"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import {
  bulkDeleteMedia,
  createMediaFolder,
  deleteMedia,
  moveMediaToFolder,
  restoreMediaAsset,
  uploadMedia,
  type UploadMediaState,
} from "@/lib/actions/grid";
import { uploadFilesConcurrently, type ConcurrentUploadOutcome } from "@/lib/video-poster";

// How many files upload in parallel during a batch. Not chosen arbitrarily --
// see the branch report for the concurrency=1/2/3/4 comparison this is based
// on (client-side decode/memory cost measured directly; server/Storage
// concurrency behavior could not be measured live in this environment, see
// the report's own disclosed limitation on that point). 1 (strictly
// sequential) is what caused one slow file to stall the entire remaining
// batch; unbounded parallel risks the same simultaneous-decode pressure the
// thin-strip fix already had to account for. 3 balances both.
const UPLOAD_CONCURRENCY = 3;
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/lib/hooks/use-toast";
import type { UndoableCommand } from "@/lib/hooks/use-undo-stack";
import type { MediaFolder, MediaLibraryItem } from "./grid-board";

export function MediaThumbPreview({
  item,
  className = "",
  hideGridBadge = false,
}: {
  item: MediaLibraryItem;
  className?: string;
  hideGridBadge?: boolean;
}) {
  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      {item.url && item.mediaType === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
      )}
      {item.url && item.mediaType === "video" && (
        <video src={item.url} className="h-full w-full object-cover" muted />
      )}
      {item.usedInGrid && !hideGridBadge && (
        <span
          title="Already on the Grid"
          className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-white"
        >
          <GridUsageIcon className="h-2.5 w-2.5" />
        </span>
      )}
      {item.pending && (
        <div
          title="Uploading — not ready to use yet"
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 backdrop-blur-[1px]"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        </div>
      )}
    </div>
  );
}

// Stacked-frames glyph -- distinct from the scheduled-content calendar icon
// (grid-board.tsx/story-card.tsx) so the two badge meanings read differently
// at a glance, same "small bg-black/70 corner chip" visual language.
export function GridUsageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="7" y="7" width="14" height="14" rx="2" />
      <path d="M3 13V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

