"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Lightbox,
  MediaFrame,
  type FlatMedia,
  type GalleryItemType,
} from "@/components/media-gallery";
import { addReviewComment, fetchReviewComments, resetReviewStatus, setReviewStatus } from "@/lib/actions/reviews";
import type { ReviewCommentItem, ReviewGalleryItem } from "@/lib/data/review";
import type { ReviewStatus } from "@/types/database";

const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "Pending Review",
  approved: "Approved",
  changes_requested: "Changes Requested",
};

const STATUS_DOT: Record<ReviewStatus, string> = {
  pending: "bg-muted",
  approved: "bg-success",
  changes_requested: "bg-error",
};

// The Client Review Mode equivalent of shared-gallery.tsx's SharedGallery --
// same continuous-scroll layout and the same MediaFrame/Lightbox components
// (imported from media-gallery.tsx, not re-implemented), plus what a
// client-facing review actually needs on top: the caption exactly as it
// appears in the editor, a comment thread, and approve/request-changes.
export function ReviewGallery({
  projectId,
  projectName,
  items,
  viewerRole,
}: {
  projectId: string;
  projectName: string;
  items: ReviewGalleryItem[];
  viewerRole: string;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const isClientReviewer = viewerRole === "client";
  const canManage = viewerRole === "owner" || viewerRole === "admin";

  const flatMedia = useMemo<FlatMedia[]>(() => {
    const list: FlatMedia[] = [];
    for (const item of items) {
      for (const m of item.media) {
        if (!m.url) continue;
        list.push({
          key: m.mediaAssetId,
          url: m.url,
          mediaType: m.mediaType,
          posterUrl: m.posterUrl,
          contentType: item.type as GalleryItemType,
        });
      }
    }
    return list;
  }, [items]);

  const indexByKey = useMemo(() => {
    const map = new Map<string, number>();
    flatMedia.forEach((m, i) => map.set(m.key, i));
    return map;
  }, [flatMedia]);

  if (items.length === 0) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <span className="text-xs tracking-wide text-muted uppercase">Nothing to Review Yet</span>
        <p className="max-w-xs text-sm text-muted">Content will show up here once it&apos;s ready for review.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh w-full flex-col items-center gap-14 bg-background px-4 py-12 text-foreground sm:gap-20 sm:px-8 sm:py-16">
      <header className="flex flex-col items-center gap-1 text-center">
        <span className="text-xs tracking-wide text-muted uppercase">{projectName} — Review</span>
      </header>

      {items.map((item) => (
        <section key={item.id} className="animate-settle-in flex w-full max-w-2xl flex-col items-center gap-4">
          {item.media.length > 1 ? (
            <div className="flex w-full flex-wrap items-center justify-center gap-3">
              {item.media.map((m) => (
                <MediaFrame
                  key={m.mediaAssetId}
                  media={m}
                  type={item.type as GalleryItemType}
                  grouped
                  onOpen={() => {
                    const i = indexByKey.get(m.mediaAssetId);
                    if (i !== undefined) setLightboxIndex(i);
                  }}
                />
              ))}
            </div>
          ) : (
            item.media[0] && (
              <MediaFrame
                media={item.media[0]}
                type={item.type as GalleryItemType}
                onOpen={() => {
                  const key = item.media[0].mediaAssetId;
                  const i = indexByKey.get(key);
                  if (i !== undefined) setLightboxIndex(i);
                }}
              />
            )
          )}

          {item.caption && <p className="w-full max-w-md whitespace-pre-wrap text-center text-sm text-muted">{item.caption}</p>}

          <ReviewActions
            projectId={projectId}
            item={item}
            isClientReviewer={isClientReviewer}
            canManage={canManage}
          />

          <ReviewCommentThread projectId={projectId} item={item} />
        </section>
      ))}

      {lightboxIndex !== null && (
        <Lightbox
          media={flatMedia}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i === null ? i : (i - 1 + flatMedia.length) % flatMedia.length))}
          onNext={() => setLightboxIndex((i) => (i === null ? i : (i + 1) % flatMedia.length))}
        />
      )}
    </div>
  );
}

function ReviewActions({
  projectId,
  item,
  isClientReviewer,
  canManage,
}: {
  projectId: string;
  item: ReviewGalleryItem;
  isClientReviewer: boolean;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useState<ReviewStatus | null>(null);
  const status = optimisticStatus ?? item.reviewStatus;

  function handleSetStatus(next: "approved" | "changes_requested") {
    if (next === status) return;
    setOptimisticStatus(next);
    startTransition(async () => {
      await setReviewStatus(projectId, item.type, item.id, next);
    });
  }

  function handleReset() {
    setOptimisticStatus("pending");
    startTransition(async () => {
      await resetReviewStatus(projectId, item.type, item.id);
    });
  }

  if (isClientReviewer) {
    return (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={status === "approved" ? "primary" : "secondary"}
          radius="full"
          disabled={pending}
          onClick={() => handleSetStatus("approved")}
        >
          ✅ Approve
        </Button>
        <Button
          type="button"
          variant={status === "changes_requested" ? "primary" : "secondary"}
          radius="full"
          disabled={pending}
          onClick={() => handleSetStatus("changes_requested")}
        >
          🔄 Request Changes
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs tracking-wide uppercase">
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      <span className="text-muted">{STATUS_LABEL[status]}</span>
      {canManage && status !== "pending" && (
        <button
          type="button"
          onClick={handleReset}
          disabled={pending}
          className="text-muted underline decoration-border underline-offset-2 hover:text-foreground disabled:opacity-40"
        >
          Reset
        </button>
      )}
    </div>
  );
}

function ReviewCommentThread({ projectId, item }: { projectId: string; item: ReviewGalleryItem }) {
  const [comments, setComments] = useState<ReviewCommentItem[] | null>(null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchReviewComments(item.type, item.id).then((c) => {
      if (!cancelled) setComments(c);
    });
    return () => {
      cancelled = true;
    };
  }, [item.type, item.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    const optimistic: ReviewCommentItem = {
      id: `optimistic-${Date.now()}`,
      authorId: "me",
      authorName: "You",
      authorAvatarUrl: null,
      text: trimmed,
      createdAt: new Date().toISOString(),
    };
    setComments((prev) => [...(prev ?? []), optimistic]);
    setText("");
    const result = await addReviewComment(projectId, item.type, item.id, trimmed);
    if (result.success) {
      fetchReviewComments(item.type, item.id).then(setComments);
    }
    setPosting(false);
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-2 border-t border-border pt-3">
      {(comments ?? []).map((c) => (
        <div key={c.id} className="flex items-start gap-2 text-sm">
          <Avatar name={c.authorName} avatarUrl={c.authorAvatarUrl} />
          <div className="min-w-0">
            <span className="mr-1.5 text-xs font-semibold">{c.authorName}</span>
            <span className="text-muted">{c.text}</span>
          </div>
        </div>
      ))}
      {comments !== null && comments.length === 0 && <p className="text-xs text-muted">No comments yet.</p>}

      <form onSubmit={handleSubmit} className="mt-1 flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Leave a comment"
          className="w-full border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim() || posting}
          className="shrink-0 text-xs tracking-wide text-muted uppercase transition-colors duration-150 hover:text-foreground disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
