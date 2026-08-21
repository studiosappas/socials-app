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

// Identifies the REAL format from the file's own magic bytes -- never
// trusts the extension in storage_path or any declared content-type,
// since both are just labels someone/something attached at upload time
// and can be wrong (a mislabeled file, a placeholder, a renamed
// non-image). Only checked on the failure path (see below) -- this is
// diagnostic-only, purely read-only, and changes nothing about whether a
// file is accepted.
function sniffFormat(buffer: Buffer): string {
  if (buffer.length === 0) return "empty file (0 bytes)";
  const hex = (n: number) => buffer.subarray(0, n).toString("hex");

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "PNG";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "JPEG";
  }
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("latin1"))) {
    return "GIF";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "WebP";
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("latin1").trim();
    if (/^(heic|heix|hevc|hevx|mif1|msf1)/.test(brand)) return `HEIC/HEIF (brand: ${brand})`;
    if (brand.startsWith("avif")) return "AVIF";
    return `ISO-BMFF container (brand: ${brand})`;
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return "BMP";
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("latin1") === "8BPS") return "PSD";
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("latin1") === "%PDF") return "PDF";
  if (buffer.length >= 2 && (hex(2) === "424d" || hex(4) === "49492a00" || hex(4) === "4d4d002a")) return "TIFF/BMP variant";
  // Looks like plain text -- often means "this isn't binary image data at
  // all" (an HTML error page saved with an image extension, a git-lfs
  // pointer file, etc.).
  if (buffer.subarray(0, Math.min(64, buffer.length)).every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127))) {
    return `plain text, starts: ${JSON.stringify(buffer.subarray(0, 40).toString("latin1"))}`;
  }
  return `unrecognized (first bytes: ${hex(Math.min(12, buffer.length))})`;
}

export async function generateServerThumbnail(
  supabase: SupabaseClient,
  bucket: string,
  originalPath: string,
  projectId: string,
): Promise<ServerThumbnailResult> {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(originalPath);
    if (error || !data) return { ok: false, reason: `download failed: ${error?.message ?? "no data returned"}` };

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
      //
      // Everything below only runs on this (rare) failure path, not on
      // every image -- an extra Storage .list() call per file would be
      // wasteful overhead on the common (successful) case. actualFormat is
      // read from the file's own magic bytes, never trusting the
      // extension or any declared content-type; storedSize cross-checks
      // the downloaded byte count against what Storage itself reports for
      // the object, to distinguish "truncated/incomplete download" from
      // "genuinely undecodable file" as separate failure modes.
      const message = err instanceof Error ? err.message : "image could not be decoded";
      const actualFormat = sniffFormat(buffer);
      const slash = originalPath.lastIndexOf("/");
      const dir = slash === -1 ? "" : originalPath.slice(0, slash);
      const name = slash === -1 ? originalPath : originalPath.slice(slash + 1);
      const declaredExt = name.includes(".") ? name.split(".").pop() : "(no extension)";
      const { data: listing } = await supabase.storage.from(bucket).list(dir, { search: name, limit: 1 });
      const storedSize = listing?.[0]?.metadata?.size as number | undefined;
      const sizeNote =
        typeof storedSize === "number" && storedSize !== buffer.length
          ? ` [MISMATCH: Storage reports ${storedSize} bytes, but ${buffer.length} bytes were downloaded -- likely a truncated/incomplete download, not a decode failure]`
          : ` [downloaded ${buffer.length} bytes, matches Storage's own reported size]`;
      return {
        ok: false,
        reason: `${message} -- declared extension: .${declaredExt}, actual format from file signature: ${actualFormat}${sizeNote}`,
      };
    }

    const thumbPath = `${projectId}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(thumbPath, resized, { contentType: "image/jpeg" });
    if (uploadError) return { ok: false, reason: `thumbnail upload failed: ${uploadError.message}` };

    return { ok: true, path: thumbPath, originalBytes: buffer.length, thumbnailBytes: resized.length };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "unknown error" };
  }
}
