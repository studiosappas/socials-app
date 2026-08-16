import type { createClient } from "@/lib/supabase/server";
import type { PostType } from "@/types/database";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// 1 image -> Post, 2+ images -> Carousel, any video present -> Reel --
// applies regardless of position, so a carousel with one video slide is
// still a Reel by this rule. Empty (no assets yet) returns null rather than
// guessing, since there's nothing to derive from.
export function derivePostType(assets: { mediaType: "image" | "video" }[]): PostType | null {
  if (assets.length === 0) return null;
  if (assets.some((a) => a.mediaType === "video")) return "reel";
  return assets.length === 1 ? "post" : "carousel";
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
