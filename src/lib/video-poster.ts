"use client";

import { startTransition } from "react";

// Grabs a still frame from a video file for use as a Grid-safe poster image,
// entirely client-side (an offscreen <video> + <canvas>, never uploaded or
// rendered) -- Grid never mounts a <video> element for its cover, so a video
// post/carousel-item needs a static image to show there instead.
export function generateVideoPosterBlob(file: File): Promise<Blob | null> {
  const objectUrl = URL.createObjectURL(file);
  return generatePosterFromVideoSrc(objectUrl, () => URL.revokeObjectURL(objectUrl));
}

// Same capture logic, but from an already-hosted video URL (a signed
// storage URL) instead of a local File -- used to backfill/regenerate a
// poster for a video that was uploaded before poster capture existed, or
// whose original capture attempt failed for some reason. No object URL to
// revoke since nothing was created locally.
export function generatePosterFromVideoUrl(url: string): Promise<Blob | null> {
  return generatePosterFromVideoSrc(url, () => {});
}

// Same capture pipeline again, but at a caller-chosen timestamp instead of
// the fixed ~0.1s heuristic, and returning a data URL (directly usable as
// an <img>/fabric.FabricImage.fromURL source) instead of a Blob -- what the
// annotation editor's video-timeline frame picker uses to turn "whatever
// moment the user scrubbed to" into a real captured frame.
export function captureVideoFrameAsDataUrl(url: string, seekTime: number): Promise<string | null> {
  return generatePosterFromVideoSrc(url, () => {}, seekTime).then(
    (blob) =>
      new Promise<string | null>((resolve) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      }),
  );
}

function generatePosterFromVideoSrc(src: string, cleanupSrc: () => void, seekTime?: number): Promise<Blob | null> {
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
    function finish(blob: Blob | null) {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      cleanup();
      resolve(blob);
    }
    // Guarded separately from `settled` -- "seeked" and the grace timer
    // below can both fire in quick succession (e.g. a fast seek right
    // before the timer elapses), and without this a single successful
    // capture could still be attempted twice.
    function capture() {
      if (captureStarted || settled) return;
      captureStarted = true;
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
    const hardTimeout = setTimeout(() => finish(null), 8000);

    video.addEventListener("error", () => finish(null));

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

// Every upload action here (uploadMedia, uploadPostAsset, uploadStoryFrame)
// accepts multiple files via getAll("file"), but a poster can only
// unambiguously belong to one file per request -- so this submits one
// file (with its own generated poster, if it's a video) per action call
// instead of relying on the native multi-file form submission, even when
// several files were selected at once.
export async function uploadFilesWithPosters(
  action: (formData: FormData) => void,
  files: File[],
): Promise<void> {
  for (const file of files) {
    const formData = new FormData();
    formData.set("file", file);
    if (file.type.startsWith("video/")) {
      const poster = await generateVideoPosterBlob(file);
      if (poster) {
        formData.set("poster", new File([poster], "poster.jpg", { type: "image/jpeg" }));
      }
    }
    // useActionState's dispatch expects to run inside a transition (that's
    // what drives its `pending` boolean) -- calling it bare outside one
    // still works, but React warns and `pending` stops updating correctly.
    startTransition(() => action(formData));
  }
}
