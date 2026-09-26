"use client";

import { useEffect, useState } from "react";
import { refreshSignedMediaUrls } from "@/lib/actions/media-urls";
import { reportMediaEvent, type MediaFailureCategory } from "@/lib/media-diagnostics";

// An <img> that recovers from a failed load instead of leaving a
// permanently blank tile. Recovery is decided by WHY the load failed
// (classified with one lightweight probe of the same URL), never blindly:
//
// - expired/invalid token (Storage 400/401/403): re-resolve a fresh signed
//   URL for the SAME storage path through the authorized server action
//   (refreshSignedMediaUrls) and swap it in. Batched across every tile that
//   fails at the same moment -- 40 expired tiles is one server call.
// - transient (network error, 5xx, 429): retry the same URL with backoff.
// - missing object (404): deterministic -- stop and report it, rather than
//   hide a real data problem behind retries.
//
// Bounded: at most MAX_RECOVERY_ATTEMPTS per src, plus one more cycle if the
// device comes back online / the tab becomes visible again after giving up.
// Only ever acts on Supabase signed URLs for the project-media bucket;
// anything else (blob: previews, demo media) behaves like a plain <img>.
//
// Media identity: the replacement is always the same storage path as the
// original src, re-signed -- never a different variant or a different
// asset -- and recovery state is keyed to the src prop it was computed
// for, so a slot whose src changes to another asset can never be shown a
// stale recovered URL.

const SIGN_MARKER = "/storage/v1/object/sign/project-media/";
const MAX_RECOVERY_ATTEMPTS = 3;
const TRANSIENT_BACKOFF_MS = [800, 2500, 5000];
// The server guarantees >= 30 minutes of validity on anything it hands
// out; reuse a refreshed URL for a bit less than that.
const REFRESHED_URL_REUSE_MS = 25 * 60 * 1000;

export function storagePathFromSignedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const idx = url.indexOf(SIGN_MARKER);
  if (idx === -1) return null;
  const raw = url.slice(idx + SIGN_MARKER.length).split("?")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// --- batched, deduped refresh -----------------------------------------------
const refreshedByPath = new Map<string, { url: string; at: number }>();
const inflightByPath = new Map<string, Promise<string | null>>();
let pendingPaths: { path: string; resolve: (url: string | null) => void }[] = [];
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

async function flushRefreshQueue() {
  const batch = pendingPaths;
  pendingPaths = [];
  pendingTimer = null;
  const unique = Array.from(new Set(batch.map((b) => b.path)));
  const result: Record<string, string> = {};
  try {
    for (let i = 0; i < unique.length; i += 100) {
      Object.assign(result, await refreshSignedMediaUrls(unique.slice(i, i + 100)));
    }
  } catch {
    // Leaves `result` with whatever chunks succeeded; the rest resolve null.
  }
  const now = Date.now();
  for (const [path, url] of Object.entries(result)) refreshedByPath.set(path, { url, at: now });
  for (const { path, resolve } of batch) {
    inflightByPath.delete(path);
    resolve(result[path] ?? null);
  }
}

function requestFreshUrl(path: string): Promise<string | null> {
  const recent = refreshedByPath.get(path);
  if (recent && Date.now() - recent.at < REFRESHED_URL_REUSE_MS) return Promise.resolve(recent.url);
  const inflight = inflightByPath.get(path);
  if (inflight) return inflight;
  const promise = new Promise<string | null>((resolve) => {
    pendingPaths.push({ path, resolve });
    // Wide enough that tiles failing "together" (probes resolve at slightly
    // different times) share one server call.
    if (!pendingTimer) pendingTimer = setTimeout(() => void flushRefreshQueue(), 150);
  });
  inflightByPath.set(path, promise);
  return promise;
}

