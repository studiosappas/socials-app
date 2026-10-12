// Builds and REHEARSES the one-paste setup script for a brand-new, empty
// Flow:er STAGING Supabase project:
//
//   supabase/staging/STAGING_ONLY_new_empty_project_setup.sql
//
//   npm i --no-save @electric-sql/pglite
//   node scripts/staging-db-setup.check.mjs            # verify + rehearse
//   node scripts/staging-db-setup.check.mjs --write    # regenerate the file, then verify + rehearse
//
// Everything here runs in a disposable in-memory Postgres (PGlite) inside
// this process. It never opens a network connection and never touches
// Supabase, Staging or Production.
//
// Why a generated file: the Staging script is the five source files below,
// verbatim, in the one order that works on an empty database, wrapped in a
// single transaction behind an "is this database really empty?" guard. The
// check fails if the committed file ever stops matching its sources, so the
// thing that was rehearsed is always the thing that gets pasted.
//
// What a pass means: the SQL in this repo builds a working database on
// Postgres, and the five project roles behave as intended on it. It does NOT
// prove anything about Supabase's own dashboard settings, and says nothing
// about what Production contains.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUPABASE_DIR = path.join(ROOT, "supabase");
const OUT_REL = "supabase/staging/STAGING_ONLY_new_empty_project_setup.sql";
const OUT = path.join(ROOT, OUT_REL);

// The ONLY files that go in, in the ONLY order that works. Deliberately
// absent:
//   - fix_member_share_review_links.sql (lives on its own fix branch; applied
//     to Staging separately, on purpose, while that fix is being tested);
//   - RUN_ALL_PENDING_MIGRATIONS.sql and fix_batch2_schema.sql: run after the
//     role-permissions file they put older, broader policies back (any member
//     managing project tasks / uploading Brief media);
//   - every other fix_*.sql: already contained in schema.sql;
//   - backfill_archive_divergence_clones.sql: repairs old data a new database
//     doesn't have.
const SOURCES = [
  ["schema.sql", "the full base schema: tables, row-level security, functions, storage buckets"],
  ["fix_brief_video_items.sql", "Brief: video items + the attachments poster column (not in schema.sql)"],
  ["fix_admin_dashboard_schema.sql", "system_events + user_presence tables, and the rule that nobody can make themselves a global admin"],
  ["fix_project_visit_recency.sql", "per-user 'last visited project' column"],
  ["fix_project_role_permission_presets.sql", "what each role may do: Member can edit content, Viewer/Client cannot"],
];
const FORBIDDEN_POLICIES = [
  // from fix_member_share_review_links.sql -- must NOT be part of this script
  "Editors can create share links",
  "Creators can delete own share links",
  "Creators can add items to own share links",
  // the older, broader policies the excluded files would re-add
  "Members manage project tasks, users manage personal tasks",
  "Members can upload brief media",
  "Members can upload media",
];

const read = (file) => fs.readFileSync(path.join(SUPABASE_DIR, file), "utf8").replace(/\r\n/g, "\n");
// Each fix file wraps itself in its own begin;/commit;. Inside ONE outer
// transaction those would end it early, so exactly those two lines are
// dropped -- nothing else in any source file is altered.
function withoutOwnTransaction(sql) {
  const lines = sql.split("\n");
  const kept = lines.filter((l) => !/^(begin|commit);\s*$/i.test(l));
  return { sql: kept.join("\n"), removed: lines.length - kept.length };
}

const HEADER = `-- ============================================================================
--  FLOW:ER  --  STAGING ONLY  --  NEW, EMPTY SUPABASE PROJECT SETUP
-- ============================================================================
--
--  THIS IS NOT A MIGRATION.  DO NOT RUN IT ON PRODUCTION.
--
--  What it is: the complete one-time setup for a BRAND-NEW, EMPTY Supabase
--  project that will be Flow:er's Staging database ("flower-STAGING").
--  It creates every table, permission rule, function and storage bucket the
--  app needs. It contains no customer data, no users and no secrets.
--
--  How to use it:
--    1. In Supabase, check the project name at the top of the page says
--       flower-STAGING.
--    2. SQL Editor -> New query -> paste this WHOLE file -> Run.
--    3. The result is one row starting "STAGING SETUP COMPLETE".
--
--  Safety built in:
--    - The first step checks the database is EMPTY (no app tables, no users,
--      no storage buckets). If it is not -- for example because this was
--      pasted into Production by mistake -- it stops with an error and
--      changes NOTHING.
--    - Everything after that runs as ONE transaction: if any step fails,
--      the whole setup is undone and the database is left empty again.
--    - It can only ever succeed once per project. A second run is refused by
--      the same empty-database check.
--
--  To start over: delete the Staging project in Supabase and create a new one.
--
--  NOT included, on purpose:
--    - fix_member_share_review_links.sql (the Member review-link permission).
--      It is applied to Staging separately, as part of testing that fix.
--    - RUN_ALL_PENDING_MIGRATIONS.sql and the other older fix_*.sql files.
--      They are either already contained in schema.sql or would put back
--      older, broader permissions. Do not run them on Staging afterwards.
--
--  GENERATED FILE -- do not edit by hand. It is built from the files named in
--  each section below by scripts/staging-db-setup.check.mjs, which also
--  rehearses it on a disposable local database and fails if this file no
--  longer matches its sources.
-- ============================================================================
`;

