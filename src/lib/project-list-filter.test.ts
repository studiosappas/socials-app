// Tests for project-list-filter.ts -- no React, no DOM, no network. Run with:
//   node --experimental-strip-types src/lib/project-list-filter.test.ts

import assert from "node:assert/strict";
import {
  canManageArchive,
  selectActiveProjects,
  selectArchivedManageableProjects,
  type ProjectListEntry,
} from "./project-list-filter.ts";

function entry(id: string, overrides: Partial<ProjectListEntry> = {}): ProjectListEntry {
  return {
    id,
    name: id.toUpperCase(),
    profilePhotoPath: null,
    createdAt: "2026-01-01T00:00:00Z",
    role: "owner",
    customPermissions: null,
    ...overrides,
  };
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

test("active list excludes archived projects", () => {
  const entries = [entry("a"), entry("b"), entry("c")];
  const archived = new Map([
    ["a", false],
    ["b", true],
    ["c", false],
  ]);
  assert.deepEqual(
    selectActiveProjects(entries, archived, new Map()).map((e) => e.id).sort(),
    ["a", "c"],
  );
});

test("active list excludes projects whose archived state is unknown (deleted / unreadable)", () => {
  const entries = [entry("a"), entry("gone")];
  const archived = new Map([["a", false]]);
  assert.deepEqual(
    selectActiveProjects(entries, archived, new Map()).map((e) => e.id),
    ["a"],
  );
});

test("empty archived map yields an empty active list, never an unfiltered one", () => {
  const entries = [entry("a"), entry("b")];
  assert.deepEqual(selectActiveProjects(entries, new Map(), new Map()), []);
});

test("order: most recently visited first, then never-visited by newest created", () => {
  const entries = [
    entry("old-unvisited", { createdAt: "2026-01-01T00:00:00Z" }),
    entry("new-unvisited", { createdAt: "2026-03-01T00:00:00Z" }),
    entry("visited-earlier", { createdAt: "2026-02-01T00:00:00Z" }),
    entry("visited-latest", { createdAt: "2025-12-01T00:00:00Z" }),
  ];
  const archived = new Map(entries.map((e) => [e.id, false] as [string, boolean]));
  const visits = new Map<string, string | null>([
    ["visited-earlier", "2026-04-01T00:00:00Z"],
    ["visited-latest", "2026-05-01T00:00:00Z"],
    ["old-unvisited", null],
  ]);
  assert.deepEqual(
    selectActiveProjects(entries, archived, visits).map((e) => e.id),
    ["visited-latest", "visited-earlier", "new-unvisited", "old-unvisited"],
  );
});

test("ordering is independent of input order (switcher and Projects page always agree)", () => {
  const entries = [
    entry("a", { createdAt: "2026-01-01T00:00:00Z" }),
    entry("b", { createdAt: "2026-02-01T00:00:00Z" }),
    entry("c", { createdAt: "2026-03-01T00:00:00Z" }),
  ];
  const archived = new Map(entries.map((e) => [e.id, false] as [string, boolean]));
  const visits = new Map<string, string | null>([["a", "2026-06-01T00:00:00Z"]]);
  const forward = selectActiveProjects([...entries], archived, visits).map((e) => e.id);
  const reversed = selectActiveProjects([...entries].reverse(), archived, visits).map((e) => e.id);
  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward, ["a", "c", "b"]);
});

test("archived list: only archived projects where the user is owner or admin", () => {
  const entries = [
    entry("owned", { role: "owner" }),
    entry("admined", { role: "admin" }),
    entry("edited", { role: "editor" }),
    entry("viewed", { role: "viewer" }),
    entry("client", { role: "client" }),
    entry("designer", { role: "designer" }),
    entry("active-owned", { role: "owner" }),
  ];
  const archived = new Map(entries.map((e) => [e.id, e.id !== "active-owned"] as [string, boolean]));
  assert.deepEqual(
    selectArchivedManageableProjects(entries, archived).map((e) => e.id).sort(),
    ["admined", "owned"],
  );
});

test("archived list excludes projects whose archived state is unknown", () => {
  assert.deepEqual(selectArchivedManageableProjects([entry("x")], new Map()), []);
});

test("archived list is sorted by name, case-insensitively", () => {
  const entries = [entry("1", { name: "zeta" }), entry("2", { name: "Alpha" }), entry("3", { name: "beta" })];
  const archived = new Map(entries.map((e) => [e.id, true] as [string, boolean]));
  assert.deepEqual(
    selectArchivedManageableProjects(entries, archived).map((e) => e.name),
    ["Alpha", "beta", "zeta"],
  );
});

test("canManageArchive matches the RLS update policy roles", () => {
  assert.equal(canManageArchive("owner"), true);
  assert.equal(canManageArchive("admin"), true);
  for (const role of ["editor", "viewer", "client", "designer"] as const) {
    assert.equal(canManageArchive(role), false);
  }
  assert.equal(canManageArchive(null), false);
  assert.equal(canManageArchive(undefined), false);
});

console.log(`\n${passed} passed`);
