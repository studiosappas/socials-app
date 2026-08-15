// Feeds the REAL Media Library component (src/app/projects/[projectId]/grid/
// media-library.tsx) on the landing page's Chapter 01 "Find" stage -- shaped
// exactly like MediaFolder[]/MediaLibraryItem[], the same props Grid's own
// page.tsx builds from a real Supabase query. Unlike the rest of this
// directory's MediaRef-based demo data, MediaThumbPreview (inside the real
// component) renders a plain <img src> with no placeholder/404 handling, so
// urls are resolved eagerly here via landingMediaUrl() rather than left as
// relative MediaRef paths for LandingMedia to resolve later.
//
// Replaces demo-assets.ts (retired -- its DemoAssetFolder shape only ever
// fed the old hand-built clone, not a real component).
import { landingMediaUrl } from "@/lib/landing-media-url";
import type { MediaFolder, MediaLibraryItem } from "@/app/projects/[projectId]/grid/grid-board";
import type { MediaRef } from "./types";

export const DEMO_MEDIA_FOLDERS: MediaFolder[] = [
  { id: "f1", name: "Product Shots — Studio" },
  { id: "f2", name: "Founder & Behind the Scenes" },
  { id: "f3", name: "Logos & Brand Marks" },
  { id: "f4", name: "Customer UGC" },
];

export const DEMO_MEDIA_LIBRARY_ITEMS: MediaLibraryItem[] = [
  { id: "i1", url: landingMediaUrl("grid/slot-1.jpg"), mediaType: "image", folderId: "f1", usedInGrid: true },
  { id: "i2", url: landingMediaUrl("grid/slot-3.jpg"), mediaType: "image", folderId: "f1" },
  { id: "i3", url: landingMediaUrl("grid/slot-2.jpg"), mediaType: "image", folderId: "f2" },
  { id: "i4", url: landingMediaUrl("grid/slot-5.jpg"), mediaType: "image", folderId: "f2" },
  { id: "i5", url: landingMediaUrl("assets/folder-3.jpg"), mediaType: "image", folderId: "f3" },
  { id: "i6", url: landingMediaUrl("grid/slot-4.jpg"), mediaType: "image", folderId: "f3", usedInGrid: true },
  { id: "i7", url: landingMediaUrl("assets/folder-4.jpg"), mediaType: "image", folderId: "f4" },
  { id: "i8", url: landingMediaUrl("grid/slot-6.jpg"), mediaType: "image", folderId: "f4" },
  { id: "i9", url: landingMediaUrl("export/feed-1.jpg"), mediaType: "image", folderId: null },
  { id: "i10", url: landingMediaUrl("export/feed-2.jpg"), mediaType: "image", folderId: null },
];

// The curated subset MediaLibrary's own real re-render swaps to once the
// scripted "search" beat completes -- a tag/keyword match, not real vision
// matching, since the real Assets page's own image search is presently an
// honest stub (it tells users "Visual search isn't available yet"). Same
// honest framing the old stage-01-find.tsx clone already established.
export const DEMO_SEARCH_MATCH_IDS: string[] = ["i1", "i2", "i7"];

export const DEMO_SEARCH_INSPIRATION_IMAGE: MediaRef = {
  src: "assets/packshot.jpg",
  alt: "Product packshot",
  aspect: "1/1",
};
