import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import type { GridCoverTransform } from "@/app/projects/[projectId]/grid/grid-board";
import type { ReviewStatus } from "@/types/database";

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
  // The one canonical crop for a post's cover asset -- null for stories (no
  // cover_transform concept there) and for a post never manually cropped.
  // Only ever meaningful for media[0]; every other item's own crop is
  // already baked into its own previewStoragePath image.
  coverTransform: GridCoverTransform | null;
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
// lets the signed-URL cache's underlying storage call below succeed for an
// anon caller too.
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

  // Cached the same way every authenticated surface signs project-media --
  // the cache is keyed by (bucket, path) only, so a path already signed for
  // a logged-in viewer (Grid, Post Editor, ...) is reused here for free, and
  // vice versa. Safe for an anonymous caller: a cache hit never touches
  // Supabase at all, and a miss still runs through this same request's
  // anon-but-policy-scoped client, same as the uncached call this replaces.
  const pathList = Array.from(paths);
  const urlByPath = await getCachedSignedUrls(supabase, "project-media", pathList);

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
      coverTransform: item.coverTransform ?? null,
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
