"use client";

import { MotionConfig } from "framer-motion";
import { SectionObserverProvider } from "./_components/motion/section-observer";
import { ScrollProgressDots } from "./_components/nav/scroll-progress-dots";
import { MobileProgressBar } from "./_components/nav/mobile-progress-bar";
import { HeroSection } from "./_components/sections/section-01-hero";
import { WorkflowSection } from "./_components/sections/section-02-workflow";
import { DemoSection } from "./_components/sections/section-03-demo";
import { BrandIntelligenceSection } from "./_components/sections/section-04-brand-intelligence";
import { AssetsSection } from "./_components/sections/section-05-assets";
import { CollaborateSection } from "./_components/sections/section-06-collaborate";
import { ExportSection } from "./_components/sections/section-07-export";

export function LandingPage() {
  return (
    <MotionConfig reducedMotion="user">
      <SectionObserverProvider>
        <ScrollProgressDots />
        <MobileProgressBar />
        <HeroSection />
        <WorkflowSection />
        <DemoSection />
        <BrandIntelligenceSection />
        <AssetsSection />
        <CollaborateSection />
        <ExportSection />
      </SectionObserverProvider>
    </MotionConfig>
  );
}
