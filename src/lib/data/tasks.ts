import { createClient } from "@/lib/supabase/server";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import type { TaskStatus } from "@/types/database";

export type TaskSource = "manual" | "auto";
export type TaskSourceRef = { type: "post" | "story"; id: string } | null;

export type TaskItem = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  projectAvatarUrl: string | null;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  source: TaskSource;
  sourceRef: TaskSourceRef;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
};

export type TeamMember = { id: string; name: string; avatarUrl: string | null };

export type TaskWorkspaceData = {
  tasks: TaskItem[];
  projectsById: Map<string, { id: string; name: string; avatarUrl: string | null }>;
  membersByProject: Map<string, TeamMember[]>;
};

// The one real query layer for `tasks` -- everywhere else that touches this
// table (Overview's "due today" widget, post/story editors' "Add to To-Do")
// stays project-scoped and queries directly, but this page is genuinely
// cross-project, so it needs the full picture RLS is willing to hand back.
export async function getTasksForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<TaskWorkspaceData> {
  // taskRows has no explicit project_id/user_id filter (RLS alone returns
  // the visible set), so it's independent of memberships -- both run in the
  // same wave instead of the task read waiting on the membership read.
  const [{ data: memberships }, { data: taskRows }] = await Promise.all([
    supabase
      .from("project_members")
      .select("project_id, user_id, projects(id, name, profile_photo_path), profiles(name, avatar_url)")
      .eq("user_id", userId),
    supabase
      .from("tasks")
      .select("id, user_id, project_id, title, due_date, status, assignee_id, source_type, source_id, created_at, updated_at")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
  ]);

  const projectIds = Array.from(
    new Set((memberships ?? []).map((m) => m.project_id).filter((id): id is string => Boolean(id))),
  );

  const projectRows = new Map<string, { id: string; name: string; profile_photo_path: string | null }>();
  for (const m of memberships ?? []) {
    const project = m.projects as { id: string; name: string; profile_photo_path: string | null } | null;
    if (project) projectRows.set(project.id, project);
  }
  const projectPhotoPaths = Array.from(projectRows.values())
    .map((p) => p.profile_photo_path)
    .filter((p): p is string => Boolean(p));

  const rows = taskRows ?? [];
  const assigneeIds = Array.from(new Set(rows.map((t) => t.assignee_id).filter((id): id is string => Boolean(id))));
  const taskIds = rows.map((t) => t.id);

  // Four independent reads, all derived from the memberships/taskRows wave
  // above: allMemberRows needs projectIds, projectUrlByPath needs
  // projectPhotoPaths (same profile_photo_path -> signed URL resolution as
  // nav-data.ts's own project switcher -- getCachedSignedUrls means this
  // reuses the exact same cache entry nav-data.ts/Grid/Overview already
  // populated for this path, instead of minting yet another signed URL for
  // the same file), assigneeProfiles needs assigneeIds, commentRows needs
  // taskIds -- none of the four need each other's result.
  const [{ data: allMemberRows }, projectUrlByPath, { data: assigneeProfiles }, { data: commentRows }] =
    await Promise.all([
      projectIds.length
        ? supabase
            .from("project_members")
            .select("project_id, user_id, profiles(name, avatar_url)")
            .in("project_id", projectIds)
        : Promise.resolve({ data: [] }),
      getCachedSignedUrls(supabase, "project-media", projectPhotoPaths),
      assigneeIds.length
        ? supabase.from("profiles").select("id, name, avatar_url").in("id", assigneeIds)
        : Promise.resolve({ data: [] }),
      taskIds.length
        ? supabase.from("task_comments").select("task_id").in("task_id", taskIds)
        : Promise.resolve({ data: [] }),
    ]);

  const projectsById = new Map<string, { id: string; name: string; avatarUrl: string | null }>();
  for (const project of projectRows.values()) {
    projectsById.set(project.id, {
      id: project.id,
      name: project.name,
      avatarUrl: project.profile_photo_path ? projectUrlByPath.get(project.profile_photo_path) ?? null : null,
    });
  }

  const membersByProject = new Map<string, TeamMember[]>();
  for (const row of allMemberRows ?? []) {
    const profile = row.profiles as { name: string | null; avatar_url: string | null } | null;
    const member: TeamMember = {
      id: row.user_id,
      name: profile?.name ?? "Unknown",
      avatarUrl: profile?.avatar_url ?? null,
    };
    const list = membersByProject.get(row.project_id) ?? [];
    list.push(member);
    membersByProject.set(row.project_id, list);
  }

  const assigneeById = new Map<string, TeamMember>();
  for (const p of assigneeProfiles ?? []) {
    assigneeById.set(p.id, { id: p.id, name: p.name ?? "Unknown", avatarUrl: p.avatar_url ?? null });
  }

  const commentCountByTask = new Map<string, number>();
  for (const c of commentRows ?? []) {
    commentCountByTask.set(c.task_id, (commentCountByTask.get(c.task_id) ?? 0) + 1);
  }

  const tasks: TaskItem[] = rows.map((t) => {
    const sourceRef: TaskSourceRef =
      t.source_type !== "manual" && t.source_id ? { type: t.source_type as "post" | "story", id: t.source_id } : null;
    return {
      id: t.id,
      projectId: t.project_id,
      projectName: t.project_id ? (projectsById.get(t.project_id)?.name ?? null) : null,
      projectAvatarUrl: t.project_id ? (projectsById.get(t.project_id)?.avatarUrl ?? null) : null,
      title: t.title,
      status: t.status,
      dueDate: t.due_date,
      source: t.source_type === "manual" ? "manual" : "auto",
      sourceRef,
      assignee: t.assignee_id ? (assigneeById.get(t.assignee_id) ?? null) : null,
      createdBy: t.user_id,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      commentCount: commentCountByTask.get(t.id) ?? 0,
    };
  });

  return { tasks, projectsById, membersByProject };
}

export type TaskCommentItem = {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  text: string;
  createdAt: string;
};

export async function getTaskComments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: string,
): Promise<TaskCommentItem[]> {
  const { data } = await supabase
    .from("task_comments")
    .select("id, task_id, author_id, text, created_at, profiles(name, avatar_url)")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  return (data ?? []).map((c) => {
    const profile = c.profiles as { name: string | null; avatar_url: string | null } | null;
    return {
      id: c.id,
      taskId: c.task_id,
      authorId: c.author_id,
      authorName: profile?.name ?? "Unknown",
      authorAvatarUrl: profile?.avatar_url ?? null,
      text: c.text,
      createdAt: c.created_at,
    };
  });
}
