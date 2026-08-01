"use client";

import { useActionState, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import { uploadMedia } from "@/lib/actions/grid";
import { Button } from "@/components/ui/button";
import type { MediaLibraryItem } from "./grid-board";

export function MediaLibrary({
  projectId,
  items,
}: {
  projectId: string;
  items: MediaLibraryItem[];
}) {
  const [state, action, pending] = useActionState(
    uploadMedia.bind(null, projectId),
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs tracking-wide text-muted uppercase">Assets</p>
      <form ref={formRef} action={action} className="flex flex-col gap-2" key={items.length}>
        <input
          ref={fileInputRef}
          type="file"
          name="file"
          accept="image/*,video/*"
          required
          className="hidden"
          onChange={() => formRef.current?.requestSubmit()}
        />
        <Button
          type="button"
          variant="primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={pending}
          className="w-full"
        >
          {pending ? "Uploading..." : "↑ Upload assets"}
        </Button>
        {state?.message && <p className="text-xs text-error">{state.message}</p>}
      </form>

      <div className="grid grid-cols-3 gap-1">
        {items.map((item) => (
          <MediaThumb key={item.id} item={item} />
        ))}
      </div>
      {items.length === 0 && (
        <p className="text-xs text-muted">No unplaced assets here.</p>
      )}
    </div>
  );
}

function MediaThumb({ item }: { item: MediaLibraryItem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `media-${item.id}`,
    data: { mediaAssetId: item.id },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 10,
        position: "relative" as const,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={style}
      className={`aspect-square touch-none overflow-hidden rounded border border-border ${
        isDragging ? "cursor-grabbing opacity-50" : "cursor-grab"
      }`}
    >
      {item.url && item.mediaType === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt="" className="h-full w-full object-cover" draggable={false} />
      )}
      {item.url && item.mediaType === "video" && (
        <video src={item.url} className="h-full w-full object-cover" muted />
      )}
    </div>
  );
}
