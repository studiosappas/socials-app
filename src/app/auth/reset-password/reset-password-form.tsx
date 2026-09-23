"use client";

import { useActionState } from "react";
import { updateRecoveryPassword, type UpdatePasswordState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";

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
      <PasswordField id="password" name="password" label="New password" minLength={8} />
      <PasswordField id="confirmPassword" name="confirmPassword" label="Confirm new password" minLength={8} />
      {state.status === "error" && state.message && <p className="text-sm text-error">{state.message}</p>}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? "Updating..." : "Update password"}
      </Button>
    </form>
  );
}
