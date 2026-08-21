"use client";

import { useState, useTransition } from "react";
import { useOptimisticOverride } from "@/lib/hooks/use-optimistic-override";
import { useToast } from "@/lib/hooks/use-toast";
import { Toolbar, type ViewMode, type StatusView } from "./toolbar";
import { ListView } from "./list-view";
import { BoardView } from "./board-view";
import { NewTaskDialog } from "./new-task-dialog";
import { LinkedContentModal, type LinkedContentTarget } from "./linked-content-modal";
import type { TaskFilters } from "./filter-popover";
import { updateTaskAssignee, updateTaskStatus } from "@/lib/actions/todo";
import type { TaskItem, TeamMember } from "@/lib/data/tasks";
import type { TaskStatus } from "@/types/database";

export function TaskWorkspace({
  currentUserId,
  tasks,
  projects,
  membersByProject,
  today,
  tomorrow,
  autoExpandComments,
}: {
  currentUserId: string;
  tasks: TaskItem[];
  projects: { id: string; name: string }[];
  membersByProject: Record<string, TeamMember[]>;
  today: string;
  tomorrow: string;
  autoExpandComments: boolean;
}) {
  const [, startTransition] = useTransition();
  const { showError } = useToast();

  // Optimistic override so status/assignee changes render immediately
  // instead of waiting on the server round trip.
  const { value: effectiveTasks, set: setOverrideTasks } = useOptimisticOverride(tasks);

  // New-task creation: NewTaskDialog builds the full optimistic TaskItem
  // itself (it already has projects/membersByProject/currentUserId) and
  // calls these to insert it, patch in the real id once createTask
  // resolves, or remove it + surface a toast if the create failed.
  function handleTaskCreated(task: TaskItem) {
    setOverrideTasks((current) => [task, ...current]);
  }
  function handleTaskReconciled(tempId: string, realId: string) {
    setOverrideTasks((current) => current.map((t) => (t.id === tempId ? { ...t, id: realId } : t)));
  }
  function handleTaskCreateFailed(tempId: string, message: string) {
    setOverrideTasks((current) => current.filter((t) => t.id !== tempId));
    showError(message);
  }

  // Task delete: TaskDetail hides the task immediately (onDeleteStart),
  // then restores it + surfaces a toast only if the server call actually
  // failed (onDeleteFailed).
  function handleTaskDeleteStart(id: string) {
    setOverrideTasks((current) => current.filter((t) => t.id !== id));
  }
  function handleTaskDeleteFailed(task: TaskItem, message: string) {
    setOverrideTasks((current) => [task, ...current]);
    showError(message);
  }

  const [view, setView] = useState<ViewMode>("list");
  const [statusView, setStatusView] = useState<StatusView>("active");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<TaskFilters>({ assignee: null, source: "all" });
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [linkedContentTarget, setLinkedContentTarget] = useState<LinkedContentTarget | null>(null);

  // Opens the linked post/story as a popup right here instead of navigating
  // away -- /tasks sits outside /projects/[projectId]/..., so there's no
  // intercepted route (like Grid/Calendar have) available to do this for
  // free; see linked-content-modal.tsx for the client-side equivalent.
  function handleOpenLinkedContent(task: TaskItem) {
    if (!task.projectId || !task.sourceRef) return;
    setLinkedContentTarget({ projectId: task.projectId, type: task.sourceRef.type, id: task.sourceRef.id });
  }

  function handleStatusChange(taskId: string, status: TaskStatus) {
    setOverrideTasks(effectiveTasks.map((t) => (t.id === taskId ? { ...t, status } : t)));
    startTransition(async () => {
      await updateTaskStatus(taskId, status);
    });
  }

  function handleAssigneeChange(taskId: string, assigneeId: string | null) {
    const task = effectiveTasks.find((t) => t.id === taskId);
    const assignee = assigneeId && task?.projectId ? (membersByProject[task.projectId] ?? []).find((m) => m.id === assigneeId) : null;
    setOverrideTasks(effectiveTasks.map((t) => (t.id === taskId ? { ...t, assignee: assignee ?? null } : t)));
    startTransition(async () => {
      await updateTaskAssignee(taskId, assigneeId);
    });
  }

  function handleToggleExpand(taskId: string) {
    setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
  }

  const assigneesPresent = Array.from(
    new Map(effectiveTasks.filter((t) => t.assignee).map((t) => [t.assignee!.id, t.assignee!])).values(),
  );

  const visibleTasks = effectiveTasks.filter((t) => {
    // Completed tasks are archived out of the day-to-day view by default --
    // this is the ONE place that distinction is enforced, so both ListView
    // and BoardView (which just render whatever they're handed) stay
    // consistent automatically.
    if (statusView === "active" && t.status === "done") return false;
    if (statusView === "completed" && t.status !== "done") return false;
    if (search.trim() && !t.title.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (filters.source !== "all" && t.source !== filters.source) return false;
    if (filters.assignee === "unassigned" && t.assignee) return false;
    if (filters.assignee && filters.assignee !== "unassigned" && t.assignee?.id !== filters.assignee) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <Toolbar
        view={view}
        onViewChange={setView}
        statusView={statusView}
        onStatusViewChange={setStatusView}
        search={search}
        onSearchChange={setSearch}
        filters={filters}
        onFiltersChange={setFilters}
        assignees={assigneesPresent}
        onAddTask={() => setNewTaskOpen(true)}
      />

      {view === "list" ? (
        <ListView
          tasks={visibleTasks}
          membersByProject={membersByProject}
          currentUserId={currentUserId}
          expandedTaskId={expandedTaskId}
          onToggleExpand={handleToggleExpand}
          onStatusChange={handleStatusChange}
          onAssigneeChange={handleAssigneeChange}
          onOpenLinkedContent={handleOpenLinkedContent}
          today={today}
          tomorrow={tomorrow}
          onAddTask={() => setNewTaskOpen(true)}
          autoExpandComments={autoExpandComments}
          onTaskDeleteStart={handleTaskDeleteStart}
          onTaskDeleteFailed={handleTaskDeleteFailed}
        />
      ) : (
        <BoardView
          tasks={visibleTasks}
          membersByProject={membersByProject}
          currentUserId={currentUserId}
          expandedTaskId={expandedTaskId}
          onToggleExpand={handleToggleExpand}
          onStatusChange={handleStatusChange}
          onAssigneeChange={handleAssigneeChange}
          onOpenLinkedContent={handleOpenLinkedContent}
          today={today}
          tomorrow={tomorrow}
          autoExpandComments={autoExpandComments}
          onTaskDeleteStart={handleTaskDeleteStart}
          onTaskDeleteFailed={handleTaskDeleteFailed}
        />
      )}

      <NewTaskDialog
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        projects={projects}
        membersByProject={membersByProject}
        currentUserId={currentUserId}
        onTaskCreated={handleTaskCreated}
        onTaskReconciled={handleTaskReconciled}
        onTaskCreateFailed={handleTaskCreateFailed}
      />

      {linkedContentTarget && (
        <LinkedContentModal target={linkedContentTarget} onClose={() => setLinkedContentTarget(null)} />
      )}
    </div>
  );
}
