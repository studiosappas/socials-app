"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  addBrandLink,
  analyzeBrandDocument,
  deleteBrandDocument,
  generateAiInsights,
  generateBrandSections,
  generateBrandSummary,
  refreshBrandIntelligence,
  suggestPersonalitySpectrum,
  updateBrandStrategy,
  updateSpectrumValue,
  uploadBrandDocument,
} from "@/lib/actions/overview";
import { updateProjectProfile } from "@/lib/actions/projects";
import { updateTaskStatus } from "@/lib/actions/todo";
import { externalUrl, socialProfileUrl } from "@/lib/social-links";
import type { AiInsights, Platform } from "@/types/database";

const labelClass = "text-xs font-semibold tracking-wide uppercase";
const fieldClass =
  "rounded-none border border-border bg-transparent px-2 py-1.5 text-sm focus:border-foreground focus:outline-none";

const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  youtube: "YouTube",
};
const PLATFORM_OPTIONS: Platform[] = ["instagram", "tiktok", "pinterest", "youtube"];

// ---------------------------------------------------------------------------
// Profile panel (left, top) -- read view mirrors Grid's now-read-only
// BrandPanel, but this is the one place these fields are actually editable.
// ---------------------------------------------------------------------------

export type ProjectSectionItem = { id: string; title: string; body: string };

export function ProfilePanel({
  projectId,
  projectName,
  brandNotes,
  contentPillars,
  sections,
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
  canManage,
}: {
  projectId: string;
  projectName: string;
  brandNotes: string;
  contentPillars: string;
  sections: ProjectSectionItem[];
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
  canManage: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  // Stable across re-renders: EditProfileDialog never unmounts (only its
  // <Dialog> wrapper conditionally renders), so its "close on success"
  // effect depends on this reference staying the same. An inline arrow
  // function here would get recreated on every ProfilePanel re-render
  // (e.g. right after a save, when fresh server props arrive) and that new
  // reference alone re-triggers the effect -- which, since useActionState's
  // `state` never resets and is still the last {success:true}, immediately
  // re-closes the dialog the next time it's opened.
  const closeEdit = useCallback(() => setEditOpen(false), []);
  const displayName = igDisplayName || projectName;

  return (
    <div className="flex flex-col gap-6 text-sm">
      <div className="flex items-center gap-3">
        {profilePhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profilePhotoUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="h-12 w-12 shrink-0 rounded-full border border-dashed border-border" />
        )}
        <h1 className="truncate text-3xl font-light">{displayName || "User Name"}</h1>
      </div>

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
          {(() => {
            const profileUrl = socialProfileUrl(platform, igUsername, { instagramUrl, tiktokUrl });
            return profileUrl ? (
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-foreground transition-colors duration-150 hover:text-muted"
              >
                {PLATFORM_LABEL[platform]}
              </a>
            ) : (
              <span className="font-semibold text-foreground">{PLATFORM_LABEL[platform]}</span>
            );
          })()}
        </div>
      </div>

      {igBio && <p className="whitespace-pre-wrap text-sm">{igBio}</p>}

      <div className="flex flex-col gap-4">
        <ExpandableField label="Notes" value={brandNotes} />
        <ExpandableField label="Content Pillars" value={contentPillars} />
        {sections.map((s) => (
          <ExpandableField key={s.id} label={s.title || "Section"} value={s.body} />
        ))}
        {canManage && (
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="flex items-center justify-between border-b border-foreground py-1 text-left text-xs tracking-wide uppercase text-muted transition-colors duration-150 hover:text-foreground"
          >
            <span>Add Section</span>
            <span className="text-sm normal-case">+</span>
          </button>
        )}
      </div>

      {canManage && (
        <Button
          type="button"
          variant="primary"
          radius="none"
          onClick={() => setEditOpen(true)}
          className="w-full tracking-wide uppercase"
        >
          Edit Profile
        </Button>
      )}

      {canManage && (
        <EditProfileDialog
          projectId={projectId}
          open={editOpen}
          onClose={closeEdit}
          name={displayName}
          username={igUsername}
          bio={igBio}
          notes={brandNotes}
          contentPillars={contentPillars}
          sections={sections}
          avatarUrl={profilePhotoUrl}
          website={websiteUrl}
          industry={industry}
          platform={platform}
          instagramUrl={instagramUrl}
          tiktokUrl={tiktokUrl}
          postsPerWeek={postsPerWeek}
          storiesPerWeek={storiesPerWeek}
          reelsPerWeek={reelsPerWeek}
          newsletterPerWeek={newsletterPerWeek}
        />
      )}
    </div>
  );
}

