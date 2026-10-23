// Keyset ("cursor") paging for the Post Editor's "Add from library" picker
// -- pure (no Supabase, no React, no DOM) so the server loader
// (lib/data/posts.ts's getPostMediaLibraryPage), the picker's client state
// (post-editor.tsx's AddFromLibrarySection) and the unit tests
// (media-library-paging.test.ts) all run this exact code.
//
// THE BUG this replaced: the picker fetched 24 raw media_assets rows by
// OFFSET, dropped archived rows afterwards, and then decided "is there
// more?" from the FILTERED count (`items.length === 24`) and the next
// offset from the filtered length too. Archived rows are common at the top
// of the newest-first list -- every copy-on-write clone
// (cloneMediaAssetForDivergence) is inserted archived with a fresh
// created_at -- so a single archived row among the newest 24 hid Load More
// forever and stranded every older asset; later pages also overlapped.
//
// Now:
//   - order is (created_at DESC, id DESC) -- a total order, so tied
//     timestamps can never reorder between requests;
//   - a cursor is the (created_at, id) of the last RAW row consumed, never
//     a count of visible items, so archived rows can't shift it;
//   - hasMore comes from fetching one row past the batch, not from how
//     many rows survived filtering;
//   - a batch that filters down to too little is followed by further raw
//     batches (bounded) before the page is returned, so an all-archived
//     batch doesn't end paging or show an empty page.

export type LibraryCursor = { createdAt: string; id: string };

// One picker row plus the cursor key of the raw row it came from -- the
// client needs each row's key to reconcile a refreshed first page against
// pages it already loaded (see reconcileFirstPage).
export type LibraryEntry<T> = { item: T; key: string };

export type LibraryPage<T> = {
  entries: LibraryEntry<T>[];
  // Cursor of the last RAW row consumed (archived rows included), or null
  // when nothing was consumed. Only meaningful while hasMore is true.
  nextCursor: string | null;
  hasMore: boolean;
};

