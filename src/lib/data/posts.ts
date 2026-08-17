import { createClient } from "@/lib/supabase/server";
import type { MediaLibraryItem, GridCoverTransform } from "@/app/projects/[projectId]/grid/grid-board";
import type { PostAssetItem, PostLinkItem } from "@/app/projects/[projectId]/posts/[postId]/post-editor";
import { getProjectMemberOptions, type ProjectMemberOption } from "@/lib/data/post-comments";
import { getBrandMoodboard, deriveCustomFontFaces, type CustomFontFace } from "@/lib/data/brand-moodboard";
import type { PostStatus, PostType, ReviewStatus } from "@/types/database";

const SIGNED_URL_TTL_SECONDS = 3600;

export type PostPageData = {
  post: {
    id: string;
    post_type: PostType;
    caption: string;
    notes: string;
    scheduled_date: string | null;
    scheduled_time: string | null;
    status: PostStatus;
    review_status: ReviewStatus;
    // The one canonical crop for this post's cover asset (position 0) --
    // same value Grid's own crop tool reads/writes (updatePostCoverTransform),
    // now also the post editor's cover tile and its own Crop action.
    coverTransform: GridCoverTransform | null;
  };
  assets: PostAssetItem[];
  links: PostLinkItem[];
  mediaLibrary: MediaLibraryItem[];
  canManage: boolean;
  currentUserId: string;
  members: ProjectMemberOption[];
  customFonts: CustomFontFace[];
};

