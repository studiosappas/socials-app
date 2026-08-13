"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addAssetCollection, deleteAssetCollection, updateAssetCollection } from "@/lib/actions/assets";
import { detectProvider, PROVIDER_LABEL, PROVIDER_OPTIONS, ASSET_TYPE_LABEL, ASSET_TYPE_OPTIONS } from "@/lib/asset-providers";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import type { AssetCollectionAiStatus, AssetProvider, AssetType } from "@/types/database";

export type AssetCollectionItem = {
  id: string;
  folderUrl: string;
  provider: AssetProvider;
  name: string;
  assetType: AssetType;
  notes: string;
  coverUrl: string | null;
  aiStatus: AssetCollectionAiStatus;
  createdAt: string;
  lastSyncedAt: string | null;
};

const AI_STATUS_LABEL: Record<AssetCollectionAiStatus, string> = {
  not_configured: "Not indexed",
  indexing: "Indexing…",
  analyzed: "Analyzed",
  error: "Index error",
};

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function AssetBoard({
  projectId,
  collections,
  canManage,
}: {
  projectId: string;
  collections: AssetCollectionItem[];
  canManage: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<AssetCollectionItem | null>(null);
  const [imageSearchName, setImageSearchName] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // AssetSourceDialog is remounted (via the key below) on every open --
  // useActionState's returned state otherwise survives across opens (only
  // the inner <form> remounted before), so a stale `state.success: true`
  // from a previous successful submit re-triggered the auto-close effect
  // the instant the dialog reopened for something else.
  const [dialogNonce, setDialogNonce] = useState(0);
  function openAddDialog() {
    setEditingCollection(null);
    setDialogNonce((n) => n + 1);
    setSourceDialogOpen(true);
  }
  function openEditDialog(collection: AssetCollectionItem) {
    setEditingCollection(collection);
    setDialogNonce((n) => n + 1);
    setSourceDialogOpen(true);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.notes.toLowerCase().includes(q) ||
        ASSET_TYPE_LABEL[c.assetType].toLowerCase().includes(q) ||
        PROVIDER_LABEL[c.provider].toLowerCase().includes(q),
    );
  }, [collections, query]);

  function handleImageSearchPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setImageSearchName(file.name);
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6">
      <div className="flex justify-end">
        <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 transition-colors duration-150 focus-within:border-foreground sm:w-72">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setImageSearchName(null);
            }}
            placeholder="Type to search"
            className="w-full bg-transparent text-sm focus:outline-none"
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            title="Search by image"
            className="shrink-0 text-muted transition-colors duration-150 hover:text-foreground"
          >
            <CameraIcon className="h-4 w-4" />
          </button>
          <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSearchPick} />
          <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 text-center">
        <span className="text-xs tracking-wide text-muted uppercase">Brand Assets</span>
        <p className="max-w-md text-sm text-muted">
          One place for all your brand assets. Upload a reference image or search with AI to instantly find matching
          content across every connected library.
        </p>
        {canManage && (
          <Button type="button" variant="primary" radius="none" onClick={openAddDialog} className="mt-2">
            + Add Asset Source
          </Button>
        )}
      </div>

      {imageSearchName ? (
        <ImageSearchResults fileName={imageSearchName} onClear={() => setImageSearchName(null)} />
      ) : (
        <>
          {filtered.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((c) => (
                <AssetCard
                  key={c.id}
                  projectId={projectId}
                  collection={c}
                  canManage={canManage}
                  onEdit={() => openEditDialog(c)}
                />
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-muted">
              {query.trim() ? "No collections match your search." : "No asset sources connected yet."}
            </p>
          )}
        </>
      )}

      <AssetSourceDialog
        key={dialogNonce}
        projectId={projectId}
        open={sourceDialogOpen}
        editing={editingCollection}
        onClose={() => setSourceDialogOpen(false)}
      />
    </div>
  );
}

