// Pure helpers for the Grid Media Library's desktop drag-and-drop upload
// (media-library.tsx). No React/DOM -- tested by media-drop.test.ts.

// True only for a drag carrying OS files -- NOT for an in-page drag of
// text/links/images, and not for the Library's own asset->Grid drags (those
// are dnd-kit pointer-event drags that never produce native drag events at
// all). Takes DataTransfer.types, which (unlike .files) is readable during
// dragenter/dragover.
export function isFileDrag(types: ArrayLike<string> | null | undefined): boolean {
  return !!types && Array.from(types).includes("Files");
}

// Same set the Upload Assets picker accepts (`accept="image/*,video/*"`).
// HEIC/HEIF are also accepted by extension because Windows/Chromium often
// report them with an EMPTY MIME type -- the upload pipeline already treats
// any non-video file as an image and the server generates their thumbnail
// (see uploadMedia's generateServerThumbnail fallback). Other empty-type
// files are rejected rather than guessed, since a video mis-guessed as an
// image would be stored with the wrong media_type.
const EMPTY_TYPE_IMAGE_EXTENSIONS = new Set(["heic", "heif"]);

export function isAcceptedMediaFile(file: { name: string; type: string }): boolean {
  if (file.type.startsWith("image/") || file.type.startsWith("video/")) return true;
  if (file.type === "") {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    return EMPTY_TYPE_IMAGE_EXTENSIONS.has(ext);
  }
  return false;
}

export function partitionDroppedFiles<T extends { name: string; type: string }>(
  files: T[],
): { accepted: T[]; rejected: T[] } {
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const file of files) (isAcceptedMediaFile(file) ? accepted : rejected).push(file);
  return { accepted, rejected };
}

export function rejectedFilesMessage(rejected: { name: string }[]): string | null {
  if (rejected.length === 0) return null;
  if (rejected.length === 1) return `"${rejected[0].name}" isn't an image or video, so it wasn't uploaded.`;
  return `${rejected.length} files weren't images or videos, so they weren't uploaded.`;
}
