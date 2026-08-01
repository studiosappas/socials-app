"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { MediaType, PostStatus, PostType } from "@/types/database";

export type UpdatePostState = { message?: string } | undefined;

export async function updatePost(
  projectId: string,
  postId: string,
  _state: UpdatePostState,
  formData: FormData,
): Promise<UpdatePostState> {
  const supabase = await createClient();

  const scheduledDate = String(formData.get("scheduled_date") ?? "").trim();

  const { error } = await supabase
    .from("posts")
    .update({
      post_type: String(formData.get("post_type") ?? "post") as PostType,
      status: String(formData.get("status") ?? "draft") as PostStatus,
      caption: String(formData.get("caption") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      scheduled_date: scheduledDate ? scheduledDate : null,
    })
    .eq("id", postId);

  if (error) {
    return { message: error.message };
  }

  revalidatePath(`/projects/${projectId}/posts/${postId}`);
  revalidatePath(`/projects/${projectId}/grid`);
  return undefined;
}

export async function addPostAsset(
  projectId: string,
  postId: string,
  mediaAssetId: string,
) {
  const supabase = await createClient();

  const { count } = await supabase
    .from("post_assets")
    .select("*", { count: "exact", head: true })
    .eq("post_id", postId);

  const { error } = await supabase
    .from("post_assets")
    .insert({ post_id: postId, media_asset_id: mediaAssetId, position: count ?? 0 });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}/posts/${postId}`);
  revalidatePath(`/projects/${projectId}/grid`);
}

export type UploadPostAssetState = { message?: string; success?: boolean } | undefined;

export async function uploadPostAsset(
  projectId: string,
  postId: string,
  _state: UploadPostAssetState,
  formData: FormData,
): Promise<UploadPostAssetState> {
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

  const { count } = await supabase
    .from("post_assets")
    .select("*", { count: "exact", head: true })
    .eq("post_id", postId);

  const { error: assetError } = await supabase
    .from("post_assets")
    .insert({ post_id: postId, media_asset_id: mediaAsset.id, position: count ?? 0 });

  if (assetError) {
    return { message: assetError.message };
  }

  revalidatePath(`/projects/${projectId}/posts/${postId}`);
  revalidatePath(`/projects/${projectId}/grid`);
  return { success: true };
}

export async function removePostAsset(
  projectId: string,
  postId: string,
  postAssetId: string,
) {
  const supabase = await createClient();
  await supabase.from("post_assets").delete().eq("id", postAssetId);
  revalidatePath(`/projects/${projectId}/posts/${postId}`);
  revalidatePath(`/projects/${projectId}/grid`);
}

export async function reorderPostAssets(
  projectId: string,
  postId: string,
  orderedPostAssetIds: string[],
) {
  const supabase = await createClient();

  await Promise.all(
    orderedPostAssetIds.map((id, position) =>
      supabase.from("post_assets").update({ position }).eq("id", id),
    ),
  );

  revalidatePath(`/projects/${projectId}/posts/${postId}`);
  revalidatePath(`/projects/${projectId}/grid`);
}

export async function addPostLink(
  projectId: string,
  postId: string,
  _state: UpdatePostState,
  formData: FormData,
): Promise<UpdatePostState> {
  const url = String(formData.get("url") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  if (!url) return { message: "URL is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("post_links").insert({ post_id: postId, url, label });

  if (error) {
    return { message: error.message };
  }

  revalidatePath(`/projects/${projectId}/posts/${postId}`);
  return undefined;
}

export async function removePostLink(projectId: string, postId: string, linkId: string) {
  const supabase = await createClient();
  await supabase.from("post_links").delete().eq("id", linkId);
  revalidatePath(`/projects/${projectId}/posts/${postId}`);
}
