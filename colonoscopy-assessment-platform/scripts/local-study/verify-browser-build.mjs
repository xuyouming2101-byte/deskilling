import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const staticRoot = path.join(process.cwd(), ".next", "static");
const forbiddenPatterns = [
  ["native SQLite module", /better-sqlite3/i],
  ["sealed participant roster", /allowedParticipantIds/],
  ["lesion ground truth", /hasLesion|lesionOnsetSec/],
  ["service-role credential name", /SUPABASE_SERVICE_ROLE_KEY/],
  ["LOCAL SQLite path variable", /LOCAL_DATABASE_PATH/],
  ["LOCAL package path variable", /LOCAL_STUDY_PACKAGE_PATH/],
  ["LOCAL video root variable", /LOCAL_VIDEO_ROOT/],
  ["macOS absolute user path", /\/Users\//],
  ["server data path", /\/data\/colonoscopy-videos/],
  ["ECS working-directory path", /\/var\/www\/deskilling/]
];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    })
  );
  return nested.flat();
}

let files;

try {
  files = await listFiles(staticRoot);
} catch (error) {
  throw new Error("Run npm run build before browser-build isolation checks.", {
    cause: error
  });
}

if (files.length === 0) {
  throw new Error("The browser static build is empty.");
}

for (const filePath of files) {
  const contents = await readFile(filePath, "utf8");

  for (const [label, pattern] of forbiddenPatterns) {
    if (pattern.test(contents)) {
      throw new Error(
        `Browser build contains forbidden ${label} in ${path.relative(process.cwd(), filePath)}.`
      );
    }
  }
}

console.log(`Browser build isolation verified across ${files.length} static files.`);
