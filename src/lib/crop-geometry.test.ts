// Pure-math tests for crop-geometry.ts -- the shared coverage/rotation
// derivation used by BOTH the client crop editor (grid-crop-overlay.tsx)
// and the server export pipeline (image-crop.ts). No DOM/sharp involved,
// so this runs directly under Node's native TS support:
//
//   node --experimental-strip-types "src/lib/crop-geometry.test.ts"
//
// The most important tests here don't just check the formulas against
// themselves -- isFrameCovered below is an INDEPENDENT, from-first-
// principles containment check (does every corner of the frame actually
// land inside the source rectangle once both are expressed in the same
// coordinate system), used to verify minZoomForCoverage and
// clampOffsetPx actually deliver on their contract, not just that they
// return internally-consistent numbers.

import assert from "node:assert/strict";
import {
  clampOffsetPx,
  coverBaseScale,
  coverageSlackPx,
  minZoomForCoverage,
  normalizeRotationDeg,
  rotateVec,
} from "./crop-geometry.ts";

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

// Ground truth, independent of coverageSlackPx/minZoomForCoverage's own
// derivation: is every corner of an axis-aligned targetHalfW x
// targetHalfH rectangle -- centered at offsetPx relative to a
// srcHalfW x srcHalfH rectangle rotated by rotationDeg -- actually inside
// that rotated rectangle?
function isFrameCovered(
  rotationDeg: number,
  srcHalfW: number,
  srcHalfH: number,
  targetHalfW: number,
  targetHalfH: number,
  offsetPx: { x: number; y: number },
  eps = 1e-6,
): boolean {
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const worldRelSource = { x: sx * targetHalfW + offsetPx.x, y: sy * targetHalfH + offsetPx.y };
      const local = rotateVec(worldRelSource, -rotationDeg);
      if (Math.abs(local.x) > srcHalfW + eps || Math.abs(local.y) > srcHalfH + eps) return false;
    }
  }
  return true;
}

test("normalizeRotationDeg: normalizes into (-180, 180], preserves small negatives", () => {
  assert.equal(normalizeRotationDeg(undefined), 0);
  assert.equal(normalizeRotationDeg(0), 0);
  assert.equal(normalizeRotationDeg(-12.4), -12.4);
  assert.equal(normalizeRotationDeg(17.8), 17.8);
  assert.equal(normalizeRotationDeg(180), 180);
  assert.equal(normalizeRotationDeg(-180), 180);
  assert.equal(normalizeRotationDeg(270), -90);
  assert.equal(normalizeRotationDeg(-270), 90);
  assert.equal(normalizeRotationDeg(360), 0);
  assert.equal(normalizeRotationDeg(725), 5, "725 = 2*360 + 5");
});

test("rotateVec: identity at 0, matches CSS's clockwise-positive convention", () => {
  const v = { x: 1, y: 0 };
  assert.deepEqual(rotateVec(v, 0), { x: 1, y: 0 });
  const r90 = rotateVec(v, 90);
  // "Right" rotated 90 degrees clockwise (screen coords, y-down) becomes
  // "down" -- i.e. (0, 1), matching CSS rotate(90deg) on the same vector.
  assert.ok(Math.abs(r90.x) < 1e-9 && Math.abs(r90.y - 1) < 1e-9);
  // Rotating by -theta then +theta is the identity, at an arbitrary angle.
  const roundTrip = rotateVec(rotateVec({ x: 3, y: -7 }, 37), -37);
  assert.ok(Math.abs(roundTrip.x - 3) < 1e-9 && Math.abs(roundTrip.y + 7) < 1e-9);
});

test("coverBaseScale: matches object-fit:cover's own max(w-ratio, h-ratio)", () => {
  // Landscape source (2000x1000) inside a 4:5 frame -- width-ratio 0.2 vs
  // height-ratio 0.5, so height is the binding axis.
  assert.equal(coverBaseScale(400, 500, 2000, 1000), 500 / 1000);
  // Same source, frame far taller still -- height binds even harder.
  assert.equal(coverBaseScale(400, 5000, 2000, 1000), 5000 / 1000);
  // Portrait source (1000x2000) inside the same 4:5 frame -- now width
  // (0.4) binds over height (0.25).
  assert.equal(coverBaseScale(400, 500, 1000, 2000), 400 / 1000);
});

test("minZoomForCoverage: exactly 1 at rotation 0 and 180, for several unrelated source aspect ratios", () => {
  for (const [naturalW, naturalH] of [
    [1000, 1000],
    [3000, 1000],
    [1000, 3000],
    [1920, 1080],
  ]) {
    assert.ok(Math.abs(minZoomForCoverage(400, 500, naturalW, naturalH, 0) - 1) < 1e-9);
    assert.ok(Math.abs(minZoomForCoverage(400, 500, naturalW, naturalH, 180) - 1) < 1e-9);
  }
});

