"use client";

import { useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { REVEAL_TRANSITION } from "@/lib/landing";
import { StageFind } from "./stage-01-find";
import { StageCreate } from "./stage-02-create";
import { StageIntelligence } from "./stage-03-intelligence";
import { StageCollaborate } from "./stage-04-collaborate";

// Mobile fallback for the pinned desktop workflow (pinned-stages.tsx) --
// scroll-jacked/sticky sections are unreliable on mobile (address-bar
// resize, touch scroll physics), so this renders the exact same 4 stage
// components in normal document flow instead, each one's `active` flag
// driven by its own whileInView trigger (the same reveal pattern used
// everywhere else on this page) rather than scroll progress. Same
// components, same copy, same order -- just not scroll-scrubbed.
export function SequentialStages() {
  const stages = [
    { id: "find", node: <StageFind active={true} /> },
    { id: "create", node: <StageCreate active={true} /> },
    { id: "intelligence", node: <StageIntelligence active={true} /> },
    { id: "collaborate", node: <StageCollaborate active={true} /> },
  ];

  return (
    <div className="flex flex-col gap-20 py-16 lg:hidden">
      {stages.map((stage) => (
        <SequentialReveal key={stage.id}>{stage.node}</SequentialReveal>
      ))}
    </div>
  );
}

// Each stage still only starts its internal timed sequence once, the first
// time it's actually in view -- mounting with active={true} immediately
// (above) would fire it before scrolling to it, so this gates mounting the
// stage's subtree at all until inView flips true instead.
function SequentialReveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15%" });
  const [mounted, setMounted] = useState(false);

  if (inView && !mounted) setMounted(true);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={REVEAL_TRANSITION}
      className="px-4 sm:px-8"
    >
      {mounted ? children : null}
    </motion.div>
  );
}
