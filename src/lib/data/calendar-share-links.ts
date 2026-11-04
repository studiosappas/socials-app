import type { createClient } from "@/lib/supabase/server";

export type CalendarShareLink = { id: string; token: string; createdAt: string };

export type CalendarShareLinksData = { links: CalendarShareLink[]; tableMissing: boolean };

// The team Calendar's Share Calendar menu -- owner/admin only (the caller
// skips this for everyone else, and RLS returns nothing to them anyway).
// Isolated: calendar_share_links is a new table that won't exist until
// add_calendar_share_links.sql runs; a missing table degrades to an empty
// list + a message instead of failing the Calendar page.
export async function getCalendarShareLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<CalendarShareLinksData> {
  const { data, error } = await supabase
    .from("calendar_share_links")
    .select("id, token, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return {
    links: (data ?? []).map((l) => ({ id: l.id, token: l.token, createdAt: l.created_at })),
    tableMissing: Boolean(error),
  };
}
