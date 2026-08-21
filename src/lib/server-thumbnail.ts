import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

// Server-side fallback for generateImageThumbnailBlob (image-thumbnail.ts).
// The client-side path (a browser <img>+<canvas>) is the fast path -- no
// extra round trip -- but it silently returns null for any format the
// browser itself can't decode into an <img> (HEIC/HEIF straight off an
// iPhone camera is the common real-world case: Chrome/Firefox/Edge on
// desktop have no built-in HEIC decoder, so img.onerror fires and the
// original upload still succeeds with no thumbnail at all). sharp/libvips
// decodes a much broader format set server-side, so this runs only when the
// client didn't already produce a thumbnailStoragePath -- a guarantee, not
// a duplicate of the fast path.
const MAX_DIMENSION = 480;
const JPEG_QUALITY = 82;

export type ServerThumbnailResult =
  | { ok: true; path: string; originalBytes: number; thumbnailBytes: number }
  | { ok: false; reason: string };

export async function generateServerThumbnail(
  supabase: SupabaseClient,
  bucket: string,
  originalPath: string,
  projectId: string,
): Promise<ServerThumbnailResult> {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(originalPath);
    if (error || !data) return { ok: false, reason: error?.message ?? "could not download the original file" };

    const buffer = Buffer.from(await data.arrayBuffer());
    let resized: Buffer;
    try {
      resized = await sharp(buffer)
        .rotate() // respect EXIF orientation -- a raw camera photo is often stored sideways
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
    } catch (err) {
      // A format sharp itself can't decode either (rare once the browser
      // has already failed -- e.g. a genuinely corrupt file, or a format
      // neither can read) -- fail closed, distinctly reported so the
      // caller can skip it and move on instead of stopping everything.
      return { ok: false, reason: err instanceof Error ? err.message : "image could not be decoded" };
    }

    const thumbPath = `${projectId}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(thumbPath, resized, { contentType: "image/jpeg" });
    if (uploadError) return { ok: false, reason: uploadError.message };

    return { ok: true, path: thumbPath, originalBytes: buffer.length, thumbnailBytes: resized.length };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "unknown error" };
  }
}
