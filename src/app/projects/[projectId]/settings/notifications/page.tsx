import { getSettingsAccess } from "@/lib/settings-access";
import { NotificationsPanel } from "./notifications-panel";

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, user } = await getSettingsAccess(projectId);

  const { data: membership } = await supabase
    .from("project_members")
    .select("notification_prefs")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .single();

  return (
    <NotificationsPanel
      projectId={projectId}
      prefs={(membership?.notification_prefs as Record<string, boolean>) ?? {}}
    />
  );
}
