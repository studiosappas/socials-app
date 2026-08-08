import sharp from "sharp";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";

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
// must never silently ignore a crop the user actually applied.
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
    // A video carousel slide has no exportable still frame here (Grid's own
    // cover-poster handling is a separate concern from carousel export) --
    // skip it rather than exporting raw video bytes at an image resolution.
    if (!media || media.media_type !== "image") {
      index += 1;
      continue;
    }

    const path = media.preview_storage_path ?? media.storage_path;
    const { data, error } = await supabase.storage.from("project-media").download(path);
    if (error || !data) {
      index += 1;
      continue;
    }

    const isCover = index === 0;
    const targetH = isCover ? COVER_H : SLIDE_H;
    try {
      const buf = Buffer.from(await data.arrayBuffer());
      const resized = await sharp(buf)
        .resize(SLIDE_W, targetH, { fit: "cover", position: "centre" })
        .jpeg({ quality: 95, mozjpeg: true })
        .toBuffer();
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
