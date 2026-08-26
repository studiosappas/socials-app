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

function mimeFromExtension(filename: string): string | undefined {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[ext];
}

// Storage responses can legitimately come back with a generic/wrong
// Content-Type (`application/octet-stream` is a common default for a
// storage-bucket object whose metadata wasn't set precisely) -- fetch()'s
// resulting blob.type reflects that HEADER verbatim, not the file's real
// content. Web Share's own `canShare({files})` validation is strict about
// this: a File whose `type` isn't a recognized shareable type (image/*,
// video/*) makes it correctly refuse to offer the file at all, since it
// has no way to know it's actually an image -- confirmed as a concrete,
// reproducible cause of "downloads to Files instead of sharing" on a
// real device (via a mocked octet-stream response + mocked canShare in
// this round's test harness): the file was constructed with type
// "application/octet-stream", canShare(files) correctly returned false
// for it, and the code silently fell through to plain download exactly
// as designed -- just not what anyone wanted.
//
// Fixed by trusting the FILENAME's own extension first (present on every
// real asset here -- storage paths always carry the original upload's
// extension) and only falling back to the response's own blob.type when
// the extension is unrecognized.
function resolveMimeType(blobType: string, filename: string): string {
  return mimeFromExtension(filename) ?? blobType ?? "application/octet-stream";
}

// Feature-detected only -- never sniffs the user agent.
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
  return new File([blob], filename, { type: resolveMimeType(blob.type, filename) });
}

// Compact, non-sensitive diagnostic for the mobile share path -- kept
// deliberately active (not stripped after this round) because the actual
// failure this was written to chase could only be reproduced/confirmed on
// a real device, which this environment has no access to. Logs shapes and
// outcomes only: no signed URLs, no file bytes. Safe to remove once a real
// device has confirmed the native share sheet appears correctly; until
// then this is the only way to see what a real browser's `canShare`/
// `share` actually returned.
function logShareDiagnostic(diagnostic: {
  preferMobileUx: boolean;
  shareAvailable: boolean;
  canShareAvailable: boolean;
  fileCount: number;
  fileTypes: string[];
  canShareResult: boolean | null;
  shareAttempted: boolean;
  shareError: string | null;
  fallbackUsed: boolean;
}) {
  console.debug("[share-diagnostic]", diagnostic);
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
//
// `preferMobileUx` (the caller's own touch/device hint) is no longer a
// hard precondition for attempting this -- capability detection
// (canShareFiles) runs regardless of it and is the thing that actually
// decides whether to share. It's still passed through so a confidently-
// desktop caller can note that in the diagnostic, but a device this
// hint misclassifies (or simply doesn't cover) is no longer silently
// blocked from ever reaching navigator.canShare at all. In practice this
// changes nothing on real desktop browsers (none of the mainstream ones
// support canShare({files}) today, so they still fall through to
// download exactly as before) while removing a whole class of "device
// heuristic said no" false negatives on mobile.
export async function shareOrDownloadAsset(url: string, filename: string, preferMobileUx: boolean) {
  const diag = {
    preferMobileUx,
    shareAvailable: typeof navigator !== "undefined" && typeof navigator.share === "function",
    canShareAvailable: typeof navigator !== "undefined" && typeof navigator.canShare === "function",
    fileCount: 1,
    fileTypes: [] as string[],
    canShareResult: null as boolean | null,
    shareAttempted: false,
    shareError: null as string | null,
    fallbackUsed: false,
  };
  try {
    const file = await fetchAsFile(url, filename);
    diag.fileTypes = [file.type];
    diag.canShareResult = await canShareFiles([file]);
    if (diag.canShareResult) {
      diag.shareAttempted = true;
      await navigator.share({ files: [file] });
      logShareDiagnostic(diag);
      return;
    }
  } catch (error) {
    diag.shareError = error instanceof Error ? error.name || error.message : String(error);
    // The user closing the share sheet themselves is not a failure --
    // falling back to a second, confusing download prompt right after
    // they explicitly dismissed the first one would be worse than doing
    // nothing.
    if (error instanceof DOMException && error.name === "AbortError") {
      logShareDiagnostic(diag);
      return;
    }
    // Any other failure (network, mid-flight unsupported, etc.) falls
    // through to the plain download below instead.
  }
  diag.fallbackUsed = true;
  logShareDiagnostic(diag);
  await downloadAsset(url, filename);
}

// The mobile-preferred path for a whole post's worth of images: fetches
// each asset's ORIGINAL bytes directly (never a server-composited export,
// never a zip) and offers them to the native share sheet as individual
// image/video Files in one share call. Deliberately not one share call
// per file (which on iOS pops a separate share sheet per image -- worse
// than a single zip) and deliberately not a zip either (a .zip in the
// share sheet's own file list isn't "individual images" -- the whole
// point of this path).
//
// An earlier version of this fetched the server's crop-applied export
// ZIP first, then unzipped it client-side with JSZip just to get back to
// individual files -- a real "server creates ZIP -> client downloads ZIP
// -> client unpacks it again" round trip for a case that doesn't need
// the export's own crop/resize (a carousel's non-cover slides never have
// a saved crop to begin with, and native share is for getting the images
// onto the device, not for a distribution-ready composite). Fetching
// every asset's real original directly is both simpler and matches what
// the existing single-asset share/download path already does.
//
// Returns true if this fully handled the request (shared successfully,
// or the user dismissed the share sheet themselves) -- the caller should
// do nothing further. Returns false if native file sharing isn't
// supported/available for these files, or a non-abort error occurred, so
// the caller can fall back to its own existing (server-export ZIP)
// download path -- see post-editor.tsx's own call site.
export async function shareOriginalAssets(assets: { url: string; filename: string }[]): Promise<boolean> {
  if (assets.length === 0) return false;
  const diag = {
    preferMobileUx: true,
    shareAvailable: typeof navigator !== "undefined" && typeof navigator.share === "function",
    canShareAvailable: typeof navigator !== "undefined" && typeof navigator.canShare === "function",
    fileCount: assets.length,
    fileTypes: [] as string[],
    canShareResult: null as boolean | null,
    shareAttempted: false,
    shareError: null as string | null,
    fallbackUsed: false,
  };
  try {
    const files = await Promise.all(assets.map((a) => fetchAsFile(a.url, a.filename)));
    diag.fileTypes = files.map((f) => f.type);
    diag.canShareResult = await canShareFiles(files);
    if (diag.canShareResult) {
      diag.shareAttempted = true;
      await navigator.share({ files });
      logShareDiagnostic(diag);
      return true;
    }
  } catch (error) {
    diag.shareError = error instanceof Error ? error.name || error.message : String(error);
    if (error instanceof DOMException && error.name === "AbortError") {
      logShareDiagnostic(diag);
      return true;
    }
  }
  diag.fallbackUsed = true;
  logShareDiagnostic(diag);
  return false;
}
