"use client";

// A small "recently used colors" palette for the Image Editor's Text color
// control -- deliberately NOT a Brand Kit/preset system: starts empty,
// only ever grows from colors the user actually commits to (never from a
// live drag/hover preview), newest first, capped, no duplicates. Same
// module-level singleton + useSyncExternalStore shape as
// use-is-touch-device.ts / style-clipboard.ts (this codebase's existing
// convention for this kind of small client-only shared state).
//
// localStorage (not sessionStorage) on purpose -- this needs to survive
// closing/reopening the editor and switching between posts, per the task
// that added it. Plain, unscoped to project/user: it's a personal
// convenience on this browser, not project data, so no DB migration.

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "flower:recent-text-colors";
const MAX_RECENT = 8;

let cached: string[] | undefined;
const listeners = new Set<() => void>();

function readFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

function getSnapshot(): string[] {
  if (cached === undefined) cached = readFromStorage();
  return cached;
}

function getServerSnapshot(): string[] {
  return [];
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRecentColors(): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Call this ONLY at an actual commit point (hex field blur/Enter with a
// valid value, or picking an existing recent swatch) -- never on every
// keystroke or a live picker drag, or the list floods with intermediate
// colors nobody meant to keep.
export function commitRecentColor(hex: string) {
  const normalized = hex.toLowerCase();
  const current = getSnapshot();
  const next = [normalized, ...current.filter((c) => c !== normalized)].slice(0, MAX_RECENT);
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode / quota) -- the in-memory cache
    // above still works for the rest of this tab's lifetime.
  }
  listeners.forEach((listener) => listener());
}
