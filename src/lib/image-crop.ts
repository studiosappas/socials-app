import sharp, { type Sharp } from "sharp";

export type CoverTransform = { scale: number; x: number; y: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// Reproduces the on-screen CSS crop exactly (coverTransformStyle in
// grid-crop-overlay.tsx: a w-full h-full object-cover <img>, with an
// additional `translate(x*100%, y*100%) scale(scale)` layered on top) as a
// sharp extract+resize -- the one shared implementation every server-side
// image-compositing surface (Grid's PNG export, PDF export, per-post
// download) uses instead of each reimplementing its own blind centered
// "fit:cover" that silently ignores whatever the user actually panned/
// zoomed to. When transform is null (never manually cropped), this reduces
// to plain center-cover -- no change for posts nobody has cropped. Returns
// an unfinished sharp pipeline so each caller can apply its own final
// format (raw pixels for compositing, jpeg for a standalone file).
export async function applyCoverTransform(
  buffer: Buffer,
  transform: CoverTransform | null,
  targetW: number,
  targetH: number,
): Promise<Sharp> {
  if (!transform) {
    return sharp(buffer).resize(targetW, targetH, { fit: "cover", position: "centre" });
  }

  const { width: naturalW, height: naturalH } = await sharp(buffer).metadata();
  if (!naturalW || !naturalH) {
    return sharp(buffer).resize(targetW, targetH, { fit: "cover", position: "centre" });
  }

  const coverFitScale = Math.max(targetW / naturalW, targetH / naturalH); // same as CSS object-fit:cover
  const totalScale = coverFitScale * transform.scale;
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

  return sharp(buffer)
    .extract({ left: cropLeft, top: cropTop, width: Math.round(cropW), height: Math.round(cropH) })
    .resize(targetW, targetH, { fit: "fill" });
}
