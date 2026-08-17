import type { StoryStatus } from "@/types/database";

// Single source of truth for every place that lists/labels/colors content
// item statuses -- the editor's dropdown, the board card's quick-set menu,
// and the card's minimal status dot all read from this instead of keeping
// their own copies in sync by hand. "published" is deliberately excluded
// from the options list (it's legacy, from before this list was expanded)
// but still has a label/color so old rows render correctly wherever they
// show up.
export const CONTENT_STATUS_OPTIONS: StoryStatus[] = [
  "draft",
  "ready",
  "approved",
  "scheduled",
  "sent",
  "delivered",
];

export const CONTENT_STATUS_LABEL: Record<StoryStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  approved: "Approved",
  scheduled: "Scheduled",
  sent: "Sent",
  delivered: "Delivered",
  published: "Published",
};

// Tailwind background classes for the minimal status dot on each card --
// kept low-contrast/neutral through the early stages and only turns
// distinctly "done" colors (green/dark) once approved or later, so the
// indicator reads as informational rather than alarming.
export const CONTENT_STATUS_DOT_COLOR: Record<StoryStatus, string> = {
  draft: "bg-muted",
  ready: "bg-blue-400",
  approved: "bg-emerald-500",
  scheduled: "bg-purple-500",
  sent: "bg-amber-500",
  delivered: "bg-emerald-700",
  published: "bg-muted",
};
