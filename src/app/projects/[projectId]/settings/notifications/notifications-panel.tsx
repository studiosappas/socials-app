"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { updateNotificationPrefs } from "@/lib/actions/settings";
import { NOTIFICATION_EVENTS } from "@/lib/notification-events";

const labelClass = "text-xs tracking-wide text-muted uppercase";

export function NotificationsPanel({
  projectId,
  prefs,
}: {
  projectId: string;
  prefs: Record<string, boolean>;
}) {
  const [state, action, pending] = useActionState(updateNotificationPrefs.bind(null, projectId), undefined);

  return (
    <form action={action} className="flex max-w-md flex-col gap-6">
      <h2 className={labelClass}>Project-Specific Notifications</h2>

      <div className="flex flex-col gap-3">
        {/* Missing/unset defaults to ON (opt-out), matching notifyProjectMembers'
            own default -- a brand-new member has no saved prefs yet, and an
            opt-in default would mean their very first notification (e.g.
            "you were added to this project") could never fire. */}
        {NOTIFICATION_EVENTS.map((event) => (
          <label key={event.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={event.key}
              defaultChecked={prefs[event.key] ?? true}
              className="h-3.5 w-3.5 accent-foreground"
            />
            {event.label}
          </label>
        ))}
      </div>

      <Button type="submit" variant="primary" radius="none" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save"}
      </Button>
      {state?.message && <p className="text-xs text-error">{state.message}</p>}
      {state?.success && !state?.message && <p className="text-xs text-success">Saved.</p>}
    </form>
  );
}
