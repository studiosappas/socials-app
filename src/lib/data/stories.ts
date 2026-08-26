import { createClient } from "@/lib/supabase/server";
import type { MediaLibraryItem } from "@/app/projects/[projectId]/grid/grid-board";
import { getProjectMemberOptions, type ProjectMemberOption } from "@/lib/data/post-comments";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import { canEditContent } from "@/lib/role-permissions";
import { mergeWorkspaceSettings, type WorkspaceSettings } from "@/lib/account-settings";
import type { StoryStatus, MediaType, ProjectRole, ReviewStatus } from "@/types/database";

export type StoryFrameItem = {
  frameId: string;
  mediaAssetId: string | null;
  url: string | null;
  mediaType: MediaType;
  linkUrl: string | null;
};

export type StoryLinkItem = { id: string; url: string; label: string };

export type StoryPageData = {
  story: {
    id: string;
    name: string;
    scheduled_date: string | null;
    status: StoryStatus;
    review_status: ReviewStatus;
    notes: string;
  };
  frames: StoryFrameItem[];
  links: StoryLinkItem[];
  mediaLibrary: MediaLibraryItem[];
  canManage: boolean;
  // The raw role, alongside the derived canManage -- see PostCoreData's
  // identical field for why (Client's own narrow Approval Status control).
  role: ProjectRole;
  currentUserId: string;
  members: ProjectMemberOption[];
  // The viewer's own saved Settings > Workspace preference (account-settings.ts),
  // already defaulted -- see PostCoreData's identical field.
  dateFormat: WorkspaceSettings["date_format"];
};

export async function getStoryPageData(
  projectId: string,
  storyId: string,
): Promise<StoryPageData | null> {
  const supabase = await createClient();

  // Everything in this wave is mutually independent -- story/frames/
  // storyLinks only need storyId, allMediaAssets/members only need
  // projectId, and getUser() needs neither. membership needs user.id (not
  // known until this resolves), so it can't join this wave.
  const [
    {
      data: { user },
    },
    { data: story },
    { data: frames },
    { data: storyLinks },
    { data: allMediaAssets },
    members,
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("stories").select("id, name, scheduled_date, status, review_status, notes").eq("id", storyId).single(),
    supabase
      .from("story_frames")
      .select("id, position, link_url, media_assets(id, storage_path, media_type, poster_storage_path, thumbnail_storage_path)")
      .eq("story_id", storyId)
      .order("position"),
    // Queried independently of the critical `story` fetch above -- story_links
    // is a separate table, so if it isn't live yet this just yields an empty
    // Links section instead of 404-ing the whole page.
    supabase.from("story_links").select("id, url, label").eq("story_id", storyId),
    // Excludes 'pdf' -- this feeds the editor's "reuse an existing asset"
    // frame picker (mediaLibrary below), and a PDF doesn't make sense as a
    // swipeable Story frame the same way a video/image does. A PDF still
    // reaches this project's media_assets table fine (via the Content
    // page's own upload), it's just never offered here as something to
    // drop into a frame slot -- same scoping Grid's and Post Editor's own
    // "add from library" pickers use (see grid/page.tsx, data/posts.ts).
    supabase
      .from("media_assets")
      .select("id, storage_path, media_type")
      .eq("project_id", projectId)
      .neq("media_type", "pdf")
      .order("created_at", { ascending: false }),
    getProjectMemberOptions(supabase, projectId),
  ]);

  if (!story) return null;

  // membership needs user.id (just resolved above); the archived check
  // needs allMediaAssets' ids (also just resolved above) -- independent of
  // each other, so one wave instead of two more sequential round trips.
  // Isolated from the media_assets select above -- archived is a newer
  // column that may not exist yet on a not-yet-migrated database, and a
  // plain .eq() filter on the main select would fail (silently returning
  // nothing, since only `data` is read) the instant it doesn't exist,
  // wiping out the whole library instead of just not filtering archived
  // assets out yet.
  const allMediaIdsForArchiveCheck = (allMediaAssets ?? []).map((a) => a.id);
  const [{ data: membership }, { data: archivedRows }, { data: profile }] = await Promise.all([
    supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user!.id).single(),
    allMediaIdsForArchiveCheck.length
      ? supabase.from("media_assets").select("id, archived").in("id", allMediaIdsForArchiveCheck)
      : Promise.resolve({ data: [] }),
    supabase.from("profiles").select("workspace_settings").eq("id", user!.id).single(),
  ]);
  const role: ProjectRole = membership?.role ?? "viewer";
  const canManage = canEditContent(role);
  const { date_format: dateFormat } = mergeWorkspaceSettings(profile?.workspace_settings);
  const archivedIds = new Set((archivedRows ?? []).filter((r) => r.archived).map((r) => r.id));
  const mediaAssets = (allMediaAssets ?? []).filter((a) => !archivedIds.has(a.id));

  type FrameMedia = {
    id: string;
    storage_path: string;
    media_type: MediaType;
    poster_storage_path: string | null;
    thumbnail_storage_path: string | null;
  };

  const allPaths = new Set<string>();
  for (const asset of mediaAssets ?? []) allPaths.add(asset.storage_path);
  for (const frame of frames ?? []) {
    const media = frame.media_assets as FrameMedia | null;
    if (!media) continue;
    allPaths.add(media.storage_path);
    if (media.poster_storage_path) allPaths.add(media.poster_storage_path);
    if (media.thumbnail_storage_path) allPaths.add(media.thumbnail_storage_path);
  }

  const urlByPath = await getCachedSignedUrls(supabase, "project-media", Array.from(allPaths));

  // `url` stays the raw original -- the editor's own frame preview
  // (story-editor.tsx) already branches on mediaType to show a real <video>
  // for video, so it never needed a poster substitute the way this page's
  // card-cover query did (see stories/page.tsx's identical split for the
  // full reasoning). A PDF frame has no live-embed branch there, so its
  // small tile uses the poster too, matching that page's cover treatment.
  const frameItems: StoryFrameItem[] = (frames ?? []).map((frame) => {
    const media = frame.media_assets as FrameMedia | null;
    const coverPath =
      media?.media_type === "pdf" ? media.poster_storage_path : null;
    return {
      frameId: frame.id,
      mediaAssetId: media?.id ?? null,
      url: media ? (coverPath ? urlByPath.get(coverPath) ?? null : urlByPath.get(media.storage_path) ?? null) : null,
      mediaType: media?.media_type ?? "image",
      linkUrl: frame.link_url,
    };
  });

  const mediaLibrary: MediaLibraryItem[] = (mediaAssets ?? []).map((asset) => ({
    id: asset.id,
    url: urlByPath.get(asset.storage_path) ?? null,
    mediaType: asset.media_type,
  }));

  const links: StoryLinkItem[] = (storyLinks ?? []).map((l) => ({ id: l.id, url: l.url, label: l.label }));

  return { story, frames: frameItems, links, mediaLibrary, canManage, role, currentUserId: user!.id, members, dateFormat };
}
