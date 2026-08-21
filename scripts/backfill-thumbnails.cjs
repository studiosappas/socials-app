// One-time maintenance script: generates thumbnail_storage_path for every
// existing image media_assets row that doesn't have one yet (uploaded
// before that column/pipeline existed -- see src/lib/image-thumbnail.ts for
// the client-side equivalent used by new uploads). Does NOT touch videos or
// rows that already have a thumbnail. Restart-safe by construction: a row
// only drops out of the "needs backfill" set once its thumbnail_storage_path
// is actually written, so re-running after a crash/interrupt just picks up
// wherever it left off -- no separate resume-token bookkeeping needed.
//
// Requires the SERVICE ROLE key (not the anon key) because this has to
// read/write media_assets across every project, not just ones the runner is
// a member of -- RLS would otherwise hide almost everything. Never expose
// this key to the client; this script only ever runs locally/by hand.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-thumbnails.cjs [--dry-run] [--project-id=<uuid>] [--limit=<n>]
//
//   --dry-run          Only counts and reports how many assets need a
//                       thumbnail; does not process anything.
//   --project-id=<id>  Restrict to one project -- run this first against a
//                       single project to sanity-check output before
//                       running against everything.
//   --limit=<n>        Stop after processing n assets (for a controlled
//                       first run); omit to process everything found.

/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS maintenance script, not part of the app bundle */
const { createClient } = require("@supabase/supabase-js");
const sharp = require("sharp");

const BUCKET = "project-media";
const MAX_DIMENSION = 480;
const JPEG_QUALITY = 82;
const FETCH_PAGE_SIZE = 1000; // Supabase's own per-request row cap.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const projectIdArg = args.find((a) => a.startsWith("--project-id="))?.split("=")[1] ?? null;
const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
const limit = limitArg ? Number.parseInt(limitArg, 10) : null;

function newThumbnailPath(projectId) {
  // Same convention as src/lib/direct-upload.ts's newStoragePath -- an
  // independent random path under the project's own prefix, not derived
  // from the original's filename (avoids any collision risk with it).
  return `${projectId}/${globalThis.crypto.randomUUID()}-thumb.jpg`;
}

async function main() {
  if (!SUPABASE_URL) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL (check .env.local or export it manually).");
    process.exit(1);
  }
  if (!SERVICE_ROLE_KEY) {
    console.error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Find it in Supabase Dashboard -> Project Settings -> API " +
        "(the 'service_role' secret, not the anon key), then re-run as:\n" +
        "  SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-thumbnails.cjs",
    );
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetched once, fully, into memory up front -- deliberately NOT re-queried
  // per batch. Re-querying "WHERE thumbnail_storage_path IS NULL" after
  // each batch would re-fetch any row that failed to process (it's still
  // null), causing an infinite retry loop on a single bad asset. Holding
  // {id, project_id, storage_path} triples for even a very large project is
  // trivial memory -- only one image's actual bytes are ever held at a time
  // during processing below.
  const pending = [];
  let from = 0;
  for (;;) {
    let query = supabase
      .from("media_assets")
      .select("id, project_id, storage_path")
      .eq("media_type", "image")
      .is("thumbnail_storage_path", null)
      .order("created_at", { ascending: true })
      .range(from, from + FETCH_PAGE_SIZE - 1);
    if (projectIdArg) query = query.eq("project_id", projectIdArg);

    const { data, error } = await query;
    if (error) {
      console.error("Failed to list assets needing backfill:", error.message);
      process.exit(1);
    }
    pending.push(...data);
    if (data.length < FETCH_PAGE_SIZE) break;
    from += FETCH_PAGE_SIZE;
  }

  console.log(
    `Found ${pending.length} image asset(s) needing a thumbnail` +
      (projectIdArg ? ` in project ${projectIdArg}` : " across all projects") +
      ".",
  );
  if (pending.length === 0) return;
  if (dryRun) {
    console.log("--dry-run: not processing anything. Re-run without --dry-run to backfill.");
    return;
  }

  const toProcess = limit ? pending.slice(0, limit) : pending;
  if (limit) console.log(`--limit=${limit}: processing ${toProcess.length} of ${pending.length}.`);

  let done = 0;
  let failed = 0;
  for (const asset of toProcess) {
    try {
      const { data: downloaded, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(asset.storage_path);
      if (downloadError || !downloaded) {
        throw new Error(`download failed: ${downloadError?.message ?? "no data"}`);
      }
      const originalBuffer = Buffer.from(await downloaded.arrayBuffer());

      const thumbBuffer = await sharp(originalBuffer)
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();

      const thumbPath = newThumbnailPath(asset.project_id);
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(thumbPath, thumbBuffer, { contentType: "image/jpeg" });
      if (uploadError) throw new Error(`thumbnail upload failed: ${uploadError.message}`);

      const { error: updateError } = await supabase
        .from("media_assets")
        .update({ thumbnail_storage_path: thumbPath })
        .eq("id", asset.id);
      if (updateError) throw new Error(`db update failed: ${updateError.message}`);

      done++;
      console.log(`[${done + failed}/${toProcess.length}] OK   ${asset.id} -> ${thumbPath}`);
    } catch (err) {
      failed++;
      // Left with thumbnail_storage_path still null -- a future run (this
      // script re-queries fresh each time it starts) will pick it up again
      // automatically; this is what makes the whole thing restart-safe.
      console.error(`[${done + failed}/${toProcess.length}] FAIL ${asset.id}: ${err.message}`);
    }
  }

  console.log(`\nDone. ${done} succeeded, ${failed} failed out of ${toProcess.length} attempted.`);
  if (failed > 0) {
    console.log("Failed rows were left untouched (thumbnail_storage_path still null) -- re-run this script to retry just those.");
  }
}

main().catch((err) => {
  console.error("Backfill script crashed:", err);
  process.exit(1);
});
