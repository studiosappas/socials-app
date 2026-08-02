"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  convertToTask,
  createTask,
  deleteTask,
  toggleTaskCompleted,
  updateTask,
} from "@/lib/actions/todo";

export type ManualTask = {
  id: string;
  title: string;
  notes: string;
  dueDate: string | null;
  completed: boolean;
  projectName: string | null;
  sourceType: "manual" | "post" | "story";
  href: string | null;
};

export type SyncedItem = {
  itemType: "post" | "story";
  itemId: string;
  projectId: string;
  projectName: string;
  label: string;
  dueDate: string;
  href: string;
};

const labelClass = "text-xs tracking-wide text-muted uppercase";

export function TodoList({
  today,
  manualTasks,
  syncedToday,
}: {
  today: string;
  manualTasks: ManualTask[];
  syncedToday: SyncedItem[];
}) {
  const todayTasks = manualTasks.filter((t) => t.dueDate === today);
  const upcomingTasks = manualTasks.filter((t) => t.dueDate && t.dueDate > today);
  const noDateTasks = manualTasks.filter((t) => !t.dueDate);

  return (
    <div className="flex flex-col gap-10">
      <NewTaskForm />

      <section className="flex flex-col gap-3">
        <h2 className={labelClass}>Today</h2>
        <div className="flex flex-col gap-1">
          {syncedToday.map((item) => (
            <SyncedRow key={`${item.itemType}-${item.itemId}`} item={item} />
          ))}
          {todayTasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
          {syncedToday.length === 0 && todayTasks.length === 0 && (
            <p className="text-sm text-muted">Nothing due today.</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={labelClass}>Upcoming</h2>
        <div className="flex flex-col gap-1">
          {upcomingTasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
          {upcomingTasks.length === 0 && (
            <p className="text-sm text-muted">Nothing scheduled yet.</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={labelClass}>No date</h2>
        <div className="flex flex-col gap-1">
          {noDateTasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
          {noDateTasks.length === 0 && (
            <p className="text-sm text-muted">Nothing here.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function NewTaskForm() {
  const [state, action, pending] = useActionState(createTask, undefined);

  return (
    <form
      action={action}
      key={state?.success ? "reset" : "form"}
      className="flex items-end gap-3 border-b border-border pb-6"
    >
      <label className="flex flex-1 flex-col gap-1.5">
        <span className={labelClass}>New task</span>
        <input
          name="title"
          required
          placeholder="What needs doing?"
          className="border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Due date</span>
        <input
          type="date"
          name="due_date"
          className="border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
        />
      </label>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Adding..." : "Add"}
      </Button>
      {state?.message && <p className="text-xs text-error">{state.message}</p>}
    </form>
  );
}

function SyncedRow({ item }: { item: SyncedItem }) {
  const [, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 transition-colors duration-150 hover:border-foreground/30">
      <Link href={item.href} className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <span>{item.itemType === "story" ? "📖" : "🖼"}</span>
        <span className="truncate">{item.label}</span>
        <span className="shrink-0 text-xs text-muted">{item.projectName}</span>
      </Link>
      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            await convertToTask(item.projectId, item.itemType, item.itemId, item.label, item.dueDate);
            router.refresh();
          })
        }
        className="shrink-0 text-xs tracking-wide text-muted uppercase hover:text-foreground"
      >
        + Add to To-Do
      </button>
    </div>
  );
}

function TaskRow({ task }: { task: ManualTask }) {
  const [, startTransition] = useTransition();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updateTask.bind(null, task.id), undefined);

  if (editing) {
    return (
      <form
        action={action}
        className="flex flex-col gap-2 rounded-md border border-border p-3"
      >
        <input
          name="title"
          defaultValue={task.title}
          required
          className="border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
        />
        <textarea
          name="notes"
          defaultValue={task.notes}
          rows={2}
          placeholder="Notes..."
          className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm focus:border-foreground focus:outline-none"
        />
        <div className="flex items-center gap-3">
          <input
            type="date"
            name="due_date"
            defaultValue={task.dueDate ?? ""}
            className="border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
          />
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving..." : "Save"}
          </Button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs tracking-wide text-muted uppercase hover:text-foreground"
          >
            Cancel
          </button>
        </div>
        {state?.message && <p className="text-xs text-error">{state.message}</p>}
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 transition-colors duration-150 hover:border-foreground/30">
      <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <input
          type="checkbox"
          defaultChecked={task.completed}
          onChange={(e) =>
            startTransition(async () => {
              await toggleTaskCompleted(task.id, e.target.checked);
              router.refresh();
            })
          }
          className="shrink-0 accent-foreground"
        />
        <span className={`truncate ${task.completed ? "text-muted line-through" : ""}`}>
          {task.title}
        </span>
        {task.projectName && (
          <span className="shrink-0 text-xs text-muted">{task.projectName}</span>
        )}
      </label>
      <div className="flex shrink-0 items-center gap-3 text-xs tracking-wide text-muted uppercase">
        {task.href ? (
          <Link href={task.href} className="hover:text-foreground">
            View
          </Link>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="hover:text-foreground">
            Edit
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              await deleteTask(task.id);
              router.refresh();
            })
          }
          className="hover:text-error"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
