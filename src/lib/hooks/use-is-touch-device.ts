"use client";

import { useSyncExternalStore } from "react";

// Extracted from grid-board.tsx's own copy -- Brief's asset drag & drop
// needs the exact same signal for the exact same reason: a touch device
// needs a deliberate long-press-to-start activation constraint on its
// PointerSensor (see the `delay` used wherever this is read), or a normal
// attempt to scroll the page immediately misreads as a drag.
// useSyncExternalStore (not state+effect) since this reads external browser
// state -- getServerSnapshot returns false so SSR/first paint assumes
// non-touch, then syncs to the real value on the client.
export function useIsTouchDevice(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(pointer: coarse)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}
