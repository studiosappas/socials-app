import { createClient } from "@/lib/supabase/server";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import { canEditContent, hasPagePermission } from "@/lib/role-permissions";
import { AssetBoard, type AssetCollectionItem } from "./asset-board";
import { AccessRestricted } from "../access-restricted";

export default async function AssetsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("project_members")
    .select("role, custom_permissions")
    .eq("project_id", projectId)
    .eq("user_id", user!.id)
    .single();

  if (!membership || !hasPagePermission(membership.role, membership.custom_permissions, "assets")) {
    return <AccessRestricted />;
  }

  // Ordinary content-editing capability, not "genuinely privileged" -- see
  // grid/page.tsx's identical comment.
  const canManage = canEditContent(membership.role);

  const { data: rows } = await supabase
    .from("asset_collections")
    .select("id, folder_url, provider, name, asset_type, notes, cover_storage_path, ai_status, last_synced_at, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const coverPaths = (rows ?? []).map((r) => r.cover_storage_path).filter((p): p is string => Boolean(p));
  const urlByPath = await getCachedSignedUrls(supabase, "project-media", coverPaths);

  const collections: AssetCollectionItem[] = (rows ?? []).map((r) => ({
    id: r.id,
    folderUrl: r.folder_url,
    provider: r.provider,
    name: r.name,
    assetType: r.asset_type,
    notes: r.notes,
    coverUrl: r.cover_storage_path ? urlByPath.get(r.cover_storage_path) ?? null : null,
    aiStatus: r.ai_status,
    createdAt: r.created_at,
    lastSyncedAt: r.last_synced_at,
  }));

  return <AssetBoard projectId={projectId} collections={collections} canManage={canManage} />;
}
