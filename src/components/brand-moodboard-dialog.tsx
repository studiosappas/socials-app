"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { uploadMoodboardItem, addMoodboardLink, deleteMoodboardItem } from "@/lib/actions/brand-moodboard";
import { useCustomFonts } from "@/lib/use-custom-fonts";
import { deriveCustomFontFaces, type BrandMoodboardItem } from "@/lib/data/brand-moodboard";
import type { BrandMoodboardCategory } from "@/types/database";

const FONT_WEIGHT_OPTIONS = [
  { value: "100", label: "Thin (100)" },
  { value: "200", label: "Extra Light (200)" },
  { value: "300", label: "Light (300)" },
  { value: "400", label: "Regular (400)" },
  { value: "500", label: "Medium (500)" },
  { value: "600", label: "Semi Bold (600)" },
  { value: "700", label: "Bold (700)" },
  { value: "800", label: "Extra Bold (800)" },
  { value: "900", label: "Black (900)" },
];

const CATEGORIES: { value: BrandMoodboardCategory; label: string }[] = [
  { value: "logo", label: "Logos" },
  { value: "font", label: "Fonts" },
  { value: "color", label: "Colors" },
  { value: "guideline", label: "Guidelines" },
  { value: "campaign", label: "Campaign Designs" },
  { value: "reference", label: "References" },
  { value: "texture", label: "Textures" },
  { value: "illustration", label: "Illustration Styles" },
  { value: "marketing", label: "Marketing Materials" },
  { value: "other", label: "Other" },
];

// Any file type is accepted -- images, font files (brand typefaces), and
// PDFs (guideline docs) all belong here; only images render as a thumbnail
// (see MoodboardTile below), everything else shows as a generic file chip.
const FILE_ACCEPT = "image/*,.ttf,.otf,.woff,.woff2,application/pdf,.pdf";

