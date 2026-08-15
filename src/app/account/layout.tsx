import { AppFooter, AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/server";
import { getUserProjectsForNav } from "@/lib/nav-data";
import { getRecentNotifications } from "@/lib/notifications-data";
import { resolveLandingPath } from "@/lib/account-settings";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
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
      <AppHeader
        projects={projects}
        notificationItems={notifications.items}
        unreadCount={notifications.unreadCount}
        homeHref={homeHref}
      />
      <div className="mx-auto w-full max-w-3xl flex-1 p-6">{children}</div>
      <AppFooter />
    </div>
  );
}
