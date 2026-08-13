"use client";

import { useMemo, useState, useTransition } from "react";
import { createStory } from "@/lib/actions/stories";
import { createShareLink } from "@/lib/actions/share-links";
import { StoryCard } from "./story-card";
import { ShareMenuButton } from "../share-menu";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import type { ShareLinkItem } from "@/lib/data/share-links";

export type StoryListItem = {
  id: string;
  name: string;
  scheduledDate: string | null;
  notes: string;
  thumbnailUrl: string | null;
};

const COLLAPSED_COUNT = 6;

export function StoriesBoard({
  projectId,
  stories,
  canManage,
  shareLinks,
  shareTableMissing,
}: {
  projectId: string;
  stories: StoryListItem[];
  canManage: boolean;
  shareLinks: ShareLinkItem[];
  shareTableMissing: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  // Share for Review: selecting stories happens inline on the board itself
  // (same multi-select-circle pattern as Media Library/Grid) instead of in
  // a separate picker dialog.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedStoryIds, setSelectedStoryIds] = useState<Set<string>>(new Set());
  const [sharing, startSharing] = useTransition();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function handleToggleSelect(storyId: string) {
    setSelectedStoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(storyId)) next.delete(storyId);
      else next.add(storyId);
      return next;
    });
  }

  function handleCancelSelection() {
    setSelectionMode(false);
    setSelectedStoryIds(new Set());
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

  // Client-side filter -- matches against name, notes, and the scheduled
  // date, so "type to search" finds a story by any of the three without a
  // server round-trip per keystroke.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stories;
    return stories.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.notes.toLowerCase().includes(q) ||
        (s.scheduledDate ?? "").toLowerCase().includes(q),
    );
  }, [stories, query]);

  const isSearching = query.trim().length > 0;
  const visible = isSearching || showAll ? filtered : filtered.slice(0, COLLAPSED_COUNT);
  const hasMore = !isSearching && !showAll && filtered.length > COLLAPSED_COUNT;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <span className="shrink-0 text-xs tracking-wide text-muted uppercase">Recent Stories</span>
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
              onEnterSelectionMode={() => setSelectionMode(true)}
            />
          )}
          {canManage && (
            <form action={createStory.bind(null, projectId)}>
              <button
                type="submit"
                title="Add New Story"
                className="rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
              >
                <PlusIcon />
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((story) => (
          <StoryCard
            key={story.id}
            projectId={projectId}
            storyId={story.id}
            name={story.name}
            thumbnailUrl={story.thumbnailUrl}
            scheduledDate={story.scheduledDate}
            canManage={canManage}
            selectionMode={selectionMode}
            selected={selectedStoryIds.has(story.id)}
            onToggleSelect={handleToggleSelect}
          />
        ))}
        {hasMore && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            title="View all stories"
            className="flex aspect-[9/16] w-full shrink-0 items-center justify-center rounded-2xl border border-dashed border-border text-muted transition-colors duration-150 hover:border-foreground/30 hover:text-foreground"
          >
            <FolderIcon className="h-6 w-6" />
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted">
          {isSearching ? "No stories match your search." : "No stories yet — create one below."}
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
      <Toast message={toastMessage} />
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

// Matches Grid's own PlusIcon exactly (grid-board.tsx) -- same "Add New
// Post"/"Add New Story" icon-button pairing next to the share icon.
function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 2.5V12.5M2.5 7.5H12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
