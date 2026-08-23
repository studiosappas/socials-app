"use client";

import { memo, useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  useDroppable,
  useDndContext,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { useOptimisticOverride } from "@/lib/hooks/use-optimistic-override";
import { useIsTouchDevice } from "@/lib/hooks/use-is-touch-device";
import { downloadAsset, filenameFromUrl } from "@/lib/download-zip";
import {
  addBriefTaskFrame,
  addBriefTaskImage,
  addBriefTaskLink,
  createBriefTask,
  deleteBriefTask,
  generateBriefDesign,
  removeBriefTaskFrame,
  removeBriefTaskItem,
  renameBriefTask,
  renameBriefTaskFrame,
  renameBriefTaskItem,
  reorderBriefTaskItems,
  restoreBriefTaskFrame,
  restoreBriefTaskItem,
  saveBriefAnnotation,
  setBriefTaskStatus,
  setBriefTaskTypes,
  updateBriefTaskFrameBody,
  updateBriefTaskItemNotes,
} from "@/lib/actions/brief";
import { saveMediaAssetAnnotation } from "@/lib/actions/media";
import { AnnotationEditor } from "@/components/annotation-editor";
import { BrandMoodboardDialog } from "@/components/brand-moodboard-dialog";
import { BrandWriterField } from "@/components/ai/brand-writer";
import { UndoIcon } from "../grid/grid-board";
import { useUndoStack, useUndoRedoShortcuts, type UndoableCommand } from "@/lib/hooks/use-undo-stack";
import { MINI_ORBIT_DOT_LAYOUT } from "@/lib/orbit-layout";
import { deriveCustomFontFaces, type BrandMoodboardItem } from "@/lib/data/brand-moodboard";
import { uploadFileDirect, newStoragePath } from "@/lib/direct-upload";
import { validateUploadSize } from "@/lib/upload-limits";
import type { BriefFrameSection, BriefItemKind, BriefItemSection, BriefTaskStatus, BriefTaskType } from "@/types/database";

export type BriefTaskItem = {
  id: string;
  section: BriefItemSection;
  kind: BriefItemKind;
  url: string | null;
  label: string;
  notes: string;
  attachmentId: string | null;
  thumbnailUrl: string | null;
  originalUrl: string | null;
  annotationJson: object | null;
};
export type BriefTaskFrame = {
  id: string;
  section: BriefFrameSection;
  label: string;
  body: string;
};
export type BriefTaskData = {
  id: string;
  name: string;
  contentTypes: BriefTaskType[];
  status: BriefTaskStatus;
  items: BriefTaskItem[];
  frames: BriefTaskFrame[];
};

const labelClass = "text-xs font-semibold tracking-wide uppercase";
const pillLabelClass =
  "shrink-0 rounded-full border border-border px-3 py-1.5 text-[11px] tracking-wide uppercase text-muted";
const pillInputClass =
  "w-full min-w-0 rounded-full border border-border bg-transparent px-3 py-1.5 text-sm focus:border-foreground focus:outline-none sm:flex-1";
const notesInputClass =
  "w-full min-w-0 shrink-0 rounded-full border border-border bg-transparent px-3 py-1.5 text-sm focus:border-foreground focus:outline-none sm:w-40";

type EditingImage =
  | { source: "attachment"; itemId: string; attachmentId: string; imageUrl: string; annotationJson: object | null }
  | { source: "asset"; mediaAssetId: string; imageUrl: string; annotationJson: object | null };

export function BriefBoard({
  projectId,
  tasks,
  canManage,
  brandMoodboard,
}: {
  projectId: string;
  tasks: BriefTaskData[];
  canManage: boolean;
  brandMoodboard: BrandMoodboardItem[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const [editingImage, setEditingImage] = useState<EditingImage | null>(null);
  const [moodboardOpen, setMoodboardOpen] = useState(false);
  // Keyed by attachmentId -- saveBriefAnnotation already returns a
  // ready-to-use preview URL, so an edited item's thumbnail updates
  // instantly instead of waiting on a route refresh to re-fetch it. Not
  // reset-on-prop-change (like Grid/Calendar's override state) since
  // there's no natural "fresh tasks prop" event to key off anymore -- this
  // action no longer revalidates its own route, so this map just is the
  // source of truth for these thumbnails going forward.
  const [previewOverrides, setPreviewOverrides] = useState<Record<string, string>>({});

  // Optimistic hide-on-delete for tasks/items/frames -- same "just an
  // exclusion set, no reset-on-prop-change needed" reasoning as
  // previewOverrides above: hiding an id that no longer exists in a fresh
  // `tasks` prop (because it was for-real deleted) is a harmless no-op, and
  // rollback on a failed delete just un-hides it again.
  const [hiddenTaskIds, setHiddenTaskIds] = useState<Set<string>>(new Set());
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(new Set());
  const [hiddenFrameIds, setHiddenFrameIds] = useState<Set<string>>(new Set());

  const hideTask = useCallback((id: string) => setHiddenTaskIds((prev) => new Set(prev).add(id)), []);
  const unhideTask = useCallback(
    (id: string) =>
      setHiddenTaskIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    [],
  );
  const hideItem = useCallback((id: string) => setHiddenItemIds((prev) => new Set(prev).add(id)), []);
  const unhideItem = useCallback(
    (id: string) =>
      setHiddenItemIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    [],
  );
  const hideFrame = useCallback((id: string) => setHiddenFrameIds((prev) => new Set(prev).add(id)), []);
  const unhideFrame = useCallback(
    (id: string) =>
      setHiddenFrameIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    [],
  );

  // Only builds a new task object for a task that actually needs one --
  // returning the original `task`/`tasks` references for everything else.
  // Otherwise every task in the board got a brand-new object on every
  // render the instant any override/hidden-id state had ANY entry, which
  // would have defeated TaskCard's React.memo below for the whole list, not
  // just the one task that changed.
  const effectiveTasks = useMemo(() => {
    const hasOverrides = Object.keys(previewOverrides).length > 0;
    const hasHidden = hiddenTaskIds.size > 0 || hiddenItemIds.size > 0 || hiddenFrameIds.size > 0;
    if (!hasOverrides && !hasHidden) return tasks;

    const visibleTasks = hiddenTaskIds.size > 0 ? tasks.filter((task) => !hiddenTaskIds.has(task.id)) : tasks;

    let changed = visibleTasks !== tasks;
    const next = visibleTasks.map((task) => {
      const itemsAffected =
        hiddenItemIds.size > 0 && task.items.some((item) => hiddenItemIds.has(item.id));
      const framesAffected =
        hiddenFrameIds.size > 0 && task.frames.some((frame) => hiddenFrameIds.has(frame.id));
      const previewAffected =
        hasOverrides && task.items.some((item) => item.attachmentId && previewOverrides[item.attachmentId]);
      if (!itemsAffected && !framesAffected && !previewAffected) return task;
      changed = true;
      return {
        ...task,
        items: task.items
          .filter((item) => !hiddenItemIds.has(item.id))
          .map((item) =>
            item.attachmentId && previewOverrides[item.attachmentId]
              ? { ...item, thumbnailUrl: previewOverrides[item.attachmentId] }
              : item,
          ),
        frames: task.frames.filter((frame) => !hiddenFrameIds.has(frame.id)),
      };
    });
    return changed ? next : tasks;
  }, [tasks, previewOverrides, hiddenTaskIds, hiddenItemIds, hiddenFrameIds]);

  // Board-level (not per-task) since undoing "Add Task" must survive that
  // task's own TaskCard being removed from the tree -- same reasoning as
  // Grid's own board-level stack (grid-board.tsx).
  const { push: pushCommand, undo, redo, canUndo, canRedo, isBusy: undoRedoBusy } = useUndoStack();
  useUndoRedoShortcuts(undo, redo);
  // No separate fetch -- derived from the same brandMoodboard already held
  // here, so uploading a font through the Moodboard dialog (same page,
  // router.refresh()) updates the editor's picker live.
  const customFonts = useMemo(() => deriveCustomFontFaces(brandMoodboard), [brandMoodboard]);

  function handleAddTask() {
    setCreating(true);
    setCreateError(undefined);
    const position = tasks.length;
    startTransition(async () => {
      const result = await createBriefTask(projectId, position);
      setCreating(false);
      if (!result.success) {
        setCreateError(result.message ?? "Couldn't create task.");
        return;
      }
      router.refresh();
      if (result.taskId) {
        // Mutable holder, not a captured constant -- each undo/redo cycle
        // after the first restores the task under a brand-new id (the
        // original row is gone for good once deleted), same pattern as
        // media-library.tsx's "Add media" tracking.
        const current = { id: result.taskId };
        pushCommand({
          label: "Add task",
          undo: async () => {
            await deleteBriefTask(projectId, current.id);
            router.refresh();
          },
          redo: async () => {
            const r = await createBriefTask(projectId, position);
            if (r.taskId) current.id = r.taskId;
            router.refresh();
          },
        });
      }
    });
  }

  function handleAnnotationSaved(previewUrl: string) {
    const target = editingImage;
    if (target?.source === "attachment") {
      setPreviewOverrides((current) => ({ ...current, [target.attachmentId]: previewUrl }));
      setEditingImage(null);
      return;
    }
    // "Generate Design" (source: "asset") edits a freshly-created media_asset
    // that isn't part of `tasks` yet -- same as handleGenerateDesign's own
    // reasoning above, nothing on THIS page ever displays this asset (it
    // only surfaces later on Grid, which saveMediaAssetAnnotation already
    // revalidates independently), so refreshing Brief's own route here
    // achieved nothing and was pure waste.
    setEditingImage(null);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setMoodboardOpen(true)}
          className="group flex w-full items-center justify-between gap-3 border border-border px-4 py-3 text-left transition-all duration-150 hover:border-foreground/50 hover:bg-black/[.03] hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)] sm:w-fit"
        >
          <div className="flex items-center gap-3">
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border">
              <div className="knowledge-orbit-dots-fast" aria-hidden="true">
                {MINI_ORBIT_DOT_LAYOUT.map((d, i) => (
                  <span key={i} className="knowledge-orbit-dot" style={{ top: d.top, left: d.left }} />
                ))}
              </div>
              <MoodboardIcon className="h-4 w-4" />
            </span>
            <div className="flex flex-col">
              <span className="text-xs font-semibold tracking-wide uppercase">Brand Moodboard</span>
              <span className="text-[11px] text-muted">Logos, colors, guidelines &amp; references</span>
            </div>
          </div>
          <ChevronIcon className="h-4 w-4 shrink-0 -rotate-90 text-muted transition-transform duration-150 group-hover:translate-x-0.5" />
        </button>

        {canManage && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => undo()}
              disabled={!canUndo || undoRedoBusy}
              title="Undo (⌘Z)"
              className="rounded-full p-2 text-muted transition-all duration-150 hover:bg-black/[.08] hover:text-foreground active:scale-90 disabled:pointer-events-none disabled:opacity-30"
            >
              <UndoIcon />
            </button>
            <button
              type="button"
              onClick={() => redo()}
              disabled={!canRedo || undoRedoBusy}
              title="Redo (⌘⇧Z)"
              className="rounded-full p-2 text-muted transition-all duration-150 hover:bg-black/[.08] hover:text-foreground active:scale-90 disabled:pointer-events-none disabled:opacity-30"
            >
              <UndoIcon redo />
            </button>
          </div>
        )}
      </div>

      {effectiveTasks.map((task) => (
        <TaskCard
          key={task.id}
          projectId={projectId}
          task={task}
          canManage={canManage}
          onEditImage={setEditingImage}
          pushCommand={pushCommand}
          onHideTask={hideTask}
          onUnhideTask={unhideTask}
          onHideItem={hideItem}
          onUnhideItem={unhideItem}
          onHideFrame={hideFrame}
          onUnhideFrame={unhideFrame}
        />
      ))}

      {tasks.length === 0 && (
        <p className="text-sm text-muted">No tasks yet. Add one to start building the brief.</p>
      )}

      {canManage && (
        <button
          type="button"
          onClick={handleAddTask}
          disabled={creating}
          className="flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide uppercase transition-all duration-150 hover:bg-black/[.06] active:scale-95 disabled:opacity-50"
        >
          {creating ? "Adding..." : "+ Add Task"}
        </button>
      )}
      {createError && <p className="text-xs text-error">{createError}</p>}

      <AnnotationEditor
        projectId={projectId}
        attachmentId={
          editingImage ? (editingImage.source === "attachment" ? editingImage.attachmentId : editingImage.mediaAssetId) : null
        }
        open={editingImage !== null}
        imageUrl={editingImage?.imageUrl ?? null}
        initialAnnotationJson={editingImage?.annotationJson ?? null}
        onClose={() => setEditingImage(null)}
        onSaved={handleAnnotationSaved}
        saveAction={editingImage?.source === "asset" ? saveMediaAssetAnnotation : saveBriefAnnotation}
        customFonts={customFonts}
      />

      <BrandMoodboardDialog
        projectId={projectId}
        items={brandMoodboard}
        canManage={canManage}
        open={moodboardOpen}
        onClose={() => setMoodboardOpen(false)}
      />
    </div>
  );
}

