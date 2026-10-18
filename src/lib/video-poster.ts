"use client";

import { startTransition } from "react";
import { uploadFileDirect, newStoragePath } from "@/lib/direct-upload";
import { generateImageThumbnailBlob } from "@/lib/image-thumbnail";
import { generatePdfCoverBlob } from "@/lib/pdf-cover";
import {
  checkFile,
  failureSummary,
  isRecognisedVideoContainer,
  problemMessage,
  storageErrorProblem,
  UNSUPPORTED_VIDEO,
  type UploadContext,
  type UploadFailure,
  type UploadProblem,
} from "@/lib/upload-validation";

// What the browser made of a video:
//   "decoded"      -- a frame was captured (the poster).
//   "unsupported"  -- the browser DEFINITELY can't play it: it reported a
//                     decode / unsupported-source error, or it loaded the
//                     file but found no picture in it. Uploading it would
//                     only store a video nobody can see, so uploads stop here.
//   "undetermined" -- no verdict: a timeout, a seek that never settled, a
//                     canvas that couldn't be read. NEVER a reason to reject
//                     -- some valid phone videos behave like this.
export type VideoDecodeResult = { status: "decoded"; poster: Blob } | { status: "unsupported" } | { status: "undetermined" };

// The upload-time check: decodes the LOCAL file (an object URL, so a source
// error here can only mean the format, never the network) before anything
// reaches storage, and keeps the captured frame as the poster.
export function probeVideoFile(file: File, options?: { timeoutMs?: number }): Promise<VideoDecodeResult> {
  const objectUrl = URL.createObjectURL(file);
  return decodeVideoSrc(objectUrl, () => URL.revokeObjectURL(objectUrl), options);
}

// The same check for an already-stored video (Regenerate Poster, Edit
// Cover). From a URL, "unsupported" can also mean the file couldn't be
// loaded, so messages built on it must not claim the format for certain.
export function probeVideoUrl(url: string, seekTime?: number): Promise<VideoDecodeResult> {
  return decodeVideoSrc(url, () => {}, { seekTime });
}

// Brief ONLY. Brief stores reference/source videos, so a video this browser
// can't play is still accepted when its first bytes are a recognised video
// container ("preview-unavailable": stored without a poster, with a notice).
// A file that only CLAIMS to be a video (a non-video renamed .avi) is
// "rejected". Grid, Post Editor and Content keep rejecting every
// unplayable video (uploadFilesWithPosters / uploadFilesConcurrently).
// The container check is a client-side safeguard, not a security boundary
// -- see isRecognisedVideoContainer.
export type BriefVideoCheck =
  | { status: "decoded"; poster: Blob }
  | { status: "undetermined" }
  | { status: "preview-unavailable" }
  | { status: "rejected" };

export async function checkBriefVideo(file: File): Promise<BriefVideoCheck> {
  const decoded = await probeVideoFile(file);
  if (decoded.status !== "unsupported") return decoded;
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  return isRecognisedVideoContainer(head) ? { status: "preview-unavailable" } : { status: "rejected" };
}

// Grabs a still frame from a video file for use as a Grid-safe poster image,
// entirely client-side (an offscreen <video> + <canvas>, never uploaded or
// rendered) -- Grid never mounts a <video> element for its cover, so a video
// post/carousel-item needs a static image to show there instead.
export async function generateVideoPosterBlob(file: File): Promise<Blob | null> {
  const result = await probeVideoFile(file);
  return result.status === "decoded" ? result.poster : null;
}

// Same capture logic, but from an already-hosted video URL (a signed
// storage URL) instead of a local File -- used to backfill/regenerate a
// poster for a video that was uploaded before poster capture existed, or
// whose original capture attempt failed for some reason. No object URL to
// revoke since nothing was created locally.
export async function generatePosterFromVideoUrl(url: string): Promise<Blob | null> {
  const result = await probeVideoUrl(url);
  return result.status === "decoded" ? result.poster : null;
}

// Same capture pipeline again, but at a caller-chosen timestamp instead of
// the fixed ~0.1s heuristic, and returning a data URL (directly usable as
// an <img>/fabric.FabricImage.fromURL source) instead of a Blob -- what the
// annotation editor's video-timeline frame picker uses to turn "whatever
// moment the user scrubbed to" into a real captured frame.
// Says WHY there's no frame, so the editor can explain it instead of waiting
// forever: "unsupported" (the browser can't play this video) vs
// "undetermined" (it didn't load in time).
export type CapturedVideoFrame = { status: "decoded"; dataUrl: string } | { status: "unsupported" } | { status: "undetermined" };

