"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ProjectRole } from "@/types/database";

export type InviteMemberState = { message?: string } | undefined;

export async function inviteMember(
  projectId: string,
  _state: InviteMemberState,
  formData: FormData,
): Promise<InviteMemberState> {
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "designer") as ProjectRole;
  if (!email) return { message: "Email is required." };

  const supabase = await createClient();
  const { data: userId, error: lookupError } = await supabase.rpc(
    "get_user_id_by_email",
    { p_email: email },
  );

  if (lookupError || !userId) {
    return { message: "No account found with that email — they need to register first." };
  }

  const { error } = await supabase
    .from("project_members")
    .upsert({ project_id: projectId, user_id: userId, role }, { onConflict: "project_id,user_id" });

  if (error) {
    return { message: error.message };
  }

  revalidatePath(`/projects/${projectId}/members`);
  return { message: undefined };
}

export async function removeMember(projectId: string, userId: string) {
  const supabase = await createClient();
  await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);

  revalidatePath(`/projects/${projectId}/members`);
}
