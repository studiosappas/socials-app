"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import {
  inviteMember,
  removeMember,
  transferOwnership,
  updateMemberPermissions,
  updateMemberRole,
} from "@/lib/actions/members";
import type { ProjectRole } from "@/types/database";

const labelClass = "text-xs tracking-wide text-muted uppercase";
const fieldClass =
  "w-full border-0 border-b border-border bg-transparent py-1.5 text-sm focus:border-foreground focus:outline-none";

const INVITE_ROLE_OPTIONS: ProjectRole[] = ["admin", "editor", "viewer", "client"];
const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: "Owner",
  admin: "Admin",
  designer: "Editor",
  editor: "Editor",
  viewer: "Viewer",
  client: "Client",
};
const PERMISSION_PAGES: { key: string; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "grid", label: "Grid" },
  { key: "stories", label: "Stories" },
  { key: "calendar", label: "Calendar" },
  { key: "brief", label: "Brief" },
  { key: "settings", label: "Settings" },
];

export type TeamMember = {
  userId: string;
  role: ProjectRole;
  customPermissions: string[] | null;
  name: string;
  email: string;
  avatarUrl: string | null;
};

export function TeamPanel({
  projectId,
  members,
  canManage,
  isOwner,
  currentUserId,
}: {
  projectId: string;
  members: TeamMember[];
  canManage: boolean;
  isOwner: boolean;
  currentUserId: string;
}) {
  const [inviteState, inviteAction, invitePending] = useActionState(
    inviteMember.bind(null, projectId),
    undefined,
  );
  const [invitePermissions, setInvitePermissions] = useState<string[]>([]);

  function toggleInvitePermission(key: string) {
    setInvitePermissions((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      {canManage && (
        <div className="flex flex-col gap-4">
          <h2 className={labelClass}>Invite Collaborators and Define Exactly What They Can Access.</h2>
          <form action={inviteAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <select name="role" defaultValue="editor" className={`${fieldClass} sm:w-32`}>
                {INVITE_ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <input
                name="email"
                type="email"
                placeholder="Email address"
                required
                className={`${fieldClass} flex-1`}
              />
              <Button type="submit" variant="primary" radius="none" disabled={invitePending} className="sm:w-fit">
                {invitePending ? "Adding…" : "Add"}
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Custom Permissions</span>
              <p className="text-xs text-muted">
                Leave unchecked to use {ROLE_LABEL.editor}&apos;s default access -- check any page to grant this
                invite access only to those pages instead.
              </p>
              <div className="flex flex-col gap-2">
                {PERMISSION_PAGES.map((page) => (
                  <label key={page.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="permissions"
                      value={page.key}
                      checked={invitePermissions.includes(page.key)}
                      onChange={() => toggleInvitePermission(page.key)}
                      className="h-3.5 w-3.5 accent-foreground"
                    />
                    {page.label}
                  </label>
                ))}
              </div>
            </div>

            {inviteState?.message && <p className="text-xs text-error">{inviteState.message}</p>}
          </form>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className={labelClass}>Team List</h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <TeamMemberRow
              key={member.userId}
              projectId={projectId}
              member={member}
              canManage={canManage}
              isOwner={isOwner}
              isSelf={member.userId === currentUserId}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function TeamMemberRow({
  projectId,
  member,
  canManage,
  isOwner,
  isSelf,
}: {
  projectId: string;
  member: TeamMember;
  canManage: boolean;
  isOwner: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<ProjectRole>(member.role);
  const [permissions, setPermissions] = useState<string[]>(member.customPermissions ?? []);
  const [useCustomPermissions, setUseCustomPermissions] = useState(Boolean(member.customPermissions));

  function togglePermission(key: string) {
    setPermissions((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function handleSaveEdit() {
    startTransition(async () => {
      await updateMemberRole(projectId, member.userId, role);
      await updateMemberPermissions(projectId, member.userId, useCustomPermissions ? permissions : null);
      router.refresh();
    });
    setEditing(false);
  }

  function handleTransferOwnership() {
    setMenuOpen(false);
    if (!confirm(`Make ${member.name} the owner of this project? You'll become an admin.`)) return;
    startTransition(async () => {
      await transferOwnership(projectId, member.userId);
      router.refresh();
    });
  }

  function handleRemove() {
    setMenuOpen(false);
    if (!confirm(`Remove ${member.name} from this project?`)) return;
    startTransition(async () => {
      await removeMember(projectId, member.userId);
      router.refresh();
    });
  }

  const canEditThisRow = canManage && member.role !== "owner";

  return (
    <li className="border border-border">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          {member.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={member.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="h-9 w-9 shrink-0 rounded-full border border-dashed border-border" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm">{member.name}</p>
            <p className="truncate text-xs text-muted">{member.email}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs tracking-wide text-muted uppercase">{ROLE_LABEL[member.role]}</span>
          {canEditThisRow && (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                title="Member options"
                className="rounded p-1 text-muted transition-colors duration-150 hover:bg-black/[.06] hover:text-foreground"
              >
                ⋮
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-7 z-10 w-48 rounded-none border border-border bg-background p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setEditing(true);
                    }}
                    className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                  >
                    Edit Permissions
                  </button>
                  {isOwner && !isSelf && (
                    <button
                      type="button"
                      onClick={handleTransferOwnership}
                      className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-black/[.05]"
                    >
                      Transfer Ownership (Owner Only)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleRemove}
                    className="w-full rounded px-2 py-1.5 text-left text-xs text-error transition-colors duration-150 hover:bg-black/[.05]"
                  >
                    Remove from Project
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div className="flex flex-col gap-4 border-t border-border bg-black/[.015] px-3 py-4">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ProjectRole)}
              className={`${fieldClass} w-40`}
            >
              {INVITE_ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useCustomPermissions}
              onChange={(e) => setUseCustomPermissions(e.target.checked)}
              className="h-3.5 w-3.5 accent-foreground"
            />
            Use custom permissions instead of {ROLE_LABEL[role]}&apos;s default access
          </label>

          {useCustomPermissions && (
            <div className="flex flex-col gap-2 pl-1">
              {PERMISSION_PAGES.map((page) => (
                <label key={page.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={permissions.includes(page.key)}
                    onChange={() => togglePermission(page.key)}
                    className="h-3.5 w-3.5 accent-foreground"
                  />
                  {page.label}
                </label>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="primary" radius="none" onClick={handleSaveEdit} className="w-fit">
              Save
            </Button>
            <Button type="button" variant="secondary" radius="none" onClick={() => setEditing(false)} className="w-fit">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
