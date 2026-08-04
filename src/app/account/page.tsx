import { createClient } from "@/lib/supabase/server";
import { AccountPanel } from "@/app/projects/[projectId]/settings/settings-panels";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, avatar_url")
    .eq("id", user!.id)
    .single();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <p className="text-xs tracking-wide text-muted uppercase">Account</p>
        <h1 className="text-2xl font-light">Your account</h1>
      </div>
      <AccountPanel
        name={profile?.name ?? ""}
        email={user?.email ?? ""}
        avatarUrl={profile?.avatar_url ?? null}
      />
    </div>
  );
}
