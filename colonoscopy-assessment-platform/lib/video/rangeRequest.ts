export type ByteRange = {
  start: number;
  end: number;
  length: number;
};

export class RangeNotSatisfiableError extends Error {
  readonly fileSize: number;

  constructor(fileSize: number) {
    super("Requested byte range is invalid or unsatisfiable.");
    this.name = "RangeNotSatisfiableError";
    this.fileSize = fileSize;
  }
}

function failRange(fileSize: number): never {
  throw new RangeNotSatisfiableError(fileSize);
}

function parseByteOffset(value: string, fileSize: number): number {
  if (!/^\d+$/.test(value)) {
    return failRange(fileSize);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    return failRange(fileSize);
  }

  return parsed;
}

export function parseSingleRange(
  header: string | null,
  size: number
): ByteRange | null {
  if (!Number.isSafeInteger(size) || size < 0) {
    return failRange(size);
  }

  if (header === null) {
    return null;
  }

  if (!header.startsWith("bytes=") || header.includes(",")) {
    return failRange(size);
  }

  const value = header.slice("bytes=".length);
  const match = /^(\d*)-(\d*)$/.exec(value);

  if (!match || (match[1] === "" && match[2] === "") || size === 0) {
    return failRange(size);
  }

  const [, startValue, endValue] = match;
  let start: number;
  let end: number;

  if (startValue === "") {
    const suffixLength = parseByteOffset(endValue, size);

    if (suffixLength === 0) {
      return failRange(size);
    }

    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = parseByteOffset(startValue, size);

    if (start >= size) {
      return failRange(size);
    }

    if (endValue === "") {
      end = size - 1;
    } else {
      const requestedEnd = parseByteOffset(endValue, size);

      if (requestedEnd < start) {
        return failRange(size);
      }

      end = Math.min(requestedEnd, size - 1);
    }
  }

  return {
    start,
    end,
    length: end - start + 1
  };
}
