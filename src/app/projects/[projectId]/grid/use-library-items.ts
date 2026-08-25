"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  bulkDeleteMedia,
  deleteMedia,
  restoreMediaAsset,
  uploadMedia,
  type UploadMediaState,
} from "@/lib/actions/grid";
import { uploadFilesConcurrently, type ConcurrentUploadOutcome } from "@/lib/video-poster";
import { useToast } from "@/lib/hooks/use-toast";
import type { UndoableCommand } from "@/lib/hooks/use-undo-stack";
import type { MediaLibraryItem } from "./grid-board";

// Same value and reasoning as this hook's own former home
// (media-library.tsx): 1 (sequential) let one slow file stall the whole
// remaining batch; unbounded parallel risks the simultaneous-decode
// pressure the thin-strip fix already had to account for. 3 balances both.
const UPLOAD_CONCURRENCY = 3;

// The Library's item-data logic -- upload, delete, bulk-delete, and the
// optimistic override/reconciliation machinery underneath all three --
// extracted into one hook so it can have exactly ONE live instance shared
// by both surfaces that show it (the sidebar MediaLibrary and the touch
// MediaPickerDialog), instead of the two independent copies each carried
// on its own before this round. That was a real, reachable divergence, not
// just a smell: both surfaces are mounted simultaneously in Grid regardless
// of viewport (the sidebar's `hidden lg:block` only hides it visually,
// clicking an empty slot opens the dialog on ANY viewport including
// desktop) -- so a desktop user could upload via the sidebar, then click
// an empty slot and see the dialog's own STALE copy, missing the upload
// that's still only optimistically visible in the sidebar's own state
// (uploads deliberately no longer trigger any revalidation -- see grid.ts).
//
// GridBoard calls this ONCE and passes the result down to both surfaces.
// MediaLibrary (media-library.tsx) ALSO still calls it internally so it
// stays fully self-contained for its OTHER caller (the landing page's
// Chapter 01 demo, which has nothing to do with Grid and must not change
// behavior) -- see MediaLibrary's own `sharedLibrary` prop for how it
// chooses which instance's data to actually render.
export function useLibraryItems(
  projectId: string,
  items: MediaLibraryItem[],
  pushCommand: (command: UndoableCommand) => void,
  demoMode: boolean,
) {
  const router = useRouter();
  const { showError } = useToast();

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadBatch, setUploadBatch] = useState<{ total: number; done: number } | null>(null);
  function advanceUploadBatch() {
    setUploadBatch((current) => {
      if (!current) return null;
      const done = current.done + 1;
      return done >= current.total ? null : { total: current.total, done };
    });
  }

  const [prevItems, setPrevItems] = useState(items);
  const [overrideItems, setOverrideItems] = useState<MediaLibraryItem[] | null>(null);
  const pendingBlobUrlsRef = useRef<Set<string>>(new Set());
  const suppressAutoTrackRef = useRef(false);
  const [pendingMutations, setPendingMutations] = useState(0);
  const beginMutation = useCallback(() => setPendingMutations((n) => n + 1), []);
  const endMutation = useCallback(() => setPendingMutations((n) => Math.max(0, n - 1)), []);
  if (items !== prevItems) {
    setPrevItems(items);
    if (pendingMutations === 0) setOverrideItems(null);
  }
  const effectiveItems = overrideItems ?? items;
  const itemsRef = useRef(effectiveItems);
  useEffect(() => {
    itemsRef.current = effectiveItems;
  }, [effectiveItems]);

  useEffect(() => {
    for (const url of pendingBlobUrlsRef.current) URL.revokeObjectURL(url);
    pendingBlobUrlsRef.current = new Set();
  }, [items]);

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

    const oldBlobUrl = matched.url;
    const newUrl = result.displayUrl ?? matched.url;
    if (result.displayUrl && oldBlobUrl && pendingBlobUrlsRef.current.has(oldBlobUrl)) {
      pendingBlobUrlsRef.current.delete(oldBlobUrl);
      URL.revokeObjectURL(oldBlobUrl);
    }
    setOverrideItems((current) =>
      (current ?? itemsRef.current).map((i) =>
        i.id === tempId
          ? { ...i, id: realId, url: newUrl, storagePath: realStoragePath, posterStoragePath: realPosterStoragePath, pending: false }
          : i,
      ),
    );

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

  // Placeholders keep selection order, replaced IN PLACE at their own
  // position on completion (handleUploadResult) -- never removed-and-
  // reappended, so finishing in a different order than selected (expected
  // with concurrency > 1) never reshuffles either surface.
  const uploadFiles = useCallback(
    (files: File[]) => {
      setUploadError(null);
      if (files.length === 0) return;
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
            pending: true,
          } satisfies MediaLibraryItem,
        };
      });
      setOverrideItems((current) => [...(current ?? itemsRef.current), ...optimistic.map((o) => o.item)]);
      for (let i = 0; i < optimistic.length; i++) beginMutation();
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
    },
    // handleUploadResult and beginMutation close over stable/current values
    // already (itemsRef, functional setState); intentionally not listed to
    // avoid this recreating on every render, matching the original
    // component's own equivalent inline handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId],
  );

  const deleteItem = useCallback(
    (mediaAssetId: string) => {
      const removedItem = itemsRef.current.find((item) => item.id === mediaAssetId) ?? null;
      setOverrideItems((current) => (current ?? itemsRef.current).filter((item) => item.id !== mediaAssetId));
      beginMutation();
      return (async () => {
        try {
          await deleteMedia(projectId, mediaAssetId);
        } catch (error) {
          console.error("Failed to delete media:", error);
          setOverrideItems((current) => {
            const cur = current ?? itemsRef.current;
            if (!removedItem || cur.some((i) => i.id === removedItem.id)) return cur;
            return [...cur, removedItem];
          });
          showError("Couldn't delete this asset. Please try again.");
        } finally {
          endMutation();
        }
      })();
    },
    [projectId, beginMutation, endMutation, showError],
  );

  const bulkDeleteItems = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return Promise.resolve();
      const idSet = new Set(ids);
      const removedItems = itemsRef.current.filter((item) => idSet.has(item.id));
      setOverrideItems((current) => (current ?? itemsRef.current).filter((item) => !idSet.has(item.id)));
      beginMutation();
      return (async () => {
        try {
          await bulkDeleteMedia(projectId, ids);
        } catch (error) {
          console.error("Failed to delete media:", error);
          setOverrideItems((current) => {
            const cur = current ?? itemsRef.current;
            const stillMissing = removedItems.filter((item) => !cur.some((c) => c.id === item.id));
            return stillMissing.length === 0 ? cur : [...cur, ...stillMissing];
          });
          showError("Couldn't delete those assets. Please try again.");
        } finally {
          endMutation();
        }
      })();
    },
    [projectId, beginMutation, endMutation, showError],
  );

  // Catches an `items` change this hook didn't itself cause (most notably a
  // redo of a previously-undone upload) so a SECOND undo/redo can act on
  // it -- see suppressAutoTrackRef's own use above.
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
              const result = await restoreMediaAsset(projectId, { storagePath, mediaType: item.mediaType, posterStoragePath });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  return {
    effectiveItems,
    uploadError,
    uploadBatch,
    uploadFiles,
    deleteItem,
    bulkDeleteItems,
  };
}

export type LibraryItemsController = ReturnType<typeof useLibraryItems>;
