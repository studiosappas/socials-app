import { Skeleton } from "@/components/ui/skeleton";

export default function AssetsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-6 w-32" />
      {/* Matches AssetCard's own aspect-[4/5] card shape and grid-cols-2
          sm:grid-cols-3 lg:grid-cols-4 breakpoints exactly -- the previous
          aspect-video (16:9) was noticeably shorter than the real 4/5
          cards, so the grid visibly grew taller the moment real content
          replaced it. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/5]" />
        ))}
      </div>
    </div>
  );
}
