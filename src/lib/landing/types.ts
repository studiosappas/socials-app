// Shared types for the landing page's demo-data layer. Every "product demo"
// section reads exclusively from typed constants in this directory (never a
// literal string/path inside a component) so replacing copy or media later is
// a data/file edit, not a component rewrite -- see demo-content.ts and the
// public/landing/ convention described in MediaRef below.

export type MediaRef = {
  /** Path relative to /public/landing, e.g. "hero/plan-faster.jpg". */
  src: string;
  alt: string;
  aspect?: "4/5" | "3/4" | "9/16" | "1/1";
};

export type CtaLink = { label: string; href: string };

export type HeroPreviewScreen = "grid" | "brief" | "post-popup" | "overview" | "export";

export type HeroPhrase = {
  id: string;
  label: string;
  screens: HeroPreviewScreen[];
  durationMs: number;
};

export type WorkflowStep = {
  id: string;
  label: string;
  blurb: string;
  screenshot: MediaRef;
};

export type DemoGridSlot = {
  id: string;
  image: MediaRef;
  caption: string;
};

export type DemoBriefField = {
  label: string;
  value: string;
};

export type DemoTeamMember = {
  id: string;
  name: string;
  avatar: MediaRef | null;
};

export type DemoComment = {
  id: string;
  author: DemoTeamMember;
  text: string;
  timeLabel: string;
};

export type DemoBrandDocument = {
  id: string;
  filename: string;
  kind: "file" | "link";
};

export type BrandSpectrumAxis = {
  id: string;
  leftLabel: string;
  rightLabel: string;
  value: number; // 0-100
};

export type DemoAssetFolder = {
  id: string;
  name: string;
  typeLabel: string;
  cover: MediaRef | null;
  keywords: string[];
  aiStatusLabel: string;
};

export type DemoExportSample = {
  id: string;
  image: MediaRef;
  aspect: "3/4" | "9/16";
  kind: "post" | "story";
};
