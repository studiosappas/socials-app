import { Skeleton } from "@/components/ui/skeleton";

// Deliberately a minimal, STABLE shell rather than a precise replica of the
// real page -- a month grid runs 4 to 6 rows depending on the month, so no
// static skeleton can match its exact height anyway, and CalendarBoard
// itself renders a completely different structure on mobile (a mini month
// strip + an agenda list) vs. desktop (the weekday-header + day-grid seen
// here). Getting the BROAD geometry right -- is there a sidebar, is this a
// grid or a list, roughly how tall is the header -- matters far more than
// matching cell-for-cell, which was the actual bug: the previous version
// didn't reserve the Drafts sidebar at all, so it popped in as a whole new
// column the instant real data landed, and used one grid shape regardless
// of viewport width.
export default function CalendarLoading() {
  return (
    <div className="flex flex-col gap-10 lg:flex-row">
      <div className="flex-1">
        {/* Same rough height/position as the real Prev / dots / Next row
            with its absolutely-centered month label -- not reproducing its
            exact internals, just occupying the same band. */}
        <div className="relative flex items-center gap-4 pb-4 sm:mb-6 sm:gap-8 sm:pb-0">
          <Skeleton className="h-3 w-10 shrink-0" />
          <div className="hidden flex-1 sm:block" />
          <Skeleton className="h-3 w-10 shrink-0" />
          <Skeleton className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-24 -translate-x-1/2 -translate-y-1/2" />
        </div>

        {/* Desktop only, matching CalendarBoard's own `hidden sm:block` --
            weekday-label row + a representative (not exact) block of day
            cells. */}
        <div className="hidden sm:block">
          <div className="grid grid-cols-7 gap-2 pb-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="mx-auto h-3 w-8" />
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 28 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        </div>

        {/* Mobile only, matching CalendarBoard's own `sm:hidden` agenda
            layout -- a mini-month-strip-shaped block, then a few agenda
            rows, instead of the desktop grid's shape. */}
        <div className="flex flex-col gap-3 sm:hidden">
          <Skeleton className="h-24 w-full" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>

      {/* The Drafts/Unscheduled sidebar -- reserved unconditionally. We
          don't know canManage yet at this point (that's still loading too),
          but a sidebar disappearing for a non-manager is a far smaller,
          quieter shift than a whole new column suddenly appearing once data
          resolves, which is what the unreserved version did. */}
      <div className="w-full lg:w-64 lg:shrink-0">
        <Skeleton className="h-6 w-20" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      </div>
    </div>
  );
}
