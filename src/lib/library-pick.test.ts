// Tests for library-pick.ts -- Post Editor's Add/Replace from Library must
// leave the carousel item on the media asset its post_assets row actually
// points at, so Edit Image saves (isolatePostUsageForEdit, the real
// server-side check) land on this post's own row. In-memory fake tables,
// no network. Run with:
//   node --experimental-strip-types src/lib/library-pick.test.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import { carryLibraryItemIds, mergeServerSlides, resolveCleanAssetId, settleLibraryPick } from "./library-pick.ts";
import { isolatePostUsageForEdit } from "./post-usage-isolation.ts";

type Usage = { id: string; post_id: string; media_asset_id: string; position: number };
type Asset = { id: string; annotation_json: object | null };

// Just enough of supabase-js's builder for both halves: media_assets
// select().eq().maybeSingle(), and post_assets select().eq() /
// update().eq()...select(), applying every .eq() filter for real.
function fakeDb(assets: Asset[], usages: Usage[]) {
  const db = { media_assets: assets.map((a) => ({ ...a })), post_assets: usages.map((u) => ({ ...u })) };
  const client = {
    from(name: "media_assets" | "post_assets") {
      const table = db[name] as Record<string, unknown>[];
      const filters: [string, unknown][] = [];
      let update: Record<string, unknown> | null = null;
      const matching = () => table.filter((r) => filters.every(([k, v]) => r[k] === v));
      const builder = {
        select() {
          return builder;
        },
        update(values: Record<string, unknown>) {
          update = values;
          return builder;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: matching()[0] ?? null, error: null });
        },
        then(resolve: (r: unknown) => void) {
          if (update) {
            const hit = matching();
            for (const r of hit) Object.assign(r, update);
            return resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
          }
          return resolve({ data: matching().map((r) => ({ id: r.id, post_id: r.post_id })), error: null });
        },
      };
      return builder;
    },
  };
  // cloneMediaAssetForDivergence's effect: a new, clean row.
  let n = 0;
  const clones: string[] = [];
  async function clone(sourceId: string): Promise<string | null> {
    const id = `${sourceId}-copy${++n}`;
    db.media_assets.push({ id, annotation_json: null });
    clones.push(sourceId);
    return id;
  }
  return { client: client as never, db, clone, clones };
}

// What addPostAsset does with the resolved id (actions/posts.ts).
async function addFromLibrary(t: ReturnType<typeof fakeDb>, postId: string, pickedId: string, rowId: string) {
  const resolved = await resolveCleanAssetId(t.client, pickedId, t.clone);
  if ("error" in resolved) return resolved;
  t.db.post_assets.push({ id: rowId, post_id: postId, media_asset_id: resolved.assetId, position: 1 });
  return { success: true as const, postAssetId: rowId, mediaAssetId: resolved.assetId };
}

// What replacePostAsset's library branch does with it.
async function replaceFromLibrary(t: ReturnType<typeof fakeDb>, rowId: string, pickedId: string) {
  const resolved = await resolveCleanAssetId(t.client, pickedId, t.clone);
  if ("error" in resolved) return { message: resolved.error };
  t.db.post_assets.find((u) => u.id === rowId)!.media_asset_id = resolved.assetId;
  return { success: true, mediaAssetId: resolved.assetId };
}

// One Edit Image save, as saveMediaAssetAnnotation runs it: the server-side
// shared-media check, then (when it passes) the write onto the target.
async function save(t: ReturnType<typeof fakeDb>, postId: string, mediaAssetId: string) {
  const isolation = await isolatePostUsageForEdit(t.client, { mediaAssetId, editingPostId: postId, clone: t.clone });
  if (isolation.kind === "failed") return { refused: isolation.stage };
  const target = isolation.kind === "isolated" ? isolation.cloneId : mediaAssetId;
  t.db.media_assets.find((a) => a.id === target)!.annotation_json = { saved: true };
  return { target, newId: isolation.kind === "isolated" ? isolation.cloneId : undefined };
}

type Item = { postAssetId: string; mediaAssetId: string; mediaPending?: boolean };

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

