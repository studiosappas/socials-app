"use client";

import { useEffect } from "react";
import { updateLastSeen } from "@/lib/actions/presence";

const HEARTBEAT_INTERVAL_MS = 90_000;

// Mounted once per authenticated app shell (projects/tasks/account layouts)
// -- not on marketing/login pages, and never for a logged-out visitor, since
// each of those layouts only renders this when `user` is already present.
// Deliberately NOT tied to mouse movement, clicks, or renders -- an interval
// plus one immediate call on mount is the entire write pattern, and the tick
// itself is skipped (not just deferred) whenever the tab is hidden, so a
// backgrounded/inactive tab produces zero network traffic instead of just
// quieter traffic.
export function PresenceHeartbeat() {
  useEffect(() => {
    let cancelled = false;

    function send() {
      if (cancelled || document.hidden) return;
      void updateLastSeen();
    }

    send();
    const interval = setInterval(send, HEARTBEAT_INTERVAL_MS);

    // Coming back to a long-hidden tab shouldn't have to wait up to 90s for
    // the next tick to register as active again.
    function handleVisibilityChange() {
      if (!document.hidden) send();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
