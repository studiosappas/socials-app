import { Skeleton } from "@/components/ui/skeleton";

export default function ProjectsLoading() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-8 py-16">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="flex items-end gap-4">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-24" />
      </div>
      <ul className="flex flex-col gap-4">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="flex items-center justify-between border-b border-border py-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-14" />
          </li>
        ))}
      </ul>
    </main>
  );
}
