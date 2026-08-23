"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { uploadPosterIfPresent, setMediaAssetPoster } from "@/lib/actions/media";
import { getStoryPageData, type StoryPageData } from "@/lib/data/stories";
import { generateServerThumbnail } from "@/lib/server-thumbnail";
import type { MediaType, StoryStatus } from "@/types/database";

// Same reasoning as fetchPostForModal in lib/actions/posts.ts -- lets the
// Tasks page open a story in a client-side popup without needing a real
// navigation into /projects/[projectId]/....
export async function fetchStoryForModal(projectId: string, storyId: string): Promise<StoryPageData | null> {
  return getStoryPageData(projectId, storyId);
}

export async function createStory(projectId: string, folderId?: string | null) {
  const supabase = await createClient();

  const { count } = await supabase
    .from("stories")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { data: story, error } = await supabase
    .from("stories")
    .insert({
      project_id: projectId,
      name: "Untitled story",
      position: count ?? 0,
      folder_id: folderId ?? null,
    })
    .select("id")
    .single();

  if (error || !story) {
    throw new Error(error?.message ?? "Failed to create story.");
  }

  // Not revalidating /stories (its own route) -- this always redirects away
  // from it immediately below, and staleTimes.dynamic already forces a
  // fresh fetch of it whenever the user navigates back.
  redirect(`/projects/${projectId}/stories/${story.id}`);
}

// ---------- Content folders ----------

export type ActionResult = { success: true } | { success: false; message: string };

