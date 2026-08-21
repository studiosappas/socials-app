import { Skeleton } from "@/components/ui/skeleton";

// Full-page fallback for a direct navigation/hard refresh to this route
// (the common case is the intercepted @modal version, which already has
// its own loading.tsx) -- same getStoryPageData fetch, same reasoning.
export default function StoryPageLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-4 w-1/3" />
      <div className="flex gap-2 overflow-hidden">
        <Skeleton className="aspect-[9/16] w-24 shrink-0" />
        <Skeleton className="aspect-[9/16] w-24 shrink-0" />
        <Skeleton className="aspect-[9/16] w-24 shrink-0" />
      </div>
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
