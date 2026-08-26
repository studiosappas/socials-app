import { notFound } from "next/navigation";
import { getPostCoreData, getPostMediaLibrary } from "@/lib/data/posts";
import { PostEditor } from "./post-editor";

export default async function PostPage({
  params,
}: {
  params: Promise<{ projectId: string; postId: string }>;
}) {
  const { projectId, postId } = await params;
  const data = await getPostCoreData(projectId, postId);

  if (!data) notFound();

  // See the intercepted-modal route's identical comment -- not awaited on
  // purpose, so the primary editor doesn't wait on the whole project's
  // media library.
  const mediaLibraryPromise = getPostMediaLibrary(projectId);

  return (
    <PostEditor
      projectId={projectId}
      post={data.post}
      assets={data.assets}
      links={data.links}
      mediaLibraryPromise={mediaLibraryPromise}
      canManage={data.canManage}
      role={data.role}
      currentUserId={data.currentUserId}
      members={data.members}
      customFonts={data.customFonts}
      dateFormat={data.dateFormat}
    />
  );
}
