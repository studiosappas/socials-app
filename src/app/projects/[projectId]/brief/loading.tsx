import { Skeleton } from "@/components/ui/skeleton";

export default function BriefLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-8 w-28" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3 border border-border p-4">
          <Skeleton className="h-4 w-1/3" />
          <div className="flex gap-2">
            <Skeleton className="h-16 w-16 shrink-0" />
            <Skeleton className="h-16 w-16 shrink-0" />
            <Skeleton className="h-16 w-16 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}
