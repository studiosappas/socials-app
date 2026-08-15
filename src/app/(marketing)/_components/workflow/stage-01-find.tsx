"use client";

import { useMemo, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { motion, AnimatePresence, type MotionValue } from "framer-motion";
import { MediaLibrary } from "@/app/projects/[projectId]/grid/media-library";
import type { MediaFolder, MediaLibraryItem } from "@/app/projects/[projectId]/grid/grid-board";
import { LandingMedia } from "../landing-media";
import { EASE } from "@/lib/landing";
import { useLandingContent } from "@/lib/landing/content-context";
import { useGuidedDemo } from "../guided-demo/use-guided-demo";
import { GuidedDemoFrame } from "../guided-demo/guided-demo-frame";
import type { DemoStep } from "../guided-demo/guided-demo-types";
import type { WorkflowStageProps } from "./workflow-types";

// Mirrors pinned-stages.tsx's own rangeStart/rangeEnd math for index 0 of
// STAGE_COUNT=4 (index/count to (index+1)/count) -- kept as a local
// constant rather than threading STAGE_COUNT across files for one number;
// keep in sync if stage order/count ever changes.
const SCROLL_RANGE: [number, number] = [0, 0.25];

// Never a real project -- MediaLibrary is rendered with demoMode, which
// omits every control that would otherwise fire a real mutating server
// action against this id.
const DEMO_PROJECT_ID = "landing-demo";

function folderLabelFor(itemId: string | null, items: MediaLibraryItem[], folders: MediaFolder[]): string | null {
  if (!itemId) return null;
  const item = items.find((i) => i.id === itemId);
  if (!item) return null;
  return folders.find((f) => f.id === item.folderId)?.name ?? "Unfoldered";
}

// The "Find" stage: the real Media Library component (folders, thumbnail
// grid, hover/select/drag) is genuinely live here, fed demo data as props --
// see media-library.tsx's `demoMode` prop and demo-media-library.ts. Search
// bar and library grid share ONE bordered workspace panel (not two stacked
// blocks) so the whole beat reads as moving through a single persistent
// interface rather than a sequence of separate feature demos: drop a
// reference -> matching -> results narrow -> a match gets tagged -- framed
// honestly as a tag/keyword match (the real Assets page's own visual search
// is an honest stub today, not live AI matching -- see that page's
// ImageSearchResults), with the same causality (action -> visible response)
// carried through to genuine visitor interaction via onSelectionChange.
export function StageFind({
  active,
  scrollYProgress,
}: WorkflowStageProps & { scrollYProgress?: MotionValue<number> }) {
  const { DEMO_MEDIA_FOLDERS, DEMO_MEDIA_LIBRARY_ITEMS, DEMO_SEARCH_MATCH_IDS, DEMO_SEARCH_INSPIRATION_IMAGE } =
    useLandingContent();

  const [packshotDropped, setPackshotDropped] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matched, setMatched] = useState(false);
  const [autoSelectedId, setAutoSelectedId] = useState<string | null>(null);
  const [realSelectedIds, setRealSelectedIds] = useState<string[]>([]);

  const steps = useMemo<DemoStep[]>(
    () => [
      {
        id: "reset",
        durationMs: 700,
        onEnter: () => {
          setPackshotDropped(false);
          setMatching(false);
          setMatched(false);
          setAutoSelectedId(null);
        },
      },
      { id: "drop-packshot", durationMs: 600, onEnter: () => setPackshotDropped(true) },
      { id: "matching", durationMs: 800, onEnter: () => setMatching(true) },
      {
        id: "matched",
        durationMs: 1400,
        onEnter: () => {
          setMatching(false);
          setMatched(true);
        },
      },
      {
        id: "auto-select",
        durationMs: 1200,
        onEnter: () => setAutoSelectedId(DEMO_SEARCH_MATCH_IDS[0] ?? null),
      },
    ],
    [DEMO_SEARCH_MATCH_IDS],
  );

  const { phase, registerInteraction } = useGuidedDemo({ active, steps });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const libraryFolders = matched ? [] : DEMO_MEDIA_FOLDERS;
  const libraryItems = matched
    ? DEMO_MEDIA_LIBRARY_ITEMS.filter((item) => DEMO_SEARCH_MATCH_IDS.includes(item.id))
    : DEMO_MEDIA_LIBRARY_ITEMS;

  function handleSelectionChange(ids: string[]) {
    setRealSelectedIds(ids);
    if (ids.length > 0) {
      registerInteraction();
      setAutoSelectedId(null);
    }
  }

  function handleClearSearch() {
    registerInteraction();
    setMatched(false);
    setAutoSelectedId(null);
  }

  const selectedLabel =
    realSelectedIds.length === 1
      ? folderLabelFor(realSelectedIds[0], DEMO_MEDIA_LIBRARY_ITEMS, DEMO_MEDIA_FOLDERS)
      : autoSelectedId
        ? folderLabelFor(autoSelectedId, DEMO_MEDIA_LIBRARY_ITEMS, DEMO_MEDIA_FOLDERS)
        : null;

  return (
    <GuidedDemoFrame
      scrollYProgress={scrollYProgress}
      range={SCROLL_RANGE}
      phase={phase}
      className="flex w-full flex-col lg:h-[85dvh] lg:w-[85vw]"
    >
      <div className="flex h-full w-full flex-col gap-3" onPointerDownCapture={registerInteraction}>
        <div className="flex shrink-0 items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <p className="text-xs tracking-wide text-muted uppercase">01 — Find</p>
            <h2 className="text-xl font-light sm:text-2xl">Stop searching.</h2>
          </div>
          <div className="h-4 text-right">
            {matching && <p className="text-xs tracking-wide text-muted uppercase">Matching tagged assets…</p>}
            {!matching && selectedLabel && (
              <p className="text-xs tracking-wide text-foreground uppercase">Tagged — {selectedLabel}</p>
            )}
            {!matching && !selectedLabel && matched && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="text-xs tracking-wide text-muted uppercase underline-offset-2 hover:text-foreground hover:underline"
              >
                {DEMO_SEARCH_MATCH_IDS.length} tagged for this product — clear
              </button>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
            <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
            <span className="flex-1 truncate text-sm text-muted">Drop in a reference, find the match</span>
            <AnimatePresence>
              {packshotDropped && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="h-6 w-6 shrink-0 overflow-hidden rounded"
                >
                  <LandingMedia media={DEMO_SEARCH_INSPIRATION_IMAGE} className="h-full w-full" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            <DndContext sensors={sensors}>
              <MediaLibrary
                projectId={DEMO_PROJECT_ID}
                items={libraryItems}
                folders={libraryFolders}
                pushCommand={() => {}}
                demoMode
                onSelectionChange={handleSelectionChange}
              />
            </DndContext>
          </div>
        </div>
      </div>
    </GuidedDemoFrame>
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
