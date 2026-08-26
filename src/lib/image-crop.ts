import sharp, { type Sharp } from "sharp";

// rotation: degrees, one of 0/90/180/270 (see grid-crop-overlay.tsx for
// why rotation is restricted to these four values rather than free/
// arbitrary angles). Optional, defaults to 0 -- a transform saved before
// rotation existed has no `rotation` key and must keep producing an
// identical export.
export type CoverTransform = { scale: number; x: number; y: number; rotation?: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRotation(rotation: number | undefined): 0 | 90 | 180 | 270 {
  const r = ((rotation ?? 0) % 360 + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

// Reproduces the on-screen CSS crop exactly (coverTransformStyle in
// grid-crop-overlay.tsx: a w-full h-full object-cover <img>, with an
// additional `translate(x*100%, y*100%) scale(scale)` layered on top) as a
// sharp extract+resize -- the one shared implementation every server-side
// image-compositing surface (Grid's PNG export, PDF export, per-post
// download) uses instead of each reimplementing its own blind centered
// "fit:cover" that silently ignores whatever the user actually panned/
// zoomed to. When transform is null (never manually cropped), this reduces
// to plain center-cover -- no change for posts nobody has cropped.
// targetW/targetH only ever set the crop's ASPECT RATIO (4:5 cover, 3:4
// slide) -- they're never the original's real resolution, so cropW/cropH
// below are computed in the source image's own native pixels regardless of
// what targetW/targetH are. Returns an unfinished sharp pipeline so each
// caller can apply its own final format (raw pixels for compositing, jpeg
// for a standalone file).
export async function applyCoverTransform(
  buffer: Buffer,
  transform: CoverTransform | null,
  targetW: number,
  targetH: number,
  options?: {
    // Skip the final resize-to-targetW/targetH and return the extracted
    // crop at its own native pixel size instead -- cropW/cropH already
    // carry the exact same aspect ratio as targetW/targetH (see below), so
    // this changes nothing about what's visually framed, only how many
    // pixels it's rendered at. Only "Download Media" (posts/[postId]/
    // export) sets this -- Grid's composite exports (full-feed JPG, PDF)
    // genuinely need every cell/thumb at the same fixed size to lay out
    // correctly, so they leave this off and keep today's behavior exactly.
    nativeResolution?: boolean;
  },
): Promise<Sharp> {
  if (!transform) {
    return sharp(buffer).resize(targetW, targetH, { fit: "cover", position: "centre" });
  }

  // Physically rotate the pixels FIRST, into their own buffer, before any
  // of the existing cover-fit/crop math runs -- for a 90/180/270 rotation
  // sharp does this losslessly (no interpolation, dimensions cleanly
  // swap at 90/270), so everything below can stay completely unaware that
  // a rotation happened at all: it just operates on "the source image,"
  // which happens to already be in its rotated orientation. This mirrors
  // the client CSS side exactly (grid-crop-overlay.tsx applies `rotate()`
  // as the outermost transform around the same scale/translate this
  // reproduces), so a given transform produces the same crop server-side
  // as it visually showed in the editor.
  const rotation = normalizeRotation(transform.rotation);
  const rotatedBuffer = rotation !== 0 ? await sharp(buffer).rotate(rotation).toBuffer() : buffer;

  const { width: naturalW, height: naturalH } = await sharp(rotatedBuffer).metadata();
  if (!naturalW || !naturalH) {
    return sharp(buffer).resize(targetW, targetH, { fit: "cover", position: "centre" });
  }

  const coverFitScale = Math.max(targetW / naturalW, targetH / naturalH); // same as CSS object-fit:cover
  const totalScale = coverFitScale * transform.scale;
  // Native-pixel size of the crop window -- clamped to naturalW/naturalH,
  // so this can never exceed (and therefore never needs to upscale beyond)
  // the source's own actual resolution.
  const cropW = clamp(targetW / totalScale, 1, naturalW);
  const cropH = clamp(targetH / totalScale, 1, naturalH);
  // transform.x/y are fractions of the tile's own box (see
  // coverTransformStyle) -- convert the resulting on-screen pixel pan back
  // into source-image pixels, then shift the crop window the OPPOSITE
  // direction (panning the image right is equivalent to moving the crop
  // window left in source-image space).
  const panX = (transform.x * targetW) / totalScale;
  const panY = (transform.y * targetH) / totalScale;
  const cropLeft = clamp(Math.round(naturalW / 2 - cropW / 2 - panX), 0, naturalW - cropW);
  const cropTop = clamp(Math.round(naturalH / 2 - cropH / 2 - panY), 0, naturalH - cropH);

  const extracted = sharp(rotatedBuffer).extract({
    left: cropLeft,
    top: cropTop,
    width: Math.round(cropW),
    height: Math.round(cropH),
  });

  return options?.nativeResolution ? extracted : extracted.resize(targetW, targetH, { fit: "fill" });
}
