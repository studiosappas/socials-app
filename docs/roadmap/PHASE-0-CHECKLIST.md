# Phase 0 Checklist: Dashboard Checks

**Who:** you (the owner), in your own dashboards. **What for:** to find out what's really happening in production before any code changes.

Rules for this checklist:
- **Never copy, paste, screenshot or send any API key or secret** to anyone, including me. When a step says "compare a key", compare only the **last 4 characters**, privately.
- Sections A–C are **look-only**, except the steps marked 🔒 **CONTAINMENT**. Do those only after we've agreed on them (decisions D-01, D-02 in the roadmap).
- The SQL queries in section C only **read** information. Paste each one exactly as written. If the editor ever asks you to confirm a "destructive operation", stop: something is wrong.
- Dashboard menu names change from time to time. If a label below doesn't match exactly, look for the item with the same meaning.
- Fill in the **Results form** at the end and send it back to me. It contains no secrets.

---

## A0. Where did this key come from? (P0-01 investigation, start here)

**Background:** you don't remember creating an Anthropic API account or buying API credits, yet `ANTHROPIC_API_KEY` exists in Vercel for Production and Preview.
- Having no paid Claude subscription tells us **nothing** about this key. Claude.ai subscriptions (Free/Pro/Max) and the Anthropic **API** are billed separately.
- An API key belongs to whichever API organization created it. That organization pays for its usage: from purchased credits, from any promotional credit balance, or from a card on file.
- The key may belong to an organization you created and forgot, or to someone else's organization.

### What the code investigation already established (no dashboard needed)

| Question | Finding | Evidence |
|---|---|---|
| Where is the key used? | Only in `src/lib/ai/client.ts` (three functions: `generateText`, `generateWithImages`, `analyzeDocument`). No other variable name is read. If the key is missing, the app shows "AI analysis isn't configured yet" and makes **no** call. | Repository-wide search |
| Can calls happen **automatically**? | **Yes, one path:** uploading a brand document or adding a brand link on the Overview page automatically runs a "brand intelligence refresh" (up to 4 model calls, including the whole PDF). Every other AI call needs a logged-in user to click an AI button (Brand Writer, Generate Design, Refresh insights). There are **no** scheduled jobs, cron routes or webhooks. The public landing page makes **no** AI calls (deliberately faked). | `overview-panels.tsx:829`, `overview.ts:519`; no `vercel.json`, no cron; `lib/landing/demo-create.ts` |
| Who can trigger it? | Any logged-in account, for any project (no membership check). Anonymous visitors are stopped by the login redirect. | Audit SEC-02 |
| Model | `claude-opus-5` | `client.ts` |
| Was a key ever committed to the code? | **No.** No `sk-ant-` string appears in any commit in the repository's history, and no environment file was ever committed. | `git log -S` over all history |
| When could it have been added? | Not before **2026-08-14**: my session notes from building the Brand Writer record that no key was configured then. It was added to Vercel afterwards, by someone with access to the Vercel project. The code can't tell who. | Session notes (project memory) |
| Can I check Vercel from here? | **No.** This workspace has no Vercel link and no Vercel CLI, and I won't install or log into anything to find out. | No `.vercel` folder |
| Placeholder, old key or working key? | **Can't be determined from the code.** The steps below settle it without spending money. | |

### A0.1 Look at the variable's details in Vercel (without revealing its value)
1. Vercel → your Flow:er project → **Settings → Environment Variables** → find `ANTHROPIC_API_KEY`.
2. Note, **without clicking reveal**:
   - Which environments it applies to (you said Production and Preview; also check Development).
   - The **last updated / created** date shown next to it.
   - Whether it's marked **Sensitive** (then even owners can't view it).
   - Whether it shows an **integration** badge (meaning an integration added it, not a person).
3. If your Vercel account is a **team**, open the team's **Activity** (audit log) page and search for "environment variable". It may show **who** added `ANTHROPIC_API_KEY` and **when**.
4. Note anyone else who has, or had, access to this Vercel project (team members, a developer or agency).

### A0.2 Identify what kind of value it is (private, optional)
Do this only if the value is **not** marked Sensitive and you're alone. Use the reveal button and look **only at the beginning** of the value, then hide it immediately. **Don't copy it, don't screenshot it, don't send me any characters.** Just tell me which category it matches:

| The value… | What it means |
|---|---|
| begins with `sk-ant-api` | A **real Anthropic API key**. It may be working; it belongs to some API organization. |
| begins with `sk-ant-admin` | An Anthropic **Admin key**. It doesn't work for generating text but has **organization-management powers**. **Tell me immediately**; it shouldn't be in the app at all. |
| begins with `sk-ant-oat` | A **Claude subscription login token**, not an API key. The app's code sends it in a way the API rejects, so AI calls would fail. Using subscription credentials in an app may also be outside Anthropic's terms (verify). **Tell me.** |
| is empty, very short, or text like `your-key-here`, `xxx`, `test` | A **placeholder**. Not functional. |
| anything else | Probably another provider's key, or garbage. Not functional with this code. |

### A0.3 Find out whether *you* own an Anthropic API organization
1. Go to the **Anthropic Console** (console.anthropic.com). If it redirects to a newer Claude platform address, follow it.
2. Try to sign in with **each email or Google account you use**, including the one you use for Claude and for Vercel.
3. For each: does it show an **organization** (a dashboard with API Keys, Usage, Billing)? Or does it ask you to create a new account or organization?
   - **Don't create anything new yet.**
4. If an organization appears: go to **Settings → API Keys** and look for a key whose **ending characters** match the Vercel value. The Console shows a short hint for each key. Compare privately, as in A2. Then continue with sections A1–A4 below.
5. If **no** email leads to an existing organization, the key most likely belongs to **someone else's** organization. Go to A0.5.

### A0.4 Check for traces of AI actually working (no cost, read-only)
If the key ever worked, successful AI results were saved in your database. In **Supabase → SQL Editor**, run each query (they only count; they show no content):

**Q-AI1: brand summaries and insights written by AI**
```sql
select count(*) filter (where ai_summary <> '') as projects_with_ai_summary,
       count(*) filter (where ai_insights is not null) as projects_with_ai_insights,
       max(ai_insights_updated_at) as last_ai_insights_at
from public.brand_strategy;
```

**Q-AI2: what happened to uploaded brand documents**
```sql
select case
         when ai_analysis = '' then 'empty'
         when ai_analysis like 'AI analysis isn''t configured%' then 'key was missing at that time'
         when ai_analysis like 'Links are used as context%' then 'link (no AI call made)'
         when ai_analysis like 'Only PDF analysis%' then 'non-PDF (no AI call made)'
         else 'looks like real AI output'
       end as outcome,
       count(*) as documents,
       min(created_at) as first_upload,
       max(created_at) as last_upload
from public.brand_documents
group by 1
order by 1;
```

**Q-AI3: "AI finished analyzing" notifications (sent only after a fully successful AI refresh)**
```sql
select count(*) as ai_success_notifications,
       min(created_at) as first_seen,
       max(created_at) as last_seen
from public.notifications
where event_key = 'ai_analysis_complete';
```

How to read the results:
- Any non-zero `projects_with_ai_insights`, any `looks like real AI output` rows, or any `ai_success_notifications` → **the key has worked at least once**, on those dates, and some organization was billed.
- All zero, or only `key was missing at that time` → no evidence it has ever produced output.
- Caveat: this doesn't prove the key is dead; it may simply never have been used since it was added.

### A0.5 Check Vercel logs for AI errors (no cost, read-only)
In Vercel → the project → **Logs** (or Observability → Logs), choose the longest period available and search for each term separately:

| Search term | If you find it, it means |
|---|---|
| `authentication_error` or `invalid x-api-key` | The key is **invalid or revoked**: not functional |
| `credit balance` | The key is **valid**, but its organization has **no money**: not currently functional, becomes functional the moment someone adds credit |
| `permission_error` | The key exists but isn't allowed to do this |
| `rate_limit_error` or `overloaded_error` | The key is **valid and was being used** |
| `AI analysis isn't configured` | That deployment ran **without** the key |

Note which terms appear, with approximate dates. Don't copy log lines that contain long random strings.

### A0.6 Decide: who controls this key's billing?

