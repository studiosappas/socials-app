import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type CoverTransform = { scale: number; x: number; y: number };

export type GridSlotWithPath = {
  slotId: string;
  postId: string | null;
  coverStoragePath: string | null;
  coverMediaType: "image" | "video" | null;
  assetCount: number;
  coverTransform: CoverTransform | null;
};

export type GridRowWithSlots = { rowId: string; slots: GridSlotWithPath[] };

// Shared row/slot/cover-asset resolution used by both the Grid page (which then
// resolves each storage path to a signed URL for on-screen <img> rendering) and the
// grid export route (which downloads each path's bytes directly, server-side).
export async function getGridRowsWithCoverPaths(
  supabase: SupabaseServerClient,
  projectId: string,
): Promise<GridRowWithSlots[]> {
  const { data: rows } = await supabase
    .from("grid_rows")
    .select("id, position")
    .eq("project_id", projectId)
    .order("position");

  const rowIds = (rows ?? []).map((r) => r.id);

  const { data: slots } = rowIds.length
    ? await supabase
        .from("grid_slots")
        .select("id, row_id, position, post_id")
        .in("row_id", rowIds)
        .order("position")
    : { data: [] };

  // Fetched independently from the core slot list above: cover_transform is a
  // newer column that may not exist yet on a not-yet-migrated database, and
  // PostgREST fails an entire select if any requested column is missing --
  // isolating it here means a pending migration only loses crop data, not the
  // whole grid.
  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: transformRows } = slotIds.length
    ? await supabase.from("grid_slots").select("id, cover_transform").in("id", slotIds)
    : { data: [] };
  const transformBySlotId = new Map<string, CoverTransform | null>();
  for (const t of transformRows ?? []) {
    transformBySlotId.set(t.id, (t.cover_transform as CoverTransform | null) ?? null);
  }

  const postIds = (slots ?? [])
    .map((s) => s.post_id)
    .filter((id): id is string => Boolean(id));

  const { data: postAssets } = postIds.length
    ? await supabase
        .from("post_assets")
        .select("post_id, position, media_assets(storage_path, media_type)")
        .in("post_id", postIds)
        .order("position")
    : { data: [] };

  const coverPathByPost = new Map<string, string | null>();
  const coverTypeByPost = new Map<string, "image" | "video" | null>();
  const countByPost = new Map<string, number>();
  for (const pa of postAssets ?? []) {
    const media = pa.media_assets as { storage_path: string; media_type: "image" | "video" } | null;
    if (!coverPathByPost.has(pa.post_id)) {
      coverPathByPost.set(pa.post_id, media?.storage_path ?? null);
      coverTypeByPost.set(pa.post_id, media?.media_type ?? null);
    }
    countByPost.set(pa.post_id, (countByPost.get(pa.post_id) ?? 0) + 1);
  }

  const slotsByRow = new Map<string, typeof slots>();
  for (const slot of slots ?? []) {
    const list = slotsByRow.get(slot.row_id) ?? [];
    list.push(slot);
    slotsByRow.set(slot.row_id, list);
  }

  return (rows ?? []).map((row) => ({
    rowId: row.id,
    slots: (slotsByRow.get(row.id) ?? []).map((slot) => ({
      slotId: slot.id,
      postId: slot.post_id,
      coverStoragePath: slot.post_id ? coverPathByPost.get(slot.post_id) ?? null : null,
      coverMediaType: slot.post_id ? coverTypeByPost.get(slot.post_id) ?? null : null,
      assetCount: slot.post_id ? countByPost.get(slot.post_id) ?? 0 : 0,
      coverTransform: transformBySlotId.get(slot.id) ?? null,
    })),
  }));
}
