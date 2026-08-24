import { getSettingsAccess } from "@/lib/settings-access";
import { ProjectInformationPanel } from "./project-information-panel";
import { AccessRestricted } from "../access-restricted";

export default async function ProjectInformationPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, canManage, hasSettingsAccess } = await getSettingsAccess(projectId);

  if (!hasSettingsAccess) {
    return <AccessRestricted />;
  }

  const [{ data: project }, { data: ownerRow }] = await Promise.all([
    supabase
      .from("projects")
      .select("name, industry, platform, created_at")
      .eq("id", projectId)
      .single(),
    supabase
      .from("project_members")
      .select("user_id, profiles(name)")
      .eq("project_id", projectId)
      .eq("role", "owner")
      .maybeSingle(),
  ]);

  // profiles.email is fetched in its own isolated query, same reasoning as
  // Grid's cover_transform/preview_storage_path isolation elsewhere: it's a
  // newer column that may not exist yet on a not-yet-migrated database, and
  // PostgREST fails an ENTIRE select (including the embedded profiles(name)
  // above) if any requested column is missing -- isolating it means a
  // pending migration only means "Owner Email" is blank, not that this
  // whole page 500s.
  const ownerUserId = ownerRow?.user_id;
  const { data: ownerEmailRow } = ownerUserId
    ? await supabase.from("profiles").select("email").eq("id", ownerUserId).maybeSingle()
    : { data: null };

  const owner = ownerRow?.profiles ?? null;
  const ownerEmail = (ownerEmailRow as { email: string | null } | null)?.email ?? null;
  const createdDate = project?.created_at
    ? new Date(project.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <ProjectInformationPanel
      projectId={projectId}
      projectName={project?.name ?? ""}
      industry={project?.industry ?? ""}
      platform={project?.platform ?? "instagram"}
      ownerName={owner?.name ?? "—"}
      ownerEmail={ownerEmail ?? "—"}
      createdDate={createdDate}
      canManage={canManage}
    />
  );
}
