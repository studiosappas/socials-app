"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/actions/notifications";
import type { NotificationItem } from "@/lib/notifications-data";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function NavNotificationBell({
  items,
  unreadCount,
}: {
  items: NotificationItem[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(open, () => setOpen(false));

  function handleOpenNotification(item: NotificationItem) {
    setOpen(false);
    if (!item.read) {
      startTransition(async () => {
        await markNotificationRead(item.id);
        router.refresh();
      });
    }
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        className="relative flex h-6 w-6 shrink-0 items-center justify-center text-muted transition-colors duration-150 hover:text-foreground"
      >
        <BellIcon className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-error" aria-hidden />
        )}
      </button>

      {/* Below sm, the trigger's own horizontal position is unpredictable
          (it sits inside the header's own flex-wrap pill, which can wrap to
          a second line and start anywhere) -- a fixed, viewport-anchored
          placement guarantees this is always fully on-screen regardless of
          where the bell lands. At sm+ the header never wraps, so this
          reverts to the original trigger-relative placement unchanged. */}
      <div
        className={`fixed inset-x-3 top-3 z-30 transition-[opacity,transform] duration-150 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:pt-2 ${
          open ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <div className="flex max-h-[min(480px,70vh)] w-full flex-col rounded-none border border-border bg-background shadow-[0_4px_20px_rgba(0,0,0,0.08)] sm:w-80">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <span className="text-xs font-semibold tracking-wide uppercase">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-[10px] tracking-wide text-muted uppercase transition-colors duration-150 hover:text-foreground"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {items.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted">Nothing yet.</p>}
            {items.map((item) => {
              const content = (
                <div
                  className={`flex items-start gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors duration-150 hover:bg-black/[.02] ${
                    item.read ? "" : "bg-black/[.015]"
                  }`}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs">
                    {item.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{item.title}</p>
                    {item.description && <p className="truncate text-xs text-muted">{item.description}</p>}
                    <p className="mt-0.5 text-[10px] text-muted">{relativeTime(item.createdAt)}</p>
                  </div>
                  {!item.read && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-error" aria-hidden />}
                </div>
              );
              return item.link ? (
                <Link key={item.id} href={item.link} onClick={() => handleOpenNotification(item)}>
                  {content}
                </Link>
              ) : (
                <button key={item.id} type="button" onClick={() => handleOpenNotification(item)} className="block w-full">
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path
        d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
