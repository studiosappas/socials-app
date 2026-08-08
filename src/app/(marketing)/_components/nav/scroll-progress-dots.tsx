"use client";

import { motion } from "framer-motion";
import { LANDING_SECTIONS, useActiveSection } from "../motion/section-observer";
import { EASE } from "@/lib/landing";

// Desktop only (lg: and up, see className) -- on narrow viewports these dots
// crowd the edge and lose usable tap targets, replaced there by
// MobileProgressBar (a thin top progress bar) instead.
export function ScrollProgressDots() {
  const activeId = useActiveSection();

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="fixed right-6 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-center gap-3 lg:flex">
      {LANDING_SECTIONS.map((section) => {
        const isActive = section.id === activeId;
        return (
          <button
            key={section.id}
            type="button"
            title={section.label}
            aria-label={`Scroll to ${section.label}`}
            onClick={() => scrollToSection(section.id)}
            className="p-1"
          >
            <motion.span
              animate={{ scale: isActive ? 1 : 0.6, opacity: isActive ? 1 : 0.35 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="block h-1.5 w-1.5 rounded-full bg-foreground"
            />
          </button>
        );
      })}
    </div>
  );
}
