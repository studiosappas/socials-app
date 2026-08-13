import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ReviewStatus } from "@/types/database";

const SIGNED_URL_TTL_SECONDS = 3600;

export type SharedGalleryMedia = {
  mediaAssetId: string;
  url: string | null;
  posterUrl: string | null;
  mediaType: "image" | "video";
};

export type SharedGalleryItem = {
  id: string;
  type: "post" | "story";
  // The real post/story row this item points at -- exactly one of the two
  // is set, matching item.type. Needed so the gallery has something to call
  // set_{post,story}_review_status_by_token/set_{post,story}_notes_by_token
  // with.
  postId: string | null;
  storyId: string | null;
  caption: string;
  notes: string;
  reviewStatus: ReviewStatus;
  media: SharedGalleryMedia[];
};

export type SharedGalleryData = {
  title: string;
  projectName: string;
  items: SharedGalleryItem[];
  members: { id: string; name: string }[];
};

// Public, unauthenticated read path -- get_shared_preview is a SECURITY
// DEFINER function so it can read posts/stories/media_assets (all otherwise
// member-only) on behalf of an anonymous caller, but only ever for a token
// that actually exists. A matching storage policy (see schema.sql) is what
// lets the createSignedUrls call below succeed for an anon caller too.
// Wrapped in React's cache() since both generateMetadata and the page
// component call this for the same request -- dedupes the RPC + storage
// round trips to one instead of two.
export const getSharedPreviewData = cache(async function getSharedPreviewData(
  token: string,
): Promise<SharedGalleryData | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_shared_preview", { p_token: token });
  if (error || !data) return null;

  const paths = new Set<string>();
  for (const item of data.items) {
    for (const media of item.media) {
      paths.add(media.storagePath);
      if (media.previewStoragePath) paths.add(media.previewStoragePath);
      if (media.posterStoragePath) paths.add(media.posterStoragePath);
    }
  }

  const pathList = Array.from(paths);
  const { data: signedUrls } = pathList.length
    ? await supabase.storage.from("project-media").createSignedUrls(pathList, SIGNED_URL_TTL_SECONDS)
    : { data: [] };

  const urlByPath = new Map<string, string>();
  for (const entry of signedUrls ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  return {
    title: data.title,
    projectName: data.projectName,
    // Falls back to [] on a not-yet-migrated database -- the RPC didn't
    // return `members` before this feature existed, same isolated-query
    // reasoning as every other "new column might not exist yet" spot in
    // this codebase, just applied to an RPC response instead of a select.
    members: data.members ?? [],
    items: data.items.map((item) => ({
      id: item.id,
      type: item.type,
      postId: item.postId,
      storyId: item.storyId,
      caption: item.caption,
      notes: item.notes,
      reviewStatus: item.reviewStatus,
      media: item.media.map((m) => ({
        mediaAssetId: m.mediaAssetId,
        // Same "edited preview wins" fallback used everywhere else this
        // media shows up (Grid, post editor) -- a re-annotated cover should
        // look the same here as it does inside the app.
        url: (m.previewStoragePath ? urlByPath.get(m.previewStoragePath) : undefined) ?? urlByPath.get(m.storagePath) ?? null,
        posterUrl: m.posterStoragePath ? urlByPath.get(m.posterStoragePath) ?? null : null,
        mediaType: m.mediaType,
      })),
    })),
  };
});
