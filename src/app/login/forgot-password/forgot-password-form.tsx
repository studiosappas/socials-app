"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type ForgotPasswordState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

const initialState: ForgotPasswordState = { status: "idle" };

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialState);

  // Same neutral confirmation regardless of whether the email actually
  // matched an account -- see requestPasswordReset's own comment. Replaces
  // the form entirely (not just an inline message above it) so there's
  // nothing left to resubmit once it's shown.
  if (state.status === "sent") {
    return (
      <div className="flex w-full max-w-sm flex-col gap-6">
        <p className="text-sm">
          If an account exists for this email, we&apos;ve sent a password reset link.
        </p>
        <Link href="/login" className="text-sm text-foreground underline underline-offset-2">
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-6">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs tracking-wide text-muted uppercase">Email</span>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="border-0 border-b border-border bg-transparent py-1.5 text-sm focus:border-foreground focus:outline-none"
        />
      </label>
      {state.status === "error" && state.message && <p className="text-sm text-error">{state.message}</p>}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? "Sending..." : "Send reset link"}
      </Button>
      <p className="text-sm text-muted">
        <Link href="/login" className="text-foreground underline underline-offset-2">
          Back to login
        </Link>
      </p>
    </form>
  );
}
