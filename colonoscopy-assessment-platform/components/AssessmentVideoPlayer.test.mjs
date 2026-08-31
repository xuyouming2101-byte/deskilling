import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./AssessmentVideoPlayer.tsx", import.meta.url),
  "utf8"
);

function getHandleEndedBody() {
  const match = source.match(
    /const handleEnded = \(\) => \{(?<body>[\s\S]*?)\n  \};/
  );

  assert.ok(match?.groups?.body, "Expected a handleEnded function body.");
  return match.groups.body;
}

function assertLexicalOrder(body, statements) {
  const positions = statements.map((statement) => {
    const position = body.indexOf(statement);
    assert.notEqual(position, -1, `Expected handleEnded to contain: ${statement}`);
    return position;
  });

  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(
      positions[index - 1] < positions[index],
      `Expected ${statements[index - 1]} to precede ${statements[index]}.`
    );
  }
}

test("captures the ended timestamp before mutating state or notifying parents", () => {
  assertLexicalOrder(getHandleEndedBody(), [
    "const endedAtMs = performance.now();",
    "endedRef.current = true;",
    "setIsPlaying(false);",
    "onPlaybackStateChange(false);",
    "onEnded(endedAtMs);"
  ]);
});

test("keeps the full timeline unlocked as soon as metadata is available", () => {
  const videoTag = source.match(/<video\b[\s\S]*?\/>/)?.[0];

  assert.ok(videoTag, "Expected a video JSX element.");
  assert.doesNotMatch(videoTag, /\bcontrols(?:\s|=|\/?>)/);
  assert.doesNotMatch(source, /maxWatchedTimeRef/);
  assert.doesNotMatch(source, /const handleSeeking/);
  assert.doesNotMatch(videoTag, /onSeeking=/);
  assert.match(
    source,
    /video\.currentTime = Math\.min\(Math\.max\(0, nextTime\), duration\)/
  );
  assert.match(source, /\bcurrentTime\s*=/);
  assert.doesNotMatch(source, /\bfastSeek\s*\(/);
  assert.match(source, /<input\b[\s\S]*?\btype\s*=\s*["']range["']/);
  assert.match(source, /onInput=\{seekVideo\}/);
  assert.match(source, /Replay video/);
  assert.doesNotMatch(source, /fullscreen|requestFullscreen|Maximize2/i);
  assert.match(source, /\bforwardRef\s*</);
  assert.match(videoTag, /onPlay=\{handlePlay\}/);
  assert.match(videoTag, /onEnded=\{handleEnded\}/);
  assert.doesNotMatch(source, /if \(endedRef\.current \|\| locked\)/);
});

test("does not report an interrupted play request as a video loading error", () => {
  assert.match(
    source,
    /error instanceof DOMException && error\.name === "AbortError"/
  );
  assert.doesNotMatch(source, /\.play\(\)\.catch\(onVideoError\)/);
});

test("omits audio controls for silent colonoscopy clips", () => {
  assert.doesNotMatch(
    source,
    /Volume2|VolumeX|isMuted|toggleMute|Mute video|Unmute video|muted=/
  );
});
