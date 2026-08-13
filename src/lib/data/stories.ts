import { createClient } from "@/lib/supabase/server";
import type { MediaLibraryItem } from "@/app/projects/[projectId]/grid/grid-board";
import { getProjectMemberOptions, type ProjectMemberOption } from "@/lib/data/post-comments";

const SIGNED_URL_TTL_SECONDS = 3600;

export type StoryFrameItem = {
  frameId: string;
  mediaAssetId: string | null;
  url: string | null;
  mediaType: "image" | "video";
  linkUrl: string | null;
};

export type StoryLinkItem = { id: string; url: string; label: string };

export type StoryPageData = {
  story: {
    id: string;
    name: string;
    scheduled_date: string | null;
    status: "draft" | "scheduled" | "published";
    notes: string;
  };
  frames: StoryFrameItem[];
  links: StoryLinkItem[];
  mediaLibrary: MediaLibraryItem[];
  canManage: boolean;
  currentUserId: string;
  members: ProjectMemberOption[];
};

export async function getStoryPageData(
  projectId: string,
  storyId: string,
): Promise<StoryPageData | null> {
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

  const { data: story } = await supabase
    .from("stories")
    .select("id, name, scheduled_date, status, notes")
    .eq("id", storyId)
    .single();

  if (!story) return null;

  const { data: frames } = await supabase
    .from("story_frames")
    .select("id, position, link_url, media_assets(id, storage_path, media_type)")
    .eq("story_id", storyId)
    .order("position");

  // Queried independently of the critical `story` fetch above -- story_links
  // is a separate table, so if it isn't live yet this just yields an empty
  // Links section instead of 404-ing the whole page.
  const { data: storyLinks } = await supabase
    .from("story_links")
    .select("id, url, label")
    .eq("story_id", storyId);

  const { data: mediaAssets } = await supabase
    .from("media_assets")
    .select("id, storage_path, media_type")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const allPaths = new Set<string>();
  for (const asset of mediaAssets ?? []) allPaths.add(asset.storage_path);
  for (const frame of frames ?? []) {
    const media = frame.media_assets as { storage_path: string } | null;
    if (media) allPaths.add(media.storage_path);
  }

  const pathList = Array.from(allPaths);
  const { data: signedUrls } = pathList.length
    ? await supabase.storage.from("project-media").createSignedUrls(pathList, SIGNED_URL_TTL_SECONDS)
    : { data: [] };

  const urlByPath = new Map<string, string>();
  for (const entry of signedUrls ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  const frameItems: StoryFrameItem[] = (frames ?? []).map((frame) => {
    const media = frame.media_assets as { id: string; storage_path: string; media_type: string } | null;
    return {
      frameId: frame.id,
      mediaAssetId: media?.id ?? null,
      url: media ? urlByPath.get(media.storage_path) ?? null : null,
      mediaType: (media?.media_type as "image" | "video") ?? "image",
      linkUrl: frame.link_url,
    };
  });

  const mediaLibrary: MediaLibraryItem[] = (mediaAssets ?? []).map((asset) => ({
    id: asset.id,
    url: urlByPath.get(asset.storage_path) ?? null,
    mediaType: asset.media_type,
  }));

  const links: StoryLinkItem[] = (storyLinks ?? []).map((l) => ({ id: l.id, url: l.url, label: l.label }));

  const members = await getProjectMemberOptions(supabase, projectId);

  return { story, frames: frameItems, links, mediaLibrary, canManage, currentUserId: user!.id, members };
}
