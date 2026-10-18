"use client";

// Purely presentational -- the owning component (wherever the action that
// needs to confirm itself lives) just holds `const [toastMessage, setToastMessage]
// = useState<string | null>(null)`, sets it, and lets it clear itself via
// setTimeout. No context/provider: there's exactly one trigger point per
// page that needs this (Share for Review, so far), so lifting it further
// than that would be premature.
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 w-max max-w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2">
      {/* Same pill; a long message (several rejected uploads) wraps
          instead of running off-screen, with softer corners when it does. */}
      <div
        role="status"
        className={`animate-settle-in bg-foreground px-4 py-2 text-center text-sm text-background shadow-[0_4px_20px_rgba(0,0,0,0.15)] ${
          message.length > 60 ? "rounded-2xl" : "rounded-full"
        }`}
      >
        {message}
      </div>
    </div>
  );
}
