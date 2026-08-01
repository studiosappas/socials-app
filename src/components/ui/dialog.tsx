"use client";

export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 -z-10 cursor-default"
      />
      <div className="relative w-full max-w-lg rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <p className="text-xs tracking-wide text-muted uppercase">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="text-xs tracking-wide text-muted uppercase hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
