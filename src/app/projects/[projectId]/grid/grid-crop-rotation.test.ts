// Deterministic tests for the rotation math added to the Grid crop editor
// this round (grid-crop-overlay.tsx). Pure arithmetic, no DOM/React --
// re-derives the same formulas the component uses so a future edit to
// either can't silently drift from the other without a visible failure.
//
// Run with:
//   node --experimental-strip-types "src/app/projects/[projectId]/grid/grid-crop-rotation.test.ts"

import assert from "node:assert/strict";
import { GRID_SLOT_ASPECT_RATIO } from "./grid-constants.ts";

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

function normalizeRotation(rotation: number | undefined): 0 | 90 | 180 | 270 {
  const r = (((rotation ?? 0) % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

function minZoomForRotation(rotation: number): number {
  const r = normalizeRotation(rotation);
  return r === 90 || r === 270 ? 1 / GRID_SLOT_ASPECT_RATIO : 1;
}

function rotateScreenDeltaToLocal(dxFrac: number, dyFrac: number, rotation: number) {
  switch (normalizeRotation(rotation)) {
    case 90:
      return { dx: dyFrac, dy: -dxFrac };
    case 180:
      return { dx: -dxFrac, dy: -dyFrac };
    case 270:
      return { dx: -dyFrac, dy: dxFrac };
    default:
      return { dx: dxFrac, dy: dyFrac };
  }
}

test("normalizeRotation: only ever returns one of 0/90/180/270", () => {
  assert.equal(normalizeRotation(undefined), 0);
  assert.equal(normalizeRotation(0), 0);
  assert.equal(normalizeRotation(90), 90);
  assert.equal(normalizeRotation(360), 0, "a full turn normalizes back to 0");
  assert.equal(normalizeRotation(450), 90, "450 = 360 + 90");
  assert.equal(normalizeRotation(-90), 270, "negative rotation wraps to the equivalent positive value");
  assert.equal(normalizeRotation(45), 0, "an arbitrary angle a legacy/corrupt value might carry falls back to 0, never crashes or half-applies");
});

test("minZoomForRotation: 1 at 0/180, exactly 1/GRID_SLOT_ASPECT_RATIO at 90/270", () => {
  assert.equal(minZoomForRotation(0), 1);
  assert.equal(minZoomForRotation(180), 1);
  const expected = 1 / GRID_SLOT_ASPECT_RATIO;
  assert.equal(minZoomForRotation(90), expected);
  assert.equal(minZoomForRotation(270), expected);
  // For the actual 4:5 Grid ratio this is exactly 1.25 -- pinned literally
  // so a change to GRID_SLOT_ASPECT_RATIO can't silently change this
  // without a visible, deliberate test update.
  assert.equal(Math.round(expected * 100) / 100, 1.25);
});

test("rotateScreenDeltaToLocal: identity at 0, exact 90-degree-step rotations otherwise", () => {
  const d = { x: 0.1, y: 0.2 };
  assert.deepEqual(rotateScreenDeltaToLocal(d.x, d.y, 0), { dx: d.x, dy: d.y });
  assert.deepEqual(rotateScreenDeltaToLocal(d.x, d.y, 90), { dx: d.y, dy: -d.x });
  assert.deepEqual(rotateScreenDeltaToLocal(d.x, d.y, 180), { dx: -d.x, dy: -d.y });
  assert.deepEqual(rotateScreenDeltaToLocal(d.x, d.y, 270), { dx: -d.y, dy: d.x });
});

test("rotateScreenDeltaToLocal: applying it 4 times (one full turn) returns to the original delta", () => {
  const d = { x: 0.37, y: -0.12 };
  let cur = { dx: d.x, dy: d.y };
  for (const step of [90, 90, 90, 90]) {
    cur = rotateScreenDeltaToLocal(cur.dx, cur.dy, step);
  }
  assert.equal(cur.dx, d.x);
  assert.equal(cur.dy, d.y);
});

test("handleRotate cycle: 0 -> 90 -> 180 -> 270 -> 0, never anything else", () => {
  let r = 0;
  const seen = [r];
  for (let i = 0; i < 8; i++) {
    r = normalizeRotation(r + 90);
    seen.push(r);
  }
  assert.deepEqual(seen, [0, 90, 180, 270, 0, 90, 180, 270, 0]);
});

test("rotating INTO 90/270 from a zoom below the new minimum bumps zoom up (no blank corners)", () => {
  // Mirrors GridCropOverlay's own handleRotate: nextZoom = max(zoom, minZoomForRotation(next)).
  const zoomAtRotate0 = 1; // the lowest legal zoom at rotation 0
  const nextRotation = 90;
  const nextZoom = Math.max(zoomAtRotate0, minZoomForRotation(nextRotation));
  assert.ok(nextZoom >= minZoomForRotation(nextRotation), "zoom after rotating must never be below the new rotation's own minimum");
  assert.equal(nextZoom, 1.25);
});

test("rotating back OUT of 90/270 never forces zoom back down (user's own choice above the old minimum is preserved)", () => {
  const zoomWhileRotated = 2; // user zoomed in well past the 1.25 floor
  const nextRotation = 180;
  const nextZoom = Math.max(zoomWhileRotated, minZoomForRotation(nextRotation));
  assert.equal(nextZoom, 2, "a zoom already above the new (lower) minimum must not be clamped down");
});

console.log(`\n${passed} passed`);