// Compact category-tabs + upload/grid, matching Media Library's own
// upload/thumbnail visual language -- fed to "Generate Design" as ongoing
// brand context (see generateBriefDesign), not a new full page.
export function BrandMoodboardDialog({
  projectId,
  items,
  canManage,
  open,
  onClose,
}: {
  projectId: string;
  items: BrandMoodboardItem[];
  canManage: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<BrandMoodboardCategory>("logo");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [addingLink, setAddingLink] = useState(false);

  // A font upload needs a family name + weight/style before it's actually
  // usable anywhere -- staged here instead of uploading immediately on file
  // pick, unlike every other category (which still uploads right away).
  const [pendingFontFile, setPendingFontFile] = useState<File | null>(null);
  const [fontName, setFontName] = useState("");
  const [fontWeight, setFontWeight] = useState("400");
  const [fontStyle, setFontStyle] = useState<"normal" | "italic">("normal");

  const visibleItems = items.filter((i) => i.category === category);
  const categoryLabel = CATEGORIES.find((c) => c.value === category)?.label;

  // Triggers loading every uploaded font so MoodboardTile can render each
  // one's own glyphs instead of a generic file icon -- same hook/mechanism
  // the editor uses, not a second font-loading path.
  const customFonts = useMemo(() => deriveCustomFontFaces(items), [items]);
  useCustomFonts(customFonts);

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(undefined);

    if (category === "font") {
      setPendingFontFile(file);
      setFontName(file.name.replace(/\.[^./]+$/, "").trim());
      setFontWeight("400");
      setFontStyle("normal");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadMoodboardItem(projectId, category, file.name, formData);
      setUploading(false);
      if (!result.success) {
        setError(result.message ?? "Couldn't upload.");
        return;
      }
      router.refresh();
    });
  }

  function handleAddFont(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingFontFile || !fontName.trim() || uploading) return;
    setError(undefined);
    setUploading(true);
    const formData = new FormData();
    formData.set("file", pendingFontFile);
    startTransition(async () => {
      const result = await uploadMoodboardItem(projectId, category, fontName, formData, {
        fontFamily: fontName.trim(),
        fontWeight,
        fontStyle,
      });
      setUploading(false);
      if (!result.success) {
        setError(result.message ?? "Couldn't upload font.");
        return;
      }
      setPendingFontFile(null);
      setFontName("");
      router.refresh();
    });
  }

  function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    if (!linkUrl.trim() || addingLink) return;
    setError(undefined);
    setAddingLink(true);
    startTransition(async () => {
      const result = await addMoodboardLink(projectId, category, linkLabel, linkUrl);
      setAddingLink(false);
      if (!result.success) {
        setError(result.message ?? "Couldn't add link.");
        return;
      }
      setLinkLabel("");
      setLinkUrl("");
      setLinkOpen(false);
      router.refresh();
    });
  }

  function handleDelete(itemId: string) {
    if (!confirm("Remove this item from the Brand Moodboard?")) return;
    startTransition(async () => {
      await deleteMoodboardItem(projectId, itemId);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title="Brand Moodboard" widthClassName="max-w-2xl" radius="none">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={`rounded-full border px-3 py-1 text-[11px] tracking-wide uppercase transition-all duration-150 active:scale-95 ${
                category === c.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted hover:border-foreground/50 hover:bg-black/[.03] hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {canManage && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileInputRef} type="file" accept={FILE_ACCEPT} className="hidden" onChange={handleFileChange} />
              <Button
                type="button"
                variant="secondary"
                radius="none"
                onClick={handleUploadClick}
                disabled={uploading}
                className="w-fit text-xs"
              >
                {uploading ? "Uploading…" : `+ Upload to ${categoryLabel}`}
              </Button>
              <Button
                type="button"
                variant="secondary"
                radius="none"
                onClick={() => setLinkOpen((v) => !v)}
                className="w-fit text-xs"
              >
                + Add Link
              </Button>
            </div>

            {linkOpen && (
              <form onSubmit={handleAddLink} className="flex flex-col gap-2 border border-border p-3 sm:flex-row sm:items-center">
                <input
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                  placeholder="Label (optional)"
                  className="w-full min-w-0 rounded-full border border-border bg-transparent px-3 py-1.5 text-sm focus:border-foreground focus:outline-none sm:w-40"
                />
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full min-w-0 flex-1 rounded-full border border-border bg-transparent px-3 py-1.5 text-sm focus:border-foreground focus:outline-none"
                />
                <Button type="submit" variant="primary" radius="full" disabled={addingLink || !linkUrl.trim()} className="w-full shrink-0 sm:w-auto">
                  {addingLink ? "Adding…" : "Add"}
                </Button>
              </form>
            )}

            {category === "font" && (
              <p className="text-[11px] text-muted">
                You&apos;re responsible for having the appropriate license to use any font you upload here.
              </p>
            )}

            {pendingFontFile && (
              <form
                onSubmit={handleAddFont}
                className="flex flex-col gap-2 border border-border p-3 sm:flex-row sm:items-center"
              >
                <input
                  value={fontName}
                  onChange={(e) => setFontName(e.target.value)}
                  placeholder="Font name"
                  required
                  className="w-full min-w-0 rounded-full border border-border bg-transparent px-3 py-1.5 text-sm focus:border-foreground focus:outline-none sm:w-36"
                />
                <select
                  value={fontWeight}
                  onChange={(e) => setFontWeight(e.target.value)}
                  className="w-full min-w-0 rounded-full border border-border bg-transparent px-3 py-1.5 text-sm focus:border-foreground focus:outline-none sm:w-40"
                >
                  {FONT_WEIGHT_OPTIONS.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </select>
                <select
                  value={fontStyle}
                  onChange={(e) => setFontStyle(e.target.value as "normal" | "italic")}
                  className="w-full min-w-0 rounded-full border border-border bg-transparent px-3 py-1.5 text-sm focus:border-foreground focus:outline-none sm:w-32"
                >
                  <option value="normal">Normal</option>
                  <option value="italic">Italic</option>
                </select>
                <Button
                  type="submit"
                  variant="primary"
                  radius="full"
                  disabled={uploading || !fontName.trim()}
                  className="w-full shrink-0 sm:w-auto"
                >
                  {uploading ? "Adding…" : "Add Font"}
                </Button>
                <button
                  type="button"
                  onClick={() => setPendingFontFile(null)}
                  className="text-xs text-muted underline-offset-2 hover:underline"
                >
                  Cancel
                </button>
              </form>
            )}

            {error && <p className="text-xs text-error">{error}</p>}
          </div>
        )}

        <div className="grid max-h-[50vh] grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
          {visibleItems.map((item) => (
            <MoodboardTile key={item.id} item={item} canManage={canManage} onDelete={() => handleDelete(item.id)} />
          ))}
          {visibleItems.length === 0 && (
            <p className="col-span-full py-6 text-center text-xs text-muted">Nothing here yet.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function MoodboardTile({
  item,
  canManage,
  onDelete,
}: {
  item: BrandMoodboardItem;
  canManage: boolean;
  onDelete: () => void;
}) {
  const isImage = item.kind === "file" && item.fileType === "image" && item.fileUrl;
  const isFont = item.category === "font" && item.kind === "file" && Boolean(item.fontFamily);

  const content = isImage ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.fileUrl!} alt={item.label} className="h-full w-full object-cover" />
  ) : isFont ? (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-black/[.03] p-2 text-center">
      <span
        style={{ fontFamily: item.fontFamily!, fontWeight: item.fontWeight ?? "400", fontStyle: item.fontStyle ?? "normal" }}
        className="text-2xl text-foreground"
      >
        Aa
      </span>
      <span className="w-full truncate text-[9px] text-muted">{item.label}</span>
    </div>
  ) : (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-black/[.03] p-1 text-center">
      <FileKindIcon kind={item.kind} fileType={item.fileType} className="h-5 w-5 text-muted" />
      <span className="w-full truncate text-[9px] text-muted">{item.label}</span>
    </div>
  );

  return (
    <div className="group relative aspect-square overflow-hidden border border-border">
      {item.kind === "link" ? (
        <a href={item.linkUrl ?? "#"} target="_blank" rel="noreferrer" className="block h-full w-full">
          {content}
        </a>
      ) : (
        content
      )}
      {canManage && (
        <button
          type="button"
          onClick={onDelete}
          title="Remove"
          className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white opacity-0 transition-opacity duration-150 hover:bg-black/85 group-hover:opacity-100"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function FileKindIcon({
  kind,
  fileType,
  className,
}: {
  kind: BrandMoodboardItem["kind"];
  fileType: BrandMoodboardItem["fileType"];
  className?: string;
}) {
  if (kind === "link") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
        <path d="M10 14a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.6-5.6l-1 1" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 10a4 4 0 0 0-5.7 0L6 12.3a4 4 0 0 0 5.6 5.6l1-1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (fileType === "pdf") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
        <path d="M6 2h9l5 5v15H6Z" strokeLinejoin="round" />
        <path d="M15 2v5h5" strokeLinejoin="round" />
      </svg>
    );
  }
  // Font (or any other non-image file) shares the same generic document
  // glyph -- a "T" mark is the only visual cue that distinguishes it.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M6 2h9l5 5v15H6Z" strokeLinejoin="round" />
      <path d="M15 2v5h5" strokeLinejoin="round" />
      <path d="M9.5 13h5M12 13v5" strokeLinecap="round" />
    </svg>
  );
}
