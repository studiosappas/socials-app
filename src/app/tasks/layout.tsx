import { AppFooter, AppHeader } from "@/components/app-header";
import { PresenceHeartbeat } from "@/components/presence-heartbeat";
import { createClient } from "@/lib/supabase/server";
import { getUserProjectsForNav } from "@/lib/nav-data";
import { getRecentNotifications } from "@/lib/notifications-data";
import { resolveLandingPath } from "@/lib/account-settings";

// Mirrors /projects/layout.tsx exactly (same header/footer shell) -- kept as
// its own copy rather than sharing that file, since /tasks now deliberately
// sits OUTSIDE the /projects/[projectId] tree entirely (see the routing
// comment on TodoPage below for why).
export default async function TasksShellLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [projects, notifications, homeHref] = user
    ? await Promise.all([
        getUserProjectsForNav(supabase, user.id),
        getRecentNotifications(supabase, user.id),
        resolveLandingPath(supabase, user.id),
      ])
    : [[], { items: [], unreadCount: 0 }, "/projects"];

  return (
    <div className="flex flex-1 flex-col">
      {user && <PresenceHeartbeat />}
      <AppHeader
        projects={projects}
        notificationItems={notifications.items}
        unreadCount={notifications.unreadCount}
        homeHref={homeHref}
      />
      <div className="flex flex-1 flex-col">{children}</div>
      <AppFooter />
    </div>
  );
}
