// The ONE canonical Grid feed-cell aspect ratio -- every place that renders,
// measures, or exports a Grid tile derives from this instead of repeating
// "4/5" or "1080x1350" as its own separate literal. Matches Instagram's
// portrait feed-post ratio (1080x1350).
//
// Before this file existed, the ratio was already correctly 4:5 in the two
// places that render an actual Grid tile (the slot itself and its drag-
// overlay preview, both `aspect-[4/5]` in grid-board.tsx) and in the Grid
// export route (CELL_W/CELL_H = 1080/1350, already commented as "matching
// the on-screen grid's slot ratio") -- so this is a consolidation (removing
// the duplicated literal, giving crop/rotation math one source to import)
// rather than a ratio change. See grid-board.tsx's own audit note on the
// Post Editor's SEPARATE carousel-slide ratio (1080x1440, 3:4) and the
// Fabric.js annotation editor -- both are a genuinely different feature
// (individual asset editing inside a post, not the Grid tile itself) and
// are deliberately not touched here.
export const GRID_SLOT_RATIO_W = 4;
export const GRID_SLOT_RATIO_H = 5;
// width / height, e.g. 0.8 for 4:5 -- a tile is TALLER than it is wide.
export const GRID_SLOT_ASPECT_RATIO = GRID_SLOT_RATIO_W / GRID_SLOT_RATIO_H;
// Tailwind arbitrary-value class -- kept as a literal string constant (not
// built from the numbers above at runtime) specifically so Tailwind's
// content scanner, which looks for class-shaped tokens directly in source
// text, still finds it wherever this constant is interpolated into a
// className template.
export const GRID_SLOT_ASPECT_CLASS = "aspect-[4/5]";

// Base export width for a Grid tile/cover -- height is always derived from
// this via GRID_SLOT_ASPECT_RATIO, never hardcoded separately.
export const GRID_EXPORT_WIDTH = 1080;
export const GRID_EXPORT_HEIGHT = Math.round(GRID_EXPORT_WIDTH / GRID_SLOT_ASPECT_RATIO);
