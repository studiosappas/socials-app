import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// A lightweight, best-effort activity feed -- not an exhaustive audit trail
// of every action in the app, just the handful of notable events Settings >
// Activity Log surfaces (uploads, post/story creation, team changes).
// Failures here are swallowed deliberately: logging an activity entry
// should never be the reason a real user action (an upload, an invite)
// fails.
export async function logActivity(
  supabase: SupabaseServerClient,
  projectId: string,
  userId: string,
  action: string,
): Promise<void> {
  try {
    const { data: profile } = await supabase.from("profiles").select("name").eq("id", userId).single();
    await supabase.from("activity_log").insert({
      project_id: projectId,
      actor_name: profile?.name ?? "Someone",
      action,
    });
  } catch {
    // Best-effort -- see comment above.
  }
}
