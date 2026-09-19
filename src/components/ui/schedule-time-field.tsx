"use client";

import { useState } from "react";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { Select } from "@/components/ui/select";

// REPLACES a plain `<input type="time">` -- confirmed live against the
// real rendered UI that it showed as raw, unstyled browser chrome
// ("--:-- --" placeholder plus a native clock icon) that looked
// jarringly out of place next to the rest of this app's own controls.
// Same architecture as ScheduleDateField's own calendar popover and this
// app's existing Select component: a styled trigger button + a panel this
// component fully owns, so hour/minute selection is always ordinary CSS
// this app controls, never OS-dependent native time-picker chrome.
// Canonical value stays a plain 24-hour "HH:MM" string; only the trigger's
// display text and the popover's own hour/period derivation are 12-hour.

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const PERIOD_OPTIONS = [
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
];

function parse24Hour(value: string): { hour: string; minute: string; period: "AM" | "PM" } | null {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const rawHour = parseInt(match[1], 10);
  const minute = match[2];
  const period: "AM" | "PM" = rawHour >= 12 ? "PM" : "AM";
  const twelveHour = rawHour % 12 === 0 ? 12 : rawHour % 12;
  return { hour: String(twelveHour), minute, period };
}

function to24Hour(hour: string, minute: string, period: "AM" | "PM"): string {
  const h = parseInt(hour, 10) % 12;
  const hour24 = period === "PM" ? h + 12 : h;
  return `${String(hour24).padStart(2, "0")}:${minute}`;
}

export function ScheduleTimeField({
  value,
  onChange,
  disabled,
  fieldClassName,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  fieldClassName: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClick<HTMLDivElement>(open, () => setOpen(false));
  const parsed = parse24Hour(value);
  // What the three selects show while the popover is open, even before a
  // real value exists -- a sensible starting point (9:00 AM) for a post
  // that hasn't been scheduled yet, never written back until the user
  // actually picks something.
  const current = parsed ?? { hour: "9", minute: "00", period: "AM" as const };

  function update(hour: string, minute: string, period: "AM" | "PM") {
    onChange(to24Hour(hour, minute, period));
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${fieldClassName} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className={value ? "" : "text-muted"}>
          {value ? `${current.hour}:${current.minute} ${current.period}` : "Select time"}
        </span>
        <ClockIcon className="h-4 w-4 shrink-0 text-muted" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`${ariaLabel} picker`}
          className="absolute left-0 top-full z-30 mt-1 w-60 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card p-3 shadow-lg"
        >
          <div className="grid grid-cols-3 gap-2">
            <Select
              value={current.hour}
              onChange={(h) => update(h, current.minute, current.period)}
              options={HOURS.map((h) => ({ value: h, label: h }))}
            />
            <Select
              value={current.minute}
              onChange={(m) => update(current.hour, m, current.period)}
              options={MINUTES.map((m) => ({ value: m, label: m }))}
            />
            <Select
              value={current.period}
              onChange={(p) => update(current.hour, current.minute, p as "AM" | "PM")}
              options={PERIOD_OPTIONS}
            />
          </div>

          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="mt-3 w-full rounded px-2 py-1.5 text-center text-xs text-muted transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground"
            >
              Clear time
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}
