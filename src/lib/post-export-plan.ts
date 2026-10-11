// What a post's "Download Media" contains, decided in one place -- pure (no
// sharp, no Supabase, no DOM) so the same rules drive the server export
// route, the Post Editor's client-side per-frame/mobile downloads, and the
// unit tests (post-export-plan.test.ts).
//
// The three layers involved (see the media architecture notes on
// saveMediaAssetAnnotation / posts.cover_transform):
//   1. the ORIGINAL upload            media_assets.storage_path
//   2. a SAVED EDIT (Edit Image)      media_assets.preview_storage_path --
//      one flattened JPEG holding the saved crop, adjustments, text and
//      drawing. It IS the edited visual result; nothing has to be re-applied
//      to it, and re-applying annotation_json on top would apply the edit
//      twice.
//   3. GRID COVER FRAMING             posts.cover_transform -- a
//      non-destructive pan/zoom/rotate of the post's cover (position 0)
//      only, defined against whatever image the cover DISPLAYS, i.e. the
//      saved edit when there is one (saving an edit resets the framing, so
//      any framing that exists was set on top of that edit).
//
// "edited" (the default download) = what the app shows:
//   image  -> layer 2 if it exists, else layer 1; the cover additionally
//             gets layer 3 applied when a framing is saved.
//   video  -> the real video file, untouched. A video's saved cover edit /
//             framing belongs to its poster image, not to the file.
// "original" = layer 1 for everything, byte-for-byte.
//
// Nothing here ever writes to an asset: exports are new files, the source
// rows and storage objects are only read.

export type PostExportVariant = "edited" | "original";

export type PostExportAsset = {
  postAssetId: string;
  mediaType: "image" | "video";
  // media_assets.storage_path -- the untouched original.
  storagePath: string;
  // media_assets.preview_storage_path -- the saved edit, when one exists.
  previewPath: string | null;
};

export type PostExportItem = {
  // Position in the post (0 = cover).
  index: number;
  postAssetId: string;
  // Human label for error messages: "the cover" / "slide 3".
  label: string;
  // Storage path whose bytes this item starts from.
  sourcePath: string;
  // "verbatim": ship sourcePath's bytes untouched (no decode, no re-encode).
  // "cover-crop": render the saved Grid framing from sourcePath into a new JPEG.
  operation: "verbatim" | "cover-crop";
  // Name inside the zip / of the single downloaded file.
  filename: string;
};

export function parseExportVariant(value: string | null | undefined): PostExportVariant {
  return value === "original" ? "original" : "edited";
}

function extensionOf(path: string, fallback: string): string {
  const basename = path.split("/").pop() ?? "";
  const dot = basename.lastIndexOf(".");
  const ext = dot > 0 ? basename.slice(dot + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : fallback;
}

export function planPostExport(
  assets: PostExportAsset[],
  // posts.cover_transform -- only its presence matters here.
  coverTransform: object | null | undefined,
  variant: PostExportVariant,
): PostExportItem[] {
  return assets.map((asset, index) => {
    const isCover = index === 0;
    const base = isCover ? "cover" : `slide-${index + 1}`;
    const label = isCover ? "the cover" : `slide ${index + 1}`;
    const common = { index, postAssetId: asset.postAssetId, label };

    if (variant === "original" || asset.mediaType === "video") {
      return {
        ...common,
        sourcePath: asset.storagePath,
        operation: "verbatim",
        filename: `${base}.${extensionOf(asset.storagePath, asset.mediaType === "video" ? "mp4" : "jpg")}`,
      };
    }

    const sourcePath = asset.previewPath || asset.storagePath;
    // Only the cover can carry a Grid framing -- never applied to any other
    // carousel slide.
    if (isCover && coverTransform) {
      return { ...common, sourcePath, operation: "cover-crop", filename: `${base}.jpg` };
    }
    return { ...common, sourcePath, operation: "verbatim", filename: `${base}.${extensionOf(sourcePath, "jpg")}` };
  });
}

// --- client side -----------------------------------------------------------

export type DownloadableAsset = {
  postAssetId: string;
  mediaType: "image" | "video";
  // What the editor displays: the saved edit's signed URL when one exists,
  // else the original's.
  url: string | null;
  // Always the original's signed URL.
  originalUrl?: string | null;
};

export type DownloadSource = {
  url: string;
  // True when the bytes have to be rendered by the export route (the cover's
  // Grid framing); false when `url` already IS the wanted file and can be
  // fetched straight from storage with no server round trip.
  viaServer: boolean;
  // Set when the URL itself doesn't carry a usable filename.
  filename?: string;
};

export function postExportUrl(
  projectId: string,
  postId: string,
  opts: { variant?: PostExportVariant; postAssetId?: string } = {},
): string {
  const params = new URLSearchParams();
  if (opts.variant === "original") params.set("variant", "original");
  if (opts.postAssetId) params.set("asset", opts.postAssetId);
  const query = params.toString();
  return `/projects/${projectId}/posts/${postId}/export${query ? `?${query}` : ""}`;
}

// Where ONE asset's edited result comes from, mirroring planPostExport: the
// only case a browser can't satisfy from a URL it already holds is the
// cover image with a saved Grid framing, which the export route renders.
export function editedDownloadSource(
  asset: DownloadableAsset,
  isCover: boolean,
  coverTransform: object | null | undefined,
  projectId: string,
  postId: string,
): DownloadSource | null {
  if (asset.mediaType === "video") {
    const url = asset.originalUrl ?? asset.url;
    return url ? { url, viaServer: false } : null;
  }
  if (isCover && coverTransform) {
    return {
      url: postExportUrl(projectId, postId, { postAssetId: asset.postAssetId }),
      viaServer: true,
      filename: "cover.jpg",
    };
  }
  const url = asset.url ?? asset.originalUrl;
  return url ? { url, viaServer: false } : null;
}

export function originalDownloadSource(asset: DownloadableAsset): DownloadSource | null {
  const url = asset.originalUrl ?? null;
  return url ? { url, viaServer: false } : null;
}
