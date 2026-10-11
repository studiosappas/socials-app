import { createClient } from "@/lib/supabase/server";
import { canDeleteReviewLink } from "@/lib/role-permissions";
import type { ProjectRole } from "@/types/database";

export type ShareLinkItem = {
  id: string;
  token: string;
  title: string;
  createdAt: string;
  itemCount: number;
  // Whether THIS viewer may delete this particular link: an owner/admin any
  // link, a Member only one they created. Resolved server-side (see
  // resolveShareLinkPermissions) so the creator's user id never needs to
  // reach the browser.
  canDelete: boolean;
};

// What getShareLinksData returns before the viewer's own role/id are known
// -- both pages fetch it in the same wave as auth.getUser().
export type ShareLinkRow = Omit<ShareLinkItem, "canDelete"> & { createdBy: string | null };

export type ShareLinksData = {
  links: ShareLinkRow[];
  tableMissing: boolean;
};

// Shared by both Grid's and Stories' Share menu -- just the list of
// already-created links (for "Manage Review Links"). Creating a new one no
// longer needs a separate picker fetch here -- selection happens inline on
// the board itself, using data the board already has (grid-board.tsx/
// stories-board.tsx's own rows/stories props).
export async function getShareLinksData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<ShareLinksData> {
  // Isolated: share_links/share_link_items are a newer table pair that may
  // not exist yet on a not-yet-migrated database. A missing table degrades
  // to an empty list + a clear message in the dialog instead of failing the
  // whole page.
  const { data: linkRows, error: linksError } = await supabase
    .from("share_links")
    .select("id, token, title, created_at, created_by")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const linkIds = (linkRows ?? []).map((l) => l.id);
  const { data: itemRows } = linkIds.length
    ? await supabase.from("share_link_items").select("share_link_id").in("share_link_id", linkIds)
    : { data: [] };

  const countByLink = new Map<string, number>();
  for (const item of itemRows ?? []) {
    countByLink.set(item.share_link_id, (countByLink.get(item.share_link_id) ?? 0) + 1);
  }

  const links: ShareLinkRow[] = (linkRows ?? []).map((l) => ({
    id: l.id,
    token: l.token,
    title: l.title,
    createdAt: l.created_at,
    itemCount: countByLink.get(l.id) ?? 0,
    createdBy: (l.created_by as string | null) ?? null,
  }));

  return { links, tableMissing: Boolean(linksError) };
}

// Turns the raw rows into what the browser gets: per-link `canDelete` for
// this viewer, with `createdBy` dropped.
export function resolveShareLinkPermissions(
  links: ShareLinkRow[],
  role: ProjectRole | null | undefined,
  userId: string | null | undefined,
): ShareLinkItem[] {
  return links.map(({ createdBy, ...link }) => ({
    ...link,
    canDelete: canDeleteReviewLink(role, Boolean(userId) && createdBy === userId),
  }));
}
