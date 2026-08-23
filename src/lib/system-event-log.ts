import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Same shape/spirit as activity-log.ts's logActivity, for the one thing
// "recent activity" can't already derive from existing timestamps:
// meaningful operation FAILURES (project/media/post/story creation are
// already fully covered by their own created_at columns -- see
// admin-dashboard.ts). Not a Sentry replacement -- no stack traces, no
// client exceptions, just a short human-readable summary of a failure a
// user actually hit. Best-effort and swallowed on purpose: logging a
// failure should never itself become a second failure in front of the user.
export async function logSystemEvent(
  supabase: SupabaseServerClient,
  params: {
    severity?: "error" | "warning";
    category: string;
    area: string;
    message: string;
    projectId?: string | null;
    userId?: string | null;
  },
): Promise<void> {
  try {
    await supabase.from("system_events").insert({
      severity: params.severity ?? "error",
      category: params.category,
      area: params.area,
      message: params.message,
      project_id: params.projectId ?? null,
      user_id: params.userId ?? null,
    });
  } catch {
    // Best-effort -- see comment above.
  }
}
