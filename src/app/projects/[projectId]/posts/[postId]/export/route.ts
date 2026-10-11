import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import type { CoverTransform } from "@/lib/image-crop";
import { parseExportVariant, planPostExport, type PostExportAsset } from "@/lib/post-export-plan";
import { PostExportError, contentTypeForFilename, renderPostExport } from "@/lib/post-export";

// Server-side per-post export -- "Download Media" in the Post Editor.
//
//   GET .../export                    zip of the post's EDITED media: what
//                                     the app shows (default).
//   GET .../export?variant=original   zip of the untouched original uploads
//                                     ("Download Originals").
//   GET .../export?asset=<postAssetId>[&variant=original]
//                                     that one asset as a single file, not a
//                                     zip (per-frame download; the mobile
//                                     share path uses it for the cover).
//
// What "edited" means is decided in lib/post-export-plan.ts (one shared,
// unit-tested rule set) and rendered by lib/post-export.ts. In short: an
// image exports its saved edit (media_assets.preview_storage_path -- crop,
// adjustments, text, drawing, already flattened) when it has one, else its
// original; the cover additionally gets its saved Grid framing
// (posts.cover_transform) applied on top of THAT image; videos export as
// the real, playable file. An image with no saved edit and no framing is
// shipped byte-for-byte, no resize or recompression -- this route used to
// push every image through a fixed 1080-wide resize, which is what made
// "Download Media" low-resolution once before.
//
// It used to read storage_path ONLY, so a saved crop/adjustment never made
// it into the download even though every screen showed it.
//
// Read-only: nothing here writes to an asset, a post or storage. Any item
// that can't be produced fails the WHOLE request with a readable message --
// never a zip that quietly lacks a slide.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; postId: string }> },
) {
  const { projectId, postId } = await params;
  const url = new URL(request.url);
  const variant = parseExportVariant(url.searchParams.get("variant"));
  const onlyAssetId = url.searchParams.get("asset");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse(401, "You must be logged in to download media.");
  }

  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return errorResponse(403, "You don't have access to this project.");
  }

  // The post must belong to the project in the URL -- membership above is
  // only for that project.
  const { data: post } = await supabase.from("posts").select("id").eq("id", postId).eq("project_id", projectId).maybeSingle();
  if (!post) {
    return errorResponse(404, "This post no longer exists.");
  }

  // Isolated from the queries below, same reasoning as every other pending-
  // column isolation in this codebase -- a missing cover_transform column
  // just means the cover exports unframed, not that the whole export fails.
  const { data: postRow } = await supabase.from("posts").select("cover_transform").eq("id", postId).maybeSingle();
  const coverTransform = (postRow?.cover_transform as CoverTransform | null) ?? null;

  const { data: postAssets, error: postAssetsError } = await supabase
    .from("post_assets")
    .select("id, position, media_assets(id, storage_path, media_type)")
    .eq("post_id", postId)
    .order("position");

  if (postAssetsError) {
    console.error("[post-export] could not load post assets", { postId, message: postAssetsError.message });
    return errorResponse(500, "Couldn't load this post's media. Please try again.");
  }
  if (!postAssets || postAssets.length === 0) {
    return errorResponse(400, "Nothing to download yet — this post has no media.");
  }

  type MediaRow = { id: string; storage_path: string; media_type: "image" | "video" };
  const rows = postAssets.map((pa) => ({ postAssetId: pa.id as string, media: pa.media_assets as MediaRow | null }));
  const missing = rows.findIndex((r) => !r.media);
  if (missing !== -1) {
    console.error("[post-export] post asset has no media row", { postId, position: missing });
    return errorResponse(500, `Couldn't find the media for ${missing === 0 ? "the cover" : `slide ${missing + 1}`}. Please refresh and try again.`);
  }

  // Isolated the same way -- preview_storage_path is a newer column. Only
  // needed for the edited variant. If the lookup fails, exporting originals
  // while calling them "edited" would be exactly the silent substitution
  // this route exists to stop, so it fails loudly instead.
  const previewByMediaId = new Map<string, string | null>();
  if (variant === "edited") {
    const mediaIds = rows.map((r) => r.media!.id);
    const { data: previewRows, error: previewError } = await supabase
      .from("media_assets")
      .select("id, preview_storage_path")
      .in("id", mediaIds);
    if (previewError) {
      console.error("[post-export] could not load saved edits", { postId, message: previewError.message });
      return errorResponse(500, "Couldn't load this post's saved edits. Please try again, or use Download Originals.");
    }
    for (const r of previewRows ?? []) {
      previewByMediaId.set(r.id, (r as { preview_storage_path: string | null }).preview_storage_path ?? null);
    }
  }

  const assets: PostExportAsset[] = rows.map((r) => ({
    postAssetId: r.postAssetId,
    mediaType: r.media!.media_type === "video" ? "video" : "image",
    storagePath: r.media!.storage_path,
    previewPath: previewByMediaId.get(r.media!.id) ?? null,
  }));

  let plan = planPostExport(assets, coverTransform, variant);
  if (onlyAssetId) {
    plan = plan.filter((item) => item.postAssetId === onlyAssetId);
    if (plan.length === 0) return errorResponse(404, "That item is no longer part of this post. Please refresh and try again.");
  }

  let rendered;
  try {
    rendered = await renderPostExport(plan, coverTransform, async (storagePath) => {
      const { data, error } = await supabase.storage.from("project-media").download(storagePath);
      if (error || !data) throw error ?? new Error("empty storage response");
      return Buffer.from(await data.arrayBuffer());
    });
  } catch (error) {
    if (error instanceof PostExportError) {
      console.error("[post-export] item failed", { postId, variant, message: error.message, cause: String(error.cause ?? "") });
      return errorResponse(502, error.userMessage);
    }
    console.error("[post-export] unexpected failure", { postId, variant, error: String(error) });
    return errorResponse(500, "Couldn't prepare the download. Please try again.");
  }

  if (onlyAssetId) {
    const { item, data } = rendered[0];
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentTypeForFilename(item.filename),
        "Content-Disposition": `attachment; filename="post-${postId}-${item.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const zip = new JSZip();
  for (const { item, data } of rendered) zip.file(item.filename, data);
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const suffix = variant === "original" ? "originals" : "export";

  return new Response(new Uint8Array(zipBuffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="post-${postId}-${suffix}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

// JSON so the Post Editor can show `message` as-is.
function errorResponse(status: number, message: string) {
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
}
