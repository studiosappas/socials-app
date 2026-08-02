"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function LinkDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (attrs: { href: string; label: string }) => void;
}) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");

  function handleClose() {
    setUrl("");
    setLabel("");
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    onSubmit({ href: url.trim(), label: label.trim() || "Link" });
    setUrl("");
    setLabel("");
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Add link">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-muted uppercase">URL</span>
          <input
            autoFocus
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="border-0 border-b border-border bg-transparent py-1.5 text-sm focus:border-foreground focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-muted uppercase">Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Link"
            className="border-0 border-b border-border bg-transparent py-1.5 text-sm focus:border-foreground focus:outline-none"
          />
        </label>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            OK
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
