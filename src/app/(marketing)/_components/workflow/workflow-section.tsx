"use client";

import { PinnedStages } from "./pinned-stages";
import { SequentialStages } from "./sequential-stages";

// "One Continuous Workflow" -- no feature cards, no repeated headings, one
// section id for the scroll-progress dots. Desktop gets the pinned-scroll
// telling (pinned-stages.tsx); mobile gets the same 4 stages as a normal
// sequential reveal (sequential-stages.tsx) -- both are always mounted,
// gated by the same lg: breakpoint convention this app already uses for
// desktop/mobile splits elsewhere (e.g. Task Management's DesktopBoard/
// MobileBoard in board-view.tsx).
export function WorkflowSection() {
  return (
    <section id="workflow">
      <PinnedStages />
      <SequentialStages />
    </section>
  );
}
