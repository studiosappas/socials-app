"use server";

import { createClient } from "@/lib/supabase/server";
import { generateServerThumbnail } from "@/lib/server-thumbnail";

// Runs entirely through the normal, already-authenticated app session (the
// same createClient() every other action uses) -- deliberately NOT the
// service-role key. That means it's bound by the exact same RLS rules as
// every other action in the app: it can only ever touch projects the
// logged-in admin is themselves an owner/admin member of. That's the
// tradeoff for never needing to hand a service-role key to anyone -- if a
// project doesn't show up here, the fix is adding this account as a member
// of it (a normal, safe in-app action), not widening this tool's access.
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");
  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) throw new Error("This tool is restricted to site admins.");
  return supabase;
}

type ManagedProject = { id: string; name: string };

async function getManagedProjects(supabase: Awaited<ReturnType<typeof createClient>>): Promise<ManagedProject[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("project_members")
    .select("project_id, role, projects(name)")
    .eq("user_id", user!.id)
    .in("role", ["owner", "admin"]);
  return (data ?? []).map((r) => ({
    id: r.project_id as string,
    name: (r.projects as { name: string | null } | null)?.name ?? "Untitled project",
  }));
}

type EligibleAsset = { id: string; storagePath: string; projectId: string };

// Fetched broadly (not filtered on `archived` in the query itself) and
// filtered in JS -- same isolation reasoning used everywhere else in this
// codebase (grid/page.tsx, getPostPageData): `archived` is a newer column,
// and a plain .eq()/.is() filter on it in the main select would fail the
// WHOLE query the instant it's missing on a not-yet-migrated database,
// rather than just not excluding archived assets yet.
async function getEligibleImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectIds: string[],
  excludeIds: string[],
): Promise<EligibleAsset[]> {
  if (projectIds.length === 0) return [];
  const { data } = await supabase
    .from("media_assets")
    .select("id, storage_path, project_id, archived")
    .in("project_id", projectIds)
    .eq("media_type", "image")
    .is("thumbnail_storage_path", null);
  const excludeSet = new Set(excludeIds);
  return (data ?? [])
    .filter((r) => !r.archived && !excludeSet.has(r.id))
    .map((r) => ({ id: r.id, storagePath: r.storage_path, projectId: r.project_id }));
}

export type ThumbnailBackfillStatus = {
  totalMissing: number;
  byProject: { projectId: string; projectName: string; missing: number }[];
};

export async function getThumbnailBackfillStatus(): Promise<ThumbnailBackfillStatus> {
  const supabase = await requireAdmin();
  const projects = await getManagedProjects(supabase);
  const eligible = await getEligibleImages(
    supabase,
    projects.map((p) => p.id),
    [],
  );
  const missingByProject = new Map<string, number>();
  for (const asset of eligible) {
    missingByProject.set(asset.projectId, (missingByProject.get(asset.projectId) ?? 0) + 1);
  }
  const byProject = projects
    .map((p) => ({ projectId: p.id, projectName: p.name, missing: missingByProject.get(p.id) ?? 0 }))
    .filter((p) => p.missing > 0)
    .sort((a, b) => b.missing - a.missing);
  return { totalMissing: eligible.length, byProject };
}

export type ThumbnailBackfillBatchResult = {
  processed: number;
  succeeded: { id: string; projectName: string; originalBytes: number; thumbnailBytes: number }[];
  failed: { id: string; projectName: string; reason: string }[];
  remaining: number;
};

// Restart-safe by construction: every call re-queries "still missing a
// thumbnail" fresh (see getEligibleImages) rather than working off a fixed
// offset/cursor, so if the run is interrupted (tab closed, network drop),
// simply starting again later picks up exactly where it left off -- no
// state to lose. excludeIds is how THIS run keeps moving past an
// individual image that fails every time it's attempted (an undecodable
// file, say) without getting stuck retrying it forever; it's kept
// client-side for the duration of one run, not persisted, which is fine --
// a failed image just gets one harmless extra retry if a new run starts
// later. Never touches storage_path (the original), never touches posts/
// grid_slots/cover_transform -- the only write is media_assets.
// thumbnail_storage_path on success.
export async function runThumbnailBackfillBatch(
  batchSize: number,
  excludeIds: string[],
): Promise<ThumbnailBackfillBatchResult> {
  const supabase = await requireAdmin();
  const projects = await getManagedProjects(supabase);
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  const eligible = await getEligibleImages(
    supabase,
    projects.map((p) => p.id),
    excludeIds,
  );
  const batch = eligible.slice(0, Math.max(1, batchSize));

  const succeeded: ThumbnailBackfillBatchResult["succeeded"] = [];
  const failed: ThumbnailBackfillBatchResult["failed"] = [];

  for (const asset of batch) {
    const projectName = projectNameById.get(asset.projectId) ?? "Unknown project";
    const result = await generateServerThumbnail(supabase, "project-media", asset.storagePath, asset.projectId);
    if (!result.ok) {
      failed.push({ id: asset.id, projectName, reason: result.reason });
      continue;
    }
    const { error } = await supabase
      .from("media_assets")
      .update({ thumbnail_storage_path: result.path })
      .eq("id", asset.id);
    if (error) {
      failed.push({ id: asset.id, projectName, reason: error.message });
      continue;
    }
    succeeded.push({
      id: asset.id,
      projectName,
      originalBytes: result.originalBytes,
      thumbnailBytes: result.thumbnailBytes,
    });
  }

  return {
    processed: batch.length,
    succeeded,
    failed,
    remaining: Math.max(0, eligible.length - batch.length),
  };
}
