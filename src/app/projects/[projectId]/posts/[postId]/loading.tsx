import { Skeleton } from "@/components/ui/skeleton";

// Full-page fallback for a direct navigation/hard refresh to this route
// (the common case is the intercepted @modal version, which already has
// its own loading.tsx) -- same getPostPageData fetch, same reasoning.
export default function PostPageLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="aspect-[4/5] w-full max-w-xs" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
