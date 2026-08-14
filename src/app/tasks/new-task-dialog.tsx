"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createTask } from "@/lib/actions/todo";
import type { TeamMember } from "@/lib/data/tasks";

export function NewTaskDialog({
  open,
  onClose,
  projects,
  membersByProject,
}: {
  open: boolean;
  onClose: () => void;
  projects: { id: string; name: string }[];
  membersByProject: Record<string, TeamMember[]>;
}) {
  const [state, action, pending] = useActionState(createTask, undefined);
  const [projectId, setProjectId] = useState("");

  // `state` never resets back to undefined after a successful submission
  // (useActionState just keeps returning the same {success:true} object),
  // and `onClose` is a fresh inline closure every render -- without this
  // ref, the dependency-array change alone re-fires the effect every time
  // the dialog is reopened, immediately closing it again on the SAME stale
  // success from a previous, already-handled submission. Only close on a
  // genuinely new (referentially different) success state.
  const handledStateRef = useRef(state);
  useEffect(() => {
    if (state !== handledStateRef.current && state?.success) {
      handledStateRef.current = state;
      onClose();
    }
  }, [state, onClose]);

  // Reset the project picker whenever the dialog freshly opens -- a
  // render-time comparison rather than an effect, since setState-in-effect
  // triggers an extra cascading render for what's really just derived reset
  // logic (same pattern already used for Grid's overrideRows reset).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setProjectId("");
  }

  const members = projectId ? (membersByProject[projectId] ?? []) : [];

  return (
    <Dialog open={open} onClose={onClose} title="Add task">
      <form action={action} key={open ? "open" : "closed"} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-muted uppercase">Title</span>
          <input
            name="title"
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
            name="due_date"
            className="border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-muted uppercase">Project (optional)</span>
          <select
            name="project_id"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
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
              name="assignee_id"
              defaultValue=""
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
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Adding…" : "Add task"}
          </Button>
          {state?.message && <p className="text-xs text-error">{state.message}</p>}
        </div>
      </form>
    </Dialog>
  );
}
