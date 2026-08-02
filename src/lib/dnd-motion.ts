// Shared motion constants for all @dnd-kit surfaces, so drag interactions
// stay within the design bible's 150-200ms / no-bounce ceiling everywhere.
import type { DropAnimation } from "@dnd-kit/core";

const EASING = "cubic-bezier(0.2, 0, 0, 1)";

export const DROP_ANIMATION: DropAnimation = {
  duration: 180,
  easing: EASING,
};

export const SORTABLE_TRANSITION = {
  duration: 180,
  easing: EASING,
};
