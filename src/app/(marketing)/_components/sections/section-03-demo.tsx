"use client";

import { useState } from "react";
import { ScrollReveal } from "../motion/scroll-reveal";
import { DemoGridDrag } from "./section-03-demo-grid";
import { DemoCropReposition } from "./section-03-demo-crop";
import { DemoLiveSearch } from "./section-03-demo-search";
import { DEMO_SECTION_CONTENT } from "@/lib/landing";

const TABS = [
  { id: "grid", label: "Reorder the feed" },
  { id: "crop", label: "Reposition a photo" },
  { id: "search", label: "Search the library" },
] as const;

export function DemoSection() {
  const [active, setActive] = useState<(typeof TABS)[number]["id"]>("grid");

  return (
    <section id="demo" className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-24 sm:px-8">
      <ScrollReveal className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-3xl font-light sm:text-4xl">{DEMO_SECTION_CONTENT.headline}</h2>
        <p className="max-w-md text-sm text-muted">{DEMO_SECTION_CONTENT.subhead}</p>
      </ScrollReveal>

      <ScrollReveal delay={0.1} className="flex flex-col items-center gap-8">
        <div className="flex flex-wrap justify-center gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={`rounded-full border px-4 py-2 text-xs tracking-wide uppercase transition-colors duration-150 ${
                active === tab.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-foreground hover:border-foreground/40"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="w-full">
          {active === "grid" && <DemoGridDrag />}
          {active === "crop" && <DemoCropReposition />}
          {active === "search" && <DemoLiveSearch />}
        </div>
      </ScrollReveal>
    </section>
  );
}
