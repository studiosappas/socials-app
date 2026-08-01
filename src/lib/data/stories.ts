import { createClient } from "@/lib/supabase/server";
import type { MediaLibraryItem } from "@/app/projects/[projectId]/grid/grid-board";

const SIGNED_URL_TTL_SECONDS = 3600;

export type StoryFrameItem = {
  frameId: string;
  mediaAssetId: string | null;
  url: string | null;
  mediaType: "image" | "video";
  linkUrl: string | null;
};

export type StoryPageData = {
  story: { id: string; name: string; scheduled_date: string | null };
  frames: StoryFrameItem[];
  mediaLibrary: MediaLibraryItem[];
  canManage: boolean;
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
    .select("id, name, scheduled_date")
    .eq("id", storyId)
    .single();

  if (!story) return null;

  const { data: frames } = await supabase
    .from("story_frames")
    .select("id, position, link_url, media_assets(id, storage_path, media_type)")
    .eq("story_id", storyId)
    .order("position");

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

  return { story, frames: frameItems, mediaLibrary, canManage };
}
