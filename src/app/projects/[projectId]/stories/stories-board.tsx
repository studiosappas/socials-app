"use client";

import { useMemo, useState } from "react";
import { createStory } from "@/lib/actions/stories";
import { StoryCard } from "./story-card";

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
}: {
  projectId: string;
  stories: StoryListItem[];
  canManage: boolean;
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
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {visible.map((story) => (
          <StoryCard
            key={story.id}
            projectId={projectId}
            storyId={story.id}
            name={story.name}
            thumbnailUrl={story.thumbnailUrl}
            canManage={canManage}
          />
        ))}
        {hasMore && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            title="View all stories"
            className="flex aspect-[9/16] w-full shrink-0 items-center justify-center border border-dashed border-border text-muted transition-colors duration-150 hover:border-foreground/30 hover:text-foreground"
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

      {canManage && (
        <form action={createStory.bind(null, projectId)}>
          <button
            type="submit"
            className="rounded-none bg-foreground px-4 py-3 text-xs tracking-wide uppercase text-background transition-colors duration-150 hover:bg-black/85"
          >
            Add New Story
          </button>
        </form>
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
