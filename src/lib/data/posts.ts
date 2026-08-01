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

  const allPaths = new Set<string>();
  for (const asset of mediaAssets ?? []) allPaths.add(asset.storage_path);
  for (const pa of postAssets ?? []) {
    const media = pa.media_assets as { storage_path: string } | null;
    if (media) allPaths.add(media.storage_path);
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
    return {
      postAssetId: pa.id,
      mediaAssetId: media?.id ?? "",
      url: media ? urlByPath.get(media.storage_path) ?? null : null,
      mediaType: (media?.media_type as "image" | "video") ?? "image",
    };
  });

  const mediaLibrary: MediaLibraryItem[] = (mediaAssets ?? []).map((asset) => ({
    id: asset.id,
    url: urlByPath.get(asset.storage_path) ?? null,
    mediaType: asset.media_type,
  }));

  const postLinks: PostLinkItem[] = (links ?? []).map((l) => ({
    id: l.id,
    url: l.url,
    label: l.label,
  }));

  return { post, assets, links: postLinks, mediaLibrary, canManage };
}
