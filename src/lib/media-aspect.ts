// The frame a NEW Edit Image / Edit Cover session is built at -- pure, so
// media-aspect.test.ts runs under Node. Shared by Post Editor and Grid's
// Paste Style (a never-edited target), so both create edits of the same
// shape for the same post.
//
//   feed post / carousel media (any position, image or video) -> 4:5, 1080x1350
//   standalone Reel cover (the post's only item is a video)     -> 9:16, 1080x1920
//
// Only NEW edits follow this. Reopening a SAVED edit always rebuilds the
// frame it was saved in (lib/annotation-frame.ts), so edits made under the
// old rules (covers at 3:4) keep their shape and framing -- never recropped.
// The Grid tile itself is still a 3:4 preview (grid-constants.ts): it shows
// these edits cover-fit, the way Instagram's profile grid does.

export const FEED_ASPECT = { w: 4, h: 5 } as const;
export const REEL_COVER_ASPECT = { w: 9, h: 16 } as const;

export function newEditAspect(
  mediaType: "image" | "video",
  // The post's total media count.
  itemCount: number,
): { w: number; h: number } {
  return mediaType === "video" && itemCount === 1 ? REEL_COVER_ASPECT : FEED_ASPECT;
}
