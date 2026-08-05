"use client";

import { useState } from "react";
import { externalUrl, socialProfileUrl } from "@/lib/social-links";
import type { Platform } from "@/types/database";

const labelClass = "text-xs tracking-wide text-muted uppercase";

const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  youtube: "YouTube",
};

export function BrandPanel({
  projectName,
  brandNotes,
  contentPillars,
  igUsername,
  igDisplayName,
  igBio,
  websiteUrl,
  industry,
  platform,
  instagramUrl,
  tiktokUrl,
  profilePhotoUrl,
  postsPerWeek,
  storiesPerWeek,
  reelsPerWeek,
  newsletterPerWeek,
}: {
  projectName: string;
  brandNotes: string;
  contentPillars: string;
  igUsername: string;
  igDisplayName: string;
  igBio: string;
  websiteUrl: string;
  industry: string;
  platform: Platform;
  instagramUrl: string;
  tiktokUrl: string;
  profilePhotoUrl: string | null;
  postsPerWeek: number;
  storiesPerWeek: number;
  reelsPerWeek: number;
  newsletterPerWeek: number;
}) {
  const displayName = igDisplayName || projectName;
  // Collapsed by default on mobile so the grid itself (the main reason
  // someone opens this page) is visible without first scrolling past the
  // full profile -- always expanded on desktop regardless of this state.
  const [mobileExpanded, setMobileExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-6 text-sm">
      <button
        type="button"
        onClick={() => setMobileExpanded((v) => !v)}
        className="flex items-center justify-between gap-3 text-left lg:cursor-default"
      >
        <div className="flex items-center gap-3">
          {profilePhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profilePhotoUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="h-12 w-12 shrink-0 rounded-full border border-dashed border-border" />
          )}
          <h1 className="truncate text-3xl">{displayName || "User Name"}</h1>
        </div>
        <ChevronIcon
          className={`h-4 w-4 shrink-0 text-muted transition-transform duration-150 lg:hidden ${
            mobileExpanded ? "rotate-180" : ""
          }`}
        />
      </button>

      <div className={`flex-col gap-6 ${mobileExpanded ? "flex" : "hidden"} lg:flex`}>
        <div className="flex flex-col gap-1 text-sm text-muted">
          {igUsername ? (
            <a
              href={socialProfileUrl(platform, igUsername, { instagramUrl, tiktokUrl }) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="w-fit transition-colors duration-150 hover:text-foreground"
            >
              @{igUsername}
            </a>
          ) : (
            <p>username</p>
          )}
          {websiteUrl ? (
            <a
              href={externalUrl(websiteUrl) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="w-fit transition-colors duration-150 hover:text-foreground"
            >
              {websiteUrl}
            </a>
          ) : (
            <p>URL</p>
          )}
          <div className="flex items-center justify-between">
            <span>{industry || "Industry"}</span>
            <span>{PLATFORM_LABEL[platform]}</span>
          </div>
        </div>

        {igBio && <p className="whitespace-pre-wrap text-sm">{igBio}</p>}

        <div className="flex flex-col gap-4">
          <ExpandableField label="Notes" value={brandNotes} />
          <ExpandableField label="Content Pillars" value={contentPillars} />
        </div>

        <p className={`${labelClass} flex flex-wrap items-baseline gap-x-1`}>
          <strong className="text-foreground">{String(postsPerWeek).padStart(2, "0")}</strong> Posts /
          <strong className="text-foreground">{String(storiesPerWeek).padStart(2, "0")}</strong> Stories /
          <strong className="text-foreground">{String(reelsPerWeek).padStart(2, "0")}</strong> Reels /
          <strong className="text-foreground">{String(newsletterPerWeek).padStart(2, "0")}</strong> Newsletter a week
        </p>
      </div>
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Grid is display-only -- editing happens exclusively on the Overview page.
// The "+" only expands/collapses already-saved content; it never opens an
// editable field. Reference interaction: framacph.com's product info
// accordions (inline expand, content pushes the rest of the column down,
// read-only, subtle motion).
function ExpandableField({ label, value }: { label: string; value: string }) {
  const [open, setOpen] = useState(false);

  if (!value) {
    return (
      <div className="flex items-center justify-between border-b border-foreground py-1 text-xs tracking-wide uppercase text-muted">
        <span>{label}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center justify-between border-b border-foreground py-1 text-left text-xs tracking-wide uppercase text-muted transition-colors duration-150 hover:text-foreground"
      >
        <span>{label}</span>
        <span
          className="inline-block text-sm normal-case transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ transform: open ? "rotate(45deg)" : "rotate(0deg)" }}
        >
          +
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <p className="whitespace-pre-wrap pt-2 text-sm text-muted">{value}</p>
        </div>
      </div>
    </div>
  );
}