await test("Add an EDITED library asset: the item follows the copy and repeated saves land on it", async () => {
  const t = fakeDb([{ id: "X", annotation_json: { text: "A's edit" } }], [{ id: "a0", post_id: A, media_asset_id: "X", position: 0 }]);
  let items: Item[] = [{ postAssetId: "temp-X", mediaAssetId: "X", mediaPending: true }];
  const result = await addFromLibrary(t, B, "X", "b1");
  assert.ok("success" in result);
  assert.equal(result.mediaAssetId, "X-copy1");
  items = settleLibraryPick(items, "temp-X", { postAssetId: result.postAssetId, mediaAssetId: result.mediaAssetId });
  assert.deepEqual(items, [{ postAssetId: "b1", mediaAssetId: "X-copy1", mediaPending: false }]);

  // Before the fix the item kept "X" -- exactly the Staging refusal.
  assert.deepEqual(await save(t, B, "X"), { refused: "no-usage-in-post" });

  assert.deepEqual(await save(t, B, items[0].mediaAssetId), { target: "X-copy1", newId: undefined });
  assert.deepEqual(await save(t, B, items[0].mediaAssetId), { target: "X-copy1", newId: undefined });
  assert.deepEqual(t.clones, ["X"], "only the add copied -- no save made another copy");
  assert.deepEqual(t.db.media_assets.find((a) => a.id === "X")!.annotation_json, { text: "A's edit" }, "post A's asset untouched");
  assert.equal(t.db.post_assets.find((u) => u.id === "a0")!.media_asset_id, "X");
});

await test("Add an UNEDITED library asset: same id, first save isolates, the next save follows the copy", async () => {
  const t = fakeDb([{ id: "X", annotation_json: null }], [{ id: "a0", post_id: A, media_asset_id: "X", position: 0 }]);
  const result = await addFromLibrary(t, B, "X", "b1");
  assert.ok("success" in result);
  assert.equal(result.mediaAssetId, "X", "no copy for a never-edited asset");
  const items = settleLibraryPick<Item>([{ postAssetId: "temp-X", mediaAssetId: "X", mediaPending: true }], "temp-X", result);
  assert.equal(items[0].mediaAssetId, "X");

  const first = await save(t, B, items[0].mediaAssetId);
  assert.deepEqual(first, { target: "X-copy1", newId: "X-copy1" });
  // The editor's own save target follows the returned id (6f52757).
  assert.deepEqual(await save(t, B, first.newId!), { target: "X-copy1", newId: undefined });
  assert.equal(t.db.post_assets.find((u) => u.id === "b1")!.media_asset_id, "X-copy1");
  assert.equal(t.db.post_assets.find((u) => u.id === "a0")!.media_asset_id, "X");
  assert.equal(t.db.media_assets.find((a) => a.id === "X")!.annotation_json, null, "post A's asset untouched");
});

await test("Replace with an EDITED library asset: the item follows the copy and repeated saves land on it", async () => {
  const t = fakeDb(
    [{ id: "X", annotation_json: { text: "A's edit" } }, { id: "Y", annotation_json: null }],
    [{ id: "a0", post_id: A, media_asset_id: "X", position: 0 }, { id: "b0", post_id: B, media_asset_id: "Y", position: 0 }],
  );
  let items: Item[] = [{ postAssetId: "b0", mediaAssetId: "X", mediaPending: true }];
  const result = await replaceFromLibrary(t, "b0", "X");
  assert.equal(result.mediaAssetId, "X-copy1");
  items = settleLibraryPick(items, "b0", { mediaAssetId: result.mediaAssetId! });
  assert.deepEqual(items, [{ postAssetId: "b0", mediaAssetId: "X-copy1", mediaPending: false }]);

  assert.deepEqual(await save(t, B, "X"), { refused: "no-usage-in-post" }, "the stale picked id is still refused");
  assert.deepEqual(await save(t, B, items[0].mediaAssetId), { target: "X-copy1", newId: undefined });
  assert.deepEqual(await save(t, B, items[0].mediaAssetId), { target: "X-copy1", newId: undefined });
  assert.deepEqual(t.clones, ["X"]);
  assert.deepEqual(t.db.media_assets.find((a) => a.id === "X")!.annotation_json, { text: "A's edit" });
});

