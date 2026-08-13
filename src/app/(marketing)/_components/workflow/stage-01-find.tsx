"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LandingMedia } from "../landing-media";
import { EASE, type DemoAssetFolder } from "@/lib/landing";
import { useLandingContent } from "@/lib/landing/content-context";
import type { WorkflowStageProps } from "./workflow-types";

// The "Find" stage: text search is a real, live filter (type and the grid
// narrows) same as the old section-05-assets.tsx clone -- but the WOW
// moment is scripted, triggered once this stage becomes active: a packshot
// drops into the search bar, results narrow to the matching folders, one
// gets highlighted as the handoff into Create. Copy is deliberately framed
// as a tag/keyword match ("tagged for this product"), not "AI visual
// search" -- the real Assets page has no vision-matching feature to back
// that claim, it's an honest stub there today.
export function StageFind({ active }: WorkflowStageProps) {
  const { DEMO_ASSET_FOLDERS, DEMO_IMAGE_SEARCH_RESULT_IDS, DEMO_PACKSHOT } = useLandingContent();
  const [query, setQuery] = useState("");
  const [packshotDropped, setPackshotDropped] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matched, setMatched] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;
    const timers = [
      setTimeout(() => setPackshotDropped(true), 900),
      setTimeout(() => setMatching(true), 1500),
      setTimeout(() => {
        setMatching(false);
        setMatched(true);
      }, 2600),
    ];
    return () => timers.forEach(clearTimeout);
  }, [active]);

  const textFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DEMO_ASSET_FOLDERS;
    return DEMO_ASSET_FOLDERS.filter((f) => f.keywords.some((k) => k.includes(q)) || f.name.toLowerCase().includes(q));
  }, [query, DEMO_ASSET_FOLDERS]);

  const visibleFolders = matched
    ? DEMO_ASSET_FOLDERS.filter((f) => DEMO_IMAGE_SEARCH_RESULT_IDS.includes(f.id))
    : textFiltered;

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <p className="text-xs tracking-wide text-muted uppercase">01 — Find</p>

      <div className="flex w-full max-w-xs items-center gap-2 rounded-full border border-border px-3 py-1.5 transition-colors duration-150 focus-within:border-foreground">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMatched(false);
          }}
          placeholder="Type to search, or paste a packshot"
          className="w-full bg-transparent text-sm focus:outline-none"
        />
        <AnimatePresence>
          {packshotDropped && (
            <motion.div
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="h-6 w-6 shrink-0 overflow-hidden rounded"
            >
              <LandingMedia media={DEMO_PACKSHOT} className="h-full w-full" />
            </motion.div>
          )}
        </AnimatePresence>
        <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
      </div>

      <div className="h-4 text-center">
        {matching && <p className="text-xs tracking-wide text-muted uppercase">Matching tagged assets…</p>}
        {matched && <p className="text-xs tracking-wide text-muted uppercase">2 assets tagged for this product</p>}
      </div>

      <div className="grid w-full max-w-lg grid-cols-2 gap-3 sm:grid-cols-4">
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
              <AssetFolderCard folder={folder} highlighted={matched} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function AssetFolderCard({ folder, highlighted }: { folder: DemoAssetFolder; highlighted: boolean }) {
  return (
    <div
      className={`group relative flex aspect-[4/5] w-full flex-col overflow-hidden rounded-2xl border bg-black/[.02] transition-colors duration-150 ${
        highlighted ? "border-foreground" : "border-border hover:border-foreground/30"
      }`}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {folder.cover ? (
          <LandingMedia media={folder.cover} className="h-full w-full" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <FolderImageIcon className="h-8 w-8 text-muted/60" />
          </div>
        )}
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
