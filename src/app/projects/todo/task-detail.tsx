"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { MentionField } from "@/components/ui/mention-input";
import { addTaskComment, deleteTask, fetchTaskComments } from "@/lib/actions/todo";
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
}: {
  task: TaskItem;
  currentUserId: string;
  members: TeamMember[];
  onStatusChange: (status: TaskStatus) => void;
}) {
  const router = useRouter();
  const [comments, setComments] = useState<TaskCommentItem[] | null>(null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTaskComments(task.id).then((c) => {
      if (!cancelled) setComments(c);
    });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  function handlePillClick(status: TaskStatus) {
    if (status === task.status) return;
    onStatusChange(status);
  }

  function handleDelete() {
    if (deleting) return;
    if (!confirm("Delete this task? This can't be undone.")) return;
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

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="cursor-default rounded-md border border-t-0 border-border px-3 pb-3 pt-1"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 py-2">
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handlePillClick(opt.value)}
              className={`rounded-full border px-3 py-1 text-xs tracking-wide uppercase transition-colors duration-150 ${
                task.status === opt.value
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted hover:border-foreground/40"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="shrink-0 text-xs text-error transition-colors duration-150 hover:underline disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete Task"}
        </button>
      </div>

      {task.sourceRef && task.sourceHref && (
        <Link
          href={task.sourceHref}
          className="mb-2 block text-xs text-muted underline decoration-border underline-offset-2 hover:text-foreground"
        >
          Linked to: {task.sourceRef.type === "post" ? "a post" : "a story"} on Calendar
        </Link>
      )}

      <div className="flex flex-col gap-2">
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
      </div>

      <form onSubmit={handleSubmitComment} className="mt-2 flex items-center gap-2 border-t border-border pt-2">
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
  );
}
