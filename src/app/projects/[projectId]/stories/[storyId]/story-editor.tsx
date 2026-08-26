"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
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
  addStoryFrame,
  addStoryLink,
  removeStoryFrame,
  removeStoryLink,
  reorderStoryFrames,
  submitClientStoryReview,
  updateStory,
  updateStoryFrameLink,
  uploadStoryFrame,
} from "@/lib/actions/stories";
import { SORTABLE_TRANSITION } from "@/lib/dnd-motion";
import { uploadFilesWithPosters } from "@/lib/video-poster";
import { downloadAssetsAsZip, filenameFromUrl, shareOriginalAssets } from "@/lib/download-zip";
import { useIsTouchDevice } from "@/lib/hooks/use-is-touch-device";
import { convertToTask } from "@/lib/actions/todo";
import { addStoryComment, fetchStoryComments } from "@/lib/actions/post-comments";
import { CONTENT_STATUS_LABEL, CONTENT_STATUS_OPTIONS } from "@/lib/content-status";
import { canSubmitClientReview } from "@/lib/role-permissions";
import { Button } from "@/components/ui/button";
import { ItemComments } from "@/components/ui/item-comments";
import { useToast } from "@/lib/hooks/use-toast";
import type { MediaLibraryItem } from "../../grid/grid-board";
import type { StoryFrameItem, StoryLinkItem } from "@/lib/data/stories";
import type { ProjectMemberOption } from "@/lib/data/post-comments";
import type { ProjectRole, ReviewStatus, StoryStatus } from "@/types/database";

type StoryRecord = {
  id: string;
  name: string;
  scheduled_date: string | null;
  status: StoryStatus;
  review_status: ReviewStatus;
  notes: string;
};

const labelClass = "text-xs tracking-wide text-muted uppercase";
const fieldClass =
  "w-full rounded-none border border-foreground bg-transparent px-3 py-2 text-sm focus:outline-none";

