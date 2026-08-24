import { getSettingsAccess } from "@/lib/settings-access";
import { TeamPanel } from "./team-panel";
import { AccessRestricted } from "../../access-restricted";

export default async function TeamPermissionsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, canManage, isOwner, user, hasSettingsAccess } = await getSettingsAccess(projectId);

  if (!hasSettingsAccess) {
    return <AccessRestricted />;
  }

  // Base membership + name/avatar first, using only long-established
  // columns -- this is what every other row on the page depends on, so it
  // must never fail just because one of the newer columns below isn't
  // migrated yet.
  const { data: members } = await supabase
    .from("project_members")
    .select("user_id, role, profiles(name, avatar_url)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  const memberIds = (members ?? []).map((m) => m.user_id);

  // custom_permissions and profiles.email are both newer, still-pending-on-
  // some-databases columns -- isolated into their own queries (same reasoning
  // as elsewhere: PostgREST fails an entire select on any missing column) so
  // a pending migration only means "no email shown yet"/"no custom
  // permissions yet," not that the whole Team page fails to load.
  const { data: permissionRows } = memberIds.length
    ? await supabase
        .from("project_members")
        .select("user_id, custom_permissions")
        .eq("project_id", projectId)
        .in("user_id", memberIds)
    : { data: [] };
  const permissionsByUserId = new Map<string, string[] | null>();
  for (const row of permissionRows ?? []) {
    const r = row as { user_id: string; custom_permissions: string[] | null };
    permissionsByUserId.set(r.user_id, r.custom_permissions ?? null);
  }

  const { data: emailRows } = memberIds.length
    ? await supabase.from("profiles").select("id, email").in("id", memberIds)
    : { data: [] };
  const emailByUserId = new Map<string, string | null>();
  for (const row of emailRows ?? []) {
    const r = row as { id: string; email: string | null };
    emailByUserId.set(r.id, r.email ?? null);
  }

  const teamMembers = (members ?? []).map((m) => ({
    userId: m.user_id,
    role: m.role,
    customPermissions: permissionsByUserId.get(m.user_id) ?? null,
    name: m.profiles?.name ?? "Unknown",
    email: emailByUserId.get(m.user_id) ?? "",
    avatarUrl: m.profiles?.avatar_url ?? null,
  }));

  return (
    <TeamPanel
      projectId={projectId}
      members={teamMembers}
      canManage={canManage}
      isOwner={isOwner}
      currentUserId={user.id}
    />
  );
}
