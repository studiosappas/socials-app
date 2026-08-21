import { Modal } from "../../../modal";
import { Skeleton } from "@/components/ui/skeleton";

// Same reasoning as the sibling posts/[postId]/loading.tsx: getStoryPageData
// runs 7+ sequential Supabase queries with no streaming boundary of its own,
// so without this file nothing appeared here at all until that whole chain
// resolved. This can't shorten that fetch, but the modal's own chrome now
// appears the instant a story is opened, with content streaming in behind it.
export default function StoryEditorLoading() {
  return (
    <Modal>
      <div className="flex animate-pulse flex-col gap-4">
        <Skeleton className="h-4 w-1/3" />
        <div className="flex gap-2 overflow-hidden">
          <Skeleton className="aspect-[9/16] w-24 shrink-0" />
          <Skeleton className="aspect-[9/16] w-24 shrink-0" />
          <Skeleton className="aspect-[9/16] w-24 shrink-0" />
        </div>
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-20 w-full" />
      </div>
    </Modal>
  );
}
