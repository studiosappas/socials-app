"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createTask } from "@/lib/actions/todo";
import type { TaskItem, TeamMember } from "@/lib/data/tasks";

export function NewTaskDialog({
  open,
  onClose,
  projects,
  membersByProject,
  currentUserId,
  onTaskCreated,
  onTaskReconciled,
  onTaskCreateFailed,
}: {
  open: boolean;
  onClose: () => void;
  projects: { id: string; name: string }[];
  membersByProject: Record<string, TeamMember[]>;
  currentUserId: string;
  onTaskCreated: (task: TaskItem) => void;
  onTaskReconciled: (tempId: string, realId: string) => void;
  onTaskCreateFailed: (tempId: string, message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  // Reset every field whenever the dialog freshly opens -- a render-time
  // comparison rather than an effect, same "adjust state during render"
  // convention used elsewhere in this codebase (e.g. Grid's overrideRows
  // reset) for a reset that needs no external synchronization.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setTitle("");
      setDueDate("");
      setProjectId("");
      setAssigneeId("");
    }
  }

  const members = projectId ? (membersByProject[projectId] ?? []) : [];

  // Builds the same shape getTasksForUser derives server-side, from data
  // already available client-side (projects/membersByProject props,
  // currentUserId) -- everything except the real id, which is reconciled
  // once createTask resolves. projectAvatarUrl is the one field genuinely
  // unavailable here (the `projects` prop carries only id/name), so it
  // starts null and self-corrects on the next real navigation.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const tempId = `temp-${Date.now()}`;
    const project = projectId ? (projects.find((p) => p.id === projectId) ?? null) : null;
    const assignee = assigneeId ? (members.find((m) => m.id === assigneeId) ?? null) : null;
    const now = new Date().toISOString();

    const optimisticTask: TaskItem = {
      id: tempId,
      projectId: projectId || null,
      projectName: project?.name ?? null,
      projectAvatarUrl: null,
      title: trimmedTitle,
      status: "todo",
      dueDate: dueDate || null,
      source: "manual",
      sourceRef: null,
      assignee,
      createdBy: currentUserId,
      createdAt: now,
      updatedAt: now,
      commentCount: 0,
      // Reaching this point at all means createTask's own RLS check (or the
      // personal-task self clause) is about to allow it -- if it doesn't,
      // onTaskCreateFailed removes this optimistic row entirely, so there's
      // no window where an unauthorized create is shown as manageable.
      canManage: true,
    };
    onTaskCreated(optimisticTask);
    onClose();

    startTransition(async () => {
      const formData = new FormData();
      formData.set("title", trimmedTitle);
      formData.set("due_date", dueDate);
      formData.set("project_id", projectId);
      formData.set("assignee_id", assigneeId);
      const result = await createTask(undefined, formData);
      if (result?.success && result.taskId) {
        onTaskReconciled(tempId, result.taskId);
      } else {
        onTaskCreateFailed(tempId, result?.message ?? "Couldn't add that task.");
      }
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add task">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-muted uppercase">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
            placeholder="What needs doing?"
            className="border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-muted uppercase">Due date</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-muted uppercase">Project (optional)</span>
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setAssigneeId("");
            }}
            className="border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
          >
            <option value="">Personal (only you)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        {projectId && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs tracking-wide text-muted uppercase">Assignee</span>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending || !title.trim()}>
            Add task
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
