// Tests for post-usage-isolation.ts -- an in-memory fake post_assets table,
// no network. Run with:
//   node --experimental-strip-types src/lib/post-usage-isolation.test.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import { isolatePostUsageForEdit, planUsageIsolation } from "./post-usage-isolation.ts";

type Row = { id: string; post_id: string; media_asset_id: string; position: number };

// Just enough of supabase-js's builder: from().select().eq()... and
// from().update().eq()...select(), applying every .eq() filter for real.
// `updateMatchesNothing` stands in for RLS silently filtering an update out
// (no error, zero rows) -- the exact shape of the original bug.
function fakeDb(rows: Row[], opts: { lookupError?: boolean; updateError?: boolean; updateMatchesNothing?: boolean } = {}) {
  const table = rows.map((r) => ({ ...r }));
  const writes: { id: string; media_asset_id: string }[] = [];
  const client = {
    from(name: string) {
      assert.equal(name, "post_assets");
      const filters: [string, unknown][] = [];
      let update: Partial<Row> | null = null;
      const matching = () => table.filter((r) => filters.every(([k, v]) => r[k as keyof Row] === v));
      const builder = {
        select() {
          return builder;
        },
        update(values: Partial<Row>) {
          update = values;
          return builder;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return builder;
        },
        then(resolve: (r: unknown) => void) {
          if (update) {
            if (opts.updateError) return resolve({ data: null, error: { message: "update denied" } });
            const hit = opts.updateMatchesNothing ? [] : matching();
            for (const r of hit) {
              Object.assign(r, update);
              writes.push({ id: r.id, media_asset_id: r.media_asset_id });
            }
            return resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
          }
          if (opts.lookupError) return resolve({ data: null, error: { message: "lookup failed" } });
          return resolve({ data: matching().map((r) => ({ id: r.id, post_id: r.post_id })), error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as never, table, writes };
}

function cloneSpy(result: string | null = "clone-1") {
  const calls: string[] = [];
  return { calls, clone: async (id: string) => (calls.push(id), result) };
}

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

const A = "post-A";
const B = "post-B";
const X = "asset-X";

await test("planner: used only by the editing post (even twice) is not shared", () => {
  assert.deepEqual(planUsageIsolation(A, [{ id: "1", post_id: A }]), { kind: "not-shared" });
  assert.deepEqual(planUsageIsolation(A, [{ id: "1", post_id: A }, { id: "2", post_id: A }]), { kind: "not-shared" });
  assert.deepEqual(planUsageIsolation(A, []), { kind: "not-shared" });
});

await test("non-shared asset: no clone, no re-link, editing post writes directly as before", async () => {
  const db = fakeDb([{ id: "a0", post_id: A, media_asset_id: X, position: 0 }]);
  const spy = cloneSpy();
  const result = await isolatePostUsageForEdit(db.client, { mediaAssetId: X, editingPostId: A, clone: spy.clone });
  assert.deepEqual(result, { kind: "not-shared" });
  assert.deepEqual(spy.calls, []);
  assert.deepEqual(db.writes, []);
});

await test("THE BUG: carousel item that is another post's cover -> isolated, only that usage row re-linked", async () => {
  const db = fakeDb([
    { id: "b0", post_id: B, media_asset_id: X, position: 0 },
    { id: "a0", post_id: A, media_asset_id: "asset-cover-A", position: 0 },
    { id: "a2", post_id: A, media_asset_id: X, position: 2 },
  ]);
  const spy = cloneSpy("clone-1");
  const result = await isolatePostUsageForEdit(db.client, { mediaAssetId: X, editingPostId: A, clone: spy.clone });
  assert.deepEqual(result, { kind: "isolated", cloneId: "clone-1", usageRowId: "a2", otherPostIds: [B] });
  assert.deepEqual(spy.calls, [X]);
  assert.deepEqual(db.writes, [{ id: "a2", media_asset_id: "clone-1" }]);
  assert.equal(db.table.find((r) => r.id === "b0")!.media_asset_id, X, "other post's cover untouched");
  assert.equal(db.table.find((r) => r.id === "a0")!.media_asset_id, "asset-cover-A", "editing post's own cover untouched");
});

await test("REVERSE: cover that another post uses as a carousel item -> now detected and isolated", async () => {
  const db = fakeDb([
    { id: "a0", post_id: A, media_asset_id: X, position: 0 },
    { id: "b3", post_id: B, media_asset_id: X, position: 3 },
  ]);
  const spy = cloneSpy("clone-2");
  const result = await isolatePostUsageForEdit(db.client, { mediaAssetId: X, editingPostId: A, clone: spy.clone });
  assert.equal(result.kind, "isolated");
  assert.deepEqual(db.writes, [{ id: "a0", media_asset_id: "clone-2" }]);
  assert.equal(db.table.find((r) => r.id === "b3")!.media_asset_id, X, "other post's carousel item untouched");
});

await test("shared cover (both posts' cover) -> isolated, other post untouched", async () => {
  const db = fakeDb([
    { id: "a0", post_id: A, media_asset_id: X, position: 0 },
    { id: "b0", post_id: B, media_asset_id: X, position: 0 },
    { id: "c0", post_id: "post-C", media_asset_id: X, position: 1 },
  ]);
  const result = await isolatePostUsageForEdit(db.client, { mediaAssetId: X, editingPostId: A, clone: cloneSpy("clone-3").clone });
  assert.deepEqual(result, { kind: "isolated", cloneId: "clone-3", usageRowId: "a0", otherPostIds: [B, "post-C"] });
  assert.deepEqual(db.writes, [{ id: "a0", media_asset_id: "clone-3" }]);
});

await test("duplicate usages in the editing post + shared -> refused BEFORE cloning, nothing written", async () => {
  const db = fakeDb([
    { id: "a0", post_id: A, media_asset_id: X, position: 0 },
    { id: "a4", post_id: A, media_asset_id: X, position: 4 },
    { id: "b0", post_id: B, media_asset_id: X, position: 0 },
  ]);
  const spy = cloneSpy();
  const result = await isolatePostUsageForEdit(db.client, { mediaAssetId: X, editingPostId: A, clone: spy.clone });
  assert.equal(result.kind, "failed");
  assert.equal(result.kind === "failed" && result.stage, "multiple-usages-in-post");
  assert.deepEqual(spy.calls, []);
  assert.deepEqual(db.writes, []);
});

await test("editing post doesn't use the asset + shared -> refused BEFORE cloning (no orphan copy)", async () => {
  const db = fakeDb([{ id: "b0", post_id: B, media_asset_id: X, position: 0 }]);
  const spy = cloneSpy();
  const result = await isolatePostUsageForEdit(db.client, { mediaAssetId: X, editingPostId: A, clone: spy.clone });
  assert.equal(result.kind === "failed" && result.stage, "no-usage-in-post");
  assert.deepEqual(spy.calls, []);
});

await test("zero-row re-link (e.g. RLS filtered the update) -> failed, never reported as success", async () => {
  const db = fakeDb(
    [
      { id: "a2", post_id: A, media_asset_id: X, position: 2 },
      { id: "b0", post_id: B, media_asset_id: X, position: 0 },
    ],
    { updateMatchesNothing: true },
  );
  const result = await isolatePostUsageForEdit(db.client, { mediaAssetId: X, editingPostId: A, clone: cloneSpy("clone-4").clone });
  assert.equal(result.kind === "failed" && result.stage, "relink");
  assert.equal(result.kind === "failed" && result.detail.relinkedCount, 0);
});

await test("re-link error -> failed", async () => {
  const db = fakeDb(
    [
      { id: "a2", post_id: A, media_asset_id: X, position: 2 },
      { id: "b0", post_id: B, media_asset_id: X, position: 0 },
    ],
    { updateError: true },
  );
  const result = await isolatePostUsageForEdit(db.client, { mediaAssetId: X, editingPostId: A, clone: cloneSpy().clone });
  assert.equal(result.kind === "failed" && result.stage, "relink");
});

await test("usage lookup error -> failed closed (never treated as not-shared), no clone", async () => {
  const db = fakeDb([{ id: "a0", post_id: A, media_asset_id: X, position: 0 }], { lookupError: true });
  const spy = cloneSpy();
  const result = await isolatePostUsageForEdit(db.client, { mediaAssetId: X, editingPostId: A, clone: spy.clone });
  assert.equal(result.kind === "failed" && result.stage, "usage-lookup");
  assert.deepEqual(spy.calls, []);
});

await test("clone failure -> failed, nothing re-linked", async () => {
  const db = fakeDb([
    { id: "a2", post_id: A, media_asset_id: X, position: 2 },
    { id: "b0", post_id: B, media_asset_id: X, position: 0 },
  ]);
  const result = await isolatePostUsageForEdit(db.client, { mediaAssetId: X, editingPostId: A, clone: cloneSpy(null).clone });
  assert.equal(result.kind === "failed" && result.stage, "clone");
  assert.deepEqual(db.writes, []);
});

// Image AND video-poster saves must both go through this one helper, and
// neither may keep its own cover-only (position 0) sharing check/re-link.
await test("both save actions use the helper; no position-0-only divergence logic remains", () => {
  const src = fs.readFileSync(new URL("./actions/media.ts", import.meta.url), "utf8");
  for (const fn of ["saveMediaAssetAnnotation", "saveMediaAssetPosterAnnotation"]) {
    const start = src.indexOf(`export async function ${fn}(`);
    assert.ok(start >= 0, `${fn} not found`);
    const next = src.indexOf("export async function", start + 1);
    const body = src.slice(start, next === -1 ? undefined : next);
    assert.ok(body.includes("isolatePostUsageForEdit("), `${fn} must call isolatePostUsageForEdit`);
    assert.ok(!body.includes('.eq("position", 0)'), `${fn} must not filter divergence by position 0`);
  }
});

console.log(`\n${passed} tests passed`);
