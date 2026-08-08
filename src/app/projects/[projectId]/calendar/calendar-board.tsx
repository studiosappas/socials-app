"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  createPostForDate,
  createStoryForDate,
  scheduleItem,
  setItemPublished,
  upsertCalendarNote,
  type CalendarItemType,
} from "@/lib/actions/calendar";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import type { PostStatus, StoryStatus } from "@/types/database";

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

type LibraryDialogState = { date: string; itemType: CalendarItemType } | null;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const UNSCHEDULED_PAGE_SIZE = 6; // 3 rows x 2 columns before "+ Load more"
const DOUBLE_CLICK_WINDOW_MS = 220; // same value as Grid's identical slot disambiguation

// Post items already carry their post_type ("post"|"reel"|"carousel") as
// `label` (see calendar/page.tsx) -- stories don't have a type field, so
// they're always "Story". This is what every chip/tile shows now instead of
// a filename or a story's custom name, per the "text next to it is the
// content type" request.
function contentTypeLabel(item: CalendarItem): string {
  if (item.itemType === "story") return "Story";
  const raw = item.label || "post";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function CalendarBoard({
  projectId,
  monthLabel,
  prevMonthParam,
  nextMonthParam,
  cells,
  unscheduled,
  canManage,
}: {
  projectId: string;
  monthLabel: string;
  prevMonthParam: string;
  nextMonthParam: string;
  cells: CalendarCell[];
  unscheduled: CalendarItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [libraryDialog, setLibraryDialog] = useState<LibraryDialogState>(null);
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);
  // Single click unfolds the whole week (row) a clicked day belongs to --
  // every day in that row grows together via CSS Grid's own row-track
  // sizing (all 7 cells share one implicit grid row, so giving them all the
  // same taller min-height stretches the row as a unit, no per-week wrapper
  // markup needed). Double-click still opens the full day-detail popup for
  // creating/adding/notes, same disambiguation pattern as Grid's slots.
  const [expandedRowIndex, setExpandedRowIndex] = useState<number | null>(null);
  // Right-click quick-actions menu: add a draft item, create new, add a
  // note, or remove whatever's scheduled -- a faster path to the same
  // actions DayDetailDialog already offers, without opening the full modal.
  const [contextMenu, setContextMenu] = useState<{ date: string; x: number; y: number } | null>(null);
  const [activeItem, setActiveItem] = useState<CalendarItem | null>(null);
  // Which cell (if any) is showing its inline note editor -- notes no
  // longer open a popup; the textarea lives directly in the cell instead.
  const [editingNoteDate, setEditingNoteDate] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // Optimistic override so scheduling an item renders immediately instead of
  // waiting for the server round-trip + router.refresh() — otherwise the
  // calendar visibly snaps back to the old date for a beat after drop.
  const [prevCells, setPrevCells] = useState(cells);
  const [prevUnscheduled, setPrevUnscheduled] = useState(unscheduled);
  const [overrideCells, setOverrideCells] = useState<CalendarCell[] | null>(null);
  const [overrideUnscheduled, setOverrideUnscheduled] = useState<CalendarItem[] | null>(null);
  if (cells !== prevCells || unscheduled !== prevUnscheduled) {
    setPrevCells(cells);
    setPrevUnscheduled(unscheduled);
    setOverrideCells(null);
    setOverrideUnscheduled(null);
  }
  const effectiveCells = overrideCells ?? cells;
  const effectiveUnscheduled = overrideUnscheduled ?? unscheduled;

  function handleDragStart(event: DragStartEvent) {
    setActiveItem((event.active.data.current?.item as CalendarItem | undefined) ?? null);
  }

  // Shared by drag-and-drop and the "Add from Library" picker so both paths
  // update the grid immediately instead of waiting on a router.refresh()
  // round-trip -- previously only drag had this optimistic update, so the
  // Library path's only feedback was the item vanishing from Drafts, with
  // the target cell catching up (or not, if the refresh lagged/raced)
  // whenever the refresh eventually landed.
  function applySchedule(item: CalendarItem, date: string | null) {
    const itemKey = (i: CalendarItem) => `${i.itemType}-${i.itemId}`;

    const nextCells = effectiveCells.map((cell) => ({
      ...cell,
      items: cell.items.filter((i) => itemKey(i) !== itemKey(item)),
    }));
    let nextUnscheduled = effectiveUnscheduled.filter((i) => itemKey(i) !== itemKey(item));

    if (date) {
      const idx = nextCells.findIndex((c) => c.date === date);
      if (idx !== -1) {
        nextCells[idx] = { ...nextCells[idx], items: [...nextCells[idx].items, item] };
      }
    } else {
      nextUnscheduled = [...nextUnscheduled, item];
    }

    setOverrideCells(nextCells);
    setOverrideUnscheduled(nextUnscheduled);

    startTransition(async () => {
      await scheduleItem(projectId, item.itemType, item.itemId, date);
      router.refresh();
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveItem(null);
    const data = event.active.data.current as
      | { itemType: CalendarItemType; itemId: string; item: CalendarItem }
      | undefined;
    const overData = event.over?.data.current as { date: string | null } | undefined;
    if (!data || !overData) return;
    applySchedule(data.item, overData.date);
  }

  // Saves inline, optimistically -- the cell shows the new note text (or
  // goes back to empty) immediately instead of waiting on the round trip,
  // same reasoning as applySchedule's optimistic override above.
  function handleSaveNote(date: string, body: string) {
    setEditingNoteDate(null);
    const trimmed = body.trim();
    setOverrideCells(
      effectiveCells.map((cell) => (cell.date === date ? { ...cell, note: trimmed || null } : cell)),
    );
    startTransition(async () => {
      await upsertCalendarNote(projectId, date, trimmed);
      router.refresh();
    });
  }

  const libraryCell = libraryDialog ? effectiveCells.find((c) => c.date === libraryDialog.date) : undefined;
  const libraryItems = libraryDialog
    ? effectiveUnscheduled.filter((item) => item.itemType === libraryDialog.itemType)
    : [];

  function handleAssignFromLibrary(item: CalendarItem) {
    if (!libraryDialog) return;
    applySchedule(item, libraryDialog.date);
    setLibraryDialog(null);
  }

  // Same "stay on Calendar, no navigation" fix as DayDetailDialog's own
  // create handlers -- this is a second entry point to the identical action.
  function handleContextCreatePost(date: string) {
    setContextMenu(null);
    startTransition(async () => {
      await createPostForDate(projectId, date);
      router.refresh();
    });
  }

  function handleContextCreateStory(date: string) {
    setContextMenu(null);
    startTransition(async () => {
      await createStoryForDate(projectId, date);
      router.refresh();
    });
  }

  function handleRemoveFromSchedule(cell: CalendarCell) {
    setContextMenu(null);
    if (!confirm(`Remove ${cell.items.length > 1 ? "all scheduled content" : "this"} from ${cell.date}?`)) return;
    for (const item of cell.items) applySchedule(item, null);
  }

  const dayDetailCell = dayDetailDate ? effectiveCells.find((c) => c.date === dayDetailDate) : undefined;
  const contextMenuCell = contextMenu ? effectiveCells.find((c) => c.date === contextMenu.date) : undefined;

  return (
    <div>
      <DndContext
        id={`calendar-dnd-${projectId}`}
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveItem(null)}
      >
        <div className="flex flex-col gap-10 lg:flex-row">
          <div className="flex-1">
            <div className="relative mb-6 flex items-center gap-4 sm:gap-8">
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

            {/* No forced min-width/horizontal scroll here -- the grid sizes
                itself to whatever width is available so a whole week is
                always visible on mobile without needing to scroll on two
                axes at once (the real usability problem with a fixed-width
                calendar on a phone, more than any single element being too
                small). Cell content is compact enough to work at any width;
                tapping a day always opens the same DayDetailDialog with the
                full item list and actions, so nothing is lost by shrinking
                the grid down. */}
            <div>
              <div className="grid grid-cols-7 text-center text-[10px] font-semibold tracking-wide uppercase sm:text-xs">
                {WEEKDAY_LABELS.map((d) => (
                  <div key={d} className="py-2">
                    {d.slice(0, 3)}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {effectiveCells.map((cell, index) => (
                  <DayCell
                    key={cell.date}
                    projectId={projectId}
                    cell={cell}
                    isExpanded={Math.floor(index / 7) === expandedRowIndex}
                    onToggleRow={() =>
                      setExpandedRowIndex((current) => {
                        const rowIndex = Math.floor(index / 7);
                        return current === rowIndex ? null : rowIndex;
                      })
                    }
                    onOpenDetail={() => setDayDetailDate(cell.date)}
                    onContextMenu={
                      canManage ? (x, y) => setContextMenu({ date: cell.date, x, y }) : undefined
                    }
                    canManage={canManage}
                    isEditingNote={editingNoteDate === cell.date}
                    onStartEditNote={() => setEditingNoteDate(cell.date)}
                    onCancelEditNote={() => setEditingNoteDate(null)}
                    onSaveNote={(body) => handleSaveNote(cell.date, body)}
                  />
                ))}
              </div>
            </div>
          </div>

          {canManage && (
            <div className="w-full lg:w-64 lg:shrink-0">
              <UnscheduledPanel projectId={projectId} items={effectiveUnscheduled} />
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeItem && (
            <div className="flex w-fit items-center gap-2 rounded-full border border-foreground bg-background px-2.5 py-1 text-[11px] shadow-[0_2px_10px_rgba(0,0,0,0.1)]">
              <span className="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-black/10">
                {activeItem.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={activeItem.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                )}
              </span>
              <span className="truncate">{activeItem.label}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <DayDetailDialog
        projectId={projectId}
        cell={dayDetailCell ?? null}
        canManage={canManage}
        onClose={() => setDayDetailDate(null)}
        onOpenLibrary={(itemType) => {
          if (!dayDetailCell) return;
          setDayDetailDate(null);
          setLibraryDialog({ date: dayDetailCell.date, itemType });
        }}
      />

      {contextMenu && contextMenuCell && (
        <DayContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasContent={contextMenuCell.items.length > 0}
          onClose={() => setContextMenu(null)}
          onAddPostFromLibrary={() => {
            setContextMenu(null);
            setLibraryDialog({ date: contextMenuCell.date, itemType: "post" });
          }}
          onAddStoryFromLibrary={() => {
            setContextMenu(null);
            setLibraryDialog({ date: contextMenuCell.date, itemType: "story" });
          }}
          onCreatePost={() => handleContextCreatePost(contextMenuCell.date)}
          onCreateStory={() => handleContextCreateStory(contextMenuCell.date)}
          onAddNote={() => {
            setContextMenu(null);
            setEditingNoteDate(contextMenuCell.date);
          }}
          onRemoveFromSchedule={() => handleRemoveFromSchedule(contextMenuCell)}
        />
      )}

      <Dialog
        open={libraryDialog !== null}
        onClose={() => setLibraryDialog(null)}
        title={libraryDialog?.itemType === "story" ? "Add Story from Library" : "Add Post from Library"}
        radius="none"
      >
        {/* Capped to roughly 9 rows, bounded by viewport height too so it
            doesn't grow unboundedly with a project's full unscheduled
            library -- scrolls internally for anything past that. */}
        <div className="grid max-h-[min(1400px,70vh)] grid-cols-4 gap-2 overflow-y-auto">
          {libraryItems.map((item) => (
            <button
              key={`${item.itemType}-${item.itemId}`}
              type="button"
              onClick={() => handleAssignFromLibrary(item)}
              title={item.label}
              className="flex aspect-[3/4] flex-col overflow-hidden border border-border transition-colors duration-150 hover:border-foreground/30"
            >
              <span className="min-h-0 flex-1 overflow-hidden">
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-black/[.04] text-muted">
                    {item.itemType === "story" ? "📖" : "🖼"}
                  </span>
                )}
              </span>
              <span className="shrink-0 truncate px-1 py-1 text-[10px] text-muted">{item.label}</span>
            </button>
          ))}
        </div>
        {libraryItems.length === 0 && (
          <p className="text-sm text-muted">
            {libraryDialog?.itemType === "story" ? "No unscheduled stories." : "No unscheduled posts."}
          </p>
        )}
        {libraryCell && (
          <p className="mt-4 text-xs text-muted">Scheduling for {libraryCell.date}.</p>
        )}
      </Dialog>
    </div>
  );
}

function DayCell({
  projectId,
  cell,
  isExpanded,
  onToggleRow,
  onOpenDetail,
  onContextMenu,
  canManage,
  isEditingNote,
  onStartEditNote,
  onCancelEditNote,
  onSaveNote,
}: {
  projectId: string;
  cell: CalendarCell;
  isExpanded: boolean;
  onToggleRow: () => void;
  onOpenDetail: () => void;
  onContextMenu?: (x: number, y: number) => void;
  canManage: boolean;
  isEditingNote: boolean;
  onStartEditNote: () => void;
  onCancelEditNote: () => void;
  onSaveNote: (body: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `day-${cell.date}`,
    data: { date: cell.date },
  });
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
    const now = Date.now();
    const isDoubleClick = now - lastClickAtRef.current < DOUBLE_CLICK_WINDOW_MS;
    lastClickAtRef.current = now;

    if (isDoubleClick) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      onOpenDetail();
      return;
    }

    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onToggleRow();
    }, DOUBLE_CLICK_WINDOW_MS);
  }

  function handleNoteKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    e.stopPropagation();
    if (e.key === "Escape") {
      onCancelEditNote();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSaveNote(e.currentTarget.value);
    }
  }

  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={handleClick}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              onContextMenu(e.clientX, e.clientY);
            }
          : undefined
      }
      title="Click to expand this week, double-click for day options, right-click for quick actions"
      className={`flex flex-col items-start gap-1 border p-1 text-left text-xs transition-[background-color,border-color,min-height] duration-200 sm:p-2 ${
        isExpanded ? "min-h-40 sm:min-h-56" : "min-h-16 sm:min-h-24"
      } ${
        hasContent
          ? cell.isCurrentMonth
            ? "border-border"
            : "border-black/5 text-muted"
          : cell.isCurrentMonth
            ? "border-dashed border-border"
            : "border-dashed border-black/5 text-muted"
      } ${cell.isToday ? "outline outline-2 outline-offset-[-2px] outline-foreground" : ""} ${
        // Every item in the day is Published -- the "completed day" dark
        // read-at-a-glance state. A mix of published/unpublished items keeps
        // the cell's normal border/background; each tile still shows its own
        // published state individually (see ExpandedItemTile).
        allPublished ? "border-foreground bg-foreground text-background" : isOver ? "bg-black/[.04]" : "hover:bg-black/[.02]"
      }`}
    >
      <div className="flex w-full shrink-0 items-center justify-between">
        <span className="text-[11px] font-semibold sm:text-xs">{cell.dayNumber}</span>
      </div>

      {/* Notes no longer open a popup -- an inline textarea appears right
          here in the cell (a "live bubble"), and a saved note renders in
          the same bordered-frame language as the content chips/tiles below
          it, not a separate emoji indicator. */}
      {isEditingNote ? (
        <textarea
          autoFocus
          defaultValue={cell.note ?? ""}
          rows={2}
          placeholder="Note..."
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleNoteKeyDown}
          onBlur={(e) => onSaveNote(e.currentTarget.value)}
          className="w-full shrink-0 resize-none rounded-none border border-foreground bg-background px-1 py-0.5 text-[9px] focus:outline-none sm:text-[10px]"
        />
      ) : (
        cell.note && (
          // A div, not a <button> -- this already sits inside DayCell's own
          // outer <button>, and a <button> nested in a <button> is invalid
          // HTML that the browser's parser silently un-nests, causing a
          // React hydration mismatch (confirmed live: "cannot be a
          // descendant of <button>").
          <div
            role={canManage ? "button" : undefined}
            tabIndex={canManage ? 0 : undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (canManage) onStartEditNote();
            }}
            onKeyDown={(e) => {
              if (canManage && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                e.stopPropagation();
                onStartEditNote();
              }
            }}
            title={cell.note}
            className={`w-full shrink-0 rounded-none border border-border bg-black/[.02] px-1 py-0.5 text-left text-[9px] text-muted sm:text-[10px] ${
              isExpanded ? "line-clamp-3 whitespace-pre-wrap" : "truncate"
            }`}
          >
            {cell.note}
          </div>
        )
      )}

      {previewItems.length > 0 && (
        <div className={isExpanded ? "flex w-full flex-col gap-1" : "flex flex-wrap gap-1"}>
          {previewItems.map((item) =>
            isExpanded ? (
              <ExpandedItemTile
                key={`${item.itemType}-${item.itemId}`}
                projectId={projectId}
                item={item}
                canManage={canManage}
              />
            ) : (
              <CompactItemChip key={`${item.itemType}-${item.itemId}`} item={item} />
            ),
          )}
          {hiddenCount > 0 && <span className="text-[9px] text-muted">+{hiddenCount}</span>}
        </div>
      )}
    </button>
  );
}