const GUARD = `
-- ----------------------------------------------------------------------------
--  STEP 0 -- SAFETY CHECK: refuse to run on anything but an empty project.
--  (Outside the transaction on purpose: if it stops here, nothing was started.)
-- ----------------------------------------------------------------------------
do $staging_guard$
declare
  v_tables int;
  v_users int;
  v_buckets int;
begin
  select count(*) into v_tables
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE';
  select count(*) into v_users from auth.users;
  select count(*) into v_buckets from storage.buckets;

  if v_tables > 0 or v_users > 0 or v_buckets > 0 then
    raise exception
      'STOPPED - NOTHING WAS CHANGED. This database is not empty (% app tables, % users, % storage buckets). This script is ONLY for a brand-new, empty Flow:er STAGING project. If this is Production, close this tab. If this is Staging and you want to start over, delete the Staging project and create a new one.',
      v_tables, v_users, v_buckets;
  end if;
end
$staging_guard$;

begin;
`;

const FOOTER = `
commit;

-- ----------------------------------------------------------------------------
--  RESULT -- one row. Expect: STAGING SETUP COMPLETE, 40 tables, 84 table
--  rules, 15 storage rules, 5 buckets, 0 tables without row-level security.
-- ----------------------------------------------------------------------------
select
  'STAGING SETUP COMPLETE' as status,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') as tables,
  (select count(*) from pg_policies where schemaname = 'public') as table_rules,
  (select count(*) from pg_policies where schemaname = 'storage') as storage_rules,
  (select count(*) from storage.buckets) as buckets,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) as tables_without_rls;
`;

function compose() {
  let out = HEADER + GUARD;
  SOURCES.forEach(([file, what], i) => {
    const { sql } = withoutOwnTransaction(read(file));
    out +=
      `\n-- ============================================================================\n` +
      `--  PART ${i + 1} of ${SOURCES.length} -- ${file}\n` +
      `--  ${what}\n` +
      `--  (copied as-is from supabase/${file}${file === "schema.sql" ? "" : "; only its own begin;/commit; lines removed"})\n` +
      `-- ============================================================================\n\n` +
      sql.replace(/\s+$/, "") +
      "\n";
  });
  return out + FOOTER;
}

// What a real Supabase project already has before any of our SQL runs --
// only the pieces this script touches.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null unique, owner uuid, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  grant all on all tables in schema storage to anon, authenticated, service_role;
`;
async function freshSupabaseLikeDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  return db;
}
const snapshot = async (db) => {
  const one = async (q) => Number((await db.query(q)).rows[0].c);
  return {
    tables: await one(`select count(*)::int c from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`),
    columns: await one(`select count(*)::int c from information_schema.columns where table_schema='public'`),
    tableRules: await one(`select count(*)::int c from pg_policies where schemaname='public'`),
    storageRules: await one(`select count(*)::int c from pg_policies where schemaname='storage'`),
    functions: await one(`select count(*)::int c from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`),
    buckets: await one(`select count(*)::int c from storage.buckets`),
    users: await one(`select count(*)::int c from auth.users`),
  };
};

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL - ${name}\n   ${String(e.message).split("\n").slice(0, 8).join("\n   ")}`);
  }
}

// ---------------------------------------------------------------------------
const composed = compose();
if (process.argv.includes("--write")) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, composed);
  console.log(`wrote ${OUT_REL} (${composed.split("\n").length} lines)`);
}
const script = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : null;

