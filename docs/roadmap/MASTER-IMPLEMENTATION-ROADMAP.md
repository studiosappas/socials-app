# Flow:er: Master Implementation Roadmap

**Single source of truth** for security remediation, AI integration and launch readiness.

| | |
|---|---|
| Created | 2026-09-27 |
| Planning branch | `plan/security-ai-launch-roadmap` (docs only) |
| Code baseline | `origin/main` @ `9300c00`. Verified: no commits merged since the audit. |
| Audit source | branch `audit/full-product-prelaunch` @ `9b4a49c` (7 documents in `docs/audit/`, not merged). Finding IDs used below (SEC-, DI-, BUG-, PERF-, MF-) refer to those documents. |
| New facts since the audit | (1) `ANTHROPIC_API_KEY` is set in Vercel **Production and Preview** (owner-confirmed). Actual usage is not yet verified. (2) Code check: uploading a brand document or adding a brand link **automatically** triggers `refreshBrandIntelligence` (`overview-panels.tsx:829` → `overview.ts:519`), i.e. up to 4 Opus calls per upload, including the full PDF. |

---

## Status dashboard

> Update this block at every status change (see §4, "Roadmap maintenance").

| | |
|---|---|
| **Current phase** | Phase 0: Immediate risk containment and verification |
| **Current task** | P0-01 / D-23: **disconnection PREFLIGHT COMPLETE** (2026-09-27), **awaiting your explicit approval to execute** checklist A0.7 (manual Vercel steps; I have no Vercel access). The key's origin and billing owner **can't be established** (owner-confirmed). Its format resembles a genuine key; it was added August 7. Decision: disconnect from Flow:er only; don't revoke; don't change Claude Code. |
| **Completed tasks** | none |
| **Blocked tasks** | Every task that needs a migration is blocked until P0-07 (schema snapshot) and P1-03 (migration baseline) are done. |
| **Open decisions** | D-01 … D-23 (§5). Decisions needed **before Phase 0 containment**: D-01, D-02, D-23. |
| **Top open risks** | R-1 AI spend exposure (live key); R-2 possible admin self-escalation (SEC-01, unverified); R-3 cross-tenant email exposure (SEC-05); R-4 preview deployments may run against production data (P0-05). |

### Task status index

| Phase | Tasks | Status |
|---|---|---|
| 0 | P0-01 … P0-12 | P0-01 IN PROGRESS (disconnection preflight complete; execution awaiting approval); P0-02 … P0-12 NOT STARTED |
| 1 (added) | P1-00 | NOT STARTED (proposed by the D-23 preflight; see the ordering note) |
| 1 | P1-01 … P1-12 | NOT STARTED |
| 2 | P2-01 … P2-07 | NOT STARTED |
| 3 | P3-01 … P3-09 (+ P3-M1 … P3-M4 deferred to monetization) | NOT STARTED |
| 4 | P4-01 … P4-07 | NOT STARTED |
| 5 | P5-01 … P5-22 | NOT STARTED |
| 6 | P6-01 … P6-08 | NOT STARTED |

---

## 1. Phase sequence and validation

The proposed order (0 → 6) holds, with **four changes**:

| Change | Reason |
|---|---|
| **1. AI authorization guard moved to the front of Phase 1 (P1-01)** and designed as the first slice of the Phase 2 gateway, so it isn't throwaway work. | The key is live in Production and Preview. Any registered account can trigger unlimited Opus calls for any project today (SEC-02). Phase 0 contains this through dashboard controls; P1-01 is the permanent code fix and must come before anything else. |
| **2. Client-feedback corruption and internal-notes exposure (DI-01, with SEC-07) moved from launch-phase work into Phase 1 (P1-09).** | This is **current** data loss and a **current** leak: every real client review rewrites the team's Notes and shows internal notes to clients. Waiting until after AI would keep damaging customer data. |
| **3. Silent write failures on destructive actions (DI-02) moved into Phase 1 (P1-10).** | Current users can lose work or see a false "deleted/saved" state. It's code-only, has no AI dependency and can run in parallel with Phase 2. |
| **4. Migration baseline (DI-04) made an explicit Phase 1 task (P1-03) that blocks every later migration.** | Four Phase 1 fixes and most AI infrastructure need migrations. Applying them to an undocumented production schema is the biggest avoidable risk in the whole plan. |

Other ordering notes:
- **SEC-05 (email exposure) stays in Phase 1**, before AI, because it's an active cross-tenant leak and AI context builders will rely on RLS meaning "only my collaborators".
- **Phases 2 and 3 are one continuous build.** Phase 2 creates the gateway, usage ledger and controls; Phase 3 adds money (credits and limits). AI features stay behind the kill switch, available only to a site-admin allowlist, until Phase 4 passes.
- **Phase 5 has no dependency on Phases 2–4**, apart from P5-04 (legal pages must mention AI processing before the public AI launch). Phase 5 tasks can be approved alongside the AI work whenever it's safe to interleave them (§3).
- **Monetization** tasks (P3-M1 … M4) are listed but deferred. They can happen after launch if the launch is free.

### Dependency graph (summary)

```
P0 (verify and contain) ──► P1-01 AI guard ──► P2 gateway ──► P3 credits/limits ──► P4 AI QA ──► AI enabled for all users
                        ├─► P1-02 open redirect (independent)
                        └─► P0-07 snapshot ──► P1-03 migration baseline ──► P1-04..P1-08 (RLS migrations)
                                                                        ├──► P2-03 AI tables ──► P3 …
                                                                        └──► P5 migrations (invitations, deletion …)
P1-09 feedback fix, P1-10 silent writes: independent, code-first
P5-*: mostly independent; P5-04 legal → required before the public AI launch
P6: after everything that ships at launch
```

---

## 2. Implementation workflow (mandatory)

Every task follows these steps. **Nothing is merged automatically, and no task starts without explicit approval.**

| Step | What happens | Who |
|---|---|---|
| **A** | I present the next task: scope, files, migration (yes/no), risks, test plan, and what is out of scope. | Claude |
| **B** | Wait for explicit approval ("Approved: P1-02"). | You |
| **C** | `git fetch`, verify that `main == origin/main`, and create `fix/<task-id>-<slug>` or `feat/<task-id>-<slug>` from the latest `origin/main`. | Claude |
| **D** | Implement **only** the approved task. Never touch `docs/roadmap/` in a feature branch. | Claude |
| **E** | Run `npx tsc --noEmit`, `npm run lint`, `npm run build`, the existing unit tests, and the task's new tests. Report failures verbatim. | Claude |
| **F** | Commit and push the feature branch. **Note:** every push creates a Vercel Preview deployment. Until P0-05 confirms preview isolation, treat Preview deployments as connected to production data. | Claude |
| **G** | Provide exact manual QA steps: which URL, which account, expected results, and what to screenshot. For migrations: the SQL for you to run, its verification query and its rollback SQL. | Claude |
| **H** | Wait for your QA result. | You |
| **I** | If QA fails, fix on the **same** branch and repeat E–H. | Claude |
| **J** | Only after "Approved for merge": merge into the latest `main`, re-run tsc, lint and build on the merged result, push, and verify local `main == origin/main`. | Claude, after approval |
| **K** | Update this roadmap (status, date, commit) on the planning branch (§4) and present the next task (back to A). | Claude |

**Migration rules:**
- A migration file is committed in the feature branch (`supabase/migrations/<timestamp>_<task-id>.sql`) together with a matching `…_rollback.sql` and a read-only verification query.
- **You** apply it (SQL editor or CLI; decided in P1-03). I never run SQL against production.
- A migration and the application code that depends on it ship in one task only when the code is backward compatible with the old schema, or when the migration is applied first and verified in Step G.

