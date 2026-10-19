import { createClient } from "@/lib/supabase/server";
import { mergePreferences, mergeWorkspaceSettings } from "@/lib/account-settings";
import { getUserProjectLists } from "@/lib/project-lists";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import { AccountPanel, type ArchivedProject } from "./account-panel";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, lists] = await Promise.all([
    supabase
      .from("profiles")
      .select("name, avatar_url, workspace_settings, preferences")
      .eq("id", user!.id)
      .single(),
    getUserProjectLists(user!.id),
  ]);

  // Owner/admin-only archived projects (see project-lists.ts); null means
  // the list couldn't be loaded, which the card shows as an error rather
  // than as "no archived projects".
  let archivedProjects: ArchivedProject[] | null = null;
  if (lists.ok) {
    const paths = lists.archived.map((p) => p.profilePhotoPath).filter((p): p is string => Boolean(p));
    const urlByPath = await getCachedSignedUrls(supabase, "project-media", paths);
    archivedProjects = lists.archived.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      avatarUrl: p.profilePhotoPath ? (urlByPath.get(p.profilePhotoPath) ?? null) : null,
    }));
  }

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
        archivedProjects={archivedProjects}
      />
    </div>
  );
}
