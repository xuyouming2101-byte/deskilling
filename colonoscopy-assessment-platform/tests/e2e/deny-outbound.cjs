const originalFetch = globalThis.fetch;

if (typeof originalFetch === "function") {
  globalThis.fetch = function denyOutboundFetch(input, init) {
    const rawUrl =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
    const url = new URL(rawUrl);

    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      throw new Error(`OFFLINE_TEST_BLOCKED_OUTBOUND_FETCH:${url.hostname}`);
    }

    return originalFetch(input, init);
  };
}
