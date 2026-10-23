import { createClient } from "@/lib/supabase/server";
import type { MediaLibraryItem, GridCoverTransform } from "@/app/projects/[projectId]/grid/grid-board";
import type { PostAssetItem, PostLinkItem } from "@/app/projects/[projectId]/posts/[postId]/post-editor";
import { getProjectMemberOptions, type ProjectMemberOption } from "@/lib/data/post-comments";
import { getBrandMoodboard, deriveCustomFontFaces, type CustomFontFace } from "@/lib/data/brand-moodboard";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import {
  archivedIdsFromLookup,
  collectLibraryPage,
  decodeCursor,
  encodeCursor,
  type LibraryPage,
} from "@/lib/media-library-paging";
import { canEditContent } from "@/lib/role-permissions";
import { mergeWorkspaceSettings, type WorkspaceSettings } from "@/lib/account-settings";
import type { MediaType, PostStatus, PostType, ProjectRole, ReviewStatus } from "@/types/database";

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
  // The viewer's own saved Settings > Workspace preference (account-settings.ts),
  // already defaulted -- not project-scoped, so this is the same value
  // regardless of which post/project is open.
  dateFormat: WorkspaceSettings["date_format"];
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

  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user!.id).single(),
    supabase.from("profiles").select("workspace_settings").eq("id", user!.id).single(),
  ]);
  const role: ProjectRole = membership?.role ?? "viewer";
  const canManage = canEditContent(role);
  const { date_format: dateFormat } = mergeWorkspaceSettings(profile?.workspace_settings);

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
    dateFormat,
  };
}

// A real, honest PAGE, not a raised-but-still-fixed cap: an earlier
// version of this function capped the query at 100 assets total with no
// way to reach anything past that, which still isn't correct for a
// project whose library has grown past it, AND still bulk-signed all 100
// (~200 paths, original+thumbnail each) before the popup could show
// anything -- confirmed too slow in real manual QA even after that cap.
// This page size (24) is sized to comfortably fill this popup's own
// visible grid (sm:grid-cols-6 -- 4 rows) before any scrolling, so the
// FIRST page is both fast to sign (~48 paths) and already a genuinely
// useful amount of media, with getPostMediaLibraryPage below callable
// again for every subsequent page so nothing past #24 is ever
// unreachable.
export const MEDIA_LIBRARY_PAGE_SIZE = 24;
// How many raw batches one picker page may scan when archived rows filter
// a batch down (see collectLibraryPage). 4 x 24 rows covers any realistic
// run of archived copy-on-write clones at the top of the list; past that,
// the page comes back short with hasMore still true and Load More resumes
// from the exact raw position, so nothing is ever stranded.
const MEDIA_LIBRARY_MAX_BATCHES = 4;

type RawMediaRow = { id: string; storage_path: string; media_type: MediaType; created_at: string };

