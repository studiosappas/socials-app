# Pre-Launch Action Plan

Audit date: 2026-09-27 · Baseline: `main` @ `9300c00`

IDs refer to `BUG-AND-TECHNICAL-RISK-REGISTER.md` (SEC-, DI-, BUG-, PERF-), `ESSENTIAL-MISSING-FEATURES.md` (MF-) and `AI-INTEGRATION-READINESS.md`.

Effort: S = under half a day, M = 1–3 days, L = more than 3 days.

---

## PLAN A: Before AI integration (keep it short)

Only items with a concrete security, data-integrity or architectural dependency for AI work. Nothing here is UX polish.

| # | Item | Why it blocks AI | Effort | Required QA |
|---|---|---|---|---|
| A1 | **Verify production RLS for `profiles` (SEC-01)** and snapshot the production schema (DI-04). Fold the fixed policy into `schema.sql` and the consolidated migration. | The AI admin controls (kill switch, credit adjustments) will live behind `is_admin`. If that's self-assignable, the whole financial control layer can be bypassed. The new AI tables need a known schema to migrate against. | S (+ someone with DB access) | Run the `pg_policies` query; attempt a self-update of `is_admin` as a normal test user, which must fail |
| A2 | **Lock down the existing AI actions (SEC-02):** auth + membership/role check + an `AI_ENABLED` env kill switch + input caps in all 8 entry points (`brand-writer.ts`, `overview.ts` ×5, `brief.ts:generateBriefDesign`, `analyzeBrandDocument`). | These actions already exist, and any registered account can call them for any project with unbounded input. Setting the API key without this is an uncapped expense. | S–M | Non-member, viewer and logged-out calls rejected; kill switch off → no provider call |
| A3 | **Anthropic account safeguards (configuration):** dedicated production API key/workspace, a monthly spend limit and alerts in the Console (verify current Console features). | Provider-level backstop against any app bug. | S | Confirm the limits appear in the Console |
| A4 | **Fix the open redirect (SEC-03).** | A small, independent, confirmed security fix; AI launch marketing will drive auth traffic. | S | `next=//evil` → `/projects` |
| A5 | **Restrict `profiles` email visibility (SEC-05)** and **`get_user_id_by_email` (SEC-04).** | AI features will read more project and member context. The baseline cross-tenant data exposure should be closed first so AI context builders can rely on RLS meaning "only my collaborators". | S–M | @mention and assignee pickers still work; a non-collaborator's email isn't readable |
| A6 | **Close the admin→owner RLS escalation (SEC-06).** | Credit ownership and billing will be tied to project or workspace owners. | S | An admin can't set `role='owner'` or delete the owner row via the client SDK |

**Explicitly NOT in Plan A:** account deletion, invitations, legal pages, timezone, unsaved-changes guard, storage cleanup, client-feedback nesting, performance work, security headers. None has an AI dependency.

---

## PLAN B: After AI integration, before commercial launch

Ordered by priority tier. The AI build itself ("WITH AI" in the readiness doc: gateway, usage ledger, credits with atomic reservation, rate limits, circuit breaker, admin spend page, monitoring) happens **between** Plan A and Plan B, and its end-to-end verification is item B-P0-5.

### P0: Security, data loss, critical blockers
| ID | Item | Depends on | Effort | QA |
|---|---|---|---|---|
| B-P0-1 | DI-02: check `error` on all 17 unchecked writes; confirm row counts on destructive writes (`.select('id')`) | none | M | Force RLS denial and network failure → the UI shows an error and restores state |
| B-P0-2 | DI-01: separate client feedback from team Notes; stop exposing team Notes on `/preview` | none | M | Repeated approve/changes clicks don't nest; team Notes unchanged |
| B-P0-3 | SEC-07: length caps and rate limits on anonymous share-link writes | none | S–M | Oversized notes rejected; bursts throttled |
| B-P0-4 | SEC-09: `allowed_mime_types` per bucket; decide Brief media privacy (SEC-08) | none | S (M if moving Brief to private) | Upload an `.html` → rejected |
| B-P0-5 | **AI end-to-end verification:** concurrency cannot overdraw; failures refund; kill switch works; truncated or refused output isn't persisted; per-user limits hold | AI build | M | Automated tests plus a manual run on staging |
| B-P0-6 | Error monitoring and alerting (no Sentry or equivalent exists; only the `system_events` table) | none | S–M | A test exception appears in the dashboard with no PII or tokens |
| B-P0-7 | Backups and restore: confirm the Supabase plan's backup/PITR, and run one **restore rehearsal** into staging | DI-04 snapshot | S–M | The restored staging app works |

