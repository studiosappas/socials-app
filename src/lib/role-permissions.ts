import type { ProjectRole } from "@/types/database";

// The complete set of project pages Team & Permissions can grant/restrict --
// one key per destination in nav-project-menu.tsx's PROJECT_PAGES, plus
// "settings" (which gates every /settings/* sub-page uniformly, not just
// the top-level Project Information one -- there's only ever been a single
// "Settings" checkbox, never one per sub-page). Adding a page here also
// requires wiring its server-side check into that page and into
// nav-project-menu.tsx's filtering -- see AccessRestricted's call sites.
export const PERMISSION_PAGE_KEYS = [
  "overview",
  "grid",
  "calendar",
  "stories",
  "brief",
  "assets",
  "settings",
] as const;
export type PermissionPageKey = (typeof PERMISSION_PAGE_KEYS)[number];

export const PERMISSION_PAGE_LABEL: Record<PermissionPageKey, string> = {
  overview: "Overview",
  grid: "Grid",
  calendar: "Calendar",
  stories: "Content",
  brief: "Brief",
  assets: "Assets",
  settings: "Settings",
};

// Roles selectable when inviting someone or adding a person during project
// creation -- 'owner' only ever exists via the on_project_created trigger or
// transferOwnership, and 'designer' is legacy (kept only so existing rows
// still render sensibly, never offered for a new membership). The single
// list every invite/create surface in the app reads from -- previously
// duplicated three ways (members.ts's VALID_ROLES, team-panel.tsx's
// INVITE_ROLE_OPTIONS, create-project-button.tsx's own ROLE_OPTIONS).
export const INVITABLE_ROLES: ProjectRole[] = ["admin", "editor", "viewer", "client"];

// Display label per role. 'editor' is the role Flow:er's product language
// now calls "Member" everywhere -- the stored enum value is unchanged
// (renaming it would mean migrating every existing project_members row for
// a label-only change), only its display text moves. 'designer' keeps its
// own historical "Editor" label rather than also becoming "Member": it's
// legacy/unassignable, and folding it into the current Member label would
// misrepresent old rows as having been given today's Member semantics.
export const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: "Owner",
  admin: "Admin",
  designer: "Editor",
  editor: "Member",
  viewer: "Viewer",
  client: "Client",
};

// Short, product-facing summary of what a role means -- shown next to the
// role in Team & Permissions and as a one-line hint under the role select in
// Create New Project. Deliberately not a permission list.
export const ROLE_DESCRIPTION: Record<ProjectRole, string> = {
  owner: "Full ownership",
  admin: "Full workspace management",
  designer: "Workspace access",
  editor: "Workspace access",
  viewer: "Workspace access",
  client: "Review access",
};

const ALL_PAGES: PermissionPageKey[] = [...PERMISSION_PAGE_KEYS];
const WORKSPACE_PAGES: PermissionPageKey[] = ["overview", "grid", "calendar", "stories", "brief", "assets"];

