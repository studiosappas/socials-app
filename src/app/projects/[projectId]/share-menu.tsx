"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createShareLink, deleteShareLink } from "@/lib/actions/share-links";
import type { ShareLinkItem, PickerPost, PickerStory } from "@/lib/data/share-links";
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

type ShareContentType = "post" | "story";

// A single icon on Grid/Stories replacing what used to be a whole "Share"
// page/nav tab -- opens a small menu (page-level export links, when given
// any, plus the one entry every page gets: the actual client-preview-link
// manager, which opens as a dialog rather than a page. Each page only ever
// picks from its own content type (Grid -> posts, Stories -> stories); the
// list of already-created links, further down, is project-wide regardless
// of which page a given link's content came from.
export function ShareMenuButton({
  projectId,
  links,
  items,
  contentType,
  canManage,
  tableMissing,
  exportLinks = [],
}: {
  projectId: string;
  links: ShareLinkItem[];
  items: PickerPost[] | PickerStory[];
  contentType: ShareContentType;
  canManage: boolean;
  tableMissing: boolean;
  exportLinks?: { href: string; label: string; title?: string }[];
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => {
          // Posts/stories created just now via Grid's optimistic (no
          // router.refresh()) drag/assign flow wouldn't otherwise show up
          // in the picker until some unrelated refresh happened to land --
          // refreshing on open guarantees this menu's data is current.
          // Wrapped in a transition (not fired bare) so isRefreshing is
          // actually true until the new props land, not just until the
          // call returns -- the picker uses it to show "Loading…" instead
          // of a false "nothing here" for however long that takes.
          if (!menuOpen) startRefresh(() => router.refresh());
          setMenuOpen((v) => !v);
        }}
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
              setDialogOpen(true);
            }}
            className="block w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
          >
            Share With Client
          </button>
        </div>
      )}

      <ShareManagerDialog
        projectId={projectId}
        links={links}
        items={items}
        contentType={contentType}
        canManage={canManage}
        tableMissing={tableMissing}
        refreshing={isRefreshing}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

function ShareManagerDialog({
  projectId,
  links,
  items,
  contentType,
  canManage,
  tableMissing,
  refreshing,
  open,
  onClose,
}: {
  projectId: string;
  links: ShareLinkItem[];
  items: PickerPost[] | PickerStory[];
  contentType: ShareContentType;
  canManage: boolean;
  tableMissing: boolean;
  refreshing: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"list" | "create">("list");
  // Forces a full remount (of both mode's content, including the create
  // form's useActionState) on every open -- otherwise a prior submission's
  // leftover state could resurface the next time this reopens. Same fix as
  // the Assets "Edit Folder" dialog needed earlier this project.
  const [dialogNonce, setDialogNonce] = useState(0);

  function handleClose() {
    setMode("list");
    setDialogNonce((n) => n + 1);
    onClose();
  }

  return (
    <Dialog
      key={dialogNonce}
      open={open}
      onClose={handleClose}
      title={mode === "create" ? "New Share Link" : "Share With Client"}
      widthClassName="max-w-2xl"
      radius="none"
    >
      {mode === "list" ? (
        <ShareLinksList
          projectId={projectId}
          links={links}
          canManage={canManage}
          tableMissing={tableMissing}
          onCreateNew={() => setMode("create")}
        />
      ) : (
        <SharePickerForm
          projectId={projectId}
          items={items}
          contentType={contentType}
          refreshing={refreshing}
          onDone={handleClose}
          onBack={() => setMode("list")}
        />
      )}
    </Dialog>
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
        A view-only gallery link for selected content — ideal for sending to clients for review before approval.
      </p>

      {tableMissing ? (
        <p className="text-sm text-muted">
          Shared previews aren&apos;t set up on this database yet — run the pending migration to enable them.
        </p>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted">No share links yet.</p>
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
          + New Share Link
        </Button>
      )}
    </div>
  );
}

function SharePickerForm({
  projectId,
  items,
  contentType,
  refreshing,
  onDone,
  onBack,
}: {
  projectId: string;
  items: PickerPost[] | PickerStory[];
  contentType: ShareContentType;
  refreshing: boolean;
  onDone: () => void;
  onBack: () => void;
}) {
  const boundAction = createShareLink.bind(null, projectId);
  const [state, action, pending] = useActionState(boundAction, undefined);
  const [copied, setCopied] = useState(false);

  if (state?.success && state.token) {
    const url = typeof window !== "undefined" ? `${window.location.origin}/preview/${state.token}` : "";
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-foreground">Share link created.</p>
        <div className="flex items-center gap-2 border border-border px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm text-muted">{url}</span>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            }}
            className="shrink-0 text-xs font-semibold tracking-wide uppercase transition-colors duration-150 hover:text-muted"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <Button type="button" variant="primary" radius="none" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  const fieldName = contentType === "post" ? "post_ids" : "story_ids";
  const sectionLabel = contentType === "post" ? "Posts" : "Stories";
  const filmstripItems = items.map((item) =>
    contentType === "post"
      ? {
          id: item.id,
          thumbnailUrl: item.thumbnailUrl,
          label: (item as PickerPost).caption.trim() || "Untitled post",
        }
      : { id: item.id, thumbnailUrl: item.thumbnailUrl, label: (item as PickerStory).name || "Untitled story" },
  );

  return (
    <form action={action} className="flex flex-col gap-5">
      <button
        type="button"
        onClick={onBack}
        className="w-fit text-xs tracking-wide text-muted uppercase transition-colors duration-150 hover:text-foreground"
      >
        ‹ Back
      </button>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs tracking-wide text-muted uppercase">Title (optional)</span>
        <input
          name="title"
          placeholder="e.g. August Campaign — Client Review"
          className="w-full rounded-none border border-foreground bg-transparent px-3 py-2 text-sm focus:outline-none"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-xs tracking-wide text-muted uppercase">{sectionLabel}</span>
        {filmstripItems.length === 0 ? (
          <p className="text-sm text-muted">{refreshing ? "Loading…" : "Nothing here yet."}</p>
        ) : (
          <PickerFilmstrip items={filmstripItems} fieldName={fieldName} />
        )}
      </div>

      {state?.message && <p className="text-sm text-error">{state.message}</p>}

      <Button type="submit" variant="primary" radius="none" disabled={pending}>
        {pending ? "Creating…" : "Create Share Link"}
      </Button>
    </form>
  );
}