await test("Replace with an UNEDITED library asset: same id, saves isolate once", async () => {
  const t = fakeDb(
    [{ id: "X", annotation_json: null }, { id: "Y", annotation_json: null }],
    [{ id: "a0", post_id: A, media_asset_id: "X", position: 0 }, { id: "b0", post_id: B, media_asset_id: "Y", position: 0 }],
  );
  const result = await replaceFromLibrary(t, "b0", "X");
  assert.equal(result.mediaAssetId, "X");
  const items = settleLibraryPick<Item>([{ postAssetId: "b0", mediaAssetId: "X", mediaPending: true }], "b0", { mediaAssetId: "X" });
  const first = await save(t, B, items[0].mediaAssetId);
  assert.deepEqual(first, { target: "X-copy1", newId: "X-copy1" });
  assert.deepEqual(await save(t, B, first.newId!), { target: "X-copy1", newId: undefined });
  assert.equal(t.db.post_assets.find((u) => u.id === "a0")!.media_asset_id, "X");
});

await test("a failed copy refuses the add -- never falls back to the edited asset", async () => {
  const t = fakeDb([{ id: "X", annotation_json: { text: "A's edit" } }], []);
  assert.deepEqual(await resolveCleanAssetId(t.client, "X", async () => null), {
    error: "Couldn't add this asset independently. Please try again.",
  });
});

await test("settleLibraryPick touches only the picked item and keeps its row id unless given one", () => {
  const items: (Item & { url: string })[] = [
    { postAssetId: "p1", mediaAssetId: "M1", url: "u1" },
    { postAssetId: "p2", mediaAssetId: "M2", url: "u2", mediaPending: true },
  ];
  const next = settleLibraryPick(items, "p2", { mediaAssetId: "M2-copy" });
  assert.equal(next[0], items[0], "other items keep their identity");
  assert.deepEqual(next[1], { postAssetId: "p2", mediaAssetId: "M2-copy", url: "u2", mediaPending: false });
  assert.deepEqual(settleLibraryPick(items, "nope", { mediaAssetId: "Z" }), items);
});

