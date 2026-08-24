import { createClient } from "@/lib/supabase/server";
import { hasPagePermission } from "@/lib/role-permissions";
import type { ProjectRole } from "@/types/database";

// Shared by every Settings sub-page (Project Information/Team/Notifications/
// Activity Log/Danger Zone) -- same current-user-membership lookup each of
// them needs before deciding what to show/allow. There's a single "Settings"
// permission key (not one per sub-page), so hasSettingsAccess gates all five
// uniformly -- each sub-page still checks it itself (not just this shared
// helper) since direct navigation to e.g. /settings/team never runs the
// top-level /settings page at all.
export async function getSettingsAccess(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("project_members")
    .select("role, custom_permissions")
    .eq("project_id", projectId)
    .eq("user_id", user!.id)
    .single();

  const role = (membership?.role as ProjectRole | undefined) ?? null;
  const canManage = role === "owner" || role === "admin";
  const isOwner = role === "owner";
  const hasSettingsAccess = Boolean(
    membership && hasPagePermission(membership.role, membership.custom_permissions, "settings"),
  );

  return { supabase, user: user!, role, canManage, isOwner, hasSettingsAccess };
}
