"use client";

// Opt-in, local-only diagnostic trace for the Grid's interaction/data
// lifecycle -- built for this branch's own Preview QA process, where the
// sandbox this was developed in has no authenticated Supabase session and
// so cannot reproduce every real-account failure directly. When a real
// Preview session hits an unexpected Grid behavior, enabling this lets the
// exact mode transition / mutation sequence be captured and sent back,
// instead of re-guessing from a screen recording alone.
//
// DISABLED BY DEFAULT. Nothing here ever runs unless explicitly turned on.
//
// TO ENABLE (either one):
//   - append ?gridDiag=1 to the Grid page's URL, or
//   - in the browser console: localStorage.setItem("grid-diagnostics", "1")
//     (then reload)
// TO DISABLE:
//   - in the browser console: localStorage.removeItem("grid-diagnostics")
//     (then reload), or simply drop ?gridDiag=1 from the URL for that visit
//
// Every event goes to console.log ONLY -- nothing is sent anywhere, no
// network request, no remote logging service. Logged fields are limited to
// timestamps, interaction mode names, and entity ids (slot/row/post/media/
// operation ids) already visible in the DOM/URL -- never post content,
// captions, uploaded file contents, or any other user data.

const STORAGE_KEY = "grid-diagnostics";

function isEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("gridDiag") === "1") return true;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Storage access can throw in some locked-down/private-browsing
    // contexts -- fail closed (diagnostics off), never fail the page.
    return false;
  }
}

function log(prefix: string, event: string, detail: Record<string, unknown>) {
  if (!isEnabled()) return;
  console.log(`[grid-diag:${prefix}] ${event}`, { t: Date.now(), ...detail });
}

// Interaction-mode transitions -- what grid-interaction.ts's reducer did,
// and what the Grid's interaction mode was immediately before/after.
export function logGridInteraction(event: string, detail: Record<string, unknown>) {
  log("interaction", event, detail);
}

// Data mutation lifecycle (grid-reducer.ts) -- BEGIN/COMMIT/FAIL for a slot
// or row operation, and server-snapshot merges.
export function logGridDataEvent(event: string, detail: Record<string, unknown>) {
  log("data", event, detail);
}