await test("wiring: both actions return the resolved id, and the Post Editor settles it and blocks Edit Image while pending", () => {
  const posts = fs.readFileSync(new URL("./actions/posts.ts", import.meta.url), "utf8");
  const body = (fn: string) => {
    const start = posts.indexOf(`export async function ${fn}(`);
    assert.ok(start >= 0, `${fn} not found`);
    return posts.slice(start, posts.indexOf("\nexport ", start + 1));
  };
  assert.match(body("addPostAsset"), /return \{ success: true, postAssetId: data\.id, mediaAssetId: assetIdToUse \}/);
  assert.match(body("replacePostAsset"), /return \{ success: true, mediaAssetId: newMediaAssetId \}/);
  assert.match(body("addPostAsset"), /cleanAssetIdFor\(supabase, mediaAssetId\)/);
  assert.match(body("replacePostAsset"), /cleanAssetIdFor\(supabase, existingMediaAssetId\)/);

  const editor = fs.readFileSync(new URL("../app/projects/[projectId]/posts/[postId]/post-editor.tsx", import.meta.url), "utf8");
  assert.match(editor, /settleLibraryPick\(current, tempId, \{ postAssetId: result\.postAssetId, mediaAssetId: result\.mediaAssetId \}\)/);
  assert.match(editor, /settleLibraryPick\(current, postAssetId, \{ mediaAssetId: result\?\.mediaAssetId \?\? item\.id \}\)/);
  assert.equal(editor.match(/mediaPending: true,/g)?.length, 2, "both optimistic picks start pending");
  assert.match(editor, /onEditImage=\{\(\) =>\s+!asset\.mediaPending &&/);
  assert.match(editor, /disabled=\{asset\.mediaPending\}/);
});

// carryLibraryItemIds -- a server refresh must not drop a settled slide's
// Library origin (otherwise a copy-on-write original turns clickable again).
type Slide = { postAssetId: string; mediaAssetId: string; mediaPending?: boolean; libraryItemId?: string; url?: string };
// What the server sends: the rows as stored, never a libraryItemId.
const fromServer = (rows: [string, string][]): Slide[] =>
  rows.map(([postAssetId, mediaAssetId]) => ({ postAssetId, mediaAssetId, url: `signed-${mediaAssetId}` }));

await test("refresh keeps an edited-image copy's Library origin", () => {
  const current: Slide[] = [
    { postAssetId: "pa1", mediaAssetId: "slide1" },
    { postAssetId: "pa2", mediaAssetId: "0cab-copy", libraryItemId: "0cab", mediaPending: false },
  ];
  const next = carryLibraryItemIds(current, fromServer([["pa1", "slide1"], ["pa2", "0cab-copy"]]));
  assert.equal(next[1].libraryItemId, "0cab", "origin carried onto the fresh row");
  assert.equal(next[1].url, "signed-0cab-copy", "everything else comes from the server");
  assert.equal(next[0].libraryItemId, undefined);
});

await test("refresh does not carry the origin of a removed slide", () => {
  const current: Slide[] = [{ postAssetId: "pa2", mediaAssetId: "0cab-copy", libraryItemId: "0cab" }];
  const incoming = fromServer([["pa1", "slide1"]]);
  const next = carryLibraryItemIds(current, incoming);
  assert.equal(next, incoming, "nothing carried, same array back");
  assert.ok(next.every((a) => !a.libraryItemId));
});

await test("refresh does not carry the origin of a replaced slide", () => {
  // the same row now points at different media
  const current: Slide[] = [{ postAssetId: "pa2", mediaAssetId: "0cab-copy", libraryItemId: "0cab" }];
  const next = carryLibraryItemIds(current, fromServer([["pa2", "other-media"]]));
  assert.equal(next[0].libraryItemId, undefined);
});

await test("refresh does not carry the origin of a still-pending pick", () => {
  const current: Slide[] = [{ postAssetId: "pa2", mediaAssetId: "0cab", libraryItemId: "0cab", mediaPending: true }];
  const next = carryLibraryItemIds(current, fromServer([["pa2", "0cab"]]));
  assert.equal(next[0].libraryItemId, undefined, "only settled slides carry it");
});

await test("unchanged slides keep their identity, and an incoming origin is never overwritten", () => {
  const current: Slide[] = [
    { postAssetId: "pa1", mediaAssetId: "slide1" },
    { postAssetId: "pa3", mediaAssetId: "vid", libraryItemId: "vid" },
  ];
  const incoming = fromServer([["pa1", "slide1"], ["pa3", "vid"]]);
  const next = carryLibraryItemIds(current, incoming);
  assert.equal(next[0], incoming[0], "a slide with nothing to carry keeps its identity");
  assert.equal(next[1].libraryItemId, "vid");
  const own: Slide[] = [{ postAssetId: "pa3", mediaAssetId: "vid", libraryItemId: "already" }];
  assert.equal(carryLibraryItemIds(current, own)[0].libraryItemId, "already");
  const none = fromServer([["pa1", "slide1"]]);
  assert.equal(carryLibraryItemIds([], none), none, "no origins at all: same array back");
});

// mergeServerSlides -- a refresh can land while picks are still in flight.
const pendingAdd = (item: string, n = 1): Slide => ({ postAssetId: `temp-${item}-${n}`, mediaAssetId: item, libraryItemId: item, mediaPending: true });

await test("refresh keeps a pending Add the server doesn't list yet, at the end", () => {
  const current: Slide[] = [{ postAssetId: "pa1", mediaAssetId: "slide1" }, pendingAdd("vid")];
  const next = mergeServerSlides(current, fromServer([["pa1", "slide1"]]));
  assert.deepEqual(next.map((a) => a.postAssetId), ["pa1", "temp-vid-1"]);
  assert.equal(next[1], current[1], "the optimistic slide itself, untouched");
});

await test("refresh keeps a pending Replace's optimistic media over the server's old row", () => {
  const current: Slide[] = [{ postAssetId: "pa2", mediaAssetId: "new-pick", libraryItemId: "new-pick", mediaPending: true, url: "optimistic" }];
  const next = mergeServerSlides(current, fromServer([["pa2", "old-media"]]));
  assert.equal(next[0], current[0]);
  // ...and its own settle then completes it in place
  const settled = settleLibraryPick(next, "pa2", { mediaAssetId: "new-pick" });
  assert.deepEqual(settled, [{ postAssetId: "pa2", mediaAssetId: "new-pick", libraryItemId: "new-pick", mediaPending: false, url: "optimistic" }]);
});

await test("refresh that already lists the saved row, then the add settles: exactly one slide, no duplicate ids", () => {
  const current: Slide[] = [{ postAssetId: "pa1", mediaAssetId: "slide1" }, pendingAdd("0cab")];
  // the server saved the pick as a COPY before the client heard back
  const refreshed = mergeServerSlides(current, fromServer([["pa1", "slide1"], ["pa-0cab", "0cab-copy"]]));
  assert.deepEqual(refreshed.map((a) => a.postAssetId), ["pa1", "pa-0cab", "temp-0cab-1"], "temp kept until its response");
  const settled = settleLibraryPick(refreshed, "temp-0cab-1", { postAssetId: "pa-0cab", mediaAssetId: "0cab-copy" });
  assert.deepEqual(settled.map((a) => a.postAssetId), ["pa1", "pa-0cab"]);
  assert.equal(new Set(settled.map((a) => a.postAssetId)).size, settled.length, "no duplicate postAssetIds");
  assert.equal(settled[1].libraryItemId, "0cab", "the saved row takes over the Library origin");
  assert.equal(settled[1].url, "signed-0cab-copy", "and keeps the server's data");
});

await test("a failed pick after a refresh still removes its temp slide", () => {
  const current: Slide[] = [{ postAssetId: "pa1", mediaAssetId: "slide1" }, pendingAdd("vid")];
  const refreshed = mergeServerSlides(current, fromServer([["pa1", "slide1"]]));
  const failed = refreshed.filter((a) => a.postAssetId !== "temp-vid-1"); // handleAddFromLibrary's failure path
  assert.deepEqual(failed.map((a) => a.postAssetId), ["pa1"]);
});

await test("merge: settled slides follow carryLibraryItemIds (kept / removed / replaced)", () => {
  const current: Slide[] = [
    { postAssetId: "keep", mediaAssetId: "k-copy", libraryItemId: "k" },
    { postAssetId: "gone", mediaAssetId: "g", libraryItemId: "g" },
    { postAssetId: "swap", mediaAssetId: "s", libraryItemId: "s" },
  ];
  const next = mergeServerSlides(current, fromServer([["keep", "k-copy"], ["swap", "other"]]));
  assert.deepEqual(next.map((a) => [a.postAssetId, a.mediaAssetId, a.libraryItemId]), [
    ["keep", "k-copy", "k"],
    ["swap", "other", undefined],
  ]);
});

await test("settleLibraryPick without a refresh in between is unchanged (rename in place)", () => {
  const current: Slide[] = [{ postAssetId: "pa1", mediaAssetId: "slide1" }, pendingAdd("vid")];
  const next = settleLibraryPick(current, "temp-vid-1", { postAssetId: "pa-vid", mediaAssetId: "vid" });
  assert.deepEqual(next[1], { postAssetId: "pa-vid", mediaAssetId: "vid", libraryItemId: "vid", mediaPending: false });
  assert.equal(next[0], current[0]);
});

await test("wiring: the Post Editor merges server slides with a functional update", () => {
  const editor = fs.readFileSync(new URL("../app/projects/[projectId]/posts/[postId]/post-editor.tsx", import.meta.url), "utf8");
  assert.match(editor, /if \(assets !== prevAssets\) \{\s+setPrevAssets\(assets\);[\s\S]{0,400}?setOrderedAssets\(\(current\) => mergeServerSlides\(current, assets\)\);/);
  assert.doesNotMatch(editor, /setOrderedAssets\(assets\);/, "no bare replacement left");
  assert.doesNotMatch(editor, /carryLibraryItemIds\(orderedAssets/, "no snapshot-based merge left");
});

console.log(`\n${passed} passed`);