export function MediaLibrary({
  projectId,
  items,
  folders,
  pushCommand,
  demoMode = false,
  onSelectionChange,
}: {
  projectId: string;
  items: MediaLibraryItem[];
  folders: MediaFolder[];
  pushCommand: (command: UndoableCommand) => void;
  // Additive, default false -- the real app is byte-for-byte unaffected.
  // Used to embed this real component on the public landing page: hides
  // every control that fires a real mutating server action (upload, move,
  // delete) against what would otherwise be a fake demo projectId from an
  // anonymous visitor, while leaving folder navigation/hover/selection/drag
  // (all pure local state) fully real and interactive.
  demoMode?: boolean;
  // Additive, optional -- lets a caller (the landing page's Chapter 01)
  // react to a real visitor selecting a thumbnail, so picking an asset can
  // visibly do something elsewhere on the page instead of selection being a
  // dead end. Fires with the current selection every time it changes; no
  // effect on the real app, which doesn't pass this.
  onSelectionChange?: (ids: string[]) => void;
}) {
  const router = useRouter();
  const { showError } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Surfaces both a too-large/direct-upload-failed file (rejected before the
  // server action ever runs) and a business-logic failure returned BY the
  // server action (e.g. the DB insert failed) -- handleUploadResult below is
  // now the one place both land, since uploadMedia is called directly rather
  // than through useActionState (see the concurrency comment on
  // uploadFilesConcurrently for why).
  const [uploadError, setUploadError] = useState<string | null>(null);
  // "Uploading 17 / 40" -- a batch resolves file-by-file, independently (see
  // uploadFilesConcurrently), so a bare "Uploading..." gave no sense of
  // progress on a large selection. Reset to a fresh count on every new file
  // selection; "done" advances on both success AND failure (a file that
  // fails is still no longer in flight), one increment per file resolved --
  // and, being driven by a direct per-file callback now rather than a
  // shared useActionState `state` value, genuinely advances one file at a
  // time instead of only becoming observable in a batch at the very end.
  const [uploadBatch, setUploadBatch] = useState<{ total: number; done: number } | null>(null);
  // One file resolved (success or failure) -- clears the counter entirely
  // once every file in the running total has, so the button reverts to its
  // normal "Upload Assets" label instead of getting stuck at "N / N".
  function advanceUploadBatch() {
    setUploadBatch((current) => {
      if (!current) return null;
      const done = current.done + 1;
      return done >= current.total ? null : { total: current.total, done };
    });
  }

  // Optimistic overlay so a new upload appears (via a local blob URL --
  // instant, no network round trip needed to show it) and a delete
  // disappears the moment it's requested, instead of waiting on
  // uploadMedia/bulkDeleteMedia's full round trip to land. Neither action
  // revalidates this route anymore (see grid.ts's own comments) -- delete
  // needs no further reconciliation (the optimistic removal already is the
  // final state), and upload reconciles its placeholder directly from the
  // action's own return value below, not from a page refresh. Same reset-
  // on-prop-change guard as Grid's own overrideRows.
  const [prevItems, setPrevItems] = useState(items);
  const [overrideItems, setOverrideItems] = useState<MediaLibraryItem[] | null>(null);
  const pendingBlobUrlsRef = useRef<Set<string>>(new Set());
  // Declared here (not down by the items-diffing effect that owns its
  // "reset to false" line) so every effect referencing it -- including the
  // upload-reconciliation effect below -- sees a single, unambiguous
  // declaration-before-use ordering.
  const suppressAutoTrackRef = useRef(false);
  // Same pending-mutation guard as grid-board.tsx's own overrideRows (see
  // its comment) -- a batch upload has many uploads genuinely in flight at
  // once now (see UPLOAD_CONCURRENCY), each independently pending between
  // "optimistic placeholder shown" and "reconciled with its real id" -- a
  // fresh `items` prop (e.g. from an unrelated folder move's
  // router.refresh()) landing while ANY of them is still in flight must not
  // wipe out placeholders that haven't been reconciled yet.
  const [pendingMutations, setPendingMutations] = useState(0);
  const beginMutation = useCallback(() => {
    setPendingMutations((n) => n + 1);
  }, []);
  const endMutation = useCallback(() => {
    setPendingMutations((n) => Math.max(0, n - 1));
  }, []);
  // prevItems always advances the instant a new `items` reference is SEEN,
  // whether or not it's actually applied -- only clearing overrideItems is
  // gated on pendingMutations. Getting this backwards (gating both together)
  // was a real bug caught by this branch's own race-condition test: a stale
  // prop arriving while a mutation was still in flight would correctly get
  // deferred, then get wrongly APPLIED the instant that unrelated mutation's
  // own endMutation() happened to fire, since prevItems had never advanced
  // past it and so it still looked "new" at that point.
  if (items !== prevItems) {
    setPrevItems(items);
    if (pendingMutations === 0) setOverrideItems(null);
  }
  const effectiveItems = overrideItems ?? items;
  // Mirrors effectiveItems for handleUploadResult below to read from --
  // handleUploadResult runs from an async callback (uploadFilesConcurrently's
  // onResult, well outside React's render cycle), not from a render, so it
  // can't safely close over `effectiveItems` from whatever render created it
  // (stale by the time a slow upload actually resolves). Updated every
  // render, always current by the time any async callback reads it.
  const itemsRef = useRef(effectiveItems);
  useEffect(() => {
    itemsRef.current = effectiveItems;
  }, [effectiveItems]);

  // Backstop only -- the reconciliation effect below is what actually
  // revokes each blob URL, individually, the moment its own upload resolves
  // (see its own comment). This just catches whatever's left in the set on
  // an eventual real navigation/refresh to this route (e.g. a blob whose
  // upload failed before finishing, or reconciled without a displayUrl for
  // some other reason) -- by then `items` itself already carries the real
  // signed URL, so nothing currently on screen still depends on any of these.
  useEffect(() => {
    for (const url of pendingBlobUrlsRef.current) URL.revokeObjectURL(url);
    pendingBlobUrlsRef.current = new Set();
  }, [items]);

  // The one place every upload settles now, called directly by
  // uploadFilesConcurrently's onResult -- not a useEffect watching a shared
  // `state` value (that WAS the root cause: React serializes repeated
  // dispatches of the same useActionState instance, so a 30-file batch
  // behaved as one long chain no matter how fast the underlying uploads
  // actually were -- see uploadFilesConcurrently's own comment for the
  // isolated reproduction). Each file's own result lands here independently,
  // as soon as ITS OWN pipeline resolves -- genuinely progressive, and safe
  // under real concurrency: reads the current list via itemsRef (never a
  // stale closure) and writes via a functional setOverrideItems updater
  // (never lost under two files resolving in the same tick).
  function handleUploadResult(outcome: ConcurrentUploadOutcome<UploadMediaState>) {
    endMutation();
    advanceUploadBatch();

    function failThisFile(message: string) {
      setUploadError(message);
      showError(message);
      const failed = itemsRef.current.find((i) => i.id === outcome.tempId);
      if (failed?.url && pendingBlobUrlsRef.current.has(failed.url)) {
        pendingBlobUrlsRef.current.delete(failed.url);
        URL.revokeObjectURL(failed.url);
      }
      setOverrideItems((current) => (current ?? itemsRef.current).filter((i) => i.id !== outcome.tempId));
    }

    if (outcome.status === "error") {
      failThisFile(outcome.message);
      return;
    }
    if (outcome.result?.message) {
      failThisFile(outcome.result.message);
      return;
    }

    const result = outcome.result;
    // UploadMediaState's own type allows `undefined` (its shape doing
    // double duty as useActionState's initial-state type elsewhere) --
    // uploadMedia itself never actually resolves to it, but a missing id
    // here would mean nothing usable came back at all, so fail closed
    // exactly like a real error would rather than silently no-op.
    if (!result?.id) {
      failThisFile("Upload didn't complete. Please try again.");
      return;
    }
    const tempId = outcome.tempId;
    const realId = result.id;
    const realStoragePath = result.storagePath;
    const realPosterStoragePath = result.posterStoragePath ?? null;
    const matched = itemsRef.current.find((i) => i.id === tempId);
    if (!matched) return;

    // Swap off the optimistic blob URL (backing the full-resolution
    // original file, decoded and held in memory for as long as it's
    // rendered) onto the real, cheap signed thumbnail URL the action just
    // computed -- without this, a reconciled item kept showing its blob URL
    // indefinitely (there was no other display URL known client-side), so
    // every upload in a session left its full-res decode pinned in memory
    // until an actual page reload. Falls back to keeping the blob URL only
    // if displayUrl genuinely couldn't be signed (never revoke a URL that's
    // still the only thing rendered).
    const oldBlobUrl = matched.url;
    const newUrl = result.displayUrl ?? matched.url;
    if (result.displayUrl && oldBlobUrl && pendingBlobUrlsRef.current.has(oldBlobUrl)) {
      pendingBlobUrlsRef.current.delete(oldBlobUrl);
      URL.revokeObjectURL(oldBlobUrl);
    }
    // In place, by id, at this item's existing array position -- NOT
    // removed-and-reappended -- so a tile never jumps position or the whole
    // grid reflows as files finish in whatever order they happen to
    // complete. `clientKey` (set at optimistic-placeholder creation, never
    // reassigned) keeps this item's React key stable across this exact
    // id change too, so it never remounts either.
    setOverrideItems((current) =>
      (current ?? itemsRef.current).map((i) =>
        i.id === tempId
          ? {
              ...i,
              id: realId,
              url: newUrl,
              storagePath: realStoragePath,
              posterStoragePath: realPosterStoragePath,
              pending: false,
            }
          : i,
      ),
    );

    // The generic items-diffing effect below can't see this reconciled item
    // (it only ever watches the real server `items` prop, which this never
    // touches -- see grid.ts's own no-revalidation comment), so this is the
    // one place a fresh upload gets its own undo command.
    if (!demoMode && realStoragePath) {
      const mediaType = matched.mediaType;
      const currentRef = { id: realId };
      pushCommand({
        label: "Add media",
        undo: async () => {
          beginMutation();
          try {
            suppressAutoTrackRef.current = true;
            await deleteMedia(projectId, currentRef.id);
            router.refresh();
          } finally {
            endMutation();
          }
        },
        redo: async () => {
          beginMutation();
          try {
            suppressAutoTrackRef.current = true;
            const restored = await restoreMediaAsset(projectId, {
              storagePath: realStoragePath,
              mediaType,
              posterStoragePath: realPosterStoragePath,
            });
            if ("message" in restored) throw new Error(restored.message);
            currentRef.id = restored.id;
            router.refresh();
          } finally {
            endMutation();
          }
        },
      });
    }
  }

  // null = root view (folder tiles + unfoldered assets). Non-null = browsing
  // one folder's assets, with a "back" affordance to return to root.
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const activeFolder = folders.find((f) => f.id === activeFolderId) ?? null;
  const visibleItems = effectiveItems.filter((item) =>
    activeFolderId ? item.folderId === activeFolderId : !item.folderId,
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    onSelectionChange?.(Array.from(selectedIds));
    // Only meant to fire when the selection itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  const [bulkDeleting, startBulkDelete] = useTransition();
  function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected asset${ids.length === 1 ? "" : "s"}? Any already used in a post or story will be archived (removed from the library, kept in place there) instead of deleted.`)) return;
    const idSet = new Set(ids);
    const removedItems = effectiveItems.filter((item) => idSet.has(item.id));
    setOverrideItems(effectiveItems.filter((item) => !idSet.has(item.id)));
    setSelectedIds(new Set());
    // No router.refresh() on success -- the optimistic removal above is
    // already the complete final state (bulkDeleteMedia no longer
    // revalidates this route either, see its own comment), so a refresh
    // would only redo the same round trip for nothing new to show.
    beginMutation();
    startBulkDelete(async () => {
      try {
        await bulkDeleteMedia(projectId, ids);
      } catch (error) {
        console.error("Failed to delete media:", error);
        // Narrow: restore only the ids THIS call removed, not a blanket
        // null -- a concurrent in-flight upload's own optimistic
        // placeholder must not be discarded by an unrelated bulk-delete's
        // failure (Invariant 2 -- see grid-reducer.ts's own comment on the
        // same class of bug in the Grid rows/slots domain).
        setOverrideItems((current) => {
          const cur = current ?? itemsRef.current;
          const stillMissing = removedItems.filter((item) => !cur.some((c) => c.id === item.id));
          return stillMissing.length === 0 ? cur : [...cur, ...stillMissing];
        });
        showError("Couldn't delete those assets. Please try again.");
      } finally {
        endMutation();
      }
    });
  }

  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [moveError, setMoveError] = useState<string | undefined>();
  const [moving, startMove] = useTransition();
  function handleMoveToNewFolder() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || !newFolderName.trim()) return;
    setMoveError(undefined);
    beginMutation();
    startMove(async () => {
      try {
        const result = await createMediaFolder(projectId, newFolderName);
        if ("message" in result) {
          setMoveError(result.message);
          return;
        }
        await moveMediaToFolder(projectId, ids, result.id);
        setSelectedIds(new Set());
        setNewFolderName("");
        setMoveDialogOpen(false);
        router.refresh();
      } finally {
        endMutation();
      }
    });
  }

  // A fresh upload gets its own "Add media" command directly from the
  // reconciliation effect above (it knows the real id/paths immediately,
  // no page refresh needed). This effect instead catches the OTHER way
  // `items` can gain a row this component didn't already know about --
  // most notably a "redo" of a previously-undone upload (restoreMediaAsset
  // + router.refresh(), see below), which needs its own new command so a
  // SECOND undo/redo can act on it. suppressAutoTrackRef (declared above)
  // opts a command-driven items change (that redo, or an undo restoring a
  // deleted asset) out of ALSO being auto-detected here, which would
  // otherwise double it up as a second, redundant "Add media" entry on top
  // of the command already being replayed.
  const prevItemIdsRef = useRef(new Set(items.map((i) => i.id)));
  useEffect(() => {
    if (demoMode) return;
    const prevIds = prevItemIdsRef.current;
    const newItems = items.filter((item) => !prevIds.has(item.id));
    prevItemIdsRef.current = new Set(items.map((i) => i.id));

    if (!suppressAutoTrackRef.current) {
      for (const item of newItems) {
        if (!item.storagePath) continue;
        const storagePath = item.storagePath;
        const posterStoragePath = item.posterStoragePath ?? null;
        // A mutable holder, not a captured constant -- each undo/redo cycle
        // after the first restores the asset under a brand-new id (the
        // original row is gone for good once deleted), so both directions
        // need to read/write whatever the CURRENT id is, not the one this
        // command was created with.
        const current = { id: item.id };
        pushCommand({
          label: "Add media",
          undo: async () => {
            beginMutation();
            try {
              suppressAutoTrackRef.current = true;
              await deleteMedia(projectId, current.id);
              router.refresh();
            } finally {
              endMutation();
            }
          },
          redo: async () => {
            beginMutation();
            try {
              suppressAutoTrackRef.current = true;
              const result = await restoreMediaAsset(projectId, {
                storagePath,
                mediaType: item.mediaType,
                posterStoragePath,
              });
              if ("message" in result) throw new Error(result.message);
              current.id = result.id;
              router.refresh();
            } finally {
              endMutation();
            }
          },
        });
      }
    }
    suppressAutoTrackRef.current = false;
    // Only ever meant to react to `items` itself changing -- projectId is
    // static per-mount and pushCommand/router are stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  return (
    <div className="flex flex-col gap-3">
      {!demoMode && (
        <form ref={formRef} className="flex flex-col gap-2">
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
              setUploadError(null);
              if (files.length === 0) return;

              // Instant thumbnail from the file the browser already has in
              // memory -- no network round trip needed to show it. tempId
              // doubles as both the correlation token handleUploadResult
              // matches its eventual result against, AND (via clientKey) the
              // React key that stays stable across the temp -> real id swap.
              const optimistic = files.map((file) => {
                const url = URL.createObjectURL(file);
                pendingBlobUrlsRef.current.add(url);
                const tempId = `optimistic-${crypto.randomUUID()}`;
                return {
                  file,
                  tempId,
                  item: {
                    id: tempId,
                    clientKey: tempId,
                    url,
                    mediaType: (file.type.startsWith("video/") ? "video" : "image") as MediaLibraryItem["mediaType"],
                    // Shown immediately, but not draggable/selectable until
                    // handleUploadResult clears this once uploadMedia's
                    // insert actually resolves.
                    pending: true,
                  } satisfies MediaLibraryItem,
                };
              });
              // Placeholders keep this exact selection order and each is
              // replaced IN PLACE at its own position on completion (see
              // handleUploadResult) -- never removed-and-reappended, so
              // finishing in a different order than selected (expected and
              // normal with concurrency > 1) never reshuffles the grid.
              setOverrideItems([...effectiveItems, ...optimistic.map((o) => o.item)]);
              for (let i = 0; i < optimistic.length; i++) beginMutation();
              // Adds to any already-in-progress batch rather than replacing
              // it -- selecting more files while an earlier batch is still
              // uploading grows the running total instead of resetting the
              // visible progress back to a smaller number.
              setUploadBatch((current) => ({
                total: (current?.total ?? 0) + optimistic.length,
                done: current?.done ?? 0,
              }));

              uploadFilesConcurrently(
                projectId,
                optimistic.map((o) => ({ file: o.file, tempId: o.tempId })),
                (formData) => uploadMedia(projectId, undefined, formData),
                handleUploadResult,
                UPLOAD_CONCURRENCY,
              );
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
            {uploadBatch ? `Uploading ${uploadBatch.done} / ${uploadBatch.total}` : "Upload Assets"}
          </Button>
          {uploadError && <p className="text-xs text-error">{uploadError}</p>}
        </form>
      )}

      {activeFolder ? (
        <button
          type="button"
          onClick={() => setActiveFolderId(null)}
          className="flex items-center gap-1 text-xs tracking-wide text-muted uppercase hover:text-foreground"
        >
          ← All Media <span className="text-foreground">/ {activeFolder.name}</span>
        </button>
      ) : null}

      {/* Capped to roughly 9 rows (grid-cols-3, ~82px square cells at this
          sidebar's w-64 width, plus gaps) so a project with hundreds of
          uploads doesn't grow the sidebar unboundedly -- scrolls internally
          for anything past that instead. Uncapped in demoMode: the landing
          page's demo library is small and deliberately rendered much wider
          than the real sidebar, where this cap would just crop the hero
          panel oddly.

          --tile-row-h/auto-rows, not each tile's own aspect-square, is what
          actually sizes every row here -- same root cause and same fix as
          story-editor.tsx's/post-editor.tsx's own "Add from library" grids:
          an aspect-square tile's height is DERIVED from its resolved width
          only after layout, so a burst of many tiles landing in the DOM at
          once (a real batch upload's optimistic placeholders, all inserted
          in a single setState) can get measured/painted before that
          derivation settles, especially on WebKit -- confirmed live via
          Playwright screenshots at 50-item batches: every tile collapsed to
          a thin horizontal strip in WebKit, and the below-the-fold tiles did
          the same in Chromium. An explicit, fixed row height has no
          dependency on any child's aspect-ratio or load state at all, so
          that race can't recur regardless of batch size or browser. 83px
          measured live against this exact sidebar's real lg:w-64 width
          (82.66px), not guessed. */}
      <div
        className={`grid grid-cols-3 gap-1 [--tile-row-h:83px] auto-rows-[var(--tile-row-h)] ${demoMode ? "" : "max-h-[620px] overflow-y-auto"}`}
      >
        {!activeFolderId &&
          folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setActiveFolderId(folder.id)}
              title={folder.name}
              className="group flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-md p-1.5 text-center transition-colors duration-150 hover:bg-black/[.04]"
            >
              <FolderIcon className="h-6 w-6 shrink-0 text-muted/70 transition-colors duration-150 group-hover:text-foreground" />
              <span className="line-clamp-2 w-full break-words text-[10px] leading-tight text-muted">
                {folder.name}
              </span>
            </button>
          ))}
        {visibleItems.map((item) => (
          <MediaThumb
            key={item.clientKey ?? item.id}
            item={item}
            selected={selectedIds.has(item.id)}
            onToggleSelect={() => toggleSelected(item.id)}
          />
        ))}
        {!demoMode && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Add assets"
            className="flex min-w-0 items-center justify-center rounded-none border border-dashed border-border text-lg text-muted transition-colors duration-150 hover:border-foreground/30"
          >
            +
          </button>
        )}
      </div>

      {!demoMode && selectedIds.size > 0 && (
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 border border-border bg-card px-3 py-2 shadow-[0_2px_10px_rgba(0,0,0,0.1)]">
          <span className="text-xs tracking-wide text-muted uppercase">{selectedIds.size} selected</span>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="secondary"
              radius="none"
              onClick={() => setMoveDialogOpen(true)}
              className="px-2 py-1 text-xs"
            >
              Move to Folder
            </Button>
            <Button
              type="button"
              variant="primary"
              radius="none"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="px-2 py-1 text-xs"
            >
              {bulkDeleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={moveDialogOpen}
        onClose={() => {
          setMoveDialogOpen(false);
          setMoveError(undefined);
        }}
        title="Move to New Folder"
        radius="none"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleMoveToNewFolder();
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs tracking-wide text-muted uppercase">Folder name</span>
            <input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. Q1 Campaign"
              className="rounded-none border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
          </label>
          {moveError && <p className="text-xs text-error">{moveError}</p>}
          <Button
            type="submit"
            variant="primary"
            radius="none"
            disabled={moving || !newFolderName.trim()}
            className="w-full py-2.5 text-xs tracking-wide uppercase"
          >
            {moving ? "Moving…" : `Create & Move ${selectedIds.size} Asset${selectedIds.size === 1 ? "" : "s"}`}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" strokeLinejoin="round" />
    </svg>
  );
}

function MediaThumb({
  item,
  selected,
  onToggleSelect,
}: {
  item: MediaLibraryItem;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `media-${item.id}`,
    data: { mediaAssetId: item.id, item },
    // Still uploading -- not a real, persisted asset yet, so it can't be
    // dropped onto a Grid slot (assignMediaToSlot needs a real
    // media_assets row to reference). dnd-kit never starts a drag at all
    // when disabled, so there's no drop event to separately guard.
    disabled: item.pending,
  });

  return (
    <div
      className={`group relative min-w-0 touch-none overflow-hidden border border-border transition-[opacity,border-color] duration-150 ${
        isDragging ? "cursor-grabbing opacity-30" : item.pending ? "cursor-default" : "cursor-grab hover:border-foreground/30"
      }`}
    >
      <div ref={setNodeRef} {...listeners} {...attributes} className="absolute inset-0">
        <MediaThumbPreview item={item} hideGridBadge />
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        disabled={item.pending}
        title={item.pending ? "Uploading…" : selected ? "Deselect" : "Select"}
        // pointer-coarse: touch has no hover state to reveal this with, so
        // it's always shown there (matching the picker dialog's own
        // always-visible delete button, which already handles this same
        // case) -- desktop keeps the existing hover-only reveal unchanged.
        className={`absolute left-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full transition-opacity duration-150 group-hover:opacity-100 pointer-coarse:opacity-100 disabled:pointer-events-none ${
          selected ? "opacity-100" : "opacity-0"
        }`}
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
      </button>
      {item.usedInGrid && (
        <span
          title="Already on the Grid"
          className="pointer-events-none absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-white"
        >
          <GridUsageIcon className="h-2.5 w-2.5" />
        </span>
      )}
    </div>
  );
}
