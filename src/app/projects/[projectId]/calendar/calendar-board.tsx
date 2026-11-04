"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import {
  createPostForDate,
  createStoryForDate,
  scheduleItem,
  setItemPublished,
  upsertCalendarNote,
  type CalendarItemType,
} from "@/lib/actions/calendar";
import { deletePost } from "@/lib/actions/posts";
import { deleteStoryFromCalendar } from "@/lib/actions/stories";
import { useOptimisticOverride } from "@/lib/hooks/use-optimistic-override";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MentionField } from "@/components/ui/mention-input";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import type { ProjectMemberOption } from "@/lib/data/post-comments";
import type { CalendarCell, CalendarItem } from "@/lib/calendar-cells";
import {
  CalendarView,
  DayNote,
  ITEM_CHIP_CLASS,
  ItemChipBody,
  ItemTileBody,
  contentTypeLabel,
  itemTileClassName,
  type CalendarDayDrop,
  type CalendarItemVariant,
  type CalendarViewSlots,
} from "./calendar-view";

export type { CalendarCell, CalendarItem } from "@/lib/calendar-cells";

type LibraryDialogState = { date: string; itemType: CalendarItemType } | null;

const UNSCHEDULED_PAGE_SIZE = 6; // 3 rows x 2 columns before "+ Load more"

// What the board's CalendarView slots (BOARD_SLOTS below) read -- context
// rather than props so the slots stay one stable module-level object and
// CalendarView's memoized day cells don't all re-render on every change.
// Split in two so starting a note edit doesn't re-render every item tile.
const BoardItemContext = createContext<{ projectId: string; canManage: boolean }>({
  projectId: "",
  canManage: false,
});
const BoardNoteContext = createContext<{
  canManage: boolean;
  members: ProjectMemberOption[];
  editingNoteDate: string | null;
  onStartEditNote: (date: string) => void;
  onCancelEditNote: () => void;
  onSaveNote: (date: string, body: string) => void;
} | null>(null);

// dnd-kit's own DragOverlay always sizes and positions its wrapper to match
// the ORIGINAL dragged element's rect (see PositionedOverlay in
// @dnd-kit/core), then only translates it by how far the pointer has moved
// since drag start -- it never re-centers on the cursor. That's invisible
// on Grid, where every tile is the same fixed size as its own overlay
// preview, but Calendar's chips vary a lot: a compact pill in the collapsed
// row vs. a full-width, much taller tile in the expanded row and the
// Drafts panel, against ONE small fixed-size pill overlay. Whatever the
// difference is between "top-left of the tile you actually grabbed" and
// "top-left of the small overlay pill" becomes a constant offset for the
// entire drag -- exactly the "doesn't stay attached to the cursor / jumps
// to an offset" bug. This is dnd-kit's own documented fix (equivalent to
// @dnd-kit/modifiers' snapCenterToCursor, reimplemented inline rather than
// adding a dependency for one ~10-line function): it adjusts the transform
// so the overlay's CENTER tracks the cursor every frame, regardless of how
// large the original element was or where within it you clicked.
const centerOverlayOnCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const activatorCoordinates = getEventCoordinates(activatorEvent);
  if (!activatorCoordinates) return transform;
  return {
    ...transform,
    x: transform.x + (activatorCoordinates.x - draggingNodeRect.left) - draggingNodeRect.width / 2,
    y: transform.y + (activatorCoordinates.y - draggingNodeRect.top) - draggingNodeRect.height / 2,
  };
};
const CALENDAR_DRAG_MODIFIERS = [centerOverlayOnCursor];

