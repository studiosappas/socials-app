import { Skeleton } from "@/components/ui/skeleton";

export default function DangerSettingsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-28" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
