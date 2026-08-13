"use client";

import { ScrollReveal } from "../motion/scroll-reveal";
import { LandingMedia } from "../landing-media";
import { useLandingContent } from "@/lib/landing/content-context";

// Deliberately minimal, per the brief: no headline, no feature grid, no
// cards -- three short statements and one clean interface image, lots of
// whitespace. Only shows after the workflow narrative is complete.
export function WhySection() {
  const { WHY_SECTION_CONTENT, WHY_SECTION_IMAGE } = useLandingContent();
  return (
    <section id="why" className="mx-auto flex max-w-3xl flex-col items-center gap-16 px-4 py-32 sm:px-8">
      <div className="flex flex-col gap-10 text-center">
        {WHY_SECTION_CONTENT.statements.map((statement, i) => (
          <ScrollReveal key={i} delay={i * 0.1}>
            <p className="text-xl font-light leading-relaxed sm:text-2xl">{statement}</p>
          </ScrollReveal>
        ))}
      </div>

      <ScrollReveal delay={0.2} className="w-full max-w-md">
        <LandingMedia media={WHY_SECTION_IMAGE} className="w-full rounded-2xl border border-border" />
      </ScrollReveal>
    </section>
  );
}
