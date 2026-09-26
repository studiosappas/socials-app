# Flow:er: Executive Audit Summary

Audit date: 2026-09-27 · Baseline: `main` @ `9300c00` · Scope: the entire application, audit only (no code, data or deployment changes).

## Scope

- 33 route files; 24 server-action modules (the security-relevant ones read in depth); 40 database tables and their RLS policies; storage buckets; the AI client and all 8 AI entry points; auth flows; sharing and client review; the media identity model; operations readiness.
- Tests run: the 3 existing unit test files (37 passing). Safe local runtime checks against the real Supabase project using only the public anon key, with no data written: auth redirects and proxy gating, plus a Playwright smoke test of the public pages at 375 px and 1440 px.
- **Not available:** authenticated sessions, test accounts, database or dashboard access, Vercel access, Anthropic Console. All authenticated journeys are therefore **NOT VERIFIED**; see `AUDIT-COVERAGE-AND-LIMITATIONS.md`.

## Most important findings

1. **Existing AI actions have no authorization or spending controls (SEC-02).**
   - Eight AI entry points already exist. None checks the caller's session or project membership before calling Anthropic.
   - None limits input size, records usage, caps spend or can be switched off.
   - Any self-registered account could generate unlimited Opus calls once `ANTHROPIC_API_KEY` is set in production.
2. **Admin privilege may be self-assignable in production (SEC-01, NOT VERIFIED).**
   - The fix preventing users from setting `profiles.is_admin = true` exists only in one standalone SQL file. It's missing from `schema.sql` and from the consolidated migration.
   - The admin area uses the service-role key. Whether production has the fix must be checked directly.
3. **Cross-tenant privacy:** every user can read every other user's email address (SEC-05), and any user can look up whether an email is registered and get its user id (SEC-04).
4. **Open redirect on the app's own domain (SEC-03), confirmed at runtime.**
5. **Client review corrupts and exposes team notes (DI-01).**
   - Client feedback is written into the same `notes` field the team uses.
   - It wraps itself one level deeper on every click, and team notes are shown to clients.
6. **Silent write failures (DI-02).** 17 writes ignore database errors, and RLS-denied deletes return no error anywhere. The UI can report success while nothing changed.
7. **Production schema state is unknowable (DI-04).** There's no migration history, only hand-run SQL files that have drifted from each other.
8. **Missing fundamental SaaS capabilities:**
   - Account deletion.
   - Invitations for people without an account, including acceptance and email.
   - Leaving a project.
   - Terms, Privacy and AI-processing disclosure.
9. **Storage is never cleaned up (DI-03).** Deleted projects' files persist, including public Brief media (SEC-08), and every image edit leaves an orphaned file.
10. **No error monitoring, no rate limiting, no security headers, no CI, no end-to-end or RLS tests.**

## Pre-AI blockers (Plan A)

Six items, roughly 2–4 engineering days plus a production check by someone with DB access:
- A1: verify and fix the `profiles` admin policy; snapshot the schema.
- A2: add auth, membership, a kill switch and input caps to all existing AI actions.
- A3: dedicated Anthropic key plus a provider spend limit and alerts.
- A4: open redirect.
- A5: email exposure and email lookup.
- A6: admin→owner escalation.

Details are in `PRE-LAUNCH-ACTION-PLAN.md`.

Nothing else blocks AI development. Missing features, UX issues and performance work do not.

## Infrastructure to build with AI

- A server-only AI gateway: auth → role → kill switch → input validation → credit reservation → call with explicit `max_tokens` and timeout → `stop_reason` handling → usage capture from `response.usage` → settlement.
- A usage ledger with a versioned price table.
- Credit accounts and an append-only transaction ledger, with atomic reservation and idempotent settle and refund.
- Per-user rate and concurrency limits, a global spend circuit breaker, an admin spend page and kill switch UI, and error monitoring.

See `AI-INTEGRATION-READINESS.md`.

