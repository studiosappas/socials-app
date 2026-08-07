const SIZE_CLASSES = {
  sm: "h-5 w-5 text-[8px]",
  md: "h-7 w-7 text-[10px]",
};

// Same pattern already used inline in nav-project-switcher.tsx (image, or
// an initials tint fallback) -- extracted here since the task rows/detail
// need it in several places and there was no shared primitive yet.
export function Avatar({
  name,
  avatarUrl,
  size = "sm",
}: {
  name: string;
  avatarUrl?: string | null;
  size?: "sm" | "md";
}) {
  return (
    <span className={`block shrink-0 overflow-hidden rounded-full border border-border ${SIZE_CLASSES[size]}`}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-black/[.04] uppercase text-muted">
          {name.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

// Unassigned state -- a muted empty outline, deliberately not a placeholder
// icon (per the task-row spec: "empty circle outline, not a placeholder icon").
export function EmptyAvatar({ size = "sm" }: { size?: "sm" | "md" }) {
  return <span className={`block shrink-0 rounded-full border border-dashed border-border ${SIZE_CLASSES[size]}`} />;
}
