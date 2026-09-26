# Phase 0 Checklist: Dashboard Checks

**Who:** you (the owner), in your own dashboards. **What for:** to find out what's really happening in production before any code changes.

Rules for this checklist:
- **Never copy, paste, screenshot or send any API key or secret** to anyone, including me. When a step says "compare a key", compare only the **last 4 characters**, privately.
- Sections A–C are **look-only**, except the steps marked 🔒 **CONTAINMENT**. Do those only after we've agreed on them (decisions D-01, D-02 in the roadmap).
- The SQL queries in section C only **read** information. Paste each one exactly as written. If the editor ever asks you to confirm a "destructive operation", stop: something is wrong.
- Dashboard menu names change from time to time. If a label below doesn't match exactly, look for the item with the same meaning.
- Fill in the **Results form** at the end and send it back to me. It contains no secrets.

---

## A. Anthropic (start here)

Go to the Anthropic Console (console.anthropic.com) and sign in with the account that owns the API key Flow:er uses.

### A1. Which organization and workspace
1. Top-left or top-right: note the **organization name**.
2. If you see a **Workspaces** area (usually under Settings): note which workspaces exist and whether any has its own spending limit.

### A2. Find the key Flow:er uses
1. Open **Settings → API Keys**.
2. You'll see a list of keys, each with a name, a short hint (the ending characters), a workspace, and a created date. Sometimes there's also a **last used** date.
3. In another tab, open **Vercel → your Flow:er project → Settings → Environment Variables** and find `ANTHROPIC_API_KEY`. **Don't copy it.** If Vercel shows it masked, use the eye/reveal button only long enough to read the **last 4 characters**, then hide it again.
4. Match those 4 characters to a key in the Anthropic list.
5. Write down: the key's **name**, **workspace**, **created date** and **last used** date (if shown).
6. Also note whether **other** keys exist that you don't recognize.

