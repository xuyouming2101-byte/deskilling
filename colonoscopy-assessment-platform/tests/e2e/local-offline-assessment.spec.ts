import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nextBinary = path.join(repositoryRoot, "node_modules/next/dist/bin/next");
const denyOutboundHook = path.join(import.meta.dirname, "deny-outbound.cjs");
const ffmpegBinary = "/opt/homebrew/bin/ffmpeg";

type RunningServer = {
  child: ChildProcessWithoutNullStreams;
  baseUrl: string;
  logs: string[];
};

type OfflineFixture = {
  root: string;
  videoRoot: string;
  databasePath: string;
  packagePath: string;
};

type BrowserAudit = {
  outboundUrls: string[];
  requestUrls: string[];
  responseReads: Promise<void>[];
  assessmentPayloads: string[];
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

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function createFormalFixture(): Promise<OfflineFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "local-formal-e2e-"));
  const videoRoot = path.join(root, "videos");
  const databasePath = path.join(root, "assessment.sqlite3");
  const packagePath = path.join(root, "sealed-formal-package.json");
  const manifestPath = path.join(root, "manifest.json");
  const rosterPath = path.join(root, "roster.csv");
  const sourceVideo = path.join(root, "source.mp4");
  await mkdir(videoRoot);

  await execFileAsync(ffmpegBinary, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=160x90:r=25",
    "-t",
    "1.2",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    sourceVideo
  ]);

  const videos = [];

  for (const sessionPool of [1, 2, 3] as const) {
    for (let index = 1; index <= 40; index += 1) {
      const padded = String(index).padStart(3, "0");
      const filePath = `formal_s${sessionPool}_${padded}.mp4`;
      await copyFile(sourceVideo, path.join(videoRoot, filePath));
      videos.push({
        videoId: `FORMAL_S${sessionPool}_${padded}`,
        filePath,
        hasLesion: sessionPool === 1,
        lesionOnsetSec: sessionPool === 1 ? 1.1 : null,
        isTest: false,
        sessionPool
      });
    }
  }

  await writeFile(
    manifestPath,
    `${JSON.stringify({
      packageVersion: 1,
      minimumSchemaVersion: 1,
      studyMode: "formal",
      generatedAt: "2026-08-29T00:00:00.000Z",
      videos
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(rosterPath, "participant_id\nP001\n", "utf8");
  await execFileAsync(process.execPath, [
    path.join(repositoryRoot, "scripts/local-study/build-package.mjs"),
    "--manifest",
    manifestPath,
    "--video-root",
    videoRoot,
    "--output",
    packagePath,
    "--roster",
    rosterPath
  ], { cwd: repositoryRoot });

  return { root, videoRoot, databasePath, packagePath };
}

async function startLocalServer(
  fixture: OfflineFixture,
  port: number
): Promise<RunningServer> {
  const logs: string[] = [];
  const child = spawn(
    process.execPath,
    [nextBinary, "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ASSESSMENT_DEPLOYMENT_MODE: "local",
        LOCAL_DATABASE_PATH: fixture.databasePath,
        LOCAL_STUDY_PACKAGE_PATH: fixture.packagePath,
        LOCAL_VIDEO_ROOT: fixture.videoRoot,
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
        SUPABASE_ACCESS_TOKEN: "",
        SUPABASE_DB_URL: "",
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--require=${JSON.stringify(denyOutboundHook)}`
        ]
          .filter(Boolean)
          .join(" ")
      },
      stdio: "pipe"
    }
  );
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  const baseUrl = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`LOCAL Next.js server exited early.\n${logs.join("")}`);
    }

    try {
      const response = await fetch(baseUrl);

      if (response.ok) {
        return { child, baseUrl, logs };
      }
    } catch {
      // The process may still be compiling its first request.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  child.kill("SIGTERM");
  throw new Error(`LOCAL Next.js server did not become ready.\n${logs.join("")}`);
}

async function stopLocalServer(server: RunningServer): Promise<void> {
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
    await new Promise<void>((resolve) => server.child.once("exit", () => resolve()));
  }
}

