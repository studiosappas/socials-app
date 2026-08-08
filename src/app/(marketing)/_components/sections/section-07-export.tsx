"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { ScrollReveal } from "../motion/scroll-reveal";
import { LandingMedia } from "../landing-media";
import { EXPORT_SECTION_CONTENT, DEMO_EXPORT_FEED, DEMO_PDF_PAGE_COUNT, DEMO_CLIENT_GALLERY_NAME } from "@/lib/landing";

const ASPECT_CLASS: Record<"post" | "story", string> = {
  post: "aspect-[3/4]",
  story: "aspect-[9/16]",
};

// The real export/share entry point on Grid is a single share icon in the
// toolbar (share-menu.tsx: ShareMenuButton) opening a small dropdown --
// "Export Full Feed" / "Export Client PDF" (download links) plus "Share
// With Client" (opens a real Dialog listing share links). First pass at
// this clone showed three separate always-visible "big black button"
// panels instead, which isn't how the real interaction reads at all.
export function ExportSection() {
  const posts = DEMO_EXPORT_FEED.filter((e) => e.kind === "post");
  const stories = DEMO_EXPORT_FEED.filter((e) => e.kind === "story");
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  return (
    <section id="export" className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-24 sm:px-8">
      <ScrollReveal className="text-center">
        <h2 className="text-3xl font-light sm:text-4xl">{EXPORT_SECTION_CONTENT.headline}</h2>
      </ScrollReveal>

      <ScrollReveal delay={0.1} className="flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <p className="text-xs tracking-wide text-muted uppercase">Your Feed</p>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              title="Share & export"
              className="rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
            >
              <ShareIcon />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 w-56 rounded-none border border-border bg-background p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                >
                  Export Full Feed
                </button>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                >
                  Export Client PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setShareDialogOpen(true);
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                >
                  Share With Client
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-[2px] sm:grid-cols-6">
          {[...posts, ...posts].slice(0, 6).map((p, i) => (
            <LandingMedia key={`${p.id}-${i}`} media={p.image} className={ASPECT_CLASS.post} />
          ))}
        </div>
      </ScrollReveal>

      <ShareWithClientDialog open={shareDialogOpen} onClose={() => setShareDialogOpen(false)} stories={stories} />
    </section>
  );
}

// Reuses the real Dialog primitive (src/components/ui/dialog.tsx) directly
// -- generic, no Supabase coupling -- and mirrors ShareLinksList's real
// structure (share-menu.tsx): a short explainer, then existing links with a
// working copy-to-clipboard, plus a PDF-stack + gallery preview underneath.
function ShareWithClientDialog({
  open,
  onClose,
  stories,
}: {
  open: boolean;
  onClose: () => void;
  stories: typeof DEMO_EXPORT_FEED;
}) {
  const [copied, setCopied] = useState(false);
  const demoUrl = "socials.app/preview/9f3k2p";

  function handleCopy() {
    navigator.clipboard?.writeText(`https://${demoUrl}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Share With Client" widthClassName="max-w-2xl" radius="none">
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">
          A view-only gallery link for selected content — ideal for sending to clients for review before approval.
        </p>

        <div className="flex items-center justify-between border-t border-b border-border py-3">
          <div>
            <p className="text-sm font-medium">{DEMO_CLIENT_GALLERY_NAME}</p>
            <p className="text-xs text-muted">{demoUrl}</p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 text-xs tracking-wide uppercase transition-colors duration-150 hover:text-muted"
          >
            {copied ? "Copied" : "Copy Link"}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {stories.map((s) => (
            <LandingMedia key={s.id} media={s.image} className={`${ASPECT_CLASS.story} rounded-md`} />
          ))}
        </div>

        <p className="text-xs tracking-wide text-muted uppercase">Export Client PDF — {DEMO_PDF_PAGE_COUNT} pages</p>
      </div>
    </Dialog>
  );
}

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 1V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M4.5 4L7.5 1L10.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M2.5 8.5V11.5C2.5 12.05 2.95 12.5 3.5 12.5H11.5C12.05 12.5 12.5 12.05 12.5 11.5V8.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
