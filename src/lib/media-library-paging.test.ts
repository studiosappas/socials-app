// Tests for media-library-paging.ts -- no React, no DOM, no network. Run with:
//   node --experimental-strip-types src/lib/media-library-paging.test.ts
//
// A simulated media_assets table stands in for Postgres: fetchBatch returns
// rows strictly after a (created_at, id) cursor in (created_at DESC, id
// DESC) order, the same contract the real PostgREST query in
// lib/data/posts.ts implements. The ORACLE ordering below is computed
// independently (BigInt microseconds from the raw strings), not with the
// module's own comparator, and Postgres-style variable fractional digits
// ("…:57.79+00:00", "…:57+00:00") are mixed into every generated library.
//
// What this does NOT cover: the PostgREST filter string itself
// (`created_at.lte` + `or(created_at.lt."…",id.lt.…)`) against a real
// database -- that is verified in Staging QA.

import assert from "node:assert/strict";
import {
  appendLibraryPage,
  collectLibraryPage,
  decodeCursor,
  encodeCursor,
  isAfterInOrder,
  reconcileFirstPage,
  type LibraryCursor,
  type LibraryPage,
} from "./media-library-paging.ts";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Row = { id: string; created_at: string; project_id: string; archived: boolean };
type Item = { id: string; usedInCarousel: boolean };

const LIMIT = 24;

// --- independent oracle ------------------------------------------------------

function micros(ts: string): bigint {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:?\d{2}|[+-]\d{2})$/.exec(ts);
  if (!m) throw new Error(`bad fixture timestamp ${ts}`);
  const offset = m[4] === "Z" ? "Z" : m[4].length === 3 ? `${m[4]}:00` : m[4].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  const seconds = BigInt(Date.parse(`${m[1]}T${m[2]}${offset}`) / 1000);
  return seconds * 1_000_000n + BigInt((m[3] ?? "").padEnd(6, "0"));
}

// Negative when a sorts BEFORE b in created_at DESC, id DESC.
function oracleCompare(a: { created_at: string; id: string }, b: { created_at: string; id: string }): number {
  const ma = micros(a.created_at);
  const mb = micros(b.created_at);
  if (ma !== mb) return ma > mb ? -1 : 1;
  return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
}

// --- simulated table ---------------------------------------------------------