async function newOfflineContext(
  browser: Browser,
  audit: BrowserAudit
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());

    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== "127.0.0.1" &&
      url.hostname !== "localhost"
    ) {
      audit.outboundUrls.push(url.href);
      await route.abort("blockedbyclient");
      return;
    }

    await route.continue();
  });
  context.on("request", (request) => audit.requestUrls.push(request.url()));
  context.on("response", (response) => {
    const url = new URL(response.url());

    if (url.pathname.startsWith("/api/assessment/")) {
      audit.responseReads.push(
        response.text().then((text) => {
          audit.assessmentPayloads.push(text);
        }).catch(() => undefined)
      );
    }
  });
  return context;
}

async function startParticipant(page: Page, participantId = "P001"): Promise<void> {
  await page.getByLabel("Participant ID").fill(participantId);
  await page.getByLabel("Session number").selectOption("1");
  await page.getByRole("button", { name: "Start", exact: true }).click();
}

async function setPlaybackRate(page: Page, rate = 16): Promise<void> {
  await page.locator("video").evaluate((video, playbackRate) => {
    (video as HTMLVideoElement).playbackRate = playbackRate;
  }, rate);
}

async function completeNoResponse(page: Page, videoOrder: number): Promise<void> {
  await expect(page.getByText(`Video ${videoOrder} / 40`, { exact: true })).toBeVisible();
  await setPlaybackRate(page);
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  const noButton = page.getByRole("button", { name: "No lesion detected" });
  await expect(noButton).toBeEnabled();
  await noButton.click();

  if (videoOrder < 40) {
    await expect(page.getByText(`Video ${videoOrder + 1} / 40`, { exact: true })).toBeVisible();
  }
}

async function browserPost(
  page: Page,
  pathName: string,
  payload: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  return await page.evaluate(async ({ pathName, payload }) => {
    const response = await fetch(pathName, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>
    };
  }, { pathName, payload });
}

