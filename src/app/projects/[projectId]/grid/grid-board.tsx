"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
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
  updatePostCoverTransform,
} from "@/lib/actions/grid";
import { deletePost } from "@/lib/actions/posts";
import { saveRegeneratedPoster } from "@/lib/actions/media";
import { MediaLibrary, MediaThumbPreview } from "./media-library";
import { BrandPanel } from "./brand-panel";
import { GridCropOverlay, coverTransformStyle } from "./grid-crop-overlay";
import { SORTABLE_TRANSITION } from "@/lib/dnd-motion";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { useUndoStack, useUndoRedoShortcuts, type UndoableCommand } from "@/lib/hooks/use-undo-stack";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteMedia, uploadMedia } from "@/lib/actions/grid";
import { generatePosterFromVideoUrl, uploadFilesWithPosters } from "@/lib/video-poster";
import { ShareMenuButton } from "../share-menu";
import { createShareLink } from "@/lib/actions/share-links";
import type { ShareLinkItem } from "@/lib/data/share-links";
import { Toast } from "@/components/ui/toast";
import type { MediaType, Platform } from "@/types/database";

const DOUBLE_CLICK_WINDOW_MS = 220;

export function UndoIcon({ redo = false }: { redo?: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      className={redo ? "-scale-x-100" : ""}
    >
      <path
        d="M4 5H9.5C11.4 5 13 6.6 13 8.5C13 10.4 11.4 12 9.5 12H6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6 2.5L3 5L6 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 2.5V12.5M2.5 7.5H12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

// Same glyph as Task Management's Auto-source badge (task-row.tsx's
// CalendarIcon) -- one consistent "this is scheduled" visual language
// across the app rather than a second calendar icon shape.
function ScheduledIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export type MediaLibraryItem = {
  id: string;
  url: string | null;
  mediaType: MediaType;
  // Optional because posts.ts/stories.ts build their own lighter-weight
  // MediaLibraryItem-shaped picker lists that never needed these -- only
  // Grid's own page.tsx populates them, to let an undone delete/upload be
  // restored without re-uploading (see restoreMediaAsset).
  storagePath?: string;
  posterStoragePath?: string | null;
  // True when this asset already appears in some OTHER carousel post in the
  // project -- purely informational (see the badge on MediaThumbPreview),
  // never blocks picking it again.
  usedInCarousel?: boolean;
  // Optional for the same reason as storagePath/posterStoragePath above --
  // only Grid's own page.tsx populates it. null/undefined both mean
  // "unfoldered," shown in the library's root view.
  folderId?: string | null;
};
export type MediaFolder = { id: string; name: string };
export type GridCoverTransform = { scale: number; x: number; y: number };
export type GridBoardSlot = {
  id: string;
  postId: string | null;
  thumbnailUrl: string | null;
  coverMediaType: "image" | "video" | null;
  coverMediaAssetId: string | null;
  coverOriginalUrl: string | null;
  assetCount: number;
  coverTransform: GridCoverTransform | null;
  scheduledDate: string | null;
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
  instagramUrl,
  tiktokUrl,
  rows,
  mediaLibrary,
  mediaFolders,
  canManage,
  shareLinks,
  shareTableMissing,
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
  instagramUrl: string;
  tiktokUrl: string;
  rows: GridBoardRow[];
  mediaLibrary: MediaLibraryItem[];
  mediaFolders: MediaFolder[];
  canManage: boolean;
  shareLinks: ShareLinkItem[];
  shareTableMissing: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeMedia, setActiveMedia] = useState<MediaLibraryItem | null>(null);
  const [activeSlot, setActiveSlot] = useState<GridBoardSlot | null>(null);
  // Mobile has no room to keep the media library visible alongside the grid
  // (and dragging between two things that can't both be on-screen doesn't
  // work), so tapping an empty slot opens this picker instead -- the
  // touch-friendly equivalent of dragging from the sidebar.
  const [pickerSlotId, setPickerSlotId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const { push: pushCommand, undo, redo, canUndo, canRedo, isBusy: undoRedoBusy } = useUndoStack();
  useUndoRedoShortcuts(undo, redo);

  // Share for Review: selecting posts happens inline on the grid itself
  // (same multi-select-circle pattern as Media Library) instead of in a
  // separate picker dialog. selectedPostIds is keyed by post id, not slot
  // id, since that's what createShareLink actually needs.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());
  const [sharing, startSharing] = useTransition();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function handleToggleSelectPost(postId: string) {
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  function handleCancelSelection() {
    setSelectionMode(false);
    setSelectedPostIds(new Set());
  }

  function handleShareForReview() {
    const ids = Array.from(selectedPostIds);
    if (ids.length === 0) return;
    startSharing(async () => {
      const formData = new FormData();
      for (const id of ids) formData.append("post_ids", id);
      const result = await createShareLink(projectId, undefined, formData);
      if (result?.success && result.token) {
        const url = `${window.location.origin}/preview/${result.token}`;
        await navigator.clipboard.writeText(url);
        setToastMessage("Review link copied to clipboard");
        setTimeout(() => setToastMessage(null), 2500);
        handleCancelSelection();
        router.refresh();
      } else {
        setToastMessage(result?.message ?? "Couldn't create the review link.");
        setTimeout(() => setToastMessage(null), 3000);
      }
    });
  }

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
      const postInfoByPostId = new Map<
        string,
        {
          thumbnailUrl: string | null;
          coverMediaType: "image" | "video" | null;
          assetCount: number;
          coverTransform: GridCoverTransform | null;
        }
      >();
      for (const slot of flatSlots) {
        if (slot.postId) {
          postInfoByPostId.set(slot.postId, {
            thumbnailUrl: slot.thumbnailUrl,
            coverMediaType: slot.coverMediaType,
            assetCount: slot.assetCount,
            coverTransform: slot.coverTransform,
          });
        }
      }
      const beforeRows = effectiveRows;
      const afterRows = effectiveRows.map((row) => ({
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
            coverMediaType: info?.coverMediaType ?? null,
            assetCount: info?.assetCount ?? 0,
            // The post's own crop travels with it immediately in the
            // optimistic update too, not just after the next refresh --
            // this is what makes "the image looks exactly the same after
            // being moved" true from the very first frame of the move.
            coverTransform: info?.coverTransform ?? null,
          };
        }),
      }));
      setOverrideRows(afterRows);

      // Lossless round-trip: the inverse mapping is just each changed
      // slot's OLD postId at the same index, so undo/redo can replay either
      // direction exactly via the same RPC used for the original move.
      const inverseUpdates = updates.map(({ slotId }) => ({
        slotId,
        postId: oldPostIds[flatSlotIds.indexOf(slotId)],
      }));

      async function applyReorder(rowsSnapshot: GridBoardRow[], serverUpdates: typeof updates) {
        setOverrideRows(rowsSnapshot);
        try {
          await reorderGridPosts(serverUpdates);
        } catch (error) {
          console.error("Failed to save grid reorder:", error);
          setOverrideRows(null);
          router.refresh();
        }
      }

      pushCommand({
        label: "Move post",
        undo: () => applyReorder(beforeRows, inverseUpdates),
        redo: () => applyReorder(afterRows, updates),
      });

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
    assignMediaToSlot(slotId, mediaAssetId, mediaItem);
  }

  // Applies the same optimistic shape used by the original assign, reused
  // by both the live drop and this command's own redo.
  function applyAssignOptimistic(slotId: string, mediaAssetId: string, mediaItem: MediaLibraryItem | undefined) {
    setOverrideRows((current) =>
      (current ?? effectiveRows).map((row) => ({
        ...row,
        slots: row.slots.map((slot) =>
          slot.id === slotId
            ? {
                ...slot,
                // A dropped video's own URL points at the raw video file,
                // not a poster -- can't show that in an <img>, so leave the
                // thumbnail empty (falls back to the "Video" placeholder)
                // until the real poster comes back from the next refresh.
                thumbnailUrl: mediaItem?.mediaType === "video" ? null : (mediaItem?.url ?? slot.thumbnailUrl),
                coverMediaType: mediaItem?.mediaType ?? slot.coverMediaType,
                coverMediaAssetId: mediaAssetId,
                // Dropping media onto a slot always replaces its cover --
                // never appends into a carousel -- so the count resets to 1
                // and any crop from whatever was previously here doesn't apply.
                assetCount: 1,
                coverTransform: null,
              }
            : slot,
        ),
      })),
    );
  }

  // Shared by drag-and-drop (desktop/pointer) and the tap-to-pick dialog
  // (mobile/touch) -- both end up assigning the same media item to the same
  // slot, just via a different input gesture.
  function assignMediaToSlot(slotId: string, mediaAssetId: string, mediaItem: MediaLibraryItem | undefined) {
    // Snapshot the pre-mutation slot so this action becomes undoable -- this
    // is what "undo" restores. Only the single cover asset/crop is
    // preserved (matching placeMediaInSlot's own always-single-asset-replace
    // behavior); if the slot previously held a multi-asset carousel, undo
    // brings back just its cover, not the other carousel assets.
    const beforeSlot = effectiveRows.flatMap((row) => row.slots).find((s) => s.id === slotId) ?? null;

    applyAssignOptimistic(slotId, mediaAssetId, mediaItem);

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

        if (beforeSlot) {
          const createdPostId = result?.postId ?? null;
          pushCommand({
            label: "Replace media",
            undo: async () => {
              if (!beforeSlot.postId) {
                // Slot was empty before -- undo just removes the post this
                // assignment created.
                if (createdPostId) await deletePost(projectId, createdPostId);
              } else if (beforeSlot.coverMediaAssetId) {
                // Slot already had a post -- restore its previous cover
                // asset and crop onto that same post.
                await placeMediaInSlot(projectId, slotId, beforeSlot.coverMediaAssetId);
                await updatePostCoverTransform(projectId, beforeSlot.postId, beforeSlot.coverTransform);
              }
              setOverrideRows((current) =>
                (current ?? []).map((row) => ({
                  ...row,
                  slots: row.slots.map((slot) => (slot.id === slotId ? { ...beforeSlot } : slot)),
                })),
              );
              router.refresh();
            },
            redo: async () => {
              applyAssignOptimistic(slotId, mediaAssetId, mediaItem);
              const redoResult = await placeMediaInSlot(projectId, slotId, mediaAssetId);
              if (redoResult?.postId) {
                setOverrideRows((current) =>
                  (current ?? []).map((row) => ({
                    ...row,
                    slots: row.slots.map((slot) =>
                      slot.id === slotId ? { ...slot, postId: redoResult.postId } : slot,
                    ),
                  })),
                );
              }
              if (mediaItem?.mediaType === "video") router.refresh();
            },
          });
        }

        // The optimistic state above can't know a video's resolved poster
        // URL (only the server-side isolated query in grid-data.ts can) --
        // a video assignment leaves thumbnailUrl deliberately null/"Video"
        // placeholder until this refresh brings back the real poster.
        if (mediaItem?.mediaType === "video") {
          router.refresh();
        }
      } catch (error) {
        console.error("Failed to place media in slot:", error);
        setOverrideRows(null);
        router.refresh();
      }
    });
  }

  function handlePickMedia(item: MediaLibraryItem) {
    if (!pickerSlotId) return;
    assignMediaToSlot(pickerSlotId, item.id, item);
    setPickerSlotId(null);
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
            instagramUrl={instagramUrl}
            tiktokUrl={tiktokUrl}
            profilePhotoUrl={profilePhotoUrl}
            postsPerWeek={postsPerWeek}
            storiesPerWeek={storiesPerWeek}
            reelsPerWeek={reelsPerWeek}
            newsletterPerWeek={newsletterPerWeek}
          />
        </div>

        <div className="flex flex-1 flex-col" style={{ gap: "2px" }}>
          {canManage && (
            <div className="mb-2 flex items-center justify-between gap-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => undo()}
                  disabled={!canUndo || undoRedoBusy}
                  title="Undo (⌘Z)"
                  className="rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <UndoIcon />
                </button>
                <button
                  type="button"
                  onClick={() => redo()}
                  disabled={!canRedo || undoRedoBusy}
                  title="Redo (⌘⇧Z)"
                  className="rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <UndoIcon redo />
                </button>
              </div>
              <div className="flex items-center gap-1">
                {effectiveRows.length > 0 && (
                  <ShareMenuButton
                    projectId={projectId}
                    links={shareLinks}
                    canManage={canManage}
                    tableMissing={shareTableMissing}
                    onEnterSelectionMode={() => setSelectionMode(true)}
                    exportLinks={[
                      { href: `/projects/${projectId}/grid/export`, label: "Export Full Feed" },
                      {
                        href: `/projects/${projectId}/grid/export-pdf`,
                        label: "Export Client PDF",
                        title: "Export a clean PDF of every post + its details, for client review",
                      },
                    ]}
                  />
                )}
                <form action={addGridRow.bind(null, projectId)}>
                  <button
                    type="submit"
                    title="Add New Post"
                    className="rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
                  >
                    <PlusIcon />
                  </button>
                </form>
              </div>
            </div>
          )}
          <SortableContext items={flatSlotIds} strategy={rectSortingStrategy}>
            {effectiveRows.map((row) => (
              <GridRow
                key={row.id}
                row={row}
                projectId={projectId}
                canManage={canManage}
                onOpenPicker={setPickerSlotId}
                pushCommand={pushCommand}
                selectionMode={selectionMode}
                selectedPostIds={selectedPostIds}
                onToggleSelectPost={handleToggleSelectPost}
              />
            ))}
          </SortableContext>
          {effectiveRows.length === 0 && (
            <p className="text-sm text-muted">No rows yet — add one to start building the feed.</p>
          )}
        </div>

        {canManage && (
          // The sidebar library needs to be visible alongside the grid for
          // drag-and-drop to make sense, which only fits once there's room
          // for both side by side -- below that, tapping an empty slot
          // opens MediaPickerDialog instead (also has its own upload entry
          // point, so nothing is lost on mobile).
          <div className="hidden lg:block lg:w-64 lg:shrink-0">
            <MediaLibrary projectId={projectId} items={mediaLibrary} folders={mediaFolders} pushCommand={pushCommand} />
          </div>
        )}
      </div>

      {canManage && (
        <MediaPickerDialog
          projectId={projectId}
          open={pickerSlotId !== null}
          onClose={() => setPickerSlotId(null)}
          items={mediaLibrary}
          onSelect={handlePickMedia}
        />
      )}

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

      {selectionMode && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-center gap-3 border-t border-border bg-background px-4 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          <span className="text-xs tracking-wide text-muted uppercase">
            {selectedPostIds.size} selected
          </span>
          <Button type="button" variant="secondary" radius="none" onClick={handleCancelSelection}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            radius="none"
            onClick={handleShareForReview}
            disabled={selectedPostIds.size === 0 || sharing}
          >
            {sharing ? "Sharing…" : "Share for Review"}
          </Button>
        </div>
      )}
      <Toast message={toastMessage} />
    </DndContext>
  );
}