console.log("\n### 1. the committed file itself");
await check(`${OUT_REL} exists and matches its five source files exactly`, async () => {
  assert.ok(script, "file is missing -- run with --write");
  assert.equal(script, composed, "the Staging script is out of date with its sources -- run with --write and review the diff");
});
await check("it is unmistakably Staging-only, and starts with the empty-database guard before any change", async () => {
  assert.match(path.basename(OUT), /^STAGING_ONLY_/);
  assert.match(script.split("\n").slice(0, 6).join("\n"), /STAGING ONLY/);
  assert.match(script, /THIS IS NOT A MIGRATION\.\s+DO NOT RUN IT ON PRODUCTION\./);
  const guardAt = script.indexOf("do $staging_guard$");
  const firstChange = script.search(/^(create|alter|insert|update|delete|drop|grant|revoke)\b/im);
  assert.ok(guardAt !== -1 && guardAt < firstChange, "guard must come before the first statement that changes anything");
  assert.ok(guardAt < script.indexOf("\nbegin;\n"), "guard runs before the transaction opens");
});
await check("exactly one transaction wraps everything; no source file's own begin/commit survived", async () => {
  assert.equal((script.match(/^begin;\s*$/gim) ?? []).length, 1);
  assert.equal((script.match(/^commit;\s*$/gim) ?? []).length, 1);
  assert.equal((script.match(/^rollback;\s*$/gim) ?? []).length, 0);
});
await check("the five parts are present in the required order; nothing else was pulled in", async () => {
  const parts = [...script.matchAll(/^--  PART (\d) of 5 -- (\S+)$/gm)].map((m) => m[2]);
  assert.deepEqual(parts, SOURCES.map(([f]) => f));
  for (const absent of ["RUN_ALL_PENDING_MIGRATIONS", "fix_batch2_schema", "fix_member_share_review_links", "backfill_archive"]) {
    assert.ok(!new RegExp(`PART \\d of 5 -- ${absent}`).test(script), `${absent} must not be a part`);
  }
});
await check("no secrets, no real addresses, no customer data: no keys, tokens, project URLs, emails or data rows", async () => {
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(script), "looks like a JWT/API key");
  assert.ok(!/\bsb_(secret|publishable)_|service_role\s*key|sk-ant-|password\s*=/i.test(script), "looks like a credential");
  assert.ok(!/[a-z0-9]{20}\.supabase\.co/i.test(script), "contains a Supabase project URL");
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(script), "contains an email address");
  // The only rows it inserts are the storage bucket definitions.
  const inserts = [...script.matchAll(/^insert into ([a-z_.]+)/gim)].map((m) => m[1]);
  assert.ok(inserts.length > 0 && inserts.every((t) => t === "storage.buckets"), `unexpected inserts: ${inserts}`);
});

console.log("\n### 2. the repo's schema.sql on its own (the ordering correction)");
await check("schema.sql now runs start to finish on an empty database", async () => {
  const db = await freshSupabaseLikeDb();
  await db.exec(read("schema.sql"));
  const s = await snapshot(db);
  assert.equal(s.tables, 38);
  const r = await db.query(`select 1 from information_schema.tables where table_schema='public' and table_name in ('brief_attachments','brief_task_items')`);
  assert.equal(r.rows.length, 2);
  await db.close();
});

