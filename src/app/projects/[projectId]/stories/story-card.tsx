"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { deleteStory } from "@/lib/actions/stories";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";

export function StoryCard({
  projectId,
  storyId,
  name,
  thumbnailUrl,
  canManage,
}: {
  projectId: string;
  storyId: string;
  name: string;
  thumbnailUrl: string | null;
  canManage: boolean;
}) {
  const [, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  const href = `/projects/${projectId}/stories/${storyId}`;

  function handleDelete() {
    setMenuOpen(false);
    if (!confirm("Delete this story? This can't be undone.")) return;
    // deleteStory redirects on completion (same pattern used by the story
    // editor's own delete button) -- no follow-up refresh needed.
    startTransition(() => deleteStory(projectId, storyId));
  }

  return (
    <div className="group relative aspect-[9/16] w-full shrink-0">
      <Link
        href={href}
        title={name}
        className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border transition-colors duration-150 ${
          thumbnailUrl ? "border-border hover:border-foreground/30" : "border-dashed border-border"
        }`}
      >
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs tracking-wide text-muted uppercase">Empty</span>
        )}
      </Link>

      {canManage && (
        <div ref={menuRef} className="absolute right-1 top-1 z-10">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title="Story options"
            className="rounded p-1.5 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
          >
            ⋮
          </button>
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-7 w-36 rounded-none border border-border bg-background p-1 shadow-lg"
            >
              <Link
                href={href}
                onClick={() => setMenuOpen(false)}
                className="block rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
              >
                Edit Content
              </Link>
              <button
                type="button"
                onClick={handleDelete}
                className="w-full rounded px-2 py-1 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05]"
              >
                Delete Content
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