// One merged set of pills -- both the task's own "type" (persisted,
// content_types, now multi-select -- see handleToggleType) and Generate
// Design's "Post Type" (canvas size, see POST_TYPE_CANVAS in
// lib/actions/brief.ts, resolved from the selection via `primaryType`
// below) used to be two separate rows showing overlapping options; now one
// set of toggles drives both.
const POST_TYPE_OPTIONS: { value: BriefTaskType; label: string }[] = [
  { value: "post", label: "Post" },
  { value: "story", label: "Story" },
  { value: "reel_cover", label: "Reel Cover" },
  { value: "newsletter", label: "Newsletter" },
];

// Generic internal-review workflow -- see setBriefTaskStatus in
// lib/actions/brief.ts. Colors stay muted/informational (nothing alarming)
// until the task actually reaches Ready for Design.
const BRIEF_STATUS_OPTIONS: BriefTaskStatus[] = ["draft", "internal_review", "ready_for_design"];
const BRIEF_STATUS_LABEL: Record<BriefTaskStatus, string> = {
  draft: "Draft",
  internal_review: "Internal Review",
  ready_for_design: "Ready for Design",
};
const BRIEF_STATUS_DOT_COLOR: Record<BriefTaskStatus, string> = {
  draft: "bg-muted",
  internal_review: "bg-amber-500",
  ready_for_design: "bg-emerald-500",
};

