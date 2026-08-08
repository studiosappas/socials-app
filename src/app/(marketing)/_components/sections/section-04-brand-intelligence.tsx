"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { ScrollReveal } from "../motion/scroll-reveal";
import { BrandOrbit } from "./section-04-orbit";
import {
  BRAND_INTELLIGENCE_CONTENT,
  DEMO_BRAND_DOCUMENTS,
  DEMO_SPECTRUM,
  DEMO_BRAND_ACCORDION,
  DEMO_AI_RECOMMENDATIONS,
  EASE,
} from "@/lib/landing";

const labelClass = "text-xs font-semibold tracking-wide uppercase";

type Stage = "idle" | "uploading" | "analyzing" | "spectrum" | "summary" | "recommendations";
const STAGE_ORDER: Stage[] = ["idle", "uploading", "analyzing", "spectrum", "summary", "recommendations"];

export function BrandIntelligenceSection() {
  const [stage, setStage] = useState<Stage>("idle");
  const [tileCount, setTileCount] = useState(0);
  const startedRef = useRef(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(triggerRef, { once: true, margin: "-20%" });

  function runSequence() {
    if (startedRef.current) return;
    startedRef.current = true;

    let elapsed = 0;
    DEMO_BRAND_DOCUMENTS.forEach((_, i) => {
      elapsed += 500;
      setTimeout(() => {
        setStage("uploading");
        setTileCount(i + 1);
      }, elapsed);
    });

    elapsed += 400;
    setTimeout(() => setStage("analyzing"), elapsed);
    elapsed += 1800;
    setTimeout(() => setStage("spectrum"), elapsed);
    elapsed += 900;
    setTimeout(() => setStage("summary"), elapsed);
    elapsed += 900;
    setTimeout(() => setStage("recommendations"), elapsed);
  }

  useEffect(() => {
    if (inView) runSequence();
  }, [inView]);

  const stageIndex = STAGE_ORDER.indexOf(stage);
  const spinning = stage === "analyzing";
  const r = DEMO_AI_RECOMMENDATIONS;

  return (
    <section id="brand-intelligence" className="mx-auto flex max-w-5xl flex-col gap-14 px-4 py-24 sm:px-8">
      <ScrollReveal className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-3xl font-light sm:text-4xl">{BRAND_INTELLIGENCE_CONTENT.headline}</h2>
        <p className="max-w-lg text-sm text-muted">{BRAND_INTELLIGENCE_CONTENT.subhead}</p>
      </ScrollReveal>

      <div ref={triggerRef} className="h-px w-full" />

      <BrandOrbit tileCount={tileCount} spinning={spinning} refreshing={stage === "analyzing"} />

      {stageIndex >= STAGE_ORDER.indexOf("spectrum") && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mx-auto flex w-full max-w-md flex-col gap-4"
        >
          <div className="flex items-center justify-between">
            <span className={labelClass}>Brand Spectrum</span>
            <span className={labelClass}>What the AI Learned</span>
          </div>
          <p className="w-fit text-xs tracking-wide text-muted uppercase">AI Suggest Spectrum</p>
          <div className="flex flex-col gap-4">
            {DEMO_SPECTRUM.map((axis) => (
              <label key={axis.id} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[10px] tracking-wide text-muted uppercase">
                  <span>{axis.leftLabel}</span>
                  <span>{axis.rightLabel}</span>
                </div>
                {/* Real native <input type="range">, not a custom dot-on-
                    track div -- matches SpectrumSlider in overview-panels.tsx
                    exactly (h-px w-full accent-foreground). */}
                <input
                  type="range"
                  min={0}
                  max={100}
                  defaultValue={axis.value}
                  disabled
                  className="h-px w-full accent-foreground"
                />
              </label>
            ))}
          </div>

          <div className="flex flex-col">
            {DEMO_BRAND_ACCORDION.map((field) => (
              <ExpandableField key={field.label} label={field.label} value={field.value} />
            ))}
          </div>

          <button
            type="button"
            className="w-fit rounded-md border border-border bg-card px-4 py-2 text-sm transition-colors duration-150 hover:border-foreground/30"
          >
            Refresh AI Analysis
          </button>
        </motion.div>
      )}

      {stageIndex >= STAGE_ORDER.indexOf("recommendations") && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mx-auto flex w-full max-w-md flex-col gap-5"
        >
          <div className="flex items-center justify-between">
            <span className={labelClass}>AI Recommendations</span>
            <span className="text-xs tracking-wide text-muted uppercase">Refresh</span>
          </div>

          <div className="grid grid-cols-3 gap-x-4 gap-y-5 text-center">
            <RecommendationTile label="Brand Health" big={`${r.brandHealthPct}%`} small={r.brandHealthWord} />
            <RecommendationTile label="Today" big={r.todayLabel} bigSmall />
            <RecommendationTile label="Next Gap" big={r.nextGapLabel} bigSmall />
            <RecommendationTile label="Tone" big={r.toneLabel} />
            <RecommendationTile label="Content Mix" big={`${r.contentMixPct}%`} small={r.contentMixLabel} />
            <RecommendationTile label="CTA Usage" big={`${r.ctaUsagePct}%`} small={r.ctaUsageLabel} />
          </div>

          <div className="flex flex-col gap-2">
            <span className={labelClass}>AI Summary</span>
            <div className="border border-border p-3 text-sm text-muted">
              <ul className="flex flex-col gap-1.5">
                {r.summaryNotices.map((notice, i) => (
                  <li key={i}>{notice}</li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      )}
    </section>
  );
}

function ExpandableField({ label, value }: { label: string; value: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center justify-between border-b border-foreground py-1 text-left text-xs tracking-wide uppercase text-muted transition-colors duration-150 hover:text-foreground"
      >
        <span>{label}</span>
        <span
          className="inline-block text-sm normal-case transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ transform: open ? "rotate(45deg)" : "rotate(0deg)" }}
        >
          +
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <p className="whitespace-pre-wrap pt-2 text-sm text-muted">{value}</p>
        </div>
      </div>
    </div>
  );
}

function RecommendationTile({
  label,
  big,
  small,
  bigSmall,
}: {
  label: string;
  big: string;
  small?: string;
  bigSmall?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] tracking-wide text-muted uppercase">{label}</span>
      <span className={bigSmall ? "text-sm font-medium" : "text-xl font-light"}>{big}</span>
      {small && <span className="text-[10px] text-muted">{small}</span>}
    </div>
  );
}
