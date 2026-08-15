"use client";

import { useMemo, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { motion, AnimatePresence, type MotionValue } from "framer-motion";
import { MediaLibrary } from "@/app/projects/[projectId]/grid/media-library";
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

// The "Find" stage: the real Media Library component (folders, thumbnail
// grid, hover/select/drag) is genuinely live here, fed demo data as props --
// see media-library.tsx's `demoMode` prop and demo-media-library.ts. The WOW
// moment is scripted: an inspiration packshot drops into the search bar,
// results narrow to a curated matching subset, framed honestly as a
// tag/keyword match (the real Assets page's own visual search is an honest
// stub today, not live AI matching -- see that page's ImageSearchResults).
export function StageFind({
  active,
  scrollYProgress,
}: WorkflowStageProps & { scrollYProgress?: MotionValue<number> }) {
  const { DEMO_MEDIA_FOLDERS, DEMO_MEDIA_LIBRARY_ITEMS, DEMO_SEARCH_MATCH_IDS, DEMO_SEARCH_INSPIRATION_IMAGE } =
    useLandingContent();

  const [packshotDropped, setPackshotDropped] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matched, setMatched] = useState(false);

  const steps = useMemo<DemoStep[]>(
    () => [
      {
        id: "reset",
        durationMs: 900,
        onEnter: () => {
          setPackshotDropped(false);
          setMatching(false);
          setMatched(false);
        },
      },
      { id: "drop-packshot", durationMs: 700, onEnter: () => setPackshotDropped(true) },
      { id: "matching", durationMs: 900, onEnter: () => setMatching(true) },
      {
        id: "matched",
        durationMs: 1800,
        onEnter: () => {
          setMatching(false);
          setMatched(true);
        },
      },
    ],
    [],
  );

  const { phase, registerInteraction } = useGuidedDemo({ active, steps });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const libraryFolders = matched ? [] : DEMO_MEDIA_FOLDERS;
  const libraryItems = matched
    ? DEMO_MEDIA_LIBRARY_ITEMS.filter((item) => DEMO_SEARCH_MATCH_IDS.includes(item.id))
    : DEMO_MEDIA_LIBRARY_ITEMS;

  return (
    <GuidedDemoFrame
      scrollYProgress={scrollYProgress}
      range={SCROLL_RANGE}
      phase={phase}
      className="flex w-full flex-col gap-4 lg:h-[80dvh] lg:w-[90vw] lg:gap-6"
    >
      <div className="flex h-full w-full flex-col gap-4 lg:gap-6" onPointerDownCapture={registerInteraction}>
        <div className="flex shrink-0 flex-col items-center gap-1 text-center">
          <p className="text-xs tracking-wide text-muted uppercase">01 — Find</p>
          <h2 className="text-2xl font-light sm:text-3xl">Stop searching.</h2>
        </div>

        <div className="mx-auto flex w-full max-w-md shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
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
          <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
        </div>

        <div className="h-4 shrink-0 text-center">
          {matching && <p className="text-xs tracking-wide text-muted uppercase">Matching tagged assets…</p>}
          {matched && !matching && (
            <button
              type="button"
              onClick={() => {
                registerInteraction();
                setMatched(false);
              }}
              className="text-xs tracking-wide text-muted uppercase underline-offset-2 hover:text-foreground hover:underline"
            >
              {DEMO_SEARCH_MATCH_IDS.length} assets tagged for this product — clear search
            </button>
          )}
        </div>

        <div className="mx-auto w-full max-w-4xl flex-1 overflow-hidden rounded-2xl border border-border bg-card p-3 sm:p-5">
          <DndContext sensors={sensors}>
            <MediaLibrary
              projectId={DEMO_PROJECT_ID}
              items={libraryItems}
              folders={libraryFolders}
              pushCommand={() => {}}
              demoMode
            />
          </DndContext>
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
