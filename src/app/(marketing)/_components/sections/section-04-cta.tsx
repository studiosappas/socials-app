"use client";

import { ScrollReveal } from "../motion/scroll-reveal";
import { LandingCtaLink } from "../landing-cta-link";
import { useLandingContent } from "@/lib/landing/content-context";

// Very clean, very minimal -- headline, one line of supporting text, one
// primary button. Distinct from LandingFooter's own (generic, persists
// across every marketing page) CTA below it.
export function CtaSection() {
  const { FINAL_CTA_CONTENT } = useLandingContent();
  return (
    <section id="cta" className="mx-auto flex max-w-xl flex-col items-center gap-6 px-4 py-32 text-center sm:px-8">
      <ScrollReveal className="flex flex-col items-center gap-4">
        <h2 className="text-3xl font-light sm:text-4xl">{FINAL_CTA_CONTENT.headline}</h2>
        <p className="text-sm text-muted">{FINAL_CTA_CONTENT.subhead}</p>
      </ScrollReveal>
      <ScrollReveal delay={0.1}>
        <LandingCtaLink href={FINAL_CTA_CONTENT.primaryCta.href} variant="primary" radius="full" className="normal-case">
          {FINAL_CTA_CONTENT.primaryCta.label}
        </LandingCtaLink>
      </ScrollReveal>
    </section>
  );
}