export function StoryEditor({
  projectId,
  story,
  frames,
  links,
  mediaLibrary,
  canManage,
  role,
  currentUserId,
  members,
  hideBackLink = false,
}: {
  projectId: string;
  story: StoryRecord;
  frames: StoryFrameItem[];
  links: StoryLinkItem[];
  mediaLibrary: MediaLibraryItem[];
  canManage: boolean;
  // Raw role, alongside canManage -- only consumed by StoryMainForm, to
  // offer Client their own narrow Approval Status control.
  role: ProjectRole;
  currentUserId: string;
  members: ProjectMemberOption[];
  hideBackLink?: boolean;
}) {
  const router = useRouter();
  const { showError } = useToast();
  const [prevFrames, setPrevFrames] = useState(frames);
  const [orderedFrames, setOrderedFrames] = useState(frames);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  if (frames !== prevFrames) {
    setPrevFrames(frames);
    setOrderedFrames(frames);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveFrameId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveFrameId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedFrames.findIndex((f) => f.frameId === active.id);
    const newIndex = orderedFrames.findIndex((f) => f.frameId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(orderedFrames, oldIndex, newIndex);
    setOrderedFrames(next);
    startTransition(async () => {
      try {
        await reorderStoryFrames(projectId, story.id, next.map((f) => f.frameId));
      } catch (error) {
        console.error("Failed to save frame reorder:", error);
        setOrderedFrames(frames);
        router.refresh();
      }
    });
  }

  const activeFrame = orderedFrames.find((f) => f.frameId === activeFrameId) ?? null;

  const usedMediaIds = new Set(orderedFrames.map((f) => f.mediaAssetId));
  const availableMedia = mediaLibrary.filter((m) => !usedMediaIds.has(m.id));

  const [downloading, setDownloading] = useState(false);
  // Same feature-detected (not UA-sniffed) signal as Post Editor's own
  // approved "Save Media".
  const isTouchDevice = useIsTouchDevice();
  async function handleDownloadAll() {
    setDownloading(true);
    try {
      const framesWithUrl = orderedFrames.filter((f): f is typeof f & { url: string } => Boolean(f.url));
      // Individual image Files through the approved native-share path --
      // same shared helper Post Editor's own "Save Media" uses, reused
      // here rather than duplicated. Only when every frame is an image: a
      // mixed/video story keeps the existing zip download untouched.
      if (framesWithUrl.length > 0 && framesWithUrl.every((f) => f.mediaType === "image")) {
        const assets = framesWithUrl.map((f, i) => ({ url: f.url, filename: filenameFromUrl(f.url, `frame-${i + 1}`) }));
        if (await shareOriginalAssets(assets)) return;
      }
      const zipAssets = framesWithUrl.map((f, i) => ({ url: f.url, filename: filenameFromUrl(f.url, `frame-${i + 1}`) }));
      await downloadAssetsAsZip(zipAssets, `story-${story.id}-frames.zip`);
    } finally {
      setDownloading(false);
    }
  }

  function scrollFramesRight() {
    scrollRef.current?.scrollBy({ left: 240, behavior: "smooth" });
  }

  return (
    <div className="flex flex-col gap-6">
      {!hideBackLink && (
        <Link
          href={`/projects/${projectId}/stories`}
          className="text-sm text-muted transition-colors duration-150 hover:text-foreground"
        >
          ← Back to content
        </Link>
      )}

      <div className="relative">
        <DndContext
          id={`story-dnd-${story.id}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveFrameId(null)}
        >
          <SortableContext
            items={orderedFrames.map((f) => f.frameId)}
            strategy={rectSortingStrategy}
          >
            <div ref={scrollRef} className="flex gap-2 overflow-x-auto scroll-smooth pb-1">
              {orderedFrames.map((frame) => (
                <SortableFrame
                  key={frame.frameId}
                  projectId={projectId}
                  storyId={story.id}
                  frame={frame}
                  canManage={canManage}
                  onRemove={() => {
                    const before = orderedFrames;
                    setOrderedFrames(before.filter((f) => f.frameId !== frame.frameId));
                    startTransition(async () => {
                      try {
                        await removeStoryFrame(projectId, story.id, frame.frameId);
                      } catch (error) {
                        console.error("Failed to remove frame:", error);
                        setOrderedFrames(before);
                        showError("Couldn't remove that frame. Please try again.");
                      }
                    });
                  }}
                />
              ))}
              {canManage && (
                <UploadFrameTile
                  projectId={projectId}
                  storyId={story.id}
                  onUploaded={() => router.refresh()}
                />
              )}
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {activeFrame && (
              <div className="aspect-[9/16] w-24 cursor-grabbing overflow-hidden rounded border border-foreground/20 shadow-[0_2px_10px_rgba(0,0,0,0.1)]">
                <FramePreview frame={activeFrame} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
        {orderedFrames.length > 3 && (
          <button
            type="button"
            onClick={scrollFramesRight}
            title="Scroll for more"
            className="absolute right-0 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-muted transition-colors duration-150 hover:text-foreground"
          >
            ›
          </button>
        )}
      </div>

      {orderedFrames.length > 0 ? (
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
        <p className="text-xs text-muted">No files yet — upload one or add from the library below.</p>
      )}

      {canManage && availableMedia.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className={labelClass}>Add from library</span>
          {/* Capped to roughly 9 rows on the full page, bounded by viewport
              height too so it doesn't grow unboundedly with a project's full
              media library. Inside the Grid/Stories popup (hideBackLink) the
              modal itself is already space-constrained, so cap to a single
              visible row there instead -- scrolls internally either way.
              Mobile row height is an EXPLICIT --tile-row-h value, same fix
              (and same reason) as Post editor's own AddFromLibrarySection
              (post-editor.tsx): an implicit auto-rows height driven by each
              tile's own aspect-ratio collapses to near-zero before a real
              device's async image load resolves, which read as tiles
              splitting into repeated horizontal strips. --tile-row-h has no
              dependency on any child's content/load state, so that can't
              recur. Values are this section's own 9:16 (not Post's 3:4)
              tiles at the same shared Modal width (both editors' intercepted-
              route modals use the identical modal.tsx, max-w-3xl/p-4 sm:p-6,
              grid-cols-4/gap-2) -- same tile widths (~60/73/77/83px at
              320/375/390/414px), scaled to 9:16 instead of 3:4. sm: reverts
              to the original desktop values -- auto-rows-auto + sm:aspect-
              [9/16] on the tile, max-h-36 on the container -- untouched. */}
          <div
            className={`grid grid-cols-4 gap-2 overflow-y-auto [-webkit-overflow-scrolling:touch] [--tile-row-h:107px] min-[375px]:[--tile-row-h:130px] min-[390px]:[--tile-row-h:137px] min-[414px]:[--tile-row-h:148px] auto-rows-[var(--tile-row-h)] sm:grid-cols-6 sm:auto-rows-auto ${
              hideBackLink ? "max-h-[calc(var(--tile-row-h)*4/3+0.5rem)] sm:max-h-36" : "max-h-[min(1000px,65vh)]"
            }`}
          >
            {availableMedia.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  // Optimistic insert -- mediaAssetId/url/mediaType are
                  // already known client-side (it's picked from the media
                  // library, not a fresh upload), so the new frame can show
                  // immediately with a temp id, then get patched to the
                  // real id once the insert resolves. Reverts (removes the
                  // placeholder) and surfaces a toast if the insert fails.
                  const tempId = `temp-${item.id}-${Date.now()}`;
                  setOrderedFrames((current) => [
                    ...current,
                    { frameId: tempId, mediaAssetId: item.id, url: item.url, mediaType: item.mediaType, linkUrl: null },
                  ]);
                  startTransition(async () => {
                    const result = await addStoryFrame(projectId, story.id, item.id);
                    if (result.success) {
                      setOrderedFrames((current) =>
                        current.map((f) => (f.frameId === tempId ? { ...f, frameId: result.frameId } : f)),
                      );
                    } else {
                      setOrderedFrames((current) => current.filter((f) => f.frameId !== tempId));
                      showError(result.message ?? "Couldn't add that frame.");
                    }
                  });
                }}
                className="relative min-w-0 overflow-hidden rounded-none border border-border transition-opacity duration-150 active:opacity-70 sm:aspect-[9/16]"
              >
                {item.url && item.mediaType === "image" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
                {item.url && item.mediaType === "video" && (
                  <video src={item.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      <StoryMainForm projectId={projectId} story={story} links={links} canManage={canManage} role={role} />

      <ItemComments
        itemId={story.id}
        currentUserId={currentUserId}
        members={members}
        fetchComments={fetchStoryComments}
        addComment={(id, text) => addStoryComment(projectId, id, text)}
      />
    </div>
  );
}

function FramePreview({ frame }: { frame: StoryFrameItem }) {
  return (
    <>
      {/* getStoryPageData already resolves a PDF frame's `url` to its
          generated page-1 cover (not the raw PDF) -- same reasoning as
          image, just a different source. */}
      {frame.url && (frame.mediaType === "image" || frame.mediaType === "pdf") && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={frame.url} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
      )}
      {frame.url && frame.mediaType === "video" && (
        <video src={frame.url} className="h-full w-full object-cover" muted />
      )}
    </>
  );
}

function SortableFrame({
  projectId,
  storyId,
  frame,
  canManage,
  onRemove,
}: {
  projectId: string;
  storyId: string;
  frame: StoryFrameItem;
  canManage: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: frame.frameId,
    transition: SORTABLE_TRANSITION,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div className="flex w-24 shrink-0 flex-col gap-1">
      <div
        ref={setNodeRef}
        style={style}
        {...(canManage ? { ...attributes, ...listeners } : {})}
        className={`relative aspect-[9/16] touch-none overflow-hidden rounded-none border border-border transition-opacity duration-150 ${
          canManage ? "cursor-grab" : ""
        } ${isDragging ? "opacity-30" : ""}`}
      >
        <FramePreview frame={frame} />
        {canManage && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded bg-black/70 text-xs text-white"
          >
            X
          </button>
        )}
      </div>
      <input
        defaultValue={frame.linkUrl ?? ""}
        placeholder="Link URL"
        disabled={!canManage}
        onBlur={(e) => updateStoryFrameLink(projectId, storyId, frame.frameId, e.target.value)}
        className="w-full rounded-none border border-border px-1 py-0.5 text-[10px] focus:border-foreground focus:outline-none"
      />
    </div>
  );
}

function UploadFrameTile({
  projectId,
  storyId,
  onUploaded,
}: {
  projectId: string;
  storyId: string;
  onUploaded: () => void;
}) {
  const [state, action, pending] = useActionState(
    uploadStoryFrame.bind(null, projectId, storyId),
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
        title="Add frame"
        className="flex aspect-[9/16] w-24 shrink-0 items-center justify-center rounded-none border border-dashed border-border text-2xl text-muted transition-colors duration-150 hover:bg-black/[.03] disabled:opacity-60"
      >
        {pending ? "…" : "+"}
      </button>
      {(uploadError || state?.message) && (
        <p className="text-xs text-error">{uploadError || state?.message}</p>
      )}
    </form>
  );
}

function StoryMainForm({
  projectId,
  story,
  links,
  canManage,
  role,
}: {
  projectId: string;
  story: StoryRecord;
  links: StoryLinkItem[];
  canManage: boolean;
  role: ProjectRole;
}) {
  const isClient = canSubmitClientReview(role);

  // Same shape as Post Editor's PostMainForm: local optimistic field state
  // committed immediately on Save, persisted in the background, reverted
  // + toasted only on failure -- see updateStory's own comment for why it
  // no longer revalidates this exact route.
  const [prevStory, setPrevStory] = useState(story);
  const [name, setName] = useState(story.name);
  const [notes, setNotes] = useState(story.notes);
  const [status, setStatus] = useState<StoryStatus>(story.status);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>(story.review_status);
  const [scheduledDate, setScheduledDate] = useState(story.scheduled_date ?? "");
  // Client's own optimistic view of review_status -- see PostMainForm's
  // identical field for why this is deliberately separate from
  // `reviewStatus` above.
  const [clientReviewStatus, setClientReviewStatus] = useState<ReviewStatus>(story.review_status);
  const [clientReviewSaving, setClientReviewSaving] = useState(false);
  if (story !== prevStory) {
    setPrevStory(story);
    setName(story.name);
    setNotes(story.notes);
    setStatus(story.status);
    setReviewStatus(story.review_status);
    setScheduledDate(story.scheduled_date ?? "");
    setClientReviewStatus(story.review_status);
  }

  const [addedToTodo, setAddedToTodo] = useState(false);
  const [todoError, setTodoError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();
  const { showError } = useToast();

  function handleClientReview(status: "approved" | "changes_requested") {
    if (clientReviewSaving) return;
    const previous = clientReviewStatus;
    setClientReviewStatus(status);
    setClientReviewSaving(true);
    startTransition(async () => {
      const result = await submitClientStoryReview(story.id, status);
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
      const result = await convertToTask(projectId, "story", story.id, story.name, story.scheduled_date);
      if (result.success) {
        setAddedToTodo(true);
      } else {
        setTodoError(result.message ?? "Couldn't add to To-Do list.");
      }
    });
  }

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setSaved(false);
    setSaving(true);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("notes", notes);
    formData.set("status", status);
    formData.set("review_status", reviewStatus);
    formData.set("scheduled_date", scheduledDate);
    startTransition(async () => {
      const result = await updateStory(projectId, story.id, undefined, formData);
      setSaving(false);
      if (result?.message) {
        showError(result.message);
        setName(story.name);
        setNotes(story.notes);
        setStatus(story.status);
        setReviewStatus(story.review_status);
        setScheduledDate(story.scheduled_date ?? "");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      }
    });
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Content name</span>
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canManage}
          placeholder="Live text for content name"
          className={fieldClass}
        />
      </label>

      <StoryLinks projectId={projectId} storyId={story.id} links={links} canManage={canManage} />

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
        <span className={labelClass}>Schedule content</span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Status</span>
            <select
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as StoryStatus)}
              disabled={!canManage}
              className={fieldClass}
            >
              {CONTENT_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {CONTENT_STATUS_LABEL[s]}
                </option>
              ))}
              {/* Legacy value from before this dropdown was expanded -- kept
                  so existing "published" rows still render correctly instead
                  of silently falling back to the first option. */}
              <option value="published">Published (legacy)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Approval Status</span>
            {isClient ? (
              // Client's own client-safe path -- immediate-submit via
              // set_story_review_status (see submitClientStoryReview),
              // mirrors Post Editor's identical branch exactly.
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
                    (set_story_review_status_by_token) -- mirrors Post Editor's
                    own Approval Status field exactly (same options/labels). */}
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

function StoryLinks({
  projectId,
  storyId,
  links,
  canManage,
}: {
  projectId: string;
  storyId: string;
  links: StoryLinkItem[];
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
      const result = await addStoryLink(projectId, storyId, undefined, formData);
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
                      await removeStoryLink(projectId, storyId, link.id);
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
