"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { updateAccountEmail, updateAccountPassword, updateAccountProfile } from "@/lib/actions/settings";

const labelClass = "text-xs tracking-wide text-muted uppercase";
const inputClass =
  "w-full border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none";

export function AccountPanel({
  name,
  email,
  avatarUrl,
}: {
  name: string;
  email: string;
  avatarUrl: string | null;
}) {
  const [profileState, profileAction, profilePending] = useActionState(
    updateAccountProfile,
    undefined,
  );
  const [emailState, emailAction, emailPending] = useActionState(updateAccountEmail, undefined);
  const [passwordState, passwordAction, passwordPending] = useActionState(
    updateAccountPassword,
    undefined,
  );

  return (
    <div className="flex flex-col gap-10">
      <form action={profileAction} className="flex flex-col gap-4">
        <span className={labelClass}>User information</span>
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="h-14 w-14 rounded-full bg-border" />
          )}
          <label>
            <span className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs tracking-wide uppercase transition-colors duration-150 hover:border-foreground/40">
              Upload photo
            </span>
            <input type="file" name="avatar" accept="image/*" className="hidden" />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Name</span>
          <input name="name" defaultValue={name} required className={inputClass} />
        </label>
        <Button type="submit" variant="primary" disabled={profilePending} className="self-start">
          {profilePending ? "Saving..." : "Save"}
        </Button>
        {profileState?.message && <p className="text-xs text-error">{profileState.message}</p>}
        {profileState?.success && !profileState?.message && (
          <p className="text-xs text-success">Saved.</p>
        )}
      </form>

      <form action={emailAction} className="flex flex-col gap-4">
        <span className={labelClass}>Email</span>
        <input name="email" type="email" defaultValue={email} required className={inputClass} />
        <Button type="submit" variant="secondary" disabled={emailPending} className="self-start">
          {emailPending ? "Saving..." : "Update email"}
        </Button>
        {emailState?.message && (
          <p className={`text-xs ${emailState.success ? "text-success" : "text-error"}`}>
            {emailState.message}
          </p>
        )}
      </form>

      <form action={passwordAction} className="flex flex-col gap-4">
        <span className={labelClass}>Password change</span>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>New password</span>
          <input name="password" type="password" required minLength={8} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Confirm password</span>
          <input name="confirm_password" type="password" required minLength={8} className={inputClass} />
        </label>
        <Button type="submit" variant="secondary" disabled={passwordPending} className="self-start">
          {passwordPending ? "Saving..." : "Update password"}
        </Button>
        {passwordState?.message && <p className="text-xs text-error">{passwordState.message}</p>}
        {passwordState?.success && !passwordState?.message && (
          <p className="text-xs text-success">Password updated.</p>
        )}
      </form>
    </div>
  );
}
