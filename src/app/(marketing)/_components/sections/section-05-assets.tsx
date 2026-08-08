"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollReveal } from "../motion/scroll-reveal";
import { LandingMedia } from "../landing-media";
import {
  ASSETS_SECTION_CONTENT,
  DEMO_ASSET_FOLDERS,
  DEMO_IMAGE_SEARCH_RESULT_IDS,
  EASE,
  type DemoAssetFolder,
} from "@/lib/landing";

// Clones AssetCard's exact markup from asset-board.tsx: aspect-[4/5],
// rounded-2xl border, hover gradient overlay, uppercase AI-status pill,
// name/type footer -- same visual language, zero Supabase/server-action
// coupling (fixed demo-data folders only).
export function AssetsSection() {
  const [query, setQuery] = useState("");
  const [imageSearchActive, setImageSearchActive] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DEMO_ASSET_FOLDERS;
    return DEMO_ASSET_FOLDERS.filter((f) => f.keywords.some((k) => k.includes(q)) || f.name.toLowerCase().includes(q));
  }, [query]);

  const imageSearchResults = DEMO_ASSET_FOLDERS.filter((f) => DEMO_IMAGE_SEARCH_RESULT_IDS.includes(f.id));
  const visibleFolders = imageSearchActive ? imageSearchResults : filtered;

  return (
    <section id="assets" className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-24 sm:px-8">
      {/* Search bar sits top-right of its own row, exactly like the real
          Assets page (asset-board.tsx: `flex justify-end` above a separately
          centered header block) -- not stacked directly under the headline. */}
      <div className="flex justify-end">
        <div className="flex w-full items-center gap-2 rounded-full border border-border px-3 py-1.5 transition-colors duration-150 focus-within:border-foreground sm:w-72">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setImageSearchActive(false);
            }}
            placeholder="Type to search"
            className="w-full bg-transparent text-sm focus:outline-none"
          />
          <button
            type="button"
            title="Search by image"
            onClick={() => {
              setQuery("");
              setImageSearchActive(true);
            }}
            className="shrink-0 text-muted transition-colors duration-150 hover:text-foreground"
          >
            <CameraIcon className="h-4 w-4" />
          </button>
          <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
        </div>
      </div>

      <ScrollReveal className="flex flex-col items-center gap-3 text-center">
        <h2 className="text-3xl font-light sm:text-4xl">{ASSETS_SECTION_CONTENT.headline}</h2>
        {imageSearchActive && (
          <p className="text-xs tracking-wide text-muted uppercase">
            Matching visually similar assets across every connected folder…
          </p>
        )}
      </ScrollReveal>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <AnimatePresence mode="popLayout">
          {visibleFolders.map((folder) => (
            <motion.div
              key={folder.id}
              layout
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <AssetFolderCard folder={folder} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

// Structurally identical to the real AssetCard (asset-board.tsx): a
// flex-col card, NOT an image with text overlaid on top of it -- the image
// region is `flex-1` (hover-only date overlay + AI-status pill live only
// here), and name/type sit in their own `shrink-0` footer block below the
// image, never overlaid on it. The first pass at this clone incorrectly
// merged both into one gradient-text-on-image treatment.
function AssetFolderCard({ folder }: { folder: DemoAssetFolder }) {
  return (
    <div className="group relative flex aspect-[4/5] w-full flex-col overflow-hidden rounded-2xl border border-border bg-black/[.02] transition-colors duration-150 hover:border-foreground/30">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {folder.cover ? (
          <LandingMedia media={folder.cover} className="h-full w-full" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <FolderImageIcon className="h-8 w-8 text-muted/60" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/75 via-black/10 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <div className="flex flex-col gap-0.5 text-white">
            <span className="text-[10px] text-white/70">Created 2 days ago</span>
            <span className="text-[10px] text-white/70">Last synced 2h ago</span>
          </div>
        </div>
        <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[9px] tracking-wide text-white uppercase">
          {folder.aiStatusLabel}
        </span>
      </div>
      <div className="flex shrink-0 flex-col gap-0.5 px-3 py-2">
        <span className="truncate text-xs font-medium text-foreground">{folder.name}</span>
        <span className="truncate text-[9px] tracking-wide text-muted uppercase">{folder.typeLabel}</span>
      </div>
    </div>
  );
}

function FolderImageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className={className}>
      <rect x="3.5" y="6" width="17" height="13" rx="1" />
      <circle cx="8.5" cy="10.5" r="1.4" />
      <path d="M3.5 16.5 8 12l3 3 3.5-4L20.5 17" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M4 8a2 2 0 0 1 2-2h1l1-2h4l1 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}
