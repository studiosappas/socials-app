import type { createClient } from "@/lib/supabase/server";

// Picking a Library asset into a post (Post Editor's Add from Library and
// Replace from Library -- addPostAsset/replacePostAsset in actions/posts.ts).
// Plain module, not "use server": that file may only export async Server
// Actions, and both halves here need to be importable by their own tests.

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// LIBRARY ASSET = clean reusable source; POST/GRID USAGE = independently
// editable instance -- see cloneMediaAssetForDivergence's own comment in
// actions/media.ts. Picking an already-edited Library asset into a post
// always gives that post a clean instance, never silently inherits whatever
// Text/Adjustments some OTHER post already saved onto that exact row. A
// never-edited asset (the overwhelming common case) has no annotation_json
// yet, so this is a single cheap read and no clone.
// FAIL CLOSED, not open -- see cloneMediaAssetForDivergence's own comment
// for the confirmed root cause (an RLS rejection whenever the acting user
// differs from the asset's original uploader) that a silent "clone failed,
// fall back to the dirty/shared asset id" used to mask.
export async function resolveCleanAssetId(
  supabase: SupabaseClient,
  mediaAssetId: string,
  // cloneMediaAssetForDivergence, passed in (it lives in a "use server"
  // file) -- resolves to the new asset id, or null on failure.
  clone: (mediaAssetId: string) => Promise<string | null>,
): Promise<{ assetId: string } | { error: string }> {
  const { data: asset } = await supabase
    .from("media_assets")
    .select("annotation_json")
    .eq("id", mediaAssetId)
    .maybeSingle();
  if (!asset?.annotation_json) return { assetId: mediaAssetId };
  const cloneId = await clone(mediaAssetId);
  if (!cloneId) return { error: "Couldn't add this asset independently. Please try again." };
  return { assetId: cloneId };
}

// The client half: once the pick's action resolves, the carousel item must
// carry the media asset the post_assets row ACTUALLY points at -- a clone,
// whenever the picked asset was already edited. Keeping the picked id
// instead made every Edit Image save on it target a row this post doesn't
// use, which saveMediaAssetAnnotation refuses ("Couldn't save this edit
// independently") -- confirmed on Staging. Also clears mediaPending, the
// flag that keeps Edit Image closed while the id is still unknown.
export function settleLibraryPick<T extends { postAssetId: string; mediaAssetId: string; mediaPending?: boolean }>(
  assets: T[],
  postAssetId: string,
  settled: { postAssetId?: string; mediaAssetId: string },
): T[] {
  return assets.map((a) =>
    a.postAssetId === postAssetId
      ? {
          ...a,
          postAssetId: settled.postAssetId ?? a.postAssetId,
          mediaAssetId: settled.mediaAssetId,
          mediaPending: false,
        }
      : a,
  );
}
