import { AppFooter, AppHeader } from "@/components/app-header";
import { PresenceHeartbeat } from "@/components/presence-heartbeat";
import { createClient } from "@/lib/supabase/server";
import { getUserProjectsForNav, getUserDisplayFirstName } from "@/lib/nav-data";
import { getRecentNotifications } from "@/lib/notifications-data";
import { resolveLandingPath } from "@/lib/account-settings";

export default async function ProjectsShellLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [projects, notifications, homeHref, userFirstName] = user
    ? await Promise.all([
        getUserProjectsForNav(supabase, user.id),
        getRecentNotifications(supabase, user.id),
        resolveLandingPath(supabase, user.id),
        getUserDisplayFirstName(supabase, user.id),
      ])
    : [[], { items: [], unreadCount: 0 }, "/projects", null];

  return (
    <div className="flex flex-1 flex-col">
      {user && <PresenceHeartbeat />}
      <AppHeader
        projects={projects}
        notificationItems={notifications.items}
        unreadCount={notifications.unreadCount}
        homeHref={homeHref}
        userFirstName={userFirstName}
      />
      <div className="flex flex-1 flex-col">{children}</div>
      <AppFooter />
    </div>
  );
}
