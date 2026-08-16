import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import { applyCoverTransform, type CoverTransform } from "@/lib/image-crop";

const SLIDE_W = 1080;
const COVER_H = 1350; // 4:5, position 0 (the post's cover)
const SLIDE_H = 1440; // 3:4, every other carousel slide

// Server-side per-post export ("Download all"): unlike the full-feed export
// (which only ever needs each post's single cover), this needs to process
// EVERY carousel asset, so it can't be the client-side raw-byte zip
// (download-zip.ts's downloadAssetsAsZip) the button used before -- that
// only ever copied bytes verbatim, with no resizing and no way to apply
// sharp (browser-only). Deliberately exports preview_storage_path (the
// user's own saved crop/annotation) over the untouched original when one
// exists -- a change from this button's previous "always the original,
// never the edited version" convention (still true elsewhere, e.g. Brief's
// image chips), because the whole point of this feature is that an export
// must never silently ignore a crop the user actually applied. The cover
// (position 0) also gets posts.cover_transform applied on top, same as
// Grid/PDF -- the one canonical crop, applied everywhere a post's cover is
// rendered or exported.
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
    .select("position, media_assets(storage_path, preview_storage_path, media_type)")
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
      preview_storage_path: string | null;
      media_type: "image" | "video";
    } | null;
    if (!media) {
      index += 1;
      continue;
    }

    const isCover = index === 0;

    if (media.media_type === "video") {
      // The actual video file, included as-is -- no resize (sharp can't
      // process video) and no crop applied (cover_transform is a 2D pan/
      // zoom of a still image, not a meaningful concept for a video file's
      // own bytes). Previously skipped entirely, which meant a reel/video
      // post's "Download Media" produced an empty zip.
      const { data, error } = await supabase.storage.from("project-media").download(media.storage_path);
      if (!error && data) {
        const ext = media.storage_path.includes(".") ? media.storage_path.split(".").pop() : "mp4";
        const buf = Buffer.from(await data.arrayBuffer());
        zip.file(`${isCover ? "cover" : `slide-${index + 1}`}.${ext}`, buf);
      }
      index += 1;
      continue;
    }

    const path = media.preview_storage_path ?? media.storage_path;
    const { data, error } = await supabase.storage.from("project-media").download(path);
    if (error || !data) {
      index += 1;
      continue;
    }

    const targetH = isCover ? COVER_H : SLIDE_H;
    try {
      const buf = Buffer.from(await data.arrayBuffer());
      const pipeline = await applyCoverTransform(buf, isCover ? coverTransform : null, SLIDE_W, targetH);
      const resized = await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
      zip.file(`${isCover ? "cover" : `slide-${index + 1}`}.jpg`, resized);
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
