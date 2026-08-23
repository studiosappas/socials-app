"use client";

import { useEffect, useRef, useState } from "react";
import { getAdminDashboardData, type AdminDashboardData } from "@/lib/actions/admin-dashboard";
import { Button } from "@/components/ui/button";
import {
  AdminMasthead,
  ContentSummary,
  ActiveNowSection,
  UsersSection,
  ProjectsSection,
  SystemHealthSection,
  RecentActivitySection,
  relativeTime,
} from "./dashboard-modules";

// Auto-refresh cadence: this page is opened deliberately by one admin, not
// loaded by every user on every navigation, so re-running the full
// aggregation periodically while it's open is cheap in absolute terms --
// still paused when the tab is hidden (same discipline as the presence
// heartbeat) so leaving the dashboard open in a background tab doesn't spend
// anything. 60s keeps "active now"/recent activity feeling current without
// re-querying on every render or on a short interval.
const AUTO_REFRESH_MS = 60_000;

export function AdminDashboardApp({ initialData }: { initialData: AdminDashboardData }) {
  const [data, setData] = useState(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const next = await getAdminDashboardData();
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't refresh the dashboard.");
    } finally {
      setRefreshing(false);
      inFlight.current = false;
    }
  }

  useEffect(() => {
    function tick() {
      if (document.hidden) return;
      void refresh();
    }
    const interval = setInterval(tick, AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-12 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs tracking-wide text-muted uppercase">Internal · Admin</p>
          <h1 className="text-2xl font-light">Flow:er Internal Overview</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">Updated {relativeTime(data.generatedAt)}</span>
          <Button type="button" variant="secondary" radius="none" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <AdminMasthead data={data} />

      <ContentSummary data={data} />

      <section>
        <ActiveNowSection users={data.activeNowUsers} />
      </section>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
        <section>
          <UsersSection users={data.usersList} />
        </section>
        <section>
          <ProjectsSection projects={data.projectsList} />
        </section>
      </div>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
        <section>
          <SystemHealthSection
            healthy={data.systemHealth.healthy}
            issuesLast24h={data.systemHealth.issuesLast24h}
            recentIssues={data.systemHealth.recentIssues}
          />
        </section>
        <section>
          <RecentActivitySection items={data.recentActivity} />
        </section>
      </div>
    </div>
  );
}
