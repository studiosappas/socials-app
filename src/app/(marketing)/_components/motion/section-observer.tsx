"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type LandingSectionMeta = { id: string; label: string };

// Fixed order, used both to build the scroll-progress dots/tabs and to know
// which DOM ids to observe -- one list, not duplicated between the dots and
// the sections themselves.
export const LANDING_SECTIONS: LandingSectionMeta[] = [
  { id: "hero", label: "Hero" },
  { id: "workflow", label: "The workflow" },
  { id: "why", label: "Why it's different" },
  { id: "cta", label: "Get started" },
];

const ActiveSectionContext = createContext<string>(LANDING_SECTIONS[0].id);

export function SectionObserverProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = useState(LANDING_SECTIONS[0].id);

  useEffect(() => {
    const elements = LANDING_SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Picks whichever section has the most VISIBLE PIXELS on screen right
        // now, not the highest ratio of its own total height -- the workflow
        // section is a multi-thousand-pixel pinned-scroll wrapper, so it can
        // never cross a 50%-of-itself ratio threshold the way the older,
        // viewport-sized sections could. Comparing raw intersectionRect
        // height instead works correctly regardless of how tall a section is.
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const mostVisible = visible.reduce((a, b) =>
          b.intersectionRect.height > a.intersectionRect.height ? b : a,
        );
        setActiveId(mostVisible.target.id);
      },
      // Many small thresholds, not one -- this needs to keep recalculating
      // throughout a long scroll through the (very tall) workflow section,
      // not just once when it first/last crosses a single fixed ratio.
      { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return <ActiveSectionContext.Provider value={activeId}>{children}</ActiveSectionContext.Provider>;
}

export function useActiveSection() {
  return useContext(ActiveSectionContext);
}
