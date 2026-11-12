// Tests for library-picker-tiles.ts -- the Post Editor "Add from library"
// picker must never move a tile under the pointer because of something
// async. Replays the sequence reproduced on Staging (2026-11-12): picks
// ~1 s apart while their server actions settle seconds later, one at a
// time; an already-edited image settles onto a COPY, so its original
// stopped counting as used, reappeared, and shifted every later tile -- the
// click aimed at a video landed on the image before it.
// Run with:
//   node --experimental-strip-types src/lib/library-picker-tiles.test.ts

import assert from "node:assert/strict";
import { pickerTiles, rememberShown, usedLibraryIds, type PickerTile } from "./library-picker-tiles.ts";
import { settleLibraryPick } from "./library-pick.ts";

type Item = { id: string; mediaType: "image" | "video" };
type Slide = { postAssetId: string; mediaAssetId: string; mediaType: "image" | "video"; mediaPending?: boolean; libraryItemId?: string };

// The inventory rows around the reproduced click (rows 5-20 on Staging).
const LIBRARY: Item[] = [
  { id: "6efcaf70", mediaType: "image" },
  { id: "c5823acf", mediaType: "video" },
  { id: "0cab4173", mediaType: "image" }, // already edited -> picking it makes a copy
  { id: "f5ef5b5e", mediaType: "image" },
  { id: "56977118", mediaType: "image" },
  { id: "30e70e2e", mediaType: "video" }, // slide 1, already in the post
  { id: "aceb1690", mediaType: "image" },
  { id: "c7cf7671", mediaType: "image" },
  { id: "596d9d96", mediaType: "image" },
  { id: "53a972fd", mediaType: "video" },
  { id: "cf0431ed", mediaType: "image" },
  { id: "8829bbb2", mediaType: "image" },
  { id: "edf23926", mediaType: "video" },
  { id: "2e45fdf2", mediaType: "video" },
  { id: "29f01137", mediaType: "image" },
  { id: "852675b1", mediaType: "video" },
];
const EDITED = new Set(["0cab4173"]);

// The Post Editor's own state flow, minus React: orderedAssets +
// AddFromLibrarySection's shownHere, rendered the way the component does.
// `legacy` renders with the OLD rule (drop every used item) as a control.
function editor(slides: Slide[], library: Item[], legacy = false) {
  let assets = slides.map((s) => ({ ...s }));
  let items = [...library];
  let shownHere = new Set<string>();
  const pending: { tempId: string; item: Item; fail: boolean }[] = [];
  let n = 0;

  function render(): PickerTile<Item>[] {
    if (legacy) {
      // The old picker: used = slides' current mediaAssetId only, and every
      // used item dropped out of the list.
      const oldUsed = new Set(assets.map((a) => a.mediaAssetId));
      return items.filter((i) => !oldUsed.has(i.id)).map((item) => ({ item, added: false }));
    }
    const used = usedLibraryIds(assets);
    const tiles = pickerTiles(items, used, shownHere);
    shownHere = rememberShown(shownHere, tiles);
    return tiles;
  }
  render(); // first paint

  return {
    render,
    cellOf(id: string) {
      return render().findIndex((t) => t.item.id === id);
    },
    // A click at grid cell `cell`, exactly like a pointer at fixed coords.
    clickCell(cell: number, opts: { fail?: boolean } = {}): Item | null {
      const tile = render()[cell];
      if (!tile || tile.added) return null; // disabled tile: nothing happens
      const item = tile.item;
      const tempId = `temp-${item.id}-${++n}`;
      // handleAddFromLibrary's optimistic slide
      assets = [...assets, { postAssetId: tempId, mediaAssetId: item.id, mediaType: item.mediaType, mediaPending: true, libraryItemId: item.id }];
      pending.push({ tempId, item, fail: Boolean(opts.fail) });
      return item;
    },
    // The OLDEST queued server action resolves (they run one at a time).
    settleNext() {
      const p = pending.shift();
      if (!p) return;
      if (p.fail) {
        assets = assets.filter((a) => a.postAssetId !== p.tempId);
        return;
      }
      const savedId = EDITED.has(p.item.id) ? `${p.item.id}-copy` : p.item.id; // addPostAsset's copy-on-write
      assets = settleLibraryPick(assets, p.tempId, { postAssetId: `pa-${p.item.id}`, mediaAssetId: savedId });
    },
    removeSlide(mediaAssetId: string) {
      assets = assets.filter((a) => a.mediaAssetId !== mediaAssetId);
    },
    replaceSlide(postAssetId: string, item: Item) {
      assets = assets.map((a) => (a.postAssetId === postAssetId ? { ...a, mediaAssetId: item.id, mediaType: item.mediaType, mediaPending: true, libraryItemId: item.id } : a));
    },
    appendPage(page: Item[]) {
      items = [...items, ...page.filter((p) => !items.some((i) => i.id === p.id))];
    },
    get assets() {
      return assets;
    },
  };
}

