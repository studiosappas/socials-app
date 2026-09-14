"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updateRecoveryPassword, type UpdatePasswordState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

const initialState: UpdatePasswordState = { status: "idle" };

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updateRecoveryPassword, initialState);

  // updateRecoveryPassword signs the recovery session out on success (see
  // its own comment) -- a fresh login is the only way back in from here,
  // so this replaces the form with a confirmation + explicit link rather
  // than an auto-redirect that would just bounce off the (now signed-out)
  // middleware anyway.
  if (state.status === "success") {
    return (
      <div className="flex w-full max-w-sm flex-col gap-6">
        <p className="text-sm">Password updated successfully.</p>
        <Link href="/login" className="text-sm text-foreground underline underline-offset-2">
          Continue to login
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-6">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs tracking-wide text-muted uppercase">New password</span>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          className="border-0 border-b border-border bg-transparent py-1.5 text-sm focus:border-foreground focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs tracking-wide text-muted uppercase">Confirm new password</span>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          className="border-0 border-b border-border bg-transparent py-1.5 text-sm focus:border-foreground focus:outline-none"
        />
      </label>
      {state.status === "error" && state.message && <p className="text-sm text-error">{state.message}</p>}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? "Updating..." : "Update password"}
      </Button>
    </form>
  );
}