export function CalendarBoard({
  projectId,
  monthLabel,
  prevMonthParam,
  nextMonthParam,
  cells,
  unscheduled,
  canManage,
  members,
  weekStartsOn = 0,
}: {
  projectId: string;
  monthLabel: string;
  prevMonthParam: string;
  nextMonthParam: string;
  cells: CalendarCell[];
  unscheduled: CalendarItem[];
  canManage: boolean;
  members: ProjectMemberOption[];
  // Account > Workspace's Week Starts On (0=Sunday, 1=Monday) -- see
  // CalendarView. showWeekends isn't wired into an actual column-hide yet --
  // doing that safely means also updating CalendarView's row-expand math
  // (Math.floor(index / 7), hardcoded to a 7-wide week) and drag-and-drop's
  // own per-row grouping, not just the grid's column count -- left as a
  // saved-but-not-yet-applied preference rather than risk that regressing
  // without being able to test drag-and-drop interactively.
  weekStartsOn?: 0 | 1;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [libraryDialog, setLibraryDialog] = useState<LibraryDialogState>(null);
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);
  // Right-click quick-actions menu: add a draft item, create new, add a
  // note, or remove whatever's scheduled -- a faster path to the same
  // actions DayDetailDialog already offers, without opening the full modal.
  const [contextMenu, setContextMenu] = useState<{ date: string; x: number; y: number } | null>(null);
  const [activeItem, setActiveItem] = useState<CalendarItem | null>(null);
  // Which cell (if any) is showing its inline note editor -- notes no
  // longer open a popup; the textarea lives directly in the cell instead.
  const [editingNoteDate, setEditingNoteDate] = useState<string | null>(null);
  // Touch needs a long-press (not a tiny movement threshold) to activate a
  // drag, same reasoning and same values as Grid's own board -- a bare
  // distance-based activator fires on the first pixel of a scroll swipe on
  // touch, which is what made touch drags feel like they never picked the
  // item up cleanly. Desktop keeps the original short distance threshold so
  // a normal click-through to the post/story still works.
  const isTouchDevice = useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(pointer: coarse)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: isTouchDevice ? { delay: 200, tolerance: 8 } : { distance: 4 },
    }),
  );

  // Optimistic override so scheduling an item renders immediately instead of
  // waiting for the server round-trip + router.refresh() — otherwise the
  // calendar visibly snaps back to the old date for a beat after drop.
  const { value: effectiveCells, set: setOverrideCells } = useOptimisticOverride(cells);
  const { value: effectiveUnscheduled, set: setOverrideUnscheduled } = useOptimisticOverride(unscheduled);

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

    // The optimistic move above is already the final state, and the write
    // below is durable, so a router.refresh() on success would only cause a
    // redundant flash (every visible chip's thumbnail gets a freshly
    // re-signed URL on every route refetch) -- same reasoning as Grid's own
    // reorder. On failure, resync with the server instead of leaving an
    // optimistic state that was never actually persisted.
    startTransition(async () => {
      try {
        await scheduleItem(projectId, item.itemType, item.itemId, date);
      } catch (error) {
        console.error("Failed to save schedule change:", error);
        setOverrideCells(null);
        setOverrideUnscheduled(null);
        router.refresh();
      }
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
  // same reasoning as applySchedule's optimistic override above. useCallback
  // (dep on effectiveCells, which only gets a new reference on a real data
  // change, never on an unrelated UI-only re-render) so DayCell's memo below
  // actually holds -- otherwise every cell would see a "new" onSaveNote
  // prop on every render of CalendarBoard.
  const handleSaveNote = useCallback(
    (date: string, body: string) => {
      setEditingNoteDate(null);
      const trimmed = body.trim();
      const previousCells = effectiveCells;
      setOverrideCells(
        effectiveCells.map((cell) => (cell.date === date ? { ...cell, note: trimmed || null } : cell)),
      );
      startTransition(async () => {
        const result = await upsertCalendarNote(projectId, date, trimmed);
        if (!result.success) {
          console.error("Failed to save note:", result.message);
          setOverrideCells(previousCells);
          router.refresh();
        }
      });
    },
    // setOverrideCells is stable (useOptimisticOverride memoizes it via
    // useCallback) -- eslint can't see through the custom hook to know
    // that, but it's included here since it genuinely is a dependency.
    [effectiveCells, projectId, router, startTransition, setOverrideCells],
  );

  // Stable references for the rest of the day cells' callbacks, same
  // reasoning as handleSaveNote above.
  const handleCancelEditNote = useCallback(() => setEditingNoteDate(null), []);
  const handleOpenContextMenu = useCallback(
    (date: string, x: number, y: number) => setContextMenu({ date, x, y }),
    [],
  );

  const itemContext = useMemo(() => ({ projectId, canManage }), [projectId, canManage]);
  const noteContext = useMemo(
    () => ({
      canManage,
      members,
      editingNoteDate,
      onStartEditNote: setEditingNoteDate,
      onCancelEditNote: handleCancelEditNote,
      onSaveNote: handleSaveNote,
    }),
    [canManage, members, editingNoteDate, handleCancelEditNote, handleSaveNote],
  );

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
        // Was missing entirely -- dnd-kit's default (rectIntersection)
        // requires the dragged chip's rect to actually overlap a day cell's
        // rect, which is unreliable for small/edge drops. closestCenter
        // (already used by Grid's own board for the same dnd-kit setup)
        // resolves to whichever droppable's center is nearest instead, far
        // more forgiving for dropping onto a small calendar cell.
        collisionDetection={closestCenter}
        modifiers={CALENDAR_DRAG_MODIFIERS}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveItem(null)}
      >
        <BoardItemContext.Provider value={itemContext}>
          <BoardNoteContext.Provider value={noteContext}>
            <CalendarView
              monthLabel={monthLabel}
              prevMonthParam={prevMonthParam}
              nextMonthParam={nextMonthParam}
              cells={effectiveCells}
              weekStartsOn={weekStartsOn}
              slots={BOARD_SLOTS}
              onOpenDayDetail={setDayDetailDate}
              onDayMenu={canManage ? handleOpenContextMenu : undefined}
              aside={
                canManage && (
                  <div className="w-full lg:w-64 lg:shrink-0">
                    <UnscheduledPanel projectId={projectId} items={effectiveUnscheduled} />
                  </div>
                )
              }
            />
          </BoardNoteContext.Provider>
        </BoardItemContext.Provider>

        <DragOverlay dropAnimation={null}>
          {activeItem && (
            // dnd-kit's own overlay wrapper is sized to match whichever
            // source element was actually dragged (a small chip or a much
            // larger expanded tile) -- this inner wrapper fills that box and
            // centers the fixed-size pill within it, so the pill itself
            // lands exactly on the cursor (which centerOverlayOnCursor above
            // now targets), regardless of the source element's own size.
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex w-fit items-center gap-2 rounded-full border border-foreground bg-background px-2.5 py-1 text-[11px] shadow-[0_2px_10px_rgba(0,0,0,0.1)]">
                <span className="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-black/10">
                  {activeItem.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={activeItem.thumbnailUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                  )}
                </span>
                <span className="truncate">{activeItem.label}</span>
              </div>
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
                  <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
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

// The board's CalendarView slots: draggable/linked items with the publish
// toggle, inline-editable notes, and droppable day cells. One stable
// module-level object -- see BoardItemContext for where their state comes
// from.
function BoardCalendarItem({
  item,
  variant,
  onDarkCell,
}: {
  item: CalendarItem;
  variant: CalendarItemVariant;
  onDarkCell: boolean;
}) {
  const { projectId, canManage } = useContext(BoardItemContext);
  if (variant === "chip") return <CompactItemChip item={item} />;
  if (variant === "strip") {
    return (
      <ExpandedItemTile
        projectId={projectId}
        item={item}
        canManage={canManage}
        widthClassName="w-28 shrink-0"
        draggable={false}
      />
    );
  }
  return <ExpandedItemTile projectId={projectId} item={item} canManage={canManage} onDarkCell={onDarkCell} />;
}

// Notes no longer open a popup -- an inline textarea appears right here in
// the cell/row (a "live bubble"), and a saved note renders as DayNote.
// Always mounted per day (CalendarView renders the Note slot whether or not
// the day has a note), so the draft text below lives exactly as long as it
// did when this was part of DayCell/MobileDayRow themselves.
function BoardDayNote({
  cell,
  variant,
  allPublished,
  isExpanded,
}: {
  cell: CalendarCell;
  variant: "cell" | "row";
  allPublished: boolean;
  isExpanded: boolean;
}) {
  const { canManage, members, editingNoteDate, onStartEditNote, onCancelEditNote, onSaveNote } =
    useContext(BoardNoteContext)!;
  const isEditingNote = editingNoteDate === cell.date;
  const [noteText, setNoteText] = useState(cell.note ?? "");
  // Adjust state during render (this codebase's own convention, see
  // post-editor.tsx's prevAssets) rather than an effect -- only reset on the
  // false->true transition into edit mode, not on every cell.note change,
  // which would stomp in-progress typing once revalidatePath refreshes
  // server data mid-edit.
  const [prevIsEditingNote, setPrevIsEditingNote] = useState(isEditingNote);
  if (isEditingNote !== prevIsEditingNote) {
    setPrevIsEditingNote(isEditingNote);
    if (isEditingNote) setNoteText(cell.note ?? "");
  }

  function handleNoteKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    // The desktop cell sits inside DayCell's own <button> -- keep its keys
    // from reaching it.
    if (variant === "cell") e.stopPropagation();
    // MentionField already consumed this key for its own dropdown
    // (navigating/selecting a mention, or dismissing it) -- don't also
    // save/cancel the note on the same keystroke.
    if (e.defaultPrevented) return;
    if (e.key === "Escape") {
      onCancelEditNote();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSaveNote(cell.date, noteText);
    }
  }

  if (isEditingNote) {
    return variant === "cell" ? (
      <MentionField
        multiline
        autoFocus
        value={noteText}
        onChange={setNoteText}
        members={members}
        rows={2}
        placeholder="Note... (@ to mention)"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleNoteKeyDown}
        onBlur={() => onSaveNote(cell.date, noteText)}
        className="w-full shrink-0 resize-none rounded-none border border-foreground bg-background px-1 py-0.5 text-[9px] text-foreground focus:outline-none sm:text-[10px]"
      />
    ) : (
      <MentionField
        multiline
        autoFocus
        value={noteText}
        onChange={setNoteText}
        members={members}
        rows={2}
        placeholder="Note... (@ to mention)"
        onKeyDown={handleNoteKeyDown}
        onBlur={() => onSaveNote(cell.date, noteText)}
        className="w-full resize-none rounded-none border border-foreground bg-background px-2 py-1 text-xs focus:outline-none"
      />
    );
  }

  return (
    <DayNote
      cell={cell}
      variant={variant}
      allPublished={allPublished}
      isExpanded={isExpanded}
      onActivate={canManage ? () => onStartEditNote(cell.date) : undefined}
    />
  );
}

function BoardDayDropTarget({ date, children }: { date: string; children: (drop: CalendarDayDrop) => ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `day-${date}`,
    data: { date },
  });
  return children({ ref: setNodeRef, isOver });
}

