import { createClient } from "@/lib/supabase/server";
import { getShareLinksData } from "@/lib/data/share-links";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import { canEditContent, hasPagePermission } from "@/lib/role-permissions";
import { StoriesBoard } from "./stories-board";
import { AccessRestricted } from "../access-restricted";
import type { MediaType } from "@/types/database";

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
    .select("role, custom_permissions")
    .eq("project_id", projectId)
    .eq("user_id", user!.id)
    .single();

  if (!membership || !hasPagePermission(membership.role, membership.custom_permissions, "stories")) {
    return <AccessRestricted />;
  }

  // Ordinary content-editing capability, not "genuinely privileged" -- see
  // grid/page.tsx's identical comment.
  const canManage = canEditContent(membership.role);

  const { data: stories } = await supabase
    .from("stories")
    .select("id, name, scheduled_date, notes, position, status, created_at")
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
        .select("id, story_id, position, media_assets(storage_path, media_type, poster_storage_path, thumbnail_storage_path)")
        .in("story_id", storyIds)
        .order("position")
    : { data: [] };

  type FrameMedia = {
    storage_path: string;
    media_type: MediaType;
    poster_storage_path: string | null;
    thumbnail_storage_path: string | null;
  };

  const pathList = Array.from(
    new Set(
      (frames ?? []).flatMap((f) => {
        const m = f.media_assets as FrameMedia | null;
        if (!m) return [];
        return [m.storage_path, m.poster_storage_path, m.thumbnail_storage_path].filter((p): p is string => Boolean(p));
      }),
    ),
  );

  const urlByPath = await getCachedSignedUrls(supabase, "project-media", pathList);

  // Frames arrive already ordered by `position` (the query above), so each
  // story's `files` array here is in the same order the editor shows them --
  // files[0] doubles as the card cover, and the full array lets the card
  // menu's "Download" zip up every file in the item and the full-view preview
  // step through them, not just show the cover. `url` here is always the raw
  // original (correct for the zoomed preview modal, video playback, and
  // Download -- all three already worked fine straight off storage_path).
  // `coverUrl` is separate and ONLY for the small card tile: a plain <img>
  // can never decode a video or PDF file directly, so those prefer their
  // generated poster (same poster_storage_path column both use); an image
  // prefers its small generated thumbnail, falling back to the full
  // original for anything uploaded before either existed. Exact same
  // resolved/resolvedDisplay split grid-data.ts already uses for Grid tiles.
  const framesByStory = new Map<string, { url: string; mediaType: MediaType; coverUrl: string | null }[]>();
  for (const frame of frames ?? []) {
    const media = frame.media_assets as FrameMedia | null;
    const url = media ? urlByPath.get(media.storage_path) ?? null : null;
    if (!url || !media) continue;
    const coverPath =
      media.media_type === "video" || media.media_type === "pdf"
        ? media.poster_storage_path
        : media.thumbnail_storage_path || media.storage_path;
    const coverUrl = coverPath ? urlByPath.get(coverPath) ?? null : null;
    const entry = { url, mediaType: media.media_type, coverUrl };
    const existing = framesByStory.get(frame.story_id);
    if (existing) existing.push(entry);
    else framesByStory.set(frame.story_id, [entry]);
  }

  const storyItems = (stories ?? []).map((story) => {
    const files = framesByStory.get(story.id) ?? [];
    return {
      id: story.id,
      name: story.name,
      scheduledDate: story.scheduled_date,
      // The authoritative "when was this content created" value for both
      // sort and the month filter -- stories.created_at, set once at
      // insert and never touched again (unlike scheduled_date, which is
      // often null for a draft and doesn't reflect authoring time at all).
      // Loose assets and clusters are both plain `stories` rows -- there's
      // no separate "asset" entity with its own timestamp, so this is the
      // one date source for either case.
      createdDate: story.created_at,
      notes: story.notes,
      status: story.status,
      thumbnailUrl: files[0]?.coverUrl ?? null,
      // A video/PDF whose poster generation failed (or was uploaded before
      // this existed) has no coverUrl but IS still a real, known media type
      // -- the card shows a typed placeholder instead of silently looking
      // "Empty" (see StoryCard's coverMediaType prop).
      coverMediaType: files[0]?.mediaType ?? null,
      files: files.map((f) => ({ url: f.url, mediaType: f.mediaType })),
      folderId: folderIdByStory.get(story.id) ?? null,
    };
  });

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
