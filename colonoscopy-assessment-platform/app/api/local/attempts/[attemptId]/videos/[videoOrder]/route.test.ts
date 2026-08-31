import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export%20{}"
      };
    }

    if (/supabase|storage/i.test(specifier)) {
      throw new Error(`LOCAL route imported forbidden adapter: ${specifier}`);
    }

    return nextResolve(specifier, context);
  }
});

const { createLocalVideoRouteHandlers } = await import("./route.ts");
const { LocalVideoAccessGateway } = await import(
  "../../../../../../../lib/video/localVideoAccessGateway.ts"
);

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const gatewaySource = readFileSync(
  new URL(
    "../../../../../../../lib/video/localVideoAccessGateway.ts",
    import.meta.url
  ),
  "utf8"
);

const fixtureBytes = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x6d, 0x70, 0x34, 0x32, 0x6c, 0x6f, 0x63, 0x61,
  0x6c, 0x2d, 0x76, 0x69, 0x64, 0x65, 0x6f, 0x21
]);

async function createRouteFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "deskilling-route-test-"));
  await writeFile(path.join(root, "video_002.mp4"), fixtureBytes);

  let authorizationCalls = 0;
  const authorizationRepository = {
    async authorizeCurrentVideo(attemptId: string, videoOrder: number) {
      authorizationCalls += 1;

      if (attemptId !== "attempt-open" || videoOrder !== 2) {
        throw new Error("not the current in-progress video");
      }

      return {
        videoId: "video_002",
        relativeFilePath: "video_002.mp4"
      };
    }
  };

  return {
    root,
    authorizationRepository,
    getAuthorizationCalls: () => authorizationCalls,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function routeContext(attemptId: string, videoOrder: string) {
  return {
    params: Promise.resolve({ attemptId, videoOrder })
  };
}

test("builds an authorized LOCAL URL without exposing a file path", async () => {
  const fixture = await createRouteFixture();

  try {
    const gateway = new LocalVideoAccessGateway(
      fixture.authorizationRepository
    );
    const source = await gateway.getCurrentVideo({
      attemptId: "attempt-open",
      videoOrder: 2
    });

    assert.deepEqual(source, {
      attemptId: "attempt-open",
      videoId: "video_002",
      videoOrder: 2,
      url: "/api/local/attempts/attempt-open/videos/2",
      expiresAt: null
    });
    assert.doesNotMatch(source.url, /video_002\.mp4|deskilling-route-test/);
  } finally {
    await fixture.cleanup();
  }
});

test("streams the complete authorized MP4 with 200", async () => {
  const fixture = await createRouteFixture();

  try {
    let modeChecks = 0;
    const handlers = createLocalVideoRouteHandlers({
      authorizationRepository: fixture.authorizationRepository,
      readMode() {
        modeChecks += 1;
        return "local";
      },
      readVideoRoot: () => fixture.root
    });
    const response = await handlers.GET(
      new Request("http://localhost/api/local/video"),
      routeContext("attempt-open", "2")
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.equal(
      response.headers.get("content-length"),
      String(fixtureBytes.length)
    );
    assert.equal(response.headers.get("content-range"), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixtureBytes);
    assert.equal(modeChecks, 1);
    assert.equal(fixture.getAuthorizationCalls(), 1);
  } finally {
    await fixture.cleanup();
  }
});

test("streams an exact byte range with 206", async () => {
  const fixture = await createRouteFixture();

  try {
    const handlers = createLocalVideoRouteHandlers({
      authorizationRepository: fixture.authorizationRepository,
      readMode: () => "local",
      readVideoRoot: () => fixture.root
    });
    const response = await handlers.GET(
      new Request("http://localhost/api/local/video", {
        headers: { Range: "bytes=4-11" }
      }),
      routeContext("attempt-open", "2")
    );

    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 4-11/24");
    assert.equal(response.headers.get("content-length"), "8");
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      fixtureBytes.subarray(4, 12)
    );
  } finally {
    await fixture.cleanup();
  }
});

test("cancels an active Range stream cleanly, closes its file, and serves the replacement stream", async () => {
  const fixture = await createRouteFixture();
  const activeBytes = Buffer.alloc(8 * 1024 * 1024, 0x5a);
  await writeFile(path.join(fixture.root, "video_002.mp4"), activeBytes);
  let closeCalls = 0;
  const uncaught: Error[] = [];
  const monitor = (error: Error) => uncaught.push(error);

  process.on("uncaughtExceptionMonitor", monitor);

  try {
    const handlers = createLocalVideoRouteHandlers({
      authorizationRepository: fixture.authorizationRepository,
      readMode: () => "local",
      readVideoRoot: () => fixture.root,
      async openFile(filePath) {
        const fileHandle = await open(filePath, "r");
        const close = fileHandle.close.bind(fileHandle);
        fileHandle.close = async () => {
          closeCalls += 1;
          await close();
        };
        return fileHandle;
      }
    });
    const abortController = new AbortController();
    const active = await handlers.GET(
      new Request("http://localhost/api/local/video", {
        headers: { Range: `bytes=0-${activeBytes.length - 1}` },
        signal: abortController.signal
      }),
      routeContext("attempt-open", "2")
    );
    const reader = active.body!.getReader();
    const first = await reader.read();

    assert.equal(first.done, false);
    assert.ok((first.value?.byteLength ?? 0) > 0);

    const cancellation = reader.cancel("video source replaced");
    abortController.abort();
    await cancellation;
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(closeCalls, 1);
    assert.deepEqual(uncaught, []);

    const replacement = await handlers.GET(
      new Request("http://localhost/api/local/video", {
        headers: { Range: "bytes=0-7" }
      }),
      routeContext("attempt-open", "2")
    );

    assert.equal(replacement.status, 206);
    assert.deepEqual(
      Buffer.from(await replacement.arrayBuffer()),
      activeBytes.subarray(0, 8)
    );
    assert.equal(closeCalls, 2);
  } finally {
    process.off("uncaughtExceptionMonitor", monitor);
    await fixture.cleanup();
  }
});

test("HEAD returns full and partial headers without a body", async () => {
  const fixture = await createRouteFixture();

  try {
    const handlers = createLocalVideoRouteHandlers({
      authorizationRepository: fixture.authorizationRepository,
      readMode: () => "local",
      readVideoRoot: () => fixture.root
    });
    const full = await handlers.HEAD(
      new Request("http://localhost/api/local/video", { method: "HEAD" }),
      routeContext("attempt-open", "2")
    );
    const partial = await handlers.HEAD(
      new Request("http://localhost/api/local/video", {
        method: "HEAD",
        headers: { Range: "bytes=-4" }
      }),
      routeContext("attempt-open", "2")
    );

    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-length"), "24");
    assert.equal(await full.text(), "");
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), "bytes 20-23/24");
    assert.equal(partial.headers.get("content-length"), "4");
    assert.equal(await partial.text(), "");
  } finally {
    await fixture.cleanup();
  }
});

