"use client";

import { Button } from "@/components/ui/button";
import { TaskRow } from "./task-row";
import { TaskDetail } from "./task-detail";
import { bucketForDueDate, type TaskBucket } from "./task-utils";
import type { TaskItem, TeamMember } from "@/lib/data/tasks";
import type { TaskStatus } from "@/types/database";

const GROUP_LABELS: Record<Exclude<TaskBucket, "none">, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  soon: "Soon",
};

export function ListView({
  tasks,
  membersByProject,
  currentUserId,
  expandedTaskId,
  onToggleExpand,
  onStatusChange,
  onAssigneeChange,
  today,
  tomorrow,
  onAddTask,
}: {
  tasks: TaskItem[];
  membersByProject: Record<string, TeamMember[]>;
  currentUserId: string;
  expandedTaskId: string | null;
  onToggleExpand: (id: string) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onAssigneeChange: (id: string, assigneeId: string | null) => void;
  today: string;
  tomorrow: string;
  onAddTask: () => void;
}) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted">No tasks yet.</p>
        <Button type="button" variant="primary" radius="full" onClick={onAddTask}>
          Add task
        </Button>
      </div>
    );
  }

  const groups: { bucket: Exclude<TaskBucket, "none">; items: TaskItem[] }[] = (["today", "tomorrow", "soon"] as const)
    .map((bucket) => ({ bucket, items: tasks.filter((t) => bucketForDueDate(t.dueDate, today, tomorrow) === bucket) }))
    .filter((g) => g.items.length > 0);

  const noDate = tasks.filter((t) => bucketForDueDate(t.dueDate, today, tomorrow) === "none");

  const row = (task: TaskItem) => (
    <div key={task.id}>
      <TaskRow
        task={task}
        members={task.projectId ? (membersByProject[task.projectId] ?? []) : []}
        currentUserId={currentUserId}
        expanded={expandedTaskId === task.id}
        onToggleExpand={() => onToggleExpand(task.id)}
        onStatusChange={(status) => onStatusChange(task.id, status)}
        onAssigneeChange={(assigneeId) => onAssigneeChange(task.id, assigneeId)}
        today={today}
        tomorrow={tomorrow}
      />
      {expandedTaskId === task.id && (
        <TaskDetail
          task={task}
          currentUserId={currentUserId}
          members={task.projectId ? (membersByProject[task.projectId] ?? []) : []}
          onStatusChange={(status) => onStatusChange(task.id, status)}
        />
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      {groups.map((g) => (
        <section key={g.bucket}>
          <p className="mb-2 mt-4 text-xs tracking-wide text-muted uppercase">
            {GROUP_LABELS[g.bucket]} · {g.items.length}
          </p>
          <div className="flex flex-col gap-1.5">{g.items.map(row)}</div>
        </section>
      ))}

      {noDate.length > 0 && (
        <section>
          <p className="mb-2 mt-4 text-xs tracking-wide text-muted uppercase">No date · {noDate.length}</p>
          <div className="flex flex-col gap-1.5">{noDate.map(row)}</div>
        </section>
      )}
    </div>
  );
}