let uuidCounter = 0;
function uuid(r: () => number): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");
  uuidCounter++;
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(8)}${(uuidCounter % 65536).toString(16).padStart(4, "0")}`;
}

// Postgres prints as few fractional digits as needed -- mirror that.
function pgTimestamp(baseSeconds: number, micro: number): string {
  const iso = new Date(baseSeconds * 1000).toISOString().slice(0, 19);
  const frac = String(micro).padStart(6, "0").replace(/0+$/, "");
  return `${iso}${frac ? `.${frac}` : ""}+00:00`;
}

function makeTable(rows: Row[]) {
  return {
    rows,
    fetchBatch(projectId: string) {
      return async (after: LibraryCursor | null, size: number): Promise<Row[]> => {
        const sorted = rows.filter((r) => r.project_id === projectId).sort(oracleCompare);
        const from = after ? sorted.filter((r) => oracleCompare(r, { created_at: after.createdAt, id: after.id }) > 0) : sorted;
        return from.slice(0, size);
      };
    },
    async filterEligible(batch: Row[]): Promise<Row[]> {
      return batch.filter((r) => !r.archived);
    },
    eligible(projectId: string): Row[] {
      return rows.filter((r) => r.project_id === projectId && !r.archived).sort(oracleCompare);
    },
  };
}

type Table = ReturnType<typeof makeTable>;

async function serverPage(table: Table, projectId: string, cursor: string | null, maxBatches = 4): Promise<LibraryPage<Item>> {
  const decoded = cursor === null ? null : decodeCursor(cursor);
  if (cursor !== null) assert.ok(decoded, `server received an undecodable cursor: ${cursor}`);
  const { rows, nextCursor, hasMore } = await collectLibraryPage<Row>({
    cursor: decoded,
    limit: LIMIT,
    maxBatches,
    fetchBatch: table.fetchBatch(projectId),
    filterEligible: (b) => table.filterEligible(b),
  });
  return {
    entries: rows.map((r) => ({ item: { id: r.id, usedInCarousel: r.id.endsWith("c") }, key: encodeCursor({ createdAt: r.created_at, id: r.id }) })),
    nextCursor,
    hasMore,
  };
}

// Drives the client exactly like AddFromLibrarySection: first page, then
// Load More until hasMore is false.
async function loadAll(table: Table, projectId: string, maxPages = 10_000): Promise<{ state: LibraryPage<Item>; pages: number }> {
  let state = appendLibraryPage({ entries: [], nextCursor: null, hasMore: false }, await serverPage(table, projectId, null));
  let pages = 1;
  while (state.hasMore) {
    if (pages++ > maxPages) throw new Error("paging did not terminate");
    state = appendLibraryPage(state, await serverPage(table, projectId, state.nextCursor));
  }
  return { state, pages };
}

function ids(state: LibraryPage<Item>): string[] {
  return state.entries.map((e) => e.item.id);
}

function assertNoDuplicates(state: LibraryPage<Item>) {
  const list = ids(state);
  assert.equal(new Set(list).size, list.length, "duplicate ids (duplicate React keys)");
}

function randomLibrary(seed: number, opts: { size?: number; archivedRate?: number; tieRate?: number; projectId?: string } = {}): Row[] {
  const r = rng(seed);
  const size = opts.size ?? Math.floor(r() * 200);
  const archivedRate = opts.archivedRate ?? r() * 0.6;
  const tieRate = opts.tieRate ?? r() * 0.5;
  const rows: Row[] = [];
  let t = 1_790_000_000;
  let micro = 0;
  for (let i = 0; i < size; i++) {
    if (r() >= tieRate) {
      t += 1 + Math.floor(r() * 3);
      // Mix "no fraction", short and full fractions, like Postgres output.
      const shape = r();
      micro = shape < 0.3 ? 0 : shape < 0.6 ? Math.floor(r() * 10) * 100_000 : Math.floor(r() * 1_000_000);
    }
    rows.push({ id: uuid(r), created_at: pgTimestamp(t, micro), project_id: opts.projectId ?? "p1", archived: r() < archivedRate });
  }
  return rows;
}

// --- tests -------------------------------------------------------------------

await test("archived rows mixed into the first page: Load More stays available and nothing is stranded", async () => {
  const r = rng(1);
  const rows: Row[] = [];
  for (let i = 0; i < 80; i++) {
    // 5 archived copy-on-write clones at the very top, then a normal library.
    rows.push({ id: uuid(r), created_at: pgTimestamp(1_790_000_000 + 1000 - i, 0), project_id: "p1", archived: i < 5 });
  }
  const table = makeTable(rows);
  const first = await serverPage(table, "p1", null);
  assert.equal(first.hasMore, true, "the old bug: an archived row in the first page ended paging");
  assert.ok(first.entries.length >= LIMIT, "first page is filled from the next batch instead of coming back short");
  const { state } = await loadAll(table, "p1");
  assert.deepEqual(ids(state), table.eligible("p1").map((x) => x.id));
});

await test("a fully archived raw batch followed by eligible media: the page skips past it, never empty", async () => {
  const r = rng(2);
  const rows: Row[] = [];
  for (let i = 0; i < 70; i++) {
    rows.push({ id: uuid(r), created_at: pgTimestamp(1_790_000_000 + 1000 - i, 0), project_id: "p1", archived: i < 30 });
  }
  const table = makeTable(rows);
  const first = await serverPage(table, "p1", null);
  assert.equal(first.entries.length >= LIMIT, true);
  assert.equal(first.entries[0].item.id, table.eligible("p1")[0].id);
  const { state } = await loadAll(table, "p1");
  assert.deepEqual(ids(state), table.eligible("p1").map((x) => x.id));
});

await test("more archived rows than one page can scan: comes back short but hasMore, and resumes exactly", async () => {
  const r = rng(3);
  const rows: Row[] = [];
  for (let i = 0; i < 160; i++) {
    rows.push({ id: uuid(r), created_at: pgTimestamp(1_790_000_000 + 1000 - i, 0), project_id: "p1", archived: i < 130 });
  }
  const table = makeTable(rows);
  const first = await serverPage(table, "p1", null);
  assert.equal(first.entries.length, 0, "4 batches x 24 rows, all archived");
  assert.equal(first.hasMore, true, "must NOT report the end of the library");
  assert.ok(first.nextCursor, "cursor advanced past the archived rows it scanned");
  const { state } = await loadAll(table, "p1");
  assert.deepEqual(ids(state), table.eligible("p1").map((x) => x.id));
});

await test("identical timestamps: stable id order, no skips or duplicates across page boundaries", async () => {
  const r = rng(4);
  const ts = pgTimestamp(1_790_000_000, 120_000); // "…:20.12+00:00"
  const rows: Row[] = Array.from({ length: 75 }, () => ({ id: uuid(r), created_at: ts, project_id: "p1", archived: r() < 0.2 }));
  const table = makeTable(rows);
  const { state, pages } = await loadAll(table, "p1");
  assert.ok(pages > 1, "spans several pages");
  assertNoDuplicates(state);
  assert.deepEqual(ids(state), table.eligible("p1").map((x) => x.id));
  // Loading twice gives the exact same order (no unstable tie ordering).
  const again = await loadAll(table, "p1");
  assert.deepEqual(ids(again.state), ids(state));
});

await test("randomized libraries: concatenated pages equal the oracle's eligible list exactly", async () => {
  for (let seed = 100; seed < 400; seed++) {
    const table = makeTable(randomLibrary(seed));
    const { state } = await loadAll(table, "p1");
    assertNoDuplicates(state);
    assert.deepEqual(ids(state), table.eligible("p1").map((x) => x.id), `seed ${seed}`);
  }
});

await test("empty library and exact page-size library: hasMore is exact, no phantom Load More", async () => {
  const empty = await serverPage(makeTable([]), "p1", null);
  assert.deepEqual(empty, { entries: [], nextCursor: null, hasMore: false });
  const r = rng(5);
  const rows: Row[] = Array.from({ length: LIMIT }, (_, i) => ({ id: uuid(r), created_at: pgTimestamp(1_790_000_000 + i, 0), project_id: "p1", archived: false }));
  const exact = await serverPage(makeTable(rows), "p1", null);
  assert.equal(exact.entries.length, LIMIT);
  assert.equal(exact.hasMore, false, "exactly one page -- no Load More that returns nothing");
});

await test("new uploads while the editor stays open: a refreshed first page shows them, keeps loaded pages, then completes", async () => {
  for (const uploads of [1, 5, 30, 60]) {
    const r = rng(6 + uploads);
    const rows = randomLibrary(600 + uploads, { size: 120, archivedRate: 0.2 });
    const table = makeTable(rows);
    // User loads three pages...
    let state = appendLibraryPage({ entries: [], nextCursor: null, hasMore: false }, await serverPage(table, "p1", null));
    state = appendLibraryPage(state, await serverPage(table, "p1", state.nextCursor));
    state = appendLibraryPage(state, await serverPage(table, "p1", state.nextCursor));
    // ...uploads land (newer than everything, some archived clones too)...
    const newest = Math.max(...rows.map((x) => Number(micros(x.created_at) / 1_000_000n)));
    for (let i = 0; i < uploads; i++) {
      rows.push({ id: uuid(r), created_at: pgTimestamp(newest + 10 + i, 0), project_id: "p1", archived: i % 7 === 3 });
    }
    // ...router.refresh() / tab focus delivers a fresh first page.
    state = reconcileFirstPage(state, await serverPage(table, "p1", null));
    assertNoDuplicates(state);
    const eligibleNow = table.eligible("p1").map((x) => x.id);
    assert.deepEqual(ids(state).slice(0, 3), eligibleNow.slice(0, 3), `uploads=${uploads}: new uploads at the top`);
    // Keep paging to the end: the complete library, exactly once each.
    while (state.hasMore) state = appendLibraryPage(state, await serverPage(table, "p1", state.nextCursor));
    assertNoDuplicates(state);
    assert.deepEqual(ids(state), eligibleNow, `uploads=${uploads}: nothing skipped or duplicated`);
  }
});

await test("rows archived/deleted while open disappear on refresh; rows outside the fresh range are kept", async () => {
  const rows = randomLibrary(700, { size: 100, archivedRate: 0 });
  const table = makeTable(rows);
  let state = appendLibraryPage({ entries: [], nextCursor: null, hasMore: false }, await serverPage(table, "p1", null));
  state = appendLibraryPage(state, await serverPage(table, "p1", state.nextCursor));
  const target = table.eligible("p1")[2];
  target.archived = true;
  state = reconcileFirstPage(state, await serverPage(table, "p1", null));
  assert.ok(!ids(state).includes(target.id), "archived elsewhere -> gone from the picker");
  assert.ok(state.entries.length >= LIMIT * 2 - 1, "already-loaded second page is kept");
  while (state.hasMore) state = appendLibraryPage(state, await serverPage(table, "p1", state.nextCursor));
  assert.deepEqual(ids(state), table.eligible("p1").map((x) => x.id));
});

await test("refresh when the whole library now fits on one page replaces the list outright", async () => {
  const rows = randomLibrary(800, { size: 60, archivedRate: 0 });
  const table = makeTable(rows);
  let state = appendLibraryPage({ entries: [], nextCursor: null, hasMore: false }, await serverPage(table, "p1", null));
  state = appendLibraryPage(state, await serverPage(table, "p1", state.nextCursor));
  for (const row of rows.slice(0, 50)) row.archived = true;
  state = reconcileFirstPage(state, await serverPage(table, "p1", null));
  assert.equal(state.hasMore, false);
  assert.deepEqual(ids(state), table.eligible("p1").map((x) => x.id));
});

await test("projects never mix: each project's pages contain only its own media", async () => {
  const a = randomLibrary(900, { size: 90, projectId: "pA" });
  const b = randomLibrary(901, { size: 70, projectId: "pB" });
  const table = makeTable([...a, ...b]);
  const loadedA = await loadAll(table, "pA");
  const loadedB = await loadAll(table, "pB");
  const aIds = new Set(a.map((x) => x.id));
  assert.ok(ids(loadedB.state).every((id) => !aIds.has(id)));
  assert.deepEqual(ids(loadedA.state), table.eligible("pA").map((x) => x.id));
  assert.deepEqual(ids(loadedB.state), table.eligible("pB").map((x) => x.id));
});

await test("a failed batch mid-page keeps what it has, stays resumable, and loses nothing", async () => {
  const rows = randomLibrary(950, { size: 150, archivedRate: 0.5 });
  const table = makeTable(rows);
  let calls = 0;
  const flaky = async (after: LibraryCursor | null, size: number) => {
    calls++;
    if (calls === 2) throw new Error("transient");
    return table.fetchBatch("p1")(after, size);
  };
  const first = await collectLibraryPage<Row>({ cursor: null, limit: LIMIT, maxBatches: 4, fetchBatch: flaky, filterEligible: (b) => table.filterEligible(b) });
  assert.equal(first.hasMore, true, "a failure is never reported as the end of the library");
  const toPage = (res: typeof first): LibraryPage<Item> => ({
    entries: res.rows.map((x) => ({ item: { id: x.id, usedInCarousel: false }, key: encodeCursor({ createdAt: x.created_at, id: x.id }) })),
    nextCursor: res.nextCursor,
    hasMore: res.hasMore,
  });
  let state = appendLibraryPage({ entries: [], nextCursor: null, hasMore: false }, toPage(first));
  while (state.hasMore) state = appendLibraryPage(state, await serverPage(table, "p1", state.nextCursor));
  assert.deepEqual(ids(state), table.eligible("p1").map((x) => x.id));
});

await test("a failed ELIGIBILITY lookup mid-page never advances the cursor past unread rows", async () => {
  const rows = randomLibrary(951, { size: 150, archivedRate: 0.5, tieRate: 0.3 });
  const table = makeTable(rows);
  for (const failOn of [1, 2, 3]) {
    let calls = 0;
    const flakyFilter = async (b: Row[]) => {
      calls++;
      if (calls === failOn) throw new Error("archived lookup failed");
      return table.filterEligible(b);
    };
    const res = await collectLibraryPage<Row>({ cursor: null, limit: LIMIT, maxBatches: 4, fetchBatch: table.fetchBatch("p1"), filterEligible: flakyFilter });
    assert.equal(res.hasMore, true, `failOn=${failOn}: still resumable`);
    const sorted = rows.filter((x) => x.project_id === "p1").sort(oracleCompare);
    const batchesDone = failOn - 1;
    if (batchesDone === 0) {
      assert.equal(res.nextCursor, null, "nothing consumed -> resume from the top");
      assert.equal(res.rows.length, 0);
    } else {
      const lastConsumed = sorted[batchesDone * LIMIT - 1];
      assert.equal(res.nextCursor, encodeCursor({ createdAt: lastConsumed.created_at, id: lastConsumed.id }), "cursor = end of the last fully successful batch");
    }
    let state: LibraryPage<Item> = appendLibraryPage(
      { entries: [], nextCursor: null, hasMore: false },
      { entries: res.rows.map((x) => ({ item: { id: x.id, usedInCarousel: false }, key: encodeCursor({ createdAt: x.created_at, id: x.id }) })), nextCursor: res.nextCursor, hasMore: res.hasMore },
    );
    while (state.hasMore) state = appendLibraryPage(state, await serverPage(table, "p1", state.nextCursor));
    assert.deepEqual(ids(state), table.eligible("p1").map((x) => x.id), `failOn=${failOn}: nothing skipped`);
  }
});

await test("a refresh whose fetch failed outright keeps the loaded list instead of wiping it", async () => {
  const table = makeTable(randomLibrary(952, { size: 90, archivedRate: 0.1 }));
  let state = appendLibraryPage({ entries: [], nextCursor: null, hasMore: false }, await serverPage(table, "p1", null));
  state = appendLibraryPage(state, await serverPage(table, "p1", state.nextCursor));
  const failed = await collectLibraryPage<Row>({
    cursor: null,
    limit: LIMIT,
    maxBatches: 4,
    fetchBatch: async () => {
      throw new Error("offline");
    },
    filterEligible: (b) => table.filterEligible(b),
  });
  assert.deepEqual(failed, { rows: [], nextCursor: null, hasMore: true });
  const after = reconcileFirstPage(state, { entries: [], nextCursor: failed.nextCursor, hasMore: failed.hasMore });
  assert.equal(after, state, "unchanged");
});

await test("Tasks' single-batch call (maxBatches 1, limit 100) is exactly the newest 100 raw rows minus archived", async () => {
  const rows = randomLibrary(960, { size: 180, archivedRate: 0.3 });
  const table = makeTable(rows);
  const res = await collectLibraryPage<Row>({ cursor: null, limit: 100, maxBatches: 1, fetchBatch: table.fetchBatch("p1"), filterEligible: (b) => table.filterEligible(b) });
  const expected = rows.filter((x) => x.project_id === "p1").sort(oracleCompare).slice(0, 100).filter((x) => !x.archived);
  assert.deepEqual(res.rows.map((x) => x.id), expected.map((x) => x.id));
});

await test("append dedupes by id and never touches item objects (selection/Replace/carousel badge data intact)", () => {
  const item = { id: "1", usedInCarousel: true };
  const key = encodeCursor({ createdAt: "2026-10-22T10:00:00+00:00", id: "00000000-0000-4000-a000-000000000001" });
  const page: LibraryPage<Item> = { entries: [{ item, key }], nextCursor: key, hasMore: true };
  const merged = appendLibraryPage(page, { entries: [{ item: { id: "1", usedInCarousel: false }, key }], nextCursor: null, hasMore: false });
  assert.equal(merged.entries.length, 1);
  assert.equal(merged.entries[0].item, item, "same object, usedInCarousel untouched");
  assert.equal(merged.hasMore, false);
});

await test("randomized interleaving of Load More, uploads, archiving and refreshes always ends complete, ordered, unique", async () => {
  for (let seed = 1000; seed < 1150; seed++) {
    const r = rng(seed);
    const rows = randomLibrary(seed, { size: Math.floor(r() * 150) });
    const table = makeTable(rows);
    let clock = Math.max(1_790_000_000, ...rows.map((x) => Number(micros(x.created_at) / 1_000_000n))) + 10;
    let state = appendLibraryPage({ entries: [], nextCursor: null, hasMore: false }, await serverPage(table, "p1", null));
    for (let step = 0; step < 25; step++) {
      const action = r();
      if (action < 0.4 && state.hasMore) {
        state = appendLibraryPage(state, await serverPage(table, "p1", state.nextCursor));
      } else if (action < 0.6) {
        // Real inserts: created_at = now() at insert time, Library uploads
        // inserted one by one -- strictly increasing. (Out-of-order inserts
        // are covered by their own test below.)
        const n = 1 + Math.floor(r() * 40);
        for (let i = 0; i < n; i++) {
          rows.push({ id: uuid(r), created_at: pgTimestamp(clock++, r() < 0.5 ? 0 : Math.floor(r() * 1e6)), project_id: "p1", archived: r() < 0.2 });
        }
      } else if (action < 0.75 && rows.length > 0) {
        rows[Math.floor(r() * rows.length)].archived = true;
      } else {
        state = reconcileFirstPage(state, await serverPage(table, "p1", null));
      }
      assertNoDuplicates(state);
    }
    // Final refresh (as on focus), then page to the end.
    state = reconcileFirstPage(state, await serverPage(table, "p1", null));
    while (state.hasMore) state = appendLibraryPage(state, await serverPage(table, "p1", state.nextCursor));
    // Rows archived AFTER they were already paged past are a known,
    // accepted staleness (they vanish on the next refresh that covers
    // them); everything ELIGIBLE must be present exactly once, in order.
    const shown = ids(state).filter((id) => !table.rows.find((x) => x.id === id)!.archived);
    assert.deepEqual(shown, table.eligible("p1").map((x) => x.id), `seed ${seed}`);
    assertNoDuplicates(state);
  }
});

await test("known limit: a row inserted with a timestamp OLDER than rows already paged past shows up on reopen", async () => {
  // Any cursor (or offset) pager has this property -- nothing re-scans
  // ranges already read. Here created_at is now() at insert and Library
  // uploads insert sequentially, so this needs a row older than a full
  // page of rows ahead of it; a fresh load (reopening the editor) always
  // includes it.
  const rows = randomLibrary(1200, { size: 80, archivedRate: 0, tieRate: 0 });
  const table = makeTable(rows);
  const { state } = await loadAll(table, "p1");
  const oldest = table.eligible("p1").at(-1)!;
  const late = { id: "ffffffff-ffff-4fff-afff-ffffffffffff", created_at: oldest.created_at, project_id: "p1", archived: false };
  rows.push(late);
  const refreshed = reconcileFirstPage(state, await serverPage(table, "p1", null));
  assert.ok(!ids(refreshed).includes(late.id), "documented: not discovered by a first-page refresh");
  const reopened = await loadAll(table, "p1");
  assert.deepEqual(ids(reopened.state), table.eligible("p1").map((x) => x.id), "reopen finds it");
});

await test("decodeCursor accepts real Postgres timestamps and rejects anything that could reach the filter", () => {
  const id = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  for (const ts of ["2026-10-22T14:42:57.794123+00:00", "2026-10-22 14:42:57+00", "2026-10-22T14:42:57.7Z", "2026-10-22T14:42:57-05:30"]) {
    assert.deepEqual(decodeCursor(`${ts}|${id}`), { createdAt: ts, id });
  }
  assert.deepEqual(decodeCursor(`2026-10-22T14:42:57+00:00|${id.toUpperCase()}`), { createdAt: "2026-10-22T14:42:57+00:00", id });
  for (const bad of [
    "",
    id,
    `2026-10-22T14:42:57+00:00|${id}),id.gt.0`,
    `2026-10-22T14:42:57+00:00,id.gt.0|${id}`,
    `"2026-10-22T14:42:57+00:00"|${id}`,
    `2026-13-45T99:99:99+00:00|${id}`,
    `2026-10-22T14:42:57+00:00|not-a-uuid`,
    `2026-10-22T14:42:57.1234567+00:00|${id}`,
  ]) {
    assert.equal(decodeCursor(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

await test("isAfterInOrder handles Postgres' variable fractional digits and time zones", () => {
  const id1 = "00000000-0000-4000-a000-000000000001";
  const id2 = "00000000-0000-4000-a000-000000000002";
  const k = (ts: string, id = id1) => encodeCursor({ createdAt: ts, id });
  assert.equal(isAfterInOrder(k("2026-10-22T14:42:57.79+00:00"), k("2026-10-22T14:42:57.794+00:00")), true);
  assert.equal(isAfterInOrder(k("2026-10-22T14:42:57+00:00"), k("2026-10-22T14:42:57.000001+00:00")), true);
  assert.equal(isAfterInOrder(k("2026-10-22T14:42:57.5+00:00"), k("2026-10-22T14:42:57.499999+00:00")), false);
  assert.equal(isAfterInOrder(k("2026-10-22T16:42:57+02:00"), k("2026-10-22T14:42:57+00:00")), false, "same instant");
  assert.equal(isAfterInOrder(k("2026-10-22T14:42:57+00:00", id1), k("2026-10-22T14:42:57+00:00", id2)), true, "tie -> smaller id is later");
  assert.equal(isAfterInOrder(k("2026-10-22T14:42:57+00:00"), k("2026-10-22T14:42:57+00:00")), false, "a key is not after itself");
});

console.log(`\n${passed} tests passed`);
