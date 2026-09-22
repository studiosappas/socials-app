"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCachedSignedUrl } from "@/lib/signed-url-cache";
import { logSystemEvent } from "@/lib/system-event-log";
import type { MediaType } from "@/types/database";

// TEMPORARY DIAGNOSTIC -- added specifically to trace a real, Supabase-
// backed Adjustments Paste failure a local/stubbed environment could not
// reproduce (see src/lib/paste-diagnostics.ts's own header, and
// annotation-engine.ts's exportAndSaveAnnotation, which sets
// formData.__diag_op_id when a paste is in progress). Inline here (rather
// than importing paste-diagnostics.ts, a "use client" module) since this
// file is "use server" -- these two log helpers are the server-side half
// of the same opId-tagged trace, so a failure that a server action THREW
// (an unhandled rejection the client only ever saw as a generic
// "Couldn't save changes") is visible here in this action's own logs
// (dev server terminal locally; Vercel function logs in production) even
// when the client-side error message alone wasn't enough to diagnose it.
// Delete both helpers and every diagLog/diagLogFail call site in this file
// once the real failing stage is identified and properly fixed.
function diagLog(opId: string | null, stage: string, extra?: Record<string, unknown>) {
  if (!opId) return;
  console.log(`[PasteStyle][${opId}][server] stage=${stage}`, extra ?? "");
}
function diagLogFail(opId: string | null, stage: string, error: unknown, extra?: Record<string, unknown>) {
  const info =
    error instanceof Error
      ? { name: error.name, message: error.message, code: (error as Error & { code?: string }).code }
      : { name: typeof error, message: String(error) };
  console.error(`[PasteStyle][${opId ?? "?"}][server] FAILED stage=${stage}`, info, extra ?? "");
}

// TEMPORARY DIAGNOSTIC -- added specifically to trace a real, reported
// cross-post identity leak (one post's edit appearing on another untouched
// post) that a local/stubbed environment could not reproduce with
// certainty. UNCONDITIONAL, unlike diagLog/diagLogFail above -- those stay
// completely silent unless a caller passed an opId, which the ordinary
// visible Image Editor's own Save button never does (only Grid's Paste
// Style debug build does), so they'd never print a single line for the
// exact flow under investigation here. Logs exactly which post/asset
// identity every clone-on-write decision involved -- dev server terminal
// locally, Vercel function logs in production -- so a real reproduction
// shows whether an operation intended for one post ever touched another
// post's identity. Never logs signed URLs, tokens, cookies, or file
// contents. Remove every mediaMutationLog call site once the real
// cross-post corruption is confirmed fixed against production.
function mediaMutationLog(entry: {
  action: string;
  postId?: string | null;
  sourceAssetId?: string | null;
  targetAssetId?: string | null;
  stage: string;
  extra?: Record<string, unknown>;
}) {
  console.log(
    `[MediaMutation] action=${entry.action} post=${entry.postId ?? "(none)"} sourceAsset=${(entry.sourceAssetId ?? "(none)").slice(0, 8)} targetAsset=${(entry.targetAssetId ?? "(none)").slice(0, 8)} stage=${entry.stage}`,
    entry.extra ?? "",
  );
}

