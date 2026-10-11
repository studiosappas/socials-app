// Tests for post-export-plan.ts -- no sharp, no DOM, no network. Run with:
//   node --experimental-strip-types src/lib/post-export-plan.test.ts
//
// The pixel-level half (real crops, real zips, measured dimensions) is
// scripts/post-export.check.mjs.

import assert from "node:assert/strict";
import {
  editedDownloadSource,
  originalDownloadSource,
  parseExportVariant,
  planPostExport,
  postExportUrl,
  type PostExportAsset,
} from "./post-export-plan.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const img = (n: number, previewPath: string | null = null, ext = "png"): PostExportAsset => ({
  postAssetId: `pa-${n}`,
  mediaType: "image",
  storagePath: `proj/orig-${n}.${ext}`,
  previewPath,
});
const vid = (n: number, previewPath: string | null = null): PostExportAsset => ({
  postAssetId: `pa-${n}`,
  mediaType: "video",
  storagePath: `proj/orig-${n}.mov`,
  previewPath,
});
const FRAMING = { scale: 1.5, x: 0.1, y: 0, rotation: 0 };
const summarize = (items: ReturnType<typeof planPostExport>) => items.map((i) => `${i.filename} <- ${i.sourcePath} [${i.operation}]`);

test("untouched images, no framing: every file is the original, verbatim (byte-identical download)", () => {
  assert.deepEqual(summarize(planPostExport([img(1), img(2, null, "heic")], null, "edited")), [
    "cover.png <- proj/orig-1.png [verbatim]",
    "slide-2.heic <- proj/orig-2.heic [verbatim]",
  ]);
});

test("an edited image exports its SAVED EDIT, not the original -- cover or carousel slide alike", () => {
  assert.deepEqual(summarize(planPostExport([img(1, "proj/a-preview.jpg"), img(2), img(3, "proj/c-preview.jpg")], null, "edited")), [
    "cover.jpg <- proj/a-preview.jpg [verbatim]",
    "slide-2.png <- proj/orig-2.png [verbatim]",
    "slide-3.jpg <- proj/c-preview.jpg [verbatim]",
  ]);
});

test("Grid framing is applied to the cover only, starting from the ORIGINAL when the cover has no saved edit", () => {
  assert.deepEqual(summarize(planPostExport([img(1), img(2)], FRAMING, "edited")), [
    "cover.jpg <- proj/orig-1.png [cover-crop]",
    "slide-2.png <- proj/orig-2.png [verbatim]",
  ]);
});

test("edited cover + Grid framing: the framing starts from the SAVED EDIT (the image it was set against)", () => {
  assert.deepEqual(summarize(planPostExport([img(1, "proj/a-preview.jpg"), img(2, "proj/b-preview.jpg")], FRAMING, "edited")), [
    "cover.jpg <- proj/a-preview.jpg [cover-crop]",
    // never applied to another carousel item, edited or not
    "slide-2.jpg <- proj/b-preview.jpg [verbatim]",
  ]);
});

test("videos always export the real video file -- even as a framed cover with a saved cover edit", () => {
  assert.deepEqual(summarize(planPostExport([vid(1, "proj/poster-edit.jpg"), img(2), vid(3)], FRAMING, "edited")), [
    "cover.mov <- proj/orig-1.mov [verbatim]",
    "slide-2.png <- proj/orig-2.png [verbatim]",
    "slide-3.mov <- proj/orig-3.mov [verbatim]",
  ]);
});

test("'original' variant ignores every edit and the framing: all originals, verbatim", () => {
  assert.deepEqual(summarize(planPostExport([img(1, "proj/a-preview.jpg"), img(2, "proj/b-preview.jpg"), vid(3)], FRAMING, "original")), [
    "cover.png <- proj/orig-1.png [verbatim]",
    "slide-2.png <- proj/orig-2.png [verbatim]",
    "slide-3.mov <- proj/orig-3.mov [verbatim]",
  ]);
});

