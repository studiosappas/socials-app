import type { BrandSpectrumAxis, DemoBrandDocument } from "./types";

export const DEMO_BRAND_DOCUMENTS: DemoBrandDocument[] = [
  { id: "d1", filename: "Brand Guidelines.pdf", kind: "file" },
  { id: "d2", filename: "Tone of Voice.docx", kind: "file" },
  { id: "d3", filename: "Product Photography.zip", kind: "file" },
  { id: "d4", filename: "competitor-reference.com", kind: "link" },
  { id: "d5", filename: "Past Campaign Recap.pdf", kind: "file" },
];

export const DEMO_SPECTRUM: BrandSpectrumAxis[] = [
  { id: "serious_playful", leftLabel: "Serious", rightLabel: "Playful", value: 68 },
  { id: "classic_futuristic", leftLabel: "Classic", rightLabel: "Futuristic", value: 55 },
  { id: "premium_accessible", leftLabel: "Premium", rightLabel: "Accessible", value: 40 },
  { id: "editorial_commercial", leftLabel: "Editorial", rightLabel: "Commercial", value: 35 },
  { id: "minimal_expressive", leftLabel: "Minimal", rightLabel: "Expressive", value: 45 },
  { id: "luxury_casual", leftLabel: "Luxury", rightLabel: "Casual", value: 50 },
];

// Matches BrandSpectrumPanel's real "sections" array + ExpandableField
// accordion (overview-panels.tsx) exactly -- AI Brand Summary first, then
// 7 more labeled fields, each collapsed by default.
export const DEMO_BRAND_ACCORDION: { label: string; value: string }[] = [
  {
    label: "AI Brand Summary",
    value:
      "A premium, editorial brand with a playful edge — confident enough to keep things simple, warm enough to never feel corporate.",
  },
  { label: "Brand DNA", value: "Calm confidence. Says less, means more." },
  { label: "Tone of Voice", value: "Warm, direct, a little playful — never salesy." },
  { label: "Communication Style", value: "Short captions, one clear idea per post." },
  { label: "Content Pillars", value: "Product craft, behind the scenes, customer stories." },
  { label: "Audience Snapshot", value: "Design-conscious founders and small studio teams." },
  { label: "Visual Language", value: "Warm neutrals, natural light, generous negative space." },
  { label: "Avoid", value: "Stock photography, hard sells, exclamation points." },
];

// Matches AiRecommendationsPanel's real 3-column stat grid exactly.
export const DEMO_AI_RECOMMENDATIONS = {
  brandHealthPct: 87,
  brandHealthWord: "Excellent",
  todayLabel: "Post the launch teaser",
  nextGapLabel: "No Reel this week",
  toneLabel: "On-brand",
  contentMixPct: 62,
  contentMixLabel: "Product-led",
  ctaUsagePct: 40,
  ctaUsageLabel: "Could increase",
  summaryNotices: [
    "Your last 3 posts lean heavily on product shots — mix in a behind-the-scenes post this week.",
    "Captions are trending shorter, which matches your brand voice well.",
  ],
};