// One cheap request against the same URL, only after a load already failed,
// purely to learn the HTTP status (an <img> error event carries none).
// Aborted as soon as headers arrive, so it never downloads the body.
async function probeStatus(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", signal: controller.signal });
    controller.abort();
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function categorize(status: number | null): MediaFailureCategory {
  if (status === null) return "transient-network";
  if (status === 400 || status === 401 || status === 403) return "expired-or-invalid-token";
  if (status === 404) return "missing-object";
  if (status === 429 || status >= 500) return "server-error";
  if (status >= 200 && status < 300) return "decode-failed";
  return "unknown";
}

type RecoveryState = {
  forSrc: string;
  currentSrc: string;
  attempt: number;
  // Bumped to remount the <img> for a same-URL retry -- re-assigning an
  // identical src string wouldn't make the browser try again.
  retryKey: number;
  gaveUp: boolean;
  // The one extra online/visibility-triggered cycle has been used.
  revived: boolean;
};

function initialState(src: string): RecoveryState {
  return { forSrc: src, currentSrc: src, attempt: 0, retryKey: 0, gaveUp: false, revived: false };
}

export type RecoverableSrc = {
  // What to actually render -- the caller's src, or a re-signed URL for the
  // exact same storage path after recovery.
  src: string;
  // Use as the <img>'s React key, so a same-URL retry remounts it.
  retryKey: number;
  onLoad: () => void;
  onError: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  // Attach to the rendered <img>. Catches a load that already FAILED before
  // React hydrated this element -- that error event fires with no React
  // listener attached yet and is never replayed, which would otherwise
  // leave a server-rendered tile blank with no recovery at all.
  attach: (el: HTMLImageElement | null) => void;
};

const checkedElements = new WeakSet<HTMLImageElement>();
// Which src each <img> element is currently being recovered for -- one
// recovery in flight per (element, src), however many error signals arrive.
const recoveringSrcByElement = new WeakMap<HTMLImageElement, string>();

// The recovery logic as a hook, for components that need the effective src
// for more than one element (CroppedCoverImage measures natural size from
// the same src it renders). RecoverableImg below is the plain-<img> wrapper.
export function useRecoverableSrc(src: string, meta?: { assetId?: string | null; mediaKind?: string }): RecoverableSrc {
  const assetId = meta?.assetId;
  const mediaKind = meta?.mediaKind;
  const [state, setState] = useState<RecoveryState>(() => initialState(src));
  // Reset whenever the caller hands us a different src (a different asset,
  // or the same asset freshly re-signed by a server render) -- recovered
  // state is only ever valid for the exact src it was derived from.
  if (state.forSrc !== src) setState(initialState(src));
  const effective = state.forSrc === src ? state : initialState(src);


  // After giving up, try exactly one more cycle when the device regains
  // connectivity or the tab/app is brought back to the foreground -- the
  // common real-world "phone was on a bad connection" case. Once only.
  useEffect(() => {
    if (!effective.gaveUp || effective.revived) return;
    function revive() {
      if (document.visibilityState === "hidden") return;
      setState((s) =>
        s.gaveUp && !s.revived
          ? { ...s, gaveUp: false, revived: true, attempt: MAX_RECOVERY_ATTEMPTS - 1, retryKey: s.retryKey + 1 }
          : s,
      );
    }
    window.addEventListener("online", revive);
    document.addEventListener("visibilitychange", revive);
    return () => {
      window.removeEventListener("online", revive);
      document.removeEventListener("visibilitychange", revive);
    };
  }, [effective.gaveUp, effective.revived]);

  // Every state write below is guarded on `s.forSrc === forSrc`, so a
  // recovery that finishes after this component has moved on to a
  // different src (another asset) can never touch the new one's state.
  async function recover(forSrc: string, failedSrc: string, attempt: number) {
    const path = storagePathFromSignedUrl(failedSrc);
    if (!path) return; // Not a project-media signed URL -- nothing safe to do.

    const status = await probeStatus(failedSrc);
    const category = categorize(status);
    reportMediaEvent({ assetId, kind: mediaKind, stage: "probe", status, category, attempt });

    const giveUp = (result: string) => {
      reportMediaEvent({ assetId, kind: mediaKind, stage: "gave-up", status, category, result, attempt });
      setState((s) => (s.forSrc === forSrc ? { ...s, gaveUp: true } : s));
    };

    if (category === "missing-object") return giveUp("deterministic: object not found");
    if (attempt >= MAX_RECOVERY_ATTEMPTS) return giveUp("attempts exhausted");

    if (category === "expired-or-invalid-token") {
      const fresh = await requestFreshUrl(path);
      if (fresh && fresh !== failedSrc) {
        reportMediaEvent({ assetId, kind: mediaKind, stage: "refresh", category, result: "fresh-url", attempt });
        setState((s) => (s.forSrc === forSrc ? { ...s, currentSrc: fresh, attempt: attempt + 1 } : s));
        return;
      }
      return giveUp(fresh ? "refresh returned the same url" : "refresh unavailable");
    }

    // transient-network / server-error / decode-failed / unknown: a bounded
    // same-URL retry. A "decode-failed" probe (200 OK) most often means the
    // original transfer was cut off mid-way on a flaky connection; if it's a
    // genuinely undecodable file, the attempt cap ends it.
    await new Promise((r) => setTimeout(r, TRANSIENT_BACKOFF_MS[Math.min(attempt, TRANSIENT_BACKOFF_MS.length - 1)]));
    reportMediaEvent({ assetId, kind: mediaKind, stage: "retry", category, attempt });
    setState((s) => (s.forSrc === forSrc ? { ...s, attempt: attempt + 1, retryKey: s.retryKey + 1 } : s));
  }

  function handleError(el: HTMLImageElement) {
    const failedSrc = effective.currentSrc;
    if (effective.gaveUp || recoveringSrcByElement.get(el) === failedSrc) return;
    reportMediaEvent({ assetId, kind: mediaKind, stage: "load-error", attempt: effective.attempt });
    recoveringSrcByElement.set(el, failedSrc);
    void recover(effective.forSrc, failedSrc, effective.attempt).finally(() => {
      if (recoveringSrcByElement.get(el) === failedSrc) recoveringSrcByElement.delete(el);
    });
  }

  return {
    src: effective.currentSrc,
    retryKey: effective.retryKey,
    attach: (el) => {
      if (!el || checkedElements.has(el)) return;
      checkedElements.add(el);
      if (el.complete && el.naturalWidth === 0 && el.getAttribute("src")) handleError(el);
    },
    onLoad: () => {
      if (effective.attempt > 0) {
        reportMediaEvent({ assetId, kind: mediaKind, stage: "recovered", attempt: effective.attempt });
      }
    },
    onError: (e) => handleError(e.currentTarget),
  };
}

export type RecoverableImgProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  // Diagnostics only (never affects what's displayed).
  assetId?: string | null;
  mediaKind?: string;
};

export function RecoverableImg({ src, assetId, mediaKind, onError, onLoad, alt = "", ...rest }: RecoverableImgProps) {
  const {
    src: effectiveSrc,
    retryKey,
    attach,
    onLoad: handleLoad,
    onError: handleError,
  } = useRecoverableSrc(src, { assetId, mediaKind });
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={retryKey}
      ref={attach}
      {...rest}
      alt={alt}
      src={effectiveSrc}
      onLoad={(e) => {
        handleLoad();
        onLoad?.(e);
      }}
      onError={(e) => {
        onError?.(e);
        handleError(e);
      }}
    />
  );
}
