"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mergeWorkspaceSettings } from "@/lib/account-settings";
import type { CalendarShareLink } from "@/lib/data/calendar-share-links";

export type CalendarShareLinkResult = { success: true; link: CalendarShareLink } | { success: false; message: string };

// Owner/admin only -- checked here for a clear message, and enforced again
// by calendar_share_links' own RLS (see add_calendar_share_links.sql), so a
// hand-crafted call from anyone else is refused by the database either way.
async function requireCalendarSharer(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be logged in." } as const;
  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    return { error: "Only project owners and admins can share the calendar." } as const;
  }
  return { supabase, user } as const;
}

export async function createCalendarShareLink(projectId: string): Promise<CalendarShareLinkResult> {
  const gate = await requireCalendarSharer(projectId);
  if ("error" in gate) return { success: false, message: gate.error! };
  const { supabase, user } = gate;

  const { data: profile } = await supabase.from("profiles").select("workspace_settings").eq("id", user.id).single();
  const { week_starts_on } = mergeWorkspaceSettings(profile?.workspace_settings);

  // 256 random bits, base64url -- the shape the table's CHECK constraint
  // and get_shared_calendar both require.
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await supabase
    .from("calendar_share_links")
    .insert({ project_id: projectId, token, week_starts_on, created_by: user.id })
    .select("id, token, created_at")
    .single();
  if (error || !data) return { success: false, message: error?.message ?? "Couldn't create the link." };

  revalidatePath(`/projects/${projectId}/calendar`);
  return { success: true, link: { id: data.id, token: data.token, createdAt: data.created_at } };
}

export async function revokeCalendarShareLink(
  projectId: string,
  linkId: string,
): Promise<{ success: true } | { success: false; message: string }> {
  const gate = await requireCalendarSharer(projectId);
  if ("error" in gate) return { success: false, message: gate.error! };

  const { data, error } = await gate.supabase
    .from("calendar_share_links")
    .delete()
    .eq("id", linkId)
    .eq("project_id", projectId)
    .select("id");
  if (error) return { success: false, message: error.message };
  if (!data?.length) return { success: false, message: "That link no longer exists." };

  revalidatePath(`/projects/${projectId}/calendar`);
  return { success: true };
}
