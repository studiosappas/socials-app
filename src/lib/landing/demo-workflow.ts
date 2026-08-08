import type { WorkflowStep } from "./types";

export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    id: "idea",
    label: "Idea",
    blurb: "Capture what you want to post before it slips away.",
    screenshot: { src: "workflow/idea.jpg", alt: "A new brief task being created", aspect: "4/5" },
  },
  {
    id: "brief",
    label: "Brief",
    blurb: "Turn a rough idea into a structured content brief.",
    screenshot: { src: "workflow/brief.jpg", alt: "A brief task with reference images and notes", aspect: "4/5" },
  },
  {
    id: "ai",
    label: "AI",
    blurb: "Let the workspace write in your brand's own voice.",
    screenshot: { src: "workflow/ai.jpg", alt: "AI-generated caption appearing in a text field", aspect: "4/5" },
  },
  {
    id: "assets",
    label: "Assets",
    blurb: "Pull the right photo or file without leaving the tab.",
    screenshot: { src: "workflow/assets.jpg", alt: "Brand asset folders", aspect: "4/5" },
  },
  {
    id: "grid",
    label: "Grid",
    blurb: "Drop it into the feed and see how it looks next to everything else.",
    screenshot: { src: "workflow/grid.jpg", alt: "A post placed into the feed grid", aspect: "4/5" },
  },
  {
    id: "review",
    label: "Review",
    blurb: "Move it to review and the right people are notified automatically.",
    screenshot: { src: "workflow/review.jpg", alt: "A post status set to in review", aspect: "4/5" },
  },
  {
    id: "export",
    label: "Export",
    blurb: "Ship it — a client PDF, a feed export, or a share link.",
    screenshot: { src: "workflow/export.jpg", alt: "An exported feed preview", aspect: "4/5" },
  },
];