const SLIDE1: Slide = { postAssetId: "pa-slide1", mediaAssetId: "30e70e2e", mediaType: "video" };

// 1. The reproduced sequence. Picks 2-4 are queued; the user aims at the
//    video, then -- before the click lands -- the copy-on-write pick
//    settles. The click must still hit the video.
{
  for (const legacy of [true, false]) {
    const ed = editor([SLIDE1], LIBRARY, legacy);
    ed.clickCell(ed.cellOf("0cab4173")); // image, edited -> copy
    ed.clickCell(ed.cellOf("53a972fd")); // video
    ed.clickCell(ed.cellOf("f5ef5b5e")); // image
    const aimed = ed.cellOf("edf23926"); // the user looks at the video...
    ed.settleNext(); // ...pick 2 settles onto its copy, seconds after its click
    const got = ed.clickCell(aimed); // ...and the click lands at the same spot
    if (legacy) {
      // Control: the old rule really did put the neighbouring image there.
      assert.equal(got?.id, "8829bbb2", "control: old picker shifted the image under the pointer");
      assert.equal(got?.mediaType, "image");
    } else {
      assert.equal(got?.id, "edf23926", "the click lands on the video it was aimed at");
      assert.equal(got?.mediaType, "video");
    }
  }
}

// 2. Same sequence, every pick settled one at a time in between clicks:
//    every intended tile is the one that gets added, with its own type,
//    and the saved slides map back to exactly the items clicked.
{
  const ed = editor([SLIDE1], LIBRARY);
  const intended = ["0cab4173", "53a972fd", "f5ef5b5e", "edf23926", "2e45fdf2", "cf0431ed", "852675b1"];
  const cells = new Map<string, number>();
  for (const id of intended) cells.set(id, ed.cellOf(id));
  const added: Item[] = [];
  for (const [i, id] of intended.entries()) {
    const aimed = ed.cellOf(id);
    assert.equal(aimed, cells.get(id), `${id} never moved before it was clicked`);
    if (i >= 2) ed.settleNext(); // the queue lags two picks behind
    const got = ed.clickCell(aimed);
    assert.ok(got, `${id} was clickable`);
    added.push(got);
  }
  while (ed.assets.some((a) => a.mediaPending)) ed.settleNext();
  assert.deepEqual(added.map((i) => i.id), intended);
  assert.deepEqual(
    ed.assets.slice(1).map((a) => [a.libraryItemId, a.mediaAssetId, a.mediaType]),
    intended.map((id) => [id, EDITED.has(id) ? `${id}-copy` : id, LIBRARY.find((i) => i.id === id)!.mediaType]),
    "each slide carries the clicked item's type; the edited image settled onto its copy",
  );
  for (const id of intended) assert.equal(ed.cellOf(id), cells.get(id), `${id} is still in its original cell`);
}

