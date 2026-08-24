import { notFound } from "next/navigation";
import { getPostCoreData, getPostMediaLibrary } from "@/lib/data/posts";
import { PostEditor } from "../../../posts/[postId]/post-editor";
import { Modal } from "../../../modal";

export default async function InterceptedPostPage({
  params,
}: {
  params: Promise<{ projectId: string; postId: string }>;
}) {
  const { projectId, postId } = await params;
  const data = await getPostCoreData(projectId, postId);

  if (!data) notFound();

  // Not awaited -- the whole-project media library (for "Add from library"
  // and Replace-asset) is the one part of the old single fetch that scaled
  // with total project media count, not with this post's own asset count.
  // Kicked off here so it's already in flight, but the primary editor
  // renders as soon as `data` resolves; only the two actual consumers in
  // PostEditor suspend on this promise, each in their own boundary.
  const mediaLibraryPromise = getPostMediaLibrary(projectId);

  return (
    <Modal>
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
        hideBackLink
      />
    </Modal>
  );
}
