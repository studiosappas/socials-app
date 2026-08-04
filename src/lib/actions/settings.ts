"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SettingsActionState = { message?: string; success?: boolean } | undefined;

export async function updateAccountProfile(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "Not signed in." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { message: "Name is required." };

  const update: { name: string; avatar_url?: string } = { name };

  const photo = formData.get("avatar");
  if (photo instanceof File && photo.size > 0) {
    const ext = photo.name.includes(".") ? photo.name.split(".").pop() : undefined;
    const storagePath = `${user.id}/avatar${ext ? `.${ext}` : ""}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(storagePath, photo, { contentType: photo.type, upsert: true });
    if (uploadError) return { message: uploadError.message };

    const { data } = supabase.storage.from("avatars").getPublicUrl(storagePath);
    update.avatar_url = data.publicUrl;
  }

  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) return { message: error.message };

  revalidatePath("/", "layout");
  return { success: true };
}

export async function updateAccountEmail(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { message: "Email is required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email });
  if (error) return { message: error.message };

  return { success: true, message: "Check your inbox to confirm the new email address." };
}

export async function updateAccountPassword(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (password.length < 8) return { message: "Password must be at least 8 characters." };
  if (password !== confirmPassword) return { message: "Passwords don't match." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { message: error.message };

  return { success: true };
}

export async function updateProjectSettings(
  projectId: string,
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { message: "Project name is required." };
  const platform = String(formData.get("platform") ?? "instagram") as "instagram" | "tiktok";

  const supabase = await createClient();
  const { error } = await supabase.from("projects").update({ name, platform }).eq("id", projectId);
  if (error) return { message: error.message };

  revalidatePath(`/projects/${projectId}`, "layout");
  return { success: true };
}

export async function updateProjectPreferences(
  projectId: string,
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ show_scheduled_dates: formData.get("show_scheduled_dates") === "on" })
    .eq("id", projectId);
  if (error) return { message: error.message };

  revalidatePath(`/projects/${projectId}/grid`);
  return { success: true };
}
