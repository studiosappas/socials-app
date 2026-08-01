"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

export function RegisterForm() {
  const [state, action, pending] = useActionState(signup, undefined);

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-6">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs tracking-wide text-muted uppercase">Name</span>
        <input
          id="name"
          name="name"
          required
          className="border-0 border-b border-border bg-transparent py-1.5 text-sm focus:border-foreground focus:outline-none"
        />
      </label>
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
      <label className="flex flex-col gap-1.5">
        <span className="text-xs tracking-wide text-muted uppercase">Password</span>
        <input
          id="password"
          name="password"
          type="password"
          required
          className="border-0 border-b border-border bg-transparent py-1.5 text-sm focus:border-foreground focus:outline-none"
        />
      </label>
      {state?.message && <p className="text-sm text-error">{state.message}</p>}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? "Creating account..." : "Create account"}
      </Button>
      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-foreground underline underline-offset-2">
          Log in
        </Link>
      </p>
    </form>
  );
}
