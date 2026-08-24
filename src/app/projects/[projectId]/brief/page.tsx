import { createClient } from "@/lib/supabase/server";
import { getBrandMoodboard } from "@/lib/data/brand-moodboard";
import { hasPagePermission } from "@/lib/role-permissions";
import { BriefBoard, type BriefTaskData } from "./brief-board";
import { AccessRestricted } from "../access-restricted";

export default async function BriefPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  // brandMoodboard needs only projectId, not the user/membership chain below
  // -- fetched in the same wave as auth.getUser() instead of after everything
  // else resolves.
  const [
    {
      data: { user },
    },
    brandMoodboard,
  ] = await Promise.all([supabase.auth.getUser(), getBrandMoodboard(supabase, projectId)]);

  // Both only need projectId/user.id (already resolved above), not each
  // other's result.
  const [{ data: membership }, { data: tasks }] = await Promise.all([
    supabase
      .from("project_members")
      .select("role, custom_permissions")
      .eq("project_id", projectId)
      .eq("user_id", user!.id)
      .single(),
    supabase
      .from("brief_tasks")
      .select("id, name, content_types, position")
      .eq("project_id", projectId)
      .order("position"),
  ]);

  if (!membership || !hasPagePermission(membership.role, membership.custom_permissions, "brief")) {
    return <AccessRestricted />;
  }

  const canManage = membership.role === "owner" || membership.role === "admin";
  const taskIds = (tasks ?? []).map((t) => t.id);

  // Fetched as flat, independent queries (rather than a nested embed) so a
  // pending migration on one table degrades that section gracefully instead
  // of failing the whole page's select. `status` (a newer column) stays its
  // own isolated select for the same reason -- same reasoning as the
  // folder_id isolation in stories/page.tsx -- just run alongside the other
  // three now instead of before them.
  const [{ data: statusRows }, { data: items }, { data: frames }, { data: attachments }] =
    taskIds.length === 0
      ? [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]
      : await Promise.all([
          supabase.from("brief_tasks").select("id, status").in("id", taskIds),
          supabase
            .from("brief_task_items")
            .select("id, task_id, section, kind, url, label, notes, attachment_id, position")
            .in("task_id", taskIds)
            .order("position"),
          supabase
            .from("brief_task_frames")
            .select("id, task_id, section, label, body, position")
            .in("task_id", taskIds)
            .order("position"),
          supabase
            .from("brief_attachments")
            .select("id, original_storage_path, preview_storage_path, annotation_json")
            .eq("project_id", projectId),
        ]);
  const statusByTask = new Map((statusRows ?? []).map((r) => [r.id, r.status]));

  const attachmentById = new Map((attachments ?? []).map((a) => [a.id, a]));

  function publicUrl(path: string) {
    return supabase.storage.from("brief-media").getPublicUrl(path).data.publicUrl;
  }

  const taskData: BriefTaskData[] = (tasks ?? []).map((task) => ({
    id: task.id,
    name: task.name,
    contentTypes: task.content_types,
    status: statusByTask.get(task.id) ?? "draft",
    items: (items ?? [])
      .filter((item) => item.task_id === task.id)
      .map((item) => {
        const attachment = item.attachment_id ? attachmentById.get(item.attachment_id) : undefined;
        return {
          id: item.id,
          section: item.section,
          kind: item.kind,
          url: item.url,
          label: item.label,
          notes: item.notes,
          attachmentId: attachment?.id ?? null,
          thumbnailUrl: attachment
            ? publicUrl(attachment.preview_storage_path || attachment.original_storage_path)
            : null,
          originalUrl: attachment ? publicUrl(attachment.original_storage_path) : null,
          annotationJson: attachment?.annotation_json ?? null,
        };
      }),
    frames: (frames ?? [])
      .filter((frame) => frame.task_id === task.id)
      .map((frame) => ({
        id: frame.id,
        section: frame.section,
        label: frame.label,
        body: frame.body,
      })),
  }));

  return <BriefBoard projectId={projectId} tasks={taskData} canManage={canManage} brandMoodboard={brandMoodboard} />;
}