**Never combine** unrelated security fixes, unrelated database changes, or a database change with an unrelated UI change in one branch.

---

## 3. Batching rules

| May be done together (one branch) | Why it's safe |
|---|---|
| P1-06 (restrict the email lookup RPC) **with** its DI-06 case-normalization | Same function, same caller (`inviteMember`) |
| P1-09 (feedback storage) **with** SEC-07 caps on the same RPCs | Same RPCs and UI |
| P2-01 (gateway) **with** migrating the 8 AI call sites | The gateway is useless without them; one reviewable change |
| P5-12 (security headers) **with** P5-15 (`SITE_URL`) | Both configuration-level, no data |
| P5-19/P5-20 small UX items | Independent, low risk; only if you approve batching |

| Must stay separate | Why |
|---|---|
| P1-04 (profiles `is_admin` policy), P1-05 (profiles SELECT), P1-07 (membership policy) | Each is an RLS change with its own blast radius and rollback |
| P1-01 (AI guard) vs P2-01 (gateway) | P1-01 must ship fast and small |
| Any migration vs unrelated UI work | Separate rollback paths |
| P3-01 (credit tables and functions) vs P3-03 (wiring the gateway to credits) | Money logic is verified at the DB level first |
| P5-01 (invitations) vs P5-02 (account deletion) | Both touch membership and auth; separate QA |

---

## 4. Roadmap maintenance

- This roadmap lives on `plan/security-ai-launch-roadmap`. **That branch only ever changes files under `docs/`.** Before every push I verify it with `git diff --name-only origin/main...HEAD`, which must list only `docs/…`.
- **Feature branches never edit the roadmap.** So implementation branches can never carry roadmap changes, and the roadmap branch can never carry code.
- At Step K, I rebase the planning branch onto the new `origin/main`. Docs-only, so conflict-free. I then update the status dashboard, the task's status, its merge commit and verification date, and push.
- The planning branch is merged into `main` **only with your explicit approval**, e.g. at phase boundaries, as a docs-only merge that I verify in the same way.
- Status values:

| Status | Meaning |
|---|---|
| NOT STARTED | Planned; not yet proposed |
| BLOCKED | Waiting on a dependency or decision (named in the task) |
| READY FOR APPROVAL | Scope presented (Step A); awaiting your approval |
| IN PROGRESS | Approved; being implemented on its branch |
| AWAITING QA | Pushed; your manual QA pending |
| QA FAILED | QA found an issue; fixing on the same branch |
| APPROVED FOR MERGE | You approved the merge |
| MERGED | On `main`; checks passed |
| VERIFIED | Confirmed working in production (post-merge check done) |

Dashboard-only tasks (Phase 0) go NOT STARTED → READY FOR APPROVAL → IN PROGRESS (you are doing them) → VERIFIED, and skip the merge states.

---

## 5. Decisions required

**I won't invent prices, credit sizes, limits or plan names.** Every value below is yours to choose. Where useful I list the options and what each one implies.

| ID | Decision | Needed before | Notes |
|---|---|---|---|
| D-01 | Keep AI features live in Production until P1-01 ships, or switch them off (remove the key)? | P0-04 | Off = features show "AI analysis isn't configured yet" (a graceful message; checked in `client.ts`). Brand document uploads will then store that text as the document's analysis (`overview.ts:341`). |
| D-02 | Remove the key from the **Preview** environment now? | P0-03 | Recommended: yes. Previews don't need real AI, and every branch push creates one. |
| D-03 | Staging environment: separate Supabase project / Supabase branching / none (test migrations on production with rollback scripts) | P1-03 | "None" makes every migration a production experiment. |
| D-04 | Which roles may use AI (owner, admin, editor, designer, client, viewer)? | P1-01 | Defaults to the least-privileged answer if undecided: owner/admin/editor only. |
| D-05 | Migration tooling: Supabase CLI migrations vs hand-run SQL files kept in a numbered folder | P1-03 | CLI gives a history table; hand-run needs discipline. |
| D-06 | Credit unit: fixed credits per operation vs credits derived from actual tokens | P3-01 | Affects the UX ("1 caption = X credits") and margin predictability. |
| D-07 | Free allowance: amount, period (one-off vs monthly) and scope | P3-02 | Not invented here. |
| D-08 | Who is charged when a member uses AI inside someone else's project: the acting user, or the project owner? | P3-01 | Determines whether credit accounts are per user or per workspace/owner. |
| D-09 | Model per operation (keep `claude-opus-5` everywhere, or choose per feature), and whether to keep thinking disabled | P2-01 | The Claude API reference recommends adaptive thinking with low effort over disabled thinking; your cost/quality decision. |
| D-10 | Monthly provider spend cap (Anthropic Console) and the daily app-level circuit-breaker threshold | P0-02 / P3-05 | Amounts are yours. |
| D-11 | Per-user limits: requests per minute, concurrent operations, daily cap | P3-04 | |
| D-12 | Rate-limit store: Postgres (no new vendor) vs a Redis service such as Upstash (new vendor, faster) | P2-05 | |
| D-13 | Error monitoring vendor (e.g. Sentry) or none | P2-06 | A new processor of error data, so a privacy policy entry is needed. |
| D-14 | Scheduler for reservation sweeps and allowance resets: Vercel Cron vs Supabase `pg_cron` | P3-06 | |
| D-15 | AI prompt/output retention: store nothing (metadata only) vs store for N days for support | P2-03 | Legal input recommended. |
| D-16 | Document-analysis limits: maximum PDF size and pages per analysis; keep auto-analysis on upload, or make it opt-in | P1-01 / P3-09 | Auto-analysis spends on every upload today. |
| D-17 | Client-feedback model: separate field vs threaded comments; may clients ever see internal notes? | P1-09 | Recommended: separate storage; clients never see internal notes. |
| D-18 | Brief media: stays public (current, by design) vs private with signed URLs | P5-13 | |
| D-19 | Concurrent editing: warn-on-conflict vs block vs accept last-write-wins | P5-08 | |
| D-20 | Transactional email provider, and whether Supabase Auth mail moves to custom SMTP | P5-05 | |
| D-21 | Account deletion policy for projects the user owns (require transfer / delete / auto-transfer) | P5-02 | |
| D-22 | Payment provider, plans, credit pack prices, subscription allowances | P3-M1 | Monetization only; not needed for the AI activation. |
| D-23 | If the key's origin or billing owner can't be established (checklist situation C or D): apply A0.7 containment (remove the key everywhere; AI features show "not configured") | P0-03 | Recommended: yes. For old Previews: delete them, or enable Deployment Protection. |

---

## 6. Phases and tasks

**Task field legend:**
- **Risk:** the risk of making the change (Low / Medium / High).
- **Complexity:** S = one small surface, M = several files or one migration, L = several migrations plus UI plus tests. No time estimates are given.
- **Dash:** whether your dashboard access is required.
- **Mig:** whether a database migration is required.

---

### PHASE 0: Immediate risk containment and verification

Mostly **your** dashboard work, guided step by step in `PHASE-0-CHECKLIST.md`. No application code changes.

