"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-log";
import { notifyProjectMembers } from "@/lib/notifications";
import { INVITABLE_ROLES } from "@/lib/role-permissions";
import type { ProjectRole } from "@/types/database";

export type InviteMemberState = { message?: string } | undefined;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Every membership-mutating action below calls this, not just relying on
// project_members' own RLS policy (which already rejects a non-owner/admin's
// write at the database layer) -- an explicit app-layer check too, same
// defense-in-depth reasoning as transferOwnership's own pre-existing check
// further down this file. Since a caller must pass this to reach ANY of
// these actions regardless of whose row they target, it's the one gate that
// covers "a Member/Client can't self-promote," "can't edit their own
// permission set," and "can't modify another member" all at once -- there's
// no path through inviteMember/removeMember/updateMemberRole/
// updateMemberPermissions that skips it.
async function assertCanManageMembers(supabase: SupabaseServerClient, projectId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .single();
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    throw new Error("Only project owners and admins can manage team members.");
  }
}

export async function inviteMember(
  projectId: string,
  _state: InviteMemberState,
  formData: FormData,
): Promise<InviteMemberState> {
  const email = String(formData.get("email") ?? "").trim();
  const roleRaw = String(formData.get("role") ?? "editor") as ProjectRole;
  const role: ProjectRole = INVITABLE_ROLES.includes(roleRaw) ? roleRaw : "editor";
  if (!email) return { message: "Email is required." };

  // Empty selection means "use the role's default access," matching
  // updateMemberPermissions' own null-means-default convention.
  const permissions = formData.getAll("permissions").map(String);

  const supabase = await createClient();

  try {
    await assertCanManageMembers(supabase, projectId);
  } catch (err) {
    return { message: err instanceof Error ? err.message : "Not authorized." };
  }

  // Independent -- neither needs the other's result.
  const [
    {
      data: { user },
    },
    { data: userId, error: lookupError },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("get_user_id_by_email", { p_email: email }),
  ]);

  if (lookupError || !userId) {
    return { message: "No account found with that email — they need to register first." };
  }

  // custom_permissions is deliberately NOT in this upsert -- it's a newer
  // column that may not exist yet on a not-yet-migrated database, and
  // bundling it here would fail the invite entirely (role included) rather
  // than just skipping permissions. Same "isolate new/pending-migration
  // columns" rule as elsewhere (see setMediaAssetPoster's identical fix for
  // why bundling matters even for a write, not just a select).
  const { error } = await supabase
    .from("project_members")
    .upsert({ project_id: projectId, user_id: userId, role }, { onConflict: "project_id,user_id" });

  if (error) {
    return { message: error.message };
  }

  // Independent of each other -- the permissions update and the activity
  // log write different rows/tables, and the project-name read doesn't
  // depend on either.
  const [, , { data: project }] = await Promise.all([
    permissions.length > 0
      ? supabase
          .from("project_members")
          .update({ custom_permissions: permissions })
          .eq("project_id", projectId)
          .eq("user_id", userId)
      : Promise.resolve(),
    user ? logActivity(supabase, projectId, user.id, `invited ${email} as ${role}`) : Promise.resolve(),
    supabase.from("projects").select("name").eq("id", projectId).single(),
  ]);

  await notifyProjectMembers(
    supabase,
    projectId,
    "member_joined",
    {
      title: `You were added to ${project?.name ?? "a project"}`,
      description: `As ${role}`,
      icon: "👋",
      link: `/projects/${projectId}`,
    },
    { onlyUserIds: [userId] },
  );

  revalidatePath(`/projects/${projectId}/settings/team`);
  return { message: undefined };
}

// Not revalidating -- its one caller (TeamMemberRow's handleRemove)
// already hides the row optimistically before this runs, and only
// restores it + surfaces an error if the removal actually failed.
export async function removeMember(
  projectId: string,
  userId: string,
): Promise<{ success: true } | { success: false; message: string }> {
  const supabase = await createClient();
  try {
    await assertCanManageMembers(supabase, projectId);
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Not authorized." };
  }
  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) return { success: false, message: error.message };
  return { success: true };
}

// Not revalidating -- its one caller (TeamMemberRow's handleSaveEdit)
// already calls router.refresh() itself right after this resolves (along
// with updateMemberPermissions below, called in the same handler).
//
// applyPreset resets custom_permissions to null (= "use the new role's
// current default," resolved dynamically by getEffectivePermissions) in the
// SAME update statement as the role change -- a single atomic write, so
// there's never a moment where the row has the new role but still the old
// role's stored permissions (or vice versa) for another request to observe
// mid-change. Declining the reset (applyPreset: false, the default) leaves
// custom_permissions completely untouched -- a member's own customized
// access is never silently rewritten just because their role changed.
export async function updateMemberRole(
  projectId: string,
  userId: string,
  role: ProjectRole,
  applyPreset = false,
) {
  if (role === "owner") {
    throw new Error("Use transferOwnership to make someone the owner.");
  }
  const supabase = await createClient();
  await assertCanManageMembers(supabase, projectId);
  const { error } = await supabase
    .from("project_members")
    .update(applyPreset ? { role, custom_permissions: null } : { role })
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// null clears the override (falls back to the role's default access). Not
// revalidating -- same reasoning as updateMemberRole above.
export async function updateMemberPermissions(
  projectId: string,
  userId: string,
  permissions: string[] | null,
) {
  const supabase = await createClient();
  await assertCanManageMembers(supabase, projectId);
  const { error } = await supabase
    .from("project_members")
    .update({ custom_permissions: permissions })
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// The previous owner becomes an admin rather than being removed -- ownership
// moves, membership doesn't lapse.
export async function transferOwnership(projectId: string, newOwnerUserId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  // App-layer check beyond RLS: the membership policy allows any admin to
  // update any role, but ownership transfer specifically is owner-only (per
  // Settings > Team & Permissions' "Transfer Ownership (Owner Only)").
  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .single();
  if (membership?.role !== "owner") {
    throw new Error("Only the current owner can transfer ownership.");
  }

  // Two different rows (different user_id) of the same table -- no shared
  // state between them, safe to run together.
  //
  // custom_permissions: null on the demote side -- getEffectivePermissions
  // never reads an owner's custom_permissions (role === "owner" always
  // resolves to every page, regardless of what's stored), so whatever value
  // happened to be sitting in this column before they became owner (or
  // simply predates a page later being added to PERMISSION_PAGE_KEYS) has
  // been completely dormant and harmless this whole time. The moment this
  // update lands and their role becomes "admin", that same stale value
  // would otherwise turn live and enforced for the first time, potentially
  // hiding whole pages (e.g. Assets) despite Admin's own default preset
  // being every page too -- same "role change must not leave stale
  // permissions behind" atomicity updateMemberRole's applyPreset already
  // guarantees for every other role change, just missing here until now.
  const [{ error: demoteError }, { error: promoteError }] = await Promise.all([
    supabase
      .from("project_members")
      .update({ role: "admin", custom_permissions: null })
      .eq("project_id", projectId)
      .eq("user_id", user.id),
    supabase
      .from("project_members")
      .update({ role: "owner" })
      .eq("project_id", projectId)
      .eq("user_id", newOwnerUserId),
  ]);
  if (demoteError) throw new Error(demoteError.message);
  if (promoteError) throw new Error(promoteError.message);

  await logActivity(supabase, projectId, user.id, "transferred project ownership");

  // Not revalidating -- its one caller (TeamMemberRow's
  // handleTransferOwnership) already calls router.refresh() itself right
  // after this resolves.
}
