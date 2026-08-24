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
  type ActionResult,
} from "@/lib/actions/stories";
import { createShareLink } from "@/lib/actions/share-links";
import { uploadFilesWithPosters } from "@/lib/video-poster";
import { StoryCard } from "./story-card";
import { ShareMenuButton } from "../share-menu";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Toast } from "@/components/ui/toast";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { useIsTouchDevice } from "@/lib/hooks/use-is-touch-device";
import { useOptimisticOverride } from "@/lib/hooks/use-optimistic-override";
import type { ShareLinkItem } from "@/lib/data/share-links";
import type { StoryStatus, MediaType } from "@/types/database";

export type StoryFileItem = { url: string; mediaType: MediaType };

export type StoryListItem = {
  id: string;
  name: string;
  scheduledDate: string | null;
  // stories.created_at -- authoritative for both sort and the month
  // filter (see StoriesBoard below). A loose asset and a cluster are both
  // plain `stories` rows, so this is the one date source for either.
  createdDate: string;
  notes: string;
  status: StoryStatus;
  thumbnailUrl: string | null;
  // Null only when there are no files at all -- otherwise the first/cover
  // file's own media type, even when thumbnailUrl itself is null (a
  // video/PDF whose poster generation failed or predates it -- see
  // StoryCard's typed-placeholder fallback).
  coverMediaType: MediaType | null;
  files: StoryFileItem[];
  folderId: string | null;
};

export type ContentFolderItem = { id: string; name: string; coverUrl: string | null };

const COLLAPSED_COUNT = 6;

type SortOrder = "newest" | "oldest";

