// Shared building block for every route's loading.tsx -- a plain pulsing
// rectangle, sized/shaped by the caller via className. Mirrors the
// bg-black/[.06] + animate-pulse convention already established by the
// Post Editor's own loading.tsx (the one loading state that existed before
// this pass), so every route's instant-loading shell reads as the same
// visual language rather than each screen inventing its own.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-black/[.06] ${className}`} />;
}
