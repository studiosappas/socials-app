"use client";

import { memo, useCallback, useRef, useState, type ComponentType, type ReactNode, type Ref } from "react";
import Link from "next/link";
import type { CalendarCell, CalendarItem } from "@/lib/calendar-cells";

// The Calendar's display layer: month nav, the desktop 7-column grid (with
// click-to-expand weeks), and the mobile mini calendar + day-strip agenda.
// Deliberately imports no server actions, no dnd-kit, no note editor and no
// links into a post/story -- everything interactive beyond expanding a week
// and month navigation is plugged in by the caller through `slots` and the
// optional day handlers below (see CalendarBoard for the editing version).

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOUBLE_CLICK_WINDOW_MS = 220; // same value as Grid's identical slot disambiguation

// "chip" = the collapsed row's small pill, "tile" = the expanded row's full
// 3:4 tile, "strip" = the mobile agenda's horizontally scrolling tile.
export type CalendarItemVariant = "chip" | "tile" | "strip";

export type CalendarDayDrop = { ref?: Ref<HTMLButtonElement>; isOver: boolean };

// Components, not render functions, so the caller can pass one stable
// module-level object and DayCell/MobileDayRow's memo keeps holding -- any
// per-render state a slot needs (editing note, permissions) comes from the
// caller's own context instead of from new props.
export type CalendarViewSlots = {
  Item: ComponentType<{ item: CalendarItem; variant: CalendarItemVariant; onDarkCell: boolean }>;
  // Always rendered (even for a day without a note) so an editor slot can
  // keep its own state per day.
  Note: ComponentType<{ cell: CalendarCell; variant: "cell" | "row"; allPublished: boolean; isExpanded: boolean }>;
  // Wraps each desktop day cell -- e.g. to make it a drop target. Omitted =
  // a plain cell.
  DropTarget?: ComponentType<{ date: string; children: (drop: CalendarDayDrop) => ReactNode }>;
};

function PlainDropTarget({ children }: { date: string; children: (drop: CalendarDayDrop) => ReactNode }) {
  return children({ isOver: false });
}

// Post items already carry their post_type ("post"|"reel"|"carousel") as
// `label` (see calendar/page.tsx) -- stories don't have a type field, so
// they're always "Story". This is what every chip/tile shows now instead of
// a filename or a story's custom name, per the "text next to it is the
// content type" request.
export function contentTypeLabel(item: CalendarItem): string {
  if (item.itemType === "story") return "Story";
  const raw = item.label || "post";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// text-foreground is explicit, not inherited: this chip paints its own
// bg-background, and a fully published day's cell sets text-background --
// inheriting that drew the label in the chip's own background color,
// invisible in both themes.
export const ITEM_CHIP_CLASS =
  "flex max-w-full items-center gap-1 rounded-full border border-border bg-background py-0.5 pr-1.5 pl-0.5 text-[9px] text-foreground transition-colors duration-150 hover:border-foreground/30 sm:text-[10px]";

// Matches Brief's image-chip language (rounded-full pill, small circular
// thumbnail, label text) -- the chip's contents; the caller supplies the
// element it sits in (styled with ITEM_CHIP_CLASS).
export function ItemChipBody({ item }: { item: CalendarItem }) {
  return (
    <>
      <span className="h-3.5 w-3.5 shrink-0 overflow-hidden rounded-full bg-black/10 sm:h-4 sm:w-4">
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[7px]">
            {item.itemType === "story" ? "📖" : "🖼"}
          </span>
        )}
      </span>
      <span className="truncate">{contentTypeLabel(item)}</span>
    </>
  );
}

