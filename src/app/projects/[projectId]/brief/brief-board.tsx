"use client";

import { memo, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { useOptimisticOverride } from "@/lib/hooks/use-optimistic-override";
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

  // Only builds a new task object for a task that actually HAS an
  // overridden item -- returning the original `task`/`tasks` references for
  // everything else. Otherwise every task in the board got a brand-new
  // object on every render the instant previewOverrides had ANY entry,
  // which would have defeated TaskCard's React.memo below for the whole
  // list, not just the one task that changed.
  const effectiveTasks = useMemo(() => {
    if (Object.keys(previewOverrides).length === 0) return tasks;
    let changed = false;
    const next = tasks.map((task) => {
      const affected = task.items.some((item) => item.attachmentId && previewOverrides[item.attachmentId]);
      if (!affected) return task;
      changed = true;
      return {
        ...task,
        items: task.items.map((item) =>
          item.attachmentId && previewOverrides[item.attachmentId]
            ? { ...item, thumbnailUrl: previewOverrides[item.attachmentId] }
            : item,
        ),
      };
    });
    return changed ? next : tasks;
  }, [tasks, previewOverrides]);

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
// content_types) and Generate Design's "Post Type" (canvas size, see
// POST_TYPE_CANVAS in lib/actions/brief.ts) used to be two separate rows
// showing overlapping options; now a single select drives both.
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
}: {
  projectId: string;
  task: BriefTaskData;
  canManage: boolean;
  onEditImage: (image: EditingImage) => void;
  pushCommand: (command: UndoableCommand) => void;
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
  // Optimistic, with "adjust state during render" sync back to the server
  // value (same convention Grid's own Post Type pills use) -- previously
  // this read straight off task.contentTypes with no local state at all, so
  // a click didn't visibly do anything until the round-trip + router.refresh
  // landed. On a slow connection (or if the save silently failed, which
  // went unsurfaced before this) that read as "the button doesn't work."
  const {
    value: selectedType,
    set: setOptimisticType,
    reset: resetOptimisticType,
  } = useOptimisticOverride<BriefTaskType>(task.contentTypes[0] ?? "post");

  // No router.refresh() on success -- optimisticType already shows the
  // correct final value, and setBriefTaskTypes no longer revalidates its
  // own route either, since there was nothing left for a refresh to
  // usefully bring back.
  function handleSelectType(type: BriefTaskType) {
    if (type === selectedType) return;
    setTypeError(undefined);
    setOptimisticType(type);
    startTransition(async () => {
      const result = await setBriefTaskTypes(projectId, task.id, [type]);
      if (!result.success) {
        resetOptimisticType();
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

  // No router.refresh() on success -- same reasoning as handleSelectType
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
  function handleGenerateDesign() {
    setGenerateError(undefined);
    setGenerating(true);
    startTransition(async () => {
      const result = await generateBriefDesign(projectId, task.id, selectedType);
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
    startTransition(async () => {
      await deleteBriefTask(projectId, task.id);
      router.refresh();
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
                  onClick={() => handleSelectType(opt.value)}
                  className={`rounded-full border px-4 py-1.5 text-xs tracking-wide uppercase transition-all duration-150 active:scale-95 ${
                    selectedType === opt.value
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

          <ItemSection
            title="References"
            projectId={projectId}
            taskId={task.id}
            section="references"
            items={task.items.filter((i) => i.section === "references")}
            canManage={canManage}
            onEditImage={onEditImage}
            pushCommand={pushCommand}
          />
          <ItemSection
            title="Images"
            projectId={projectId}
            taskId={task.id}
            section="images"
            items={task.items.filter((i) => i.section === "images")}
            canManage={canManage}
            onEditImage={onEditImage}
            pushCommand={pushCommand}
          />
          <ItemSection
            title="Products"
            projectId={projectId}
            taskId={task.id}
            section="products"
            items={task.items.filter((i) => i.section === "products")}
            canManage={canManage}
            onEditImage={onEditImage}
            pushCommand={pushCommand}
          />

          <FrameSection
            title="Frames"
            projectId={projectId}
            taskId={task.id}
            section="frames"
            frames={task.frames.filter((f) => f.section === "frames")}
            canManage={canManage}
            pushCommand={pushCommand}
          />
          <FrameSection
            title="Text"
            projectId={projectId}
            taskId={task.id}
            section="text"
            frames={task.frames.filter((f) => f.section === "text")}
            canManage={canManage}
            pushCommand={pushCommand}
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

function ItemSection({
  title,
  projectId,
  taskId,
  section,
  items,
  canManage,
  onEditImage,
  pushCommand,
}: {
  title: string;
  projectId: string;
  taskId: string;
  section: BriefItemSection;
  items: BriefTaskItem[];
  canManage: boolean;
  onEditImage: (image: EditingImage) => void;
  pushCommand: (command: UndoableCommand) => void;
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

  function handleAddImage() {
    if (!pendingFile) {
      fileInputRef.current?.click();
      return;
    }
    const notes = imageNotesRef.current?.value ?? "";
    const position = items.length;
    const fileName = pendingFile.name;
    setImageError(undefined);
    setImagePending(true);
    startTransition(async () => {
      // The file itself goes direct browser-to-Storage (brief-media bucket,
      // same as this app's other uploads) before the action ever runs --
      // bypasses Vercel's Function request-body limit entirely.
      const path = newStoragePath(projectId, pendingFile.name);
      const uploaded = await uploadFileDirect("brief-media", path, pendingFile);
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
              fileName,
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

  function handleRemove(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    startTransition(async () => {
      await removeBriefTaskItem(projectId, itemId);
      router.refresh();
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

  return (
    <div className="flex flex-col gap-2">
      <span className={labelClass}>{title}</span>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-1.5">
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
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <span className={pillLabelClass}>Link</span>
              <input
                ref={urlRef}
                placeholder="Converts to an image with image url"
                onKeyDown={(e) => e.key === "Enter" && handleAddLink()}
                className={pillInputClass}
              />
              <input ref={linkNotesRef} placeholder="Notes" className={notesInputClass} />
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
              <input ref={imageNotesRef} placeholder="Notes" className={notesInputClass} />
              <Button
                type="button"
                variant="primary"
                radius="full"
                onClick={handleAddImage}
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
}: {
  item: BriefTaskItem;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

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
    downloadAsset(currentUrl, filenameFromUrl(currentUrl, item.label || "image")).finally(() =>
      setDownloading(false),
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <div className="flex w-fit max-w-full items-center gap-1 rounded-full border border-foreground bg-background py-1 pr-1 pl-2.5 text-[11px]">
        <a
          href={currentUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          title={item.label}
          onContextMenu={(e) => {
            if (!canManage) return;
            e.preventDefault();
            setMenuOpen(true);
          }}
          className="flex min-w-0 items-center gap-1"
        >
          <span className="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-black/10">
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[10px]">🖼</span>
            )}
          </span>
          <span className="max-w-[100px] truncate">{item.label}</span>
        </a>
        {canManage && (
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
}: {
  title: string;
  projectId: string;
  taskId: string;
  section: BriefFrameSection;
  frames: BriefTaskFrame[];
  canManage: boolean;
  pushCommand: (command: UndoableCommand) => void;
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
    startTransition(async () => {
      await removeBriefTaskFrame(projectId, frameId);
      router.refresh();
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
      <input
        defaultValue={frame.label}
        disabled={!canManage}
        onBlur={(e) => onLabelBlur(frame.id, e.target.value, frame.label)}
        className="w-24 shrink-0 truncate border border-border bg-transparent px-1.5 py-2 text-center text-[9px] tracking-normal uppercase text-muted focus:border-foreground focus:text-foreground focus:outline-none disabled:opacity-100 sm:w-28 sm:px-2 sm:text-[10px]"
      />
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