export function captureVideoFrameAsDataUrl(url: string, seekTime: number): Promise<CapturedVideoFrame> {
  return probeVideoUrl(url, seekTime).then(
    (result) =>
      new Promise<CapturedVideoFrame>((resolve) => {
        if (result.status !== "decoded") {
          resolve(result);
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () =>
          resolve(typeof reader.result === "string" ? { status: "decoded", dataUrl: reader.result } : { status: "undetermined" });
        reader.onerror = () => resolve({ status: "undetermined" });
        reader.readAsDataURL(result.poster);
      }),
  );
}

// MediaError codes that are a verdict on the file itself, not on loading it.
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

function decodeVideoSrc(
  src: string,
  cleanupSrc: () => void,
  options: { seekTime?: number; timeoutMs?: number } = {},
): Promise<VideoDecodeResult> {
  const { seekTime, timeoutMs = 8000 } = options;
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.src = src;

    let settled = false;
    let captureStarted = false;
    function cleanup() {
      video.removeAttribute("src");
      video.load();
      cleanupSrc();
    }
    function settle(result: VideoDecodeResult) {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      cleanup();
      resolve(result);
    }
    function finish(blob: Blob | null) {
      settle(blob ? { status: "decoded", poster: blob } : { status: "undetermined" });
    }
    // Guarded separately from `settled` -- "seeked" and the grace timer
    // below can both fire in quick succession (e.g. a fast seek right
    // before the timer elapses), and without this a single successful
    // capture could still be attempted twice.
    function capture() {
      if (captureStarted || settled) return;
      captureStarted = true;
      // Metadata loaded but no picture at all: the browser read the
      // container and can't decode its video (or there is none).
      if (video.videoWidth === 0 && video.videoHeight === 0) {
        settle({ status: "unsupported" });
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 640;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        finish(null);
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.85);
      } catch {
        // A tainted canvas (crossOrigin rejected by the storage host) throws
        // on drawImage/toBlob rather than erroring earlier -- fail closed.
        finish(null);
      }
    }

    // Absolute fail-closed ceiling for files whose metadata never loads at
    // all (the "error" listener below never fires for these either) --
    // hangs the upload/regenerate no longer than this rather than forever.
    // A timeout is "undetermined", never "unsupported".
    const hardTimeout = setTimeout(() => finish(null), timeoutMs);

    video.addEventListener("error", () => {
      const code = video.error?.code;
      if (code === MEDIA_ERR_DECODE || code === MEDIA_ERR_SRC_NOT_SUPPORTED) settle({ status: "unsupported" });
      else finish(null);
    });

    video.addEventListener("loadedmetadata", () => {
      // A hair past 0 -- frame 0 of many encodes is a solid black/blank
      // frame before the real first keyframe. Best-effort only: a handful
      // of real-world files (some phone-recorded .mov/.webm) never fire
      // "seeked" at all no matter how long you wait, which used to mean the
      // whole capture silently failed 8s later even though the video had
      // loaded fine. The grace timer below is the actual fix -- if the seek
      // hasn't resolved shortly after metadata loads, it captures whatever
      // frame is already on screen instead of holding out for a cosmetic
      // frame-0 fix that may never come.
      try {
        video.currentTime = seekTime ?? Math.min(0.1, (video.duration || 1) / 2);
      } catch {
        // Some browsers throw synchronously if seeking isn't ready yet --
        // the grace timer below still captures a frame regardless.
      }
      setTimeout(capture, 1200);
    });

    video.addEventListener("seeked", capture);
  });
}

