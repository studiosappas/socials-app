import sharp, { type Sharp } from "sharp";
import {
  clampNum,
  clampOffsetPx,
  coverBaseScale,
  coverageSlackPx,
  minZoomForCoverage,
  normalizeRotationDeg,
} from "./crop-geometry";

// rotation: an arbitrary degree value (freeform, not quantized) -- see
// grid-crop-overlay.tsx for the client-side editor this mirrors. Optional,
// defaults to 0 -- a transform saved before rotation existed has no
// `rotation` key and must keep producing an identical export.
//
// x/y: the pan offset, stored as a fraction of the image's OWN
// base-cover-fit size (naturalW*baseScale, naturalH*baseScale) -- NOT a
// fraction of the frame, and NOT scaled by `scale`. This is what lets the
// exact same stored transform be applied at any frame pixel size (a small
// Grid thumbnail, a 1080px export, a 360px PDF cell) and reproduce
// identical framing: baseScale is recomputed fresh at whatever resolution
// is being rendered, so the normalization "undoes" itself consistently at
// every call site. See grid-crop-overlay.tsx's own header comment for the
// full derivation and why this unit was chosen over "fraction of frame".
export type CoverTransform = { scale: number; x: number; y: number; rotation?: number };

// Reproduces the on-screen crop editor exactly (grid-crop-overlay.tsx) as
// a sharp rotate + resize + extract -- the one shared implementation every
// server-side image-compositing surface (Grid's PNG export, PDF export,
// per-post download) uses instead of each reimplementing its own blind
// centered "fit:cover" that silently ignores whatever the user actually
// panned/zoomed/rotated to. When transform is null (never manually
// cropped), this reduces to plain center-cover -- no change for posts
// nobody has cropped.
//
// targetW/targetH only ever set the crop's ASPECT RATIO (4:5 cover, 3:4
// slide) -- they're never the original's real resolution, so the
// extraction below happens in the source image's own native pixels
// regardless of what targetW/targetH are. Returns an unfinished sharp
// pipeline so each caller can apply its own final format (raw pixels for
// compositing, jpeg for a standalone file).
export async function applyCoverTransform(
  buffer: Buffer,
  transform: CoverTransform | null,
  targetW: number,
  targetH: number,
  options?: {
    // Skip the final resize-to-targetW/targetH and return the extracted
    // crop at its own native pixel size instead -- only "Download Media"
    // (posts/[postId]/export) sets this; Grid's composite exports (full-
    // feed JPG, PDF) genuinely need every cell/thumb at the same fixed
    // size to lay out correctly, so they leave this off.
    nativeResolution?: boolean;
  },
): Promise<Sharp> {
  if (!transform) {
    return sharp(buffer).resize(targetW, targetH, { fit: "cover", position: "centre" });
  }

  const { width: naturalW, height: naturalH } = await sharp(buffer).metadata();
  if (!naturalW || !naturalH) {
    return sharp(buffer).resize(targetW, targetH, { fit: "cover", position: "centre" });
  }

  const rotation = normalizeRotationDeg(transform.rotation);
  const baseScale = coverBaseScale(targetW, targetH, naturalW, naturalH);
  // Never allow a stored/foreign scale below what THIS rotation requires
  // to keep the frame fully covered -- the same defensive floor the
  // client editor applies, so no combination of saved data can ever
  // produce a blank/transparent corner in an export.
  const zoom = Math.max(transform.scale, minZoomForCoverage(targetW, targetH, naturalW, naturalH, rotation));
  const totalScale = baseScale * zoom;

  // Physically rotate the pixels FIRST, into their own (auto-expanded)
  // buffer -- sharp pads the canvas out to the rotated rectangle's exact
  // bounding box and centers the original content within it. Scaling that
  // rotated result by totalScale afterward produces IDENTICAL geometry to
  // "scale the source, then rotate it" (the client CSS's own order,
  // scale -> rotate -> translate): uniform scale commutes with rotation,
  // so it doesn't matter which happens first, only that both sides apply
  // the same net scale and the same rotation angle.
  const rotatedBuffer =
    rotation !== 0
      ? await sharp(buffer)
          .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .toBuffer()
      : buffer;
  const rotatedMeta = rotation !== 0 ? await sharp(rotatedBuffer).metadata() : { width: naturalW, height: naturalH };
  const rotW = rotatedMeta.width ?? naturalW;
  const rotH = rotatedMeta.height ?? naturalH;

  // Native-pixel size of the crop window within the rotated buffer --
  // clamped to rotW/rotH so this can never exceed the rotated buffer's own
  // extent (that outer clamp is a final safety net; the coverage-slack
  // clamp on the pan below is what actually keeps this inside the real
  // (non-padded) rotated content).
  const cropW = clampNum(targetW / totalScale, 1, rotW);
  const cropH = clampNum(targetH / totalScale, 1, rotH);

  // transform.x/y are fractions of the image's own base-cover-fit size
  // (see this file's CoverTransform comment) -- convert to a pixel pan in
  // this render's own "frame scale" (matching targetW/targetH), then into
  // the rotated buffer's native pixels by dividing out totalScale (the
  // same scale-commutes-with-rotation reasoning as above).
  const panWorld = { x: transform.x * naturalW * baseScale, y: transform.y * naturalH * baseScale };
  const panNativeRaw = { x: panWorld.x / totalScale, y: panWorld.y / totalScale };

  // Clamp the pan so the extraction window can never sample the rotated
  // buffer's padded/transparent corners -- source = the actual rotated
  // photo content (native naturalW x naturalH, unscaled), target = the
  // crop window (cropW x cropH). Mirrors grid-crop-overlay.tsx's own
  // pan-bounds clamp exactly, just with source/target roles swapped
  // (there the image is scaled and the frame is fixed; here the image
  // stays native and the window shrinks with zoom).
  const { slackX, slackY } = coverageSlackPx(rotation, naturalW / 2, naturalH / 2, cropW / 2, cropH / 2);
  const panNative = clampOffsetPx(panNativeRaw, rotation, slackX, slackY);

  // The crop window's center sits at the rotated buffer's own center,
  // offset OPPOSITE the pan (panning the image right is equivalent to
  // moving the crop window left in source-image space).
  const cropLeft = clampNum(Math.round(rotW / 2 - cropW / 2 - panNative.x), 0, Math.max(0, rotW - cropW));
  const cropTop = clampNum(Math.round(rotH / 2 - cropH / 2 - panNative.y), 0, Math.max(0, rotH - cropH));

  const extracted = sharp(rotatedBuffer).extract({
    left: cropLeft,
    top: cropTop,
    width: Math.round(cropW),
    height: Math.round(cropH),
  });

  return options?.nativeResolution ? extracted : extracted.resize(targetW, targetH, { fit: "fill" });
}
