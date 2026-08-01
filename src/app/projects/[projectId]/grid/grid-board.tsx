"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { addGridRow, removeGridRow, placeMediaInSlot } from "@/lib/actions/grid";
import { MediaLibrary } from "./media-library";
import { BrandPanel } from "./brand-panel";
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const mediaAssetId = event.active.data.current?.mediaAssetId as string | undefined;
    const slotId = event.over?.data.current?.slotId as string | undefined;
    if (!mediaAssetId || !slotId) return;

    startTransition(async () => {
      await placeMediaInSlot(projectId, slotId, mediaAssetId);
      router.refresh();
    });
  }

  return (
    <DndContext id={`grid-dnd-${projectId}`} sensors={sensors} onDragEnd={handleDragEnd}>
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
          {rows.map((row) => (
            <GridRow key={row.id} row={row} projectId={projectId} canManage={canManage} />
          ))}
          {rows.length === 0 && (
            <p className="text-sm text-muted">No rows yet — add one to start building the feed.</p>
          )}
          {canManage && (
            <form action={addGridRow.bind(null, projectId)} className="mt-2">
              <button
                type="submit"
                className="rounded-md border border-border px-4 py-2 text-xs tracking-wide uppercase hover:border-foreground/30"
              >
                + Add row
              </button>
            </form>
          )}
        </div>

        {canManage && (
          <div className="w-full lg:w-64 lg:shrink-0">
            <MediaLibrary projectId={projectId} items={mediaLibrary} />
          </div>
        )}
      </div>
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
    <div className="group relative grid grid-cols-3 gap-1">
      {row.slots.map((slot) => (
        <GridSlot key={slot.id} slot={slot} projectId={projectId} />
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

function GridSlot({ slot, projectId }: { slot: GridBoardSlot; projectId: string }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `slot-${slot.id}`,
    data: { slotId: slot.id },
  });

  const content = (
    <div
      ref={setNodeRef}
      className={`relative flex aspect-[4/5] items-center justify-center overflow-hidden border ${
        slot.thumbnailUrl ? "border-border" : "border-dashed border-border"
      } ${isOver ? "outline outline-1 outline-offset-[-1px] outline-foreground" : ""}`}
    >
      {slot.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slot.thumbnailUrl} alt="" className="h-full w-full object-cover" />
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
