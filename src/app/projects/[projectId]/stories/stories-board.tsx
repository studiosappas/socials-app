"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  bulkDeleteStories,
  bulkMoveStoriesToFolder,
  createContentFolder,
  createStory,
  deleteContentFolder,
  renameContentFolder,
  uploadContentAsset,
} from "@/lib/actions/stories";
import { createShareLink } from "@/lib/actions/share-links";
import { uploadFilesWithPosters } from "@/lib/video-poster";
import { StoryCard } from "./story-card";
import { ShareMenuButton } from "../share-menu";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Toast } from "@/components/ui/toast";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import type { ShareLinkItem } from "@/lib/data/share-links";
import type { StoryStatus } from "@/types/database";

export type StoryFileItem = { url: string; mediaType: "image" | "video" };

export type StoryListItem = {
  id: string;
  name: string;
  scheduledDate: string | null;
  notes: string;
  status: StoryStatus;
  thumbnailUrl: string | null;
  files: StoryFileItem[];
  folderId: string | null;
};

export type ContentFolderItem = { id: string; name: string; coverUrl: string | null };

const COLLAPSED_COUNT = 6;

export function StoriesBoard({
  projectId,
  stories,
  folders,
  canManage,
  shareLinks,
  shareTableMissing,
}: {
  projectId: string;
  stories: StoryListItem[];
  folders: ContentFolderItem[];
  canManage: boolean;
  shareLinks: ShareLinkItem[];
  shareTableMissing: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | undefined>();
  const [creatingFolder, startCreatingFolder] = useTransition();
  const [, startFolderAction] = useTransition();

  // Share for Review: selecting stories happens inline on the board itself
  // (same multi-select-circle pattern as Media Library/Grid) instead of in
  // a separate picker dialog.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedStoryIds, setSelectedStoryIds] = useState<Set<string>>(new Set());
  const [sharing, startSharing] = useTransition();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // useCallback (stable, empty deps) so StoryCard's React.memo below
  // actually takes effect for every card instead of re-rendering all of
  // them whenever StoriesBoard re-renders for an unrelated reason.
  const handleToggleSelect = useCallback((storyId: string) => {
    setSelectedStoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(storyId)) next.delete(storyId);
      else next.add(storyId);
      return next;
    });
  }, []);

  function handleCancelSelection() {
    setSelectionMode(false);
    setSelectedStoryIds(new Set());
  }

  // Bulk Move/Delete: an always-available corner circle per card (see
  // StoryCard's bulkSelected/onToggleBulkSelect), same Grid Media Library
  // pattern -- no explicit "enter selection mode" step, the bottom bar just
  // appears once anything is checked. Kept as its own Set/handlers rather
  // than reusing selectionMode's above, since that one is the full-tile
  // Share-for-Review picker and the two are mutually exclusive in the UI.
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoveDialogOpen, setBulkMoveDialogOpen] = useState(false);
  const [, startBulkAction] = useTransition();

  const handleToggleBulkSelect = useCallback((storyId: string) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(storyId)) next.delete(storyId);
      else next.add(storyId);
      return next;
    });
  }, []);

  function handleCancelBulkSelection() {
    setBulkSelectedIds(new Set());
    setBulkMoveDialogOpen(false);
  }

  function handleBulkDelete() {
    const ids = Array.from(bulkSelectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} item${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    startBulkAction(async () => {
      await bulkDeleteStories(projectId, ids);
      handleCancelBulkSelection();
      router.refresh();
    });
  }

  function handleBulkMove(folderId: string | null) {
    const ids = Array.from(bulkSelectedIds);
    if (ids.length === 0) return;
    startBulkAction(async () => {
      await bulkMoveStoriesToFolder(projectId, ids, folderId);
      handleCancelBulkSelection();
      router.refresh();
    });
  }

  function handleShareForReview() {
    const ids = Array.from(selectedStoryIds);
    if (ids.length === 0) return;
    startSharing(async () => {
      const formData = new FormData();
      for (const id of ids) formData.append("story_ids", id);
      const result = await createShareLink(projectId, undefined, formData);
      if (result?.success && result.token) {
        const url = `${window.location.origin}/preview/${result.token}`;
        await navigator.clipboard.writeText(url);
        setToastMessage("Review link copied to clipboard");
        setTimeout(() => setToastMessage(null), 2500);
        handleCancelSelection();
      } else {
        setToastMessage(result?.message ?? "Couldn't create the review link.");
        setTimeout(() => setToastMessage(null), 3000);
      }
    });
  }

  function handleCreateFolder() {
    setFolderError(undefined);
    startCreatingFolder(async () => {
      const result = await createContentFolder(projectId, newFolderName);
      if ("message" in result) {
        setFolderError(result.message);
        return;
      }
      setNewFolderName("");
      setFolderDialogOpen(false);
      router.refresh();
    });
  }

  function handleRenameFolder(folderId: string, name: string) {
    startFolderAction(async () => {
      await renameContentFolder(projectId, folderId, name);
      router.refresh();
    });
  }

  function handleDeleteFolder(folderId: string, name: string) {
    if (!confirm(`Delete "${name}"? Its content will move to Unfiled -- nothing is deleted.`)) return;
    if (activeFolderId === folderId) setActiveFolderId(null);
    startFolderAction(async () => {
      await deleteContentFolder(projectId, folderId);
      router.refresh();
    });
  }

  const countByFolder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of stories) {
      if (!s.folderId) continue;
      counts.set(s.folderId, (counts.get(s.folderId) ?? 0) + 1);
    }
    return counts;
  }, [stories]);

  const activeFolder = activeFolderId ? folders.find((f) => f.id === activeFolderId) ?? null : null;

  // Client-side filter -- matches against name, notes, and the scheduled
  // date, so "type to search" finds an item by any of the three without a
  // server round-trip per keystroke. Scoped to the current folder (or
  // Unfiled at root) first, same as Grid Media Library's folder scoping.
  const scoped = useMemo(
    () => stories.filter((s) => (activeFolderId ? s.folderId === activeFolderId : !s.folderId)),
    [stories, activeFolderId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.notes.toLowerCase().includes(q) ||
        (s.scheduledDate ?? "").toLowerCase().includes(q),
    );
  }, [scoped, query]);

  const isSearching = query.trim().length > 0;
  const visible = isSearching || showAll ? filtered : filtered.slice(0, COLLAPSED_COUNT);
  const hasMore = !isSearching && !showAll && filtered.length > COLLAPSED_COUNT;

  const sectionLabel = activeFolder ? "Content" : folders.length > 0 ? "Unfiled" : "Recent Content";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <span className="shrink-0 text-xs tracking-wide text-muted uppercase">{sectionLabel}</span>
        <div className="hidden flex-1 items-center justify-center gap-10 text-border sm:flex">
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className="h-1 w-1 shrink-0 rounded-full bg-current" />
          ))}
        </div>
        <label className="flex w-full items-center gap-2 rounded-full border border-border px-3 py-1.5 transition-colors duration-150 focus-within:border-foreground sm:w-64 sm:shrink-0">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to search"
            className="w-full bg-transparent text-sm focus:outline-none"
          />
          <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
        </label>
        {/* Same top-right icon pairing as Grid's own "Add New Post" row
            (grid-board.tsx) -- share + "+" as compact icon buttons, not a
            full-width text button, so the two content boards read the same. */}
        <div className="flex shrink-0 items-center gap-1">
          {stories.length > 0 && (
            <ShareMenuButton
              projectId={projectId}
              links={shareLinks}
              canManage={canManage}
              tableMissing={shareTableMissing}
              onEnterSelectionMode={() => {
                handleCancelBulkSelection();
                setSelectionMode(true);
              }}
            />
          )}
          {canManage && (
            <form action={createStory.bind(null, projectId, activeFolderId)}>
              <button
                type="submit"
                title="Add New Content"
                className="rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
              >
                <PlusIcon />
              </button>
            </form>
          )}
        </div>
      </div>

      {!activeFolder && (folders.length > 0 || canManage) && (
        <div className="flex flex-col gap-2">
          <span className="text-xs tracking-wide text-muted uppercase">Folders</span>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {folders.map((folder) => (
              <FolderTile
                key={folder.id}
                folder={folder}
                count={countByFolder.get(folder.id) ?? 0}
                canManage={canManage}
                onOpen={() => setActiveFolderId(folder.id)}
                onRename={(name) => handleRenameFolder(folder.id, name)}
                onDelete={() => handleDeleteFolder(folder.id, folder.name)}
              />
            ))}
            {canManage && (
              <button
                type="button"
                onClick={() => setFolderDialogOpen(true)}
                title="New Folder"
                className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-muted transition-colors duration-150 hover:border-foreground/30 hover:text-foreground"
              >
                <PlusIcon />
                <span className="text-xs tracking-wide uppercase">New Folder</span>
              </button>
            )}
          </div>
        </div>
      )}

      {activeFolder && (
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setActiveFolderId(null)}
            className="text-xs font-semibold uppercase tracking-wide text-muted transition-colors duration-150 hover:text-foreground"
          >
            ← All Content
          </button>
          <span className="text-border">/</span>
          <span className="font-semibold">{activeFolder.name}</span>
        </div>
      )}

      <UploadAssetsZone
        projectId={projectId}
        folderId={activeFolderId}
        canManage={canManage}
        onUploaded={() => router.refresh()}
      >
        {visible.map((story) => (
          <StoryCard
            key={story.id}
            projectId={projectId}
            storyId={story.id}
            name={story.name}
            thumbnailUrl={story.thumbnailUrl}
            files={story.files}
            scheduledDate={story.scheduledDate}
            canManage={canManage}
            selectionMode={selectionMode}
            selected={selectedStoryIds.has(story.id)}
            onToggleSelect={handleToggleSelect}
            bulkSelected={bulkSelectedIds.has(story.id)}
            onToggleBulkSelect={handleToggleBulkSelect}
            folders={folders}
            currentFolderId={story.folderId}
          />
        ))}
        {hasMore && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            title="View all content"
            className="flex aspect-[3/4] w-full shrink-0 items-center justify-center rounded-2xl border border-dashed border-border text-muted transition-colors duration-150 hover:border-foreground/30 hover:text-foreground"
          >
            <FolderIcon className="h-6 w-6" />
          </button>
        )}
      </UploadAssetsZone>

      {filtered.length === 0 && (
        <p className="text-sm text-muted">
          {isSearching ? "No content matches your search." : "No content yet — create one below."}
        </p>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-fit text-xs font-semibold uppercase tracking-wide transition-colors duration-150 hover:text-muted"
        >
          View More +
        </button>
      )}

      {selectionMode && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-center gap-3 border-t border-border bg-background px-4 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          <span className="text-xs tracking-wide text-muted uppercase">{selectedStoryIds.size} selected</span>
          <Button type="button" variant="secondary" radius="none" onClick={handleCancelSelection}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            radius="none"
            onClick={handleShareForReview}
            disabled={selectedStoryIds.size === 0 || sharing}
          >
            {sharing ? "Sharing…" : "Share for Review"}
          </Button>
        </div>
      )}

      {bulkSelectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center justify-center gap-3 border-t border-border bg-background px-4 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          <span className="text-xs tracking-wide text-muted uppercase">{bulkSelectedIds.size} selected</span>
          <Button type="button" variant="secondary" radius="none" onClick={handleCancelBulkSelection}>
            Cancel
          </Button>
          {folders.length > 0 && (
            <Button type="button" variant="secondary" radius="none" onClick={() => setBulkMoveDialogOpen(true)}>
              Move to Folder
            </Button>
          )}
          <Button type="button" variant="primary" radius="none" onClick={handleBulkDelete}>
            Delete
          </Button>
        </div>
      )}
      <Toast message={toastMessage} />

      <Dialog
        open={folderDialogOpen}
        onClose={() => {
          setFolderDialogOpen(false);
          setFolderError(undefined);
        }}
        title="New Folder"
        radius="none"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreateFolder();
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
              placeholder="e.g. Newsletters"
              className="rounded-none border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
          </label>
          {folderError && <p className="text-xs text-error">{folderError}</p>}
          <Button
            type="submit"
            variant="primary"
            radius="none"
            disabled={creatingFolder || !newFolderName.trim()}
            className="w-full py-2.5 text-xs tracking-wide uppercase"
          >
            {creatingFolder ? "Creating…" : "Create Folder"}
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={bulkMoveDialogOpen}
        onClose={() => setBulkMoveDialogOpen(false)}
        title={`Move ${bulkSelectedIds.size} Item${bulkSelectedIds.size === 1 ? "" : "s"}`}
        radius="none"
      >
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              setBulkMoveDialogOpen(false);
              handleBulkMove(null);
            }}
            className="rounded px-2 py-2 text-left text-sm transition-colors duration-150 hover:bg-black/[.05]"
          >
            Unfiled
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setBulkMoveDialogOpen(false);
                handleBulkMove(f.id);
              }}
              className="truncate rounded px-2 py-2 text-left text-sm transition-colors duration-150 hover:bg-black/[.05]"
            >
              {f.name}
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

