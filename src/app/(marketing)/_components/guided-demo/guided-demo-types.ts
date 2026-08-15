// Shared contract for the "Guided Live Demo" engine (use-guided-demo.ts +
// guided-demo-frame.tsx) -- content-agnostic on purpose, so every chapter
// (Find, Create, Collaborate, Flow) can describe its own scripted sequence
// as a plain array of steps without the engine knowing anything about what
// each step actually shows.

export type DemoPhase = "auto" | "interactive" | "resuming";

export type DemoStep = {
  id: string;
  /** How long this step holds before the next one starts (ms). */
  durationMs: number;
  /** Fires once, the moment this step becomes current. */
  onEnter?: () => void;
};
