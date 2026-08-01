"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { MediaType } from "@/types/database";

export type UploadMediaState = { message?: string } | undefined;

export async function addGridRow(projectId: string) {
  const supabase = await createClient();

  const { count } = await supabase
    .from("grid_rows")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { data: row, error } = await supabase
    .from("grid_rows")
    .insert({ project_id: projectId, position: count ?? 0 })
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
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { message: "Choose a file to upload." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "You must be logged in." };

  const mediaType: MediaType = file.type.startsWith("video/") ? "video" : "image";
  const ext = file.name.includes(".") ? file.name.split(".").pop() : undefined;
  const storagePath = `${projectId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

  const { error: uploadError } = await supabase.storage
    .from("project-media")
    .upload(storagePath, file, { contentType: file.type });

  if (uploadError) {
    return { message: uploadError.message };
  }

  const { error: insertError } = await supabase.from("media_assets").insert({
    project_id: projectId,
    storage_path: storagePath,
    media_type: mediaType,
    uploaded_by: user.id,
  });

  if (insertError) {
    return { message: insertError.message };
  }

  revalidatePath(`/projects/${projectId}/grid`);
  return undefined;
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
  }

  const { count } = await supabase
    .from("post_assets")
    .select("*", { count: "exact", head: true })
    .eq("post_id", postId);

  const { error: assetError } = await supabase
    .from("post_assets")
    .insert({ post_id: postId, media_asset_id: mediaAssetId, position: count ?? 0 });

  if (assetError) {
    throw new Error(assetError.message);
  }

  revalidatePath(`/projects/${projectId}/grid`);
}
