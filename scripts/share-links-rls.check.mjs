// Opt-in check of the review-link RLS policies against a REAL Postgres
// engine (PGlite: Postgres compiled to WASM, in-memory, in this process).
// Nothing here connects to Supabase or any shared database.
//
//   npm i --no-save @electric-sql/pglite
//   node scripts/share-links-rls.check.mjs
//
// It does not re-type the policies under test. It reads them from the repo:
//   - the is_project_member / project_role helpers and the share_links /
//     share_link_items tables + their four ORIGINAL policies are cut
//     verbatim out of supabase/schema.sql;
//   - supabase/fix_member_share_review_links.sql is then applied verbatim
//     (twice, to prove it is re-runnable).
// Only what those depend on is stubbed minimally (auth.uid(), the
// `authenticated` role, and skeleton profiles/projects/posts/stories).
//
// What a pass means: the SQL in this repo behaves as intended on Postgres.
// It does NOT prove what is currently deployed on any Supabase project.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = fs.readFileSync(path.join(ROOT, "supabase", "schema.sql"), "utf8").replace(/\r\n/g, "\n");
const migration = fs.readFileSync(path.join(ROOT, "supabase", "fix_member_share_review_links.sql"), "utf8");

function cut(from, to) {
  const a = schema.indexOf(from);
  const b = schema.indexOf(to, a);
  assert.ok(a !== -1 && b !== -1, `schema.sql no longer contains the expected block: ${from.slice(0, 50)}`);
  return schema.slice(a, b);
}
const helpersSql = cut("create function public.is_project_member(", "alter table public.projects enable row level security;");
const shareSql = cut("create table public.share_links (", "-- Public, unauthenticated read path for a share link's content.");
assert.equal((shareSql.match(/create policy/g) ?? []).length, 4, "expected the 4 original share policies");

const db = new PGlite();
await db.exec(`
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role authenticated nologin;
  create role anon nologin;
  create table public.profiles (id uuid primary key);
  create table public.projects (id uuid primary key);
  create type public.project_role as enum ('owner', 'admin', 'designer', 'editor', 'viewer', 'client');
  create table public.project_members (
    project_id uuid not null references public.projects (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    role public.project_role not null default 'editor',
    primary key (project_id, user_id)
  );
  create table public.posts (id uuid primary key, project_id uuid not null references public.projects (id) on delete cascade);
  create table public.stories (id uuid primary key, project_id uuid not null references public.projects (id) on delete cascade);
  ${helpersSql}
  ${shareSql}
  grant usage on schema public, auth to authenticated, anon;
  grant all on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated, anon;
  grant execute on all functions in schema auth to authenticated, anon;
`);

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const PROJECT = id(1);
const OTHER_PROJECT = id(2);
const USERS = { owner: id(11), admin: id(12), editor: id(13), editor2: id(14), viewer: id(15), client: id(16), designer: id(17), outsider: id(18) };
const POST = id(101);
const STORY = id(102);
const OTHER_POST = id(201);

await db.exec(`
  insert into profiles (id) values ${Object.values(USERS).map((u) => `('${u}')`).join(",")};
  insert into projects (id) values ('${PROJECT}'), ('${OTHER_PROJECT}');
  insert into project_members (project_id, user_id, role) values
    ('${PROJECT}', '${USERS.owner}', 'owner'), ('${PROJECT}', '${USERS.admin}', 'admin'),
    ('${PROJECT}', '${USERS.editor}', 'editor'), ('${PROJECT}', '${USERS.editor2}', 'editor'),
    ('${PROJECT}', '${USERS.viewer}', 'viewer'), ('${PROJECT}', '${USERS.client}', 'client'),
    ('${PROJECT}', '${USERS.designer}', 'designer'),
    ('${OTHER_PROJECT}', '${USERS.outsider}', 'owner');
  insert into posts (id, project_id) values ('${POST}', '${PROJECT}'), ('${OTHER_POST}', '${OTHER_PROJECT}');
  insert into stories (id, project_id) values ('${STORY}', '${PROJECT}');
`);