function GridRow({
  row,
  projectId,
  canManage,
  onOpenPicker,
  pushCommand,
  selectionMode,
  selectedPostIds,
  onToggleSelectPost,
}: {
  row: GridBoardRow;
  projectId: string;
  canManage: boolean;
  onOpenPicker: (slotId: string) => void;
  pushCommand: (command: UndoableCommand) => void;
  selectionMode: boolean;
  selectedPostIds: Set<string>;
  onToggleSelectPost: (postId: string) => void;
}) {
  // No dedicated "remove row" bar between rows -- the grid stays tight like
  // desktop, and "Remove Row" lives in each slot's own ⋮ menu instead.
  return (
    <div className="grid grid-cols-3" style={{ gap: "2px" }}>
      {row.slots.map((slot) => (
        <GridSlot
          key={slot.id}
          slot={slot}
          rowId={row.id}
          projectId={projectId}
          canManage={canManage}
          onOpenPicker={onOpenPicker}
          pushCommand={pushCommand}
          selectionMode={selectionMode}
          selected={slot.postId ? selectedPostIds.has(slot.postId) : false}
          onToggleSelectPost={onToggleSelectPost}
        />
      ))}
    </div>
  );
}

function GridSlot({
  slot,
  rowId,
  projectId,
  canManage,
  onOpenPicker,
  pushCommand,
  selectionMode,
  selected,
  onToggleSelectPost,
}: {
  slot: GridBoardSlot;
  rowId: string;
  projectId: string;
  canManage: boolean;
  onOpenPicker: (slotId: string) => void;
  pushCommand: (command: UndoableCommand) => void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelectPost: (postId: string) => void;
}) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isOver, isDragging } =
    useSortable({
      id: slot.id,
      data: { type: "slot", slotId: slot.id, slot },
      // Boolean `disabled` disables both drag AND drop in dnd-kit — pass the object
      // form so empty/view-only slots stay valid *drop* targets, just not pick-uppable.
      // Also disabled while selecting for Review, so a drag gesture never
      // fights with the tap-to-select interaction.
      disabled: { draggable: !slot.postId || !canManage || selectionMode, droppable: !canManage || selectionMode },
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

  // Self-heals a video cover that's missing its poster (upload-time capture
  // can fail for some codecs/timeouts -- see video-poster.ts) instead of
  // leaving the "▶ Video" text placeholder up until someone happens to open
  // the ⋮ menu and click "Regenerate Poster" manually. Runs once per slot
  // per mount; the ref guards against StrictMode's double-invoke and against
  // re-firing on every re-render while the async capture is in flight.
  const autoHealAttemptedRef = useRef(false);
  useEffect(() => {
    if (!canManage) return;
    if (slot.thumbnailUrl || slot.coverMediaType !== "video") return;
    if (!slot.coverMediaAssetId || !slot.coverOriginalUrl) return;
    if (autoHealAttemptedRef.current) return;
    autoHealAttemptedRef.current = true;

    (async () => {
      const posterBlob = await generatePosterFromVideoUrl(slot.coverOriginalUrl!);
      if (!posterBlob) return;
      const formData = new FormData();
      formData.set("poster", new File([posterBlob], "poster.jpg", { type: "image/jpeg" }));
      const result = await saveRegeneratedPoster(projectId, slot.coverMediaAssetId!, formData);
      if (!result.message) router.refresh();
    })();
  }, [canManage, projectId, router, slot.coverMediaAssetId, slot.coverMediaType, slot.coverOriginalUrl, slot.thumbnailUrl]);

  // dnd-kit's PointerSensor listens on this same element, and its pointerdown
  // handling suppresses the browser's native "dblclick" synthesis -- so
  // single-vs-double click is disambiguated manually here (via elapsed time
  // between "click" events) rather than relying on onDoubleClick.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastClickAtRef = useRef(0);

  function handleClick() {
    if (!slot.postId) return;
    if (selectionMode) {
      onToggleSelectPost(slot.postId);
      return;
    }
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
    if (!slot.postId) return;
    const postId = slot.postId;
    const previousTransform = effectiveTransform;
    setOverrideTransform(next);
    setCropMode(false);
    try {
      await updatePostCoverTransform(projectId, postId, next);
      pushCommand({
        label: "Crop",
        undo: async () => {
          setOverrideTransform(previousTransform);
          await updatePostCoverTransform(projectId, postId, previousTransform);
        },
        redo: async () => {
          setOverrideTransform(next);
          await updatePostCoverTransform(projectId, postId, next);
        },
      });
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

  function handleRemoveRow() {
    setContentMenuOpen(false);
    if (!confirm("Remove this row? This can't be undone.")) return;
    startDeleteTransition(async () => {
      await removeGridRow(projectId, rowId);
      router.refresh();
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(slot.postId && canManage ? { ...attributes, ...listeners } : {})}
      role={slot.postId || canManage ? "button" : undefined}
      tabIndex={slot.postId || canManage ? 0 : undefined}
      onClick={slot.postId ? handleClick : canManage ? () => onOpenPicker(slot.id) : undefined}
      className={`relative flex aspect-[4/5] items-center justify-center border transition-[outline-color,border-color] duration-150 ${
        slot.postId && canManage ? "cursor-grab touch-none" : slot.postId || canManage ? "cursor-pointer" : ""
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
      {/* overflow-hidden lives on this inner wrapper (not the slot root) so
          it only ever clips the image -- the ⋮ menu below is a sibling, not
          a descendant, so it can render outside the tile's own bounds
          instead of being cropped by it. */}
      <div className={`absolute inset-0 flex items-center justify-center ${cropMode ? "" : "overflow-hidden"}`}>
        {slot.thumbnailUrl ? (
          // Always a static <img>, even when the cover is a video -- this is
          // the video's poster frame (captured client-side at upload time),
          // never the video file itself. Grid never plays/autoplays video.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={slot.thumbnailUrl}
            src={slot.thumbnailUrl}
            alt=""
            className="h-full w-full animate-settle-in object-cover"
            draggable={false}
            style={coverTransformStyle(effectiveTransform)}
          />
        ) : slot.coverMediaType === "video" ? (
          // A video cover with no poster yet (e.g. uploaded before this
          // feature existed, or poster capture failed) -- still distinct
          // from a truly empty slot.
          <span className="flex flex-col items-center gap-1 text-muted">
            <span className="text-lg leading-none">▶</span>
            <span className="text-xs tracking-wide uppercase">Video</span>
          </span>
        ) : canManage ? (
          <span className="flex flex-col items-center gap-1 text-muted">
            <span className="text-lg leading-none">+</span>
            <span className="text-xs tracking-wide uppercase">Empty</span>
          </span>
        ) : (
          <span className="text-xs tracking-wide text-muted uppercase">Empty</span>
        )}
      </div>
      {slot.coverMediaType === "video" && (
        <span
          title="Video"
          className="absolute bottom-1 left-1 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-[9px] text-white"
        >
          ▶
        </span>
      )}
      {/* Top-left is the one corner not already claimed by the video badge
          (bottom-left), asset count (bottom-right), or the ⋮ menu (top-right)
          -- subtle, informational only, never blocks the slot's own click
          behavior since it's a plain absolutely-positioned span. While
          selecting for Review, the selection circle takes this same corner
          instead -- same "one small badge, top-left" language, just a
          different moment (there's no reason to see the scheduled-date
          badge and the selection circle at once). */}
      {selectionMode && slot.postId ? (
        <span
          title={selected ? "Deselect" : "Select"}
          className="absolute left-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full"
        >
          {selected ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" className="fill-accent" stroke="white" strokeWidth="1" />
              <path d="M4.8 8.2 6.8 10.1 11.2 5.7" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" className="fill-black/30" stroke="white" strokeWidth="1.2" />
            </svg>
          )}
        </span>
      ) : (
        slot.scheduledDate && (
          <span
            title={`Scheduled for ${slot.scheduledDate}`}
            className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-white"
          >
            <ScheduledIcon className="h-2.5 w-2.5" />
          </span>
        )
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
              setContentMenuOpen((v) => !v);
            }}
            title="Slot options"
            className="rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
          >
            ⋮
          </button>
          {contentMenuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-7 w-36 max-w-[calc(100vw-1.5rem)] rounded-none border border-border bg-background p-1 shadow-lg"
            >
              {slot.postId && (
                <button
                  type="button"
                  onClick={() => {
                    setContentMenuOpen(false);
                    router.push(`/projects/${projectId}/posts/${slot.postId}`);
                  }}
                  className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                >
                  Edit Content
                </button>
              )}
              {slot.thumbnailUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setContentMenuOpen(false);
                    setCropMode(true);
                  }}
                  className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                >
                  Crop Image
                </button>
              )}
              {slot.postId && (
                <button
                  type="button"
                  onClick={handleDeletePost}
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05]"
                >
                  Delete Content
                </button>
              )}
              <button
                type="button"
                onClick={handleRemoveRow}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05]"
              >
                Remove Row
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

// Touch-friendly equivalent of dragging a thumbnail from the sidebar
// library onto a slot -- tap an empty slot to open this, tap a thumbnail to
// place it. Also carries its own upload entry point, since the desktop
// sidebar (where uploading normally happens) is hidden below `lg`.
function MediaPickerDialog({
  projectId,
  open,
  onClose,
  items,
  onSelect,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  items: MediaLibraryItem[];
  onSelect: (item: MediaLibraryItem) => void;
}) {
  const [state, action, pending] = useActionState(uploadMedia.bind(null, projectId), undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [, startDeleteTransition] = useTransition();

  function handleDelete(e: React.MouseEvent, mediaAssetId: string) {
    e.stopPropagation();
    if (!confirm("Delete this asset? This removes it from any post or story using it.")) return;
    startDeleteTransition(async () => {
      await deleteMedia(projectId, mediaAssetId);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title="Choose from library" radius="none">
      <div className="flex flex-col gap-4">
        <form ref={formRef} action={action} key={items.length}>
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            accept="image/*,video/*"
            multiple
            required
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) uploadFilesWithPosters(action, files);
            }}
          />
          <Button
            type="button"
            variant="primary"
            radius="none"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending}
            className="w-full py-3 text-xs tracking-wide uppercase"
          >
            {pending ? "Uploading..." : "Upload New Asset"}
          </Button>
          {state?.message && <p className="mt-2 text-xs text-error">{state.message}</p>}
        </form>

        {/* Capped to roughly 9 rows (grid-cols-3, ~155px square cells at
            this dialog's max-w-lg width) but also bounded by 70% of the
            viewport height, since 9 full rows here would be taller than
            most screens -- either limit alone isn't enough: a fixed row
            count can overflow small viewports, and a pure vh cap wouldn't
            read as "about 9 rows" on a typically-sized one. */}
        <div className="grid max-h-[min(1400px,70vh)] grid-cols-3 gap-2 overflow-y-auto">
          {items.map((item) => (
            <div key={item.id} className="relative">
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="aspect-square w-full overflow-hidden border border-border transition-colors duration-150 hover:border-foreground/30"
              >
                <MediaThumbPreview item={item} />
              </button>
              {/* Always visible (not hover-revealed) -- this dialog is the
                  touch-friendly picker, and touch has no hover state. */}
              <button
                type="button"
                onClick={(e) => handleDelete(e, item.id)}
                title="Delete asset"
                className="absolute right-1 top-1 z-10 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white transition-colors duration-150 hover:bg-black/85"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {items.length === 0 && <p className="text-sm text-muted">No media uploaded yet.</p>}
      </div>
    </Dialog>
  );
}
