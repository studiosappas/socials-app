"use client";

import { useActionState, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
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
import {
  addPostAsset,
  addPostLink,
  removePostAsset,
  removePostLink,
  reorderPostAssets,
  replacePostAsset,
  updatePost,
  uploadPostAsset,
} from "@/lib/actions/posts";
import { saveMediaAssetAnnotation, saveMediaAssetPosterAnnotation } from "@/lib/actions/media";
import { updatePostCoverTransform } from "@/lib/actions/grid";
import { uploadFilesWithPosters } from "@/lib/video-poster";
import { DROP_ANIMATION, SORTABLE_TRANSITION } from "@/lib/dnd-motion";
import { downloadAsset, filenameFromUrl } from "@/lib/download-zip";
import { saveAs } from "file-saver";
import { convertToTask } from "@/lib/actions/todo";
import { addPostComment, fetchPostComments } from "@/lib/actions/post-comments";
import { Button } from "@/components/ui/button";
import { AnnotationEditor } from "@/components/annotation-editor";
import { ItemComments } from "@/components/ui/item-comments";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { useUndoStack, useUndoRedoShortcuts } from "@/lib/hooks/use-undo-stack";
import { BrandWriterField } from "@/components/ai/brand-writer";
import { UndoIcon, type GridCoverTransform, type MediaLibraryItem } from "../../grid/grid-board";
import { GridCropOverlay, coverTransformStyle } from "../../grid/grid-crop-overlay";
import type { CustomFontFace } from "@/lib/data/brand-moodboard";
import type { PostStatus, PostType, ReviewStatus } from "@/types/database";
import type { ProjectMemberOption } from "@/lib/data/post-comments";

// Module-level constants (not object literals inline in JSX) so the same
// reference is passed on every render regardless of which asset is being
// edited -- 1080x1350 cover, 1080x1440 carousel slide.
const COVER_ASPECT = { w: 4, h: 5 };
const SLIDE_ASPECT = { w: 3, h: 4 };

export type PostAssetItem = {
  postAssetId: string;
  mediaAssetId: string;
  url: string | null;
  originalUrl: string | null;
  annotationJson: object | null;
  mediaType: "image" | "video";
  // Only ever set for mediaType "video" -- the manually-picked/annotated
  // cover frame (see saveMediaAssetPosterAnnotation), same source Grid's
  // own cover resolves from. Without this, this page's own asset tile had
  // no way to reflect a saved cover change at all -- it always showed the
  // raw <video> element instead, which looks identical whether a cover was
  // ever picked or not.
  posterUrl: string | null;
};
export type PostLinkItem = { id: string; url: string; label: string };

type EditingImage = {
  mediaAssetId: string;
  imageUrl: string;
  annotationJson: object | null;
  mediaType: "image" | "video";
  // Position 0 in the post's own asset order is its cover; every other
  // position is a carousel slide -- the two get different export targets
  // (4:5 cover vs 3:4 slide), see targetAspect below.
  isCover: boolean;
};

type PostRecord = {
  id: string;
  post_type: PostType;
  caption: string;
  notes: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  status: PostStatus;
  review_status: ReviewStatus;
  // The one canonical crop for this post's cover asset (position 0) -- same
  // value Grid's own crop tool reads/writes.
  coverTransform: GridCoverTransform | null;
};

const labelClass = "text-xs tracking-wide text-muted uppercase";
const fieldClass =
  "w-full rounded-none border border-foreground bg-transparent px-3 py-2 text-sm focus:outline-none";

export function PostEditor({
  projectId,
  post,
  assets,
  links,
  mediaLibrary,
  canManage,
  currentUserId,
  members,
  customFonts = [],
  hideBackLink = false,
}: {
  projectId: string;
  post: PostRecord;
  assets: PostAssetItem[];
  links: PostLinkItem[];
  mediaLibrary: MediaLibraryItem[];
  canManage: boolean;
  currentUserId: string;
  members: ProjectMemberOption[];
  customFonts?: CustomFontFace[];
  hideBackLink?: boolean;
}) {
  const router = useRouter();
  const [prevAssets, setPrevAssets] = useState(assets);
  const [orderedAssets, setOrderedAssets] = useState(assets);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [editingImage, setEditingImage] = useState<EditingImage | null>(null);
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  function handleAnnotationSaved() {
    setEditingImage(null);
    router.refresh();
  }

  if (assets !== prevAssets) {
    setPrevAssets(assets);
    setOrderedAssets(assets);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // Its own history stack, separate from Grid's -- the carousel only exists
  // on this page, so there's no cross-page state to share.
  const { push: pushCommand, undo, redo, canUndo, canRedo, isBusy: undoRedoBusy } = useUndoStack();
  useUndoRedoShortcuts(undo, redo);

  function handleDragStart(event: DragStartEvent) {
    setActiveAssetId(event.active.id as string);
  }

  function applyReorder(next: PostAssetItem[]) {
    setOrderedAssets(next);
    startTransition(async () => {
      await reorderPostAssets(projectId, post.id, next.map((a) => a.postAssetId));
      router.refresh();
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveAssetId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedAssets.findIndex((a) => a.postAssetId === active.id);
    const newIndex = orderedAssets.findIndex((a) => a.postAssetId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const before = orderedAssets;
    const next = arrayMove(orderedAssets, oldIndex, newIndex);
    applyReorder(next);
    pushCommand({
      label: "Reorder carousel",
      undo: () => applyReorder(before),
      redo: () => applyReorder(next),
    });
  }

  const activeAsset = orderedAssets.find((a) => a.postAssetId === activeAssetId) ?? null;

  const usedMediaIds = new Set(orderedAssets.map((a) => a.mediaAssetId));
  const availableMedia = mediaLibrary.filter((m) => !usedMediaIds.has(m.id));

  const [downloading, setDownloading] = useState(false);
  async function handleDownloadAll() {
    setDownloading(true);
    try {
      // Hits the server export route instead of zipping raw source bytes --
      // this needs real per-asset resizing (1080x1350 cover / 1080x1440
      // slides) and must apply the user's saved crop, neither of which a
      // client-side byte-for-byte zip (downloadAssetsAsZip) can do.
      const response = await fetch(`/projects/${projectId}/posts/${post.id}/export`);
      if (!response.ok) return;
      const blob = await response.blob();
      saveAs(blob, `post-${post.id}-export.zip`);
    } finally {
      setDownloading(false);
    }
  }

  function scrollMediaRight() {
    scrollRef.current?.scrollBy({ left: 240, behavior: "smooth" });
  }

  return (
    <div className="flex flex-col gap-6">
      {!hideBackLink && (
        <Link
          href={`/projects/${projectId}/grid`}
          className="text-sm text-muted transition-colors duration-150 hover:text-foreground"
        >
          ← Back to grid
        </Link>
      )}

      <div className="relative">
        {canManage && orderedAssets.length > 1 && (
          <div className="mb-2 flex items-center gap-1">
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
        )}
        <DndContext
          id={`post-dnd-${post.id}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveAssetId(null)}
        >
          <SortableContext
            items={orderedAssets.map((a) => a.postAssetId)}
            strategy={rectSortingStrategy}
          >
            <div ref={scrollRef} className="flex gap-2 overflow-x-auto scroll-smooth pb-1">
              {orderedAssets.map((asset, index) => (
                <SortableAsset
                  key={asset.postAssetId}
                  asset={asset}
                  canManage={canManage}
                  isCover={index === 0}
                  coverTransform={post.coverTransform}
                  projectId={projectId}
                  postId={post.id}
                  mediaLibrary={mediaLibrary}
                  onRemove={() =>
                    startTransition(async () => {
                      await removePostAsset(projectId, post.id, asset.postAssetId);
                      router.refresh();
                    })
                  }
                  onEditImage={() =>
                    asset.mediaAssetId &&
                    asset.originalUrl &&
                    setEditingImage({
                      mediaAssetId: asset.mediaAssetId,
                      imageUrl: asset.originalUrl,
                      annotationJson: asset.annotationJson,
                      mediaType: asset.mediaType,
                      isCover: index === 0,
                    })
                  }
                />
              ))}
              {canManage && (
                <UploadAssetTile projectId={projectId} postId={post.id} onUploaded={() => router.refresh()} />
              )}
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={DROP_ANIMATION}>
            {activeAsset && (
              <div className="aspect-[3/4] w-20 cursor-grabbing overflow-hidden rounded border border-foreground/20 shadow-[0_2px_10px_rgba(0,0,0,0.1)]">
                <AssetPreview
                  asset={activeAsset}
                  coverTransform={orderedAssets[0]?.postAssetId === activeAssetId ? post.coverTransform : null}
                />
              </div>
            )}
          </DragOverlay>
        </DndContext>
        {orderedAssets.length > 3 && (
          <button
            type="button"
            onClick={scrollMediaRight}
            title="Scroll for more"
            className="absolute right-0 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-muted transition-colors duration-150 hover:text-foreground"
          >
            ›
          </button>
        )}
      </div>

      {orderedAssets.length > 0 ? (
        <Button
          type="button"
          variant="primary"
          radius="none"
          onClick={handleDownloadAll}
          disabled={downloading}
          className="w-fit self-start px-6 py-3 text-xs tracking-wide uppercase"
        >
          {downloading ? "Preparing…" : "Download Media"}
        </Button>
      ) : (
        <p className="text-xs text-muted">No images yet — upload one or add from the library below.</p>
      )}

      {canManage && availableMedia.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className={labelClass}>Add from library</span>
          {/* Capped to roughly 9 rows on the full page, bounded by viewport
              height too so it doesn't grow unboundedly with a project's full
              media library. Inside the Grid/Stories popup (hideBackLink) the
              modal itself is already space-constrained, so cap to a single
              visible row there instead -- scrolls internally either way. */}
          <div
            className={`grid grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6 ${
              hideBackLink ? "max-h-48" : "max-h-[min(1000px,65vh)]"
            }`}
          >
            {availableMedia.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    await addPostAsset(projectId, post.id, item.id);
                    router.refresh();
                  })
                }
                className="relative aspect-[3/4] min-w-0 overflow-hidden rounded-none border border-border transition-opacity duration-150 active:opacity-70"
              >
                {item.url && item.mediaType === "image" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="" className="h-full w-full object-cover" />
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
              </button>
            ))}
          </div>
        </section>
      )}

      <PostMainForm
        projectId={projectId}
        post={post}
        links={links}
        canManage={canManage}
      />

      <ItemComments
        itemId={post.id}
        currentUserId={currentUserId}
        members={members}
        fetchComments={fetchPostComments}
        addComment={(id, text) => addPostComment(projectId, id, text)}
      />

      <AnnotationEditor
        projectId={projectId}
        attachmentId={editingImage?.mediaAssetId ?? null}
        open={editingImage !== null}
        imageUrl={editingImage?.imageUrl ?? null}
        initialAnnotationJson={editingImage?.annotationJson ?? null}
        mediaType={editingImage?.mediaType}
        targetAspect={editingImage ? (editingImage.isCover ? COVER_ASPECT : SLIDE_ASPECT) : undefined}
        onClose={() => setEditingImage(null)}
        onSaved={handleAnnotationSaved}
        saveAction={editingImage?.mediaType === "video" ? saveMediaAssetPosterAnnotation : saveMediaAssetAnnotation}
        customFonts={customFonts}
      />
    </div>
  );
}

function AssetPreview({
  asset,
  coverTransform,
}: {
  asset: PostAssetItem;
  // Only ever non-null for the post's cover (position 0) -- see
  // posts.cover_transform's own comment. Applied with the exact same CSS
  // Grid's own on-screen tile uses (coverTransformStyle), so this always
  // matches what Grid shows.
  coverTransform: GridCoverTransform | null;
}) {
  const style = coverTransformStyle(coverTransform);
  return (
    <>
      {asset.url && asset.mediaType === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={asset.url} alt="" className="h-full w-full object-cover" draggable={false} style={style} />
      )}
      {asset.mediaType === "video" &&
        (asset.posterUrl ? (
          // A picked/annotated cover exists -- show that, same as Grid,
          // instead of the raw video (which would look unchanged either way
          // and never reflects what "Edit Cover" actually saved).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.posterUrl} alt="" className="h-full w-full object-cover" draggable={false} style={style} />
        ) : (
          asset.url && <video src={asset.url} className="h-full w-full object-cover" muted />
        ))}
    </>
  );
}

function SortableAsset({
  asset,
  canManage,
  isCover,
  coverTransform,
  projectId,
  postId,
  mediaLibrary,
  onRemove,
  onEditImage,
}: {
  asset: PostAssetItem;
  canManage: boolean;
  isCover: boolean;
  coverTransform: GridCoverTransform | null;
  projectId: string;
  postId: string;
  mediaLibrary: MediaLibraryItem[];
  onRemove: () => void;
  onEditImage: () => void;
}) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: asset.postAssetId,
    transition: SORTABLE_TRANSITION,
  });
  // Kept alongside dnd-kit's own setNodeRef so ReplaceAssetPopover can
  // compute a fixed portal position from this tile's rect even after the
  // ⋮ menu item that opened it has already unmounted.
  const tileRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

  // Optimistic override so a fresh crop renders immediately instead of
  // waiting for router.refresh() to land -- same "reset when the server
  // prop actually changes" pattern as Grid's own GridSlot.
  const [prevCoverTransform, setPrevCoverTransform] = useState(coverTransform);
  const [overrideTransform, setOverrideTransform] = useState<GridCoverTransform | null | undefined>(undefined);
  if (coverTransform !== prevCoverTransform) {
    setPrevCoverTransform(coverTransform);
    setOverrideTransform(undefined);
  }
  const effectiveTransform = overrideTransform !== undefined ? overrideTransform : coverTransform;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function handleDownload() {
    setMenuOpen(false);
    if (!asset.originalUrl) return;
    setDownloading(true);
    downloadAsset(asset.originalUrl, filenameFromUrl(asset.originalUrl, "asset")).finally(() =>
      setDownloading(false),
    );
  }

  async function handleSaveCrop(next: GridCoverTransform) {
    setOverrideTransform(next);
    setCropMode(false);
    await updatePostCoverTransform(projectId, postId, next);
    router.refresh();
  }

  // A video's crop tool operates on its picked poster frame (a static
  // image) -- the raw video file itself can't be panned/zoomed like Grid's
  // crop overlay expects. No poster yet means nothing to crop.
  const cropImageUrl = asset.mediaType === "video" ? asset.posterUrl : asset.url;

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        tileRef.current = el;
      }}
      style={style}
      {...(canManage ? { ...attributes, ...listeners } : {})}
      className={`relative aspect-[3/4] w-24 shrink-0 touch-none rounded-none border border-border transition-opacity duration-150 ${
        canManage ? "cursor-grab" : ""
      } ${isDragging ? "opacity-30" : ""}`}
    >
      {/* overflow-hidden lives on this inner wrapper, not the slot's root --
          the ⋮ dropdown below is a sibling, not a descendant, of this
          clipped box, so it isn't clipped along with it. Same fix as the
          Grid slot's own ⋮ menu (grid-board.tsx). */}
      <div className={`absolute inset-0 ${cropMode ? "" : "overflow-hidden"}`}>
        <AssetPreview asset={asset} coverTransform={isCover ? effectiveTransform : null} />
      </div>
      {canManage && (
        <div ref={menuRef} className="absolute left-1 top-1 z-10">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title="Frame options"
            className="rounded bg-black/70 px-1.5 py-0.5 text-xs text-white transition-colors duration-150 hover:bg-black/85"
          >
            ⋮
          </button>
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute left-0 top-6 w-32 max-w-[calc(100vw-1.5rem)] rounded-none border border-border bg-background p-1 shadow-lg"
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onEditImage();
                }}
                className="w-full rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
              >
                {asset.mediaType === "video" ? "Edit Cover" : "Edit Image"}
              </button>
              {isCover && cropImageUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setCropMode(true);
                  }}
                  className="w-full rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                >
                  Crop
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setReplaceOpen(true);
                }}
                className="w-full rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="w-full rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05] disabled:opacity-60"
              >
                {downloading ? "Downloading..." : "Download"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
                className="w-full rounded px-2 py-1 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05]"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
      {cropMode && cropImageUrl && (
        <GridCropOverlay
          imageUrl={cropImageUrl}
          initialTransform={effectiveTransform}
          onSave={handleSaveCrop}
          onCancel={() => setCropMode(false)}
        />
      )}
      {replaceOpen && (
        <ReplaceAssetPopover
          projectId={projectId}
          postId={postId}
          postAssetId={asset.postAssetId}
          mediaLibrary={mediaLibrary.filter((m) => m.id !== asset.mediaAssetId)}
          anchorRef={tileRef}
          onClose={() => setReplaceOpen(false)}
        />
      )}
    </div>
  );
}

// Swap this frame's media in place -- upload a new file, or pick an
// existing library asset -- rather than the old delete-then-re-add, which
// lost carousel position and any per-asset crop. Direct action calls +
// startTransition (not useActionState) since "pick a library thumbnail" and
// "pick a file" both need to invoke the same action with differently-built
// FormData, not a single <form> submit.
//
// Rendered via a portal at a fixed, viewport-clamped position computed from
// anchorRef, instead of position:absolute inside the asset strip -- that
// strip sets overflow-x-auto (for horizontal scrolling), which per the CSS
// overflow spec forces its overflow-y to auto too, clipping an
// absolutely-positioned popover that opens below its ~106px-tall row.
function ReplaceAssetPopover({
  projectId,
  postId,
  postAssetId,
  mediaLibrary,
  anchorRef,
  onClose,
}: {
  projectId: string;
  postId: string;
  postAssetId: string;
  mediaLibrary: MediaLibraryItem[];
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useOutsideClick<HTMLDivElement>(true, onClose);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 224; // w-56
    setPosition({
      top: Math.min(rect.bottom + 4, window.innerHeight - 12),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runReplace(formData: FormData) {
    setPending(true);
    setError(undefined);
    startTransition(async () => {
      const result = await replacePostAsset(projectId, postId, postAssetId, undefined, formData);
      setPending(false);
      if (result?.message) {
        setError(result.message);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    runReplace(formData);
  }

  function handlePickLibrary(mediaAssetId: string) {
    const formData = new FormData();
    formData.set("media_asset_id", mediaAssetId);
    runReplace(formData);
  }

  if (!position) return null;

  return createPortal(
    <div
      ref={popoverRef}
      onClick={(e) => e.stopPropagation()}
      style={{ position: "fixed", top: position.top, left: position.left }}
      className="z-20 w-56 max-w-[calc(100vw-1.5rem)] rounded-none border border-border bg-background p-2 shadow-lg"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={pending}
        className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05] disabled:opacity-60"
      >
        {pending ? "Replacing…" : "Upload new file"}
      </button>
      {mediaLibrary.length > 0 && (
        <>
          <p className="mb-1 mt-1.5 px-2 text-[10px] tracking-wide text-muted uppercase">Or choose from library</p>
          <div className="grid max-h-40 grid-cols-4 gap-1 overflow-y-auto">
            {mediaLibrary.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handlePickLibrary(item.id)}
                disabled={pending}
                className="aspect-square min-w-0 overflow-hidden rounded-none border border-border transition-colors duration-150 hover:border-foreground/30 disabled:opacity-60"
              >
                {item.url && item.mediaType === "image" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="" className="h-full w-full object-cover" />
                )}
                {item.url && item.mediaType === "video" && (
                  <video src={item.url} className="h-full w-full object-cover" muted />
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="mt-1 px-2 text-xs text-error">{error}</p>}
    </div>,
    document.body,
  );
}

function UploadAssetTile({
  projectId,
  postId,
  onUploaded,
}: {
  projectId: string;
  postId: string;
  onUploaded: () => void;
}) {
  const [state, action, pending] = useActionState(
    uploadPostAsset.bind(null, projectId, postId),
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.success) onUploaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={formRef} action={action} className="contents">
      <input
        ref={fileInputRef}
        type="file"
        name="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) uploadFilesWithPosters(action, files);
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={pending}
        title="Add media"
        className="flex aspect-[3/4] w-24 shrink-0 items-center justify-center rounded-none border border-dashed border-border text-2xl text-muted transition-colors duration-150 hover:bg-black/[.03] disabled:opacity-60"
      >
        {pending ? "…" : "+"}
      </button>
      {state?.message && <p className="text-xs text-error">{state.message}</p>}
    </form>
  );
}

const POST_TYPES: PostType[] = ["post", "reel", "carousel"];

function PostMainForm({
  projectId,
  post,
  links,
  canManage,
}: {
  projectId: string;
  post: PostRecord;
  links: PostLinkItem[];
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(
    updatePost.bind(null, projectId, post.id),
    undefined,
  );
  // Adding/replacing/removing media auto-suggests the right type (see
  // lib/post-type.ts's syncPostType, which writes posts.post_type directly
  // and revalidates) -- this follows that fresh server value whenever it
  // changes, so the pill selection updates itself, while still staying a
  // real pick the user can override by hand and Save. "Adjust state during
  // render" (this codebase's own convention) rather than an effect, since
  // resetting local state to match a changed prop needs no external sync.
  const [prevPostType, setPrevPostType] = useState(post.post_type);
  const [postType, setPostType] = useState<PostType>(post.post_type);
  if (post.post_type !== prevPostType) {
    setPrevPostType(post.post_type);
    setPostType(post.post_type);
  }
  const [addedToTodo, setAddedToTodo] = useState(false);
  const [todoError, setTodoError] = useState<string | undefined>();
  const [, startTransition] = useTransition();
  const [captionEl, setCaptionEl] = useState<HTMLTextAreaElement | null>(null);

  function handleAddToTodo() {
    setTodoError(undefined);
    startTransition(async () => {
      const result = await convertToTask(projectId, "post", post.id, postType, post.scheduled_date);
      if (result.success) {
        setAddedToTodo(true);
      } else {
        setTodoError(result.message ?? "Couldn't add to To-Do list.");
      }
    });
  }

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="post_type" value={postType} />

      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Post Type</span>
        {/* Auto-selected whenever media changes (1 image = Post, 2+ images
            = Carousel, any video = Reel), but still a real pick -- click
            another and Save to override it. */}
        <div className="flex flex-wrap gap-2">
          {POST_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              disabled={!canManage}
              onClick={() => setPostType(type)}
              className={`flex-1 rounded-full border px-4 py-2 text-xs tracking-wide uppercase transition-colors duration-150 ${
                postType === type
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-foreground hover:border-foreground/40"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between">
          <span className={labelClass}>Caption</span>
          <BrandWriterField projectId={projectId} field={captionEl} disabled={!canManage} />
        </span>
        <textarea
          ref={setCaptionEl}
          name="caption"
          defaultValue={post.caption}
          disabled={!canManage}
          rows={3}
          placeholder="Live text for caption"
          className={fieldClass}
        />
      </label>

      <PostLinks projectId={projectId} postId={post.id} links={links} canManage={canManage} />

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Notes</span>
        <textarea
          name="notes"
          defaultValue={post.notes}
          disabled={!canManage}
          rows={3}
          placeholder="Live text for notes"
          className={fieldClass}
        />
      </label>

      <div className="flex flex-col gap-3">
        <span className={labelClass}>Schedule post</span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Status</span>
            <select name="status" defaultValue={post.status} disabled={!canManage} className={fieldClass}>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Published</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Approval Status</span>
            {/* Same column a client's review-link submission writes to
                (set_post_review_status_by_token) -- this updates automatically
                based on their latest review, and can also be changed manually
                here, same as the workflow Status select next to it. */}
            <select name="review_status" defaultValue={post.review_status} disabled={!canManage} className={fieldClass}>
              <option value="pending">Pending Review</option>
              <option value="approved">Approved</option>
              <option value="changes_requested">Needs Changes</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Schedule date</span>
            <input
              type="date"
              name="scheduled_date"
              defaultValue={post.scheduled_date ?? ""}
              disabled={!canManage}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Schedule time</span>
            <input
              type="time"
              name="scheduled_time"
              defaultValue={post.scheduled_time ?? ""}
              disabled={!canManage}
              className={fieldClass}
            />
          </label>
        </div>
      </div>

      <Button
        type="button"
        variant="primary"
        radius="none"
        onClick={handleAddToTodo}
        disabled={addedToTodo}
        className="w-full py-3 text-xs tracking-wide uppercase"
      >
        {addedToTodo ? "Added to To-Do" : "Add to → To Do List"}
      </Button>
      {todoError && <p className="text-sm text-error">{todoError}</p>}

      {state?.message && <p className="text-sm text-error">{state.message}</p>}

      {canManage && (
        <Button
          type="submit"
          variant="primary"
          radius="none"
          disabled={pending}
          className="w-full py-3 text-xs tracking-wide uppercase"
        >
          {pending ? "Saving..." : "Save Changes"}
        </Button>
      )}
    </form>
  );
}

function PostLinks({
  projectId,
  postId,
  links,
  canManage,
}: {
  projectId: string;
  postId: string;
  links: PostLinkItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const labelRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  function handleAdd() {
    const label = labelRef.current?.value.trim() ?? "";
    const url = urlRef.current?.value.trim() ?? "";
    if (!url) return;
    setPending(true);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("label", label);
      formData.set("url", url);
      const result = await addPostLink(projectId, postId, undefined, formData);
      setPending(false);
      if (result?.message) {
        setMessage(result.message);
        return;
      }
      setMessage(undefined);
      if (labelRef.current) labelRef.current.value = "";
      if (urlRef.current) urlRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className={labelClass}>Links</span>
      {links.length > 0 && (
        <ul className="flex flex-col gap-1">
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-2 text-sm">
              <a href={link.url} target="_blank" rel="noreferrer" className="truncate underline">
                {link.label || link.url}
              </a>
              {canManage && (
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await removePostLink(projectId, postId, link.id);
                      router.refresh();
                    })
                  }
                  className="shrink-0 text-xs text-error transition-colors duration-150 hover:underline"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            ref={labelRef}
            placeholder="Label"
            className="w-full min-w-0 rounded-full border border-border px-3 py-1.5 text-sm focus:border-foreground focus:outline-none sm:w-28"
          />
          <input
            ref={urlRef}
            placeholder="URL"
            className="w-full min-w-0 flex-1 rounded-full border border-border px-3 py-1.5 text-sm focus:border-foreground focus:outline-none"
          />
          <Button
            type="button"
            variant="primary"
            radius="full"
            onClick={handleAdd}
            disabled={pending}
            className="w-full shrink-0 sm:w-auto"
          >
            {pending ? "Adding..." : "Add"}
          </Button>
        </div>
      )}
      {message && <p className="text-xs text-error">{message}</p>}
    </div>
  );
}

// Same glyph as media-library.tsx's own GridUsageIcon (stacked-frames) --
// duplicated, not shared, same convention as the scheduled-content badge
// icons. Kept as its own copy since this badge means something different
// here (reused across carousels) than Grid's "already on the Grid" one.
function CarouselUsageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="7" y="7" width="14" height="14" rx="2" />
      <path d="M3 13V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}
