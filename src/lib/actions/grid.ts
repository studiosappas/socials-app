"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { uploadPosterIfPresent, setMediaAssetPoster } from "@/lib/actions/media";
import { logActivity } from "@/lib/activity-log";
import { notifyProjectMembers } from "@/lib/notifications";
import type { MediaType } from "@/types/database";

export type UploadMediaState = { message?: string } | undefined;

export async function addGridRow(projectId: string) {
  const supabase = await createClient();

  // New rows always land at the very top (lowest position sorts first, see
  // getGridRowsWithCoverPaths's .order("position")) -- inserting one
  // position below the current minimum, rather than appending after the
  // count, means every existing row's own position is left untouched (no
  // bulk update needed) while still sorting before all of them.
  const { data: minRow } = await supabase
    .from("grid_rows")
    .select("position")
    .eq("project_id", projectId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  const nextPosition = minRow ? minRow.position - 1 : 0;

  const { data: row, error } = await supabase
    .from("grid_rows")
    .insert({ project_id: projectId, position: nextPosition })
    .select("id")
    .single();

  if (error || !row) {
    throw new Error(error?.message ?? "Failed to add row.");
  }

  const { error: slotsError } = await supabase
    .from("grid_slots")
    .insert([0, 1, 2].map((position) => ({ row_id: row.id, position })));

  if (slotsError) {
    throw new Error(slotsError.message);
  }

  revalidatePath(`/projects/${projectId}/grid`);
}

export async function removeGridRow(projectId: string, rowId: string) {
  const supabase = await createClient();
  await supabase.from("grid_rows").delete().eq("id", rowId);
  revalidatePath(`/projects/${projectId}/grid`);
}

export async function uploadMedia(
  projectId: string,
  _state: UploadMediaState,
  formData: FormData,
): Promise<UploadMediaState> {
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { message: "Choose a file to upload." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "You must be logged in." };

  // The client submits one file (plus its own optional poster) per call
  // even when several were selected via the multi-select input, so a
  // "poster" field always belongs unambiguously to the single file in this
  // request -- see generateVideoPosterBlob/uploadFilesWithPosters.
  for (const file of files) {
    const mediaType: MediaType = file.type.startsWith("video/") ? "video" : "image";
    const ext = file.name.includes(".") ? file.name.split(".").pop() : undefined;
    const storagePath = `${projectId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

    const { error: uploadError } = await supabase.storage
      .from("project-media")
      .upload(storagePath, file, { contentType: file.type });

    if (uploadError) {
      return { message: uploadError.message };
    }

    const posterStoragePath = await uploadPosterIfPresent(supabase, projectId, formData, mediaType);

    const { data: mediaAsset, error: insertError } = await supabase
      .from("media_assets")
      .insert({
        project_id: projectId,
        storage_path: storagePath,
        media_type: mediaType,
        uploaded_by: user.id,
      })
      .select("id")
      .single();

    if (insertError || !mediaAsset) {
      return { message: insertError?.message ?? "Failed to save media." };
    }

    await setMediaAssetPoster(supabase, mediaAsset.id, posterStoragePath);
  }

  await logActivity(supabase, projectId, user.id, `uploaded ${files.length} asset${files.length === 1 ? "" : "s"}`);

  const { data: uploader } = await supabase.from("profiles").select("name").eq("id", user.id).single();
  await notifyProjectMembers(
    supabase,
    projectId,
    "new_uploaded_assets",
    {
      title: `${uploader?.name ?? "Someone"} uploaded ${files.length} asset${files.length === 1 ? "" : "s"}`,
      icon: "🖼",
      link: `/projects/${projectId}/grid`,
    },
    { excludeUserId: user.id },
  );

  revalidatePath(`/projects/${projectId}/grid`);
  return undefined;
}

export async function deleteMedia(projectId: string, mediaAssetId: string) {
  const supabase = await createClient();
  // FK cascades (post_assets/story_frames -> media_assets) remove it from
  // wherever it was in use; the RLS delete policy already restricts this to
  // owners/admins of the project.
  const { error } = await supabase.from("media_assets").delete().eq("id", mediaAssetId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath(`/projects/${projectId}/posts`);
  revalidatePath(`/projects/${projectId}/stories`);
}

// Undo of deleteMedia (and redo of an undone upload) -- the deleted row is
// gone, but its storage object is never removed, so this just re-inserts a
// media_assets row pointing at the same, still-live storage_path/poster
// instead of re-uploading anything. Gets a new id (the old one is gone for
// good), which is fine -- visually and functionally identical either way.
export async function restoreMediaAsset(
  projectId: string,
  data: { storagePath: string; mediaType: MediaType; posterStoragePath: string | null },
): Promise<{ id: string } | { message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "You must be logged in." };

  const { data: mediaAsset, error } = await supabase
    .from("media_assets")
    .insert({
      project_id: projectId,
      storage_path: data.storagePath,
      media_type: data.mediaType,
      poster_storage_path: data.posterStoragePath,
      uploaded_by: user.id,
    })
    .select("id")
    .single();

  if (error || !mediaAsset) {
    return { message: error?.message ?? "Failed to restore media." };
  }

  revalidatePath(`/projects/${projectId}/grid`);
  return { id: mediaAsset.id };
}

export async function placeMediaInSlot(
  projectId: string,
  slotId: string,
  mediaAssetId: string,
) {
  const supabase = await createClient();

  const { data: slot, error: slotError } = await supabase
    .from("grid_slots")
    .select("id, post_id")
    .eq("id", slotId)
    .single();

  if (slotError || !slot) {
    throw new Error(slotError?.message ?? "Slot not found.");
  }

  let postId = slot.post_id;

  if (!postId) {
    const { data: post, error: postError } = await supabase
      .from("posts")
      .insert({ project_id: projectId })
      .select("id")
      .single();

    if (postError || !post) {
      throw new Error(postError?.message ?? "Failed to create post.");
    }

    postId = post.id;

    const { error: updateSlotError } = await supabase
      .from("grid_slots")
      .update({ post_id: postId })
      .eq("id", slotId);

    if (updateSlotError) {
      throw new Error(updateSlotError.message);
    }
  } else {
    // Dropping media onto a slot that already has a post replaces its
    // cover outright -- carousels are only ever built intentionally from
    // inside the post editor, never as a side effect of a grid drop.
    const { error: clearError } = await supabase
      .from("post_assets")
      .delete()
      .eq("post_id", postId);

    if (clearError) {
      throw new Error(clearError.message);
    }
  }

  const { error: assetError } = await supabase
    .from("post_assets")
    .insert({ post_id: postId, media_asset_id: mediaAssetId, position: 0 });

  if (assetError) {
    throw new Error(assetError.message);
  }

  return { postId };
}

export async function reorderGridPosts(
  updates: { slotId: string; postId: string | null }[],
) {
  if (updates.length === 0) return;

  const supabase = await createClient();

  // Runs as one atomic transaction server-side (see reorder_grid_slots in
  // schema.sql) -- reassigning every changed slot's post_id individually
  // via parallel requests let a concurrent read catch the grid mid-update
  // and see the same post duplicated across two slots.
  const { error } = await supabase.rpc("reorder_grid_slots", { updates });
  if (error) {
    throw new Error(error.message);
  }
}

// Keyed by post_id (not slot_id) so the crop stays attached to the post's
// own content and survives being moved to a different grid cell -- see the
// schema comment on posts.cover_transform for why this replaced the old
// grid_slots-keyed version.
export async function updatePostCoverTransform(
  projectId: string,
  postId: string,
  transform: { scale: number; x: number; y: number } | null,
) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("posts")
    .update({ cover_transform: transform })
    .eq("id", postId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}/grid`);
}
