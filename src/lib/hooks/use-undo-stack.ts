"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type UndoableCommand = {
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
};

const MAX_HISTORY = 50;

// A generic command-pattern undo/redo stack, shared by any editing surface
// that wants Figma/Canva-style history (Grid, Post Editor's carousel). Each
// pushed command owns both directions itself -- the stack just sequences
// them -- since a layout action here is a server mutation (reorder, crop,
// replace, add/delete), not just local state, so "undo" has to actually
// call the inverse server action or a page refresh would bring the old
// state right back.
export function useUndoStack() {
  const undoRef = useRef<UndoableCommand[]>([]);
  const redoRef = useRef<UndoableCommand[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  // The stacks themselves live in refs (so a rapid sequence of pushes, e.g.
  // during a drag, never queues stale closures), but canUndo/canRedo are
  // real state -- reading a ref's .current during render isn't safe (React
  // can't guarantee the component re-renders when it changes), so these two
  // booleans are recomputed and stored via setState every time the stacks
  // are mutated instead of being derived inline at render time.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const syncFlags = useCallback(() => {
    setCanUndo(undoRef.current.length > 0);
    setCanRedo(redoRef.current.length > 0);
  }, []);

  const push = useCallback(
    (command: UndoableCommand) => {
      undoRef.current.push(command);
      if (undoRef.current.length > MAX_HISTORY) undoRef.current.shift();
      redoRef.current = [];
      syncFlags();
    },
    [syncFlags],
  );

  const undo = useCallback(async () => {
    const command = undoRef.current.pop();
    if (!command || isBusy) return;
    setIsBusy(true);
    try {
      await command.undo();
      redoRef.current.push(command);
    } catch (error) {
      console.error(`Failed to undo "${command.label}":`, error);
      // Put it back -- the mutation may have partially applied, but treating
      // it as "still undoable" is safer than silently dropping the entry.
      undoRef.current.push(command);
    } finally {
      setIsBusy(false);
      syncFlags();
    }
  }, [isBusy, syncFlags]);

  const redo = useCallback(async () => {
    const command = redoRef.current.pop();
    if (!command || isBusy) return;
    setIsBusy(true);
    try {
      await command.redo();
      undoRef.current.push(command);
    } catch (error) {
      console.error(`Failed to redo "${command.label}":`, error);
      redoRef.current.push(command);
    } finally {
      setIsBusy(false);
      syncFlags();
    }
  }, [isBusy, syncFlags]);

  return { push, undo, redo, canUndo, canRedo, isBusy };
}

// ⌘/Ctrl+Z to undo, ⌘/Ctrl+Shift+Z or Ctrl+Y to redo -- ignored while focus
// is in a text input/textarea/contenteditable so it never hijacks native
// text-field undo (e.g. a note field elsewhere on the same page).
export function useUndoRedoShortcuts(undo: () => void, redo: () => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      const key = e.key.toLowerCase();
      if (key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (key === "z") {
        e.preventDefault();
        undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);
}
