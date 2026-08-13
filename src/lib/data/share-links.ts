import { createClient } from "@/lib/supabase/server";

export type ShareLinkItem = {
  id: string;
  token: string;
  title: string;
  createdAt: string;
  itemCount: number;
};

export type ShareLinksData = {
  links: ShareLinkItem[];
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
    .select("id, token, title, created_at")
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

  const links: ShareLinkItem[] = (linkRows ?? []).map((l) => ({
    id: l.id,
    token: l.token,
    title: l.title,
    createdAt: l.created_at,
    itemCount: countByLink.get(l.id) ?? 0,
  }));

  return { links, tableMissing: Boolean(linksError) };
}
