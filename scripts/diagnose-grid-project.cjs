/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS diagnostic script, not part of the app bundle */
// Read-only diagnostic: reports the REAL current state of one project's
// media_assets -- which images actually have a thumbnail_storage_path set,
// and the real byte size of both the original and (if present) the
// thumbnail file, straight from Supabase Storage. Makes no writes.
// Written to answer "are the re-uploaded images actually getting real
// thumbnails, or does the app just think they are" with real data instead
// of code-reading alone.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/diagnose-grid-project.cjs --project-id=<uuid>

const { createClient } = require("@supabase/supabase-js");

const BUCKET = "project-media";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectId = process.argv.find((a) => a.startsWith("--project-id="))?.split("=")[1];

function fmtBytes(n) {
  if (n == null) return "?";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function fileSize(supabase, path) {
  if (!path) return null;
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const name = slash === -1 ? path : path.slice(slash + 1);
  const { data, error } = await supabase.storage.from(BUCKET).list(dir, { search: name, limit: 1 });
  if (error || !data || data.length === 0) return null;
  return data[0].metadata?.size ?? null;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  if (!projectId) {
    console.error("Usage: node scripts/diagnose-grid-project.cjs --project-id=<uuid>");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: assets, error } = await supabase
    .from("media_assets")
    .select("id, media_type, storage_path, thumbnail_storage_path, poster_storage_path, created_at, archived")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Failed to read media_assets:", error.message);
    process.exit(1);
  }

  console.log(`Project ${projectId}: ${assets.length} media_assets row(s) total.\n`);

  const images = assets.filter((a) => a.media_type === "image" && !a.archived);
  const withThumb = images.filter((a) => a.thumbnail_storage_path);
  const withoutThumb = images.filter((a) => !a.thumbnail_storage_path);
  console.log(`Images (non-archived): ${images.length}`);
  console.log(`  with thumbnail_storage_path set:     ${withThumb.length}`);
  console.log(`  WITHOUT thumbnail_storage_path:       ${withoutThumb.length}\n`);

  // Which of these are actually a Grid cover (position 0 of a post that has
  // a grid_slots row) -- the ones that actually matter for "Grid feels
  // slow", as opposed to library-only assets never placed on the board.
  const { data: gridSlots } = await supabase.from("grid_slots").select("post_id").not("post_id", "is", null);
  const gridPostIds = new Set((gridSlots ?? []).map((s) => s.post_id));
  const { data: coverAssets } = gridPostIds.size
    ? await supabase
        .from("post_assets")
        .select("post_id, position, media_asset_id")
        .in("post_id", Array.from(gridPostIds))
        .eq("position", 0)
    : { data: [] };
  const coverAssetIds = new Set((coverAssets ?? []).map((r) => r.media_asset_id));
  const coverImages = images.filter((a) => coverAssetIds.has(a.id));
  const coverWithoutThumb = coverImages.filter((a) => !a.thumbnail_storage_path);
  console.log(`Of those, actually used as a Grid cover: ${coverImages.length}`);
  console.log(`  WITHOUT thumbnail_storage_path (these are the ones a slow board would still be paying full price for): ${coverWithoutThumb.length}\n`);

  // Real byte sizes for a sample -- confirms (or disproves) that a
  // thumbnail_storage_path row actually points at a genuinely small file,
  // not e.g. an empty/failed upload that silently wrote a path anyway.
  const sample = images.slice(0, 12);
  console.log(`Real file sizes for the ${sample.length} most recent image(s):`);
  console.log("id".padEnd(38), "created_at".padEnd(22), "original".padEnd(10), "thumbnail");
  for (const a of sample) {
    const [origSize, thumbSize] = await Promise.all([
      fileSize(supabase, a.storage_path),
      a.thumbnail_storage_path ? fileSize(supabase, a.thumbnail_storage_path) : Promise.resolve(null),
    ]);
    console.log(
      a.id.padEnd(38),
      new Date(a.created_at).toISOString().padEnd(22),
      fmtBytes(origSize).padEnd(10),
      a.thumbnail_storage_path ? fmtBytes(thumbSize) : "(none)",
    );
  }
}

main().catch((err) => {
  console.error("Diagnostic script crashed:", err);
  process.exit(1);
});
