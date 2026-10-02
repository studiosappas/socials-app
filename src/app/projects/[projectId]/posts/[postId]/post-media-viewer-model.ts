// Pure model for the Post Editor popup's media viewer (post-media-viewer.tsx)
// -- which media the viewer shows, in what order, where it starts, and how
// prev/next move. No React/DOM, and no runtime imports (type-only imports
// are erased), so post-media-viewer-model.test.ts runs directly under Node.
//
// The viewer itself is Review Content's existing Lightbox
// (components/media-gallery.tsx), fed exactly the shape Review Content /
// the shared preview gallery feed it (shared-gallery.tsx's flatMedia):
// post media in order, contentType "post", the cover crop on the cover
// (position 0) only, and the real video URL + poster for videos.

import type { FlatMedia } from "@/components/media-gallery";
import type { GridCoverTransform } from "../../grid/grid-board";

export type ViewerSourceAsset = {
  postAssetId: string;
  url: string | null;
  posterUrl: string | null;
  mediaType: "image" | "video";
};

// `coverTransform` must be the crop the cover tile is CURRENTLY showing --
// Post Editor's crop applies optimistically on the tile and doesn't refresh
// the editor's own props (updatePostCoverTransform doesn't revalidate), so
// the caller passes the tile's live value, not the possibly-stale prop.
export function buildPostViewerMedia(assets: ViewerSourceAsset[], coverTransform: GridCoverTransform | null): FlatMedia[] {
  const media: FlatMedia[] = [];
  assets.forEach((asset, position) => {
    // Same rule as Review Content: an item with no resolvable URL is
    // skipped rather than shown as a broken frame.
    if (!asset.url) return;
    media.push({
      key: asset.postAssetId,
      url: asset.url,
      mediaType: asset.mediaType,
      posterUrl: asset.posterUrl,
      contentType: "post",
      // A copy, not the editor's own object -- the viewer is read-only by
      // construction, never sharing mutable state with the editor.
      coverTransform: position === 0 && coverTransform ? { ...coverTransform } : null,
    });
  });
  return media;
}

// Where the viewer opens: the exact item that was clicked -- never "the
// first item" by default. null when that item isn't viewable.
export function viewerIndexFor(media: FlatMedia[], postAssetId: string): number | null {
  const index = media.findIndex((m) => m.key === postAssetId);
  return index < 0 ? null : index;
}

// Review Content's own navigation semantics (shared-gallery.tsx): looping.
export function nextViewerIndex(index: number, length: number): number {
  return length === 0 ? 0 : (index + 1) % length;
}
export function prevViewerIndex(index: number, length: number): number {
  return length === 0 ? 0 : (index - 1 + length) % length;
}

// Keys the viewer owns while it's open. They're taken BEFORE they can reach
// the Post Editor popup -- whose Modal closes itself on Escape via a
// document-level listener, which would otherwise fire on the same key press
// as the Lightbox's own window-level listener and close BOTH.
//
// "swallow": the Post Editor's undo/redo shortcuts (⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z,
// Ctrl+Y -- see useUndoRedoShortcuts) are also window-level; while the
// view-only viewer covers the editor they must not edit what's underneath.
export type ViewerKeyAction = "close" | "prev" | "next" | "swallow" | null;
export function viewerKeyAction(e: { key: string; metaKey?: boolean; ctrlKey?: boolean }): ViewerKeyAction {
  if (e.key === "Escape") return "close";
  if (e.key === "ArrowLeft") return "prev";
  if (e.key === "ArrowRight") return "next";
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && (key === "z" || key === "y")) return "swallow";
  return null;
}

// A dnd-kit reorder ends with pointerup over the tile, which browsers can
// follow with a click -- that click must not open the viewer.
export const CLICK_AFTER_DRAG_GRACE_MS = 300;
export function isClickRightAfterDrag(lastDragEndedAt: number | null, now: number): boolean {
  return lastDragEndedAt !== null && now - lastDragEndedAt < CLICK_AFTER_DRAG_GRACE_MS;
}
