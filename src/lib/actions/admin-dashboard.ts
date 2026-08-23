"use server";

import { requireAdminServiceClient } from "@/lib/admin-auth";

// Windows chosen for reliability over precision -- there's no session/socket
// tracking here, only a ~90s heartbeat (see presence-heartbeat.tsx), so
// "active now" needs enough slack to not flicker a genuinely-open tab to
// offline between two heartbeats (worst case: a heartbeat fires, then the
// next one is delayed by a slow network -- 5 minutes comfortably covers
// that without also registering as "still active" someone who closed the
// tab a while ago.
const ACTIVE_NOW_WINDOW_MS = 5 * 60 * 1000;
const ACTIVE_TODAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_ACTIVITY_LIMIT = 30;
const ACTIVE_NOW_LIST_LIMIT = 20;
const USERS_LIST_LIMIT = 200;

export type AdminActiveUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  lastSeenAt: string;
};

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  isOnline: boolean;
  projectCount: number;
  mediaCount: number;
};

export type AdminProjectRow = {
  id: string;
  name: string;
  ownerName: string;
  ownerEmail: string;
  createdAt: string;
  mediaCount: number;
  postCount: number;
  storyCount: number;
  lastActivityAt: string | null;
};

export type AdminActivityItem = {
  id: string;
  kind: "project_created" | "media_uploaded" | "post_created" | "story_created" | "failure";
  label: string;
  detail: string | null;
  timestamp: string;
  severity: "error" | "warning" | null;
};

export type AdminSystemIssue = {
  id: string;
  createdAt: string;
  severity: "error" | "warning";
  category: string;
  area: string;
  message: string;
};

export type AdminDashboardData = {
  generatedAt: string;
  users: { total: number; activeNow: number; activeToday: number; newToday: number; newThisWeek: number };
  projects: { total: number; createdToday: number; createdThisWeek: number; avgPerUser: number };
  content: { totalPosts: number; totalStories: number; totalMedia: number; uploadsToday: number };
  activeNowUsers: AdminActiveUser[];
  usersList: AdminUserRow[];
  projectsList: AdminProjectRow[];
  recentActivity: AdminActivityItem[];
  systemHealth: { healthy: boolean; issuesLast24h: number; recentIssues: AdminSystemIssue[] };
};

