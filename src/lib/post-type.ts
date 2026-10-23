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
// backfill); see exportPostType for how export reads them.
export function derivePostType(assets: { mediaType: "image" | "video" }[]): PostType | null {
  if (assets.length === 0) return null;
  if (assets.length >= 2) return "carousel";
  return assets[0].mediaType === "video" ? "reel" : "post";
}

// The type an EXPORT treats a post as, from its stored post_type and its
// real media count -- read-time only, never written back. The one
// correction: a stored "reel" with 2+ items can only be a carousel (a Reel
// is a single video), which is exactly what the old derivePostType rule
// produced for mixed carousels. Every other stored value -- including a
// manual pick like "post" on a multi-image post -- is respected as saved.
export function exportPostType(stored: PostType, itemCount: number): PostType {
  return stored === "reel" && itemCount >= 2 ? "carousel" : stored;
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
