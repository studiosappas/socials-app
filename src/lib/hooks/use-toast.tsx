"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Toast } from "@/components/ui/toast";

type ToastVariant = "error" | "success";
type ToastState = { message: string; variant: ToastVariant } | null;

const ToastContext = createContext<{
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
} | null>(null);

// One provider for the whole app instead of every optimistic-update site
// re-inventing its own `useState<string | null>` + setTimeout + <Toast>
// (Grid's Share-for-Review flow already did exactly this, see grid-board.tsx)
// -- now that revert-on-failure needs the same shape in 5+ places, that's
// worth lifting. The underlying <Toast> stays exactly as it was designed:
// bottom-center, pointer-events-none, non-blocking.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, variant: ToastVariant) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToast({ message, variant });
    timeoutRef.current = setTimeout(() => setToast(null), variant === "error" ? 3000 : 2500);
  }, []);

  const showError = useCallback((message: string) => show(message, "error"), [show]);
  const showSuccess = useCallback((message: string) => show(message, "success"), [show]);

  return (
    <ToastContext.Provider value={{ showError, showSuccess }}>
      {children}
      <Toast message={toast?.message ?? null} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