// "YYYY-MM" derived straight from createdDate's own ISO string -- no Date
// parsing/timezone conversion needed just to bucket by month, and it sorts
// correctly as a plain string (lexicographic order matches chronological
// order for this format).
function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

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
  const isTouchDevice = useIsTouchDevice();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  // Client-side only, reset on reload -- same "no persistence" convention
  // as `query`/`showAll` above, no server round-trip or saved-preference
  // column needed for either control.
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

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

  // Bulk Move/Delete: explicit "Select" entry (Share/export menu's own
  // "Select Items" item, same corner circle spot as Share's own
  // selectionMode above) -- no circle shows on any card until this is
  // true. Kept as its own boolean/Set/handlers rather than reusing
  // selectionMode above, since that one is the full-tile Share-for-Review
  // picker and the two are mutually exclusive in the UI.
  const [bulkSelectionMode, setBulkSelectionMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoveDialogOpen, setBulkMoveDialogOpen] = useState(false);
  const [, startBulkAction] = useTransition();

  // Optimistic hide for bulk delete/move and folder delete -- an id that's
  // genuinely gone from a fresh `stories`/`folders` prop is a harmless
  // no-op to keep hidden, so no reset-on-prop-change guard is needed (same
  // reasoning as Brief's hiddenTaskIds/hiddenItemIds/hiddenFrameIds).
  const [hiddenStoryIds, setHiddenStoryIds] = useState<Set<string>>(new Set());
  const [hiddenFolderIds, setHiddenFolderIds] = useState<Set<string>>(new Set());
  const unhideStories = useCallback((ids: string[]) => {
    setHiddenStoryIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);
  const unhideFolder = useCallback((id: string) => {
    setHiddenFolderIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleToggleBulkSelect = useCallback((storyId: string) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(storyId)) next.delete(storyId);
      else next.add(storyId);
      return next;
    });
  }, []);

  function handleCancelBulkSelection() {
    setBulkSelectionMode(false);
    setBulkSelectedIds(new Set());
    setBulkMoveDialogOpen(false);
  }

  function handleBulkDelete() {
    const ids = Array.from(bulkSelectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} item${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    setHiddenStoryIds((prev) => new Set([...prev, ...ids]));
    handleCancelBulkSelection();
    startBulkAction(async () => {
      const result = await bulkDeleteStories(projectId, ids);
      if (!result.success) {
        unhideStories(ids);
        setToastMessage(result.message ?? "Couldn't delete those items.");
        setTimeout(() => setToastMessage(null), 3000);
      }
    });
  }

  function handleBulkMove(folderId: string | null) {
    const ids = Array.from(bulkSelectedIds);
    if (ids.length === 0) return;
    // Moving out of the currently-viewed folder (or Unfiled) makes these
    // cards disappear from the current view -- moving them further into a
    // folder the user isn't currently looking at has no other visible
    // effect to show optimistically.
    setHiddenStoryIds((prev) => new Set([...prev, ...ids]));
    handleCancelBulkSelection();
    startBulkAction(async () => {
      const result = await bulkMoveStoriesToFolder(projectId, ids, folderId);
      if (!result.success) {
        unhideStories(ids);
        setToastMessage(result.message ?? "Couldn't move those items.");
        setTimeout(() => setToastMessage(null), 3000);
      } else {
        router.refresh();
      }
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

  // Returns the result (rather than fire-and-forget) so FolderTile can show
  // the new name optimistically and revert it locally if the save fails.
  async function handleRenameFolder(folderId: string, name: string) {
    const result = await renameContentFolder(projectId, folderId, name);
    if (result.success) router.refresh();
    return result;
  }

  function handleDeleteFolder(folderId: string, name: string) {
    if (!confirm(`Delete "${name}"? Its content will move to Unfiled -- nothing is deleted.`)) return;
    if (activeFolderId === folderId) setActiveFolderId(null);
    setHiddenFolderIds((prev) => new Set(prev).add(folderId));
    startFolderAction(async () => {
      const result = await deleteContentFolder(projectId, folderId);
      if (!result.success) {
        unhideFolder(folderId);
        setToastMessage(result.message ?? "Couldn't delete that folder.");
        setTimeout(() => setToastMessage(null), 3000);
        return;
      }
      // Its content falls back to Unfiled server-side -- a real refresh is
      // still needed so those stories' folderId (in the stale `stories`
      // prop) catches up, same reasoning as handleBulkMove above.
      router.refresh();
    });
  }

  const countByFolder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of stories) {
      if (!s.folderId || hiddenStoryIds.has(s.id)) continue;
      counts.set(s.folderId, (counts.get(s.folderId) ?? 0) + 1);
    }
    return counts;
  }, [stories, hiddenStoryIds]);

  const visibleFolders = useMemo(
    () => (hiddenFolderIds.size === 0 ? folders : folders.filter((f) => !hiddenFolderIds.has(f.id))),
    [folders, hiddenFolderIds],
  );

  const activeFolder = activeFolderId ? visibleFolders.find((f) => f.id === activeFolderId) ?? null : null;

  // Client-side filter -- matches against name, notes, and the scheduled
  // date, so "type to search" finds an item by any of the three without a
  // server round-trip per keystroke. Scoped to the current folder (or
  // Unfiled at root) first, same as Grid Media Library's folder scoping.
  const scoped = useMemo(
    () =>
      stories.filter(
        (s) => !hiddenStoryIds.has(s.id) && (activeFolderId ? s.folderId === activeFolderId : !s.folderId),
      ),
    [stories, activeFolderId, hiddenStoryIds],
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

  // Derived from `scoped` (folder-scoped, pre-search) rather than `filtered`
  // -- the month picker's own OPTIONS shouldn't shrink/reorder as someone
  // types a search query, only which stories currently match should change.
  const availableMonths = useMemo(() => {
    const keys = new Set(scoped.map((s) => monthKey(s.createdDate)));
    return Array.from(keys).sort((a, b) => b.localeCompare(a));
  }, [scoped]);

  // Resets to "All" if the currently-selected month no longer has any
  // content in it (its last item moved/got deleted) -- adjusted during
  // render (React's own documented pattern), not an effect, since nothing
  // external needs synchronizing.
  const [prevAvailableMonths, setPrevAvailableMonths] = useState(availableMonths);
  if (availableMonths !== prevAvailableMonths) {
    setPrevAvailableMonths(availableMonths);
    if (monthFilter !== "all" && !availableMonths.includes(monthFilter)) setMonthFilter("all");
  }

  const monthFilteredResults = useMemo(() => {
    if (monthFilter === "all") return filtered;
    return filtered.filter((s) => monthKey(s.createdDate) === monthFilter);
  }, [filtered, monthFilter]);

  const sorted = useMemo(() => {
    const copy = [...monthFilteredResults];
    copy.sort((a, b) =>
      sortOrder === "newest" ? b.createdDate.localeCompare(a.createdDate) : a.createdDate.localeCompare(b.createdDate),
    );
    return copy;
  }, [monthFilteredResults, sortOrder]);

  const isSearching = query.trim().length > 0;
  // A deliberately narrowed-down view (a search, or a specific month picked)
  // shows everything that matches rather than truncating to the usual
  // collapsed preview -- same reasoning search already used alone.
  const isFiltering = isSearching || monthFilter !== "all";
  const visible = isFiltering || showAll ? sorted : sorted.slice(0, COLLAPSED_COUNT);
  const hasMore = !isFiltering && !showAll && sorted.length > COLLAPSED_COUNT;

  const sectionLabel = activeFolder ? "Content" : visibleFolders.length > 0 ? "Unfiled" : "Recent Content";

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
            full-width text button, so the two content boards read the same.
            justify-end: on mobile this row is a full-width flex item of the
            parent's flex-col stack (unlike Grid's own row, which is always
            a single flex-row with justify-between doing this for free), so
            its own children default-align to the row's LEFT edge instead of
            the right -- which put ShareMenuButton's trigger near x≈32 on a
            narrow phone instead of the right edge, and since its dropdown
            panel is right-0-anchored TO THAT TRIGGER (not the viewport), the
            224px-wide panel rendered almost entirely off-screen to the left,
            making every item in it (Share for Review/Select Items/Manage
            Review Links) untappable on mobile. justify-end is a no-op on
            desktop (sm:flex-row): there this div is already only as wide as
            its own content, so redistributing space along its main axis has
            nothing to do. */}
        <div className="flex shrink-0 items-center justify-end gap-1">
          {/* Touch-only, same isTouchDevice gate and Edit Grid/Done shape as
              Grid's own reorder-mode toggle (grid-board.tsx) -- a directly
              visible button, not a menu item a touch user has to already
              suspect exists behind the Share icon before finding it. The
              "Select Items" item inside ShareMenuButton's dropdown below is
              left in place (desktop mouse users already know to look there,
              and it's a second path into the exact same bulkSelectionMode,
              never a second selection system) -- this button is purely an
              additional, more discoverable entry point for touch. */}
          {isTouchDevice && canManage && stories.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (bulkSelectionMode) {
                  handleCancelBulkSelection();
                } else {
                  handleCancelSelection();
                  setBulkSelectionMode(true);
                }
              }}
              className={`rounded-full border px-3 py-1.5 text-xs tracking-wide uppercase transition-colors duration-150 ${
                bulkSelectionMode
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-foreground hover:border-foreground/40"
              }`}
            >
              {bulkSelectionMode ? "Done" : "Select"}
            </button>
          )}
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
              onEnterBulkSelectionMode={
                canManage
                  ? () => {
                      handleCancelSelection();
                      setBulkSelectionMode(true);
                    }
                  : undefined
              }
            />
          )}
          {/* Last in this cluster, not first -- its panel anchors via
              right-0 (same as ShareMenuButton's own), and on the narrowest
              phones (this row wraps onto its own short line there) an
              icon sitting at the LEFT end of that line pulls a right-
              anchored panel's left edge past the viewport edge. Putting it
              last keeps it close to the row's own right edge, where
              right-0 anchoring already behaves safely -- confirmed at
              320px, where the earlier left-positioned version visibly
              clipped. */}
          {stories.length > 0 && (
            <SortFilterMenu
              sortOrder={sortOrder}
              onSortOrderChange={setSortOrder}
              monthFilter={monthFilter}
              onMonthFilterChange={setMonthFilter}
              availableMonths={availableMonths}
              open={sortMenuOpen}
              onOpenChange={setSortMenuOpen}
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

      {!activeFolder && (visibleFolders.length > 0 || canManage) && (
        <div className="flex flex-col gap-2">
          <span className="text-xs tracking-wide text-muted uppercase">Folders</span>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visibleFolders.map((folder) => (
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
            coverMediaType={story.coverMediaType}
            files={story.files}
            scheduledDate={story.scheduledDate}
            canManage={canManage}
            selectionMode={selectionMode}
            selected={selectedStoryIds.has(story.id)}
            onToggleSelect={handleToggleSelect}
            bulkSelectionMode={bulkSelectionMode}
            bulkSelected={bulkSelectedIds.has(story.id)}
            onToggleBulkSelect={handleToggleBulkSelect}
            folders={visibleFolders}
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

      {sorted.length === 0 && (
        <p className="text-sm text-muted">
          {isSearching
            ? "No content matches your search."
            : monthFilter !== "all"
              ? "No content in that month."
              : "No content yet — create one below."}
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

      {/* Shows if EITHER bulkSelectionMode is explicitly active (mobile's
          "Select Items" entry, with nothing chosen yet) OR anything is
          already selected (desktop's original hover+click-the-circle flow,
          which never needed or used an explicit mode) -- restores the
          exact original "the bar just appears once something's checked"
          desktop behavior while still giving mobile's explicit entry point
          an immediate, obvious way to exit. */}
      {(bulkSelectionMode || bulkSelectedIds.size > 0) && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center justify-center gap-3 border-t border-border bg-background px-4 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          <span className="text-xs tracking-wide text-muted uppercase">{bulkSelectedIds.size} selected</span>
          <Button type="button" variant="secondary" radius="none" onClick={handleCancelBulkSelection}>
            Cancel
          </Button>
          {visibleFolders.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              radius="none"
              onClick={() => setBulkMoveDialogOpen(true)}
              disabled={bulkSelectedIds.size === 0}
            >
              Move to Folder
            </Button>
          )}
          <Button type="button" variant="primary" radius="none" onClick={handleBulkDelete} disabled={bulkSelectedIds.size === 0}>
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
          {visibleFolders.map((f) => (
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
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/") || f.type === "application/pdf",
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
        accept="image/*,video/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          // Array.from(...) BEFORE clearing .value, not just `const files =
          // e.target.files` -- a file input's .files is a live FileList tied
          // to the element, and resetting .value clears that same object in
          // place, so a bare reference captured first is already empty by
          // the time handleFiles reads it below (confirmed via direct
          // testing: length 1 immediately, length 0 right after the reset,
          // same object). Same pattern story-editor.tsx's own upload input
          // already used correctly.
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) handleFiles(files);
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

// One compact entry point for both Sort and Month -- same trigger+panel
// shape as ShareMenuButton (share-menu.tsx) and FolderTile's own ⋮ menu:
// a small icon button that toggles a small absolutely-positioned panel,
// not a permanent filter bar taking up its own row. Both controls live in
// the SAME panel (not two separate buttons) since they're really one
// "how is Content currently arranged" concept, and a project accumulates
// months slowly enough that a second always-visible control for it isn't
// warranted.
function SortFilterMenu({
  sortOrder,
  onSortOrderChange,
  monthFilter,
  onMonthFilterChange,
  availableMonths,
  open,
  onOpenChange,
}: {
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
  monthFilter: string;
  onMonthFilterChange: (month: string) => void;
  availableMonths: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Local, not lifted -- nothing outside this menu ever needs to know
  // which of its two views is showing, only the actual sort/month
  // SELECTIONS (already lifted to StoriesBoard, since those drive the
  // list). Reset to "main" every time the popover closes, so reopening it
  // later always starts back on the compact Sort/Month row rather than
  // wherever the user last left it mid-drill-down.
  const [view, setView] = useState<"main" | "month">("main");
  const menuRef = useOutsideClick<HTMLDivElement>(open, () => {
    onOpenChange(false);
    setView("main");
  });
  const isActive = sortOrder !== "newest" || monthFilter !== "all";

  function toggleOpen() {
    if (open) setView("main");
    onOpenChange(!open);
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        title="Sort & filter"
        className={`rounded p-1.5 transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground ${
          isActive ? "text-foreground" : "text-muted"
        }`}
      >
        <SortFilterIcon />
      </button>
      {open && (
        // right-0 at every width, same anchor as ShareMenuButton's own panel
        // right next to this one -- the icon-cluster row this trigger sits
        // in is justify-end (see the parent div's own comment), so this
        // trigger sits at the row's RIGHT edge on mobile too, not the left.
        // A now-stale left-0 mobile override here (from before the cluster
        // was justify-end'd) anchored the panel's LEFT edge to a
        // right-sitting trigger, pushing a 192px-wide panel off the RIGHT
        // side of a 320-414px viewport instead -- confirmed live, same
        // off-screen-panel bug class as ShareMenuButton's Round 3 fix, just
        // the opposite direction now that the trigger itself moved.
        <div className="absolute right-0 top-8 z-20 w-48 max-w-[calc(100vw-1.5rem)] rounded-none border border-border bg-background p-1 shadow-lg">
          {view === "main" ? (
            <>
              <p className="px-2 pt-1 pb-0.5 text-[10px] tracking-wide text-muted uppercase">Sort</p>
              {(
                [
                  ["newest", "Newest to oldest"],
                  ["oldest", "Oldest to newest"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onSortOrderChange(value)}
                  className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05] ${
                    sortOrder === value ? "font-medium text-foreground" : "text-muted"
                  }`}
                >
                  {label}
                </button>
              ))}

              <div className="my-1 border-t border-border" />

              {/* One compact row, not the full month list -- with real
                  usage this could be 24+ months, and this popover should
                  never grow into a long scrolling list itself. Opens the
                  dedicated month sub-view below instead. */}
              <button
                type="button"
                onClick={() => setView("month")}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-muted transition-colors duration-150 hover:bg-black/[.05]"
              >
                <span className="text-[10px] tracking-wide uppercase">Month</span>
                <span className="flex items-center gap-1 text-foreground">
                  <span className={monthFilter === "all" ? "text-muted" : "font-medium"}>
                    {monthFilter === "all" ? "All" : monthLabel(monthFilter)}
                  </span>
                  <ChevronRightIcon className="h-3 w-3 text-muted" />
                </span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setView("main")}
                className="mb-0.5 flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-xs text-muted transition-colors duration-150 hover:bg-black/[.05]"
              >
                <ChevronLeftIcon className="h-3 w-3" />
                Month
              </button>
              {/* overscroll-contain -- scrolling a long month list to its
                  end shouldn't hand off the scroll gesture to the Content
                  page underneath the popover. */}
              <div className="max-h-56 overflow-y-auto overscroll-contain">
                <button
                  type="button"
                  onClick={() => {
                    onMonthFilterChange("all");
                    setView("main");
                  }}
                  className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05] ${
                    monthFilter === "all" ? "font-medium text-foreground" : "text-muted"
                  }`}
                >
                  All
                </button>
                {availableMonths.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      onMonthFilterChange(key);
                      setView("main");
                    }}
                    className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05] ${
                      monthFilter === key ? "font-medium text-foreground" : "text-muted"
                    }`}
                  >
                    {monthLabel(key)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SortFilterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <path d="M4 7h16M7 12h10M10 17h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  onRename: (name: string) => Promise<ActionResult>;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  // Shows the new name immediately on Enter instead of waiting for the
  // round trip -- reverts to the last known-good server value if the save
  // fails (see handleRenameFolder above, which returns the result instead
  // of firing and forgetting).
  const { value: displayName, set: setOptimisticName, reset: resetOptimisticName } = useOptimisticOverride(
    folder.name,
  );
  const [renameError, setRenameError] = useState<string | undefined>();

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
            <img src={folder.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
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
                const next = renameValue.trim();
                if (!next || next === displayName) return;
                setRenameError(undefined);
                setOptimisticName(next);
                onRename(next).then((result) => {
                  if (!result.success) {
                    resetOptimisticName();
                    setRenameError(result.message ?? "Couldn't rename that folder.");
                  }
                });
              }}
              className="w-full truncate bg-transparent text-xs font-medium text-foreground outline-none"
            />
          ) : (
            <span className="truncate text-xs font-medium text-foreground">{displayName}</span>
          )}
        </div>
      </button>
      {renameError && <p className="mt-1 text-[10px] text-error">{renameError}</p>}

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
                  setRenameValue(displayName);
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
