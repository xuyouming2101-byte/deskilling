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

const { validateLocalStudyPackage } = await import(
  "../../lib/local/studyPackage.ts"
);

function readArguments(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "Usage: validate-package --package <json> --video-root <dir>"
      );
    }

    values.set(key, value);
  }

  if (!values.has("--package") || !values.has("--video-root")) {
    throw new Error("Both --package and --video-root are required.");
  }

  return values;
}

const argumentsMap = readArguments(process.argv.slice(2));
const packagePath = resolve(argumentsMap.get("--package"));
const videoRoot = resolve(argumentsMap.get("--video-root"));
const studyPackage = await validateLocalStudyPackage(
  JSON.parse(await readFile(packagePath, "utf8")),
  videoRoot
);

console.log(
  JSON.stringify({
    valid: true,
    study_mode: studyPackage.studyMode,
    video_count: studyPackage.videos.length,
    participant_count: studyPackage.allowedParticipantIds.length,
    checksum_sha256: studyPackage.checksumSha256
  })
);