const BOARD_SLOTS: CalendarViewSlots = {
  Item: BoardCalendarItem,
  Note: BoardDayNote,
  DropTarget: BoardDayDropTarget,
};

// Matches Brief's image-chip language (rounded-full pill, small circular
// thumbnail, label text) -- draggable so an already-scheduled item can be
// picked up and dropped on a different day, same as items dragged in from
// the Drafts sidebar.
// memo: one of these renders per scheduled item across the whole visible
// month -- same reasoning as DayCell above. `item` is already a stable
// reference from its parent's array (DayCell's previewItems slice doesn't
// clone the underlying item objects), so no extra stabilization needed here.
const CompactItemChip = memo(function CompactItemChip({ item }: { item: CalendarItem }) {
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
        // The browser's own native link-drag (grab a link, drop it on the
        // address bar, etc.) fires from pointerdown on ANY <a>, completely
        // independent of dnd-kit's synthetic pointer-drag on the wrapping
        // div above -- without this, the two raced, which is what made the
        // chip feel like it never got picked up cleanly / lagged behind the
        // cursor. draggable={false} turns the native one off; dnd-kit's own
        // drag (via the wrapper's listeners) is unaffected.
        draggable={false}
        className={ITEM_CHIP_CLASS}
      >
        <ItemChipBody item={item} />
      </Link>
    </div>
  );
});