What code inspection has already established (no dashboard needed):
- 8 AI entry points call Anthropic before any session or membership check (SEC-02). `generateBriefDesign` checks the session only.
- The proxy blocks **anonymous** access to the pages hosting these actions, so exposure is **any registered account**, and signup is open.
- Brand document and link uploads auto-trigger up to 4 Opus calls.
- The model is `claude-opus-5` in `src/lib/ai/client.ts` (listed at $5 / $25 per million input/output tokens in the Claude API reference, cached 2026-06-24; verify current pricing in the Console).
- No usage is recorded anywhere in the app. **The only source of truth for current spend is the Anthropic Console.**

#### P0-01: Anthropic key investigation, inventory and usage/spend review
- **Objective:** establish where the key came from, who controls its billing, whether it's functional, and what it has been used for and cost.
- **Ref:** SEC-02, BUG-02, AI-readiness §6.
- **New fact (2026-09-27):** the owner doesn't recall creating an Anthropic API account or buying API credits. Code-side investigation, done without Vercel or Anthropic access and without reading the key:
  - The key is read only in `src/lib/ai/client.ts`.
  - The only **automatic** trigger is the brand document/link upload refresh (`overview-panels.tsx:829`). There are no cron jobs, webhooks, or AI calls from the public landing page.
  - No key ever appears in git history.
  - The key was not configured as of 2026-08-14 (session notes), so it was added to Vercel after that by someone with project access.
  - Whether it's a placeholder, an old key or a working key **can't be determined from the code**.
  - Having no Claude subscription is **not** evidence that the key is inactive (API billing is separate).
- **Affected:** Vercel (variable metadata, activity log, logs), Anthropic Console (organizations, API keys, usage, cost, billing), Supabase (read-only count queries).
- **Implementation:** none by me. Checklist **A0** (origin investigation: A0.1 Vercel metadata, A0.2 private value-category check, A0.3 organization ownership, A0.4 zero-cost DB evidence of successful AI calls, A0.5 zero-cost log evidence, A0.6 decision table), then A1–A4 if the organization is yours.
- **Update 2026-09-27 (owner):**
  - Claude Code runs on a Claude Pro login. The key was added on August 7, and its format resembles a genuine key.
  - Owner, billing, validity and usage **can't be established** → situation D.
  - D-23 approved in principle: disconnect from Flow:er only (no revocation, no Claude Code change); execution needs a separate approval.
  - Preflight (checklist A0.7): no non-AI dependency, and no Claude Code dependency (no `ANTHROPIC_*` variables anywhere locally, no Claude settings overrides). No Vercel access for me, so the steps are manual.
  - New finding **R-13** leads to proposed task **P1-00**.
