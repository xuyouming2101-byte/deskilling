import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const originalEnvironment = {
  diagnostics: process.env.ASSESSMENT_DEV_DIAGNOSTICS,
  packagePath: process.env.LOCAL_STUDY_PACKAGE_PATH
};

async function importGate() {
  return await import("./devDiagnostics.ts");
}

test.afterEach(() => {
  if (originalEnvironment.diagnostics === undefined) {
    delete process.env.ASSESSMENT_DEV_DIAGNOSTICS;
  } else {
    process.env.ASSESSMENT_DEV_DIAGNOSTICS = originalEnvironment.diagnostics;
  }

  if (originalEnvironment.packagePath === undefined) {
    delete process.env.LOCAL_STUDY_PACKAGE_PATH;
  } else {
    process.env.LOCAL_STUDY_PACKAGE_PATH = originalEnvironment.packagePath;
  }
});

test("enables diagnostics only for an explicitly gated LOCAL DEV package", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "assessment-dev-gate-"));
  const packagePath = path.join(root, "study-package.json");

  try {
    process.env.ASSESSMENT_DEV_DIAGNOSTICS = "1";
    process.env.LOCAL_STUDY_PACKAGE_PATH = packagePath;
    await writeFile(packagePath, JSON.stringify({ studyMode: "dev" }), "utf8");
    const { readDevDiagnosticsGate } = await importGate();

    assert.equal(await readDevDiagnosticsGate("local"), true);
    assert.equal(await readDevDiagnosticsGate("online"), false);

    await writeFile(packagePath, JSON.stringify({ studyMode: "formal" }), "utf8");
    assert.equal(await readDevDiagnosticsGate("local"), false);

    process.env.ASSESSMENT_DEV_DIAGNOSTICS = "0";
    await writeFile(packagePath, JSON.stringify({ studyMode: "dev" }), "utf8");
    assert.equal(await readDevDiagnosticsGate("local"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when the package is absent or malformed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "assessment-dev-gate-"));
  const packagePath = path.join(root, "study-package.json");

  try {
    process.env.ASSESSMENT_DEV_DIAGNOSTICS = "1";
    process.env.LOCAL_STUDY_PACKAGE_PATH = packagePath;
    const { readDevDiagnosticsGate } = await importGate();

    assert.equal(await readDevDiagnosticsGate("local"), false);
    await writeFile(packagePath, "not-json", "utf8");
    assert.equal(await readDevDiagnosticsGate("local"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
