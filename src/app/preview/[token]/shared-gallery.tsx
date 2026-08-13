"use client";

import { useMemo, useState } from "react";
import type { SharedGalleryItem } from "@/lib/data/share-preview";
import { Lightbox, MediaFrame, type FlatMedia } from "@/components/media-gallery";
import { MentionField } from "@/components/ui/mention-input";
import { submitReviewStatus, submitReviewNotes } from "@/lib/actions/share-preview-review";
import type { ReviewStatus } from "@/types/database";

// Every selected post/story renders together in one continuous scroll, and
// within a single post/story every image or video renders together too --
// no slide-at-a-time paging in the default view, no swipe/dots. Every frame
// is forced into its content type's standard aspect ratio (post 1080x1440
// = 3:4, story 1080x1920 = 9:16) rather than each source image's own
// dimensions, so a set of mixed-aspect uploads still reads as one
// consistent grid. Clicking any image opens it full-size in a lightbox that
// can slide through every image/video on the page (in the order they
// appear), for a closer look without leaving the page. Gallery/lightbox
// itself is unchanged by Client Review -- only the per-item controls below
// each one (ReviewControls) are new.
export function SharedGallery({
  token,
  title,
  projectName,
  items,
  members,
}: {
  token: string;
  title: string;
  projectName: string;
  items: SharedGalleryItem[];
  members: { id: string; name: string }[];
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const flatMedia = useMemo<FlatMedia[]>(() => {
    const list: FlatMedia[] = [];
    for (const item of items) {
      for (const m of item.media) {
        if (!m.url) continue;
        list.push({ key: m.mediaAssetId, url: m.url, mediaType: m.mediaType, posterUrl: m.posterUrl, contentType: item.type });
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
        <span className="text-xs tracking-wide text-muted uppercase">Preview Unavailable</span>
        <p className="max-w-xs text-sm text-muted">This link doesn&apos;t have any content to show yet.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh w-full flex-col items-center gap-14 bg-background px-4 py-12 text-foreground sm:gap-20 sm:px-8 sm:py-16">
      <header className="flex flex-col items-center gap-1 text-center">
        <span className="text-xs tracking-wide text-muted uppercase">{title || `${projectName} — Client Preview`}</span>
      </header>

      {items.map((item) => (
        <section key={item.id} className="animate-settle-in flex w-full flex-col items-center gap-4">
          {item.media.length > 1 ? (
            <div className="flex w-full max-w-6xl flex-wrap items-center justify-center gap-3">
              {item.media.map((m) => (
                <MediaFrame
                  key={m.mediaAssetId}
                  media={m}
                  type={item.type}
                  grouped
                  onOpen={() => {
                    const i = indexByKey.get(m.mediaAssetId);
                    if (i !== undefined) setLightboxIndex(i);
                  }}
                />
              ))}
            </div>
          ) : (
            <MediaFrame
              media={item.media[0]}
              type={item.type}
              onOpen={() => {
                const i = indexByKey.get(item.media[0].mediaAssetId);
                if (i !== undefined) setLightboxIndex(i);
              }}
            />
          )}

          {item.caption && <p className="w-full max-w-md whitespace-pre-wrap text-center text-sm text-muted">{item.caption}</p>}

          <ReviewControls token={token} item={item} members={members} />
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

const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "Pending Review",
  approved: "Approved",
  changes_requested: "Needs Changes",
};

// The exact template the manager-facing Edit Post popup's Notes field
// should show -- Notes is the single source of truth for client feedback
// (no separate comments system), so every write here is a full replace, not
// an append.
function formatFeedback(status: ReviewStatus, notes: string): string {
  const trimmed = notes.trim();
  if (!trimmed) return `Status: ${STATUS_LABEL[status]}`;
  return `Status: ${STATUS_LABEL[status]}\n\nClient Feedback:\n"${trimmed}"`;
}

// Approval (mutually exclusive, writes immediately on click) + one Notes
// field (pre-filled with whatever's already there -- a re-opened link
// showing the client's own last submission, or the manager's existing
// notes if nobody's reviewed yet -- saved on click, not per-keystroke).
// Both write straight to the real posts/stories row via the token-scoped
// RPCs (submitReviewStatus/submitReviewNotes) -- no separate comments
// table, no second copy of this data anywhere.
function ReviewControls({
  token,
  item,
  members,
}: {
  token: string;
  item: SharedGalleryItem;
  members: { id: string; name: string }[];
}) {
  const itemId = item.type === "post" ? item.postId : item.storyId;
  const [status, setStatus] = useState<ReviewStatus>(item.reviewStatus);
  const [statusSaving, setStatusSaving] = useState(false);
  const [notes, setNotes] = useState(item.notes);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  if (!itemId) return null;

  async function handleSetStatus(next: ReviewStatus) {
    if (next === status || statusSaving) return;
    const previous = status;
    setStatus(next);
    setStatusSaving(true);
    const result = await submitReviewStatus(token, item.type, itemId!, next);
    if (!result.success) {
      setStatus(previous);
    } else {
      // Keeps the Notes field's "Status:" line current even on a status-only
      // click that never touches the textarea below.
      await submitReviewNotes(token, item.type, itemId!, formatFeedback(next, notes));
    }
    setStatusSaving(false);
  }

  async function handleSaveNotes() {
    setNotesSaving(true);
    setNotesSaved(false);
    const result = await submitReviewNotes(token, item.type, itemId!, formatFeedback(status, notes));
    setNotesSaving(false);
    if (result.success) {
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 1800);
    }
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => handleSetStatus("approved")}
          disabled={statusSaving}
          className={`rounded-full border px-3 py-1.5 text-xs tracking-wide uppercase transition-colors duration-150 disabled:opacity-50 ${
            status === "approved" ? "border-success bg-success/10 text-success" : "border-border text-muted hover:border-foreground/40"
          }`}
        >
          ✅ Approved
        </button>
        <button
          type="button"
          onClick={() => handleSetStatus("changes_requested")}
          disabled={statusSaving}
          className={`rounded-full border px-3 py-1.5 text-xs tracking-wide uppercase transition-colors duration-150 disabled:opacity-50 ${
            status === "changes_requested" ? "border-error bg-error/10 text-error" : "border-border text-muted hover:border-foreground/40"
          }`}
        >
          ❌ Needs Changes
        </button>
      </div>
      <p className="text-center text-[10px] tracking-wide text-muted uppercase">{STATUS_LABEL[status]}</p>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs tracking-wide text-muted uppercase">Notes</span>
        <MentionField
          multiline
          value={notes}
          onChange={setNotes}
          members={members}
          rows={3}
          placeholder="Leave a note for the team — @ to mention someone"
          className="w-full rounded-none border border-border bg-transparent p-2 text-sm focus:border-foreground focus:outline-none"
        />
      </label>
      <button
        type="button"
        onClick={handleSaveNotes}
        disabled={notesSaving}
        className="w-fit self-end text-xs tracking-wide uppercase text-muted transition-colors duration-150 hover:text-foreground disabled:opacity-50"
      >
        {notesSaving ? "Saving…" : notesSaved ? "Saved" : "Save Notes"}
      </button>
    </div>
  );
}
