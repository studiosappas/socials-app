"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-log";
import { NOTIFICATION_EVENTS } from "@/lib/notification-events";
import {
  DATE_FORMAT_OPTIONS,
  LANDING_PAGE_OPTIONS,
  type UserPreferences,
  type WorkspaceSettings,
} from "@/lib/account-settings";

export type SettingsActionState = { message?: string; success?: boolean } | undefined;

// One action for the whole Profile card (name, avatar, email) behind a
// single "Save Changes" button -- previously three separate forms/buttons.
// Avatar removal and a new upload are mutually exclusive from the client
// (see account-panel.tsx), so only one of remove_avatar/avatar is ever
// actually acted on here.
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

  const update: { name: string; avatar_url?: string | null } = { name };

  // The photo itself already went direct browser-to-Storage before this
  // action ever runs (same ${userId}/avatar.ext + upsert:true path this
  // action used to build itself, see account-panel.tsx's handleSubmit) --
  // this only ever receives the resulting storage path, never the raw file.
  const avatarStoragePath = formData.get("avatar_storage_path");
  if (typeof avatarStoragePath === "string" && avatarStoragePath) {
    const { data } = supabase.storage.from("avatars").getPublicUrl(avatarStoragePath);
    update.avatar_url = data.publicUrl;
  } else if (formData.get("remove_avatar") === "true") {
    update.avatar_url = null;
  }

  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) return { message: error.message };

  // Email changes don't take effect immediately (Supabase emails a
  // confirmation link to both the old and new address) -- only fire this
  // when it's actually different from the current one, so re-saving the
  // Profile card for an unrelated name/avatar change doesn't re-trigger a
  // confirmation email every time.
  let message: string | undefined;
  const email = String(formData.get("email") ?? "").trim();
  if (email && email !== user.email) {
    const { error: emailError } = await supabase.auth.updateUser({ email });
    if (emailError) return { message: emailError.message };
    message = "Profile updated. Check your inbox to confirm your new email address.";
  }

  // Narrowed from a blanket revalidatePath("/", "layout") -- the Account
  // page itself never needed it (ProfileCard already shows the saved
  // name/email/avatar from its own local state, never from a fresh server
  // prop). Name/avatar are genuinely read elsewhere though: Team Settings'
  // member list and every comment thread (Brief/Story under /projects,
  // Task under /tasks) show this profile's name/avatar_url live.
  revalidatePath("/projects", "layout");
  revalidatePath("/tasks");
  return { success: true, message };
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

// ---------------------------------------------------------------------------
// Account > Workspace & Preferences -- see src/lib/account-settings.ts for
// the shared types/defaults/option lists both these actions and the UI
// (account-panel.tsx) read from, so they can't drift apart.
// ---------------------------------------------------------------------------

export async function updateWorkspaceSettings(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "Not signed in." };

  const dateFormat = String(formData.get("date_format") ?? "");
  if (!DATE_FORMAT_OPTIONS.some((o) => o.value === dateFormat)) {
    return { message: "Invalid date format." };
  }
  const landingPage = String(formData.get("default_landing_page") ?? "");
  if (!LANDING_PAGE_OPTIONS.some((o) => o.value === landingPage)) {
    return { message: "Invalid default landing page." };
  }
  const weekStartsOn = formData.get("week_starts_on") === "1" ? 1 : 0;

  const settings: WorkspaceSettings = {
    language: String(formData.get("language") ?? "en"),
    timezone: String(formData.get("timezone") ?? "UTC").trim() || "UTC",
    date_format: dateFormat as WorkspaceSettings["date_format"],
    week_starts_on: weekStartsOn,
    default_landing_page: landingPage as WorkspaceSettings["default_landing_page"],
  };

  const { error } = await supabase.from("profiles").update({ workspace_settings: settings }).eq("id", user.id);
  if (error) return { message: error.message };

  // Narrowed from a blanket revalidatePath("/", "layout") -- the Account
  // page itself never needed it (WorkspaceCard is fully controlled local
  // state). The one real external consumer is Calendar's week_starts_on
  // (see calendar/page.tsx), which lives under /projects.
  revalidatePath("/projects", "layout");
  return { success: true };
}

export async function updatePreferences(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "Not signed in." };

  const themeValue: UserPreferences["theme"] = formData.get("theme") === "dark" ? "dark" : "light";
  const checked = (key: string) => formData.get(key) === "on";

  const preferences: UserPreferences = {
    theme: themeValue,
    notifications: {
      email: checked("notif_email"),
      in_app: checked("notif_in_app"),
      task_assignments: checked("notif_task_assignments"),
      client_review: checked("notif_client_review"),
      ai_generation: checked("notif_ai_generation"),
      daily_summary: checked("notif_daily_summary"),
    },
    calendar: {
      default_view: "month",
      show_weekends: checked("calendar_show_weekends"),
    },
    interface: {
      compact_mode: checked("interface_compact_mode"),
      reduce_motion: checked("interface_reduce_motion"),
      show_ai_tips: checked("interface_show_ai_tips"),
      auto_expand_comments: checked("interface_auto_expand_comments"),
    },
  };

  const { error } = await supabase.from("profiles").update({ preferences }).eq("id", user.id);
  if (error) return { message: error.message };

  // Read on the very next request by layout.tsx's <html data-theme>/
  // data-reduce-motion -- keeps the change visible immediately without
  // waiting on anything else. 1 year: this is a preference, not a session,
  // and re-saving already refreshes it every time the user changes it.
  const cookieStore = await cookies();
  cookieStore.set(
    "theme_prefs",
    JSON.stringify({ theme: preferences.theme, reduce_motion: preferences.interface.reduce_motion }),
    { maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax" },
  );

  // Narrowed from a blanket revalidatePath("/", "layout") -- the Account
  // page itself never needed it (PreferencesCard is fully controlled local
  // state), and theme/reduce_motion are already picked up on the very next
  // request via the theme_prefs cookie set above, independent of any
  // revalidation. The one real external consumer is /tasks'
  // auto_expand_comments (see task-workspace.tsx/task-detail.tsx).
  revalidatePath("/tasks");
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

  // Not revalidating -- its one caller (NotificationsPanel) uses
  // uncontrolled checkboxes that already show the saved state, and these
  // prefs are otherwise only read server-side (notifyProjectMembers/
  // notifyMentions), never rendered on any other page.
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