export async function createContentFolder(
  projectId: string,
  name: string,
): Promise<{ id: string } | { message: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { message: "Folder name is required." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_folders")
    .insert({ project_id: projectId, name: trimmed })
    .select("id")
    .single();

  if (error || !data) {
    return { message: error?.message ?? "Failed to create folder." };
  }

  // Not revalidating /stories (its own route) -- its one caller
  // (stories-board.tsx's handleCreateFolder) already calls router.refresh()
  // itself right after this resolves.
  return { id: data.id };
}

export async function renameContentFolder(
  projectId: string,
  folderId: string,
  name: string,
): Promise<ActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { success: false, message: "Folder name is required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("content_folders")
    .update({ name: trimmed })
    .eq("id", folderId);

  if (error) return { success: false, message: error.message };

  // Not revalidating /stories (its own route) -- its one caller
  // (stories-board.tsx's handleRenameFolder) already calls router.refresh()
  // itself right after this resolves.
  return { success: true };
}

// Deletes only the folder row -- contained items fall back to Unfiled via
// folder_id's `on delete set null`, not a cascade delete of the items.
export async function deleteContentFolder(projectId: string, folderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("content_folders").delete().eq("id", folderId);

  if (error) return { success: false, message: error.message };

  // Not revalidating /stories (its own route) -- its one caller
  // (stories-board.tsx's handleDeleteFolder) already calls router.refresh()
  // itself right after this resolves.
  return { success: true };
}

export async function moveStoryToFolder(
  projectId: string,
  storyId: string,
  folderId: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("stories").update({ folder_id: folderId }).eq("id", storyId);

  if (error) return { success: false, message: error.message };

  // Not revalidating /stories (its own route) -- its one caller
  // (story-card.tsx's handleMove) already calls router.refresh() itself
  // right after this resolves.
  return { success: true };
}

// Batched counterparts of moveStoryToFolder/deleteStory for the board's
// multi-select mode (mirrors Grid Media Library's bulkDeleteMedia/
// moveMediaToFolder -- one query each instead of N individual ones).
export async function bulkMoveStoriesToFolder(
  projectId: string,
  storyIds: string[],
  folderId: string | null,
): Promise<ActionResult> {
  if (storyIds.length === 0) return { success: true };
  const supabase = await createClient();
  const { error } = await supabase.from("stories").update({ folder_id: folderId }).in("id", storyIds);

  if (error) return { success: false, message: error.message };

  // Not revalidating /stories (its own route) -- its one caller
  // (stories-board.tsx's handleBulkMove) already calls router.refresh()
  // itself right after this resolves.
  return { success: true };
}

export async function bulkDeleteStories(projectId: string, storyIds: string[]): Promise<ActionResult> {
  if (storyIds.length === 0) return { success: true };
  const supabase = await createClient();
  const { error } = await supabase.from("stories").delete().in("id", storyIds);

  if (error) return { success: false, message: error.message };

  // Not revalidating /stories (its own route) -- its one caller
  // (stories-board.tsx's handleBulkDelete) already calls router.refresh()
  // itself right after this resolves. /calendar is a genuinely different
  // route, kept as-is.
  revalidatePath(`/projects/${projectId}/calendar`);
  return { success: true };
}

// A targeted single-column update, unlike updateStory -- that one reads
// name/scheduled_date/notes from FormData too, so building a fresh FormData
// with only "status" set to reuse it here would silently blank out the
// item's name and notes on every quick status change from the card menu.
export async function updateStoryStatus(
  projectId: string,
  storyId: string,
  status: StoryStatus,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("stories").update({ status }).eq("id", storyId);

  if (error) return { success: false, message: error.message };

  revalidatePath(`/projects/${projectId}/stories`);
  revalidatePath(`/projects/${projectId}/stories/${storyId}`);
  return { success: true };
}

export type UploadContentAssetState = { message?: string; success?: boolean } | undefined;

// Uploads exactly one file per call. It's driven from the client by
// uploadFilesWithPosters, which already submits one FormData per
// selected/dropped file even when several were picked at once (a poster can
// only unambiguously belong to one file per request) -- so each call here
// creates its OWN story + single frame, meaning an N-file drop yields N
// independent content items, not one item with N frames. That's the
// Drive-style "drop a pile of unrelated assets into this folder" flow,
// distinct from the single-item "+" tile inside the editor, which adds more
// frames to one already-existing item.
export async function uploadContentAsset(
  projectId: string,
  folderId: string | null,
  _state: UploadContentAssetState,
  formData: FormData,
): Promise<UploadContentAssetState> {
  // The file itself already went direct browser-to-Storage (see
  // uploadFilesWithPosters in lib/video-poster.ts) before this action ever
  // runs -- this only ever receives the resulting storage path, never the
  // raw file, so it stays well under Vercel's Function request-body limit
  // regardless of how large the actual upload was.
  const storagePath = formData.get("storagePath");
  const mediaTypeRaw = formData.get("mediaType");
  const fileName = formData.get("fileName");
  if (typeof storagePath !== "string" || !storagePath) {
    return { message: "Choose a file to upload." };
  }
  const mediaType: MediaType = mediaTypeRaw === "video" ? "video" : mediaTypeRaw === "pdf" ? "pdf" : "image";
  // Same "already uploaded direct, this is just the resulting path" shape
  // as storagePath/poster above -- see uploadFilesWithPosters' own
  // generateImageThumbnailBlob call, and grid.ts's uploadMedia (the
  // original, now-shared version of this fallback pattern). PDF never gets
  // a thumbnail_storage_path here -- that field is the small-JPEG-of-an-
  // image path specifically; a PDF's cover always lives in
  // poster_storage_path instead (set below via uploadPosterIfPresent), same
  // column video already uses for the identical reason.
  const thumbnailStoragePathRaw = formData.get("thumbnailStoragePath");
  let thumbnailStoragePath =
    typeof thumbnailStoragePathRaw === "string" && thumbnailStoragePathRaw ? thumbnailStoragePathRaw : null;

  const supabase = await createClient();

  // Independent reads -- neither needs the other's result.
  const [
    {
      data: { user },
    },
    { count },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("stories").select("*", { count: "exact", head: true }).eq("project_id", projectId),
  ]);
  if (!user) return { message: "You must be logged in." };

  // Independent uploads -- the poster upload and the server-thumbnail
  // fallback write to different storage paths and neither reads the
  // other's result. The thumbnail fallback only runs when the browser
  // already tried and failed (e.g. a HEIC/HEIF photo no desktop browser can
  // decode into an <img>) -- see server-thumbnail.ts's own comment for the
  // full reasoning.
  const needsServerThumbnail = !thumbnailStoragePath && mediaType === "image";
  const [posterStoragePath, serverThumb] = await Promise.all([
    uploadPosterIfPresent(supabase, projectId, formData, mediaType),
    needsServerThumbnail
      ? generateServerThumbnail(supabase, "project-media", storagePath, projectId)
      : Promise.resolve(null),
  ]);
  if (serverThumb) {
    thumbnailStoragePath = serverThumb.ok ? serverThumb.path : null;
  }

  // Named from the file itself (minus extension) rather than "Untitled
  // story" -- these arrive as standalone assets, not something the user is
  // about to rename immediately the way a freshly created empty item is.
  const name = (typeof fileName === "string" ? fileName : "").replace(/\.[^./]+$/, "").trim() || "Untitled";

  // Every Storage object THIS attempt has created so far -- the original
  // file (already uploaded direct-to-Storage client-side before this action
  // ever ran, see uploadFilesWithPosters) plus whatever cover/thumbnail was
  // just generated above. If anything below fails, this is exactly what
  // gets deleted -- never a pre-existing file, only what this one attempt
  // put there. Without this, a DB-side failure (a rejected media_type, a
  // constraint violation, anything) left the real file sitting in Storage
  // forever with no media_assets row ever pointing at it.
  const uploadedPaths = [storagePath, posterStoragePath, thumbnailStoragePath].filter((p): p is string => Boolean(p));
  async function cleanupOrphanedStorage() {
    await supabase.storage.from("project-media").remove(uploadedPaths);
  }

  // Sequential, not the parallel Promise.all this used to be -- media_assets
  // has to actually exist before stories/story_frames reference it, and
  // each step below can only clean up correctly if it knows exactly which
  // earlier steps already committed.
  const { data: mediaAsset, error: mediaError } = await supabase
    .from("media_assets")
    .insert({
      project_id: projectId,
      storage_path: storagePath,
      media_type: mediaType,
      uploaded_by: user.id,
      thumbnail_storage_path: thumbnailStoragePath,
    })
    .select("id")
    .single();

  if (mediaError || !mediaAsset) {
    // Never surfaced to the user -- a raw Postgres constraint/relation name
    // is meaningless to them and leaks schema detail; console.error keeps
    // the real reason visible in server logs for whoever's debugging this.
    console.error("uploadContentAsset: media_assets insert failed:", mediaError?.message);
    await cleanupOrphanedStorage();
    return { message: "Couldn't upload this file. Please try again." };
  }

  const { data: story, error: storyError } = await supabase
    .from("stories")
    .insert({ project_id: projectId, name, position: count ?? 0, folder_id: folderId })
    .select("id")
    .single();

  if (storyError || !story) {
    console.error("uploadContentAsset: stories insert failed:", storyError?.message);
    await Promise.all([supabase.from("media_assets").delete().eq("id", mediaAsset.id), cleanupOrphanedStorage()]);
    return { message: "Couldn't upload this file. Please try again." };
  }

  // Both only need mediaAsset.id/story.id from above -- setMediaAssetPoster
  // writes to the media_assets row it just inserted, the frame insert
  // writes to a different table entirely, neither depends on the other.
  const [, { error: frameError }] = await Promise.all([
    setMediaAssetPoster(supabase, mediaAsset.id, posterStoragePath),
    supabase.from("story_frames").insert({ story_id: story.id, media_asset_id: mediaAsset.id, position: 0 }),
  ]);

  if (frameError) {
    console.error("uploadContentAsset: story_frames insert failed:", frameError.message);
    await Promise.all([
      supabase.from("stories").delete().eq("id", story.id),
      supabase.from("media_assets").delete().eq("id", mediaAsset.id),
      cleanupOrphanedStorage(),
    ]);
    return { message: "Couldn't upload this file. Please try again." };
  }

  // Not revalidating /stories (its own route) -- its one caller
  // (stories-board.tsx's UploadAssetsZone, via onUploaded) already calls
  // router.refresh() itself right after this resolves.
  return { success: true };
}

