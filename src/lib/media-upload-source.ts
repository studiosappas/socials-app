// Grid Media Library's two source tabs -- "Uploaded" and "From Content" --
// and the one column behind them, media_assets.upload_source
// (supabase/add_media_upload_source.sql). Pure, no React/Supabase, so the
// tab rules are testable on their own (media-upload-source.test.ts).
//
// upload_source records where a row was ORIGINALLY uploaded, set once by
// the upload action itself -- never derived from current usage
// (story_frames/post_assets), which changes as Content items are deleted or
// library assets are reused across Grid and Content.

export type UploadSource = "grid" | "content";
export type LibraryTab = "uploaded" | "content";

export function parseUploadSource(value: unknown): UploadSource | null {
  return value === "grid" || value === "content" ? value : null;
}

// NULL (every row from before the column existed, Brief's generated
// designs, or a database where the migration hasn't run yet) belongs to
// Uploaded -- only an explicit 'content' moves an asset to From Content.
export function libraryTabFor(source: UploadSource | null | undefined): LibraryTab {
  return source === "content" ? "content" : "uploaded";
}

export function filterLibraryTab<T extends { uploadSource?: UploadSource | null }>(items: T[], tab: LibraryTab): T[] {
  return items.filter((item) => libraryTabFor(item.uploadSource) === tab);
}

export function countLibraryTabs(items: { uploadSource?: UploadSource | null }[]): Record<LibraryTab, number> {
  const counts: Record<LibraryTab, number> = { uploaded: 0, content: 0 };
  for (const item of items) counts[libraryTabFor(item.uploadSource)] += 1;
  return counts;
}

// The Grid page's isolated `select("id, upload_source")` result -> id ->
// source. On a not-yet-migrated database that select returns an ERROR (and
// data: null), not rows with a null field -- so an error, or any malformed
// row, yields no entry at all, and every asset falls back to Uploaded.
export function uploadSourceMap(result: { data: unknown; error: unknown }): Map<string, UploadSource> {
  const map = new Map<string, UploadSource>();
  if (result.error || !Array.isArray(result.data)) return map;
  for (const row of result.data) {
    if (!row || typeof row !== "object") continue;
    const { id, upload_source } = row as { id?: unknown; upload_source?: unknown };
    const source = parseUploadSource(upload_source);
    if (typeof id === "string" && source) map.set(id, source);
  }
  return map;
}
