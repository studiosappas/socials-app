"use client";

import { useEffect, useState } from "react";
import type { CustomFontFace } from "@/lib/data/brand-moodboard";

// Module-level, not per-hook-instance -- every AnnotationEditor mount on the
// same page (and the Brand Moodboard dialog's own preview) shares this, so
// the same font isn't fetched/registered twice in one session. Keyed by URL
// too (not just familyName|weight|style), so a fresh signed URL after a page
// reload naturally re-loads rather than trusting a URL that might be near
// its 1hr TTL -- see project-media's SIGNED_URL_TTL_SECONDS convention.
const loadedKeys = new Set<string>();

function keyFor(f: CustomFontFace): string {
  return `${f.familyName}|${f.weight}|${f.style}|${f.url}`;
}

// Loads each not-yet-seen font face via the browser FontFace API and
// registers it on document.fonts. A face that fails to parse/load (corrupt
// file, a format the browser doesn't support) is silently skipped -- the
// rest still load, and the family just renders in solid form
// (bold/italic falling back) rather than blocking or throwing.
export function useCustomFonts(fonts: CustomFontFace[]): { familyNames: string[]; readyVersion: number } {
  const [readyVersion, setReadyVersion] = useState(0);

  useEffect(() => {
    if (typeof document === "undefined" || !("fonts" in document)) return;

    const toLoad = fonts.filter((f) => !loadedKeys.has(keyFor(f)));
    if (toLoad.length === 0) return;

    let cancelled = false;
    Promise.all(
      toLoad.map(async (f) => {
        try {
          const face = new FontFace(f.familyName, `url(${f.url})`, {
            weight: f.weight,
            style: f.style,
          });
          const loaded = await face.load();
          document.fonts.add(loaded);
          loadedKeys.add(keyFor(f));
        } catch {
          // Unsupported/corrupt font file -- skip this face, others still load.
        }
      }),
    ).then(() => {
      if (!cancelled) setReadyVersion((v) => v + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [fonts]);

  const familyNames = Array.from(new Set(fonts.map((f) => f.familyName)));
  return { familyNames, readyVersion };
}
