// Grid Media Library's two source tabs -- "Uploaded" and "From Content" --
// and the one column behind them, media_assets.upload_source
// (supabase/add_media_upload_source.sql). Pure, no React/Supabase, so the
// rules are testable on their own (media-upload-source.test.ts).
//
// upload_source records where a row was ORIGINALLY uploaded, written in the
// row's own INSERT (insertWithUploadSource below) -- never derived from
// current usage (story_frames/post_assets), which changes as Content items
// are deleted or library assets are reused across Grid and Content.

export type UploadSource = "grid" | "content";
export type LibraryTab = "uploaded" | "content";

// What the app knows about one asset's source:
//   'grid' | 'content' -- recorded;
//   null               -- read successfully, nothing recorded (older rows,
//                         Brief's generated designs, pre-migration uploads);
//   "unknown"          -- the lookup itself failed (or the migration hasn't
//                         run). Never written back as if it were known.
export type UploadSourceState = UploadSource | null | "unknown";

export function parseUploadSource(value: unknown): UploadSource | null {
  return value === "grid" || value === "content" ? value : null;
}

// Only an explicit 'content' moves an asset to From Content; null and
// "unknown" both show under Uploaded.
export function libraryTabFor(source: UploadSourceState | undefined): LibraryTab {
  return source === "content" ? "content" : "uploaded";
}

export function filterLibraryTab<T extends { uploadSource?: UploadSourceState }>(items: T[], tab: LibraryTab): T[] {
  return items.filter((item) => libraryTabFor(item.uploadSource) === tab);
}

export function countLibraryTabs(items: { uploadSource?: UploadSourceState }[]): Record<LibraryTab, number> {
  const counts: Record<LibraryTab, number> = { uploaded: 0, content: 0 };
  for (const item of items) counts[libraryTabFor(item.uploadSource)] += 1;
  return counts;
}

// The Grid page's isolated `select("id, upload_source")` result -> id ->
// recorded source (null included). Returns null -- "nothing known" -- when
// the select errored: on a not-yet-migrated database PostgREST answers with
// an error and data: null, never rows with a null field. An id missing from
// a successful map is likewise unknown, not null (see sourceStateFor).
export function uploadSourceMap(result: { data: unknown; error: unknown }): Map<string, UploadSource | null> | null {
  if (result.error || !Array.isArray(result.data)) return null;
  const map = new Map<string, UploadSource | null>();
  for (const row of result.data) {
    if (!row || typeof row !== "object") continue;
    const { id, upload_source } = row as { id?: unknown; upload_source?: unknown };
    if (typeof id === "string") map.set(id, parseUploadSource(upload_source));
  }
  return map;
}

export function sourceStateFor(map: Map<string, UploadSource | null> | null, id: string): UploadSourceState {
  if (!map || !map.has(id)) return "unknown";
  return map.get(id) ?? null;
}

// A single-row `select("upload_source")` result -> state. Error or no row
// -> "unknown".
export function uploadSourceFromLookup(result: { data: unknown; error: unknown }): UploadSourceState {
  if (result.error || !result.data || typeof result.data !== "object") return "unknown";
  return parseUploadSource((result.data as { upload_source?: unknown }).upload_source);
}

// Undo/Redo: a freshly read state replaces the remembered one only when it
// is actually known -- a failed read never overwrites a known source.
export function preferKnownSource(next: UploadSourceState | undefined, previous: UploadSourceState): UploadSourceState {
  return next === undefined || next === "unknown" ? previous : next;
}

// The only error the fallback below retries on: the database doesn't have
// the upload_source column yet. PGRST204 is PostgREST rejecting an unknown
// column in the request body ("Could not find the 'upload_source' column of
// 'media_assets' in the schema cache") -- refused while parsing the request,
// before any SQL runs, so nothing was inserted. 42703 is Postgres' own
// undefined_column, also raised before a row is written. Both must name
// upload_source; any other column, code, or a network/RLS/constraint error
// is NOT this case.
export function isMissingUploadSourceColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code !== "PGRST204" && code !== "42703") return false;
  return typeof message === "string" && message.includes("upload_source");
}

// Inserts with upload_source in the SAME statement (so a row can never
// exist with its source silently missing -- the insert RLS already accepted
// covers it). Retries once without it ONLY for the verified missing-column
// error above. Every other failure -- including a network error, where the
// first insert may or may not have committed -- is returned as-is, never
// retried, so this can never create a duplicate row.
export async function insertWithUploadSource<Row extends object, Result extends { error: unknown }>(
  runInsert: (row: Row & { upload_source?: UploadSource }) => PromiseLike<Result>,
  row: Row,
  uploadSource: UploadSource | null,
): Promise<Result> {
  if (!uploadSource) return runInsert(row);
  const first = await runInsert({ ...row, upload_source: uploadSource });
  if (first.error && isMissingUploadSourceColumn(first.error)) return runInsert(row);
  return first;
}
