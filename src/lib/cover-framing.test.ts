// Tests for cover-framing.ts. Run with:
//   node --experimental-strip-types src/lib/cover-framing.test.ts
// The rendered-export half (real plan + renderer, legacy vs marked, against
// Production's plan) is scripts/post-export.check.mjs part D.

import assert from "node:assert/strict";
import {
  GRID_PREVIEW_SCOPE,
  GRID_PREVIEW_SCOPE_VERSION,
  REEL_COVER_SCOPE,
  coverFramingKind,
  coverLayoutFrame,
  exportCoverFraming,
  exportFraming,
  isGridPreviewFraming,
  isReelCoverFraming,
  markCoverFraming,
  markGridPreviewFraming,
  sameFraming,
  slideExportFraming,
} from "./cover-framing.ts";

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

const LEGACY = { scale: 1.6, x: 0.08, y: -0.05, rotation: 0 };

test("the marker shape is exactly { scope: 'grid-preview', scopeVersion: 1 } on top of the framing", () => {
  const marked = markGridPreviewFraming(LEGACY);
  assert.deepEqual(marked, { ...LEGACY, scope: "grid-preview", scopeVersion: 1 });
  assert.equal(GRID_PREVIEW_SCOPE, "grid-preview");
  assert.equal(GRID_PREVIEW_SCOPE_VERSION, 1);
  // the input isn't mutated
  assert.equal("scope" in LEGACY, false);
  // survives a JSONB round trip
  assert.equal(isGridPreviewFraming(JSON.parse(JSON.stringify(marked))), true);
});

test("unmarked legacy framing keeps cropping exports, untouched", () => {
  assert.equal(isGridPreviewFraming(LEGACY), false);
  assert.equal(exportCoverFraming(LEGACY), LEGACY);
  assert.equal(exportCoverFraming({ scale: 2, x: 0, y: 0 }) !== null, true, "rotation-less legacy shape too");
});

test("marked framing never crops exports", () => {
  assert.equal(exportCoverFraming(markGridPreviewFraming(LEGACY)), null);
});

test("missing / malformed / unknown markers are LEGACY (fail-safe: old exports never change)", () => {
  const variants: object[] = [
    { ...LEGACY, scope: "grid-preview" }, // no version
    { ...LEGACY, scope: "grid-preview", scopeVersion: 2 }, // unknown version
    { ...LEGACY, scope: "grid-preview", scopeVersion: "1" }, // wrong type
    { ...LEGACY, scope: "Grid-Preview", scopeVersion: 1 }, // case
    { ...LEGACY, scope: "export", scopeVersion: 1 }, // unknown scope
    { ...LEGACY, scope: null, scopeVersion: 1 },
    { ...LEGACY, scopeVersion: 1 },
  ];
  for (const v of variants) {
    assert.equal(isGridPreviewFraming(v), false, JSON.stringify(v));
    assert.equal(exportCoverFraming(v), v, JSON.stringify(v));
  }
  for (const v of [null, undefined, "grid-preview", 42, []]) assert.equal(isGridPreviewFraming(v), false);
  assert.equal(exportCoverFraming(null), null);
  assert.equal(exportCoverFraming(undefined), null);
});

test("sameFraming: an untouched Crop (open + close) is detected, so nothing is rewritten or marked", () => {
  assert.equal(sameFraming(LEGACY, { ...LEGACY }), true);
  assert.equal(sameFraming(LEGACY, markGridPreviewFraming(LEGACY)), true, "the marker itself isn't a framing change");
  assert.equal(sameFraming({ scale: 2, x: 0, y: 0 }, { scale: 2, x: 0, y: 0, rotation: 0 }), true, "missing rotation == 0");
  assert.equal(sameFraming({ scale: 1, x: 0, y: 0, rotation: 360 }, { scale: 1, x: 0, y: 0, rotation: 0 }), true);
  assert.equal(sameFraming(null, null), true);
  assert.equal(sameFraming(undefined, null), true);
});