// The "+" tile inside the item editor adds frames to ONE existing item.
// This is the other half: a Drive-style bulk drop scoped to the current
// folder (or Unfiled, at root) where every file becomes its own independent
// item. It wraps the whole grid as a drop target (drop anywhere among the
// cards, not just on the tile) and also exposes a click-to-browse tile as
// the first grid cell, matching the folder view's "New Folder" affordance.
function UploadAssetsZone({
  projectId,
  folderId,
  canManage,
  onUploaded,
  children,
}: {
  projectId: string;
  folderId: string | null;
  canManage: boolean;
  onUploaded: () => void;
  children: React.ReactNode;
}) {
  const [state, action, pending] = useActionState(
    uploadContentAsset.bind(null, projectId, folderId),
    undefined,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragDepth = useRef(0);
  // Surfaces a too-large/direct-upload-failed file before the Server Action
  // ever runs (uploadFilesWithPosters rejects it client-side).
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.success) onUploaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
    );
    setUploadError(null);
    if (files.length > 0) {
      uploadFilesWithPosters(projectId, action, files, (_name, message) => setUploadError(message));
    }
  }

  if (!canManage) {
    return <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
  }

  return (
    <div
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
      }}
      onDragEnter={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        dragDepth.current += 1;
        setIsDraggingOver(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setIsDraggingOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setIsDraggingOver(false);
        if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
      }}
      className={`grid grid-cols-2 gap-4 rounded-2xl p-1 -m-1 transition-colors duration-150 sm:grid-cols-3 lg:grid-cols-4 ${
        isDraggingOver ? "outline outline-2 outline-dashed outline-foreground/50" : ""
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          e.target.value = "";
          if (files) handleFiles(files);
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={pending}
        title="Upload assets — each file becomes its own content item"
        className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border text-muted transition-colors duration-150 hover:border-foreground/30 hover:bg-black/[.03] disabled:opacity-60"
      >
        <UploadIcon className="h-5 w-5" />
        <span className="px-2 text-center text-[10px] tracking-wide uppercase">
          {pending ? "Uploading…" : "Drop or Upload"}
        </span>
      </button>
      {children}
      {(uploadError || state?.message) && (
        <p className="col-span-full text-xs text-error">{uploadError || state?.message}</p>
      )}
    </div>
  );
}

// Same aspect-[4/5] rounded-2xl cover-card look as Assets' AssetCard
// (asset-board.tsx) -- cover fills the tile, name/count sit in a footer
// below it, and a circular backdrop-blur ⋮ button floats top-right. The one
// real difference: there's no external link or manual cover upload here --
// the cover is always auto-derived (this folder's first item's thumbnail,
// computed server-side in page.tsx) and clicking the tile opens the folder
// in place instead of navigating away.
function FolderTile({
  folder,
  count,
  canManage,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: ContentFolderItem;
  count: number;
  canManage: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

  return (
    <div className="group relative aspect-[4/5] w-full">
      <button
        type="button"
        onClick={onOpen}
        title={`Open "${folder.name}"`}
        className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-black/[.02] text-left transition-colors duration-150 hover:border-foreground/30"
      >
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {folder.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={folder.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <FolderIcon className="h-8 w-8 text-muted/60" />
            </div>
          )}
          <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[9px] tracking-wide text-white uppercase">
            {count} item{count === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex shrink-0 items-center px-3 py-2">
          {renaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => setRenaming(false)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                setRenaming(false);
                if (renameValue.trim() && renameValue.trim() !== folder.name) onRename(renameValue.trim());
              }}
              className="w-full truncate bg-transparent text-xs font-medium text-foreground outline-none"
            />
          ) : (
            <span className="truncate text-xs font-medium text-foreground">{folder.name}</span>
          )}
        </div>
      </button>

      {canManage && (
        <div ref={menuRef} className="absolute right-2 top-2 z-10">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title="Folder options"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-sm text-white shadow-[0_1px_4px_rgba(0,0,0,0.25)] backdrop-blur-sm transition-colors duration-150 hover:bg-black/65"
          >
            ⋮
          </button>
          {menuOpen && (
            <div
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="absolute right-0 top-8 w-36 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-background p-1 shadow-lg"
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setRenameValue(folder.name);
                  setRenaming(true);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05]"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M12 16V4M12 4 7.5 8.5M12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Matches Grid's own PlusIcon exactly (grid-board.tsx) -- same "Add New
// Post"/"Add New Story" icon-button pairing next to the share icon.
function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 2.5V12.5M2.5 7.5H12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
