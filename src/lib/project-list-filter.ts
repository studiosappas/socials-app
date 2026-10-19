// Pure filtering/ordering for every "which of my projects" list in the app --
// the Projects page, the top nav's project switcher, the To-Do page's
// project filter, the default landing page, and Account > Archived
// Projects. Kept free of Supabase/Next imports so it runs under plain
// `node --experimental-strip-types` (see project-list-filter.test.ts).
//
// Before this existed, the Projects page and the switcher each ran their own
// query with their own rules (only the page filtered `archived`; each sorted
// differently), so the two lists disagreed and archived projects leaked into
// the switcher. Everything now derives from the same entries + these rules.

import type { ProjectRole } from "../types/database";

export type ProjectListEntry = {
  id: string;
  name: string;
  profilePhotoPath: string | null;
  createdAt: string;
  role: ProjectRole;
  customPermissions: string[] | null;
};

// Archive/restore is gated to the same roles as RLS's "Owners/admins can
// update their project" policy -- the archived list only ever shows projects
// the viewer could actually restore.
export function canManageArchive(role: ProjectRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

// Strict on purpose: a project counts as active only when its `archived`
// flag was positively read as false. A project with no flag at all (deleted
// between the two reads, or hidden by RLS) is excluded rather than assumed
// active -- never show something whose state we couldn't confirm.
export function selectActiveProjects<T extends Pick<ProjectListEntry, "id" | "createdAt">>(
  entries: T[],
  archivedById: Map<string, boolean>,
  lastVisitedById: Map<string, string | null>,
): T[] {
  return (
    entries
      .filter((e) => archivedById.get(e.id) === false)
      // Newest-created first as the base order (the order for projects this
      // user has never visited), then most-recently-visited first on top.
      // Array.prototype.sort is stable, so never-visited ties keep the
      // created-date order from the first pass.
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .sort((a, b) => {
        const av = lastVisitedById.get(a.id);
        const bv = lastVisitedById.get(b.id);
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return av < bv ? 1 : av > bv ? -1 : 0;
      })
  );
}

export function selectArchivedManageableProjects<T extends Pick<ProjectListEntry, "id" | "name" | "role">>(
  entries: T[],
  archivedById: Map<string, boolean>,
): T[] {
  return entries
    .filter((e) => archivedById.get(e.id) === true && canManageArchive(e.role))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
