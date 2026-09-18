import { createClient } from "@/lib/supabase/server";
import { getGridRowsWithCoverPaths } from "@/lib/grid-data";
import { getShareLinksData } from "@/lib/data/share-links";
import { getCachedSignedUrl, getCachedSignedUrls } from "@/lib/signed-url-cache";
import { canEditContent, hasPagePermission } from "@/lib/role-permissions";
import { GridBoard, type GridBoardRow, type MediaFolder, type MediaLibraryItem } from "./grid-board";
import { AccessRestricted } from "../access-restricted";

export default async function GridPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  // Wave 1 -- everything below needs only projectId (or nothing at all), so
  // none of it has to wait on any other query in this wave. This used to be
  // ~10 sequential `await`s in a row (membership, then project, then
  // socialLinks, then profilePhotoUrl, then grid rows, then media assets,
  // then folders, ...) -- each one a real round trip to Supabase paid in
  // series instead of at once, the same waterfall shape Overview's and
  // Brief's page.tsx already avoid with their own Promise.all. Matches
  // those two files' same trade-off of also fetching membership-gated data
  // before the access check below, rather than after: RLS already scopes
  // every one of these queries to what the requesting user can see, so an
  // unauthorized visitor gets back empty results here, not someone else's
  // data -- the only cost is a few wasted (but parallel, so still cheap)
  // queries on the rare access-denied path.
  const [
    {
      data: { user },
    },
    { data: project },
    // Isolated from the project select above -- instagram_url/tiktok_url
    // are new columns that may not exist yet on a not-yet-migrated
    // database, and PostgREST fails the whole select if any referenced
    // column is missing.
    { data: socialLinks },
    gridRowsWithPaths,
    // Excludes 'pdf' -- Grid's Media Library is a "pick a cover for this
    // post/carousel slot" picker, and a PDF was never a sensible Grid
    // cover. PDFs still exist in this same project-wide media_assets table
    // (via the Content page's own upload), just never surfaced here --
    // Grid's own rendering/types stay exactly "image" | "video" throughout,
    // unchanged.
    { data: allMediaAssets },
    // Isolated the same way as socialLinks above -- folder_id/media_folders
    // are new and may not exist yet on a not-yet-migrated database, and
    // PostgREST fails the whole select if any referenced column/table is
    // missing. A failed lookup here just means no folders show yet, not a
    // broken Grid page.
    { data: mediaFolderRows },
    shareData,
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("projects")
      .select(
        "name, brand_notes, content_pillars, ig_username, ig_display_name, ig_bio, ig_website_link, industry, platform, posts_per_week, stories_per_week, reels_per_week, newsletter_per_week, profile_photo_path",
      )
      .eq("id", projectId)
      .single(),
    supabase.from("projects").select("instagram_url, tiktok_url").eq("id", projectId).maybeSingle(),
    getGridRowsWithCoverPaths(supabase, projectId),
    supabase
      .from("media_assets")
      .select("id, storage_path, media_type, poster_storage_path, created_at")
      .eq("project_id", projectId)
      .neq("media_type", "pdf")
      .order("created_at", { ascending: false }),
    supabase.from("media_folders").select("id, name").eq("project_id", projectId).order("created_at", { ascending: true }),
    getShareLinksData(supabase, projectId),
  ]);

  const mediaFolders: MediaFolder[] = (mediaFolderRows ?? []).map((f) => ({ id: f.id, name: f.name }));
  const assetIds = (allMediaAssets ?? []).map((a) => a.id);
  // Which assets already occupy a slot on the Grid, for the always-visible
  // "already on the Grid" badge on the media library -- scoped to posts
  // that actually have a grid_slots row (not just any post in the
  // project), since a post can exist without being placed on the grid yet.
  const gridPostIds = Array.from(
    new Set(
      gridRowsWithPaths.flatMap((row) => row.slots.map((slot) => slot.postId).filter((id): id is string => Boolean(id))),
    ),
  );

  // Wave 2 -- each of these needs one specific result from wave 1
  // (user.id, project.profile_photo_path, assetIds, or gridPostIds), but
  // none of them need each other's result, so they still all go out at
  // once rather than one after another.
  const [
    { data: membership },
    profilePhotoUrl,
    { data: folderAssignmentRows },
    // Isolated the same way as folder_id above -- archived is an even newer
    // column, and a plain .eq("archived", false) filter on the MAIN select
    // above would fail (and silently return nothing, since only `data` is
    // read) the instant it doesn't exist yet on a not-yet-migrated
    // database, wiping out the entire library rather than just not
    // filtering archived assets out yet. A failed/empty lookup here means
    // nothing gets excluded, not that everything disappears.
    { data: archivedRows },
    // Isolated the same way -- thumbnail_storage_path is a new column that
    // may not exist yet on a not-yet-migrated database. A missing/failed
    // lookup here just means the library sidebar shows full originals
    // until the migration runs, never a broken page.
    { data: thumbnailRows },
    { data: gridAssetRows },
  ] = await Promise.all([
    supabase
      .from("project_members")
      .select("role, custom_permissions")
      .eq("project_id", projectId)
      .eq("user_id", user!.id)
      .single(),
    getCachedSignedUrl(supabase, "project-media", project?.profile_photo_path),
    assetIds.length
      ? supabase.from("media_assets").select("id, folder_id").in("id", assetIds)
      : Promise.resolve({ data: [] }),
    assetIds.length
      ? supabase.from("media_assets").select("id, archived").in("id", assetIds)
      : Promise.resolve({ data: [] }),
    assetIds.length
      ? supabase.from("media_assets").select("id, thumbnail_storage_path").in("id", assetIds)
      : Promise.resolve({ data: [] }),
    gridPostIds.length
      ? supabase.from("post_assets").select("media_asset_id").in("post_id", gridPostIds)
      : Promise.resolve({ data: [] }),
  ]);

  if (!membership || !hasPagePermission(membership.role, membership.custom_permissions, "grid")) {
    return <AccessRestricted />;
  }

  // "Ordinary content editing" capability, not "genuinely privileged" --
  // Member (editor) can use Grid normally, matching the RLS widening in
  // supabase/fix_project_role_permission_presets.sql's Section 2.
  const canManage = canEditContent(membership.role);

  const folderIdByAssetId = new Map((folderAssignmentRows ?? []).map((r) => [r.id, r.folder_id as string | null]));

  const archivedIds = new Set((archivedRows ?? []).filter((r) => r.archived).map((r) => r.id));
  const mediaAssets = (allMediaAssets ?? []).filter((a) => !archivedIds.has(a.id));

  const thumbnailPathByAssetId = new Map(
    (thumbnailRows ?? []).map((r) => [r.id, (r as { thumbnail_storage_path: string | null }).thumbnail_storage_path]),
  );

  const usedInGridIds = new Set((gridAssetRows ?? []).map((r) => r.media_asset_id));

  const allPaths = new Set<string>();
  for (const asset of mediaAssets ?? []) {
    const thumb = thumbnailPathByAssetId.get(asset.id);
    if (thumb) {
      allPaths.add(thumb);
    } else {
      // Only sign the original when there's no thumbnail to prefer instead
      // -- mediaLibrary's own url mapping below never reads the original's
      // signed URL once a thumbnail exists, so minting one for every
      // already-thumbnail'd asset was pure wasted Storage API work on every
      // page load, for a URL the client would never actually use.
      allPaths.add(asset.storage_path);
    }
  }
  for (const row of gridRowsWithPaths) {
    for (const slot of row.slots) {
      if (slot.coverStoragePath) allPaths.add(slot.coverStoragePath);
      if (slot.coverDisplayPath) allPaths.add(slot.coverDisplayPath);
      // coverOriginalUrl is read client-side by the video poster self-heal
      // effect AND by Grid's direct Paste Style engine (grid-board.tsx /
      // annotation-engine.ts) -- the latter needs a fresh, currently-valid
      // signed original for BOTH image and video covers, since restoring a
      // target's saved annotation_json requires patching its base photo's
      // (possibly hours-old, expired) signed src with a live one -- see
      // annotation-editor.tsx's own "SIGNED url refresh" comment for why
      // that patch is necessary. Previously only signed for video, which
      // made every Paste Style onto an image cover fail target resolution
      // with a false "no image to paste onto" error.
      if (slot.coverOriginalPath) allPaths.add(slot.coverOriginalPath);
    }
  }

  const urlByPath = await getCachedSignedUrls(supabase, "project-media", Array.from(allPaths));

  const gridRows: GridBoardRow[] = gridRowsWithPaths.map((row) => ({
    id: row.rowId,
    slots: row.slots.map((slot) => ({
      id: slot.slotId,
      postId: slot.postId,
      // The small generated thumbnail when one exists, not the (possibly
      // 10s of MB) original -- coverStoragePath itself stays full quality
      // for the export/export-pdf routes, which read grid-data.ts's own
      // return value directly rather than this page's mapped GridBoardRow.
      thumbnailUrl: slot.coverDisplayPath ? urlByPath.get(slot.coverDisplayPath) ?? null : null,
      coverMediaType: slot.coverMediaType,
      coverMediaAssetId: slot.coverMediaAssetId,
      coverOriginalUrl: slot.coverOriginalPath ? urlByPath.get(slot.coverOriginalPath) ?? null : null,
      assetCount: slot.assetCount,
      coverTransform: slot.coverTransform,
      scheduledDate: slot.scheduledDate,
    })),
  }));

  const mediaLibrary: MediaLibraryItem[] = (mediaAssets ?? []).map((asset) => {
    const thumbPath = thumbnailPathByAssetId.get(asset.id);
    return {
    id: asset.id,
    // Same thumbnail-over-original preference as the grid slots above --
    // this sidebar renders every library asset at once, so it's the other
    // place a full-size original for a small tile mattered most.
    url: (thumbPath ? urlByPath.get(thumbPath) : undefined) ?? urlByPath.get(asset.storage_path) ?? null,
    mediaType: asset.media_type,
    // Kept alongside the signed url (not just the url) so an undone delete
    // can restore this exact asset without re-uploading -- see
    // restoreMediaAsset in lib/actions/grid.ts.
    storagePath: asset.storage_path,
    posterStoragePath: asset.poster_storage_path ?? null,
    usedInGrid: usedInGridIds.has(asset.id),
    folderId: folderIdByAssetId.get(asset.id) ?? null,
    };
  });

  return (
    <GridBoard
      projectId={projectId}
      projectName={project?.name ?? ""}
      brandNotes={project?.brand_notes ?? ""}
      contentPillars={project?.content_pillars ?? ""}
      igUsername={project?.ig_username ?? ""}
      igDisplayName={project?.ig_display_name ?? ""}
      igBio={project?.ig_bio ?? ""}
      websiteUrl={project?.ig_website_link ?? ""}
      industry={project?.industry ?? ""}
      platform={project?.platform ?? "instagram"}
      instagramUrl={socialLinks?.instagram_url ?? ""}
      tiktokUrl={socialLinks?.tiktok_url ?? ""}
      profilePhotoUrl={profilePhotoUrl}
      postsPerWeek={project?.posts_per_week ?? 0}
      storiesPerWeek={project?.stories_per_week ?? 0}
      reelsPerWeek={project?.reels_per_week ?? 0}
      newsletterPerWeek={project?.newsletter_per_week ?? 0}
      rows={gridRows}
      mediaLibrary={mediaLibrary}
      mediaFolders={mediaFolders}
      canManage={canManage}
      shareLinks={shareData.links}
      shareTableMissing={shareData.tableMissing}
    />
  );
}