## Pre-launch blockers (Plan B, P0/P1)

- Fix silent writes (DI-02) and client-feedback corruption (DI-01).
- Limit anonymous share-link writes (SEC-07); MIME allowlists and a Brief privacy decision (SEC-09, SEC-08).
- AI end-to-end verification; error monitoring; a backup restore rehearsal.
- Invitations, account deletion, leave project, legal pages (legal review required), transactional email, storage cleanup on deletion, and billing if launching paid.

## Critical unknowns (need access to resolve)

1. The live `profiles` UPDATE policy (SEC-01).
2. Whether `ANTHROPIC_API_KEY` is set in production (it decides whether SEC-02 is currently exploitable).
3. Supabase Auth settings: email confirmation, secure password change, redirect allowlist, SMTP.
4. Storage bucket settings as deployed (MIME types, public flags).
5. Supabase plan backup and point-in-time-recovery coverage.
6. The Vercel function timeout and runtime timezone.
7. The real behavior of every authenticated journey.

## Verified functionality (this audit)

| Item | How |
|---|---|
| Public pages (landing, login, register, forgot password, reset, invalid preview) render without horizontal overflow at 375 and 1440 px; no console errors except a landing hydration warning (BUG-03) | Local Playwright |
| Proxy redirects anonymous users away from `/projects`, `/tasks`, `/admin/*` | Local curl |
| Invalid share token shows "Preview Unavailable"; expired recovery shows "Link expired." | Local runtime |
| Crop geometry, grid reducer and grid interaction logic | 37 unit tests pass |
| Media loading fixes (signed-URL expiry, batching, recovery, posters, iOS play badge) | Merged in `9300c00`. Verified by harness earlier and QA-approved by the owner. |
| RLS is enabled on all 40 tables; storage for `project-media` is private | Schema inspection |

## Unverified functionality

All authenticated workflows:
- Onboarding with invites.
- Password recovery email delivery.
- Upload → edit → persist.
- Media isolation across posts.
- The post lifecycle and scheduling.
- Carousel.
- Client review round trip.
- Mobile editor.
- Recovery cases.

Also: production RLS and bucket configuration, and real performance numbers.

## Counts

| Metric | Count |
|---|---|
| Route files inspected | 33 (plus 24 action modules and 40 tables) |
| Confirmed findings (runtime or deterministic code) | 18: security 11 (SEC-02, 03, 04, 05, 06, 07, 08, 10, 11, 12, 14), data integrity 4 (DI-01, 02, 03, 04), functional 2 (BUG-02, 03), performance 1 (PERF-01) |
| Probable findings | 4 (SEC-09, DI-06, BUG-01, PERF-03) |
| Potential risks | 4 (SEC-13, DI-05, BUG-04, PERF-02) |
| Not verified (production state) | 1, critical (SEC-01) |
| Informational | SEC-15, BUG-05, PERF-04; DI-07 (design reviewed, no defect found) |
| Essential missing capabilities (launch-critical, or required with AI or payments) | 6 (MF-01–04, MF-09, MF-10) |
| Critical security findings | 2 (SEC-02 confirmed; SEC-01 not verified) |
| Data-integrity findings | 6 defects/risks (DI-01…DI-06) plus DI-07 design review |
| Unverified user journeys | 9 of 9 authenticated journeys |

## Documents

1. `docs/audit/EXECUTIVE-AUDIT-SUMMARY.md` (this file)
2. `docs/audit/ESSENTIAL-MISSING-FEATURES.md`
3. `docs/audit/BUG-AND-TECHNICAL-RISK-REGISTER.md`
4. `docs/audit/END-TO-END-USER-JOURNEYS.md`
5. `docs/audit/PRE-LAUNCH-ACTION-PLAN.md`
6. `docs/audit/AUDIT-COVERAGE-AND-LIMITATIONS.md`
7. `docs/audit/AI-INTEGRATION-READINESS.md`
