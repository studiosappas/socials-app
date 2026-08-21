import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationSettingsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-40" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-5 w-9" />
        </div>
      ))}
    </div>
  );
}
