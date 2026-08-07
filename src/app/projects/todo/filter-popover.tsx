"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";

export type TaskFilters = {
  // null = everyone, "unassigned" = only unassigned, else a specific user id.
  assignee: string | "unassigned" | null;
  source: "all" | "manual" | "auto";
};

export function FilterPopover({
  filters,
  onChange,
  assignees,
}: {
  filters: TaskFilters;
  onChange: (next: TaskFilters) => void;
  assignees: { id: string; name: string; avatarUrl: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClick<HTMLDivElement>(open, () => setOpen(false));
  const active = filters.assignee !== null || filters.source !== "all";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Filter tasks"
        className={`rounded p-1.5 transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground ${
          active ? "text-foreground" : "text-muted"
        }`}
      >
        <FilterIcon className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-52 rounded-md border border-border bg-background p-3 shadow-lg">
          <p className="mb-1.5 text-xs tracking-wide text-muted uppercase">Assignee</p>
          <div className="mb-3 flex flex-col gap-0.5">
            <FilterOption active={filters.assignee === null} onClick={() => onChange({ ...filters, assignee: null })}>
              Everyone
            </FilterOption>
            <FilterOption
              active={filters.assignee === "unassigned"}
              onClick={() => onChange({ ...filters, assignee: "unassigned" })}
            >
              Unassigned
            </FilterOption>
            {assignees.map((a) => (
              <FilterOption key={a.id} active={filters.assignee === a.id} onClick={() => onChange({ ...filters, assignee: a.id })}>
                <Avatar name={a.name} avatarUrl={a.avatarUrl} />
                <span className="truncate">{a.name}</span>
              </FilterOption>
            ))}
          </div>

          <p className="mb-1.5 text-xs tracking-wide text-muted uppercase">Source</p>
          <div className="flex flex-col gap-0.5">
            <FilterOption active={filters.source === "all"} onClick={() => onChange({ ...filters, source: "all" })}>
              All
            </FilterOption>
            <FilterOption active={filters.source === "manual"} onClick={() => onChange({ ...filters, source: "manual" })}>
              Manual
            </FilterOption>
            <FilterOption active={filters.source === "auto"} onClick={() => onChange({ ...filters, source: "auto" })}>
              Auto
            </FilterOption>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterOption({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 ${
        active ? "bg-accent/10 text-accent" : "hover:bg-black/[.05]"
      }`}
    >
      {children}
    </button>
  );
}

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
    </svg>
  );
}
