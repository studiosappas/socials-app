import { createClient } from "@/lib/supabase/server";
import { removeMember } from "@/lib/actions/members";
import { InviteForm } from "./invite-form";
import { ProjectSettingsPanel } from "./settings-panels";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: project }, { data: members }] = await Promise.all([
    supabase
      .from("projects")
      .select("name, platform, show_scheduled_dates")
      .eq("id", projectId)
      .single(),
    supabase.from("project_members").select("user_id, role, profiles(name)").eq("project_id", projectId),
  ]);

  const currentRole = members?.find((m) => m.user_id === user?.id)?.role;
  const canManage = currentRole === "owner" || currentRole === "admin";

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-1">
        <p className="text-xs tracking-wide text-muted uppercase">Settings</p>
        <h1 className="text-2xl font-light">Workspace</h1>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Workspace</h2>
        <ProjectSettingsPanel
          projectId={projectId}
          projectName={project?.name ?? ""}
          platform={project?.platform ?? "instagram"}
          showScheduledDates={project?.show_scheduled_dates ?? true}
          canManage={canManage}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Team</h2>
        {canManage && <InviteForm projectId={projectId} />}
        <ul className="flex flex-col divide-y divide-black/10">
          {(members ?? []).map((member) => (
            <li key={member.user_id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">{member.profiles?.name ?? "Unknown"}</p>
                <p className="text-xs uppercase text-muted">{member.role}</p>
              </div>
              {canManage && member.role !== "owner" && (
                <form action={removeMember.bind(null, projectId, member.user_id)}>
                  <button
                    type="submit"
                    className="text-sm text-error underline transition-colors duration-150 hover:text-error/70"
                  >
                    Remove
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
