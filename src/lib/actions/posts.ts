"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { uploadPosterIfPresent, setMediaAssetPoster } from "@/lib/actions/media";
import { notifyProjectMembers } from "@/lib/notifications";
import { ensureAutoTaskForPost, completeAutoTaskForPost } from "@/lib/actions/task-automation";
import { deriveAutoTaskTitle } from "@/lib/task-title";
import { getPostPageData, type PostPageData } from "@/lib/data/posts";
import { syncPostType } from "@/lib/post-type";
import type { MediaType, PostStatus, PostType, ReviewStatus } from "@/types/database";

export type UpdatePostState = { message?: string } | undefined;

// Lets the Tasks page (src/app/tasks/*) open a post in a client-side popup
// instead of navigating away -- it lives outside /projects/[projectId]/...
// entirely (see that layout's own comment for why), so it can't reach
// getPostPageData directly (that needs the server-only Supabase client) or
// rely on the intercepted-route modal Grid/Calendar use, which only
// activates for soft navigations already inside that route tree.
export async function fetchPostForModal(projectId: string, postId: string): Promise<PostPageData | null> {
  return getPostPageData(projectId, postId);
}

export async function deletePost(projectId: string, postId: string) {
  const supabase = await createClient();
  await supabase.from("posts").delete().eq("id", postId);
  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath(`/projects/${projectId}/calendar`);
}

export async function updatePost(
  projectId: string,
  postId: string,
  _state: UpdatePostState,
  formData: FormData,
): Promise<UpdatePostState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const scheduledDate = String(formData.get("scheduled_date") ?? "").trim();
  const scheduledTime = String(formData.get("scheduled_time") ?? "").trim();
  const nextStatus = String(formData.get("status") ?? "draft") as PostStatus;
  const caption = String(formData.get("caption") ?? "");

  const { data: before } = await supabase.from("posts").select("status, post_type").eq("id", postId).single();

  // post_type: adding/replacing/removing media auto-suggests the right
  // value (lib/post-type.ts's syncPostType, called from those actions), but
  // the user can still override it by hand here -- an explicit pick always
  // wins over the auto-suggestion until the next media change re-derives it.
  const postType = String(formData.get("post_type") ?? before?.post_type ?? "post") as PostType;

  const { error } = await supabase
    .from("posts")
    .update({
      post_type: postType,
      status: nextStatus,
      caption,
      notes: String(formData.get("notes") ?? ""),
      scheduled_date: scheduledDate ? scheduledDate : null,
    })
    .eq("id", postId);

  if (error) {
    return { message: error.message };
  }

  if (scheduledDate) {
    await ensureAutoTaskForPost(supabase, projectId, postId, {
      title: deriveAutoTaskTitle(caption, postType, scheduledDate),
      dueDate: scheduledDate,
    });
  }

  // Auto-complete is a one-way push toward "done" on an in-app-observable
  // signal (the team marking the post Published themselves) -- not real
  // Instagram publish state, which this app has no way to observe. Manual
  // override afterward (reopening the task) always stays possible since
  // this never runs again once the task is already done.
  if (nextStatus === "published" && before?.status !== "published") {
    await completeAutoTaskForPost(supabase, postId);
  }

  // Isolated from the update above -- scheduled_time is a new column that
  // may not exist yet on a not-yet-migrated database, and PostgREST fails
  // the WHOLE statement if any referenced column is missing.
  await supabase
    .from("posts")
    .update({ scheduled_time: scheduledTime ? scheduledTime : null })
    .eq("id", postId);

  // Same isolation reasoning -- review_status is what a client's review-link
  // submission also writes to (set_post_review_status_by_token), so a
  // manual edit here uses the exact same column, never a second field.
  const reviewStatus = formData.get("review_status");
  if (reviewStatus) {
    await supabase
      .from("posts")
      .update({ review_status: String(reviewStatus) as ReviewStatus })
      .eq("id", postId);
  }

  // Only the transition INTO "in_review", not every save made while a post
  // already sits in that status -- otherwise this would fire on every
  // unrelated edit (caption tweak, date change) to a post already pending review.
  if (nextStatus === "in_review" && before?.status !== "in_review") {
    await notifyProjectMembers(
      supabase,
      projectId,
      "approval_requested",
      { title: "A post is ready for approval", icon: "✅", link: `/projects/${projectId}/posts/${postId}` },
      { excludeUserId: user?.id },
    );
  }

  revalidatePath(`/projects/${projectId}/posts/${postId}`);
  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath("/tasks");
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

  await syncPostType(supabase, postId);

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
  // The file itself already went direct browser-to-Storage (see
  // uploadFilesWithPosters in lib/video-poster.ts) before this action ever
  // runs -- this only ever receives the resulting storage path, never the
  // raw file, so it stays well under Vercel's Function request-body limit
  // regardless of how large the actual upload was.
  const storagePath = formData.get("storagePath");
  const mediaTypeRaw = formData.get("mediaType");
  if (typeof storagePath !== "string" || !storagePath) {
    return { message: "Choose a file to upload." };
  }
  const mediaType: MediaType = mediaTypeRaw === "video" ? "video" : "image";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "You must be logged in." };

  const { count: startingCount } = await supabase
    .from("post_assets")
    .select("*", { count: "exact", head: true })
    .eq("post_id", postId);

  const position = startingCount ?? 0;

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

  const { error: assetError } = await supabase
    .from("post_assets")
    .insert({ post_id: postId, media_asset_id: mediaAsset.id, position });

  if (assetError) {
    return { message: assetError.message };
  }

  await syncPostType(supabase, postId);

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
  await syncPostType(supabase, postId);
  revalidatePath(`/projects/${projectId}/posts/${postId}`);
  revalidatePath(`/projects/${projectId}/grid`);
}

