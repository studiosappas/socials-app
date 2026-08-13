"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FilterPopover, type TaskFilters } from "./filter-popover";

export type ViewMode = "list" | "board";
export type StatusView = "active" | "completed";

export function Toolbar({
  view,
  onViewChange,
  statusView,
  onStatusViewChange,
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  assignees,
  onAddTask,
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  statusView: StatusView;
  onStatusViewChange: (v: StatusView) => void;
  search: string;
  onSearchChange: (v: string) => void;
  filters: TaskFilters;
  onFiltersChange: (f: TaskFilters) => void;
  assignees: { id: string; name: string; avatarUrl: string | null }[];
  onAddTask: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex shrink-0 items-center rounded-full border border-border bg-black/[.02] p-0.5">
          {(["list", "board"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onViewChange(v)}
              className={`rounded-full px-3.5 py-1 text-xs tracking-wide uppercase transition-colors duration-150 ${
                view === v ? "bg-card text-foreground shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Completed tasks are archived out of day-to-day view by default --
            this is the one way back to them, kept as a plain, low-emphasis
            toggle rather than folded into FilterPopover since it changes the
            whole dataset (not just narrowing it) the same way List/Board does. */}
        <div className="flex shrink-0 items-center rounded-full border border-border bg-black/[.02] p-0.5">
          {(["active", "completed"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onStatusViewChange(v)}
              className={`rounded-full px-3.5 py-1 text-xs tracking-wide uppercase transition-colors duration-150 ${
                statusView === v ? "bg-card text-foreground shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <div className="hidden items-center gap-1 sm:flex">
          <FilterPopover filters={filters} onChange={onFiltersChange} assignees={assignees} />
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
              title="Search tasks"
              className={`rounded p-1.5 transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground ${
                searchOpen || search ? "text-foreground" : "text-muted"
              }`}
            >
              <SearchIcon className="h-4 w-4" />
            </button>
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search"
              className={`overflow-hidden border-0 border-b border-border bg-transparent text-sm transition-[width,opacity] duration-150 focus:outline-none ${
                searchOpen ? "w-32 opacity-100" : "w-0 opacity-0"
              }`}
            />
          </div>
        </div>
        <Button type="button" variant="primary" radius="full" onClick={onAddTask} className="flex items-center gap-1.5">
          <PlusIcon />
          Add task
        </Button>
      </div>
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

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 2.5V12.5M2.5 7.5H12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