// 3. Copy-on-write: after the edited image settles onto its copy, its
//    original stays in place, marked Added, and can't be picked twice.
{
  const ed = editor([SLIDE1], LIBRARY);
  const cell = ed.cellOf("0cab4173");
  ed.clickCell(cell);
  ed.settleNext();
  assert.equal(ed.assets[1].mediaAssetId, "0cab4173-copy");
  const tile = ed.render()[cell];
  assert.equal(tile.item.id, "0cab4173");
  assert.equal(tile.added, true, "original still counts as used after the copy settles");
  assert.equal(ed.clickCell(cell), null, "an Added tile does nothing when clicked");
  assert.equal(ed.assets.length, 2);
}

// 4. A failed pick reverts in place: no shift, and the tile is clickable again.
{
  const ed = editor([SLIDE1], LIBRARY);
  const before = ed.render().map((t) => t.item.id);
  const cell = ed.cellOf("53a972fd");
  ed.clickCell(cell, { fail: true });
  assert.equal(ed.render()[cell].added, true);
  ed.settleNext();
  assert.deepEqual(ed.render().map((t) => t.item.id), before, "nothing moved");
  assert.equal(ed.render()[cell].added, false);
  assert.equal(ed.clickCell(cell)?.id, "53a972fd");
}

// 5. What the post already had at open stays hidden (unchanged behaviour),
//    and a reopened picker hides everything the post now uses.
{
  const ed = editor([SLIDE1], LIBRARY);
  assert.equal(ed.cellOf("30e70e2e"), -1, "slide 1 isn't listed");
  ed.clickCell(ed.cellOf("edf23926"));
  ed.settleNext();
  const reopened = editor(ed.assets, LIBRARY);
  assert.equal(reopened.cellOf("edf23926"), -1, "a fresh picker hides it again");
}

// 6. Pagination: a newer page appends at the end, nothing above it moves,
//    and an item that's already used when its page arrives stays hidden.
{
  const ed = editor([SLIDE1, { postAssetId: "pa-x", mediaAssetId: "later-used", mediaType: "video" }], LIBRARY);
  ed.clickCell(ed.cellOf("2e45fdf2"));
  const before = ed.render().map((t) => t.item.id);
  ed.appendPage([
    { id: "2e772c4d", mediaType: "video" },
    { id: "later-used", mediaType: "video" },
    { id: "6efcaf70", mediaType: "image" }, // duplicate row: ignored
  ]);
  const after = ed.render().map((t) => t.item.id);
  assert.deepEqual(after.slice(0, before.length), before, "loaded tiles kept their cells");
  assert.deepEqual(after.slice(before.length), ["2e772c4d"]);
  ed.settleNext();
  assert.deepEqual(ed.render().map((t) => t.item.id), after, "a settle after paging moves nothing");
}

// 7. Replace from Library: the picked replacement stays in place as Added;
//    a slide removed by the user frees its tile in place.
{
  const ed = editor([SLIDE1], LIBRARY);
  const pickCell = ed.cellOf("cf0431ed");
  ed.clickCell(pickCell);
  ed.settleNext();
  const replCell = ed.cellOf("852675b1");
  ed.replaceSlide("pa-cf0431ed", LIBRARY.find((i) => i.id === "852675b1")!);
  assert.equal(ed.render()[replCell].added, true, "replacement shows as Added, same cell");
  assert.equal(ed.render()[pickCell].added, false, "the replaced item is free again, same cell");
  ed.removeSlide("852675b1");
  assert.equal(ed.render()[replCell].item.id, "852675b1");
  assert.equal(ed.render()[replCell].added, false);
}

// 8. rememberShown returns the SAME set when nothing is new (the component
//    stores it in state and must not re-render forever).
{
  const shown = new Set(["a"]);
  assert.equal(rememberShown(shown, [{ item: { id: "a" }, added: false }]), shown);
  const next = rememberShown(shown, [{ item: { id: "a" }, added: false }, { item: { id: "b" }, added: true }]);
  assert.notEqual(next, shown);
  assert.deepEqual([...next].sort(), ["a", "b"]);
  assert.deepEqual([...shown], ["a"], "input set not mutated");
}

console.log("library-picker-tiles: all tests passed");