// Runs `sql` as an authenticated Supabase user. Returns { rows } or { error }.
async function as(userId, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (error) {
    return { error: error.message };
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
let n = 1000;
const createLink = (who, opts = {}) =>
  as(who, `insert into share_links (id, project_id, token, title, created_by) values ($1, $2, $3, '', $4) returning id`, [
    id(++n),
    opts.project ?? PROJECT,
    `tok-${n}`,
    opts.createdBy ?? who,
  ]);
const addItem = (who, linkId, target) =>
  as(who, `insert into share_link_items (share_link_id, post_id, story_id) values ($1, $2, $3) returning id`, [linkId, target.post ?? null, target.story ?? null]);
const deleteLink = (who, linkId) => as(who, `delete from share_links where id = $1 returning id`, [linkId]);
const updateLink = (who, linkId) => as(who, `update share_links set title = 'changed' where id = $1 returning id`, [linkId]);
const countLinks = async () => Number((await db.query(`select count(*)::int as c from share_links`)).rows[0].c);
const RLS = /row-level security/;

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL - ${name}\n   ${String(e.message).split("\n").slice(0, 6).join("\n   ")}`);
  }
}

console.log("### BEFORE the migration (schema.sql as it stands)");
await check("before: Owner and Admin can create a link + items", async () => {
  for (const who of [USERS.owner, USERS.admin]) {
    const link = await createLink(who);
    assert.ok(link.rows, link.error);
    assert.ok((await addItem(who, link.rows[0].id, { post: POST })).rows);
  }
});
await check("before: Member (editor) is REJECTED by RLS -- the reported bug", async () => {
  const before = await countLinks();
  assert.match((await createLink(USERS.editor)).error ?? "", RLS);
  assert.equal(await countLinks(), before);
});

await db.exec(migration);
await db.exec(migration); // re-runnable
console.log("\n### AFTER supabase/fix_member_share_review_links.sql (applied twice)");

const policies = (await db.query(`select tablename, policyname, cmd from pg_policies where tablename in ('share_links','share_link_items') order by 1, 2`)).rows;
await check("policy set is exactly the 4 originals + the 3 new ones", async () => {
  assert.deepEqual(
    policies.map((p) => `${p.tablename}: ${p.policyname} [${p.cmd}]`),
    [
      "share_link_items: Admins manage share link items [ALL]",
      "share_link_items: Creators can add items to own share links [INSERT]",
      "share_link_items: Members can view share link items [SELECT]",
      "share_links: Admins manage share links [ALL]",
      "share_links: Creators can delete own share links [DELETE]",
      "share_links: Editors can create share links [INSERT]",
      "share_links: Members can view share links [SELECT]",
    ],
  );
});

let editorLink;
let ownerLink;
await check("Owner, Admin and Member can each create a link with a post and a story", async () => {
  for (const who of [USERS.owner, USERS.admin, USERS.editor]) {
    const before = await countLinks();
    const link = await createLink(who);
    assert.ok(link.rows, link.error);
    assert.equal(await countLinks(), before + 1, "exactly one row per create");
    const a = await addItem(who, link.rows[0].id, { post: POST });
    const b = await addItem(who, link.rows[0].id, { story: STORY });
    assert.ok(a.rows && b.rows, a.error ?? b.error);
    if (who === USERS.editor) editorLink = link.rows[0].id;
    if (who === USERS.owner) ownerLink = link.rows[0].id;
  }
});
await check("Viewer, Client, legacy designer and a non-member CANNOT create a link", async () => {
  for (const who of [USERS.viewer, USERS.client, USERS.designer, USERS.outsider]) {
    const before = await countLinks();
    assert.match((await createLink(who)).error ?? "", RLS, who);
    assert.equal(await countLinks(), before);
  }
});
await check("Member cannot create a link in someone else's name", async () => {
  assert.match((await createLink(USERS.editor, { createdBy: USERS.owner })).error ?? "", RLS);
});
await check("Member cannot create a link in a project they are not in", async () => {
  assert.match((await createLink(USERS.editor, { project: OTHER_PROJECT })).error ?? "", RLS);
});
await check("Member cannot attach ANOTHER project's post to their link (no cross-project exposure)", async () => {
  assert.match((await addItem(USERS.editor, editorLink, { post: OTHER_POST })).error ?? "", RLS);
});
await check("Member cannot add items to a link someone else created", async () => {
  assert.match((await addItem(USERS.editor, ownerLink, { post: POST })).error ?? "", RLS);
  assert.match((await addItem(USERS.editor2, editorLink, { post: POST })).error ?? "", RLS);
});
await check("Viewer and Client cannot add items to any link", async () => {
  for (const who of [USERS.viewer, USERS.client]) {
    assert.match((await addItem(who, editorLink, { post: POST })).error ?? "", RLS);
  }
});
await check("every project member can still READ links (unchanged); a non-member sees none", async () => {
  const total = await countLinks();
  for (const who of [USERS.owner, USERS.admin, USERS.editor, USERS.viewer, USERS.client]) {
    assert.equal((await as(who, `select id from share_links`)).rows.length, total, who);
  }
  assert.equal((await as(USERS.outsider, `select id from share_links`)).rows.length, 0);
});
await check("Member cannot UPDATE any link, not even their own", async () => {
  assert.equal((await updateLink(USERS.editor, editorLink)).rows.length, 0);
  assert.equal((await updateLink(USERS.editor, ownerLink)).rows.length, 0);
});
await check("Member cannot DELETE a link created by an Owner or by another Member (0 rows, no error)", async () => {
  const before = await countLinks();
  assert.equal((await deleteLink(USERS.editor, ownerLink)).rows.length, 0);
  assert.equal((await deleteLink(USERS.editor2, editorLink)).rows.length, 0);
  assert.equal(await countLinks(), before);
});
await check("Viewer and Client cannot DELETE any link", async () => {
  const before = await countLinks();
  for (const who of [USERS.viewer, USERS.client]) {
    assert.equal((await deleteLink(who, editorLink)).rows.length, 0);
    assert.equal((await deleteLink(who, ownerLink)).rows.length, 0);
  }
  assert.equal(await countLinks(), before);
});
await check("Member CAN delete their own link (items cascade) -- what the failed-create cleanup relies on", async () => {
  const link = await createLink(USERS.editor);
  await addItem(USERS.editor, link.rows[0].id, { post: POST });
  assert.equal((await deleteLink(USERS.editor, link.rows[0].id)).rows.length, 1);
  assert.equal(Number((await db.query(`select count(*)::int as c from share_link_items where share_link_id = $1`, [link.rows[0].id])).rows[0].c), 0);
});
await check("a demoted creator (Member -> Viewer) can no longer delete their own link", async () => {
  await db.exec(`update project_members set role = 'viewer' where user_id = '${USERS.editor2}'`);
  const link = await db.query(`insert into share_links (id, project_id, token, title, created_by) values ($1, $2, 'tok-demoted', '', $3) returning id`, [id(++n), PROJECT, USERS.editor2]);
  assert.equal((await deleteLink(USERS.editor2, link.rows[0].id)).rows.length, 0);
});
await check("Owner and Admin still manage EVERY link: update and delete a Member's link", async () => {
  assert.equal((await updateLink(USERS.admin, editorLink)).rows.length, 1);
  assert.equal((await deleteLink(USERS.owner, editorLink)).rows.length, 1);
});

console.log(`\n${passed} checks passed, ${failed} failed`);
await db.close();
if (failed) process.exit(1);
