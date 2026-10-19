// Pure helper for the Grid Media Library's desktop drag-and-drop upload
// (media-library.tsx). No React/DOM -- tested by media-drop.test.ts. Which
// dropped files are accepted, and the message for the rest, now live in the
// shared upload-validation.ts (context "media"), same as every other upload.

// True only for a drag carrying OS files -- NOT for an in-page drag of
// text/links/images, and not for the Library's own asset->Grid drags (those
// are dnd-kit pointer-event drags that never produce native drag events at
// all). Takes DataTransfer.types, which (unlike .files) is readable during
// dragenter/dragover.
export function isFileDrag(types: ArrayLike<string> | null | undefined): boolean {
  return !!types && Array.from(types).includes("Files");
}
