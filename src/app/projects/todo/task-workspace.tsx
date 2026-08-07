"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Toolbar, type ViewMode } from "./toolbar";
import { ListView } from "./list-view";
import { BoardView } from "./board-view";
import { NewTaskDialog } from "./new-task-dialog";
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
}: {
  currentUserId: string;
  tasks: TaskItem[];
  projects: { id: string; name: string }[];
  membersByProject: Record<string, TeamMember[]>;
  today: string;
  tomorrow: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Optimistic override so status/assignee changes render immediately
  // instead of waiting on the server round trip -- same "reset when the
  // server prop actually changes" pattern as Grid's own overrideRows.
  const [prevTasks, setPrevTasks] = useState(tasks);
  const [overrideTasks, setOverrideTasks] = useState<TaskItem[] | null>(null);
  if (tasks !== prevTasks) {
    setPrevTasks(tasks);
    setOverrideTasks(null);
  }
  const effectiveTasks = overrideTasks ?? tasks;

  const [view, setView] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<TaskFilters>({ assignee: null, source: "all" });
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  function handleStatusChange(taskId: string, status: TaskStatus) {
    setOverrideTasks(effectiveTasks.map((t) => (t.id === taskId ? { ...t, status } : t)));
    startTransition(async () => {
      await updateTaskStatus(taskId, status);
      router.refresh();
    });
  }

  function handleAssigneeChange(taskId: string, assigneeId: string | null) {
    const task = effectiveTasks.find((t) => t.id === taskId);
    const assignee = assigneeId && task?.projectId ? (membersByProject[task.projectId] ?? []).find((m) => m.id === assigneeId) : null;
    setOverrideTasks(effectiveTasks.map((t) => (t.id === taskId ? { ...t, assignee: assignee ?? null } : t)));
    startTransition(async () => {
      await updateTaskAssignee(taskId, assigneeId);
      router.refresh();
    });
  }

  function handleToggleExpand(taskId: string) {
    setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
  }

  const assigneesPresent = Array.from(
    new Map(effectiveTasks.filter((t) => t.assignee).map((t) => [t.assignee!.id, t.assignee!])).values(),
  );

  const visibleTasks = effectiveTasks.filter((t) => {
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
          today={today}
          tomorrow={tomorrow}
          onAddTask={() => setNewTaskOpen(true)}
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
          today={today}
          tomorrow={tomorrow}
        />
      )}

      <NewTaskDialog
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        projects={projects}
        membersByProject={membersByProject}
      />
    </div>
  );
}
