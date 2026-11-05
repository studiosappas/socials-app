import type { createClient } from "@/lib/supabase/server";

// Edit-time copy-on-write for a post's own usage of a media asset -- shared
// by saveMediaAssetAnnotation and saveMediaAssetPosterAnnotation (actions/
// media.ts). Plain module, not "use server": that file may only export async
// Server Actions, and this needs to be importable by its own tests.
//
// LIBRARY ASSET = clean reusable source; POST USAGE = independently editable
// instance (see cloneMediaAssetForDivergence). Two posts that both picked
// the same Library asset share one media_assets ROW, so an edit written to
// that row lands on every post using it. Before writing an edit for one
// post, this decides whether that post needs its own copy, and if so gives
// it one and re-links exactly that post's usage row to it.
//
// Both halves used to look only at COVERS (position 0):
//  - sharing was only detected against other posts' covers, so editing a
//    cover that another post also used as a carousel item wrote straight
//    onto the shared row and silently edited that other post too;
//  - the re-link only matched the editing post's own position-0 row, so
//    editing a carousel item that was another post's cover cloned, re-linked
//    ZERO rows with no error, and saved the edit onto an orphan copy nothing
//    pointed at -- confirmed in Production logs as "text appears, then
//    disappears after Save" (the refresh brought back the untouched source).
// Now: sharing means any OTHER post uses the asset at ANY position, and the
// re-link targets the editing post's exact usage row by id and must report
// exactly one updated row. Anything ambiguous refuses the save BEFORE
// cloning -- fail closed, never fall back to the shared row.

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type PostAssetUsage = { id: string; post_id: string };

export type UsageIsolationPlan =
  | { kind: "not-shared" }
  | { kind: "isolate"; usageRowId: string; otherPostIds: string[] }
  | { kind: "refuse"; reason: "no-usage-in-post" | "multiple-usages-in-post"; usageCount: number; otherPostIds: string[] };

export function planUsageIsolation(editingPostId: string, usages: PostAssetUsage[]): UsageIsolationPlan {
  const otherPostIds = Array.from(new Set(usages.filter((u) => u.post_id !== editingPostId).map((u) => u.post_id)));
  // Not used by any other post: the editing post owns the row outright, and
  // keeps writing to it directly -- unchanged from before.
  if (otherPostIds.length === 0) return { kind: "not-shared" };
  const own = usages.filter((u) => u.post_id === editingPostId);
  if (own.length === 1) return { kind: "isolate", usageRowId: own[0].id, otherPostIds };
  // Zero: the editing post doesn't actually use this asset (stale client
  // state) -- a copy would be an orphan. Two or more: the same asset appears
  // twice in this post and nothing says which usage is being edited.
  return {
    kind: "refuse",
    reason: own.length === 0 ? "no-usage-in-post" : "multiple-usages-in-post",
    usageCount: own.length,
    otherPostIds,
  };
}

export type UsageIsolationResult =
  | { kind: "not-shared" }
  | { kind: "isolated"; cloneId: string; usageRowId: string; otherPostIds: string[] }
  | {
      kind: "failed";
      stage: "usage-lookup" | "no-usage-in-post" | "multiple-usages-in-post" | "clone" | "relink";
      detail: Record<string, unknown>;
    };

export async function isolatePostUsageForEdit(
  supabase: SupabaseClient,
  opts: {
    mediaAssetId: string;
    editingPostId: string;
    // cloneMediaAssetForDivergence, passed in (it lives in the "use server"
    // actions file) -- resolves to the new asset id, or null on failure.
    clone: (mediaAssetId: string) => Promise<string | null>;
  },
): Promise<UsageIsolationResult> {
  const { mediaAssetId, editingPostId, clone } = opts;

  const { data: usageRows, error: lookupError } = await supabase
    .from("post_assets")
    .select("id, post_id")
    .eq("media_asset_id", mediaAssetId);
  // An unknown sharing state is not "not shared" -- writing directly could
  // edit other posts.
  if (lookupError || !usageRows) {
    return { kind: "failed", stage: "usage-lookup", detail: { error: lookupError?.message ?? "no rows returned" } };
  }

  const plan = planUsageIsolation(editingPostId, usageRows as PostAssetUsage[]);
  if (plan.kind === "not-shared") return plan;
  if (plan.kind === "refuse") {
    return { kind: "failed", stage: plan.reason, detail: { usageCount: plan.usageCount, otherPostIds: plan.otherPostIds } };
  }

  const cloneId = await clone(mediaAssetId);
  if (!cloneId) return { kind: "failed", stage: "clone", detail: { otherPostIds: plan.otherPostIds } };

  // By row id, still scoped to this post + the source asset, so it can only
  // ever touch the one usage row the plan picked.
  const { data: relinked, error: relinkError } = await supabase
    .from("post_assets")
    .update({ media_asset_id: cloneId })
    .eq("id", plan.usageRowId)
    .eq("post_id", editingPostId)
    .eq("media_asset_id", mediaAssetId)
    .select("id");
  const relinkedCount = relinked?.length ?? 0;
  if (relinkError || relinkedCount !== 1) {
    return {
      kind: "failed",
      stage: "relink",
      detail: { cloneId, usageRowId: plan.usageRowId, relinkedCount, error: relinkError?.message },
    };
  }
  return { kind: "isolated", cloneId, usageRowId: plan.usageRowId, otherPostIds: plan.otherPostIds };
}
