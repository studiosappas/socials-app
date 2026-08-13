import { notFound } from "next/navigation";
import { getStoryPageData } from "@/lib/data/stories";
import { StoryEditor } from "./story-editor";

export default async function StoryPage({
  params,
}: {
  params: Promise<{ projectId: string; storyId: string }>;
}) {
  const { projectId, storyId } = await params;
  const data = await getStoryPageData(projectId, storyId);

  if (!data) notFound();

  return (
    <StoryEditor
      projectId={projectId}
      story={data.story}
      frames={data.frames}
      links={data.links}
      mediaLibrary={data.mediaLibrary}
      canManage={data.canManage}
      currentUserId={data.currentUserId}
      members={data.members}
    />
  );
}
