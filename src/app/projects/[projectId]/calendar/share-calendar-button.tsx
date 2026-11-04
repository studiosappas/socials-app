"use client";

import { useState, useTransition } from "react";
import { createCalendarShareLink, revokeCalendarShareLink } from "@/lib/actions/calendar-share-links";
import type { CalendarShareLink } from "@/lib/data/calendar-share-links";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// A server action that never answers (offline, deploy mid-request) rejects
// instead of returning -- caught so it shows as a message rather than
// escaping the transition into the page's error boundary.
function networkFailure() {
  return { success: false as const, message: "Couldn't reach the server — check your connection and try again." };
}

function linkUrl(token: string): string {
  return `${window.location.origin}/preview-calendar/${token}`;
}

// Owner/admin only (calendar/page.tsx doesn't render this for anyone else,
// and the actions + RLS refuse them anyway). Same labelled-pill trigger and
// square dialog language as Grid's Share menu (share-menu.tsx).
export function ShareCalendarButton({
  projectId,
  links: initialLinks,
  tableMissing,
}: {
  projectId: string;
  links: CalendarShareLink[];
  tableMissing: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Local copy so a create/revoke shows instantly; revalidatePath refreshes
  // the server copy behind it.
  const [links, setLinks] = useState(initialLinks);
  const [prevInitial, setPrevInitial] = useState(initialLinks);
  if (initialLinks !== prevInitial) {
    setPrevInitial(initialLinks);
    setLinks(initialLinks);
  }
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function copy(link: CalendarShareLink) {
    try {
      await navigator.clipboard.writeText(linkUrl(link.token));
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((id) => (id === link.id ? null : id)), 1800);
    } catch {
      setMessage("Couldn't copy automatically — use Open and copy the address instead.");
    }
  }

  function create() {
    setMessage(null);
    startTransition(async () => {
      const result = await createCalendarShareLink(projectId).catch(networkFailure);
      if (!result.success) {
        setMessage(result.message);
        return;
      }
      setLinks((current) => [result.link, ...current]);
      await copy(result.link);
    });
  }

  function revoke(link: CalendarShareLink) {
    if (!confirm("Revoke this calendar link? Anyone using it will lose access immediately.")) return;
    setMessage(null);
    startTransition(async () => {
      const result = await revokeCalendarShareLink(projectId, link.id).catch(networkFailure);
      if (!result.success) {
        setMessage(result.message);
        return;
      }
      setLinks((current) => current.filter((l) => l.id !== link.id));
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Share a read-only calendar link"
        className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs tracking-wide text-foreground uppercase transition-colors duration-150 hover:border-foreground/40 hover:bg-black/[.03]"
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
          <path d="M7.5 1V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M4.5 4L7.5 1L10.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <path
            d="M2.5 8.5V11.5C2.5 12.05 2.95 12.5 3.5 12.5H11.5C12.05 12.5 12.5 12.05 12.5 11.5V8.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Share Calendar
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Share Calendar" widthClassName="max-w-2xl" radius="none">
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted">
            A private, view-only link to this project&apos;s calendar — every dated post and story, including drafts, and day
            notes. No login needed; nothing can be edited. Revoke it any time.
          </p>

          {tableMissing ? (
            <p className="text-sm text-muted">
              Calendar sharing isn&apos;t set up on this database yet — run the pending migration to enable it.
            </p>
          ) : links.length === 0 ? (
            <p className="text-sm text-muted">No calendar links yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border border-t border-b border-border">
              {links.map((link) => (
                <div key={link.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                  <span className="text-xs text-muted">Created {formatDate(link.createdAt)}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button type="button" variant="secondary" radius="none" onClick={() => copy(link)}>
                      {copiedId === link.id ? "Copied" : "Copy Link"}
                    </Button>
                    <a
                      href={`/preview-calendar/${link.token}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 text-sm text-muted underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline"
                    >
                      Open
                    </a>
                    <button
                      type="button"
                      onClick={() => revoke(link)}
                      disabled={pending}
                      className="px-2 py-2 text-xs tracking-wide text-error uppercase transition-colors duration-150 hover:text-error/70 disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {message && <p className="text-sm text-error">{message}</p>}

          {!tableMissing && (
            <Button type="button" variant="primary" radius="none" onClick={create} disabled={pending}>
              {pending ? "Working…" : "+ Create & Copy Link"}
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}
