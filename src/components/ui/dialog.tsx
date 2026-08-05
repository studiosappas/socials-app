"use client";

import { useEffect } from "react";

export function Dialog({
  open,
  onClose,
  title,
  children,
  widthClassName = "max-w-lg",
  radius = "lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  widthClassName?: string;
  radius?: "lg" | "none";
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const radiusClass = radius === "none" ? "rounded-none" : "rounded-lg";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 -z-10 cursor-default"
      />
      <div className={`relative w-full ${radiusClass} border border-border bg-card ${widthClassName}`}>
        <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-6">
          <p className="text-xs tracking-wide text-muted uppercase">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="text-xs tracking-wide text-muted uppercase hover:text-foreground"
          >
            X
          </button>
        </div>
        <div className="px-4 py-5 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
