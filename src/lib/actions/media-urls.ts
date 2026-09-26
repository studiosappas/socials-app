"use server";

import { createClient } from "@/lib/supabase/server";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";

// Recovery path for an on-screen image whose signed URL stopped working
// after the page rendered -- see src/components/recoverable-img.tsx. The
// server-side cache guarantees every URL it hands out has >= 30 minutes of
// validity left, but a page (or a restored mobile tab, or a client-router
// back/forward entry) can easily outlive that; before this existed, the
// only recovery was a full manual refresh.
//
// Resolves the EXACT same storage path the failing <img> was already
// showing -- never a different variant or a different asset -- so this can
// only ever re-sign what the user was already looking at, never swap in
// something else.
//
// Authorization is the same as the page render that produced the original
// URL:
// - every path must sit under a project's own prefix (`${projectId}/...`,
//   the shape every upload path in this app uses -- see newStoragePath),
// - the caller must be a member of that project (RLS-scoped lookup), and
// - signing itself runs with the caller's own client, so Storage's own RLS
//   still applies on top.
const MAX_PATHS_PER_CALL = 100;
const PROJECT_MEDIA_BUCKET = "project-media";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function refreshSignedMediaUrls(paths: string[]): Promise<Record<string, string>> {
  if (!Array.isArray(paths) || paths.length === 0) return {};
  const byProject = new Map<string, string[]>();
  for (const path of paths.slice(0, MAX_PATHS_PER_CALL)) {
    if (typeof path !== "string" || path.length > 512 || path.includes("..")) continue;
    const projectId = path.split("/")[0];
    if (!UUID_RE.test(projectId)) continue;
    const list = byProject.get(projectId);
    if (list) list.push(path);
    else byProject.set(projectId, [path]);
  }
  if (byProject.size === 0) return {};

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return {};

  const { data: memberships } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("user_id", user.id)
    .in("project_id", Array.from(byProject.keys()));
  const allowedProjects = new Set((memberships ?? []).map((m) => m.project_id));

  const allowedPaths: string[] = [];
  for (const [projectId, projectPaths] of byProject) {
    if (allowedProjects.has(projectId)) allowedPaths.push(...projectPaths);
  }
  if (allowedPaths.length === 0) return {};

  const urlByPath = await getCachedSignedUrls(supabase, PROJECT_MEDIA_BUCKET, allowedPaths);
  return Object.fromEntries(urlByPath);
}
