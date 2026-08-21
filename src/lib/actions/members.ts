"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-log";
import { notifyProjectMembers } from "@/lib/notifications";
import type { ProjectRole } from "@/types/database";

export type InviteMemberState = { message?: string } | undefined;

const VALID_ROLES: ProjectRole[] = ["admin", "editor", "viewer", "client"];

export async function inviteMember(
  projectId: string,
  _state: InviteMemberState,
  formData: FormData,
): Promise<InviteMemberState> {
  const email = String(formData.get("email") ?? "").trim();
  const roleRaw = String(formData.get("role") ?? "editor") as ProjectRole;
  const role: ProjectRole = VALID_ROLES.includes(roleRaw) ? roleRaw : "editor";
  if (!email) return { message: "Email is required." };

  // Empty selection means "use the role's default access," matching
  // updateMemberPermissions' own null-means-default convention.
  const permissions = formData.getAll("permissions").map(String);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: userId, error: lookupError } = await supabase.rpc(
    "get_user_id_by_email",
    { p_email: email },
  );

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

  if (permissions.length > 0) {
    await supabase
      .from("project_members")
      .update({ custom_permissions: permissions })
      .eq("project_id", projectId)
      .eq("user_id", userId);
  }

  if (user) await logActivity(supabase, projectId, user.id, `invited ${email} as ${role}`);

  const { data: project } = await supabase.from("projects").select("name").eq("id", projectId).single();
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
// already calls router.refresh() itself right after this resolves.
export async function removeMember(projectId: string, userId: string) {
  const supabase = await createClient();
  await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
}

// Not revalidating -- its one caller (TeamMemberRow's handleSaveEdit)
// already calls router.refresh() itself right after this resolves (along
// with updateMemberPermissions below, called in the same handler).
export async function updateMemberRole(projectId: string, userId: string, role: ProjectRole) {
  if (role === "owner") {
    throw new Error("Use transferOwnership to make someone the owner.");
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_members")
    .update({ role })
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

  const { error: demoteError } = await supabase
    .from("project_members")
    .update({ role: "admin" })
    .eq("project_id", projectId)
    .eq("user_id", user.id);
  if (demoteError) throw new Error(demoteError.message);

  const { error: promoteError } = await supabase
    .from("project_members")
    .update({ role: "owner" })
    .eq("project_id", projectId)
    .eq("user_id", newOwnerUserId);
  if (promoteError) throw new Error(promoteError.message);

  await logActivity(supabase, projectId, user.id, "transferred project ownership");

  // Not revalidating -- its one caller (TeamMemberRow's
  // handleTransferOwnership) already calls router.refresh() itself right
  // after this resolves.
}