| Situation | What we do |
|---|---|
| **A.** The key is in **your** Anthropic organization (A0.3 found it) | Continue with A1–A5 (usage, cost, spend cap), then A6 (rotate it into a Production-only key you control). |
| **B.** A known **collaborator** added it from **their** organization | Ask them for the usage and cost history. Then replace it with your own key (A6) and have them revoke theirs. Your customers' brand content should only go to an account **you** control. |
| **C.** The value is a **placeholder**, a subscription token (`sk-ant-oat`), another provider's key, or logs show `authentication_error` | It's not functional. Remove it (A0.7). No billing risk from it, but it should not stay. |
| **D.** It's a **real API key** and its **origin or billing owner can't be established** | Treat it as **uncontrolled**. Apply A0.7 containment now. Reasons: you can't see or cap its spending; you don't know under whose terms your customers' content is being processed; and whoever owns it can use it elsewhere or revoke it at any moment. |

### A0.7 🔒 DISCONNECTION RUNBOOK (decision D-23, owner-approved in principle on 2026-09-27; execution needs a separate approval)

**Owner decision (2026-09-27):**
- The key's owner, billing, validity and usage can't be established. Its format resembles a genuine Anthropic API key, and it was added to Vercel on August 7.
- Flow:er will be **disconnected** from it.
- The key will **not** be deleted or revoked at Anthropic. Claude Code authentication is **not** changed.
- Production changes need a separate, explicit approval after the preflight report (below).

#### Preflight findings (verified 2026-09-27, code inspection only, no paid calls)

**1. What happens to each feature once the key is gone.** With no key, `src/lib/ai/client.ts` returns a "not configured" result **before** creating any Anthropic client. It doesn't throw, and no network call is made.

| Feature | Where | Behavior without the key | Data impact |
|---|---|---|---|
| Brand Writer (Post Editor caption, Brief text) | `components/ai/brand-writer.tsx` → `brand-writer.ts:generateBrandCopy` | Shows the error text in the writer panel | None |
| Generate Design (Brief) | `brief-board.tsx:690` → `brief.ts:generateBriefDesign` | Shows the error under the button. It returns **before** any upload or DB write. | None |
| Refresh AI summary/sections (Overview) | `overview-panels.tsx:1062` → `generateBrandSummary`, `generateBrandSections` | Shows the error | None (returns before `upsert`) |
| Suggest personality spectrum | `overview-panels.tsx:1073` → `suggestPersonalitySpectrum` | Shows the error | None |
| AI insights refresh | `overview-panels.tsx:1312` → `generateAiInsights` | Shows the error | None |
| **Automatic refresh after adding a brand link** | `overview-panels.tsx:829` → `refreshBrandIntelligence` | 3 attempts, each returns "not configured"; the result is **ignored by the client**. **Nothing is shown.** | None. The link row is saved **before** any AI runs. |
| **Automatic analysis after uploading a PDF** | `refreshBrandIntelligence` → `analyzeBrandDocument` | **Writes the text "AI analysis isn't configured yet — set ANTHROPIC_API_KEY to enable this." into the new document's `ai_analysis`**, which then displays under the document | The document and file are saved **before** AI runs (not lost). The analysis field gets a placeholder message. |
| **Manual "Analyze" button on any uploaded file** | `overview-panels.tsx:905/979` → `analyzeBrandDocument` | The button shows for **every** file document, including already-analyzed ones. It **overwrites** the existing `ai_analysis` with the same message. | ⚠ **Data loss:** any previously real AI analysis on that document is replaced |
| Non-PDF uploads (.doc, .docx, .txt) | `analyzeBrandDocument` | Stores "Only PDF analysis is supported right now." (no AI call, same as today) | Unchanged |
| Everything else: auth, projects, Grid, Library, Post Editor, scheduling, Stories, Calendar, Tasks, sharing, exports, landing page | none | **No dependency on AI.** No non-AI code path waits on or requires an AI response (verified by search: the only importers of `lib/ai/client` are `brand-writer.ts`, `overview.ts`, `brief.ts`). | None |

**2. Other non-AI dependencies:** none. The key is read only in `src/lib/ai/client.ts`. No other code or configuration references it, and no cron jobs, webhooks or scheduled tasks exist.

