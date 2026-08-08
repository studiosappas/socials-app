import type { DemoBriefField } from "./types";

export const DEMO_BRIEF_FIELDS: DemoBriefField[] = [
  { label: "Task", value: "Launch announcement — new product line" },
  { label: "Notes", value: "Playful but premium. Lead with the hero shot, keep copy short." },
];

export const DEMO_AI_CAPTION =
  "Six months in the making. Built the way you asked for it, launching the way you'll love it. Out now. ✨";

export const DEMO_GENERATED_GRAPHIC = {
  src: "brief/generated-graphic.jpg",
  alt: "AI-generated launch graphic",
  aspect: "4/5",
} as const;
