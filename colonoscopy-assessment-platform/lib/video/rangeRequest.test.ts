import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSingleRange,
  RangeNotSatisfiableError
} from "./rangeRequest.ts";

function assertRangeError(header: string | null, size: number) {
  assert.throws(
    () => parseSingleRange(header, size),
    (error) =>
      error instanceof RangeNotSatisfiableError &&
      Object.is(error.fileSize, size)
  );
}

test("returns null when no Range header is supplied", () => {
  assert.equal(parseSingleRange(null, 100), null);
});

test("parses explicit, open-ended, suffix, and last-byte ranges", () => {
  assert.deepEqual(parseSingleRange("bytes=0-9", 100), {
    start: 0,
    end: 9,
    length: 10
  });
  assert.deepEqual(parseSingleRange("bytes=10-", 100), {
    start: 10,
    end: 99,
    length: 90
  });
  assert.deepEqual(parseSingleRange("bytes=-10", 100), {
    start: 90,
    end: 99,
    length: 10
  });
  assert.deepEqual(parseSingleRange("bytes=99-99", 100), {
    start: 99,
    end: 99,
    length: 1
  });
});

test("caps an explicit end at the final byte", () => {
  assert.deepEqual(parseSingleRange("bytes=90-200", 100), {
    start: 90,
    end: 99,
    length: 10
  });
});

test("treats a suffix larger than the file as the complete file", () => {
  assert.deepEqual(parseSingleRange("bytes=-200", 100), {
    start: 0,
    end: 99,
    length: 100
  });
});

test("rejects malformed, empty, reversed, and multiple ranges", () => {
  for (const header of [
    "items=0-9",
    "bytes=",
    "bytes=10-9",
    "bytes=0-1,4-5",
    "bytes=a-b",
    "bytes=1.5-2",
    "bytes= 0-1",
    "bytes=0 -1"
  ]) {
    assertRangeError(header, 100);
  }
});

test("rejects unsatisfiable zero-size, out-of-bounds, and zero suffix ranges", () => {
  assertRangeError("bytes=0-", 0);
  assertRangeError("bytes=100-", 100);
  assertRangeError("bytes=-0", 100);
});

test("rejects invalid file sizes with a typed range error", () => {
  for (const size of [-1, 1.5, Number.NaN]) {
    assertRangeError("bytes=0-", size);
  }
});
