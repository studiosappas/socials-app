"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteShareLink } from "@/lib/actions/share-links";
import type { ShareLinkItem } from "@/lib/data/share-links";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { SHARE_LINK_MESSAGES, copyTextToClipboard, reviewLinkUrl } from "@/lib/review-link";

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
  canCreateLinks,
  tableMissing,
  exportLinks = [],
  onEnterSelectionMode,
  onEnterBulkSelectionMode,
  showLabel = false,
}: {
  projectId: string;
  links: ShareLinkItem[];
  // Owner/Admin/Member (canCreateReviewLinks) -- NOT the board's own
  // content-editing canManage. Gates creating a link and opening the list
  // of existing ones. Whether a given link can be DELETED is per link
  // (link.canDelete): any link for an owner/admin, only their own for a
  // Member.
  canCreateLinks: boolean;
  tableMissing: boolean;
  exportLinks?: { href: string; label: string; title?: string }[];
  onEnterSelectionMode: () => void;
  // Optional -- only Content (stories-board.tsx) has a bulk Move/Delete
  // picker to enter; Grid has no equivalent, so it simply never passes
  // this and no "Select Items" entry appears there. Same
  // enter-a-board-level-selection-mode shape as onEnterSelectionMode
  // above, just for a different picker.
  onEnterBulkSelectionMode?: () => void;
  // Grid-only opt-in (discoverability fix): an unlabeled icon was the
  // reported "can't find where to share" problem, but Content's own
  // trigger has proven, carefully-tuned mobile positioning (see this
  // file's own history) that a visual change here has no reason to
  // disturb -- defaults to false so every other caller is byte-for-byte
  // unaffected. Widening the button doesn't move the dropdown panel below
  // it, which anchors to the wrapper div, not the button's own edge.
  showLabel?: boolean;
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
        className={
          showLabel
            ? "flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs tracking-wide text-foreground uppercase transition-colors duration-150 hover:border-foreground/40 hover:bg-black/[.03]"
            : "rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
        }
      >
        <ShareIcon />
        {showLabel && "Share"}
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-8 z-20 w-56 max-w-[calc(100vw-1.5rem)] rounded-none border border-border bg-background p-1 shadow-lg">
          {exportLinks.length > 0 && (
            <>
              <div className="px-2 pt-1.5 pb-1">
                <p className="text-[10px] tracking-wide text-muted uppercase">Share feed</p>
                <p className="text-[10px] text-muted">Share the visual feed with a client</p>
              </div>
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
              <div className="my-1 border-t border-border" />
            </>
          )}
          <div className="px-2 pt-1.5 pb-1">
            <p className="text-[10px] tracking-wide text-muted uppercase">Share review</p>
            <p className="text-[10px] text-muted">Send content for approval and feedback</p>
          </div>
          {canCreateLinks ? (
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
          ) : (
            // Unavailable, and says why -- a Viewer/Client used to be let
            // into the whole select-then-confirm flow only to have the
            // final step rejected by the database.
            <div className="px-2 py-1.5" data-share-unavailable="">
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="block w-full cursor-not-allowed text-left text-xs text-muted opacity-60"
              >
                Share for Review
              </button>
              <p className="mt-0.5 text-[10px] text-muted">{SHARE_LINK_MESSAGES.createNotAllowed}</p>
            </div>
          )}
          {onEnterBulkSelectionMode && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onEnterBulkSelectionMode();
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
            >
              Select Items
            </button>
          )}
          {canCreateLinks && (
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
          canCreateLinks={canCreateLinks}
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
  canCreateLinks,
  tableMissing,
  onCreateNew,
}: {
  projectId: string;
  links: ShareLinkItem[];
  canCreateLinks: boolean;
  tableMissing: boolean;
  onCreateNew: () => void;
}) {
  const router = useRouter();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Set when the browser refuses the automatic copy -- the link is shown in
  // a selectable field under its row instead.
  const [manualCopyId, setManualCopyId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCopy(link: ShareLinkItem) {
    const copied = await copyTextToClipboard(reviewLinkUrl(window.location.origin, link.token));
    if (!copied) {
      setManualCopyId(link.id);
      return;
    }
    setManualCopyId(null);
    setCopiedId(link.id);
    setTimeout(() => setCopiedId((id) => (id === link.id ? null : id)), 1800);
  }

  async function handleDelete(link: ShareLinkItem) {
    if (deletingId) return;
    if (!confirm(`Delete "${link.title || "this share link"}"? The link will stop working immediately.`)) return;
    setError(null);
    setDeletingId(link.id);
    try {
      const result = await deleteShareLink(projectId, link.id);
      if (!result.success) setError(result.message);
      router.refresh();
    } catch {
      setError(SHARE_LINK_MESSAGES.deleteFailed);
    } finally {
      setDeletingId(null);
    }
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
            <div key={link.id} className="flex flex-col gap-2 py-3">
            <div className="flex items-center justify-between gap-4">
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
                {link.canDelete && (
                  <button
                    type="button"
                    onClick={() => handleDelete(link)}
                    disabled={deletingId !== null}
                    className="px-2 py-2 text-xs tracking-wide text-error uppercase transition-colors duration-150 hover:text-error/70 disabled:opacity-50"
                  >
                    {deletingId === link.id ? "Deleting…" : "Delete"}
                  </button>
                )}
              </div>
            </div>
            {manualCopyId === link.id && (
              <CopyableLinkField
                url={reviewLinkUrl(window.location.origin, link.token)}
                hint="Couldn't copy automatically — select the link and copy it."
              />
            )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}

      {canCreateLinks && (
        <Button type="button" variant="primary" radius="none" onClick={onCreateNew}>
          + New Review Link
        </Button>
      )}
    </div>
  );
}

// A read-only, pre-selected field holding a review link -- the fallback for
// whenever the browser won't write to the clipboard on its own (Safari after
// an awaited request, a denied permission, no Clipboard API at all). The
// Copy button here is a fresh click of its own, so it usually succeeds even
// where the automatic copy didn't; if it still can't, the text is already
// selected for a manual copy.
export function CopyableLinkField({ url, hint }: { url: string; hint?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  async function handleCopy() {
    inputRef.current?.select();
    setState((await copyTextToClipboard(url)) ? "copied" : "manual");
  }

  return (
    <div className="flex flex-col gap-1.5" data-review-link-field="">
      <div className="flex min-w-0 items-stretch gap-2">
        <input
          ref={inputRef}
          type="text"
          readOnly
          value={url}
          aria-label="Review link"
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.currentTarget.select()}
          className="block min-w-0 flex-1 rounded-none border border-border bg-transparent px-3 py-2 text-sm text-foreground select-all focus:border-foreground focus:outline-none"
        />
        <Button type="button" variant="secondary" radius="none" onClick={handleCopy}>
          {state === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-muted">
        {state === "manual" ? "Copying is blocked in this browser — the link is selected, press ⌘C / Ctrl+C." : hint}
      </p>
    </div>
  );
}
