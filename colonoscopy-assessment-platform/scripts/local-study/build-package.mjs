import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
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

const {
  buildLocalStudyPackage,
  parseFormalParticipantRosterCsv,
  writeLocalStudyPackageAtomically
} = await import("../../lib/local/studyPackage.ts");

function readArguments(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "Usage: build-package --manifest <json> --video-root <dir> --output <json> [--roster <csv>]"
      );
    }

    values.set(key, value);
  }

  for (const required of ["--manifest", "--video-root", "--output"]) {
    if (!values.has(required)) {
      throw new Error(`Missing required argument ${required}.`);
    }
  }

  return values;
}

const argumentsMap = readArguments(process.argv.slice(2));
const manifestPath = resolve(argumentsMap.get("--manifest"));
const videoRoot = resolve(argumentsMap.get("--video-root"));
const outputPath = resolve(argumentsMap.get("--output"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const rosterPath = argumentsMap.get("--roster");

if (manifest.studyMode === "formal" && !rosterPath) {
  throw new Error("FORMAL package creation requires --roster.");
}

const allowedParticipantIds = rosterPath
  ? parseFormalParticipantRosterCsv(
      await readFile(resolve(rosterPath), "utf8")
    )
  : [];
const studyPackage = await buildLocalStudyPackage(
  { ...manifest, allowedParticipantIds },
  videoRoot
);
await writeLocalStudyPackageAtomically(outputPath, studyPackage);

console.log(
  JSON.stringify({
    output: outputPath,
    study_mode: studyPackage.studyMode,
    video_count: studyPackage.videos.length,
    participant_count: studyPackage.allowedParticipantIds.length,
    checksum_sha256: studyPackage.checksumSha256
  })
);
