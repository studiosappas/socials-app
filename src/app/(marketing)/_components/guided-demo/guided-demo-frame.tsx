"use client";

import { motion, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import type { DemoPhase } from "./guided-demo-types";

// Presentational shell for a Guided Live Demo chapter -- purely `phase` +
// (optionally) scroll progress in, styled wrapper + a subtle idle hint out.
// No chapter-specific content awareness, so every future chapter reuses
// this unchanged; only what's passed as `children` differs.
export function GuidedDemoFrame({
  scrollYProgress,
  range,
  phase,
  className = "",
  children,
}: {
  // Pass the pinned scroll container's own scrollYProgress (see
  // pinned-stages.tsx) plus this chapter's [start, end] window within it,
  // for an Anthropic-style "the app scales into focus while scrolling"
  // effect. Omit both on the mobile/sequential fallback, which has no
  // scroll-pinned parent to read progress from -- the frame renders flat,
  // untransformed there.
  scrollYProgress?: MotionValue<number>;
  range?: [number, number];
  phase: DemoPhase;
  className?: string;
  children: React.ReactNode;
}) {
  // useTransform needs a real MotionValue every render regardless of
  // whether the caller passed one (rules of hooks) -- its value is never
  // read unless scrollYProgress was actually provided (see the style prop
  // below), so the fixed 0.5 default is inert.
  const fallbackProgress = useMotionValue(0.5);
  const progress = scrollYProgress ?? fallbackProgress;
  const [start, end] = range ?? [0, 1];
  // Settles in over the first ~15% of the window, then HOLDS at full
  // scale/position for the rest of it -- deliberately asymmetric (no
  // matching scale-down as the window ends) so the workspace reads as
  // staying present throughout the chapter, like a camera arriving and
  // then holding steady, rather than a feature popping in and back out.
  // StagePanel's own opacity cross-fade is what signals the chapter
  // ending; this transform never fights it with a second "leaving" cue.
  const enterEnd = start + (end - start) * 0.15;
  const scale = useTransform(progress, [start, enterEnd, end], [0.975, 1, 1]);
  const y = useTransform(progress, [start, enterEnd, end], [14, 0, 0]);

  return (
    <motion.div style={scrollYProgress ? { scale, y } : undefined} className={`relative ${className}`}>
      {children}
      {phase === "interactive" && <IdleHint />}
    </motion.div>
  );
}

// A gentle nudge that this is a real, clickable interface -- shown only
// while the visitor has control and hasn't done anything yet; disappears
// the moment they interact (registerInteraction re-arms the idle timer and
// flips phase away from here) or once the idle timer replays the demo.
function IdleHint() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
      <span className="animate-pulse rounded-full bg-black/[.04] px-3 py-1 text-[10px] tracking-wide text-muted uppercase">
        Explore — click, hover, drag
      </span>
    </div>
  );
}