// Every upload action here (uploadMedia, uploadPostAsset, uploadStoryFrame,
// uploadContentAsset) accepts multiple files via getAll("file"), but a
// poster can only unambiguously belong to one file per request -- so this
// submits one file (with its own generated poster, if it's a video) per
// action call instead of relying on the native multi-file form submission,
// even when several files were selected at once.
//
// The main file itself now uploads DIRECT to Supabase Storage from the
// browser (uploadFileDirect) before the action ever runs -- bypassing
// Vercel's hard, non-configurable ~4.5MB Function request-body limit, which
// every previous FormData-through-a-Server-Action upload was actually bound
// by regardless of next.config.ts's own serverActions.bodySizeLimit. The
// action now receives the resulting storagePath/mediaType (tiny strings)
// instead of the raw file -- see the four target actions' own updated
// signatures. The poster stays in FormData as before (a small,
// client-generated JPEG, never a large raw upload).
//
// Every file is checked against the caller's upload context first, and a
// video is decoded BEFORE upload: one the browser definitely can't play
// never reaches storage (see probeVideoFile). Each rejected file is reported
// through onError with its name and reason, and the rest still upload.
export async function uploadFilesWithPosters(
  projectId: string,
  action: (formData: FormData) => void,
  files: File[],
  onError?: (failure: UploadFailure) => void,
  context: UploadContext = "media",
): Promise<void> {
  for (const file of files) {
    const reject = (problem: UploadProblem) => onError?.({ fileName: file.name, problem });
    const problem = checkFile(file, context);
    if (problem) {
      reject(problem);
      continue;
    }

    const mediaType = file.type.startsWith("video/") ? "video" : file.type === "application/pdf" ? "pdf" : "image";
    const decoded = mediaType === "video" ? await probeVideoFile(file) : null;
    if (decoded?.status === "unsupported") {
      reject(UNSUPPORTED_VIDEO);
      continue;
    }

    const storagePath = newStoragePath(projectId, file.name);
    const uploaded = await uploadFileDirect("project-media", storagePath, file);
    if ("error" in uploaded) {
      reject(uploaded.problem);
      continue;
    }

    const formData = new FormData();
    formData.set("storagePath", uploaded.path);
    formData.set("mediaType", mediaType);
    formData.set("fileName", file.name);
    if (mediaType === "video") {
      const poster = decoded?.status === "decoded" ? decoded.poster : null;
      if (poster) {
        formData.set("poster", new File([poster], "poster.jpg", { type: "image/jpeg" }));
      }
      // A failed poster capture is never fatal to the upload -- the original
      // video is already safely uploaded above; the card just falls back to
      // a typed placeholder instead of a real poster (see StoryCard).
    } else if (mediaType === "pdf") {
      // Same "poster" field name video already uses -- both are the exact
      // same concept (a small generated cover image for a source a plain
      // <img> can't decode directly), so the server side needs no separate
      // PDF-specific field or code path, only a widened mediaType check
      // (see uploadPosterIfPresent in lib/actions/media.ts).
      const cover = await generatePdfCoverBlob(file);
      if (cover) {
        formData.set("poster", new File([cover], "poster.jpg", { type: "image/jpeg" }));
      }
    } else {
      // A small generated JPEG for on-screen tiles -- see
      // src/lib/image-thumbnail.ts. Best-effort: if generation or its own
      // upload fails for any reason, thumbnailStoragePath is just omitted
      // and every read site already falls back to the full original.
      const thumbBlob = await generateImageThumbnailBlob(file);
      if (thumbBlob) {
        const thumbPath = newStoragePath(projectId, "thumb.jpg");
        const thumbUploaded = await uploadFileDirect(
          "project-media",
          thumbPath,
          new File([thumbBlob], "thumb.jpg", { type: "image/jpeg" }),
        );
        if (!("error" in thumbUploaded)) {
          formData.set("thumbnailStoragePath", thumbUploaded.path);
        }
      }
    }
    // useActionState's dispatch expects to run inside a transition (that's
    // what drives its `pending` boolean) -- calling it bare outside one
    // still works, but React warns and `pending` stops updating correctly.
    startTransition(() => action(formData));
  }
}

// uploadFilesWithPosters for a whole selection, resolving to ONE message that
// names every rejected file (null when all of them went through) -- what
// Post Editor and Content show once the batch is done.
export async function uploadFilesAndSummarize(
  projectId: string,
  action: (formData: FormData) => void,
  files: File[],
  context: UploadContext = "media",
): Promise<string | null> {
  const failures: UploadFailure[] = [];
  await uploadFilesWithPosters(projectId, action, files, (failure) => failures.push(failure), context);
  return failureSummary(failures, context);
}