// There's no visual index of the actual files inside a connected folder --
// building one means reading the folder's contents, which needs a real
// OAuth/API integration with whichever provider it lives in, none of which
// exist yet. This is the honest placeholder for that, not a fake "no
// results" -- same pattern as the AI Summary stub in Overview's Brand
// Strategy panel.
function ImageSearchResults({ fileName, onClear }: { fileName: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 border border-dashed border-border px-6 py-16 text-center">
      <p className="text-xs tracking-wide text-muted uppercase">Searching by image — {fileName}</p>
      <p className="max-w-sm text-sm text-muted">
        Visual search isn&apos;t available yet. It needs your connected folders to be indexed first, which isn&apos;t
        configured for this project.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="text-xs font-semibold uppercase tracking-wide transition-colors duration-150 hover:text-muted"
      >
        Clear Search
      </button>
    </div>
  );
}

function AssetCard({
  projectId,
  collection,
  canManage,
  onEdit,
}: {
  projectId: string;
  collection: AssetCollectionItem;
  canManage: boolean;
  onEdit: () => void;
}) {
  const [, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

  function handleDelete() {
    setMenuOpen(false);
    if (!confirm(`Remove "${collection.name}"? This only removes the link, not the folder itself.`)) return;
    startTransition(() => deleteAssetCollection(projectId, collection.id));
  }

  return (
    <div className="group relative aspect-[4/5] w-full">
      <a
        href={collection.folderUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open "${collection.name}" in ${PROVIDER_LABEL[collection.provider]}`}
        className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-black/[.02] transition-colors duration-150 hover:border-foreground/30"
      >
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {collection.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={collection.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <FolderImageIcon className="h-8 w-8 text-muted/60" />
            </div>
          )}

          {/* Hover overlay -- name/type already live in the footer below the
              cover, so this only ever shows what's NOT visible elsewhere. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/75 via-black/10 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <div className="flex flex-col gap-0.5 text-white">
              <span className="text-[10px] text-white/70">Created {formatDate(collection.createdAt)}</span>
              <span className="text-[10px] text-white/70">Last synced {formatDate(collection.lastSyncedAt)}</span>
              {collection.notes && (
                <span className="mt-1 line-clamp-2 text-[10px] text-white/80">{collection.notes}</span>
              )}
            </div>
          </div>

          <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[9px] tracking-wide text-white uppercase">
            {AI_STATUS_LABEL[collection.aiStatus]}
          </span>
        </div>

        <div className="flex shrink-0 flex-col gap-0.5 px-3 py-2">
          <span className="truncate text-xs font-medium text-foreground">{collection.name}</span>
          <span className="truncate text-[9px] tracking-wide text-muted uppercase">
            {ASSET_TYPE_LABEL[collection.assetType]}
          </span>
        </div>
      </a>

      {canManage && (
        <div ref={menuRef} className="absolute right-2 top-2 z-10">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title="Collection options"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-sm text-white shadow-[0_1px_4px_rgba(0,0,0,0.25)] backdrop-blur-sm transition-colors duration-150 hover:bg-black/65"
          >
            ⋮
          </button>
          {menuOpen && (
            <div
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="absolute right-0 top-8 w-40 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-background p-1 shadow-lg"
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onEdit();
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
              >
                Edit Folder
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05]"
              >
                Remove Source
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssetSourceDialog({
  projectId,
  open,
  editing,
  onClose,
}: {
  projectId: string;
  open: boolean;
  editing: AssetCollectionItem | null;
  onClose: () => void;
}) {
  const isEditing = Boolean(editing);
  const boundAction = isEditing
    ? updateAssetCollection.bind(null, editing!.id, projectId)
    : addAssetCollection.bind(null, projectId);
  const [state, action, pending] = useActionState(boundAction, undefined);
  const [folderUrl, setFolderUrl] = useState(editing?.folderUrl ?? "");
  const [coverPreview, setCoverPreview] = useState<string | null>(editing?.coverUrl ?? null);
  const detected = detectProvider(folderUrl);
  const formRef = useRef<HTMLFormElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.success) onClose();
  }, [state, onClose]);

  // Re-syncs the form to whichever target it's opening for -- a fresh blank
  // form for "Add", or that collection's current values for "Edit". Keyed
  // below on editing?.id too (belt-and-suspenders): that forces the
  // uncontrolled fields (name/asset_type/notes) to remount with fresh
  // defaultValues even if this effect's dependency timing ever changed.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFolderUrl(editing?.folderUrl ?? "");
      setCoverPreview((prev) => {
        if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
        return editing?.coverUrl ?? null;
      });
    } else {
      formRef.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title={isEditing ? "Edit Asset Source" : "Add Asset Source"} radius="none">
      <form key={editing?.id ?? "add"} ref={formRef} action={action} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-muted uppercase">Folder URL</span>
          <input
            name="folder_url"
            required
            value={folderUrl}
            onChange={(e) => setFolderUrl(e.target.value)}
            placeholder="https://drive.google.com/..."
            className="w-full rounded-none border border-foreground bg-transparent px-3 py-2 text-sm focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-muted uppercase">Folder Name</span>
          <input
            name="name"
            required
            defaultValue={editing?.name ?? ""}
            placeholder="e.g. Q3 Campaign Shoot"
            className="w-full rounded-none border border-foreground bg-transparent px-3 py-2 text-sm focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-muted uppercase">Cover Image (optional)</span>
          {/* No provider integration can pull a cover from the folder's
              actual contents (see the card's placeholder icon when this is
              left empty) -- this is the only way a collection gets a real
              cover today. */}
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            className="flex h-28 w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-border text-xs text-muted transition-colors duration-150 hover:border-foreground/30"
          >
            {coverPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              "Click to upload a cover image"
            )}
          </button>
          <input
            ref={coverInputRef}
            type="file"
            name="cover"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setCoverPreview(URL.createObjectURL(file));
            }}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-muted uppercase">Asset Type</span>
          <select
            name="asset_type"
            defaultValue={editing?.assetType ?? "other"}
            className="w-full rounded-none border border-foreground bg-transparent px-3 py-2 text-sm focus:outline-none"
          >
            {ASSET_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {ASSET_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>

        {/* Only shown when the URL doesn't match a known provider -- most of
            the time this stays hidden and the server detects it the same
            way, from the URL alone. */}
        {folderUrl.trim() && !detected && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs tracking-wide text-muted uppercase">Provider</span>
            <select
              name="provider"
              defaultValue={editing?.provider ?? "other"}
              className="w-full rounded-none border border-foreground bg-transparent px-3 py-2 text-sm focus:outline-none"
            >
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        )}
        {detected && (
          <p className="text-xs text-muted">
            Detected provider: <span className="text-foreground">{PROVIDER_LABEL[detected]}</span>
          </p>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-muted uppercase">Notes (optional)</span>
          <textarea
            name="notes"
            rows={2}
            defaultValue={editing?.notes ?? ""}
            placeholder="Anything worth remembering about this folder..."
            className="w-full rounded-none border border-foreground bg-transparent px-3 py-2 text-sm focus:outline-none"
          />
        </label>

        {state?.message && <p className="text-sm text-error">{state.message}</p>}

        <Button type="submit" variant="primary" radius="none" disabled={pending}>
          {pending ? "Saving…" : isEditing ? "Save Changes" : "Add Source"}
        </Button>
      </form>
    </Dialog>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

function FolderImageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className={className}>
      <rect x="3.5" y="6" width="17" height="13" rx="1" />
      <circle cx="8.5" cy="10.5" r="1.4" />
      <path d="M3.5 16.5 8 12l3 3 3.5-4L20.5 17" />
    </svg>
  );
}
