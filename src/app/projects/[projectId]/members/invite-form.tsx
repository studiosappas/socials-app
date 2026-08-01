"use client";

import { useActionState } from "react";
import { inviteMember } from "@/lib/actions/members";

export function InviteForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(
    inviteMember.bind(null, projectId),
    undefined,
  );

  return (
    <form action={action} className="flex gap-2">
      <input
        name="email"
        type="email"
        placeholder="teammate@email.com"
        required
        className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
      />
      <select
        name="role"
        defaultValue="designer"
        className="rounded-md border border-border px-3 py-2 text-sm"
      >
        <option value="admin">Admin</option>
        <option value="designer">Designer</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-60"
      >
        {pending ? "Inviting..." : "Invite"}
      </button>
      {state?.message && <p className="text-sm text-error">{state.message}</p>}
    </form>
  );
}
