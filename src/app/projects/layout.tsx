import { AppFooter, AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/server";
import { getUserProjectsForNav } from "@/lib/nav-data";
import { getRecentNotifications } from "@/lib/notifications-data";

export default async function ProjectsShellLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [projects, notifications] = user
    ? await Promise.all([getUserProjectsForNav(supabase, user.id), getRecentNotifications(supabase, user.id)])
    : [[], { items: [], unreadCount: 0 }];

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader projects={projects} notificationItems={notifications.items} unreadCount={notifications.unreadCount} />
      <div className="flex flex-1 flex-col">{children}</div>
      <AppFooter />
    </div>
  );
}
