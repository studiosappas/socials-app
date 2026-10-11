// Explicit pixel row height for a "pick from library" tile grid.
//
// Why this exists at all: sizing such a grid's rows from each tile's own
// aspect-ratio (grid-auto-rows: auto + aspect-ratio on the item) is what
// renders tiles as thin overlapping strips in WebKit/Safari -- inside a
// max-height scroll container WebKit shrinks the auto rows to fit that
// max-height ((maxHeight - gaps) / rowCount, measured at 11px for 8 rows
// in a 144px container) while every tile keeps its own aspect-ratio height
// and overflows its row into the ones below. An explicit row height has no
// dependency on any child or on the container's own height, so rows can't
// collapse. Same approach as Post Editor's AddFromLibrarySection
// (post-editor.tsx), which computes this inline for its own 3:4 tiles.
//
// aspectWidthOverHeight: 9 / 16 for Content's story-shaped tiles.
// Returns null when the container hasn't been laid out yet (width <= 0),
// so the caller keeps its CSS fallback instead of writing a bogus value.
export function libraryTileRowHeight(
  containerWidth: number,
  columns: number,
  gapPx: number,
  aspectWidthOverHeight: number,
): number | null {
  if (!(containerWidth > 0) || !(columns > 0) || !(aspectWidthOverHeight > 0)) return null;
  const tileWidth = (containerWidth - gapPx * (columns - 1)) / columns;
  if (!(tileWidth > 0)) return null;
  return Math.round(tileWidth / aspectWidthOverHeight);
}
