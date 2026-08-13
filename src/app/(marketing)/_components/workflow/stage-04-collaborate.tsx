"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Avatar, EmptyAvatar } from "@/components/ui/avatar";
import { LandingMedia } from "../landing-media";
import { EASE, type DemoComment } from "@/lib/landing";
import { useLandingContent } from "@/lib/landing/content-context";
import type { WorkflowStageProps } from "./workflow-types";

type Scene = "calendar" | "review" | "team";
const SCENE_ORDER: Scene[] = ["calendar", "review", "team"];
const DAYS = ["Wed 13", "Thu 14", "Fri 15", "Sat 16"];

type TaskStatus = "todo" | "in_progress" | "done";
const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

// The "Collaborate" stage: three auto-advancing scenes (calendar move,
// client review + comment, team task) sharing one story -- the same post
// created in Stage 2 moves through all three. The calendar drag is this
// stage's one genuinely interactive beat (real @dnd-kit, drag it yourself
// if you want); the review approval and task completion auto-play.
export function StageCollaborate({ active }: WorkflowStageProps) {
  const [scene, setScene] = useState<Scene>("calendar");
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;
    const timers = [
      setTimeout(() => setScene("review"), 3200),
      setTimeout(() => setScene("team"), 3200 + 3600),
    ];
    return () => timers.forEach(clearTimeout);
  }, [active]);

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <p className="text-xs tracking-wide text-muted uppercase">04 — Collaborate</p>

      <div className="flex items-center gap-2">
        {SCENE_ORDER.map((s) => (
          <span
            key={s}
            className={`h-1 w-6 rounded-full transition-colors duration-300 ${
              scene === s ? "bg-foreground" : "bg-border"
            }`}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {scene === "calendar" && (
          <motion.div key="calendar" exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>
            <CalendarScene />
          </motion.div>
        )}
        {scene === "review" && (
          <motion.div
            key="review"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <ReviewScene active={scene === "review"} />
          </motion.div>
        )}
        {scene === "team" && (
          <motion.div
            key="team"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <TeamScene active={scene === "team"} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CalendarScene() {
  const [dayIndex, setDayIndex] = useState(1);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const idx = DAYS.indexOf(String(e.over.id));
    if (idx >= 0) setDayIndex(idx);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-xs tracking-wide text-muted uppercase">Drag to reschedule</p>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-4 gap-1.5">
          {DAYS.map((day, i) => (
            <DayCell key={day} day={day} hasItem={dayIndex === i} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function DayCell({ day, hasItem }: { day: string; hasItem: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: day });
  return (
    <div
      ref={setNodeRef}
      className={`flex h-24 w-16 flex-col items-center gap-1 border p-1 text-center transition-colors duration-150 sm:w-20 ${
        isOver ? "border-foreground bg-black/[.03]" : "border-border"
      }`}
    >
      <span className="text-[9px] tracking-wide text-muted uppercase">{day}</span>
      {hasItem && <DraggableItem />}
    </div>
  );
}

function DraggableItem() {
  const { DEMO_GRID_SLOTS } = useLandingContent();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: "scheduled-post" });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`aspect-[3/4] w-full cursor-grab touch-none overflow-hidden rounded border border-border transition-opacity duration-150 ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <LandingMedia media={DEMO_GRID_SLOTS[0].image} className="h-full w-full" />
    </div>
  );
}

function ReviewScene({ active }: { active: boolean }) {
  const { DEMO_GRID_SLOTS } = useLandingContent();
  const [approved, setApproved] = useState(false);
  const [commented, setCommented] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;
    const timers = [setTimeout(() => setApproved(true), 1200), setTimeout(() => setCommented(true), 2200)];
    return () => timers.forEach(clearTimeout);
  }, [active]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative aspect-[3/4] w-40 overflow-hidden rounded-lg border border-border">
        <LandingMedia media={DEMO_GRID_SLOTS[0].image} className="h-full w-full" />
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full border px-3 py-1.5 text-xs tracking-wide uppercase transition-colors duration-300 ${
            approved ? "border-success bg-success/10 text-success" : "border-border text-muted"
          }`}
        >
          ✅ Approve
        </span>
        <span className="rounded-full border border-border px-3 py-1.5 text-xs tracking-wide text-muted uppercase">
          🔄 Request Changes
        </span>
      </div>
      {commented && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="flex items-start gap-2 text-sm"
        >
          <Avatar name="Client" avatarUrl={null} />
          <div className="min-w-0">
            <span className="mr-1.5 text-xs font-semibold">Client</span>
            <span className="text-muted">Looks great — approved!</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function TeamScene({ active }: { active: boolean }) {
  const { DEMO_TEAM, DEMO_COMMENTS, DEMO_TASK_TITLE } = useLandingContent();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [comments, setComments] = useState<DemoComment[]>([]);
  const startedRef = useRef(false);
  const done = status === "done";

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;
    const timers = [
      setTimeout(() => setExpanded(true), 700),
      setTimeout(() => setStatus("in_progress"), 1400),
      setTimeout(() => setComments([DEMO_COMMENTS[0]]), 2000),
      setTimeout(() => setStatus("done"), 2900),
    ];
    return () => timers.forEach(clearTimeout);
  }, [active, DEMO_COMMENTS]);

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <div
        className={`flex items-center gap-3 rounded-md border border-border px-3 py-2.5 transition-colors duration-150 ${
          expanded ? "bg-black/[.02]" : ""
        }`}
      >
        <span className="shrink-0 rounded-full">
          {done ? (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="8" className="fill-success" />
              <path d="M5.5 9.2 7.7 11.3 12.5 6.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="8" stroke="currentColor" strokeWidth="1.4" className="text-border" />
            </svg>
          )}
        </span>
        <span className={`min-w-0 flex-1 truncate text-sm ${done ? "text-muted line-through" : ""}`}>
          {DEMO_TASK_TITLE}
        </span>
        <Avatar name={DEMO_TEAM[1].name} avatarUrl={null} />
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 rounded-md border border-t-0 border-border px-3 pb-3 pt-1">
          <div className="flex flex-wrap gap-2 py-1">
            {STATUS_OPTIONS.map((opt) => (
              <span
                key={opt.value}
                className={`rounded-full border px-3 py-1 text-xs tracking-wide uppercase transition-colors duration-300 ${
                  status === opt.value ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"
                }`}
              >
                {opt.label}
              </span>
            ))}
          </div>
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2 text-sm">
              <Avatar name={c.author.name} avatarUrl={null} />
              <div className="min-w-0">
                <span className="mr-1.5 text-xs font-semibold">{c.author.name}</span>
                <span className="text-muted">{c.text}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-2 pt-1">
        <span className="text-xs tracking-wide text-muted uppercase">Team on this project</span>
        <div className="flex -space-x-1.5">
          {DEMO_TEAM.map((m) => (
            <Avatar key={m.id} name={m.name} avatarUrl={null} />
          ))}
          <EmptyAvatar />
        </div>
      </div>
    </div>
  );
}
