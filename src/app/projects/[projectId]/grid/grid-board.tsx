"use client";

import { memo, useCallback, useEffect, useReducer, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  addGridRow,
  removeGridRow,
  placeMediaInSlot,
  reorderGridPosts,
  reorderGridRows,
  updatePostCoverTransform,
} from "@/lib/actions/grid";
import { deletePost } from "@/lib/actions/posts";
import { saveRegeneratedPoster } from "@/lib/actions/media";
import { MediaLibrary, MediaThumbPreview } from "./media-library";
import { BrandPanel } from "./brand-panel";
import { CroppedCoverImage, GridCropOverlay } from "./grid-crop-overlay";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { useIsTouchDevice } from "@/lib/hooks/use-is-touch-device";
import { useUndoStack, useUndoRedoShortcuts, type UndoableCommand } from "@/lib/hooks/use-undo-stack";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { generatePosterFromVideoUrl } from "@/lib/video-poster";
import { ShareMenuButton } from "../share-menu";
import { createShareLink } from "@/lib/actions/share-links";
import type { ShareLinkItem } from "@/lib/data/share-links";
import { Toast } from "@/components/ui/toast";
import { useToast } from "@/lib/hooks/use-toast";
import type { MediaType, Platform } from "@/types/database";
import {
  gridReducer,
  initGridState,
  deriveRows,
  newOpId,
  isSlotFilled,
  type GridBoardRow,
  type GridBoardSlot,
  type GridCoverTransform,
} from "./grid-reducer";
import { gridInteractionReducer, initialGridInteractionState } from "./grid-interaction";
import { logGridInteraction, logGridDataEvent } from "./grid-diagnostics";
import { useLibraryItems, type LibraryItemsController } from "./use-library-items";
import { GRID_COVER_ASPECT_CLASS } from "./grid-constants";
// Re-exported so every existing external import (post-editor.tsx, grid/
// page.tsx, lib/data/posts.ts, lib/data/share-preview.ts,
// components/media-gallery.tsx, lib/landing/demo-create.ts,
// grid-crop-overlay.tsx) keeps working unchanged -- grid-board.tsx is still
// the public surface for these types, grid-reducer.ts is just where their
// definitions now live (next to the state machine that produces them).
export type { GridBoardRow, GridBoardSlot, GridCoverTransform };

// GridSlot's single-click Post Editor navigation is deferred by this long,
// giving a following native `dblclick` (the actual double-click arbiter --
// see GridSlot's own handleClick/handleDoubleClick comment) a chance to
// cancel it first. This is no longer trying to itself measure "was that a
// double-click" the way it used to -- it only needs to comfortably outlast
// a real double-click gesture's own two-click span, which live testing
// showed the previous 220ms value did NOT reliably do (WebKit alone showed
// >200ms between two ordinary clicks even at a brisk pace). 400ms is
// comfortably inside typical OS double-click intervals without making a
// genuine single click feel laggy.
const DOUBLE_CLICK_WINDOW_MS = 400;

// Resizable Library sidebar (desktop only -- the sidebar itself is already
// `hidden lg:block`, mobile is untouched). Bounded by the project page's own
// shared `max-w-6xl` container (layout.tsx, used by every /projects/[id]/*
// route -- deliberately not touched here, that's a cross-page decision
// outside this task's scope): at the max width below, the 3-column Grid
// still gets a genuinely usable ~110-130px per tile at that container's
// typical rendered width; MIN keeps a floor close to the previous fixed
// 256px (lg:w-64) so resizing down never regresses below what already
// shipped.
const LIBRARY_WIDTH_MIN = 240;
const LIBRARY_WIDTH_DEFAULT = 320;
const LIBRARY_WIDTH_MAX = 420;
const LIBRARY_WIDTH_STORAGE_KEY = "grid-library-width";

function clampLibraryWidth(px: number): number {
  return Math.min(LIBRARY_WIDTH_MAX, Math.max(LIBRARY_WIDTH_MIN, px));
}