test("minZoomForCoverage: reduces to the previous fixed 1.25 at 90 degrees when the source already happens to be 4:5", () => {
  // Regression check against the prior (90-degree-only) implementation's
  // own hardcoded constant for a 4:5 frame -- confirms the new continuous
  // formula agrees with the old special case exactly when the source's
  // own aspect ratio equals the frame's.
  const minZ = minZoomForCoverage(400, 500, 800, 1000, 90);
  assert.equal(Math.round(minZ * 100) / 100, 1.25);
});

test("minZoomForCoverage + isFrameCovered: the derived minimum is exactly the tight floor -- covered right at it, NOT covered just below it", () => {
  const cases: Array<[number, number, number, number, number]> = [
    [400, 500, 2000, 3000, 0],
    [400, 500, 2000, 3000, 17],
    [400, 500, 2000, 3000, -23],
    [400, 500, 2000, 3000, 45],
    [400, 500, 3000, 900, 30],
    [400, 500, 900, 3000, 113],
    [400, 500, 1200, 1200, 5],
    [400, 500, 1200, 1200, 271],
    [400, 500, 1200, 1200, 359],
  ];
  for (const [frameW, frameH, naturalW, naturalH, rotationDeg] of cases) {
    const baseScale = coverBaseScale(frameW, frameH, naturalW, naturalH);
    const minZ = minZoomForCoverage(frameW, frameH, naturalW, naturalH, rotationDeg);
    const atMin = isFrameCovered(
      rotationDeg,
      (naturalW * baseScale * minZ) / 2,
      (naturalH * baseScale * minZ) / 2,
      frameW / 2,
      frameH / 2,
      { x: 0, y: 0 },
    );
    const belowMin = isFrameCovered(
      rotationDeg,
      (naturalW * baseScale * minZ * 0.98) / 2,
      (naturalH * baseScale * minZ * 0.98) / 2,
      frameW / 2,
      frameH / 2,
      { x: 0, y: 0 },
    );
    assert.ok(atMin, `expected coverage right at minZoom for rotation ${rotationDeg}`);
    assert.ok(!belowMin, `expected NO coverage 2% under minZoom for rotation ${rotationDeg} (floor would be too loose)`);
  }
});

test("coverageSlackPx + clampOffsetPx: an offset exactly at the derived bound stays covered; one past it gets pulled back to covered", () => {
  const frameW = 400;
  const frameH = 500;
  const naturalW = 1800;
  const naturalH = 2600;
  const rotationDeg = 22;
  const zoom = 1.6; // comfortably above minZoom for this case
  const baseScale = coverBaseScale(frameW, frameH, naturalW, naturalH);
  const w = naturalW * baseScale * zoom;
  const h = naturalH * baseScale * zoom;
  const { slackX, slackY } = coverageSlackPx(rotationDeg, w / 2, h / 2, frameW / 2, frameH / 2);
  assert.ok(slackX > 0 && slackY > 0, "expected real slack to pan into at this zoom");

  // Right at the boundary (in the image's own local/pre-rotation axes),
  // converted back to world pixels -- should still be fully covered.
  const atBoundLocal = { x: slackX, y: -slackY };
  const atBoundWorld = rotateVec(atBoundLocal, rotationDeg);
  assert.ok(isFrameCovered(rotationDeg, w / 2, h / 2, frameW / 2, frameH / 2, atBoundWorld));

  // Well past the boundary -- NOT covered before clamping...
  const tooFarLocal = { x: slackX * 3, y: -slackY * 3 };
  const tooFarWorld = rotateVec(tooFarLocal, rotationDeg);
  assert.ok(!isFrameCovered(rotationDeg, w / 2, h / 2, frameW / 2, frameH / 2, tooFarWorld));

  // ...and covered again once clampOffsetPx pulls it back in.
  const clamped = clampOffsetPx(tooFarWorld, rotationDeg, slackX, slackY);
  assert.ok(isFrameCovered(rotationDeg, w / 2, h / 2, frameW / 2, frameH / 2, clamped));
});

test("clampOffsetPx: a comfortably-inside offset is left completely unchanged (never a needless reset)", () => {
  const inside = { x: 3, y: -4 };
  const clamped = clampOffsetPx(inside, 31, 50, 50);
  assert.ok(Math.abs(clamped.x - inside.x) < 1e-9);
  assert.ok(Math.abs(clamped.y - inside.y) < 1e-9);
});

