import { cache } from "react";
import { addMonths, format, subMonths } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import { buildCalendarCells, calendarThumbnailPath, type CalendarCell } from "@/lib/calendar-cells";
import { effectivePostType } from "@/lib/post-type";
import {
  buildSharedCalendarItems,
  isCalendarShareToken,
  parseShareMonthParam,
  sharedCalendarSignPaths,
  type GuestPreview,
  type SharedCalendarRpc,
} from "@/lib/calendar-share-model";

export type SharedCalendarData = {
  projectName: string;
  weekStartsOn: 0 | 1;
  monthLabel: string;
  prevMonthParam: string;
  nextMonthParam: string;
  cells: CalendarCell[];
  previews: Record<string, GuestPreview>;
};

// Public, unauthenticated read path for /preview-calendar/[token].
//
// 1. The token is format-checked here, then get_shared_calendar (SECURITY
//    DEFINER, granted to anon) resolves it to exactly one project and
//    returns one month of display data -- null for anything unknown or
//    revoked. The anon client is used for this, so it runs with no more
//    rights than any visitor.
// 2. Only the storage paths that call returned (and only under that
//    project's own folder, see sharedCalendarSignPaths) are signed, with
//    the service-role client -- there is deliberately NO anonymous storage
//    policy for calendar links, so the token is checked on every page load
//    instead of opening those paths to anyone who knows one. This is the
//    one non-admin use of createServiceRoleClient: it only ever signs
//    paths, never reads or writes a table.
// cache(): generateMetadata and the page both call this for one request.
export const getSharedCalendarData = cache(async function getSharedCalendarData(
  token: string,
  monthParam: string | undefined,
): Promise<SharedCalendarData | null> {
  if (!isCalendarShareToken(token)) return null;
  const anchor = parseShareMonthParam(monthParam) ?? new Date();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_shared_calendar", {
    p_token: token,
    p_month: format(anchor, "yyyy-MM-01"),
  });
  if (error || !data) return null;
  const rpc = data as SharedCalendarRpc;

  let urlByPath = new Map<string, string>();
  const paths = sharedCalendarSignPaths(rpc);
  if (paths.length) {
    try {
      urlByPath = await getCachedSignedUrls(
        createServiceRoleClient() as unknown as Awaited<ReturnType<typeof createClient>>,
        "project-media",
        paths,
      );
    } catch (err) {
      // Missing service-role key: the calendar still renders, every item
      // falls back to its icon instead of the whole page failing.
      console.error("Shared calendar: couldn't sign media", err);
    }
  }

  const weekStartsOn: 0 | 1 = rpc.weekStartsOn === 1 ? 1 : 0;
  const { items, noteByDate, previews } = buildSharedCalendarItems(rpc, urlByPath, {
    thumbnailPath: calendarThumbnailPath,
    postLabel: effectivePostType,
  });

  return {
    projectName: rpc.projectName,
    weekStartsOn,
    monthLabel: format(anchor, "MMMM yyyy"),
    prevMonthParam: format(subMonths(anchor, 1), "yyyy-MM"),
    nextMonthParam: format(addMonths(anchor, 1), "yyyy-MM"),
    cells: buildCalendarCells({
      anchor,
      weekStartsOn,
      todayStr: format(new Date(), "yyyy-MM-dd"),
      items,
      noteByDate,
    }),
    previews,
  };
});
