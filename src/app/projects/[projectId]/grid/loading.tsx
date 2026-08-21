import { Skeleton } from "@/components/ui/skeleton";

export default function GridLoading() {
  return (
    <div className="flex flex-col gap-10 lg:flex-row">
      <div className="w-full lg:w-72 lg:shrink-0">
        <Skeleton className="h-40 w-full" />
      </div>
      <div className="flex flex-1 flex-col" style={{ gap: "2px" }}>
        {[0, 1, 2].map((row) => (
          <div key={row} className="grid grid-cols-3" style={{ gap: "2px" }}>
            {[0, 1, 2].map((col) => (
              <Skeleton key={col} className="aspect-[4/5] rounded-none" />
            ))}
          </div>
        ))}
      </div>
      <div className="hidden lg:block lg:w-64 lg:shrink-0">
        <Skeleton className="h-full min-h-[420px] w-full" />
      </div>
    </div>
  );
}
