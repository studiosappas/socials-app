import { createClient } from "@/lib/supabase/server";
import type { ProjectRole } from "@/types/database";

// Shared by every Settings sub-page (Project Information/Team/Notifications/
// Activity Log/Danger Zone) -- same current-user-membership lookup each of
// them needs before deciding what to show/allow.
export async function getSettingsAccess(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user!.id)
    .single();

  const role = (membership?.role as ProjectRole | undefined) ?? null;
  const canManage = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  return { supabase, user: user!, role, canManage, isOwner };
}
