"use client";

import { useState } from "react";
import { useActionState } from "react";
import { updateRecoveryPassword, type UpdatePasswordState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

const initialState: UpdatePasswordState = { status: "idle" };

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updateRecoveryPassword, initialState);

  // No client-rendered "success" state to swap in here anymore --
  // updateRecoveryPassword redirects straight to /login on success (see
  // its own comment for why). This form only ever needs to handle the
  // error case; a successful submit navigates away before React gets
  // another state to render.
  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-6">
      <PasswordField id="password" name="password" label="New password" />
      <PasswordField id="confirmPassword" name="confirmPassword" label="Confirm new password" />
      {state.status === "error" && state.message && <p className="text-sm text-error">{state.message}</p>}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? "Updating..." : "Update password"}
      </Button>
    </form>
  );
}

// No existing show/hide-password pattern anywhere in this app to reuse
// (login-form.tsx, register-form.tsx, and account-panel.tsx's own password
// fields are all plain type="password" with no toggle) -- built fresh here,
// as one reusable field rather than duplicating the toggle logic across
// the two password inputs this form needs it for. Same bare-bones
// border-bottom input styling every other auth field in this app already
// uses; the toggle button is absolutely positioned inside a relative
// wrapper (not a sibling that could shift layout) and the input keeps a
// fixed right-padding for it, so nothing reflows when it appears.
function PasswordField({ id, name, label }: { id: string; name: string; label: string }) {
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
          minLength={8}
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
          className="absolute right-0 flex h-8 w-8 shrink-0 items-center justify-center text-muted transition-colors duration-150 hover:text-foreground"
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
