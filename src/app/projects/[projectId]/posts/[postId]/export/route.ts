import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import { applyCoverTransform, type CoverTransform } from "@/lib/image-crop";
import { GRID_EXPORT_WIDTH, GRID_EXPORT_HEIGHT } from "@/app/projects/[projectId]/grid/grid-constants";

const SLIDE_W = GRID_EXPORT_WIDTH;
const COVER_H = GRID_EXPORT_HEIGHT; // 4:5, position 0 (the post's cover) -- same canonical Grid ratio, since this literally is the Grid tile's own image
const SLIDE_H = 1440; // 3:4, every other carousel slide -- a genuinely different, unrelated ratio (not the Grid tile), intentionally left as its own literal

// Server-side per-post export ("Download Media"): unlike the full-feed
// export (which only ever needs each post's single cover), this needs to
// process EVERY carousel asset, so it can't be the client-side raw-byte zip
// (download-zip.ts's downloadAssetsAsZip) the button used before.
//
// Always reads media_assets.storage_path -- the true original -- never
// preview_storage_path. An asset with no saved cover_transform (every
// carousel slide, and any cover nobody has cropped) is zipped byte-for-byte
// verbatim, no resize/recompress at all. Only the cover (position 0) WITH an
// actual saved cover_transform goes through applyCoverTransform, so its
// framing is preserved -- that's the one canonical crop, same as Grid/PDF.
// This used to run every image (cropped or not) through applyCoverTransform
// at a fixed 1080-wide target, which silently downscaled every untouched
// image to ~1080px -- the root cause of "Download Media" producing a
// low-resolution file even for an asset nobody ever cropped or edited.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; postId: string }> },
) {
  const { projectId, postId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return new Response("Forbidden", { status: 403 });
  }

  // Isolated from the query below, same reasoning as every other pending-
  // column isolation in this codebase -- a missing cover_transform column
  // just means the cover exports uncropped, not that the whole export fails.
  const { data: postRow } = await supabase.from("posts").select("cover_transform").eq("id", postId).maybeSingle();
  const coverTransform = (postRow?.cover_transform as CoverTransform | null) ?? null;

  const { data: postAssets } = await supabase
    .from("post_assets")
    .select("position, media_assets(storage_path, media_type)")
    .eq("post_id", postId)
    .order("position");

  if (!postAssets || postAssets.length === 0) {
    return new Response("Nothing to export yet.", { status: 400 });
  }

  const zip = new JSZip();
  let index = 0;
  for (const pa of postAssets) {
    const media = pa.media_assets as {
      storage_path: string;
      media_type: "image" | "video";
    } | null;
    if (!media) {
      index += 1;
      continue;
    }

    const isCover = index === 0;
    // Only the cover can ever have a saved crop -- every other carousel
    // slide always exports its raw original untouched.
    const transform = isCover ? coverTransform : null;

    const { data, error } = await supabase.storage.from("project-media").download(media.storage_path);
    if (error || !data) {
      index += 1;
      continue;
    }
    const buf = Buffer.from(await data.arrayBuffer());

    if (media.media_type === "video") {
      // The actual video file, included as-is -- no resize (sharp can't
      // process video) and no crop applied (cover_transform is a 2D pan/
      // zoom of a still image, not a meaningful concept for a video file's
      // own bytes). Previously skipped entirely, which meant a reel/video
      // post's "Download Media" produced an empty zip.
      const ext = media.storage_path.includes(".") ? media.storage_path.split(".").pop() : "mp4";
      zip.file(`${isCover ? "cover" : `slide-${index + 1}`}.${ext}`, buf);
      index += 1;
      continue;
    }

    if (!transform) {
      // No saved crop for this asset -- ship the exact original bytes,
      // byte-identical, no resize or recompression.
      const ext = media.storage_path.includes(".") ? media.storage_path.split(".").pop() : "jpg";
      zip.file(`${isCover ? "cover" : `slide-${index + 1}`}.${ext}`, buf);
      index += 1;
      continue;
    }

    try {
      // SLIDE_W/targetH here only pin the crop's aspect ratio (4:5 / 3:4) --
      // nativeResolution:true makes applyCoverTransform skip its final
      // resize-to-that-fixed-size step, so the output is the crop's own
      // native pixel dimensions (derived from this original's real
      // resolution), never downscaled to a fixed 1080-ish target.
      const targetH = isCover ? COVER_H : SLIDE_H;
      const pipeline = await applyCoverTransform(buf, transform, SLIDE_W, targetH, { nativeResolution: true });
      const cropped = await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
      zip.file(`${isCover ? "cover" : `slide-${index + 1}`}.jpg`, cropped);
    } catch {
      // Skip a single unreadable asset rather than failing the whole export.
    }
    index += 1;
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  return new Response(new Uint8Array(zipBuffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="post-${postId}-export.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