// The expanded-row tile: a real, readable image (not a small icon) at a
// fixed 3:4 ratio. `onDarkCell` is set when every item in the day is
// published, so the cell itself is bg-foreground -- the published border
// (foreground/60) would vanish against it, so it inverts instead.
export function itemTileClassName(published: boolean, onDarkCell: boolean): string {
  return `group relative block aspect-[3/4] w-full overflow-hidden border transition-colors duration-150 ${
    published
      ? onDarkCell
        ? "border-background/50 bg-black/[.03]"
        : "border-foreground/60 bg-black/[.03]"
      : "border-border bg-black/[.03] hover:border-foreground/30"
  }`;
}

// The tile's contents -- image, published dim, content-type corner badge
// (the same "minimal tag" language as Grid's asset-count/video badges), then
// any caller-specific overlays (`children`).
export function ItemTileBody({
  item,
  published,
  children,
}: {
  item: CalendarItem;
  published: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      {item.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.thumbnailUrl}
          alt=""
          loading="lazy"
          className={`h-full w-full object-cover ${published ? "opacity-70" : ""}`}
          draggable={false}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-2xl">
          {item.itemType === "story" ? "📖" : "🖼"}
        </span>
      )}
      {published && <div className="absolute inset-0 bg-black/40" />}
      <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
        {contentTypeLabel(item)}
      </span>
      {children}
    </>
  );
}

// A saved day note, in the same bordered-frame language as the content
// chips/tiles. `onActivate` (when given) makes it a keyboard/click target,
// e.g. to start editing. A div, not a <button> -- in the desktop cell this
// already sits inside DayCell's own outer <button>, and a <button> nested in
// a <button> is invalid HTML that the browser's parser silently un-nests,
// causing a React hydration mismatch (confirmed live: "cannot be a
// descendant of <button>").
export function DayNote({
  cell,
  variant,
  allPublished,
  isExpanded,
  onActivate,
}: {
  cell: CalendarCell;
  variant: "cell" | "row";
  allPublished: boolean;
  isExpanded: boolean;
  onActivate?: () => void;
}) {
  if (!cell.note) return null;
  if (variant === "row") {
    return (
      <div
        role={onActivate ? "button" : undefined}
        tabIndex={onActivate ? 0 : undefined}
        onClick={() => onActivate?.()}
        className="w-full rounded-none border border-border bg-black/[.02] px-2 py-1 text-left text-xs text-muted"
      >
        {cell.note}
      </div>
    );
  }
  return (
    <div
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onActivate?.();
      }}
      onKeyDown={(e) => {
        if (onActivate && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          e.stopPropagation();
          onActivate();
        }
      }}
      title={cell.note}
      className={`w-full shrink-0 rounded-none border px-1 py-0.5 text-left text-[9px] sm:text-[10px] ${
        allPublished ? "border-background/30 bg-background/10 text-background/80" : "border-border bg-black/[.02] text-muted"
      } ${isExpanded ? "line-clamp-3 whitespace-pre-wrap" : "truncate"}`}
    >
      {cell.note}
    </div>
  );
}

