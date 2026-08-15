"use client";

import { useState } from "react";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";

// A real native <select>'s dropdown popup is drawn by the browser/OS, not by
// our CSS -- its background, row hover, and (especially) the selected-row
// highlight color are largely NOT overridable via `option` CSS in Chrome; it
// stays the OS accent blue no matter what's declared. This is a from-scratch
// listbox that looks the same closed (matches the app's underline input
// style) but renders its own panel + rows, so hover/selected colors are
// ordinary CSS we fully control.
export function Select<T extends string>({
  name,
  value,
  onChange,
  options,
  className = "",
}: {
  name?: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClick<HTMLDivElement>(open, () => setOpen(false));
  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between border-0 border-b border-border bg-transparent py-2 text-left text-sm transition-colors duration-150 focus:border-foreground focus:outline-none ${className}`}
      >
        <span>{selected?.label ?? ""}</span>
        <ChevronIcon className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-150 ${open ? "-rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`block w-full px-3 py-2 text-left text-sm text-foreground transition-colors duration-100 hover:bg-foreground/[0.06] ${
                opt.value === value ? "bg-foreground/[0.08]" : ""
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
