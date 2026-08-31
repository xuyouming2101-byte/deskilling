import { expect, test, type Page } from "@playwright/test";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nextBinary = path.join(repositoryRoot, "node_modules/next/dist/bin/next");
const ffmpegBinary = "/opt/homebrew/bin/ffmpeg";

type RunningServer = {
  child: ChildProcessWithoutNullStreams;
  baseUrl: string;
  logs: string[];
};

type UiSnapshot = {
  html: string;
  text: string;
  controls: Array<{
    tag: string;
    text: string;
    ariaLabel: string | null;
    className: string;
    disabled: boolean;
  }>;
  classes: string[];
  screenshot: Buffer;
};

async function reserveLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve a loopback port."));
        return;
      }

      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startParityServer(port: number): Promise<RunningServer> {
  const logs: string[] = [];
  const child = spawn(
    process.execPath,
    [nextBinary, "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ASSESSMENT_DEPLOYMENT_MODE: "local",
        ASSESSMENT_UI_PARITY_FIXTURE: "1",
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        NEXT_TELEMETRY_DISABLED: "1"
      },
      stdio: "pipe"
    }
  );
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  const baseUrl = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Parity server exited early.\n${logs.join("")}`);
    }

    try {
      const response = await fetch(baseUrl);

      if (response.ok) {
        return { child, baseUrl, logs };
      }
    } catch {
      // The first request may still be compiling.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  child.kill("SIGTERM");
  throw new Error(`Parity server did not become ready.\n${logs.join("")}`);
}

async function stopServer(server: RunningServer): Promise<void> {
  if (server.child.exitCode !== null) {
    return;
  }

  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000))
  ]);

  if (server.child.exitCode === null) {
    server.child.kill("SIGKILL");
  }
}

async function renderAssessment(
  page: Page,
  baseUrl: string,
  variant: "local" | "online",
  videoPath: string
): Promise<UiSnapshot> {
  await page.route("**/ui-parity-fixture/fixture.mp4", async (route) => {
    await route.fulfill({
      body: await import("node:fs/promises").then(({ readFile }) => readFile(videoPath)),
      contentType: "video/mp4",
      status: 200
    });
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${baseUrl}/ui-parity-fixture?variant=${variant}`);
  await page.getByLabel("Participant ID").fill("P001");
  await page.getByLabel("Session number").selectOption("1");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Video 1 / 3", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready to play", { exact: true })).toBeVisible();

  const shell = page.locator(".assessment-shell");
  const structure = await shell.evaluate((element) => ({
    html: element.innerHTML,
    text: (element as HTMLElement).innerText,
    controls: Array.from(element.querySelectorAll("button, input, select")).map(
      (control) => ({
        tag: control.tagName.toLowerCase(),
        text: (control as HTMLElement).innerText,
        ariaLabel: control.getAttribute("aria-label"),
        className: control.getAttribute("class") ?? "",
        disabled: (control as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled
      })
    ),
    classes: Array.from(element.querySelectorAll("[class]"))
      .map((node) => node.getAttribute("class") ?? "")
  }));

  return {
    ...structure,
    screenshot: await shell.screenshot({ animations: "disabled" })
  };
}

test("LOCAL and ONLINE render the same shared assessment after intake", async ({ browser }) => {
  test.setTimeout(180_000);
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "assessment-ui-parity-"));
  const videoPath = path.join(fixtureRoot, "fixture.mp4");
  const port = await reserveLoopbackPort();
  const server = await startParityServer(port);

  try {
    await execFileAsync(ffmpegBinary, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=640x360:r=25",
      "-t",
      "1",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      videoPath
    ]);

    const localPage = await browser.newPage();
    const onlinePage = await browser.newPage();
    const local = await renderAssessment(localPage, server.baseUrl, "local", videoPath);
    const online = await renderAssessment(onlinePage, server.baseUrl, "online", videoPath);

    expect(local.html).toBe(online.html);
    expect(local.text).toBe(online.text);
    expect(local.controls).toEqual(online.controls);
    expect(local.classes).toEqual(online.classes);
    expect(local.screenshot.equals(online.screenshot)).toBe(true);

    await localPage.close();
    await onlinePage.close();
  } finally {
    await stopServer(server);
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});
