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
  addPostAsset,
  addPostLink,
  removePostAsset,
  removePostLink,
  reorderPostAssets,
  updatePost,
  uploadPostAsset,
} from "@/lib/actions/posts";
import type { MediaLibraryItem } from "../../grid/grid-board";
import type { PostStatus, PostType } from "@/types/database";

export type PostAssetItem = {
  postAssetId: string;
  mediaAssetId: string;
  url: string | null;
  mediaType: "image" | "video";
};
export type PostLinkItem = { id: string; url: string; label: string };

type PostRecord = {
  id: string;
  post_type: PostType;
  caption: string;
  notes: string;
  scheduled_date: string | null;
  status: PostStatus;
};

export function PostEditor({
  projectId,
  post,
  assets,
  links,
  mediaLibrary,
  canManage,
  hideBackLink = false,
}: {
  projectId: string;
  post: PostRecord;
  assets: PostAssetItem[];
  links: PostLinkItem[];
  mediaLibrary: MediaLibraryItem[];
  canManage: boolean;
  hideBackLink?: boolean;
}) {
  const router = useRouter();
  const [prevAssets, setPrevAssets] = useState(assets);
  const [orderedAssets, setOrderedAssets] = useState(assets);
  const [, startTransition] = useTransition();

  if (assets !== prevAssets) {
    setPrevAssets(assets);
    setOrderedAssets(assets);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedAssets.findIndex((a) => a.postAssetId === active.id);
    const newIndex = orderedAssets.findIndex((a) => a.postAssetId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(orderedAssets, oldIndex, newIndex);
    setOrderedAssets(next);
    startTransition(async () => {
      await reorderPostAssets(projectId, post.id, next.map((a) => a.postAssetId));
      router.refresh();
    });
  }

  const usedMediaIds = new Set(orderedAssets.map((a) => a.mediaAssetId));
  const availableMedia = mediaLibrary.filter((m) => !usedMediaIds.has(m.id));

  return (
    <div className="flex flex-col gap-8">
      {!hideBackLink && (
        <Link
          href={`/projects/${projectId}/grid`}
          className="text-sm text-muted hover:underline"
        >
          â† Back to grid
        </Link>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Assets</h2>
        <DndContext
          id={`post-dnd-${post.id}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={orderedAssets.map((a) => a.postAssetId)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {orderedAssets.map((asset) => (
                <SortableAsset
                  key={asset.postAssetId}
                  asset={asset}
                  canManage={canManage}
                  onRemove={() =>
                    startTransition(async () => {
                      await removePostAsset(projectId, post.id, asset.postAssetId);
                      router.refresh();
                    })
                  }
                />
              ))}
              {canManage && (
                <UploadAssetTile projectId={projectId} postId={post.id} onUploaded={() => router.refresh()} />
              )}
            </div>
          </SortableContext>
        </DndContext>
        {orderedAssets.length === 0 && (
          <p className="text-xs text-muted">
            No images yet â€” upload one or add from the library below.
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
                    await addPostAsset(projectId, post.id, item.id);
                    router.refresh();
                  })
                }
                className="aspect-[3/4] overflow-hidden rounded border border-border"
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

      <PostDetailsForm projectId={projectId} post={post} canManage={canManage} />

      <PostLinks projectId={projectId} postId={post.id} links={links} canManage={canManage} />
    </div>
  );
}

function SortableAsset({
  asset,
  canManage,
  onRemove,
}: {
  asset: PostAssetItem;
  canManage: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: asset.postAssetId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(canManage ? { ...attributes, ...listeners } : {})}
      className={`relative aspect-[3/4] touch-none overflow-hidden rounded border border-border ${
        canManage ? "cursor-grab" : ""
      } ${isDragging ? "opacity-50" : ""}`}
    >
      {asset.url && asset.mediaType === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={asset.url} alt="" className="h-full w-full object-cover" draggable={false} />
      )}
      {asset.url && asset.mediaType === "video" && (
        <video src={asset.url} className="h-full w-full object-cover" muted />
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
  );
}

function UploadAssetTile({
  projectId,
  postId,
  onUploaded,
}: {
  projectId: string;
  postId: string;
  onUploaded: () => void;
}) {
  const [state, action, pending] = useActionState(
    uploadPostAsset.bind(null, projectId, postId),
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
        className="hidden"
        onChange={() => formRef.current?.requestSubmit()}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={pending}
        title="Add frame"
        className="flex aspect-[3/4] items-center justify-center rounded border border-dashed border-border text-2xl text-muted hover:bg-black/[.03] disabled:opacity-60"
      >
        {pending ? "â€¦" : "+"}
      </button>
      {state?.message && (
        <p className="col-span-full text-xs text-error">{state.message}</p>
      )}
    </form>
  );
}

function PostDetailsForm({
  projectId,
  post,
  canManage,
}: {
  projectId: string;
  post: PostRecord;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(
    updatePost.bind(null, projectId, post.id),
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select
            name="post_type"
            defaultValue={post.post_type}
            disabled={!canManage}
            className="rounded-md border border-border px-2 py-1.5"
          >
            <option value="post">Post</option>
            <option value="reel">Reel</option>
            <option value="carousel">Carousel</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            name="status"
            defaultValue={post.status}
            disabled={!canManage}
            className="rounded-md border border-border px-2 py-1.5"
          >
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="published">Published</option>
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          Scheduled date
          <input
            type="date"
            name="scheduled_date"
            defaultValue={post.scheduled_date ?? ""}
            disabled={!canManage}
            className="rounded-md border border-border px-2 py-1.5"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Caption
        <textarea
          name="caption"
          defaultValue={post.caption}
          disabled={!canManage}
          rows={3}
          className="rounded-md border border-border px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Notes for the designer
        <textarea
          name="notes"
          defaultValue={post.notes}
          disabled={!canManage}
          rows={3}
          className="rounded-md border border-border px-3 py-2"
        />
      </label>

      {canManage && (
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      )}
      {state?.message && <p className="text-sm text-error">{state.message}</p>}
    </form>
  );
}

function PostLinks({
  projectId,
  postId,
  links,
  canManage,
}: {
  projectId: string;
  postId: string;
  links: PostLinkItem[];
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(
    addPostLink.bind(null, projectId, postId),
    undefined,
  );
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Links</h2>
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
                    await removePostLink(projectId, postId, link.id);
                    router.refresh();
                  })
                }
                className="text-xs text-error hover:underline"
              >
                Remove
              </button>
            )}
          </li>
        ))}
        {links.length === 0 && (
          <p className="text-xs text-muted">No links yet.</p>
        )}
      </ul>

      {canManage && (
        <form action={action} className="flex gap-2">
          <input
            name="label"
            placeholder="Label"
            className="w-32 rounded-md border border-border px-2 py-1.5 text-sm"
          />
          <input
            name="url"
            placeholder="https://..."
            required
            className="flex-1 rounded-md border border-border px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-60"
          >
            {pending ? "Adding..." : "Add"}
          </button>
        </form>
      )}
      {state?.message && <p className="text-xs text-error">{state.message}</p>}
    </section>
  );
}
