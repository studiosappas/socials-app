"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import { deleteMedia, restoreMediaAsset, uploadMedia } from "@/lib/actions/grid";
import { uploadFilesWithPosters } from "@/lib/video-poster";
import { Button } from "@/components/ui/button";
import type { UndoableCommand } from "@/lib/hooks/use-undo-stack";
import type { MediaLibraryItem } from "./grid-board";

export function MediaThumbPreview({
  item,
  className = "",
}: {
  item: MediaLibraryItem;
  className?: string;
}) {
  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      {item.url && item.mediaType === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt="" className="h-full w-full object-cover" draggable={false} />
      )}
      {item.url && item.mediaType === "video" && (
        <video src={item.url} className="h-full w-full object-cover" muted />
      )}
      {item.usedInCarousel && (
        <span
          title="Already used in a carousel"
          className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-white"
        >
          <CarouselUsageIcon className="h-2.5 w-2.5" />
        </span>
      )}
    </div>
  );
}

// Stacked-frames glyph -- distinct from the scheduled-content calendar icon
// (grid-board.tsx/story-card.tsx) so the two badge meanings read differently
// at a glance, same "small bg-black/70 corner chip" visual language.
function CarouselUsageIcon({ className }: { className?: string }) {
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
  pushCommand,
}: {
  projectId: string;
  items: MediaLibraryItem[];
  pushCommand: (command: UndoableCommand) => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    uploadMedia.bind(null, projectId),
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Undo/redo of add/delete both round-trip through server actions that
  // change `items` (a new row appears/disappears once revalidatePath lands),
  // so this diff is what turns a spontaneous upload into an undoable "Add
  // media" command -- there's no other signal available client-side, since
  // uploadMedia's action state only ever returns an error message, never the
  // created row's id. suppressAutoTrackRef opts a command-driven items
  // change (an undo restoring a deleted asset, or a redo re-uploading one)
  // out of ALSO being auto-detected here, which would otherwise double it up
  // as a second, redundant "Add media" entry on top of the command already
  // being replayed.
  const prevItemIdsRef = useRef(new Set(items.map((i) => i.id)));
  const suppressAutoTrackRef = useRef(false);
  useEffect(() => {
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
            suppressAutoTrackRef.current = true;
            await deleteMedia(projectId, current.id);
            router.refresh();
          },
          redo: async () => {
            suppressAutoTrackRef.current = true;
            const result = await restoreMediaAsset(projectId, {
              storagePath,
              mediaType: item.mediaType,
              posterStoragePath,
            });
            if ("message" in result) throw new Error(result.message);
            current.id = result.id;
            router.refresh();
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
      <form ref={formRef} action={action} className="flex flex-col gap-2" key={items.length}>
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
          {pending ? "Uploading..." : "Upload Assets"}
        </Button>
        {state?.message && <p className="text-xs text-error">{state.message}</p>}
      </form>

      {/* Capped to roughly 9 rows (grid-cols-3, ~82px square cells at this
          sidebar's w-64 width, plus gaps) so a project with hundreds of
          uploads doesn't grow the sidebar unboundedly -- scrolls internally
          for anything past that instead. */}
      <div className="grid max-h-[620px] grid-cols-3 gap-1 overflow-y-auto">
        {items.map((item) => (
          <MediaThumb
            key={item.id}
            projectId={projectId}
            item={item}
            pushCommand={pushCommand}
            suppressAutoTrackRef={suppressAutoTrackRef}
          />
        ))}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Add assets"
          className="flex aspect-square items-center justify-center rounded-none border border-dashed border-border text-lg text-muted transition-colors duration-150 hover:border-foreground/30"
        >
          +
        </button>
      </div>
    </div>
  );
}

function MediaThumb({
  projectId,
  item,
  pushCommand,
  suppressAutoTrackRef,
}: {
  projectId: string;
  item: MediaLibraryItem;
  pushCommand: (command: UndoableCommand) => void;
  suppressAutoTrackRef: React.MutableRefObject<boolean>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `media-${item.id}`,
    data: { mediaAssetId: item.id, item },
  });

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this asset? This removes it from any post or story using it.")) return;
    // See current(...) in MediaLibrary's "Add media" tracking -- same
    // mutable-id reasoning: a restored asset comes back under a new id, so
    // a second delete/redo cycle needs the current one, not this closure's.
    const storagePath = item.storagePath;
    const posterStoragePath = item.posterStoragePath ?? null;
    const current = { id: item.id };
    startTransition(async () => {
      suppressAutoTrackRef.current = true;
      await deleteMedia(projectId, current.id);
      router.refresh();
      if (storagePath) {
        pushCommand({
          label: "Delete media",
          undo: async () => {
            suppressAutoTrackRef.current = true;
            const result = await restoreMediaAsset(projectId, {
              storagePath,
              mediaType: item.mediaType,
              posterStoragePath,
            });
            if ("message" in result) throw new Error(result.message);
            current.id = result.id;
            router.refresh();
          },
          redo: async () => {
            suppressAutoTrackRef.current = true;
            await deleteMedia(projectId, current.id);
            router.refresh();
          },
        });
      }
    });
  }

  return (
    <div
      className={`group relative aspect-square touch-none overflow-hidden border border-border transition-[opacity,border-color] duration-150 ${
        isDragging ? "cursor-grabbing opacity-30" : "cursor-grab hover:border-foreground/30"
      }`}
    >
      <div ref={setNodeRef} {...listeners} {...attributes} className="absolute inset-0">
        <MediaThumbPreview item={item} />
      </div>
      <button
        type="button"
        onClick={handleDelete}
        title="Delete asset"
        className="absolute right-1 top-1 z-10 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white opacity-0 transition-opacity duration-150 hover:bg-black/85 group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}
