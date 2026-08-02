import { format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { TodoList, type ManualTask, type SyncedItem } from "./todo-list";

export default async function TodoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const today = format(new Date(), "yyyy-MM-dd");

  const [{ data: tasks }, { data: memberships }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, project_id, title, notes, due_date, completed, source_type, source_id")
      .eq("user_id", user!.id)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("project_members")
      .select("project_id, projects(id, name)")
      .eq("user_id", user!.id),
  ]);

  const projectNameById = new Map<string, string>();
  const projectIds: string[] = [];
  for (const m of memberships ?? []) {
    const project = m.projects as { id: string; name: string } | null;
    if (project) {
      projectNameById.set(project.id, project.name);
      projectIds.push(project.id);
    }
  }

  const [{ data: todaysPosts }, { data: todaysStories }] = await Promise.all([
    projectIds.length
      ? supabase
          .from("posts")
          .select("id, project_id, post_type, scheduled_date")
          .in("project_id", projectIds)
          .eq("scheduled_date", today)
      : Promise.resolve({ data: [] }),
    projectIds.length
      ? supabase
          .from("stories")
          .select("id, project_id, name, scheduled_date")
          .in("project_id", projectIds)
          .eq("scheduled_date", today)
      : Promise.resolve({ data: [] }),
  ]);

  const convertedSourceIds = new Set(
    (tasks ?? [])
      .filter((t) => t.source_type !== "manual" && t.source_id)
      .map((t) => `${t.source_type}-${t.source_id}`),
  );

  const syncedToday: SyncedItem[] = [
    ...(todaysPosts ?? [])
      .filter((p) => !convertedSourceIds.has(`post-${p.id}`))
      .map((p) => ({
        itemType: "post" as const,
        itemId: p.id,
        projectId: p.project_id,
        projectName: projectNameById.get(p.project_id) ?? "Untitled project",
        label: p.post_type,
        dueDate: p.scheduled_date as string,
        href: `/projects/${p.project_id}/posts/${p.id}`,
      })),
    ...(todaysStories ?? [])
      .filter((s) => !convertedSourceIds.has(`story-${s.id}`))
      .map((s) => ({
        itemType: "story" as const,
        itemId: s.id,
        projectId: s.project_id,
        projectName: projectNameById.get(s.project_id) ?? "Untitled project",
        label: s.name,
        dueDate: s.scheduled_date as string,
        href: `/projects/${s.project_id}/stories/${s.id}`,
      })),
  ];

  const manualTasks: ManualTask[] = (tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    dueDate: t.due_date,
    completed: t.completed,
    projectName: t.project_id ? (projectNameById.get(t.project_id) ?? null) : null,
    sourceType: t.source_type,
    href:
      t.source_type === "post"
        ? `/projects/${t.project_id}/posts/${t.source_id}`
        : t.source_type === "story"
          ? `/projects/${t.project_id}/stories/${t.source_id}`
          : null,
  }));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-8 py-16">
      <div className="flex flex-col gap-1">
        <p className="text-xs tracking-wide text-muted uppercase">Workspace</p>
        <h1 className="text-2xl font-light">To-Do</h1>
      </div>

      <TodoList today={today} manualTasks={manualTasks} syncedToday={syncedToday} />
    </main>
  );
}
