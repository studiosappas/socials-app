// Client-safe helpers for the Share for Review flow -- no React, no
// Supabase, so they're unit-testable on their own (review-link.test.ts).

export function reviewLinkUrl(origin: string, token: string): string {
  return `${origin}/preview/${token}`;
}

type ClipboardLike = { writeText?: (text: string) => Promise<void> } | null | undefined;

// Never throws. Returns false whenever the text did not verifiably reach the
// clipboard -- the API is missing (insecure context, old browser), the
// browser denies the write, or it throws synchronously. Safari in
// particular rejects a clipboard write that no longer counts as part of the
// user's click, which is exactly the situation after awaiting a server
// action; the caller must treat false as "show the link so it can be copied
// by hand", never as "the link wasn't created".
export async function copyTextToClipboard(text: string, clipboard?: ClipboardLike): Promise<boolean> {
  const target: ClipboardLike =
    clipboard !== undefined ? clipboard : typeof navigator !== "undefined" ? navigator.clipboard : null;
  if (!target || typeof target.writeText !== "function") return false;
  try {
    await target.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const SHARE_LINK_MESSAGES = {
  notLoggedIn: "You must be logged in.",
  nothingSelected: "Select at least one post or story to share.",
  createNotAllowed: "Only owners, admins and members can create review links for this project.",
  deleteNotAllowed: "You can only delete review links you created. Ask an owner or admin to remove this one.",
  notSetUp: "Review links aren't set up on this workspace yet. Please contact an admin.",
  contentUnavailable: "That content is no longer available. Refresh the page and try again.",
  createFailed: "Couldn't create the review link. Please try again.",
  deleteFailed: "Couldn't delete the review link. Please try again.",
  alreadyDeleted: "That review link no longer exists.",
} as const;

// Turns a database error into something a person can act on. The raw
// message (e.g. `new row violates row-level security policy for table
// "share_links"`) is never shown -- the caller logs it server-side instead.
export function friendlyShareLinkError(
  error: { code?: string | null; message?: string | null } | null | undefined,
  action: "create" | "delete",
): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  // 42501 = insufficient_privilege, what PostgREST reports for an RLS
  // rejection.
  if (code === "42501" || message.includes("row-level security")) {
    return action === "create" ? SHARE_LINK_MESSAGES.createNotAllowed : SHARE_LINK_MESSAGES.deleteNotAllowed;
  }
  // 42P01 = undefined_table, PGRST205 = table not in PostgREST's schema cache.
  if (code === "42P01" || code === "PGRST205") return SHARE_LINK_MESSAGES.notSetUp;
  // 23503 = foreign_key_violation: a selected post/story was deleted meanwhile.
  if (code === "23503") return SHARE_LINK_MESSAGES.contentUnavailable;
  return action === "create" ? SHARE_LINK_MESSAGES.createFailed : SHARE_LINK_MESSAGES.deleteFailed;
}

// Collapses overlapping calls into one: while a run is in flight, further
// calls are ignored (return undefined) instead of starting a second run. A
// disabled button alone doesn't cover two clicks landing before React has
// re-rendered it as disabled.
export function createSingleFlight() {
  let inFlight = false;
  return {
    get busy() {
      return inFlight;
    },
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (inFlight) return undefined;
      inFlight = true;
      try {
        return await fn();
      } finally {
        inFlight = false;
      }
    },
  };
}
