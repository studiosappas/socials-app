"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import {
  bulkDeleteMedia,
  createMediaFolder,
  deleteMedia,
  moveMediaToFolder,
  restoreMediaAsset,
  uploadMedia,
} from "@/lib/actions/grid";
import { uploadFilesWithPosters } from "@/lib/video-poster";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { UndoableCommand } from "@/lib/hooks/use-undo-stack";
import type { MediaFolder, MediaLibraryItem } from "./grid-board";

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
        <img src={item.url} alt="" className="h-full w-full object-cover" draggable={false} />
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
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    uploadMedia.bind(null, projectId),
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // null = root view (folder tiles + unfoldered assets). Non-null = browsing
  // one folder's assets, with a "back" affordance to return to root.
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const activeFolder = folders.find((f) => f.id === activeFolderId) ?? null;
  const visibleItems = items.filter((item) =>
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

  const [bulkDeleting, startBulkDelete] = useTransition();
  function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected asset${ids.length === 1 ? "" : "s"}? This removes ${ids.length === 1 ? "it" : "them"} from any post or story using ${ids.length === 1 ? "it" : "them"}.`)) return;
    startBulkDelete(async () => {
      await bulkDeleteMedia(projectId, ids);
      setSelectedIds(new Set());
      router.refresh();
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

  // Undo/redo of add/delete both round-trip through server actions that
  // change `items` (a new row appears/disappears once revalidatePath lands),
  // so this diff is what turns a spontaneous upload into an undoable "Add
  // media" command -- there's no other signal available client-side, since
  // uploadMedia's action state only ever returns an error message, never the
  // created row's id. suppressAutoTrackRef opts a command-driven items
  // change (an undo restoring a deleted asset, or a redo re-uploading one)
  // out of ALSO being auto-detected here, which would otherwise double it up
  // as a second, redundant "Add media" entry on top of the command already
  // being replayed.
  const prevItemIdsRef = useRef(new Set(items.map((i) => i.id)));
  const suppressAutoTrackRef = useRef(false);
  useEffect(() => {
    if (demoMode) return;
    const prevIds = prevItemIdsRef.current;
    const newItems = items.filter((item) => !prevIds.has(item.id));
    prevItemIdsRef.current = new Set(items.map((i) => i.id));

    if (!suppressAutoTrackRef.current) {
      for (const item of newItems) {
        if (!item.storagePath) continue;
        const storagePath = item.storagePath;
        const posterStoragePath = item.posterStoragePath ?? null;
        // A mutable holder, not a captured constant -- each undo/redo cycle
        // after the first restores the asset under a brand-new id (the
        // original row is gone for good once deleted), so both directions
        // need to read/write whatever the CURRENT id is, not the one this
        // command was created with.
        const current = { id: item.id };
        pushCommand({
          label: "Add media",
          undo: async () => {
            suppressAutoTrackRef.current = true;
            await deleteMedia(projectId, current.id);
            router.refresh();
          },
          redo: async () => {
            suppressAutoTrackRef.current = true;
            const result = await restoreMediaAsset(projectId, {
              storagePath,
              mediaType: item.mediaType,
              posterStoragePath,
            });
            if ("message" in result) throw new Error(result.message);
            current.id = result.id;
            router.refresh();
          },
        });
      }
    }
    suppressAutoTrackRef.current = false;
    // Only ever meant to react to `items` itself changing -- projectId is
    // static per-mount and pushCommand/router are stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  return (
    <div className="flex flex-col gap-3">
      {!demoMode && (
        <form ref={formRef} action={action} className="flex flex-col gap-2" key={items.length}>
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
              if (files.length > 0) uploadFilesWithPosters(action, files);
            }}
          />
          <Button
            type="button"
            variant="primary"
            radius="none"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending}
            className="w-full py-3 text-xs tracking-wide uppercase"
          >
            {pending ? "Uploading..." : "Upload Assets"}
          </Button>
          {state?.message && <p className="text-xs text-error">{state.message}</p>}
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

      {/* Capped to roughly 9 rows (grid-cols-3, ~82px square cells at this
          sidebar's w-64 width, plus gaps) so a project with hundreds of
          uploads doesn't grow the sidebar unboundedly -- scrolls internally
          for anything past that instead. Uncapped in demoMode: the landing
          page's demo library is small and deliberately rendered much wider
          than the real sidebar, where this cap would just crop the hero
          panel oddly. */}
      <div className={`grid grid-cols-3 gap-1 ${demoMode ? "" : "max-h-[620px] overflow-y-auto"}`}>
        {!activeFolderId &&
          folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setActiveFolderId(folder.id)}
              title={folder.name}
              className="group flex aspect-square min-w-0 flex-col items-center justify-center gap-1.5 rounded-md p-1.5 text-center transition-colors duration-150 hover:bg-black/[.04]"
            >
              <FolderIcon className="h-6 w-6 shrink-0 text-muted/70 transition-colors duration-150 group-hover:text-foreground" />
              <span className="line-clamp-2 w-full break-words text-[10px] leading-tight text-muted">
                {folder.name}
              </span>
            </button>
          ))}
        {visibleItems.map((item) => (
          <MediaThumb
            key={item.id}
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
            className="flex aspect-square min-w-0 items-center justify-center rounded-none border border-dashed border-border text-lg text-muted transition-colors duration-150 hover:border-foreground/30"
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
  });

  return (
    <div
      className={`group relative aspect-square min-w-0 touch-none overflow-hidden border border-border transition-[opacity,border-color] duration-150 ${
        isDragging ? "cursor-grabbing opacity-30" : "cursor-grab hover:border-foreground/30"
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
        title={selected ? "Deselect" : "Select"}
        // pointer-coarse: touch has no hover state to reveal this with, so
        // it's always shown there (matching the picker dialog's own
        // always-visible delete button, which already handles this same
        // case) -- desktop keeps the existing hover-only reveal unchanged.
        className={`absolute left-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full transition-opacity duration-150 group-hover:opacity-100 pointer-coarse:opacity-100 ${
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
