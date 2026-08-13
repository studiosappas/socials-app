"use client";

import { useEffect, useRef, useState } from "react";
import type { HeroPhrase } from "@/lib/landing";
import { useLandingContent } from "@/lib/landing/content-context";

// Cycles through HERO_PHRASES on a timer, continuously, with no way to pause
// it -- this is the hero's own instance of the "interface reacts on its own"
// principle the whole page follows now, not a hover toy. onActivePhraseChange
// keeps the hero preview panel in sync with whichever phrase is current.
export function HeroPhraseSequence({
  onActivePhraseChange,
}: {
  onActivePhraseChange?: (phrase: HeroPhrase) => void;
}) {
  const { HERO_PHRASES } = useLandingContent();
  const [activeIndex, setActiveIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onActivePhraseChange?.(HERO_PHRASES[activeIndex]);
  }, [activeIndex, onActivePhraseChange, HERO_PHRASES]);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setActiveIndex((i) => (i + 1) % HERO_PHRASES.length);
    }, HERO_PHRASES[activeIndex].durationMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeIndex, HERO_PHRASES]);

  return (
    <p className="text-2xl leading-relaxed font-light sm:text-3xl">
      {HERO_PHRASES.map((phrase, i) => (
        <span key={phrase.id}>
          <span
            className={`transition-colors duration-300 ${
              activeIndex === i ? "text-foreground" : "text-foreground/30"
            }`}
          >
            {phrase.label}.
          </span>{" "}
        </span>
      ))}
    </p>
  );
}