test("order, indexes, ids and labels follow the post's own order", () => {
  const plan = planPostExport([img(7), img(3), img(9)], null, "edited");
  assert.deepEqual(plan.map((i) => [i.index, i.postAssetId, i.label]), [
    [0, "pa-7", "the cover"],
    [1, "pa-3", "slide 2"],
    [2, "pa-9", "slide 3"],
  ]);
  assert.equal(new Set(plan.map((i) => i.filename)).size, 3, "filenames are unique inside the zip");
});

test("a storage path with no usable extension still gets a sane filename", () => {
  const odd: PostExportAsset = { postAssetId: "x", mediaType: "image", storagePath: "proj/folder.v2/noext", previewPath: null };
  assert.equal(planPostExport([odd], null, "edited")[0].filename, "cover.jpg");
  const oddVideo: PostExportAsset = { ...odd, mediaType: "video" };
  assert.equal(planPostExport([oddVideo], null, "edited")[0].filename, "cover.mp4");
});

test("parseExportVariant: only an explicit 'original' selects originals", () => {
  assert.equal(parseExportVariant("original"), "original");
  for (const v of [null, undefined, "", "edited", "ORIGINAL", "anything"]) assert.equal(parseExportVariant(v), "edited");
});

test("postExportUrl builds the route's three request shapes", () => {
  assert.equal(postExportUrl("p", "q"), "/projects/p/posts/q/export");
  assert.equal(postExportUrl("p", "q", { variant: "original" }), "/projects/p/posts/q/export?variant=original");
  assert.equal(postExportUrl("p", "q", { postAssetId: "pa-1" }), "/projects/p/posts/q/export?asset=pa-1");
  assert.equal(postExportUrl("p", "q", { variant: "edited" }), "/projects/p/posts/q/export");
});

// --- client-side source resolution (per-frame download, mobile share) -------

const shown = { postAssetId: "pa-1", mediaType: "image" as const, url: "https://s/preview.jpg", originalUrl: "https://s/orig.png" };

test("client: an edited slide downloads the saved edit straight from storage, never the original", () => {
  assert.deepEqual(editedDownloadSource(shown, false, FRAMING, "p", "q"), { url: "https://s/preview.jpg", viaServer: false });
  assert.deepEqual(editedDownloadSource(shown, true, null, "p", "q"), { url: "https://s/preview.jpg", viaServer: false });
});

test("client: only the cover WITH a framing goes through the export route", () => {
  assert.deepEqual(editedDownloadSource(shown, true, FRAMING, "p", "q"), {
    url: "/projects/p/posts/q/export?asset=pa-1",
    viaServer: true,
    filename: "cover.jpg",
  });
});

test("client: a video is always the real video file, framed cover or not", () => {
  const video = { postAssetId: "pa-2", mediaType: "video" as const, url: "https://s/v.mov", originalUrl: "https://s/v.mov" };
  assert.deepEqual(editedDownloadSource(video, true, FRAMING, "p", "q"), { url: "https://s/v.mov", viaServer: false });
});

test("client: 'Download Original' is always the original url; missing urls resolve to null, not a broken download", () => {
  assert.deepEqual(originalDownloadSource(shown), { url: "https://s/orig.png", viaServer: false });
  assert.equal(originalDownloadSource({ ...shown, originalUrl: null }), null);
  assert.equal(editedDownloadSource({ ...shown, url: null, originalUrl: null }, false, null, "p", "q"), null);
  // an untouched asset's `url` IS its original
  const untouched = { ...shown, url: "https://s/orig.png" };
  assert.equal(editedDownloadSource(untouched, false, null, "p", "q")!.url, originalDownloadSource(untouched)!.url);
});

test("client and server agree on which items need rendering", () => {
  const assets = [img(1, "proj/a-preview.jpg"), img(2, "proj/b-preview.jpg"), vid(3)];
  for (const framing of [null, FRAMING]) {
    const plan = planPostExport(assets, framing, "edited");
    assets.forEach((a, i) => {
      const client = editedDownloadSource({ postAssetId: a.postAssetId, mediaType: a.mediaType, url: "u", originalUrl: "o" }, i === 0, framing, "p", "q")!;
      assert.equal(client.viaServer, plan[i].operation === "cover-crop", `asset ${i}, framing ${Boolean(framing)}`);
    });
  }
});

console.log(`\n${passed} tests passed`);
