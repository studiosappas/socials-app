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
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className="animate-settle-in rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-[0_4px_20px_rgba(0,0,0,0.15)]">
        {message}
      </div>
    </div>
  );
}