export async function getPostPageData(
  projectId: string,
  postId: string,
): Promise<PostPageData | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user!.id)
    .single();

  const canManage = membership?.role === "owner" || membership?.role === "admin";

  const { data: post } = await supabase
    .from("posts")
    .select("id, post_type, caption, notes, scheduled_date, status")
    .eq("id", postId)
    .single();

  if (!post) return null;

  // Isolated from the select above -- scheduled_time is a new column that
  // may not exist yet on a not-yet-migrated database (same reasoning as
  // preview_storage_path/annotation_json below).
  const { data: timeRow } = await supabase
    .from("posts")
    .select("scheduled_time")
    .eq("id", postId)
    .maybeSingle();

  // Isolated the same way -- review_status is what Client Review's
  // review-link submissions write to, and what the new "Approval Status"
  // field below reads/writes manually.
  const { data: reviewStatusRow } = await supabase
    .from("posts")
    .select("review_status")
    .eq("id", postId)
    .maybeSingle();

  // Isolated the same way -- the one canonical cover crop, same column
  // Grid's own crop tool reads/writes.
  const { data: coverTransformRow } = await supabase
    .from("posts")
    .select("cover_transform")
    .eq("id", postId)
    .maybeSingle();

  const { data: postAssets } = await supabase
    .from("post_assets")
    .select("id, position, media_assets(id, storage_path, media_type)")
    .eq("post_id", postId)
    .order("position");

  const { data: links } = await supabase
    .from("post_links")
    .select("id, url, label")
    .eq("post_id", postId);

  const { data: allMediaAssets } = await supabase
    .from("media_assets")
    .select("id, storage_path, media_type")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  // Isolated from the select above -- archived is a newer column that may
  // not exist yet on a not-yet-migrated database, and a plain .eq() filter
  // on the main select would fail (silently returning nothing, since only
  // `data` is read) the instant it doesn't exist, wiping out the whole
  // library instead of just not filtering archived assets out yet.
  const allMediaIdsForArchiveCheck = (allMediaAssets ?? []).map((a) => a.id);
  const { data: archivedRows } = allMediaIdsForArchiveCheck.length
    ? await supabase.from("media_assets").select("id, archived").in("id", allMediaIdsForArchiveCheck)
    : { data: [] };
  const archivedIds = new Set((archivedRows ?? []).filter((r) => r.archived).map((r) => r.id));
  const mediaAssets = (allMediaAssets ?? []).filter((a) => !archivedIds.has(a.id));

  // Same "already used in a carousel" lookup as Grid's own media library
  // (grid/page.tsx) -- kept as two plain queries rather than a joined
  // filter, matching this file's existing isolated-lookup style.
  const { data: carouselPosts } = await supabase
    .from("posts")
    .select("id")
    .eq("project_id", projectId)
    .eq("post_type", "carousel");
  const carouselPostIds = (carouselPosts ?? []).map((p) => p.id);
  const { data: carouselAssetRows } = carouselPostIds.length
    ? await supabase.from("post_assets").select("media_asset_id").in("post_id", carouselPostIds)
    : { data: [] };
  const usedInCarouselIds = new Set((carouselAssetRows ?? []).map((r) => r.media_asset_id));

  // Fetched independently, same reasoning as Grid's cover_transform/
  // preview_storage_path isolation in grid-data.ts: preview_storage_path/
  // annotation_json are newer columns that may not exist yet on a
  // not-yet-migrated database, and PostgREST fails an ENTIRE select if any
  // requested column is missing -- folding these into the selects above
  // once broke the whole post editor (zero assets shown) rather than just
  // losing edit-preview data, until this was isolated the same way Grid
  // already handles it.
  const allMediaIds = new Set<string>();
  for (const pa of postAssets ?? []) {
    const media = pa.media_assets as { id: string } | null;
    if (media) allMediaIds.add(media.id);
  }
  for (const asset of mediaAssets ?? []) allMediaIds.add(asset.id);
  const { data: previewRows } = allMediaIds.size
    ? await supabase
        .from("media_assets")
        .select("id, preview_storage_path, annotation_json")
        .in("id", Array.from(allMediaIds))
    : { data: [] };
  const previewByMediaId = new Map<string, { previewPath: string | null; annotationJson: object | null }>();
  for (const r of previewRows ?? []) {
    previewByMediaId.set(r.id, {
      previewPath: (r as { preview_storage_path: string | null }).preview_storage_path ?? null,
      annotationJson: (r as { annotation_json: object | null }).annotation_json ?? null,
    });
  }

  // Isolated the same way as preview_storage_path above (a still-pending
  // migration should only mean video covers aren't shown yet, not that the
  // whole post editor breaks). Without this, the post editor's own asset
  // strip had nothing pointing at a video's manually-picked/annotated cover
  // at all -- it always showed the raw <video> element instead (see
  // AssetPreview in post-editor.tsx), so picking a cover frame changed Grid
  // but looked like nothing happened here, even though the save succeeded.
  const { data: posterRows } = allMediaIds.size
    ? await supabase.from("media_assets").select("id, poster_storage_path").in("id", Array.from(allMediaIds))
    : { data: [] };
  const posterPathByMediaId = new Map<string, string | null>();
  for (const r of posterRows ?? []) {
    posterPathByMediaId.set(r.id, (r as { id: string; poster_storage_path: string | null }).poster_storage_path ?? null);
  }

  const allPaths = new Set<string>();
  for (const asset of mediaAssets ?? []) {
    allPaths.add(asset.storage_path);
    const preview = previewByMediaId.get(asset.id)?.previewPath;
    if (preview) allPaths.add(preview);
    const poster = posterPathByMediaId.get(asset.id);
    if (poster) allPaths.add(poster);
  }
  for (const pa of postAssets ?? []) {
    const media = pa.media_assets as { id: string; storage_path: string } | null;
    if (media) {
      allPaths.add(media.storage_path);
      const preview = previewByMediaId.get(media.id)?.previewPath;
      if (preview) allPaths.add(preview);
      const poster = posterPathByMediaId.get(media.id);
      if (poster) allPaths.add(poster);
    }
  }

  const pathList = Array.from(allPaths);
  const { data: signedUrls } = pathList.length
    ? await supabase.storage.from("project-media").createSignedUrls(pathList, SIGNED_URL_TTL_SECONDS)
    : { data: [] };

  const urlByPath = new Map<string, string>();
  for (const entry of signedUrls ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  const assets: PostAssetItem[] = (postAssets ?? []).map((pa) => {
    const media = pa.media_assets as { id: string; storage_path: string; media_type: string } | null;
    const originalUrl = media ? urlByPath.get(media.storage_path) ?? null : null;
    const preview = media ? previewByMediaId.get(media.id) : undefined;
    return {
      postAssetId: pa.id,
      mediaAssetId: media?.id ?? "",
      // Wherever this asset is displayed shows the edited preview once one
      // exists -- editing "the cover image" is what should make the edit
      // show up on the Grid slot too, same idea as Brief's attachments.
      url: preview?.previewPath ? urlByPath.get(preview.previewPath) ?? originalUrl : originalUrl,
      originalUrl,
      annotationJson: preview?.annotationJson ?? null,
      mediaType: (media?.media_type as "image" | "video") ?? "image",
      posterUrl: media ? (posterPathByMediaId.get(media.id) ? urlByPath.get(posterPathByMediaId.get(media.id)!) ?? null : null) : null,
    };
  });

  const mediaLibrary: MediaLibraryItem[] = (mediaAssets ?? []).map((asset) => {
    const preview = previewByMediaId.get(asset.id)?.previewPath;
    return {
      id: asset.id,
      url: preview ? urlByPath.get(preview) ?? urlByPath.get(asset.storage_path) ?? null : urlByPath.get(asset.storage_path) ?? null,
      mediaType: asset.media_type,
      usedInCarousel: usedInCarouselIds.has(asset.id),
    };
  });

  const postLinks: PostLinkItem[] = (links ?? []).map((l) => ({
    id: l.id,
    url: l.url,
    label: l.label,
  }));

  const members = await getProjectMemberOptions(supabase, projectId);

  // Reuses Brand Moodboard's own project-scoped, RLS-backed fetch (already
  // isolated/graceful on its own) -- the post editor's font picker just
  // derives its custom-font list from the same source Brief's does.
  const brandMoodboard = await getBrandMoodboard(supabase, projectId);
  const customFonts = deriveCustomFontFaces(brandMoodboard);

  return {
    post: {
      ...post,
      scheduled_time: timeRow?.scheduled_time ?? null,
      review_status: reviewStatusRow?.review_status ?? "pending",
      coverTransform: (coverTransformRow?.cover_transform as GridCoverTransform | null) ?? null,
    },
    assets,
    links: postLinks,
    mediaLibrary,
    canManage,
    currentUserId: user!.id,
    members,
    customFonts,
  };
}