console.log("\n### 3. the exact Staging script, start to finish, on an empty Supabase-like database");
const db = await freshSupabaseLikeDb();
console.log("   engine:", (await db.query("select version() v")).rows[0].v.split(" on ")[0], "(in memory, this process only)");
let summary;
await check("the whole file runs in one go with no error and reports STAGING SETUP COMPLETE", async () => {
  const results = await db.exec(script);
  summary = results[results.length - 1].rows[0];
  assert.equal(summary.status, "STAGING SETUP COMPLETE");
});
const built = await snapshot(db);
await check("result: 40 tables, 84 table rules, 15 storage rules, 5 buckets, row-level security on every table", async () => {
  console.log("   " + JSON.stringify(summary));
  assert.deepEqual(
    { tables: Number(summary.tables), tableRules: Number(summary.table_rules), storageRules: Number(summary.storage_rules), buckets: Number(summary.buckets), noRls: Number(summary.tables_without_rls) },
    { tables: 40, tableRules: 84, storageRules: 15, buckets: 5, noRls: 0 },
  );
  assert.equal(built.users, 0, "no users are created");
});
await check("everything the app's code uses exists: every table, database function, bucket and selected column", async () => {
  const walk = (dir, acc = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, acc);
      else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
    }
    return acc;
  };
  const src = walk(path.join(ROOT, "src")).map((p) => fs.readFileSync(p, "utf8")).join("\n");
  const buckets = new Set((await db.query(`select id from storage.buckets`)).rows.map((r) => r.id));
  const tables = new Set((await db.query(`select table_name t from information_schema.tables where table_schema='public'`)).rows.map((r) => r.t));
  const fns = new Set((await db.query(`select p.proname f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows.map((r) => r.f));
  const usedTables = [...new Set([...src.matchAll(/\.from\(\s*"([a-z_-]+)"\s*\)/g)].map((m) => m[1]))];
  assert.deepEqual(usedTables.filter((t) => !tables.has(t) && !buckets.has(t)), [], "tables used by the app but missing");
  const usedFns = [...new Set([...src.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]))];
  assert.deepEqual(usedFns.filter((f) => !fns.has(f)), [], "database functions used by the app but missing");
  const usedBuckets = [...new Set([...src.matchAll(/storage\s*\.from\(\s*"([a-z-]+)"\s*\)/g)].map((m) => m[1]))];
  assert.deepEqual(usedBuckets.filter((b) => !buckets.has(b)), [], "buckets used by the app but missing");
  const cols = new Map();
  for (const r of (await db.query(`select table_name t, column_name c from information_schema.columns where table_schema='public'`)).rows) {
    (cols.get(r.t) ?? cols.set(r.t, new Set()).get(r.t)).add(r.c);
  }
  const missing = new Set();
  for (const [, t, list] of src.matchAll(/\.from\(\s*"([a-z_]+)"\s*\)\s*\.select\(\s*"([^"()*]+)"/g)) {
    if (!cols.has(t)) continue;
    for (const raw of list.split(",")) {
      const c = raw.trim().split(":").pop().trim();
      if (/^[a-z_]+$/.test(c) && !cols.get(t).has(c)) missing.add(`${t}.${c}`);
    }
  }
  assert.deepEqual([...missing], [], "columns selected by the app but missing");
});
await check("NOT included: the Member review-link policies, and the older broader policies", async () => {
  const names = (await db.query(`select policyname from pg_policies where schemaname in ('public','storage')`)).rows.map((r) => r.policyname);
  assert.deepEqual(FORBIDDEN_POLICIES.filter((p) => names.includes(p)), []);
  const share = (await db.query(`select policyname from pg_policies where tablename in ('share_links','share_link_items') order by 1`)).rows.map((r) => r.policyname);
  assert.deepEqual(share, ["Admins manage share link items", "Admins manage share links", "Members can view share link items", "Members can view share links"]);
});

// ---------------------------------------------------------------------------
console.log("\n### 4. roles and permissions on the built database (Owner, Admin, Member, Viewer, Client)");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const U = { owner: id(1), admin: id(2), editor: id(3), viewer: id(4), client: id(5), outsider: id(9) };
const ROLES = ["owner", "admin", "editor", "viewer", "client"];
const NAME = { owner: "Owner", admin: "Admin", editor: "Member", viewer: "Viewer", client: "Client" };
async function as(user, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
// "allowed" = the write went through and affected a row.
const allowed = (r) => !r.error && r.rows.length > 0;
// Who may do `action`, measured -- returned as a list of role labels.
async function who(action) {
  const out = [];
  for (const role of ROLES) if (allowed(await action(role))) out.push(NAME[role]);
  return out;
}
const STAFF = ["Owner", "Admin", "Member"];
const MANAGERS = ["Owner", "Admin"];
let projectId, otherProjectId, postId;

await check("creating users creates their profiles (synthetic example.com addresses, no name set)", async () => {
  for (const [role, uid] of Object.entries(U)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [uid, `staging-${role}@example.com`]);
  const r = await db.query(`select name, email, is_admin from public.profiles`);
  assert.equal(r.rows.length, 6);
  assert.ok(r.rows.every((p) => p.name && p.email && p.is_admin === false));
});
await check("Owner creates a project and automatically becomes its owner; then adds the other four roles", async () => {
  const r = await as(U.owner, `insert into public.projects (name, created_by) values ('Staging demo', $1) returning id`, [U.owner]);
  assert.ok(allowed(r), r.error);
  projectId = r.rows[0].id;
  for (const role of ["admin", "editor", "viewer", "client"]) {
    const m = await as(U.owner, `insert into public.project_members (project_id, user_id, role) values ($1, $2, $3) returning role`, [projectId, U[role], role]);
    assert.ok(allowed(m), `${role}: ${m.error}`);
  }
  const roles = (await db.query(`select role::text from public.project_members where project_id = $1 order by 1`, [projectId])).rows.map((x) => x.role);
  assert.deepEqual(roles, ["admin", "client", "editor", "owner", "viewer"]);
  // a second project nobody above belongs to
  otherProjectId = (await as(U.outsider, `insert into public.projects (name, created_by) values ('Someone else', $1) returning id`, [U.outsider])).rows[0].id;
});
await check("create a post: Owner, Admin, Member -- not Viewer, not Client", async () => {
  assert.deepEqual(await who((role) => as(U[role], `insert into public.posts (project_id) values ($1) returning id`, [projectId])), STAFF);
  postId = (await db.query(`select id from public.posts where project_id = $1 limit 1`, [projectId])).rows[0].id;
});
await check("edit and delete a post: Owner, Admin, Member only", async () => {
  assert.deepEqual(await who((role) => as(U[role], `update public.posts set caption = 'x' where id = $1 returning id`, [postId])), STAFF);
  assert.deepEqual(
    await who(async (role) => {
      const p = (await db.query(`insert into public.posts (project_id) values ($1) returning id`, [projectId])).rows[0].id;
      return as(U[role], `delete from public.posts where id = $1 returning id`, [p]);
    }),
    STAFF,
  );
});
await check("add media to the library (as yourself): Owner, Admin, Member only", async () => {
  assert.deepEqual(
    await who((role) => as(U[role], `insert into public.media_assets (project_id, storage_path, media_type, uploaded_by) values ($1, $2, 'image', $3) returning id`, [projectId, `${projectId}/${role}.jpg`, U[role]])),
    STAFF,
  );
});
await check("upload a file into the project's private storage folder: Owner, Admin, Member only", async () => {
  assert.deepEqual(
    await who((role) => as(U[role], `insert into storage.objects (bucket_id, name, owner) values ('project-media', $1, $2) returning id`, [`${projectId}/upload-${role}.jpg`, U[role]])),
    STAFF,
  );
});
await check("nobody can upload into ANOTHER project's storage folder", async () => {
  assert.deepEqual(await who((role) => as(U[role], `insert into storage.objects (bucket_id, name, owner) values ('project-media', $1, $2) returning id`, [`${otherProjectId}/x-${role}.jpg`, U[role]])), []);
});
await check("Content (stories) and Brief tasks: Owner, Admin, Member only", async () => {
  assert.deepEqual(await who((role) => as(U[role], `insert into public.stories (project_id) values ($1) returning id`, [projectId])), STAFF);
  assert.deepEqual(await who((role) => as(U[role], `insert into public.brief_tasks (project_id) values ($1) returning id`, [projectId])), STAFF);
});
await check("Brief: a Member can add a video item to a task (fix_brief_video_items is in effect)", async () => {
  const task = (await db.query(`select id from public.brief_tasks where project_id = $1 limit 1`, [projectId])).rows[0].id;
  const r = await as(U.editor, `insert into public.brief_task_items (task_id, section, kind) values ($1, 'references', 'video') returning id`, [task]);
  assert.ok(allowed(r), r.error);
  assert.equal((await db.query(`select 1 from information_schema.columns where table_name='brief_attachments' and column_name='poster_storage_path'`)).rows.length, 1);
});
await check("everyone in the project can READ its posts; someone outside it sees nothing", async () => {
  for (const role of ROLES) assert.equal((await as(U[role], `select id from public.posts where id = $1`, [postId])).rows.length, 1, role);
  assert.equal((await as(U.outsider, `select id from public.posts where project_id = $1`, [projectId])).rows.length, 0);
  assert.equal((await as(U.owner, `select id from public.projects where id = $1`, [otherProjectId])).rows.length, 0);
});
await check("comment on a post: every member, including Viewer and Client", async () => {
  assert.deepEqual(await who((role) => as(U[role], `insert into public.post_comments (post_id, author_id, text) values ($1, $2, 'hi') returning id`, [postId, U[role]])), ["Owner", "Admin", "Member", "Viewer", "Client"]);
});
await check("manage team membership and project settings: Owner and Admin only -- not Member", async () => {
  assert.deepEqual(await who((role) => as(U[role], `update public.project_members set custom_permissions = null where project_id = $1 and user_id = $2 returning role`, [projectId, U.viewer])), MANAGERS);
  assert.deepEqual(await who((role) => as(U[role], `update public.projects set brand_notes = 'n' where id = $1 returning id`, [projectId])), MANAGERS);
});
await check("delete the project: Owner only (checked without deleting it)", async () => {
  // Run inside a rolled-back transaction per role so the project survives.
  const out = [];
  for (const role of ROLES) {
    await db.exec("begin");
    const r = await as(U[role], `delete from public.projects where id = $1 returning id`, [projectId]);
    await db.exec("rollback");
    if (allowed(r)) out.push(NAME[role]);
  }
  assert.deepEqual(out, ["Owner"]);
});
await check("review links, BEFORE the Member fix: Owner and Admin can create; Member, Viewer, Client are refused", async () => {
  assert.deepEqual(await who((role) => as(U[role], `insert into public.share_links (project_id, token, title, created_by) values ($1, $2, '', $3) returning id`, [projectId, `tok-${role}`, U[role]])), MANAGERS);
});
await check("an anonymous visitor can open a real review link and gets nothing for a wrong token", async () => {
  await db.query(`insert into public.share_link_items (share_link_id, post_id) select id, $1 from public.share_links where token = 'tok-owner'`, [postId]);
  await db.exec("set role anon");
  try {
    const good = (await db.query(`select public.get_shared_preview('tok-owner') as r`)).rows[0].r;
    const bad = (await db.query(`select public.get_shared_preview('not-a-token') as r`)).rows[0].r;
    assert.ok(good && good.items.length === 1);
    assert.equal(bad, null);
    // ...but cannot read the tables directly
    assert.ok((await db.query(`select count(*)::int c from public.posts`)).rows[0].c === 0);
  } finally {
    await db.exec("reset role");
  }
});
await check("no one can make themselves a global admin", async () => {
  for (const role of ROLES) await as(U[role], `update public.profiles set is_admin = true where id = $1 returning id`, [U[role]]);
  assert.equal((await db.query(`select count(*)::int c from public.profiles where is_admin`)).rows[0].c, 0);
});

// ---------------------------------------------------------------------------
console.log("\n### 5. it cannot be run on a database that is not empty (the 'pasted into Production' case)");
await check("run a SECOND time on the now-populated database: stopped by the guard, and nothing at all changes", async () => {
  const before = JSON.stringify(await snapshot(db));
  const rows = async () => JSON.stringify((await db.query(`select (select count(*) from public.posts) p, (select count(*) from public.project_members) m, (select count(*) from pg_policies) pol`)).rows[0]);
  const rowsBefore = await rows();
  let message = "";
  try {
    await db.exec(script);
  } catch (e) {
    message = e.message;
  }
  await db.exec("rollback").catch(() => {});
  assert.match(message, /STOPPED - NOTHING WAS CHANGED/);
  assert.match(message, /ONLY for a brand-new, empty Flow:er STAGING project/);
  assert.equal(JSON.stringify(await snapshot(db)), before);
  assert.equal(await rows(), rowsBefore);
});
await db.close();
for (const [label, prepare] of [
  ["a database that has app tables but no users (e.g. a half-built or Production-like schema)", (d) => d.exec(`create table public.projects (id uuid primary key)`)],
  ["a database with users but no tables", (d) => d.exec(`insert into auth.users (email) values ('someone@example.com')`)],
  ["a database that already has a storage bucket", (d) => d.exec(`insert into storage.buckets (id, name) values ('project-media', 'project-media')`)],
]) {
  await check(`refuses ${label}, changing nothing`, async () => {
    const d = await freshSupabaseLikeDb();
    await prepare(d);
    const before = JSON.stringify(await snapshot(d));
    await assert.rejects(d.exec(script), /STOPPED - NOTHING WAS CHANGED/);
    await d.exec("rollback").catch(() => {});
    assert.equal(JSON.stringify(await snapshot(d)), before);
    await d.close();
  });
}
await check("if a step fails halfway, the whole setup is undone (database left empty)", async () => {
  const d = await freshSupabaseLikeDb();
  const broken = script.replace("create table public.share_links (", "create table public.share_links_BROKEN ("); // later statements then fail
  await assert.rejects(d.exec(broken));
  await d.exec("rollback").catch(() => {});
  const s = await snapshot(d);
  assert.deepEqual({ tables: s.tables, tableRules: s.tableRules, buckets: s.buckets, functions: s.functions }, { tables: 0, tableRules: 0, buckets: 0, functions: 0 });
  await d.close();
});

console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed) process.exit(1);
