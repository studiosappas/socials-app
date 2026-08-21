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

export async function generateServerThumbnail(
  supabase: SupabaseClient,
  bucket: string,
  originalPath: string,
  projectId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(originalPath);
    if (error || !data) return null;

    const buffer = Buffer.from(await data.arrayBuffer());
    const resized = await sharp(buffer)
      .rotate() // respect EXIF orientation -- a raw camera photo is often stored sideways
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    const thumbPath = `${projectId}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(thumbPath, resized, { contentType: "image/jpeg" });
    if (uploadError) return null;

    return thumbPath;
  } catch {
    // Any decode failure (corrupt file, a format sharp also can't read,
    // etc.) -- fail closed, same as the client-side generator. The caller
    // already falls back to the full original when this returns null.
    return null;
  }
}
