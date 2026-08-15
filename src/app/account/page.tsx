import { createClient } from "@/lib/supabase/server";
import { mergePreferences, mergeWorkspaceSettings } from "@/lib/account-settings";
import { AccountPanel } from "./account-panel";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, avatar_url, workspace_settings, preferences")
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
        workspaceSettings={mergeWorkspaceSettings(profile?.workspace_settings)}
        preferences={mergePreferences(profile?.preferences)}
      />
    </div>
  );
}
