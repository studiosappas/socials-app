"use client";

import { useState } from "react";

// Shared show/hide-password input -- originally built local to
// reset-password-form.tsx (its own two password inputs), extracted here so
// Login can reuse it instead of duplicating the toggle logic a second time.
// Same bare-bones border-bottom input styling every other auth field in
// this app already uses; the toggle button is absolutely positioned inside
// a relative wrapper (not a sibling that could shift layout) and the input
// keeps a fixed right-padding for it, so nothing reflows when it appears.
export function PasswordField({
  id,
  name,
  label,
  // Omitted by default (Login's own password field never enforced a
  // minimum length -- only Reset Password's "new password" fields do, and
  // must keep doing so unchanged) rather than defaulting to 8 here, so a
  // caller that doesn't pass this gets byte-for-byte the same validation
  // behavior it had before this component existed.
  minLength,
}: {
  id: string;
  name: string;
  label: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs tracking-wide text-muted uppercase">{label}</span>
      <div className="relative flex items-center">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required
          minLength={minLength}
          className="w-full border-0 border-b border-border bg-transparent py-1.5 pr-9 text-sm focus:border-foreground focus:outline-none"
        />
        <button
          // Explicit type="button" -- without it, a button inside a <form>
          // defaults to type="submit" and this would submit the form on
          // every toggle click instead of just flipping visibility.
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute right-0 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center text-muted transition-colors duration-150 hover:text-foreground"
        >
          {visible ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M1.5 10S4.5 3.5 10 3.5 18.5 10 18.5 10 15.5 16.5 10 16.5 1.5 10 1.5 10Z" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2.5 2.5l15 15" />
      <path d="M8.3 4.1c.55-.13 1.12-.2 1.7-.2 5.5 0 8.5 6.5 8.5 6.5a15 15 0 0 1-3.06 3.98M5.4 5.4C3.02 6.98 1.5 10 1.5 10s3 6.5 8.5 6.5c1.2 0 2.28-.31 3.23-.8" />
      <path d="M7.9 8.1a2.5 2.5 0 0 0 3.5 3.5" />
    </svg>
  );
}
