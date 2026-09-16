"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { StyleCategory } from "@/lib/style-clipboard";

const CATEGORY_OPTIONS: { value: StyleCategory; label: string }[] = [
  { value: "crop", label: "Crop" },
  { value: "text", label: "Text" },
  { value: "adjustments", label: "Adjustments" },
];

// Deliberately tiny -- one question, one set of checkboxes, two buttons.
// Selection resets each time it's opened/closed rather than remembering the
// last pick, since "what to copy" is a fresh decision per source post.
export function CopyStyleDialog({
  open,
  onClose,
  onCopy,
}: {
  open: boolean;
  onClose: () => void;
  onCopy: (categories: StyleCategory[]) => void;
}) {
  const [selected, setSelected] = useState<StyleCategory[]>([]);

  function toggle(category: StyleCategory) {
    setSelected((current) =>
      current.includes(category) ? current.filter((c) => c !== category) : [...current, category],
    );
  }

  function handleClose() {
    setSelected([]);
    onClose();
  }

  function handleCopy() {
    if (selected.length === 0) return;
    onCopy(selected);
    setSelected([]);
  }

  return (
    // BUG FOUND AND FIXED: Dialog renders a plain (non-portalled) `fixed
    // inset-0` overlay INLINE in the React/DOM tree -- `position: fixed`
    // only changes where it PAINTS, not where it sits in the DOM. This
    // component is rendered as a child of GridSlot, which is itself the
    // tile's own clickable root (single click -> Post Editor via a
    // deferred timer, see grid-board.tsx's handleClick). With no boundary
    // here, every click inside this dialog -- a checkbox, Cancel, Copy,
    // even the backdrop -- bubbled straight up through Dialog's own
    // wrapper divs into that SAME tile's onClick, each one independently
    // scheduling a delayed router.push to THIS tile's own (the COPY
    // SOURCE's) post. Live-confirmed: clicking a checkbox then Copy fired
    // handleClick three times, each one queuing a navigation to the
    // source post -- exactly the reported "Post Editor opens for the post
    // I copied FROM" bug. One stopPropagation boundary around the whole
    // dialog (not scattered across each button) closes it structurally,
    // covering the backdrop click too since it's a sibling inside this
    // same subtree.
    <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <Dialog open={open} onClose={handleClose} title="Copy style" widthClassName="max-w-xs" radius="none">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">What do you want to copy?</p>
          <div className="flex flex-col divide-y divide-border border-t border-b border-border">
            {CATEGORY_OPTIONS.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2.5 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                  className="h-4 w-4 cursor-pointer accent-foreground"
                />
                {option.label}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" radius="none" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="button" variant="primary" radius="none" onClick={handleCopy} disabled={selected.length === 0}>
              Copy
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