// LIBRARY ASSET = clean reusable source; POST/GRID USAGE = independently
// editable instance. media_assets rows are the current, real ownership
// scope for annotation_json/preview_storage_path/poster_storage_path
// (confirmed by saveMediaAssetAnnotation/saveMediaAssetPosterAnnotation
// below, which write those columns keyed ONLY by media_asset_id, with no
// per-post scoping anywhere in the schema) -- so two posts that both got
// assigned "the same Library asset" via Grid/Add-from-library are, today,
// literally sharing one media_assets ROW, not just the same source image.
// Editing one post's usage previously mutated that shared row directly,
// silently editing every other post using it too. This creates an
// independent copy for exactly one post's exclusive use going forward --
// same storage_path/media_type/thumbnail/poster (still the same underlying
// image bytes), but a clean annotation_json/preview_storage_path (never
// copied from the source), and a brand-new id nothing else references yet.
// The source row is never mutated or deleted -- whichever other post(s)
// still point at it keep rendering exactly what they already had.
export async function cloneMediaAssetForDivergence(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceAssetId: string,
): Promise<string | null> {
  const { data: source } = await supabase
    .from("media_assets")
    .select("project_id, storage_path, media_type, thumbnail_storage_path, poster_storage_path")
    .eq("id", sourceAssetId)
    .maybeSingle();
  if (!source) return null;

  // uploaded_by must be the ACTING user, never the source asset's original
  // uploader -- "Members can upload media"'s RLS with-check requires
  // uploaded_by = auth.uid(). Copying the source's own uploaded_by (the
  // first version of this function) silently failed that check on every
  // project with more than one member, the instant the person editing
  // wasn't the same person who originally uploaded the shared Library
  // asset -- an ordinary case, not an edge case. Every caller below now
  // treats a failed clone as fatal rather than a reason to fall back to
  // writing on the shared row -- this exact silent RLS rejection is what
  // let one post's edit leak onto every other post sharing the same asset.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: clone, error } = await supabase
    .from("media_assets")
    .insert({
      project_id: source.project_id,
      storage_path: source.storage_path,
      media_type: source.media_type,
      thumbnail_storage_path: source.thumbnail_storage_path,
      poster_storage_path: source.poster_storage_path,
      uploaded_by: user.id,
    })
    .select("id")
    .single();

  mediaMutationLog({
    action: "cloneMediaAssetForDivergence",
    sourceAssetId,
    targetAssetId: clone?.id ?? null,
    stage: error || !clone ? "clone-insert-failed" : "clone-insert-succeeded",
    extra: error ? { errorMessage: error.message, actingUser: user.id.slice(0, 8) } : { actingUser: user.id.slice(0, 8) },
  });

  return error || !clone ? null : clone.id;
}

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
// posts.ts's uploadPostAsset, stories.ts's uploadStoryFrame) and, now, PDF
// (stories.ts's uploadContentAsset -- the Content page's own upload zone;
// Grid/Post Editor never send mediaType "pdf" at all, since their own file
// pickers still only accept image/video, so this stays dormant for them):
// the client generates a cover image client-side (video-poster.ts's own
// poster capture, or pdf-cover.ts's page-1 render) and submits it as a
// "poster" field alongside the single "file" it's paired with -- one field
// name/code path for both, since they're the same concept (a small
// generated image standing in for a source a plain <img> can't decode).
export async function uploadPosterIfPresent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  formData: FormData,
  mediaType: MediaType,
): Promise<string | null> {
  if (mediaType !== "video" && mediaType !== "pdf") return null;
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

// Read-only lookup for Grid's Copy Style feature -- Text and Adjustments
// aren't independently queryable anywhere; both live only inside this
// asset's own annotation_json blob (see saveMediaAssetAnnotation below), so
// "Copy style" fetches it directly rather than assuming the Grid slot's own
// client state already has it.
export async function getMediaAssetAnnotationJson(
  mediaAssetId: string,
): Promise<{ annotationJson: object | null; message?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media_assets")
    .select("annotation_json")
    .eq("id", mediaAssetId)
    .maybeSingle();
  if (error) return { annotationJson: null, message: error.message };
  return { annotationJson: (data?.annotation_json as object | null) ?? null };
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
): Promise<{ previewUrl?: string; message?: string; mediaAssetId?: string }> {
  const opId = (formData.get("__diag_op_id") as string) || null;
  try {
    const file = formData.get("file");
    const annotationJsonRaw = formData.get("annotation_json");
    diagLog(opId, "server-received", {
      fileSize: file instanceof File ? file.size : null,
      fileType: file instanceof File ? file.type : null,
      hasAnnotationJson: typeof annotationJsonRaw === "string",
    });
    if (!(file instanceof File) || file.size === 0) {
      diagLogFail(opId, "server-received", new Error("No preview image provided."));
      return { message: "No preview image provided." };
    }
    if (typeof annotationJsonRaw !== "string") {
      diagLogFail(opId, "server-received", new Error("Missing annotation data."));
      return { message: "Missing annotation data." };
    }

    let annotationJson: object;
    try {
      annotationJson = JSON.parse(annotationJsonRaw);
    } catch (err) {
      diagLogFail(opId, "annotation-json-parse", err);
      return { message: "Invalid annotation data." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Edit-time copy-on-write -- see cloneMediaAssetForDivergence's own
    // comment. postId is threaded through formData rather than a new
    // positional parameter so this still satisfies the shared
    // AnnotationSaveAction signature every caller (including Brief, which
    // has no post concept at all and never sets this) uses unmodified.
    // Only clones when mediaAssetId is CURRENTLY someone else's cover too --
    // a post editing its own exclusively-owned asset keeps writing directly
    // to it, exactly as before.
    //
    // FAIL CLOSED, not open: if this save WAS determined to need its own
    // copy (sharedWithAnotherPost) and the clone/repoint step fails for ANY
    // reason, this must refuse the save rather than fall back to writing
    // directly onto the still-shared row -- that fallback is exactly what
    // let one post's edit silently leak onto every other post sharing the
    // same asset (confirmed root cause: cloneMediaAssetForDivergence's
    // insert used to fail RLS whenever the editing user differed from the
    // asset's original uploader, and this fell back to the shared row with
    // no error surfaced at all).
    const editingPostIdRaw = formData.get("post_id");
    const editingPostId = typeof editingPostIdRaw === "string" && editingPostIdRaw ? editingPostIdRaw : null;
    mediaMutationLog({ action: "saveMediaAssetAnnotation", postId: editingPostId, sourceAssetId: mediaAssetId, stage: "received", extra: { postIdWasProvided: Boolean(editingPostId) } });
    let targetAssetId = mediaAssetId;
    let clonedAssetId: string | null = null;
    if (editingPostId) {
      const { data: coverUsers } = await supabase
        .from("post_assets")
        .select("post_id")
        .eq("media_asset_id", mediaAssetId)
        .eq("position", 0);
      const sharedWithAnotherPost = (coverUsers ?? []).some((r) => r.post_id !== editingPostId);
      mediaMutationLog({
        action: "saveMediaAssetAnnotation",
        postId: editingPostId,
        sourceAssetId: mediaAssetId,
        stage: "shared-check",
        extra: { coverUserPostIds: (coverUsers ?? []).map((r) => r.post_id), sharedWithAnotherPost },
      });
      if (sharedWithAnotherPost) {
        const cloneId = await cloneMediaAssetForDivergence(supabase, mediaAssetId);
        if (!cloneId) {
          diagLogFail(opId, "divergence-clone-failed", new Error("cloneMediaAssetForDivergence returned null"), { mediaAssetId, editingPostId });
          mediaMutationLog({ action: "saveMediaAssetAnnotation", postId: editingPostId, sourceAssetId: mediaAssetId, stage: "divergence-clone-failed-refusing-save" });
          return { message: "Couldn't save this edit independently. Please try again." };
        }
        const { error: repointError } = await supabase
          .from("post_assets")
          .update({ media_asset_id: cloneId })
          .eq("post_id", editingPostId)
          .eq("media_asset_id", mediaAssetId)
          .eq("position", 0);
        if (repointError) {
          diagLogFail(opId, "divergence-repoint-failed", repointError, { mediaAssetId, cloneId, editingPostId });
          mediaMutationLog({ action: "saveMediaAssetAnnotation", postId: editingPostId, sourceAssetId: mediaAssetId, targetAssetId: cloneId, stage: "divergence-repoint-failed-refusing-save" });
          return { message: "Couldn't save this edit independently. Please try again." };
        }
        targetAssetId = cloneId;
        clonedAssetId = cloneId;
        diagLog(opId, "cloned-for-divergence", { from: mediaAssetId, to: cloneId });
        mediaMutationLog({ action: "saveMediaAssetAnnotation", postId: editingPostId, sourceAssetId: mediaAssetId, targetAssetId: cloneId, stage: "diverged-repointed" });
      }
    }
    mediaMutationLog({ action: "saveMediaAssetAnnotation", postId: editingPostId, sourceAssetId: mediaAssetId, targetAssetId, stage: "resolved-write-target" });

    const storagePath = `${projectId}/${crypto.randomUUID()}-preview.jpg`;
    mediaMutationLog({ action: "saveMediaAssetAnnotation", postId: editingPostId, sourceAssetId: mediaAssetId, targetAssetId, stage: "preview-upload-start", extra: { storagePath, fileBytes: file.size } });

    const { error: uploadError } = await supabase.storage
      .from("project-media")
      .upload(storagePath, file, { contentType: file.type });

    if (uploadError) {
      diagLogFail(opId, "storage-upload", uploadError, { storagePath });
      await logSystemEvent(supabase, {
        category: "annotation_save_failed",
        area: "image-editor",
        message: uploadError.message,
        projectId,
        userId: user?.id ?? null,
      });
      return { message: uploadError.message };
    }
    diagLog(opId, "storage-upload-complete", { storagePath });

    const { error: updateError } = await supabase
      .from("media_assets")
      .update({ preview_storage_path: storagePath, annotation_json: annotationJson })
      .eq("id", targetAssetId);
    mediaMutationLog({ action: "saveMediaAssetAnnotation", postId: editingPostId, sourceAssetId: mediaAssetId, targetAssetId, stage: "media-asset-row-updated", extra: { storagePath, fileBytes: file.size, error: updateError?.message } });

    if (updateError) {
      diagLogFail(opId, "db-update", updateError, { mediaAssetId: targetAssetId });
      await logSystemEvent(supabase, {
        category: "annotation_save_failed",
        area: "image-editor",
        message: updateError.message,
        projectId,
        userId: user?.id ?? null,
      });
      return { message: updateError.message };
    }
    diagLog(opId, "db-update-complete");

    await resetCoverTransformForAsset(supabase, targetAssetId);
    diagLog(opId, "cover-transform-reset");

    // Brand-new path every edit (crypto.randomUUID() above), so this is
    // always a cache miss for correctness -- routed through the shared cache
    // anyway so the next page load that reads this exact path (Grid,
    // Calendar, Stories) reuses this same signed URL instead of re-signing it.
    const previewUrl = await getCachedSignedUrl(supabase, "project-media", storagePath);
    diagLog(opId, "signed-url-generated", { hasPreviewUrl: Boolean(previewUrl) });

    revalidatePath(`/projects/${projectId}/grid`);
    revalidatePath(`/projects/${projectId}/calendar`);
    revalidatePath(`/projects/${projectId}/stories`);

    diagLog(opId, "server-complete");
    return { previewUrl: previewUrl ?? undefined, mediaAssetId: clonedAssetId ?? undefined };
  } catch (error) {
    // Reaching here means something threw that none of the explicit
    // `if (error)` checks above ever saw -- previously an UNHANDLED
    // rejection the client's saveAction(...) call only ever observed as a
    // generic, cause-less failure. Returning a safe {message} here instead
    // (rather than letting it propagate) means the client's own
    // exportAndSaveAnnotation now gets a REAL message via result.message
    // instead of falling through to its own "Couldn't save changes. Try
    // again." catch-all.
    diagLogFail(opId, "saveMediaAssetAnnotation-uncaught", error, { mediaAssetId });
    return {
      message: error instanceof Error ? `Unexpected server error: ${error.message}` : "Unexpected server error.",
    };
  }
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
): Promise<{ previewUrl?: string; message?: string; mediaAssetId?: string }> {
  const opId = (formData.get("__diag_op_id") as string) || null;
  try {
    const file = formData.get("file");
    const annotationJsonRaw = formData.get("annotation_json");
    diagLog(opId, "server-received", {
      fileSize: file instanceof File ? file.size : null,
      fileType: file instanceof File ? file.type : null,
      hasAnnotationJson: typeof annotationJsonRaw === "string",
    });
    if (!(file instanceof File) || file.size === 0) {
      diagLogFail(opId, "server-received", new Error("No cover image provided."));
      return { message: "No cover image provided." };
    }
    if (typeof annotationJsonRaw !== "string") {
      diagLogFail(opId, "server-received", new Error("Missing annotation data."));
      return { message: "Missing annotation data." };
    }

    let annotationJson: object;
    try {
      annotationJson = JSON.parse(annotationJsonRaw);
    } catch (err) {
      diagLogFail(opId, "annotation-json-parse", err);
      return { message: "Invalid annotation data." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Same copy-on-write reasoning as saveMediaAssetAnnotation above --
    // FAIL CLOSED, not open, on a determined-necessary clone that fails
    // (see that function's own comment for the confirmed root cause this
    // guards against).
    const editingPostIdRaw = formData.get("post_id");
    const editingPostId = typeof editingPostIdRaw === "string" && editingPostIdRaw ? editingPostIdRaw : null;
    mediaMutationLog({ action: "saveMediaAssetPosterAnnotation", postId: editingPostId, sourceAssetId: mediaAssetId, stage: "received", extra: { postIdWasProvided: Boolean(editingPostId) } });
    let targetAssetId = mediaAssetId;
    let clonedAssetId: string | null = null;
    if (editingPostId) {
      const { data: coverUsers } = await supabase
        .from("post_assets")
        .select("post_id")
        .eq("media_asset_id", mediaAssetId)
        .eq("position", 0);
      const sharedWithAnotherPost = (coverUsers ?? []).some((r) => r.post_id !== editingPostId);
      mediaMutationLog({
        action: "saveMediaAssetPosterAnnotation",
        postId: editingPostId,
        sourceAssetId: mediaAssetId,
        stage: "shared-check",
        extra: { coverUserPostIds: (coverUsers ?? []).map((r) => r.post_id), sharedWithAnotherPost },
      });
      if (sharedWithAnotherPost) {
        const cloneId = await cloneMediaAssetForDivergence(supabase, mediaAssetId);
        if (!cloneId) {
          diagLogFail(opId, "divergence-clone-failed", new Error("cloneMediaAssetForDivergence returned null"), { mediaAssetId, editingPostId });
          mediaMutationLog({ action: "saveMediaAssetPosterAnnotation", postId: editingPostId, sourceAssetId: mediaAssetId, stage: "divergence-clone-failed-refusing-save" });
          return { message: "Couldn't save this edit independently. Please try again." };
        }
        const { error: repointError } = await supabase
          .from("post_assets")
          .update({ media_asset_id: cloneId })
          .eq("post_id", editingPostId)
          .eq("media_asset_id", mediaAssetId)
          .eq("position", 0);
        if (repointError) {
          diagLogFail(opId, "divergence-repoint-failed", repointError, { mediaAssetId, cloneId, editingPostId });
          mediaMutationLog({ action: "saveMediaAssetPosterAnnotation", postId: editingPostId, sourceAssetId: mediaAssetId, targetAssetId: cloneId, stage: "divergence-repoint-failed-refusing-save" });
          return { message: "Couldn't save this edit independently. Please try again." };
        }
        targetAssetId = cloneId;
        clonedAssetId = cloneId;
        diagLog(opId, "cloned-for-divergence", { from: mediaAssetId, to: cloneId });
        mediaMutationLog({ action: "saveMediaAssetPosterAnnotation", postId: editingPostId, sourceAssetId: mediaAssetId, targetAssetId: cloneId, stage: "diverged-repointed" });
      }
    }
    mediaMutationLog({ action: "saveMediaAssetPosterAnnotation", postId: editingPostId, sourceAssetId: mediaAssetId, targetAssetId, stage: "resolved-write-target" });

    const posterPath = `${projectId}/${crypto.randomUUID()}-poster.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("project-media")
      .upload(posterPath, file, { contentType: file.type });

    if (uploadError) {
      diagLogFail(opId, "storage-upload", uploadError, { posterPath });
      await logSystemEvent(supabase, {
        category: "annotation_save_failed",
        area: "image-editor",
        message: uploadError.message,
        projectId,
        userId: user?.id ?? null,
      });
      return { message: uploadError.message };
    }
    diagLog(opId, "storage-upload-complete", { posterPath });

    const { error: updateError } = await supabase
      .from("media_assets")
      .update({ poster_storage_path: posterPath, annotation_json: annotationJson })
      .eq("id", targetAssetId);

    if (updateError) {
      diagLogFail(opId, "db-update", updateError, { mediaAssetId: targetAssetId });
      await logSystemEvent(supabase, {
        category: "annotation_save_failed",
        area: "image-editor",
        message: updateError.message,
        projectId,
        userId: user?.id ?? null,
      });
      return { message: updateError.message };
    }
    diagLog(opId, "db-update-complete");

    await resetCoverTransformForAsset(supabase, targetAssetId);
    diagLog(opId, "cover-transform-reset");

    // Same reasoning as saveMediaAssetAnnotation above -- brand-new path, but
    // routed through the shared cache so a subsequent normal page load of
    // this exact poster reuses this signed URL rather than minting another.
    const previewUrl = await getCachedSignedUrl(supabase, "project-media", posterPath);
    diagLog(opId, "signed-url-generated", { hasPreviewUrl: Boolean(previewUrl) });

    revalidatePath(`/projects/${projectId}/grid`);
    revalidatePath(`/projects/${projectId}/calendar`);
    revalidatePath(`/projects/${projectId}/stories`);

    diagLog(opId, "server-complete");
    return { previewUrl: previewUrl ?? undefined, mediaAssetId: clonedAssetId ?? undefined };
  } catch (error) {
    diagLogFail(opId, "saveMediaAssetPosterAnnotation-uncaught", error, { mediaAssetId });
    return {
      message: error instanceof Error ? `Unexpected server error: ${error.message}` : "Unexpected server error.",
    };
  }
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

  // Same reasoning as saveMediaAssetAnnotation above -- brand-new path,
  // routed through the shared cache so a later normal page load of this
  // exact poster reuses this signed URL rather than minting another.
  const posterUrl = await getCachedSignedUrl(supabase, "project-media", posterPath);

  // Not revalidating /grid (its own route, only caller) -- the self-heal
  // effect in grid-board.tsx already patches this slot's thumbnail locally
  // from the posterUrl returned below.
  return { posterUrl: posterUrl ?? undefined };
}
