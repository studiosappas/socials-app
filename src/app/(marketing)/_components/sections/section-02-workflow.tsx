"use client";

import { useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { ScrollReveal } from "../motion/scroll-reveal";
import { LandingMedia } from "../landing-media";
import { WORKFLOW_SECTION_CONTENT, WORKFLOW_STEPS, EASE, type WorkflowStep } from "@/lib/landing";

export function WorkflowSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start 0.7", "end 0.5"] });
  const lineScale = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <section id="workflow" ref={sectionRef} className="mx-auto max-w-6xl px-4 py-24 sm:px-8">
      <ScrollReveal className="mb-16 text-center">
        <h2 className="text-3xl font-light sm:text-4xl">{WORKFLOW_SECTION_CONTENT.headline}</h2>
      </ScrollReveal>

      <div className="relative">
        {/* Connector line -- builds in as the section scrolls through view,
            desktop only (mobile uses a horizontally-scrollable row instead,
            where the sequential-card read already carries the "flow"). */}
        <div className="absolute left-0 right-0 top-6 hidden h-px bg-border lg:block" />
        <motion.div
          style={{ scaleX: lineScale }}
          className="absolute left-0 right-0 top-6 hidden h-px origin-left bg-foreground lg:block"
        />

        <div className="flex gap-4 overflow-x-auto pb-4 sm:gap-6 lg:grid lg:grid-cols-7 lg:overflow-visible lg:pb-0">
          {WORKFLOW_STEPS.map((step, i) => (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: EASE }}
              className="shrink-0"
            >
              <WorkflowCard step={step} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkflowCard({ step }: { step: WorkflowStep }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative w-40 shrink-0 sm:w-44 lg:w-full"
    >
      <div className="relative z-10 mx-auto mb-3 flex h-3 w-3 items-center justify-center">
        <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-black/[.02] transition-colors duration-150 group-hover:border-foreground/30">
        <div className="relative aspect-[4/5]">
          <LandingMedia media={step.screenshot} className="h-full w-full" />
          <div
            className={`pointer-events-none absolute inset-0 flex items-end bg-black/70 p-3 text-left text-xs text-white opacity-0 transition-opacity duration-200 ${
              hovered ? "opacity-100" : ""
            }`}
          >
            {step.blurb}
          </div>
        </div>
        <p className="px-3 py-2.5 text-center text-xs tracking-wide uppercase">{step.label}</p>
      </div>
    </div>
  );
}
