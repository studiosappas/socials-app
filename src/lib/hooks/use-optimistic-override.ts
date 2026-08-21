"use client";

import { useCallback, useState } from "react";

// Extracted from the identical pattern duplicated across grid-board.tsx
// (overrideRows), calendar-board.tsx (overrideCells/overrideUnscheduled),
// task-workspace.tsx (overrideTasks), and brief-board.tsx (optimisticType/
// optimisticStatus): a local shadow value that supersedes the server prop
// until a FRESH server prop arrives (checked by reference, not by why it
// changed -- a revalidation, a future realtime patch, anything), at which
// point the shadow resets and the new prop wins again.
//
// `set(null)`/`reset()` both mean "stop shadowing, trust the server value" --
// for a nullable override (Grid/Calendar/Tasks' lists) that's the natural
// "no override" state; for a non-nullable optimistic field (Brief's type/
// status pills) it's just as correct on revert, since the server value is
// still whatever it was before the failed mutation.
export function useOptimisticOverride<T>(serverValue: T): {
  value: T;
  set: (next: T | null | ((current: T) => T)) => void;
  reset: () => void;
} {
  const [prevServerValue, setPrevServerValue] = useState(serverValue);
  const [override, setOverride] = useState<T | null>(null);
  if (serverValue !== prevServerValue) {
    setPrevServerValue(serverValue);
    setOverride(null);
  }

  // Memoized (stable identity across renders, changing only when serverValue
  // itself does) so callers can safely put set/reset in a useCallback/
  // useEffect dependency array -- several call sites rely on that stability
  // to keep a React.memo'd child from re-rendering on every unrelated parent
  // render (same reason a plain useState setter is always deps-safe).
  const set = useCallback(
    (next: T | null | ((current: T) => T)) => {
      if (typeof next === "function") {
        const updater = next as (current: T) => T;
        setOverride((current) => updater(current ?? serverValue));
      } else {
        setOverride(next);
      }
    },
    [serverValue],
  );

  const reset = useCallback(() => setOverride(null), []);

  return { value: override ?? serverValue, set, reset };
}