test("returns 416 with the exact file size for invalid ranges", async () => {
  const fixture = await createRouteFixture();

  try {
    const handlers = createLocalVideoRouteHandlers({
      authorizationRepository: fixture.authorizationRepository,
      readMode: () => "local",
      readVideoRoot: () => fixture.root
    });

    for (const range of ["bytes=24-", "bytes=0-1,4-5", "items=0-1"]) {
      const response = await handlers.GET(
        new Request("http://localhost/api/local/video", {
          headers: { Range: range }
        }),
        routeContext("attempt-open", "2")
      );

      assert.equal(response.status, 416);
      assert.equal(response.headers.get("content-range"), "bytes */24");
      assert.equal(response.headers.get("accept-ranges"), "bytes");
    }
  } finally {
    await fixture.cleanup();
  }
});

test("rejects disabled, previous, future, completed, and unknown requests before file access", async () => {
  const fixture = await createRouteFixture();

  try {
    let fileAccesses = 0;
    const disabledHandlers = createLocalVideoRouteHandlers({
      authorizationRepository: fixture.authorizationRepository,
      readMode: () => "online",
      readVideoRoot: () => fixture.root,
      async resolveVideoPath() {
        fileAccesses += 1;
        return "unreachable";
      }
    });
    const disabled = await disabledHandlers.GET(
      new Request("http://localhost/api/local/video"),
      routeContext("attempt-open", "2")
    );

    assert.equal(disabled.status, 404);
    assert.equal(fileAccesses, 0);
    assert.equal(fixture.getAuthorizationCalls(), 0);

    const handlers = createLocalVideoRouteHandlers({
      authorizationRepository: fixture.authorizationRepository,
      readMode: () => "local",
      readVideoRoot: () => fixture.root,
      async resolveVideoPath() {
        fileAccesses += 1;
        return "unreachable";
      }
    });

    for (const [attemptId, videoOrder] of [
      ["attempt-open", "1"],
      ["attempt-open", "3"],
      ["attempt-completed", "2"],
      ["attempt-unknown", "2"]
    ]) {
      const response = await handlers.GET(
        new Request("http://localhost/api/local/video"),
        routeContext(attemptId, videoOrder)
      );

      assert.equal(response.status, 404);
    }

    assert.equal(fileAccesses, 0);
    assert.equal(fixture.getAuthorizationCalls(), 4);
  } finally {
    await fixture.cleanup();
  }
});

test("reports a missing LOCAL file by video ID without path disclosure", async () => {
  const fixture = await createRouteFixture();

  try {
    const handlers = createLocalVideoRouteHandlers({
      authorizationRepository: {
        async authorizeCurrentVideo() {
          return {
            videoId: "video_404",
            relativeFilePath: "missing.mp4"
          };
        }
      },
      readMode: () => "local",
      readVideoRoot: () => fixture.root
    });
    const response = await handlers.GET(
      new Request("http://localhost/api/local/video"),
      routeContext("attempt-open", "2")
    );
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.match(body, /LOCAL_VIDEO_MISSING/);
    assert.match(body, /video_404/);
    assert.doesNotMatch(body, new RegExp(fixture.root.replaceAll("/", "\\/")));
    assert.doesNotMatch(body, /missing\.mp4/);
  } finally {
    await fixture.cleanup();
  }
});

test("contains no Supabase Storage or signed URL fallback", () => {
  const localSource = `${routeSource}\n${gatewaySource}`;

  assert.doesNotMatch(localSource, /supabase|createSignedUrl|signed_url|storage/i);
});
