"use client";

import { motion, useScroll } from "framer-motion";

// Mobile replacement for ScrollProgressDots -- a thin fixed bar whose width
// tracks overall page scroll progress (0-1), giving the same "where am I"
// signal without needing per-dot tap targets on a narrow viewport.
export function MobileProgressBar() {
  const { scrollYProgress } = useScroll();

  return (
    <div className="fixed inset-x-0 top-0 z-40 h-[2px] bg-border lg:hidden">
      <motion.div className="h-full origin-left bg-foreground" style={{ scaleX: scrollYProgress }} />
    </div>
  );
}
