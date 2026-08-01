"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  addStoryFrame,
  deleteStory,
  removeStoryFrame,
  reorderStoryFrames,
  updateStory,
  updateStoryFrameLink,
  uploadStoryFrame,
} from "@/lib/actions/stories";
import type { MediaLibraryItem } from "../../grid/grid-board";
import type { StoryFrameItem } from "@/lib/data/stories";

export function StoryEditor({
  projectId,
  story,
  frames,
  mediaLibrary,
  canManage,
  hideBackLink = false,
}: {
  projectId: string;
  story: { id: string; name: string; scheduled_date: string | null };
  frames: StoryFrameItem[];
  mediaLibrary: MediaLibraryItem[];
  canManage: boolean;
  hideBackLink?: boolean;
}) {
  const router = useRouter();
  const [prevFrames, setPrevFrames] = useState(frames);
  const [orderedFrames, setOrderedFrames] = useState(frames);
  const [, startTransition] = useTransition();

  if (frames !== prevFrames) {
    setPrevFrames(frames);
    setOrderedFrames(frames);
  }

  const [state, action, pending] = useActionState(
    updateStory.bind(null, projectId, story.id),
    undefined,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
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

  const usedMediaIds = new Set(orderedFrames.map((f) => f.mediaAssetId));
  const availableMedia = mediaLibrary.filter((m) => !usedMediaIds.has(m.id));

  return (
    <div className="flex flex-col gap-8">
      {!hideBackLink && (
        <Link
          href={`/projects/${projectId}/stories`}
          className="text-sm text-muted hover:underline"
        >
          ← Back to stories
        </Link>
      )}

      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Story name
          <input
            name="name"
            defaultValue={story.name}
            disabled={!canManage}
            className="rounded-md border border-border px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Scheduled date
          <input
            type="date"
            name="scheduled_date"
            defaultValue={story.scheduled_date ?? ""}
            disabled={!canManage}
            className="rounded-md border border-border px-2 py-1.5"
          />
        </label>
        {canManage && (
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-60"
          >
            {pending ? "Saving..." : "Save"}
          </button>
        )}
        {canManage && (
          <button
            type="button"
            onClick={() => {
              if (confirm("Delete this story?")) {
                startTransition(() => deleteStory(projectId, story.id));
              }
            }}
            className="rounded-md border border-red-600 px-3 py-1.5 text-sm text-error"
          >
            Delete story
          </button>
        )}
        {state?.message && <p className="w-full text-sm text-error">{state.message}</p>}
        {state?.success && !state?.message && (
          <p className="w-full text-sm text-success">Saved.</p>
        )}
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Frames</h2>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={orderedFrames.map((f) => f.frameId)}
            strategy={rectSortingStrategy}
          >
            <div className="flex flex-wrap gap-3">
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
        </DndContext>
        {orderedFrames.length === 0 && (
          <p className="text-xs text-muted">
            No frames yet — upload one or add from the library below.
          </p>
        )}
      </section>

      {canManage && availableMedia.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Add from library</h2>
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
                className="aspect-[9/16] overflow-hidden rounded border border-border"
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
    </div>
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
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div className="flex w-24 flex-col gap-1">
      <div
        ref={setNodeRef}
        style={style}
        {...(canManage ? { ...attributes, ...listeners } : {})}
        className={`relative aspect-[9/16] touch-none overflow-hidden rounded border border-border ${
          canManage ? "cursor-grab" : ""
        } ${isDragging ? "opacity-50" : ""}`}
      >
        {frame.url && frame.mediaType === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frame.url} alt="" className="h-full w-full object-cover" draggable={false} />
        )}
        {frame.url && frame.mediaType === "video" && (
          <video src={frame.url} className="h-full w-full object-cover" muted />
        )}
        {canManage && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute right-1 top-1 rounded bg-black/70 px-1.5 text-xs text-white"
          >
            âœ•
          </button>
        )}
      </div>
      <input
        defaultValue={frame.linkUrl ?? ""}
        placeholder="Link URL"
        disabled={!canManage}
        onBlur={(e) => updateStoryFrameLink(projectId, storyId, frame.frameId, e.target.value)}
        className="w-full rounded border border-border px-1 py-0.5 text-[10px]"
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
    <form ref={formRef} action={action} className="flex w-24 flex-col gap-1">
      <input
        ref={fileInputRef}
        type="file"
        name="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={() => formRef.current?.requestSubmit()}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={pending}
        title="Add frame"
        className="flex aspect-[9/16] items-center justify-center rounded border border-dashed border-border text-2xl text-muted hover:bg-black/[.03] disabled:opacity-60"
      >
        {pending ? "…" : "+"}
      </button>
      {state?.message && <p className="text-[10px] text-error">{state.message}</p>}
    </form>
  );
}
