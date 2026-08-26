"use client";

import { Suspense, use, useActionState, useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
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
import { uploadFileDirect, newStoragePath } from "@/lib/direct-upload";
import { validateUploadSize } from "@/lib/upload-limits";
import { DROP_ANIMATION, SORTABLE_TRANSITION } from "@/lib/dnd-motion";
import { filenameFromUrl, shareOrDownloadAsset, shareOriginalAssets } from "@/lib/download-zip";
import { saveAs } from "file-saver";
import { useIsTouchDevice } from "@/lib/hooks/use-is-touch-device";
import { convertToTask } from "@/lib/actions/todo";
import { addPostComment, fetchPostComments } from "@/lib/actions/post-comments";
import { Button } from "@/components/ui/button";
import { AnnotationEditor } from "@/components/annotation-editor";
import { ItemComments } from "@/components/ui/item-comments";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { useUndoStack, useUndoRedoShortcuts } from "@/lib/hooks/use-undo-stack";
import { useToast } from "@/lib/hooks/use-toast";
import { BrandWriterField } from "@/components/ai/brand-writer";
import { UndoIcon, type GridCoverTransform, type MediaLibraryItem } from "../../grid/grid-board";
import { CroppedCoverImage, GridCropOverlay } from "../../grid/grid-crop-overlay";
import type { CustomFontFace } from "@/lib/data/brand-moodboard";
import type { PostStatus, PostType, ProjectRole, ReviewStatus } from "@/types/database";
import { canSubmitClientReview } from "@/lib/role-permissions";
import { submitClientPostReview } from "@/lib/actions/posts";
import type { ProjectMemberOption } from "@/lib/data/post-comments";

// Module-level constants (not object literals inline in JSX) so the same
// reference is passed on every render regardless of which asset is being
// edited -- 1080x1440 cover (3:4), 1080x1350 carousel slide (4:5). Mirrors
// grid-constants.ts's GRID_COVER_ASPECT_RATIO / POST_BODY_ASPECT_RATIO;
// kept as plain {w,h} objects here (not imported) since AnnotationEditor's
// targetAspect prop wants that shape, not a single ratio number.
const COVER_ASPECT = { w: 3, h: 4 };
const SLIDE_ASPECT = { w: 4, h: 5 };

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
  // (3:4 cover vs 4:5 slide), see targetAspect below.
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
  mediaLibraryPromise,
  canManage,
  role,
  currentUserId,
  members,
  customFonts = [],
  hideBackLink = false,
}: {
  projectId: string;
  post: PostRecord;
  assets: PostAssetItem[];
  links: PostLinkItem[];
  // Unresolved on purpose -- the whole-project media library is the one
  // part of the old data fetch that scaled with total project media count,
  // not with this post's own asset count. Only AddFromLibrarySection and
  // ReplaceAssetPopover below actually consume it (via use()), each
  // suspending in its own small boundary, so the primary editor (post
  // fields, asset carousel, links, save) never waits on it.
  mediaLibraryPromise: Promise<MediaLibraryItem[]>;
  canManage: boolean;
  // Raw role, alongside canManage -- only consumed by PostMainForm, to
  // offer Client their own narrow Approval Status control. Every other
  // field/control in this editor keys off canManage exactly as before.
  role: ProjectRole;
  currentUserId: string;
  members: ProjectMemberOption[];
  customFonts?: CustomFontFace[];
  hideBackLink?: boolean;
}) {
  const router = useRouter();
  const { showError } = useToast();
  const [prevAssets, setPrevAssets] = useState(assets);
  const [orderedAssets, setOrderedAssets] = useState(assets);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [editingImage, setEditingImage] = useState<EditingImage | null>(null);
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Replace's "choose from library" option targets THIS asset for
  // replacement, then puts the existing "Add from library" section below
  // into a temporary mode where clicking an item there replaces this asset
  // instead of appending a new one -- see handleLibraryItemClick. null
  // means normal (append) behavior; libraryZoneRef wraps that section so
  // the cancel-on-outside-click effect below can tell a click on a library
  // item apart from a click anywhere else.
  const [replaceTarget, setReplaceTarget] = useState<{ postAssetId: string; isCover: boolean } | null>(null);
  const libraryZoneRef = useRef<HTMLDivElement>(null);

  // Cancels a pending replace-from-library target on Escape or any click
  // outside the library section itself -- opening a different asset's own
  // menu/action is itself a click outside that section, so this also
  // covers "reopening another menu clears it" without needing separate
  // plumbing. No stale target can survive to silently replace an unrelated
  // click later: this effect only exists at all while replaceTarget is
  // set, and clears it (not just closes some UI) the instant either
  // condition fires.
  useEffect(() => {
    if (!replaceTarget) return;
    function handlePointerDown(e: PointerEvent) {
      if (libraryZoneRef.current && !libraryZoneRef.current.contains(e.target as Node)) {
        setReplaceTarget(null);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setReplaceTarget(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [replaceTarget]);

  // Optimistic override for the cover crop -- saveMediaAssetAnnotation/
  // saveMediaAssetPosterAnnotation reset posts.cover_transform server-side
  // whenever the edited asset is the cover (position 0); this mirrors that
  // locally so the carousel never shows a stale crop after an annotation
  // save, without waiting on a route refresh to pick it up. Same
  // undefined-means-"no override" convention as SortableAsset's own
  // overrideTransform below.
  const [prevPost, setPrevPost] = useState(post);
  const [overrideCoverTransform, setOverrideCoverTransform] = useState<GridCoverTransform | null | undefined>(
    undefined,
  );
  if (post !== prevPost) {
    setPrevPost(post);
    setOverrideCoverTransform(undefined);
  }
  const effectiveCoverTransform = overrideCoverTransform !== undefined ? overrideCoverTransform : post.coverTransform;

  // Feature-detected (pointer: coarse), never user-agent sniffed -- gates
  // whether "Download Media" prefers the native OS share sheet (Web Share
  // API Level 2) over a plain file download. See shareOrDownloadZipEntries'
  // own comment for the full reasoning.
  const isTouchDevice = useIsTouchDevice();

  // Optimistic insert -- item.url/mediaType are already known client-side
  // (picked from the already-loaded media library, not a fresh upload), so
  // the new tile can show immediately with a temp postAssetId, then get
  // patched to the real id once addPostAsset resolves. Reverts (removes the
  // placeholder) and surfaces a toast if the insert fails.
  function handleAddFromLibrary(item: MediaLibraryItem) {
    const tempId = `temp-${item.id}-${Date.now()}`;
    const optimisticAsset: PostAssetItem = {
      postAssetId: tempId,
      mediaAssetId: item.id,
      url: item.url,
      // item.originalUrl (always storage_path), not item.url -- item.url may
      // point at a preview for display, and Download must always resolve to
      // the real original (see the type's own comment in grid-board.tsx).
      originalUrl: item.originalUrl ?? item.url,
      annotationJson: null,
      mediaType: item.mediaType as "image" | "video",
      posterUrl: null,
    };
    setOrderedAssets((current) => [...current, optimisticAsset]);
    startTransition(async () => {
      const result = await addPostAsset(projectId, post.id, item.id);
      if (result.success) {
        setOrderedAssets((current) =>
          current.map((a) => (a.postAssetId === tempId ? { ...a, postAssetId: result.postAssetId } : a)),
        );
      } else {
        setOrderedAssets((current) => current.filter((a) => a.postAssetId !== tempId));
        showError(result.message ?? "Couldn't add that asset.");
      }
    });
  }

  // Removes the tile immediately; only reverts + resyncs if the delete
  // actually failed.
  function handleRemoveAsset(postAssetId: string) {
    const before = orderedAssets;
    setOrderedAssets((current) => current.filter((a) => a.postAssetId !== postAssetId));
    startTransition(async () => {
      const result = await removePostAsset(projectId, post.id, postAssetId);
      if (!result.success) {
        setOrderedAssets(before);
        showError(result.message ?? "Couldn't remove that asset.");
        router.refresh();
      }
    });
  }

  // Swapping in a library pick (not a fresh upload) is optimistic for the
  // same reason as handleAddFromLibrary above -- url/mediaType are already
  // known client-side. Replacing the cover also resets its saved crop
  // server-side (the new image may be framed completely differently), so
  // this clears the local override the same way handleAnnotationSaved does
  // for an edited cover.
  function handleReplaceFromLibrary(postAssetId: string, item: MediaLibraryItem, isCover: boolean) {
    const before = orderedAssets;
    setOrderedAssets((current) =>
      current.map((a) =>
        a.postAssetId === postAssetId
          ? {
              ...a,
              mediaAssetId: item.id,
              url: item.url,
              // Same reasoning as handleAddFromLibrary above.
              originalUrl: item.originalUrl ?? item.url,
              annotationJson: null,
              mediaType: item.mediaType as "image" | "video",
              posterUrl: null,
            }
          : a,
      ),
    );
    if (isCover) setOverrideCoverTransform(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("media_asset_id", item.id);
      const result = await replacePostAsset(projectId, post.id, postAssetId, undefined, formData);
      if (result?.message) {
        setOrderedAssets(before);
        if (isCover) setOverrideCoverTransform(undefined);
        showError(result.message);
        router.refresh();
      }
    });
  }

  // Replace's "choose from library" click -- just records which asset is
  // being replaced. The actual replacement happens later, from
  // handleLibraryItemClick, when the user picks an item in the (already
  // visible) library section below.
  function handleChooseFromLibrary(postAssetId: string, isCover: boolean) {
    setReplaceTarget({ postAssetId, isCover });
  }

  // The single click handler the "Add from library" section's items now
  // go through -- branches on whether a replace is pending instead of
  // AddFromLibrarySection needing two different modes/props of its own.
  function handleLibraryItemClick(item: MediaLibraryItem) {
    if (replaceTarget) {
      handleReplaceFromLibrary(replaceTarget.postAssetId, item, replaceTarget.isCover);
      setReplaceTarget(null);
      return;
    }
    handleAddFromLibrary(item);
  }

  function handleAnnotationSaved(previewUrl: string) {
    const target = editingImage;
    setOrderedAssets((current) =>
      current.map((asset) =>
        asset.mediaAssetId === target?.mediaAssetId
          ? target.mediaType === "video"
            ? { ...asset, posterUrl: previewUrl }
            : { ...asset, url: previewUrl }
          : asset,
      ),
    );
    if (target?.isCover) setOverrideCoverTransform(null);
    setEditingImage(null);
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

  const [downloading, setDownloading] = useState(false);
  async function handleDownloadAll() {
    setDownloading(true);
    try {
      // Prefer sharing each asset's real ORIGINAL directly (image or
      // video) as individual native-share Files -- no server export, no
      // zip, no client-side unzip. This is genuinely simpler than the
      // previous "fetch the server's crop-applied export zip, then unzip
      // it client-side just to get individual files back" round trip,
      // and matches what the single-asset Download/Share action already
      // does (asset.originalUrl, not a composited export). Only the
      // COVER (position 0) can ever have a saved crop in this app --
      // every other carousel slide has none to begin with -- so using
      // originals here doesn't silently drop anything meaningful for the
      // common multi-image case this path exists for.
      //
      // Gated on isTouchDevice -- some desktop browsers do support
      // canShare({files}), so shareOriginalAssets' own preferMobileUx
      // parameter is what actually keeps the OS share dialog off desktop
      // "Download Media" clicks; on desktop this falls straight through
      // to the exact same server-export zip download it always has.
      const shareable = orderedAssets
        .map((a) => a.originalUrl ?? a.url)
        .filter((url): url is string => !!url)
        .map((url) => ({ url, filename: filenameFromUrl(url, "asset") }));
      if (shareable.length > 0 && (await shareOriginalAssets(shareable, isTouchDevice))) return;

      // Falls back to the server-composited export (crop-applied cover,
      // canonical per-slide sizing) as a plain zip download -- unchanged
      // from before, and the only path taken when native file sharing
      // isn't supported/available for these files.
      const response = await fetch(`/projects/${projectId}/posts/${post.id}/export`);
      if (!response.ok) return;
      const zipBlob = await response.blob();
      saveAs(zipBlob, `post-${post.id}-export.zip`);
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
                  coverTransform={effectiveCoverTransform}
                  projectId={projectId}
                  postId={post.id}
                  onRemove={() => handleRemoveAsset(asset.postAssetId)}
                  onChooseFromLibrary={handleChooseFromLibrary}
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
                  coverTransform={orderedAssets[0]?.postAssetId === activeAssetId ? effectiveCoverTransform : null}
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
          {downloading ? "Preparing…" : isTouchDevice ? "Save Media" : "Download Media"}
        </Button>
      ) : (
        <p className="text-xs text-muted">No images yet — upload one or add from the library below.</p>
      )}

      {canManage && (
        <Suspense fallback={null}>
          <AddFromLibrarySection
            mediaLibraryPromise={mediaLibraryPromise}
            usedMediaIds={usedMediaIds}
            hideBackLink={hideBackLink}
            onAdd={handleLibraryItemClick}
            replaceActive={replaceTarget !== null}
            sectionRef={libraryZoneRef}
          />
        </Suspense>
      )}

      <PostMainForm
        projectId={projectId}
        post={post}
        links={links}
        canManage={canManage}
        role={role}
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

// Suspends on mediaLibraryPromise via use() -- isolated in its own small
// boundary (see the <Suspense> wrapper at its call site above) so it's the
// only part of the editor that waits on the whole-project media library,
// instead of that blocking the primary editing surface the way the old
// single-fetch page did.
//
// This is the ONE library-browsing surface Post Editor has -- Replace's
// own "choose from library" option does not open a second one. It puts
// THIS section into replace mode instead (replaceActive), which only
// changes what a click here means (see onAdd/handleLibraryItemClick in
// PostEditor) and adds a minimal visual cue -- everything else about how
// this section looks and behaves is exactly what it always was.
function AddFromLibrarySection({
  mediaLibraryPromise,
  usedMediaIds,
  hideBackLink,
  onAdd,
  replaceActive,
  sectionRef,
}: {
  mediaLibraryPromise: Promise<MediaLibraryItem[]>;
  usedMediaIds: Set<string>;
  hideBackLink: boolean;
  onAdd: (item: MediaLibraryItem) => void;
  replaceActive: boolean;
  sectionRef: React.RefObject<HTMLDivElement | null>;
}) {
  const mediaLibrary = use(mediaLibraryPromise);
  const availableMedia = mediaLibrary.filter((m) => !usedMediaIds.has(m.id));

  // Scrolls this section into view the instant replace mode activates --
  // scrollIntoView's own "nearest" block option is a no-op when the
  // element is already fully visible, so this never yanks the page around
  // for a target that's already on screen, only nudges it into view when
  // it's genuinely (partially) off-screen.
  useEffect(() => {
    if (replaceActive) sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaceActive]);

  if (availableMedia.length === 0) return null;

  return (
    <section
      ref={sectionRef}
      // ring, not border -- doesn't consume layout space, so no shift when
      // it fades in/out. Deliberately just a steady, subtle ring (no
      // looping animation) fading in over 300ms: enough to catch the eye
      // once without an ongoing pulse competing for attention the whole
      // time a decision is being made.
      className={`flex flex-col gap-2 rounded-none ring-2 ring-inset transition-shadow duration-300 ${
        replaceActive ? "ring-foreground/30" : "ring-transparent"
      }`}
    >
      <span className={labelClass}>{replaceActive ? "Choose a replacement" : "Add from library"}</span>
      {/* grid-cols-4 (mobile) vs sm:grid-cols-6 (unchanged -- desktop stays
          exactly as it was). Row height stays an EXPLICIT value (no
          per-item aspect-ratio on mobile) for the same reason established
          last round: a real device's async image loading made
          `auto`-sized rows driven by a child's aspect-ratio collapse,
          which read as tiles splitting into repeated horizontal strips --
          an explicit grid-auto-rows value has zero dependency on any
          child's content/load state, so that failure class can't recur.
          What's new this round is making that fixed height a 3:4-ratio
          match for the tile's own (also fixed, track-driven) width at
          each of the four widths this was asked to be tuned against --
          320/375/390/414px measured out to ~60/73/77/83px tile widths, so
          --tile-row-h below is each of those times 4/3. Both auto-rows and
          the container's own max-height (roughly one row + a 1/3-height
          peek of the next, the scroll affordance) derive from that same
          custom property via var()/calc(), instead of two separately
          hand-computed numbers that could drift out of sync with each
          other. sm: reverts both to their original desktop values --
          auto-rows-auto + sm:aspect-[3/4] on the tile, max-h-48 on the
          container -- untouched by any of this. */}
      <div
        className={`grid grid-cols-4 gap-2 overflow-y-auto [-webkit-overflow-scrolling:touch] [--tile-row-h:80px] min-[375px]:[--tile-row-h:98px] min-[390px]:[--tile-row-h:103px] min-[414px]:[--tile-row-h:111px] auto-rows-[var(--tile-row-h)] sm:grid-cols-6 sm:auto-rows-auto ${
          hideBackLink
            ? "max-h-[calc(var(--tile-row-h)*4/3+0.5rem)] sm:max-h-48"
            : "max-h-[min(1000px,65vh)]"
        }`}
      >
        {availableMedia.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onAdd(item)}
            className="relative min-w-0 overflow-hidden rounded-none border border-border transition-opacity duration-150 active:opacity-70 sm:aspect-[3/4]"
          >
            {item.url && item.mediaType === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.url} alt="" className="h-full w-full object-cover" />
            )}
            {item.url && item.mediaType === "video" && (
              // preload="metadata" -- mobile browsers commonly default video
              // preload to "none" to save cellular data, which otherwise
              // leaves this thumbnail with no visible frame at all until
              // played. playsInline avoids iOS Safari trying to launch
              // native fullscreen playback chrome for it.
              <video
                src={item.url}
                className="h-full w-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
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
  );
}

function AssetPreview({
  asset,
  coverTransform,
}: {
  asset: PostAssetItem;
  // Only ever non-null for the post's cover (position 0) -- see
  // posts.cover_transform's own comment. Rendered with the exact same
  // CroppedCoverImage Grid's own on-screen tile uses, so this always
  // matches what Grid shows.
  coverTransform: GridCoverTransform | null;
}) {
  return (
    <>
      {asset.url && asset.mediaType === "image" && (
        <CroppedCoverImage src={asset.url} transform={coverTransform} className="h-full w-full" />
      )}
      {asset.mediaType === "video" &&
        (asset.posterUrl ? (
          // A picked/annotated cover exists -- show that, same as Grid,
          // instead of the raw video (which would look unchanged either way
          // and never reflects what "Edit Cover" actually saved).
          <CroppedCoverImage src={asset.posterUrl} transform={coverTransform} className="h-full w-full" />
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
  onRemove,
  onEditImage,
  onChooseFromLibrary,
}: {
  asset: PostAssetItem;
  canManage: boolean;
  isCover: boolean;
  coverTransform: GridCoverTransform | null;
  projectId: string;
  postId: string;
  onRemove: () => void;
  onEditImage: () => void;
  // Replace's "choose from library" option no longer opens its own
  // duplicate library grid -- it hands the target identity up to
  // PostEditor, which puts the ALREADY-VISIBLE "Add from library"
  // section into a temporary replace-target mode instead. See PostEditor's
  // own replaceTarget state.
  onChooseFromLibrary: (postAssetId: string, isCover: boolean) => void;
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
  // Memoized (not a fresh inline arrow function per render): a NEW ref
  // callback identity on every render makes React detach (null) then
  // reattach (the node) on every single re-render, even though the
  // underlying DOM node never actually changes. This was the confirmed
  // root cause of "Replace does nothing" -- setReplaceOpen(true) (from
  // the same click that opens this popover) re-renders THIS component,
  // which re-created this ref callback, which momentarily nulled
  // tileRef.current during exactly the commit ReplaceAssetPopover mounts
  // and reads it in its own mount-time layout effect -- so its computed
  // `position` never got set, and it silently rendered nothing, forever.
  // Same fix as GridSlot's own combined ref callback in grid-board.tsx.
  const combinedTileRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      tileRef.current = node;
    },
    [setNodeRef],
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  // Same feature-detected (not UA-sniffed) signal as PostEditor's own
  // "Download Media" -- see shareOrDownloadAsset's own comment.
  const isTouchDevice = useIsTouchDevice();

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
    // Same bytes as before (asset.originalUrl, the true original -- this
    // single-asset action has always been the raw file, distinct from
    // "Download Media"'s server-composited crop-applied export above);
    // only the MECHANISM changes on a touch device, preferring the native
    // share sheet over a plain file download.
    shareOrDownloadAsset(
      asset.originalUrl,
      filenameFromUrl(asset.originalUrl, "asset"),
      isTouchDevice,
    ).finally(() => setDownloading(false));
  }

  async function handleSaveCrop(next: GridCoverTransform) {
    setOverrideTransform(next);
    setCropMode(false);
    try {
      await updatePostCoverTransform(projectId, postId, next);
    } catch (error) {
      console.error("Failed to save crop:", error);
      setOverrideTransform(undefined);
      router.refresh();
    }
  }

  // A video's crop tool operates on its picked poster frame (a static
  // image) -- the raw video file itself can't be panned/zoomed like Grid's
  // crop overlay expects. No poster yet means nothing to crop.
  const cropImageUrl = asset.mediaType === "video" ? asset.posterUrl : asset.url;

  return (
    <div
      ref={combinedTileRef}
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
                {downloading ? "Downloading..." : isTouchDevice ? "Save" : "Download"}
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
          anchorRef={tileRef}
        />
      )}
      {replaceOpen && (
        <ReplaceMenu
          projectId={projectId}
          postId={postId}
          postAssetId={asset.postAssetId}
          isCover={isCover}
          onChooseFromLibrary={onChooseFromLibrary}
          anchorRef={tileRef}
          onClose={() => setReplaceOpen(false)}
        />
      )}
    </div>
  );
}

// Swap this frame's media in place -- upload a new file, or pick an
// existing library asset -- rather than the old delete-then-re-add, which
// lost carousel position and any per-asset crop.
//
// Deliberately minimal: exactly two choices, no embedded library grid of
// its own. An earlier version of this menu additionally rendered a small
// duplicate "pick from library" thumbnail grid inline -- redundant with
// the already-visible, already-larger "Add from library" section further
// down this same editor, and confusing for offering two different-looking
// ways to browse the same library at once. "Choose from library" here
// instead hands the target identity up to PostEditor (onChooseFromLibrary)
// and closes; PostEditor puts the EXISTING section into a temporary
// replace-target mode instead of this menu duplicating it.
//
// Rendered via a portal at a fixed, viewport-clamped position computed from
// anchorRef, instead of position:absolute inside the asset strip -- that
// strip sets overflow-x-auto (for horizontal scrolling), which per the CSS
// overflow spec forces its overflow-y to auto too, clipping an
// absolutely-positioned popover that opens below its ~106px-tall row.
function ReplaceMenu({
  projectId,
  postId,
  postAssetId,
  isCover,
  onChooseFromLibrary,
  anchorRef,
  onClose,
}: {
  projectId: string;
  postId: string;
  postAssetId: string;
  isCover: boolean;
  onChooseFromLibrary: (postAssetId: string, isCover: boolean) => void;
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
    let rafId: number | null = null;
    let cancelled = false;
    let retriesLeft = 10;
    function recompute() {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) {
        // Defensive retry -- see SortableAsset's own combined ref callback
        // (now memoized, which is the actual root-cause fix) for why this
        // could otherwise momentarily read null the instant the popover
        // opens, same mechanism as GridCropOverlay's own anchor-measuring
        // effect.
        if (!cancelled && retriesLeft > 0) {
          retriesLeft -= 1;
          rafId = requestAnimationFrame(recompute);
        }
        return;
      }
      const width = 224; // w-56
      setPosition({
        top: Math.min(rect.bottom + 4, window.innerHeight - 12),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      });
    }
    recompute();
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
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

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const sizeCheck = validateUploadSize(file);
    if (!sizeCheck.ok) {
      setError(sizeCheck.message);
      return;
    }

    setPending(true);
    setError(undefined);
    const path = newStoragePath(projectId, file.name);
    const uploaded = await uploadFileDirect("project-media", path, file);
    if ("error" in uploaded) {
      setPending(false);
      setError(uploaded.error);
      return;
    }
    const formData = new FormData();
    formData.set("storagePath", uploaded.path);
    formData.set("mediaType", file.type.startsWith("video/") ? "video" : "image");
    runReplace(formData);
  }

  if (!position) return null;

  return createPortal(
    <div
      ref={popoverRef}
      onClick={(e) => e.stopPropagation()}
      style={{ position: "fixed", top: position.top, left: position.left }}
      // z-[110] -- NOT z-20. Post Editor is normally reached through the
      // (.)posts/[postId] intercepting route, which renders it inside
      // <Modal> (modal.tsx: `fixed inset-0 z-50`). This popover is
      // portaled straight to document.body, landing as a SIBLING of that
      // modal in the DOM (not a descendant), so it competes on z-index
      // terms alone -- at z-20 it rendered fully underneath the modal's
      // own z-50 backdrop/dialog, genuinely present and correctly
      // positioned in the DOM but never paintable or clickable (confirmed
      // live: elementFromPoint at the button's own coordinates returned
      // the modal's content, not this button). This was the actual,
      // previously-missed reason Replace did nothing in real Preview --
      // a live-only bug this component's synthetic test harness (no
      // Modal wrapper) could never have surfaced. z-[110] clears the
      // modal's z-50 with the same margin GridCropOverlay's own portal
      // already uses (z-[100]/z-[101]) for the identical reason.
      className="z-[110] w-56 max-w-[calc(100vw-1.5rem)] rounded-none border border-border bg-background p-2 shadow-lg"
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
      <button
        type="button"
        onClick={() => {
          onChooseFromLibrary(postAssetId, isCover);
          onClose();
        }}
        disabled={pending}
        className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05] disabled:opacity-60"
      >
        Choose from library
      </button>
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
  // Surfaces a too-large/direct-upload-failed file before the Server Action
  // ever runs (uploadFilesWithPosters rejects it client-side).
  const [uploadError, setUploadError] = useState<string | null>(null);

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
          setUploadError(null);
          if (files.length > 0) {
            uploadFilesWithPosters(projectId, action, files, (_name, message) => setUploadError(message));
          }
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
      {(uploadError || state?.message) && (
        <p className="text-xs text-error">{uploadError || state?.message}</p>
      )}
    </form>
  );
}

const POST_TYPES: PostType[] = ["post", "reel", "carousel"];

function PostMainForm({
  projectId,
  post,
  links,
  canManage,
  role,
}: {
  projectId: string;
  post: PostRecord;
  links: PostLinkItem[];
  canManage: boolean;
  role: ProjectRole;
}) {
  const isClient = canSubmitClientReview(role);
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

  // Same pattern, one block covering the rest of the form's fields since
  // they all reset together on the same event (a fresh `post` prop -- today
  // that only happens via some other action's revalidation of this route;
  // this form's own save no longer triggers one, see updatePost).
  const [prevPost, setPrevPost] = useState(post);
  const [caption, setCaption] = useState(post.caption);
  const [notes, setNotes] = useState(post.notes);
  const [status, setStatus] = useState<PostStatus>(post.status);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>(post.review_status);
  const [scheduledDate, setScheduledDate] = useState(post.scheduled_date ?? "");
  const [scheduledTime, setScheduledTime] = useState(post.scheduled_time ?? "");
  // Client's own optimistic view of review_status -- deliberately separate
  // state from `reviewStatus` above (which is what the owner/admin/editor
  // form save submits), since a client's review goes through a completely
  // different, immediate-submit action, not the batched form save.
  const [clientReviewStatus, setClientReviewStatus] = useState<ReviewStatus>(post.review_status);
  const [clientReviewSaving, setClientReviewSaving] = useState(false);
  if (post !== prevPost) {
    setPrevPost(post);
    setCaption(post.caption);
    setNotes(post.notes);
    setStatus(post.status);
    setReviewStatus(post.review_status);
    setScheduledDate(post.scheduled_date ?? "");
    setScheduledTime(post.scheduled_time ?? "");
    setClientReviewStatus(post.review_status);
  }

  const [addedToTodo, setAddedToTodo] = useState(false);
  const [todoError, setTodoError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();
  const [captionEl, setCaptionEl] = useState<HTMLTextAreaElement | null>(null);
  const { showError } = useToast();

  function handleClientReview(status: "approved" | "changes_requested") {
    if (clientReviewSaving) return;
    const previous = clientReviewStatus;
    setClientReviewStatus(status);
    setClientReviewSaving(true);
    startTransition(async () => {
      const result = await submitClientPostReview(post.id, status);
      setClientReviewSaving(false);
      if (!result.success) {
        setClientReviewStatus(previous);
        showError(result.message ?? "Couldn't save your review. Please try again.");
      }
    });
  }

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

  // The optimistic field values above already ARE the shown state the
  // instant Save is clicked -- persistence happens in the background and,
  // on success, changes nothing further (a redundant "fresh" render would
  // only flash every re-signed asset thumbnail on this page for no reason,
  // see updatePost's revalidation scope). On failure, every field reverts
  // to the last known-good server value and the error surfaces as a toast
  // instead of blocking the page.
  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setSaved(false);
    setSaving(true);
    const formData = new FormData();
    formData.set("post_type", postType);
    formData.set("caption", caption);
    formData.set("notes", notes);
    formData.set("status", status);
    formData.set("review_status", reviewStatus);
    formData.set("scheduled_date", scheduledDate);
    formData.set("scheduled_time", scheduledTime);
    startTransition(async () => {
      const result = await updatePost(projectId, post.id, undefined, formData);
      setSaving(false);
      if (result?.message) {
        showError(result.message);
        setCaption(post.caption);
        setNotes(post.notes);
        setStatus(post.status);
        setReviewStatus(post.review_status);
        setScheduledDate(post.scheduled_date ?? "");
        setScheduledTime(post.scheduled_time ?? "");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      }
    });
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
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
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
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
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
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
            <select
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as PostStatus)}
              disabled={!canManage}
              className={fieldClass}
            >
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Published</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Approval Status</span>
            {isClient ? (
              // Client's own client-safe path -- immediate-submit via
              // set_post_review_status (see submitClientPostReview), never
              // the batched form save below (which RLS wouldn't allow a
              // client to reach anyway). No "Pending Review" option here on
              // purpose -- that RPC only ever accepts approved/changes_requested,
              // matching the anonymous token flow's own reviewer-facing subset.
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleClientReview("approved")}
                  disabled={clientReviewSaving}
                  className={`flex-1 rounded-full border px-4 py-2 text-xs tracking-wide uppercase transition-colors duration-150 disabled:opacity-50 ${
                    clientReviewStatus === "approved"
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-foreground hover:border-foreground/40"
                  }`}
                >
                  Approved
                </button>
                <button
                  type="button"
                  onClick={() => handleClientReview("changes_requested")}
                  disabled={clientReviewSaving}
                  className={`flex-1 rounded-full border px-4 py-2 text-xs tracking-wide uppercase transition-colors duration-150 disabled:opacity-50 ${
                    clientReviewStatus === "changes_requested"
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-foreground hover:border-foreground/40"
                  }`}
                >
                  Needs Changes
                </button>
              </div>
            ) : (
              <>
                {/* Same column a client's review-link submission writes to
                    (set_post_review_status_by_token) -- this updates automatically
                    based on their latest review, and can also be changed manually
                    here, same as the workflow Status select next to it. */}
                <select
                  name="review_status"
                  value={reviewStatus}
                  onChange={(e) => setReviewStatus(e.target.value as ReviewStatus)}
                  disabled={!canManage}
                  className={fieldClass}
                >
                  <option value="pending">Pending Review</option>
                  <option value="approved">Approved</option>
                  <option value="changes_requested">Needs Changes</option>
                </select>
              </>
            )}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Schedule date</span>
            <input
              type="date"
              name="scheduled_date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              disabled={!canManage}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Schedule time</span>
            <input
              type="time"
              name="scheduled_time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
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

      {canManage && (
        <Button
          type="submit"
          variant="primary"
          radius="none"
          disabled={saving}
          className="w-full py-3 text-xs tracking-wide uppercase"
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save Changes"}
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
