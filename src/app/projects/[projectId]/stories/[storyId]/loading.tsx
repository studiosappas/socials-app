import { PageLoading } from "@/components/ui/page-loading";

// The full-page fallback route (direct navigation/hard reload) -- the
// intercepted-modal version at @modal/(.)stories/[storyId]/loading.tsx
// keeps its own richer <Modal>-shelled loader. This one never has a story
// name to show yet, only that it's a story.
export default function StoryEditorPageLoading() {
  return <PageLoading title="Story" />;
}
