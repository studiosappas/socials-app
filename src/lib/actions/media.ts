"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { MediaType } from "@/types/database";

const SIGNED_URL_TTL_SECONDS = 3600;

// If this asset is the cover (position 0) of any post, that post's saved
// pan/zoom (posts.cover_transform) is about to be reframing a different
// image than it was cropped against -- reset it rather than let a stale
// crop silently keep applying. A media asset can in principle be a cover on
// more than one post (added via "Add from library" to two different
// posts), so this clears every one of them, not just a single postId the
// caller happens to know about.
async function resetCoverTransformForAsset(
  supabase: Awaited<ReturnType<typeof createClient>>,
  mediaAssetId: string,
): Promise<void> {
  const { data: coverRows } = await supabase
    .from("post_assets")
    .select("post_id")
    .eq("media_asset_id", mediaAssetId)
    .eq("position", 0);

  const postIds = (coverRows ?? []).map((r) => r.post_id);
  if (postIds.length === 0) return;

  await supabase.from("posts").update({ cover_transform: null }).in("id", postIds);
}

// Shared by every upload action that accepts video (grid.ts's uploadMedia,
// posts.ts's uploadPostAsset, stories.ts's uploadStoryFrame): the client
// generates a poster frame for video files client-side (video-poster.ts)
// and submits it as a "poster" field alongside the single "file" it's
// paired with. Grid never mounts a <video> for its cover, so this is what
// lets a video-first post/carousel-item still show a static thumbnail.
export async function uploadPosterIfPresent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  formData: FormData,
  mediaType: MediaType,
): Promise<string | null> {
  if (mediaType !== "video") return null;
  const posterFile = formData.get("poster");
  if (!(posterFile instanceof File) || posterFile.size === 0) return null;

  const posterPath = `${projectId}/${crypto.randomUUID()}-poster.jpg`;
  const { error } = await supabase.storage
    .from("project-media")
    .upload(posterPath, posterFile, { contentType: "image/jpeg" });

  return error ? null : posterPath;
}

// Deliberately a separate call from the initial media_assets insert, not a
// field folded into it -- poster_storage_path is a newer column that may
// not exist yet on a not-yet-migrated database, and PostgREST fails the
// ENTIRE insert if any referenced column is missing. Isolating it here
// means a pending migration only means new videos show without a poster
// yet, not that every upload (including plain images) breaks outright.
export async function setMediaAssetPoster(
  supabase: Awaited<ReturnType<typeof createClient>>,
  mediaAssetId: string,
  posterStoragePath: string | null,
): Promise<void> {
  if (!posterStoragePath) return;
  await supabase.from("media_assets").update({ poster_storage_path: posterStoragePath }).eq("id", mediaAssetId);
}