### P1: Essential launch functionality
| ID | Item | Effort | QA |
|---|---|---|---|
| B-P1-1 | MF-02: pending invitations for new emails, accept flow, expiry and revoke, invite email (also fixes DI-06 and removes the need for the SEC-04 lookup) | M–L | Invite a new email → sign up via the link → joined with the right role |
| B-P1-2 | MF-01: self-serve account deletion (ownership rules plus storage cleanup) | M | Delete account → login fails; owned projects handled; files removed |
| B-P1-3 | MF-03: leave project | S | A non-owner leaves; the owner can't |
| B-P1-4 | MF-04: Terms, Privacy and AI-processing disclosure, plus signup consent (**external legal review**) | S (eng) | Links present on signup, footer and settings |
| B-P1-5 | MF-13: email provider for transactional mail (invites, review results) | M | Deliverability to Gmail/Outlook |
| B-P1-6 | DI-03 (part 1): reference-counted Storage cleanup on project deletion | M | Delete a project → its files are gone; files shared with other projects are untouched |
| B-P1-7 | MF-09 (only if launching paid): payments, webhooks with idempotency, purchase and subscription allowances, billing history | L | Webhook replay doesn't double-credit; refund path |
| B-P1-8 | SEC-12 / MF-08: require the current password to change password or email | S | Wrong current password → rejected |

### P2: Reliability and important UX
| ID | Item | Effort |
|---|---|---|
| B-P2-1 | BUG-04 / MF-07: unsaved-changes guard in the Post Editor | S–M |
| B-P2-2 | BUG-01 / MF-06: client-side "today" or the saved timezone; or hide the setting | S–M |
| B-P2-3 | MF-05: share-link expiry and a view-only mode | S–M |
| B-P2-4 | SEC-11: security headers (`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, then a tested CSP) | S–M |
| B-P2-5 | SEC-10: rate limits on exports and other expensive actions | M |
| B-P2-6 | PERF-01: paginate or virtualize the Grid Library for large projects | M |
| B-P2-7 | Error boundaries for `/tasks`, `/account`, `/admin`, `/preview`, plus `global-error.tsx` (currently only `/projects/error.tsx` and `@modal/error.tsx`) | S |
| B-P2-8 | Dialog accessibility: focus trap, initial focus, focus restore, `role="dialog"`/`aria-modal` on the shared `Dialog` (`src/components/ui/dialog.tsx` handles only Escape) | S–M |
| B-P2-9 | DI-03 (part 2): cleanup of superseded preview and poster files | M |
| B-P2-10 | MF-12: resend verification email; friendly unverified-login message | S |
| B-P2-11 | MF-11: project data export | M |
| B-P2-12 | Adopt Supabase CLI migrations from the DI-04 baseline; document the deploy and rollback runbook (Vercel instant rollback exists for code; DB changes need forward-fix scripts) | M |

### P3: Optional
MF-14 (direct publishing), MF-15 (MFA), DI-05 (conflict detection), SEC-14 (`search_path` on old SECURITY DEFINER functions), BUG-03 (landing hydration warning), PERF-03 (thumbnails in shared galleries), replacing the 22 native `confirm()` dialogs with styled confirmations, BUG-05 (delete the stale branch).

---

## Production readiness checklist (Phase 9)

| Area | State | Gap type |
|---|---|---|
| Error monitoring | None (only the `system_events` table plus `console`) | Missing implementation |
| Logging | Server `console` logs; diagnostic loggers avoid URLs and tokens (checked `paste-diagnostics.ts`, `signed-url-cache.ts`, `media-diagnostics.ts`) | Adequate for now; needs log retention via Vercel's plan |
| DB migrations | Hand-run SQL files, no history, drift (DI-04) | Missing process |
| Backup and restore | Depends on the Supabase plan; never rehearsed | Configuration + procedure |
| Incident recovery / rollback | Vercel rollback for code; nothing for the DB | Missing procedure |
| Environment configuration | `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` (local); production also needs `SUPABASE_SERVICE_ROLE_KEY` (admin) and `ANTHROPIC_API_KEY` (AI). There's no `SITE_URL` (SEC-13). | Configuration |
| Storage capacity and cost | Unbounded growth (DI-03); 50MB per-file cap | Missing implementation |
| AI cost exposure | Uncapped (SEC-02) | Missing implementation |
| Email delivery | Supabase Auth only; SMTP provider unknown | Configuration + missing implementation (MF-13) |
| Account lifecycle | No deletion (MF-01), no invitations (MF-02) | Missing implementation |
| Privacy / data handling | Email exposure (SEC-05), public Brief media (SEC-08), files persist after deletion (DI-03), no policy pages (MF-04) | Implementation + legal |
| Billing | None | Missing (monetization phase) |
| User support | No in-app help or contact link found | Missing (S) |
| Safe deployment | Build passes; 37 unit tests; no E2E/RLS tests in CI; no CI config found in the repo | Missing test automation |

## Recommended regression tests to add (Phase 10)

1. **RLS tests** (SQL or supabase-js against staging): a non-member can't read project rows; the profile `is_admin` update is blocked; an admin can't set the owner role; anon can read only shared media.
2. **Server-action authorization tests** for every AI action and every destructive action.
3. **Media identity E2E** (Playwright, 2 posts sharing one Library asset): edit A → B unchanged; reset A → clean; Paste Style onto B → A unchanged.
4. **Client review E2E:** approve → changes requested → notes don't nest; the owner sees the notifications.
5. **Credit concurrency test:** N parallel AI requests against a balance for fewer than N → exactly `floor(balance / cost)` succeed, and the rest are rejected before any provider call.
6. **Auth journeys** on staging: signup, verify, login, reset, expired link, open-redirect regression.
7. Add an `npm test` script that runs the existing three Node test files, and run it in CI.
