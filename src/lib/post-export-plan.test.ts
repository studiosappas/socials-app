// Tests for post-export-plan.ts -- no sharp, no DOM, no network. Run with:
//   node --experimental-strip-types src/lib/post-export-plan.test.ts
//
// The pixel-level half (real crops, real zips, measured dimensions) is
// scripts/post-export.check.mjs.

import assert from "node:assert/strict";
import {
  editedDownloadSource,
  parseExportPart,
  parseExportVariant,
  planPostExport,
  postExportUrl,
  videoCoverDownloadSource,
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
const vid = (
  n: number,
  previewPath: string | null = null,
  cover: { posterPath?: string | null; coverEdited?: boolean } = {},
): PostExportAsset => ({
  postAssetId: `pa-${n}`,
  mediaType: "video",
  storagePath: `proj/orig-${n}.mov`,
  previewPath,
  ...cover,
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

test("a standalone Reel with only its AUTOMATIC poster exports that poster as its one cover image, byte-for-byte", () => {
  const auto = { posterPath: "proj/auto-poster.jpg", coverEdited: false };
  assert.deepEqual(summarize(planPostExport([vid(1, null, auto)], null, "edited")), [
    "cover.mov <- proj/orig-1.mov [verbatim]",
    "cover-image.jpg <- proj/auto-poster.jpg [verbatim]",
  ]);
  // never a second / duplicate cover file
  const plan = planPostExport([vid(1, null, auto)], FRAMING, "edited");
  assert.equal(plan.filter((i) => i.part === "cover-image").length, 1);
  // no poster file at all: nothing is invented
  assert.deepEqual(summarize(planPostExport([vid(1, null, { posterPath: null })], null, "edited")), ["cover.mov <- proj/orig-1.mov [verbatim]"]);
});

test("carousel videos always export just the real video file -- an automatic poster adds nothing", () => {
  const auto = { posterPath: "proj/auto-poster.jpg", coverEdited: false };
  assert.deepEqual(summarize(planPostExport([img(1), vid(2, null, auto), vid(3)], null, "edited")), [
    "cover.png <- proj/orig-1.png [verbatim]",
    "slide-2.mov <- proj/orig-2.mov [verbatim]",
    "slide-3.mov <- proj/orig-3.mov [verbatim]",
  ]);
  // framing only ever belongs to the post's cover -- a framed post doesn't
  // pull in a non-cover video's automatic poster
  assert.deepEqual(summarize(planPostExport([img(1), vid(2, null, auto)], FRAMING, "edited")), [
    "cover.jpg <- proj/orig-1.png [cover-crop]",
    "slide-2.mov <- proj/orig-2.mov [verbatim]",
  ]);
});

test("a standalone Reel with an EDITED cover exports the untouched video plus its cover image, byte-for-byte", () => {
  const edited = { posterPath: "proj/poster-edit.jpg", coverEdited: true };
  assert.deepEqual(summarize(planPostExport([vid(1, null, edited)], null, "edited")), [
    "cover.mov <- proj/orig-1.mov [verbatim]",
    "cover-image.jpg <- proj/poster-edit.jpg [verbatim]",
  ]);
});

test("a FRAMED standalone Reel cover exports its cover image with the framing -- edited or automatic poster alike", () => {
  for (const coverEdited of [true, false]) {
    assert.deepEqual(summarize(planPostExport([vid(1, null, { posterPath: "proj/poster.jpg", coverEdited })], FRAMING, "edited")), [
      "cover.mov <- proj/orig-1.mov [verbatim]",
      "cover-image.jpg <- proj/poster.jpg [cover-crop]",
    ]);
  }
});

test("mixed carousels: every slide exports, videos as their real files, and NO standalone cover JPG for any video", () => {
  const edited = { posterPath: "proj/poster-edit.jpg", coverEdited: true };
  // video inside a carousel, edited cover, at a non-cover position
  assert.deepEqual(summarize(planPostExport([img(1), vid(2, null, edited)], null, "edited")), [
    "cover.png <- proj/orig-1.png [verbatim]",
    "slide-2.mov <- proj/orig-2.mov [verbatim]",
  ]);
  // video as the carousel's FIRST item, edited and framed -- still no cover JPG
  for (const framing of [null, FRAMING]) {
    assert.deepEqual(summarize(planPostExport([vid(1, null, edited), img(2), vid(3, null, edited)], framing, "edited")), [
      "cover.mov <- proj/orig-1.mov [verbatim]",
      "slide-2.png <- proj/orig-2.png [verbatim]",
      "slide-3.mov <- proj/orig-3.mov [verbatim]",
    ]);
  }
  // an all-video carousel is a carousel too
  assert.deepEqual(summarize(planPostExport([vid(1, null, edited), vid(2, null, edited)], FRAMING, "edited")), [
    "cover.mov <- proj/orig-1.mov [verbatim]",
    "slide-2.mov <- proj/orig-2.mov [verbatim]",
  ]);
});

test("a video with no poster at all never gets a cover image, edited flag or framing notwithstanding", () => {
  assert.deepEqual(summarize(planPostExport([vid(1, null, { posterPath: null, coverEdited: true })], FRAMING, "edited")), [
    "cover.mov <- proj/orig-1.mov [verbatim]",
  ]);
});

test("a Reel's cover image carries its own part, label and a unique filename", () => {
  const plan = planPostExport([vid(1, null, { posterPath: "p/a.jpg", coverEdited: true })], null, "edited");
  assert.deepEqual(plan.map((i) => [i.postAssetId, i.part, i.label]), [
    ["pa-1", "media", "the cover"],
    ["pa-1", "cover-image", "the cover image"],
  ]);
  assert.equal(new Set(plan.map((i) => i.filename)).size, plan.length);
});

test("'original' variant ignores every edit and the framing: all originals, verbatim -- no cover images", () => {
  const edited = { posterPath: "proj/poster-edit.jpg", coverEdited: true };
  assert.deepEqual(summarize(planPostExport([img(1, "proj/a-preview.jpg"), img(2, "proj/b-preview.jpg"), vid(3, null, edited)], FRAMING, "original")), [
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

test("postExportUrl builds the route's request shapes", () => {
  assert.equal(postExportUrl("p", "q"), "/projects/p/posts/q/export");
  assert.equal(postExportUrl("p", "q", { variant: "original" }), "/projects/p/posts/q/export?variant=original");
  assert.equal(postExportUrl("p", "q", { postAssetId: "pa-1" }), "/projects/p/posts/q/export?asset=pa-1");
  assert.equal(postExportUrl("p", "q", { variant: "edited" }), "/projects/p/posts/q/export");
  assert.equal(postExportUrl("p", "q", { postAssetId: "pa-1", part: "cover-image" }), "/projects/p/posts/q/export?asset=pa-1&part=cover-image");
  // a part without an asset means nothing -- never sent
  assert.equal(postExportUrl("p", "q", { part: "cover-image" }), "/projects/p/posts/q/export");
});

test("parseExportPart: only an explicit 'cover-image' selects the cover image", () => {
  assert.equal(parseExportPart("cover-image"), "cover-image");
  for (const v of [null, undefined, "", "media", "cover", "COVER-IMAGE"]) assert.equal(parseExportPart(v), "media");
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

test("client: missing urls resolve to null, not a broken download; an untouched image downloads its full original", () => {
  assert.equal(editedDownloadSource({ ...shown, url: null, originalUrl: null }, false, null, "p", "q"), null);
  // an untouched asset's `url` IS its original -- no automatic display crop
  const untouched = { ...shown, url: "https://s/orig.png" };
  assert.deepEqual(editedDownloadSource(untouched, false, null, "p", "q"), { url: "https://s/orig.png", viaServer: false });
  assert.deepEqual(editedDownloadSource(untouched, true, null, "p", "q"), { url: "https://s/orig.png", viaServer: false });
});

const videoShown = (coverEdited: boolean | undefined, annotationJson: object | null = null) => ({
  postAssetId: "pa-2",
  mediaType: "video" as const,
  url: "https://s/v.mov",
  originalUrl: "https://s/v.mov",
  posterUrl: "https://s/poster.jpg",
  annotationJson,
  coverEdited,
});

test("client: a standalone Reel's edited cover image comes straight from storage", () => {
  assert.deepEqual(videoCoverDownloadSource(videoShown(true), true, null, 1, "p", "q"), { url: "https://s/poster.jpg", viaServer: false });
  // edited state read from saved annotation_json when the session didn't set it
  assert.deepEqual(videoCoverDownloadSource(videoShown(undefined, { objects: [] }), true, null, 1, "p", "q"), {
    url: "https://s/poster.jpg",
    viaServer: false,
  });
});

test("client: no 'Download Cover Image' for a video inside a carousel, at any position, edited or framed", () => {
  for (const itemCount of [2, 3, 10]) {
    for (const isCover of [true, false]) {
      for (const framing of [null, FRAMING]) {
        assert.equal(videoCoverDownloadSource(videoShown(true), isCover, framing, itemCount, "p", "q"), null);
        assert.equal(videoCoverDownloadSource(videoShown(undefined, { objects: [] }), isCover, framing, itemCount, "p", "q"), null);
      }
    }
  }
});

test("client: a framed Reel cover's image is rendered by the export route, edited or not", () => {
  for (const coverEdited of [true, false]) {
    assert.deepEqual(videoCoverDownloadSource(videoShown(coverEdited), true, FRAMING, 1, "p", "q"), {
      url: "/projects/p/posts/q/export?asset=pa-2&part=cover-image",
      viaServer: true,
      filename: "cover-image.jpg",
    });
  }
});

test("client: a standalone Reel's AUTOMATIC poster downloads as its cover image, straight from storage", () => {
  assert.deepEqual(videoCoverDownloadSource(videoShown(false), true, null, 1, "p", "q"), { url: "https://s/poster.jpg", viaServer: false });
});

test("client: no cover image for images, or videos without a poster", () => {
  assert.equal(videoCoverDownloadSource(shown, true, FRAMING, 1, "p", "q"), null);
  assert.equal(videoCoverDownloadSource({ ...videoShown(true), posterUrl: null }, true, FRAMING, 1, "p", "q"), null);
  assert.equal(videoCoverDownloadSource({ ...videoShown(false), posterUrl: null }, true, null, 1, "p", "q"), null);
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

test("client and server agree on which video cover images exist and which are rendered", () => {
  for (const framing of [null, FRAMING]) {
    for (const coverEdited of [true, false]) {
      // "reel": the video alone; "first"/"second": the video inside a
      // two-item carousel, at that position.
      for (const layout of ["reel", "first", "second"] as const) {
        const video = vid(9, null, { posterPath: "proj/poster.jpg", coverEdited });
        const assets = layout === "reel" ? [video] : layout === "first" ? [video, img(2)] : [img(1), video];
        const serverCover = planPostExport(assets, framing, "edited").find((i) => i.part === "cover-image");
        const clientCover = videoCoverDownloadSource(
          { postAssetId: "pa-9", mediaType: "video", url: "u", originalUrl: "o", posterUrl: "pu", coverEdited },
          layout !== "second",
          framing,
          assets.length,
          "p",
          "q",
        );
        const where = `framing ${Boolean(framing)}, edited ${coverEdited}, layout ${layout}`;
        if (layout !== "reel") assert.equal(serverCover, undefined, where);
        assert.equal(Boolean(serverCover), Boolean(clientCover), where);
        if (serverCover && clientCover) assert.equal(clientCover.viaServer, serverCover.operation === "cover-crop", where);
      }
    }
  }
});

console.log(`\n${passed} tests passed`);
