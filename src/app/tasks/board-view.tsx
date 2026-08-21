"use client";

import { useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { DROP_ANIMATION } from "@/lib/dnd-motion";
import { TaskRow } from "./task-row";
import { TaskDetail } from "./task-detail";
import type { TaskItem, TeamMember } from "@/lib/data/tasks";
import type { TaskStatus } from "@/types/database";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

type SharedProps = {
  tasks: TaskItem[];
  membersByProject: Record<string, TeamMember[]>;
  currentUserId: string;
  expandedTaskId: string | null;
  onToggleExpand: (id: string) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onAssigneeChange: (id: string, assigneeId: string | null) => void;
  onOpenLinkedContent: (task: TaskItem) => void;
  today: string;
  tomorrow: string;
  autoExpandComments: boolean;
  onTaskDeleteStart: (id: string) => void;
  onTaskDeleteFailed: (task: TaskItem, message: string) => void;
};

export function BoardView(props: SharedProps) {
  return (
    <>
      <DesktopBoard {...props} />
      <MobileBoard {...props} />
    </>
  );
}

function DesktopBoard({
  tasks,
  membersByProject,
  currentUserId,
  expandedTaskId,
  onToggleExpand,
  onStatusChange,
  onAssigneeChange,
  onOpenLinkedContent,
  today,
  tomorrow,
  autoExpandComments,
  onTaskDeleteStart,
  onTaskDeleteFailed,
}: SharedProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const activeTask = tasks.find((t) => t.id === activeId) ?? null;

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const nextStatus = over.id as TaskStatus;
    const task = tasks.find((t) => t.id === active.id);
    if (!task || task.status === nextStatus) return;
    onStatusChange(task.id, nextStatus);
  }

  return (
    <div className="hidden sm:block">
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
          {COLUMNS.map((col) => (
            <BoardColumn key={col.status} status={col.status} label={col.label} count={tasks.filter((t) => t.status === col.status).length}>
              {tasks
                .filter((t) => t.status === col.status)
                .map((task) => (
                  <DraggableTaskCard key={task.id} task={task}>
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
                        onOpenLinkedContent={() => onOpenLinkedContent(task)}
                        autoExpandComments={autoExpandComments}
                        onDeleteStart={onTaskDeleteStart}
                        onDeleteFailed={onTaskDeleteFailed}
                      />
                    )}
                  </DraggableTaskCard>
                ))}
            </BoardColumn>
          ))}
        </div>
        <DragOverlay dropAnimation={DROP_ANIMATION}>
          {activeTask && (
            <div className="rounded-md border border-foreground bg-background px-3 py-2.5 text-sm shadow-lg">
              {activeTask.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function BoardColumn({
  status,
  label,
  count,
  children,
}: {
  status: TaskStatus;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className={`flex flex-col gap-1.5 px-3 pb-4 pt-3 transition-colors duration-150 ${isOver ? "bg-black/[.02]" : ""}`}>
      <p className="mb-1 text-xs tracking-wide text-muted uppercase">
        {label} · {count}
      </p>
      {children}
    </div>
  );
}

function DraggableTaskCard({ task, children }: { task: TaskItem; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = { transform: CSS.Translate.toString(transform) };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={isDragging ? "opacity-30" : ""}>
      {children}
    </div>
  );
}

function MobileBoard({
  tasks,
  membersByProject,
  currentUserId,
  expandedTaskId,
  onToggleExpand,
  onStatusChange,
  onAssigneeChange,
  onOpenLinkedContent,
  today,
  tomorrow,
  autoExpandComments,
  onTaskDeleteStart,
  onTaskDeleteFailed,
}: SharedProps) {
  const [activeTab, setActiveTab] = useState<TaskStatus>("todo");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Partial<Record<TaskStatus, HTMLDivElement | null>>>({});

  function scrollToTab(status: TaskStatus) {
    setActiveTab(status);
    panelRefs.current[status]?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  function handleScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    setActiveTab(COLUMNS[Math.min(Math.max(index, 0), COLUMNS.length - 1)].status);
  }

  return (
    <div className="sm:hidden">
      <div className="mb-3 flex items-center rounded-full border border-border bg-black/[.02] p-0.5">
        {COLUMNS.map((col) => (
          <button
            key={col.status}
            type="button"
            onClick={() => scrollToTab(col.status)}
            className={`flex-1 rounded-full px-2 py-1.5 text-xs tracking-wide uppercase transition-colors duration-150 ${
              activeTab === col.status ? "bg-card text-foreground shadow-sm" : "text-muted"
            }`}
          >
            {col.label}
          </button>
        ))}
      </div>

      <div ref={scrollerRef} onScroll={handleScroll} className="flex snap-x snap-mandatory overflow-x-auto">
        {COLUMNS.map((col) => (
          <div
            key={col.status}
            ref={(el) => {
              panelRefs.current[col.status] = el;
            }}
            className="w-full shrink-0 snap-center px-0.5"
          >
            <div className="flex flex-col gap-1.5">
              {tasks
                .filter((t) => t.status === col.status)
                .map((task) => (
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
                        onOpenLinkedContent={() => onOpenLinkedContent(task)}
                        autoExpandComments={autoExpandComments}
                        onDeleteStart={onTaskDeleteStart}
                        onDeleteFailed={onTaskDeleteFailed}
                      />
                    )}
                  </div>
                ))}
              {tasks.filter((t) => t.status === col.status).length === 0 && (
                <p className="py-6 text-center text-xs text-muted">Nothing here.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