const FILMSTRIP_ITEM_WIDTH = 88;
const FILMSTRIP_GAP = 8;
const FILMSTRIP_VISIBLE_COUNT = 5;

// A single horizontal row -- roughly 5 items visible at once, side arrows
// to page through the rest -- instead of a tall scrolling checklist, so all
// the content reads at a glance the way a contact sheet does.
function PickerFilmstrip({
  items,
  fieldName,
}: {
  items: { id: string; thumbnailUrl: string | null; label: string }[];
  fieldName: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollByPage(direction: 1 | -1) {
    scrollRef.current?.scrollBy({
      left: direction * FILMSTRIP_VISIBLE_COUNT * (FILMSTRIP_ITEM_WIDTH + FILMSTRIP_GAP),
      behavior: "smooth",
    });
  }

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <label key={item.id} className="relative flex shrink-0 flex-col items-center gap-1" style={{ width: FILMSTRIP_ITEM_WIDTH }}>
            <input type="checkbox" name={fieldName} value={item.id} className="peer sr-only" />
            <div className="aspect-square w-full cursor-pointer overflow-hidden rounded border border-border bg-black/[.04] transition-colors duration-150 peer-checked:border-foreground">
              {item.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="pointer-events-none absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-foreground text-[10px] text-background peer-checked:flex">
              ✓
            </div>
            <span className="w-full truncate text-center text-[10px] text-muted">{item.label}</span>
          </label>
        ))}
      </div>
      {items.length > FILMSTRIP_VISIBLE_COUNT && (
        <>
          <button
            type="button"
            onClick={() => scrollByPage(-1)}
            aria-label="Show previous"
            className="absolute -left-3 top-[38%] flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-muted shadow-[0_1px_4px_rgba(0,0,0,0.1)] transition-colors duration-150 hover:text-foreground"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => scrollByPage(1)}
            aria-label="Show more"
            className="absolute -right-3 top-[38%] flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-muted shadow-[0_1px_4px_rgba(0,0,0,0.1)] transition-colors duration-150 hover:text-foreground"
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}