// One project media page, newest first, keyset-paged on (created_at, id)
// -- see lib/media-library-paging.ts for why (the old OFFSET + filtered-
// count version hid Load More and stranded older assets as soon as any
// archived row landed in the first page). Shared by getPostMediaLibrary
// below (first page, for callers with no pagination UI of their own) and
// loadPostMediaLibraryPage (lib/actions/posts.ts), the Server Action the
// picker calls for Load More and to refresh its first page.
//
// `cursor` is untrusted input on that Server Action path -- decodeCursor
// rejects anything that isn't exactly a timestamptz + uuid before it gets
// anywhere near the PostgREST filter below. Project isolation and access
// are unchanged: every query is still scoped by project_id under the
// caller's own RLS session.
export async function getPostMediaLibraryPage(
  projectId: string,
  cursor: string | null,
  limit: number,
): Promise<LibraryPage<MediaLibraryItem>> {
  const supabase = await createClient();
  const startAfter = cursor === null ? null : decodeCursor(cursor);
  if (cursor !== null && !startAfter) throw new Error("Invalid media library cursor.");

  // Same "already used in a carousel" lookup as Grid's own media library
  // (grid/page.tsx) -- project-wide, so fetched once per page (not per raw
  // batch), started now so it runs alongside the batches below.
  const usedInCarouselPromise = (async () => {
    const { data: carouselPosts } = await supabase
      .from("posts")
      .select("id")
      .eq("project_id", projectId)
      .eq("post_type", "carousel");
    const carouselPostIds = (carouselPosts ?? []).map((p) => p.id);
    if (carouselPostIds.length === 0) return new Set<string>();
    const { data: carouselAssetRows } = await supabase.from("post_assets").select("media_asset_id").in("post_id", carouselPostIds);
    return new Set((carouselAssetRows ?? []).map((r) => r.media_asset_id));
  })();

  const { rows: mediaAssets, nextCursor, hasMore } = await collectLibraryPage<RawMediaRow>({
    cursor: startAfter,
    limit,
    maxBatches: MEDIA_LIBRARY_MAX_BATCHES,
    fetchBatch: async (after, size) => {
      // Excludes 'pdf' -- same reasoning as Grid's own Media Library query
      // (grid/page.tsx): this is a "pick an asset for this post/carousel
      // slot" picker, and a PDF was never a sensible post asset. Still
      // exists in this same project-wide table via the Content page, just
      // never offered here. id is the tie-breaker that makes the order
      // total, so rows sharing a created_at can't swap between requests.
      let query = supabase
        .from("media_assets")
        .select("id, storage_path, media_type, created_at")
        .eq("project_id", projectId)
        .neq("media_type", "pdf");
      if (after) {
        // Keyset "strictly after (created_at, id)" in DESC order:
        // created_at <= c AND (created_at < c OR id < i). The timestamp is
        // double-quoted inside or() since it contains ':' / '.' / '+'.
        query = query
          .lte("created_at", after.createdAt)
          .or(`created_at.lt."${after.createdAt}",id.lt.${after.id}`);
      }
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(size);
      if (error) throw new Error(`media library batch failed: ${error.message}`);
      return (data ?? []) as RawMediaRow[];
    },
    // Isolated from the batch select above -- archived is a newer column
    // that may not exist yet on a not-yet-migrated database, and a plain
    // .eq() filter on the main select would fail the instant it doesn't
    // exist, wiping out the whole library instead of just not filtering
    // archived assets out yet. Applied per batch; the cursor only advances
    // once this has succeeded, so archived rows can never shift or end
    // paging. Fails closed on a transient error -- see archivedIdsFromLookup.
    filterEligible: async (rows) => {
      const archivedIds = archivedIdsFromLookup(
        await supabase.from("media_assets").select("id, archived").in("id", rows.map((r) => r.id)),
      );
      return rows.filter((r) => !archivedIds.has(r.id));
    },
  });

  const usedInCarouselIds = await usedInCarouselPromise;

  // poster_storage_path is fetched for VIDEO items only (see posterRows
  // below) -- it's what a video's library tile renders. The original
  // combined fetch signed poster paths for every asset in the whole library
  // (images included, which never have one worth showing here).
  const allMediaIds = (mediaAssets ?? []).map((a) => a.id);
  const videoIds = (mediaAssets ?? []).filter((a) => a.media_type === "video").map((a) => a.id);
  const [{ data: previewRows }, { data: thumbnailRows }, { data: posterRows }] = await Promise.all([
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
    // Videos only, isolated like the two above. A video never has a
    // thumbnail_storage_path (that's image-only), so its tile used to render
    // a raw <video> of the full original -- blank/white on iOS, and a
    // multi-MB range request per tile everywhere. Its poster (the same
    // image Grid already shows for that video) is what the tile renders now.
    videoIds.length
      ? supabase.from("media_assets").select("id, poster_storage_path").in("id", videoIds)
      : Promise.resolve({ data: [] }),
  ]);
  const posterPathByMediaId = new Map<string, string | null>();
  for (const r of posterRows ?? []) {
    posterPathByMediaId.set(r.id, (r as { id: string; poster_storage_path: string | null }).poster_storage_path ?? null);
  }

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
    const poster = posterPathByMediaId.get(asset.id);
    if (poster) allPaths.add(poster);
  }

  const urlByPath = await getCachedSignedUrls(supabase, "project-media", Array.from(allPaths));

  const items: MediaLibraryItem[] = (mediaAssets ?? []).map((asset) => {
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
      posterUrl: (() => {
        const poster = posterPathByMediaId.get(asset.id);
        return poster ? urlByPath.get(poster) ?? null : null;
      })(),
      usedInCarousel: usedInCarouselIds.has(asset.id),
    };
  });

  return {
    // Each item keeps its own row's cursor key -- the picker needs it to
    // reconcile a refreshed first page with pages it already loaded.
    entries: items.map((item, i) => ({
      item,
      key: encodeCursor({ createdAt: mediaAssets[i].created_at, id: mediaAssets[i].id }),
    })),
    // Both come from the RAW rows (see collectLibraryPage), never from how
    // many survived the archived filter.
    nextCursor,
    hasMore,
  };
}

// The project's whole media library, for callers with no pagination UI of
// their own (Tasks' LinkedContentModal via fetchPostForModal) --
// deliberately split out from getPostCoreData above, same reasoning as
// getPostMediaLibraryPage: this is the one query that scales with the
// ENTIRE project's media count, not with this one post's asset count.
// Post Editor's own primary "Add from library"/Replace flow no longer
// calls this -- see loadPostMediaLibraryPage (lib/actions/posts.ts) and
// its own first-page call in page.tsx, which page through
// getPostMediaLibraryPage directly instead of needing everything at once.
// Exactly the same first page the Grid/Calendar post routes start from
// (page.tsx), so the picker pages identically wherever the editor opens.
// This used to be a single 100-row batch: Tasks then only ever got
// hasMore=true -- and so paging -- for projects with more than 100 media
// rows, which left that path's paging unexercised on any normal-sized
// project and signed 4x the URLs up front for no benefit.
export async function getPostMediaLibrary(projectId: string): Promise<LibraryPage<MediaLibraryItem>> {
  return getPostMediaLibraryPage(projectId, null, MEDIA_LIBRARY_PAGE_SIZE);
}