// Matches Brief's image-chip language (rounded-full pill, small circular
// thumbnail, label text) -- draggable so an already-scheduled item can be
// picked up and dropped on a different day, same as items dragged in from
// the Drafts sidebar.
function CompactItemChip({ item }: { item: CalendarItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cell-item-${item.itemType}-${item.itemId}`,
    data: { itemType: item.itemType, itemId: item.itemId, item },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => e.stopPropagation()}
      className={`max-w-full touch-none transition-opacity duration-150 ${isDragging ? "opacity-30" : ""}`}
    >
      <Link
        href={item.href}
        title={contentTypeLabel(item)}
        className="flex max-w-full items-center gap-1 rounded-full border border-border bg-background py-0.5 pr-1.5 pl-0.5 text-[9px] transition-colors duration-150 hover:border-foreground/30 sm:text-[10px]"
      >
        <span className="h-3.5 w-3.5 shrink-0 overflow-hidden rounded-full bg-black/10 sm:h-4 sm:w-4">
          {item.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[7px]">
              {item.itemType === "story" ? "📖" : "🖼"}
            </span>
          )}
        </span>
        <span className="truncate">{contentTypeLabel(item)}</span>
      </Link>
    </div>
  );
}

// The expanded-row tile: a real, readable image (not a small icon) at a
// fixed 3:4 ratio, full width of the cell -- these now stack vertically
// (see DayCell's container above) rather than sharing a row, so this is
// `w-full` instead of the old `flex-1` row-sharing width. Content-type tag
// stays a small corner badge (the same "minimal tag" language as Grid's
// asset-count/video badges). Draggable for the same reason as CompactItemChip.
function ExpandedItemTile({
  projectId,
  item,
  canManage,
}: {
  projectId: string;
  item: CalendarItem;
  canManage: boolean;
}) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cell-item-${item.itemType}-${item.itemId}`,
    data: { itemType: item.itemType, itemId: item.itemId, item },
  });
  const [pending, startTransition] = useTransition();
  // Optimistic override so the toggle flips instantly instead of waiting on
  // the server round-trip + router.refresh() -- null means "trust item.status".
  const [optimisticPublished, setOptimisticPublished] = useState<boolean | null>(null);
  const published = optimisticPublished ?? item.status === "published";

  function togglePublished() {
    if (pending) return;
    const next = !published;
    setOptimisticPublished(next);
    startTransition(async () => {
      await setItemPublished(projectId, item.itemType, item.itemId, next);
      router.refresh();
    });
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => e.stopPropagation()}
      className={`w-full touch-none transition-opacity duration-150 ${isDragging ? "opacity-30" : ""}`}
    >
      <Link
        href={item.href}
        title={contentTypeLabel(item)}
        className={`relative block aspect-[3/4] w-full overflow-hidden border transition-colors duration-150 ${
          published ? "border-foreground/60 bg-black/[.03]" : "border-border bg-black/[.03] hover:border-foreground/30"
        }`}
      >
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt=""
            className={`h-full w-full object-cover ${published ? "opacity-70" : ""}`}
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
        {canManage && (
          // A <span role="button">, not a real <button> -- this already sits
          // inside a <Link> (an <a>) which itself sits inside DayCell's own
          // outer <button>, and a <button> nested in a <button> is invalid
          // HTML the browser's parser silently un-nests, causing a React
          // hydration mismatch (confirmed live: "cannot contain a nested
          // <button>") -- same reasoning as DayCell's own note-edit div above.
          <span
            role="button"
            tabIndex={0}
            aria-disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              togglePublished();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                togglePublished();
              }
            }}
            title={published ? "Mark not published" : "Mark published"}
            className={`absolute right-1 top-1 rounded-full ${pending ? "opacity-50" : ""}`}
          >
            {published ? (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="8" fill="white" />
                <path d="M5.5 9.2 7.7 11.3 12.5 6.5" stroke="black" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="8" className="fill-black/40" stroke="white" strokeWidth="1.4" />
              </svg>
            )}
          </span>
        )}
      </Link>
    </div>
  );
}

