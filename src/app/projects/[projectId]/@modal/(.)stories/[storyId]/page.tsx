import { notFound } from "next/navigation";
import { getStoryPageData } from "@/lib/data/stories";
import { StoryEditor } from "../../../stories/[storyId]/story-editor";
import { Modal } from "../../../modal";

export default async function InterceptedStoryPage({
  params,
}: {
  params: Promise<{ projectId: string; storyId: string }>;
}) {
  const { projectId, storyId } = await params;
  const data = await getStoryPageData(projectId, storyId);

  if (!data) notFound();

  return (
    <Modal>
      <StoryEditor
        projectId={projectId}
        story={data.story}
        frames={data.frames}
        links={data.links}
        mediaLibrary={data.mediaLibrary}
        canManage={data.canManage}
        role={data.role}
        currentUserId={data.currentUserId}
        members={data.members}
        hideBackLink
      />
    </Modal>
  );
}
