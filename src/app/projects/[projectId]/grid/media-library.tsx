"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import { createMediaFolder, moveMediaToFolder } from "@/lib/actions/grid";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { UndoableCommand } from "@/lib/hooks/use-undo-stack";
import type { MediaFolder, MediaLibraryItem } from "./grid-board";
import { useLibraryItems, type LibraryItemsController } from "./use-library-items";

export function MediaThumbPreview({
  item,
  className = "",
  hideGridBadge = false,
}: {
  item: MediaLibraryItem;
  className?: string;
  hideGridBadge?: boolean;
}) {
  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      {item.url && item.mediaType === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
      )}
      {item.url && item.mediaType === "video" && (
        <video src={item.url} className="h-full w-full object-cover" muted />
      )}
      {item.usedInGrid && !hideGridBadge && (
        <span
          title="Already on the Grid"
          className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-white"
        >
          <GridUsageIcon className="h-2.5 w-2.5" />
        </span>
      )}
      {item.pending && (
        <div
          title="Uploading — not ready to use yet"
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 backdrop-blur-[1px]"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        </div>
      )}
    </div>
  );
}

// Stacked-frames glyph -- distinct from the scheduled-content calendar icon
// (grid-board.tsx/story-card.tsx) so the two badge meanings read differently
// at a glance, same "small bg-black/70 corner chip" visual language.
export function GridUsageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="7" y="7" width="14" height="14" rx="2" />
      <path d="M3 13V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

