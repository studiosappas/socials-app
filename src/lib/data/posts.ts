import { createClient } from "@/lib/supabase/server";
import type { MediaLibraryItem, GridCoverTransform } from "@/app/projects/[projectId]/grid/grid-board";
import type { PostAssetItem, PostLinkItem } from "@/app/projects/[projectId]/posts/[postId]/post-editor";
import { getProjectMemberOptions, type ProjectMemberOption } from "@/lib/data/post-comments";
import { getBrandMoodboard, deriveCustomFontFaces, type CustomFontFace } from "@/lib/data/brand-moodboard";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import { canEditContent } from "@/lib/role-permissions";
import type { PostStatus, PostType, ProjectRole, ReviewStatus } from "@/types/database";

export type PostCoreData = {
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
  canManage: boolean;
  // The raw role, alongside the derived canManage -- needed so the editor
  // can offer Client their own narrow Approval Status control (see
  // PostMainForm's isClient branch) without conflating it with canManage,
  // which stays "owner/admin/editor only" throughout.
  role: ProjectRole;
  currentUserId: string;
  members: ProjectMemberOption[];
  customFonts: CustomFontFace[];
};

// Everything the primary editing surface actually needs to render and
// become usable: the post's own fields, its own asset carousel (with real
// signed URLs, not the whole project's), links, comment-mention members,
// and the font picker's list. Deliberately does NOT include the project's
// whole media library -- see getPostMediaLibrary below for why that's a
// separate, non-blocking fetch now.
export async function getPostCoreData(
  projectId: string,
  postId: string,
): Promise<PostCoreData | null> {
  const supabase = await createClient();

  const [
    userResult,
    postResult,
    timeRowResult,
    reviewStatusRowResult,
    coverTransformRowResult,
    postAssetsResult,
    linksResult,
    members,
    brandMoodboard,
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("posts").select("id, post_type, caption, notes, scheduled_date, status").eq("id", postId).single(),
    // Isolated from the main post select -- scheduled_time is a new column
    // that may not exist yet on a not-yet-migrated database (same reasoning
    // as preview_storage_path/annotation_json below).
    supabase.from("posts").select("scheduled_time").eq("id", postId).maybeSingle(),
    // Isolated the same way -- review_status is what Client Review's
    // review-link submissions write to, and what the "Approval Status"
    // field reads/writes manually.
    supabase.from("posts").select("review_status").eq("id", postId).maybeSingle(),
    // Isolated the same way -- the one canonical cover crop, same column
    // Grid's own crop tool reads/writes.
    supabase.from("posts").select("cover_transform").eq("id", postId).maybeSingle(),
    supabase
      .from("post_assets")
      .select("id, position, media_assets(id, storage_path, media_type)")
      .eq("post_id", postId)
      .order("position"),
    supabase.from("post_links").select("id, url, label").eq("post_id", postId),
    getProjectMemberOptions(supabase, projectId),
    // Reuses Brand Moodboard's own project-scoped, RLS-backed fetch --
    // the post editor's font picker just derives its custom-font list from
    // the same source Brief's does.
    getBrandMoodboard(supabase, projectId),
  ]);

  const user = userResult.data.user;
  const post = postResult.data;
  const timeRow = timeRowResult.data;
  const reviewStatusRow = reviewStatusRowResult.data;
  const coverTransformRow = coverTransformRowResult.data;
  const postAssets = postAssetsResult.data;
  const links = linksResult.data;
  const customFonts = deriveCustomFontFaces(brandMoodboard);

  if (!post) return null;

  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user!.id)
    .single();
  const role: ProjectRole = membership?.role ?? "viewer";
  const canManage = canEditContent(role);

  // Isolated from the select above -- preview_storage_path/annotation_json/
  // poster_storage_path are newer columns that may not exist yet on a
  // not-yet-migrated database, and PostgREST fails an ENTIRE select if any
  // requested column is missing -- folding these into the post_assets
  // select once broke the whole post editor (zero assets shown) rather than
  // just losing edit-preview data, until this was isolated the same way
  // Grid already handles it. Scoped to just this post's own asset ids, not
  // the whole project's media library.
  const ownMediaIds = new Set<string>();
  for (const pa of postAssets ?? []) {
    const media = pa.media_assets as { id: string } | null;
    if (media) ownMediaIds.add(media.id);
  }

  const [{ data: previewRows }, { data: posterRows }] = await Promise.all([
    ownMediaIds.size
      ? supabase.from("media_assets").select("id, preview_storage_path, annotation_json").in("id", Array.from(ownMediaIds))
      : Promise.resolve({ data: [] }),
    // Without this, the post editor's own asset strip had nothing pointing
    // at a video's manually-picked/annotated cover at all -- it always
    // showed the raw <video> element instead (see AssetPreview below),
    // so picking a cover frame changed Grid but looked like nothing
    // happened here, even though the save succeeded.
    ownMediaIds.size
      ? supabase.from("media_assets").select("id, poster_storage_path").in("id", Array.from(ownMediaIds))
      : Promise.resolve({ data: [] }),
  ]);

  const previewByMediaId = new Map<string, { previewPath: string | null; annotationJson: object | null }>();
  for (const r of previewRows ?? []) {
    previewByMediaId.set(r.id, {
      previewPath: (r as { preview_storage_path: string | null }).preview_storage_path ?? null,
      annotationJson: (r as { annotation_json: object | null }).annotation_json ?? null,
    });
  }

  const posterPathByMediaId = new Map<string, string | null>();
  for (const r of posterRows ?? []) {
    posterPathByMediaId.set(r.id, (r as { id: string; poster_storage_path: string | null }).poster_storage_path ?? null);
  }

  const allPaths = new Set<string>();
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

  const urlByPath = await getCachedSignedUrls(supabase, "project-media", Array.from(allPaths));

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

  const postLinks: PostLinkItem[] = (links ?? []).map((l) => ({
    id: l.id,
    url: l.url,
    label: l.label,
  }));

  return {
    post: {
      ...post,
      scheduled_time: timeRow?.scheduled_time ?? null,
      review_status: reviewStatusRow?.review_status ?? "pending",
      coverTransform: (coverTransformRow?.cover_transform as GridCoverTransform | null) ?? null,
    },
    assets,
    links: postLinks,
    canManage,
    role,
    currentUserId: user!.id,
    members,
    customFonts,
  };
}