**3. Claude Code dependency: none.**
- Neither the local shell nor the Windows user/machine environment defines `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_BASE_URL` (checked by **name only**; only Claude Code's own session variables exist).
- There's no `~/.claude/settings.json`, and no project `.claude/settings*.json`, so there's no `apiKeyHelper` and no environment override.
- Claude Code runs on your machine with your Claude Pro login. The Vercel variable is only read by Flow:er's server on Vercel. Removing it can't affect Claude Code, and nothing here changes Claude Code.

**4. Vercel access: not available to me.** No Vercel CLI, no project link, no Vercel credentials on this machine. Every Vercel step below is manual, and I guide you through it.

#### Before you start (5 minutes, read-only)
1. **Run query Q-AI2 (section A0.4)** and note whether any row says **"looks like real AI output"**.
   - If **yes**, real analyses exist, and the "Analyze" button could overwrite them after disconnection. Choose one:
     - (i) Approve the small code fix **P1-00** first (see the roadmap).
     - (ii) Proceed, and tell your team **not to click "Analyze"** on existing documents until P1-00 ships.
   - If **no**, there's nothing to overwrite; proceed.
2. Write down the **current Production deployment**: Vercel → Deployments → the one marked **Current** / Production: its date and commit (it should be `9300c00`, "Merge branch 'fix/media-loading-and-mobile-video-icon'"). It's your rollback target.
3. Check **B2** (does Preview use the production database?) and **B3** (is Preview protected?). They decide step E below.

#### A. Remove the variable from the Flow:er project only
1. Vercel → Flow:er project → **Settings → Environment Variables**.
2. Search `ANTHROPIC`. There may be **more than one row** with this name: one per environment, or a Preview row limited to a specific git branch. Note every row.
3. For each row, check whether it's a **project** variable or a **shared/team** variable: shared ones show a link or "Shared" marker and are managed in **Team Settings → Environment Variables**.
   - **Project variable:** open its ⋯ menu → **Remove**. Don't reveal or copy it.
   - **Shared variable:** don't delete it globally, because other projects may use it. Open it in Team Settings and **unlink the Flow:er project only**. Note which other projects are linked.
4. Remove it from **Production, Preview and Development**. Don't touch any other variable.
5. Refresh the page and search `ANTHROPIC` again: **no rows** should remain for Flow:er.

#### B. Make sure it can't come back
1. **Team Settings → Environment Variables** (shared): search `ANTHROPIC` and confirm none is still linked to Flow:er.
2. Project → **Integrations**: note any installed integration that says it manages environment variables. Don't remove anything; just tell me.
3. Repository: already verified. No `.env` file is committed (`.env*` is git-ignored), there's no `vercel.json`, and the code has no hard-coded key.

#### C. Redeploy Production without the variable
1. Vercel → **Deployments** → the **Current** Production deployment → ⋯ → **Redeploy**. Keep the same commit; the build cache is fine.
2. Wait for **Ready**, then confirm this new deployment is now marked **Current** and serves your production domain.
3. Note the time.

#### D. Verify Production (see "Regression checks" below)
Run all checks. **Don't declare success until every check passes.**

#### E. Existing deployments that still hold the key
Removing the variable does **not** change deployments that already exist. This includes **old Preview deployments** and **old Production deployments**, which stay reachable through their own `…vercel.app` deployment URLs. They keep the key until its unknown owner revokes it. Options, in order of preference:
1. **Protect them (reversible, keeps rollback targets):** Settings → **Deployment Protection** → turn on **Vercel Authentication** with the scope that covers **all deployment URLs except your production domain** (the wording varies, e.g. "Standard Protection"; choose the option that isn't limited to Previews only). After that, only members of your Vercel team can open those URLs.
2. **Delete old Preview deployments** you don't need: Deployments → filter **Preview** → ⋯ → **Delete**. This can't be undone; that's fine for previews.
3. Keep at least the **previous Production deployment** (your rollback target) until the new one is verified. Protect it rather than delete it.

#### F. Future Preview deployments
Because the variable no longer has a Preview scope, new Preview deployments are built without it. **Check** this on the next Preview deployment (the first feature branch we push): its AI buttons must show the "not configured" message.

#### Expected user-visible changes after disconnection
- Every AI button shows **"AI analysis isn't configured yet — set ANTHROPIC_API_KEY to enable this."** This wording exposes a technical variable name to customers. It becomes neutral wording in P1-00 / P1-01.
- Newly uploaded PDFs show that same sentence as their "analysis".
- Adding a brand link: saved normally. No AI message appears, and no new AI summary is produced.
- Nothing else changes.

#### Regression checks after redeploy (you, on the production domain, with a throwaway test project)
| # | Check | Pass criteria |
|---|---|---|
| 1 | Log out → **register** a test account (or log in with an existing test account) → **log in** | Lands on Projects |
| 2 | **Create a project**, open Overview, Grid, Calendar, Content/Stories, Brief, Tasks, Settings | Every page loads, no error page |
| 3 | **Overview → Brand knowledge → upload a small PDF** | The document appears in the list; after a refresh it's still there; its analysis says AI isn't configured; no crash |
| 4 | **Overview → add a brand link** | The link appears and persists after a refresh |
| 5 | **Overview → Refresh AI / Suggest spectrum / Insights refresh** | A readable "not configured" message; existing text unchanged |
| 6 | **Grid:** upload an image, place it in a slot, refresh | The image persists and shows |
| 7 | **Media Library:** open, scroll, pick an image | Thumbnails load |
| 8 | **Post Editor:** open a post, edit the caption, set the date and time, **Save**, close, reopen, refresh | All values persist |
| 9 | **Post Editor → AI/Brand Writer button** | Shows the "not configured" message; the caption is untouched |
| 10 | **Brief → Generate Design** | Shows the "not configured" message; no new asset is created |
| 11 | **Client review link:** create a share link, open it in a private window | Gallery loads; Approve works |
| 12 | **Anthropic spend:** you can't see this key's usage. Skip it; recorded as an unresolved risk. | n/a |
| 13 | On a **Preview** deployment (next time one exists): the AI button shows "not configured" | Confirms F |

#### Rollback
- **If Production breaks for any reason after C:** Vercel → Deployments → your noted previous Production deployment → **Instant Rollback** (or "Promote to Production"). This restores the previous behavior, **including the old key**, because old deployments keep their environment. Then tell me.
- **The variable itself can't be re-added** without its value, and we don't have the value and must not store it. So for this disconnection, rollback means **promoting the previous deployment**, not re-creating the variable.
- Deployment Protection can be turned off again at any time.

#### Unresolved risks (remain after disconnection)
1. **The key stays valid** wherever else it's used, until its unknown owner revokes it. We can't say it's disabled.
2. **Deployments you keep** (protected ones) still contain it. Protection limits who can reach them; it doesn't remove the key.
3. **Past usage and cost are unknown.** If Q-AI1/Q-AI2/Q-AI3 show real AI output, some of your customers' brand content has already been sent to Anthropic under an organization you don't control.
4. **Placeholder analysis text** accumulates on new PDF uploads until P1-00 or P1-01. It's recognizable by its fixed wording and can be cleaned later.
5. **The "Analyze" overwrite risk** (see "Before you start") until P1-00.
6. **Preview → production database** (B2) is still unknown. It doesn't affect the disconnection, but it affects how we test future branches.

---

## A. Anthropic (for an organization you control)

Only continue here if A0.3 found **your** organization (situation A), or later, once you've created your own organization for Flow:er.

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
A0.1 Vercel variable — environments: · last updated: · marked Sensitive? · integration badge?
     Activity log shows who added it? (name/date, or "not available"):
     Other people with Vercel project access:
A0.2 Value category (only if checked): sk-ant-api / sk-ant-admin / sk-ant-oat / placeholder / other / not checked
A0.3 Existing Anthropic organization under any of your emails? yes (which login) / no
     Matching key found there? yes/no
A0.4 Q-AI1 projects_with_ai_summary: · projects_with_ai_insights: · last_ai_insights_at:
     Q-AI2 outcomes (outcome → documents, dates):
     Q-AI3 ai_success_notifications: · first/last seen:
A0.5 Log terms found (term → approx. dates):
A0.6 Situation: A / B / C / D
A0.7 Before-you-start: Q-AI2 "real AI output" rows? yes/no · Chosen path (P1-00 first / proceed + no-Analyze rule):
     Rollback target (Production deployment date / commit):
     A: rows found (count, project vs shared, other linked projects):  · removed at:
     B: shared link remaining? · integrations managing env vars:
     C: redeployed at: · new deployment is Current? yes/no
     D: regression checks 1–11 passed? (list any failures)
     E: protection enabled (which scope) / previews deleted (count) / previous Production kept?
     F: (later) first new Preview shows "not configured"? yes/no

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
