"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Lightbox, type FlatMedia } from "@/components/media-gallery";
import { nextViewerIndex, prevViewerIndex, viewerKeyAction } from "./post-media-viewer-model";

// The Post Editor popup's large media viewer -- Review Content's own
// Lightbox (components/media-gallery.tsx), reused unmodified, with only the
// layering the popup needs around it:
//
// - Portaled to <body> inside a z-[60] layer, so it sits above the Post
//   Editor's Modal (fixed, z-50) instead of being nested in it.
// - Escape/ArrowLeft/ArrowRight are claimed in the CAPTURE phase on window
//   and stopped there. Without this, Escape reaches the Modal's
//   document-level listener (which closes the whole Post Editor) before the
//   Lightbox's own window-level listener -- one key press would close both.
//   The same handler performs the Lightbox's own actions for those keys, so
//   its keyboard behavior is unchanged. The editor's undo/redo shortcuts are
//   swallowed too while the viewer is open (it is view-only).
// - React events from inside the viewer are stopped at its root: a portal
//   still bubbles synthetic events up the React tree into the editor.
//
// Read-only: opening, navigating and closing only change local index state.
export function PostMediaViewer({
  media,
  startIndex,
  onClose,
}: {
  media: FlatMedia[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const prev = () => setIndex((i) => prevViewerIndex(i, media.length));
  const next = () => setIndex((i) => nextViewerIndex(i, media.length));

  useEffect(() => {
    function handleKeyDownCapture(e: KeyboardEvent) {
      const action = viewerKeyAction(e);
      if (!action) return;
      e.stopPropagation();
      e.preventDefault();
      if (action === "close") onClose();
      else if (action === "prev") setIndex((i) => prevViewerIndex(i, media.length));
      else if (action === "next") setIndex((i) => nextViewerIndex(i, media.length));
    }
    window.addEventListener("keydown", handleKeyDownCapture, true);
    return () => window.removeEventListener("keydown", handleKeyDownCapture, true);
  }, [onClose, media.length]);

  if (media.length === 0) return null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <div
      className="relative z-[60]"
      data-post-media-viewer=""
      onClick={stop}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onKeyDown={stop}
    >
      <Lightbox media={media} index={Math.min(index, media.length - 1)} onClose={onClose} onPrev={prev} onNext={next} />
    </div>,
    document.body,
  );
}
