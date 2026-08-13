"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { uploadMoodboardItem, deleteMoodboardItem } from "@/lib/actions/brand-moodboard";
import type { BrandMoodboardItem } from "@/lib/data/brand-moodboard";
import type { BrandMoodboardCategory } from "@/types/database";

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

  const visibleItems = items.filter((i) => i.category === category);

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(undefined);
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
              className={`rounded-full border px-3 py-1 text-[11px] tracking-wide uppercase transition-colors duration-150 ${
                category === c.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted hover:border-foreground/40"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {canManage && (
          <>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            <Button
              type="button"
              variant="secondary"
              radius="none"
              onClick={handleUploadClick}
              disabled={uploading}
              className="w-fit text-xs"
            >
              {uploading ? "Uploading…" : `+ Add to ${CATEGORIES.find((c) => c.value === category)?.label}`}
            </Button>
            {error && <p className="text-xs text-error">{error}</p>}
          </>
        )}

        <div className="grid max-h-[50vh] grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
          {visibleItems.map((item) => (
            <div key={item.id} className="group relative aspect-square overflow-hidden border border-border">
              {item.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt={item.label} className="h-full w-full object-cover" />
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  title="Remove"
                  className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white opacity-0 transition-opacity duration-150 hover:bg-black/85 group-hover:opacity-100"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {visibleItems.length === 0 && (
            <p className="col-span-full py-6 text-center text-xs text-muted">Nothing here yet.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