test("sameFraming: any real change is a new crop", () => {
  assert.equal(sameFraming(LEGACY, { ...LEGACY, scale: 1.61 }), false);
  assert.equal(sameFraming(LEGACY, { ...LEGACY, x: 0.081 }), false);
  assert.equal(sameFraming(LEGACY, { ...LEGACY, y: 0 }), false);
  assert.equal(sameFraming(LEGACY, { ...LEGACY, rotation: 5 }), false);
  // cropping a never-framed cover (null -> zoom 1, centred) is a new crop
  assert.equal(sameFraming(null, { scale: 1, x: 0, y: 0, rotation: 0 }), false);
});

// --- Reel cover framing (9:16 cover, 3:4 Grid band) -------------------------

test("cover kinds: a standalone Reel -> reel; an older 3:4 Reel cover -> legacy-reel; everything else -> preview", () => {
  assert.equal(coverFramingKind({ mediaType: "video", itemCount: 1, coverAspect: 9 / 16 }), "reel");
  assert.equal(coverFramingKind({ mediaType: "video", itemCount: 1, coverAspect: 16 / 9 }), "reel", "landscape automatic poster");
  assert.equal(coverFramingKind({ mediaType: "video", itemCount: 1, coverAspect: 1 }), "reel", "square automatic poster");
  assert.equal(coverFramingKind({ mediaType: "video", itemCount: 1, coverAspect: null }), "reel", "not measured yet");
  assert.equal(coverFramingKind({ mediaType: "video", itemCount: 1, coverAspect: 1080 / 1440 }), "legacy-reel");
  assert.equal(coverFramingKind({ mediaType: "video", itemCount: 3, coverAspect: 9 / 16 }), "preview", "carousel video");
  assert.equal(coverFramingKind({ mediaType: "image", itemCount: 1, coverAspect: 9 / 16 }), "preview");
  assert.equal(coverFramingKind({ mediaType: null, itemCount: 0 }), "preview");
});

test("markCoverFraming: the TARGET kind decides the marker (a pasted crop's own marker is replaced)", () => {
  const t = { scale: 1.3, x: 0.1, y: -0.05, rotation: 4 };
  assert.deepEqual(markCoverFraming(t, "reel"), { ...t, scope: "reel-cover", scopeVersion: 1 });
  assert.deepEqual(markCoverFraming(t, "preview"), { ...t, scope: "grid-preview", scopeVersion: 1 });
  assert.deepEqual(markCoverFraming(t, "legacy-reel"), t, "legacy 3:4 Reel covers keep the unmarked (3:4-exporting) crop");
  const pasted = { ...t, scope: "reel-cover", scopeVersion: 1 };
  assert.deepEqual(markCoverFraming(pasted, "preview"), { ...t, scope: "grid-preview", scopeVersion: 1 });
  assert.deepEqual(markCoverFraming({ ...t, scope: "grid-preview", scopeVersion: 1 }, "legacy-reel"), t);
  assert.equal(REEL_COVER_SCOPE, "reel-cover");
});

test("export rule: reel-cover crops the export ONLY while the cover is still a standalone Reel", () => {
  const reel = { scale: 1.3, x: 0, y: 0, scope: "reel-cover", scopeVersion: 1 };
  assert.equal(exportCoverFraming(reel, true), reel);
  assert.equal(exportCoverFraming(reel, false), null, "after a reorder / an added item: preview only");
  assert.equal(exportCoverFraming(reel), null, "safe default");
  assert.equal(isReelCoverFraming(reel), true);
  for (const bad of [{ ...reel, scopeVersion: 2 }, { ...reel, scopeVersion: "1" }, { ...reel, scope: "Reel-Cover" }]) {
    assert.equal(isReelCoverFraming(bad), false);
    assert.equal(exportCoverFraming(bad, true), bad, "malformed -> legacy, crops as before");
  }
  const grid = markGridPreviewFraming({ scale: 2, x: 0, y: 0 });
  assert.equal(exportCoverFraming(grid, true), null, "grid-preview stays preview only, even on a Reel");
  const legacy = { scale: 2, x: 0, y: 0 };
  assert.equal(exportCoverFraming(legacy, true), legacy);
  assert.equal(exportCoverFraming(legacy, false), legacy);
});

