"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LandingMedia } from "../landing-media";
import { BrandOrbit } from "./section-04-orbit";
import {
  DEMO_GRID_SLOTS,
  DEMO_BRIEF_FIELDS,
  DEMO_AI_CAPTION,
  DEMO_POST_TITLE,
  DEMO_TEAM,
  DEMO_SPECTRUM,
  DEMO_EXPORT_FEED,
  DEMO_BRAND_DOCUMENTS,
  EASE,
  type HeroPreviewScreen,
} from "@/lib/landing";
import { Avatar } from "@/components/ui/avatar";

// Mini reuses of the same real screens built for Sections 03-07, rather
// than a fresh set of mini-screens -- kept intentionally small/static
// (no independent drag context, no second timed sequence competing with
// Section 04's own) since this panel's only job is to illustrate, in sync
// with the hero sentence, not to be its own interactive demo.
export function HeroPreview({ screen }: { screen: HeroPreviewScreen }) {
  return (
    <div className="flex aspect-[4/5] w-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-card p-4">
      <AnimatePresence mode="wait">
        <motion.div
          key={screen}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="h-full w-full"
        >
          {screen === "grid" && <GridPreview />}
          {screen === "brief" && <BriefPreview />}
          {screen === "post-popup" && <PostPopupPreview />}
          {screen === "overview" && <OverviewPreview />}
          {screen === "export" && <ExportPreview />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function GridPreview() {
  return (
    <div className="grid h-full grid-cols-2 gap-[2px]">
      {DEMO_GRID_SLOTS.slice(0, 4).map((slot) => (
        <div key={slot.id} className="aspect-[4/5] border border-border">
          <LandingMedia media={slot.image} className="aspect-[4/5]" />
        </div>
      ))}
    </div>
  );
}

function BriefPreview() {
  return (
    <div className="flex h-full flex-col gap-4">
      {DEMO_BRIEF_FIELDS.map((f) => (
        <div key={f.label} className="flex flex-col gap-1">
          <span className="text-[10px] tracking-wide text-muted uppercase">{f.label}</span>
          <p className="text-sm">{f.value}</p>
        </div>
      ))}
      <div className="mt-2 flex flex-col gap-1 border-t border-border pt-3">
        <span className="text-[10px] tracking-wide text-muted uppercase">Caption — written by AI</span>
        <p className="text-sm text-muted">{DEMO_AI_CAPTION}</p>
      </div>
    </div>
  );
}

function PostPopupPreview() {
  return (
    <div className="flex h-full flex-col gap-4">
      <p className="text-sm font-medium">{DEMO_POST_TITLE}</p>
      <div className="flex -space-x-1.5">
        {DEMO_TEAM.map((m) => (
          <Avatar key={m.id} name={m.name} avatarUrl={m.avatar?.src ?? null} size="md" />
        ))}
      </div>
      <span className="w-fit rounded-full border border-accent bg-accent/10 px-3 py-1 text-xs tracking-wide text-accent uppercase">
        In Review
      </span>
    </div>
  );
}

function OverviewPreview() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <BrandOrbit tileCount={DEMO_BRAND_DOCUMENTS.length} spinning={false} />
      <div className="flex w-full max-w-[220px] flex-col gap-1.5">
        {/* Real native <input type="range">, matching SpectrumSlider
            (overview-panels.tsx) exactly -- same fix applied in Section 04. */}
        {DEMO_SPECTRUM.slice(0, 2).map((axis) => (
          <input
            key={axis.id}
            type="range"
            min={0}
            max={100}
            defaultValue={axis.value}
            disabled
            className="h-px w-full accent-foreground"
          />
        ))}
      </div>
    </div>
  );
}

function ExportPreview() {
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="grid grid-cols-3 gap-[2px]">
        {DEMO_EXPORT_FEED.filter((e) => e.kind === "post").map((e) => (
          <LandingMedia key={e.id} media={e.image} className="aspect-[3/4]" />
        ))}
      </div>
      <button
        type="button"
        className="mt-4 w-full rounded-none bg-foreground px-4 py-2.5 text-xs tracking-wide text-background uppercase"
      >
        Export Full Feed
      </button>
    </div>
  );
}
