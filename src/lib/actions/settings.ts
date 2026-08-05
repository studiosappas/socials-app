"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-log";
import { NOTIFICATION_EVENTS } from "@/lib/notification-events";

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
  const industry = String(formData.get("industry") ?? "").trim();
  const platformRaw = String(formData.get("platform") ?? "instagram");
  const platform: "instagram" | "tiktok" | "pinterest" | "youtube" =
    platformRaw === "tiktok" || platformRaw === "pinterest" || platformRaw === "youtube"
      ? platformRaw
      : "instagram";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("projects").update({ name, industry, platform }).eq("id", projectId);
  if (error) return { message: error.message };

  if (user) await logActivity(supabase, projectId, user.id, "updated project information");

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

// ---------------------------------------------------------------------------
// Notifications (Settings > Notifications) -- per-member preference toggles.
// No delivery mechanism (email/push) exists anywhere in this app yet, so
// these are stored preferences a future notifier would read, not something
// that sends anything today. Event list lives in lib/notification-events.ts,
// not here -- see that file for why.
// ---------------------------------------------------------------------------

export async function updateNotificationPrefs(
  projectId: string,
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "Not signed in." };

  const prefs: Record<string, boolean> = {};
  for (const event of NOTIFICATION_EVENTS) {
    prefs[event.key] = formData.get(event.key) === "on";
  }

  const { error } = await supabase
    .from("project_members")
    .update({ notification_prefs: prefs })
    .eq("project_id", projectId)
    .eq("user_id", user.id);
  if (error) return { message: error.message };

  revalidatePath(`/projects/${projectId}/settings/notifications`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Danger Zone
// ---------------------------------------------------------------------------

// A branding/settings-only copy -- name, platform, industry, posting
// cadence, notes -- not a full deep clone of Grid/Stories/Calendar/Brief
// content (dozens of related tables; a genuinely separate, larger feature
// if ever needed). Useful today as "start a new client from this one's setup."
export async function duplicateProject(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: source, error: fetchError } = await supabase
    .from("projects")
    .select(
      "name, brand_notes, platform, industry, content_pillars, posts_per_week, stories_per_week, reels_per_week, newsletter_per_week, show_scheduled_dates",
    )
    .eq("id", projectId)
    .single();

  if (fetchError || !source) {
    throw new Error(fetchError?.message ?? "Project not found.");
  }

  const { data: copy, error: insertError } = await supabase
    .from("projects")
    .insert({ ...source, name: `${source.name} (Copy)`, created_by: user.id })
    .select("id")
    .single();

  if (insertError || !copy) {
    throw new Error(insertError?.message ?? "Failed to duplicate project.");
  }

  // Same reasoning as createProject: the top nav's project list is fetched
  // in a layout segment the new project's own [projectId] segment doesn't
  // invalidate on its own.
  revalidatePath("/projects", "layout");
  redirect(`/projects/${copy.id}/grid`);
}

export async function archiveProject(projectId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update({ archived: true }).eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath("/projects", "layout");
  redirect("/projects");
}

export async function unarchiveProject(projectId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update({ archived: false }).eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/settings/danger`);
  revalidatePath("/projects", "layout");
}

// RLS ("Owners can delete their project") already restricts this to owners;
// cascading FKs across every project-scoped table remove the rest.
export async function deleteProjectPermanently(projectId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath("/projects", "layout");
  redirect("/projects");
}
