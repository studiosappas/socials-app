import { createClient } from "@/lib/supabase/server";
import { getGridRowsWithCoverPaths } from "@/lib/grid-data";
import { GridBoard, type GridBoardRow, type MediaLibraryItem } from "./grid-board";

const SIGNED_URL_TTL_SECONDS = 3600;

export default async function GridPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
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

  const { data: project } = await supabase
    .from("projects")
    .select(
      "name, brand_notes, content_pillars, ig_username, ig_display_name, ig_bio, ig_website_link, industry, platform, posts_per_week, stories_per_week, reels_per_week, newsletter_per_week, profile_photo_path",
    )
    .eq("id", projectId)
    .single();

  // Isolated from the select above -- instagram_url/tiktok_url are new
  // columns that may not exist yet on a not-yet-migrated database, and
  // PostgREST fails the whole select if any referenced column is missing.
  const { data: socialLinks } = await supabase
    .from("projects")
    .select("instagram_url, tiktok_url")
    .eq("id", projectId)
    .maybeSingle();

  const profilePhotoUrl = project?.profile_photo_path
    ? (
        await supabase.storage
          .from("project-media")
          .createSignedUrl(project.profile_photo_path, SIGNED_URL_TTL_SECONDS)
      ).data?.signedUrl ?? null
    : null;

  const gridRowsWithPaths = await getGridRowsWithCoverPaths(supabase, projectId);

  const { data: mediaAssets } = await supabase
    .from("media_assets")
    .select("id, storage_path, media_type, poster_storage_path, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const allPaths = new Set<string>();
  for (const asset of mediaAssets ?? []) allPaths.add(asset.storage_path);
  for (const row of gridRowsWithPaths) {
    for (const slot of row.slots) {
      if (slot.coverStoragePath) allPaths.add(slot.coverStoragePath);
      if (slot.coverOriginalPath) allPaths.add(slot.coverOriginalPath);
    }
  }

  const pathList = Array.from(allPaths);
  const { data: signedUrls } = pathList.length
    ? await supabase.storage
        .from("project-media")
        .createSignedUrls(pathList, SIGNED_URL_TTL_SECONDS)
    : { data: [] };

  const urlByPath = new Map<string, string>();
  for (const entry of signedUrls ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  const gridRows: GridBoardRow[] = gridRowsWithPaths.map((row) => ({
    id: row.rowId,
    slots: row.slots.map((slot) => ({
      id: slot.slotId,
      postId: slot.postId,
      thumbnailUrl: slot.coverStoragePath ? urlByPath.get(slot.coverStoragePath) ?? null : null,
      coverMediaType: slot.coverMediaType,
      coverMediaAssetId: slot.coverMediaAssetId,
      coverOriginalUrl: slot.coverOriginalPath ? urlByPath.get(slot.coverOriginalPath) ?? null : null,
      assetCount: slot.assetCount,
      coverTransform: slot.coverTransform,
    })),
  }));

  const mediaLibrary: MediaLibraryItem[] = (mediaAssets ?? []).map((asset) => ({
    id: asset.id,
    url: urlByPath.get(asset.storage_path) ?? null,
    mediaType: asset.media_type,
    // Kept alongside the signed url (not just the url) so an undone delete
    // can restore this exact asset without re-uploading -- see
    // restoreMediaAsset in lib/actions/grid.ts.
    storagePath: asset.storage_path,
    posterStoragePath: asset.poster_storage_path ?? null,
  }));

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
      canManage={canManage}
    />
  );
}
