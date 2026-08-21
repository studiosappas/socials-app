"use client";

import { memo, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteStory, moveStoryToFolder } from "@/lib/actions/stories";
import { downloadAsset, downloadAssetsAsZip, filenameFromUrl } from "@/lib/download-zip";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import type { ContentFolderItem, StoryFileItem } from "./stories-board";

type MenuView = "root" | "move";

// memo: one of these renders per Content card in the grid, and without it
// every card re-rendered whenever StoriesBoard re-rendered for any reason
// -- see the perf investigation this was added for. onToggleSelect/
// onToggleBulkSelect are stabilized via useCallback at the call site
// (stories-board.tsx) so this actually takes effect.
export const StoryCard = memo(function StoryCard({
  projectId,
  storyId,
  name,
  thumbnailUrl,
  files = [],
  scheduledDate,
  canManage,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  bulkSelected = false,
  onToggleBulkSelect,
  folders = [],
  currentFolderId = null,
}: {
  projectId: string;
  storyId: string;
  name: string;
  thumbnailUrl: string | null;
  files?: StoryFileItem[];
  scheduledDate: string | null;
  canManage: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (storyId: string) => void;
  // Separate, always-available multi-select for bulk Move/Delete (like Grid
  // Media Library's corner circle) -- distinct from `selectionMode` above,
  // which is the full-tile Share-for-Review picker. The two are mutually
  // exclusive in the UI (see the render below) so they never fight over the
  // same click.
  bulkSelected?: boolean;
  onToggleBulkSelect?: (storyId: string) => void;
  folders?: ContentFolderItem[];
  currentFolderId?: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<MenuView>("root");
  const [downloading, setDownloading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => {
    setMenuOpen(false);
    setMenuView("root");
  });
  const href = `/projects/${projectId}/stories/${storyId}`;

  // Warms the intercepted Story editor route's RSC payload as soon as this
  // card is on screen, same fix already proven for Grid tiles -> Post
  // Editor (grid-board.tsx). getStoryPageData runs several sequential
  // Supabase queries; without a prefetch, opening a story was a fully cold
  // navigation every time.
  useEffect(() => {
    router.prefetch(href);
  }, [href, router]);

  if (deleted) return null;

  function handleDelete() {
    setMenuOpen(false);
    if (!confirm("Delete this content? This can't be undone.")) return;
    setDeleted(true);
    startTransition(async () => {
      try {
        await deleteStory(projectId, storyId);
      } catch (error) {
        console.error("Failed to delete story:", error);
        setDeleted(false);
        router.refresh();
      }
    });
  }

  function handleMove(folderId: string | null) {
    setMenuOpen(false);
    setMenuView("root");
    startTransition(async () => {
      await moveStoryToFolder(projectId, storyId, folderId);
      router.refresh();
    });
  }

  async function handleDownload() {
    setMenuOpen(false);
    if (files.length === 0) return;
    setDownloading(true);
    try {
      if (files.length === 1) {
        await downloadAsset(files[0].url, filenameFromUrl(files[0].url, name || "content"));
      } else {
        const zipAssets = files.map((f, i) => ({ url: f.url, filename: filenameFromUrl(f.url, `file-${i + 1}`) }));
        await downloadAssetsAsZip(zipAssets, `${name || "content"}.zip`);
      }
    } finally {
      setDownloading(false);
    }
  }

  // Clicking the tile itself is a Drive-style "open the full-size preview"
  // action now, not a navigation -- Edit Content (in the ⋮ menu below) is
  // the only way into the actual editor. An item with no files yet has
  // nothing to preview, so it falls back to opening the editor directly.
  function handleOpen() {
    if (selectionMode) {
      onToggleSelect?.(storyId);
      return;
    }
    if (files.length > 0) {
      setPreviewOpen(true);
    } else {
      router.push(href);
    }
  }

  return (
    <div className="group relative aspect-[3/4] w-full shrink-0">
      <button
        type="button"
        title={name}
        onClick={handleOpen}
        className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border text-left transition-colors duration-150 ${
          selectionMode ? "cursor-pointer" : "cursor-zoom-in"
        } ${thumbnailUrl ? "border-border hover:border-foreground/30" : "border-dashed border-border"}`}
      >
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs tracking-wide text-muted uppercase">Empty</span>
        )}

        {/* Hover-only affordance -- makes it visually obvious the tile opens
            a full-size preview on click, not just a cursor change (same
            "View larger" intent as MediaFrame's zoom cursor in
            components/media-gallery.tsx). */}
        {!selectionMode && thumbnailUrl && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-150 group-hover:bg-black/20 group-hover:opacity-100">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm">
              <ZoomIcon className="h-4 w-4" />
            </span>
          </span>
        )}
      </button>

      {/* Same corner badge/icon as Grid's own scheduled indicator -- kept
          top-left, matching the ⋮ menu's top-right so the two never collide.
          While selecting for Review, the selection circle takes this same
          corner instead, same reasoning as Grid's own slots. */}
      {selectionMode ? (
        <span
          title={selected ? "Deselect" : "Select"}
          className="pointer-events-none absolute left-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full"
        >
          {selected ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" className="fill-accent" stroke="white" strokeWidth="1" />
              <path d="M4.8 8.2 6.8 10.1 11.2 5.7" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" className="fill-black/30" stroke="white" strokeWidth="1.2" />
            </svg>
          )}
        </span>
      ) : (
        scheduledDate && (
          <span
            title={`Scheduled for ${scheduledDate}`}
            className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-white"
          >
            <ScheduledIcon className="h-2.5 w-2.5" />
          </span>
        )
      )}

      {/* Bulk-select circle for Move/Delete-all-at-once -- exact top-left
          corner, same spot/hover-reveal pattern as Grid Media Library's
          MediaThumb (always visible on touch via pointer-coarse, hover-only
          on desktop). Hidden during Share's selectionMode, which already
          owns that corner as its own picker. */}
      {canManage && !selectionMode && onToggleBulkSelect && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleBulkSelect(storyId);
          }}
          title={bulkSelected ? "Deselect" : "Select"}
          className={`absolute left-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full transition-opacity duration-150 group-hover:opacity-100 pointer-coarse:opacity-100 ${
            bulkSelected ? "opacity-100" : "opacity-0"
          }`}
        >
          {bulkSelected ? (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="10" className="fill-accent" stroke="white" strokeWidth="1.2" />
              <path d="M6.6 11.3 9.3 14 15.4 7.9" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="10" className="fill-black/30" stroke="white" strokeWidth="1.4" />
            </svg>
          )}
        </button>
      )}

      {canManage && !selectionMode && (
        <div ref={menuRef} className="absolute right-1 top-1 z-10">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title="Content options"
            className="rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
          >
            ⋮
          </button>
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-7 w-40 max-w-[calc(100vw-1.5rem)] rounded-none border border-border bg-background p-1 shadow-lg"
            >
              {menuView === "root" && (
                <>
                  <Link
                    href={href}
                    onClick={() => setMenuOpen(false)}
                    className="block rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                  >
                    Edit Content
                  </Link>
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={downloading || files.length === 0}
                    className="block w-full rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05] disabled:opacity-50"
                  >
                    {downloading ? "Downloading…" : "Download"}
                  </button>
                  {folders.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setMenuView("move")}
                      className="block w-full rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                    >
                      Move to Folder
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="w-full rounded px-2 py-1 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05]"
                  >
                    Delete Content
                  </button>
                </>
              )}

              {menuView === "move" && (
                <>
                  <button
                    type="button"
                    onClick={() => setMenuView("root")}
                    className="block w-full rounded px-2 py-1 text-left text-xs text-muted transition-colors duration-150 hover:bg-black/[.05]"
                  >
                    ← Back
                  </button>
                  {currentFolderId && (
                    <button
                      type="button"
                      onClick={() => handleMove(null)}
                      className="block w-full rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                    >
                      Unfiled
                    </button>
                  )}
                  {folders
                    .filter((f) => f.id !== currentFolderId)
                    .map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => handleMove(f.id)}
                        className="block w-full truncate rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                      >
                        {f.name}
                      </button>
                    ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {previewOpen && (
        <AssetPreviewModal files={files} initialIndex={0} name={name} onClose={() => setPreviewOpen(false)} />
      )}
    </div>
  );
});

// Drive-style "click a file to see it full-size" preview -- unlike the
// crop-oriented Lightbox shared by the Client Review/Shared Preview flows
// (components/media-gallery.tsx, fixed post/story aspect boxes with
// object-cover), this shows each file at its own natural aspect ratio via
// object-contain, since these can be arbitrary standalone assets dropped in
// via the bulk-upload zone, not just story-shaped frames.
function AssetPreviewModal({
  files,
  initialIndex,
  name,
  onClose,
}: {
  files: StoryFileItem[];
  initialIndex: number;
  name: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [downloading, setDownloading] = useState(false);
  const file = files[index];

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + files.length) % files.length);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % files.length);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, files.length]);

  if (!file) return null;

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadAsset(file.url, filenameFromUrl(file.url, name || "content"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/98 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 -z-10 cursor-default"
      />
      {/* Same top-right corner as Grid's own icon-button row (e.g. the
          Media Library toolbar) -- a bare icon, no label, sitting just left
          of Close so the two read as one cluster. */}
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        aria-label="Download"
        title="Download"
        className="absolute right-16 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full text-foreground/60 transition-colors duration-150 hover:text-foreground disabled:opacity-50"
      >
        <DownloadIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full text-foreground/60 transition-colors duration-150 hover:text-foreground"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-16">
        {files.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => setIndex((i) => (i - 1 + files.length) % files.length)}
              aria-label="Previous"
              className="absolute left-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-foreground/50 transition-colors duration-150 hover:text-foreground sm:left-4"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setIndex((i) => (i + 1) % files.length)}
              aria-label="Next"
              className="absolute right-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-foreground/50 transition-colors duration-150 hover:text-foreground sm:right-4"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}

        {/* Keyed by index, not file.url -- the url is a signed URL that gets
            a new token every time it's re-signed even though the underlying
            file didn't change, so keying by it forced a full remount (video
            restart/image flash) on every unrelated background revalidation,
            not just on an actual Prev/Next navigation. index is stable for
            "which file is this" across re-signs, and still changes exactly
            when the user navigates to a different file. */}
        {file.mediaType === "video" ? (
          <video
            key={index}
            src={file.url}
            controls
            playsInline
            autoPlay
            className="max-h-[86dvh] max-w-[92vw] object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={index} src={file.url} alt="" className="max-h-[86dvh] max-w-[92vw] object-contain" />
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1 pb-6">
        <span className="text-sm text-foreground">{name}</span>
        {files.length > 1 && (
          <span className="text-xs tracking-wide text-muted uppercase">
            {index + 1} / {files.length}
          </span>
        )}
      </div>
    </div>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M12 4v12M12 16l-4.5-4.5M12 16l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ZoomIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21M10.5 8v5M8 10.5h5" strokeLinecap="round" />
    </svg>
  );
}

function ScheduledIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
