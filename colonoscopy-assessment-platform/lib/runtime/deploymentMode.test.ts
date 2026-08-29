import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export%20{}"
      };
    }

    return nextResolve(specifier, context);
  }
});

const { parseDeploymentMode, readDeploymentMode } = await import(
  "./deploymentMode.ts"
);

test("accepts only exact local and online deployment modes", () => {
  assert.equal(parseDeploymentMode("local"), "local");
  assert.equal(parseDeploymentMode("online"), "online");
});

test("fails closed for missing, invalid, or mixed-case deployment modes", () => {
  for (const value of [undefined, "", "LOCAL", "Online", "remote", "dev"]) {
    assert.throws(
      () => parseDeploymentMode(value),
      /ASSESSMENT_DEPLOYMENT_MODE must be exactly local or online/
    );
  }
});

test("does not infer deployment mode from host, port, branch, or browser flags", () => {
  assert.throws(
    () =>
      readDeploymentMode({
        HOSTNAME: "localhost",
        PORT: "3000",
        GIT_BRANCH: "main",
        NEXT_PUBLIC_ASSESSMENT_DEPLOYMENT_MODE: "local",
        QUERY_MODE: "local",
        COOKIE_MODE: "local"
      }),
    /ASSESSMENT_DEPLOYMENT_MODE must be exactly local or online/
  );
});

test("reads the server-side deployment mode on every call", () => {
  const environment: Record<string, string | undefined> = {
    ASSESSMENT_DEPLOYMENT_MODE: "local"
  };

  assert.equal(readDeploymentMode(environment), "local");
  environment.ASSESSMENT_DEPLOYMENT_MODE = "online";
  assert.equal(readDeploymentMode(environment), "online");
});
