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
