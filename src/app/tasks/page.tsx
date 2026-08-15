import { addDays, format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { getTasksForUser, type TeamMember } from "@/lib/data/tasks";
import { mergePreferences } from "@/lib/account-settings";
import { TaskWorkspace } from "./task-workspace";

export default async function TodoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const today = format(new Date(), "yyyy-MM-dd");
  const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");

  const { tasks, projectsById, membersByProject } = await getTasksForUser(supabase, user!.id);

  const { data: profile } = await supabase.from("profiles").select("preferences").eq("id", user!.id).single();
  const { interface: interfacePrefs } = mergePreferences(profile?.preferences);

  // Maps aren't serializable across the server/client component boundary --
  // flatten to a plain array + a plain object keyed by project id.
  const projects = Array.from(projectsById.values());
  const membersByProjectPlain: Record<string, TeamMember[]> = {};
  for (const [projectId, members] of membersByProject) {
    membersByProjectPlain[projectId] = members;
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-8 py-16">
      <div className="flex flex-col gap-1">
        <p className="text-xs tracking-wide text-muted uppercase">Workspace</p>
        <h1 className="text-2xl font-light">Tasks</h1>
      </div>

      <TaskWorkspace
        currentUserId={user!.id}
        tasks={tasks}
        projects={projects}
        membersByProject={membersByProjectPlain}
        today={today}
        tomorrow={tomorrow}
        autoExpandComments={interfacePrefs.auto_expand_comments}
      />
    </main>
  );
}