// THE canonical role -> default permission-page-key preset. Every place a
// role gets applied to a member -- Create New Project's People list, Invite
// Member, and "apply this role's defaults" on a role change -- resolves
// through this one table, and every page's own server-side access check
// resolves an unset (null) custom_permissions through it too. There is no
// second copy of this mapping anywhere else in the app.
//
// Owner isn't really "a preset" here -- getEffectivePermissions/
// hasPagePermission below special-case it to always resolve to every page
// regardless of this table's owner entry, so a role change or a stray
// custom_permissions value can never lock an owner out of their own
// project. It's still listed for completeness (e.g. so ROLE_DEFAULT_
// PERMISSIONS[role] is total over ProjectRole without an `undefined` case).
export const ROLE_DEFAULT_PERMISSIONS: Record<ProjectRole, PermissionPageKey[]> = {
  owner: ALL_PAGES,
  admin: ALL_PAGES,
  editor: WORKSPACE_PAGES,
  designer: WORKSPACE_PAGES,
  viewer: WORKSPACE_PAGES,
  // Intentionally narrow -- Client is a reviewer, not a workspace operator.
  // Grid and Content (stories) are where the Review/comments thread lives
  // (Post Editor and Story Editor respectively, via the shared
  // ItemComments component, which has no role restriction of its own), so
  // those are the only two pages a Client gets by default. canManage (still
  // owner/admin only, unchanged by this file) already hides every edit
  // control on both pages regardless of role -- this only ever grants a
  // Client the ability to open and comment, never to manage.
  //
  // NOTE (found during this pass, not fixed here -- see the accompanying
  // report): the in-app Approval Status control on both editors is also
  // canManage-gated (owner/admin only), so an authenticated Client cannot
  // actually submit an approval today despite having page access to it --
  // only the separate anonymous token-based /preview/[token] review flow
  // currently works for that specific action. Wiring the dormant
  // set_post_review_status/set_story_review_status DB functions (already
  // scoped to project_role = 'client', already restricted to
  // 'approved'/'changes_requested') into the editor UI would close this,
  // but touches post-editor.tsx/story-editor.tsx and is left as a
  // follow-up rather than folded into this already-large pass.
  client: ["grid", "stories"],
};

// custom_permissions === null means "use this member's role's CURRENT
// default" -- resolved dynamically here, never baked into the stored row at
// invite time. Tuning ROLE_DEFAULT_PERMISSIONS later therefore takes effect
// immediately for everyone still on the default, with nothing to
// backfill/migrate. A non-null array is an explicit, persisted override
// that stays exactly as customized (via Team & Permissions, or an explicit
// "apply this role's defaults" reset) until someone edits it again.
export function getEffectivePermissions(
  role: ProjectRole,
  customPermissions: string[] | null | undefined,
): PermissionPageKey[] {
  if (role === "owner") return ALL_PAGES;
  // Only null/undefined means "use the role's default" -- a non-null but
  // EMPTY array is a deliberate "no pages at all" override (a manager can
  // uncheck every box in Team & Permissions), not the same as never having
  // set an override, so it must not silently fall back to the preset.
  if (customPermissions != null) {
    const known = new Set<string>(PERMISSION_PAGE_KEYS);
    return customPermissions.filter((p): p is PermissionPageKey => known.has(p));
  }
  return ROLE_DEFAULT_PERMISSIONS[role] ?? [];
}

export function hasPagePermission(
  role: ProjectRole,
  customPermissions: string[] | null | undefined,
  page: PermissionPageKey,
): boolean {
  return getEffectivePermissions(role, customPermissions).includes(page);
}

// ACTION CAPABILITY, distinct from PAGE ACCESS above: whether this role can
// perform ordinary day-to-day content edits (Grid/Calendar/Brief/Content/
// Assets writes) once they've already reached one of those pages. Matches
// exactly the roles the corresponding RLS policies now allow (see
// supabase/fix_project_role_permission_presets.sql's Section 2) -- 'editor'
// ("Member") joins 'owner'/'admin' here, but 'viewer' and legacy 'designer'
// deliberately do NOT, and neither does 'client' (whose own, separate,
// narrower capability is canSubmitClientReview below).
//
// This is the single source every content page's own `canManage` value now
// computes from (grid/page.tsx, calendar/page.tsx, brief/page.tsx,
// stories/page.tsx, assets/page.tsx, lib/data/posts.ts, lib/data/stories.ts)
// -- deliberately NOT plugged into settings-access.ts's own canManage/isOwner,
// which gate genuinely privileged operations (Team & Permissions, project
// settings, Danger Zone) that stay owner/admin-only regardless of this.
export function canEditContent(role: ProjectRole | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "editor";
}

// Client's own narrow capability: submitting Approval Status through the
// dedicated set_post_review_status/set_story_review_status DB functions
// (already SECURITY DEFINER, already self-restricted to project_role =
// 'client', already restricted to 'approved'/'changes_requested' -- this
// helper doesn't grant anything by itself, it only decides whether the UI
// shows the client-safe review control at all).
export function canSubmitClientReview(role: ProjectRole | null | undefined): boolean {
  return role === "client";
}