### A3. How much has it been used
1. Open **Usage** (sometimes "Usage & Cost" or under "Analytics").
2. Choose the widest range available (e.g. the last 90 days). If you can, filter by the key or workspace from A2.
3. Write down:
   - Is there **any** usage at all? (Yes / No)
   - Which **model(s)** appear? (Flow:er's code uses `claude-opus-5`.)
   - Roughly how many **requests per day** on a normal day, and the **highest** day.
   - Any **sudden spikes** that don't match when you or your team were using AI features.

### A4. How much has it cost
1. Open **Cost** (or Billing → Invoices/Usage).
2. Write down the cost for **this month so far** and each of the **last 2–3 months**.
3. Open **Billing** and note:
   - Is **auto-reload** or automatic credit top-up turned **on**? At what amount?
   - Current **credit balance** (if prepaid).

### A5. 🔒 CONTAINMENT: set a spending cap (task P0-02, do after we agree on an amount, D-10)
1. Open **Settings → Limits** (or the workspace's settings → Limits).
2. Set a **monthly spend limit** at the amount you choose.
3. Turn on **spend notifications / alerts** to your email, if offered.
4. In **Billing**, turn **off** auto-reload, or lower it to a small amount.
5. Write down what you set.

   *Effect on users: none, unless the cap is reached. Then AI features show an error until next month or until you raise the cap.*

### A6. 🔒 CONTAINMENT: new key, Production only (task P0-03, do after we agree on D-01 and D-02)

Do these steps in this exact order:
1. In the Anthropic Console, ideally create a new workspace called something like **"Flow:er Production"** with its own monthly limit (same as A5). Then create a **new API key** in it, named e.g. `flower-production-2026-09`.
2. Copy the new key **directly** into Vercel. Don't paste it anywhere else.
3. In Vercel: **Settings → Environment Variables → `ANTHROPIC_API_KEY`**:
   - Edit the variable so it applies to **Production only**, with the **new** key value.
   - Make sure it **no longer applies to Preview** (untick Preview, or delete the Preview entry).
   - If D-01 = "turn AI off for now": **delete the Production entry too.**
4. **Redeploy Production:** Vercel → Deployments → the latest Production deployment → "⋯" → **Redeploy**. Environment changes only take effect on new deployments.
5. When the redeploy is finished, open Flow:er → any post → Caption → the AI/Brand Writer button. It should work, or show "not configured" if you chose to turn AI off.
6. Back in the Anthropic Console → API Keys: **revoke / delete the OLD key.** This is the step that cuts off every old Preview deployment, because they still contain the old key.
7. Write down: the date and time done, and whether step 5 behaved as expected.

   *If anything goes wrong after step 4:* Vercel → Deployments → pick the previous Production deployment → **Instant Rollback** (or "Promote to Production"). Don't revoke the old key until step 5 works.

---

## B. Vercel

Project → **Settings**.

### B1. Environment variables: names and scopes only
Open **Environment Variables**. For each variable below, note **which environments** it applies to (Production / Preview / Development). **Don't reveal any values.**

| Variable | Production? | Preview? | Development? |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | | | |
| `SUPABASE_SERVICE_ROLE_KEY` | | | |
| `NEXT_PUBLIC_SUPABASE_URL` | | | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | | | |
| any others (list names only) | | | |

### B2. Do Preview deployments use the production database?
`NEXT_PUBLIC_SUPABASE_URL` isn't a secret (it's visible in the browser anyway). It looks like `https://<something>.supabase.co`.
1. If there's **one** value shared by Production and Preview → Preview uses **production data**.
2. If Preview has its **own** value, compare the `<something>` part with Production's. Same → production data; different → a separate project.
3. Write down: "Preview uses production database: yes / no".

### B3. Are Preview deployments public?
Open **Deployment Protection**. Note whether **Vercel Authentication** (or password protection) is **on for Preview deployments**.

### B4. Function limits and region
Open **Functions** (or **General** → Functions). Note the **maximum duration** and the **region**, if shown.

### B5. Old preview deployments
Open **Deployments**, filter by **Preview**, and note roughly **how many** exist. They're all live URLs, and until A6 step 6 they all still hold the old AI key.

---

## C. Supabase

Open your Flow:er project at supabase.com → the project dashboard.

### C1. Read-only SQL checks
Open **SQL Editor → New query**. Paste **one query at a time**, press **Run**, and follow the instruction for that query.

**Q1: Can users make themselves admin?** (task P0-06)
```sql
select policyname, cmd, qual as using_rule, with_check as check_rule
from pg_policies
where schemaname = 'public' and tablename = 'profiles'
order by cmd, policyname;
```
➡ Find the row whose `cmd` is **UPDATE**. Copy its `check_rule` text into the Results form.
- If `check_rule` is **empty (NULL)**, or doesn't mention `is_admin`, write **"VULNERABLE"** and tell me right away.
- If it contains something like `is_admin = (select p.is_admin …)`, write **"PROTECTED"**.

**Q2: Who is an admin right now?** (task P0-06)
```sql
select count(*) as admin_count
from public.profiles
where is_admin;
```
➡ Write down the number. Then run the next query **only for yourself** (don't send me the result) to see who they are:
```sql
select email, created_at
from public.profiles
where is_admin
order by created_at;
```
➡ In the Results form, only answer: **"All admins are expected: yes / no"**. If **no**, stop and tell me immediately. Don't change anything yourself yet; I'll give you exact, safe steps.

**Q3: All access rules** (task P0-07; download, don't read)
```sql
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;
```
➡ Use the editor's **Download / Export CSV** button and save it as `policies.csv`.

**Q4: All tables and columns** (task P0-07)
```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```
➡ Download as `columns.csv`.

**Q5: Database functions and who can run them** (task P0-07)
```sql
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as runs_with_owner_rights,
       p.proconfig as settings,
       has_function_privilege('authenticated', p.oid, 'execute') as logged_in_users_can_run,
       has_function_privilege('anon', p.oid, 'execute') as anonymous_can_run
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by 1;
```
➡ Download as `functions.csv`.

**Q6: Storage buckets** (task P0-07)
```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;
```
➡ Download as `buckets.csv`.

**Q7: Row-level security switched on per table** (task P0-07)
```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;
```
➡ Download as `rls.csv`. In the Results form, note any table where `rls_enabled` is **false**.

**Q8: Installed extensions** (helps decide D-12 and D-14)
```sql
select extname, extversion from pg_extension order by 1;
```
➡ Download as `extensions.csv`.

Files `policies.csv`, `columns.csv`, `functions.csv`, `buckets.csv`, `rls.csv` and `extensions.csv` describe the database structure only. They contain **no customer content** and **no secrets**. You can hand them to me for task P1-03.

### C2. Sign-in and email settings (task P0-08)
Go to **Authentication**. Look at each item below and write down what you see.

| Where | What to note |
|---|---|
| Sign In / Providers → **Email** | Is **"Confirm email"** on? Is **"Secure email change"** on? Is there a **"Secure password change"** (or "require recent login / reauthentication") setting, and is it on? Minimum password length? |
| **URL Configuration** | The **Site URL** exactly. The list of **Redirect URLs**: note any containing `*` (wildcards) or domains you don't recognize. |
| **Rate Limits** | The limits for emails sent per hour and sign-ins/sign-ups. |
| **Emails → SMTP Settings** | Is **custom SMTP** turned on (which provider, if shown)? If it's off, Supabase's built-in sender is used, which is intended for testing and sends very few emails per hour. |

### C3. Backups (task P0-09)
1. Go to **Database → Backups** (or **Project Settings → Add-ons**).
2. Note: are **daily backups** listed? How many days back? Is **Point-in-Time Recovery (PITR)** enabled?
3. Note your **plan** (Free / Pro / Team …), from **Project Settings → Billing** or the organization's billing page.

### C4. Staging (task P0-10)
In the Supabase organization list: is there **any other project** besides production (e.g. a staging or test project)? Note its name. Don't change anything.

---

## D. Optional: confirm two app issues in a throwaway project (task P0-11)

Use a **new test project** that you create just for this. Never use a client's project. Delete the test project afterwards if you like.

### D1. Does client feedback overwrite internal notes? (audit DI-01)
1. In the test project, create a post. In the Post Editor, type in **Notes**: `INTERNAL - do not show client` and save.
2. Create a **share link** for that post (Share icon on the Grid). Open it in a **private/incognito** window.
3. Check: **can you see the internal note text on the client page?** (Yes / No)
4. On the client page click **Approve**, then **Changes requested**, then **Approve** again.
5. Back in the app, reopen the post → look at **Notes**.
6. Note: is the original text still there unchanged? Do you see repeated `Status:` / `Client Feedback:` blocks nested inside each other? A screenshot of the Notes field is useful. It contains no secrets.

### D2. Are unsaved caption edits lost? (audit BUG-04)
1. Open a post in the test project and change the **Caption**. Don't press Save.
2. Close the editor (X, click outside, or browser Back).
3. Reopen the post.
4. Note: was your edit (a) kept, (b) lost with no warning, or (c) did you get a warning before closing?

---

## Results form (send this back; contains no secrets)

```
A1 Organization / workspaces:
A2 Key used by Flow:er — name / workspace / created / last used:
   Unrecognized other keys? yes/no
A3 Any usage? yes/no · Models seen: · Typical requests/day: · Highest day (date, count):
   Unexplained spikes? yes/no (dates):
A4 Cost this month: · Last 3 months: · Auto-reload on? (amount) · Balance:
A5 (only if done) Monthly limit set to: · Alerts to: · Auto-reload now:
A6 (only if done) Done at: · Production AI works / intentionally off: · Old key revoked? yes/no

B1 Variable scopes: (table)
B2 Preview uses production database? yes/no
B3 Preview deployments protected? yes/no (method)
B4 Max duration: · Region:
B5 Number of preview deployments (approx):

C1-Q1 profiles UPDATE check_rule: PROTECTED / VULNERABLE (paste the text)
C1-Q2 admin_count: · All admins expected? yes/no
C1-Q3..Q8 CSV files saved? yes/no · Any table with rls_enabled = false:
C2 Confirm email: · Secure email change: · Secure password change: · Min password length:
   Site URL: · Redirect URLs with wildcards/unknown domains:
   Email rate limit: · Custom SMTP: yes/no (provider)
C3 Daily backups: yes/no (days) · PITR: yes/no · Plan:
C4 Other Supabase projects:

D1 Internal note visible to client? yes/no · Notes nested/overwritten? yes/no
D2 Unsaved caption: kept / lost silently / warned
```

---

## What happens next

When you send the Results form, I'll:
1. Record the results in the roadmap (task P0-12). That's a docs-only commit on the planning branch.
2. Tell you whether anything needs **emergency** handling (e.g. VULNERABLE in Q1, or an unexpected admin in Q2).
3. Present **P1-01 (AI access guard)** for your approval, or the emergency task first if needed.