- **Outcome drives P0-03:**
  - Situation A (your organization) → rotate within your organization.
  - Situations B, C, D (a collaborator's, non-functional, or unknown) → **A0.7 containment** (remove the variable from all environments, redeploy Production, delete or protect old Previews; revocation only possible by the owning organization), then create your own organization later for AI activation.
- **Dependencies:** none. **Risk:** none (read-only). **Complexity:** S.
- **Automated tests:** n/a.
- **Manual QA / completion:** you record, without any key values: the organization/workspace the key belongs to, the key's "last used" date, monthly usage and cost for the last 3 months, any unexplained spikes, and whether auto-reload or credit top-up is on.
- **Rollback:** n/a. **Dash:** yes. **Mig:** no.

#### P0-02: Provider-level spend containment
- **Objective:** cap the worst-case bill **before** anything else, with no impact on the app.
- **Ref:** AI-readiness §6 ("provider-level hard limit").
- **Implementation:** you set a monthly spend limit (D-10), spend notifications, and turn off or restrict auto-reload. Checklist A5.
- **Dependencies:** P0-01; your approval. **Risk:** Low. If the limit is hit, AI calls fail; today that surfaces as a generic error (BUG-02) until P1-01. **Complexity:** S.
- **Completion:** the limit is visible in the Console and an alert email address is set.
- **Rollback:** raise or remove the limit. **Dash:** yes. **Mig:** no.

#### P0-03: Key rotation and Preview removal
- **Objective:** cut off AI access from every old Preview deployment, and scope the key to Production only.
- **Ref:** SEC-02; new fact (the key is in Preview).
- **Implementation:** create a new key (ideally in a dedicated "Flow:er Production" workspace that has its own limit), set it in Vercel **Production only**, delete the variable from Preview, redeploy Production, confirm AI still works (or remains intentionally off per D-01), then **revoke the old key**. Checklist A6 and B2.
- **Why rotation and not just deletion:** Vercel env changes apply only to new deployments. Existing Preview deployments keep the old value until that key is revoked.
- **Dependencies:** D-01, D-02, P0-01; your approval. **Risk:** Medium (production redeploy). **Complexity:** S.
- **Manual QA:** after redeploy, open the Post Editor → Brand Writer: it works (or shows "not configured" if D-01 = off). Anthropic Console → the old key shows revoked.
- **Rollback:** put the previous deployment back via Vercel's "Instant Rollback". A revoked key can't be un-revoked; create another one if needed.
- **Dash:** yes (Vercel and Anthropic). **Mig:** no.

#### P0-04: Production AI availability decision (D-01)
- **Objective:** decide whether AI stays on for Production users until P1-01 is merged.
- **Options:**
  - (a) Keep on, with P0-02 limits: current users keep AI, exposure is capped by the spend limit.
  - (b) Turn off by removing the Production key and redeploying: zero exposure; users see "AI analysis isn't configured yet".
- **Recommendation:** (a) only if customers actively use AI **and** P0-02 is in place; otherwise (b).
- **Dash:** yes (only for b). **Mig:** no. **Risk:** Low.

#### P0-05: Vercel environment and Preview isolation check
- **Objective:** find out whether Preview deployments (created on every branch push, including this plan's future feature branches) use the **production** Supabase project and are publicly reachable.
- **Ref:** new finding (R-4); workflow Step F.
- **Implementation:** checklist B1–B4 (names and environment scopes only; never values).
- **Completion:** recorded answers:
  - Does Preview's `NEXT_PUBLIC_SUPABASE_URL` point to the same project as Production?
  - Is `SUPABASE_SERVICE_ROLE_KEY` present in Preview?
  - Is Vercel Deployment Protection on for Previews?
  - What is the Function max duration and region?
- **Follow-up:** if Previews use production data and are public, decide between enabling protection or pointing Preview at staging (D-03).
- **Dash:** yes. **Mig:** no. **Risk:** none.

#### P0-06: Admin-privilege verification (SEC-01)
- **Objective:** find out whether any user can self-grant `is_admin`, and whether anyone already has.
- **Implementation:** you run two **read-only** SQL queries (checklist C1-Q1, C1-Q2) and share: the policy's `with_check` text, and the **count** of admin accounts plus whether each is expected (don't share emails if you prefer not to).
- **Branching:**
  - Fixed policy present and only expected admins → SEC-01 is downgraded; P1-04 becomes a repository-alignment task.
  - Policy vulnerable → P1-04 becomes the **next task immediately** after P1-01, marked emergency.
  - An unexpected admin exists → **incident**: remove the flag (you, via SQL, with my guidance), rotate the service-role key, review the admin-area actions. P1-04 goes first.
- **Dash:** yes. **Mig:** no. **Risk:** none (read-only).

#### P0-07: Production schema, RLS, function and bucket snapshot
- **Objective:** capture the real production schema, so every later migration is written against reality (DI-04).
- **Implementation:** you run the read-only export queries (checklist C1-Q3 … Q6) and download the results as CSV, or use the Supabase CLI `db dump --schema-only` if you prefer (decided in D-05). The files contain no customer data.
- **Completion:** the snapshot files are handed to me; P1-03 turns them into the migration baseline.
- **Dash:** yes. **Mig:** no. **Risk:** none.

#### P0-08: Supabase Auth and email configuration review
- **Objective:** confirm the settings the audit couldn't see (SEC-12, SEC-13, MF-12, MF-13): email confirmation, secure email change, secure password change, Site URL and Redirect URL allowlist (look for broad wildcards), auth rate limits, SMTP provider (the built-in one is meant for testing and is heavily limited).
- **Implementation:** checklist C2. **Dash:** yes. **Mig:** no. **Risk:** none.

#### P0-09: Backup coverage check
- **Objective:** confirm what backups exist (daily, point-in-time recovery, retention) on your Supabase plan.
- **Implementation:** checklist C3. The restore rehearsal is P6-03. **Dash:** yes. **Risk:** none.

#### P0-10: Staging environment decision (D-03)
- **Objective:** decide where migrations and AI financial tests run before production.
- **Recommendation:** a separate Supabase staging project (free tier is enough) plus Vercel Preview pointed at it. This also resolves R-4.
- **Dash:** yes (if created). **Mig:** no.

#### P0-11: Confirm current-user data issues in the real app (optional but recommended)
- **Objective:** turn DI-01 and BUG-04 from "code-confirmed" into "reproduced", so their Phase 1/5 priority is justified.
- **Implementation:** checklist D1–D2, using a **throwaway test project** you create yourself (never a client project).
- **Dash:** no (app only). **Risk:** Low (the test project only).

#### P0-12: Record Phase 0 results
- **Objective:** write the verified facts into this roadmap and re-prioritize.
- **Implementation:** a docs-only commit on the planning branch.
- **Completion:** the status dashboard is updated; SEC-01/SEC-02 severities are confirmed; D-01, D-02, D-03 and D-05 are recorded.

**Phase 0 exit criteria:** the spend cap is active; the key is Production-only and the old key revoked (or AI deliberately off); SEC-01 status known; schema snapshot obtained; Preview isolation known; D-01, D-02, D-03 and D-05 decided.

---

### PHASE 1: Existing critical security fixes (and current data-loss items)

#### P1-00: Safe behavior when AI is unavailable (added 2026-09-27 by the D-23 preflight)
- **Objective:** a missing or disabled AI configuration must never overwrite or pollute user data, and must show a neutral message.
- **Ref:** D-23 preflight (checklist A0.7); related to SEC-02 and BUG-02.
- **Finding:** `analyzeBrandDocument` (`src/lib/actions/overview.ts`) writes the "not configured" text into `brand_documents.ai_analysis`. The Overview "Analyze" button (`overview-panels.tsx:979`) shows for every file document, so after disconnection it **overwrites existing real analyses**. The user-facing message also exposes the variable name `ANTHROPIC_API_KEY`.
- **Affected:**
  - `src/lib/actions/overview.ts` (`analyzeBrandDocument`: return the message instead of writing it; never replace a non-empty analysis with an error).
  - `src/lib/ai/client.ts` (neutral `NOT_CONFIGURED` wording).
  - `overview-panels.tsx` (show the returned message for Analyze and for the automatic refresh).
- **Dependencies:** none. **Risk:** Low. **Complexity:** S. **Mig:** no. **Dash:** no.
- **Automated tests:** a unit test with a mocked AI client: "not configured" → no DB write; an existing analysis is untouched.
- **Manual QA:** without the key, click Analyze on a document with existing analysis text → the text is unchanged and a message appears; upload a new PDF → its analysis stays empty and a message appears.
- **Completion:** QA passes. **Rollback:** revert.
- **Ordering:** before the Vercel disconnection **if** query Q-AI2 finds real analyses (otherwise it may follow it); it's also subsumed later by P1-01's guard. Separate branch from the latest `main`, never on the planning branch.

#### P1-01: AI access guard (first slice of the gateway)
- **Objective:** no AI call without authentication, project membership, an allowed role, the kill switch being on, and input within limits.
- **Ref:** SEC-02, BUG-02 (error handling part), D-04, D-16.
- **Affected:**
  - New: `src/lib/ai/guard.ts` (server-only).
  - Edited: `src/lib/actions/brand-writer.ts` (`generateBrandCopy`); `src/lib/actions/overview.ts` (`generateBrandSummary`, `suggestPersonalitySpectrum`, `generateBrandSections`, `generateAiInsights`, `analyzeBrandDocument`, `refreshBrandIntelligence`); `src/lib/actions/brief.ts` (`generateBriefDesign`: add the membership check, and assert `task.project_id === projectId`); `src/lib/ai/client.ts` (try/catch with typed SDK errors, explicit timeout and `maxRetries`, `stop_reason` check so truncated or refused output isn't written).
- **Implementation:**
  - `requireAiAccess(projectId, operation)`: `auth.getUser()` → membership and role via `project_members` → `process.env.AI_ENABLED === "true"` (kill switch v0) → an optional `AI_ALLOWED_USER_IDS` allowlist (used later while Phases 2–4 are in progress) → a per-operation input caps table (`request`, `history` count and length, `currentText`, document bytes).
  - Every entry point calls it **before** building context or calling the provider.
  - Errors return generic user messages.
  - `analyzeBrandDocument` stops writing error text into `ai_analysis`.
- **Dependencies:** D-04, D-16. No DB change. **Risk:** Medium (touches every AI feature). **Complexity:** M.
- **Automated tests:** unit tests for the guard (no session → rejected; non-member → rejected; disallowed role → rejected; switch off → rejected with no provider call; oversized input → rejected). The provider client is mocked, so **no real API spend in tests**.
- **Manual QA:**
  1. As owner: Brand Writer, Overview refresh, Brief design and document upload all work.
  2. As a `client`/`viewer` test member: AI actions are refused with a clear message.
  3. With `AI_ENABLED=false` set in Preview: every AI action shows "AI is currently unavailable" and **the Anthropic Console shows no new usage**.
- **Completion:** all 8 entry points are guarded (verified by a grep test listing `generateText|generateWithImages|analyzeDocument` callers); QA passes.
- **Rollback:** revert the merge; production behavior returns to the current (unguarded) state. The spend cap from P0-02 remains.
- **Dash:** yes (you add `AI_ENABLED` in Vercel). **Mig:** no.

#### P1-02: Open redirect in `/auth/callback`
- **Objective:** redirect only to same-site paths.
- **Ref:** SEC-03 (runtime-confirmed).
- **Affected:** `src/app/auth/callback/route.ts`; possibly a new `src/lib/safe-redirect.ts` shared with future auth flows.
- **Implementation:** accept `next` only if it starts with `/` and not `//` or `/\`, and the resolved URL's origin equals the request origin; otherwise use `/projects`.
- **Dependencies:** none. **Risk:** Low. **Complexity:** S.
- **Automated tests:** a unit test table: `/projects` ✓, `//evil.example` ✗, `https://evil.example` ✗, `/\evil` ✗, an encoded variant (`%2F%2Fevil`) ✗.
- **Manual QA:**
  1. The full password reset (Journey B) still lands on the reset form.
  2. `/auth/callback?next=//example.com` lands on `/projects?error=invalid_link` (logged out → login).
- **Completion:** tests pass; QA passes; a production curl check shows no external `Location`.
- **Rollback:** revert. **Dash:** no. **Mig:** no.

#### P1-03: Migration baseline and process
- **Objective:** make the repository reflect production, and establish how migrations are applied, verified and rolled back.
- **Ref:** DI-04; D-03, D-05.
- **Affected:** `supabase/` (a new `migrations/` folder, a baseline file from the P0-07 snapshot, a README describing the process). `schema.sql` is marked historical. No production change.
- **Implementation:** create the baseline from the snapshot; diff it against `schema.sql` and the fix files, and document every drift (e.g. which version of the `profiles` policy is live); write the apply/verify/rollback template used by all later migrations.
- **Dependencies:** P0-07, D-05, D-03. **Risk:** Low (docs and SQL in the repo only). **Complexity:** M.
- **Automated tests:** if staging exists, the baseline applies cleanly to an empty staging project.
- **Manual QA:** you confirm that the drift report matches what you expect.
- **Completion:** baseline merged; every later migration references it.
- **Rollback:** n/a. **Dash:** yes (staging, if chosen). **Mig:** no production migration.

#### P1-04: Admin privilege protection (`profiles.is_admin`)
- **Objective:** guarantee `is_admin` can't be self-assigned, and keep fresh installs from regressing.
- **Ref:** SEC-01; the P0-06 result decides its urgency.
- **Affected:** a migration (the `profiles` UPDATE policy with a `WITH CHECK` pinning `is_admin`, or a column-level approach: revoke UPDATE on `is_admin` from `authenticated`); `src/lib/admin-auth.ts` unchanged.
- **Dependencies:** P1-03 (P0-06 if it's an emergency). **Risk:** Medium (profile editing must keep working). **Complexity:** S.
- **Automated tests:** an RLS test script (staging): a normal user updating `is_admin` → rejected; updating `name` → succeeds.
- **Manual QA:**
  1. Account → change name and avatar → saved.
  2. Run the verification query → the policy shows the new `with_check`.
- **Completion:** verified in production (the P0-06 queries re-run).
- **Rollback:** the rollback SQL restores the previous policy (not recommended). **Dash:** yes (apply SQL). **Mig:** yes.

#### P1-05: Restrict profile visibility to collaborators
- **Objective:** a user can read only their own profile and profiles of people they share a project with.
- **Ref:** SEC-05 (active cross-tenant leak).
- **Affected:**
  - Migration: replace the `profiles` SELECT policy with a SECURITY DEFINER helper `shares_project_with(uid)`.
  - Code to verify still works: `src/app/projects/page.tsx:19`, `settings/page.tsx:40`, `settings/team/page.tsx:48`, the @mention and assignee pickers (`lib/data/post-comments.ts`), notifications, comments.
  - `admin-dashboard.ts` uses the service role, so it's unaffected.
  - The `get_shared_preview` members list is SECURITY DEFINER, so it's unaffected.
- **Dependencies:** P1-03. **Risk:** Medium–High (many readers of profile names). **Complexity:** M.
- **Automated tests:** RLS tests: a non-collaborator → 0 rows; a collaborator → name/avatar/email visible; self → visible.
- **Manual QA:** Team page, @mentions in comments, the task assignee picker, notification names, project owner email in Settings — all still show names. From a second account with no shared project, the browser console query returns nothing (exact snippet provided at Step G).
- **Completion:** verified in production.
- **Rollback:** rollback SQL restores `USING (true)`. **Dash:** yes. **Mig:** yes.

#### P1-06: Account enumeration via `get_user_id_by_email` (+ DI-06)
- **Objective:** only project owners/admins can resolve an email, only inside the invite flow, and matching is case-insensitive.
- **Ref:** SEC-04, DI-06.
- **Affected:** a migration (the function takes `p_project_id` and checks `project_role(p_project_id) in ('owner','admin')`, `lower()` comparison, pinned `search_path`; revoke the old signature); `src/lib/actions/members.ts:inviteMember` (pass the project id; lowercase the email).
- **Note:** the "No account found" message remains until P5-01 (invitations) removes the need for it. That's accepted residual risk, now limited to owners/admins.
- **Dependencies:** P1-03. **Risk:** Low–Medium. **Complexity:** S.
- **Automated tests:** an RPC test: an editor calling it → error; an owner → id; a mixed-case email → found.
- **Manual QA:** invite an existing test account using different capitalization → added. As an editor, the RPC call from the browser console fails.
- **Rollback:** rollback SQL. **Dash:** yes. **Mig:** yes.

#### P1-07: Ownership escalation through the membership policy
- **Objective:** admins can't create, alter or delete owner rows; ownership transfer is atomic.
- **Ref:** SEC-06; `transferOwnership` currently runs two separate parallel updates (non-atomic: zero or two owners are possible if one fails).
- **Affected:** a migration (split "Owners/admins can manage membership" into owner-only rules for `role='owner'` rows and admin rules excluding owner rows; a new SECURITY DEFINER `transfer_project_ownership(p_project_id, p_new_owner)` in one transaction); `src/lib/actions/members.ts` (`transferOwnership`, `removeMember`, `updateMemberRole` use it or respect it).
- **Dependencies:** P1-03. **Risk:** Medium (team management). **Complexity:** M.
- **Automated tests:** RLS/RPC tests: an admin setting `role='owner'` → rejected; an admin deleting the owner row → rejected; the owner transferring → exactly one owner afterwards.
- **Manual QA:** as admin, try to change the owner's role in the UI (not offered) **and** via a console snippet (rejected); as owner, transfer ownership to a test member, then transfer back.
- **Rollback:** rollback SQL plus a revert. **Dash:** yes. **Mig:** yes.

#### P1-08: Brief media and upload-type hardening (partial)
- **Objective:** stop arbitrary file types (HTML, SVG and so on) being hosted in the storage buckets, and especially in public `brief-media`.
- **Ref:** SEC-09 (and SEC-08 partially; the full privacy decision is D-18 / P5-13).
- **Affected:** a migration or dashboard setting: `allowed_mime_types` per bucket (images, video, PDF only where used); client pickers already restrict types.
- **Dependencies:** P1-03; the list of real file types in use (from the P0-07 bucket snapshot). **Risk:** Medium (could block a legitimate format such as HEIC or MOV; the allowlist must include them). **Complexity:** S.
- **Automated tests:** a staging upload of `.html` → rejected; `.heic`, `.mov`, `.mp4`, `.jpg`, `.png`, `.pdf` (brand docs) → accepted.
- **Manual QA:** upload each real format you use in the Grid, Brief, Stories and brand documents.
- **Rollback:** remove the restriction. **Dash:** yes. **Mig:** yes (bucket config).

#### P1-09: Client feedback no longer overwrites or exposes internal notes
- **Objective:** client review writes to its own storage; team Notes stay private and unchanged.
- **Ref:** DI-01, SEC-07, D-17. **Moved into Phase 1 because current client reviews corrupt data and leak internal notes.**
- **Affected:**
  - Migration: `posts.client_feedback` and `stories.client_feedback` columns (or a feedback table, per D-17).
  - New token RPCs writing only there, with a length cap.
  - `get_shared_preview` returns feedback, not `notes`.
  - Code: `src/app/preview/[token]/shared-gallery.tsx` (no pre-fill from notes, no re-wrapping); `src/lib/actions/share-preview-review.ts`; the Post Editor shows client feedback read-only next to Notes.
  - Existing wrapped notes are left intact (no automatic data rewrite); an optional cleanup script is offered separately.
- **Dependencies:** P1-03, D-17. **Risk:** Medium. **Complexity:** M.
- **Automated tests:** unit test of feedback formatting (idempotent); an RPC test for the length cap.
- **Manual QA:** in the throwaway project, write internal Notes → share → the client view does **not** show them → approve, request changes, approve again with feedback → the Post Editor Notes are unchanged, feedback shows once without nesting, and the owner receives the notification.
- **Rollback:** code revert (the new columns are harmless if left). **Dash:** yes. **Mig:** yes.

#### P1-10: Silent write failures on destructive and important actions
- **Objective:** no action reports success unless the database confirms it.
- **Ref:** DI-02. **Moved into Phase 1 because it affects current users.** Code only.
- **Affected:** the 17 unchecked writes listed in DI-02 (`posts.ts:71, 497, 555`; `stories.ts:340, 350, 579, 649`; `grid.ts:125, 558, 575`; `media.ts:160, 203`; `notifications.ts:8, 18`; `overview.ts:341`; `share-links.ts:70`; `task-automation.ts:39`) plus their UI callers' rollback of optimistic state.
- **Implementation:** check `error`; destructive writes use `.select('id')` and treat 0 rows as failure; callers restore state and show the existing toast.
- **Dependencies:** none. **Risk:** Medium (many call sites; may surface previously hidden errors). **Complexity:** M.
- **Automated tests:** a grep-based guard test (no bare `await supabase.from(...).update|delete|insert|upsert(` without capturing the result in `src/lib/actions`), plus unit tests for the helper.
- **Manual QA:** delete a post, story, frame, link and grid row → it persists after refresh. With devtools "Offline" during a delete → an error toast and the item is restored.
- **Rollback:** revert. **Dash:** no. **Mig:** no. **Can run in parallel with Phase 2** (after approval).

#### P1-11: Password change requires the current password
- **Objective:** a stolen session can't silently take over an account.
- **Ref:** SEC-12, MF-08.
- **Affected:** `src/lib/actions/settings.ts:updateAccountPassword` (verify the current password via `signInWithPassword` before `updateUser`), the account panel form; email change follows the same rule unless Supabase "Secure email change" (P0-08) already covers it.
- **Dependencies:** P0-08. **Risk:** Low. **Complexity:** S.
- **Automated tests:** unit tests for the validation paths.
- **Manual QA:** wrong current password → rejected; correct → changed; log in with the new password.
- **Rollback:** revert. **Dash:** no. **Mig:** no.

#### P1-12: Pin `search_path` on the older SECURITY DEFINER functions
- **Objective:** close the Supabase-linter class issue.
- **Ref:** SEC-14. Low risk; **can be batched with P1-06** only if you approve, since it's the same function family.
- **Affected:** a migration for `is_project_member`, `project_role` (`get_user_id_by_email` is covered by P1-06).
- **Complexity:** S. **Mig:** yes. **Dash:** yes.

**Phase 1 exit criteria:** P1-01 … P1-11 MERGED and VERIFIED in production; the P0-06 queries re-run clean; an RLS test suite exists on staging.

---

### PHASE 2: AI architecture and infrastructure

AI stays usable only by the `AI_ALLOWED_USER_IDS` allowlist (P1-01) or stays off (per D-01) until Phase 4 passes.

#### P2-01: Central AI gateway
- **Objective:** one server-only module constructs the Anthropic client; every AI feature goes through `runAiOperation`.
- **Ref:** AI-readiness §2; BUG-02; D-09.
- **Affected:** new `src/lib/ai/gateway.ts` (built on `guard.ts`), `src/lib/ai/operations.ts` (a per-operation config: model, `max_tokens`, timeout, input caps, allowed roles); `client.ts` becomes internal to the gateway; the 8 call sites are migrated.
- **Implementation:** guard → validate → provider call with explicit timeout and retries → typed error mapping → `stop_reason` handling (`max_tokens`/`refusal` never persisted as valid output) → return `{ text, usage, model, stopReason }` to the caller. Structured outputs replace regex JSON parsing where JSON is required (verify SDK usage against the current docs at implementation).
- **Dependencies:** P1-01, D-09. **Risk:** Medium. **Complexity:** M.
- **Automated tests:** a grep test (no `new Anthropic(` outside `gateway.ts`); unit tests with a mocked SDK for each error class and stop reason.
- **Manual QA:** every AI feature works for an allowlisted user; a forced-timeout test build shows a friendly error.
- **Rollback:** revert. **Dash:** no. **Mig:** no.

#### P2-02: AI settings / kill switch v1 (database-backed)
- **Objective:** turn AI (globally or per operation) off instantly, without a redeploy.
- **Affected:** a migration (`ai_settings` table; read by the service role only); the gateway reads it with short caching; `AI_ENABLED` env stays as the master override.
- **Dependencies:** P2-01, P1-03, P1-04 (admin integrity). **Risk:** Low. **Complexity:** S.
- **Tests:** switch off → no provider call (mocked). **QA:** flip it via SQL (later via the admin UI, P3-08) and confirm AI features show "unavailable" within the cache window.
- **Mig:** yes. **Dash:** yes.

#### P2-03: Usage ledger and model price table
- **Objective:** record every AI call with the provider-reported usage and the computed cost.
- **Ref:** AI-readiness §3; D-15.
- **Affected:** a migration (`ai_usage_events`, `ai_model_prices` versioned by `effective_from`; RLS: users read their own rows, no client writes; writes via the service role in the gateway).
- **Implementation:** the gateway inserts a row per call with the `response.usage` fields, `response.model`, the status, `stop_reason`, latency and request id. Cost is computed from the price row effective at call time. **No prompt or output text is stored** unless D-15 says otherwise.
- **Dependencies:** P2-01, P1-03. **Risk:** Low. **Complexity:** M.
- **Tests:** a unit test for cost computation, including cache-token fields; an idempotency-key uniqueness test.
- **Manual QA:** run each AI feature once → one row each, with non-zero tokens matching the Anthropic Console within reason.
- **Mig:** yes. **Dash:** yes (you enter the current prices from the Console/pricing page; I won't hardcode them).

#### P2-04: Server-side AI error and cost logging
- **Objective:** failed AI calls are visible without reading prompts (error category, operation, user, project).
- **Affected:** the gateway, plus `system_events` or the ledger status. **Complexity:** S. **Mig:** no (uses P2-03). **Depends:** P2-03.

#### P2-05: Rate-limit infrastructure
- **Objective:** a reusable per-user / per-IP limiter, used by AI first and later by exports and share links.
- **Ref:** SEC-10; D-12.
- **Affected:** new `src/lib/rate-limit.ts` plus, depending on D-12, a Postgres table and function (migration) or an external Redis service (new env vars).
- **Dependencies:** D-12. **Risk:** Low–Medium. **Complexity:** M.
- **Tests:** burst tests (N+1th call rejected; resets after the window).
- **Mig:** yes if Postgres. **Dash:** yes if an external service.

#### P2-06: Error monitoring
- **Objective:** production exceptions (AI and non-AI) are reported with no tokens or PII.
- **Ref:** audit Phase 9 gap; D-13.
- **Affected:** the chosen vendor SDK, `global-error.tsx`, the server instrumentation hook. Scrub rules for URLs (signed tokens), cookies and prompts.
- **Complexity:** M. **Dash:** yes (vendor account). **Mig:** no.

#### P2-07: Document-analysis limits
- **Objective:** bound the cost of the automatic PDF analysis.
- **Ref:** D-16. **Affected:** `overview.ts:analyzeBrandDocument`, `refreshBrandIntelligence` (a page and size cap before sending; optional opt-in instead of auto-run).
- **Complexity:** S–M. **Depends:** P2-01, D-16.

**Phase 2 exit criteria:** all AI traffic flows through the gateway; every call is ledgered; the kill switch v1 works; rate limiter and monitoring are live.

---

### PHASE 3: Anthropic usage, credits and financial safeguards

**Initial AI activation needs P3-01 … P3-09. Monetization tasks (P3-M*) are deferred.**

#### P3-01: Credit accounts, ledger and atomic reservation functions
- **Objective:** a balance that concurrent requests can't overdraw.
- **Ref:** AI-readiness §4; D-06, D-08.
- **Affected:** a migration:
  - `ai_credit_accounts` (per the D-08 scope).
  - `ai_credit_transactions` (append-only; types `grant_initial`, `allowance_reset`, `reserve`, `settle`, `refund`, `admin_adjustment`, `expire`, plus the future `purchase`/`subscription_allowance`).
  - SECURITY DEFINER functions `ai_reserve_credits` (a single conditional `UPDATE … WHERE balance >= $est`), `ai_settle_credits`, `ai_refund_credits`, all idempotent on `idempotency_key`.
  - No client write policies.
- **Dependencies:** P2-03, D-06, D-08. **Risk:** High (money logic). **Complexity:** L.
- **Automated tests (DB level, staging):**
  - N parallel reservations against a balance for k < N → exactly k succeed.
  - Settle twice → charged once.
  - Refund after settle → rejected.
  - The balance equals the ledger sum.
- **Manual QA:** you review the staging test output (provided).
- **Rollback:** the tables are unused until P3-03; drop via the rollback SQL.
- **Mig:** yes. **Dash:** yes.

#### P3-02: Initial free allowance
- **Objective:** grant the free allowance you define.
- **Ref:** D-07. **Affected:** a migration or trigger on account creation plus a backfill for existing users (a one-off script you approve). **Complexity:** S–M. **Mig:** yes. **Depends:** P3-01, D-07.

#### P3-03: Gateway ↔ credits wiring
- **Objective:** every AI call does reserve → call → settle, or refund on failure, with idempotency keys generated per user action.
- **Affected:** `gateway.ts`, the operation config (credit estimate per D-06), the UI (insufficient-balance message).
- **Dependencies:** P3-01, P3-02. **Risk:** High. **Complexity:** M.
- **Tests:** a mocked provider failure → refunded; a timeout → refunded; a double-submitted action → charged once.
- **QA:** use AI until the balance is exhausted → a clear message and no provider call (the Console confirms).

#### P3-04: Per-user limits and concurrency cap
- **Objective:** rate limits and at most N concurrent operations per user.
- **Ref:** D-11. **Affected:** gateway, `rate-limit.ts`, the reservation function (in-flight count). **Complexity:** S–M. **Depends:** P2-05, P3-03.

#### P3-05: Global spend circuit breaker and alerts
- **Objective:** automatic AI shutdown and an alert when daily provider cost exceeds your threshold.
- **Ref:** D-10. **Affected:** gateway (checks today's ledger sum, cached), `ai_settings`, and the alert channel (email via P5-05 or the monitoring vendor). **Complexity:** M. **Depends:** P2-02, P2-03.

#### P3-06: Reservation sweep and allowance reset job
- **Objective:** refund stale `reserved` rows (crashed functions) and reset periodic allowances.
- **Ref:** D-14. **Affected:** a scheduled job (Vercel Cron route protected by a secret, or `pg_cron`). **Complexity:** S–M. **Dash:** yes. **Mig:** maybe.

#### P3-07: User-facing balance and usage history
- **Objective:** users see their remaining allowance and recent AI usage (informational only; enforcement stays server-side).
- **Affected:** Account page section, plus a small indicator in the AI UIs. **Complexity:** M. **Depends:** P3-03.

#### P3-08: Private admin AI controls
- **Objective:** kill switch toggle, today/month spend, top users and projects, failed requests, credit adjustments (with the admin id and a reason), per-user suspension.
- **Ref:** AI-readiness §7. **Affected:** `/admin/ai` (new page under the existing admin gate). **Dependencies:** **P1-04 VERIFIED**, P2-02, P2-03, P3-01. **Complexity:** M.

#### P3-09: Reconciliation procedure
- **Objective:** a documented weekly check comparing the ledger totals with the Anthropic Console usage and cost.
- **Affected:** docs plus an admin report query. **Complexity:** S.

#### Deferred until monetization (not needed to activate AI)

| ID | Task | Ref | Notes |
|---|---|---|---|
| P3-M1 | Payment provider integration, checkout for credit packs | D-22 | Credits granted **only from verified webhooks** |
| P3-M2 | Webhook processing with an idempotent `webhook_events` table; refunds and chargebacks | AI-readiness §9 | |
| P3-M3 | Subscription plans with included allowances; billing-cycle resets; failed payments, cancellation, upgrades and downgrades | D-22 | The ledger from P3-01 already supports these types |
| P3-M4 | Billing and usage history page, invoices | MF-09 | |

**Phase 3 exit criteria:** credits enforced server-side for every AI call; limits, breaker, sweep and admin controls live on staging.

---

### PHASE 4: AI security, financial and end-to-end QA

| ID | Task | Completion criteria |
|---|---|---|
| P4-01 | Automated authorization suite for every AI operation (no session / non-member / disallowed role / kill switch / oversized input) | All pass in CI |
| P4-02 | Concurrency and overdraw test against staging (parallel requests on a small balance) | Never overdrawn; ledger sum = balance |
| P4-03 | Failure-path tests: provider 429/5xx/timeout/refusal/truncation → refunded, nothing persisted | All pass |
| P4-04 | Kill switch, circuit breaker and rate-limit drills on staging, then on production with an allowlisted account | You observe the "unavailable" state and no Console usage during the drill |
| P4-05 | Manual end-to-end test of each AI feature (Brand Writer, Overview refresh, document analysis, Brief design) on desktop and mobile | Your QA sign-off |
| P4-06 | Cost reconciliation after a controlled test period: ledger vs Anthropic Console | Within an agreed tolerance |
| P4-07 | Prompt-injection and cross-project review: untrusted content (documents, client feedback, captions) is delimited; context is RLS-scoped to the verified project; outputs are rendered as text | Review document plus targeted tests |

**Gate:** remove `AI_ALLOWED_USER_IDS` (open AI to all users) only after P4-01 … P4-07 pass **and** P5-04 (AI-processing disclosure) is merged.

---

### PHASE 5: Remaining critical pre-launch fixes and essential functionality

Ordered by priority. Items that affect **current** users were already moved into Phase 1 (P1-09, P1-10). These may be interleaved with Phases 2–4 once approved.

| ID | Task | Ref | Affected | Mig | Dash | Complexity | Key tests / QA |
|---|---|---|---|---|---|---|---|
| P5-01 | Invitations for new users: `invitations` table (hashed token, expiry, revoke), invite email, accept on signup/login, pending list with resend/revoke; existing users accept instead of being added silently | MF-02, SEC-04 residual | `members.ts`, team settings UI, auth callback | yes | yes (email) | L | Invite a new email → sign up via the link → joined with the right role; expired and revoked links fail |
| P5-02 | Account deletion with an ownership policy, storage cleanup and auth user removal | MF-01, D-21, DI-03 | new action (service role), account danger zone | maybe | no | M–L | Delete a test account → login fails; owned projects handled per D-21; files removed |
| P5-03 | Leave project (non-owners) | MF-03 | members action plus RLS/RPC | yes | no | S | A non-owner leaves; the owner can't |
| P5-04 | Terms, Privacy and AI-processing disclosure; consent at signup | MF-04, D-15 | static pages, register form, footer, settings | no | no | S | **Legal text needs professional review. Required before the AI gate opens (Phase 4).** |
| P5-05 | Transactional email provider; Supabase Auth custom SMTP | MF-13, D-20, P0-08 | email lib, Supabase SMTP settings | no | yes | M | Deliverability to Gmail/Outlook for signup, reset and invite |
| P5-06 | Storage lifecycle part 1: reference-counted cleanup on project deletion (clones share paths, see DI-07) | DI-03 | `deleteProjectPermanently`, new cleanup function | maybe | no | M | Delete a test project → its files gone; files shared with other projects intact |
| P5-07 | Storage lifecycle part 2: superseded preview/poster files after edits | DI-03 | annotation save paths, a scheduled sweep | maybe | yes | M | Edit an image 3× → only the current preview remains (plus a grace period) |
| P5-08 | Concurrent editing: conflict detection on post/story updates (`updated_at` check) | DI-05, D-19 | `updatePost`, story updates, editor UI | maybe | no | M | Two browsers edit the same post → the second save warns per D-19 |
| P5-09 | Unsaved-changes guard in the Post Editor (modal close, route change, tab close) | BUG-04 (P0-11 result) | `post-editor.tsx` | no | no | S–M | Edit the caption → close → a confirmation prompt; saving clears it |
| P5-10 | Timezone: client-side "today" and week boundaries, or use the saved timezone; otherwise hide the setting | BUG-01, MF-06 | `calendar/page.tsx`, `overview/page.tsx`, settings | no | no | S–M | At local 00:30 UTC+3, the Calendar highlights the right day |
| P5-11 | Share links: optional expiry and a view-only mode | MF-05 | share-link schema, RPCs, share menu | yes | no | S–M | An expired link shows "Preview Unavailable"; a view-only link hides approve controls |
| P5-12 | Security headers (`frame-ancestors`, `nosniff`, `Referrer-Policy`, then a tested CSP) | SEC-11 | `next.config.ts` | no | no | S–M | Full regression pass (Fabric, fonts, Supabase media) |
| P5-13 | Brief media privacy per D-18 (private bucket plus signed URLs with `RecoverableImg`, or documented as public) | SEC-08 | brief actions, Brief UI, bucket | yes | yes | M | Brief images load; the old public URLs stop working (if private) |
| P5-14 | Rate limits on exports and share-link writes (reuses P2-05) | SEC-10, PERF-02 | export routes, review actions | maybe | no | S | Burst export requests → throttled |
| P5-15 | Configured `SITE_URL` for auth emails; Redirect URL allowlist tightened | SEC-13, P0-08 | `auth.ts:getSiteOrigin` | no | yes | S | Reset email link points to the production domain |
| P5-16 | Error boundaries for `/tasks`, `/account`, `/admin`, `/preview`; `global-error.tsx` | audit Phase 7 | app routes | no | no | S | A forced error shows the boundary, not a blank page |
| P5-17 | Dialog accessibility: focus trap, initial and restored focus, `role="dialog"`/`aria-modal` | audit Phase 7 | `src/components/ui/dialog.tsx` | no | no | S–M | Keyboard-only walkthrough of the dialogs |
| P5-18 | Resend verification email; friendly unverified-login message | MF-12 | auth actions, login page | no | no | S | Unverified login → the resend option works |
| P5-19 | Grid Library pagination or virtualization for large projects | PERF-01 | `grid/page.tsx`, `media-library.tsx` | no | no | M | A 1,000-asset project loads; `?mediaDiag=1` timings recorded |
| P5-20 | Shared gallery thumbnails (and the storage policy covering `thumbnail_storage_path`) | PERF-03, SEC-15 | `share-preview.ts`, `is_media_path_shared` | yes | yes | S–M | The client preview loads fast on mobile 4G |
| P5-21 | Project data export (captions CSV plus originals) | MF-11 | new route | no | no | M | Export zip opens; the contents match |
| P5-22 | Housekeeping: landing hydration warning (BUG-03); delete the stale branch `fix/post-editor-media-scheduling` (BUG-05, with your approval) | BUG-03, BUG-05 | marketing page | no | no | S | No hydration warning in a clean browser |

Every P5 task gets the full field set (objective, rollback, completion criteria and so on) when it's presented at Step A. The table above fixes scope, references and dependencies.

**Optional (post-launch):** MFA (MF-15), direct publishing (MF-14), replacing native `confirm()` dialogs with styled confirmations.

---

### PHASE 6: Final launch readiness and QA

| ID | Task | Completion criteria |
|---|---|---|
| P6-01 | CI: `npm test` script for the existing and new tests; GitHub Actions (or Vercel checks) running tsc, lint, build and tests on every PR | Checks required before merge |
| P6-02 | End-to-end journeys A–I (audit document) on staging with owner/editor/client/non-member test accounts: Playwright on desktop Chromium plus mobile WebKit emulation | All pass with screenshots |
| P6-03 | Backup **restore rehearsal** into staging (plan-dependent, P0-09) | The restored app works; the procedure is documented |
| P6-04 | Deploy and rollback runbook: Vercel instant rollback for code; forward-fix plus rollback SQL for the DB; key rotation; kill switch usage | Runbook reviewed by you |
| P6-05 | Real-device QA: iPhone Safari and Android Chrome (Grid, Post Editor, Library, Image Editor, client preview, AI features) and desktop Chrome/Safari/Firefox | Your sign-off per surface |
| P6-06 | Security re-check: re-run the audit's RLS and endpoint checks against production; confirm SEC-01 … SEC-07 closed | All closed or accepted in writing |
| P6-07 | Operations check: monitoring alerts reach you; Anthropic and app spend alerts tested; email deliverability; storage usage baseline | Alerts received |
| P6-08 | Launch go/no-go review: remaining risks listed and accepted | Your written go |

---

## 7. Risk register (live)

| ID | Risk | Current mitigation | Closed by |
|---|---|---|---|
| R-1 | Unbounded Anthropic spend by any registered account | None yet | P0-02 (cap), P0-03/04, P1-01, Phase 3 |
| R-1b | The key's origin and billing owner are unknown: customer content may be processed under an organization you don't control, and its spend can't be capped by you. Owner-confirmed on 2026-09-27 that it can't be established. | Disconnection preflight done | A0.7 execution (removes it from new deployments). **Never fully closed** unless its owner revokes it; existing deployments keep it (protect or delete them per A0.7-E). |
| R-13 | With AI unavailable, the "Analyze" button overwrites real brand-document analyses with a "not configured" message, and new PDF uploads store that message | None | P1-00 (or a team "don't click Analyze" rule until it ships) |
| R-2 | Admin self-escalation to service-role access (if the production policy is old) | Unknown | P0-06 → P1-04 |
| R-3 | Cross-tenant email exposure | None | P1-05 |
| R-4 | Preview deployments with production data plus the AI key | Unknown | P0-03, P0-05, P0-10 |
| R-5 | Client reviews corrupt Notes and expose internal notes | None | P1-09 |
| R-6 | Silent write failures | None | P1-10 |
| R-7 | Migrations applied to an unknown schema | None | P0-07, P1-03 |
| R-8 | Account enumeration | None | P1-06, then P5-01 |
| R-9 | Ownership escalation / non-atomic transfer | None | P1-07 |
| R-10 | Deleted data persists in Storage (including public Brief URLs) | None | P5-02, P5-06, P5-13 |
| R-11 | No monitoring: production failures invisible | None | P2-06 |
| R-12 | No verified backup restore | Unknown | P0-09, P6-03 |
