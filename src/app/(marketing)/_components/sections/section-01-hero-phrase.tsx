"use client";

import { useEffect, useRef, useState } from "react";
import { HERO_PHRASES, type HeroPhrase } from "@/lib/landing";

// Cycles through HERO_PHRASES on a timer; hovering (desktop) or tapping
// (touch -- onClick fires naturally after a tap, no separate touch handling
// needed) a phrase pins it and pauses the timer until the pointer leaves,
// then resumes auto-advance from that point. onActivePhraseChange lets the
// hero preview (wired in a later pass) stay in sync with whichever phrase
// is current.
export function HeroPhraseSequence({
  onActivePhraseChange,
}: {
  onActivePhraseChange?: (phrase: HeroPhrase) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [pinned, setPinned] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onActivePhraseChange?.(HERO_PHRASES[activeIndex]);
  }, [activeIndex, onActivePhraseChange]);

  useEffect(() => {
    if (pinned) return;
    timerRef.current = setTimeout(() => {
      setActiveIndex((i) => (i + 1) % HERO_PHRASES.length);
    }, HERO_PHRASES[activeIndex].durationMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeIndex, pinned]);

  return (
    <p className="text-2xl leading-relaxed font-light sm:text-3xl">
      {HERO_PHRASES.map((phrase, i) => (
        <span key={phrase.id}>
          <span
            onMouseEnter={() => {
              setPinned(true);
              setActiveIndex(i);
            }}
            onMouseLeave={() => setPinned(false)}
            onClick={() => {
              setPinned((p) => (p && activeIndex === i ? false : true));
              setActiveIndex(i);
            }}
            className={`cursor-default transition-colors duration-300 ${
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
