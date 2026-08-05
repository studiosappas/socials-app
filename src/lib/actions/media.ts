"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { MediaType } from "@/types/database";

const SIGNED_URL_TTL_SECONDS = 3600;

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

  const { data: signed } = await supabase.storage
    .from("project-media")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

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

  revalidatePath(`/projects/${projectId}/grid`);

  return { posterUrl: signed?.signedUrl };
}