// Upload concurrency now lives in use-library-items.ts, the one shared
// owner of Library item data for both this dialog and the sidebar
// MediaLibrary -- no longer a separate constant here to keep in sync.

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
  // The true original asset's signed URL, always from storage_path -- unlike
  // `url` above, which may prefer a smaller edited preview for display. Only
  // getPostMediaLibrary populates this; Post Editor's add/replace-from-
  // library actions use it (not `url`) for the optimistic asset's download
  // source, so Download resolves to the real original immediately instead
  // of whatever the library happened to show.
  originalUrl?: string | null;
  mediaType: MediaType;
  // Optional because posts.ts/stories.ts build their own lighter-weight
  // MediaLibraryItem-shaped picker lists that never needed these -- only
  // Grid's own page.tsx populates them, to let an undone delete/upload be
  // restored without re-uploading (see restoreMediaAsset).
  storagePath?: string;
  posterStoragePath?: string | null;
  // True when this asset already appears in some OTHER carousel post in the
  // project -- purely informational (see the badge on MediaThumbPreview),
  // never blocks picking it again. Post Editor's own "already reused across
  // carousels" warning; distinct from usedInGrid below.
  usedInCarousel?: boolean;
  // True when this asset already occupies a slot on the Grid (any post
  // type, not just carousels) -- only Grid's own page.tsx populates this;
  // drives the always-visible badge in the Media Library sidebar so it's
  // obvious at a glance which assets are already placed.
  usedInGrid?: boolean;
  // Optional for the same reason as storagePath/posterStoragePath above --
  // only Grid's own page.tsx populates it. null/undefined both mean
  // "unfoldered," shown in the library's root view.
  folderId?: string | null;
  // True only for an optimistic placeholder shown the instant a file is
  // picked, before uploadMedia's insert has actually resolved (see
  // media-library.tsx/grid-board.tsx's MediaPickerDialog, both of which set
  // this on the placeholder and clear it once the real id/storagePath comes
  // back). Never true for a real, already-persisted asset. Consumers gate
  // drag/select/assign on this -- the preview shows immediately, but the
  // asset isn't usable until the upload genuinely lands.
  pending?: boolean;
  // Stable React key across the temp-id -> real-id transition. `id` itself
  // is reassigned in place on reconciliation (the whole point -- see
  // pending's own comment), which would otherwise change this item's own
  // React `key` mid-upload and force an unmount/remount of its tile (losing
  // any in-progress hover/drag state, and contributing to visible
  // flicker/instability during a batch). Set once, at optimistic-placeholder
  // creation time, to the same tempId that never changes for this item's
  // whole lifetime; a persisted-from-the-start item (server-rendered, never
  // went through an optimistic phase) has no need for one and falls back to
  // its own (equally stable) real id.
  clientKey?: string;
};
export type MediaFolder = { id: string; name: string };
// GridCoverTransform/GridBoardSlot/GridBoardRow now live in grid-reducer.ts
// (re-exported here isn't needed -- every other file that wants them
// imports from grid-reducer directly) since that's the file that owns their
// runtime shape via the reducer; keeping the type definitions next to the
// state machine that actually produces/consumes them avoids the two ever
// drifting apart.

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
  demoMode = false,
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
  // Additive, default false -- the real app is byte-for-byte unaffected.
  // Same pattern as media-library.tsx's own demoMode: no-ops every control
  // wired to a real mutating server action (add/remove row, persist a
  // reorder/assign/crop, delete post/media, share links, opening the real
  // Post Editor route) while leaving drag-and-drop's optimistic
  // `overrideRows` visual feedback, folder browsing, and the crop overlay's
  // own pan/zoom fully real and interactive.
  demoMode?: boolean;
}) {
  const router = useRouter();
  const { showError } = useToast();
  const [activeMedia, setActiveMedia] = useState<MediaLibraryItem | null>(null);
  const [activeSlot, setActiveSlot] = useState<GridBoardSlot | null>(null);
  const [activeRow, setActiveRow] = useState<GridBoardRow | null>(null);
  // The single authoritative owner of "what interaction mode is the Grid in
  // right now" -- see grid-interaction.ts for the full reasoning. Replaces
  // this component's own standalone `pickerSlotId` state and GridSlot's own
  // local `cropMode` boolean: both are now just reads of THIS state
  // (`interaction.mode === "library"` / `=== "crop"`), so Library and Crop
  // can no longer be simultaneously true by construction -- the reducer
  // itself rejects a second mode-opening action while one is already
  // active, rather than every call site needing to independently agree not
  // to do that.
  const [interaction, dispatchInteraction] = useReducer(gridInteractionReducer, initialGridInteractionState);
  const pickerSlotId = interaction.mode === "library" ? interaction.pickerTargetSlotId : null;
  const setPickerSlotId = useCallback((slotId: string | null) => {
    if (slotId === null) {
      logGridInteraction("close_library", {});
      dispatchInteraction({ type: "CLOSE_LIBRARY" });
    } else {
      logGridInteraction("open_library", { slotId });
      dispatchInteraction({ type: "OPEN_LIBRARY", slotId });
    }
  }, []);
  // Per-slot booleans (not the raw `interaction` object) are what GridSlot
  // actually receives -- see requestOpenCrop/requestCloseCrop below. A
  // primitive `cropOpen: boolean` prop, computed once per slot right where
  // rows are mapped to <GridRow>, is what lets GridSlot's memo() correctly
  // skip re-rendering every OTHER slot when only one tile's crop state
  // changes (memo compares props by value for primitives, so 29 unchanged
  // `false`s and one changed `true` re-renders exactly one tile) -- passing
  // the whole `interaction` object instead would change reference on every
  // transition and defeat that memo for the entire board.
  const requestOpenCrop = useCallback((slotId: string) => {
    logGridInteraction("open_crop", { slotId });
    dispatchInteraction({ type: "OPEN_CROP", slotId });
  }, []);
  const requestCloseCrop = useCallback(() => {
    logGridInteraction("close_crop", {});
    dispatchInteraction({ type: "CLOSE_CROP" });
  }, []);

  // Touch devices get an explicit "Edit Grid" mode instead of always-on
  // drag -- a bare touch-action:none on every tile (needed so dnd-kit can
  // tell a drag from a scroll) otherwise blocks native vertical scrolling
  // the instant a finger lands on any populated tile. Desktop (fine
  // pointer) never sets isTouchDevice, so dragEnabled is always true there
  // and this whole mode is invisible/unused -- mouse drag behaves exactly
  // as before.
  const isTouchDevice = useIsTouchDevice();
  const [reorderMode, setReorderMode] = useState(false);
  const dragEnabled = !isTouchDevice || reorderMode;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Long-press to start a drag on touch, same as iOS/Google Photos
      // reorder gestures -- lets a quick swipe still scroll even while
      // Edit Grid mode is on, only a deliberate press-and-hold picks up a
      // tile. Desktop keeps the original short distance threshold.
      activationConstraint: isTouchDevice ? { delay: 200, tolerance: 8 } : { distance: 4 },
    }),
  );

  // A row's own bounding box fully CONTAINS its 3 slots' boxes, so without
  // this, plain closestCenter (which only compares droppable CENTERS, not
  // containment) could occasionally resolve a slot-drag's `over` target to
  // the enclosing ROW instead of the specific slot under the pointer near a
  // row boundary -- and vice versa for a row drag hovering close to one of
  // its own slots. Filtering candidates by matching `data.type` first
  // (row-drag -> only row droppables; slot/library-item drag -> only slot
  // droppables, library items carry no `type` at all so they fall in this
  // same bucket) makes the two drag kinds structurally unable to collide,
  // rather than relying on closestCenter to happen to pick right.
  const collisionDetectionStrategy: CollisionDetection = useCallback((args) => {
    const activeType = args.active.data.current?.type;
    const wantRow = activeType === "row";
    const filtered = args.droppableContainers.filter((container) => {
      const containerType = container.data.current?.type;
      return wantRow ? containerType === "row" : containerType !== "row";
    });
    return closestCenter({ ...args, droppableContainers: filtered });
  }, []);

  const { push: pushCommand, undo, redo, canUndo, canRedo, isBusy: undoRedoBusy } = useUndoStack();
  useUndoRedoShortcuts(undo, redo);

  // ONE Library item-data owner, shared by both surfaces that show it (the
  // sidebar MediaLibrary and the touch MediaPickerDialog below) -- see
  // use-library-items.ts's own comment for why this consolidation was
  // required this round, not left as a documented smell: both surfaces are
  // mounted simultaneously regardless of viewport, and an upload made
  // through one was invisible to the other until an unrelated refresh
  // happened to land.
  const libraryController = useLibraryItems(projectId, mediaLibrary, pushCommand, demoMode);

  // Resizable Library sidebar width -- pure client UI preference, not
  // project/database state (see LIBRARY_WIDTH_STORAGE_KEY's own comment
  // for why localStorage, not a server column). Always starts at the
  // static default on both server and first client render (SSR has no
  // localStorage, and reading it during the initial render would mismatch
  // the server-rendered HTML) -- the stored value, if any, is applied via
  // the effect below immediately after mount, matching this codebase's
  // existing dark-mode/preferences pattern for the same SSR-safety reason.
  const [libraryWidth, setLibraryWidth] = useState(LIBRARY_WIDTH_DEFAULT);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LIBRARY_WIDTH_STORAGE_KEY);
      if (stored) {
        const parsed = Number(stored);
        // A one-time read of an external system (localStorage) applied
        // once right after mount, not a state->state sync loop -- same
        // established exception as this codebase's other mount-time
        // preference reads.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Number.isFinite(parsed)) setLibraryWidth(clampLibraryWidth(parsed));
      }
    } catch {
      // Storage can throw in locked-down/private-browsing contexts --
      // the default width is a perfectly fine fallback, never worth
      // failing the page over.
    }
  }, []);
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ startX: 0, startWidth: LIBRARY_WIDTH_DEFAULT });
  const [isResizingLibrary, setIsResizingLibrary] = useState(false);
  const handleResizeHandlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      resizeStartRef.current = { startX: e.clientX, startWidth: libraryWidth };
      setIsResizingLibrary(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [libraryWidth],
  );
  const handleResizeHandlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizingRef.current) return;
    // The handle sits on the Library's LEFT edge (the boundary with the
    // Grid) -- dragging it further left (negative delta) widens the
    // sidebar, dragging it right narrows it, matching the direction a
    // real Adobe-style panel divider moves.
    const delta = e.clientX - resizeStartRef.current.startX;
    setLibraryWidth(clampLibraryWidth(resizeStartRef.current.startWidth - delta));
  }, []);
  const handleResizeHandlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    setIsResizingLibrary(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setLibraryWidth((current) => {
      try {
        window.localStorage.setItem(LIBRARY_WIDTH_STORAGE_KEY, String(current));
      } catch {
        // Same non-fatal reasoning as the read above.
      }
      return current;
    });
  }, []);

  // Share for Review: selecting posts happens inline on the grid itself
  // (same multi-select-circle pattern as Media Library) instead of in a
  // separate picker dialog. selectedPostIds is keyed by post id, not slot
  // id, since that's what createShareLink actually needs.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());
  const [sharing, startSharing] = useTransition();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // useCallback (stable reference, empty deps -- only reads via the
  // functional setState form) so GridSlot's React.memo below actually
  // takes effect for every slot instead of re-rendering all of them
  // whenever GridBoard re-renders for an unrelated reason (e.g. a drag
  // starting elsewhere).
  const handleToggleSelectPost = useCallback((postId: string) => {
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }, []);

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

  // Single authoritative owner of rows/slots -- see grid-reducer.ts for the
  // full reasoning. Replaces the earlier overrideRows/prevRows/
  // pendingMutations trio (and GridSlot's own duplicate overrideTransform/
  // overridePatch/pendingSlotMutations): every mutation below now goes
  // through mutateSlot/mutateSlots/mutateAddRow/mutateRemoveRow, which
  // dispatch narrow BEGIN/COMMIT/FAIL actions scoped to exactly the
  // slot(s)/row it names, instead of any one mutation's failure ever being
  // able to null out (or a stale prop ever being able to blindly replace)
  // every OTHER slot's own not-yet-refreshed state.
  const [gridState, dispatch] = useReducer(gridReducer, rows, initGridState);
  const [prevRowsProp, setPrevRowsProp] = useState(rows);
  if (rows !== prevRowsProp) {
    setPrevRowsProp(rows);
    logGridDataEvent("server_snapshot_received", { rowCount: rows.length });
    dispatch({ type: "SERVER_ROWS_RECEIVED", rows });
  }
  const effectiveRows = deriveRows(gridState);

  // Pure, synchronous, ref-based (never stale mid-callback the way a value
  // captured from React state would be) -- tracks how many Grid mutations
  // are currently between BEGIN and COMMIT/FAIL, for exactly one purpose:
  // deferring router.refresh() until it's genuinely safe. Firing a refresh
  // while something is still pending risks the server's read landing before
  // that pending write's own commit reaches the database, which would make
  // the refreshed snapshot legitimately stale for that one entity -- see
  // grid-reducer.ts's own comment on hasPendingWork for the full race this
  // closes. requestIdleRefresh is the ONLY sanctioned way anything in this
  // file triggers a Grid resync; nothing below calls router.refresh() on
  // its own anymore.
  const pendingOpsRef = useRef(0);
  const deferredRefreshRef = useRef(false);
  const requestIdleRefresh = useCallback(() => {
    if (pendingOpsRef.current === 0) router.refresh();
    else deferredRefreshRef.current = true;
  }, [router]);
  const opBegin = useCallback(() => {
    pendingOpsRef.current += 1;
  }, []);
  const opEnd = useCallback(() => {
    pendingOpsRef.current = Math.max(0, pendingOpsRef.current - 1);
    if (pendingOpsRef.current === 0 && deferredRefreshRef.current) {
      deferredRefreshRef.current = false;
      router.refresh();
    }
  }, [router]);

  // The four mutation primitives every Grid write goes through -- see each
  // action's own comment in grid-reducer.ts for what BEGIN/COMMIT/FAIL mean
  // for it. `run` throwing is the only thing that triggers a FAIL/rollback;
  // callers decide what to tell the user and whether to request a resync,
  // since the right message differs per action (this file previously had
  // that same shape duplicated ad hoc at every call site -- these just give
  // it one place to live, matching "no mutation should invent its own
  // whole-state restore semantics").
  const mutateSlot = useCallback(
    async (slotId: string, optimisticValue: GridBoardSlot, run: () => Promise<Partial<GridBoardSlot> | void>) => {
      const opId = newOpId();
      logGridDataEvent("slot_begin", { opId, slotId });
      dispatch({ type: "SLOT_BEGIN", opId, slotId, value: optimisticValue });
      opBegin();
      try {
        const patch = await run();
        logGridDataEvent("slot_commit", { opId, slotId });
        dispatch({ type: "SLOT_COMMIT", opId, slotId, patch: patch ?? undefined });
        return true;
      } catch (error) {
        console.error("Grid slot mutation failed:", error);
        logGridDataEvent("slot_fail", { opId, slotId });
        dispatch({ type: "SLOT_FAIL", opId, slotId });
        return false;
      } finally {
        opEnd();
      }
    },
    [opBegin, opEnd],
  );
  const mutateSlots = useCallback(
    async (changes: { slotId: string; value: GridBoardSlot }[], run: () => Promise<void>) => {
      const opId = newOpId();
      const slotIds = changes.map((c) => c.slotId);
      logGridDataEvent("slots_begin", { opId, slotIds });
      for (const c of changes) dispatch({ type: "SLOT_BEGIN", opId, slotId: c.slotId, value: c.value });
      opBegin();
      try {
        await run();
        logGridDataEvent("slots_commit", { opId, slotIds });
        for (const c of changes) dispatch({ type: "SLOT_COMMIT", opId, slotId: c.slotId });
        return true;
      } catch (error) {
        console.error("Grid multi-slot mutation failed:", error);
        logGridDataEvent("slots_fail", { opId, slotIds });
        for (const c of changes) dispatch({ type: "SLOT_FAIL", opId, slotId: c.slotId });
        return false;
      } finally {
        opEnd();
      }
    },
    [opBegin, opEnd],
  );
  const mutateAddRow = useCallback(
    async (tempRow: GridBoardRow, run: () => Promise<{ rowId: string; slotIds: string[] }>) => {
      const opId = newOpId();
      logGridDataEvent("row_add_begin", { opId, tempRowId: tempRow.id });
      dispatch({
        type: "ROW_ADD_BEGIN",
        opId,
        tempRowId: tempRow.id,
        clientKey: tempRow.clientKey ?? tempRow.id,
        tempSlots: tempRow.slots,
      });
      opBegin();
      try {
        const { rowId, slotIds } = await run();
        logGridDataEvent("row_add_commit", { opId, tempRowId: tempRow.id, realRowId: rowId });
        dispatch({ type: "ROW_ADD_COMMIT", opId, tempRowId: tempRow.id, realRowId: rowId, realSlotIds: slotIds });
        return true;
      } catch (error) {
        console.error("Failed to add row:", error);
        logGridDataEvent("row_add_fail", { opId, tempRowId: tempRow.id });
        dispatch({ type: "ROW_ADD_FAIL", opId, tempRowId: tempRow.id });
        return false;
      } finally {
        opEnd();
      }
    },
    [opBegin, opEnd],
  );
  const mutateRemoveRow = useCallback(
    async (rowId: string, run: () => Promise<void>) => {
      const opId = newOpId();
      logGridDataEvent("row_remove_begin", { opId, rowId });
      dispatch({ type: "ROW_REMOVE_BEGIN", opId, rowId });
      opBegin();
      try {
        await run();
        logGridDataEvent("row_remove_commit", { opId, rowId });
        dispatch({ type: "ROW_REMOVE_COMMIT", opId, rowId });
        return true;
      } catch (error) {
        console.error("Failed to remove row:", error);
        logGridDataEvent("row_remove_fail", { opId, rowId });
        dispatch({ type: "ROW_REMOVE_FAIL", opId, rowId });
        return false;
      } finally {
        opEnd();
      }
    },
    [opBegin, opEnd],
  );
  // Drag-the-whole-row reorder. Same shape as mutateAddRow/mutateRemoveRow:
  // BEGIN applies the already-permuted `nextRowIds` optimistically, run()
  // persists it, FAIL rolls back to exactly the pre-drag order (never the
  // whole board -- see grid-reducer.ts's ROW_REORDER_* comments).
  const mutateReorderRows = useCallback(
    async (nextRowIds: string[], run: () => Promise<void>) => {
      const opId = newOpId();
      logGridDataEvent("row_reorder_begin", { opId, rowIds: nextRowIds });
      dispatch({ type: "ROW_REORDER_BEGIN", opId, nextRowIds });
      opBegin();
      try {
        await run();
        logGridDataEvent("row_reorder_commit", { opId });
        dispatch({ type: "ROW_REORDER_COMMIT", opId });
        return true;
      } catch (error) {
        console.error("Failed to reorder rows:", error);
        logGridDataEvent("row_reorder_fail", { opId });
        dispatch({ type: "ROW_REORDER_FAIL", opId });
        return false;
      } finally {
        opEnd();
      }
    },
    [opBegin, opEnd],
  );

  // Add Row's own in-flight flag -- separate from the generic pending-op
  // tracking above (that one's ref-based and deliberately invisible to
  // render). This one disables the button itself, so a burst of clicks
  // while the first add is still in flight can't queue up invisible work
  // that all lands at once -- see handleAddRow's comment for the full story.
  const [addRowPending, setAddRowPending] = useState(false);

  const flatSlots = effectiveRows.flatMap((row) => row.slots);
  const flatSlotIds = flatSlots.map((slot) => slot.id);
  const rowSortIds = effectiveRows.map((row) => row.id);

  function handleDragStart(event: DragStartEvent) {
    logGridInteraction("drag_start", { activeId: event.active.id });
    dispatchInteraction({ type: "DRAG_START" });
    const data = event.active.data.current;
    if (data?.type === "row") {
      setActiveRow((data.row as GridBoardRow | undefined) ?? null);
      return;
    }
    if (data?.type === "slot") {
      setActiveSlot((data.slot as GridBoardSlot | undefined) ?? null);
      return;
    }
    setActiveMedia((data?.item as MediaLibraryItem | undefined) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    logGridInteraction("drag_end", { activeId: event.active.id, overId: event.over?.id ?? null });
    dispatchInteraction({ type: "DRAG_END" });
    setActiveMedia(null);
    setActiveSlot(null);
    setActiveRow(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;

    if (activeData?.type === "row") {
      const rowIds = effectiveRows.map((r) => r.id);
      const oldIndex = rowIds.indexOf(active.id as string);
      const newIndex = rowIds.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const nextRowIds = arrayMove(rowIds, oldIndex, newIndex);
      const previousRowIds = rowIds;

      async function applyRowReorder(order: string[]) {
        const ok = await mutateReorderRows(order, async () => {
          // The visual reorder is real and final either way -- demoMode
          // just skips persistence, same convention as every other
          // mutation in this file.
          if (demoMode) return;
          await reorderGridRows(order.map((rowId, i) => ({ rowId, position: i })));
        });
        if (!ok) {
          showError("Couldn't save that row move. Please try again.");
          requestIdleRefresh();
        }
      }

      applyRowReorder(nextRowIds);
      if (demoMode) return;

      pushCommand({
        label: "Reorder row",
        undo: () => applyRowReorder(previousRowIds),
        redo: () => applyRowReorder(nextRowIds),
      });
      return;
    }

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
      // Only the slots that actually changed -- mutateSlots (see its own
      // comment) only ever touches exactly these, never the rest of the
      // board, so an unrelated slot's own in-flight edit elsewhere can never
      // be discarded by this move's own success or failure (Invariant 2).
      const changedSlots: { slotId: string; value: GridBoardSlot }[] = updates.map(({ slotId }) => {
        const slot = flatSlots.find((s) => s.id === slotId)!;
        const newPostId = postIdBySlotId.get(slotId)!;
        const info = newPostId ? postInfoByPostId.get(newPostId) : undefined;
        return {
          slotId,
          value: {
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
          },
        };
      });
      // Each changed slot's own pre-move value -- undo's narrow inverse.
      // NOT a snapshot of the whole board (see grid-reducer.ts's own
      // Invariant 7 comment): undo/redo below only ever re-applies this
      // exact list of slot values, never anything else on the board, so a
      // 4-second-old undo entry can never rewind an unrelated newer edit.
      const inverseSlots = updates.map(({ slotId }) => ({
        slotId,
        value: flatSlots[flatSlotIds.indexOf(slotId)],
      }));
      const inverseUpdates = updates.map(({ slotId }) => ({
        slotId,
        postId: oldPostIds[flatSlotIds.indexOf(slotId)],
      }));

      async function applyReorder(
        changes: typeof changedSlots,
        serverUpdates: typeof updates,
      ) {
        const ok = await mutateSlots(changes, async () => {
          // The visual reorder is real and final either way -- demoMode
          // just skips persistence, same reasoning as every other mutation
          // in this file.
          if (demoMode) return;
          await reorderGridPosts(serverUpdates);
        });
        if (!ok) {
          showError("Couldn't save that move. Please try again.");
          requestIdleRefresh();
        }
      }

      applyReorder(changedSlots, updates);
      if (demoMode) return;

      pushCommand({
        label: "Move post",
        undo: () => applyReorder(inverseSlots, inverseUpdates),
        redo: () => applyReorder(changedSlots, updates),
      });
      return;
    }

    const mediaAssetId = activeData?.mediaAssetId as string | undefined;
    const mediaItem = activeData?.item as MediaLibraryItem | undefined;
    const slotId = (over.data.current?.slotId as string | undefined) ?? (over.id as string);
    if (!mediaAssetId || !slotId) return;
    assignMediaToSlot(slotId, mediaAssetId, mediaItem);
  }

  // Shared by drag-and-drop (desktop/pointer) and the tap-to-pick dialog
  // (mobile/touch) -- both end up assigning the same media item to the same
  // slot, just via a different input gesture.
  function assignMediaToSlot(slotId: string, mediaAssetId: string, mediaItem: MediaLibraryItem | undefined) {
    const beforeSlot = flatSlots.find((s) => s.id === slotId) ?? null;
    if (!beforeSlot) return;

    const optimisticValue: GridBoardSlot = {
      ...beforeSlot,
      // A dropped video's own URL points at the raw video file, not a
      // poster -- can't show that in an <img>, so leave the thumbnail empty
      // (falls back to the "Video" placeholder) until requestIdleRefresh
      // below brings back the real poster.
      thumbnailUrl: mediaItem?.mediaType === "video" ? null : (mediaItem?.url ?? beforeSlot.thumbnailUrl),
      // Narrowed, not just `mediaItem?.mediaType ?? slot.coverMediaType` --
      // MediaLibraryItem.mediaType is the app-wide MediaType (now including
      // "pdf"), but Grid's own Media Library query excludes PDFs entirely
      // (see grid/page.tsx), so a Grid cover can never actually be one.
      coverMediaType:
        mediaItem?.mediaType === "video" || mediaItem?.mediaType === "image"
          ? mediaItem.mediaType
          : beforeSlot.coverMediaType,
      coverMediaAssetId: mediaAssetId,
      // Dropping media onto a slot always replaces its cover -- never
      // appends into a carousel -- so the count resets to 1 and any crop
      // from whatever was previously here doesn't apply.
      assetCount: 1,
      coverTransform: null,
    };

    // Mutable, not a const captured once -- each undo/redo cycle after the
    // first needs to read/write whatever post id is CURRENTLY assigned to
    // this slot (undo deletes it, redo recreates it under a brand-new id).
    // Same idiom already used for this exact reason in media-library.tsx's
    // own "Add media" undo/redo (see its currentRef comment) -- fixes a
    // latent bug the old code had here: it captured `createdPostId` as a
    // plain const from the FIRST assign only, so a second undo (after an
    // intervening redo re-created the post under a new id) would have tried
    // to delete the wrong, already-gone id.
    const assignedPostId = { id: null as string | null };

    async function applyAssign(value: GridBoardSlot, run: () => Promise<Partial<GridBoardSlot> | void>) {
      const ok = await mutateSlot(slotId, value, run);
      if (!ok) {
        showError("Couldn't place that media. Please try again.");
        requestIdleRefresh();
      }
      return ok;
    }

    applyAssign(optimisticValue, async () => {
      if (demoMode) return undefined;
      const result = await placeMediaInSlot(projectId, slotId, mediaAssetId);
      assignedPostId.id = result?.postId ?? null;
      // The optimistic state above can't know a video's resolved poster URL
      // (only the server-side isolated query in grid-data.ts can) -- this
      // is the one deliberate exception to "no mutation resyncs via a
      // refresh": requestIdleRefresh still won't fire until every other
      // pending mutation (including this one) has settled.
      if (mediaItem?.mediaType === "video") requestIdleRefresh();
      return assignedPostId.id ? { postId: assignedPostId.id } : undefined;
    }).then((ok) => {
      if (!ok || demoMode) return;
      pushCommand({
        label: "Replace media",
        undo: async () => {
          const undoOk = await mutateSlot(slotId, beforeSlot, async () => {
            if (!beforeSlot.postId) {
              // Slot was empty before -- undo just removes the post this
              // assignment created.
              if (assignedPostId.id) await deletePost(projectId, assignedPostId.id);
              assignedPostId.id = null;
            } else if (beforeSlot.coverMediaAssetId) {
              // Slot already had a post -- restore its previous cover asset
              // and crop onto that same post.
              await placeMediaInSlot(projectId, slotId, beforeSlot.coverMediaAssetId);
              await updatePostCoverTransform(projectId, beforeSlot.postId, beforeSlot.coverTransform);
            }
          });
          if (!undoOk) {
            showError("Couldn't undo that. Please try again.");
            requestIdleRefresh();
          }
        },
        redo: async () => {
          await applyAssign(optimisticValue, async () => {
            const redoResult = await placeMediaInSlot(projectId, slotId, mediaAssetId);
            assignedPostId.id = redoResult?.postId ?? null;
            if (mediaItem?.mediaType === "video") requestIdleRefresh();
            return assignedPostId.id ? { postId: assignedPostId.id } : undefined;
          });
        },
      });
    });
  }

  // Genuinely optimistic Add Row: the new row (and its 3 empty slots) is
  // applied via mutateAddRow's BEGIN synchronously, before the server call
  // even starts, so the click has visible effect immediately -- no
  // dependence on addGridRow's round-trip. This directly fixes the "click
  // does nothing, then N rows appear at once" report: that was caused by
  // addGridRow's now-removed revalidatePath call on this same route
  // batching every pending call's visible effect into one delayed commit
  // (confirmed via an isolated repro outside this file; see the comment on
  // addGridRow itself). addRowPending disables the button for the duration
  // of this one add -- the deliberate alternative to letting clicks queue
  // invisibly and replay later as a burst, per the interaction contract:
  // first click must give immediate feedback, further clicks are
  // prevented, not silently swallowed.
  function handleAddRow() {
    if (addRowPending) return;
    const tempRowId = `optimistic-${crypto.randomUUID()}`;
    const tempSlots: GridBoardSlot[] = [0, 1, 2].map(() => {
      const tempSlotId = `optimistic-${crypto.randomUUID()}`;
      return {
        id: tempSlotId,
        clientKey: tempSlotId,
        postId: null,
        thumbnailUrl: null,
        coverMediaType: null,
        coverMediaAssetId: null,
        coverOriginalUrl: null,
        assetCount: 0,
        coverTransform: null,
        scheduledDate: null,
      };
    });
    const tempRow: GridBoardRow = { id: tempRowId, clientKey: tempRowId, slots: tempSlots };
    setAddRowPending(true);
    mutateAddRow(tempRow, () => addGridRow(projectId)).then((ok) => {
      setAddRowPending(false);
      if (!ok) showError("Couldn't add a new row. Please try again.");
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
      collisionDetection={collisionDetectionStrategy}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        logGridInteraction("drag_cancel", {});
        dispatchInteraction({ type: "DRAG_END" });
        setActiveMedia(null);
        setActiveSlot(null);
        setActiveRow(null);
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
          {canManage && !demoMode && (
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
                {isTouchDevice && effectiveRows.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setReorderMode((v) => !v)}
                    className={`rounded-full border px-3 py-1.5 text-xs tracking-wide uppercase transition-colors duration-150 ${
                      reorderMode
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-foreground hover:border-foreground/40"
                    }`}
                  >
                    {reorderMode ? "Done" : "Edit Grid"}
                  </button>
                )}
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
                <button
                  type="button"
                  onClick={handleAddRow}
                  disabled={addRowPending}
                  title="Add New Post"
                  className="rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <PlusIcon />
                </button>
              </div>
            </div>
          )}
          {/* Nested inside the ONE grid-dnd DndContext above, not a second
              drag/state system -- see collisionDetectionStrategy's own
              comment for why row vs. slot droppables can't ambiguously
              collide despite a row's box fully containing its 3 slots'
              boxes. verticalListSortingStrategy (rows stack in a single
              column) vs. the slot SortableContext's own rectSortingStrategy
              (a 2D grid) -- two different strategies is exactly why this
              needs its own SortableContext rather than merging into
              flatSlotIds' one. */}
          <SortableContext items={rowSortIds} strategy={verticalListSortingStrategy}>
            <SortableContext items={flatSlotIds} strategy={rectSortingStrategy}>
              {effectiveRows.map((row) => (
                <GridRow
                  key={row.clientKey ?? row.id}
                  row={row}
                  projectId={projectId}
                  canManage={canManage}
                  onOpenPicker={setPickerSlotId}
                  pushCommand={pushCommand}
                  mutateSlot={mutateSlot}
                  mutateRemoveRow={mutateRemoveRow}
                  requestIdleRefresh={requestIdleRefresh}
                  cropTargetSlotId={interaction.mode === "crop" ? interaction.cropTargetSlotId : null}
                  requestOpenCrop={requestOpenCrop}
                  requestCloseCrop={requestCloseCrop}
                  interactionIdle={interaction.mode === "idle"}
                  // Deliberately a DIFFERENT condition from interactionIdle,
                  // for a real bug found this round: dnd-kit's own
                  // `disabled.droppable` had been gated on interactionIdle
                  // too, which is backwards -- handleDragStart dispatches
                  // DRAG_START the instant ANY drag begins (including
                  // dragging an asset in from the Library sidebar), which
                  // flips interaction.mode away from "idle" immediately, so
                  // every Grid slot became a NON-droppable target for the
                  // full duration of the very drag that needs somewhere to
                  // drop. Slots must stay droppable exactly while a drag is
                  // in progress -- only Library/Crop being open should
                  // disable dropping.
                  dropEligible={interaction.mode === "idle" || interaction.mode === "dragging"}
                  selectionMode={selectionMode}
                  selectedPostIds={selectedPostIds}
                  onToggleSelectPost={handleToggleSelectPost}
                  demoMode={demoMode}
                  dragEnabled={dragEnabled}
                  reorderMode={reorderMode}
                  // Row dragging is always available via its own explicit
                  // handle (not gated behind touch's "Edit Grid" mode the
                  // way whole-tile slot dragging is) -- the handle itself
                  // is the deliberate, small activation surface, same
                  // reasoning as why it needs no separate reorderMode gate.
                  // Not gated on demoMode either -- matches GridSlot's own
                  // draggable/droppable conditions, which don't check it
                  // either: the optimistic drag stays fully real/
                  // interactive in demoMode, only the actual persistence
                  // (applyRowReorder's own demoMode check, above) is
                  // skipped, same split as every other mutation here.
                  rowDragDisabled={!canManage}
                />
              ))}
            </SortableContext>
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
          // point, so nothing is lost on mobile). Desktop-only resize
          // handle sits on the sidebar's own left edge (the boundary with
          // the Grid) -- `hidden lg:flex` mirrors the sidebar's own
          // existing `hidden lg:block` gate exactly, so mobile is
          // completely unaffected (no resize UI, no width state applied --
          // the whole wrapper only renders at `lg`+ to begin with).
          <div className="relative hidden lg:flex lg:shrink-0" style={{ width: libraryWidth }}>
            {/* Adobe-panel-style: a thin, always-visible divider line reads
                as a real boundary at rest (the previous version was
                invisible until you happened to hover it -- not
                discoverable). Hover/drag thickens and darkens that line
                and fades in a small centered grip cue, so it clearly
                reads as draggable without turning into a heavy admin
                splitter or any instructional text. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize media library"
              title="Drag to resize"
              onPointerDown={handleResizeHandlePointerDown}
              onPointerMove={handleResizeHandlePointerMove}
              onPointerUp={handleResizeHandlePointerUp}
              onPointerCancel={handleResizeHandlePointerUp}
              className="group absolute -left-2.5 top-0 z-10 flex h-full w-3 cursor-col-resize touch-none items-center justify-center select-none"
            >
              <div
                className={`h-full transition-[width,background-color] duration-150 ${
                  isResizingLibrary ? "w-0.5 bg-foreground/50" : "w-px bg-border group-hover:w-0.5 group-hover:bg-foreground/40"
                }`}
              />
              <div
                className={`pointer-events-none absolute flex flex-col gap-[3px] transition-opacity duration-150 ${
                  isResizingLibrary ? "opacity-100" : "opacity-0 group-hover:opacity-70"
                }`}
              >
                <span className="h-3 w-[3px] rounded-full bg-foreground/60" />
                <span className="h-3 w-[3px] rounded-full bg-foreground/60" />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <MediaLibrary
                projectId={projectId}
                items={mediaLibrary}
                folders={mediaFolders}
                pushCommand={pushCommand}
                demoMode={demoMode}
                sharedLibrary={libraryController}
                wide
                sidebarWidthPx={libraryWidth}
              />
            </div>
          </div>
        )}
      </div>

      {canManage && (
        <MediaPickerDialog
          open={pickerSlotId !== null}
          onClose={() => setPickerSlotId(null)}
          library={libraryController}
          onSelect={handlePickMedia}
          demoMode={demoMode}
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
          <div className={`${GRID_COVER_ASPECT_CLASS} w-28 cursor-grabbing overflow-hidden rounded border border-foreground/20 shadow-[0_2px_10px_rgba(0,0,0,0.1)]`}>
            {activeSlot.thumbnailUrl ? (
              // Same CroppedCoverImage the real tile renders with (see
              // GridSlotBody) -- without it, a cropped post's drag preview
              // showed the raw, uncropped framing while dragging, a visible
              // mismatch from what the tile actually looks like at rest
              // (and from what it snaps back to on drop).
              <CroppedCoverImage src={activeSlot.thumbnailUrl} transform={activeSlot.coverTransform} className="h-full w-full" />
            ) : null}
          </div>
        )}
        {activeRow && (
          // The whole row as one floating unit while it's being dragged --
          // "whole row clearly moves as one" -- same shadow/border language
          // as activeSlot's own preview above, just three of them side by
          // side at a fixed small width (this preview never needs to match
          // the real tile's own responsive size, only to read clearly).
          <div className="grid w-56 grid-cols-3 overflow-hidden rounded border border-foreground/20 shadow-[0_4px_16px_rgba(0,0,0,0.15)]" style={{ gap: "2px" }}>
            {activeRow.slots.map((slot) => (
              <div key={slot.clientKey ?? slot.id} className={`${GRID_COVER_ASPECT_CLASS} cursor-grabbing overflow-hidden bg-black/[.04]`}>
                {slot.thumbnailUrl ? (
                  <CroppedCoverImage src={slot.thumbnailUrl} transform={slot.coverTransform} className="h-full w-full" />
                ) : null}
              </div>
            ))}
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
      {reorderMode && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-center gap-3 border-t border-border bg-background px-4 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          <span className="text-xs tracking-wide text-muted uppercase">Press and hold a post to drag it</span>
          <Button type="button" variant="primary" radius="none" onClick={() => setReorderMode(false)}>
            Done
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
  mutateSlot,
  mutateRemoveRow,
  requestIdleRefresh,
  cropTargetSlotId,
  requestOpenCrop,
  requestCloseCrop,
  interactionIdle,
  dropEligible,
  selectionMode,
  selectedPostIds,
  onToggleSelectPost,
  demoMode = false,
  dragEnabled = true,
  reorderMode = false,
  rowDragDisabled = false,
}: {
  row: GridBoardRow;
  projectId: string;
  canManage: boolean;
  onOpenPicker: (slotId: string) => void;
  pushCommand: (command: UndoableCommand) => void;
  mutateSlot: (
    slotId: string,
    optimisticValue: GridBoardSlot,
    run: () => Promise<Partial<GridBoardSlot> | void>,
  ) => Promise<boolean>;
  mutateRemoveRow: (rowId: string, run: () => Promise<void>) => Promise<boolean>;
  requestIdleRefresh: () => void;
  // GridBoard's own interaction reducer, narrowed to exactly what each
  // slot needs to know -- see GridBoard's own comment on why this is a
  // per-slot primitive boolean (computed here, per slot, below) rather
  // than the whole interaction object.
  cropTargetSlotId: string | null;
  requestOpenCrop: (slotId: string) => void;
  requestCloseCrop: () => void;
  interactionIdle: boolean;
  // See GridBoard's own comment on why this is NOT the same condition as
  // interactionIdle -- a slot must stay a valid drop target for the whole
  // duration of a drag that's already in progress (mode === "dragging"),
  // only Library/Crop being open should turn dropping off.
  dropEligible: boolean;
  selectionMode: boolean;
  selectedPostIds: Set<string>;
  onToggleSelectPost: (postId: string) => void;
  demoMode?: boolean;
  dragEnabled?: boolean;
  reorderMode?: boolean;
  rowDragDisabled?: boolean;
}) {
  // Row visibility is now entirely GridBoard's reducer's call (a removed
  // row is simply absent from deriveRows' output) -- no local "removed"
  // state needed here anymore; this component just doesn't get rendered
  // for a row that's gone. No dedicated "remove row" bar between rows --
  // the grid stays tight like desktop, and "Remove Row" lives in each
  // slot's own ⋮ menu instead.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    data: { type: "row", row },
    // Boolean form so a view-only (non-canManage) row stays a valid *drop*
    // target for other rows (droppable) while never being pick-uppable
    // itself (draggable) -- same split GridSlot's own useSortable uses.
    disabled: { draggable: rowDragDisabled, droppable: rowDragDisabled },
    // No transition -- same reasoning as GridSlot's own useSortable
    // (verified against @dnd-kit/sortable's source): passing one here
    // would put a live CSS transition on every row's transform for the
    // whole drag, competing with the DragOverlay's own per-frame cursor
    // tracking for the same compositor time. Rows snap to their new slot
    // instead of sliding, matching every other drag on this board.
    transition: null,
  });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} data-row-id={row.id} style={style} className={`group/row relative ${isDragging ? "opacity-30" : ""}`}>
      {!rowDragDisabled && (
        // Explicit, dedicated activation surface -- NOT the row itself, so
        // grabbing an image still only ever does what it always did (open
        // Post Editor / start a slot drag). touch-action:none is scoped to
        // just this small handle, not the whole row, so it can't block
        // ordinary page/grid scrolling the way it would on a full tile --
        // no "Edit Grid" mode gate needed for it, unlike whole-tile slot
        // dragging (see dragEnabled's own comment above). Centered at the
        // row's own top edge -- every per-slot corner badge/menu already
        // claims a SLOT's own corner, this claims none of them.
        <button
          type="button"
          {...attributes}
          {...listeners}
          title="Drag to reorder row"
          aria-label="Drag to reorder row"
          className="absolute left-1/2 top-0.5 z-10 flex h-4 w-10 -translate-x-1/2 cursor-grab touch-none items-center justify-center rounded-full border border-border/70 bg-background/80 opacity-70 shadow-sm transition-opacity duration-150 hover:opacity-100 active:cursor-grabbing lg:opacity-0 lg:group-hover/row:opacity-100"
        >
          <span className="flex gap-[3px]">
            <span className="h-[3px] w-[3px] rounded-full bg-foreground/60" />
            <span className="h-[3px] w-[3px] rounded-full bg-foreground/60" />
            <span className="h-[3px] w-[3px] rounded-full bg-foreground/60" />
          </span>
        </button>
      )}
      <div className="grid grid-cols-3" style={{ gap: "2px" }}>
        {row.slots.map((slot) => (
          <GridSlot
            key={slot.clientKey ?? slot.id}
            slot={slot}
            rowId={row.id}
            projectId={projectId}
            canManage={canManage}
            onOpenPicker={onOpenPicker}
            pushCommand={pushCommand}
            mutateSlot={mutateSlot}
            mutateRemoveRow={mutateRemoveRow}
            requestIdleRefresh={requestIdleRefresh}
            cropOpen={cropTargetSlotId === slot.id}
            requestOpenCrop={requestOpenCrop}
            requestCloseCrop={requestCloseCrop}
            interactionIdle={interactionIdle}
            dropEligible={dropEligible}
            selectionMode={selectionMode}
            selected={slot.postId ? selectedPostIds.has(slot.postId) : false}
            onToggleSelectPost={onToggleSelectPost}
            demoMode={demoMode}
            dragEnabled={dragEnabled}
            reorderMode={reorderMode}
          />
        ))}
      </div>
    </div>
  );
}

// memo: this renders once per slot (up to dozens per Grid page), and without
// it every slot re-rendered whenever GridBoard re-rendered for ANY reason
// (starting a drag anywhere on the board, an unrelated toast, etc.) --
// see the perf investigation this was added for. Only actually skips
// re-rendering when every prop below is reference-stable -- mutateSlot/
// mutateRemoveRow/requestIdleRefresh are all useCallback'd once in
// GridBoard with stable deps, same as onToggleSelectPost already was.
const GridSlot = memo(function GridSlot({
  slot,
  rowId,
  projectId,
  canManage,
  onOpenPicker,
  pushCommand,
  mutateSlot,
  mutateRemoveRow,
  requestIdleRefresh,
  cropOpen,
  requestOpenCrop,
  requestCloseCrop,
  interactionIdle,
  dropEligible,
  selectionMode,
  selected,
  onToggleSelectPost,
  demoMode = false,
  dragEnabled = true,
  reorderMode = false,
}: {
  slot: GridBoardSlot;
  rowId: string;
  projectId: string;
  canManage: boolean;
  onOpenPicker: (slotId: string) => void;
  pushCommand: (command: UndoableCommand) => void;
  mutateSlot: (
    slotId: string,
    optimisticValue: GridBoardSlot,
    run: () => Promise<Partial<GridBoardSlot> | void>,
  ) => Promise<boolean>;
  mutateRemoveRow: (rowId: string, run: () => Promise<void>) => Promise<boolean>;
  requestIdleRefresh: () => void;
  // Is THIS slot's crop editor open -- GridBoard's interaction reducer,
  // narrowed to a single primitive so memo() below still only re-renders
  // the one tile whose value actually changed (see GridBoard's own comment
  // on why the whole interaction object is never passed down directly).
  cropOpen: boolean;
  requestOpenCrop: (slotId: string) => void;
  requestCloseCrop: () => void;
  // True only while the Grid's interaction mode is fully idle -- i.e.
  // neither Library nor any slot's Crop is open, AND no drag is currently
  // in progress. Gates whether this tile can be PICKED UP to START a new
  // drag/be clicked to enter Crop/Library.
  interactionIdle: boolean;
  // True while idle OR while a drag is already in progress -- what
  // actually gates whether this slot can RECEIVE a drop. See GridBoard's
  // own comment for the real bug this distinction fixes: gating droppable
  // on interactionIdle alone made every slot reject drops for the entire
  // duration of the very drag that needed one, since starting ANY drag
  // (including from the Library sidebar) flips the mode away from "idle"
  // immediately.
  dropEligible: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelectPost: (postId: string) => void;
  demoMode?: boolean;
  dragEnabled?: boolean;
  reorderMode?: boolean;
}) {
  const router = useRouter();
  const { showError } = useToast();
  const { attributes, listeners, setNodeRef, transform, transition, isOver, isDragging } =
    useSortable({
      id: slot.id,
      data: { type: "slot", slotId: slot.id, slot },
      // Boolean `disabled` disables both drag AND drop in dnd-kit — pass the object
      // form so empty/view-only slots stay valid *drop* targets, just not pick-uppable.
      // Also disabled while selecting for Review, so a drag gesture never
      // fights with the tap-to-select interaction. And disabled on touch
      // until "Edit Grid" mode is on (dragEnabled), so an ordinary scroll
      // touch is never mistaken for a drag pickup.
      // Also disabled whenever the Grid's interaction mode isn't idle (some
      // slot's Crop is open, or Library is open) -- a pointerdown starting
      // a grid drag while the crop overlay is active was a real, live-
      // confirmed contributor to an earlier round's "stuck crop" report:
      // dnd-kit's own drag-activation tracking competing with the crop
      // overlay's own pointer handling on the exact same pointer sequence.
      disabled: {
        draggable: !slot.postId || !canManage || selectionMode || !dragEnabled || !interactionIdle,
        droppable: !canManage || selectionMode || !dragEnabled || !dropEligible,
      },
      // No transition (verified against @dnd-kit/sortable's own source,
      // useSortable's getTransition()): passing a transition here makes
      // EVERY sortable tile carry a live CSS transition on its transform
      // for the ENTIRE duration of any drag in this SortableContext
      // (isSorting is true board-wide, not just for the dragged item),
      // so every tile whose position shifts as you drag over a new spot
      // triggers a real, concurrent CSS transition -- competing for the
      // same main-thread/compositor time as the DragOverlay's own
      // per-frame cursor tracking, which is what actually needs to feel
      // instant. Already consistent with this file's DragOverlay itself
      // (dropAnimation={null}, same "no animation competing with feel"
      // reasoning) -- tiles now snap directly to their new slot instead
      // of sliding, matching "prioritize direct pointer responsiveness
      // over fancy sibling animation."
      transition: null,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Plain DOM ref alongside dnd-kit's own setNodeRef -- GridCropOverlay
  // needs the tile's real on-screen rect to position its portal (a
  // combined ref callback since a single element can't take two `ref`
  // props). Memoized (not a fresh inline arrow function per render): a
  // NEW ref callback identity on every render makes React detach (call
  // with null) then reattach (call with the node) on every single
  // re-render, even though the underlying DOM node never actually
  // changes -- confirmed live as the exact cause of GridCropOverlay's
  // own mount-time measurement occasionally reading a momentarily-null
  // anchor. A stable callback (memoized on the two things it actually
  // closes over) is attached once and never needlessly churns.
  const tileElRef = useRef<HTMLDivElement>(null);
  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      tileElRef.current = node;
    },
    [setNodeRef],
  );

  const [contentMenuOpen, setContentMenuOpen] = useState(false);
  // Gated on reorderMode -- same reasoning as handleClick's own reorderMode
  // guard below ("the only thing this mode does is let you drag"). Without
  // this, the ⋮ menu's "Crop Image" action was still reachable while Edit
  // Grid mode was on, which could open GridCropOverlay (an interactive,
  // pointer-handling layer) on top of a tile mid-reorder-session -- exactly
  // the "something crop-related competing with the drag gesture" shape,
  // even though it required a deliberate menu tap rather than merely
  // having a saved crop. Not empty-deps anymore (reorderMode changes only
  // on a deliberate Edit Grid toggle, not per drag frame), so this still
  // doesn't break GridSlotBody's memo the way a per-render-fresh closure
  // would.
  const handleToggleMenu = useCallback(() => {
    if (reorderMode) return;
    setContentMenuOpen((v) => !v);
  }, [reorderMode]);
  const contentMenuRef = useOutsideClick<HTMLDivElement>(contentMenuOpen, () => setContentMenuOpen(false));
  // Defensive close for both -- covers the moment Edit Grid mode turns on
  // while a menu/crop session was already open on this tile, so nothing
  // crop-related can be mid-interaction the instant dragging becomes
  // available. "Adjust state during render" rather than a useEffect -- this
  // needs to take effect in the SAME commit reorderMode flips in, not one
  // render later.
  const [prevReorderMode, setPrevReorderMode] = useState(reorderMode);
  if (reorderMode !== prevReorderMode) {
    setPrevReorderMode(reorderMode);
    if (reorderMode) {
      setContentMenuOpen(false);
      if (cropOpen) requestCloseCrop();
    }
  }

  // `slot` IS the final, derived-from-GridBoard's-reducer value -- no local
  // override/patch/pendingMutation machinery needed here anymore (that
  // whole layer -- overrideTransform/overridePatch/prevSlot/
  // pendingSlotMutations -- is exactly the dead architecture this round
  // replaced; see grid-reducer.ts for where its job went). Every mutation
  // below goes through the mutateSlot/mutateRemoveRow props from GridBoard.

  // Self-heals a video cover that's missing its poster (upload-time capture
  // can fail for some codecs/timeouts -- see video-poster.ts) instead of
  // leaving the "▶ Video" text placeholder up until someone happens to open
  // the ⋮ menu and click "Regenerate Poster" manually. Runs once per slot
  // per mount; the ref guards against StrictMode's double-invoke and against
  // re-firing on every re-render while the async capture is in flight.
  const autoHealAttemptedRef = useRef(false);
  useEffect(() => {
    if (!canManage || demoMode) return;
    if (slot.thumbnailUrl || slot.coverMediaType !== "video") return;
    if (!slot.coverMediaAssetId || !slot.coverOriginalUrl) return;
    if (autoHealAttemptedRef.current) return;
    autoHealAttemptedRef.current = true;

    // Routed through mutateSlot (BEGIN with the unchanged current value --
    // there's nothing to show optimistically until the capture finishes --
    // COMMIT with a thumbnailUrl patch if it succeeds) purely so this
    // slot's in-flight state is visible to the reducer the same way every
    // other mutation's is, not because this one can meaningfully fail or
    // needs to roll back anything: no error/toast on failure, matching the
    // original silent-best-effort behavior exactly.
    mutateSlot(slot.id, slot, async () => {
      const posterBlob = await generatePosterFromVideoUrl(slot.coverOriginalUrl!);
      if (!posterBlob) return undefined;
      const formData = new FormData();
      formData.set("poster", new File([posterBlob], "poster.jpg", { type: "image/jpeg" }));
      const result = await saveRegeneratedPoster(projectId, slot.coverMediaAssetId!, formData);
      return result.posterUrl ? { thumbnailUrl: result.posterUrl } : undefined;
    });
    // `slot` itself deliberately isn't a dep: the ref guard above already
    // makes this effect's body a one-time thing per slot instance, and
    // depending on individual primitive fields (not the whole object,
    // which gets a new reference on every unrelated mutation now) keeps it
    // from re-running pointlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, demoMode, projectId, mutateSlot, slot.coverMediaAssetId, slot.coverMediaType, slot.coverOriginalUrl, slot.thumbnailUrl]);

  // Warms the intercepted Post Editor route's RSC payload (its own
  // page.tsx runs a dozen-plus sequential Supabase queries + signs the
  // whole project's media library) as soon as this tile is on screen,
  // instead of only starting that fetch the instant the user clicks --
  // router.push has no prefetch of its own, so without this every click
  // was a fully cold navigation. Keyed on postId (not re-run on every
  // drag-triggered re-render) since prefetch is a one-time warm, not
  // something to repeat.
  useEffect(() => {
    if (!slot.postId || demoMode) return;
    router.prefetch(`/projects/${projectId}/posts/${slot.postId}`);
  }, [slot.postId, projectId, demoMode, router]);

  // Native onClick + onDoubleClick, deliberately NOT the manual
  // Date.now()-comparison timer this used to be. That timer's own claim
  // ("dnd-kit suppresses native dblclick synthesis") was wrong -- verified
  // live: a real double-click fires a genuine native `dblclick` event on
  // this exact element, with dnd-kit's PointerSensor listeners attached,
  // in both Chromium and WebKit. The manual version failed for a different,
  // real reason: it compared elapsed time against DOUBLE_CLICK_WINDOW_MS
  // using the SAME constant it used to delay single-click navigation, so a
  // double-click gesture any slower than that window (confirmed live: 220ms
  // was already too tight for two scripted clicks in Chromium, and WebKit's
  // own event dispatch overhead alone routinely exceeded it even at "fast"
  // intervals) raced its own single-click timer -- the first click's
  // navigation had frequently ALREADY FIRED by the time the second click
  // was even processed, and the second click then got scheduled as its own
  // brand-new single-click timer instead of recognized as part of a double.
  // This reproduced exactly "double-click frequently does nothing" /
  // "inconsistent." The browser's own dblclick recognition uses the OS's
  // actual double-click timing, not a hardcoded guess, so it's used as the
  // sole arbiter now; clickTimerRef's only remaining job is a short grace
  // window that gives a following native dblclick a chance to cancel the
  // deferred single-click navigation before it fires.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cleared on: a following dblclick (handleDoubleClick, below), this same
  // slot's own drag activating (isDragging flipping true -- a real drag
  // gesture beginning must preempt a pending single-click intent, not race
  // it to fire mid-drag), reorder mode toggling on, and component removal
  // (a row/slot can be removed via Undo or another mutation while this
  // timer is still ticking). Never needs clearing "on Library open" or "on
  // Crop open elsewhere" -- Library only ever opens via the empty-slot
  // click path, which never runs this timer at all, and another slot's
  // Crop opening has no bearing on THIS slot's own pending intent.
  useEffect(() => {
    if (isDragging && clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, [isDragging]);
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  // BUG FOUND AND FIXED THIS ROUND: this used to schedule a fresh
  // setTimeout on every `click` unconditionally, overwriting
  // clickTimerRef.current WITHOUT clearing the previous timer first. A
  // real double-click fires TWO `click` events before `dblclick` (browsers
  // dispatch click1, click2, THEN dblclick) -- so click #1 scheduled timer
  // A, click #2 overwrote the ref with a brand-new timer B (leaking A,
  // still pending), and handleDoubleClick below only ever clears whatever
  // clickTimerRef.current CURRENTLY holds (B) when it fires -- leaving A to
  // fire on its own 400ms later and call router.push regardless. That's
  // the exact, confirmed mechanism behind "double-click still opens Post
  // Editor" in real Preview: not a race, a straightforward leaked timer.
  //
  // Fixed using the browser's own click-sequence count (MouseEvent.detail:
  // 1 for a genuine first click, 2+ for a click that's part of a
  // multi-click sequence, using the OS's own double-click timing --
  // strictly more reliable than re-deriving it by hand) instead of a
  // second, independent timer-based guess: a click that isn't the first in
  // its sequence never schedules anything at all, so there is only ever
  // ONE pending single-click intent for this tile to begin with, and
  // handleDoubleClick's own clear is guaranteed to be clearing THE
  // (singular) pending timer, not a stale one.
  function handleClick(e: React.MouseEvent) {
    if (!slot.postId) return;
    if (selectionMode) {
      onToggleSelectPost(slot.postId);
      return;
    }
    // While actively rearranging, a stray tap shouldn't navigate away or
    // open crop mode -- the only thing this mode does is let you drag.
    if (reorderMode) return;
    // Click #2 (and beyond) of a multi-click sequence -- onDoubleClick
    // owns this gesture instead. Not scheduling anything here is what
    // makes the ONE-pending-intent guarantee hold structurally rather than
    // by careful bookkeeping.
    if (e.detail > 1) return;
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      // No real Post Editor route exists for a fake demo project -- a plain
      // single click has nothing to do in demoMode (double-click's crop
      // overlay, below, is the one editing interaction that stays real).
      if (demoMode) return;
      router.push(`/projects/${projectId}/posts/${slot.postId}`);
    }, DOUBLE_CLICK_WINDOW_MS);
  }

  function handleDoubleClick() {
    if (!slot.postId) return;
    if (selectionMode || reorderMode) return;
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    // Narrower than isSlotFilled(slot) deliberately -- GridCropOverlay
    // needs an actual image to overlay on top of (imageUrl={slot.
    // thumbnailUrl}), which a video with no poster yet doesn't have, so
    // double-clicking one is a safe no-op rather than opening an overlay
    // with nothing to show. Still never falls through to the Library --
    // this whole function already returned early above if !slot.postId.
    // Routed through the shared interaction reducer (requestOpenCrop), not
    // local state -- its own OPEN_CROP guard is what makes "Library can
    // never also be open right now" true by construction rather than by
    // this component happening to agree.
    if (canManage && slot.thumbnailUrl) requestOpenCrop(slot.id);
  }

  // useCallback below (not plain functions) -- these are passed as props
  // into GridSlotBody's memo() boundary, so a fresh closure every render
  // (which happens on every dnd-kit-driven re-render of THIS component,
  // not just when something the user cares about changed -- see the note
  // on GridSlotBody itself) would defeat that memo for every slot on the
  // board on every pointer-move frame during any drag, not just this one.
  const handleSaveCrop = useCallback(
    (next: GridCoverTransform) => {
      if (!slot.postId) return;
      const postId = slot.postId;
      const previousTransform = slot.coverTransform;
      // Exits the editor immediately, synchronously, regardless of what
      // happens next -- Confirm must never leave the UI locked waiting on
      // the server (see mutateSlot's own async call below, which this does
      // not wait for). On failure, showError/requestIdleRefresh still fire,
      // but the user is never trapped in the crop overlay because of it.
      requestCloseCrop();
      mutateSlot(slot.id, { ...slot, coverTransform: next }, async () => {
        // The crop itself is applied optimistically either way -- demoMode
        // just skips persisting it, same reasoning as every mutation here.
        if (demoMode) return;
        await updatePostCoverTransform(projectId, postId, next);
      }).then((ok) => {
        if (!ok) {
          showError("Couldn't save that crop. Please try again.");
          requestIdleRefresh();
          return;
        }
        if (demoMode) return;
        pushCommand({
          label: "Crop",
          undo: () =>
            mutateSlot(slot.id, { ...slot, coverTransform: previousTransform }, async () => {
              await updatePostCoverTransform(projectId, postId, previousTransform);
            }).then((undoOk) => {
              if (!undoOk) requestIdleRefresh();
            }),
          redo: () =>
            mutateSlot(slot.id, { ...slot, coverTransform: next }, async () => {
              await updatePostCoverTransform(projectId, postId, next);
            }).then((redoOk) => {
              if (!redoOk) requestIdleRefresh();
            }),
        });
      });
    },
    [slot, demoMode, projectId, pushCommand, mutateSlot, showError, requestIdleRefresh, requestCloseCrop],
  );

  // Purely local intent, dispatched to the shared reducer -- discards the
  // editor's in-progress transform and exits. Never awaits a server call,
  // so a slow/failed backend can never trap the user in the crop overlay
  // via this path.
  const handleCancelCrop = useCallback(() => requestCloseCrop(), [requestCloseCrop]);

  const handleEditContent = useCallback(() => {
    setContentMenuOpen(false);
    if (demoMode) return;
    router.push(`/projects/${projectId}/posts/${slot.postId}`);
  }, [demoMode, projectId, slot.postId, router]);

  const handleOpenCropFromMenu = useCallback(() => {
    setContentMenuOpen(false);
    requestOpenCrop(slot.id);
  }, [requestOpenCrop, slot.id]);

  const handleDeletePost = useCallback(() => {
    if (!slot.postId) return;
    const postId = slot.postId;
    setContentMenuOpen(false);
    if (!confirm("Delete this post? This can't be undone.")) return;
    mutateSlot(
      slot.id,
      {
        ...slot,
        postId: null,
        thumbnailUrl: null,
        coverMediaType: null,
        coverMediaAssetId: null,
        coverOriginalUrl: null,
        assetCount: 0,
        coverTransform: null,
        scheduledDate: null,
      },
      async () => {
        await deletePost(projectId, postId);
      },
    ).then((ok) => {
      if (!ok) {
        showError("Couldn't delete that post. Please try again.");
        requestIdleRefresh();
      }
    });
  }, [slot, projectId, mutateSlot, showError, requestIdleRefresh]);

  const handleRemoveRow = useCallback(() => {
    setContentMenuOpen(false);
    if (!confirm("Remove this row? This can't be undone.")) return;
    mutateRemoveRow(rowId, async () => {
      await removeGridRow(projectId, rowId);
    }).then((ok) => {
      if (!ok) {
        showError("Couldn't remove that row. Please try again.");
        requestIdleRefresh();
      }
    });
  }, [mutateRemoveRow, projectId, rowId, showError, requestIdleRefresh]);

  const filled = isSlotFilled(slot);

  return (
    <div
      ref={combinedRef}
      style={style}
      // Deliberately still gated on the real, persisted slot.postId, NOT
      // `filled` -- picking a tile up to reorder it while its own
      // assignment is still mid-flight (content visible, post not yet
      // created server-side) would race dnd-kit's reorder against
      // placeMediaInSlot's own still-pending write in ways narrower to
      // reason about than just leaving it non-draggable for that one brief
      // window. Doesn't reintroduce the Library bug below -- that was
      // about CLICK routing, not drag eligibility. Also withheld whenever
      // interaction mode isn't idle -- see useSortable's own disabled
      // config comment.
      {...(slot.postId && canManage && dragEnabled && interactionIdle ? { ...attributes, ...listeners } : {})}
      role={filled || canManage ? "button" : undefined}
      tabIndex={filled || canManage ? 0 : undefined}
      // THE fix: routes on `filled` (isSlotFilled -- the same content-based
      // truth GridSlotBody below renders from), not `slot.postId`. Before
      // this, a slot showing its just-picked image but still waiting on
      // placeMediaInSlot's server round-trip (postId not yet assigned) fell
      // into the `else` branch here and reopened the Library picker on
      // every click -- the exact, confirmed cause of "clicking an
      // already-filled image opens the Library." handleClick itself already
      // no-ops safely when slot.postId isn't there yet (see its own
      // `if (!slot.postId) return`), so routing here by `filled` alone is
      // sufficient: a pending-assignment tile's clicks become a safe no-op
      // instead of reopening the picker, and a genuinely empty tile is
      // completely unaffected.
      onClick={filled ? handleClick : canManage ? () => onOpenPicker(slot.id) : undefined}
      onDoubleClick={filled ? handleDoubleClick : undefined}
      // select-none + -webkit-touch-callout:none -- iOS Safari's own
      // long-press-on-an-image gesture (its "Save Photo/Copy/Share" system
      // callout) is a well-known conflict with a custom long-press-to-drag
      // interaction; nothing in this app suppressed it before. Applied to
      // the whole draggable tile (not just the cover image) so it can never
      // compete with dnd-kit's own long-press activation, regardless of
      // which element inside the tile the touch happens to land on.
      className={`relative flex ${GRID_COVER_ASPECT_CLASS} items-center justify-center border transition-[outline-color,border-color] duration-150 select-none [-webkit-touch-callout:none] ${
        slot.postId && canManage && dragEnabled && interactionIdle
          ? "cursor-grab touch-none"
          : filled || canManage
            ? "cursor-pointer"
            : ""
      } ${
        filled ? "border-border hover:border-foreground/30" : "border-dashed border-border"
      } ${
        isDragging ? "opacity-30" : ""
      } ${
        isOver
          ? "outline outline-1 outline-offset-[-1px] outline-foreground"
          : "outline outline-1 outline-offset-[-1px] outline-transparent"
      }`}
    >
      <GridSlotBody
        slot={slot}
        transform={slot.coverTransform}
        canManage={canManage}
        selectionMode={selectionMode}
        selected={selected}
        demoMode={demoMode}
        cropMode={cropOpen}
        tileElRef={tileElRef}
        contentMenuOpen={contentMenuOpen}
        contentMenuRef={contentMenuRef}
        onToggleMenu={handleToggleMenu}
        onEditContent={handleEditContent}
        onOpenCropFromMenu={handleOpenCropFromMenu}
        onDeletePost={handleDeletePost}
        onRemoveRow={handleRemoveRow}
        onSaveCrop={handleSaveCrop}
        onCancelCrop={handleCancelCrop}
      />
    </div>
  );
});

// Split out of GridSlot so dnd-kit's own per-frame re-renders of the
// dragged item's SIBLINGS (useSortable subscribes every sortable slot to
// the shared DndContext, so all of them re-render as `transform` updates
// on every pointer move during a drag -- memo() on GridSlot itself can't
// prevent this, since it's driven by an internal hook/context subscription,
// not by GridSlot's own props) don't also force React to reconcile the
// expensive part of every tile -- the image, badges, ⋮ menu, and crop
// overlay -- on every one of those frames. GridSlot's outer wrapper (the
// transform-styled div) still legitimately re-renders every frame; this is
// the part that doesn't need to, and now won't, as long as its own props
// stay reference-stable (see the useCallback wrapping every handler passed
// in above).
const GridSlotBody = memo(function GridSlotBody({
  slot,
  transform,
  canManage,
  selectionMode,
  selected,
  demoMode,
  cropMode,
  tileElRef,
  contentMenuOpen,
  contentMenuRef,
  onToggleMenu,
  onEditContent,
  onOpenCropFromMenu,
  onDeletePost,
  onRemoveRow,
  onSaveCrop,
  onCancelCrop,
}: {
  slot: GridBoardSlot;
  transform: GridCoverTransform | null;
  canManage: boolean;
  selectionMode: boolean;
  selected: boolean;
  demoMode: boolean;
  cropMode: boolean;
  tileElRef: React.RefObject<HTMLDivElement | null>;
  contentMenuOpen: boolean;
  contentMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleMenu: () => void;
  onEditContent: () => void;
  onOpenCropFromMenu: () => void;
  onDeletePost: () => void;
  onRemoveRow: () => void;
  onSaveCrop: (next: GridCoverTransform) => void;
  onCancelCrop: () => void;
}) {
  return (
    <>
      {/* overflow-hidden lives on this inner wrapper (not the slot root) so
          it only ever clips the image -- the ⋮ menu below is a sibling, not
          a descendant, so it can render outside the tile's own bounds
          instead of being cropped by it. */}
      {/* The two conditions below (thumbnailUrl / coverMediaType==="video")
          are exactly isSlotFilled's own definition (grid-reducer.ts) --
          spelled out here rather than called as a function only because
          this branch needs three outcomes (image / video-without-poster /
          truly empty), not isSlotFilled's single boolean. GridSlot's outer
          wrapper uses the real isSlotFilled(slot) call for its click
          routing -- keeping both reads of the same two fields is what
          guarantees a tile's visual state and its click behavior can never
          disagree (see the outer wrapper's own comment). */}
      <div className={`absolute inset-0 flex items-center justify-center ${cropMode ? "" : "overflow-hidden"}`}>
        {slot.thumbnailUrl ? (
          // Always a static <img>, even when the cover is a video -- this is
          // the video's poster frame (captured client-side at upload time),
          // never the video file itself. Grid never plays/autoplays video.
          // Keyed on the asset's own identity, not the signed URL string --
          // a signed URL gets a fresh token every time it's re-minted even
          // for the exact same file (see signed-url-cache.ts's own
          // reasoning), and keying on it would force a full remount (a
          // fresh decode/paint, even when the browser has the bytes
          // cached) every time that happened. This still replays the
          // animate-settle-in entrance whenever the cover asset genuinely
          // changes (upload/crop/replace), just not on an unrelated
          // re-sign. Pointer events on the rendered <img> are always off
          // (CroppedCoverImage's own default) -- clicks/drag are handled
          // by the tile's outer wrapper; GridCropOverlay -- the only
          // element that DOES need pointer events on the image itself --
          // is a separate, later sibling in a portal, only while cropMode
          // is true, so this never conflicts with actual cropping.
          <CroppedCoverImage
            key={slot.coverMediaAssetId ?? slot.id}
            src={slot.thumbnailUrl}
            transform={transform}
            className="h-full w-full"
            imgClassName="animate-settle-in"
            loading="lazy"
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
      {/* Hidden while cropMode is active, not just visually covered by the
          crop overlay's own z-20 -- live-confirmed (elementFromPoint at
          this button's own coordinates) that it sat directly underneath
          the overlay, unreachable, while still looking present in the DOM.
          The crop editor now has its own explicit Cancel/Save, so this
          menu has nothing to add during a crop session anyway. */}
      {canManage && !cropMode && (
        <div ref={contentMenuRef} className="absolute right-1 top-1 z-10">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMenu();
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
              {slot.postId && !demoMode && (
                <button
                  type="button"
                  onClick={onEditContent}
                  className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                >
                  Edit Content
                </button>
              )}
              {slot.thumbnailUrl && (
                <button
                  type="button"
                  onClick={onOpenCropFromMenu}
                  className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                >
                  Crop Image
                </button>
              )}
              {slot.postId && !demoMode && (
                <button
                  type="button"
                  onClick={onDeletePost}
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05]"
                >
                  Delete Content
                </button>
              )}
              {!demoMode && (
                <button
                  type="button"
                  onClick={onRemoveRow}
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05]"
                >
                  Remove Row
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {cropMode && slot.thumbnailUrl && (
        <GridCropOverlay
          imageUrl={slot.thumbnailUrl}
          initialTransform={transform}
          onSave={onSaveCrop}
          onCancel={onCancelCrop}
          anchorRef={tileElRef}
        />
      )}
    </>
  );
});

// Touch-friendly equivalent of dragging a thumbnail from the sidebar
// library onto a slot -- tap an empty slot to open this, tap a thumbnail to
// place it. Also carries its own upload entry point, since the desktop
// sidebar (where uploading normally happens) is hidden below `lg`.
//
// Purely presentational now -- `library` is GridBoard's own single
// useLibraryItems() instance, the SAME one the sidebar MediaLibrary renders
// (see grid-board.tsx's own comment on why: these two surfaces used to each
// carry an independent copy of the same conceptual item data, which could
// -- and did, this was reachable, not just theoretical -- go stale relative
// to each other, since both are mounted simultaneously on every viewport
// and uploads no longer trigger any revalidation to naturally resync them).
function MediaPickerDialog({
  open,
  onClose,
  library,
  onSelect,
  demoMode = false,
}: {
  open: boolean;
  onClose: () => void;
  library: LibraryItemsController;
  onSelect: (item: MediaLibraryItem) => void;
  demoMode?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [, startDeleteTransition] = useTransition();
  const { effectiveItems, uploadError, uploadBatch, uploadFiles, deleteItem } = library;

  function handleDelete(e: React.MouseEvent, mediaAssetId: string) {
    e.stopPropagation();
    if (!confirm("Delete this asset? This removes it from any post or story using it.")) return;
    startDeleteTransition(async () => {
      await deleteItem(mediaAssetId);
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title="Choose from library" radius="none">
      <div className="flex flex-col gap-4">
        {!demoMode && (
          <form ref={formRef}>
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
                uploadFiles(files);
              }}
            />
            <Button
              type="button"
              variant="primary"
              radius="none"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadBatch !== null}
              className="w-full py-3 text-xs tracking-wide uppercase"
            >
              {uploadBatch ? `Uploading ${uploadBatch.done} / ${uploadBatch.total}` : "Upload New Asset"}
            </Button>
            {uploadError && <p className="mt-2 text-xs text-error">{uploadError}</p>}
          </form>
        )}

        {/* Capped to roughly 9 rows (grid-cols-3, ~155px square cells at
            this dialog's max-w-lg width) but also bounded by 70% of the
            viewport height, since 9 full rows here would be taller than
            most screens -- either limit alone isn't enough: a fixed row
            count can overflow small viewports, and a pure vh cap wouldn't
            read as "about 9 rows" on a typically-sized one.

            --tile-row-h/auto-rows, not the tile's own aspect-square, is what
            actually sizes every row -- same root cause and same fix as
            media-library.tsx's own sidebar grid (see its comment): a burst
            of many optimistic placeholders landing in the DOM at once (a
            batch upload) can get measured/painted before an aspect-ratio-
            derived height settles, especially on WebKit -- confirmed live
            via Playwright at 50-item batches. An explicit, fixed row height
            has no dependency on any child's aspect-ratio or load state.
            155px measured against this dialog's own max-w-lg width (three
            columns, gap-2, minus the Dialog's own padding). */}
        <div className="grid max-h-[min(1400px,70vh)] grid-cols-3 gap-2 [--tile-row-h:155px] auto-rows-[var(--tile-row-h)] overflow-y-auto">
          {effectiveItems.map((item) => (
            <div key={item.clientKey ?? item.id} className="relative min-w-0">
              <button
                type="button"
                onClick={() => onSelect(item)}
                disabled={item.pending}
                title={item.pending ? "Uploading…" : undefined}
                className="h-full w-full overflow-hidden border border-border transition-colors duration-150 hover:border-foreground/30 disabled:pointer-events-none"
              >
                <MediaThumbPreview item={item} />
              </button>
              {/* Always visible (not hover-revealed) -- this dialog is the
                  touch-friendly picker, and touch has no hover state. */}
              {!demoMode && !item.pending && (
                <button
                  type="button"
                  onClick={(e) => handleDelete(e, item.id)}
                  title="Delete asset"
                  className="absolute right-1 top-1 z-10 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white transition-colors duration-150 hover:bg-black/85"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {effectiveItems.length === 0 && <p className="text-sm text-muted">No media uploaded yet.</p>}
      </div>
    </Dialog>
  );
}
