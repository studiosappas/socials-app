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
      "name, brand_notes, platform, ig_username, ig_display_name, ig_bio, ig_posts_count, ig_followers_count, ig_following_count, ig_website_link, ig_handle, profile_photo_path, show_scheduled_dates",
    )
    .eq("id", projectId)
    .single();

  const { count: postsCount } = await supabase
    .from("grid_slots")
    .select("id, grid_rows!inner(project_id)", { count: "exact", head: true })
    .eq("grid_rows.project_id", projectId)
    .not("post_id", "is", null);

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
    .select("id, storage_path, media_type, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const allPaths = new Set<string>();
  for (const asset of mediaAssets ?? []) allPaths.add(asset.storage_path);
  for (const row of gridRowsWithPaths) {
    for (const slot of row.slots) {
      if (slot.coverStoragePath) allPaths.add(slot.coverStoragePath);
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
      assetCount: slot.assetCount,
    })),
  }));

  const mediaLibrary: MediaLibraryItem[] = (mediaAssets ?? []).map((asset) => ({
    id: asset.id,
    url: urlByPath.get(asset.storage_path) ?? null,
    mediaType: asset.media_type,
  }));

  return (
    <GridBoard
      projectId={projectId}
      projectName={project?.name ?? ""}
      brandNotes={project?.brand_notes ?? ""}
      platform={project?.platform ?? "instagram"}
      igUsername={project?.ig_username ?? ""}
      igDisplayName={project?.ig_display_name ?? ""}
      igBio={project?.ig_bio ?? ""}
      igPostsCount={project?.ig_posts_count ?? 0}
      igFollowersCount={project?.ig_followers_count ?? 0}
      igFollowingCount={project?.ig_following_count ?? 0}
      igWebsiteLink={project?.ig_website_link ?? ""}
      igHandle={project?.ig_handle ?? ""}
      profilePhotoUrl={profilePhotoUrl}
      showScheduledDates={project?.show_scheduled_dates ?? true}
      postsCount={postsCount ?? 0}
      rows={gridRows}
      mediaLibrary={mediaLibrary}
      canManage={canManage}
    />
  );
}
