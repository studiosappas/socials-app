// Shared by Overview's real Brand Knowledge panel (overview-panels.tsx) and
// the landing page's Section 04 clone -- one implementation, so the two
// never drift apart visually. Up to MAX_ORBIT_TILES tiles placed at equal
// angles on a precise circle (radius TILE_RADIUS_PCT of the container)
// around the center hub, laid out dynamically for however many items exist.
export const TILE_RADIUS_PCT = 36;
export const MAX_ORBIT_TILES = 8;
const TILE_SIZES = ["19%", "16%", "18%", "15%", "19%", "16%", "18%", "15%"];

export function computeTileLayout(count: number): { top: string; left: string; size: string }[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i * 360) / count - 90; // start at the top, go clockwise
    const radians = (angle * Math.PI) / 180;
    const left = 50 + TILE_RADIUS_PCT * Math.cos(radians);
    const top = 50 + TILE_RADIUS_PCT * Math.sin(radians);
    return { top: `${top}%`, left: `${left}%`, size: TILE_SIZES[i % TILE_SIZES.length] };
  });
}

// A handful of small dots traveling along the same circular path the file
// tiles sit on -- unevenly spaced (not a clean 360/N split) so they read as
// independent points of motion rather than a single spinning shape.
const ORBIT_DOT_ANGLES = [0, 70, 160, 210, 300];
export const ORBIT_DOT_LAYOUT: { top: string; left: string }[] = ORBIT_DOT_ANGLES.map((angle) => {
  const radians = (angle * Math.PI) / 180;
  return {
    left: `${50 + TILE_RADIUS_PCT * Math.cos(radians)}%`,
    top: `${50 + TILE_RADIUS_PCT * Math.sin(radians)}%`,
  };
});

// A minimal version of the same orbit motion (same CSS animation/dot
// styling, see .knowledge-orbit-dots/.knowledge-orbit-dot in globals.css),
// scaled for a small circular icon rather than a full panel -- dots travel
// directly along the icon's own border (radius 50% of the box) instead of
// an inset ring line, since there's no separate ring drawn at this size.
const MINI_ORBIT_DOT_ANGLES = [0, 130, 250];
export const MINI_ORBIT_DOT_LAYOUT: { top: string; left: string }[] = MINI_ORBIT_DOT_ANGLES.map((angle) => {
  const radians = (angle * Math.PI) / 180;
  return {
    left: `${50 + 50 * Math.cos(radians)}%`,
    top: `${50 + 50 * Math.sin(radians)}%`,
  };
});
