import { getSettingsAccess } from "@/lib/settings-access";
import { DangerPanel } from "./danger-panel";

const labelClass = "text-xs tracking-wide text-muted uppercase";

export default async function DangerZonePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, canManage, isOwner } = await getSettingsAccess(projectId);

  const { data: project } = await supabase.from("projects").select("name").eq("id", projectId).single();

  if (!canManage) {
    return <p className="text-sm text-muted">Only project owners and admins can access the Danger Zone.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className={labelClass}>Danger Zone</h2>
      <DangerPanel projectId={projectId} projectName={project?.name ?? "this project"} isOwner={isOwner} />
    </div>
  );
}
