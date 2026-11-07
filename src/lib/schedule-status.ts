// Status that follows from a scheduled_date change -- the one rule every
// scheduling path (Calendar drag/drop + Add from Library, Post Editor,
// Content Editor) applies, so a dated item actually reaches "scheduled" and
// the Calendar's lazy Scheduled -> Published flip (calendar/page.tsx) can
// pick it up once its date passes.
//
// Only fires on an actual date change, and only for the two statuses it owns:
//   - date assigned/moved while "draft"  -> "scheduled"
//   - date removed while "scheduled"     -> "draft"
// Every other status (published, in_review, a story's ready/approved/...)
// is an explicit choice and passes through untouched. An unchanged date
// never rewrites anything, so picking Draft by hand on a dated post sticks.
export function statusForScheduleChange<S extends string>(
  status: S,
  prevDate: string | null | undefined,
  nextDate: string | null | undefined,
): S | "scheduled" | "draft" {
  const prev = prevDate || null;
  const next = nextDate || null;
  if (prev === next) return status;
  if (next && status === "draft") return "scheduled";
  if (!next && status === "scheduled") return "draft";
  return status;
}

// Mirrors the Calendar page's auto-publish UPDATE filter (status =
// 'scheduled' AND scheduled_date <= today) -- kept here so the full
// draft -> scheduled -> published chain is testable without Supabase.
export function isAutoPublishable(status: string, date: string | null | undefined, todayStr: string): boolean {
  return status === "scheduled" && !!date && date <= todayStr;
}
