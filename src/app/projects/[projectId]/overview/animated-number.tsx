"use client";

import { useEffect, useRef, useState } from "react";

const JUMBLE_DURATION_MS = 900;

// Rolls through random digits until settling on the real value, triggered
// the moment the number scrolls into view (not on mount) -- matches "when
// you roll the page and get to them" from the mockup notes.
export function AnimatedNumber({ value, digits = 2 }: { value: number; digits?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();

        const start = performance.now();
        const ceiling = Math.max(value * 3, 20);
        let frame: number;

        function tick(now: number) {
          const progress = Math.min(1, (now - start) / JUMBLE_DURATION_MS);
          if (progress < 1) {
            setDisplay(Math.floor(Math.random() * ceiling));
            frame = requestAnimationFrame(tick);
          } else {
            setDisplay(value);
            setSettled(true);
          }
        }
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <span ref={ref} className={settled ? "" : "tabular-nums"}>
      {String(display).padStart(digits, "0")}
    </span>
  );
}
