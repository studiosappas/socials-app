import { Modal } from "../../../modal";
import { Skeleton } from "@/components/ui/skeleton";

// Same reasoning as the sibling posts/[postId]/loading.tsx: without this
// file, nothing appears here at all until getStoryPageData resolves. This
// can't shorten that fetch, but the modal's own chrome now appears the
// instant a story is opened, with content streaming in behind it.
// (getStoryPageData is itself already parallelized into two waves rather
// than the fully sequential chain this comment used to describe -- see
// lib/data/stories.ts.)
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