test("rotating back toward a less-restrictive angle never implies a lower floor than the user's own larger zoom (matches the editor's own no-ratchet-down rule)", () => {
  const frameW = 400;
  const frameH = 500;
  const naturalW = 1800;
  const naturalH = 2600;
  const userZoom = 2.0;
  const minAt90 = minZoomForCoverage(frameW, frameH, naturalW, naturalH, 90);
  const minAt0 = minZoomForCoverage(frameW, frameH, naturalW, naturalH, 0);
  assert.ok(minAt90 >= minAt0, "90 degrees should never require LESS zoom than 0 for a non-square source");
  // The editor's own rule is `next = max(currentZoom, minZoomForRotation(next))`
  // -- simulated here directly against the shared formula.
  const afterRotatingBackTo0 = Math.max(userZoom, minAt0);
  assert.equal(afterRotatingBackTo0, userZoom, "a zoom already above the new (lower) minimum must not be clamped down");
});

// ---------------------------------------------------------------------------
// Landscape source in the portrait 3:4 Grid frame -- the horizontal-pan
// regression. The squash itself was a CSS clamp (see grid-crop-overlay.tsx's
// UNCLAMPED_IMG_SIZE, verified in a real browser by
// grid-crop-render.check.mjs); these pin down the geometry the editor and
// the Grid tile both rely on, simulating the editor's own pan flow exactly:
// stored fraction -> px -> clamp -> stored fraction, zoom untouched.
// ---------------------------------------------------------------------------

const LANDSCAPE = { w: 1600, h: 900 }; // 16:9
const PORTRAIT_FRAME = { w: 300, h: 400 }; // 3:4

// Mirrors GridCropOverlay's handleImagePointerMove + clampStoredOffset.
function panStored(
  frame: { w: number; h: number },
  natural: { w: number; h: number },
  zoom: number,
  startStored: { x: number; y: number },
  dragPx: { x: number; y: number },
) {
  const base = coverBaseScale(frame.w, frame.h, natural.w, natural.h);
  const imgW = natural.w * base;
  const imgH = natural.h * base;
  const raw = { x: startStored.x * imgW + dragPx.x, y: startStored.y * imgH + dragPx.y };
  const { slackX, slackY } = coverageSlackPx(0, (imgW * zoom) / 2, (imgH * zoom) / 2, frame.w / 2, frame.h / 2);
  const px = clampOffsetPx(raw, 0, slackX, slackY);
  return { stored: { x: px.x / imgW, y: px.y / imgH }, px, imgW, imgH, slackX, slackY };
}

// Which part of the SOURCE (in natural-pixel fractions, 0..1) is visible
// through the frame -- the frame-size-independent "what did the user crop"
// answer, used to prove a saved crop reproduces identically at a different
// render size (editor vs Grid tile vs refresh).
function visibleSourceWindow(
  frame: { w: number; h: number },
  natural: { w: number; h: number },
  zoom: number,
  stored: { x: number; y: number },
) {
  const base = coverBaseScale(frame.w, frame.h, natural.w, natural.h);
  const dispW = natural.w * base * zoom;
  const dispH = natural.h * base * zoom;
  const offX = stored.x * natural.w * base;
  const offY = stored.y * natural.h * base;
  // Image center sits at frame center + offset; frame spans +-frame/2.
  const left = (dispW / 2 - offX - frame.w / 2) / dispW;
  const top = (dispH / 2 - offY - frame.h / 2) / dispH;
  return { left, top, width: frame.w / dispW, height: frame.h / dispH };
}

test("landscape in portrait frame: cover scale fills HEIGHT, extra width overflows horizontally, aspect preserved", () => {
  const base = coverBaseScale(PORTRAIT_FRAME.w, PORTRAIT_FRAME.h, LANDSCAPE.w, LANDSCAPE.h);
  const imgW = LANDSCAPE.w * base;
  const imgH = LANDSCAPE.h * base;
  assert.ok(Math.abs(imgH - PORTRAIT_FRAME.h) < 1e-9, "height must exactly fill the frame");
  assert.ok(imgW > PORTRAIT_FRAME.w, "width must extend past the frame");
  assert.ok(Math.abs(imgW / imgH - LANDSCAPE.w / LANDSCAPE.h) < 1e-9, "aspect ratio must be the source's own");
  assert.equal(minZoomForCoverage(PORTRAIT_FRAME.w, PORTRAIT_FRAME.h, LANDSCAPE.w, LANDSCAPE.h, 0), 1);
});

