"use client";

import { useState } from "react";
import { ScrollReveal } from "../motion/scroll-reveal";
import { LandingCtaLink } from "../landing-cta-link";
import { HeroPhraseSequence } from "./section-01-hero-phrase";
import { HeroPreview } from "./section-01-hero-preview";
import type { HeroPreviewScreen } from "@/lib/landing";
import { useLandingContent } from "@/lib/landing/content-context";

export function HeroSection() {
  const { HERO_CONTENT, HERO_PHRASES } = useLandingContent();
  const [screen, setScreen] = useState<HeroPreviewScreen>(HERO_PHRASES[0].screens[0]);

  return (
    <section id="hero" className="mx-auto flex max-w-6xl flex-col gap-14 px-4 pt-16 pb-24 sm:px-8 sm:pt-24">
      <ScrollReveal className="flex flex-col items-center gap-6 text-center">
        <h1 className="max-w-3xl text-4xl font-light sm:text-6xl">{HERO_CONTENT.headline}</h1>
        <div className="flex items-center gap-3">
          <LandingCtaLink href={HERO_CONTENT.primaryCta.href} variant="primary" radius="full" className="normal-case">
            {HERO_CONTENT.primaryCta.label}
          </LandingCtaLink>
          <LandingCtaLink href={HERO_CONTENT.secondaryCta.href} variant="secondary" radius="full" className="normal-case">
            {HERO_CONTENT.secondaryCta.label}
          </LandingCtaLink>
        </div>
      </ScrollReveal>

      <ScrollReveal delay={0.15} className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
        <HeroPhraseSequence onActivePhraseChange={(phrase) => setScreen(phrase.screens[0])} />
        <HeroPreview screen={screen} />
      </ScrollReveal>
    </section>
  );
}