export function MediaLibrary({
  projectId,
  items,
  folders,
  pushCommand,
  demoMode = false,
  onSelectionChange,
  sharedLibrary,
  wide = false,
  sidebarWidthPx,
}: {
  projectId: string;
  items: MediaLibraryItem[];
  folders: MediaFolder[];
  pushCommand: (command: UndoableCommand) => void;
  // Additive, default false -- the real app is byte-for-byte unaffected.
  // Used to embed this real component on the public landing page: hides
  // every control that fires a real mutating server action (upload, move,
  // delete) against what would otherwise be a fake demo projectId from an
  // anonymous visitor, while leaving folder navigation/hover/selection/drag
  // (all pure local state) fully real and interactive.
  demoMode?: boolean;
  // Additive, optional -- lets a caller (the landing page's Chapter 01)
  // react to a real visitor selecting a thumbnail, so picking an asset can
  // visibly do something elsewhere on the page instead of selection being a
  // dead end. Fires with the current selection every time it changes; no
  // effect on the real app, which doesn't pass this.
  onSelectionChange?: (ids: string[]) => void;
  // Additive, optional -- when provided (Grid's own pairing with
  // MediaPickerDialog; see grid-board.tsx), this component renders that
  // ALREADY-LIVE useLibraryItems() instance instead of the one it creates
  // for itself below, so both surfaces read and write the exact same item
  // data. Omitted (the landing page's Chapter 01 demo, MediaLibrary's only
  // other caller): behavior is unchanged from before this existed -- this
  // component still calls useLibraryItems() itself and is fully self-
  // contained, since that caller has no picker dialog to share with.
  sharedLibrary?: LibraryItemsController;
  // Additive, default false -- the landing page's Chapter 01 demo omits
  // this and renders byte-for-byte the same small square-tile grid it
  // always has. Grid's own resizable sidebar (grid-board.tsx) is the only
  // caller that passes it: 2 columns instead of 3, and a taller,
  // portrait-biased tile height instead of square, so thumbnails are
  // actually big enough to make out faces/composition/text -- see the
  // tile grid's own comment below for why this stays a fixed EXPLICIT
  // pixel height (never CSS `aspect-ratio` derived from content) even
  // though it's now portrait-shaped and width-responsive.
  wide?: boolean;
  // The sidebar's own current (possibly user-resized) width in px --
  // only meaningful alongside `wide`, used to compute a tile height that
  // tracks the resize live (see the tile grid's own comment). Falls back
  // to grid-board.tsx's own LIBRARY_WIDTH_DEFAULT (320) if omitted.
  sidebarWidthPx?: number;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Always called (Rules of Hooks -- a hook can't be called conditionally
  // on a prop), but its result is only USED when sharedLibrary wasn't
  // provided. When it was, this instance's own state simply never receives
  // any events (nothing below calls its setters), so it costs an idle,
  // untouched piece of state and nothing else.
  const ownLibrary = useLibraryItems(projectId, items, pushCommand, demoMode);
  const { effectiveItems, uploadError, uploadBatch, uploadFiles, bulkDeleteItems } = sharedLibrary ?? ownLibrary;

  // null = root view (folder tiles + unfoldered assets). Non-null = browsing
  // one folder's assets, with a "back" affordance to return to root.
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const activeFolder = folders.find((f) => f.id === activeFolderId) ?? null;
  const visibleItems = effectiveItems.filter((item) =>
    activeFolderId ? item.folderId === activeFolderId : !item.folderId,
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    onSelectionChange?.(Array.from(selectedIds));
    // Only meant to fire when the selection itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  const [bulkDeleting, startBulkDelete] = useTransition();
  function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected asset${ids.length === 1 ? "" : "s"}? Any already used in a post or story will be archived (removed from the library, kept in place there) instead of deleted.`)) return;
    setSelectedIds(new Set());
    startBulkDelete(async () => {
      await bulkDeleteItems(ids);
    });
  }

  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [moveError, setMoveError] = useState<string | undefined>();
  const [moving, startMove] = useTransition();
  function handleMoveToNewFolder() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || !newFolderName.trim()) return;
    setMoveError(undefined);
    startMove(async () => {
      const result = await createMediaFolder(projectId, newFolderName);
      if ("message" in result) {
        setMoveError(result.message);
        return;
      }
      await moveMediaToFolder(projectId, ids, result.id);
      setSelectedIds(new Set());
      setNewFolderName("");
      setMoveDialogOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {!demoMode && (
        <form ref={formRef} className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            accept="image/*,video/*"
            multiple
            required
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              // Instant optimistic placeholders (blob-URL thumbnails, kept
              // at their own array position through reconciliation) and the
              // bounded-concurrency upload pipeline itself now live in
              // useLibraryItems -- see its own comments for the full
              // reasoning (unchanged from before this was extracted).
              uploadFiles(files);
            }}
          />
          <Button
            type="button"
            variant="primary"
            radius="none"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadBatch !== null}
            className="w-full py-3 text-xs tracking-wide uppercase"
          >
            {uploadBatch ? `Uploading ${uploadBatch.done} / ${uploadBatch.total}` : "Upload Assets"}
          </Button>
          {uploadError && <p className="text-xs text-error">{uploadError}</p>}
        </form>
      )}

      {activeFolder ? (
        <button
          type="button"
          onClick={() => setActiveFolderId(null)}
          className="flex items-center gap-1 text-xs tracking-wide text-muted uppercase hover:text-foreground"
        >
          ← All Media <span className="text-foreground">/ {activeFolder.name}</span>
        </button>
      ) : null}

      {/* Capped to roughly 9 rows so a project with hundreds of uploads
          doesn't grow the sidebar unboundedly -- scrolls internally for
          anything past that instead. Uncapped in demoMode: the landing
          page's demo library is small and deliberately rendered much wider
          than the real sidebar, where this cap would just crop the hero
          panel oddly.

          --tile-row-h/auto-rows, not each tile's own aspect-square/
          aspect-ratio, is what actually sizes every row here -- same root
          cause and same fix as story-editor.tsx's/post-editor.tsx's own
          "Add from library" grids: an aspect-ratio tile's height is
          DERIVED from its resolved width only after layout, so a burst of
          many tiles landing in the DOM at once (a real batch upload's
          optimistic placeholders, all inserted in a single setState) can
          get measured/painted before that derivation settles, especially
          on WebKit -- confirmed live via Playwright screenshots at 50-item
          batches: every tile collapsed to a thin horizontal strip in
          WebKit, and the below-the-fold tiles did the same in Chromium.
          An explicit, JS-COMPUTED pixel row height has no dependency on
          any child's aspect-ratio or load state at all, so that race
          can't recur regardless of batch size, browser, or (now) sidebar
          width -- `wide` mode's height is still a concrete px number
          applied directly, exactly like the original fixed 83px was, just
          recomputed from the current (possibly user-resized) sidebar
          width instead of being a hardcoded constant. 83px itself was
          measured live against the old fixed lg:w-64 width (82.66px), not
          guessed; the `wide` formula below follows the identical
          per-column-width * 4/3 derivation, just parameterized. */}
      <div
        className={`grid gap-1 auto-rows-[var(--tile-row-h)] ${wide ? "grid-cols-2 gap-2" : "grid-cols-3"} ${demoMode ? "" : "max-h-[620px] overflow-y-auto"}`}
        style={{
          ["--tile-row-h" as string]: wide
            ? `${Math.round((((sidebarWidthPx ?? 320) - 8) / 2) * (4 / 3))}px`
            : "83px",
        }}
      >
        {!activeFolderId &&
          folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setActiveFolderId(folder.id)}
              title={folder.name}
              className="group flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-md p-1.5 text-center transition-colors duration-150 hover:bg-black/[.04]"
            >
              <FolderIcon className="h-6 w-6 shrink-0 text-muted/70 transition-colors duration-150 group-hover:text-foreground" />
              <span className="line-clamp-2 w-full break-words text-[10px] leading-tight text-muted">
                {folder.name}
              </span>
            </button>
          ))}
        {visibleItems.map((item) => (
          <MediaThumb
            key={item.clientKey ?? item.id}
            item={item}
            selected={selectedIds.has(item.id)}
            onToggleSelect={() => toggleSelected(item.id)}
          />
        ))}
        {!demoMode && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Add assets"
            className="flex min-w-0 items-center justify-center rounded-none border border-dashed border-border text-lg text-muted transition-colors duration-150 hover:border-foreground/30"
          >
            +
          </button>
        )}
      </div>

      {!demoMode && selectedIds.size > 0 && (
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 border border-border bg-card px-3 py-2 shadow-[0_2px_10px_rgba(0,0,0,0.1)]">
          <span className="text-xs tracking-wide text-muted uppercase">{selectedIds.size} selected</span>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="secondary"
              radius="none"
              onClick={() => setMoveDialogOpen(true)}
              className="px-2 py-1 text-xs"
            >
              Move to Folder
            </Button>
            <Button
              type="button"
              variant="primary"
              radius="none"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="px-2 py-1 text-xs"
            >
              {bulkDeleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={moveDialogOpen}
        onClose={() => {
          setMoveDialogOpen(false);
          setMoveError(undefined);
        }}
        title="Move to New Folder"
        radius="none"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleMoveToNewFolder();
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs tracking-wide text-muted uppercase">Folder name</span>
            <input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. Q1 Campaign"
              className="rounded-none border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
          </label>
          {moveError && <p className="text-xs text-error">{moveError}</p>}
          <Button
            type="submit"
            variant="primary"
            radius="none"
            disabled={moving || !newFolderName.trim()}
            className="w-full py-2.5 text-xs tracking-wide uppercase"
          >
            {moving ? "Moving…" : `Create & Move ${selectedIds.size} Asset${selectedIds.size === 1 ? "" : "s"}`}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" strokeLinejoin="round" />
    </svg>
  );
}

function MediaThumb({
  item,
  selected,
  onToggleSelect,
}: {
  item: MediaLibraryItem;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `media-${item.id}`,
    data: { mediaAssetId: item.id, item },
    // Still uploading -- not a real, persisted asset yet, so it can't be
    // dropped onto a Grid slot (assignMediaToSlot needs a real
    // media_assets row to reference). dnd-kit never starts a drag at all
    // when disabled, so there's no drop event to separately guard.
    disabled: item.pending,
  });

  return (
    <div
      className={`group relative min-w-0 touch-none overflow-hidden border border-border transition-[opacity,border-color] duration-150 ${
        isDragging ? "cursor-grabbing opacity-30" : item.pending ? "cursor-default" : "cursor-grab hover:border-foreground/30"
      }`}
    >
      <div ref={setNodeRef} {...listeners} {...attributes} className="absolute inset-0">
        <MediaThumbPreview item={item} hideGridBadge />
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        disabled={item.pending}
        title={item.pending ? "Uploading…" : selected ? "Deselect" : "Select"}
        // pointer-coarse: touch has no hover state to reveal this with, so
        // it's always shown there (matching the picker dialog's own
        // always-visible delete button, which already handles this same
        // case) -- desktop keeps the existing hover-only reveal unchanged.
        className={`absolute left-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full transition-opacity duration-150 group-hover:opacity-100 pointer-coarse:opacity-100 disabled:pointer-events-none ${
          selected ? "opacity-100" : "opacity-0"
        }`}
      >
        {selected ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" className="fill-accent" stroke="white" strokeWidth="1" />
            <path d="M4.8 8.2 6.8 10.1 11.2 5.7" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" className="fill-black/30" stroke="white" strokeWidth="1.2" />
          </svg>
        )}
      </button>
      {item.usedInGrid && (
        <span
          title="Already on the Grid"
          className="pointer-events-none absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-white"
        >
          <GridUsageIcon className="h-2.5 w-2.5" />
        </span>
      )}
    </div>
  );
}
