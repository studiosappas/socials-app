"use client";

import JSZip from "jszip";
import { saveAs } from "file-saver";

export type ZipAsset = { url: string; filename: string };

// Fetches each asset's exact bytes (no client-side re-encoding) and packs them into
// a single zip, so downloads stay byte-identical to the originally uploaded files.
export async function downloadAssetsAsZip(assets: ZipAsset[], zipName: string) {
  if (assets.length === 0) return;

  const zip = new JSZip();
  const usedNames = new Set<string>();

  await Promise.all(
    assets.map(async (asset) => {
      const response = await fetch(asset.url);
      if (!response.ok) return;
      const blob = await response.blob();

      let name = asset.filename;
      let suffix = 2;
      while (usedNames.has(name)) {
        const dot = asset.filename.lastIndexOf(".");
        name =
          dot === -1
            ? `${asset.filename}-${suffix}`
            : `${asset.filename.slice(0, dot)}-${suffix}${asset.filename.slice(dot)}`;
        suffix += 1;
      }
      usedNames.add(name);
      zip.file(name, blob);
    }),
  );

  const zipBlob = await zip.generateAsync({ type: "blob" });
  saveAs(zipBlob, zipName);
}

// Same fetch-then-saveAs approach as the zip path above, for a single file --
// a plain <a download> often just navigates instead of downloading for
// cross-origin storage URLs without the right Content-Disposition header, so
// this fetches the real bytes and hands them to file-saver directly.
export async function downloadAsset(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) return;
  const blob = await response.blob();
  saveAs(blob, filename);
}

// Derives a filename from a signed/public asset URL's path (media_assets doesn't
// store the original upload's filename, so this falls back to the storage path's
// own basename — still stable and collision-safe, just not the original name).
export function filenameFromUrl(url: string, fallback: string) {
  try {
    const basename = new URL(url).pathname.split("/").pop();
    return basename ? decodeURIComponent(basename) : fallback;
  } catch {
    return fallback;
  }
}

const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

function mimeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[ext] ?? "application/octet-stream";
}

// Feature-detected only -- never sniffs the user agent. `navigator.share`
// exists on some desktop browsers too, which is exactly why callers must
// ALSO gate this on their own isTouchDevice signal (see
// use-is-touch-device.ts, already used elsewhere in this codebase for the
// identical "don't treat a capability as identical to a form factor"
// reason) before treating a positive result here as "show the share sheet"
// -- this function alone answers "can these files legitimately be shared,"
// not "should we prefer sharing over downloading on this device."
export async function canShareFiles(files: File[]): Promise<boolean> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
    return false;
  }
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

async function fetchAsFile(url: string, filename: string): Promise<File> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || mimeFromFilename(filename) });
}

// The mobile-preferred path for a single image: fetches the real bytes
// (same as downloadAsset -- exact MIME, real filename, no thumbnail
// substitution) and hands them to the OS's native share sheet via Web
// Share API Level 2 (`navigator.share({files})`), which is what lets the
// user reach the platform's own "Save Image"/"Save to Photos" action --
// no web API can write into the Photos library directly, this is the
// legitimate way to get there. Falls back to the existing plain download
// (downloadAsset) whenever sharing isn't available, isn't supported for
// this file, or fails for any reason other than the user dismissing the
// share sheet themselves -- download must never be left completely broken
// on a browser that doesn't support file sharing.
export async function shareOrDownloadAsset(url: string, filename: string, preferShare: boolean) {
  if (preferShare) {
    try {
      const file = await fetchAsFile(url, filename);
      if (await canShareFiles([file])) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (error) {
      // The user closing the share sheet themselves is not a failure --
      // falling back to a second, confusing download prompt right after
      // they explicitly dismissed the first one would be worse than doing
      // nothing.
      if (error instanceof DOMException && error.name === "AbortError") return;
      // Any other failure (network, mid-flight unsupported, etc.) falls
      // through to the plain download below instead.
    }
  }
  await downloadAsset(url, filename);
}

// The mobile-preferred path for a whole post's worth of images. A single-
// asset post never zips at all, on any device -- see shareOrDownloadAsset.
// For multiple assets: one native share call offering every file at once
// where the browser/OS supports multi-file Web Share (deliberately not
// one share call per file, which on iOS pops a separate share sheet per
// image -- worse than a single zip); falls back to the existing zip
// download otherwise, exactly as before this existed. `alreadyZipped` lets
// a caller that already has the export as one blob (Post Editor's
// server-composited, crop-applied export) hand it in directly instead of
// this function re-fetching each asset's raw bytes -- see post-editor.tsx's
// own call site for why that matters (the zip contains the CROPPED
// export, not the originals).
export async function shareOrDownloadZipEntries(
  zipBlob: Blob,
  entries: { filename: string; blob: Blob }[],
  zipName: string,
  preferShare: boolean,
) {
  if (entries.length === 1) {
    const only = entries[0];
    if (preferShare) {
      try {
        const file = new File([only.blob], only.filename, { type: only.blob.type || mimeFromFilename(only.filename) });
        if (await canShareFiles([file])) {
          await navigator.share({ files: [file] });
          return;
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    saveAs(only.blob, only.filename);
    return;
  }
  if (preferShare) {
    try {
      const files = entries.map(
        (e) => new File([e.blob], e.filename, { type: e.blob.type || mimeFromFilename(e.filename) }),
      );
      if (await canShareFiles(files)) {
        await navigator.share({ files });
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  saveAs(zipBlob, zipName);
}
