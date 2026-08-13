"use client";

import { MotionConfig } from "framer-motion";
import { SectionObserverProvider } from "./_components/motion/section-observer";
import { ScrollProgressDots } from "./_components/nav/scroll-progress-dots";
import { MobileProgressBar } from "./_components/nav/mobile-progress-bar";
import { HeroSection } from "./_components/sections/section-01-hero";
import { WorkflowSection } from "./_components/workflow/workflow-section";
import { WhySection } from "./_components/sections/section-03-why";
import { CtaSection } from "./_components/sections/section-04-cta";
import { LandingContentProvider, type LandingContentKey } from "@/lib/landing/content-context";

// Four sections, per the rebuilt storytelling: Hero, the One Continuous
// Workflow (Find/Create/Intelligence/Collaborate), Why It Feels Different,
// Final CTA. LandingFooter (mounted one level up, in layout.tsx) is a
// separate, persistent site-wide element below all of this.
//
// `overrides` comes from the Demo Content Manager (page.tsx fetches it
// server-side) -- every section/stage below reads its content via
// useLandingContent() instead of importing @/lib/landing's constants
// directly, so an admin edit shows up here without touching any component.
export function LandingPage({ overrides }: { overrides: Partial<Record<LandingContentKey, unknown>> }) {
  return (
    <LandingContentProvider overrides={overrides}>
      <MotionConfig reducedMotion="user">
        <SectionObserverProvider>
          <ScrollProgressDots />
          <MobileProgressBar />
          <HeroSection />
          <WorkflowSection />
          <WhySection />
          <CtaSection />
        </SectionObserverProvider>
      </MotionConfig>
    </LandingContentProvider>
  );
}
