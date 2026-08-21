import { Skeleton } from "@/components/ui/skeleton";

function PanelSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-3 border border-border p-4 sm:p-6">
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}

export default function OverviewLoading() {
  return (
    <div className="grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-2">
      <div className="flex flex-col gap-8">
        <PanelSkeleton lines={2} />
        <section className="grid grid-cols-2 gap-4 sm:gap-8">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </section>
        <PanelSkeleton />
      </div>
      <div className="flex flex-col gap-8">
        <PanelSkeleton lines={2} />
        <PanelSkeleton lines={4} />
      </div>
    </div>
  );
}
