"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { uploadPosterIfPresent, setMediaAssetPoster } from "@/lib/actions/media";
import type { MediaType } from "@/types/database";

export async function createStory(projectId: string) {
  const supabase = await createClient();

  const { count } = await supabase
    .from("stories")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { data: story, error } = await supabase
    .from("stories")
    .insert({ project_id: projectId, name: "Untitled story", position: count ?? 0 })
    .select("id")
    .single();

  if (error || !story) {
    throw new Error(error?.message ?? "Failed to create story.");
  }

  revalidatePath(`/projects/${projectId}/stories`);
  redirect(`/projects/${projectId}/stories/${story.id}`);
}

export async function deleteStory(projectId: string, storyId: string) {
  const supabase = await createClient();
  await supabase.from("stories").delete().eq("id", storyId);
  revalidatePath(`/projects/${projectId}/stories`);
  redirect(`/projects/${projectId}/stories`);
}

export type UpdateStoryState = { message?: string; success?: boolean } | undefined;

export async function updateStory(
  projectId: string,
  storyId: string,
  _state: UpdateStoryState,
  formData: FormData,
): Promise<UpdateStoryState> {
  const supabase = await createClient();
  const scheduledDate = String(formData.get("scheduled_date") ?? "").trim();

  const { error } = await supabase
    .from("stories")
    .update({
      name: String(formData.get("name") ?? "Untitled story"),
      scheduled_date: scheduledDate ? scheduledDate : null,
      status: String(formData.get("status") ?? "draft") as "draft" | "scheduled" | "published",
      notes: String(formData.get("notes") ?? ""),
    })
    .eq("id", storyId);

  if (error) {
    return { message: error.message };
  }

  revalidatePath(`/projects/${projectId}/stories`);
  revalidatePath(`/projects/${projectId}/stories/${storyId}`);
  revalidatePath(`/projects/${projectId}/calendar`);
  return { success: true };
}

export async function addStoryFrame(projectId: string, storyId: string, mediaAssetId: string) {
  const supabase = await createClient();

  const { count } = await supabase
    .from("story_frames")
    .select("*", { count: "exact", head: true })
    .eq("story_id", storyId);

  const { error } = await supabase
    .from("story_frames")
    .insert({ story_id: storyId, media_asset_id: mediaAssetId, position: count ?? 0 });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}/stories`);
  revalidatePath(`/projects/${projectId}/stories/${storyId}`);
}

export type UploadStoryFrameState = { message?: string; success?: boolean } | undefined;

export async function uploadStoryFrame(
  projectId: string,
  storyId: string,
  _state: UploadStoryFrameState,
  formData: FormData,
): Promise<UploadStoryFrameState> {
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { message: "Choose a file to upload." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "You must be logged in." };

  const { count: startingCount } = await supabase
    .from("story_frames")
    .select("*", { count: "exact", head: true })
    .eq("story_id", storyId);

  let position = startingCount ?? 0;

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

    const { error: frameError } = await supabase
      .from("story_frames")
      .insert({ story_id: storyId, media_asset_id: mediaAsset.id, position });

    if (frameError) {
      return { message: frameError.message };
    }

    position += 1;
  }

  revalidatePath(`/projects/${projectId}/stories`);
  revalidatePath(`/projects/${projectId}/stories/${storyId}`);
  return { success: true };
}

export async function removeStoryFrame(projectId: string, storyId: string, frameId: string) {
  const supabase = await createClient();
  await supabase.from("story_frames").delete().eq("id", frameId);
  revalidatePath(`/projects/${projectId}/stories`);
  revalidatePath(`/projects/${projectId}/stories/${storyId}`);
}

export async function reorderStoryFrames(
  projectId: string,
  storyId: string,
  orderedFrameIds: string[],
) {
  const supabase = await createClient();

  await Promise.all(
    orderedFrameIds.map((id, position) =>
      supabase.from("story_frames").update({ position }).eq("id", id),
    ),
  );

  revalidatePath(`/projects/${projectId}/stories/${storyId}`);
}

export async function updateStoryFrameLink(
  projectId: string,
  storyId: string,
  frameId: string,
  linkUrl: string,
) {
  const supabase = await createClient();
  await supabase
    .from("story_frames")
    .update({ link_url: linkUrl.trim() ? linkUrl.trim() : null })
    .eq("id", frameId);

  revalidatePath(`/projects/${projectId}/stories/${storyId}`);
}

export type UpdateStoryLinkState = { message?: string } | undefined;

export async function addStoryLink(
  projectId: string,
  storyId: string,
  _state: UpdateStoryLinkState,
  formData: FormData,
): Promise<UpdateStoryLinkState> {
  const url = String(formData.get("url") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  if (!url) return { message: "URL is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("story_links").insert({ story_id: storyId, url, label });

  if (error) {
    return { message: error.message };
  }

  revalidatePath(`/projects/${projectId}/stories/${storyId}`);
  return undefined;
}

export async function removeStoryLink(projectId: string, storyId: string, linkId: string) {
  const supabase = await createClient();
  await supabase.from("story_links").delete().eq("id", linkId);
  revalidatePath(`/projects/${projectId}/stories/${storyId}`);
}
