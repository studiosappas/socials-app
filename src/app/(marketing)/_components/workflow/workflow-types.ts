// Shared contract every workflow stage component implements. `active` tells
// a stage whether it's the one currently in focus -- whether that's because
// the pinned desktop viewport has scrolled onto it, or because it scrolled
// into view on the mobile sequential fallback (see pinned-stages.tsx /
// sequential-stages.tsx). Each stage owns its own internal timed sequence
// (same pattern section-04-brand-intelligence.tsx already used standalone)
// and starts it once, the first time `active` flips true.
export type WorkflowStageProps = {
  active: boolean;
};
