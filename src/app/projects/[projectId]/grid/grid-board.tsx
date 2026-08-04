"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  addGridRow,
  removeGridRow,
  placeMediaInSlot,
  reorderGridPosts,
  updateSlotCoverTransform,
} from "@/lib/actions/grid";
import { deletePost } from "@/lib/actions/posts";
import { MediaLibrary, MediaThumbPreview } from "./media-library";
import { BrandPanel } from "./brand-panel";
import { GridCropOverlay, coverTransformStyle } from "./grid-crop-overlay";
import { SORTABLE_TRANSITION } from "@/lib/dnd-motion";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import type { MediaType, Platform } from "@/types/database";

const DOUBLE_CLICK_WINDOW_MS = 220;

export type MediaLibraryItem = { id: string; url: string | null; mediaType: MediaType };
export type GridCoverTransform = { scale: number; x: number; y: number };
export type GridBoardSlot = {
  id: string;
  postId: string | null;
  thumbnailUrl: string | null;
  assetCount: number;
  coverTransform: GridCoverTransform | null;
};
export type GridBoardRow = { id: string; slots: GridBoardSlot[] };

export function GridBoard({
  projectId,
  projectName,
  brandNotes,
  contentPillars,
  igUsername,
  igDisplayName,
  igBio,
  websiteUrl,
  industry,
  platform,
  profilePhotoUrl,
  postsPerWeek,
  storiesPerWeek,
  reelsPerWeek,
  newsletterPerWeek,
  rows,
  mediaLibrary,
  canManage,
}: {
  projectId: string;
  projectName: string;
  brandNotes: string;
  contentPillars: string;
  igUsername: string;
  igDisplayName: string;
  igBio: string;
  websiteUrl: string;
  industry: string;
  platform: Platform;
  profilePhotoUrl: string | null;
  postsPerWeek: number;
  storiesPerWeek: number;
  reelsPerWeek: number;
  newsletterPerWeek: number;
  rows: GridBoardRow[];
  mediaLibrary: MediaLibraryItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeMedia, setActiveMedia] = useState<MediaLibraryItem | null>(null);
  const [activeSlot, setActiveSlot] = useState<GridBoardSlot | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // Optimistic override so a slot reorder renders immediately instead of
  // waiting for the server round-trip + router.refresh() to land — otherwise
  // the grid visibly snaps back to the old order for a beat after drop.
  const [prevRows, setPrevRows] = useState(rows);
  const [overrideRows, setOverrideRows] = useState<GridBoardRow[] | null>(null);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setOverrideRows(null);
  }
  const effectiveRows = overrideRows ?? rows;

  const flatSlots = effectiveRows.flatMap((row) => row.slots);
  const flatSlotIds = flatSlots.map((slot) => slot.id);

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current;
    if (data?.type === "slot") {
      setActiveSlot((data.slot as GridBoardSlot | undefined) ?? null);
      return;
    }
    setActiveMedia((data?.item as MediaLibraryItem | undefined) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveMedia(null);
    setActiveSlot(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;

    if (activeData?.type === "slot") {
      const oldIndex = flatSlotIds.indexOf(active.id as string);
      const newIndex = flatSlotIds.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const oldPostIds = flatSlots.map((slot) => slot.postId);
      const newPostIds = arrayMove(oldPostIds, oldIndex, newIndex);
      const updates = flatSlotIds
        .map((slotId, i) => ({ slotId, postId: newPostIds[i] }))
        .filter((update, i) => newPostIds[i] !== oldPostIds[i]);

      if (updates.length === 0) return;

      const postIdBySlotId = new Map(flatSlotIds.map((slotId, i) => [slotId, newPostIds[i]]));
      const postInfoByPostId = new Map<string, { thumbnailUrl: string | null; assetCount: number }>();
      for (const slot of flatSlots) {
        if (slot.postId) {
          postInfoByPostId.set(slot.postId, { thumbnailUrl: slot.thumbnailUrl, assetCount: slot.assetCount });
        }
      }
      setOverrideRows(
        effectiveRows.map((row) => ({
          ...row,
          slots: row.slots.map((slot) => {
            // postIdBySlotId is exhaustive (built from every flatSlotId), so
            // a missing entry never happens in practice -- but critically,
            // `.get()` can legitimately return null (this slot is now
            // empty), which `??` would wrongly treat as "not found" and
            // fall back to the slot's old postId, leaving the source slot
            // showing its old content after a move. Using `.has()` keeps
            // that null as the real, intended value.
            if (!postIdBySlotId.has(slot.id)) return slot;
            const newPostId = postIdBySlotId.get(slot.id)!;
            if (newPostId === slot.postId) return slot;
            const info = newPostId ? postInfoByPostId.get(newPostId) : undefined;
            return {
              ...slot,
              postId: newPostId,
              thumbnailUrl: info?.thumbnailUrl ?? null,
              assetCount: info?.assetCount ?? 0,
            };
          }),
        })),
      );

      // The optimistic state above already reflects the final order and the
      // write below is durable, so a router.refresh() on success would only
      // cause a redundant flash -- the next real navigation picks up fresh
      // data. On failure, resync with the server instead of leaving an
      // optimistic state that was never actually persisted.
      startTransition(async () => {
        try {
          await reorderGridPosts(updates);
        } catch (error) {
          console.error("Failed to save grid reorder:", error);
          setOverrideRows(null);
          router.refresh();
        }
      });
      return;
    }

    const mediaAssetId = activeData?.mediaAssetId as string | undefined;
    const mediaItem = activeData?.item as MediaLibraryItem | undefined;
    const slotId = (over.data.current?.slotId as string | undefined) ?? (over.id as string);
    if (!mediaAssetId || !slotId) return;

    setOverrideRows(
      effectiveRows.map((row) => ({
        ...row,
        slots: row.slots.map((slot) =>
          slot.id === slotId
            ? {
                ...slot,
                thumbnailUrl: mediaItem?.url ?? slot.thumbnailUrl,
                // Dropping media onto a slot always replaces its cover --
                // never appends into a carousel -- so the count resets to 1.
                assetCount: 1,
              }
            : slot,
        ),
      })),
    );

    startTransition(async () => {
      try {
        const result = await placeMediaInSlot(projectId, slotId, mediaAssetId);
        if (result?.postId) {
          setOverrideRows((current) =>
            (current ?? []).map((row) => ({
              ...row,
              slots: row.slots.map((slot) =>
                slot.id === slotId ? { ...slot, postId: result.postId } : slot,
              ),
            })),
          );
        }
      } catch (error) {
        console.error("Failed to place media in slot:", error);
        setOverrideRows(null);
        router.refresh();
      }
    });
  }

  return (
    <DndContext
      id={`grid-dnd-${projectId}`}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveMedia(null);
        setActiveSlot(null);
      }}
    >
      <div className="flex flex-col gap-10 lg:flex-row">
        <div className="w-full lg:w-72 lg:shrink-0">
          <BrandPanel
            projectName={projectName}
            brandNotes={brandNotes}
            contentPillars={contentPillars}
            igUsername={igUsername}
            igDisplayName={igDisplayName}
            igBio={igBio}
            websiteUrl={websiteUrl}
            industry={industry}
            platform={platform}
            profilePhotoUrl={profilePhotoUrl}
            postsPerWeek={postsPerWeek}
            storiesPerWeek={storiesPerWeek}
            reelsPerWeek={reelsPerWeek}
            newsletterPerWeek={newsletterPerWeek}
          />
        </div>

        <div className="flex flex-1 flex-col" style={{ gap: "2px" }}>
          <SortableContext items={flatSlotIds} strategy={rectSortingStrategy}>
            {effectiveRows.map((row) => (
              <GridRow key={row.id} row={row} projectId={projectId} canManage={canManage} />
            ))}
          </SortableContext>
          {effectiveRows.length === 0 && (
            <p className="text-sm text-muted">No rows yet — add one to start building the feed.</p>
          )}
          <div className="mt-2 flex items-center gap-2">
            {effectiveRows.length > 0 && (
              <a
                href={`/projects/${projectId}/grid/export`}
                download
                className="flex-1 rounded-none bg-foreground px-4 py-3 text-center text-xs tracking-wide uppercase text-background transition-colors duration-150 hover:bg-black/85"
              >
                Export Full Feed
              </a>
            )}
            {canManage && (
              <form action={addGridRow.bind(null, projectId)} className="flex-1">
                <button
                  type="submit"
                  className="w-full rounded-none bg-foreground px-4 py-3 text-xs tracking-wide uppercase text-background transition-colors duration-150 hover:bg-black/85"
                >
                  Add New Post
                </button>
              </form>
            )}
          </div>
        </div>

        {canManage && (
          <div className="w-full lg:w-64 lg:shrink-0">
            <MediaLibrary projectId={projectId} items={mediaLibrary} />
          </div>
        )}
      </div>

      {/*
        No drop animation: the optimistic state already renders the
        destination slot with its final content the instant the drag ends,
        so animating this ghost preview back into place would just overlap
        that real content for the animation's duration -- at a mismatched
        size, since this fixed-size preview never matches the actual
        (responsive) slot dimensions. Looks exactly like a duplicated post
        for that window. Disappearing immediately removes that overlap.
      */}
      <DragOverlay dropAnimation={null}>
        {activeMedia && (
          <div className="aspect-square w-24 cursor-grabbing overflow-hidden rounded border border-foreground/20 shadow-[0_2px_10px_rgba(0,0,0,0.1)]">
            <MediaThumbPreview item={activeMedia} />
          </div>
        )}
        {activeSlot && (
          <div className="aspect-[4/5] w-28 cursor-grabbing overflow-hidden rounded border border-foreground/20 shadow-[0_2px_10px_rgba(0,0,0,0.1)]">
            {activeSlot.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeSlot.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function GridRow({
  row,
  projectId,
  canManage,
}: {
  row: GridBoardRow;
  projectId: string;
  canManage: boolean;
}) {
  return (
    <div className="group relative grid grid-cols-3" style={{ gap: "2px" }}>
      {row.slots.map((slot) => (
        <GridSlot key={slot.id} slot={slot} projectId={projectId} canManage={canManage} />
      ))}
      {canManage && (
        <form
          action={removeGridRow.bind(null, projectId, row.id)}
          className="absolute -right-6 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <button
            type="submit"
            title="Remove row"
            className="text-xs text-error hover:underline"
          >
            X
          </button>
        </form>
      )}
    </div>
  );
}

function GridSlot({
  slot,
  projectId,
  canManage,
}: {
  slot: GridBoardSlot;
  projectId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isOver, isDragging } =
    useSortable({
      id: slot.id,
      data: { type: "slot", slotId: slot.id, slot },
      // Boolean `disabled` disables both drag AND drop in dnd-kit — pass the object
      // form so empty/view-only slots stay valid *drop* targets, just not pick-uppable.
      disabled: { draggable: !slot.postId || !canManage, droppable: !canManage },
      transition: SORTABLE_TRANSITION,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const [cropMode, setCropMode] = useState(false);
  const [contentMenuOpen, setContentMenuOpen] = useState(false);
  const contentMenuRef = useOutsideClick<HTMLDivElement>(contentMenuOpen, () => setContentMenuOpen(false));
  const [, startDeleteTransition] = useTransition();
  const [prevSlot, setPrevSlot] = useState(slot);
  const [overrideTransform, setOverrideTransform] = useState<GridCoverTransform | null | undefined>(
    undefined,
  );
  if (slot !== prevSlot) {
    setPrevSlot(slot);
    setOverrideTransform(undefined);
  }
  const effectiveTransform = overrideTransform !== undefined ? overrideTransform : slot.coverTransform;

  // dnd-kit's PointerSensor listens on this same element, and its pointerdown
  // handling suppresses the browser's native "dblclick" synthesis -- so
  // single-vs-double click is disambiguated manually here (via elapsed time
  // between "click" events) rather than relying on onDoubleClick.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastClickAtRef = useRef(0);

  function handleClick() {
    if (!slot.postId) return;
    const now = Date.now();
    const isDoubleClick = now - lastClickAtRef.current < DOUBLE_CLICK_WINDOW_MS;
    lastClickAtRef.current = now;

    if (isDoubleClick) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      if (canManage && slot.thumbnailUrl) setCropMode(true);
      return;
    }

    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      router.push(`/projects/${projectId}/posts/${slot.postId}`);
    }, DOUBLE_CLICK_WINDOW_MS);
  }

  async function handleSaveCrop(next: GridCoverTransform) {
    setOverrideTransform(next);
    setCropMode(false);
    try {
      await updateSlotCoverTransform(projectId, slot.id, next);
    } catch (error) {
      console.error("Failed to save crop:", error);
      setOverrideTransform(undefined);
      router.refresh();
    }
  }

  function handleDeletePost() {
    if (!slot.postId) return;
    setContentMenuOpen(false);
    if (!confirm("Delete this post? This can't be undone.")) return;
    startDeleteTransition(async () => {
      await deletePost(projectId, slot.postId!);
      router.refresh();
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(slot.postId && canManage ? { ...attributes, ...listeners } : {})}
      role={slot.postId ? "button" : undefined}
      tabIndex={slot.postId ? 0 : undefined}
      onClick={slot.postId ? handleClick : undefined}
      className={`relative flex aspect-[4/5] items-center justify-center border transition-[outline-color,border-color] duration-150 ${
        cropMode ? "" : "overflow-hidden"
      } ${
        slot.postId && canManage ? "cursor-grab touch-none" : slot.postId ? "cursor-pointer" : ""
      } ${
        slot.thumbnailUrl ? "border-border hover:border-foreground/30" : "border-dashed border-border"
      } ${
        isDragging ? "opacity-30" : ""
      } ${
        isOver
          ? "outline outline-1 outline-offset-[-1px] outline-foreground"
          : "outline outline-1 outline-offset-[-1px] outline-transparent"
      }`}
    >
      {slot.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={slot.thumbnailUrl}
          src={slot.thumbnailUrl}
          alt=""
          className="h-full w-full animate-settle-in object-cover"
          draggable={false}
          style={coverTransformStyle(effectiveTransform)}
        />
      ) : (
        <span className="text-xs tracking-wide text-muted uppercase">Empty</span>
      )}
      {slot.assetCount > 1 && (
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
          {slot.assetCount}
        </span>
      )}
      {canManage && (
        <div ref={contentMenuRef} className="absolute right-1 top-1 z-10">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (slot.postId) setContentMenuOpen((v) => !v);
            }}
            title={slot.postId ? "Post options" : undefined}
            className={`rounded px-1 transition-colors duration-150 ${
              slot.postId ? "text-muted hover:bg-black/[.06] hover:text-foreground" : "text-muted/40"
            }`}
          >
            ⋮
          </button>
          {contentMenuOpen && slot.postId && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-6 w-36 rounded-none border border-border bg-background p-1 shadow-lg"
            >
              <button
                type="button"
                onClick={() => {
                  setContentMenuOpen(false);
                  router.push(`/projects/${projectId}/posts/${slot.postId}`);
                }}
                className="w-full rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
              >
                Edit Content
              </button>
              <button
                type="button"
                onClick={handleDeletePost}
                className="w-full rounded px-2 py-1 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05]"
              >
                Delete Content
              </button>
            </div>
          )}
        </div>
      )}
      {cropMode && slot.thumbnailUrl && (
        <GridCropOverlay
          imageUrl={slot.thumbnailUrl}
          initialTransform={effectiveTransform}
          onSave={handleSaveCrop}
          onCancel={() => setCropMode(false)}
        />
      )}
    </div>
  );
}