test("completes and recovers a 40-video FORMAL attempt fully offline", async ({ browser }) => {
  const fixture = await createFormalFixture();
  const port = await reserveLoopbackPort();
  const audit: BrowserAudit = {
    outboundUrls: [],
    requestUrls: [],
    responseReads: [],
    assessmentPayloads: []
  };
  const allServerLogs: string[] = [];
  let server = await startLocalServer(fixture, port);
  let context: BrowserContext | null = null;
  let firstSubmission: Record<string, unknown> | null = null;

  try {
    context = await newOfflineContext(browser, audit);
    let page = await context.newPage();
    page.on("dialog", (dialog) => dialog.accept());
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/assessment/response") &&
        request.method() === "POST" &&
        firstSubmission === null
      ) {
        firstSubmission = request.postDataJSON() as Record<string, unknown>;
      }
    });
    await page.goto(server.baseUrl);

    await expect(page.getByLabel("Participant intake")).toContainText("Participant ID");
    await expect(page.getByLabel("Participant intake")).toContainText("Session number");
    await expect(page.getByLabel("Participant intake")).not.toContainText(/password|access code|study mode|roster|filesystem|Supabase/i);

    await startParticipant(page, "UNKNOWN");
    await expect(page.getByText("Participant ID is not in the sealed FORMAL participant roster.")).toBeVisible();
    let db = new Database(fixture.databasePath, { readonly: true });
    expect((db.prepare("SELECT COUNT(*) AS count FROM local_assessment_attempts").get() as { count: number }).count).toBe(0);
    db.close();

    await startParticipant(page);
    await expect(page.getByText("Video 1 / 40", { exact: true })).toBeVisible();
    const queueBeforeRestart = (() => {
      const queueDb = new Database(fixture.databasePath, { readonly: true });
      const rows = queueDb.prepare(
        "SELECT video_id, video_order FROM local_assessment_queue ORDER BY video_order"
      ).all();
      queueDb.close();
      return rows;
    })();
    expect(queueBeforeRestart).toHaveLength(40);

    const videoSource = await page.locator("video").getAttribute("src");
    expect(videoSource).toMatch(/^\/api\/local\/attempts\/[^/]+\/videos\/1$/);
    const rangeResult = await page.evaluate(async (source) => {
      const partial = await fetch(source!, { headers: { Range: "bytes=0-31" } });
      const head = await fetch(source!, { method: "HEAD" });
      const unsatisfied = await fetch(source!, {
        headers: { Range: "bytes=999999999-" }
      });
      return {
        partialStatus: partial.status,
        partialLength: (await partial.arrayBuffer()).byteLength,
        contentRange: partial.headers.get("content-range"),
        headStatus: head.status,
        unsatisfiedStatus: unsatisfied.status
      };
    }, videoSource);
    expect(rangeResult.partialStatus).toBe(206);
    expect(rangeResult.partialLength).toBe(32);
    expect(rangeResult.contentRange).toMatch(/^bytes 0-31\/\d+$/);
    expect(rangeResult.headStatus).toBe(200);
    expect(rangeResult.unsatisfiedStatus).toBe(416);

    const timeline = page.getByLabel("Seek video");
    await expect(timeline).toBeEnabled();
    const videoDuration = Number(await timeline.getAttribute("max"));
    expect(videoDuration).toBeGreaterThan(0);

    const seekTo = async (fraction: number) => {
      const target = videoDuration * fraction;
      await timeline.evaluate((input, nextTime) => {
        const range = input as HTMLInputElement;
        range.value = String(nextTime);
        range.dispatchEvent(new Event("input", { bubbles: true }));
      }, target);
      await expect.poll(() => page.locator("video").evaluate(
        (video) => (video as HTMLVideoElement).currentTime
      )).toBeCloseTo(target, 1);
    };

    await seekTo(0.75);
    await seekTo(0.2);
    await seekTo(0.6);

    await page.getByRole("button", { name: "Play video", exact: true }).click();
    await expect(page.getByRole("button", { name: "Lesion detected", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Lesion detected", exact: true }).click();
    await page.getByRole("button", { name: "Lesion detected", exact: true }).click();
    await expect(page.getByText("Mark 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete mark 1" }).click();
    await expect(page.getByText("Mark 1", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Mark 2", { exact: true })).toHaveCount(0);

    await expect(page.getByRole("button", { name: "No lesion detected" })).toBeEnabled();
    await timeline.evaluate((input) => {
      const range = input as HTMLInputElement;
      range.value = "0.2";
      range.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect.poll(() => page.locator("video").evaluate((video) => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0.15);
    await page.getByRole("button", { name: "Replay video" }).click();
    await page.getByRole("button", { name: "Lesion detected", exact: true }).click();
    await expect(page.getByText("Mark 2", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "No lesion detected" })).toBeEnabled();
    await page.getByRole("button", { name: "Next video" }).click();
    await expect(page.getByText("Video 2 / 40", { exact: true })).toBeVisible();
    expect(firstSubmission).not.toBeNull();

    const exactRetry = await browserPost(page, "/api/assessment/response", firstSubmission!);
    expect(exactRetry.status).toBe(200);
    const differingRetry = await browserPost(page, "/api/assessment/response", {
      ...firstSubmission!,
      response_time_ms: Number(firstSubmission!.response_time_ms) + 1
    });
    expect(differingRetry.status).toBe(409);

    await setPlaybackRate(page);
    await page.getByRole("button", { name: "Play video", exact: true }).click();
    await page.getByRole("button", { name: "Lesion detected", exact: true }).click();
    await expect(page.getByRole("button", { name: "No lesion detected" })).toBeEnabled();
    await page.getByRole("button", { name: "No lesion detected" }).click();
    await expect(page.getByText("Video 3 / 40", { exact: true })).toBeVisible();
    await completeNoResponse(page, 3);

    await context.close();
    context = await newOfflineContext(browser, audit);
    page = await context.newPage();
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(server.baseUrl);
    await startParticipant(page);
    await expect(page.getByText("Video 4 / 40", { exact: true })).toBeVisible();
    await completeNoResponse(page, 4);
    await completeNoResponse(page, 5);

    allServerLogs.push(...server.logs);
    await stopLocalServer(server);
    server = await startLocalServer(fixture, port);
    await context.close();
    context = await newOfflineContext(browser, audit);
    page = await context.newPage();
    await page.goto(server.baseUrl);
    await startParticipant(page);
    await expect(page.getByText("Video 6 / 40", { exact: true })).toBeVisible();
    const queueAfterRestart = (() => {
      const queueDb = new Database(fixture.databasePath, { readonly: true });
      const rows = queueDb.prepare(
        "SELECT video_id, video_order FROM local_assessment_queue ORDER BY video_order"
      ).all();
      queueDb.close();
      return rows;
    })();
    expect(queueAfterRestart).toEqual(queueBeforeRestart);

    for (let videoOrder = 6; videoOrder <= 40; videoOrder += 1) {
      await completeNoResponse(page, videoOrder);
    }

    await expect(page.getByText("All 40 videos have been completed.")).toBeVisible();
    await page.reload();
    await startParticipant(page);
    await expect(page.getByText("All 40 videos have been completed.")).toBeVisible();

    db = new Database(fixture.databasePath, { readonly: true });
    expect((db.pragma("quick_check") as Array<Record<string, unknown>>)[0]).toEqual({ quick_check: "ok" });
    expect((db.pragma("foreign_key_check") as unknown[])).toHaveLength(0);
    const counts = db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM local_assessment_attempts) AS attempts,
         (SELECT COUNT(*) FROM local_assessment_queue) AS queue_rows,
         (SELECT COUNT(*) FROM local_responses) AS responses,
         (SELECT COUNT(*) FROM local_lesion_detection_events) AS events`
    ).get() as { attempts: number; queue_rows: number; responses: number; events: number };
    expect(counts).toEqual({ attempts: 1, queue_rows: 40, responses: 40, events: 2 });
    const firstResponse = db.prepare(
      `SELECT answer, video_time_at_click_ms, detection_latency_ms,
              no_response_latency_ms, response_time_ms
       FROM local_responses WHERE video_order = 1`
    ).get() as Record<string, number | null>;
    expect(firstResponse.answer).toBe(1);
    expect(firstResponse.video_time_at_click_ms).not.toBeNull();
    expect(firstResponse.detection_latency_ms).toBeLessThan(0);
    expect(firstResponse.no_response_latency_ms).toBeNull();
    expect(firstResponse.response_time_ms).toBeGreaterThanOrEqual(0);
    const firstResponseEvents = db.prepare(
      `SELECT click_index FROM local_lesion_detection_events
       WHERE video_order = 1 ORDER BY click_index`
    ).all() as Array<{ click_index: number }>;
    expect(firstResponseEvents).toEqual([{ click_index: 1 }, { click_index: 2 }]);
    const noResponsesWithDetectionTimes = (db.prepare(
      `SELECT COUNT(*) AS count FROM local_responses
       WHERE answer = 0 AND (video_time_at_click_ms IS NOT NULL OR detection_latency_ms IS NOT NULL)`
    ).get() as { count: number }).count;
    expect(noResponsesWithDetectionTimes).toBe(0);
    const orderTwoEvents = (db.prepare(
      "SELECT COUNT(*) AS count FROM local_lesion_detection_events WHERE video_order = 2"
    ).get() as { count: number }).count;
    expect(orderTwoEvents).toBe(0);
    const attempt = db.prepare(
      "SELECT attempt_id, status FROM local_assessment_attempts"
    ).get() as { attempt_id: string; status: string };
    expect(attempt.status).toBe("completed");
    db.close();

    const terminalConflict = await browserPost(page, "/api/assessment/response", {
      ...firstSubmission!,
      video_order: 40
    });
    expect(terminalConflict.status).toBe(409);

    await Promise.all(audit.responseReads);
    const browserVisibleData = `${await page.locator("body").innerText()}\n${audit.assessmentPayloads.join("\n")}`;
    expect(browserVisibleData).not.toContain(fixture.root);
    expect(browserVisibleData).not.toMatch(/hasLesion|has_lesion|lesionOnset|lesion_onset|filePath|file_path/);
    expect(audit.outboundUrls).toEqual([]);
    expect(audit.requestUrls.filter((url) => /^https?:/.test(url)).every((url) => {
      const host = new URL(url).hostname;
      return host === "127.0.0.1" || host === "localhost";
    })).toBe(true);
    expect(audit.requestUrls.some((url) => url.includes("/api/local/attempts/"))).toBe(true);
    const logs = `${allServerLogs.join("")}\n${server.logs.join("")}`;
    expect(logs).not.toContain("OFFLINE_TEST_BLOCKED_OUTBOUND_FETCH");
    expect(logs).not.toContain("supabase.co");
    expect(logs).not.toContain(fixture.videoRoot);
    expect(logs).not.toMatch(/hasLesion|lesionOnset/);
    expect(JSON.parse(await readFile(fixture.packagePath, "utf8")).videos).toHaveLength(120);
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }

    allServerLogs.push(...server.logs);
    await stopLocalServer(server);
    await rm(fixture.root, { recursive: true, force: true });
  }
});
