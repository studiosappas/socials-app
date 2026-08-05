import { createClient } from "@/lib/supabase/server";
import type { MediaLibraryItem } from "@/app/projects/[projectId]/grid/grid-board";
import type { PostAssetItem, PostLinkItem } from "@/app/projects/[projectId]/posts/[postId]/post-editor";
import type { PostStatus, PostType } from "@/types/database";

const SIGNED_URL_TTL_SECONDS = 3600;

export type PostPageData = {
  post: {
    id: string;
    post_type: PostType;
    caption: string;
    notes: string;
    scheduled_date: string | null;
    scheduled_time: string | null;
    status: PostStatus;
  };
  assets: PostAssetItem[];
  links: PostLinkItem[];
  mediaLibrary: MediaLibraryItem[];
  canManage: boolean;
};

export async function getPostPageData(
  projectId: string,
  postId: string,
): Promise<PostPageData | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user!.id)
    .single();

  const canManage = membership?.role === "owner" || membership?.role === "admin";

  const { data: post } = await supabase
    .from("posts")
    .select("id, post_type, caption, notes, scheduled_date, status")
    .eq("id", postId)
    .single();

  if (!post) return null;

  // Isolated from the select above -- scheduled_time is a new column that
  // may not exist yet on a not-yet-migrated database (same reasoning as
  // preview_storage_path/annotation_json below).
  const { data: timeRow } = await supabase
    .from("posts")
    .select("scheduled_time")
    .eq("id", postId)
    .maybeSingle();

  const { data: postAssets } = await supabase
    .from("post_assets")
    .select("id, position, media_assets(id, storage_path, media_type)")
    .eq("post_id", postId)
    .order("position");

  const { data: links } = await supabase
    .from("post_links")
    .select("id, url, label")
    .eq("post_id", postId);

  const { data: mediaAssets } = await supabase
    .from("media_assets")
    .select("id, storage_path, media_type")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  // Fetched independently, same reasoning as Grid's cover_transform/
  // preview_storage_path isolation in grid-data.ts: preview_storage_path/
  // annotation_json are newer columns that may not exist yet on a
  // not-yet-migrated database, and PostgREST fails an ENTIRE select if any
  // requested column is missing -- folding these into the selects above
  // once broke the whole post editor (zero assets shown) rather than just
  // losing edit-preview data, until this was isolated the same way Grid
  // already handles it.
  const allMediaIds = new Set<string>();
  for (const pa of postAssets ?? []) {
    const media = pa.media_assets as { id: string } | null;
    if (media) allMediaIds.add(media.id);
  }
  for (const asset of mediaAssets ?? []) allMediaIds.add(asset.id);
  const { data: previewRows } = allMediaIds.size
    ? await supabase
        .from("media_assets")
        .select("id, preview_storage_path, annotation_json")
        .in("id", Array.from(allMediaIds))
    : { data: [] };
  const previewByMediaId = new Map<string, { previewPath: string | null; annotationJson: object | null }>();
  for (const r of previewRows ?? []) {
    previewByMediaId.set(r.id, {
      previewPath: (r as { preview_storage_path: string | null }).preview_storage_path ?? null,
      annotationJson: (r as { annotation_json: object | null }).annotation_json ?? null,
    });
  }

  const allPaths = new Set<string>();
  for (const asset of mediaAssets ?? []) {
    allPaths.add(asset.storage_path);
    const preview = previewByMediaId.get(asset.id)?.previewPath;
    if (preview) allPaths.add(preview);
  }
  for (const pa of postAssets ?? []) {
    const media = pa.media_assets as { id: string; storage_path: string } | null;
    if (media) {
      allPaths.add(media.storage_path);
      const preview = previewByMediaId.get(media.id)?.previewPath;
      if (preview) allPaths.add(preview);
    }
  }

  const pathList = Array.from(allPaths);
  const { data: signedUrls } = pathList.length
    ? await supabase.storage.from("project-media").createSignedUrls(pathList, SIGNED_URL_TTL_SECONDS)
    : { data: [] };

  const urlByPath = new Map<string, string>();
  for (const entry of signedUrls ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  const assets: PostAssetItem[] = (postAssets ?? []).map((pa) => {
    const media = pa.media_assets as { id: string; storage_path: string; media_type: string } | null;
    const originalUrl = media ? urlByPath.get(media.storage_path) ?? null : null;
    const preview = media ? previewByMediaId.get(media.id) : undefined;
    return {
      postAssetId: pa.id,
      mediaAssetId: media?.id ?? "",
      // Wherever this asset is displayed shows the edited preview once one
      // exists -- editing "the cover image" is what should make the edit
      // show up on the Grid slot too, same idea as Brief's attachments.
      url: preview?.previewPath ? urlByPath.get(preview.previewPath) ?? originalUrl : originalUrl,
      originalUrl,
      annotationJson: preview?.annotationJson ?? null,
      mediaType: (media?.media_type as "image" | "video") ?? "image",
    };
  });

  const mediaLibrary: MediaLibraryItem[] = (mediaAssets ?? []).map((asset) => {
    const preview = previewByMediaId.get(asset.id)?.previewPath;
    return {
      id: asset.id,
      url: preview ? urlByPath.get(preview) ?? urlByPath.get(asset.storage_path) ?? null : urlByPath.get(asset.storage_path) ?? null,
      mediaType: asset.media_type,
    };
  });

  const postLinks: PostLinkItem[] = (links ?? []).map((l) => ({
    id: l.id,
    url: l.url,
    label: l.label,
  }));

  return {
    post: { ...post, scheduled_time: timeRow?.scheduled_time ?? null },
    assets,
    links: postLinks,
    mediaLibrary,
    canManage,
  };
}
