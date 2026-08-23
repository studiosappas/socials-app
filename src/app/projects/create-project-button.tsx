"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { useToast } from "@/lib/hooks/use-toast";
import { createProjectWithSetup, setProjectAvatar } from "@/lib/actions/projects";
import type { ProjectRole } from "@/types/database";

const labelClass = "text-xs tracking-wide text-muted uppercase";
const fieldClass =
  "w-full border-0 border-b border-border bg-transparent py-1.5 text-sm focus:border-foreground focus:outline-none";

// Same 4 invitable roles as Project Settings > Team (members.ts's own
// VALID_ROLES) -- owner is granted only via the on_project_created trigger,
// 'designer' is legacy-only, neither belongs in a fresh invite here.
const ROLE_OPTIONS: ProjectRole[] = ["admin", "editor", "viewer", "client"];
const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: "Owner",
  admin: "Admin",
  designer: "Editor",
  editor: "Editor",
  viewer: "Viewer",
  client: "Client",
};

type PersonRow = { key: number; email: string; role: ProjectRole };

export function CreateProjectButton({
  currentUser,
}: {
  currentUser: { name: string; email: string; avatarUrl: string | null };
}) {
  const router = useRouter();
  const { showError } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [nextKey, setNextKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // A same-tick double-click both fire before React re-renders with the
  // updated `submitting` state, so both event handlers can still read the
  // OLD (false) value from their closure -- the `submitting` state guard
  // alone isn't reliable against that. This ref is set/checked synchronously
  // in the same statement, independent of any render, so it can't race.
  const submittingRef = useRef(false);

  function reset() {
    setName("");
    setImageFile(null);
    setImagePreview(null);
    setPeople([]);
    setError(null);
    setSubmitting(false);
    submittingRef.current = false;
  }

  function close() {
    // Never let the backdrop/X/Escape dismiss mid-submit -- the user needs
    // to see whether creation succeeded or failed, not lose that state.
    if (submittingRef.current) return;
    setOpen(false);
    reset();
  }

  function addPerson() {
    setPeople((prev) => [...prev, { key: nextKey, email: "", role: "editor" }]);
    setNextKey((k) => k + 1);
  }

  function updatePerson(key: number, patch: Partial<PersonRow>) {
    setPeople((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function removePerson(key: number) {
    setPeople((prev) => prev.filter((p) => p.key !== key));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    startTransition(async () => {
      try {
        const invitePeople = people
          .map((p) => ({ email: p.email.trim(), role: p.role }))
          .filter((p) => p.email);

        const result = await createProjectWithSetup(trimmed, invitePeople);

        if (!result.success) {
          setError(result.message);
          setSubmitting(false);
          submittingRef.current = false;
          return;
        }

        if (imageFile) {
          const avatarFormData = new FormData();
          avatarFormData.set("avatar", imageFile);
          const avatarResult = await setProjectAvatar(result.projectId, undefined, avatarFormData);
          if (avatarResult?.message) {
            showError(`Project created, but the image couldn't be saved: ${avatarResult.message}`);
          }
        }

        if (result.failedInvites.length > 0) {
          const list = result.failedInvites.map((f) => f.email).join(", ");
          showError(`Project created. Couldn't invite: ${list}`);
        }

        router.push(`/projects/${result.projectId}/grid`);
        setOpen(false);
        reset();
      } catch (err) {
        console.error("Failed to create project:", err);
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
        setSubmitting(false);
        submittingRef.current = false;
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-fit items-center gap-2 text-xs tracking-wide uppercase text-foreground transition-colors duration-150 hover:text-muted"
      >
        <span className="text-base leading-none">+</span> Create New Project
      </button>

      <Dialog open={open} onClose={close} title="Create New Project" radius="none" widthClassName="max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Project name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={fieldClass}
              placeholder="Client / brand name"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className={labelClass}>Project image</span>
            <label className="relative flex h-14 w-14 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border">
              {imagePreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imagePreview} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-lg text-muted">+</span>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setImageFile(file);
                    setImagePreview(URL.createObjectURL(file));
                  }
                }}
              />
            </label>
          </div>

          <div className="flex flex-col gap-3">
            <span className={labelClass}>People</span>

            <div className="flex items-center gap-3">
              <Avatar name={currentUser.name} avatarUrl={currentUser.avatarUrl} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{currentUser.name}</p>
                <p className="truncate text-xs text-muted">{currentUser.email}</p>
              </div>
              <span className="shrink-0 text-xs tracking-wide text-muted uppercase">Owner</span>
            </div>

            {people.map((person) => (
              <div key={person.key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="email"
                  value={person.email}
                  onChange={(e) => updatePerson(person.key, { email: e.target.value })}
                  placeholder="Email address"
                  className={`${fieldClass} flex-1`}
                />
                <div className="flex items-center gap-2">
                  <select
                    value={person.role}
                    onChange={(e) => updatePerson(person.key, { role: e.target.value as ProjectRole })}
                    className={`${fieldClass} sm:w-28`}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removePerson(person.key)}
                    title="Remove"
                    className="shrink-0 text-xs text-muted transition-colors duration-150 hover:text-error"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addPerson}
              className="w-fit text-xs tracking-wide uppercase text-muted transition-colors duration-150 hover:text-foreground"
            >
              + Add person
            </button>
          </div>

          {error && <p className="text-xs text-error">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" radius="none" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" radius="none" disabled={submitting || !name.trim()}>
              {submitting ? "Creating…" : "Create Project"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