// memo: one of these renders per Brief task, and without it every task
// card re-rendered whenever BriefBoard re-rendered for any reason -- see
// the perf investigation this was added for. task/onEditImage/pushCommand
// are all already stable references at the call site (see effectiveTasks
// above and the useUndoStack hook), so no further stabilization was needed
// here beyond fixing effectiveTasks' own referential-stability bug.
const TaskCard = memo(function TaskCard({
  projectId,
  task,
  canManage,
  onEditImage,
  pushCommand,
  onHideTask,
  onUnhideTask,
  onHideItem,
  onUnhideItem,
  onHideFrame,
  onUnhideFrame,
}: {
  projectId: string;
  task: BriefTaskData;
  canManage: boolean;
  onEditImage: (image: EditingImage) => void;
  pushCommand: (command: UndoableCommand) => void;
  onHideTask: (id: string) => void;
  onUnhideTask: (id: string) => void;
  onHideItem: (id: string) => void;
  onUnhideItem: (id: string) => void;
  onHideFrame: (id: string) => void;
  onUnhideFrame: (id: string) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  const nameRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | undefined>();
  const [typeError, setTypeError] = useState<string | undefined>();
  const [dndError, setDndError] = useState<string | undefined>();

  // Asset drag & drop -- reorder within References/Images/Products and move
  // between them. Frames/Text are a completely different data model (one
  // label+body field each, not a list) and are rendered OUTSIDE the
  // DndContext below entirely, so they can never become a drop target at
  // all, not just "the UI discourages it."
  //
  // Same optimistic-override shape as every other field on this card:
  // task.items is the server truth, this shadows it locally during a
  // drag/persist and resets the instant a fresh task.items prop arrives (a
  // revalidation, or -- on failure -- this component's own reset call).
  const {
    value: items,
    set: setItemsOverride,
    reset: resetItemsOverride,
  } = useOptimisticOverride<BriefTaskItem[]>(task.items);
  const isTouchDevice = useIsTouchDevice();
  const dndSensors = useSensors(
    useSensor(PointerSensor, {
      // Same reasoning as Grid's own sensor (see useIsTouchDevice): a
      // deliberate long-press on touch so a normal scroll attempt doesn't
      // misfire as a drag; a small movement threshold on desktop so a
      // plain click still reaches the thumbnail link, the rename input, or
      // the options menu without registering as a drag.
      activationConstraint: isTouchDevice ? { delay: 200, tolerance: 8 } : { distance: 4 },
    }),
  );
  const dragStartSectionRef = useRef<BriefItemSection | null>(null);
  // The full items list as it was the INSTANT the drag started -- handleDragEnd
  // reads "before" state from this, not from `items` directly, because by
  // the time it runs, handleDragOver has typically already applied its own
  // live section change to `items`. Snapshotting at drag-end would then
  // capture that already-mutated state as "before," which is wrong: it's
  // literally the mid-drag state, not the pre-drag one -- and undo would
  // restore to the wrong place (confirmed via a real test: without this,
  // undoing a cross-section move left the item behind in the NEW section
  // instead of putting it back in the original one).
  const dragStartItemsRef = useRef<BriefTaskItem[] | null>(null);

  function handleDragStart(event: DragStartEvent) {
    dragStartItemsRef.current = items;
    const item = items.find((i) => i.id === event.active.id);
    dragStartSectionRef.current = item?.section ?? null;
  }

  // Fires continuously while dragging over a target -- moves the dragged
  // item's SECTION optimistically the moment it crosses into a different
  // one, so it visually appears in the new section immediately instead of
  // only snapping over on drop. Within-section reordering during the drag
  // itself is handled by SortableContext/useSortable automatically; this
  // only ever changes which section an item currently belongs to.
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const activeItem = items.find((i) => i.id === activeId);
    if (!activeItem) return;

    const overSection = sectionOfDroppable(overId, items);
    if (!overSection || overSection === activeItem.section) return;

    setItemsOverride((current) => current.map((i) => (i.id === activeId ? { ...i, section: overSection } : i)));
  }

  function handleDragCancel() {
    dragStartSectionRef.current = null;
    // Undoes any live section change onDragOver already applied -- a
    // cancelled drag (Escape, dropped somewhere invalid) must leave the
    // item exactly where it started.
    resetItemsOverride();
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const fromSection = dragStartSectionRef.current;
    const preDragItems = dragStartItemsRef.current ?? items;
    dragStartSectionRef.current = null;
    dragStartItemsRef.current = null;
    if (!over || !fromSection) {
      resetItemsOverride();
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);
    const activeItem = items.find((i) => i.id === activeId);
    if (!activeItem) {
      resetItemsOverride();
      return;
    }

    const toSection = sectionOfDroppable(overId, items) ?? activeItem.section;

    // Snapshot the BEFORE order of every section this move touches, from
    // preDragItems (the state at drag START) -- NOT from `items`, which by
    // now may already reflect handleDragOver's own live section change.
    // Undo just replays these ids verbatim, no separate "insert back at
    // index N" logic needed.
    const beforeTargetIds = preDragItems.filter((i) => i.section === toSection).map((i) => i.id);
    const beforeSourceIds =
      fromSection !== toSection ? preDragItems.filter((i) => i.section === fromSection).map((i) => i.id) : null;

    const itemsInTarget = items.filter((i) => i.section === toSection);
    const oldIndex = itemsInTarget.findIndex((i) => i.id === activeId);
    const overItem = items.find((i) => i.id === overId);
    const newIndex =
      overItem && overItem.section === toSection ? itemsInTarget.findIndex((i) => i.id === overId) : itemsInTarget.length - 1;

    if (oldIndex === -1) {
      resetItemsOverride();
      return;
    }
    if (oldIndex === newIndex && fromSection === toSection) return; // dropped back where it started -- nothing to do

    const afterTargetIds = arrayMove(itemsInTarget, oldIndex, newIndex).map((i) => i.id);
    const afterSourceIds =
      fromSection !== toSection ? items.filter((i) => i.section === fromSection && i.id !== activeId).map((i) => i.id) : null;

    setDndError(undefined);
    setItemsOverride((current) => applyItemOrder(current, toSection, afterTargetIds, fromSection, afterSourceIds));

    startTransition(async () => {
      const calls = [reorderBriefTaskItems(projectId, toSection, afterTargetIds)];
      if (afterSourceIds) calls.push(reorderBriefTaskItems(projectId, fromSection, afterSourceIds));
      const results = await Promise.all(calls);
      const failed = results.find((r) => !r.success);
      if (failed) {
        resetItemsOverride();
        setDndError(failed.message ?? "Couldn't save that move. Please try again.");
        return;
      }
      pushCommand({
        label: fromSection === toSection ? "Reorder items" : "Move item",
        undo: async () => {
          const undoCalls = [reorderBriefTaskItems(projectId, toSection, beforeTargetIds)];
          if (beforeSourceIds) undoCalls.push(reorderBriefTaskItems(projectId, fromSection, beforeSourceIds));
          await Promise.all(undoCalls);
          router.refresh();
        },
        redo: async () => {
          const redoCalls = [reorderBriefTaskItems(projectId, toSection, afterTargetIds)];
          if (afterSourceIds) redoCalls.push(reorderBriefTaskItems(projectId, fromSection, afterSourceIds));
          await Promise.all(redoCalls);
          router.refresh();
        },
      });
    });
  }

  // Optimistic, with "adjust state during render" sync back to the server
  // value (same convention Grid's own Post Type pills use) -- previously
  // this read straight off task.contentTypes with no local state at all, so
  // a click didn't visibly do anything until the round-trip + router.refresh
  // landed. On a slow connection (or if the save silently failed, which
  // went unsurfaced before this) that read as "the button doesn't work."
  //
  // content_types has ALWAYS been a Postgres text[] / BriefTaskType[] end to
  // end (schema, setBriefTaskTypes, generateBriefDesign's prompt text) --
  // this component was the only place that narrowed it down to a single
  // value (task.contentTypes[0]). Toggling now operates on the full array;
  // no migration, no server-side change needed.
  const {
    value: selectedTypes,
    set: setOptimisticTypes,
    reset: resetOptimisticTypes,
  } = useOptimisticOverride<BriefTaskType[]>(task.contentTypes);

  // No router.refresh() on success -- optimisticTypes already shows the
  // correct final value, and setBriefTaskTypes no longer revalidates its
  // own route either, since there was nothing left for a refresh to
  // usefully bring back.
  //
  // The product has never allowed zero types (DB default is array['story'],
  // every write path -- old single-select included -- always produced
  // exactly one value): deselecting the last remaining pill is a no-op,
  // same as the old single-select's `if (type === selectedType) return`.
  function handleToggleType(type: BriefTaskType) {
    const isSelected = selectedTypes.includes(type);
    if (isSelected && selectedTypes.length === 1) return;
    const nextTypes = isSelected ? selectedTypes.filter((t) => t !== type) : [...selectedTypes, type];
    setTypeError(undefined);
    setOptimisticTypes(nextTypes);
    startTransition(async () => {
      const result = await setBriefTaskTypes(projectId, task.id, nextTypes);
      if (!result.success) {
        resetOptimisticTypes();
        setTypeError(result.message ?? "Couldn't change the type.");
      }
    });
  }

  // Same optimistic pair/rollback shape as the Post Type pills above.
  const [statusError, setStatusError] = useState<string | undefined>();
  const {
    value: currentStatus,
    set: setOptimisticStatus,
    reset: resetOptimisticStatus,
  } = useOptimisticOverride<BriefTaskStatus>(task.status);

  // No router.refresh() on success -- same reasoning as handleToggleType
  // above.
  function handleSetStatus(next: BriefTaskStatus) {
    if (next === currentStatus) return;
    setStatusError(undefined);
    setOptimisticStatus(next);
    startTransition(async () => {
      const result = await setBriefTaskStatus(projectId, task.id, task.name, next);
      if (!result.success) {
        resetOptimisticStatus();
        setStatusError(result.message ?? "Couldn't change the status.");
      }
    });
  }

  // No router.refresh() -- the generated design isn't part of `tasks`/
  // items at all, nothing on this page displays it, and onEditImage below
  // already opens the annotation editor with the real result data
  // (mediaAssetId/imageUrl/annotationJson) passed directly, not read back
  // from a page prop.
  // Generate Design renders ONE canvas, so multi-type selection still needs
  // exactly one GeneratedDesignPostType to pick a size (POST_TYPE_CANVAS in
  // lib/actions/brief.ts) -- there's no "generate N designs, one per type"
  // feature here, and per the no-modal/no-extra-UI brief for this pass, the
  // resolution is: whichever selected type comes first in POST_TYPE_OPTIONS'
  // fixed display order (Post > Story > Reel Cover > Newsletter) drives the
  // canvas. Deliberate and documented, not an incidental array[0] read --
  // the type isn't discarded, `generateBriefDesign` still receives and
  // reports the FULL content_types list in its prompt text.
  const primaryType = POST_TYPE_OPTIONS.find((opt) => selectedTypes.includes(opt.value))?.value ?? "post";

  function handleGenerateDesign() {
    setGenerateError(undefined);
    setGenerating(true);
    startTransition(async () => {
      const result = await generateBriefDesign(projectId, task.id, primaryType);
      setGenerating(false);
      if (!result.success || !result.mediaAssetId || !result.imageUrl) {
        setGenerateError(result.message ?? "Couldn't generate a design.");
        return;
      }
      onEditImage({
        source: "asset",
        mediaAssetId: result.mediaAssetId,
        imageUrl: result.imageUrl,
        annotationJson: result.annotationJson ?? null,
      });
    });
  }

  // No router.refresh() -- the task name field is an uncontrolled input
  // (defaultValue) that already shows the typed text once this blurs.
  function handleNameBlur() {
    const value = nameRef.current?.value.trim();
    if (!value || value === task.name) return;
    startTransition(async () => {
      await renameBriefTask(projectId, task.id, value);
    });
  }

  function handleDelete() {
    setMenuOpen(false);
    if (!confirm(`Delete "${task.name}"? This can't be undone.`)) return;
    onHideTask(task.id);
    startTransition(async () => {
      const result = await deleteBriefTask(projectId, task.id);
      if (!result.success) {
        console.error("Failed to delete task:", result.message);
        onUnhideTask(task.id);
        router.refresh();
      }
    });
  }

  function handleSave() {
    // Every field already saves itself on blur / on its own Add action --
    // this button's job is to commit whatever field is still mid-edit (blur
    // it) and give the user an explicit, visible confirmation that nothing
    // is left unsaved. No router.refresh() -- this isn't gated by any
    // mutation of its own, so there's nothing for a fresh page render to
    // bring back; it was forcing a full Brief refetch on every click purely
    // for the "Saved." toast below.
    const active = document.activeElement;
    if (active instanceof HTMLElement && containerRef.current?.contains(active)) {
      active.blur();
    }
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }, 150);
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div
        className="flex cursor-pointer items-center justify-between gap-3"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex min-w-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <input
            key={task.name}
            ref={nameRef}
            defaultValue={task.name}
            disabled={!canManage}
            onBlur={handleNameBlur}
            className={`${labelClass} min-w-0 cursor-text border-0 bg-transparent focus:outline-none disabled:opacity-100`}
          />
          {/* Clearly-but-subtly visible even while collapsed -- the whole
              point is a designer can scan the list without expanding every
              card or asking anyone whether a brief is ready. Doubles as the
              only control for changing status -- canManage users get a
              dropdown, everyone else just sees the badge. */}
          <StatusBadge status={currentStatus} canManage={canManage} onSetStatus={handleSetStatus} />
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {canManage && (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                title="Task options"
                className="rounded p-1.5 text-muted transition-all duration-150 hover:bg-black/[.08] hover:text-foreground active:scale-90"
              >
                ⋮
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-7 z-20 w-40 max-w-[calc(100vw-1.5rem)] rounded-none border border-border bg-background p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="w-full rounded px-2 py-1 text-left text-xs text-error transition-colors duration-150 hover:bg-error/10"
                  >
                    Delete Task
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Minimize" : "Expand"}
            className="rounded p-1.5 text-muted transition-all duration-150 hover:bg-black/[.08] hover:text-foreground active:scale-90"
          >
            <ChevronIcon className={`h-4 w-4 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {/* Outside the expand/collapse block on purpose -- a failed status
          change from the (always-visible) badge above needs to be visible
          even while the card is collapsed. */}
      {statusError && <p className="-mt-2 text-xs text-error">{statusError}</p>}

      {expanded && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {POST_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!canManage}
                  aria-pressed={selectedTypes.includes(opt.value)}
                  onClick={() => handleToggleType(opt.value)}
                  className={`rounded-full border px-4 py-1.5 text-xs tracking-wide uppercase transition-all duration-150 active:scale-95 ${
                    selectedTypes.includes(opt.value)
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-foreground hover:border-foreground/50 hover:bg-black/[.03]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {typeError && <p className="text-xs text-error">{typeError}</p>}
          </div>

          {dndError && <p className="-mt-2 text-xs text-error">{dndError}</p>}

          {canManage ? (
            <DndContext
              sensors={dndSensors}
              collisionDetection={briefCollisionDetection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <ItemSection
                title="References"
                projectId={projectId}
                taskId={task.id}
                section="references"
                items={items.filter((i) => i.section === "references")}
                canManage={canManage}
                onEditImage={onEditImage}
                pushCommand={pushCommand}
                onHideItem={onHideItem}
                onUnhideItem={onUnhideItem}
              />
              <ItemSection
                title="Images"
                projectId={projectId}
                taskId={task.id}
                section="images"
                items={items.filter((i) => i.section === "images")}
                canManage={canManage}
                onEditImage={onEditImage}
                pushCommand={pushCommand}
                onHideItem={onHideItem}
                onUnhideItem={onUnhideItem}
              />
              <ItemSection
                title="Products"
                projectId={projectId}
                taskId={task.id}
                section="products"
                items={items.filter((i) => i.section === "products")}
                canManage={canManage}
                onEditImage={onEditImage}
                pushCommand={pushCommand}
                onHideItem={onHideItem}
                onUnhideItem={onUnhideItem}
              />
            </DndContext>
          ) : (
            <>
              <ItemSection
                title="References"
                projectId={projectId}
                taskId={task.id}
                section="references"
                items={items.filter((i) => i.section === "references")}
                canManage={canManage}
                onEditImage={onEditImage}
                pushCommand={pushCommand}
                onHideItem={onHideItem}
                onUnhideItem={onUnhideItem}
              />
              <ItemSection
                title="Images"
                projectId={projectId}
                taskId={task.id}
                section="images"
                items={items.filter((i) => i.section === "images")}
                canManage={canManage}
                onEditImage={onEditImage}
                pushCommand={pushCommand}
                onHideItem={onHideItem}
                onUnhideItem={onUnhideItem}
              />
              <ItemSection
                title="Products"
                projectId={projectId}
                taskId={task.id}
                section="products"
                items={items.filter((i) => i.section === "products")}
                canManage={canManage}
                onEditImage={onEditImage}
                pushCommand={pushCommand}
                onHideItem={onHideItem}
                onUnhideItem={onUnhideItem}
              />
            </>
          )}

          <FrameSection
            title="Frames"
            projectId={projectId}
            taskId={task.id}
            section="frames"
            frames={task.frames.filter((f) => f.section === "frames")}
            canManage={canManage}
            pushCommand={pushCommand}
            onHideFrame={onHideFrame}
            onUnhideFrame={onUnhideFrame}
          />
          <FrameSection
            title="Text"
            projectId={projectId}
            taskId={task.id}
            section="text"
            frames={task.frames.filter((f) => f.section === "text")}
            canManage={canManage}
            pushCommand={pushCommand}
            onHideFrame={onHideFrame}
            onUnhideFrame={onUnhideFrame}
          />

          {canManage && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="primary" radius="full" onClick={handleSave} disabled={saving} className="w-40">
                  {saving ? "Saving..." : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  radius="full"
                  onClick={handleGenerateDesign}
                  disabled={generating}
                  className="flex items-center gap-1.5"
                >
                  <SparkleIcon className="h-3.5 w-3.5" />
                  {generating ? "Generating…" : "Generate Design"}
                </Button>
                {saved && <span className="text-xs text-success">Saved.</span>}
              </div>
              {generateError && <p className="text-xs text-error">{generateError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// The status badge doubles as its own control -- canManage users click it to
// open a small dropdown of the three states instead of separate "Send to
// Review"/"Mark Ready for Design" buttons living elsewhere on the card.
// View-only members (or the badge for anyone once there's nothing to do)
// just see the static badge.
function StatusBadge({
  status,
  canManage,
  onSetStatus,
}: {
  status: BriefTaskStatus;
  canManage: boolean;
  onSetStatus: (status: BriefTaskStatus) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

  const badge = (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[10px] tracking-wide text-muted uppercase">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${BRIEF_STATUS_DOT_COLOR[status]}`} />
      {BRIEF_STATUS_LABEL[status]}
    </span>
  );

  if (!canManage) {
    return <span title={`Status: ${BRIEF_STATUS_LABEL[status]}`}>{badge}</span>;
  }

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        title={`Status: ${BRIEF_STATUS_LABEL[status]} — click to change`}
        className="flex items-center gap-1 transition-opacity duration-150 hover:opacity-80"
      >
        {badge}
        <ChevronIcon className="h-2.5 w-2.5 text-muted" />
      </button>
      {menuOpen && (
        <div className="absolute left-0 top-7 z-20 w-40 rounded-none border border-border bg-background p-1 normal-case shadow-lg">
          {BRIEF_STATUS_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onSetStatus(opt);
              }}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${BRIEF_STATUS_DOT_COLOR[opt]}`} />
              <span className={opt === status ? "font-semibold" : ""}>{BRIEF_STATUS_LABEL[opt]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Resolves a dnd-kit `over.id` to the BriefItemSection it belongs to --
// `over` is either another item (dropped near/on it -- use ITS section) or
// a section's own droppable container id (dropped into its empty space,
// see ItemSection's `section-${section}` droppable below).
// closestCenter alone (dnd-kit's default) compares the dragged item's
// center to every OTHER droppable's center and picks whichever is
// nearest -- a good fit for same-sized sortable items, but a poor one for
// a large, mostly-empty container: a section that has no items yet is
// still registered as a droppable (see ItemSection's useDroppable below),
// but its center can end up geometrically closer to an ADJACENT section's
// items than to itself unless the pointer is moved very precisely, which
// is exactly why dragging into an empty section felt unreliable/impossible
// in practice even though it was technically wired up correctly. This is
// dnd-kit's own documented fix for multi-container sortable UIs: try
// pointerWithin first (did the pointer literally land inside a droppable's
// rect -- the intuitive, predictable behavior for "hovering a section"),
// fall back to rectIntersection (the dragged item's rect overlaps a
// droppable's rect at all), and only fall back to closestCenter if neither
// finds anything, so item-to-item reordering within a section keeps
// working exactly as it did before.
const briefCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  const intersections = rectIntersection(args);
  if (intersections.length > 0) return intersections;
  return closestCenter(args);
};

function sectionOfDroppable(overId: string, items: BriefTaskItem[]): BriefItemSection | null {
  const overItem = items.find((i) => i.id === overId);
  if (overItem) return overItem.section;
  const prefix = "section-";
  if (overId.startsWith(prefix)) {
    const candidate = overId.slice(prefix.length);
    if (candidate === "references" || candidate === "images" || candidate === "products") return candidate;
  }
  return null;
}

// Rebuilds the full items array reflecting a completed move: toSection's
// items in their new order (targetIds, which includes the moved item),
// and -- only for a cross-section move -- fromSection's remaining items in
// their new order too. Every OTHER section's items are left exactly where
// they were; the exact position of one section's items relative to
// another's within the combined array never matters, since each
// ItemSection derives its own list via `items.filter(i => i.section ===
// X)`, which only cares about relative order among same-section items.
function applyItemOrder(
  current: BriefTaskItem[],
  toSection: BriefItemSection,
  targetIds: string[],
  fromSection: BriefItemSection,
  sourceIds: string[] | null,
): BriefTaskItem[] {
  const byId = new Map(current.map((i) => [i.id, i]));
  const untouched = current.filter((i) => i.section !== toSection && (!sourceIds || i.section !== fromSection));
  const targetItems = targetIds.map((id) => {
    const base = byId.get(id);
    if (!base) return null;
    return base.section === toSection ? base : { ...base, section: toSection };
  });
  const sourceItems = sourceIds ? sourceIds.map((id) => byId.get(id) ?? null) : [];
  return [...untouched, ...sourceItems, ...targetItems].filter((i): i is BriefTaskItem => i !== null);
}

// Wraps one item's row (chip + notes field) as a single sortable/draggable
// unit -- notes travel with the item they belong to, which also keeps drag
// concerns entirely out of ImageItemChip/LinkItemChip themselves.
//
// Desktop: listeners stay on the whole outer wrapper (not a separate handle
// icon, per the original "no large drag handles unless necessary" brief) --
// a plain click on the thumbnail, the name, or the options menu still works
// normally, since PointerSensor only activates a drag after real pointer
// movement past its activationConstraint, not on a stationary click.
//
// Touch: listeners move to a small dedicated grip handle instead. Real
// mobile testing found the whole-wrapper approach doesn't actually work on
// touch -- the filename span's onPointerDown stopPropagation (see
// ImageItemChip, added so a text-selection drag never also starts a
// reorder) silently swallows the gesture for any touch starting on the
// label, which is the single widest tap target in the chip; the thumbnail
// and link chip's <a> have the same problem from the OTHER direction (a
// long-press on a real link natively triggers the OS's own link
// callout/context menu before dnd-kit's synthetic long-press timer can
// win). A dedicated handle has neither conflict, so it's the reliable
// choice on touch even though the whole chip stays the (already proven)
// drag surface on desktop. The wrapper itself drops touch-none when the
// handle is in play, so a normal swipe/scroll starting anywhere else on
// the row (thumbnail, name, whitespace) is untouched.
function SortableItemRow({ item, children }: { item: BriefTaskItem; children: React.ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: item.id });
  const isTouchDevice = useIsTouchDevice();
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  if (isTouchDevice) {
    return (
      <div ref={setNodeRef} style={style} className="flex items-center gap-1.5">
        <span
          {...attributes}
          {...listeners}
          role="button"
          aria-label="Drag to reorder or move"
          className="touch-none p-1.5 text-muted select-none active:scale-90 active:text-foreground"
          style={{ WebkitTouchCallout: "none" }}
        >
          <GripIcon className="h-4 w-3" />
        </span>
        {children}
      </div>
    );
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex touch-none items-center gap-1.5 [@media(pointer:fine)]:cursor-grab [@media(pointer:fine)]:active:cursor-grabbing"
    >
      {children}
    </div>
  );
}

function GripIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 16" fill="currentColor" className={className}>
      <circle cx="2.5" cy="2" r="1.3" />
      <circle cx="7.5" cy="2" r="1.3" />
      <circle cx="2.5" cy="8" r="1.3" />
      <circle cx="7.5" cy="8" r="1.3" />
      <circle cx="2.5" cy="14" r="1.3" />
      <circle cx="7.5" cy="14" r="1.3" />
    </svg>
  );
}

function ItemSection({
  title,
  projectId,
  taskId,
  section,
  items,
  canManage,
  onEditImage,
  pushCommand,
  onHideItem,
  onUnhideItem,
}: {
  title: string;
  projectId: string;
  taskId: string;
  section: BriefItemSection;
  items: BriefTaskItem[];
  canManage: boolean;
  onEditImage: (image: EditingImage) => void;
  pushCommand: (command: UndoableCommand) => void;
  onHideItem: (id: string) => void;
  onUnhideItem: (id: string) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [linkPending, setLinkPending] = useState(false);
  const [linkError, setLinkError] = useState<string | undefined>();
  const [imagePending, setImagePending] = useState(false);
  const [imageError, setImageError] = useState<string | undefined>();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const linkNotesRef = useRef<HTMLInputElement>(null);
  const imageNotesRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // One "Link" entry point: the server tries to convert the URL into a real
  // editable image first (direct image, or a webpage's primary image), and
  // only falls back to a plain external-link item when no image is found
  // anywhere -- see addBriefTaskLink. result.kind tells us which one it
  // actually created, so undo/redo can restore the right shape.
  function handleAddLink() {
    const url = urlRef.current?.value.trim() ?? "";
    if (!url) return;
    const notes = linkNotesRef.current?.value ?? "";
    const position = items.length;
    setLinkError(undefined);
    setLinkPending(true);
    startTransition(async () => {
      const result = await addBriefTaskLink(projectId, taskId, section, url, notes, position);
      setLinkPending(false);
      if (!result.success) {
        setLinkError(result.message ?? "Couldn't add that link.");
        return;
      }
      if (urlRef.current) urlRef.current.value = "";
      if (linkNotesRef.current) linkNotesRef.current.value = "";
      router.refresh();
      if (!result.itemId) return;

      const current = { id: result.itemId };
      if (result.kind === "image" && result.attachmentId) {
        const attachmentId = result.attachmentId;
        const label = result.label ?? url;
        pushCommand({
          label: "Add image from link",
          undo: async () => {
            await removeBriefTaskItem(projectId, current.id);
            router.refresh();
          },
          redo: async () => {
            // Re-links the same already-fetched attachment -- never
            // re-fetches the URL, same reasoning as handleAddImage's redo.
            const r = await restoreBriefTaskItem(
              projectId,
              taskId,
              section,
              "image",
              label,
              notes,
              attachmentId,
              null,
              position,
            );
            if (r.itemId) current.id = r.itemId;
            router.refresh();
          },
        });
      } else {
        pushCommand({
          label: "Add link",
          undo: async () => {
            await removeBriefTaskItem(projectId, current.id);
            router.refresh();
          },
          redo: async () => {
            const r = await restoreBriefTaskItem(projectId, taskId, section, "link", url, notes, null, url, position);
            if (r.itemId) current.id = r.itemId;
            router.refresh();
          },
        });
      }
    });
  }

  // fileOverride lets a paste event (handlePasteImage below) reuse this
  // exact same upload+insert+undo flow without going through the file
  // picker/pendingFile state at all -- paste is a "the image is already
  // right here, just add it" gesture, so it skips the extra manual Add
  // click the file-picker path still requires. Must stay a NO-ARG call at
  // its own "Add" button's onClick site below (not `onClick={handleAddImage}`
  // directly) or React would pass the click SyntheticEvent through as
  // fileOverride.
  function handleAddImage(fileOverride?: File) {
    const file = fileOverride ?? pendingFile;
    if (!file) {
      fileInputRef.current?.click();
      return;
    }
    const notes = imageNotesRef.current?.value ?? "";
    const position = items.length;
    const fileName = file.name;
    setImageError(undefined);
    setImagePending(true);
    startTransition(async () => {
      // The file itself goes direct browser-to-Storage (brief-media bucket,
      // same as this app's other uploads) before the action ever runs --
      // bypasses Vercel's Function request-body limit entirely.
      const path = newStoragePath(projectId, file.name);
      const uploaded = await uploadFileDirect("brief-media", path, file);
      if ("error" in uploaded) {
        setImagePending(false);
        setImageError(uploaded.error);
        return;
      }
      const formData = new FormData();
      formData.set("storagePath", uploaded.path);
      formData.set("fileName", fileName);
      const result = await addBriefTaskImage(projectId, taskId, section, notes, position, formData);
      setImagePending(false);
      if (!result.success) {
        setImageError(result.message ?? "Couldn't upload that image.");
        return;
      }
      setPendingFile(null);
      if (imageNotesRef.current) imageNotesRef.current.value = "";
      router.refresh();
      if (result.itemId && result.attachmentId) {
        const current = { id: result.itemId };
        const attachmentId = result.attachmentId;
        // The item's real (prettified) label, not the raw fileName --
        // otherwise redoing this command after an undo would restore the
        // item with a different label than what was actually shown/saved.
        const label = result.label ?? fileName;
        pushCommand({
          label: "Add image",
          undo: async () => {
            await removeBriefTaskItem(projectId, current.id);
            router.refresh();
          },
          redo: async () => {
            // No re-upload -- removeBriefTaskItem never deletes the
            // underlying brief_attachments row, only the item row pointing
            // at it, so it's always still there to re-link.
            const r = await restoreBriefTaskItem(
              projectId,
              taskId,
              section,
              "image",
              label,
              notes,
              attachmentId,
              null,
              position,
            );
            if (r.itemId) current.id = r.itemId;
            router.refresh();
          },
        });
      }
    });
  }

  // No paste-image handler existed anywhere in the app before this -- see
  // the naming-hierarchy comment in brief.ts for exactly what clipboard
  // data is/isn't reliable. Wired onto the Link/Notes text inputs below
  // (real, always-focusable elements a user naturally clicks into before
  // pasting) rather than a dedicated invisible paste target. If the
  // clipboard has an image, it's used; if not (the normal case -- pasting
  // actual text into these fields), this is a no-op and the browser's
  // default text-paste behavior proceeds untouched.
  function handlePasteImage(e: React.ClipboardEvent<HTMLInputElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        const sizeCheck = validateUploadSize(file);
        if (!sizeCheck.ok) {
          setImageError(sizeCheck.message);
          return;
        }
        setImageError(undefined);
        handleAddImage(file);
        return;
      }
    }
  }

  function handleRemove(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    onHideItem(itemId);
    startTransition(async () => {
      const result = await removeBriefTaskItem(projectId, itemId);
      if (!result.success) {
        console.error("Failed to remove item:", result.message);
        onUnhideItem(itemId);
        router.refresh();
        return;
      }
      if (item) {
        const current = { id: itemId };
        pushCommand({
          label: "Remove item",
          undo: async () => {
            const r = await restoreBriefTaskItem(
              projectId,
              taskId,
              section,
              item.kind,
              item.label,
              item.notes,
              item.attachmentId,
              item.url,
              items.length,
            );
            if (r.itemId) current.id = r.itemId;
            router.refresh();
          },
          redo: async () => {
            onHideItem(current.id);
            await removeBriefTaskItem(projectId, current.id);
            router.refresh();
          },
        });
      }
    });
  }

  // No router.refresh() -- an uncontrolled textarea already shows the
  // typed notes.
  function handleNotesBlur(itemId: string, value: string, original: string) {
    if (value.trim() === original) return;
    startTransition(async () => {
      await updateBriefTaskItemNotes(projectId, itemId, value);
    });
  }

  // Only ever touches this one brief_task_items row's label -- see
  // renameBriefTaskItem's own comment for why that can never affect
  // anything shown outside this Brief item.
  function handleRename(itemId: string, label: string) {
    return renameBriefTaskItem(projectId, itemId, label);
  }

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: `section-${section}` });
  const itemIds = useMemo(() => items.map((item) => item.id), [items]);
  // Only meaningful while canManage renders this inside TaskCard's
  // DndContext -- outside one (the view-only path), this reads the safe
  // no-op default context (active always null), so isDragActive is always
  // false there.
  const { active: activeDrag } = useDndContext();
  const isDragActive = activeDrag !== null;
  const isEmpty = items.length === 0;

  function renderItemRow(item: BriefTaskItem) {
    return (
      <>
        {item.kind === "image" ? (
          <ImageItemChip
            item={item}
            canManage={canManage}
            onEdit={() =>
              item.attachmentId &&
              item.originalUrl &&
              onEditImage({
                source: "attachment",
                itemId: item.id,
                attachmentId: item.attachmentId,
                imageUrl: item.originalUrl,
                annotationJson: item.annotationJson,
              })
            }
            onDelete={() => handleRemove(item.id)}
            onRename={(label) => handleRename(item.id, label)}
          />
        ) : (
          <LinkItemChip item={item} canManage={canManage} onDelete={() => handleRemove(item.id)} />
        )}
        {canManage ? (
          <input
            key={`${item.id}-notes`}
            defaultValue={item.notes}
            placeholder="Add a note"
            onBlur={(e) => handleNotesBlur(item.id, e.target.value, item.notes)}
            className="w-28 min-w-0 shrink-0 border-b border-transparent bg-transparent text-[10px] italic text-muted focus:border-foreground focus:text-foreground focus:outline-none"
          />
        ) : (
          item.notes && <span className="text-[10px] italic text-muted">{item.notes}</span>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className={labelClass}>{title}</span>

      {/* Always rendered (even with zero items) and always registered as a
          droppable -- an empty section still has to be a valid, reachable
          drop target, not just a visual gap that appears once something
          lands in it.

          Resting height stays a minimal min-h-8 (barely-there, matches the
          existing clean look) whether empty or not. The moment ANY drag
          starts (isDragActive) an EMPTY section specifically grows to
          min-h-20 with a thin dashed border -- the same border-dashed
          border-border treatment this codebase already uses for empty-state
          placeholders elsewhere (e.g. BrandPanel's missing-avatar circle),
          not a foreign "enterprise dropzone" pattern -- purely so there's
          an actually-generous, easy-to-hit target the instant a drag
          begins, not just a thin 32px band. isOver layers a stronger,
          solid highlight on top once the pointer is actually within it. */}
      <div
        ref={setDroppableRef}
        className={`flex flex-wrap items-center gap-3 rounded-lg transition-all duration-150 ${
          isEmpty && isDragActive ? "min-h-20 border border-dashed border-border" : "min-h-8"
        } ${isOver ? "border-solid border-foreground/40 bg-black/[.04] ring-1 ring-foreground/25" : ""}`}
      >
        <SortableContext items={itemIds} strategy={rectSortingStrategy}>
          {items.map((item) =>
            canManage ? (
              <SortableItemRow key={item.id} item={item}>
                {renderItemRow(item)}
              </SortableItemRow>
            ) : (
              <div key={item.id} className="flex items-center gap-1.5">
                {renderItemRow(item)}
              </div>
            ),
          )}
        </SortableContext>
      </div>

      {canManage && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <span className={pillLabelClass}>Link</span>
              <input
                ref={urlRef}
                placeholder="Converts to an image with image url"
                onKeyDown={(e) => e.key === "Enter" && handleAddLink()}
                onPaste={handlePasteImage}
                className={pillInputClass}
              />
              <input ref={linkNotesRef} placeholder="Notes" onPaste={handlePasteImage} className={notesInputClass} />
              <Button
                type="button"
                variant="primary"
                radius="full"
                onClick={handleAddLink}
                disabled={linkPending}
                className="w-full sm:w-auto"
              >
                {linkPending ? "Adding..." : "Add"}
              </Button>
            </div>
            {linkError && <p className="text-xs text-error">{linkError}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <span className={pillLabelClass}>Image</span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`${pillInputClass} truncate text-left ${pendingFile ? "" : "text-muted"}`}
              >
                {pendingFile?.name ?? "Upload file"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  if (file) {
                    const sizeCheck = validateUploadSize(file);
                    if (!sizeCheck.ok) {
                      setImageError(sizeCheck.message);
                      e.target.value = "";
                      return;
                    }
                  }
                  setImageError(undefined);
                  setPendingFile(file);
                }}
              />
              <input
                ref={imageNotesRef}
                placeholder="Notes"
                onPaste={handlePasteImage}
                className={notesInputClass}
              />
              <Button
                type="button"
                variant="primary"
                radius="full"
                onClick={() => handleAddImage()}
                disabled={imagePending}
                className="w-full sm:w-auto"
              >
                {imagePending ? "Adding..." : "Add"}
              </Button>
            </div>
            {imageError && <p className="text-xs text-error">{imageError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function LinkItemChip({
  item,
  canManage,
  onDelete,
}: {
  item: BriefTaskItem;
  canManage: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs">
      <a href={item.url ?? "#"} target="_blank" rel="noreferrer" className="max-w-[160px] truncate underline">
        {item.label}
      </a>
      {canManage && (
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 rounded-full px-1.5 text-muted transition-all duration-150 hover:bg-error/10 hover:text-error active:scale-90"
        >
          ×
        </button>
      )}
    </div>
  );
}

function ImageItemChip({
  item,
  canManage,
  onEdit,
  onDelete,
  onRename,
}: {
  item: BriefTaskItem;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRename: (label: string) => Promise<{ success: boolean; message?: string }>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(item.label);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  // No router.refresh() on rename (see renameBriefTaskItem's own comment),
  // so the chip has to show its own optimistic value rather than the
  // (now-stale) item.label prop -- same pattern as stories-board.tsx's
  // folder rename.
  const { value: label, set: setOptimisticLabel, reset: resetOptimisticLabel } = useOptimisticOverride(item.label);

  // Edited preview wins over the untouched original wherever this asset is
  // displayed/opened/downloaded, same convention as everywhere else this
  // app shows a Fabric-annotated image (Grid, post editor) -- the raw
  // original is only ever what the editor itself loads as its base photo
  // layer (see onEdit below), never what a user clicking or downloading
  // the chip should land on.
  const currentUrl = item.thumbnailUrl ?? item.originalUrl;

  function handleDownload() {
    setMenuOpen(false);
    if (!currentUrl) return;
    setDownloading(true);
    downloadAsset(currentUrl, filenameFromUrl(currentUrl, label || "image")).finally(() => setDownloading(false));
  }

  function startRename() {
    setMenuOpen(false);
    setRenameValue(label);
    setRenaming(true);
  }

  function commitRename() {
    setRenaming(false);
    const next = renameValue.trim();
    if (!next || next === label) return;
    setOptimisticLabel(next);
    onRename(next).then((result) => {
      if (!result.success) resetOptimisticLabel();
    });
  }

  return (
    <div
      ref={menuRef}
      className="relative"
      onContextMenu={(e) => {
        if (!canManage || renaming) return;
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <div className="flex w-fit max-w-full items-center gap-1 rounded-full border border-foreground bg-background py-1 pr-1 pl-2.5 text-[11px]">
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                setRenaming(false);
                setRenameValue(label);
              }
            }}
            className="max-w-[120px] min-w-0 bg-transparent px-0.5 py-0.5 text-[11px] focus:outline-none"
          />
        ) : (
          <>
            {/* Separate hit area from the name below on purpose -- clicking
                the thumbnail opens the image, nothing else. Previously the
                whole chip (thumbnail + name) was one <a>, which meant
                click-dragging across the name to select it could also
                register as a click on the link. */}
            <a
              href={currentUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              title="Open image"
              aria-label="Open image"
              className="flex shrink-0 items-center"
            >
              <span className="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-black/10">
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px]">🖼</span>
                )}
              </span>
            </a>
            {/* Real, normally-selectable text -- drag across it with the
                mouse and Cmd/Ctrl+C copies it exactly like any other
                webpage text (CSS truncation only clips the RENDERED glyphs;
                the full string is still the actual DOM text node, so
                triple-click/Select All still selects/copies the complete
                untruncated name even when it's visually cut off). The
                onPointerDown stopPropagation is load-bearing twice over on
                desktop: it stops this row's own drag-to-reorder listener
                (see SortableItemRow) from hijacking a click-drag text
                selection, and it means a selection drag can never land on
                and "click" the <a> above, so selecting the name can never
                accidentally open the image. On touch, SortableItemRow's
                listeners live on its own dedicated grip handle instead, so
                this stopPropagation has nothing to steal from there --
                text selection on the name just works, untouched. */}
            <span
              title={label}
              onPointerDown={(e) => e.stopPropagation()}
              className="max-w-[100px] cursor-text truncate select-text"
            >
              {label}
            </span>
          </>
        )}
        {canManage && !renaming && (
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            title="Image options"
            className="shrink-0 rounded-full px-1.5 text-muted transition-all duration-150 hover:bg-black/[.08] hover:text-foreground active:scale-90"
          >
            ⋮
          </button>
        )}
      </div>
      {menuOpen && (
        <div className="absolute left-0 top-full z-20 mt-1 w-36 max-w-[calc(100vw-1.5rem)] rounded-none border border-border bg-background p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onEdit();
            }}
            className="w-full rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.07]"
          >
            Edit Image
          </button>
          <button
            type="button"
            onClick={startRename}
            className="w-full rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.07]"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="w-full rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.07] disabled:opacity-60"
          >
            {downloading ? "Downloading..." : "Download Image"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
            className="w-full rounded px-2 py-1 text-left text-xs text-error transition-colors duration-150 hover:bg-error/10"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function FrameSection({
  title,
  projectId,
  taskId,
  section,
  frames,
  canManage,
  pushCommand,
  onHideFrame,
  onUnhideFrame,
}: {
  title: string;
  projectId: string;
  taskId: string;
  section: BriefFrameSection;
  frames: BriefTaskFrame[];
  canManage: boolean;
  pushCommand: (command: UndoableCommand) => void;
  onHideFrame: (id: string) => void;
  onUnhideFrame: (id: string) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  // No router.refresh() on either blur handler below -- both fields are
  // uncontrolled inputs that already show their typed value.
  function handleLabelBlur(frameId: string, value: string, original: string) {
    if (value.trim() === original || !value.trim()) return;
    startTransition(async () => {
      await renameBriefTaskFrame(projectId, frameId, value);
    });
  }

  function handleBodyBlur(frameId: string, value: string, original: string) {
    if (value === original) return;
    startTransition(async () => {
      await updateBriefTaskFrameBody(projectId, frameId, value);
    });
  }

  function handleAddFrame() {
    setAdding(true);
    startTransition(async () => {
      const result = await addBriefTaskFrame(projectId, taskId, section);
      setAdding(false);
      router.refresh();
      if (result.success && result.frameId && result.label !== undefined && result.position !== undefined) {
        const current = { id: result.frameId };
        const { label, position } = result;
        pushCommand({
          label: "Add frame",
          undo: async () => {
            await removeBriefTaskFrame(projectId, current.id);
            router.refresh();
          },
          redo: async () => {
            const r = await restoreBriefTaskFrame(projectId, taskId, section, label, "", position);
            if (r.frameId) current.id = r.frameId;
            router.refresh();
          },
        });
      }
    });
  }

  function handleRemoveFrame(frameId: string) {
    const frameIndex = frames.findIndex((f) => f.id === frameId);
    const frame = frames[frameIndex];
    onHideFrame(frameId);
    startTransition(async () => {
      const result = await removeBriefTaskFrame(projectId, frameId);
      if (!result.success) {
        console.error("Failed to remove frame:", result.message);
        onUnhideFrame(frameId);
        router.refresh();
        return;
      }
      if (frame) {
        const current = { id: frameId };
        pushCommand({
          label: "Remove frame",
          undo: async () => {
            const r = await restoreBriefTaskFrame(projectId, taskId, section, frame.label, frame.body, frameIndex);
            if (r.frameId) current.id = r.frameId;
            router.refresh();
          },
          redo: async () => {
            onHideFrame(current.id);
            await removeBriefTaskFrame(projectId, current.id);
            router.refresh();
          },
        });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className={labelClass}>{title}</span>
      <div className="flex flex-col gap-2">
        {frames.map((frame) => (
          <FrameRow
            key={frame.id}
            frame={frame}
            projectId={projectId}
            canManage={canManage}
            onLabelBlur={handleLabelBlur}
            onBodyBlur={handleBodyBlur}
            onRemove={handleRemoveFrame}
          />
        ))}
      </div>
      {canManage && (
        <Button
          type="button"
          variant="primary"
          radius="full"
          onClick={handleAddFrame}
          disabled={adding}
          className="w-fit"
        >
          {adding ? "Adding..." : section === "frames" ? "+ Add Frame Box" : "+ Add Text Box"}
        </Button>
      )}
    </div>
  );
}

// Its own component (rather than inline in FrameSection's .map()) so each
// row gets its own `useState` for the body input's DOM node -- a stable,
// per-instance setter, unlike a shared ref-keyed-by-id Map read during
// render, which the react-hooks/refs rule disallows.
function FrameRow({
  frame,
  projectId,
  canManage,
  onLabelBlur,
  onBodyBlur,
  onRemove,
}: {
  frame: BriefTaskFrame;
  projectId: string;
  canManage: boolean;
  onLabelBlur: (frameId: string, value: string, original: string) => void;
  onBodyBlur: (frameId: string, value: string, original: string) => void;
  onRemove: (frameId: string) => void;
}) {
  const [bodyEl, setBodyEl] = useState<HTMLInputElement | null>(null);

  return (
    <div className="flex items-center gap-2">
      {/* group + relative wrapper: the pencil is a passive visual cue, not an
          interactive element -- it sits over the input's own right padding
          (pr-4, reserved for exactly this) so it can never overlap the
          centered label text, even truncated at the input's max width. Kept
          faintly visible at rest (not hidden-until-hover) specifically so
          touch users -- who have no hover state at all -- get the same "this
          is a text field" cue as desktop, rather than only mouse users. This
          is the one thing beta feedback said was missing: the input itself,
          its focus state, and blur-to-save already worked correctly. */}
      <div className="group relative w-24 shrink-0 sm:w-28">
        <input
          defaultValue={frame.label}
          disabled={!canManage}
          onBlur={(e) => onLabelBlur(frame.id, e.target.value, frame.label)}
          className="w-full truncate border border-border bg-transparent py-2 pr-4 pl-1.5 text-center text-[9px] tracking-normal uppercase text-muted transition-colors duration-150 group-hover:border-foreground/40 focus:border-foreground focus:text-foreground focus:outline-none disabled:opacity-100 sm:pr-4 sm:pl-2 sm:text-[10px]"
        />
        {canManage && (
          <PencilIcon className="pointer-events-none absolute top-1/2 right-1.5 h-2.5 w-2.5 -translate-y-1/2 text-muted opacity-40 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-90" />
        )}
      </div>
      <input
        ref={setBodyEl}
        defaultValue={frame.body}
        disabled={!canManage}
        placeholder="Live text"
        onBlur={(e) => onBodyBlur(frame.id, e.target.value, frame.body)}
        className="min-w-0 flex-1 rounded-none border border-border bg-transparent px-3 py-2 text-sm focus:border-foreground focus:outline-none disabled:opacity-60"
      />
      <BrandWriterField projectId={projectId} field={bodyEl} disabled={!canManage} />
      {canManage && (
        <button
          type="button"
          onClick={() => onRemove(frame.id)}
          className="shrink-0 rounded-full px-1.5 text-muted transition-all duration-150 hover:bg-error/10 hover:text-error active:scale-90"
        >
          ×
        </button>
      )}
    </div>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path
        d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19 3 20l1-4Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" strokeLinecap="round" />
    </svg>
  );
}

function MoodboardIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" fill="currentColor" stroke="none" />
      <path d="m3 16 5-5 4 4 3-3 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
