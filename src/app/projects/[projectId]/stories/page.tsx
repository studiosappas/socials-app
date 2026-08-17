import { createClient } from "@/lib/supabase/server";
import { getShareLinksData } from "@/lib/data/share-links";
import { StoriesBoard } from "./stories-board";

const SIGNED_URL_TTL_SECONDS = 3600;

export default async function StoriesPage({
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

  const { data: stories } = await supabase
    .from("stories")
    .select("id, name, scheduled_date, notes, position, status")
    .eq("project_id", projectId)
    .order("position");

  const storyIds = (stories ?? []).map((s) => s.id);

  // Isolated from the select above -- folder_id/content_folders are new,
  // possibly-not-yet-migrated additions. A .select("...folder_id") that fails
  // because the column doesn't exist yet would wipe out the *entire* stories
  // list (only `data` is read, and it comes back null on error), not just
  // the folder grouping -- same reasoning as the archived-check isolation
  // in lib/data/stories.ts. If either fetch fails, everything just renders
  // as ungrouped/no folders instead of an empty page.
  const { data: folderIdRows } = storyIds.length
    ? await supabase.from("stories").select("id, folder_id").in("id", storyIds)
    : { data: [] };
  const folderIdByStory = new Map((folderIdRows ?? []).map((r) => [r.id, r.folder_id]));

  const { data: folders } = await supabase
    .from("content_folders")
    .select("id, name, created_at")
    .eq("project_id", projectId)
    .order("created_at");

  const { data: frames } = storyIds.length
    ? await supabase
        .from("story_frames")
        .select("id, story_id, position, media_assets(storage_path, media_type)")
        .in("story_id", storyIds)
        .order("position")
    : { data: [] };

  const pathList = Array.from(
    new Set(
      (frames ?? [])
        .map((f) => (f.media_assets as { storage_path: string } | null)?.storage_path)
        .filter((p): p is string => Boolean(p)),
    ),
  );

  const { data: signedUrls } = pathList.length
    ? await supabase.storage.from("project-media").createSignedUrls(pathList, SIGNED_URL_TTL_SECONDS)
    : { data: [] };

  const urlByPath = new Map<string, string>();
  for (const entry of signedUrls ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  // Frames arrive already ordered by `position` (the query above), so each
  // story's `files` array here is in the same order the editor shows them --
  // files[0] doubles as the card thumbnail, and the full array lets the card
  // menu's "Download" zip up every file in the item and the full-view preview
  // step through them, not just show the cover.
  const framesByStory = new Map<string, { url: string; mediaType: "image" | "video" }[]>();
  for (const frame of frames ?? []) {
    const media = frame.media_assets as { storage_path: string; media_type: "image" | "video" } | null;
    const url = media ? urlByPath.get(media.storage_path) ?? null : null;
    if (!url || !media) continue;
    const entry = { url, mediaType: media.media_type };
    const existing = framesByStory.get(frame.story_id);
    if (existing) existing.push(entry);
    else framesByStory.set(frame.story_id, [entry]);
  }

  const storyItems = (stories ?? []).map((story) => ({
    id: story.id,
    name: story.name,
    scheduledDate: story.scheduled_date,
    notes: story.notes,
    status: story.status,
    thumbnailUrl: framesByStory.get(story.id)?.[0]?.url ?? null,
    files: framesByStory.get(story.id) ?? [],
    folderId: folderIdByStory.get(story.id) ?? null,
  }));

  // A folder's cover is never set manually -- it's always the thumbnail of
  // whichever content item landed in it first. `storyItems` is already in
  // `position` order (from the ordered `stories` query above), so the first
  // match per folder found while walking that order is that folder's oldest
  // item, same idea as each story's own thumbnail already being its first
  // frame.
  const folderCoverByFolder = new Map<string, string | null>();
  for (const story of storyItems) {
    if (!story.folderId || folderCoverByFolder.has(story.folderId)) continue;
    folderCoverByFolder.set(story.folderId, story.thumbnailUrl);
  }

  const folderItems = (folders ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    coverUrl: folderCoverByFolder.get(f.id) ?? null,
  }));

  const shareData = await getShareLinksData(supabase, projectId);

  return (
    <StoriesBoard
      projectId={projectId}
      stories={storyItems}
      folders={folderItems}
      canManage={canManage}
      shareLinks={shareData.links}
      shareTableMissing={shareData.tableMissing}
    />
  );
}
