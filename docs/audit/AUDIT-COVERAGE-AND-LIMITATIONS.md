# Audit Coverage and Limitations

Audit date: 2026-09-27 · Baseline: `main` @ `9300c00` (includes the merged `fix/media-loading-and-mobile-video-icon`)

## Branch status

| Branch | Status | Affects findings? |
|---|---|---|
| `fix/media-loading-and-mobile-video-icon` | **Merged** into `main` (`9300c00`). The branch is kept. | Its fixes (signed-URL expiry, batching, image recovery, poster tiles, iOS play badge) are treated as **deployed code**. Real-device QA was reported approved by the owner. |
| `fix/post-editor-media-scheduling` | Not merged. `git cherry` shows both commits (`d38e8c3`, `22cea9e`) already on `main` as equivalent patches. | No. It's stale; recommend deleting it (BUG-05). |
| Other remote branches (46) | Merged into `main`. | No. |

## Route inventory (33 route files inspected)

| Area | Routes |
|---|---|
| Marketing / public | `/` (`(marketing)/page.tsx`), `/preview/[token]` |
| Auth | `/login`, `/register`, `/login/forgot-password`, `/auth/callback` (route handler), `/auth/reset-password` |
| Account | `/account` |
| Projects | `/projects`, `/projects/[projectId]` |
| Project pages | `overview`, `grid`, `calendar`, `stories`, `stories/[storyId]`, `brief`, `assets`, `posts/[postId]`, `settings`, `settings/team`, `settings/notifications`, `settings/activity`, `settings/danger` |
| Modals (intercepted) | `@modal/(.)posts/[postId]`, `@modal/(.)stories/[storyId]`, `@modal/[...catchAll]` |
| Export route handlers | `grid/export`, `grid/export-pdf`, `posts/[postId]/export` |
| Tasks | `/tasks` |
| Admin | `/admin/dashboard`, `/admin/landing`, `/admin/thumbnails` |

**Server actions:** 24 files in `src/lib/actions`. The auth, members, settings, projects, posts, media, media-urls, grid, share-links, brand-writer and overview files were read in the relevant parts; the brief, stories and notifications files were read partially.

**Database:** 40 tables, all with RLS enabled (`schema.sql` plus 11 migration/fix files). Policies were reviewed for `profiles`, `project_members`, `share_links`, the token RPCs, the storage buckets and the helper functions.

## Features inspected (by code)

Authentication, accounts, projects, team and permissions, Overview/brand knowledge (including AI), Grid, Media Library, Image Editor (annotation save paths), Copy/Paste Style (design only), Post Editor, scheduling fields, carousel assets, Stories (partially), Brief (AI design generation, public bucket), Tasks (structure only), Calendar (date logic), Settings, share links and client review, notifications (write paths), admin gate, AI client.

**Inspected only lightly:** Tasks, Stories editor, Brand Assets, landing demo engine, Fabric editor internals, PDF export internals.

## Tests executed

| Test | Result |
|---|---|
| `node --experimental-strip-types src/lib/crop-geometry.test.ts` | 9 passed |
| `node --experimental-strip-types src/app/projects/[projectId]/grid/grid-reducer.test.ts` | 17 passed |
| `node --experimental-strip-types src/app/projects/[projectId]/grid/grid-interaction.test.ts` | 11 passed |
| Local runtime: `/auth/callback` redirect behavior (curl against `next dev`, anon key, no data written) | Open redirect **confirmed** (SEC-03) |
| Local runtime: proxy gating of `/projects`, `/tasks`, `/admin/dashboard` without a session | Correctly redirected to `/login` |
| Local Playwright (Chromium) smoke of 6 public routes at 375 px and 1440 px | No horizontal overflow. Hydration mismatch on `/` (BUG-03). |
| TypeScript, lint and build | Not re-run for this audit (docs-only change). They passed on the same code at merge `9300c00` earlier today: tsc clean, lint 0 errors and 1 pre-existing warning, build OK. |

There's **no test runner script** in `package.json`; the three test files are run by hand with Node. There are **no** integration, RLS, server-action or E2E tests.

## Tests unavailable, and why

| Needed | Blocker |
|---|---|
| Any authenticated journey (A–I) | No test accounts. Creating accounts or data in the live project is outside the audit rules. |
| Production RLS and policy verification (SEC-01 and others) | No database or dashboard access; only the anon key is available. |
| Storage bucket configuration (MIME, size, public flags as deployed) | No dashboard access. |
| Supabase Auth settings (email confirmation, secure password change, redirect allowlist, rate limits, SMTP) | No dashboard access. |
| Vercel configuration (function timeouts, env vars incl. whether `ANTHROPIC_API_KEY` is set, region/timezone) | No Vercel access. |
| Real performance measurements (Grid first load, Library, mobile 4G) | Needs an authenticated session and a realistic dataset. The `?mediaDiag=1` instrumentation is ready for manual use. |
| Load or concurrency tests (exports, AI, credit races) | No staging environment. |
| Orphaned storage volume | Needs a service-role listing. |

## Missing credentials and access (none requested or exposed)

- A Supabase service-role key, or dashboard access, to read `pg_policies`, bucket settings and Auth settings.
- A staging project mirroring production.
- Test accounts: owner, admin, editor, client or viewer, and a non-member.
- Vercel project access (environment and logs).
- Anthropic Console access (spend limits, usage reports, API key scoping).

## Production behavior not verified

Everything marked **CONFIRMED (code)**, **PROBABLE**, **POTENTIAL RISK** or **NOT VERIFIED** in the register still needs a real reproduction. In particular:
1. SEC-01: the actual `profiles` update policy in production.
2. Whether `ANTHROPIC_API_KEY` is set in production (it decides whether SEC-02 is live).
3. DI-01: the client-feedback nesting in a real browser.
4. BUG-01: the Vercel runtime timezone.
5. Email delivery for signup and recovery.

## Rules followed

No application code changed; no feature implemented; no migration run; no production data read or written (the only runtime contact with Supabase was unauthenticated page rendering by a local dev server using the public anon key); no deployment; no merge; no secrets printed. One temporary Playwright script was created in the repo root and deleted in the same command. The only committed files are under `docs/audit/`.
