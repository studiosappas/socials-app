"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  createPostForDate,
  createStoryForDate,
  scheduleItem,
  upsertCalendarNote,
  type CalendarItemType,
} from "@/lib/actions/calendar";

export type CalendarItem = {
  itemType: CalendarItemType;
  itemId: string;
  label: string;
  thumbnailUrl: string | null;
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

type MenuMode = "main" | "assign" | "note";
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const data = event.active.data.current as
      | { itemType: CalendarItemType; itemId: string }
      | undefined;
    const overData = event.over?.data.current as { date: string | null } | undefined;
    if (!data || !overData) return;

    startTransition(async () => {
      await scheduleItem(projectId, data.itemType, data.itemId, overData.date);
      router.refresh();
    });
  }

  return (
    <div onClick={() => setMenu(null)}>
      <DndContext id={`calendar-dnd-${projectId}`} sensors={sensors} onDragEnd={handleDragEnd}>
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

            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
              {WEEKDAY_LABELS.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((cell) => (
                <DayCell
                  key={cell.date}
                  projectId={projectId}
                  cell={cell}
                  canManage={canManage}
                  unscheduled={unscheduled}
                  menu={menu}
                  onOpenMenu={(mode) => setMenu({ date: cell.date, mode })}
                  onCloseMenu={() => setMenu(null)}
                />
              ))}
            </div>
          </div>

          {canManage && (
            <div className="w-full lg:w-56 lg:shrink-0">
              <UnscheduledPanel items={unscheduled} />
            </div>
          )}
        </div>
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

  return (
    <div
      ref={setNodeRef}
      className={`relative flex min-h-24 flex-col gap-1 rounded-md border p-1 text-xs ${
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
      <span>{cell.dayNumber}</span>
      <div className="flex flex-col gap-1">
        {cell.items.map((item) => (
          <ItemChip key={`${item.itemType}-${item.itemId}`} item={item} />
        ))}
      </div>
      {cell.note && !isMenuOpen && (
        <p className="truncate text-[10px] italic text-muted">
          📝 {cell.note}
        </p>
      )}

      {isMenuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-20 mt-1 w-48 rounded-md border border-border bg-background p-2 shadow-lg"
        >
          {menu.mode === "main" && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => onOpenMenu("assign")}
                className="rounded px-2 py-1 text-left hover:bg-black/[.05]"
              >
                Assign unscheduled…
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
                {cell.note ? "Edit note" : "Add a note"}
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

          {menu.mode === "assign" && (
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {unscheduled.map((item) => (
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
              {unscheduled.length === 0 && (
                <p className="px-2 py-1 text-muted">
                  Nothing unscheduled.
                </p>
              )}
              <button
                type="button"
                onClick={() => onOpenMenu("main")}
                className="rounded px-2 py-1 text-left text-muted"
              >
                â† Back
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
      className={`flex flex-col gap-2 rounded-md border p-2 ${
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

function ItemChip({ item }: { item: CalendarItem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `item-${item.itemType}-${item.itemId}`,
    data: { itemType: item.itemType, itemId: item.itemId },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 10,
        position: "relative" as const,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={style}
      onClick={(e) => e.stopPropagation()}
      className={`touch-none ${isDragging ? "opacity-50" : ""}`}
    >
      <Link
        href={item.href}
        className="flex items-center gap-1 rounded border border-border bg-background px-1 py-0.5 text-[10px] hover:bg-black/[.03]"
      >
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
      </Link>
    </div>
  );
}
