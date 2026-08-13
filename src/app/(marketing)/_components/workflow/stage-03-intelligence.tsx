"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { BrandOrbit } from "../sections/section-04-orbit";
import { EASE } from "@/lib/landing";
import { useLandingContent } from "@/lib/landing/content-context";
import type { WorkflowStageProps } from "./workflow-types";

const labelClass = "text-xs font-semibold tracking-wide uppercase";

type Stage = "idle" | "uploading" | "analyzing" | "spectrum" | "summary" | "recommendations";
const STAGE_ORDER: Stage[] = ["idle", "uploading", "analyzing", "spectrum", "summary", "recommendations"];

// The "Intelligence" stage -- this is almost entirely the same timed
// sequence the old section-04-brand-intelligence.tsx already built
// (documents flow into the orb, the spectrum reacts, summaries appear),
// just triggered by this stage's own `active` prop (scroll progress or
// mobile inView, see pinned-stages.tsx/sequential-stages.tsx) instead of
// its own standalone useInView. No explanatory copy -- the animation is
// the explanation, per the brief.
export function StageIntelligence({ active }: WorkflowStageProps) {
  const { DEMO_BRAND_DOCUMENTS, DEMO_SPECTRUM, DEMO_BRAND_ACCORDION, DEMO_AI_RECOMMENDATIONS } = useLandingContent();
  const [stage, setStage] = useState<Stage>("idle");
  const [tileCount, setTileCount] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active || startedRef.current) return;
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
  }, [active, DEMO_BRAND_DOCUMENTS]);

  const stageIndex = STAGE_ORDER.indexOf(stage);
  const spinning = stage === "analyzing";
  const r = DEMO_AI_RECOMMENDATIONS;

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3 overflow-y-auto py-2" style={{ maxHeight: "90dvh" }}>
      <p className="text-xs tracking-wide text-muted uppercase">03 — Intelligence</p>

      <BrandOrbit tileCount={tileCount} spinning={spinning} refreshing={stage === "analyzing"} />

      {stageIndex >= STAGE_ORDER.indexOf("spectrum") && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="flex w-full flex-col gap-4"
        >
          <div className="flex items-center justify-between">
            <span className={labelClass}>Brand Spectrum</span>
            <span className={labelClass}>What the AI Learned</span>
          </div>
          <div className="flex flex-col gap-3">
            {DEMO_SPECTRUM.slice(0, 3).map((axis) => (
              <label key={axis.id} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[10px] tracking-wide text-muted uppercase">
                  <span>{axis.leftLabel}</span>
                  <span>{axis.rightLabel}</span>
                </div>
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
            {DEMO_BRAND_ACCORDION.slice(0, 2).map((field) => (
              <ExpandableField key={field.label} label={field.label} value={field.value} />
            ))}
          </div>
        </motion.div>
      )}

      {stageIndex >= STAGE_ORDER.indexOf("recommendations") && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="grid w-full grid-cols-3 gap-x-4 text-center"
        >
          <RecommendationTile label="Brand Health" big={`${r.brandHealthPct}%`} small={r.brandHealthWord} />
          <RecommendationTile label="Today" big={r.todayLabel} bigSmall />
          <RecommendationTile label="Tone" big={r.toneLabel} />
        </motion.div>
      )}
    </div>
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
