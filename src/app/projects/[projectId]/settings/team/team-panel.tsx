"use client";

import { useActionState, useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { useToast } from "@/lib/hooks/use-toast";
import {
  inviteMember,
  removeMember,
  transferOwnership,
  updateMemberPermissions,
  updateMemberRole,
} from "@/lib/actions/members";
import {
  INVITABLE_ROLES,
  PERMISSION_PAGE_KEYS,
  PERMISSION_PAGE_LABEL,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
} from "@/lib/role-permissions";
import type { ProjectRole } from "@/types/database";

const labelClass = "text-xs tracking-wide text-muted uppercase";
const fieldClass =
  "w-full border-0 border-b border-border bg-transparent py-1.5 text-sm focus:border-foreground focus:outline-none";
const PERMISSION_PAGES = PERMISSION_PAGE_KEYS.map((key) => ({ key, label: PERMISSION_PAGE_LABEL[key] }));

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
  const { showError } = useToast();

  function toggleInvitePermission(key: string) {
    setInvitePermissions((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  // Optimistic role display + hide-on-remove -- roleOverrides patches what
  // badge a row shows (role edit, or both sides of a transfer-ownership),
  // hiddenMemberIds hides a removed row immediately. Same "exclusion set,
  // no reset-on-prop-change needed" reasoning as every other hidden-id set
  // in this phase; roleOverrides similarly stays correct even after a
  // stale `members` prop, since it's never cleared except by an explicit
  // rollback.
  const [roleOverrides, setRoleOverrides] = useState<Record<string, ProjectRole>>({});
  const [hiddenMemberIds, setHiddenMemberIds] = useState<Set<string>>(new Set());

  const visibleMembers = useMemo(() => {
    const withRoles =
      Object.keys(roleOverrides).length === 0
        ? members
        : members.map((m) => (roleOverrides[m.userId] ? { ...m, role: roleOverrides[m.userId] } : m));
    return hiddenMemberIds.size === 0 ? withRoles : withRoles.filter((m) => !hiddenMemberIds.has(m.userId));
  }, [members, roleOverrides, hiddenMemberIds]);

  const setRole = useCallback((userId: string, role: ProjectRole) => {
    setRoleOverrides((prev) => ({ ...prev, [userId]: role }));
  }, []);
  const clearRoleOverride = useCallback((userId: string) => {
    setRoleOverrides((prev) => {
      if (!(userId in prev)) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);
  const hideMember = useCallback((userId: string) => {
    setHiddenMemberIds((prev) => new Set(prev).add(userId));
  }, []);
  const unhideMember = useCallback((userId: string) => {
    setHiddenMemberIds((prev) => {
      if (!prev.has(userId)) return prev;
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      {canManage && (
        <div className="flex flex-col gap-4">
          <h2 className={labelClass}>Invite Collaborators and Define Exactly What They Can Access.</h2>
          <form action={inviteAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <select name="role" defaultValue="editor" className={`${fieldClass} sm:w-32`}>
                {INVITABLE_ROLES.map((r) => (
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
          {visibleMembers.map((member) => (
            <TeamMemberRow
              key={member.userId}
              projectId={projectId}
              member={member}
              canManage={canManage}
              isOwner={isOwner}
              isSelf={member.userId === currentUserId}
              currentUserId={currentUserId}
              onSetRole={setRole}
              onClearRoleOverride={clearRoleOverride}
              onHideMember={hideMember}
              onUnhideMember={unhideMember}
              onError={showError}
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
  currentUserId,
  onSetRole,
  onClearRoleOverride,
  onHideMember,
  onUnhideMember,
  onError,
}: {
  projectId: string;
  member: TeamMember;
  canManage: boolean;
  isOwner: boolean;
  isSelf: boolean;
  currentUserId: string;
  onSetRole: (userId: string, role: ProjectRole) => void;
  onClearRoleOverride: (userId: string) => void;
  onHideMember: (userId: string) => void;
  onUnhideMember: (userId: string) => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  const [editing, setEditing] = useState(false);
  const [role, setLocalRole] = useState<ProjectRole>(member.role);
  const [permissions, setPermissions] = useState<string[]>(member.customPermissions ?? []);
  const [useCustomPermissions, setUseCustomPermissions] = useState(Boolean(member.customPermissions));

  function togglePermission(key: string) {
    setPermissions((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function handleSaveEdit() {
    const roleChanged = role !== member.role;
    // Deliberate, explicit choice -- never a silent overwrite. Confirming
    // resets this member's permissions to the new role's default preset
    // (in the same atomic update as the role change itself, see
    // updateMemberRole's own comment); declining leaves custom_permissions
    // completely untouched. Either way this save only ever changes ROLE --
    // any in-progress edits to the permission checkboxes below are ignored
    // when the role also changed, so there's no ambiguity about whether a
    // permission change was intentional. To change both, save the role
    // first, then reopen this row to adjust permissions separately.
    const applyPreset = roleChanged
      ? confirm(
          `Apply ${ROLE_LABEL[role]} default permissions?\n\nThis resets ${member.name}'s permissions to the ${ROLE_LABEL[role]} preset. Choose Cancel to change their role but keep their current permissions exactly as they are.`,
        )
      : false;

    setEditing(false);
    onSetRole(member.userId, role);
    startTransition(async () => {
      try {
        await updateMemberRole(projectId, member.userId, role, applyPreset);
        if (!roleChanged) {
          await updateMemberPermissions(projectId, member.userId, useCustomPermissions ? permissions : null);
        }
      } catch (error) {
        console.error("Failed to save member edit:", error);
        onClearRoleOverride(member.userId);
        onError(error instanceof Error ? error.message : "Couldn't save that change.");
        router.refresh();
      }
    });
  }

  function handleTransferOwnership() {
    setMenuOpen(false);
    if (!confirm(`Make ${member.name} the owner of this project? You'll become an admin.`)) return;
    onSetRole(member.userId, "owner");
    onSetRole(currentUserId, "admin");
    startTransition(async () => {
      try {
        await transferOwnership(projectId, member.userId);
      } catch (error) {
        console.error("Failed to transfer ownership:", error);
        onClearRoleOverride(member.userId);
        onClearRoleOverride(currentUserId);
        onError(error instanceof Error ? error.message : "Couldn't transfer ownership.");
        router.refresh();
      }
    });
  }

  function handleRemove() {
    setMenuOpen(false);
    if (!confirm(`Remove ${member.name} from this project?`)) return;
    onHideMember(member.userId);
    startTransition(async () => {
      const result = await removeMember(projectId, member.userId);
      if (!result.success) {
        console.error("Failed to remove member:", result.message);
        onUnhideMember(member.userId);
        onError(result.message);
        router.refresh();
      }
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
          {/* ROLE stays what it's always been (the badge); PERMISSIONS is
              the separate, per-member override underneath -- see the
              editing panel's own "use custom permissions instead of..."
              copy for the same distinction spelled out. */}
          <span className="text-right">
            <span className="block text-xs tracking-wide text-foreground uppercase">{ROLE_LABEL[member.role]}</span>
            <span className="block text-[10px] text-muted">
              {member.customPermissions ? "Custom permissions" : ROLE_DESCRIPTION[member.role]}
            </span>
          </span>
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
                <div className="absolute right-0 top-7 z-10 w-48 max-w-[calc(100vw-1.5rem)] rounded-none border border-border bg-background p-1 shadow-lg">
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
              onChange={(e) => setLocalRole(e.target.value as ProjectRole)}
              className={`${fieldClass} w-40`}
            >
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">{ROLE_DESCRIPTION[role]}</span>
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
