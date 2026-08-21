import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type CoverTransform = { scale: number; x: number; y: number };

export type GridSlotWithPath = {
  slotId: string;
  postId: string | null;
  coverStoragePath: string | null;
  // What Grid's own on-screen tile should actually render -- prefers the
  // small generated thumbnail over the (possibly 10s of MB) original when
  // one exists. Deliberately a SEPARATE field from coverStoragePath: the
  // export/export-pdf routes download coverStoragePath directly for the
  // real output file and must keep getting full quality, never this.
  coverDisplayPath: string | null;
  coverMediaType: "image" | "video" | null;
  // The cover's own media_assets row + its raw (never-a-poster) storage
  // path -- only needed so a video with no poster yet can offer a
  // "Regenerate Poster" action (video-poster.ts's generatePosterFromVideoUrl
  // needs the actual video file to capture a frame from).
  coverMediaAssetId: string | null;
  coverOriginalPath: string | null;
  assetCount: number;
  coverTransform: CoverTransform | null;
  scheduledDate: string | null;
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

  const postIds = (slots ?? [])
    .map((s) => s.post_id)
    .filter((id): id is string => Boolean(id));

  // Fetched independently from the core slot list above: cover_transform is a
  // newer column that may not exist yet on a not-yet-migrated database, and
  // PostgREST fails an entire select if any requested column is missing --
  // isolating it here means a pending migration only loses crop data, not the
  // whole grid. Keyed by post_id (not slot_id) so a post's crop stays
  // attached to it when moved to a different grid cell -- see posts.cover_transform.
  const { data: transformRows } = postIds.length
    ? await supabase.from("posts").select("id, cover_transform, scheduled_date").in("id", postIds)
    : { data: [] };
  const transformByPostId = new Map<string, CoverTransform | null>();
  const scheduledDateByPostId = new Map<string, string | null>();
  for (const t of transformRows ?? []) {
    transformByPostId.set(t.id, (t.cover_transform as CoverTransform | null) ?? null);
    scheduledDateByPostId.set(t.id, (t as { scheduled_date: string | null }).scheduled_date ?? null);
  }

  const { data: postAssets } = postIds.length
    ? await supabase
        .from("post_assets")
        .select("post_id, position, media_assets(id, storage_path, media_type)")
        .in("post_id", postIds)
        .order("position")
    : { data: [] };

  // Fetched independently, same reasoning as cover_transform above:
  // preview_storage_path/poster_storage_path are newer columns that may not
  // exist yet on a not-yet-migrated database, and isolating them here means
  // a pending migration only means edited covers/video posters aren't
  // reflected yet, not that the whole grid fails to load. preview_storage_path
  // is what makes an edited cover image (via the post editor's frame ⋮ menu
  // -> Edit Image) show up here; poster_storage_path is a video's static
  // first-frame capture, generated at upload time -- Grid never renders a
  // <video>, so a video cover always resolves to this (or nothing) instead
  // of the raw video file's own storage_path.
  //
  // These are TWO SEPARATE queries, not one bundled select -- preview_storage_path
  // has been live for a while and poster_storage_path is newer/still-pending
  // on some databases; bundling them meant a still-missing poster_storage_path
  // column failed the WHOLE select (PostgREST fails entirely on any missing
  // column), silently wiping out already-working annotation previews too.
  // Isolating each means a pending poster_storage_path migration only means
  // videos don't have posters yet, never that existing image edits disappear.
  const mediaAssetIds = (postAssets ?? [])
    .map((pa) => (pa.media_assets as { id: string } | null)?.id)
    .filter((id): id is string => Boolean(id));
  const { data: previewRows } = mediaAssetIds.length
    ? await supabase.from("media_assets").select("id, preview_storage_path").in("id", mediaAssetIds)
    : { data: [] };
  const previewByMediaId = new Map<string, string | null>();
  for (const r of previewRows ?? []) {
    const row = r as { id: string; preview_storage_path: string | null };
    previewByMediaId.set(row.id, row.preview_storage_path ?? null);
  }

  const { data: posterRows } = mediaAssetIds.length
    ? await supabase.from("media_assets").select("id, poster_storage_path").in("id", mediaAssetIds)
    : { data: [] };
  const posterByMediaId = new Map<string, string | null>();
  for (const r of posterRows ?? []) {
    const row = r as { id: string; poster_storage_path: string | null };
    posterByMediaId.set(row.id, row.poster_storage_path ?? null);
  }

  // Isolated the same way as preview/poster above -- thumbnail_storage_path
  // is a new column that may not exist yet on a not-yet-migrated database.
  // A missing/failed lookup here just means the display path falls back to
  // the full original (see resolvedDisplayPath below), never a broken grid.
  const { data: thumbnailRows } = mediaAssetIds.length
    ? await supabase.from("media_assets").select("id, thumbnail_storage_path").in("id", mediaAssetIds)
    : { data: [] };
  const thumbnailByMediaId = new Map<string, string | null>();
  for (const r of thumbnailRows ?? []) {
    const row = r as { id: string; thumbnail_storage_path: string | null };
    thumbnailByMediaId.set(row.id, row.thumbnail_storage_path ?? null);
  }

  const coverPathByPost = new Map<string, string | null>();
  const coverDisplayPathByPost = new Map<string, string | null>();
  const coverTypeByPost = new Map<string, "image" | "video" | null>();
  const coverMediaIdByPost = new Map<string, string | null>();
  const coverOriginalPathByPost = new Map<string, string | null>();
  const countByPost = new Map<string, number>();
  for (const pa of postAssets ?? []) {
    const media = pa.media_assets as { id: string; storage_path: string; media_type: "image" | "video" } | null;
    if (!coverPathByPost.has(pa.post_id)) {
      const previewPath = media ? previewByMediaId.get(media.id) : null;
      const resolvedPath =
        media?.media_type === "video"
          ? (posterByMediaId.get(media.id) ?? null)
          : (previewPath || media?.storage_path) ?? null;
      // Same resolution as resolvedPath (an edited preview always wins --
      // it's already a flattened, reasonably-sized export, not the raw
      // upload), except an image with neither prefers the small generated
      // thumbnail over the full original. Video already resolves to its
      // (small) poster either way, so display and export paths match there.
      const resolvedDisplayPath =
        media?.media_type === "video"
          ? resolvedPath
          : (previewPath || (media ? thumbnailByMediaId.get(media.id) : null) || media?.storage_path) ?? null;
      coverPathByPost.set(pa.post_id, resolvedPath);
      coverDisplayPathByPost.set(pa.post_id, resolvedDisplayPath);
      coverTypeByPost.set(pa.post_id, media?.media_type ?? null);
      coverMediaIdByPost.set(pa.post_id, media?.id ?? null);
      coverOriginalPathByPost.set(pa.post_id, media?.storage_path ?? null);
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
      coverDisplayPath: slot.post_id ? coverDisplayPathByPost.get(slot.post_id) ?? null : null,
      coverMediaType: slot.post_id ? coverTypeByPost.get(slot.post_id) ?? null : null,
      coverMediaAssetId: slot.post_id ? coverMediaIdByPost.get(slot.post_id) ?? null : null,
      coverOriginalPath: slot.post_id ? coverOriginalPathByPost.get(slot.post_id) ?? null : null,
      assetCount: slot.post_id ? countByPost.get(slot.post_id) ?? 0 : 0,
      coverTransform: slot.post_id ? transformByPostId.get(slot.post_id) ?? null : null,
      scheduledDate: slot.post_id ? scheduledDateByPostId.get(slot.post_id) ?? null : null,
    })),
  }));
}
