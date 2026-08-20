"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { upsertLandingContent, resetLandingContent, uploadLandingImage } from "@/lib/actions/landing-admin";
import { landingMediaUrl } from "@/lib/landing-media-url";
import { LANDING_CONTENT_KEYS, type LandingContent, type LandingContentKey } from "@/lib/landing/content-context";
import { uploadFileDirect, newStoragePath } from "@/lib/direct-upload";
import { validateUploadSize } from "@/lib/upload-limits";
import type { Json } from "@/types/database";

// One label per content key, in the same order they appear in the
// workflow story -- shown as a plain JSON editor (pretty-printed, edit and
// save) rather than a bespoke form per key. Each key's shape is different
// (a flat object, an array of media+captions, an array of team members...)
// and building 18 different structured editors was out of scope for this
// pass; a JSON editor still fully satisfies "edit without touching code"
// (this is a UI, not a code file), it's just not the most polished
// possible UX for every field. Image fields (MediaRef's `src`) take a
// storage path from the uploader above, pasted into the relevant JSON key.
const LABELS: Record<LandingContentKey, string> = {
  HERO_CONTENT: "Hero — Headline & Copy",
  HERO_PHRASES: "Hero — Rotating Phrases",
  DEMO_GRID_SLOTS: "Create Stage — Grid/Carousel Images",
  DEMO_AI_CAPTION: "Create Stage — AI Caption Text",
  DEMO_MEDIA_FOLDERS: "Find Stage — Media Library Folders",
  DEMO_MEDIA_LIBRARY_ITEMS: "Find Stage — Media Library Items",
  DEMO_SEARCH_MATCH_IDS: "Find Stage — Matched Item IDs",
  DEMO_SEARCH_INSPIRATION_IMAGE: "Find Stage — Inspiration Image",
  DEMO_WORKSPACE_TILES: "Create Stage — Lead-in Tiles",
  DEMO_BRIEF_TASK: "Create Stage — Brief Task",
  DEMO_GRID_ROWS: "Create Stage — Grid Rows",
  DEMO_BRAND_DOCUMENTS: "Intelligence Stage — Brand Documents",
  DEMO_SPECTRUM: "Intelligence Stage — Brand Spectrum",
  DEMO_BRAND_ACCORDION: "Intelligence Stage — AI-Learned Fields",
  DEMO_AI_RECOMMENDATIONS: "Intelligence Stage — AI Recommendations",
  DEMO_TEAM: "Collaborate Stage — Team Members",
  DEMO_COMMENTS: "Collaborate Stage — Client Comments",
  DEMO_TASK_TITLE: "Collaborate Stage — Task Title",
  DEMO_POST_TITLE: "Hero Preview — Post Title",
  WHY_SECTION_CONTENT: "Why Section — Statements",
  WHY_SECTION_IMAGE: "Why Section — Interface Image",
  FINAL_CTA_CONTENT: "Final CTA — Headline & Copy",
};

export function AdminLandingForm({
  defaults,
  overrides,
}: {
  defaults: LandingContent;
  overrides: Partial<Record<LandingContentKey, unknown>>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ImageUploader />
      <div className="flex flex-col gap-3">
        {LANDING_CONTENT_KEYS.map((key) => (
          <ContentKeyEditor
            key={key}
            contentKey={key}
            label={LABELS[key]}
            defaultValue={defaults[key]}
            override={overrides[key]}
          />
        ))}
      </div>
    </div>
  );
}

function ImageUploader() {
  const [uploading, setUploading] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [message, setMessage] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setMessage(undefined);

    const sizeCheck = validateUploadSize(file);
    if (!sizeCheck.ok) {
      setMessage(sizeCheck.message);
      setUploading(false);
      return;
    }

    const storagePath = newStoragePath("uploads", file.name);
    const uploaded = await uploadFileDirect("landing-media", storagePath, file);
    if ("error" in uploaded) {
      setMessage(uploaded.error);
      setUploading(false);
      return;
    }

    const formData = new FormData();
    formData.set("storagePath", uploaded.path);
    const result = await uploadLandingImage(formData);
    if (result.path) {
      setPath(result.path);
    } else {
      setMessage(result.message ?? "Upload failed.");
    }
    setUploading(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Upload an image</span>
        <Button type="button" variant="secondary" radius="md" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? "Uploading…" : "Choose File"}
        </Button>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </div>
      <p className="text-xs text-muted">
        Upload a replacement image, then paste the path it gives you into the relevant key&apos;s <code>src</code>{" "}
        field below (e.g. a grid slot&apos;s <code>image.src</code>, or the Why section&apos;s image).
      </p>
      {path && (
        <div className="flex items-center gap-3 border-t border-border pt-3">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={landingMediaUrl(path)} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-muted">Path to paste into a JSON `src` field:</span>
            <code className="truncate rounded bg-black/[.04] px-2 py-1 text-xs">{path}</code>
          </div>
        </div>
      )}
      {message && <p className="text-xs text-error">{message}</p>}
    </div>
  );
}

function ContentKeyEditor({
  contentKey,
  label,
  defaultValue,
  override,
}: {
  contentKey: LandingContentKey;
  label: string;
  defaultValue: unknown;
  override: unknown;
}) {
  const [open, setOpen] = useState(false);
  const hasOverride = override !== undefined;
  const [text, setText] = useState(() => JSON.stringify(override ?? defaultValue, null, 2));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  async function handleSave() {
    let parsed: Json;
    try {
      parsed = JSON.parse(text);
    } catch {
      setMessage("Invalid JSON — check for a missing comma/quote.");
      return;
    }
    setSaving(true);
    setMessage(undefined);
    const result = await upsertLandingContent(contentKey, parsed);
    setMessage(result.success ? "Saved." : (result.message ?? "Failed to save."));
    setSaving(false);
  }

  async function handleReset() {
    setSaving(true);
    setMessage(undefined);
    const result = await resetLandingContent(contentKey);
    if (result.success) {
      setText(JSON.stringify(defaultValue, null, 2));
      setMessage("Reset to default.");
    } else {
      setMessage(result.message ?? "Failed to reset.");
    }
    setSaving(false);
  }

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium">{label}</span>
        <div className="flex items-center gap-2">
          {hasOverride && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] tracking-wide text-accent uppercase">
              Customized
            </span>
          )}
          <span className="text-xs text-muted">{open ? "Hide" : "Edit"}</span>
        </div>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-border p-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(20, text.split("\n").length + 1)}
            spellCheck={false}
            className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs focus:border-foreground focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="primary" radius="md" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {hasOverride && (
              <Button type="button" variant="secondary" radius="md" onClick={handleReset} disabled={saving}>
                Reset to Default
              </Button>
            )}
            {message && <span className="text-xs text-muted">{message}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
