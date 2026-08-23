"use client";

import { useMemo, useState } from "react";
import { AnimatedNumber } from "@/app/projects/[projectId]/animated-number";
import { Avatar, EmptyAvatar } from "@/components/ui/avatar";
import type {
  AdminActiveUser,
  AdminActivityItem,
  AdminDashboardData,
  AdminProjectRow,
  AdminSystemIssue,
  AdminUserRow,
} from "@/lib/actions/admin-dashboard";

const labelClass = "text-xs tracking-wide text-muted uppercase";

export function relativeTime(iso: string | null): string {
  if (!iso) return "No activity yet";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Masthead -- the "restrained summary area," deliberately NOT four identical
// StatTile boxes: Active Now gets a live avatar cluster (this is the most
// important section per the brief), System gets a status word/dot instead
// of a number, and every number carries a one-line delta for context instead
// of sitting alone.
// ---------------------------------------------------------------------------
export function AdminMasthead({ data }: { data: AdminDashboardData }) {
  const { users, projects, systemHealth, activeNowUsers } = data;
  const shown = activeNowUsers.slice(0, 5);
  const extra = users.activeNow - shown.length;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-8">
      <div className="flex flex-col justify-between gap-3 border border-border p-4 sm:p-6">
        <div className="flex -space-x-2">
          {shown.length === 0 ? (
            <EmptyAvatar size="md" />
          ) : (
            shown.map((u) => (
              <span key={u.id} className="ring-2 ring-background rounded-full">
                <Avatar name={u.name} avatarUrl={u.avatarUrl} size="md" />
              </span>
            ))
          )}
        </div>
        <div>
          <span className="text-3xl font-light sm:text-5xl">
            <AnimatedNumber value={users.activeNow} />
          </span>
          <p className={labelClass}>Active Now{extra > 0 ? ` · +${extra} more` : ""}</p>
        </div>
      </div>

      <StatTile label="Users" value={users.total} sub={users.newToday > 0 ? `+${users.newToday} today` : undefined} />
      <StatTile
        label="Projects"
        value={projects.total}
        sub={projects.createdToday > 0 ? `+${projects.createdToday} today` : undefined}
      />

      <div className="flex flex-col justify-between gap-3 border border-border p-4 sm:p-6">
        <span
          className={`h-2.5 w-2.5 rounded-full ${systemHealth.healthy ? "bg-success" : "bg-warning"}`}
          aria-hidden
        />
        <div>
          <p className="text-lg font-light sm:text-2xl">{systemHealth.healthy ? "Healthy" : "Needs attention"}</p>
          <p className={labelClass}>
            {systemHealth.issuesLast24h === 0
              ? "System"
              : `${systemHealth.issuesLast24h} issue${systemHealth.issuesLast24h === 1 ? "" : "s"} · 24h`}
          </p>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="flex flex-col gap-2 border border-border p-4 sm:p-6">
      <span className="text-3xl font-light sm:text-5xl">
        <AnimatedNumber value={value} />
      </span>
      <div className="flex items-baseline justify-between gap-2">
        <span className={labelClass}>{label}</span>
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content / usage -- a secondary, smaller row (posts/stories/media are
// useful context, not headline numbers).
// ---------------------------------------------------------------------------
export function ContentSummary({ data }: { data: AdminDashboardData }) {
  const { content, projects } = data;
  return (
    <div className="flex flex-col gap-3">
      <h2 className={labelClass}>Content &amp; Usage</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MiniStat label="Posts" value={content.totalPosts} />
        <MiniStat label="Stories" value={content.totalStories} />
        <MiniStat label="Media Assets" value={content.totalMedia} />
        <MiniStat label="Uploads Today" value={content.uploadsToday} />
      </div>
      <p className="text-xs text-muted">
        {projects.avgPerUser} project{projects.avgPerUser === 1 ? "" : "s"} per user on average · {projects.createdThisWeek}{" "}
        new project{projects.createdThisWeek === 1 ? "" : "s"} this week
      </p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xl font-light">{value.toLocaleString()}</span>
      <span className={labelClass}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active Now -- who, not just how many.
// ---------------------------------------------------------------------------
export function ActiveNowSection({ users }: { users: AdminActiveUser[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className={labelClass}>Active Now</h2>
      {users.length === 0 ? (
        <p className="text-sm text-muted">Nobody is active right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((u) => (
            <li key={u.id} className="border border-border">
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="relative shrink-0">
                    <Avatar name={u.name} avatarUrl={u.avatarUrl} size="md" />
                    <span className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border border-background bg-success" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm">{u.name}</p>
                    <p className="truncate text-xs text-muted">{u.email}</p>
                  </div>
                </div>
                <span className="shrink-0 text-xs tracking-wide text-muted uppercase">{relativeTime(u.lastSeenAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users -- people, not database rows. Mirrors settings/team's TeamMemberRow
// list styling (bordered <li>, avatar + name/email, right-aligned meta).
// ---------------------------------------------------------------------------
export function UsersSection({ users }: { users: AdminUserRow[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className={labelClass}>Users</h2>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users…"
          className="w-40 border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
        />
      </div>
      <ul className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
        {filtered.map((u) => (
          <li key={u.id} className="border border-border">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="relative shrink-0">
                  <Avatar name={u.name} avatarUrl={u.avatarUrl} size="md" />
                  {u.isOnline && (
                    <span className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border border-background bg-success" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm">{u.name}</p>
                  <p className="truncate text-xs text-muted">{u.email}</p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-muted">
                  {u.projectCount} project{u.projectCount === 1 ? "" : "s"} · {u.mediaCount} media
                </p>
                <p className="text-xs tracking-wide text-muted uppercase">
                  {u.isOnline ? "Active" : relativeTime(u.lastSeenAt)}
                </p>
              </div>
            </div>
          </li>
        ))}
        {filtered.length === 0 && <p className="text-sm text-muted">No users match &quot;{query}&quot;.</p>}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Projects -- "who created projects and who is actually using the product."
// ---------------------------------------------------------------------------
export function ProjectsSection({ projects }: { projects: AdminProjectRow[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.ownerName.toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className={labelClass}>Projects</h2>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects…"
          className="w-40 border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
        />
      </div>
      <ul className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
        {filtered.map((p) => (
          <li key={p.id} className="border border-border">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm">{p.name}</p>
                <p className="truncate text-xs text-muted">
                  {p.ownerName} · joined {new Date(p.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-muted">
                  {p.mediaCount} media · {p.postCount + p.storyCount} content
                </p>
                <p className="text-xs tracking-wide text-muted uppercase">Active {relativeTime(p.lastActivityAt)}</p>
              </div>
            </div>
          </li>
        ))}
        {filtered.length === 0 && <p className="text-sm text-muted">No projects match &quot;{query}&quot;.</p>}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System health -- human-readable first, technical detail second.
// ---------------------------------------------------------------------------
export function SystemHealthSection({
  healthy,
  issuesLast24h,
  recentIssues,
}: {
  healthy: boolean;
  issuesLast24h: number;
  recentIssues: AdminSystemIssue[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className={labelClass}>System Health</h2>
      <div className="flex items-center gap-3 border border-border p-4">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${healthy ? "bg-success" : "bg-warning"}`} aria-hidden />
        <p className="text-sm">
          {healthy
            ? "All systems healthy — no failures captured in the last 24 hours."
            : `${issuesLast24h} issue${issuesLast24h === 1 ? "" : "s"} in the last 24 hours.`}
        </p>
      </div>
      {recentIssues.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {recentIssues.map((issue) => (
            <li key={issue.id} className="flex items-start justify-between gap-3 border-b border-border py-1.5 text-xs">
              <div className="min-w-0">
                <p className="truncate text-foreground">{issue.message}</p>
                <p className="text-muted">
                  {issue.area} · {issue.category}
                </p>
              </div>
              <span className="shrink-0 text-muted">{relativeTime(issue.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent activity -- merged feed of creation events + failures.
// ---------------------------------------------------------------------------
const ACTIVITY_ICON: Record<AdminActivityItem["kind"], string> = {
  project_created: "＋",
  media_uploaded: "↑",
  post_created: "▤",
  story_created: "◐",
  failure: "!",
};

export function RecentActivitySection({ items }: { items: AdminActivityItem[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className={labelClass}>Recent Activity</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">No activity in the tracked window yet.</p>
      ) : (
        <ul className="flex max-h-[28rem] flex-col gap-1.5 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 border-b border-border py-1.5">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                  item.kind === "failure" ? "bg-error/10 text-error" : "bg-black/[.04] text-muted"
                }`}
                aria-hidden
              >
                {ACTIVITY_ICON[item.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.label}</p>
                {item.detail && <p className="truncate text-xs text-muted">{item.detail}</p>}
              </div>
              <span className="shrink-0 text-xs text-muted">{relativeTime(item.timestamp)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
