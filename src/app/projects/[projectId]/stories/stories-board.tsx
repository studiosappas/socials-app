"use client";

import { useMemo, useState } from "react";
import { createStory } from "@/lib/actions/stories";
import { StoryCard } from "./story-card";
import { ShareMenuButton } from "../share-menu";
import type { ShareLinkItem, PickerStory } from "@/lib/data/share-links";

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
  shareStories,
  shareTableMissing,
}: {
  projectId: string;
  stories: StoryListItem[];
  canManage: boolean;
  shareLinks: ShareLinkItem[];
  shareStories: PickerStory[];
  shareTableMissing: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

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
              items={shareStories}
              contentType="story"
              canManage={canManage}
              tableMissing={shareTableMissing}
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
