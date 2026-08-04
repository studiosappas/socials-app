"use client";

import { useActionState, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import { uploadMedia } from "@/lib/actions/grid";
import { Button } from "@/components/ui/button";
import type { MediaLibraryItem } from "./grid-board";

export function MediaThumbPreview({
  item,
  className = "",
}: {
  item: MediaLibraryItem;
  className?: string;
}) {
  return (
    <div className={`h-full w-full overflow-hidden ${className}`}>
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
      <form ref={formRef} action={action} className="flex flex-col gap-2" key={items.length}>
        <input
          ref={fileInputRef}
          type="file"
          name="file"
          accept="image/*,video/*"
          multiple
          required
          className="hidden"
          onChange={() => formRef.current?.requestSubmit()}
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

      <div className="grid grid-cols-3 gap-1">
        {items.map((item) => (
          <MediaThumb key={item.id} item={item} />
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

function MediaThumb({ item }: { item: MediaLibraryItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `media-${item.id}`,
    data: { mediaAssetId: item.id, item },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`aspect-square touch-none overflow-hidden rounded-none border border-border transition-[opacity,border-color] duration-150 ${
        isDragging ? "cursor-grabbing opacity-30" : "cursor-grab hover:border-foreground/30"
      }`}
    >
      <MediaThumbPreview item={item} />
    </div>
  );
}
