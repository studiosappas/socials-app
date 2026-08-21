import { Skeleton } from "@/components/ui/skeleton";

export default function TeamSettingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-6 w-24" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
