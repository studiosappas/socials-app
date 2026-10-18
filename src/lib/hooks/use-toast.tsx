"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Toast } from "@/components/ui/toast";

type ToastVariant = "error" | "success" | "upload-error";
type ToastState = { message: string; variant: ToastVariant } | null;

// File-upload failures stay up long enough to read a whole multi-file
// summary, and can be closed by hand (Toast's X button).
const UPLOAD_ERROR_MS = 15000;

const ToastContext = createContext<{
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
  showUploadError: (message: string) => void;
} | null>(null);

// One provider for the whole app instead of every optimistic-update site
// re-inventing its own `useState<string | null>` + setTimeout + <Toast>
// (Grid's Share-for-Review flow already did exactly this, see grid-board.tsx)
// -- now that revert-on-failure needs the same shape in 5+ places, that's
// worth lifting. The underlying <Toast> stays exactly as it was designed:
// bottom-center, pointer-events-none, non-blocking.
//
// One toast at a time: the latest call replaces whatever is showing. An
// upload batch reports ONE summary naming every failed file, so replacing
// never splits a batch's failures across toasts.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setToast(null);
  }, []);

  const show = useCallback((message: string, variant: ToastVariant) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToast({ message, variant });
    // Long messages (an upload listing several rejected files) stay up long
    // enough to read; short ones keep the original timing.
    const readingTime = Math.min(9000, message.length * 55);
    const duration =
      variant === "upload-error" ? UPLOAD_ERROR_MS : Math.max(variant === "error" ? 3000 : 2500, readingTime);
    timeoutRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  const showError = useCallback((message: string) => show(message, "error"), [show]);
  const showSuccess = useCallback((message: string) => show(message, "success"), [show]);
  const showUploadError = useCallback((message: string) => show(message, "upload-error"), [show]);

  return (
    <ToastContext.Provider value={{ showError, showSuccess, showUploadError }}>
      {children}
      <Toast message={toast?.message ?? null} onDismiss={toast?.variant === "upload-error" ? dismiss : undefined} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
