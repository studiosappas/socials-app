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

// An editor's unsaved date-picker edit: the same rule, applied against the
// date currently shown, so the Status dropdown reflects it immediately.
// Nothing is persisted -- the server re-applies statusForScheduleChange on
// Save against the stored date as the safety net.
export function applyScheduleDateEdit<S extends string>(
  form: { status: S; date: string },
  nextDate: string,
): { status: S | "scheduled" | "draft"; date: string } {
  return { status: statusForScheduleChange(form.status, form.date, nextDate), date: nextDate };
}

// Save-time status for an editor form: a Status the user picked by hand is
// kept exactly as submitted; otherwise the date-change rule above applies as
// the safety net. Used by updatePost only -- Calendar drag/drop and other
// paths have no hand-picked Status and keep using statusForScheduleChange.
export function resolveSubmittedStatus<S extends string>(
  submitted: S,
  storedDate: string | null | undefined,
  nextDate: string | null | undefined,
  explicit: boolean,
): S | "scheduled" | "draft" {
  return explicit ? submitted : statusForScheduleChange(submitted, storedDate, nextDate);
}

// Mirrors the Calendar page's auto-publish UPDATE filter (status =
// 'scheduled' AND scheduled_date <= today) -- kept here so the full
// draft -> scheduled -> published chain is testable without Supabase.
export function isAutoPublishable(status: string, date: string | null | undefined, todayStr: string): boolean {
  return status === "scheduled" && !!date && date <= todayStr;
}
