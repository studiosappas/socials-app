"use client";

import { useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { formatScheduleDate, type WorkspaceSettings } from "@/lib/account-settings";

// REPLACES an earlier version of this component (the invisible-native-
// input-plus-decorative-overlay trick): that made the input's own text
// AND its native calendar icon opacity-0, so an unscheduled post's field
// rendered as a completely blank rectangle with zero visual affordance
// that it was even interactive -- confirmed live against the real
// rendered UI, not just source. This is a real, from-scratch calendar
// popover instead (same architectural pattern as this app's own Select
// component: a styled trigger button + an outside-click-dismissed panel
// it fully owns), so the trigger is ALWAYS visibly a control (a calendar
// icon plus either the formatted date or a "Select date" placeholder),
// and clicking it always opens a small in-app month grid -- never a
// browser/OS-dependent native picker whose availability and appearance
// this app can't control or guarantee. The canonical value stays a plain
// "YYYY-MM-DD" string throughout; only the grid's day-highlighting and the
// trigger's own display text are derived from it, via date-fns'
// `parseISO`, which -- confirmed -- parses a date-only string as LOCAL
// midnight, never UTC, so there is no day-shift risk the way
// `new Date("YYYY-MM-DD")` would have.
export function ScheduleDateField({
  value,
  onChange,
  disabled,
  dateFormat,
  fieldClassName,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  dateFormat: WorkspaceSettings["date_format"];
  fieldClassName: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClick<HTMLDivElement>(open, () => setOpen(false));
  const selected = value ? parseISO(value) : null;
  // The month currently shown in the grid -- defaults to the selected
  // date's month if there is one, otherwise the real current month.
  // Deliberately its own state (not derived inline every render) so
  // Prev/Next navigation doesn't get overridden by `selected` on a re-
  // render triggered by something unrelated to this field.
  const [viewMonth, setViewMonth] = useState(() => selected ?? new Date());

  function openPicker() {
    if (disabled) return;
    setViewMonth(selected ?? new Date());
    setOpen((o) => !o);
  }

  function pick(day: Date) {
    onChange(format(day, "yyyy-MM-dd"));
    setOpen(false);
  }

  // Sunday-start grid, matching this app's own date-fns default (date-fns'
  // startOfWeek/endOfWeek default to Sunday=0 with no options passed, the
  // same default Calendar's own week grid uses before applying its own
  // week_starts_on override) -- this field doesn't thread that per-user
  // preference through since it's a single-date picker, not a week grid,
  // and every calendar UI convention starts labeling from Sunday or Monday
  // regardless of that setting.
  const gridStart = startOfWeek(startOfMonth(viewMonth));
  const gridEnd = endOfWeek(endOfMonth(viewMonth));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${fieldClassName} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className={value ? "" : "text-muted"}>{value ? formatScheduleDate(value, dateFormat) : "Select date"}</span>
        <CalendarIcon className="h-4 w-4 shrink-0 text-muted" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`${ariaLabel} calendar`}
          className="absolute left-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
              aria-label="Previous month"
              className="rounded p-1 text-muted transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <ChevronIcon direction="left" className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">{format(viewMonth, "MMMM yyyy")}</span>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              aria-label="Next month"
              className="rounded p-1 text-muted transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <ChevronIcon direction="right" className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] tracking-wide text-muted uppercase">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((day) => {
              const inMonth = isSameMonth(day, viewMonth);
              const isSelected = selected && isSameDay(day, selected);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => pick(day)}
                  className={`aspect-square rounded text-xs transition-colors duration-100 ${
                    isSelected
                      ? "bg-foreground text-background"
                      : inMonth
                        ? "text-foreground hover:bg-foreground/[0.08]"
                        : "text-muted/50 hover:bg-foreground/[0.05]"
                  } ${isToday(day) && !isSelected ? "font-semibold underline underline-offset-2" : ""}`}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>

          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="mt-2 w-full rounded px-2 py-1.5 text-center text-xs text-muted transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground"
            >
              Clear date
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="5" width="18" height="16" rx="1.5" />
      <path d="M3 9.5h18M8 3v3.5M16 3v3.5" />
    </svg>
  );
}

function ChevronIcon({ direction, className }: { direction: "left" | "right"; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={direction === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}
