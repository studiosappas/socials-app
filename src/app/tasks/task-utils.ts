// Every date here is a plain "yyyy-MM-dd" string compared directly, never
// parsed into a Date -- Postgres `date` columns round-trip as bare date
// strings, and parsing those back into a JS Date is a well-known timezone
// footgun (a date-only ISO string parses as UTC midnight, which can land on
// the "wrong" day once compared against a local-time `today`). String
// comparison side-steps that entirely, same approach the page already used
// before this feature (`todo/page.tsx`'s original `today` string compare).

export type TaskBucket = "today" | "tomorrow" | "soon" | "none";

export function bucketForDueDate(dueDate: string | null, todayStr: string, tomorrowStr: string): TaskBucket {
  if (!dueDate) return "none";
  // Overdue tasks surface under Today rather than getting buried in Soon --
  // that's the most useful default for a page whose whole point is nothing
  // falling through the cracks.
  if (dueDate <= todayStr) return "today";
  if (dueDate === tomorrowStr) return "tomorrow";
  return "soon";
}

export function formatDueLabel(dueDate: string | null, todayStr: string, tomorrowStr: string): string {
  if (!dueDate) return "";
  if (dueDate <= todayStr) return "Today";
  if (dueDate === tomorrowStr) return "Tmrw";
  const [, m, d] = dueDate.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}