function EditProfileDialog({
  projectId,
  open,
  onClose,
  name,
  username,
  bio,
  notes,
  contentPillars,
  sections,
  avatarUrl,
  website,
  industry,
  platform,
  instagramUrl,
  tiktokUrl,
  postsPerWeek,
  storiesPerWeek,
  reelsPerWeek,
  newsletterPerWeek,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  name: string;
  username: string;
  bio: string;
  notes: string;
  contentPillars: string;
  sections: ProjectSectionItem[];
  avatarUrl: string | null;
  website: string;
  industry: string;
  platform: Platform;
  instagramUrl: string;
  tiktokUrl: string;
  postsPerWeek: number;
  storiesPerWeek: number;
  reelsPerWeek: number;
  newsletterPerWeek: number;
}) {
  const [state, action, pending] = useActionState(updateProjectProfile.bind(null, projectId), undefined);
  const [rows, setRows] = useState(() => sections.map((s) => ({ title: s.title, body: s.body })));
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(platform);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(sections.map((s) => ({ title: s.title, body: s.body })));
    setSelectedPlatform(platform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (state?.success) onClose();
  }, [state, onClose]);

  return (
    <Dialog open={open} onClose={onClose} title="Edit profile" radius="none" widthClassName="max-w-md">
      <form action={action} className="flex flex-col gap-5">
        <input type="hidden" name="sections_json" value={JSON.stringify(rows)} />

        <div className="flex items-center gap-3">
          <label className="relative flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border">
            {preview || avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview || avatarUrl!} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-lg text-muted">+</span>
            )}
            <input
              type="file"
              name="avatar"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setPreview(URL.createObjectURL(file));
              }}
            />
          </label>
          <input
            name="name"
            defaultValue={name}
            placeholder="User Name"
            className="flex-1 border-0 border-b border-border bg-transparent py-1 text-lg focus:border-foreground focus:outline-none"
          />
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>@Username</span>
          <input name="username" defaultValue={username} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Bio</span>
          <textarea name="bio" defaultValue={bio} rows={3} placeholder="Add your bio here" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Notes</span>
          <textarea name="notes" defaultValue={notes} rows={3} placeholder="Live text for notes" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Content Pillars</span>
          <textarea
            name="content_pillars"
            defaultValue={contentPillars}
            rows={3}
            placeholder="Live text for content pillars"
            className={fieldClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>URL</span>
          <input name="website" defaultValue={website} placeholder="https://..." className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Industry</span>
          <input name="industry" defaultValue={industry} placeholder="Industry" className={fieldClass} />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>Platform</span>
          <input type="hidden" name="platform" value={selectedPlatform} />
          <div className="flex gap-2">
            {PLATFORM_OPTIONS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setSelectedPlatform(p)}
                className={`rounded-full border px-4 py-1.5 text-xs tracking-wide uppercase transition-colors duration-150 ${
                  selectedPlatform === p
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-foreground hover:border-foreground/40"
                }`}
              >
                {PLATFORM_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Instagram URL</span>
          <input
            name="instagram_url"
            defaultValue={instagramUrl}
            placeholder="https://instagram.com/..."
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>TikTok URL</span>
          <input
            name="tiktok_url"
            defaultValue={tiktokUrl}
            placeholder="https://tiktok.com/@..."
            className={fieldClass}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>Content Amount a Week</span>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] tracking-wide text-muted uppercase">Posts</span>
              <input
                type="number"
                min={0}
                name="posts_per_week"
                defaultValue={postsPerWeek}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] tracking-wide text-muted uppercase">Stories</span>
              <input
                type="number"
                min={0}
                name="stories_per_week"
                defaultValue={storiesPerWeek}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] tracking-wide text-muted uppercase">Reels</span>
              <input
                type="number"
                min={0}
                name="reels_per_week"
                defaultValue={reelsPerWeek}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] tracking-wide text-muted uppercase">Newsletter</span>
              <input
                type="number"
                min={0}
                name="newsletter_per_week"
                defaultValue={newsletterPerWeek}
                className={fieldClass}
              />
            </label>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="flex flex-col gap-3">
            {rows.map((row, i) => (
              <div key={i} className="flex flex-col gap-1.5 border border-border p-2">
                <div className="flex items-center gap-2">
                  <input
                    value={row.title}
                    onChange={(e) =>
                      setRows((r) => r.map((it, idx) => (idx === i ? { ...it, title: e.target.value } : it)))
                    }
                    placeholder="Section title"
                    className="flex-1 border-0 bg-transparent text-xs font-semibold tracking-wide uppercase focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
                    className="text-muted hover:text-error"
                  >
                    ×
                  </button>
                </div>
                <textarea
                  value={row.body}
                  onChange={(e) =>
                    setRows((r) => r.map((it, idx) => (idx === i ? { ...it, body: e.target.value } : it)))
                  }
                  rows={2}
                  className="border-0 bg-transparent text-sm focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setRows((r) => [...r, { title: "", body: "" }])}
          className="w-fit text-left text-xs font-semibold tracking-wide uppercase transition-colors duration-150 hover:text-muted"
        >
          + Add Section
        </button>

        {state?.message && <p className="text-xs text-error">{state.message}</p>}
        <Button type="submit" variant="primary" radius="none" disabled={pending} className="w-full">
          {pending ? "Saving..." : "Save Changes"}
        </Button>
      </form>
    </Dialog>
  );
}

// Reference interaction: framacph.com's product info accordions (inline
// expand, content pushes the rest of the column down, subtle motion).
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

// ---------------------------------------------------------------------------
// Workplace insights (left, bottom)
// ---------------------------------------------------------------------------

export type TaskDueTodayItem = { id: string; title: string };

export function WorkplaceInsightsPanel({
  items,
  reminders,
  tasksDueToday,
}: {
  items: string[];
  reminders: string[];
  tasksDueToday: TaskDueTodayItem[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const visibleTasks = tasksDueToday.filter((t) => !completedIds.has(t.id));

  function handleToggle(taskId: string) {
    // Optimistically drop it from "due today" immediately -- checking a task
    // off should feel instant, not wait on a server round trip.
    setCompletedIds((prev) => new Set(prev).add(taskId));
    startTransition(async () => {
      await updateTaskStatus(taskId, "done");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className={labelClass}>Workplace Insights</h2>
      <p className="text-xs font-semibold tracking-wide text-muted uppercase italic">Today&apos;s Focus</p>
      <div className="flex flex-col gap-2">
        {items.map((label, i) => (
          <label key={`i-${i}`} className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled className="h-3.5 w-3.5 rounded-none border-border" />
            <span>{label}</span>
          </label>
        ))}
        {visibleTasks.map((task) => (
          <label
            key={task.id}
            className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm transition-colors duration-150 hover:border-border hover:bg-black/[.02]"
          >
            <input
              type="checkbox"
              onChange={() => handleToggle(task.id)}
              className="h-3.5 w-3.5 shrink-0 rounded-none accent-foreground"
            />
            <span className="truncate">{task.title}</span>
          </label>
        ))}
        {reminders.map((label, i) => (
          <label key={`r-${i}`} className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" disabled className="h-3.5 w-3.5 rounded-none border-border" />
            <span>{label}</span>
          </label>
        ))}
        {items.length === 0 && reminders.length === 0 && visibleTasks.length === 0 && (
          <p className="text-sm text-muted">Nothing needs attention today.</p>
        )}
      </div>
      <Link
        href="/projects/todo"
        className="mt-2 block rounded-none bg-foreground px-4 py-3 text-center text-xs tracking-wide text-background uppercase transition-colors duration-150 hover:bg-black/85"
      >
        Go to → To Do List
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand knowledge upload hub (right, top)
// ---------------------------------------------------------------------------

export type BrandDocumentItem = {
  id: string;
  sourceType: "file" | "link";
  filename: string;
  url: string | null;
  aiAnalysis: string;
  createdAt: string;
};

// Up to 8 tiles placed at equal angles on a precise circle (radius 36% of
// the container) around the center hub -- laid out dynamically for however
// many real documents exist (not a fixed 8 slots padded with placeholders),
// so a project with e.g. 3 files shows 3 evenly-spaced tiles, not 3 tiles
// plus 5 empty "File" ghosts.
const TILE_RADIUS_PCT = 36;
const MAX_ORBIT_TILES = 8;
const TILE_SIZES = ["19%", "16%", "18%", "15%", "19%", "16%", "18%", "15%"];
function computeTileLayout(count: number): { top: string; left: string; size: string }[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i * 360) / count - 90; // start at the top, go clockwise
    const radians = (angle * Math.PI) / 180;
    const left = 50 + TILE_RADIUS_PCT * Math.cos(radians);
    const top = 50 + TILE_RADIUS_PCT * Math.sin(radians);
    return { top: `${top}%`, left: `${left}%`, size: TILE_SIZES[i % TILE_SIZES.length] };
  });
}

// A handful of small dots traveling along the same circular path the file
// tiles sit on -- unevenly spaced (not a clean 360/N split) so they read as
// independent points of motion rather than a single spinning shape.
const ORBIT_DOT_ANGLES = [0, 70, 160, 210, 300];
const ORBIT_DOT_LAYOUT: { top: string; left: string }[] = ORBIT_DOT_ANGLES.map((angle) => {
  const radians = (angle * Math.PI) / 180;
  return {
    left: `${50 + TILE_RADIUS_PCT * Math.cos(radians)}%`,
    top: `${50 + TILE_RADIUS_PCT * Math.sin(radians)}%`,
  };
});

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path
        d="M17.5 6.5 9 15a3 3 0 1 0 4.24 4.24l7.07-7.07a5 5 0 1 0-7.07-7.07L5.5 12.83"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Wraps Brand Knowledge + Brand Spectrum so uploading a file/link can drive a
// loading state across both: "the AI will feed and summarize and the whole
// sections... will be loading... and the spectrum will move."
export function BrandIntelligenceSection({
  projectId,
  documents,
  strategy,
  canManage,
}: {
  projectId: string;
  documents: BrandDocumentItem[];
  strategy: BrandStrategyData;
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState(false);

  function handleIntelligenceRefresh(documentId?: string) {
    setRefreshing(true);
    startTransition(async () => {
      await refreshBrandIntelligence(projectId, documentId);
      router.refresh();
      setRefreshing(false);
    });
  }

  return (
    <div className="flex flex-col gap-12">
      <BrandKnowledgePanel
        projectId={projectId}
        documents={documents}
        canManage={canManage}
        refreshing={refreshing}
        onIntelligenceRefresh={handleIntelligenceRefresh}
      />
      <BrandSpectrumPanel
        projectId={projectId}
        strategy={strategy}
        canManage={canManage}
        externalRefreshing={refreshing}
      />
    </div>
  );
}

export function BrandKnowledgePanel({
  projectId,
  documents,
  canManage,
  refreshing,
  onIntelligenceRefresh,
}: {
  projectId: string;
  documents: BrandDocumentItem[];
  canManage: boolean;
  refreshing?: boolean;
  onIntelligenceRefresh: (documentId?: string) => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Auto-spins briefly on mount, then pauses; hovering anywhere in the
  // cluster (including the gaps between tiles) resumes it. This toggles
  // animation-play-state on a single persistent animation instance (see
  // globals.css) rather than swapping keyframes, so pausing/resuming always
  // holds the exact current rotation instead of snapping to a new one.
  const [autoSpinning, setAutoSpinning] = useState(true);
  const [hovering, setHovering] = useState(false);
  const isSpinning = autoSpinning || hovering;

  useEffect(() => {
    const timer = setTimeout(() => setAutoSpinning(false), 6000);
    return () => clearTimeout(timer);
  }, []);

  const fileCount = documents.filter((d) => d.sourceType === "file").length;
  const linkCount = documents.filter((d) => d.sourceType === "link").length;
  const latest = documents[0];

  // Only real, uploaded documents get a tile -- no placeholder "File" ghosts
  // padding the ring out to a fixed 8 slots.
  const tiles = documents.slice(0, MAX_ORBIT_TILES);
  const tileLayout = computeTileLayout(tiles.length);

  function handleDelete(documentId: string) {
    startTransition(async () => {
      await deleteBrandDocument(projectId, documentId);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* .knowledge-wheel covers the full square, so hovering anywhere inside
          it -- including the empty gaps between tiles -- triggers the ring
          rotation (see globals.css), not just hovering an individual tile. */}
      {/* overflow-hidden matters here beyond tidiness: a rotated element's
          axis-aligned bounding box is wider than its resting square (a
          rotate(45deg) square's bounding box is ~1.4x wider), and CSS
          transforms count toward an ancestor's scrollable overflow in
          Chromium/WebKit -- without a clip, the ring mid-spin was pushing
          the whole page's horizontal scroll extent past the viewport on
          mobile, letting a swipe drag the entire page sideways. The tiles
          themselves are already positioned within this square (radius 36%
          from center, per TILE_RADIUS_PCT), so clipping here only removes
          the invisible rotated-bbox excess, not any real content. */}
      <div
        className="knowledge-wheel relative mx-auto aspect-square w-full max-w-md overflow-hidden"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        // Touch has no hover state, so without this the ring only ever
        // spins once (the auto-spin on mount) for mobile users -- a tap
        // anywhere in the cluster resumes it the same way hovering does on
        // desktop.
        onTouchStart={() => setHovering(true)}
        onTouchEnd={() => setHovering(false)}
      >
        {/* The orbit line + traveling dots sit behind the file tiles (painted
            first, tiles come after) and never pause -- unlike the tile ring,
            which only spins on hover/tap, this stays gently in motion at
            rest so the section reads as continuous, ambient "the AI is
            always learning" rather than something you have to trigger. */}
        <div className="knowledge-orbit-ring" aria-hidden="true" />
        <div className="knowledge-orbit-dots" aria-hidden="true">
          {ORBIT_DOT_LAYOUT.map((d, i) => (
            <span key={i} className="knowledge-orbit-dot" style={{ top: d.top, left: d.left }} />
          ))}
        </div>
        <div className={`knowledge-wheel-ring absolute inset-0 ${isSpinning ? "is-spinning" : ""}`}>
          {tiles.map((doc, i) => {
            const t = tileLayout[i];
            return (
              // Keyed by the document's own id now, not slot index -- there
              // are no placeholder slots left to worry about "popping" into,
              // and every tile's angle is recomputed from the current count
              // (see computeTileLayout), so keeping doc.id as the key lets
              // React correctly track *which* tile moved when the count
              // changes, instead of reusing/mismatching DOM nodes by position.
              <div
                key={doc.id}
                style={{ top: t.top, left: t.left, width: t.size }}
                className="knowledge-tile absolute aspect-square rounded-[15%] flex flex-col items-center justify-center gap-1 overflow-hidden border border-dashed border-border bg-black/[.02] p-2 text-center text-[10px] tracking-wide text-muted uppercase"
              >
                <span className="text-2xl">{doc.sourceType === "link" ? "🔗" : "📄"}</span>
                <span className="line-clamp-2 leading-tight">{doc.filename}</span>
              </div>
            );
          })}
        </div>
        <div className="absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            disabled={!canManage}
            title="Add brand knowledge"
            className="flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-background text-muted transition-colors duration-150 hover:border-foreground/40 hover:text-foreground disabled:cursor-default"
          >
            <PaperclipIcon className="h-6 w-6" />
          </button>
          <span className="w-24 text-center text-[10px] tracking-wide text-muted uppercase">
            Upload or drop your assets
          </span>
        </div>
      </div>

      <div className="text-center">
        <p className={labelClass}>Brand Knowledge</p>
        <p className="text-xs text-muted">Help AI Understand Your Brand</p>
      </div>

      <p className="text-center text-[10px] text-muted">
        {refreshing
          ? "AI is analyzing your brand knowledge..."
          : `AI has analyzed: ${fileCount} File${fileCount === 1 ? "" : "s"}${
              linkCount > 0 ? ` // ${linkCount} Link${linkCount === 1 ? "" : "s"}` : ""
            }${latest ? ` // Last updated ${relativeTime(latest.createdAt)}` : ""}`}
      </p>

      <BrandKnowledgeDialog
        projectId={projectId}
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        documents={documents}
        onDelete={handleDelete}
        onUploaded={onIntelligenceRefresh}
      />
    </div>
  );
}

function BrandKnowledgeDialog({
  projectId,
  open,
  onClose,
  documents,
  onDelete,
  onUploaded,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  documents: BrandDocumentItem[];
  onDelete: (id: string) => void;
  onUploaded: (documentId?: string) => void;
}) {
  const [fileState, fileAction, filePending] = useActionState(uploadBrandDocument.bind(null, projectId), undefined);
  const [linkState, linkAction, linkPending] = useActionState(addBrandLink.bind(null, projectId), undefined);
  const [, startTransition] = useTransition();
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const router = useRouter();
  const fileFormRef = useRef<HTMLFormElement>(null);
  const linkFormRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fileState?.success) {
      fileFormRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingFileName(null);
      onUploaded(fileState.documentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileState]);
  useEffect(() => {
    if (linkState?.success) {
      linkFormRef.current?.reset();
      onUploaded(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkState]);

  function handleAnalyze(documentId: string) {
    setAnalyzingId(documentId);
    startTransition(async () => {
      await analyzeBrandDocument(projectId, documentId);
      setAnalyzingId(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title="Brand knowledge" radius="none" widthClassName="max-w-lg">
      <div className="flex flex-col gap-5">
        <form ref={fileFormRef} action={fileAction} className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            accept=".pdf,.doc,.docx,.txt"
            required
            className="hidden"
            onChange={(e) => setPendingFileName(e.target.files?.[0]?.name ?? null)}
          />
          <Button
            type="button"
            variant="secondary"
            radius="full"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 truncate text-left"
          >
            {pendingFileName ?? "Choose File"}
          </Button>
          <Button type="submit" variant="primary" radius="full" disabled={filePending || !pendingFileName}>
            {filePending ? "Uploading..." : "Upload"}
          </Button>
        </form>
        {fileState?.message && <p className="text-xs text-error">{fileState.message}</p>}

        <form ref={linkFormRef} action={linkAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            name="label"
            placeholder="Label (Website, Instagram...)"
            className={`w-full min-w-0 ${fieldClass} rounded-full sm:w-40`}
          />
          <input name="url" placeholder="https://..." className={`w-full min-w-0 ${fieldClass} rounded-full sm:flex-1`} />
          <Button type="submit" variant="primary" radius="full" disabled={linkPending} className="w-full sm:w-auto">
            {linkPending ? "Adding..." : "Add link"}
          </Button>
        </form>
        {linkState?.message && <p className="text-xs text-error">{linkState.message}</p>}

        <div className="flex flex-col gap-2">
          {documents.map((doc) => (
            <div key={doc.id} className="flex flex-col gap-1 border border-border p-2">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm">
                  {doc.sourceType === "link" ? "🔗" : "📄"} {doc.filename}
                </span>
                <div className="flex shrink-0 items-center gap-3 text-xs tracking-wide text-muted uppercase">
                  {doc.sourceType === "file" && (
                    <button
                      type="button"
                      onClick={() => handleAnalyze(doc.id)}
                      disabled={analyzingId === doc.id}
                      className="transition-colors duration-150 hover:text-foreground disabled:opacity-60"
                    >
                      {analyzingId === doc.id ? "Analyzing..." : "Analyze"}
                    </button>
                  )}
                  <button type="button" onClick={() => onDelete(doc.id)} className="transition-colors duration-150 hover:text-error">
                    Delete
                  </button>
                </div>
              </div>
              {doc.aiAnalysis && <p className="text-xs text-muted">{doc.aiAnalysis}</p>}
            </div>
          ))}
          {documents.length === 0 && <p className="text-sm text-muted">No brand knowledge added yet.</p>}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Brand spectrum + "What the AI Learned" (right, middle)
// ---------------------------------------------------------------------------

export type BrandStrategyData = {
  brandValues: string;
  vision: string;
  voice: string;
  positioning: string;
  audienceNotes: string;
  aiSummary: string;
  aiBrandDna: string;
  aiToneOfVoice: string;
  aiCommunicationStyle: string;
  aiContentPillars: string;
  aiAudienceSnapshot: string;
  aiVisualLanguage: string;
  aiAvoid: string;
  spectrum: {
    seriousPlayful: number;
    classicFuturistic: number;
    premiumAccessible: number;
    editorialCommercial: number;
    minimalExpressive: number;
    luxuryCasual: number;
  };
};

const SPECTRUM_AXES: { key: keyof BrandStrategyData["spectrum"]; name: string; left: string; right: string }[] = [
  { key: "seriousPlayful", name: "spectrum_serious_playful", left: "Serious", right: "Playful" },
  { key: "classicFuturistic", name: "spectrum_classic_futuristic", left: "Classic", right: "Futuristic" },
  { key: "premiumAccessible", name: "spectrum_premium_accessible", left: "Premium", right: "Accessible" },
  { key: "editorialCommercial", name: "spectrum_editorial_commercial", left: "Editorial", right: "Commercial" },
  { key: "minimalExpressive", name: "spectrum_minimal_expressive", left: "Minimal", right: "Expressive" },
  { key: "luxuryCasual", name: "spectrum_luxury_casual", left: "Luxury", right: "Casual" },
];

export function BrandSpectrumPanel({
  projectId,
  strategy,
  canManage,
  externalRefreshing,
}: {
  projectId: string;
  strategy: BrandStrategyData;
  canManage: boolean;
  externalRefreshing?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [editOpen, setEditOpen] = useState(false);
  // See the identical note on ProfilePanel's closeEdit -- same bug, same fix.
  const closeEditBrandInfo = useCallback(() => setEditOpen(false), []);

  function handleRefreshAi() {
    setRefreshing(true);
    setError(undefined);
    startTransition(async () => {
      const [a, b] = await Promise.all([generateBrandSummary(projectId), generateBrandSections(projectId)]);
      setRefreshing(false);
      const message = a?.message || b?.message;
      if (message) setError(message);
      router.refresh();
    });
  }

  function handleSuggestSpectrum() {
    setSuggesting(true);
    startTransition(async () => {
      const result = await suggestPersonalitySpectrum(projectId);
      setSuggesting(false);
      if (result?.message) setError(result.message);
      router.refresh();
    });
  }

  const sections: { label: string; value: string }[] = [
    { label: "AI Brand Summary", value: strategy.aiSummary },
    { label: "Brand DNA", value: strategy.aiBrandDna },
    { label: "Tone of Voice", value: strategy.aiToneOfVoice },
    { label: "Communication Style", value: strategy.aiCommunicationStyle },
    { label: "Content Pillars", value: strategy.aiContentPillars },
    { label: "Audience Snapshot", value: strategy.aiAudienceSnapshot },
    { label: "Visual Language", value: strategy.aiVisualLanguage },
    { label: "Avoid", value: strategy.aiAvoid },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <span className={labelClass}>Brand Spectrum</span>
        <div className="flex items-center gap-3">
          <span className={labelClass}>What the AI Learned</span>
          {canManage && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              title="Edit brand info"
              className="text-muted transition-colors duration-150 hover:text-foreground"
            >
              ✎
            </button>
          )}
        </div>
      </div>

      {externalRefreshing && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground" />
          AI is analyzing your brand knowledge and updating this section...
        </p>
      )}

      <div className={`flex flex-col gap-4 transition-opacity duration-150 ${externalRefreshing ? "opacity-40" : ""}`}>
        {canManage && (
          <button
            type="button"
            onClick={handleSuggestSpectrum}
            disabled={suggesting || externalRefreshing}
            className="w-fit text-xs tracking-wide text-muted uppercase transition-colors duration-150 hover:text-foreground disabled:opacity-60"
          >
            {suggesting ? "Suggesting..." : "AI Suggest Spectrum"}
          </button>
        )}
        {SPECTRUM_AXES.map((axis) => (
          <SpectrumSlider
            key={axis.key}
            projectId={projectId}
            name={axis.name}
            left={axis.left}
            right={axis.right}
            defaultValue={strategy.spectrum[axis.key]}
            disabled={!canManage || Boolean(externalRefreshing)}
          />
        ))}
      </div>

      <div className={`flex flex-col transition-opacity duration-150 ${externalRefreshing ? "opacity-40" : ""}`}>
        {sections.map((s) => (
          <ExpandableField key={s.label} label={s.label} value={s.value} />
        ))}
      </div>

      {canManage && (
        <Button type="button" variant="secondary" onClick={handleRefreshAi} disabled={refreshing} className="w-fit">
          {refreshing ? "Refreshing..." : "Refresh AI Analysis"}
        </Button>
      )}
      {error && <p className="text-xs text-error">{error}</p>}

      {canManage && (
        <EditBrandInfoDialog projectId={projectId} strategy={strategy} open={editOpen} onClose={closeEditBrandInfo} />
      )}
    </div>
  );
}

function SpectrumSlider({
  projectId,
  name,
  left,
  right,
  defaultValue,
  disabled,
}: {
  projectId: string;
  name: string;
  left: string;
  right: string;
  defaultValue: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [value, setValue] = useState(defaultValue);
  // React batches the onChange->setValue update with whatever event fires
  // right after it (e.g. keyup on the same keypress), so reading `value`
  // (state) inside that sibling handler can see the stale pre-keypress
  // render. A ref updated synchronously in onChange sidesteps that.
  const latestValueRef = useRef(defaultValue);
  // Derived-state-from-props: when the AI (or another client) changes this
  // axis server-side and a fresh defaultValue prop arrives, snap the dot to
  // it -- a plain useState(defaultValue) would otherwise keep showing
  // whatever this slider last rendered, ignoring the update entirely.
  const [prevDefaultValue, setPrevDefaultValue] = useState(defaultValue);
  if (defaultValue !== prevDefaultValue) {
    setPrevDefaultValue(defaultValue);
    setValue(defaultValue);
  }
  // Refs can't be written during render (only state can) -- keep the ref in
  // sync via an effect instead; it lands well before any human interaction
  // could read a stale value out of it.
  useEffect(() => {
    latestValueRef.current = defaultValue;
  }, [defaultValue]);

  function handleChange(next: number) {
    setValue(next);
    latestValueRef.current = next;
  }

  function commit() {
    const next = latestValueRef.current;
    startTransition(async () => {
      await updateSpectrumValue(projectId, name, next);
      router.refresh();
    });
  }

  return (
    <label className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px] tracking-wide text-muted uppercase">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        onChange={(e) => handleChange(Number(e.target.value))}
        onMouseUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="h-px w-full accent-foreground"
      />
    </label>
  );
}

function EditBrandInfoDialog({
  projectId,
  strategy,
  open,
  onClose,
}: {
  projectId: string;
  strategy: BrandStrategyData;
  open: boolean;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(updateBrandStrategy.bind(null, projectId), undefined);

  useEffect(() => {
    if (state?.success) onClose();
  }, [state, onClose]);

  return (
    <Dialog open={open} onClose={onClose} title="Edit brand info" radius="none">
      <form action={action} className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Values</span>
          <textarea name="brand_values" defaultValue={strategy.brandValues} rows={2} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Vision</span>
          <textarea name="vision" defaultValue={strategy.vision} rows={2} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Voice</span>
          <textarea name="voice" defaultValue={strategy.voice} rows={2} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Positioning</span>
          <textarea name="positioning" defaultValue={strategy.positioning} rows={2} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Audience notes</span>
          <textarea name="audience_notes" defaultValue={strategy.audienceNotes} rows={2} className={fieldClass} />
        </label>
        {state?.message && <p className="text-xs text-error">{state.message}</p>}
        <Button type="submit" variant="primary" radius="none" disabled={pending} className="w-full">
          {pending ? "Saving..." : "Save"}
        </Button>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// AI recommendations (right, bottom)
// ---------------------------------------------------------------------------

export function AiRecommendationsPanel({
  projectId,
  insights,
  updatedAt,
  canManage,
}: {
  projectId: string;
  insights: AiInsights | null;
  updatedAt: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function handleRefresh() {
    setRefreshing(true);
    setError(undefined);
    startTransition(async () => {
      const result = await generateAiInsights(projectId);
      setRefreshing(false);
      if (result?.message) setError(result.message);
      router.refresh();
    });
  }

  const dash = "—";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className={labelClass}>AI Recommendations</span>
        {canManage && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs tracking-wide text-muted uppercase transition-colors duration-150 hover:text-foreground disabled:opacity-60"
          >
            {refreshing ? "Analyzing..." : "Refresh"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-x-4 gap-y-5 text-center">
        <RecommendationTile label="Brand Health" big={insights ? `${insights.brand_health_pct}%` : dash} small={insights ? healthWord(insights.brand_health_pct) : "Not analyzed yet"} />
        <RecommendationTile label="Today" big={insights?.today_label || dash} small="" bigSmall />
        <RecommendationTile label="Next Gap" big={insights?.next_gap_label || dash} small="" bigSmall />
        <RecommendationTile label="Tone" big={insights?.tone_label || dash} small="" />
        <RecommendationTile label="Content Mix" big={insights ? `${insights.content_mix_pct}%` : dash} small={insights?.content_mix_label || ""} />
        <RecommendationTile label="CTA Usage" big={insights ? `${insights.cta_usage_pct}%` : dash} small={insights?.cta_usage_label || ""} />
      </div>

      <div className="flex flex-col gap-2">
        <span className={labelClass}>AI Summary</span>
        <div className="border border-border p-3 text-sm text-muted">
          {insights?.notices && insights.notices.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {insights.notices.map((notice, i) => (
                <li key={i}>{notice}</li>
              ))}
            </ul>
          ) : (
            <p>Run &quot;Refresh&quot; to generate brand-consistency recommendations from your content and brand knowledge.</p>
          )}
        </div>
        {updatedAt && <p className="text-[10px] text-muted">Last updated {relativeTime(updatedAt)}</p>}
        {error && <p className="text-xs text-error">{error}</p>}
      </div>
    </div>
  );
}

function healthWord(pct: number): string {
  if (pct >= 85) return "Excellent";
  if (pct >= 65) return "Good";
  if (pct >= 40) return "Needs attention";
  return "Off brand";
}

function RecommendationTile({
  label,
  big,
  small,
  bigSmall,
}: {
  label: string;
  big: string;
  small: string;
  bigSmall?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] tracking-wide text-muted uppercase">{label}</span>
      <span className={bigSmall ? "text-sm font-medium" : "text-xl font-light"}>{big}</span>
      {small && <span className="text-[10px] text-muted">{small}</span>}
    </div>
  );
}
