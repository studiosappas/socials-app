"use client";

import { useState, useTransition } from "react";
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
import { addGridRow, removeGridRow, placeMediaInSlot, reorderGridPosts } from "@/lib/actions/grid";
import { MediaLibrary, MediaThumbPreview } from "./media-library";
import { BrandPanel } from "./brand-panel";
import { DROP_ANIMATION, SORTABLE_TRANSITION } from "@/lib/dnd-motion";
import type { MediaType, Platform } from "@/types/database";

export type MediaLibraryItem = { id: string; url: string | null; mediaType: MediaType };
export type GridBoardSlot = {
  id: string;
  postId: string | null;
  thumbnailUrl: string | null;
  assetCount: number;
};
export type GridBoardRow = { id: string; slots: GridBoardSlot[] };

export function GridBoard({
  projectId,
  projectName,
  brandNotes,
  platform,
  igUsername,
  igDisplayName,
  igBio,
  igPostsCount,
  igFollowersCount,
  igFollowingCount,
  igWebsiteLink,
  igHandle,
  profilePhotoUrl,
  showScheduledDates,
  postsCount,
  rows,
  mediaLibrary,
  canManage,
}: {
  projectId: string;
  projectName: string;
  brandNotes: string;
  platform: Platform;
  igUsername: string;
  igDisplayName: string;
  igBio: string;
  igPostsCount: number;
  igFollowersCount: number;
  igFollowingCount: number;
  igWebsiteLink: string;
  igHandle: string;
  profilePhotoUrl: string | null;
  showScheduledDates: boolean;
  postsCount: number;
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
            const newPostId = postIdBySlotId.get(slot.id) ?? slot.postId;
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

      startTransition(async () => {
        await reorderGridPosts(projectId, updates);
        router.refresh();
      });
      return;
    }

    const mediaAssetId = activeData?.mediaAssetId as string | undefined;
    const slotId = (over.data.current?.slotId as string | undefined) ?? (over.id as string);
    if (!mediaAssetId || !slotId) return;

    startTransition(async () => {
      await placeMediaInSlot(projectId, slotId, mediaAssetId);
      router.refresh();
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
        <div className="w-full lg:w-56 lg:shrink-0">
          <BrandPanel
            projectId={projectId}
            projectName={projectName}
            brandNotes={brandNotes}
            platform={platform}
            igUsername={igUsername}
            igDisplayName={igDisplayName}
            igBio={igBio}
            igPostsCount={igPostsCount}
            igFollowersCount={igFollowersCount}
            igFollowingCount={igFollowingCount}
            igWebsiteLink={igWebsiteLink}
            igHandle={igHandle}
            profilePhotoUrl={profilePhotoUrl}
            showScheduledDates={showScheduledDates}
            postsCount={postsCount}
            canManage={canManage}
          />
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <SortableContext items={flatSlotIds} strategy={rectSortingStrategy}>
            {effectiveRows.map((row) => (
              <GridRow key={row.id} row={row} projectId={projectId} canManage={canManage} />
            ))}
          </SortableContext>
          {effectiveRows.length === 0 && (
            <p className="text-sm text-muted">No rows yet — add one to start building the feed.</p>
          )}
          <div className="mt-2 flex items-center gap-2">
            {canManage && (
              <form action={addGridRow.bind(null, projectId)}>
                <button
                  type="submit"
                  className="rounded-md border border-border px-4 py-2 text-xs tracking-wide uppercase hover:border-foreground/30"
                >
                  + Add row
                </button>
              </form>
            )}
            {effectiveRows.length > 0 && (
              <a
                href={`/projects/${projectId}/grid/export`}
                download
                className="rounded-md border border-border px-4 py-2 text-xs tracking-wide uppercase hover:border-foreground/30"
              >
                Export grid
              </a>
            )}
          </div>
        </div>

        {canManage && (
          <div className="w-full lg:w-64 lg:shrink-0">
            <MediaLibrary projectId={projectId} items={mediaLibrary} />
          </div>
        )}
      </div>

      <DragOverlay dropAnimation={DROP_ANIMATION}>
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
    <div className="group relative grid grid-cols-3 gap-[2px]">
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
            ✕
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

  const content = (
    <div
      ref={setNodeRef}
      style={style}
      {...(slot.postId && canManage ? { ...attributes, ...listeners } : {})}
      className={`relative flex aspect-[4/5] items-center justify-center overflow-hidden border transition-[outline-color,border-color] duration-150 ${
        slot.postId && canManage ? "cursor-grab touch-none" : ""
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
        />
      ) : (
        <span className="text-xs tracking-wide text-muted uppercase">Empty</span>
      )}
      {slot.assetCount > 1 && (
        <span className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
          {slot.assetCount}
        </span>
      )}
    </div>
  );

  if (slot.postId) {
    return (
      <Link href={`/projects/${projectId}/posts/${slot.postId}`} className="block">
        {content}
      </Link>
    );
  }

  return content;
}
