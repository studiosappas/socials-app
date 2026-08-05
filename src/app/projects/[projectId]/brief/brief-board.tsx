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
  removeBriefTaskFrame,
  removeBriefTaskItem,
  renameBriefTask,
  renameBriefTaskFrame,
  saveBriefAnnotation,
  setBriefTaskTypes,
  updateBriefTaskFrameBody,
} from "@/lib/actions/brief";
import { AnnotationEditor } from "@/components/annotation-editor";
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

type EditingImage = { itemId: string; attachmentId: string; imageUrl: string; annotationJson: object | null };

export function BriefBoard({
  projectId,
  tasks,
  canManage,
}: {
  projectId: string;
  tasks: BriefTaskData[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const [editingImage, setEditingImage] = useState<EditingImage | null>(null);

  function handleAddTask() {
    setCreating(true);
    setCreateError(undefined);
    startTransition(async () => {
      const result = await createBriefTask(projectId, tasks.length);
      setCreating(false);
      if (!result.success) {
        setCreateError(result.message ?? "Couldn't create task.");
        return;
      }
      router.refresh();
    });
  }

  function handleAnnotationSaved() {
    setEditingImage(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          projectId={projectId}
          task={task}
          canManage={canManage}
          onEditImage={setEditingImage}
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
          className="flex w-fit items-center gap-2 text-xs font-semibold tracking-wide uppercase transition-colors duration-150 hover:text-muted disabled:opacity-50"
        >
          {creating ? "Adding..." : "+ Add Task"}
        </button>
      )}
      {createError && <p className="text-xs text-error">{createError}</p>}

      <AnnotationEditor
        projectId={projectId}
        attachmentId={editingImage?.attachmentId ?? null}
        open={editingImage !== null}
        imageUrl={editingImage?.imageUrl ?? null}
        initialAnnotationJson={editingImage?.annotationJson ?? null}
        onClose={() => setEditingImage(null)}
        onSaved={handleAnnotationSaved}
        saveAction={saveBriefAnnotation}
      />
    </div>
  );
}

const TASK_TYPES: BriefTaskType[] = ["story", "newsletter"];

function TaskCard({
  projectId,
  task,
  canManage,
  onEditImage,
}: {
  projectId: string;
  task: BriefTaskData;
  canManage: boolean;
  onEditImage: (image: EditingImage) => void;
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

  function handleNameBlur() {
    const value = nameRef.current?.value.trim();
    if (!value || value === task.name) return;
    startTransition(async () => {
      await renameBriefTask(projectId, task.id, value);
      router.refresh();
    });
  }

  function handleToggleType(type: BriefTaskType) {
    const next = task.contentTypes.includes(type)
      ? task.contentTypes.filter((t) => t !== type)
      : [...task.contentTypes, type];
    startTransition(async () => {
      await setBriefTaskTypes(projectId, task.id, next);
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
                className="rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
              >
                ⋮
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-7 z-20 w-40 rounded-none border border-border bg-background p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="w-full rounded px-2 py-1 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05]"
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
            className="rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
          >
            <ChevronIcon className={`h-4 w-4 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-6">
          <div className="flex gap-2">
            {TASK_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                disabled={!canManage}
                onClick={() => handleToggleType(type)}
                className={`rounded-full border px-4 py-1.5 text-xs tracking-wide uppercase transition-colors duration-150 ${
                  task.contentTypes.includes(type)
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-foreground hover:border-foreground/40"
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          <ItemSection
            title="References"
            projectId={projectId}
            taskId={task.id}
            section="references"
            items={task.items.filter((i) => i.section === "references")}
            canManage={canManage}
            onEditImage={onEditImage}
          />
          <ItemSection
            title="Images"
            projectId={projectId}
            taskId={task.id}
            section="images"
            items={task.items.filter((i) => i.section === "images")}
            canManage={canManage}
            onEditImage={onEditImage}
          />
          <ItemSection
            title="Products"
            projectId={projectId}
            taskId={task.id}
            section="products"
            items={task.items.filter((i) => i.section === "products")}
            canManage={canManage}
            onEditImage={onEditImage}
          />

          <FrameSection
            title="Frames"
            projectId={projectId}
            taskId={task.id}
            section="frames"
            frames={task.frames.filter((f) => f.section === "frames")}
            canManage={canManage}
          />
          <FrameSection
            title="Text"
            projectId={projectId}
            taskId={task.id}
            section="text"
            frames={task.frames.filter((f) => f.section === "text")}
            canManage={canManage}
          />

          {canManage && (
            <div className="flex items-center gap-3">
              <Button type="button" variant="primary" radius="full" onClick={handleSave} disabled={saving} className="w-40">
                {saving ? "Saving..." : "Save"}
              </Button>
              {saved && <span className="text-xs text-success">Saved.</span>}
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
}: {
  title: string;
  projectId: string;
  taskId: string;
  section: BriefItemSection;
  items: BriefTaskItem[];
  canManage: boolean;
  onEditImage: (image: EditingImage) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [linkPending, setLinkPending] = useState(false);
  const [imagePending, setImagePending] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const linkNotesRef = useRef<HTMLInputElement>(null);
  const imageNotesRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleAddLink() {
    const url = urlRef.current?.value.trim() ?? "";
    if (!url) return;
    const notes = linkNotesRef.current?.value ?? "";
    setLinkPending(true);
    startTransition(async () => {
      await addBriefTaskLink(projectId, taskId, section, url, notes, items.length);
      setLinkPending(false);
      if (urlRef.current) urlRef.current.value = "";
      if (linkNotesRef.current) linkNotesRef.current.value = "";
      router.refresh();
    });
  }

  function handleAddImage() {
    if (!pendingFile) {
      fileInputRef.current?.click();
      return;
    }
    const notes = imageNotesRef.current?.value ?? "";
    setImagePending(true);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", pendingFile);
      await addBriefTaskImage(projectId, taskId, section, notes, items.length, formData);
      setImagePending(false);
      setPendingFile(null);
      if (imageNotesRef.current) imageNotesRef.current.value = "";
      router.refresh();
    });
  }

  function handleRemove(itemId: string) {
    startTransition(async () => {
      await removeBriefTaskItem(projectId, itemId);
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
              {item.notes && <span className="text-[10px] italic text-muted">{item.notes}</span>}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <span className={pillLabelClass}>Link</span>
            <input
              ref={urlRef}
              placeholder="URL"
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
          className="shrink-0 px-1 text-muted transition-colors duration-150 hover:text-error"
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

  function handleDownload() {
    setMenuOpen(false);
    if (!item.originalUrl) return;
    setDownloading(true);
    downloadAsset(item.originalUrl, filenameFromUrl(item.originalUrl, item.label || "image")).finally(() =>
      setDownloading(false),
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <div className="flex w-fit max-w-full items-center gap-1 rounded-full border border-foreground bg-background py-1 pr-1 pl-2.5 text-[11px]">
        <a
          href={item.originalUrl ?? undefined}
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
            className="shrink-0 rounded-full px-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
          >
            ⋮
          </button>
        )}
      </div>
      {menuOpen && (
        <div className="absolute left-0 top-full z-20 mt-1 w-36 rounded-none border border-border bg-background p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onEdit();
            }}
            className="w-full rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
          >
            Edit Image
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="w-full rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05] disabled:opacity-60"
          >
            {downloading ? "Downloading..." : "Download Image"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
            className="w-full rounded px-2 py-1 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05]"
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
}: {
  title: string;
  projectId: string;
  taskId: string;
  section: BriefFrameSection;
  frames: BriefTaskFrame[];
  canManage: boolean;
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
      await addBriefTaskFrame(projectId, taskId, section, frames.length);
      setAdding(false);
      router.refresh();
    });
  }

  function handleRemoveFrame(frameId: string) {
    startTransition(async () => {
      await removeBriefTaskFrame(projectId, frameId);
      router.refresh();
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
                className="shrink-0 px-1 text-muted transition-colors duration-150 hover:text-error"
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
          {adding ? "Adding..." : "+ Add Text Box"}
        </Button>
      )}
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
