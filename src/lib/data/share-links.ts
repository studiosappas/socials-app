import { createClient } from "@/lib/supabase/server";

const SIGNED_URL_TTL_SECONDS = 3600;

export type ShareLinkItem = {
  id: string;
  token: string;
  title: string;
  createdAt: string;
  itemCount: number;
};

export type PickerPost = {
  id: string;
  postType: string;
  caption: string;
  status: string;
  scheduledDate: string | null;
  assetCount: number;
  thumbnailUrl: string | null;
};

export type PickerStory = {
  id: string;
  name: string;
  status: string;
  scheduledDate: string | null;
  thumbnailUrl: string | null;
};

export type ShareLinksData = {
  links: ShareLinkItem[];
  posts: PickerPost[];
  stories: PickerStory[];
  tableMissing: boolean;
};

// Shared by both Grid's and Stories' Share menu -- either page can create a
// link over any combination of posts + stories, not just its own content
// type, so both need the same full picker data.
export async function getShareLinksData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<ShareLinksData> {
  // Isolated: share_links/share_link_items are a newer table pair that may
  // not exist yet on a not-yet-migrated database. A missing table degrades
  // to an empty list + a clear message in the dialog instead of failing the
  // whole page.
  const { data: linkRows, error: linksError } = await supabase
    .from("share_links")
    .select("id, token, title, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const linkIds = (linkRows ?? []).map((l) => l.id);
  const { data: itemRows } = linkIds.length
    ? await supabase.from("share_link_items").select("share_link_id").in("share_link_id", linkIds)
    : { data: [] };

  const countByLink = new Map<string, number>();
  for (const item of itemRows ?? []) {
    countByLink.set(item.share_link_id, (countByLink.get(item.share_link_id) ?? 0) + 1);
  }

  const links: ShareLinkItem[] = (linkRows ?? []).map((l) => ({
    id: l.id,
    token: l.token,
    title: l.title,
    createdAt: l.created_at,
    itemCount: countByLink.get(l.id) ?? 0,
  }));

  const { data: posts } = await supabase
    .from("posts")
    .select("id, post_type, caption, status, scheduled_date")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const { data: stories } = await supabase
    .from("stories")
    .select("id, name, status, scheduled_date")
    .eq("project_id", projectId)
    .order("position");

  const postIds = (posts ?? []).map((p) => p.id);
  const { data: postAssets } = postIds.length
    ? await supabase
        .from("post_assets")
        .select("post_id, position, media_assets(storage_path)")
        .in("post_id", postIds)
        .order("position")
    : { data: [] };

  const storyIds = (stories ?? []).map((s) => s.id);
  const { data: storyFrames } = storyIds.length
    ? await supabase
        .from("story_frames")
        .select("story_id, position, media_assets(storage_path)")
        .in("story_id", storyIds)
        .order("position")
    : { data: [] };

  const coverPathByPost = new Map<string, string>();
  const postAssetCounts = new Map<string, number>();
  for (const pa of postAssets ?? []) {
    postAssetCounts.set(pa.post_id, (postAssetCounts.get(pa.post_id) ?? 0) + 1);
    if (!coverPathByPost.has(pa.post_id)) {
      const path = (pa.media_assets as { storage_path: string } | null)?.storage_path;
      if (path) coverPathByPost.set(pa.post_id, path);
    }
  }

  const coverPathByStory = new Map<string, string>();
  for (const sf of storyFrames ?? []) {
    if (!coverPathByStory.has(sf.story_id)) {
      const path = (sf.media_assets as { storage_path: string } | null)?.storage_path;
      if (path) coverPathByStory.set(sf.story_id, path);
    }
  }

  const allPaths = Array.from(new Set([...coverPathByPost.values(), ...coverPathByStory.values()]));
  const { data: signedUrls } = allPaths.length
    ? await supabase.storage.from("project-media").createSignedUrls(allPaths, SIGNED_URL_TTL_SECONDS)
    : { data: [] };
  const urlByPath = new Map<string, string>();
  for (const entry of signedUrls ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  const pickerPosts: PickerPost[] = (posts ?? []).map((p) => ({
    id: p.id,
    postType: p.post_type,
    caption: p.caption,
    status: p.status,
    scheduledDate: p.scheduled_date,
    assetCount: postAssetCounts.get(p.id) ?? 0,
    thumbnailUrl: coverPathByPost.has(p.id) ? urlByPath.get(coverPathByPost.get(p.id)!) ?? null : null,
  }));

  const pickerStories: PickerStory[] = (stories ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    scheduledDate: s.scheduled_date,
    thumbnailUrl: coverPathByStory.has(s.id) ? urlByPath.get(coverPathByStory.get(s.id)!) ?? null : null,
  }));

  return { links, posts: pickerPosts, stories: pickerStories, tableMissing: Boolean(linksError) };
}