// The expanded-row tile: a real, readable image (not a small icon) at a
// fixed 3:4 ratio, full width of the cell -- these now stack vertically
// (see DayCell's container in calendar-view.tsx) rather than sharing a row, so this is
// `w-full` instead of the old `flex-1` row-sharing width. Content-type tag
// stays a small corner badge (the same "minimal tag" language as Grid's
// asset-count/video badges). Draggable for the same reason as CompactItemChip.
// memo, same reasoning as CompactItemChip above.
const ExpandedItemTile = memo(function ExpandedItemTile({
  projectId,
  item,
  canManage,
  widthClassName = "w-full",
  draggable = true,
  onDarkCell = false,
}: {
  projectId: string;
  item: CalendarItem;
  canManage: boolean;
  // "w-full" for the desktop expanded-row stack (unchanged default); the
  // mobile agenda's horizontal day strip passes a fixed width instead.
  widthClassName?: string;
  // Off for the mobile agenda -- a horizontal-scroll strip of draggable
  // tiles would reintroduce the same touch/scroll conflict the Grid mobile
  // pass fixes, and drag-to-reschedule isn't essential there since tapping
  // into the post/story to change its date already works.
  draggable?: boolean;
  // Set by CalendarView's DayCell when every item in the day is published, so the cell
  // itself is bg-foreground -- the published border (foreground/60) would
  // vanish against it, so it inverts instead.
  onDarkCell?: boolean;
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
      try {
        await setItemPublished(projectId, item.itemType, item.itemId, next);
      } catch (error) {
        console.error("Failed to update published status:", error);
        setOptimisticPublished(null);
        router.refresh();
      }
    });
  }

  return (
    <div
      ref={setNodeRef}
      {...(draggable ? { ...listeners, ...attributes } : {})}
      onClick={(e) => e.stopPropagation()}
      className={`${widthClassName} transition-opacity duration-150 ${draggable ? "touch-none" : ""} ${isDragging ? "opacity-30" : ""}`}
    >
      <Link
        href={item.href}
        title={contentTypeLabel(item)}
        // Same native-link-drag-vs-dnd-kit-drag conflict as CompactItemChip's
        // own Link above -- see its comment for why.
        draggable={false}
        className={itemTileClassName(published, onDarkCell)}
      >
        <ItemTileBody item={item} published={published}>
          {/* Comments live on the post/story editor itself (see ItemComments
              there) -- this is just a discoverable affordance pointing at the
              same destination the whole tile already links to, not a second
              comment UI. Hover-only: it doesn't indicate an actual comment
              count, so forcing it always-on for touch (no hover state) just
              put an unclear icon over every tile with no way to dismiss it --
              tapping the tile already reaches the same place. */}
          <span
            title="Comments"
            className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            💬
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
              // The visible glyph stays exactly 18x18 on every device -- the
              // pointer-coarse:before: rule only adds an invisible, larger hit
              // area around it (closer to the ~44px touch-target minimum)
              // without changing anything about how this looks or sits on
              // desktop, where a mouse doesn't need the extra margin.
              className={`absolute right-1 top-1 rounded-full pointer-coarse:before:absolute pointer-coarse:before:-inset-3 pointer-coarse:before:content-[''] ${pending ? "opacity-50" : ""}`}
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
        </ItemTileBody>
      </Link>
    </div>
  );
});

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
          <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
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
  const router = useRouter();
  const { isOver, setNodeRef } = useDroppable({
    id: "unscheduled-panel",
    data: { date: null },
  });
  const [visibleCount, setVisibleCount] = useState(UNSCHEDULED_PAGE_SIZE);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useOutsideClick<HTMLDivElement>(createMenuOpen, () => setCreateMenuOpen(false));
  const visibleItems = items.slice(0, visibleCount);

  // Same hover-to-reveal-a-circle multi-select + bulk-delete interaction as
  // Grid's Media Library (media-library.tsx's MediaThumb/selectedIds), keyed
  // by "type-id" since Drafts mixes posts and stories in one list.
  const itemKey = (item: CalendarItem) => `${item.itemType}-${item.itemId}`;
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  function toggleSelected(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const [bulkDeleting, startBulkDelete] = useTransition();
  function handleBulkDelete() {
    const selected = items.filter((item) => selectedKeys.has(itemKey(item)));
    if (selected.length === 0) return;
    if (!confirm(`Delete ${selected.length} item${selected.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    startBulkDelete(async () => {
      await Promise.all(
        selected.map((item) =>
          item.itemType === "story"
            ? deleteStoryFromCalendar(projectId, item.itemId)
            : deletePost(projectId, item.itemId),
        ),
      );
      setSelectedKeys(new Set());
      router.refresh();
    });
  }

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
          <ItemChip
            key={itemKey(item)}
            item={item}
            size="square"
            selected={selectedKeys.has(itemKey(item))}
            onToggleSelect={() => toggleSelected(itemKey(item))}
          />
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

      {selectedKeys.size > 0 && (
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 border border-border bg-card px-3 py-2 shadow-[0_2px_10px_rgba(0,0,0,0.1)]">
          <span className="text-xs tracking-wide text-muted uppercase">{selectedKeys.size} selected</span>
          <Button
            type="button"
            variant="primary"
            radius="none"
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="px-2 py-1 text-xs"
          >
            {bulkDeleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
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
      className="absolute right-0 top-full z-20 mt-1 w-40 max-w-[calc(100vw-1.5rem)] rounded-none border border-border bg-background p-1 shadow-lg"
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

function ItemChip({
  item,
  size = "pill",
  selected = false,
  onToggleSelect,
}: {
  item: CalendarItem;
  size?: "pill" | "square";
  // Only meaningful for size="square" (the Drafts panel) -- same hover-reveal
  // multi-select circle as Grid's MediaThumb, so bulk-deleting several draft
  // posts/stories at once works the same way it does for media assets there.
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
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
        className={`group relative touch-none transition-opacity duration-150 ${isDragging ? "opacity-30" : ""}`}
      >
        {/* draggable={false}: same native-link-drag-vs-dnd-kit conflict as
            CompactItemChip's own Link (calendar-board.tsx). */}
        <Link href={item.href} draggable={false} className="flex flex-col gap-0.5">
          <div className="relative aspect-square overflow-hidden rounded-none border border-border transition-colors duration-150 hover:border-foreground/30">
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-black/[.04] text-muted">
                {item.itemType === "story" ? "📖" : "🖼"}
              </div>
            )}
          </div>
          <span className="truncate text-[10px] text-muted">{item.label}</span>
        </Link>
        {onToggleSelect && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelect();
            }}
            title={selected ? "Deselect" : "Select"}
            // pointer-coarse: touch has no hover state to reveal this with,
            // so it's always shown there -- desktop keeps the hover-only
            // reveal, same as Grid's MediaThumb.
            className={`absolute left-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full transition-opacity duration-150 group-hover:opacity-100 pointer-coarse:opacity-100 ${
              selected ? "opacity-100" : "opacity-0"
            }`}
          >
            {selected ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" className="fill-accent" stroke="white" strokeWidth="1" />
                <path d="M4.8 8.2 6.8 10.1 11.2 5.7" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" className="fill-black/30" stroke="white" strokeWidth="1.2" />
              </svg>
            )}
          </button>
        )}
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
        draggable={false}
        className="flex items-center gap-2 rounded-full border border-foreground bg-background px-2.5 py-1 text-[11px] transition-colors duration-150 hover:bg-black/[.03]"
      >
        <span className="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-black/10">
          {item.thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
          )}
        </span>
        <span className="truncate">{item.label}</span>
      </Link>
    </div>
  );
}
