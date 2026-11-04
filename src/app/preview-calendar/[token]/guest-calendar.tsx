"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { CalendarCell, CalendarItem } from "@/lib/calendar-cells";
import { guestPreviewKey, type GuestPreview } from "@/lib/calendar-share-model";
import {
  CalendarView,
  DayNote,
  ITEM_CHIP_CLASS,
  ItemChipBody,
  ItemTileBody,
  contentTypeLabel,
  itemTileClassName,
  type CalendarItemVariant,
  type CalendarViewSlots,
} from "@/app/projects/[projectId]/calendar/calendar-view";
import { VideoCoverPlayer } from "@/components/media-gallery";

// The guest (share-link) Calendar: the team Calendar's own CalendarView with
// read-only slots -- items open a preview instead of linking into the app,
// notes render without an editor, no drop targets, no day menu, no
// day-detail dialog, no Drafts panel. Nothing here imports a server action.

const OpenPreviewContext = createContext<(item: CalendarItem) => void>(() => {});

// A <span role="button">, not a <button>: the desktop chip/tile sits inside
// DayCell's own outer <button> (see calendar-view.tsx's DayNote comment on
// nested buttons). stopPropagation keeps a tap from also toggling the week.
function GuestCalendarItem({ item, variant, onDarkCell }: { item: CalendarItem; variant: CalendarItemVariant; onDarkCell: boolean }) {
  const openPreview = useContext(OpenPreviewContext);
  const published = item.status === "published";
  const activate = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    openPreview(item);
  };
  const shared = {
    role: "button",
    tabIndex: 0,
    title: contentTypeLabel(item),
    onClick: activate,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") activate(e);
    },
  } as const;

  if (variant === "chip") {
    return (
      <div className="max-w-full">
        <span {...shared} className={`${ITEM_CHIP_CLASS} cursor-pointer`}>
          <ItemChipBody item={item} />
        </span>
      </div>
    );
  }
  return (
    <div className={variant === "strip" ? "w-28 shrink-0" : "w-full"}>
      <span {...shared} className={`${itemTileClassName(published, variant === "tile" && onDarkCell)} cursor-pointer`}>
        <ItemTileBody item={item} published={published} />
      </span>
    </div>
  );
}

function GuestDayNote(props: { cell: CalendarCell; variant: "cell" | "row"; allPublished: boolean; isExpanded: boolean }) {
  return <DayNote {...props} />;
}

const GUEST_SLOTS: CalendarViewSlots = { Item: GuestCalendarItem, Note: GuestDayNote };

export function GuestCalendar({
  projectName,
  monthLabel,
  prevMonthParam,
  nextMonthParam,
  cells,
  weekStartsOn,
  previews,
}: {
  projectName: string;
  monthLabel: string;
  prevMonthParam: string;
  nextMonthParam: string;
  cells: CalendarCell[];
  weekStartsOn: 0 | 1;
  previews: Record<string, GuestPreview>;
}) {
  const [open, setOpen] = useState<GuestPreview | null>(null);
  const openPreview = useCallback((item: CalendarItem) => setOpen(previews[guestPreviewKey(item)] ?? null), [previews]);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-6xl truncate text-xs tracking-wide text-muted uppercase">
          {projectName} — Content Calendar
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
        <OpenPreviewContext.Provider value={openPreview}>
          <CalendarView
            monthLabel={monthLabel}
            prevMonthParam={prevMonthParam}
            nextMonthParam={nextMonthParam}
            cells={cells}
            weekStartsOn={weekStartsOn}
            slots={GUEST_SLOTS}
          />
        </OpenPreviewContext.Provider>
      </div>
      {open && <GuestItemPreview preview={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// One post/story: its media one at a time (arrows/counter for a carousel)
// plus its Caption and Notes as read-only text -- beside the media on
// desktop, below it on mobile. The text is post-level, so changing slides
// never touches it. Media is shown whole (object-contain), not cropped to a
// tile. With neither caption nor notes, the media takes the whole screen.
function GuestItemPreview({ preview, onClose }: { preview: GuestPreview; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const count = preview.media.length;
  const current = preview.media[index];
  const sections = [
    { label: "Caption", text: preview.caption },
    { label: "Notes", text: preview.notes },
  ].filter((section) => section.text.trim() !== "");
  const hasText = sections.length > 0;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (count > 1 && e.key === "ArrowLeft") setIndex((i) => (i - 1 + count) % count);
      if (count > 1 && e.key === "ArrowRight") setIndex((i) => (i + 1) % count);
    }
    window.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [count, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 overflow-y-auto bg-background/98 backdrop-blur-sm lg:overflow-hidden"
    >
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 -z-10 cursor-default" />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="fixed right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground/60 transition-colors duration-150 hover:text-foreground"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <div className={`flex flex-col lg:h-full lg:flex-row ${hasText ? "min-h-full" : "h-full"}`}>
        <div className={`flex flex-col lg:min-h-0 lg:flex-1 ${hasText ? "" : "min-h-0 flex-1"}`}>
          <div
            className={`relative flex items-center justify-center px-4 pt-14 sm:px-16 lg:min-h-0 lg:flex-1 ${
              hasText ? "h-[70dvh] shrink-0 lg:h-auto" : "min-h-0 flex-1"
            }`}
          >
            {count > 1 && (
              <>
                <PreviewArrow direction="prev" onClick={() => setIndex((i) => (i - 1 + count) % count)} />
                <PreviewArrow direction="next" onClick={() => setIndex((i) => (i + 1) % count)} />
              </>
            )}
            {current ? (
              <div
                key={index}
                className={`animate-settle-in h-full max-h-full overflow-hidden bg-black/[.03] ${
                  preview.itemType === "story" ? "aspect-[9/16]" : "aspect-[3/4]"
                } max-w-full`}
              >
                {current.mediaType === "video" ? (
                  <VideoCoverPlayer url={current.url} posterUrl={current.posterUrl} coverTransform={null} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={current.mediaType === "pdf" ? (current.posterUrl ?? current.url) : current.url}
                    alt=""
                    className="h-full w-full object-contain"
                    draggable={false}
                  />
                )}
              </div>
            ) : (
              <p className="text-xs tracking-wide text-muted uppercase">No media yet</p>
            )}
          </div>
          <div className="flex shrink-0 justify-center pt-3 pb-5">
            {count > 1 && (
              <span className="text-xs tracking-wide text-muted uppercase">
                {index + 1} / {count}
              </span>
            )}
          </div>
        </div>

        {hasText && (
          <aside
            data-guest-preview-text
            className="flex w-full flex-col gap-6 border-t border-border bg-background px-6 pt-6 pb-10 lg:w-96 lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-l lg:pt-16"
          >
            {sections.map((section) => (
              <section key={section.label} className="flex flex-col gap-1.5">
                <h3 className="text-[10px] tracking-wide text-muted uppercase">{section.label}</h3>
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{section.text}</p>
              </section>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

function PreviewArrow({ direction, onClick }: { direction: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === "prev" ? "Previous" : "Next"}
      className={`absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground/70 transition-colors duration-150 hover:text-foreground ${
        direction === "prev" ? "left-2 sm:left-4" : "right-2 sm:right-4"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
        <path d={direction === "prev" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
      </svg>
    </button>
  );
}
