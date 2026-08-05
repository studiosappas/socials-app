import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type NotificationItem = {
  id: string;
  title: string;
  description: string;
  icon: string;
  link: string | null;
  read: boolean;
  createdAt: string;
};

// Plain server-side data helper (not a "use server" action) -- only ever
// called from server components (the shared AppHeader wrapper layouts), so
// it doesn't need to be client-invokable the way markNotificationRead does.
export async function getRecentNotifications(
  supabase: SupabaseServerClient,
  userId: string,
  limit = 20,
): Promise<{ items: NotificationItem[]; unreadCount: number }> {
  const [{ data }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, title, description, icon, link, read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    // Separate from the limited list above -- the unread badge should
    // reflect the true total, not just how many of the most recent N happen
    // to be unread.
    supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("read", false),
  ]);

  const items: NotificationItem[] = (data ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    description: n.description,
    icon: n.icon,
    link: n.link,
    read: n.read,
    createdAt: n.created_at,
  }));

  return { items, unreadCount: count ?? 0 };
}
