"use client";

import { useState } from "react";
import { Avatar, EmptyAvatar } from "@/components/ui/avatar";
import { ScrollReveal } from "../motion/scroll-reveal";
import {
  COLLABORATION_SECTION_CONTENT,
  DEMO_COMMENTS,
  DEMO_TASK_TITLE,
  DEMO_TEAM,
  type DemoComment,
} from "@/lib/landing";

type TaskStatus = "todo" | "in_progress" | "done";
const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

// Rebuilt to actually represent Task Management (the feature the user meant
// by "CRM" in their rebuild brief), not just an isolated comment box. Leads
// with a real collapsed TaskRow -- the exact anatomy from
// src/app/projects/todo/task-row.tsx (status circle, title, Auto/Manual
// source badge, assignee avatar, due date, comment count) -- that expands
// on click into the real TaskDetail pattern (status pills + comment thread),
// same interaction as the real page, not two disconnected pieces.
export function CollaborateSection() {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<TaskStatus>("in_progress");
  const [comments, setComments] = useState<DemoComment[]>(DEMO_COMMENTS);
  const [text, setText] = useState("");
  const done = status === "done";

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setComments((prev) => [
      ...prev,
      { id: `local-${prev.length}`, author: DEMO_TEAM[0], text: trimmed, timeLabel: "now" },
    ]);
    setText("");
  }

  return (
    <section id="collaborate" className="mx-auto flex max-w-2xl flex-col gap-10 px-4 py-24 sm:px-8">
      <ScrollReveal className="text-center">
        <h2 className="text-3xl font-light sm:text-4xl">{COLLABORATION_SECTION_CONTENT.headline}</h2>
      </ScrollReveal>

      <ScrollReveal delay={0.1} className="flex flex-col gap-1">
        {/* Collapsed row -- identical anatomy to the real TaskRow. */}
        <div
          onClick={() => setExpanded((v) => !v)}
          className={`flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2.5 transition-colors duration-150 ${
            expanded ? "bg-black/[.02]" : "hover:bg-black/[.02]"
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setStatus(done ? "todo" : "done");
            }}
            title={done ? "Mark not done" : "Mark done"}
            className="shrink-0 rounded-full"
          >
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
          </button>

          <span className={`min-w-0 flex-1 truncate text-sm ${done ? "text-muted line-through" : ""}`}>
            {DEMO_TASK_TITLE}
          </span>

          <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] tracking-wide text-accent uppercase">
            <CalendarIcon className="h-3 w-3" />
            Auto
          </span>

          {DEMO_TEAM[1].avatar ? (
            <Avatar name={DEMO_TEAM[1].name} avatarUrl={DEMO_TEAM[1].avatar.src} />
          ) : (
            <Avatar name={DEMO_TEAM[1].name} avatarUrl={null} />
          )}

          <span className="w-10 shrink-0 text-right text-xs text-muted">Today</span>

          {comments.length > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
              <CommentIcon className="h-3.5 w-3.5" />
              {comments.length}
            </span>
          )}
        </div>

        {/* Expanded detail -- identical structure to the real TaskDetail. */}
        {expanded && (
          <div onClick={(e) => e.stopPropagation()} className="rounded-md border border-t-0 border-border px-3 pb-3 pt-1">
            <div className="flex flex-wrap gap-2 py-2">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatus(opt.value)}
                  className={`rounded-full border px-3 py-1 text-xs tracking-wide uppercase transition-colors duration-150 ${
                    status === opt.value ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:border-foreground/40"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <p className="mb-2 block text-xs text-muted underline decoration-border underline-offset-2">
              Linked to: a post on Calendar
            </p>

            <div className="flex flex-col gap-2">
              {comments.map((c) => (
                <div key={c.id} className="flex items-start gap-2 text-sm">
                  <Avatar name={c.author.name} avatarUrl={c.author.avatar?.src ?? null} />
                  <div className="min-w-0">
                    <span className="mr-1.5 text-xs font-semibold">{c.author.name}</span>
                    <span className="text-muted">{c.text}</span>
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleSend} className="mt-2 flex items-center gap-2 border-t border-border pt-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Write a comment"
                className="w-full border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
              />
              <button
                type="submit"
                disabled={!text.trim()}
                className="shrink-0 text-xs tracking-wide text-muted uppercase transition-colors duration-150 hover:text-foreground disabled:opacity-40"
              >
                Send
              </button>
            </form>
          </div>
        )}
      </ScrollReveal>

      <ScrollReveal delay={0.15} className="flex items-center justify-center gap-2">
        <span className="text-xs tracking-wide text-muted uppercase">Team on this project</span>
        <div className="flex -space-x-1.5">
          {DEMO_TEAM.map((m) => (
            <Avatar key={m.id} name={m.name} avatarUrl={m.avatar?.src ?? null} />
          ))}
          <EmptyAvatar />
        </div>
      </ScrollReveal>
    </section>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function CommentIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    </svg>
  );
}