// Not revalidating or redirecting -- its one real caller (StoryCard, on the
// Stories list page itself) already removes the card from local state
// before calling this, and was never actually leaving the page in the
// first place (the redirect this used to unconditionally do just sent the
// list page back to... itself, a wasted round trip every single time).
export async function deleteStory(projectId: string, storyId: string) {
  const supabase = await createClient();
  await supabase.from("stories").delete().eq("id", storyId);
}

// Same delete as above, minus the redirect -- used by Calendar's Drafts
// panel bulk-delete, which stays on the Calendar page and may delete several
// mixed posts/stories in one loop (a mid-loop redirect() would both navigate
// away unexpectedly and abort every delete queued after it, since redirect()
// works by throwing).
export async function deleteStoryFromCalendar(projectId: string, storyId: string) {
  const supabase = await createClient();
  await supabase.from("stories").delete().eq("id", storyId);
  // Not revalidating /calendar (its own route -- this is only ever called
  // from Calendar's Drafts panel) -- its one caller (calendar-board.tsx's
  // handleBulkDelete) already calls router.refresh() itself right after.
  // /stories is a genuinely different route, kept as-is.
  revalidatePath(`/projects/${projectId}/stories`);
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
      status: String(formData.get("status") ?? "draft") as StoryStatus,
      notes: String(formData.get("notes") ?? ""),
    })
    .eq("id", storyId);

  if (error) {
    return { message: error.message };
  }

  // Not revalidating this action's own route (/stories/[storyId]) -- the
  // client already applied every field optimistically (see StoryMainForm's
  // handleSave). The list page and Calendar still show this story's
  // name/status, so they still need to reflect the change next visit.
  revalidatePath(`/projects/${projectId}/stories`);
  revalidatePath(`/projects/${projectId}/calendar`);
  return { success: true };
}

