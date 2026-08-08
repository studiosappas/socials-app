import type { HeroPhrase } from "./types";

// Each phrase drives which mini "screen" the hero preview shows -- see
// section-01-hero-preview.tsx. screens is ordered; the preview cycles through
// them while the phrase is active (durationMs is split evenly across them).
export const HERO_PHRASES: HeroPhrase[] = [
  { id: "plan", label: "Plan faster", screens: ["grid"], durationMs: 4000 },
  { id: "create", label: "Create with AI", screens: ["brief"], durationMs: 4000 },
  { id: "collaborate", label: "Collaborate effortlessly", screens: ["post-popup"], durationMs: 4000 },
  { id: "brand", label: "Stay on-brand", screens: ["overview"], durationMs: 4000 },
  { id: "export", label: "Export ready-to-publish content", screens: ["export"], durationMs: 4000 },
];