function DayContextMenu({
  x,
  y,
  hasContent,
  onClose,
  onAddPostFromLibrary,
  onAddStoryFromLibrary,
  onCreatePost,
  onCreateStory,
  onAddNote,
  onRemoveFromSchedule,
}: {
  x: number;
  y: number;
  hasContent: boolean;
  onClose: () => void;
  onAddPostFromLibrary: () => void;
  onAddStoryFromLibrary: () => void;
  onCreatePost: () => void;
  onCreateStory: () => void;
  onAddNote: () => void;
  onRemoveFromSchedule: () => void;
}) {
  const menuRef = useOutsideClick<HTMLDivElement>(true, onClose);
  // Clamp so the menu never opens off the right/bottom edge of the viewport
  // near the last column/row of the grid.
  const MENU_WIDTH = 200;
  const MENU_MAX_HEIGHT = 260;
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(y, window.innerHeight - MENU_MAX_HEIGHT - 8);

  return (
    <div
      ref={menuRef}
      style={{ left, top, width: MENU_WIDTH }}
      className="fixed z-50 flex flex-col gap-2 rounded-none border border-border bg-background p-2 text-xs shadow-[0_2px_10px_rgba(0,0,0,0.15)]"
    >
      <div className="flex flex-col">
        <span className="px-1 pb-1 text-[10px] tracking-wide text-muted uppercase">Add Draft Item</span>
        <button
          type="button"
          onClick={onAddPostFromLibrary}
          className="w-full rounded px-2 py-1.5 text-left transition-colors duration-150 hover:bg-black/[.05]"
        >
          Add Post from Library
        </button>
        <button
          type="button"
          onClick={onAddStoryFromLibrary}
          className="w-full rounded px-2 py-1.5 text-left transition-colors duration-150 hover:bg-black/[.05]"
        >
          Add Story from Library
        </button>
      </div>
      <div className="flex flex-col border-t border-border pt-2">
        <span className="px-1 pb-1 text-[10px] tracking-wide text-muted uppercase">Create New</span>
        <button
          type="button"
          onClick={onCreatePost}
          className="w-full rounded px-2 py-1.5 text-left transition-colors duration-150 hover:bg-black/[.05]"
        >
          + New Post
        </button>
        <button
          type="button"
          onClick={onCreateStory}
          className="w-full rounded px-2 py-1.5 text-left transition-colors duration-150 hover:bg-black/[.05]"
        >
          + New Story
        </button>
      </div>
      <div className="flex flex-col border-t border-border pt-2">
        <button
          type="button"
          onClick={onAddNote}
          className="w-full rounded px-2 py-1.5 text-left transition-colors duration-150 hover:bg-black/[.05]"
        >
          Add Note
        </button>
        {hasContent && (
          <button
            type="button"
            onClick={onRemoveFromSchedule}
            className="w-full rounded px-2 py-1.5 text-left text-error transition-colors duration-150 hover:bg-black/[.05]"
          >
            Remove from Schedule
          </button>
        )}
      </div>
    </div>
  );
}

