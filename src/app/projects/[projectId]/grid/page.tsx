import { createClient } from "@/lib/supabase/server";
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

  const { data: rows } = await supabase
    .from("grid_rows")
    .select("id, position")
    .eq("project_id", projectId)
    .order("position");

  const rowIds = (rows ?? []).map((r) => r.id);

  const { data: slots } = rowIds.length
    ? await supabase
        .from("grid_slots")
        .select("id, row_id, position, post_id")
        .in("row_id", rowIds)
        .order("position")
    : { data: [] };

  const postIds = (slots ?? [])
    .map((s) => s.post_id)
    .filter((id): id is string => Boolean(id));

  const { data: postAssets } = postIds.length
    ? await supabase
        .from("post_assets")
        .select("id, post_id, position, media_assets(storage_path)")
        .in("post_id", postIds)
        .order("position")
    : { data: [] };

  const { data: mediaAssets } = await supabase
    .from("media_assets")
    .select("id, storage_path, media_type, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const allPaths = new Set<string>();
  for (const asset of mediaAssets ?? []) allPaths.add(asset.storage_path);
  for (const pa of postAssets ?? []) {
    const path = (pa.media_assets as { storage_path: string } | null)?.storage_path;
    if (path) allPaths.add(path);
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

  const assetsByPost = new Map<string, { thumbnailUrl: string | null; count: number }>();
  for (const pa of postAssets ?? []) {
    const path = (pa.media_assets as { storage_path: string } | null)?.storage_path;
    const existing = assetsByPost.get(pa.post_id);
    if (!existing) {
      assetsByPost.set(pa.post_id, {
        thumbnailUrl: path ? urlByPath.get(path) ?? null : null,
        count: 1,
      });
    } else {
      existing.count += 1;
    }
  }

  const slotsByRow = new Map<string, typeof slots>();
  for (const slot of slots ?? []) {
    const list = slotsByRow.get(slot.row_id) ?? [];
    list.push(slot);
    slotsByRow.set(slot.row_id, list);
  }

  const gridRows: GridBoardRow[] = (rows ?? []).map((row) => ({
    id: row.id,
    slots: (slotsByRow.get(row.id) ?? []).map((slot) => {
      const postInfo = slot.post_id ? assetsByPost.get(slot.post_id) : undefined;
      return {
        id: slot.id,
        postId: slot.post_id,
        thumbnailUrl: postInfo?.thumbnailUrl ?? null,
        assetCount: postInfo?.count ?? 0,
      };
    }),
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
