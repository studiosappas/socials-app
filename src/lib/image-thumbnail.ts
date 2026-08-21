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
    function finish(blob: Blob | null) {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      URL.revokeObjectURL(objectUrl);
      resolve(blob);
    }

    // Same fail-closed reasoning as video-poster.ts's own hard timeout --
    // never hang the upload if decoding stalls for some reason.
    const hardTimeout = setTimeout(() => finish(null), 8000);

    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      if (!w || !h) {
        finish(null);
        return;
      }
      const scale = Math.min(1, MAX_DIMENSION / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        finish(null);
        return;
      }
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob), "image/jpeg", JPEG_QUALITY);
      } catch {
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = objectUrl;
  });
}