export async function addStoryFrame(
  projectId: string,
  storyId: string,
  mediaAssetId: string,
): Promise<{ success: true; frameId: string } | { success: false; message: string }> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("story_frames")
    .select("*", { count: "exact", head: true })
    .eq("story_id", storyId);

  const { data, error } = await supabase
    .from("story_frames")
    .insert({ story_id: storyId, media_asset_id: mediaAssetId, position: count ?? 0 })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, message: error?.message ?? "Failed to add frame." };
  }

  // Not revalidating this action's own route (/stories/[storyId]) -- its
  // one caller (story-editor.tsx's "Add from library" click) already shows
  // the new frame optimistically and reconciles the real id returned here.
  // /stories (the list) is a genuinely different route, kept as-is (a new
  // frame can change that story's list thumbnail).
  revalidatePath(`/projects/${projectId}/stories`);
  return { success: true, frameId: data.id };
}

export type UploadStoryFrameState = { message?: string; success?: boolean } | undefined;

export async function uploadStoryFrame(
  projectId: string,
  storyId: string,
  _state: UploadStoryFrameState,
  formData: FormData,
): Promise<UploadStoryFrameState> {
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
  // Same "already uploaded direct, this is just the resulting path" shape
  // as storagePath/poster above -- see uploadFilesWithPosters' own
  // generateImageThumbnailBlob call, and grid.ts's uploadMedia (the
  // original, now-shared version of this fallback pattern).
  const thumbnailStoragePathRaw = formData.get("thumbnailStoragePath");
  let thumbnailStoragePath =
    typeof thumbnailStoragePathRaw === "string" && thumbnailStoragePathRaw ? thumbnailStoragePathRaw : null;

  const supabase = await createClient();

  // Independent reads -- neither needs the other's result.
  const [
    {
      data: { user },
    },
    { count: startingCount },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("story_frames").select("*", { count: "exact", head: true }).eq("story_id", storyId),
  ]);
  if (!user) return { message: "You must be logged in." };

  const position = startingCount ?? 0;

  // Independent uploads -- same reasoning as uploadContentAsset above.
  const needsServerThumbnail = !thumbnailStoragePath && mediaType === "image";
  const [posterStoragePath, serverThumb] = await Promise.all([
    uploadPosterIfPresent(supabase, projectId, formData, mediaType),
    needsServerThumbnail
      ? generateServerThumbnail(supabase, "project-media", storagePath, projectId)
      : Promise.resolve(null),
  ]);
  if (serverThumb) {
    thumbnailStoragePath = serverThumb.ok ? serverThumb.path : null;
  }

  // Same "clean up exactly what THIS attempt created" reasoning as
  // uploadContentAsset above -- the original file already reached Storage
  // client-side before this action ran, so a DB-side failure here would
  // otherwise leave it orphaned with nothing ever pointing at it.
  const uploadedPaths = [storagePath, posterStoragePath, thumbnailStoragePath].filter((p): p is string => Boolean(p));
  async function cleanupOrphanedStorage() {
    await supabase.storage.from("project-media").remove(uploadedPaths);
  }

  const { data: mediaAsset, error: insertError } = await supabase
    .from("media_assets")
    .insert({
      project_id: projectId,
      storage_path: storagePath,
      media_type: mediaType,
      uploaded_by: user.id,
      thumbnail_storage_path: thumbnailStoragePath,
    })
    .select("id")
    .single();

  if (insertError || !mediaAsset) {
    console.error("uploadStoryFrame: media_assets insert failed:", insertError?.message);
    await cleanupOrphanedStorage();
    return { message: "Couldn't upload this file. Please try again." };
  }

  // Both only need mediaAsset.id -- same reasoning as uploadContentAsset
  // above.
  const [, { error: frameError }] = await Promise.all([
    setMediaAssetPoster(supabase, mediaAsset.id, posterStoragePath),
    supabase.from("story_frames").insert({ story_id: storyId, media_asset_id: mediaAsset.id, position }),
  ]);

  if (frameError) {
    console.error("uploadStoryFrame: story_frames insert failed:", frameError.message);
    await Promise.all([supabase.from("media_assets").delete().eq("id", mediaAsset.id), cleanupOrphanedStorage()]);
    return { message: "Couldn't upload this file. Please try again." };
  }

  // Not revalidating this action's own route (/stories/[storyId]) -- its
  // one caller (story-editor.tsx's UploadFrameTile, via onUploaded) already
  // calls router.refresh() itself right after this resolves. /stories (the
  // list) is a genuinely different route, kept as-is.
  revalidatePath(`/projects/${projectId}/stories`);
  return { success: true };
}

