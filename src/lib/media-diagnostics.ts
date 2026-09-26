"use client";

import { useEffect } from "react";

// Safe, opt-in diagnostics for media loading. Enable in any browser (mobile
// included, via the address bar) with `?mediaDiag=1` once, or
// `localStorage.setItem("mediaDiag", "1")`; disable with `?mediaDiag=0`.
//
// NEVER logs a signed URL, a token, or any credential -- only asset ids,
// media kinds, pipeline stages, HTTP status codes and error categories.

let diagEnabledCache: boolean | null = null;

export function mediaDiagEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (diagEnabledCache !== null) return diagEnabledCache;
  try {
    const param = new URLSearchParams(window.location.search).get("mediaDiag");
    if (param === "1") window.localStorage.setItem("mediaDiag", "1");
    if (param === "0") window.localStorage.removeItem("mediaDiag");
    diagEnabledCache = window.localStorage.getItem("mediaDiag") === "1";
  } catch {
    diagEnabledCache = false;
  }
  return diagEnabledCache;
}

export type MediaFailureCategory =
  | "expired-or-invalid-token"
  | "missing-object"
  | "transient-network"
  | "server-error"
  | "decode-failed"
  | "unknown";

export type MediaLoadEvent = {
  assetId?: string | null;
  kind?: string;
  stage: "load-error" | "probe" | "refresh" | "retry" | "recovered" | "gave-up";
  status?: number | null;
  category?: MediaFailureCategory;
  result?: string;
  attempt?: number;
};

export function reportMediaEvent(event: MediaLoadEvent) {
  if (typeof window === "undefined") return;
  // Final outcomes are always worth a (safe) console line -- they're what a
  // real-device QA session needs to see without having to pre-enable
  // anything. Intermediate steps only when diagnostics are switched on.
  if (event.stage === "gave-up") {
    console.warn("[media] image failed to load", event);
  } else if (mediaDiagEnabled()) {
    console.info("[media]", event);
  }
}

// --- Timing -----------------------------------------------------------------
//
// T0 is the most recent pointerdown anywhere on the page (the tap/click that
// started the navigation or opened the editor) -- or 0, i.e. the browser's
// own navigation start, on a hard load with no interaction yet.
let lastInteractionAt: number | null = null;
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    () => {
      lastInteractionAt = performance.now();
    },
    { capture: true, passive: true },
  );
}

type TimingResult = {
  surface: string;
  t0: number;
  t1StructureVisible: number;
  t2FirstImage: number | null;
  t3ViewportReady: number | null;
  t4AllRendered: number | null;
  viewportImages: number;
  totalImages: number;
  failedImages: number;
  hardLoad: boolean;
};

declare global {
  interface Window {
    __mediaTimings?: TimingResult[];
  }
}

function isInViewport(el: Element) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
}

// Measures user-visible readiness of the <img>s inside `containerRef`:
// T1 structure visible (this hook's mount, next frame), T2 first image
// decoded, T3 every image currently in the viewport decoded (or failed),
// T4 every image in the container decoded (or failed). No-op unless
// diagnostics are enabled; results go to the console and
// window.__mediaTimings.
export function useMediaTiming(surface: string, containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!mediaDiagEnabled()) return;
    const t0 = lastInteractionAt ?? 0;
    const hardLoad = lastInteractionAt === null;
    let t1 = 0;
    let t2: number | null = null;
    let t3: number | null = null;
    let t4: number | null = null;
    let done = false;
    const started = performance.now();
    const raf = requestAnimationFrame(() => {
      t1 = performance.now();
    });
    const settled = (img: HTMLImageElement) => img.complete;
    const loaded = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0;

    function finish(imgs: HTMLImageElement[], viewportCount: number) {
      done = true;
      const rel = (t: number | null) => (t === null ? null : Math.round(t - t0));
      const result: TimingResult = {
        surface,
        t0: Math.round(t0),
        t1StructureVisible: Math.round((t1 || started) - t0),
        t2FirstImage: rel(t2),
        t3ViewportReady: rel(t3),
        t4AllRendered: rel(t4),
        viewportImages: viewportCount,
        totalImages: imgs.length,
        failedImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
        hardLoad,
      };
      window.__mediaTimings = [...(window.__mediaTimings ?? []), result];
      console.info(`[media-timing] ${surface} (ms from T0)`, result);
    }

    const interval = window.setInterval(() => {
      const el = containerRef.current;
      if (!el || done) return;
      const imgs = Array.from(el.querySelectorAll("img"));
      const now = performance.now();
      if (t2 === null && imgs.some(loaded)) t2 = now;
      const inView = imgs.filter(isInViewport);
      if (t3 === null && inView.length > 0 && inView.every(settled)) t3 = now;
      if (t4 === null && imgs.length > 0 && imgs.every(settled)) t4 = now;
      // Lazy images outside the viewport never load on their own, so T4 is
      // best-effort: stop at T3 + 3s or a 30s cap, whichever comes first.
      if ((t3 !== null && (t4 !== null || now - t3 > 3000)) || now - started > 30000) {
        window.clearInterval(interval);
        finish(imgs, inView.length);
      }
    }, 50);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(interval);
    };
    // Measured once per mount -- a surface's first appearance is the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
