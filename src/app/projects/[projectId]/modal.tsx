"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// onClose defaults to router.back() -- the two intercepted-route call sites
// (posts/stories) rely on that, since this modal there IS a real navigation
// with a real history entry. The Tasks page's own linked-content popup
// (linked-content-modal.tsx) has no such navigation to go back to -- it's
// pure client state -- so it passes its own onClose instead.
export function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  const router = useRouter();
  const close = onClose ?? (() => router.back());

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, router]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="fixed inset-0 -z-10 cursor-default"
      />
      <div className="relative w-full max-w-3xl rounded-none border border-border bg-card p-4 sm:p-6">
        <button
          type="button"
          onClick={close}
          className="absolute right-4 top-4 text-xs tracking-wide text-muted uppercase transition-colors duration-150 hover:text-foreground"
        >
          Close X
        </button>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
