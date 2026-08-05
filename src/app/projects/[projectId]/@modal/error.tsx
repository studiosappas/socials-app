"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// This is the exact route that crashed and (per the "insertBefore ... not a
// child of this node" DOM error in the dev log) took the whole app down
// with it -- Post Editor's "Edit Image" modal renders Fabric.js's own
// canvas here, and Fabric restructures the DOM around that canvas in ways
// React doesn't know about, so a badly-timed re-render nearby can crash the
// whole commit with no error boundary to stop it. This file is that
// boundary going forward. <Modal> itself is rendered INSIDE the page that
// crashes (not in an ancestor layout), so it's gone once this replaces the
// page's output -- rebuilding the same backdrop/card chrome here keeps the
// crash from looking like the whole app broke, even though technically
// this file's content isn't wrapped by the real Modal component anymore.
export default function ModalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    console.error("Modal error:", error);
  }, [error]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={() => router.back()}
        className="fixed inset-0 -z-10 cursor-default"
      />
      <div className="relative w-full max-w-md rounded-none border border-border bg-card p-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="absolute right-4 top-4 text-xs tracking-wide text-muted uppercase transition-colors duration-150 hover:text-foreground"
        >
          Close X
        </button>
        <div className="mt-6 flex flex-col items-center gap-4 text-center">
          <p className="text-sm tracking-wide text-muted uppercase">Something went wrong</p>
          <p className="text-sm text-muted">
            This editor hit an error, but nothing was saved or deleted. Try again, or close this and come back to it.
          </p>
          <div className="flex gap-3">
            <Button type="button" variant="primary" radius="none" onClick={reset}>
              Try again
            </Button>
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-none border border-foreground px-4 py-2 text-sm transition-colors duration-150 hover:bg-black/[.04]"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
