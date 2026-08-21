"use client";

// Generates a small on-screen thumbnail entirely client-side (an offscreen
// <img> + <canvas>, mirroring video-poster.ts's own capture pipeline) --
// Grid/Media Library used to render every tile from the full original
// upload, which meant downloading a full-size (now up to 50MB) file just to
// show a small tile. Scaled to fit within maxDimension on its longest side,
// preserving aspect ratio; never upscales a smaller original.
const MAX_DIMENSION = 480;
const JPEG_QUALITY = 0.82;

export function generateImageThumbnailBlob(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    let settled = false;
    // Logged (not surfaced to the user -- this path already falls back to a
    // guaranteed server-side sharp render, see server-thumbnail.ts) so the
    // actual reason is visible in the browser console instead of a plain
    // "no thumbnail, no explanation" -- this is what let a 100%-silent
    // failure rate go unnoticed for every HEIC/HEIF photo (iPhone's default
    // camera format, which desktop Chrome/Firefox/Edge can't decode into an
    // <img> at all) uploaded through this pipeline.
    function finish(blob: Blob | null, failureReason?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      URL.revokeObjectURL(objectUrl);
      if (!blob && failureReason) {
        console.warn(`[thumbnail] client-side generation failed for "${file.name}" (${file.type || "unknown type"}): ${failureReason}`);
      }
      resolve(blob);
    }

    // Same fail-closed reasoning as video-poster.ts's own hard timeout --
    // never hang the upload if decoding stalls for some reason.
    const hardTimeout = setTimeout(() => finish(null, "timed out after 8s"), 8000);

    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      if (!w || !h) {
        finish(null, "decoded with zero width/height");
        return;
      }
      const scale = Math.min(1, MAX_DIMENSION / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        finish(null, "2d canvas context unavailable");
        return;
      }
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob, blob ? undefined : "canvas.toBlob returned null"), "image/jpeg", JPEG_QUALITY);
      } catch (err) {
        finish(null, err instanceof Error ? err.message : "drawImage/toBlob threw");
      }
    };
    // The most common real-world case: the browser's <img> decoder doesn't
    // support this file's format at all (HEIC/HEIF straight off an iPhone
    // camera, some RAW/TIFF variants) -- upload of the raw bytes still
    // succeeds via uploadFileDirect regardless, since that never decodes
    // the file, only transports it.
    img.onerror = () => finish(null, "browser could not decode this file as an image (unsupported format?)");
    img.src = objectUrl;
  });
}
