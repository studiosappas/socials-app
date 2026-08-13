"use client";

import { useState, useTransition } from "react";
import { deleteShareLink } from "@/lib/actions/share-links";
import type { ShareLinkItem } from "@/lib/data/share-links";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";

function formatDate(iso: string | null): string {
  if (!iso) return "No date";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
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
  );
}

// A single icon on Grid/Stories replacing what used to be a whole "Share"
// page/nav tab -- opens a small menu (page-level export links, when given
// any, plus "Share for Review" and a way to manage links already created).
// Selecting content to share now happens inline on the board itself (the
// same multi-select-circle pattern Media Library uses), not in a dialog --
// see onEnterSelectionMode, implemented by the board (GridBoard/
// StoriesBoard) that renders this button.
export function ShareMenuButton({
  projectId,
  links,
  canManage,
  tableMissing,
  exportLinks = [],
  onEnterSelectionMode,
}: {
  projectId: string;
  links: ShareLinkItem[];
  canManage: boolean;
  tableMissing: boolean;
  exportLinks?: { href: string; label: string; title?: string }[];
  onEnterSelectionMode: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        title="Share & export"
        className="rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
      >
        <ShareIcon />
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-8 z-20 w-56 rounded-none border border-border bg-background p-1 shadow-lg">
          {exportLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              download
              title={link.title}
              onClick={() => setMenuOpen(false)}
              className="block w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
            >
              {link.label}
            </a>
          ))}
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onEnterSelectionMode();
            }}
            className="block w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
          >
            Share for Review
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setManageOpen(true);
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
            >
              Manage Review Links
            </button>
          )}
        </div>
      )}

      <Dialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        title="Review Links"
        widthClassName="max-w-2xl"
        radius="none"
      >
        <ShareLinksList
          projectId={projectId}
          links={links}
          canManage={canManage}
          tableMissing={tableMissing}
          onCreateNew={() => {
            setManageOpen(false);
            onEnterSelectionMode();
          }}
        />
      </Dialog>
    </div>
  );
}

function ShareLinksList({
  projectId,
  links,
  canManage,
  tableMissing,
  onCreateNew,
}: {
  projectId: string;
  links: ShareLinkItem[];
  canManage: boolean;
  tableMissing: boolean;
  onCreateNew: () => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleCopy(link: ShareLinkItem) {
    await navigator.clipboard.writeText(`${window.location.origin}/preview/${link.token}`);
    setCopiedId(link.id);
    setTimeout(() => setCopiedId((id) => (id === link.id ? null : id)), 1800);
  }

  function handleDelete(link: ShareLinkItem) {
    if (!confirm(`Delete "${link.title || "this share link"}"? The link will stop working immediately.`)) return;
    startTransition(() => deleteShareLink(projectId, link.id));
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        A view-only gallery link for selected content, with approval and notes that sync straight back to the post —
        ideal for sending to clients for review.
      </p>

      {tableMissing ? (
        <p className="text-sm text-muted">
          Shared previews aren&apos;t set up on this database yet — run the pending migration to enable them.
        </p>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted">No review links yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border border-t border-b border-border">
          {links.map((link) => (
            <div key={link.id} className="flex items-center justify-between gap-4 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">{link.title || "Untitled link"}</span>
                <span className="text-xs text-muted">
                  {link.itemCount} item{link.itemCount === 1 ? "" : "s"} · Created {formatDate(link.createdAt)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button type="button" variant="secondary" radius="none" onClick={() => handleCopy(link)}>
                  {copiedId === link.id ? "Copied" : "Copy Link"}
                </Button>
                <a
                  href={`/preview/${link.token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 text-sm text-muted underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline"
                >
                  Open
                </a>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleDelete(link)}
                    className="px-2 py-2 text-xs tracking-wide text-error uppercase transition-colors duration-150 hover:text-error/70"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <Button type="button" variant="primary" radius="none" onClick={onCreateNew}>
          + New Review Link
        </Button>
      )}
    </div>
  );
}
