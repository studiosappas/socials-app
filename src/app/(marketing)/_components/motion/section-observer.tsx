"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type LandingSectionMeta = { id: string; label: string };

// Fixed order, used both to build the scroll-progress dots/tabs and to know
// which DOM ids to observe -- one list, not duplicated between the dots and
// the sections themselves.
export const LANDING_SECTIONS: LandingSectionMeta[] = [
  { id: "hero", label: "Hero" },
  { id: "workflow", label: "Everything flows together" },
  { id: "demo", label: "Interactive demo" },
  { id: "brand-intelligence", label: "Brand intelligence" },
  { id: "assets", label: "Find assets" },
  { id: "collaborate", label: "Collaborate" },
  { id: "export", label: "Ready to publish" },
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
        // Among sections currently crossing the 50% threshold, pick whichever
        // is most visible -- avoids the active dot flickering between two
        // adjacent sections during a fast scroll past both at once.
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const mostVisible = visible.reduce((a, b) => (b.intersectionRatio > a.intersectionRatio ? b : a));
        setActiveId(mostVisible.target.id);
      },
      { threshold: 0.5 },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return <ActiveSectionContext.Provider value={activeId}>{children}</ActiveSectionContext.Provider>;
}

export function useActiveSection() {
  return useContext(ActiveSectionContext);
}