// The project's whole media library, for the "Add from library" section and
// the Replace-asset popover -- deliberately split out from getPostCoreData
// above. This is the one query in the old getPostPageData that scaled with
// the ENTIRE project's media count (every asset gets an archived check, a
// preview/poster lookup, and a signed URL), not with this one post's asset
// count -- on a project with a large library, it was the dominant cost of
// opening the editor, and none of it is needed to render the primary
// editing surface. Callers pass this as an unawaited promise so the
// primary editor can render immediately; only the two actual consumers
// (the inline "Add from library" grid, and Replace-asset, both in
// post-editor.tsx) suspend on it, each in its own small boundary.
export async function getPostMediaLibrary(projectId: string): Promise<MediaLibraryItem[]> {
  const supabase = await createClient();

  const [{ data: allMediaAssets }, { data: carouselPosts }] = await Promise.all([
    // Excludes 'pdf' -- same reasoning as Grid's own Media Library query
    // (grid/page.tsx): this is a "pick an asset for this post/carousel
    // slot" picker, and a PDF was never a sensible post asset. Still exists
    // in this same project-wide table via the Content page, just never
    // offered here.
    supabase
      .from("media_assets")
      .select("id, storage_path, media_type")
      .eq("project_id", projectId)
      .neq("media_type", "pdf")
      .order("created_at", { ascending: false }),
    // Same "already used in a carousel" lookup as Grid's own media library
    // (grid/page.tsx) -- kept as two plain queries rather than a joined
    // filter, matching this file's existing isolated-lookup style.
    supabase.from("posts").select("id").eq("project_id", projectId).eq("post_type", "carousel"),
  ]);

  // Isolated from the select above -- archived is a newer column that may
  // not exist yet on a not-yet-migrated database, and a plain .eq() filter
  // on the main select would fail (silently returning nothing, since only
  // `data` is read) the instant it doesn't exist, wiping out the whole
  // library instead of just not filtering archived assets out yet.
  const allMediaIdsForArchiveCheck = (allMediaAssets ?? []).map((a) => a.id);
  const carouselPostIds = (carouselPosts ?? []).map((p) => p.id);

  const [{ data: archivedRows }, { data: carouselAssetRows }] = await Promise.all([
    allMediaIdsForArchiveCheck.length
      ? supabase.from("media_assets").select("id, archived").in("id", allMediaIdsForArchiveCheck)
      : Promise.resolve({ data: [] }),
    carouselPostIds.length
      ? supabase.from("post_assets").select("media_asset_id").in("post_id", carouselPostIds)
      : Promise.resolve({ data: [] }),
  ]);

  const archivedIds = new Set((archivedRows ?? []).filter((r) => r.archived).map((r) => r.id));
  const mediaAssets = (allMediaAssets ?? []).filter((a) => !archivedIds.has(a.id));
  const usedInCarouselIds = new Set((carouselAssetRows ?? []).map((r) => r.media_asset_id));

  // poster_storage_path is deliberately NOT fetched here -- MediaLibraryItem
  // only ever renders `url` (the image, or the raw <video> for a video
  // item; see the "Add from library" grid in post-editor.tsx), never a
  // video's poster. The original combined fetch signed poster paths for
  // every asset in the whole library and never used them for this list --
  // real work for nothing, only worth doing for postAssets' own
  // PostAssetItem.posterUrl, which now lives in getPostCoreData above.
  const allMediaIds = (mediaAssets ?? []).map((a) => a.id);
  const [{ data: previewRows }, { data: thumbnailRows }] = await Promise.all([
    allMediaIds.length
      ? supabase.from("media_assets").select("id, preview_storage_path").in("id", allMediaIds)
      : Promise.resolve({ data: [] }),
    // Isolated the same way as preview above -- thumbnail_storage_path may
    // not exist yet on a not-yet-migrated database. This grid's tiles are
    // tiny (~65-90px), same as Grid's own media library sidebar (see
    // grid/page.tsx's identical thumbnail-over-original preference) -- this
    // list was the one picker still signing the full original/preview for
    // every asset just to paint a small tile, which on a slow mobile
    // connection meant every thumbnail sat mid-download (rendering as a
    // partial sliver of decoded pixels) for however long a multi-MB file
    // took to arrive.
    allMediaIds.length
      ? supabase.from("media_assets").select("id, thumbnail_storage_path").in("id", allMediaIds)
      : Promise.resolve({ data: [] }),
  ]);

  const previewPathByMediaId = new Map<string, string | null>();
  for (const r of previewRows ?? []) {
    previewPathByMediaId.set(r.id, (r as { id: string; preview_storage_path: string | null }).preview_storage_path ?? null);
  }
  const thumbnailPathByMediaId = new Map<string, string | null>();
  for (const r of thumbnailRows ?? []) {
    thumbnailPathByMediaId.set(r.id, (r as { id: string; thumbnail_storage_path: string | null }).thumbnail_storage_path ?? null);
  }

  const allPaths = new Set<string>();
  for (const asset of mediaAssets ?? []) {
    allPaths.add(asset.storage_path);
    const preview = previewPathByMediaId.get(asset.id);
    if (preview) allPaths.add(preview);
    const thumbnail = thumbnailPathByMediaId.get(asset.id);
    if (thumbnail) allPaths.add(thumbnail);
  }

  const urlByPath = await getCachedSignedUrls(supabase, "project-media", Array.from(allPaths));

  return (mediaAssets ?? []).map((asset) => {
    const preview = previewPathByMediaId.get(asset.id);
    const thumbnail = thumbnailPathByMediaId.get(asset.id);
    const originalUrl = urlByPath.get(asset.storage_path) ?? null;
    // Thumbnail first (this list only ever renders a small tile, never a
    // full-size view), then the edited preview, then the original -- same
    // priority Grid's own on-screen tiles use, just with the preview step
    // added back in so a cropped/annotated asset still shows its actual
    // saved look here instead of the stale pre-edit thumbnail.
    const displayUrl =
      (thumbnail ? urlByPath.get(thumbnail) : undefined) ?? (preview ? urlByPath.get(preview) : undefined) ?? originalUrl;
    return {
      id: asset.id,
      url: displayUrl,
      // Always storage_path, never the preview -- see handleAddFromLibrary/
      // handleReplaceFromLibrary in post-editor.tsx, which need the real
      // original url (not this list's display-only `url`) for their
      // optimistic PostAssetItem so Download resolves correctly before the
      // page's next real fetch.
      originalUrl,
      mediaType: asset.media_type,
      usedInCarousel: usedInCarouselIds.has(asset.id),
    };
  });
}