// Not revalidating this action's own route (/stories/[storyId]) -- the
// client already removes the frame from local state before calling this
// (see story-editor.tsx's onRemove). /stories (the list) still needs it:
// removing the cover frame changes that story's thumbnail there.
export async function removeStoryFrame(projectId: string, storyId: string, frameId: string) {
  const supabase = await createClient();
  await supabase.from("story_frames").delete().eq("id", frameId);
  revalidatePath(`/projects/${projectId}/stories`);
}

export async function reorderStoryFrames(
  projectId: string,
  storyId: string,
  orderedFrameIds: string[],
) {
  const supabase = await createClient();

  const results = await Promise.all(
    orderedFrameIds.map((id, position) =>
      supabase.from("story_frames").update({ position }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    throw new Error(failed.error.message);
  }

  // Not revalidating -- the client already shows the reordered frames
  // optimistically (see story-editor.tsx's handleDragEnd), same reasoning
  // as reorderGridPosts.
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

  // Not revalidating -- its one caller (SortableFrame's onBlur in
  // story-editor.tsx) is an uncontrolled input that already shows the typed
  // value with zero dependency on a fresh render, and nothing else on the
  // page displays a frame's link.
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

  // Not revalidating -- its one caller (StoryLinks' handleAdd) already
  // calls router.refresh() itself right after this resolves.
  return undefined;
}

export async function removeStoryLink(projectId: string, storyId: string, linkId: string) {
  const supabase = await createClient();
  await supabase.from("story_links").delete().eq("id", linkId);
  // Not revalidating -- its one caller (StoryLinks' remove button) already
  // calls router.refresh() itself right after this resolves.
}
