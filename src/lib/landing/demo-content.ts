import type { CtaLink } from "./types";

export const NAV_CONTENT = {
  logoLabel: "Socials App",
  links: {
    pricing: { label: "Pricing", href: "/pricing" } satisfies CtaLink,
    bookDemo: { label: "Book a Demo", href: "/book-a-demo" } satisfies CtaLink,
    login: { label: "Log In", href: "/login" } satisfies CtaLink,
    startFree: { label: "Start Free", href: "/register" } satisfies CtaLink,
  },
};

export const HERO_CONTENT = {
  headline: "One workspace for your entire social media workflow.",
  subhead:
    "Plan faster. Create with AI. Collaborate effortlessly. Stay on-brand. Export ready-to-publish content—all from one intelligent workspace.",
  primaryCta: { label: "Start Free", href: "/register" } satisfies CtaLink,
  secondaryCta: { label: "Book a Demo", href: "/book-a-demo" } satisfies CtaLink,
};

export const WORKFLOW_SECTION_CONTENT = {
  headline: "Everything flows together.",
};

export const DEMO_SECTION_CONTENT = {
  headline: "Try it yourself.",
  subhead: "This is the real interface. Drag a post, reposition an image, search a library — no account needed.",
};

export const BRAND_INTELLIGENCE_CONTENT = {
  headline: "AI that learns your brand.",
  subhead: "Upload what you already have. The workspace turns it into a brand your whole team can write from.",
};

export const ASSETS_SECTION_CONTENT = {
  headline: "Never search folder by folder again.",
};

export const COLLABORATION_SECTION_CONTENT = {
  headline: "Keep everyone in the same conversation.",
};

export const EXPORT_SECTION_CONTENT = {
  headline: "Everything ready when you are.",
};

export const FOOTER_CONTENT = {
  tagline: "One workspace for your entire social media workflow.",
  ctaHeadline: "Start planning in minutes.",
  primaryCta: { label: "Start Free", href: "/register" } satisfies CtaLink,
};
