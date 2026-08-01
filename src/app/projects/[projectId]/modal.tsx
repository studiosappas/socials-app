"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function Modal({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") router.back();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={() => router.back()}
        className="fixed inset-0 -z-10 cursor-default"
      />
      <div className="relative w-full max-w-3xl rounded-lg border border-border bg-card p-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="absolute right-4 top-4 text-xs tracking-wide text-muted uppercase hover:text-foreground"
        >
          ✕ Close
        </button>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