// Grid-only counterpart to uploadFilesWithPosters above -- NOT a drop-in
// replacement, and Post Editor/Content keep using the original unchanged.
//
// Root cause this exists to fix (confirmed via an isolated, minimal
// reproduction, not assumption): every file dispatched through
// uploadFilesWithPosters shares ONE useActionState hook instance (the
// caller's own `action`). React serializes repeated dispatches of the SAME
// useActionState instance -- call #2's action body does not even START
// until call #1 has fully RESOLVED, regardless of how quickly the
// surrounding loop fires them or how fast the network actually is. A
// 30-file batch therefore behaves as ONE long chain no matter how the
// per-file upload work itself is scheduled, which is exactly the "stuck at
// 0/30 for a long time, then a bulk catch-up" symptom -- not a server-load
// or network-speed issue, a React dispatch-queueing one.
//
// Fixed by calling the server action DIRECTLY (`dispatch` below, a plain
// async function, never a useActionState-bound one) instead of through any
// shared hook instance, so each file's full pipeline -- direct-to-Storage
// upload, thumbnail generation, thumbnail upload, then the actual
// DB-insert server action call -- is a genuinely independent async chain.
// Bounded by `concurrency` simultaneous in-flight files (a worker-pool: N
// workers each pull the next unclaimed file and run its whole pipeline
// before pulling another) rather than either the old one-at-a-time
// sequential loop or unbounded 30-way parallel -- see the branch report for
// the concurrency measurements behind the default.
export type ConcurrentUploadOutcome<TResult> =
  | { status: "success"; tempId: string; fileName: string; result: TResult }
  | { status: "error"; tempId: string; fileName: string; message: string; problem: UploadProblem };

export async function uploadFilesConcurrently<TResult>(
  projectId: string,
  files: { file: File; tempId: string }[],
  dispatch: (formData: FormData) => Promise<TResult>,
  onResult: (outcome: ConcurrentUploadOutcome<TResult>) => void,
  concurrency = 3,
  context: UploadContext = "media",
): Promise<void> {
  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= files.length) return;
      const { file, tempId } = files[i];
      onResult(await uploadOne(file, tempId));
    }
  }

  // Each file's whole pipeline resolves to exactly ONE outcome, reported
  // once by the worker above: anything unexpected thrown mid-pipeline
  // (poster/thumbnail generation, a network rejection) becomes that file's
  // error outcome instead of silently killing its worker -- which used to
  // leave the placeholder spinning forever and skip every file queued behind
  // it on that worker. The Library's insert sequencer
  // (lib/upload-insert-order.ts) depends on this: an outcome is what
  // releases a file's insert turn.
  async function uploadOne(file: File, tempId: string): Promise<ConcurrentUploadOutcome<TResult>> {
    const fail = (problem: UploadProblem): ConcurrentUploadOutcome<TResult> => ({
      status: "error",
      tempId,
      fileName: file.name,
      message: problemMessage(problem),
      problem,
    });
    try {
      const problem = checkFile(file, context);
      if (problem) return fail(problem);

      const mediaType = file.type.startsWith("video/") ? "video" : file.type === "application/pdf" ? "pdf" : "image";
      // Decoded BEFORE upload -- see uploadFilesWithPosters.
      const decoded = mediaType === "video" ? await probeVideoFile(file) : null;
      if (decoded?.status === "unsupported") return fail(UNSUPPORTED_VIDEO);

      const storagePath = newStoragePath(projectId, file.name);
      const uploaded = await uploadFileDirect("project-media", storagePath, file);
      if ("error" in uploaded) return fail(uploaded.problem);

      const formData = new FormData();
      formData.set("storagePath", uploaded.path);
      formData.set("mediaType", mediaType);
      formData.set("fileName", file.name);
      formData.set("clientTempId", tempId);
      if (mediaType === "video") {
        const poster = decoded?.status === "decoded" ? decoded.poster : null;
        if (poster) formData.set("poster", new File([poster], "poster.jpg", { type: "image/jpeg" }));
      } else if (mediaType === "pdf") {
        const cover = await generatePdfCoverBlob(file);
        if (cover) formData.set("poster", new File([cover], "poster.jpg", { type: "image/jpeg" }));
      } else {
        const thumbBlob = await generateImageThumbnailBlob(file);
        if (thumbBlob) {
          const thumbPath = newStoragePath(projectId, "thumb.jpg");
          const thumbUploaded = await uploadFileDirect(
            "project-media",
            thumbPath,
            new File([thumbBlob], "thumb.jpg", { type: "image/jpeg" }),
          );
          if (!("error" in thumbUploaded)) formData.set("thumbnailStoragePath", thumbUploaded.path);
        }
      }

      const result = await dispatch(formData);
      return { status: "success", tempId, fileName: file.name, result };
    } catch (error) {
      // e.g. the save action's request failing -- a network or server
      // problem, never reported as a bad file.
      return fail(storageErrorProblem({ message: error instanceof Error ? error.message : "" }));
    }
  }

  const workerCount = Math.min(concurrency, files.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