test("landscape in portrait frame: horizontal drag reaches full left and right edges, never exposes empty space", () => {
  const zoom = 1;
  const farLeft = panStored(PORTRAIT_FRAME, LANDSCAPE, zoom, { x: 0, y: 0 }, { x: 10_000, y: 0 });
  const farRight = panStored(PORTRAIT_FRAME, LANDSCAPE, zoom, { x: 0, y: 0 }, { x: -10_000, y: 0 });
  assert.ok(farLeft.slackX > 0, "there must be horizontal room to pan");
  assert.equal(farLeft.px.x, farLeft.slackX, "dragging right is clamped exactly at the left edge of the source");
  assert.equal(farRight.px.x, -farRight.slackX, "dragging left is clamped exactly at the right edge of the source");
  for (const r of [farLeft, farRight]) {
    assert.ok(isFrameCovered(0, r.imgW / 2, r.imgH / 2, PORTRAIT_FRAME.w / 2, PORTRAIT_FRAME.h / 2, r.px));
  }
  const leftWin = visibleSourceWindow(PORTRAIT_FRAME, LANDSCAPE, zoom, farLeft.stored);
  const rightWin = visibleSourceWindow(PORTRAIT_FRAME, LANDSCAPE, zoom, farRight.stored);
  assert.ok(Math.abs(leftWin.left) < 1e-9, "far-left reveals the source's own left edge");
  assert.ok(Math.abs(rightWin.left + rightWin.width - 1) < 1e-9, "far-right reveals the source's own right edge");
});

test("landscape in portrait frame: vertical drag is pinned at zoom 1 (no vertical slack), horizontal still free", () => {
  const r = panStored(PORTRAIT_FRAME, LANDSCAPE, 1, { x: 0, y: 0 }, { x: 40, y: 80 });
  assert.equal(r.px.x, 40);
  assert.equal(r.px.y, 0);
});

test("landscape in portrait frame: dragging never changes zoom, and the visible window keeps the frame's own aspect", () => {
  const zoom = 1.6;
  let stored = { x: 0, y: 0 };
  for (const dx of [-500, 120, 900, -2000, 33]) {
    stored = panStored(PORTRAIT_FRAME, LANDSCAPE, zoom, stored, { x: dx, y: 0 }).stored;
    const win = visibleSourceWindow(PORTRAIT_FRAME, LANDSCAPE, zoom, stored);
    // Visible source region's own pixel aspect == frame aspect -> no stretch.
    const aspect = (win.width * LANDSCAPE.w) / (win.height * LANDSCAPE.h);
    assert.ok(Math.abs(aspect - PORTRAIT_FRAME.w / PORTRAIT_FRAME.h) < 1e-9, `aspect drifted to ${aspect}`);
    // Width of the visible window depends only on zoom -- unchanged by pans.
    assert.ok(Math.abs(win.width - PORTRAIT_FRAME.w / (LANDSCAPE.w * coverBaseScale(PORTRAIT_FRAME.w, PORTRAIT_FRAME.h, LANDSCAPE.w, LANDSCAPE.h) * zoom)) < 1e-12);
    assert.ok(win.left >= -1e-9 && win.left + win.width <= 1 + 1e-9, "visible window left the source (empty space)");
  }
});

test("saved crop reproduces the identical source window at a different render size (editor -> Grid tile / refresh)", () => {
  const zoom = 1.25;
  const saved = panStored(PORTRAIT_FRAME, LANDSCAPE, zoom, { x: 0, y: 0 }, { x: -140, y: 30 }).stored;
  const inEditor = visibleSourceWindow(PORTRAIT_FRAME, LANDSCAPE, zoom, saved);
  for (const tile of [{ w: 150, h: 200 }, { w: 90, h: 120 }, { w: 1080, h: 1440 }]) {
    const onTile = visibleSourceWindow(tile, LANDSCAPE, zoom, saved);
    for (const k of ["left", "top", "width", "height"] as const) {
      assert.ok(Math.abs(onTile[k] - inEditor[k]) < 1e-9, `${k} differs at ${tile.w}x${tile.h}`);
    }
  }
});

test("portrait and square sources: existing behavior -- width fills, vertical pan only (portrait), no pan at zoom 1 (square in square)", () => {
  const portrait = { w: 900, h: 1600 };
  const p = panStored(PORTRAIT_FRAME, portrait, 1, { x: 0, y: 0 }, { x: 50, y: 10_000 });
  assert.equal(p.px.x, 0, "portrait source taller than 3:4 has no horizontal slack at zoom 1");
  assert.ok(p.px.y > 0 && p.px.y === p.slackY, "vertical pan clamps at the source's top edge");
  assert.ok(isFrameCovered(0, p.imgW / 2, p.imgH / 2, PORTRAIT_FRAME.w / 2, PORTRAIT_FRAME.h / 2, p.px));

  const square = { w: 1000, h: 1000 };
  const sq = panStored({ w: 300, h: 300 }, square, 1, { x: 0, y: 0 }, { x: 80, y: -80 });
  assert.deepEqual(sq.px, { x: 0, y: 0 });
  const sqZoomed = panStored({ w: 300, h: 300 }, square, 2, { x: 0, y: 0 }, { x: 80, y: -80 });
  assert.deepEqual(sqZoomed.px, { x: 80, y: -80 }, "square zoomed in pans freely within bounds");
});

console.log(`\n${passed} passed`);
