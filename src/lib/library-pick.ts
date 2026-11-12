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
//
// A server refresh can land BEFORE this runs and already list the saved row
// (settled.postAssetId) next to the still-pending temp slide (see
// mergeServerSlides). Renaming the temp would then leave two slides with
// the same postAssetId -- so the temp is dropped instead, and the saved row
// takes over its Library origin.
export function settleLibraryPick<T extends { postAssetId: string; mediaAssetId: string; mediaPending?: boolean; libraryItemId?: string }>(
  assets: T[],
  postAssetId: string,
  settled: { postAssetId?: string; mediaAssetId: string },
): T[] {
  const savedId = settled.postAssetId;
  if (savedId && savedId !== postAssetId && assets.some((a) => a.postAssetId === savedId)) {
    const temp = assets.find((a) => a.postAssetId === postAssetId);
    return assets
      .filter((a) => a.postAssetId !== postAssetId)
      .map((a) =>
        a.postAssetId === savedId && temp?.libraryItemId && !a.libraryItemId && a.mediaAssetId === settled.mediaAssetId
          ? { ...a, libraryItemId: temp.libraryItemId, mediaPending: false }
          : a,
      );
  }
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

// When fresh slides arrive from the server (a refresh, or a revalidation
// after an add), the Post Editor replaces its local list with them -- and
// the server knows nothing about libraryItemId: a copy-on-write slide only
// points at its copy. Dropping it made the ORIGINAL Library item count as
// unused again mid-session (clickable in the picker, so the same edited
// image could be added twice). The dropped origin was seen in the Staging
// Preview QA logs, 2026-11-12; the duplicate add follows from the code.
// Carried over ONLY when the same slide (postAssetId) still points at the
// same SETTLED media asset; a removed slide (absent from `incoming`), a
// replaced one (different mediaAssetId) or a still-pending pick never
// carries it. Returns `incoming` itself when nothing was carried.
export function carryLibraryItemIds<T extends { postAssetId: string; mediaAssetId: string; mediaPending?: boolean; libraryItemId?: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const origins = new Map<string, T>();
  for (const a of current) if (a.libraryItemId && !a.mediaPending) origins.set(a.postAssetId, a);
  if (origins.size === 0) return incoming;
  let changed = false;
  const next = incoming.map((a) => {
    const prev = origins.get(a.postAssetId);
    if (!prev || a.libraryItemId || prev.mediaAssetId !== a.mediaAssetId) return a;
    changed = true;
    return { ...a, libraryItemId: prev.libraryItemId };
  });
  return changed ? next : incoming;
}

// What the Post Editor's list becomes when fresh slides arrive from the
// server (a refresh, or the revalidation an add/replace triggers -- which
// can land while LATER picks are still queued, since server actions run one
// at a time). Replacing the list wholesale used to drop every pick still in
// flight: a pending Add vanished (and its own settle then found nothing to
// update), a pending Replace snapped back to the old media.
//   - Settled slides come from the server, keeping their Library origin
//     only when the same slide still has the same media
//     (carryLibraryItemIds).
//   - A pending Replace (same postAssetId as a server row) keeps its
//     optimistic version until it settles.
//   - A pending Add the server doesn't list yet (its temp id) stays, at the
//     end -- where adds always go. If the server already lists its saved
//     row, the temp still stays until its own response arrives;
//     settleLibraryPick then drops it rather than duplicating the row.
// Pure: meant for a functional state update, so it always sees the latest
// list, including picks queued in the same tick.
export function mergeServerSlides<T extends { postAssetId: string; mediaAssetId: string; mediaPending?: boolean; libraryItemId?: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const pending = new Map<string, T>();
  for (const a of current) if (a.mediaPending) pending.set(a.postAssetId, a);
  const settled = carryLibraryItemIds(current, incoming);
  if (pending.size === 0) return settled;
  const incomingIds = new Set(incoming.map((a) => a.postAssetId));
  return [
    ...settled.map((a) => pending.get(a.postAssetId) ?? a),
    ...current.filter((a) => a.mediaPending && !incomingIds.has(a.postAssetId)),
  ];
}
