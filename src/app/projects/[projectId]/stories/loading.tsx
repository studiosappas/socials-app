import { Skeleton } from "@/components/ui/skeleton";

export default function StoriesLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-28" />
      </div>
      {/* Matches StoryCard's own aspect-[3/4] card shape and grid-cols-2
          sm:grid-cols-3 lg:grid-cols-4 breakpoints exactly -- the previous
          9/16 (story-shaped) ratio was taller/narrower than the real 3/4
          cards, so every card visibly got shorter the moment real content
          replaced it. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[3/4]" />
        ))}
      </div>
    </div>
  );
}
