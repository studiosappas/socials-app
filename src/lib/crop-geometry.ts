// Pure geometry helpers shared between the client crop editor
// (grid/grid-crop-overlay.tsx) and the server-side export pipeline
// (lib/image-crop.ts) -- kept in ONE module specifically so the two can
// never independently drift apart on the "does this rotated image still
// fully cover the output frame" math, which is easy to get subtly wrong
// twice. No DOM, no sharp -- safe to import from either a client
// component or server-only code.
//
// Model: an axis-aligned FRAME (the fixed output viewport) and a SOURCE
// image rectangle, rotated by an arbitrary angle around a shared center,
// offset from that center by a pan vector. The two call sites assign the
// "source" and "target" roles differently:
//  - the client scales the source image up (zoom) and keeps the frame at
//    a fixed viewport pixel size -- source = scaled image, target = frame.
//  - the server keeps the source image at its native pixel resolution and
//    shrinks the EXTRACTION WINDOW as zoom increases -- source = native
//    image, target = crop window.
// The underlying "does a smaller axis-aligned rectangle, centered inside
// a bigger one rotated by theta, stay fully covered" math is identical
// either way, which is exactly why it lives here once instead of twice.

export function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Normalizes to (-180, 180] -- keeps small negative angles small (-12.4
// stays -12.4, not 347.6), matching how a user actually thinks about
// "rotate it slightly counter-clockwise."
export function normalizeRotationDeg(rotation: number | undefined): number {
  let r = (rotation ?? 0) % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return r;
}

// Rotates a vector by `deg`, using the same clockwise-positive convention
// as CSS's rotate() (screen coordinates, y-down) -- so this can be used
// directly against on-screen pixel deltas with no sign correction.
export function rotateVec(v: { x: number; y: number }, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

// The scale that makes a naturalW x naturalH source exactly cover a
// frameW x frameH box at rotation 0 -- CSS object-fit: cover's own
// formula, and the baseline every zoom multiplier builds on.
export function coverBaseScale(frameW: number, frameH: number, naturalW: number, naturalH: number): number {
  return Math.max(frameW / naturalW, frameH / naturalH);
}

// How much "slack" (per axis, in the SOURCE rectangle's own pre-rotation
// coordinate space) is left once a smaller axis-aligned target rectangle
// is centered inside a bigger rectangle rotated by rotationDeg. Zero or
// negative on either axis means no valid centered position exists yet --
// callers must raise scale until both are >= 0 before trusting the pan
// bounds derived from this.
//
// Derivation: a point is inside the rotated source rect iff rotating it
// by -rotationDeg lands inside the source's own axis-aligned half-extent
// box. Applying that to all 4 corners of the (axis-aligned) target rect
// and taking the extreme corner in each axis gives exactly the a/b terms
// below -- this is the standard "rotated-rectangle-covers-rectangle"
// condition (the algebraic dual of the well-known rotated-bounding-box
// formula: rotatedW = |w cos| + |h sin|).
export function coverageSlackPx(
  rotationDeg: number,
  srcHalfW: number,
  srcHalfH: number,
  targetHalfW: number,
  targetHalfH: number,
): { slackX: number; slackY: number } {
  const theta = (rotationDeg * Math.PI) / 180;
  const cosA = Math.abs(Math.cos(theta));
  const sinA = Math.abs(Math.sin(theta));
  const a = targetHalfW * cosA + targetHalfH * sinA;
  const b = targetHalfW * sinA + targetHalfH * cosA;
  return { slackX: srcHalfW - a, slackY: srcHalfH - b };
}

// The minimum zoom multiplier (applied on top of coverBaseScale) that
// keeps a naturalW x naturalH source fully covering a frameW x frameH
// frame at the given rotation -- the zoom at which coverageSlackPx's own
// a/b terms exactly equal the (scaled) source's half-extents, i.e. slack
// is exactly zero. At rotation 0/180 this is always exactly 1 (baseScale
// alone already covers the frame); away from those it only ever
// increases, and does so continuously (no 90-degree-step discontinuity).
export function minZoomForCoverage(
  frameW: number,
  frameH: number,
  naturalW: number,
  naturalH: number,
  rotationDeg: number,
): number {
  const baseScale = coverBaseScale(frameW, frameH, naturalW, naturalH);
  const theta = (rotationDeg * Math.PI) / 180;
  const cosA = Math.abs(Math.cos(theta));
  const sinA = Math.abs(Math.sin(theta));
  const a = (frameW / 2) * cosA + (frameH / 2) * sinA;
  const b = (frameW / 2) * sinA + (frameH / 2) * cosA;
  const minZoomX = (2 * a) / (naturalW * baseScale);
  const minZoomY = (2 * b) / (naturalH * baseScale);
  return Math.max(minZoomX, minZoomY);
}

// Clamps a pan offset (the target rectangle's center, expressed relative
// to the rotated source rectangle's own center, in whatever pixel space
// both are measured in) so the target never extends past the source's
// actually-covered region. slackX/slackY come from coverageSlackPx --
// clamped to >= 0 here defensively, since a caller working from stale or
// foreign data might pass a rotation/zoom combo that hasn't itself been
// raised to the coverage floor yet.
export function clampOffsetPx(
  offsetPx: { x: number; y: number },
  rotationDeg: number,
  slackX: number,
  slackY: number,
): { x: number; y: number } {
  const boundX = Math.max(0, slackX);
  const boundY = Math.max(0, slackY);
  const local = rotateVec(offsetPx, -rotationDeg);
  const clampedLocal = { x: clampNum(local.x, -boundX, boundX), y: clampNum(local.y, -boundY, boundY) };
  return rotateVec(clampedLocal, rotationDeg);
}
