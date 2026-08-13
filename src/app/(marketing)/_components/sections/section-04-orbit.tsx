"use client";

import { computeTileLayout, MAX_ORBIT_TILES, ORBIT_DOT_LAYOUT } from "@/lib/orbit-layout";
import { useLandingContent } from "@/lib/landing/content-context";

const labelClass = "text-xs font-semibold tracking-wide uppercase";

// Near-verbatim port of BrandKnowledgePanel's wheel (overview-panels.tsx) --
// same CSS classes/keyframes (globals.css, "Landing: Brand Intelligence
// orbit" block), same tile-layout math (now shared via src/lib/orbit-layout.ts
// so the two never drift). tileCount drives how many demo documents have
// "appeared" so far in the upload stage; spinning maps straight onto the
// real is-spinning class toggle. Hub is a real h-20 w-20 rounded-2xl button
// with the real PaperclipIcon (not a circular emoji hub, which the first
// pass at this clone incorrectly used) -- the "Brand Knowledge" label +
// analyzed-count line sit BELOW the circle as their own block, exactly like
// the real component, not overlapping the wheel.
export function BrandOrbit({
  tileCount,
  spinning,
  refreshing = false,
}: {
  tileCount: number;
  spinning: boolean;
  refreshing?: boolean;
}) {
  const { DEMO_BRAND_DOCUMENTS } = useLandingContent();
  const tiles = DEMO_BRAND_DOCUMENTS.slice(0, Math.min(tileCount, MAX_ORBIT_TILES));
  const tileLayout = computeTileLayout(Math.max(tiles.length, 1));
  const fileCount = tiles.filter((t) => t.kind === "file").length;
  const linkCount = tiles.filter((t) => t.kind === "link").length;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative mx-auto aspect-square w-full max-w-sm">
        <div className="knowledge-orbit-ring" aria-hidden="true" />
        <div className="knowledge-orbit-dots" aria-hidden="true">
          {ORBIT_DOT_LAYOUT.map((d, i) => (
            <span key={i} className="knowledge-orbit-dot" style={{ top: d.top, left: d.left }} />
          ))}
        </div>
        <div className={`knowledge-wheel-ring absolute inset-0 ${spinning ? "is-spinning" : ""}`}>
          {tiles.map((doc, i) => {
            const t = tileLayout[i];
            return (
              <div
                key={doc.id}
                style={{ top: t.top, left: t.left, width: t.size }}
                className="knowledge-tile absolute aspect-square rounded-[15%] flex flex-col items-center justify-center gap-1 overflow-hidden border border-dashed border-border bg-black/[.02] p-2 text-center text-[10px] tracking-wide text-muted uppercase"
              >
                <span className="text-2xl">{doc.kind === "link" ? "🔗" : "📄"}</span>
                <span className="line-clamp-2 leading-tight">{doc.filename}</span>
              </div>
            );
          })}
        </div>
        <div className="absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
          <span className="flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-background text-muted">
            <PaperclipIcon className="h-6 w-6" />
          </span>
          <span className="w-24 text-center text-[10px] tracking-wide text-muted uppercase">
            Upload or drop your assets
          </span>
        </div>
      </div>

      <div className="text-center">
        <p className={labelClass}>Brand Knowledge</p>
        <p className="text-xs text-muted">Help AI Understand Your Brand</p>
      </div>
      <p className="text-center text-[10px] text-muted">
        {refreshing
          ? "AI is analyzing your brand knowledge..."
          : `AI has analyzed: ${fileCount} File${fileCount === 1 ? "" : "s"}${
              linkCount > 0 ? ` // ${linkCount} Link${linkCount === 1 ? "" : "s"}` : ""
            }`}
      </p>
    </div>
  );
}

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path
        d="M17.5 6.5 9 15a3 3 0 1 0 4.24 4.24l7.07-7.07a5 5 0 1 0-7.07-7.07L5.5 12.83"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
