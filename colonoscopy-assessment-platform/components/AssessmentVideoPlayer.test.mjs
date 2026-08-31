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
    "const shouldNotifyParent = !endedRef.current;",
    "endedRef.current = true;",
    "setIsPlaying(false);",
    "onPlaybackStateChange(false);",
    "onEnded(endedAtMs);"
  ]);
});

test("keeps the full timeline interactive from the start", () => {
  const videoTag = source.match(/<video\b[\s\S]*?\/>/)?.[0];

  assert.ok(videoTag, "Expected a video JSX element.");
  assert.doesNotMatch(videoTag, /\bcontrols(?:\s|=|\/?>)/);
  assert.match(source, /<input\b[\s\S]*?type=\"range\"/);
  assert.match(source, /video\.currentTime\s*=\s*Math\.min\(Math\.max\(0/);
  assert.match(source, /aria-label=\"Replay video\"/);
  assert.match(source, /step=\{0\.001\}/);
  assert.doesNotMatch(source, /maxWatchedTimeRef|handleSeeking|onSeeking/);
  assert.doesNotMatch(source, /fullscreen|requestFullscreen|Maximize2/i);
  assert.match(source, /\bforwardRef\s*</);
  assert.match(videoTag, /onPlay=\{handlePlay\}/);
  assert.match(videoTag, /onEnded=\{handleEnded\}/);
  assert.match(videoTag, /onLoadedMetadata=\{syncPosition\}/);
});