// Same shape/flow as saveBriefAnnotation (src/lib/actions/brief.ts): upload
// the flattened preview, store it alongside the editable annotation state.
// Lives on media_assets itself rather than a separate attachment row since
// an uploaded asset is already the shared thing both post_assets and Grid's
// cover-image lookup point at -- editing it here is what makes an edited
// cover image show up on the Grid slot, per the project-media bucket being
// private (unlike Brief's public brief-media bucket), the returned preview
// URL has to be signed rather than a plain public URL.
export async function saveMediaAssetAnnotation(
  projectId: string,
  mediaAssetId: string,
  formData: FormData,
): Promise<{ previewUrl?: string; message?: string }> {
  const file = formData.get("file");
  const annotationJsonRaw = formData.get("annotation_json");
  if (!(file instanceof File) || file.size === 0) {
    return { message: "No preview image provided." };
  }
  if (typeof annotationJsonRaw !== "string") {
    return { message: "Missing annotation data." };
  }

  let annotationJson: object;
  try {
    annotationJson = JSON.parse(annotationJsonRaw);
  } catch {
    return { message: "Invalid annotation data." };
  }

  const supabase = await createClient();
  const storagePath = `${projectId}/${crypto.randomUUID()}-preview.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("project-media")
    .upload(storagePath, file, { contentType: file.type });

  if (uploadError) {
    return { message: uploadError.message };
  }

  const { error: updateError } = await supabase
    .from("media_assets")
    .update({ preview_storage_path: storagePath, annotation_json: annotationJson })
    .eq("id", mediaAssetId);

  if (updateError) {
    return { message: updateError.message };
  }

  await resetCoverTransformForAsset(supabase, mediaAssetId);

  const { data: signed } = await supabase.storage
    .from("project-media")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath(`/projects/${projectId}/calendar`);
  revalidatePath(`/projects/${projectId}/stories`);

  return { previewUrl: signed?.signedUrl };
}

// Same shape as saveMediaAssetAnnotation above (and satisfies the same
// AnnotationSaveAction interface, so AnnotationEditor stays agnostic to
// which one it's calling), but for a video's manually-picked cover frame --
// writes poster_storage_path instead of preview_storage_path, since that's
// the column Grid/Calendar/Stories actually read for a video's cover (see
// grid-data.ts: a video cover resolves from poster_storage_path only,
// never preview_storage_path). annotation_json is still saved to the same
// column images use, since a video asset never otherwise has anything in
// it -- reopening "Edit Image" on this video later restores the exact same
// crop/text/arrows without needing a separate column.
export async function saveMediaAssetPosterAnnotation(
  projectId: string,
  mediaAssetId: string,
  formData: FormData,
): Promise<{ previewUrl?: string; message?: string }> {
  const file = formData.get("file");
  const annotationJsonRaw = formData.get("annotation_json");
  if (!(file instanceof File) || file.size === 0) {
    return { message: "No cover image provided." };
  }
  if (typeof annotationJsonRaw !== "string") {
    return { message: "Missing annotation data." };
  }

  let annotationJson: object;
  try {
    annotationJson = JSON.parse(annotationJsonRaw);
  } catch {
    return { message: "Invalid annotation data." };
  }

  const supabase = await createClient();
  const posterPath = `${projectId}/${crypto.randomUUID()}-poster.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("project-media")
    .upload(posterPath, file, { contentType: file.type });

  if (uploadError) {
    return { message: uploadError.message };
  }

  const { error: updateError } = await supabase
    .from("media_assets")
    .update({ poster_storage_path: posterPath, annotation_json: annotationJson })
    .eq("id", mediaAssetId);

  if (updateError) {
    return { message: updateError.message };
  }

  await resetCoverTransformForAsset(supabase, mediaAssetId);

  const { data: signed } = await supabase.storage
    .from("project-media")
    .createSignedUrl(posterPath, SIGNED_URL_TTL_SECONDS);

  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath(`/projects/${projectId}/calendar`);
  revalidatePath(`/projects/${projectId}/stories`);

  return { previewUrl: signed?.signedUrl };
}

// Manual escape hatch for a video whose poster was never captured (e.g.
// uploaded before poster capture existed, or the original client-side
// capture failed/timed out) -- the client re-fetches the original video and
// re-runs the same capture (generatePosterFromVideoUrl in video-poster.ts),
// then this just uploads+saves the result the same way the initial upload
// path does.
export async function saveRegeneratedPoster(
  projectId: string,
  mediaAssetId: string,
  formData: FormData,
): Promise<{ posterUrl?: string; message?: string }> {
  const file = formData.get("poster");
  if (!(file instanceof File) || file.size === 0) {
    return { message: "Couldn't capture a frame from this video." };
  }

  const supabase = await createClient();
  const posterPath = `${projectId}/${crypto.randomUUID()}-poster.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("project-media")
    .upload(posterPath, file, { contentType: "image/jpeg" });

  if (uploadError) {
    return { message: uploadError.message };
  }

  const { error: updateError } = await supabase
    .from("media_assets")
    .update({ poster_storage_path: posterPath })
    .eq("id", mediaAssetId);

  if (updateError) {
    return { message: updateError.message };
  }

  const { data: signed } = await supabase.storage
    .from("project-media")
    .createSignedUrl(posterPath, SIGNED_URL_TTL_SECONDS);

  // Not revalidating /grid (its own route, only caller) -- the self-heal
  // effect in grid-board.tsx already patches this slot's thumbnail locally
  // from the posterUrl returned below.
  return { posterUrl: signed?.signedUrl };
}