function CalendarItemRow({ item }: { item: CalendarItem }) {
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 border border-border p-2 transition-colors duration-150 hover:border-foreground/30"
    >
      <div className="h-16 w-16 shrink-0 overflow-hidden border border-border sm:h-20 sm:w-20">
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-black/[.04] text-2xl text-muted">
            {item.itemType === "story" ? "📖" : "🖼"}
          </div>
        )}
      </div>
      <span className="truncate text-xs">
        {item.itemType === "story" ? "📖 " : "🖼 "}
        {item.label}
      </span>
    </Link>
  );
}

function DayDetailDialog({
  projectId,
  cell,
  canManage,
  onClose,
  onOpenLibrary,
}: {
  projectId: string;
  cell: CalendarCell | null;
  canManage: boolean;
  onClose: () => void;
  onOpenLibrary: (itemType: CalendarItemType) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Deliberately no router.push to the new post/story's own editor page --
  // closing this popup always returns to Calendar, which stays the current
  // workspace instead of navigating away to /posts/[id] or /stories/[id].
  // router.refresh() is what makes the new item show up in its day cell.
  function handleCreatePost() {
    if (!cell) return;
    const date = cell.date;
    onClose();
    startTransition(async () => {
      await createPostForDate(projectId, date);
      router.refresh();
    });
  }

  function handleCreateStory() {
    if (!cell) return;
    const date = cell.date;
    onClose();
    startTransition(async () => {
      await createStoryForDate(projectId, date);
      router.refresh();
    });
  }

  return (
    <Dialog open={cell !== null} onClose={onClose} title={cell?.date ?? ""} radius="none">
      {cell && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            {cell.items.map((item) => (
              <CalendarItemRow key={`${item.itemType}-${item.itemId}`} item={item} />
            ))}
            {cell.items.length === 0 && <p className="text-sm text-muted">Nothing scheduled.</p>}
          </div>

          {canManage && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" radius="none" onClick={() => onOpenLibrary("post")}>
                  Add Post from Library
                </Button>
                <Button type="button" variant="secondary" radius="none" onClick={() => onOpenLibrary("story")}>
                  Add Story from Library
                </Button>
                <Button type="button" variant="secondary" radius="none" onClick={handleCreatePost}>
                  + New post
                </Button>
                <Button type="button" variant="secondary" radius="none" onClick={handleCreateStory}>
                  + New story
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}


function UnscheduledPanel({ projectId, items }: { projectId: string; items: CalendarItem[] }) {
  const { isOver, setNodeRef } = useDroppable({
    id: "unscheduled-panel",
    data: { date: null },
  });
  const [visibleCount, setVisibleCount] = useState(UNSCHEDULED_PAGE_SIZE);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useOutsideClick<HTMLDivElement>(createMenuOpen, () => setCreateMenuOpen(false));
  const visibleItems = items.slice(0, visibleCount);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-4 p-2 transition-colors duration-150 ${isOver ? "bg-black/[.04]" : ""}`}
    >
      <div className="bg-foreground px-4 py-2 text-center text-xs tracking-wide uppercase text-background">
        Drafts
      </div>

      <div className="grid grid-cols-2 gap-2">
        {visibleItems.map((item) => (
          <ItemChip key={`${item.itemType}-${item.itemId}`} item={item} size="square" />
        ))}
        <div ref={createMenuRef} className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCreateMenuOpen((v) => !v);
            }}
            title="Add content"
            className="flex aspect-square w-full items-center justify-center border border-dashed border-border text-2xl text-muted transition-colors duration-150 hover:border-foreground/30 hover:text-foreground"
          >
            +
          </button>
          {createMenuOpen && (
            <CreateContentMenu projectId={projectId} onClose={() => setCreateMenuOpen(false)} />
          )}
        </div>
      </div>

      {items.length === 0 && <p className="text-xs text-muted">Nothing unscheduled.</p>}

      {items.length > visibleCount && (
        <button
          type="button"
          onClick={() => setVisibleCount((c) => c + UNSCHEDULED_PAGE_SIZE)}
          className="w-fit text-xs font-semibold uppercase tracking-wide transition-colors duration-150 hover:text-muted"
        >
          View More +
        </button>
      )}

      <ScheduleContentButton projectId={projectId} />
    </div>
  );
}

function ScheduleContentButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={menuRef} className="relative mt-4">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-full rounded-none bg-foreground px-4 py-3 text-xs tracking-wide uppercase text-background transition-colors duration-150 hover:bg-black/85"
      >
        Schedule Content
      </button>
      {open && <CreateContentMenu projectId={projectId} onClose={() => setOpen(false)} />}
    </div>
  );
}

// New post/story creation is already fully built on the Grid and Stories
// pages (row + drag media, and Add New Story); this menu is just a shortcut
// into those existing flows rather than a new creation path.
function CreateContentMenu({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-full z-20 mt-1 w-40 rounded-none border border-border bg-background p-1 shadow-lg"
    >
      <Link
        href={`/projects/${projectId}/grid`}
        onClick={onClose}
        className="block rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
      >
        New Post
      </Link>
      <Link
        href={`/projects/${projectId}/stories`}
        onClick={onClose}
        className="block rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
      >
        New Story
      </Link>
    </div>
  );
}

function ItemChip({ item, size = "pill" }: { item: CalendarItem; size?: "pill" | "square" }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `item-${item.itemType}-${item.itemId}`,
    data: { itemType: item.itemType, itemId: item.itemId, item },
  });

  if (size === "square") {
    return (
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={(e) => e.stopPropagation()}
        className={`touch-none transition-opacity duration-150 ${isDragging ? "opacity-30" : ""}`}
      >
        <Link href={item.href} className="flex flex-col gap-0.5">
          <div className="aspect-square overflow-hidden rounded-none border border-border transition-colors duration-150 hover:border-foreground/30">
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-black/[.04] text-muted">
                {item.itemType === "story" ? "📖" : "🖼"}
              </div>
            )}
          </div>
          <span className="truncate text-[10px] text-muted">{item.label}</span>
        </Link>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => e.stopPropagation()}
      className={`w-fit max-w-full touch-none transition-opacity duration-150 ${isDragging ? "opacity-30" : ""}`}
    >
      <Link
        href={item.href}
        className="flex items-center gap-2 rounded-full border border-foreground bg-background px-2.5 py-1 text-[11px] transition-colors duration-150 hover:bg-black/[.03]"
      >
        <span className="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-black/10">
          {item.thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          )}
        </span>
        <span className="truncate">{item.label}</span>
      </Link>
    </div>
  );
}
