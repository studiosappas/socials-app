"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SORTABLE_TRANSITION } from "@/lib/dnd-motion";
import { LandingMedia } from "../landing-media";
import { EASE, type DemoGridSlot } from "@/lib/landing";
import { useLandingContent } from "@/lib/landing/content-context";
import type { WorkflowStageProps } from "./workflow-types";

type Stage = "grid" | "popup-open" | "crop" | "carousel" | "caption" | "post-type" | "schedule" | "scheduled";
const POPUP_STAGES: Stage[] = ["popup-open", "crop", "carousel", "caption", "post-type", "schedule", "scheduled"];

const CROP_OFFSETS = [
  { x: 0, y: 0 },
  { x: -8, y: -4 },
  { x: 6, y: 5 },
  { x: 0, y: 0 },
];

// The "Create" stage: the flagship interaction (reordering the feed) is a
// real, genuinely draggable @dnd-kit grid -- the exact pattern from the old
// section-03-demo-grid.tsx clone. Everything after that (opening the post
// popup, cropping, building a carousel, the caption typing in, picking a
// post type, scheduling) auto-plays on a timer so the story keeps moving
// even if nobody drags anything, same principle as Stage 1/3.
export function StageCreate({ active }: WorkflowStageProps) {
  const { DEMO_GRID_SLOTS, DEMO_AI_CAPTION } = useLandingContent();
  const [slots, setSlots] = useState<DemoGridSlot[]>(DEMO_GRID_SLOTS.slice(0, 4));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("grid");
  const [cropIndex, setCropIndex] = useState(0);
  const [caption, setCaption] = useState("");
  const startedRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 2600; // let the visitor see/try the reorder first
    for (const s of POPUP_STAGES) {
      timers.push(setTimeout(() => setStage(s), elapsed));
      elapsed += s === "caption" ? 1800 : 1400;
    }
    return () => timers.forEach(clearTimeout);
  }, [active]);

  // Small back-and-forth pan while the "crop" beat is showing, purely
  // decorative (auto-driven, not user-drag, here -- the grid reorder above
  // is this stage's one genuinely interactive moment).
  useEffect(() => {
    if (stage !== "crop") return;
    const id = setInterval(() => setCropIndex((i) => (i + 1) % CROP_OFFSETS.length), 500);
    return () => clearInterval(id);
  }, [stage]);

  // Types DEMO_AI_CAPTION in character by character once the "caption" beat
  // starts -- same fabricated-AI-caption convention as the old hero preview
  // (DEMO_AI_CAPTION), just as a streaming reveal instead of static text.
  useEffect(() => {
    if (stage !== "caption" && stage !== "post-type" && stage !== "schedule" && stage !== "scheduled") return;
    if (caption.length >= DEMO_AI_CAPTION.length) return;
    const id = setInterval(() => {
      setCaption((prev) =>
        prev.length >= DEMO_AI_CAPTION.length ? prev : DEMO_AI_CAPTION.slice(0, prev.length + 3),
      );
    }, 30);
    return () => clearInterval(id);
  }, [stage, caption, DEMO_AI_CAPTION]);

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active: activeDrag, over } = e;
    if (!over || activeDrag.id === over.id) return;
    setSlots((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === activeDrag.id);
      const newIndex = prev.findIndex((s) => s.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  const activeSlot = slots.find((s) => s.id === activeId);
  const popupOpen = POPUP_STAGES.includes(stage);
  const cover = slots[0];
  const carouselAdded = stage !== "popup-open" && stage !== "crop";
  const isCarousel = carouselAdded;

  return (
    <div className="relative flex w-full flex-col items-center gap-6">
      <p className="text-xs tracking-wide text-muted uppercase">02 — Create</p>

      <div className="flex flex-col items-center gap-3">
        <p className="text-xs tracking-wide text-muted uppercase">Drag a post to reorder the feed</p>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setActiveId(String(e.active.id))}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={slots.map((s) => s.id)} strategy={rectSortingStrategy}>
            <div className="grid w-full max-w-xs grid-cols-2 gap-[2px] sm:max-w-sm">
              {slots.map((slot, i) => (
                <SortableSlot key={slot.id} id={slot.id} image={slot.image} scheduled={i === 0 && stage === "scheduled"} />
              ))}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={SORTABLE_TRANSITION}>
            {activeSlot && <LandingMedia media={activeSlot.image} className="aspect-[4/5]" />}
          </DragOverlay>
        </DndContext>
      </div>

      <AnimatePresence>
        {popupOpen && cover && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="absolute top-1/2 left-1/2 z-10 flex w-[min(90vw,360px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs tracking-wide text-muted uppercase">Edit Post</span>
              <div className="flex gap-1">
                {["Post", "Reel", "Carousel"].map((label) => (
                  <span
                    key={label}
                    className={`rounded-full border px-2 py-0.5 text-[9px] tracking-wide uppercase transition-colors duration-200 ${
                      label === (isCarousel ? "Carousel" : "Post")
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted"
                    }`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <div className="relative aspect-[4/5] w-24 shrink-0 overflow-hidden rounded-md border border-border">
                <LandingMedia media={cover.image} className="h-full w-full" style={cropStyle(stage, cropIndex)} />
              </div>
              <AnimatePresence>
                {carouselAdded && slots[1] && (
                  <motion.div
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className="relative aspect-[3/4] w-20 shrink-0 overflow-hidden rounded-md border border-border"
                  >
                    <LandingMedia media={slots[1].image} className="h-full w-full" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] tracking-wide text-muted uppercase">Caption — written by AI</span>
              <p className="min-h-[3.5em] rounded-md border border-border bg-background p-2 text-xs text-foreground">
                {caption}
                {(stage === "caption" || stage === "post-type") && caption.length < DEMO_AI_CAPTION.length && (
                  <span className="animate-pulse">|</span>
                )}
              </p>
            </div>

            <AnimatePresence>
              {(stage === "schedule" || stage === "scheduled") && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="flex items-center gap-2 text-xs text-muted"
                >
                  <ScheduleIcon className="h-3.5 w-3.5" />
                  <span>Scheduled — Thu, Aug 14 · 10:00 AM</span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function cropStyle(stage: Stage, cropIndex: number): React.CSSProperties {
  if (stage !== "crop") return {};
  const { x, y } = CROP_OFFSETS[cropIndex];
  return { objectPosition: `${50 + x}% ${50 + y}%`, transition: "object-position 0.5s ease" };
}

function SortableSlot({
  id,
  image,
  scheduled,
}: {
  id: string;
  image: DemoGridSlot["image"];
  scheduled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    transition: SORTABLE_TRANSITION,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`relative aspect-[4/5] cursor-grab touch-none border border-border transition-[opacity,border-color] duration-150 hover:border-foreground/30 ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <LandingMedia media={image} className="aspect-[4/5]" />
      {scheduled && (
        <span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-white">
          <ScheduleIcon className="h-2.5 w-2.5" />
        </span>
      )}
    </div>
  );
}

function ScheduleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
