import { notFound } from "next/navigation";
import { getPostPageData } from "@/lib/data/posts";
import { PostEditor } from "./post-editor";

export default async function PostPage({
  params,
}: {
  params: Promise<{ projectId: string; postId: string }>;
}) {
  const { projectId, postId } = await params;
  const data = await getPostPageData(projectId, postId);

  if (!data) notFound();

  return (
    <PostEditor
      projectId={projectId}
      post={data.post}
      assets={data.assets}
      links={data.links}
      mediaLibrary={data.mediaLibrary}
      canManage={data.canManage}
      currentUserId={data.currentUserId}
      members={data.members}
      customFonts={data.customFonts}
    />
  );
}
