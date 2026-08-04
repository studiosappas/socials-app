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
import { Dialog } from "@/components/ui/dialog";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";

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

type MenuMode = "main" | "note";
type MenuState = { date: string; mode: MenuMode } | null;
type LibraryDialogState = { date: string; itemType: CalendarItemType } | null;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const UNSCHEDULED_PAGE_SIZE = 6; // 3 rows x 2 columns before "+ Load more"

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
  const [libraryDialog, setLibraryDialog] = useState<LibraryDialogState>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
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

  const libraryCell = libraryDialog ? effectiveCells.find((c) => c.date === libraryDialog.date) : undefined;
  const libraryItems = libraryDialog
    ? effectiveUnscheduled.filter((item) => item.itemType === libraryDialog.itemType)
    : [];

  function handleAssignFromLibrary(item: CalendarItem) {
    if (!libraryDialog) return;
    const date = libraryDialog.date;
    startTransition(async () => {
      await scheduleItem(projectId, item.itemType, item.itemId, date);
      setLibraryDialog(null);
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
        <div className="flex flex-col gap-10 lg:flex-row">
          <div className="flex-1">
            <div className="relative mb-6 flex items-center gap-8">
              <Link
                href={`?month=${prevMonthParam}`}
                className="shrink-0 text-xs font-semibold tracking-wide uppercase transition-colors duration-150 hover:text-muted"
              >
                ‹ Prev
              </Link>
              <div className="flex flex-1 items-center justify-center gap-10 text-border">
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
              <h2 className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-sm font-semibold tracking-wide uppercase">
                {monthLabel}
              </h2>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[980px]">
                <div className="grid grid-cols-7 text-center text-xs font-semibold tracking-wide uppercase">
                  {WEEKDAY_LABELS.map((d) => (
                    <div key={d} className="py-2">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-2">
                  {effectiveCells.map((cell) => (
                    <DayCell
                      key={cell.date}
                      projectId={projectId}
                      cell={cell}
                      canManage={canManage}
                      menu={menu}
                      onOpenMenu={(mode) => setMenu({ date: cell.date, mode })}
                      onCloseMenu={() => setMenu(null)}
                      onOpenLibrary={(itemType) => {
                        setMenu(null);
                        setLibraryDialog({ date: cell.date, itemType });
                      }}
                      expanded={expandedDate === cell.date}
                      onToggleExpand={() =>
                        setExpandedDate((current) => (current === cell.date ? null : cell.date))
                      }
                    />
                  ))}
                </div>
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

      <Dialog
        open={libraryDialog !== null}
        onClose={() => setLibraryDialog(null)}
        title={libraryDialog?.itemType === "story" ? "Add Story from Library" : "Add Post from Library"}
        radius="none"
      >
        <div className="grid grid-cols-4 gap-2">
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
  canManage,
  menu,
  onOpenMenu,
  onCloseMenu,
  onOpenLibrary,
  expanded,
  onToggleExpand,
}: {
  projectId: string;
  cell: CalendarCell;
  canManage: boolean;
  menu: MenuState;
  onOpenMenu: (mode: MenuMode) => void;
  onCloseMenu: () => void;
  onOpenLibrary: (itemType: CalendarItemType) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { isOver, setNodeRef } = useDroppable({
    id: `day-${cell.date}`,
    data: { date: cell.date },
  });
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [noteError, setNoteError] = useState<string | undefined>();
  const isMenuOpen = menu?.date === cell.date;
  const hasContent = cell.items.length > 0 || Boolean(cell.note);

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

  function handleSaveNote() {
    setNoteError(undefined);
    const body = noteRef.current?.value ?? "";
    startTransition(async () => {
      const result = await upsertCalendarNote(projectId, cell.date, body);
      if (result.success) {
        onCloseMenu();
        router.refresh();
      } else {
        setNoteError(result.message ?? "Couldn't save note.");
      }
    });
  }

  const VISIBLE_ITEMS = 2;
  const visibleItems = cell.items.slice(0, VISIBLE_ITEMS);
  const hiddenCount = cell.items.length - visibleItems.length;

  return (
    <div
      ref={setNodeRef}
      className={`relative flex flex-col border p-2 text-xs transition-[min-height,background-color,border-color] duration-200 ${
        expanded ? "min-h-[420px]" : "min-h-36"
      } ${
        hasContent
          ? cell.isCurrentMonth
            ? "border-border"
            : "border-black/5 text-muted"
          : cell.isCurrentMonth
            ? "border-dashed border-border"
            : "border-dashed border-black/5 text-muted"
      } ${cell.isToday ? "outline outline-2 outline-offset-[-2px] outline-foreground" : ""} ${
        isOver ? "bg-black/[.04]" : ""
      }`}
      onClick={() => {
        // Deliberately not stopping propagation here: bubbling up to the
        // board's own onClick is what closes any other day's open menu when
        // you click elsewhere in the calendar.
        onToggleExpand();
      }}
      onContextMenu={(e) => {
        if (!canManage) return;
        e.preventDefault();
        e.stopPropagation();
        onOpenMenu("main");
      }}
    >
      {canManage && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu("main");
          }}
          title="Day options"
          className="absolute right-1 top-1 z-10 rounded px-1 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
        >
          ⋮
        </button>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
        <div className="flex shrink-0 items-center justify-between pr-4">
          <span className="text-xs font-semibold">{cell.dayNumber}</span>
          {cell.note && !isMenuOpen && (
            <span className="truncate text-[10px] italic text-muted" title={cell.note}>
              📝
            </span>
          )}
        </div>

        {expanded ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {cell.items.map((item) => (
              <Link
                key={`${item.itemType}-${item.itemId}`}
                href={item.href}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-3 border border-border p-2 transition-colors duration-150 hover:border-foreground/30"
              >
                <div className="h-20 w-20 shrink-0 overflow-hidden border border-border">
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
            ))}
            {cell.items.length === 0 && (
              <p className="text-[11px] text-muted">Nothing scheduled.</p>
            )}
          </div>
        ) : (
          <>
            {visibleItems.length > 0 && (
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
                {visibleItems.map((item) => (
                  <ItemChip key={`${item.itemType}-${item.itemId}`} item={item} size="pill" />
                ))}
              </div>
            )}
            {hiddenCount > 0 && (
              <span className="shrink-0 truncate text-[10px] text-muted">+{hiddenCount} more</span>
            )}
          </>
        )}
      </div>

      {isMenuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-1 top-6 z-20 w-44 rounded-none border border-border bg-background p-2 shadow-lg"
        >
          {menu.mode === "main" && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => onOpenLibrary("post")}
                className="rounded px-2 py-1 text-left transition-colors duration-150 hover:bg-black/[.05]"
              >
                Add Post from Library
              </button>
              <button
                type="button"
                onClick={() => onOpenLibrary("story")}
                className="rounded px-2 py-1 text-left transition-colors duration-150 hover:bg-black/[.05]"
              >
                Add Story from Library
              </button>
              <button
                type="button"
                onClick={handleCreatePost}
                className="rounded px-2 py-1 text-left transition-colors duration-150 hover:bg-black/[.05]"
              >
                + New post
              </button>
              <button
                type="button"
                onClick={handleCreateStory}
                className="rounded px-2 py-1 text-left transition-colors duration-150 hover:bg-black/[.05]"
              >
                + New story
              </button>
              <button
                type="button"
                onClick={() => onOpenMenu("note")}
                className="rounded px-2 py-1 text-left transition-colors duration-150 hover:bg-black/[.05]"
              >
                {cell.note ? "Edit Manual Notes" : "Add Manual Notes"}
              </button>
              <button
                type="button"
                onClick={onCloseMenu}
                className="rounded px-2 py-1 text-left text-muted transition-colors duration-150 hover:bg-black/[.05]"
              >
                Cancel
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
                className="rounded-none border border-foreground px-1 py-0.5 text-xs focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveNote}
                className="rounded-none bg-foreground px-2 py-1 text-background transition-colors duration-150 hover:bg-black/85"
              >
                Save
              </button>
              {noteError && <p className="text-[10px] text-error">{noteError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
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
