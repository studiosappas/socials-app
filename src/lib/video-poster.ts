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

function generatePosterFromVideoSrc(src: string, cleanupSrc: () => void): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.src = src;

    let settled = false;
    function cleanup() {
      video.removeAttribute("src");
      video.load();
      cleanupSrc();
    }
    function finish(blob: Blob | null) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(blob);
    }

    // A handful of real-world video files (some phone-recorded .mov/.webm)
    // never fire "seeked" reliably -- fail closed after a few seconds rather
    // than hang the upload indefinitely.
    const timeout = setTimeout(() => finish(null), 8000);

    video.addEventListener("error", () => {
      clearTimeout(timeout);
      finish(null);
    });

    video.addEventListener("loadedmetadata", () => {
      // A hair past 0 -- frame 0 of many encodes is a solid black/blank
      // frame before the real first keyframe.
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
    });

    video.addEventListener("seeked", () => {
      clearTimeout(timeout);
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
    });
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
