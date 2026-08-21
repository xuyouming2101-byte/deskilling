import assert from "node:assert/strict";
import test from "node:test";
import * as sessionConfig from "./sessionConfig.ts";

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type AccessTokenDependencies = {
  storage: StorageLike;
  getRandomValues(bytes: Uint8Array): Uint8Array;
};

type SessionConfigApi = {
  getOrCreateAssessmentAccessToken(
    participantId: string,
    sessionNumber: number,
    dependencies: AccessTokenDependencies
  ): string;
  buildStartOrResumeRpcParams(
    participantId: string,
    sessionNumber: number,
    accessToken: string
  ): Record<string, unknown>;
};

const api = sessionConfig as typeof sessionConfig & SessionConfigApi;

function createFakeStorage() {
  const values = new Map<string, string>();

  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      }
    } satisfies StorageLike
  };
}

test("reuses one generated token for the same participant and session", () => {
  const { values, storage } = createFakeStorage();
  let randomCalls = 0;
  const dependencies: AccessTokenDependencies = {
    storage,
    getRandomValues: (bytes) => {
      randomCalls += 1;
      bytes.forEach((_, index) => {
        bytes[index] = index;
      });
      return bytes;
    }
  };

  const first = api.getOrCreateAssessmentAccessToken("P001", 1, dependencies);
  const second = api.getOrCreateAssessmentAccessToken("P001", 1, dependencies);

  assert.equal(
    first,
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
  );
  assert.equal(second, first);
  assert.equal(randomCalls, 1);
  assert.deepEqual([...values.entries()], [
    ["assessment-access:v1:P001:1", first]
  ]);
});

test("isolates access tokens by participant session", () => {
  const { values, storage } = createFakeStorage();
  let seed = 16;
  const dependencies: AccessTokenDependencies = {
    storage,
    getRandomValues: (bytes) => {
      bytes.fill(seed);
      seed += 16;
      return bytes;
    }
  };

  const sessionOne = api.getOrCreateAssessmentAccessToken(
    "P001",
    1,
    dependencies
  );
  const sessionTwo = api.getOrCreateAssessmentAccessToken(
    "P001",
    2,
    dependencies
  );

  assert.equal(sessionOne, "10".repeat(32));
  assert.equal(sessionTwo, "20".repeat(32));
  assert.notEqual(sessionOne, sessionTwo);
  assert.deepEqual([...values.keys()], [
    "assessment-access:v1:P001:1",
    "assessment-access:v1:P001:2"
  ]);
});

test("builds exactly the three start RPC parameters", () => {
  const params = api.buildStartOrResumeRpcParams(
    "P001",
    2,
    "browser-token"
  );

  assert.deepEqual(params, {
    p_participant_id: "P001",
    p_session_number: 2,
    p_access_token: "browser-token"
  });
  assert.deepEqual(Object.keys(params).sort(), [
    "p_access_token",
    "p_participant_id",
    "p_session_number"
  ]);
});
