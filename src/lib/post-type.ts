import type { createClient } from "@/lib/supabase/server";
import type { PostType } from "@/types/database";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Instagram's own structure rule: 1 image -> Post, 1 video -> Reel, 2+
// media items of ANY type -> Carousel (a mixed image/video carousel is a
// Carousel, never a Reel). The item count decides first; media type only
// matters for a single item. Empty (no assets yet) returns null rather than
// guessing, since there's nothing to derive from.
//
// This used to return "reel" whenever ANY item was a video, which mis-typed
// every mixed carousel -- and the Grid PDF export then showed only its first
// slide. Posts saved under that old rule keep their stored post_type (no
// backfill); see effectivePostType for how they are shown and exported.
export function derivePostType(assets: { mediaType: "image" | "video" }[]): PostType | null {
  if (assets.length === 0) return null;
  if (assets.length >= 2) return "carousel";
  return assets[0].mediaType === "video" ? "reel" : "post";
}

// The type every surface SHOWS and EXPORTS a post as (Post Editor, Calendar,
// Grid PDF export, the library's "in a carousel" badge), from its stored
// post_type and its real media count -- read-time only, never written back.
// 2+ media items is always a Carousel (a Post or a Reel is a single item),
// whatever was stored: this corrects every mixed carousel the old
// derivePostType rule saved as "reel". A single item keeps its stored type,
// which syncPostType already sets to Post (image) / Reel (video) on every
// media change. No media yet (count 0) keeps the stored type.
export function effectivePostType(stored: PostType, itemCount: number): PostType {
  return itemCount >= 2 ? "carousel" : stored;
}

// Which of `posts` are effectively carousels, given their post_assets rows
// (one row per media item) -- effectivePostType applied per post. Used by
// the media library's "in a carousel" badge.
export function effectiveCarouselPostIds(
  posts: { id: string; post_type: PostType }[],
  assetRows: { post_id: string }[],
): Set<string> {
  const counts = new Map<string, number>();
  for (const row of assetRows) counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1);
  return new Set(posts.filter((p) => effectivePostType(p.post_type, counts.get(p.id) ?? 0) === "carousel").map((p) => p.id));
}

// Server-only orchestration: re-reads a post's current assets, derives the
// type, and writes it if it changed. Called at the end of every action that
// adds/replaces/removes a post's media (addPostAsset, uploadPostAsset,
// removePostAsset, replacePostAsset in lib/actions/posts.ts; placeMediaInSlot
// in lib/actions/grid.ts) so Post Type is always a live reflection of the
// post's actual media -- never a value the user has to set themselves. See
// AGENTS.md-adjacent plan notes: post-editor.tsx's own Post Type control is
// a read-only badge now, not a client-settable field.
export async function syncPostType(supabase: SupabaseServerClient, postId: string): Promise<void> {
  const { data: rows } = await supabase
    .from("post_assets")
    .select("media_assets(media_type)")
    .eq("post_id", postId);

  const assets = (rows ?? [])
    .map((r) => (r.media_assets as { media_type: string } | null)?.media_type)
    .filter((t): t is "image" | "video" => t === "image" || t === "video")
    .map((mediaType) => ({ mediaType }));

  const nextType = derivePostType(assets);
  if (!nextType) return;

  await supabase.from("posts").update({ post_type: nextType }).eq("id", postId);
}
