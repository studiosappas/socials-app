// Single source of truth for the Account page's Workspace & Preferences
// sections -- both the server actions (validation) and the UI (option
// lists, defaults) import from here, the same centralizing role
// notification-events.ts already plays for per-project notification prefs.
//
// Not every field here changes real app behavior yet -- see the inline
// notes below. Each one still saves and loads correctly; "not yet consumed"
// just means no other part of the app reads it back out yet, the same
// "reserved" state a few notification-events.ts event keys are already in.

import type { createClient } from "@/lib/supabase/server";

export type WorkspaceSettings = {
  language: string;
  timezone: string;
  date_format: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  // 0 = Sunday, 1 = Monday -- REAL: drives Calendar's month grid.
  week_starts_on: 0 | 1;
  // REAL for "projects"/"todo" (unambiguous global routes). "calendar" /
  // "grid" / "overview" redirect into the user's most-recently-created
  // project, since those pages don't exist without one.
  default_landing_page: "projects" | "todo" | "calendar" | "grid" | "overview";
};

export type UserPreferences = {
  // REAL, app-wide -- see globals.css's data-theme rules + layout.tsx.
  theme: "light" | "dark";
  notifications: {
    email: boolean; // not yet consumed -- no email sender exists in this app
    in_app: boolean; // REAL -- master switch, checked in lib/notifications.ts
    task_assignments: boolean; // not yet consumed -- no notify call fires on assignment today
    client_review: boolean; // REAL -- gates the existing "review_comment" event
    ai_generation: boolean; // REAL -- gates the existing "ai_analysis_complete" event
    daily_summary: boolean; // not yet consumed -- no scheduled-job system exists
  };
  calendar: {
    default_view: "month"; // not yet consumed -- Calendar only has one view today
    show_weekends: boolean; // REAL -- filters weekend columns out of Calendar's grid
  };
  interface: {
    compact_mode: boolean; // not yet consumed
    reduce_motion: boolean; // REAL, app-wide -- same data-attribute mechanism as theme
    show_ai_tips: boolean; // not yet consumed -- no "AI tip" UI exists to gate
    auto_expand_comments: boolean; // REAL -- Tasks page's comment thread default
  };
};

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  language: "en",
  timezone: "UTC",
  date_format: "MM/DD/YYYY",
  week_starts_on: 0,
  default_landing_page: "projects",
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "light",
  notifications: {
    email: true,
    in_app: true,
    task_assignments: true,
    client_review: true,
    ai_generation: true,
    daily_summary: false,
  },
  calendar: {
    default_view: "month",
    show_weekends: true,
  },
  interface: {
    compact_mode: false,
    reduce_motion: false,
    show_ai_tips: true,
    auto_expand_comments: false,
  },
};

export function mergeWorkspaceSettings(saved: unknown): WorkspaceSettings {
  const s = (saved ?? {}) as Partial<WorkspaceSettings>;
  return { ...DEFAULT_WORKSPACE_SETTINGS, ...s };
}

export function mergePreferences(saved: unknown): UserPreferences {
  const p = (saved ?? {}) as Partial<UserPreferences>;
  return {
    ...DEFAULT_PREFERENCES,
    ...p,
    notifications: { ...DEFAULT_PREFERENCES.notifications, ...p.notifications },
    calendar: { ...DEFAULT_PREFERENCES.calendar, ...p.calendar },
    interface: { ...DEFAULT_PREFERENCES.interface, ...p.interface },
  };
}

export const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "he", label: "Hebrew" },
];

export const DATE_FORMAT_OPTIONS: { value: WorkspaceSettings["date_format"]; label: string }[] = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
];

export const LANDING_PAGE_OPTIONS: { value: WorkspaceSettings["default_landing_page"]; label: string }[] = [
  { value: "projects", label: "Projects" },
  { value: "calendar", label: "Calendar" },
  { value: "grid", label: "Grid" },
  { value: "overview", label: "Overview" },
  { value: "todo", label: "To Do" },
];

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Shared by the post-login redirect (lib/actions/auth.ts) AND the app
// header's logo link (see app-header.tsx's homeHref prop) -- both need "where
// does this user's Default Home Page setting actually point," so it lives
// here once rather than drifting into two separate implementations.
//
// "projects" and "todo" are real, unambiguous global routes. The other
// three (calendar/grid/overview) are per-project pages -- there's no single
// right answer for a user in multiple projects, so this picks their most
// recently created one, the same "most recent first" ordering nav-data.ts's
// own project list already uses. Falls back to /projects for a user who
// isn't in any project yet (nothing to land on otherwise).
export async function resolveLandingPath(supabase: SupabaseServerClient, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("workspace_settings")
    .eq("id", userId)
    .single();
  const { default_landing_page: page } = mergeWorkspaceSettings(profile?.workspace_settings);

  if (page === "projects") return "/projects";
  if (page === "todo") return "/tasks";

  const { data: memberships } = await supabase
    .from("project_members")
    .select("project_id, projects(created_at)")
    .eq("user_id", userId);
  const [mostRecent] = (memberships ?? [])
    .filter((m): m is typeof m & { projects: { created_at: string } } => Boolean(m.projects))
    .sort((a, b) => (a.projects.created_at < b.projects.created_at ? 1 : -1));
  if (!mostRecent) return "/projects";

  const subPath = page === "grid" ? "grid" : page === "calendar" ? "calendar" : "";
  return `/projects/${mostRecent.project_id}${subPath ? `/${subPath}` : ""}`;
}
