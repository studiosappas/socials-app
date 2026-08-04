"use client";

import { useEffect, useRef } from "react";

// Closes an open menu/dropdown on any click outside the returned ref's
// element. Attach the ref to the wrapper that contains BOTH the trigger
// button and the menu panel -- if it only wrapped the panel, the trigger's
// own click would count as "outside", closing the menu and then immediately
// reopening it via the trigger's own toggle handler.
export function useOutsideClick<T extends HTMLElement>(isOpen: boolean, onClose: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen, onClose]);

  return ref;
}
