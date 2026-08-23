"use client";

// Grabs a page-1 render for use as a Content-grid-safe cover image, entirely
// client-side (pdf.js decodes + rasterizes into an offscreen <canvas>, never
// uploaded or rendered as a live PDF), mirroring video-poster.ts's own
// capture pipeline for the exact same reason: the Content card is a plain
// <img>, which can never decode a raw PDF file directly.
//
// No existing PDF-rendering utility exists in this codebase to reuse --
// pdf-lib (already a dependency, used by Grid's PDF *export*) only writes/
// manipulates PDF documents, it has no page-rasterization capability at
// all. pdf.js (Mozilla's renderer, what every browser's own built-in PDF
// viewer is built on) is the standard, well-supported choice for this.
const MAX_DIMENSION = 720;
const JPEG_QUALITY = 0.85;

let workerConfigured = false;

async function loadPdfJs() {
  const pdfjsLib = await import("pdfjs-dist");
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    workerConfigured = true;
  }
  return pdfjsLib;
}

export async function generatePdfCoverBlob(file: File): Promise<Blob | null> {
  try {
    const pdfjsLib = await loadPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    // getDocument + getPage(1) only -- a multi-page PDF's other pages are
    // never touched, decoded, or rendered just to produce this one cover.
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);

    const baseViewport = page.getViewport({ scale: 1 });
    const scale = MAX_DIMENSION / Math.max(baseViewport.width, baseViewport.height);
    const viewport = page.getViewport({ scale: Math.min(scale, 1) || 1 });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      await loadingTask.destroy();
      return null;
    }

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    await loadingTask.destroy();

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", JPEG_QUALITY);
    });
  } catch (error) {
    // Best-effort, same as generateImageThumbnailBlob's own console.warn --
    // the caller always falls back to "no cover yet" rather than failing
    // the whole upload (see uploadFilesWithPosters/uploadPosterIfPresent).
    console.warn(
      `[pdf-cover] page-1 render failed for "${file.name}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