// Strict on purpose: a cursor arrives from the client through a Server
// Action and ends up inside a PostgREST filter, so anything that isn't
// exactly a Postgres timestamptz plus a uuid is rejected rather than
// interpolated.
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Whole-second, Date.parse-able form of a timestamptz: "T" separator, no
// fraction, and the offset widened to ±HH:MM (Date.parse rejects the bare
// "+00" Postgres' text output can use).
function wholeSecondIso(createdAt: string): string {
  return createdAt
    .replace(" ", "T")
    .replace(/\.\d+/, "")
    .replace(/([+-]\d{2})$/, "$1:00")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

export function encodeCursor(cursor: LibraryCursor): string {
  return `${cursor.createdAt}|${cursor.id}`;
}

export function decodeCursor(value: string): LibraryCursor | null {
  const sep = value.lastIndexOf("|");
  if (sep < 0) return null;
  const createdAt = value.slice(0, sep);
  const id = value.slice(sep + 1).toLowerCase();
  if (!TIMESTAMP_RE.test(createdAt) || !UUID_RE.test(id)) return null;
  if (Number.isNaN(Date.parse(wholeSecondIso(createdAt)))) return null;
  return { createdAt, id };
}

// Postgres keeps microseconds and prints a variable number of fractional
// digits ("…:57.79+00:00", "…:57+00:00"), and Date only keeps
// milliseconds -- so compare as (whole epoch seconds, microseconds, id)
// instead of comparing the strings or Date values directly.
function sortParts(key: string): [number, number, string] | null {
  const cursor = decodeCursor(key);
  if (!cursor) return null;
  const fraction = /\.(\d{1,6})/.exec(cursor.createdAt)?.[1] ?? "";
  const seconds = Date.parse(wholeSecondIso(cursor.createdAt)) / 1000;
  return [seconds, Number(fraction.padEnd(6, "0")), cursor.id];
}

// True when key `a` comes AFTER key `b` in the picker's newest-first order
// (an older row, or the same instant with a smaller id) -- the same
// comparison Postgres makes for ORDER BY created_at DESC, id DESC.
export function isAfterInOrder(a: string, b: string): boolean {
  const pa = sortParts(a);
  const pb = sortParts(b);
  if (!pa || !pb) return false;
  if (pa[0] !== pb[0]) return pa[0] < pb[0];
  if (pa[1] !== pb[1]) return pa[1] < pb[1];
  return pa[2] < pb[2];
}

// Raw batch rows: just enough to page on. Eligibility (archived, etc.) is
// decided by the caller's filter, so this file never needs to know which
// columns exist on the database it runs against.
export type RawLibraryRow = { id: string; created_at: string };

export async function collectLibraryPage<Row extends RawLibraryRow>({
  cursor,
  limit,
  maxBatches,
  fetchBatch,
  filterEligible,
}: {
  cursor: LibraryCursor | null;
  limit: number;
  // Upper bound on raw batches scanned for one page -- keeps a long run of
  // archived rows from turning one request into a scan of the whole table.
  // When it's hit, the page comes back short but still hasMore, so the
  // next Load More continues from exactly where this one stopped.
  maxBatches: number;
  // Must return up to `size` rows strictly after `after` in
  // (created_at DESC, id DESC) order (from the top when `after` is null).
  fetchBatch: (after: LibraryCursor | null, size: number) => Promise<Row[]>;
  filterEligible: (rows: Row[]) => Promise<Row[]>;
}): Promise<{ rows: Row[]; nextCursor: string | null; hasMore: boolean }> {
  const rows: Row[] = [];
  let after = cursor;
  let hasMore = true;
  for (let batch = 0; batch < maxBatches && rows.length < limit; batch++) {
    // One row past the batch answers "is there more?" exactly, without a
    // COUNT query and without trusting how many rows survive filtering.
    let fetched: Row[];
    let eligible: Row[];
    try {
      fetched = await fetchBatch(after, limit + 1);
      eligible = fetched.length > 0 ? await filterEligible(fetched.slice(0, limit)) : [];
    } catch (error) {
      // A failed batch (the fetch OR its eligibility lookup) ends THIS page
      // but not paging: whatever earlier batches collected is returned, the
      // cursor stays on the last row of the last batch that fully
      // succeeded -- it only ever advances below, after both steps -- and
      // hasMore stays true so Load More retries from exactly there.
      // Throwing instead would turn one transient query error into a
      // crashed editor (the first page is read through use()).
      console.error("[media-library-paging] batch failed", error);
      hasMore = true;
      break;
    }
    const consumed = fetched.slice(0, limit);
    hasMore = fetched.length > limit;
    if (consumed.length > 0) {
      const last = consumed[consumed.length - 1];
      after = { createdAt: last.created_at, id: last.id };
      rows.push(...eligible);
    }
    if (!hasMore) break;
  }
  return { rows, nextCursor: after ? encodeCursor(after) : null, hasMore };
}

// The separate `archived` lookup (lib/data/posts.ts) -- decides which ids
// are hidden, and FAILS CLOSED: a transient error (network, timeout, a
// PostgREST hiccup) throws, which collectLibraryPage turns into "this page
// stops here, retry from the same cursor" -- never into "nothing is
// archived", which would briefly show archived copy-on-write clones. The
// one exception is a database that genuinely has no `archived` column
// (Postgres 42703 undefined_column, or PostgREST's schema-cache PGRST204):
// there nothing CAN be archived yet, so hiding nothing is correct -- the
// compatibility the isolated lookup exists for.
export type ArchivedLookupResult = {
  data: { id: string; archived?: boolean | null }[] | null;
  error: { code?: string; message?: string } | null;
};

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

export function archivedIdsFromLookup(result: ArchivedLookupResult): Set<string> {
  if (result.error) {
    if (result.error.code && MISSING_COLUMN_CODES.has(result.error.code)) return new Set();
    throw new Error(`archived lookup failed: ${result.error.message ?? result.error.code ?? "unknown error"}`);
  }
  if (!result.data) throw new Error("archived lookup returned no data");
  return new Set(result.data.filter((r) => r.archived).map((r) => r.id));
}

// --- client side -----------------------------------------------------------

// Whether a fetched page moved paging forward. A page can legitimately add
// no visible rows (a run of archived rows) -- that's still progress as
// long as the cursor moved. A page that neither added rows nor moved the
// cursor (a server-side batch failure on its very first batch returns the
// SAME cursor with hasMore still true) must be treated as a failure by an
// automatic loader, or it would refetch the same position forever.
export function pageMadeProgress<T>(requestedCursor: string | null, page: LibraryPage<T>): boolean {
  if (!page.hasMore) return true;
  return page.entries.length > 0 || (page.nextCursor !== null && page.nextCursor !== requestedCursor);
}

// Appends a Load More page, never duplicating a row already shown (by id)
// -- guards the React keys even if a row were somehow returned twice.
export function appendLibraryPage<T extends { id: string }>(
  current: LibraryPage<T>,
  page: LibraryPage<T>,
): LibraryPage<T> {
  const seen = new Set(current.entries.map((e) => e.item.id));
  const added: LibraryEntry<T>[] = [];
  for (const entry of page.entries) {
    if (seen.has(entry.item.id)) continue;
    seen.add(entry.item.id);
    added.push(entry);
  }
  return { entries: [...current.entries, ...added], nextCursor: page.nextCursor, hasMore: page.hasMore };
}

// Folds a freshly fetched FIRST page (after router.refresh(), or when the
// tab regains focus) into what the picker already shows, without throwing
// away older pages the user has already loaded:
//   - rows inside the fresh page's range come from the fresh page, so new
//     uploads appear and rows archived/deleted since then disappear;
//   - already-loaded rows OLDER than that range are kept as they are;
//   - paging continues from whichever of the two reached further.
export function reconcileFirstPage<T extends { id: string }>(
  current: LibraryPage<T>,
  fresh: LibraryPage<T>,
): LibraryPage<T> {
  // hasMore with no cursor means the fresh fetch failed before reading a
  // single batch (see collectLibraryPage) -- it says nothing about the
  // library, so keep what's shown rather than wiping it to an empty list.
  if (fresh.hasMore && fresh.nextCursor === null) return current;
  const deduped = appendLibraryPage({ entries: [], nextCursor: null, hasMore: false }, fresh);
  // The fresh page reached the end of the library -- it IS the whole list.
  if (!fresh.hasMore) return deduped;

  const boundary = fresh.nextCursor!;
  // More new rows arrived than one fresh page holds: the fresh page ends
  // ABOVE the first row already shown, so the rows between the two were
  // never fetched by either. Continuing from the old cursor would skip them
  // for good, and paging them in later would list them below older rows --
  // so start over from the fresh page instead (Load More rebuilds the rest).
  const top = current.entries[0]?.key;
  if (top === undefined || isAfterInOrder(top, boundary)) return deduped;

  const freshIds = new Set(deduped.entries.map((e) => e.item.id));
  const older = current.entries.filter((e) => !freshIds.has(e.item.id) && isAfterInOrder(e.key, boundary));
  const currentReachedFurther =
    !current.hasMore || (current.nextCursor !== null && isAfterInOrder(current.nextCursor, boundary));

  return {
    entries: [...deduped.entries, ...older],
    nextCursor: currentReachedFurther ? current.nextCursor : boundary,
    hasMore: currentReachedFurther ? current.hasMore : true,
  };
}
