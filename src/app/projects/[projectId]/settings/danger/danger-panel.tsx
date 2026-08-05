"use client";

import { useTransition } from "react";
import { archiveProject, deleteProjectPermanently, duplicateProject } from "@/lib/actions/settings";

export function DangerPanel({
  projectId,
  projectName,
  isOwner,
}: {
  projectId: string;
  projectName: string;
  isOwner: boolean;
}) {
  const [duplicating, startDuplicate] = useTransition();
  const [archiving, startArchive] = useTransition();
  const [deleting, startDelete] = useTransition();

  function handleDuplicate() {
    if (!confirm(`Duplicate "${projectName}"? This copies its branding and settings into a new project.`)) return;
    startDuplicate(() => duplicateProject(projectId));
  }

  function handleArchive() {
    if (!confirm(`Archive "${projectName}"? It'll be hidden from your projects list, but nothing is deleted.`))
      return;
    startArchive(() => archiveProject(projectId));
  }

  function handleDelete() {
    if (!confirm(`Permanently delete "${projectName}"? This deletes everything and can't be undone.`)) return;
    if (!confirm("Are you absolutely sure? Type nothing needed -- just confirm again to permanently delete.")) return;
    startDelete(() => deleteProjectPermanently(projectId));
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <DangerCard
        label="Duplicate Project"
        description="Copy this project's branding and settings into a new project."
        onClick={handleDuplicate}
        pending={duplicating}
        pendingLabel="Duplicating…"
      />
      <DangerCard
        label="Archive Project"
        description="Hide this project from your list without deleting anything."
        onClick={handleArchive}
        pending={archiving}
        pendingLabel="Archiving…"
      />
      {isOwner ? (
        <DangerCard
          label="Delete Project"
          description="Permanently delete this project and everything in it."
          onClick={handleDelete}
          pending={deleting}
          pendingLabel="Deleting…"
          destructive
        />
      ) : (
        <div className="flex aspect-square flex-col items-center justify-center gap-2 border border-dashed border-border p-4 text-center opacity-50">
          <span className="text-sm tracking-wide uppercase">Delete Project</span>
          <span className="text-xs text-muted">Only the project owner can delete it.</span>
        </div>
      )}
    </div>
  );
}

function DangerCard({
  label,
  description,
  onClick,
  pending,
  pendingLabel,
  destructive = false,
}: {
  label: string;
  description: string;
  onClick: () => void;
  pending: boolean;
  pendingLabel: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`flex aspect-square flex-col items-center justify-center gap-2 border border-dashed p-4 text-center transition-colors duration-150 disabled:cursor-default disabled:opacity-60 ${
        destructive
          ? "border-error/40 hover:border-error text-error"
          : "border-border hover:border-foreground/40"
      }`}
    >
      <span className="text-sm tracking-wide uppercase">{pending ? pendingLabel : label}</span>
      <span className="text-xs text-muted">{description}</span>
    </button>
  );
}
