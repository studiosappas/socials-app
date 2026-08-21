import { PageLoading } from "@/components/ui/page-loading";

// The full-page fallback route (direct navigation/hard reload) -- the
// intercepted-modal version at @modal/(.)posts/[postId]/loading.tsx keeps
// its own richer <Modal>-shelled loader, since that's a soft navigation
// where the modal chrome itself is what needs to feel instant. This one
// never has a post caption to show yet, only that it's a post.
export default function PostEditorPageLoading() {
  return <PageLoading title="Post" />;
}
