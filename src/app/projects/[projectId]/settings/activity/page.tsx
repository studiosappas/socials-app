import { getSettingsAccess } from "@/lib/settings-access";

const labelClass = "text-xs tracking-wide text-muted uppercase";

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export default async function ActivityLogPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase } = await getSettingsAccess(projectId);

  // Best-effort feed (see lib/activity-log.ts) -- isolated query since
  // activity_log may not exist yet on a not-yet-migrated database.
  const { data: entries } = await supabase
    .from("activity_log")
    .select("id, actor_name, action, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(100);

  const groups = new Map<string, { id: string; actor_name: string; action: string }[]>();
  for (const entry of entries ?? []) {
    const key = dayLabel(entry.created_at);
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  return (
    <div className="flex max-w-md flex-col gap-6">
      <h2 className={labelClass}>Activity Log</h2>

      {groups.size === 0 && <p className="text-sm text-muted">No activity yet.</p>}

      {Array.from(groups.entries()).map(([day, items]) => (
        <div key={day} className="flex flex-col gap-2">
          <p className="text-sm font-semibold italic">{day}</p>
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 rounded-none border border-border"
                />
                <span>
                  <span className="font-medium">{item.actor_name}</span> {item.action}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
