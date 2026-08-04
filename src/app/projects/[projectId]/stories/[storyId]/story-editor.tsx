"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  addStoryFrame,
  addStoryLink,
  removeStoryFrame,
  removeStoryLink,
  reorderStoryFrames,
  updateStory,
  updateStoryFrameLink,
  uploadStoryFrame,
} from "@/lib/actions/stories";
import { SORTABLE_TRANSITION } from "@/lib/dnd-motion";
import { downloadAssetsAsZip, filenameFromUrl } from "@/lib/download-zip";
import { convertToTask } from "@/lib/actions/todo";
import { Button } from "@/components/ui/button";
import type { MediaLibraryItem } from "../../grid/grid-board";
import type { StoryFrameItem, StoryLinkItem } from "@/lib/data/stories";
import type { StoryStatus } from "@/types/database";

type StoryRecord = {
  id: string;
  name: string;
  scheduled_date: string | null;
  status: StoryStatus;
  notes: string;
};

const labelClass = "text-xs tracking-wide text-muted uppercase";
const fieldClass =
  "w-full rounded-none border border-foreground bg-transparent px-3 py-2 text-sm focus:outline-none";

export function StoryEditor({
  projectId,
  story,
  frames,
  links,
  mediaLibrary,
  canManage,
  hideBackLink = false,
}: {
  projectId: string;
  story: StoryRecord;
  frames: StoryFrameItem[];
  links: StoryLinkItem[];
  mediaLibrary: MediaLibraryItem[];
  canManage: boolean;
  hideBackLink?: boolean;
}) {
  const router = useRouter();
  const [prevFrames, setPrevFrames] = useState(frames);
  const [orderedFrames, setOrderedFrames] = useState(frames);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  if (frames !== prevFrames) {
    setPrevFrames(frames);
    setOrderedFrames(frames);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveFrameId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveFrameId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedFrames.findIndex((f) => f.frameId === active.id);
    const newIndex = orderedFrames.findIndex((f) => f.frameId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(orderedFrames, oldIndex, newIndex);
    setOrderedFrames(next);
    startTransition(async () => {
      await reorderStoryFrames(projectId, story.id, next.map((f) => f.frameId));
      router.refresh();
    });
  }

  const activeFrame = orderedFrames.find((f) => f.frameId === activeFrameId) ?? null;

  const usedMediaIds = new Set(orderedFrames.map((f) => f.mediaAssetId));
  const availableMedia = mediaLibrary.filter((m) => !usedMediaIds.has(m.id));

  const [downloading, setDownloading] = useState(false);
  async function handleDownloadAll() {
    setDownloading(true);
    try {
      const zipAssets = orderedFrames
        .filter((f): f is typeof f & { url: string } => Boolean(f.url))
        .map((f, i) => ({ url: f.url, filename: filenameFromUrl(f.url, `frame-${i + 1}`) }));
      await downloadAssetsAsZip(zipAssets, `story-${story.id}-frames.zip`);
    } finally {
      setDownloading(false);
    }
  }

  function scrollFramesRight() {
    scrollRef.current?.scrollBy({ left: 240, behavior: "smooth" });
  }

  return (
    <div className="flex flex-col gap-6">
      {!hideBackLink && (
        <Link
          href={`/projects/${projectId}/stories`}
          className="text-sm text-muted transition-colors duration-150 hover:text-foreground"
        >
          ← Back to stories
        </Link>
      )}

      <div className="relative">
        <DndContext
          id={`story-dnd-${story.id}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveFrameId(null)}
        >
          <SortableContext
            items={orderedFrames.map((f) => f.frameId)}
            strategy={rectSortingStrategy}
          >
            <div ref={scrollRef} className="flex gap-2 overflow-x-auto scroll-smooth pb-1">
              {orderedFrames.map((frame) => (
                <SortableFrame
                  key={frame.frameId}
                  projectId={projectId}
                  storyId={story.id}
                  frame={frame}
                  canManage={canManage}
                  onRemove={() =>
                    startTransition(async () => {
                      await removeStoryFrame(projectId, story.id, frame.frameId);
                      router.refresh();
                    })
                  }
                />
              ))}
              {canManage && (
                <UploadFrameTile
                  projectId={projectId}
                  storyId={story.id}
                  onUploaded={() => router.refresh()}
                />
              )}
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {activeFrame && (
              <div className="aspect-[9/16] w-24 cursor-grabbing overflow-hidden rounded border border-foreground/20 shadow-[0_2px_10px_rgba(0,0,0,0.1)]">
                <FramePreview frame={activeFrame} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
        {orderedFrames.length > 3 && (
          <button
            type="button"
            onClick={scrollFramesRight}
            title="Scroll for more"
            className="absolute right-0 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-muted transition-colors duration-150 hover:text-foreground"
          >
            ›
          </button>
        )}
      </div>

      {orderedFrames.length > 0 ? (
        <Button
          type="button"
          variant="primary"
          radius="none"
          onClick={handleDownloadAll}
          disabled={downloading}
          className="w-fit self-start px-6 py-3 text-xs tracking-wide uppercase"
        >
          {downloading ? "Preparing…" : "Download Media"}
        </Button>
      ) : (
        <p className="text-xs text-muted">No frames yet — upload one or add from the library below.</p>
      )}

      {canManage && availableMedia.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className={labelClass}>Add from library</span>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {availableMedia.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    await addStoryFrame(projectId, story.id, item.id);
                    router.refresh();
                  })
                }
                className="aspect-[9/16] overflow-hidden rounded-none border border-border"
              >
                {item.url && item.mediaType === "image" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="" className="h-full w-full object-cover" />
                )}
                {item.url && item.mediaType === "video" && (
                  <video src={item.url} className="h-full w-full object-cover" muted />
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      <StoryMainForm projectId={projectId} story={story} links={links} canManage={canManage} />
    </div>
  );
}

function FramePreview({ frame }: { frame: StoryFrameItem }) {
  return (
    <>
      {frame.url && frame.mediaType === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={frame.url} alt="" className="h-full w-full object-cover" draggable={false} />
      )}
      {frame.url && frame.mediaType === "video" && (
        <video src={frame.url} className="h-full w-full object-cover" muted />
      )}
    </>
  );
}

function SortableFrame({
  projectId,
  storyId,
  frame,
  canManage,
  onRemove,
}: {
  projectId: string;
  storyId: string;
  frame: StoryFrameItem;
  canManage: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: frame.frameId,
    transition: SORTABLE_TRANSITION,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div className="flex w-24 shrink-0 flex-col gap-1">
      <div
        ref={setNodeRef}
        style={style}
        {...(canManage ? { ...attributes, ...listeners } : {})}
        className={`relative aspect-[9/16] touch-none overflow-hidden rounded-none border border-border transition-opacity duration-150 ${
          canManage ? "cursor-grab" : ""
        } ${isDragging ? "opacity-30" : ""}`}
      >
        <FramePreview frame={frame} />
        {canManage && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute right-1 top-1 rounded bg-black/70 px-1.5 text-xs text-white"
          >
            X
          </button>
        )}
      </div>
      <input
        defaultValue={frame.linkUrl ?? ""}
        placeholder="Link URL"
        disabled={!canManage}
        onBlur={(e) => updateStoryFrameLink(projectId, storyId, frame.frameId, e.target.value)}
        className="w-full rounded-none border border-border px-1 py-0.5 text-[10px] focus:border-foreground focus:outline-none"
      />
    </div>
  );
}

function UploadFrameTile({
  projectId,
  storyId,
  onUploaded,
}: {
  projectId: string;
  storyId: string;
  onUploaded: () => void;
}) {
  const [state, action, pending] = useActionState(
    uploadStoryFrame.bind(null, projectId, storyId),
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.success) onUploaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={formRef} action={action} className="contents">
      <input
        ref={fileInputRef}
        type="file"
        name="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={() => formRef.current?.requestSubmit()}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={pending}
        title="Add frame"
        className="flex aspect-[9/16] w-24 shrink-0 items-center justify-center rounded-none border border-dashed border-border text-2xl text-muted transition-colors duration-150 hover:bg-black/[.03] disabled:opacity-60"
      >
        {pending ? "…" : "+"}
      </button>
      {state?.message && <p className="text-xs text-error">{state.message}</p>}
    </form>
  );
}

function StoryMainForm({
  projectId,
  story,
  links,
  canManage,
}: {
  projectId: string;
  story: StoryRecord;
  links: StoryLinkItem[];
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(
    updateStory.bind(null, projectId, story.id),
    undefined,
  );
  const [addedToTodo, setAddedToTodo] = useState(false);
  const [todoError, setTodoError] = useState<string | undefined>();
  const [, startTransition] = useTransition();

  function handleAddToTodo() {
    setTodoError(undefined);
    startTransition(async () => {
      const result = await convertToTask(projectId, "story", story.id, story.name, story.scheduled_date);
      if (result.success) {
        setAddedToTodo(true);
      } else {
        setTodoError(result.message ?? "Couldn't add to To-Do list.");
      }
    });
  }

  return (
    <form action={action} className="flex flex-col gap-6">
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Story name</span>
        <input
          name="name"
          defaultValue={story.name}
          disabled={!canManage}
          placeholder="Live text for story name"
          className={fieldClass}
        />
      </label>

      <StoryLinks projectId={projectId} storyId={story.id} links={links} canManage={canManage} />

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Notes</span>
        <textarea
          name="notes"
          defaultValue={story.notes}
          disabled={!canManage}
          rows={3}
          placeholder="Live text for notes"
          className={fieldClass}
        />
      </label>

      <div className="flex flex-col gap-3">
        <span className={labelClass}>Schedule story</span>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Status</span>
            <select name="status" defaultValue={story.status} disabled={!canManage} className={fieldClass}>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Published</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Schedule date</span>
            <input
              type="date"
              name="scheduled_date"
              defaultValue={story.scheduled_date ?? ""}
              disabled={!canManage}
              className={fieldClass}
            />
          </label>
        </div>
      </div>

      <Button
        type="button"
        variant="primary"
        radius="none"
        onClick={handleAddToTodo}
        disabled={addedToTodo}
        className="w-full py-3 text-xs tracking-wide uppercase"
      >
        {addedToTodo ? "Added to To-Do" : "Add to → To Do List"}
      </Button>
      {todoError && <p className="text-sm text-error">{todoError}</p>}

      {state?.message && <p className="text-sm text-error">{state.message}</p>}

      {canManage && (
        <Button
          type="submit"
          variant="primary"
          radius="none"
          disabled={pending}
          className="w-full py-3 text-xs tracking-wide uppercase"
        >
          {pending ? "Saving..." : "Save Changes"}
        </Button>
      )}
    </form>
  );
}

function StoryLinks({
  projectId,
  storyId,
  links,
  canManage,
}: {
  projectId: string;
  storyId: string;
  links: StoryLinkItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const labelRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  function handleAdd() {
    const label = labelRef.current?.value.trim() ?? "";
    const url = urlRef.current?.value.trim() ?? "";
    if (!url) return;
    setPending(true);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("label", label);
      formData.set("url", url);
      const result = await addStoryLink(projectId, storyId, undefined, formData);
      setPending(false);
      if (result?.message) {
        setMessage(result.message);
        return;
      }
      setMessage(undefined);
      if (labelRef.current) labelRef.current.value = "";
      if (urlRef.current) urlRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className={labelClass}>Links</span>
      {links.length > 0 && (
        <ul className="flex flex-col gap-1">
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-2 text-sm">
              <a href={link.url} target="_blank" rel="noreferrer" className="truncate underline">
                {link.label || link.url}
              </a>
              {canManage && (
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await removeStoryLink(projectId, storyId, link.id);
                      router.refresh();
                    })
                  }
                  className="shrink-0 text-xs text-error transition-colors duration-150 hover:underline"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="flex gap-2">
          <input
            ref={labelRef}
            placeholder="Label"
            className="w-28 rounded-full border border-border px-3 py-1.5 text-sm focus:border-foreground focus:outline-none"
          />
          <input
            ref={urlRef}
            placeholder="URL"
            className="flex-1 rounded-full border border-border px-3 py-1.5 text-sm focus:border-foreground focus:outline-none"
          />
          <Button
            type="button"
            variant="primary"
            radius="full"
            onClick={handleAdd}
            disabled={pending}
            className="shrink-0"
          >
            {pending ? "Adding..." : "Add"}
          </Button>
        </div>
      )}
      {message && <p className="text-xs text-error">{message}</p>}
    </div>
  );
}
