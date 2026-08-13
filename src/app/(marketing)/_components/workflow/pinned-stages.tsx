"use client";

import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "framer-motion";
import { StageFind } from "./stage-01-find";
import { StageCreate } from "./stage-02-create";
import { StageIntelligence } from "./stage-03-intelligence";
import { StageCollaborate } from "./stage-04-collaborate";

const STAGE_COUNT = 4;
// Scroll distance per stage, in viewport heights -- long enough that each
// stage's own timed sub-sequence (see each stage component) has room to
// play out before the next stage's cross-fade begins.
const VH_PER_STAGE = 220;

const STAGE_LABELS = ["Find", "Create", "Intelligence", "Collaborate"];

// Desktop-only pinned-scroll telling of the workflow: one tall wrapper,
// a sticky full-height viewport inside it, and scroll position (not scroll
// EVENTS -- scrollYProgress, a continuous 0-1 value) decides which of the
// 4 stages is on screen via a per-stage opacity cross-fade. Once a stage
// crosses into view its own internal timed sequence starts (see each
// stage's `active` prop) -- scroll picks the chapter, time tells that
// chapter's story, matching section-04-brand-intelligence.tsx's existing
// useInView-triggered-sequence pattern, just re-triggered by scroll
// progress instead of a one-shot viewport check.
export function PinnedStages() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const { scrollYProgress } = useScroll({ target: containerRef, offset: ["start start", "end end"] });

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    const idx = Math.min(STAGE_COUNT - 1, Math.max(0, Math.floor(v * STAGE_COUNT)));
    setActiveIndex(idx);
  });

  const stages = [
    <StageFind key="find" active={activeIndex === 0} />,
    <StageCreate key="create" active={activeIndex === 1} />,
    <StageIntelligence key="intelligence" active={activeIndex === 2} />,
    <StageCollaborate key="collaborate" active={activeIndex === 3} />,
  ];

  return (
    <div
      ref={containerRef}
      className="relative hidden lg:block"
      style={{ height: `${STAGE_COUNT * VH_PER_STAGE}vh` }}
    >
      <div className="sticky top-0 h-dvh w-full overflow-hidden">
        {stages.map((stage, i) => (
          <StagePanel key={i} index={i} scrollYProgress={scrollYProgress} active={activeIndex === i}>
            {stage}
          </StagePanel>
        ))}

        {/* Minimal step indicator -- not a headline, just orientation. */}
        <div className="pointer-events-none absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-2">
          {STAGE_LABELS.map((label, i) => (
            <span
              key={label}
              className={`text-[10px] tracking-wide uppercase transition-colors duration-300 ${
                activeIndex === i ? "text-foreground" : "text-foreground/25"
              }`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StagePanel({
  index,
  scrollYProgress,
  active,
  children,
}: {
  index: number;
  scrollYProgress: MotionValue<number>;
  active: boolean;
  children: React.ReactNode;
}) {
  const rangeStart = index / STAGE_COUNT;
  const rangeEnd = (index + 1) / STAGE_COUNT;
  const fade = 0.04;
  const opacity = useTransform(
    scrollYProgress,
    [rangeStart, Math.min(1, rangeStart + fade), Math.max(0, rangeEnd - fade), rangeEnd],
    [0, 1, 1, 0],
  );

  return (
    <motion.div
      style={{ opacity, pointerEvents: active ? "auto" : "none" }}
      className="absolute inset-0 flex items-center justify-center px-4 sm:px-8"
    >
      {children}
    </motion.div>
  );
}
