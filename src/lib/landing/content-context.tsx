"use client";

import { createContext, useContext, useMemo } from "react";
import {
  HERO_CONTENT,
  HERO_PHRASES,
  DEMO_GRID_SLOTS,
  DEMO_AI_CAPTION,
  DEMO_MEDIA_FOLDERS,
  DEMO_MEDIA_LIBRARY_ITEMS,
  DEMO_SEARCH_MATCH_IDS,
  DEMO_SEARCH_INSPIRATION_IMAGE,
  DEMO_WORKSPACE_TILES,
  DEMO_BRIEF_TASK,
  DEMO_GRID_ROWS,
  DEMO_BRAND_DOCUMENTS,
  DEMO_SPECTRUM,
  DEMO_BRAND_ACCORDION,
  DEMO_AI_RECOMMENDATIONS,
  DEMO_TEAM,
  DEMO_COMMENTS,
  DEMO_TASK_TITLE,
  DEMO_POST_TITLE,
  WHY_SECTION_CONTENT,
  WHY_SECTION_IMAGE,
  FINAL_CTA_CONTENT,
} from "./index";

// Every key here is one row in the landing_demo_content table, and one
// section in the Demo Content Manager admin UI (src/app/admin/landing/).
// The compile-time values imported above are the SHIPPED DEFAULTS -- a key
// with no matching DB row (including a totally fresh, never-edited table)
// falls back to its default here, so the public page never breaks or shows
// blank content before an admin has customized anything. Deliberately NOT
// every export from src/lib/landing -- NAV_CONTENT/FOOTER_CONTENT (site
// chrome, not this page's own workflow story), EASE/REVEAL_TRANSITION
// (motion constants, not content), and types stay plain static imports
// wherever they're used; only what the "One Continuous Workflow" story and
// Hero/Why/CTA sections actually render as data goes through here.
//
// Also deliberately excluded: demo-create.ts's DEMO_DESIGN_BASE_PHOTO/
// DEMO_LAYOUT_ELEMENTS/DEMO_DESIGN_FABRIC_JSON. The Fabric JSON is derived
// FROM the base photo at module-load time (layoutToFabricJson) -- making
// the photo admin-editable independently of that derived JSON would let
// them silently drift out of sync (the editor would open showing a
// different photo than the one the layout was actually composed for).
// Chapter 02's stage-02-create.tsx imports those directly instead.
const DEFAULT_LANDING_CONTENT = {
  HERO_CONTENT,
  HERO_PHRASES,
  DEMO_GRID_SLOTS,
  DEMO_AI_CAPTION,
  DEMO_MEDIA_FOLDERS,
  DEMO_MEDIA_LIBRARY_ITEMS,
  DEMO_SEARCH_MATCH_IDS,
  DEMO_SEARCH_INSPIRATION_IMAGE,
  DEMO_WORKSPACE_TILES,
  DEMO_BRIEF_TASK,
  DEMO_GRID_ROWS,
  DEMO_BRAND_DOCUMENTS,
  DEMO_SPECTRUM,
  DEMO_BRAND_ACCORDION,
  DEMO_AI_RECOMMENDATIONS,
  DEMO_TEAM,
  DEMO_COMMENTS,
  DEMO_TASK_TITLE,
  DEMO_POST_TITLE,
  WHY_SECTION_CONTENT,
  WHY_SECTION_IMAGE,
  FINAL_CTA_CONTENT,
};

export type LandingContent = typeof DEFAULT_LANDING_CONTENT;
export type LandingContentKey = keyof LandingContent;
export const LANDING_CONTENT_KEYS = Object.keys(DEFAULT_LANDING_CONTENT) as LandingContentKey[];
export const LANDING_CONTENT_DEFAULTS = DEFAULT_LANDING_CONTENT;

const LandingContentContext = createContext<LandingContent>(DEFAULT_LANDING_CONTENT);

// `overrides` comes from page.tsx (a Server Component) reading every row in
// landing_demo_content -- only keys an admin has actually saved show up
// here, so this merge is "defaults, with whichever keys exist replaced."
export function LandingContentProvider({
  overrides,
  children,
}: {
  overrides: Partial<Record<LandingContentKey, unknown>>;
  children: React.ReactNode;
}) {
  // Stable reference across re-renders -- several consumers close over
  // these arrays/objects inside useEffect (e.g. the hero phrase timer), and
  // a fresh object identity every render would retrigger those needlessly.
  const merged = useMemo(() => ({ ...DEFAULT_LANDING_CONTENT, ...overrides }) as LandingContent, [overrides]);
  return <LandingContentContext.Provider value={merged}>{children}</LandingContentContext.Provider>;
}

export function useLandingContent() {
  return useContext(LandingContentContext);
}
