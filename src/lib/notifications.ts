import type { createClient } from "@/lib/supabase/server";
import { parseMentions } from "@/lib/mentions";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Real per-recipient notification instances for the top-nav bell -- distinct
// from project_members.notification_prefs, which only stores which event
// types a member wants (this is what a write checks before inserting here).
//
// Preferences default to ON (missing/unset key = notify) rather than off:
// a brand-new member has an empty notification_prefs object and hasn't had
// a chance to visit Settings > Notifications yet, so an opt-in default would
// mean their very first notification (e.g. "you were invited") could never
// fire. Settings > Notifications' checkboxes match this same default (see
// notifications-panel.tsx).
export async function notifyProjectMembers(
  supabase: SupabaseServerClient,
  projectId: string,
  eventKey: string,
  notification: { title: string; description?: string; icon?: string; link?: string },
  options: { excludeUserId?: string; onlyUserIds?: string[] } = {},
): Promise<void> {
  try {
    let query = supabase.from("project_members").select("user_id, notification_prefs").eq("project_id", projectId);
    if (options.onlyUserIds) {
      query = query.in("user_id", options.onlyUserIds);
    }
    const { data: members } = await query;

    const recipients = (members ?? [])
      .filter((m) => m.user_id !== options.excludeUserId)
      .filter((m) => {
        const prefs = (m.notification_prefs as Record<string, boolean> | null) ?? {};
        return prefs[eventKey] !== false;
      })
      .map((m) => m.user_id);

    if (recipients.length === 0) return;

    await supabase.from("notifications").insert(
      recipients.map((userId) => ({
        user_id: userId,
        project_id: projectId,
        event_key: eventKey,
        title: notification.title,
        description: notification.description ?? "",
        icon: notification.icon ?? "🔔",
        link: notification.link,
      })),
    );
  } catch {
    // Best-effort, same reasoning as activity-log.ts: a notification failing
    // to send should never be the reason the real action (an upload, an
    // invite) fails.
  }
}

// Scans `text` for `@Full Name` mentions of real project members and
// notifies just those people -- distinct from notifyProjectMembers' own
// broadcast-to-everyone shape. Reliable because mention-input.tsx's
// autocomplete always inserts a member's exact full name, so this is a
// plain substring check (see parseMentions), not fuzzy text parsing.
export async function notifyMentions(
  supabase: SupabaseServerClient,
  projectId: string,
  text: string,
  options: { notifierName: string; itemLabel: string; link?: string; excludeUserId?: string },
): Promise<void> {
  try {
    const { data: members } = await supabase
      .from("project_members")
      .select("user_id, profiles(name)")
      .eq("project_id", projectId);

    const candidates = (members ?? [])
      .map((m) => ({ id: m.user_id as string, name: (m.profiles as { name: string } | null)?.name ?? "" }))
      .filter((m) => m.id !== options.excludeUserId);

    const mentionedIds = parseMentions(text, candidates);
    if (mentionedIds.length === 0) return;

    await notifyProjectMembers(
      supabase,
      projectId,
      "mentioned",
      {
        title: `${options.notifierName} mentioned you in ${options.itemLabel}`,
        icon: "🔔",
        link: options.link,
      },
      { onlyUserIds: mentionedIds },
    );
  } catch {
    // Best-effort, same reasoning as notifyProjectMembers above.
  }
}
