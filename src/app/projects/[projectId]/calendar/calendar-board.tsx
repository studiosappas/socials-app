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
  upsertCalendarNote,
  type CalendarItemType,
} from "@/lib/actions/calendar";
import { DROP_ANIMATION } from "@/lib/dnd-motion";
import { convertToTask } from "@/lib/actions/todo";
import { Dialog } from "@/components/ui/dialog";

export type CalendarItem = {
  itemType: CalendarItemType;
  itemId: string;
  label: string;
  thumbnailUrl: string | null;
  assetUrls: string[];
  href: string;
};

export type CalendarCell = {
  date: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  items: CalendarItem[];
  note: string | null;
};

type MenuMode = "main" | "assign-post" | "assign-story" | "note";
type MenuState = { date: string; mode: MenuMode } | null;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  const [menu, setMenu] = useState<MenuState>(null);
  const [activeItem, setActiveItem] = useState<CalendarItem | null>(null);
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

  function handleDragEnd(event: DragEndEvent) {
    setActiveItem(null);
    const data = event.active.data.current as
      | { itemType: CalendarItemType; itemId: string; item: CalendarItem }
      | undefined;
    const overData = event.over?.data.current as { date: string | null } | undefined;
    if (!data || !overData) return;

    const itemKey = (i: CalendarItem) => `${i.itemType}-${i.itemId}`;
    const movingItem = data.item;

    const nextCells = effectiveCells.map((cell) => ({
      ...cell,
      items: cell.items.filter((i) => itemKey(i) !== itemKey(movingItem)),
    }));
    let nextUnscheduled = effectiveUnscheduled.filter((i) => itemKey(i) !== itemKey(movingItem));

    if (overData.date) {
      const idx = nextCells.findIndex((c) => c.date === overData.date);
      if (idx !== -1) {
        nextCells[idx] = { ...nextCells[idx], items: [...nextCells[idx].items, movingItem] };
      }
    } else {
      nextUnscheduled = [...nextUnscheduled, movingItem];
    }

    setOverrideCells(nextCells);
    setOverrideUnscheduled(nextUnscheduled);

    startTransition(async () => {
      await scheduleItem(projectId, data.itemType, data.itemId, overData.date);
      router.refresh();
    });
  }

  return (
    <div onClick={() => setMenu(null)}>
      <DndContext
        id={`calendar-dnd-${projectId}`}
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveItem(null)}
      >
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex-1">
            <div className="mb-3 flex items-center justify-between">
              <Link
                href={`?month=${prevMonthParam}`}
                className="text-sm text-muted hover:underline"
              >
                ‹ Prev
              </Link>
              <h2 className="text-sm font-semibold">{monthLabel}</h2>
              <Link
                href={`?month=${nextMonthParam}`}
                className="text-sm text-muted hover:underline"
              >
                Next ›
              </Link>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[980px]">
                <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
                  {WEEKDAY_LABELS.map((d) => (
                    <div key={d}>{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {effectiveCells.map((cell) => (
                    <DayCell
                      key={cell.date}
                      projectId={projectId}
                      cell={cell}
                      canManage={canManage}
                      unscheduled={effectiveUnscheduled}
                      menu={menu}
                      onOpenMenu={(mode) => setMenu({ date: cell.date, mode })}
                      onCloseMenu={() => setMenu(null)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {canManage && (
            <div className="w-full lg:w-56 lg:shrink-0">
              <UnscheduledPanel items={effectiveUnscheduled} />
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={DROP_ANIMATION}>
          {activeItem && (
            <div className="w-40 cursor-grabbing rounded border border-foreground/20 bg-background px-1 py-0.5 text-[10px] shadow-[0_2px_10px_rgba(0,0,0,0.1)]">
              <ItemChipContent item={activeItem} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function DayCell({
  projectId,
  cell,
  canManage,
  unscheduled,
  menu,
  onOpenMenu,
  onCloseMenu,
}: {
  projectId: string;
  cell: CalendarCell;
  canManage: boolean;
  unscheduled: CalendarItem[];
  menu: MenuState;
  onOpenMenu: (mode: MenuMode) => void;
  onCloseMenu: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { isOver, setNodeRef } = useDroppable({
    id: `day-${cell.date}`,
    data: { date: cell.date },
  });
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const isMenuOpen = menu?.date === cell.date;
  const [expandOpen, setExpandOpen] = useState(false);

  function handleCreatePost() {
    startTransition(async () => {
      const id = await createPostForDate(projectId, cell.date);
      onCloseMenu();
      router.push(`/projects/${projectId}/posts/${id}`);
    });
  }

  function handleCreateStory() {
    startTransition(async () => {
      const id = await createStoryForDate(projectId, cell.date);
      onCloseMenu();
      router.push(`/projects/${projectId}/stories/${id}`);
    });
  }

  function handleAssign(item: CalendarItem) {
    startTransition(async () => {
      await scheduleItem(projectId, item.itemType, item.itemId, cell.date);
      onCloseMenu();
      router.refresh();
    });
  }

  function handleSaveNote() {
    const body = noteRef.current?.value ?? "";
    startTransition(async () => {
      await upsertCalendarNote(projectId, cell.date, body);
      onCloseMenu();
      router.refresh();
    });
  }

  const VISIBLE_ITEMS = 2;
  const visibleItems = cell.items.slice(0, VISIBLE_ITEMS);
  const hiddenCount = cell.items.length - visibleItems.length;

  return (
    <div
      ref={setNodeRef}
      className={`relative flex aspect-square min-h-32 flex-col rounded-md border p-1.5 text-xs transition-colors duration-150 ${
        cell.isCurrentMonth
          ? "border-border"
          : "border-black/5 text-muted"
      } ${cell.isToday ? "outline outline-2 outline-offset-[-2px] outline-foreground" : ""} ${
        isOver ? "bg-black/[.04]" : ""
      }`}
      onClick={(e) => {
        if (!canManage) return;
        e.stopPropagation();
        onOpenMenu("main");
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
        <div className="flex shrink-0 items-center justify-between">
          <span>{cell.dayNumber}</span>
          {cell.note && !isMenuOpen && (
            <span className="truncate text-[10px] italic text-muted" title={cell.note}>
              📝
            </span>
          )}
        </div>
        {visibleItems.length > 0 && (
          <div className="flex min-h-0 flex-1 gap-1">
            {visibleItems.map((item) => (
              <ItemChip key={`${item.itemType}-${item.itemId}`} item={item} size="lg" />
            ))}
          </div>
        )}
        {cell.items.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpandOpen(true);
            }}
            className="shrink-0 truncate text-left text-[10px] text-muted hover:text-foreground"
          >
            {hiddenCount > 0 ? `+${hiddenCount} more · View all` : "View all"}
          </button>
        )}
      </div>

      {isMenuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-20 mt-1 w-48 rounded-md border border-border bg-background p-2 shadow-lg"
        >
          {menu.mode === "main" && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => onOpenMenu("assign-post")}
                className="rounded px-2 py-1 text-left hover:bg-black/[.05]"
              >
                Add Post from Library
              </button>
              <button
                type="button"
                onClick={() => onOpenMenu("assign-story")}
                className="rounded px-2 py-1 text-left hover:bg-black/[.05]"
              >
                Add Story from Library
              </button>
              <button
                type="button"
                onClick={handleCreatePost}
                className="rounded px-2 py-1 text-left hover:bg-black/[.05]"
              >
                + New post
              </button>
              <button
                type="button"
                onClick={handleCreateStory}
                className="rounded px-2 py-1 text-left hover:bg-black/[.05]"
              >
                + New story
              </button>
              <button
                type="button"
                onClick={() => onOpenMenu("note")}
                className="rounded px-2 py-1 text-left hover:bg-black/[.05]"
              >
                {cell.note ? "Edit Manual Notes" : "Add Manual Notes"}
              </button>
              <button
                type="button"
                onClick={onCloseMenu}
                className="rounded px-2 py-1 text-left text-muted hover:bg-black/[.05]"
              >
                Cancel
              </button>
            </div>
          )}

          {(menu.mode === "assign-post" || menu.mode === "assign-story") && (
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {unscheduled
                .filter((item) =>
                  menu.mode === "assign-post" ? item.itemType === "post" : item.itemType === "story",
                )
                .map((item) => (
                  <button
                    key={`${item.itemType}-${item.itemId}`}
                    type="button"
                    onClick={() => handleAssign(item)}
                    className="truncate rounded px-2 py-1 text-left hover:bg-black/[.05]"
                  >
                    {item.itemType === "story" ? "📖 " : "🖼 "}
                    {item.label}
                  </button>
                ))}
              {unscheduled.filter((item) =>
                menu.mode === "assign-post" ? item.itemType === "post" : item.itemType === "story",
              ).length === 0 && (
                <p className="px-2 py-1 text-muted">
                  {menu.mode === "assign-post" ? "No unscheduled posts." : "No unscheduled stories."}
                </p>
              )}
              <button
                type="button"
                onClick={() => onOpenMenu("main")}
                className="rounded px-2 py-1 text-left text-muted"
              >
                ← Back
              </button>
            </div>
          )}

          {menu.mode === "note" && (
            <div className="flex flex-col gap-1">
              <textarea
                ref={noteRef}
                defaultValue={cell.note ?? ""}
                rows={3}
                placeholder="Note for this day..."
                className="rounded border border-border px-1 py-0.5 text-xs"
              />
              <button
                type="button"
                onClick={handleSaveNote}
                className="rounded bg-foreground px-2 py-1 text-background"
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}

      <Dialog
        open={expandOpen}
        onClose={() => setExpandOpen(false)}
        title={cell.isCurrentMonth ? `Day ${cell.dayNumber}` : cell.date}
      >
        <div className="flex flex-col gap-2">
          {cell.items.map((item) => (
            <div
              key={`${item.itemType}-${item.itemId}`}
              className="flex items-center gap-3 rounded-md border border-border p-2 transition-colors duration-150 hover:border-foreground/30"
            >
              <Link
                href={item.href}
                onClick={() => setExpandOpen(false)}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <div className="h-16 w-14 shrink-0 overflow-hidden rounded-sm border border-border">
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-black/[.04] text-muted">
                      {item.itemType === "story" ? "📖" : "🖼"}
                    </div>
                  )}
                </div>
                <span className="truncate text-sm">
                  {item.itemType === "story" ? "📖 " : "🖼 "}
                  {item.label}
                </span>
              </Link>
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    await convertToTask(projectId, item.itemType, item.itemId, item.label, cell.date);
                    router.refresh();
                  })
                }
                className="shrink-0 text-xs tracking-wide text-muted uppercase hover:text-foreground"
              >
                + To-Do
              </button>
            </div>
          ))}
          {cell.items.length === 0 && (
            <p className="text-sm text-muted">Nothing scheduled.</p>
          )}
        </div>
      </Dialog>
    </div>
  );
}

function UnscheduledPanel({ items }: { items: CalendarItem[] }) {
  const { isOver, setNodeRef } = useDroppable({
    id: "unscheduled-panel",
    data: { date: null },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-2 rounded-md border p-2 transition-colors duration-150 ${
        isOver ? "bg-black/[.04]" : "border-transparent"
      }`}
    >
      <h2 className="text-sm font-semibold">Unscheduled</h2>
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <ItemChip key={`${item.itemType}-${item.itemId}`} item={item} />
        ))}
        {items.length === 0 && (
          <p className="text-xs text-muted">Nothing unscheduled.</p>
        )}
      </div>
    </div>
  );
}

function ItemChipContent({ item }: { item: CalendarItem }) {
  return (
    <span className="flex items-center gap-1">
      {item.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.thumbnailUrl} alt="" className="h-6 w-5 shrink-0 rounded-sm object-cover" />
      ) : (
        <span className="h-6 w-5 shrink-0 rounded-sm bg-black/10" />
      )}
      <span className="truncate">
        {item.itemType === "story" ? "📖 " : "🖼 "}
        {item.label}
      </span>
    </span>
  );
}

function ItemChip({ item, size = "sm" }: { item: CalendarItem; size?: "sm" | "lg" }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `item-${item.itemType}-${item.itemId}`,
    data: { itemType: item.itemType, itemId: item.itemId, item },
  });

  if (size === "lg") {
    return (
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={(e) => e.stopPropagation()}
        className={`relative min-w-0 flex-1 touch-none transition-opacity duration-150 ${isDragging ? "opacity-30" : ""}`}
      >
        <Link href={item.href} className="flex h-full flex-col gap-0.5">
          <div className="min-h-0 flex-1 overflow-hidden rounded-sm border border-border transition-colors duration-150 hover:border-foreground/30">
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-black/[.04] text-muted">
                {item.itemType === "story" ? "📖" : "🖼"}
              </div>
            )}
          </div>
          <span className="shrink-0 truncate text-[10px] text-muted">{item.label}</span>
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
      className={`flex items-center gap-1 touch-none transition-opacity duration-150 ${isDragging ? "opacity-30" : ""}`}
    >
      <Link
        href={item.href}
        className="flex flex-1 items-center gap-1 rounded border border-border bg-background px-1 py-0.5 text-[10px] hover:bg-black/[.03]"
      >
        <ItemChipContent item={item} />
      </Link>
    </div>
  );
}
