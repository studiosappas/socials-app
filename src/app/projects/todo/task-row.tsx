"use client";

import { useState } from "react";
import { Avatar, EmptyAvatar } from "@/components/ui/avatar";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { formatDueLabel } from "./task-utils";
import type { TaskItem, TeamMember } from "@/lib/data/tasks";
import type { TaskStatus } from "@/types/database";

export function TaskRow({
  task,
  members,
  currentUserId,
  expanded,
  onToggleExpand,
  onStatusChange,
  onAssigneeChange,
  today,
  tomorrow,
}: {
  task: TaskItem;
  members: TeamMember[];
  currentUserId: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onStatusChange: (status: TaskStatus) => void;
  onAssigneeChange: (assigneeId: string | null) => void;
  today: string;
  tomorrow: string;
}) {
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const assigneeRef = useOutsideClick<HTMLDivElement>(assigneeOpen, () => setAssigneeOpen(false));

  const done = task.status === "done";

  function handleStatusCircleClick(e: React.MouseEvent) {
    e.stopPropagation();
    onStatusChange(done ? "todo" : "done");
  }

  function handleAssigneePick(memberId: string | null) {
    setAssigneeOpen(false);
    onAssigneeChange(memberId);
  }

  return (
    <div
      onClick={onToggleExpand}
      className={`flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2.5 transition-colors duration-150 ${
        expanded ? "bg-black/[.02]" : "hover:bg-black/[.02]"
      }`}
    >
      <button
        type="button"
        onClick={handleStatusCircleClick}
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

      <span className={`min-w-0 flex-1 truncate text-sm ${done ? "text-muted line-through" : ""}`}>{task.title}</span>

      <SourceBadge source={task.source} />

      <div ref={assigneeRef} className="relative shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAssigneeOpen((v) => !v);
          }}
          title={task.assignee ? task.assignee.name : "Unassigned"}
        >
          {task.assignee ? (
            <Avatar name={task.assignee.name} avatarUrl={task.assignee.avatarUrl} />
          ) : (
            <EmptyAvatar />
          )}
        </button>
        {assigneeOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-6 z-20 w-44 max-w-[calc(100vw-1.5rem)] rounded-md border border-border bg-background p-1 shadow-lg"
          >
            {task.projectId ? (
              <>
                <button
                  type="button"
                  onClick={() => handleAssigneePick(null)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                >
                  <EmptyAvatar />
                  Unassigned
                </button>
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleAssigneePick(m.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                  >
                    <Avatar name={m.name} avatarUrl={m.avatarUrl} />
                    <span className="truncate">{m.name}</span>
                  </button>
                ))}
              </>
            ) : (
              <button
                type="button"
                onClick={() => handleAssigneePick(task.assignee ? null : currentUserId)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
              >
                {task.assignee ? "Unassign" : "Assign to me"}
              </button>
            )}
          </div>
        )}
      </div>

      {task.dueDate && (
        <span className="w-10 shrink-0 text-right text-xs text-muted">{formatDueLabel(task.dueDate, today, tomorrow)}</span>
      )}

      {task.commentCount > 0 && (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
          <CommentIcon className="h-3.5 w-3.5" />
          {task.commentCount}
        </span>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: "manual" | "auto" }) {
  if (source === "auto") {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] tracking-wide text-accent uppercase">
        <CalendarIcon className="h-3 w-3" />
        Auto
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/[.04] px-2 py-0.5 text-[10px] tracking-wide text-muted uppercase">
      <PencilIcon className="h-3 w-3" />
      Manual
    </span>
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

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M17 3a2.83 2.83 0 0 1 4 4L7 21l-4 1 1-4Z" />
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
