// Tests for post-media-viewer-model.ts -- the Post Editor popup's media
// viewer model. No React/DOM. Run with:
//   node --experimental-strip-types "src/app/projects/[projectId]/posts/[postId]/post-media-viewer-model.test.ts"
//
// The real-browser behavior (layering above the popup, Escape/X closing ONLY
// the viewer, editor state preserved, ⋮/Crop/drag not opening it, video
// playback, mobile fit, no server actions) is covered by the opt-in check
// scripts/post-editor-media-viewer.check.mjs.

import assert from "node:assert/strict";
import {
  buildPostViewerMedia,
  CLICK_AFTER_DRAG_GRACE_MS,
  isClickRightAfterDrag,
  nextViewerIndex,
  prevViewerIndex,
  viewerIndexFor,
  viewerKeyAction,
  type ViewerSourceAsset,
} from "./post-media-viewer-model.ts";

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

const CROP = { scale: 1.4, x: 0.05, y: 0, rotation: 0 };
const mixed: ViewerSourceAsset[] = [
  { postAssetId: "pa-1", url: "https://x/img-1.jpg", posterUrl: null, mediaType: "image" },
  { postAssetId: "pa-2", url: "https://x/video-2.mp4", posterUrl: "https://x/poster-2.jpg", mediaType: "video" },
  { postAssetId: "pa-3", url: "https://x/img-3.jpg", posterUrl: null, mediaType: "image" },
  { postAssetId: "pa-4", url: "https://x/img-4.jpg", posterUrl: null, mediaType: "image" },
];

test("carousel order preserved exactly (Image -> Video -> Image -> Image)", () => {
  const media = buildPostViewerMedia(mixed, null);
  assert.deepEqual(media.map((m) => m.key), ["pa-1", "pa-2", "pa-3", "pa-4"]);
  assert.deepEqual(media.map((m) => m.mediaType), ["image", "video", "image", "image"]);
});

test("same shape Review Content feeds its Lightbox: contentType post, crop on the cover only", () => {
  const media = buildPostViewerMedia(mixed, CROP);
  assert.ok(media.every((m) => m.contentType === "post"));
  assert.deepEqual(media[0].coverTransform, CROP);
  assert.ok(media.slice(1).every((m) => m.coverTransform === null));
});

test("video stays the actual video: url is the MP4, the poster is only the poster", () => {
  const video = buildPostViewerMedia(mixed, null)[1];
  assert.equal(video.url, "https://x/video-2.mp4");
  assert.equal(video.posterUrl, "https://x/poster-2.jpg");
});

test("opens on the EXACT clicked item -- never defaults to item 1", () => {
  const media = buildPostViewerMedia(mixed, null);
  assert.equal(viewerIndexFor(media, "pa-3"), 2);
  assert.equal(viewerIndexFor(media, "pa-2"), 1);
  assert.equal(viewerIndexFor(media, "pa-1"), 0);
  assert.equal(viewerIndexFor(media, "missing"), null);
});

test("an item without a URL is skipped (as Review Content does) and indexes still point at the clicked item", () => {
  const withGap = [mixed[0], { ...mixed[1], url: null }, mixed[2], mixed[3]];
  const media = buildPostViewerMedia(withGap, null);
  assert.deepEqual(media.map((m) => m.key), ["pa-1", "pa-3", "pa-4"]);
  assert.equal(viewerIndexFor(media, "pa-3"), 1);
  assert.equal(viewerIndexFor(media, "pa-2"), null, "unviewable item doesn't open anything");
});

test("the cover crop only ever attaches to position 0, even when position 0 has no URL", () => {
  const media = buildPostViewerMedia([{ ...mixed[0], url: null }, mixed[1]], CROP);
  assert.equal(media[0].key, "pa-2");
  assert.equal(media[0].coverTransform, null);
});

test("prev/next loop exactly like Review Content (modulo), following carousel order", () => {
  const order: number[] = [];
  let i = 2;
  for (const step of ["n", "n", "n", "p", "p"]) {
    i = step === "n" ? nextViewerIndex(i, 4) : prevViewerIndex(i, 4);
    order.push(i + 1);
  }
  assert.deepEqual(order, [4, 1, 2, 1, 4]);
  assert.equal(nextViewerIndex(0, 1), 0);
  assert.equal(prevViewerIndex(0, 1), 0);
});

test("keys the viewer owns: Escape closes it, arrows navigate, undo/redo are swallowed, everything else passes through", () => {
  assert.equal(viewerKeyAction({ key: "Escape" }), "close");
  assert.equal(viewerKeyAction({ key: "ArrowLeft" }), "prev");
  assert.equal(viewerKeyAction({ key: "ArrowRight" }), "next");
  assert.equal(viewerKeyAction({ key: "z", ctrlKey: true }), "swallow");
  assert.equal(viewerKeyAction({ key: "Z", metaKey: true }), "swallow");
  assert.equal(viewerKeyAction({ key: "y", ctrlKey: true }), "swallow");
  assert.equal(viewerKeyAction({ key: "z" }), null, "plain typing untouched");
  assert.equal(viewerKeyAction({ key: "Tab" }), null);
  assert.equal(viewerKeyAction({ key: "Enter" }), null);
});

test("a click right after a drag-reorder doesn't open the viewer; a later click does", () => {
  assert.equal(isClickRightAfterDrag(null, 1000), false);
  assert.equal(isClickRightAfterDrag(1000, 1000 + CLICK_AFTER_DRAG_GRACE_MS - 1), true);
  assert.equal(isClickRightAfterDrag(1000, 1000 + CLICK_AFTER_DRAG_GRACE_MS), false);
});

test("read-only: building the viewer list never mutates the editor's assets or crop", () => {
  const assets = structuredClone(mixed);
  const crop = { ...CROP };
  const snapshot = JSON.stringify({ assets, crop });
  const media = buildPostViewerMedia(assets, crop);
  media[0].coverTransform!.scale = 99; // even mutating the output...
  media.reverse();
  assert.equal(JSON.stringify({ assets, crop: { ...CROP } }), JSON.stringify(JSON.parse(snapshot)));
  assert.notEqual(crop.scale, 99, "...must not reach the editor's crop object");
});

console.log(`\n${passed} passed`);
