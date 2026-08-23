import { getAdminDashboardData } from "@/lib/actions/admin-dashboard";
import { AdminDashboardApp } from "./admin-dashboard-app";

// The real security boundary is inside getAdminDashboardData itself
// (requireAdminServiceClient, see admin-auth.ts) -- this page only runs
// past admin/layout.tsx's own gate, which is a fast friendly early exit,
// not the enforcement. Errors are shown with their real message
// deliberately: this is admin-only tooling nobody but a site admin will
// ever see, same reasoning /admin/thumbnails already uses.
export default async function AdminDashboardPage() {
  let data: Awaited<ReturnType<typeof getAdminDashboardData>> | null = null;
  let loadError: string | null = null;
  try {
    data = await getAdminDashboardData();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  if (loadError || !data) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-12 sm:px-8">
        <h1 className="text-2xl font-light">Flow:er Internal Overview</h1>
        <div className="rounded border border-error/40 bg-error/5 p-4 text-sm text-error">
          Couldn&apos;t load the dashboard: {loadError ?? "unknown error"}
        </div>
      </div>
    );
  }

  return <AdminDashboardApp initialData={data} />;
}
