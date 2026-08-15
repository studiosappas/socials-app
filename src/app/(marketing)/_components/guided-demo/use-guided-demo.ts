"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoPhase, DemoStep } from "./guided-demo-types";

// Brief pause between "visitor went idle" and the auto sequence visibly
// restarting -- an instant jump-cut back to step 0 reads as a glitch, a
// half-second beat reads as "the demo is picking back up."
const RESUME_PAUSE_MS = 500;

// Generalizes the active-boolean + setTimeout-chain pattern every workflow
// stage already used in miniature (see the old stage-01-find.tsx) into a
// reusable "Watch -> Understand -> Explore" state machine: plays a scripted
// `steps` sequence once a chapter becomes active, hands control to the
// visitor the moment they interact (or the sequence finishes on its own),
// then replays from the top after `idleTimeoutMs` of no interaction.
// Content-agnostic -- knows nothing about what any step actually renders,
// so every future chapter can reuse this unchanged with its own `steps`.
export function useGuidedDemo({
  active,
  steps,
  idleTimeoutMs = 4000,
  replayOnReturn = false,
}: {
  active: boolean;
  steps: DemoStep[];
  idleTimeoutMs?: number;
  replayOnReturn?: boolean;
}): {
  phase: DemoPhase;
  stepIndex: number;
  /** Call from every visitor-driven handler (click/hover/drag-start/...). */
  registerInteraction: () => void;
  /** Manually replay the scripted sequence from the start. */
  restart: () => void;
} {
  const [phase, setPhase] = useState<DemoPhase>("auto");
  const [stepIndex, setStepIndex] = useState(0);

  const stepsRef = useRef(steps);
  useEffect(() => {
    stepsRef.current = steps;
  });
  const autoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const everStartedRef = useRef(false);

  const clearAutoTimers = useCallback(() => {
    autoTimersRef.current.forEach(clearTimeout);
    autoTimersRef.current = [];
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  }, []);

  // playAuto and armIdleTimer each need to trigger the other (finishing the
  // scripted sequence arms the idle timer; the idle timer firing replays
  // the sequence) -- a ref holding the latest armIdleTimer lets playAuto
  // call it without the two useCallbacks circularly depending on each other.
  const armIdleTimerRef = useRef<() => void>(() => {});

  const playAuto = useCallback(() => {
    clearAutoTimers();
    clearIdleTimer();
    setPhase("auto");
    setStepIndex(0);
    let elapsed = 0;
    stepsRef.current.forEach((step, i) => {
      autoTimersRef.current.push(
        setTimeout(() => {
          setStepIndex(i);
          step.onEnter?.();
        }, elapsed),
      );
      elapsed += step.durationMs;
    });
    autoTimersRef.current.push(
      setTimeout(() => {
        setPhase("interactive");
        armIdleTimerRef.current();
      }, elapsed),
    );
  }, [clearAutoTimers, clearIdleTimer]);

  const playAutoRef = useRef(playAuto);
  useEffect(() => {
    playAutoRef.current = playAuto;
  });

  const armIdleTimer = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      setPhase("resuming");
      autoTimersRef.current.push(setTimeout(() => playAutoRef.current(), RESUME_PAUSE_MS));
    }, idleTimeoutMs);
  }, [clearIdleTimer, idleTimeoutMs]);
  useEffect(() => {
    armIdleTimerRef.current = armIdleTimer;
  });

  const registerInteraction = useCallback(() => {
    setPhase((p) => {
      if (p === "auto") clearAutoTimers();
      return p === "resuming" ? p : "interactive";
    });
    armIdleTimer();
  }, [armIdleTimer, clearAutoTimers]);

  const restart = useCallback(() => playAuto(), [playAuto]);

  useEffect(() => {
    if (active) {
      // First activation ever, an explicit "always restart" request, or
      // reactivating mid-way through an interrupted auto sequence all just
      // replay from the top -- simplest correct behavior, and an interrupted
      // first play is rare (the scripted sequence is only ~3-6s).
      if (!everStartedRef.current || replayOnReturn || phase === "auto") {
        everStartedRef.current = true;
        playAuto();
      } else if (phase === "interactive") {
        armIdleTimer();
      }
    } else {
      clearAutoTimers();
      clearIdleTimer();
    }
    // Deliberately reacts to `active` only -- playAuto/armIdleTimer are
    // stable (useCallback), and including `phase` here would re-fire this
    // effect every time the timers scheduled below change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    return () => {
      clearAutoTimers();
      clearIdleTimer();
    };
  }, [clearAutoTimers, clearIdleTimer]);

  return { phase, stepIndex, registerInteraction, restart };
}
