import type { CtaLink, MediaRef } from "./types";

export const NAV_CONTENT = {
  logoLabel: "Flow",
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

// Section 3 -- deliberately just three short statements, not another
// feature grid, per the rebuild brief ("extremely minimal... lots of
// whitespace").
export const WHY_SECTION_CONTENT = {
  statements: [
    "Everything stays connected. Your assets, posts, briefs, approvals and team are always in sync.",
    "AI that understands your brand. Every project makes your workspace smarter.",
    "No more switching between tools. Everything happens inside one uninterrupted workflow.",
  ],
};

export const WHY_SECTION_IMAGE: MediaRef = {
  src: "why/interface.jpg",
  alt: "The workspace interface",
  aspect: "4/5",
};

// Section 4 -- the page's own final beat, distinct from LandingFooter's
// persistent site-wide CTA (which stays generic across every marketing
// page); this one carries the exact copy the workflow narrative earns.
export const FINAL_CTA_CONTENT = {
  headline: "Ready to simplify your content workflow?",
  subhead: "Invite users to start managing their entire social media workflow from one intelligent workspace.",
  primaryCta: { label: "Start Free", href: "/register" } satisfies CtaLink,
};

export const FOOTER_CONTENT = {
  tagline: "One workspace for your entire social media workflow.",
  ctaHeadline: "Start planning in minutes.",
  primaryCta: { label: "Start Free", href: "/register" } satisfies CtaLink,
};