test("layout frame: reel-cover is laid out in a 9:16 frame as wide as the box; everything else in the box", () => {
  const reel = { scale: 1, x: 0, y: 0, scope: "reel-cover", scopeVersion: 1 };
  assert.deepEqual(coverLayoutFrame(reel, { w: 360, h: 480 }), { w: 360, h: 640 });
  assert.deepEqual(coverLayoutFrame(reel, { w: 1080, h: 1920 }), { w: 1080, h: 1920 });
  assert.deepEqual(coverLayoutFrame({ scale: 1, x: 0, y: 0 }, { w: 360, h: 480 }), { w: 360, h: 480 });
  assert.deepEqual(coverLayoutFrame(null, { w: 360, h: 480 }), { w: 360, h: 480 });
});

test("sameFraming ignores the marker: an UNCHANGED crop is never rewritten, whatever its scope (open + close Crop writes nothing)", () => {
  const t = { scale: 1.2, x: 0.1, y: 0, rotation: 0 };
  assert.equal(sameFraming(t, t), true, "legacy unmarked crop is left exactly as it is");
  assert.equal(sameFraming(t, { ...t, scope: "grid-preview", scopeVersion: 1 }), true);
  assert.equal(sameFraming(t, { ...t, scope: "reel-cover", scopeVersion: 1 }), true);
  // a real change is a new crop (written with the cover kind's marker)
  assert.equal(sameFraming({ ...t, x: 0.2 }, { ...t, scope: "reel-cover", scopeVersion: 1 }), false);
  assert.equal(sameFraming(null, t), false, "cropping a never-framed cover");
});

test("export framing: the 3:4 Grid box shows the frame's largest centred 3:4 window -- band of a taller frame, full height of a wider one", () => {
  const box = { w: 300, h: 400 };
  assert.deepEqual(coverLayoutFrame(exportFraming(9 / 16, null), box), { w: 300, h: 300 / (9 / 16) });
  assert.deepEqual(coverLayoutFrame(exportFraming(1, null), box), { w: 400, h: 400 }, "1:1 -> full height, sides cut");
  assert.deepEqual(coverLayoutFrame(exportFraming(4 / 5, null), box), { w: 320, h: 400 }, "4:5 -> full height");
  assert.deepEqual(coverLayoutFrame(exportFraming("original", null), box, { w: 768, h: 480 }), { w: 640, h: 400 }, "original = the image's own");
  assert.deepEqual(coverLayoutFrame(exportFraming("original", null), box, null), box, "original, size unknown -> the box");
  assert.deepEqual(coverLayoutFrame(exportFraming(4 / 5, null), { w: 800, h: 1000 }), { w: 800, h: 1000 }, "its own shape: all of it");
});

test("Client PDF slides: an image slide gets its own frame at the post's ratio; legacy and video slides stay unframed", () => {
  const f = { scale: 1.3, x: 0.1, y: -0.05, rotation: 0 };
  assert.deepEqual(slideExportFraming("4:5", "image", f, null), { ...f, scope: "export-frame", scopeVersion: 1, aspect: 4 / 5 });
  assert.equal(slideExportFraming("16:9", "image", null, null)?.aspect, 16 / 9);
  assert.equal(slideExportFraming("16:9", "image", null, null)?.scale, 1);
  assert.equal(slideExportFraming(null, "image", f, null), null);
  assert.equal(slideExportFraming("4:5", "video", f, null), null);
  // "Original" = the FIRST item's ratio, never the slide's own
  assert.equal(slideExportFraming("original", "image", f, 1.6)?.aspect, 1.6);
  assert.equal(slideExportFraming("original", "image", f, null), null);
});

console.log(`\n${passed} tests passed`);
