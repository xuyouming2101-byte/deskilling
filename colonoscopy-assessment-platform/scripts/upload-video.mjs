import { createClient } from "@supabase/supabase-js";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

const projectDir = new URL("..", import.meta.url);
const envPath = new URL(".env.local", projectDir);
const bucket = "SSL";
const sourceArg = process.argv[2];
const videoIdArg = process.argv[3];
const objectPathArg = process.argv[4];

function loadLocalEnv() {
  if (!existsSync(envPath)) {
    return;
  }

  const envText = readFileSync(envPath, "utf8");

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} in .env.local`);
  }

  return value;
}

async function ensureBucket(supabase) {
  const { error } = await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: 52_428_800,
    allowedMimeTypes: ["video/mp4"]
  });

  if (error && !error.message.toLowerCase().includes("already exists")) {
    throw error;
  }
}

async function uploadVideo() {
  loadLocalEnv();

  if (!sourceArg) {
    throw new Error(
      "Usage: npm run upload:video -- /absolute/path/to/source-video.mp4 video_001 [storage-file-name.mp4]"
    );
  }

  if (!videoIdArg) {
    throw new Error("Missing video_id argument, for example video_001.");
  }

  if (!/^video_\d{3}$/.test(videoIdArg)) {
    throw new Error("video_id must use the format video_001.");
  }

  const sourcePath = resolve(sourceArg);

  if (!existsSync(sourcePath)) {
    throw new Error(`Video not found: ${sourcePath}`);
  }

  const size = statSync(sourcePath).size;

  if (size >= 52_428_800) {
    throw new Error(
      `${basename(sourcePath)} is ${size} bytes; upload target should be under 50 MiB.`
    );
  }

  const objectPath = objectPathArg ?? basename(sourcePath);

  if (!objectPath.toLowerCase().endsWith(".mp4")) {
    throw new Error("The Supabase Storage file_path must end with .mp4.");
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });

  await ensureBucket(supabase);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(objectPath, createReadStream(sourcePath), {
      cacheControl: "3600",
      contentType: "video/mp4",
      duplex: "half",
      upsert: true
    });

  if (uploadError) {
    throw uploadError;
  }

  const { error: upsertError } = await supabase.from("videos").upsert(
    {
      video_id: videoIdArg,
      bucket,
      file_path: objectPath,
      updated_at: new Date().toISOString()
    },
    { onConflict: "video_id" }
  );

  if (upsertError) {
    throw upsertError;
  }

  const { data, error: signedUrlError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, 60);

  if (signedUrlError) {
    throw signedUrlError;
  }

  console.log(`Uploaded ${sourcePath}`);
  console.log(`videos row: video_id=${videoIdArg}, bucket=${bucket}, file_path=${objectPath}`);
  console.log(`Signed URL check: ${data.signedUrl.slice(0, 80)}...`);
}

uploadVideo().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
