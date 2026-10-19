"use client";

// Purely presentational -- the owning component (wherever the action that
// needs to confirm itself lives) just holds `const [toastMessage, setToastMessage]
// = useState<string | null>(null)`, sets it, and lets it clear itself via
// setTimeout. No context/provider: there's exactly one trigger point per
// page that needs this (Share for Review, so far), so lifting it further
// than that would be premature.
//
// `onDismiss` (upload errors only, see use-toast.tsx) adds an X button and
// announces the toast as an alert. Without it the markup is exactly as
// before, so every other toast -- including the two screens that render
// <Toast> with their own state -- is unchanged.
export function Toast({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  if (!message) return null;
  const shape = message.length > 60 ? "rounded-2xl" : "rounded-full";
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 w-max max-w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2">
      {/* Same pill; a long message (several rejected uploads) wraps
          instead of running off-screen, with softer corners when it does. */}
      {onDismiss ? (
        <div
          role="alert"
          className={`animate-settle-in flex items-start gap-1 bg-foreground py-2 pr-1.5 pl-4 text-sm text-background shadow-[0_4px_20px_rgba(0,0,0,0.15)] ${shape}`}
        >
          <span className="min-w-0 flex-1 py-0.5">{message}</span>
          {/* The only part that takes clicks -- the rest of the toast stays
              click-through so nothing underneath is blocked while it's up.
              A real button: reachable with Tab, Enter/Space activate it. */}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notification"
            title="Dismiss"
            className="pointer-events-auto -my-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-background/75 transition-colors duration-150 hover:bg-background/15 hover:text-background focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-background"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ) : (
        <div
          role="status"
          className={`animate-settle-in bg-foreground px-4 py-2 text-center text-sm text-background shadow-[0_4px_20px_rgba(0,0,0,0.15)] ${shape}`}
        >
          {message}
        </div>
      )}
    </div>
  );
}