// Everything the dashboard needs, in one call, run only when an admin
// actually opens /admin/dashboard (never during normal app navigation).
// Deliberately NOT split into one Server Action per module -- a single
// requireAdminServiceClient() check plus one round of parallel queries is
// both simpler and cheaper than re-checking admin status and re-opening a
// service-role client per section.
//
// Every query below selects only light, indexed/FK columns (ids, names,
// timestamps) and is fetched in full rather than aggregated with N+1
// per-user/per-project queries -- at this app's actual scale (an agency
// planning tool, not a consumer app with millions of rows) a handful of
// bulk selects plus in-memory aggregation is both simpler and faster than
// either approach, and it's bounded to run once per manual dashboard visit.
export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const supabase = await requireAdminServiceClient();

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const activeNowCutoff = new Date(now.getTime() - ACTIVE_NOW_WINDOW_MS);
  const activeTodayCutoff = new Date(now.getTime() - ACTIVE_TODAY_WINDOW_MS);

  const [
    { data: profiles },
    { data: presenceRows },
    { data: projectRows },
    { data: memberRows },
    { data: mediaRows },
    { data: postRows },
    { data: storyRows },
    { data: eventRows },
  ] = await Promise.all([
    supabase.from("profiles").select("id, name, email, avatar_url, created_at"),
    supabase.from("user_presence").select("user_id, last_seen_at"),
    supabase.from("projects").select("id, name, created_at, created_by"),
    supabase.from("project_members").select("project_id, user_id"),
    supabase.from("media_assets").select("id, project_id, uploaded_by, created_at"),
    supabase.from("posts").select("id, project_id, created_at"),
    supabase.from("stories").select("id, project_id, created_at"),
    supabase
      .from("system_events")
      .select("id, created_at, severity, category, area, message, project_id, user_id")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const users = profiles ?? [];
  const projects = projectRows ?? [];
  const members = memberRows ?? [];
  const media = mediaRows ?? [];
  const posts = postRows ?? [];
  const stories = storyRows ?? [];
  const events = eventRows ?? [];

  const presenceByUser = new Map((presenceRows ?? []).map((r) => [r.user_id, r.last_seen_at]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const projectNameById = new Map(projects.map((p) => [p.id, p.name ?? "Untitled project"]));

  // ---- Users ----
  const activeNowUsers: AdminActiveUser[] = [];
  let activeNowCount = 0;
  let activeTodayCount = 0;
  for (const u of users) {
    const lastSeenAt = presenceByUser.get(u.id);
    if (!lastSeenAt) continue;
    const seenAt = new Date(lastSeenAt);
    if (seenAt >= activeTodayCutoff) activeTodayCount += 1;
    if (seenAt >= activeNowCutoff) {
      activeNowCount += 1;
      activeNowUsers.push({
        id: u.id,
        name: u.name || "Unnamed",
        email: u.email ?? "",
        avatarUrl: u.avatar_url,
        lastSeenAt,
      });
    }
  }
  activeNowUsers.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

  const newUsersToday = users.filter((u) => new Date(u.created_at) >= todayStart).length;
  const newUsersThisWeek = users.filter((u) => new Date(u.created_at) >= weekStart).length;

  // ---- Projects per user / media per user ----
  const projectCountByUser = new Map<string, number>();
  for (const m of members) {
    projectCountByUser.set(m.user_id, (projectCountByUser.get(m.user_id) ?? 0) + 1);
  }
  const mediaCountByUser = new Map<string, number>();
  const mediaCountByProject = new Map<string, number>();
  for (const m of media) {
    if (m.uploaded_by) mediaCountByUser.set(m.uploaded_by, (mediaCountByUser.get(m.uploaded_by) ?? 0) + 1);
    mediaCountByProject.set(m.project_id, (mediaCountByProject.get(m.project_id) ?? 0) + 1);
  }
  const postCountByProject = new Map<string, number>();
  for (const p of posts) postCountByProject.set(p.project_id, (postCountByProject.get(p.project_id) ?? 0) + 1);
  const storyCountByProject = new Map<string, number>();
  for (const s of stories) storyCountByProject.set(s.project_id, (storyCountByProject.get(s.project_id) ?? 0) + 1);

  const lastActivityByProject = new Map<string, string>();
  function trackLastActivity(projectId: string, timestamp: string) {
    const current = lastActivityByProject.get(projectId);
    if (!current || new Date(timestamp) > new Date(current)) lastActivityByProject.set(projectId, timestamp);
  }
  for (const m of media) trackLastActivity(m.project_id, m.created_at);
  for (const p of posts) trackLastActivity(p.project_id, p.created_at);
  for (const s of stories) trackLastActivity(s.project_id, s.created_at);

  const usersList: AdminUserRow[] = users
    .map((u) => {
      const lastSeenAt = presenceByUser.get(u.id) ?? null;
      return {
        id: u.id,
        name: u.name || "Unnamed",
        email: u.email ?? "",
        avatarUrl: u.avatar_url,
        createdAt: u.created_at,
        lastSeenAt,
        isOnline: lastSeenAt !== null && new Date(lastSeenAt) >= activeNowCutoff,
        projectCount: projectCountByUser.get(u.id) ?? 0,
        mediaCount: mediaCountByUser.get(u.id) ?? 0,
      };
    })
    .sort((a, b) => {
      const aTime = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
      const bTime = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, USERS_LIST_LIMIT);

  // ---- Projects ----
  const projectsList: AdminProjectRow[] = projects
    .map((p) => {
      const owner = userById.get(p.created_by);
      return {
        id: p.id,
        name: p.name || "Untitled project",
        ownerName: owner?.name || "Unknown",
        ownerEmail: owner?.email ?? "",
        createdAt: p.created_at,
        mediaCount: mediaCountByProject.get(p.id) ?? 0,
        postCount: postCountByProject.get(p.id) ?? 0,
        storyCount: storyCountByProject.get(p.id) ?? 0,
        lastActivityAt: lastActivityByProject.get(p.id) ?? null,
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const projectsToday = projects.filter((p) => new Date(p.created_at) >= todayStart).length;
  const projectsThisWeek = projects.filter((p) => new Date(p.created_at) >= weekStart).length;
  const avgPerUser = users.length > 0 ? Math.round((members.length / users.length) * 10) / 10 : 0;

  const uploadsToday = media.filter((m) => new Date(m.created_at) >= todayStart).length;

  // ---- Recent activity (merged from existing timestamps + failure log) ----
  const activity: AdminActivityItem[] = [];
  for (const p of projects) {
    const owner = userById.get(p.created_by);
    activity.push({
      id: `project-${p.id}`,
      kind: "project_created",
      label: `${owner?.name ?? "Someone"} created "${p.name ?? "Untitled project"}"`,
      detail: null,
      timestamp: p.created_at,
      severity: null,
    });
  }
  for (const m of media) {
    activity.push({
      id: `media-${m.id}`,
      kind: "media_uploaded",
      label: `Media uploaded in ${projectNameById.get(m.project_id) ?? "a project"}`,
      detail: null,
      timestamp: m.created_at,
      severity: null,
    });
  }
  for (const p of posts) {
    activity.push({
      id: `post-${p.id}`,
      kind: "post_created",
      label: `Post created in ${projectNameById.get(p.project_id) ?? "a project"}`,
      detail: null,
      timestamp: p.created_at,
      severity: null,
    });
  }
  for (const s of stories) {
    activity.push({
      id: `story-${s.id}`,
      kind: "story_created",
      label: `Story created in ${projectNameById.get(s.project_id) ?? "a project"}`,
      detail: null,
      timestamp: s.created_at,
      severity: null,
    });
  }
  for (const e of events) {
    activity.push({
      id: `event-${e.id}`,
      kind: "failure",
      label: e.message,
      detail: `${e.area} · ${e.category}`,
      timestamp: e.created_at,
      severity: e.severity,
    });
  }
  activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const recentActivity = activity.slice(0, RECENT_ACTIVITY_LIMIT);

  // ---- System health ----
  const issuesLast24h = events.filter((e) => new Date(e.created_at) >= last24h).length;
  const recentIssues: AdminSystemIssue[] = events.slice(0, 10).map((e) => ({
    id: e.id,
    createdAt: e.created_at,
    severity: e.severity,
    category: e.category,
    area: e.area,
    message: e.message,
  }));

  return {
    generatedAt: now.toISOString(),
    users: {
      total: users.length,
      activeNow: activeNowCount,
      activeToday: activeTodayCount,
      newToday: newUsersToday,
      newThisWeek: newUsersThisWeek,
    },
    projects: {
      total: projects.length,
      createdToday: projectsToday,
      createdThisWeek: projectsThisWeek,
      avgPerUser,
    },
    content: {
      totalPosts: posts.length,
      totalStories: stories.length,
      totalMedia: media.length,
      uploadsToday,
    },
    activeNowUsers: activeNowUsers.slice(0, ACTIVE_NOW_LIST_LIMIT),
    usersList,
    projectsList,
    recentActivity,
    systemHealth: {
      healthy: issuesLast24h === 0,
      issuesLast24h,
      recentIssues,
    },
  };
}
