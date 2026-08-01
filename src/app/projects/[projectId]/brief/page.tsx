import { createClient } from "@/lib/supabase/server";
import { BriefEditor } from "./brief-editor";

export default async function BriefPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user!.id)
    .single();

  const canManage = membership?.role === "owner" || membership?.role === "admin";

  const { data: brief } = await supabase
    .from("project_briefs")
    .select("body_json")
    .eq("project_id", projectId)
    .maybeSingle();

  return (
    <BriefEditor
      projectId={projectId}
      initialContent={brief?.body_json ?? null}
      canManage={canManage}
    />
  );
}
