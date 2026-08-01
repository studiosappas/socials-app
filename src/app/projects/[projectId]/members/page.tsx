import { createClient } from "@/lib/supabase/server";
import { removeMember } from "@/lib/actions/members";
import { InviteForm } from "./invite-form";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: members } = await supabase
    .from("project_members")
    .select("user_id, role, profiles(name)")
    .eq("project_id", projectId);

  const currentRole = members?.find((m) => m.user_id === user?.id)?.role;
  const canManage = currentRole === "owner" || currentRole === "admin";

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Members</h2>

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
                <button type="submit" className="text-sm text-error underline">
                  Remove
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
