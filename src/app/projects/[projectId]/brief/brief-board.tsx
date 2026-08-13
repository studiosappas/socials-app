"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
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
  setBriefTaskTypes,
  updateBriefTaskFrameBody,
  updateBriefTaskItemNotes,
} from "@/lib/actions/brief";
import { saveMediaAssetAnnotation } from "@/lib/actions/media";
import { AnnotationEditor } from "@/components/annotation-editor";
import { BrandMoodboardDialog } from "@/components/brand-moodboard-dialog";
import { UndoIcon } from "../grid/grid-board";
import { useUndoStack, useUndoRedoShortcuts, type UndoableCommand } from "@/lib/hooks/use-undo-stack";
import type { BrandMoodboardItem } from "@/lib/data/brand-moodboard";
import type { BriefFrameSection, BriefItemKind, BriefItemSection, BriefTaskType } from "@/types/database";

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

  // Board-level (not per-task) since undoing "Add Task" must survive that
  // task's own TaskCard being removed from the tree -- same reasoning as
  // Grid's own board-level stack (grid-board.tsx).
  const { push: pushCommand, undo, redo, canUndo, canRedo, isBusy: undoRedoBusy } = useUndoStack();
  useUndoRedoShortcuts(undo, redo);

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

  function handleAnnotationSaved() {
    setEditingImage(null);
    router.refresh();
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
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border">
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

      {tasks.map((task) => (
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

function TaskCard({
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
  const selectedType: BriefTaskType = task.contentTypes[0] ?? "post";

  function handleSelectType(type: BriefTaskType) {
    startTransition(async () => {
      await setBriefTaskTypes(projectId, task.id, [type]);
      router.refresh();
    });
  }

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
      router.refresh();
    });
  }

  function handleNameBlur() {
    const value = nameRef.current?.value.trim();
    if (!value || value === task.name) return;
    startTransition(async () => {
      await renameBriefTask(projectId, task.id, value);
      router.refresh();
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
    // is left unsaved.
    const active = document.activeElement;
    if (active instanceof HTMLElement && containerRef.current?.contains(active)) {
      active.blur();
    }
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 1500);
    }, 150);
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div
        className="flex cursor-pointer items-center justify-between gap-3"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <input
            key={task.name}
            ref={nameRef}
            defaultValue={task.name}
            disabled={!canManage}
            onBlur={handleNameBlur}
            className={`${labelClass} cursor-text border-0 bg-transparent focus:outline-none disabled:opacity-100`}
          />
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
      const formData = new FormData();
      formData.set("file", pendingFile);
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

  function handleNotesBlur(itemId: string, value: string, original: string) {
    if (value.trim() === original) return;
    startTransition(async () => {
      await updateBriefTaskItemNotes(projectId, itemId, value);
      router.refresh();
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
                onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
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
              <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
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

  function handleLabelBlur(frameId: string, value: string, original: string) {
    if (value.trim() === original || !value.trim()) return;
    startTransition(async () => {
      await renameBriefTaskFrame(projectId, frameId, value);
      router.refresh();
    });
  }

  function handleBodyBlur(frameId: string, value: string, original: string) {
    if (value === original) return;
    startTransition(async () => {
      await updateBriefTaskFrameBody(projectId, frameId, value);
      router.refresh();
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
          <div key={frame.id} className="flex items-center gap-2">
            <input
              key={`${frame.id}-label`}
              defaultValue={frame.label}
              disabled={!canManage}
              onBlur={(e) => handleLabelBlur(frame.id, e.target.value, frame.label)}
              className="w-24 shrink-0 truncate border border-border bg-transparent px-1.5 py-2 text-center text-[9px] tracking-normal uppercase text-muted focus:border-foreground focus:text-foreground focus:outline-none disabled:opacity-100 sm:w-28 sm:px-2 sm:text-[10px]"
            />
            <input
              key={`${frame.id}-body`}
              defaultValue={frame.body}
              disabled={!canManage}
              placeholder="Live text"
              onBlur={(e) => handleBodyBlur(frame.id, e.target.value, frame.body)}
              className="min-w-0 flex-1 rounded-none border border-border bg-transparent px-3 py-2 text-sm focus:border-foreground focus:outline-none disabled:opacity-60"
            />
            {canManage && (
              <button
                type="button"
                onClick={() => handleRemoveFrame(frame.id)}
                className="shrink-0 rounded-full px-1.5 text-muted transition-all duration-150 hover:bg-error/10 hover:text-error active:scale-90"
              >
                ×
              </button>
            )}
          </div>
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
