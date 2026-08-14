"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { MentionField } from "@/components/ui/mention-input";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { addTaskComment, deleteTask, fetchTaskComments } from "@/lib/actions/todo";
import { CalendarIcon } from "./task-row";
import type { TaskCommentItem, TeamMember } from "@/lib/data/tasks";
import type { TaskItem } from "@/lib/data/tasks";
import type { TaskStatus } from "@/types/database";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

export function TaskDetail({
  task,
  currentUserId,
  members,
  onStatusChange,
  onOpenLinkedContent,
}: {
  task: TaskItem;
  currentUserId: string;
  members: TeamMember[];
  onStatusChange: (status: TaskStatus) => void;
  onOpenLinkedContent: () => void;
}) {
  const router = useRouter();
  const [statusOpen, setStatusOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const statusRef = useOutsideClick<HTMLDivElement>(statusOpen, () => setStatusOpen(false));
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<TaskCommentItem[] | null>(null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Only fetched once the thread is actually opened -- the collapsed
  // summary line uses task.commentCount (already known, no fetch needed),
  // matching "don't permanently display the comment field."
  useEffect(() => {
    if (!commentsOpen || comments !== null) return;
    let cancelled = false;
    fetchTaskComments(task.id).then((c) => {
      if (!cancelled) setComments(c);
    });
    return () => {
      cancelled = true;
    };
  }, [commentsOpen, comments, task.id]);

  function handleStatusPick(status: TaskStatus) {
    setStatusOpen(false);
    if (status !== task.status) onStatusChange(status);
  }

  function handleDelete() {
    if (deleting) return;
    if (!confirm("Delete this task? This can't be undone.")) return;
    setMenuOpen(false);
    setDeleting(true);
    deleteTask(task.id).then(() => router.refresh());
  }

  async function handleSubmitComment(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    // Append instantly -- no separate save step, per the brief.
    const optimistic: TaskCommentItem = {
      id: `optimistic-${Date.now()}`,
      taskId: task.id,
      authorId: currentUserId,
      authorName: "You",
      authorAvatarUrl: null,
      text: trimmed,
      createdAt: new Date().toISOString(),
    };
    setComments((prev) => [...(prev ?? []), optimistic]);
    setText("");
    const result = await addTaskComment(task.id, trimmed);
    if (result.success) {
      fetchTaskComments(task.id).then(setComments);
    }
    setPosting(false);
  }

  const statusLabel = STATUS_OPTIONS.find((o) => o.value === task.status)?.label ?? "To do";
  const commentCount = comments !== null ? comments.length : task.commentCount;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="cursor-default rounded-md border border-t-0 border-border px-3 pb-3 pt-2"
    >
      <div className="flex items-center justify-between gap-2 pb-2">
        <div ref={statusRef} className="relative">
          <button
            type="button"
            onClick={() => setStatusOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs transition-colors duration-150 hover:border-foreground/40"
          >
            <span className="text-muted">Status</span>
            <span className="font-medium">{statusLabel}</span>
            <ChevronDownIcon className="h-3 w-3 text-muted" />
          </button>
          {statusOpen && (
            <div className="absolute left-0 top-8 z-20 w-36 rounded-md border border-border bg-background p-1 shadow-lg">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleStatusPick(opt.value)}
                  className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05] ${
                    task.status === opt.value ? "font-semibold text-accent" : ""
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Secondary actions -- Delete Task no longer sits permanently
            visible next to Status; Open Linked Content only shows up here
            when there's actually something to link to. */}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            title="More actions"
            className="rounded p-1 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 w-44 max-w-[calc(100vw-1.5rem)] rounded-md border border-border bg-background p-1 shadow-lg">
              {task.sourceRef && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenLinkedContent();
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                >
                  Open Linked Content
                </button>
              )}
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="block w-full rounded px-2 py-1.5 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05] disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete Task"}
              </button>
            </div>
          )}
        </div>
      </div>

      {task.sourceRef && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenLinkedContent();
          }}
          className="mb-2 flex w-fit items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted transition-colors duration-150 hover:border-foreground/40 hover:text-foreground"
        >
          <CalendarIcon className="h-3 w-3" />
          View Content
        </button>
      )}

      <div className="border-t border-border pt-2">
        <button
          type="button"
          onClick={() => setCommentsOpen((v) => !v)}
          className="text-xs text-muted transition-colors duration-150 hover:text-foreground"
        >
          {commentCount > 0 ? `${commentCount} comment${commentCount === 1 ? "" : "s"}` : "No comments"}
        </button>

        {commentsOpen && (
          <div className="mt-2 flex flex-col gap-2">
            {(comments ?? []).map((c) => (
              <div key={c.id} className="flex items-start gap-2 text-sm">
                <Avatar name={c.authorName} avatarUrl={c.authorAvatarUrl} />
                <div className="min-w-0">
                  <span className="mr-1.5 text-xs font-semibold">{c.authorName}</span>
                  <span className="text-muted">{c.text}</span>
                </div>
              </div>
            ))}
            {comments !== null && comments.length === 0 && (
              <p className="text-xs text-muted">No comments yet.</p>
            )}

            <form onSubmit={handleSubmitComment} className="mt-1 flex items-center gap-2 border-t border-border pt-2">
              <MentionField
                value={text}
                onChange={setText}
                members={members}
                placeholder="Write a comment — @ to mention"
                className="w-full border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
              />
              <button
                type="submit"
                disabled={!text.trim() || posting}
                className="shrink-0 text-xs tracking-wide text-muted uppercase transition-colors duration-150 hover:text-foreground disabled:opacity-40"
              >
                Send
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
