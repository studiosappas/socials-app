import { createClient } from "@/lib/supabase/server";
import type { GalleryMedia } from "@/components/media-gallery";
import type { ReviewStatus } from "@/types/database";

const SIGNED_URL_TTL_SECONDS = 3600;

export type ReviewGalleryItem = {
  id: string;
  type: "post" | "story";
  // posts.caption / stories.notes -- shown exactly as it appears in the
  // editor, per the Review Mode spec, not paraphrased or truncated.
  caption: string;
  reviewStatus: ReviewStatus;
  media: GalleryMedia[];
};

export type ReviewGalleryData = {
  projectName: string;
  items: ReviewGalleryItem[];
};

// Authenticated, RLS-scoped read path -- unlike getSharedPreviewData (the
// anonymous /preview/[token] equivalent), this needs no SECURITY DEFINER
// RPC: a Client Reviewer is already a real project_members row, so plain
// is_project_member-gated selects already grant exactly the read access
// Review Mode needs. Whole-project scope (every post/story), not a
// curated link-selected subset -- see the plan's confirmed "Reviewer scope"
// decision.
export async function getReviewGalleryData(projectId: string): Promise<ReviewGalleryData> {
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("name").eq("id", projectId).single();

  const [{ data: posts }, { data: stories }] = await Promise.all([
    supabase
      .from("posts")
      .select("id, caption, review_status, scheduled_date, created_at")
      .eq("project_id", projectId)
      .order("scheduled_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("stories")
      .select("id, notes, review_status, scheduled_date, created_at")
      .eq("project_id", projectId)
      .order("scheduled_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
  ]);

  const postIds = (posts ?? []).map((p) => p.id);
  const storyIds = (stories ?? []).map((s) => s.id);

  const [{ data: postAssets }, { data: storyFrames }] = await Promise.all([
    postIds.length
      ? supabase
          .from("post_assets")
          .select("post_id, position, media_assets(id, storage_path, preview_storage_path, poster_storage_path, media_type)")
          .in("post_id", postIds)
          .order("position")
      : Promise.resolve({ data: [] }),
    storyIds.length
      ? supabase
          .from("story_frames")
          .select("story_id, position, media_assets(id, storage_path, preview_storage_path, poster_storage_path, media_type)")
          .in("story_id", storyIds)
          .order("position")
      : Promise.resolve({ data: [] }),
  ]);

  type AssetRow = {
    id: string;
    storage_path: string;
    preview_storage_path: string | null;
    poster_storage_path: string | null;
    media_type: "image" | "video";
  };

  const pathSet = new Set<string>();
  const collectPaths = (asset: AssetRow | null) => {
    if (!asset) return;
    pathSet.add(asset.storage_path);
    if (asset.preview_storage_path) pathSet.add(asset.preview_storage_path);
    if (asset.poster_storage_path) pathSet.add(asset.poster_storage_path);
  };
  for (const a of postAssets ?? []) collectPaths(a.media_assets as AssetRow | null);
  for (const f of storyFrames ?? []) collectPaths(f.media_assets as AssetRow | null);

  const pathList = Array.from(pathSet);
  const { data: signedUrls } = pathList.length
    ? await supabase.storage.from("project-media").createSignedUrls(pathList, SIGNED_URL_TTL_SECONDS)
    : { data: [] };

  const urlByPath = new Map<string, string>();
  for (const entry of signedUrls ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  function toGalleryMedia(asset: AssetRow | null): GalleryMedia | null {
    if (!asset) return null;
    // Same "edited preview wins" fallback used everywhere else this media
    // shows up (Grid, post editor, the anonymous preview).
    const url =
      (asset.preview_storage_path ? urlByPath.get(asset.preview_storage_path) : undefined) ??
      urlByPath.get(asset.storage_path) ??
      null;
    const posterUrl = asset.poster_storage_path ? (urlByPath.get(asset.poster_storage_path) ?? null) : null;
    return { mediaAssetId: asset.id, url, posterUrl, mediaType: asset.media_type };
  }

  const mediaByPost = new Map<string, GalleryMedia[]>();
  for (const a of postAssets ?? []) {
    const media = toGalleryMedia(a.media_assets as AssetRow | null);
    if (!media) continue;
    mediaByPost.set(a.post_id, [...(mediaByPost.get(a.post_id) ?? []), media]);
  }

  const mediaByStory = new Map<string, GalleryMedia[]>();
  for (const f of storyFrames ?? []) {
    const media = toGalleryMedia(f.media_assets as AssetRow | null);
    if (!media) continue;
    mediaByStory.set(f.story_id, [...(mediaByStory.get(f.story_id) ?? []), media]);
  }

  const items: ReviewGalleryItem[] = [
    ...(posts ?? []).map((p) => ({
      id: p.id,
      type: "post" as const,
      caption: p.caption,
      reviewStatus: p.review_status,
      media: mediaByPost.get(p.id) ?? [],
    })),
    ...(stories ?? []).map((s) => ({
      id: s.id,
      type: "story" as const,
      caption: s.notes,
      reviewStatus: s.review_status,
      media: mediaByStory.get(s.id) ?? [],
    })),
  ].filter((item) => item.media.length > 0);

  return { projectName: project?.name ?? "", items };
}

export type ReviewCommentItem = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  text: string;
  createdAt: string;
};

// Same shape/query as getTaskComments (lib/data/tasks.ts) -- visible to
// every project role (not client-only), so owner/admin can see and reply.
export async function getPostComments(itemId: string): Promise<ReviewCommentItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("post_comments")
    .select("id, author_id, text, created_at, profiles(name, avatar_url)")
    .eq("post_id", itemId)
    .order("created_at", { ascending: true });
  return mapComments(data);
}

export async function getStoryComments(itemId: string): Promise<ReviewCommentItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("story_comments")
    .select("id, author_id, text, created_at, profiles(name, avatar_url)")
    .eq("story_id", itemId)
    .order("created_at", { ascending: true });
  return mapComments(data);
}

function mapComments(
  rows: { id: string; author_id: string; text: string; created_at: string; profiles: unknown }[] | null,
): ReviewCommentItem[] {
  return (rows ?? []).map((c) => {
    const profile = c.profiles as { name: string | null; avatar_url: string | null } | null;
    return {
      id: c.id,
      authorId: c.author_id,
      authorName: profile?.name ?? "Unknown",
      authorAvatarUrl: profile?.avatar_url ?? null,
      text: c.text,
      createdAt: c.created_at,
    };
  });
}