export function CalendarView({
  monthLabel,
  prevMonthParam,
  nextMonthParam,
  cells,
  weekStartsOn = 0,
  slots,
  onOpenDayDetail,
  onDayMenu,
  aside,
}: {
  monthLabel: string;
  prevMonthParam: string;
  nextMonthParam: string;
  cells: CalendarCell[];
  // Rotates the header row to match; `cells` itself is already built
  // starting from the matching day (see buildCalendarCells), so only the
  // label row needs rotating here.
  weekStartsOn?: 0 | 1;
  slots: CalendarViewSlots;
  // Double-click on a desktop day. Omitted = a single click expands the week
  // immediately (no double-click window to wait out).
  onOpenDayDetail?: (date: string) => void;
  // Right-click on a desktop day, or the ⋮ button on touch/mobile. Omitted =
  // no day menu at all.
  onDayMenu?: (date: string, x: number, y: number) => void;
  // Beside the calendar on desktop, below it on mobile (e.g. Drafts).
  aside?: ReactNode;
}) {
  const weekdayLabels = [...WEEKDAY_LABELS.slice(weekStartsOn), ...WEEKDAY_LABELS.slice(0, weekStartsOn)];
  // Single click unfolds the whole week (row) a clicked day belongs to --
  // every day in that row grows together via CSS Grid's own row-track
  // sizing (all 7 cells share one implicit grid row, so giving them all the
  // same taller min-height stretches the row as a unit, no per-week wrapper
  // markup needed). Double-click still opens the full day-detail popup for
  // creating/adding/notes, same disambiguation pattern as Grid's slots.
  const [expandedRowIndex, setExpandedRowIndex] = useState<number | null>(null);
  // Mobile only (see the mini calendar below the month nav) -- which day's
  // strip is currently highlighted/scrolled-to. Not used on desktop at all.
  const [selectedMobileDate, setSelectedMobileDate] = useState<string | null>(null);
  // Measured, not a fixed offset -- the sticky panel's real height varies
  // (a 5-week vs. 6-week month changes the mini calendar's row count), so a
  // plain scrollIntoView({block:"start"}) lands the target's top edge at
  // y=0, exactly where the sticky panel sits -- it scrolls to the right
  // place, but the sticky panel then covers it, which is what actually
  // looked like "the wrong date."
  const stickyRef = useRef<HTMLDivElement>(null);
  function handleSelectMobileDate(date: string) {
    setSelectedMobileDate(date);
    const target = document.getElementById(`cal-day-${date}`);
    if (!target) return;
    const stickyHeight = stickyRef.current?.getBoundingClientRect().height ?? 0;
    const targetTop = target.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: targetTop - stickyHeight - 8, behavior: "smooth" });
  }

  // Stable reference so DayCell's memo actually holds.
  const handleToggleRow = useCallback((rowIndex: number) => {
    setExpandedRowIndex((current) => (current === rowIndex ? null : rowIndex));
  }, []);

  return (
    <div className="flex flex-col gap-10 lg:flex-row">
      <div className="flex-1">
        {/* Sticky on mobile only -- the month nav + mini calendar act as
            a fixed "screen" that never moves, with the day-strip list
            below scrolling underneath it like a separate pane (Asana's
            mobile calendar does the same split). Desktop is untouched
            (sm:static cancels the sticky positioning entirely there). */}
        <div
          ref={stickyRef}
          className="sticky top-0 z-20 bg-background pb-4 sm:static sm:z-auto sm:bg-transparent sm:pb-0"
        >
          <div className="relative flex items-center gap-4 sm:mb-6 sm:gap-8">
            <Link
              href={`?month=${prevMonthParam}`}
              className="shrink-0 text-xs font-semibold tracking-wide uppercase transition-colors duration-150 hover:text-muted"
            >
              ‹ Prev
            </Link>
            <div className="hidden flex-1 items-center justify-center gap-10 text-border sm:flex">
              {Array.from({ length: 4 }).map((_, i) => (
                <span key={i} className="h-1 w-1 shrink-0 rounded-full bg-current" />
              ))}
            </div>
            <Link
              href={`?month=${nextMonthParam}`}
              className="shrink-0 text-xs font-semibold tracking-wide uppercase transition-colors duration-150 hover:text-muted"
            >
              Next ›
            </Link>
            <h2 className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-xs font-semibold tracking-wide uppercase sm:text-sm">
              {monthLabel}
            </h2>
          </div>

          <div className="sm:hidden">
            {/* Asana-style mobile layout: a compact month grid up top
                (date numbers + a content dot, not full tiles -- a
                7-column grid can't show a post at a usable size, same
                reasoning as the agenda list below it), and tapping a
                date scrolls straight to that day's already-expanded
                strip rather than opening a separate popup -- the strip
                IS the "detail view" here. */}
            <MiniCalendarGrid
              weekdayLabels={weekdayLabels}
              cells={cells}
              selectedDate={selectedMobileDate}
              onSelectDate={handleSelectMobileDate}
            />
          </div>
        </div>

        {/* Below sm:, a 7-column grid caps every cell at viewport/7 wide
            no matter what, which can't show a post at a usable size on a
            phone -- that's a structural ceiling, not something more CSS
            tuning fixes, so mobile gets its own agenda-list presentation
            instead of a shrunk copy of this grid. */}
        <div className="hidden sm:block">
          <div className="grid grid-cols-7 text-center text-[10px] font-semibold tracking-wide uppercase sm:text-xs">
            {weekdayLabels.map((d) => (
              <div key={d} className="py-2">
                {d.slice(0, 3)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {cells.map((cell, index) => (
              <DayCell
                key={cell.date}
                cell={cell}
                rowIndex={Math.floor(index / 7)}
                isExpanded={Math.floor(index / 7) === expandedRowIndex}
                onToggleRow={handleToggleRow}
                onOpenDetail={onOpenDayDetail}
                onContextMenu={onDayMenu}
                slots={slots}
              />
            ))}
          </div>
        </div>

        <div className="sm:hidden border-t border-border">
          {cells
            .filter((cell) => cell.isCurrentMonth)
            .map((cell) => (
              <MobileDayRow
                key={cell.date}
                cell={cell}
                highlighted={selectedMobileDate === cell.date}
                onContextMenu={onDayMenu}
                slots={slots}
              />
            ))}
        </div>
      </div>

      {aside}
    </div>
  );
}

// memo: one of these renders per visible day (30-42+ per month), and
// without it every cell re-rendered whenever its parent re-rendered for ANY
// reason (starting a drag anywhere on the month, an unrelated menu opening
// on a different day, etc.) -- see the perf investigation this was added
// for. Every callback prop below is a stable reference (useCallback / a raw
// setState function) and `slots` is a stable module-level object, which is
// what actually lets memo skip cells whose own data didn't change.
const DayCell = memo(function DayCell({
  cell,
  rowIndex,
  isExpanded,
  onToggleRow,
  onOpenDetail,
  onContextMenu,
  slots,
}: {
  cell: CalendarCell;
  rowIndex: number;
  isExpanded: boolean;
  onToggleRow: (rowIndex: number) => void;
  onOpenDetail?: (date: string) => void;
  onContextMenu?: (date: string, x: number, y: number) => void;
  slots: CalendarViewSlots;
}) {
  const { Item, Note, DropTarget = PlainDropTarget } = slots;
  const hasContent = cell.items.length > 0 || Boolean(cell.note);
  // Expanded now stacks every item vertically (see the container below)
  // instead of capping at 2 side-by-side -- the cell's own height grows to
  // fit instead of hiding extras behind a "+N" count. Compact mode's small
  // pill-chip cap is unrelated (that's not the layout this changed) and
  // stays as-is.
  const PREVIEW_ITEMS = isExpanded ? cell.items.length : 3;
  const previewItems = cell.items.slice(0, PREVIEW_ITEMS);
  const hiddenCount = cell.items.length - previewItems.length;
  const allPublished = cell.items.length > 0 && cell.items.every((item) => item.status === "published");

  // Same single/double-click disambiguation as Grid's slots (dnd-kit's
  // PointerSensor suppresses native dblclick synthesis, so this is done by
  // hand): a single click unfolds the row, a double-click still opens the
  // full day-detail popup for creating content / adding from library.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastClickAtRef = useRef(0);

  function handleClick() {
    if (!onOpenDetail) {
      onToggleRow(rowIndex);
      return;
    }

    const now = Date.now();
    const isDoubleClick = now - lastClickAtRef.current < DOUBLE_CLICK_WINDOW_MS;
    lastClickAtRef.current = now;

    if (isDoubleClick) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      onOpenDetail(cell.date);
      return;
    }

    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onToggleRow(rowIndex);
    }, DOUBLE_CLICK_WINDOW_MS);
  }

  return (
    <DropTarget date={cell.date}>
      {({ ref, isOver }) => (
        <button
          type="button"
          ref={ref}
          onClick={handleClick}
          onContextMenu={
            onContextMenu
              ? (e) => {
                  e.preventDefault();
                  onContextMenu(cell.date, e.clientX, e.clientY);
                }
              : undefined
          }
          title={
            onOpenDetail
              ? "Click to expand this week, double-click for day options, right-click for quick actions"
              : "Click to expand this week"
          }
          className={`flex min-w-0 flex-col items-start gap-1 overflow-hidden border p-1 text-left text-xs transition-[background-color,border-color,min-height] duration-200 sm:p-2 ${
            isExpanded ? "min-h-40 sm:min-h-56" : "min-h-16 sm:min-h-24"
          } ${
            // Every item in the day is Published -- the "completed day" dark
            // read-at-a-glance state. A mix of published/unpublished items keeps
            // the cell's normal border/background; each tile still shows its own
            // published state individually (see ItemTileBody). Exclusive of
            // the normal branches below rather than appended after them: an
            // outside-the-month day used to get BOTH text-muted and
            // text-background, two conflicting color utilities, and which one won
            // depended on stylesheet order, not on this class string. Outside the
            // month it is softened (bg-foreground/80) instead of muted, which
            // keeps its text readable.
            allPublished
              ? cell.isCurrentMonth
                ? "border-foreground bg-foreground text-background"
                : "border-foreground/80 bg-foreground/80 text-background"
              : `${
                  hasContent
                    ? cell.isCurrentMonth
                      ? "border-border"
                      : "border-black/5 text-muted"
                    : cell.isCurrentMonth
                      ? "border-dashed border-border"
                      : "border-dashed border-black/5 text-muted"
                } ${isOver ? "bg-black/[.04]" : "hover:bg-black/[.02]"}`
          } ${
            // Inset outline -- drawn inside the cell, so on a published day's
            // bg-foreground it has to invert too or today's ring disappears.
            cell.isToday
              ? `outline outline-2 outline-offset-[-2px] ${allPublished ? "outline-background/70" : "outline-foreground"}`
              : ""
          }`}
        >
          <div className="flex w-full shrink-0 items-center justify-between">
            <span className="text-[11px] font-semibold sm:text-xs">{cell.dayNumber}</span>
            {onContextMenu && (
              // Right-click (the day menu's only other trigger) generally
              // doesn't fire from a long-press on touch devices, so this gives
              // mobile an explicit, discoverable way to reach the exact same
              // menu -- sm:hidden since desktop already has right-click.
              // A <span role="button">, not a real <button>, for the same
              // nested-<button> HTML-validity reason as DayNote (this already
              // sits inside DayCell's own outer <button>).
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  onContextMenu(cell.date, rect.right, rect.bottom);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    onContextMenu(cell.date, rect.right, rect.bottom);
                  }
                }}
                title="Day options"
                className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded before:absolute before:-inset-2 before:content-[''] sm:hidden ${
                  allPublished ? "text-background/70" : "text-muted"
                }`}
              >
                ⋮
              </span>
            )}
          </div>

          <Note cell={cell} variant="cell" allPublished={allPublished} isExpanded={isExpanded} />

          {previewItems.length > 0 && (
            <div className={isExpanded ? "flex w-full flex-col gap-1" : "flex w-full flex-wrap gap-1"}>
              {previewItems.map((item) => (
                <Item
                  key={`${item.itemType}-${item.itemId}`}
                  item={item}
                  variant={isExpanded ? "tile" : "chip"}
                  onDarkCell={allPublished}
                />
              ))}
              {hiddenCount > 0 && (
                <span className={`text-[9px] ${allPublished ? "text-background/70" : "text-muted"}`}>+{hiddenCount}</span>
              )}
            </div>
          )}
        </button>
      )}
    </DropTarget>
  );
});

// The compact month grid at the top of the mobile layout -- date numbers and
// a small content dot only, never tiles/thumbnails (a 7-column grid caps
// each cell at viewport/7 wide, the same structural ceiling that ruled out
// reusing the desktop DayCell for mobile in the first place). Purely a date
// picker/wayfinder for the day-strip list below it -- tapping a date doesn't
// show content here, it scrolls to that day's already-real strip.
function MiniCalendarGrid({
  weekdayLabels,
  cells,
  selectedDate,
  onSelectDate,
}: {
  weekdayLabels: string[];
  cells: CalendarCell[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-7 text-center text-[9px] font-semibold tracking-wide uppercase text-muted">
        {weekdayLabels.map((d) => (
          <div key={d} className="py-1">
            {d.slice(0, 1)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((cell) => {
          const hasContent = cell.items.length > 0;
          const isSelected = cell.date === selectedDate;
          return (
            <button
              key={cell.date}
              type="button"
              disabled={!cell.isCurrentMonth}
              onClick={() => onSelectDate(cell.date)}
              className={`mx-auto flex aspect-square w-8 flex-col items-center justify-center gap-0.5 rounded-full text-xs transition-colors duration-150 ${
                !cell.isCurrentMonth
                  ? "text-muted/30"
                  : isSelected
                    ? "bg-foreground text-background"
                    : cell.isToday
                      ? "outline outline-1 outline-offset-[-1px] outline-foreground"
                      : "hover:bg-black/[.04]"
              }`}
            >
              <span>{cell.dayNumber}</span>
              <span
                className={`h-1 w-1 rounded-full ${
                  hasContent ? (isSelected ? "bg-background" : "bg-foreground") : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Mobile's own presentation, swapped in below sm: instead of a shrunk copy
// of the 7-column grid above (see the "structural ceiling" comment at its
// call site) -- one row per day, date on the left, a horizontally
// scrollable strip of real-sized tiles on the right (no expand/collapse
// state needed, unlike the grid: a horizontal strip already holds any number
// of items without a week-toggle or "+N" cap). Uses the same Item slot as
// desktop ("strip" variant) so the visual language stays identical, and the
// same ⋮ day menu DayCell wires up for touch.
// memo, same reasoning as DayCell above.
const MobileDayRow = memo(function MobileDayRow({
  cell,
  highlighted = false,
  onContextMenu,
  slots,
}: {
  cell: CalendarCell;
  // Set when this row's date was just tapped in the mini calendar above --
  // scrollIntoView already gets the viewport there, this is just the visual
  // confirmation that it landed on the right day.
  highlighted?: boolean;
  onContextMenu?: (date: string, x: number, y: number) => void;
  slots: CalendarViewSlots;
}) {
  const { Item, Note } = slots;
  const weekdayLabel = new Date(`${cell.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });

  return (
    <div
      id={`cal-day-${cell.date}`}
      className={`flex gap-3 border-b border-border px-1 py-3 transition-colors duration-500 first:pt-0 ${
        highlighted ? "bg-black/[.05]" : cell.isToday ? "bg-black/[.02]" : ""
      }`}
    >
      <div className="flex w-9 shrink-0 flex-col items-center pt-0.5">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
            cell.isToday ? "bg-foreground text-background" : ""
          }`}
        >
          {cell.dayNumber}
        </span>
        <span className="mt-0.5 text-[9px] tracking-wide text-muted uppercase">{weekdayLabel}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Note cell={cell} variant="row" allPublished={false} isExpanded={false} />

        {cell.items.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {cell.items.map((item) => (
              <Item key={`${item.itemType}-${item.itemId}`} item={item} variant="strip" onDarkCell={false} />
            ))}
          </div>
        ) : (
          !cell.note && <span className="text-xs text-muted/50">—</span>
        )}
      </div>

      {onContextMenu && (
        <button
          type="button"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onContextMenu(cell.date, rect.right, rect.bottom);
          }}
          title="Day options"
          className="h-7 w-7 shrink-0 self-start rounded text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
        >
          ⋮
        </button>
      )}
    </div>
  );
});
