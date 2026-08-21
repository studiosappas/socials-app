"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateServerThumbnail } from "@/lib/server-thumbnail";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// NOTE: no maxDuration export here -- a "use server" file may only export
// async functions (plus type-only exports, which are erased); exporting a
// plain const like maxDuration breaks the whole module's exports (caught
// via a real local build failure: "the export ... was not found in
// module ... the module has no exports at all"). runThumbnailBackfillBatch
// stays on Vercel's default function duration for now -- batch size is
// kept conservative (10 images/call) specifically because of this, and
// duration can be revisited once the page itself is confirmed loading.

// This tool needs to see every project in the system, not just ones the
// logged-in admin happens to be a member of (some were created from other
// accounts entirely) -- ordinary RLS can't do that, so the actual data
// operations below run through the service-role client instead, which
// bypasses RLS completely.
//
// That means THIS check is the only thing standing between "any logged-in
// user" and full cross-project read/write access, so it deliberately runs
// on the normal, session-bound client (the real cookie-based identity of
// whoever is making the request) -- never on the service-role client
// itself, which has no concept of "who's asking" at all. The service-role
// client is only ever constructed and returned after this passes.
async function requireAdminServiceClient(): Promise<SupabaseClient<Database>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");
  const { data: profile, error } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (error) throw new Error(`Couldn't check admin status: ${error.message}`);
  if (!profile?.is_admin) throw new Error("This tool is restricted to site admins.");
  return createServiceRoleClient();
}

type ProjectInfo = { id: string; name: string };

// Every project in the database, regardless of who created it or whether
// the logged-in admin is a member -- only possible because `supabase` here
// is the service-role client, which bypasses the project_members-based RLS
// every other query in this app is bound by.
async function getAllProjects(supabase: SupabaseClient<Database>): Promise<ProjectInfo[]> {
  const { data, error } = await supabase.from("projects").select("id, name");
  if (error) throw new Error(`Couldn't load projects: ${error.message}`);
  return (data ?? []).map((p) => ({ id: p.id, name: p.name ?? "Untitled project" }));
}

type EligibleAsset = { id: string; storagePath: string; projectId: string };

// Fetched broadly (not filtered on `archived` in the query itself) and
// filtered in JS -- same isolation reasoning used everywhere else in this
// codebase (grid/page.tsx, getPostPageData): `archived` is a newer column,
// and a plain .eq()/.is() filter on it in the main select would fail the
// WHOLE query the instant it's missing on a not-yet-migrated database,
// rather than just not excluding archived assets yet.
async function getEligibleImages(
  supabase: SupabaseClient<Database>,
  excludeIds: string[],
): Promise<EligibleAsset[]> {
  const { data, error } = await supabase
    .from("media_assets")
    .select("id, storage_path, project_id, archived")
    .eq("media_type", "image")
    .is("thumbnail_storage_path", null);
  if (error) throw new Error(`Couldn't load media assets: ${error.message}`);
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
  const supabase = await requireAdminServiceClient();
  const projects = await getAllProjects(supabase);
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  const eligible = await getEligibleImages(supabase, []);

  const missingByProject = new Map<string, number>();
  for (const asset of eligible) {
    missingByProject.set(asset.projectId, (missingByProject.get(asset.projectId) ?? 0) + 1);
  }
  const byProject = Array.from(missingByProject.entries())
    .map(([projectId, missing]) => ({
      projectId,
      projectName: projectNameById.get(projectId) ?? "Unknown project",
      missing,
    }))
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
  const supabase = await requireAdminServiceClient();
  const projects = await getAllProjects(supabase);
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  const eligible = await getEligibleImages(supabase, excludeIds);
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
