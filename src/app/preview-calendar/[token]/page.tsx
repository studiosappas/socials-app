import type { Metadata } from "next";
import { getSharedCalendarData } from "@/lib/data/calendar-share";
import { GuestCalendar } from "./guest-calendar";

// /preview-calendar/[token] rather than /preview/calendar/[token]: a static
// "calendar" folder beside /preview/[token] is the same static-beside-
// dynamic shape that corrupted the router cache for /projects/todo (see
// the Tasks route move). Still public via proxy's startsWith("/preview").

// Dynamic by construction (searchParams + the request-bound Supabase client),
// so every load re-checks the token and a revoked link stops working on the
// very next one.
type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ month?: string }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ token }, { month }] = await Promise.all([params, searchParams]);
  const data = await getSharedCalendarData(token, month);
  return {
    title: data ? `${data.projectName} — Calendar` : "Calendar Unavailable",
    robots: { index: false, follow: false },
    // Keeps the token in this URL from leaking to any page a guest follows.
    referrer: "no-referrer",
  };
}

export default async function SharedCalendarPage({ params, searchParams }: Props) {
  const [{ token }, { month }] = await Promise.all([params, searchParams]);
  const data = await getSharedCalendarData(token, month);

  if (!data) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <span className="text-xs tracking-wide text-muted uppercase">Calendar Unavailable</span>
        <p className="max-w-xs text-sm text-muted">This link is no longer available. Ask for a new one if you still need it.</p>
      </div>
    );
  }

  return (
    <GuestCalendar
      projectName={data.projectName}
      monthLabel={data.monthLabel}
      prevMonthParam={data.prevMonthParam}
      nextMonthParam={data.nextMonthParam}
      cells={data.cells}
      weekStartsOn={data.weekStartsOn}
      previews={data.previews}
    />
  );
}
