// The Calendar's month data shape, built in one place -- pure (no Supabase,
// no React, no DOM) so calendar/page.tsx and any future read-only surface
// lay out the same days and items, and the unit tests
// (calendar-cells.test.ts) can run it directly.

import { eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import type { CalendarItemType } from "@/lib/actions/calendar";
import type { MediaType, PostStatus, StoryStatus } from "@/types/database";

// Which stored file a calendar chip/tile shows as its <img>. A plain <img>
// can never decode a video or PDF, so those use their generated poster --
// or nothing (the chip's icon fallback) until one exists, never the raw
// file, which renders as a broken image. Images keep their original.
// Same video/pdf rule as stories/page.tsx's coverUrl.
export function calendarThumbnailPath(media: {
  storage_path: string;
  media_type?: MediaType | null;
  poster_storage_path?: string | null;
}): string | null {
  if (media.media_type === "video" || media.media_type === "pdf") return media.poster_storage_path ?? null;
  return media.storage_path;
}

export type CalendarItem = {
  itemType: CalendarItemType;
  itemId: string;
  label: string;
  thumbnailUrl: string | null;
  assetUrls: string[];
  href: string;
  status: PostStatus | StoryStatus;
};

export type CalendarCell = {
  date: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  items: CalendarItem[];
  note: string | null;
};

// The whole weeks a month's grid spans -- from the start of the week the
// 1st falls in to the end of the week the last day falls in, with the week
// starting on Account > Workspace's Week Starts On (0=Sunday, 1=Monday).
export function calendarGridRange(anchor: Date, weekStartsOn: 0 | 1) {
  const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn });
  const gridEnd = endOfWeek(endOfMonth(anchor), { weekStartsOn });
  return {
    gridStart,
    gridEnd,
    gridStartStr: format(gridStart, "yyyy-MM-dd"),
    gridEndStr: format(gridEnd, "yyyy-MM-dd"),
  };
}

// One cell per day of the grid. `items` keeps its given order within a day
// (the page passes posts before stories), and an item dated outside the grid
// simply never lands in a cell.
export function buildCalendarCells({
  anchor,
  weekStartsOn,
  todayStr,
  items,
  noteByDate,
}: {
  anchor: Date;
  weekStartsOn: 0 | 1;
  todayStr: string;
  items: { date: string; item: CalendarItem }[];
  noteByDate: Map<string, string>;
}): CalendarCell[] {
  const itemsByDate = new Map<string, CalendarItem[]>();
  for (const { date, item } of items) {
    const list = itemsByDate.get(date) ?? [];
    list.push(item);
    itemsByDate.set(date, list);
  }

  const { gridStart, gridEnd } = calendarGridRange(anchor, weekStartsOn);
  return eachDayOfInterval({ start: gridStart, end: gridEnd }).map((day) => {
    const dateStr = format(day, "yyyy-MM-dd");
    return {
      date: dateStr,
      dayNumber: day.getDate(),
      isCurrentMonth: day.getMonth() === anchor.getMonth(),
      isToday: dateStr === todayStr,
      items: itemsByDate.get(dateStr) ?? [],
      note: noteByDate.get(dateStr) ?? null,
    };
  });
}