export type ReplacePostAssetState = { message?: string; success?: boolean } | undefined;

// Swaps an existing post_asset's media in place -- unlike delete-then-add,
// `position` (carousel order) never changes. `formData` carries either a
// "media_asset_id" (pick from library) or a "file" (upload a new one,
// mirroring uploadPostAsset's own upload handling). If this is the post's
// cover (position 0), also resets posts.cover_transform to null: the new
// image may be framed completely differently, so the old pan/zoom fraction
// shouldn't silently keep applying to it.
export async function replacePostAsset(
  projectId: string,
  postId: string,
  postAssetId: string,
  _state: ReplacePostAssetState,
  formData: FormData,
): Promise<ReplacePostAssetState> {
  const supabase = await createClient();

  const existingMediaAssetId = String(formData.get("media_asset_id") ?? "").trim();
  // The file itself already went direct browser-to-Storage before this
  // action ever runs (see ReplaceAssetPopover.handleFileChange) -- this only
  // ever receives the resulting storage path, never the raw file.
  const newStoragePathValue = formData.get("storagePath");
  const mediaTypeRaw = formData.get("mediaType");

  let newMediaAssetId: string;

  if (existingMediaAssetId) {
    newMediaAssetId = existingMediaAssetId;
  } else if (typeof newStoragePathValue === "string" && newStoragePathValue) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { message: "You must be logged in." };

    const mediaType: MediaType = mediaTypeRaw === "video" ? "video" : "image";
    const posterStoragePath = await uploadPosterIfPresent(supabase, projectId, formData, mediaType);

    const { data: mediaAsset, error: insertError } = await supabase
      .from("media_assets")
      .insert({ project_id: projectId, storage_path: newStoragePathValue, media_type: mediaType, uploaded_by: user.id })
      .select("id")
      .single();
    if (insertError || !mediaAsset) return { message: insertError?.message ?? "Failed to save media." };

    await setMediaAssetPoster(supabase, mediaAsset.id, posterStoragePath);
    newMediaAssetId = mediaAsset.id;
  } else {
    return { message: "Choose a file or select from the library." };
  }

  const { data: existingRow } = await supabase
    .from("post_assets")
    .select("position")
    .eq("id", postAssetId)
    .single();

  const { error: updateError } = await supabase
    .from("post_assets")
    .update({ media_asset_id: newMediaAssetId })
    .eq("id", postAssetId);
  if (updateError) return { message: updateError.message };

  if (existingRow?.position === 0) {
    await supabase.from("posts").update({ cover_transform: null }).eq("id", postId);
  }

  await syncPostType(supabase, postId);

  revalidatePath(`/projects/${projectId}/posts/${postId}`);
  revalidatePath(`/projects/${projectId}/grid`);
  return { success: true };
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
