# Bug and Technical Risk Register

Audit date: 2026-09-27 · Baseline: `main` @ `9300c00` · Branch: `audit/full-product-prelaunch`

## Verification status legend

| Status | Meaning |
|---|---|
| **CONFIRMED (runtime)** | Reproduced by actually running the app (local dev server against the real Supabase project, anon key only, no data written). |
| **CONFIRMED (code)** | The behavior follows deterministically from the code or SQL. It was **not** reproduced in a browser against production. |
| **PROBABLE** | Very likely from the code, but it depends on an environment fact I couldn't check (e.g. the Vercel runtime timezone, or Supabase Auth settings). |
| **POTENTIAL RISK** | A design weakness that becomes a bug or incident under plausible conditions. |
| **NOT VERIFIED** | The production state is unknown and must be checked by someone with access. |

Severity levels are Critical, High, Medium and Low. Complexity is S (under half a day), M (1–3 days) or L (more than 3 days).

No authenticated session, production database access or service-role key was available. Every "CONFIRMED (code)" item still needs a real reproduction before its fix is signed off. See `AUDIT-COVERAGE-AND-LIMITATIONS.md`.

---

## Security

### SEC-01: Users may be able to make themselves site admins (production state unknown)
- **Where:** `supabase/schema.sql:31-34` (policy "Users can update their own profile", `USING (id = auth.uid())`, no `WITH CHECK`) and `src/lib/admin-auth.ts` (`requireAdminServiceClient` trusts `profiles.is_admin`, then returns a **service-role** client).
- **Description:** A fix exists in `supabase/fix_admin_dashboard_schema.sql:26-35`, which adds a `WITH CHECK` pinning `is_admin` to its current value. However, the fix is **not** in `schema.sql` or in `RUN_ALL_PENDING_MIGRATIONS.sql`. If production doesn't have the fixed policy, any registered user can run `supabase.from('profiles').update({ is_admin: true }).eq('id', <self>)` in the browser console. They would then have `/admin/*` access, which uses the service-role key and bypasses all RLS across every project.
- **Severity:** Critical if the fix is unapplied; none if it is applied.
- **Evidence:** the three SQL files above. The file's own comment (lines 15–21) describes the exact attack.
- **Reproduction (safe, for someone with DB access):** `select policyname, qual, with_check from pg_policies where tablename='profiles' and cmd='UPDATE';`. If `with_check` is null or doesn't mention `is_admin`, the database is vulnerable.
- **Recommended fix:** confirm in production. Fold the fixed policy into `schema.sql` and the consolidated migration so a fresh environment can't regress. Consider moving admin status off `profiles` (e.g. to an `admin_users` table with no client-writable policy).
- **Complexity:** S · **Status:** NOT VERIFIED (production). The fresh-install scripts are CONFIRMED (code) vulnerable.

### SEC-02: AI server actions have no authorization, membership, input-size or usage controls
- **Where:**
  - `src/lib/actions/brand-writer.ts` → `generateBrandCopy`
  - `src/lib/actions/overview.ts` → `generateBrandSummary`, `suggestPersonalitySpectrum`, `generateBrandSections`, `generateAiInsights`, `refreshBrandIntelligence` (which fans out to several of these in parallel)
  - `src/lib/ai/client.ts` → `generateText`, `generateWithImages`, `analyzeDocument`
- **Description:**
  - None of these actions calls `auth.getUser()` or checks project membership or role before calling Anthropic. RLS only limits what *context* is read and whether the *result* is written back. The paid model call happens regardless.
  - `request`, `history` and `currentText` in `generateBrandCopy` have no length limits.
  - Nothing records `response.usage`, and there is no per-user, per-project or global limit, no concurrency limit and no kill switch.
  - `refreshBrandIntelligence` triggers several Opus calls per click.
  - `generateBriefDesign` (`brief.ts:811`) does check the session, but it also has no usage limits.
- **Exposure today:** requests with no session are redirected by the proxy (`src/lib/supabase/proxy.ts`), because every page that includes these actions is protected. But **any self-registered account** (signup is open, `auth.ts:signup`) can call them for any `projectId`, including projects it isn't a member of, in a loop, with arbitrarily large inputs. The spend is real once `ANTHROPIC_API_KEY` is set in production. Whether the key is set there is **unknown**; memory from 2026-08 says it wasn't yet.
- **Severity:** Critical as soon as the key is set in production.
- **Recommended fix:** route every AI call through a single server-side gateway that does, in order: auth → membership/role → kill switch → input limits → credit reservation → call with explicit `max_tokens` and timeout → usage capture from `response.usage` → final settlement. See `AI-INTEGRATION-READINESS.md`.
- **Complexity:** M (the gateway) plus L (the ledger and credits) · **Status:** CONFIRMED (code).

### SEC-03: Open redirect in `/auth/callback`
- **Where:** `src/app/auth/callback/route.ts`. `next` goes straight into `new URL(next, url.origin)`. The fallback branch redirects even when no `code` is present.
- **Reproduction (performed locally):** `GET /auth/callback?next=//evil.example/phish` → `307 Location: http://evil.example/phish?error=invalid_link`. `next=https://evil.example` behaves the same.
- **Impact:** phishing through a link that really is on the app's domain. It could be chained with the password-reset flow's `next`.
- **Severity:** Medium–High.
- **Recommended fix:** only accept `next` values that start with a single `/`, not `//` or `/\`, and fall back to `/projects` otherwise.
- **Complexity:** S · **Status:** CONFIRMED (runtime, local).

### SEC-04: `get_user_id_by_email` RPC lets any user enumerate accounts
- **Where:** `supabase/schema.sql:184-194` (SECURITY DEFINER, `grant execute ... to authenticated`, returns `auth.users.id`). It's also exposed through the UI: `members.ts:inviteMember` returns "No account found with that email".
- **Impact:** any registered user can check whether any email has an account and get that account's UUID. It's a privacy leak and gives attackers a recon primitive.
- **Recommended fix:** do the lookup inside a server action that has already verified owner/admin rights, run it with the service role (or an RPC that itself checks `project_role(p_project_id) in ('owner','admin')`), and revoke direct execute from `authenticated`. Pending invitations (MF-02) also remove the need to tell the inviter whether an account exists.
- **Severity:** Medium · **Complexity:** S · **Status:** CONFIRMED (code).

### SEC-05: Every user's email address is readable by every other user
- **Where:** `supabase/schema.sql:26-29`, policy "Profiles are viewable by any authenticated user" (`USING (true)`), on a table with an `email` column (`schema.sql:14`).
- **Impact:** any registered account can run `select name, email from profiles` and get the whole user base, including other companies' clients and team members. For a paid multi-tenant SaaS this is a significant privacy problem.
- **Recommended fix:** restrict SELECT to yourself plus people you share a project with (`exists (select 1 from project_members a join project_members b on a.project_id = b.project_id where a.user_id = auth.uid() and b.user_id = profiles.id)`), or move `email` to a separate, more restricted view. Check the @mention and assignee pickers afterwards.
- **Severity:** High · **Complexity:** S–M (regression-test the pickers) · **Status:** CONFIRMED (code).

### SEC-06: Admins can make themselves owner, or remove the owner, directly through RLS
- **Where:** `supabase/schema.sql:159-163`, policy "Owners/admins can manage membership" `FOR ALL` with `project_role(project_id) in ('owner','admin')`. `fix_project_role_permission_presets.sql` asserts it's unchanged.
- **Impact:** the UI routes ownership changes through `members.ts:transferOwnership`. At the database level, though, an admin can `update project_members set role='owner'` on their own row, or delete the real owner's row, from the browser client.
- **Recommended fix:** split the policy so admins can't write rows where `role = 'owner'` (in either USING or WITH CHECK) and can't set `role = 'owner'`. Keep ownership transfer inside a SECURITY DEFINER RPC that checks the caller is the owner.
- **Severity:** Medium · **Complexity:** S · **Status:** CONFIRMED (code).

### SEC-07: Anonymous share-link writes have no size limits, no rate limits and no history
- **Where:** `set_post_notes_by_token` and `set_story_notes_by_token` (`schema.sql` around lines 1186–1230), and the review-status RPCs, all `grant ... to anon`.
- **Impact:** anyone with a share link can write unlimited text into `posts.notes` and `stories.notes`, as often as they like. There's no length cap and no throttling (see also DI-01).
- **Recommended fix:** cap the length in the RPC (e.g. 5,000 characters), rate-limit the server action per token and IP, and consider a separate `client_feedback` table.
- **Severity:** Medium · **Complexity:** S–M · **Status:** CONFIRMED (code).

### SEC-08: Brief media is in a public bucket and stays public after deletion
- **Where:** `supabase/schema.sql` around line 826 (`brief-media` created with `public = true`, by design, for URLs that never expire). Deleting a project never removes Storage objects (DI-03).
- **Impact:** Brief images and videos are reachable by anyone with the URL, forever, including after the project is deleted or a member is removed. The URLs are UUIDs, so they're hard to guess, but they aren't private.
- **Recommended fix:** decide on purpose whether Brief media may be public. If not, move it to a private bucket with signed URLs (the same pattern and `RecoverableImg` recovery already used for project media). At minimum, delete the objects when the project is deleted.
- **Severity:** Medium (depends on the privacy promise made to customers) · **Complexity:** M · **Status:** CONFIRMED (code).

### SEC-09: Allowed file types are only checked in the browser
- **Where:** `src/lib/upload-limits.ts` checks size only. The pickers use `accept="image/*,video/*"`, which is advisory. No SQL sets `allowed_mime_types` on any bucket (grep found no matches). Uploads go straight from the browser to Storage (`src/lib/direct-upload.ts`).
- **Impact:** any authenticated editor can upload any file type, e.g. HTML or SVG, including into the public `brief-media` bucket. That enables content hosting on the Supabase domain (phishing, malware distribution).
- **Recommended fix:** set `allowed_mime_types` per bucket (images, videos, and PDF only where needed) and validate the type server-side where a server action touches the file.
- **Severity:** Medium · **Complexity:** S · **Status:** PROBABLE (bucket configuration could have been changed in the dashboard; not visible from here).

### SEC-10: The app has no rate limiting
- **Evidence:** no matches for `ratelimit`, `rate-limit` or `upstash` in `src/`. Login, signup and password reset rely only on Supabase Auth's built-in limits, which weren't checked. Server actions, share-link RPCs, AI actions and export routes (`grid/export`, `grid/export-pdf`, `posts/[postId]/export`, all CPU-heavy with `sharp`/`pdf-lib`) have none.
- **Severity:** Medium overall; High for AI (covered in SEC-02) · **Complexity:** M · **Status:** CONFIRMED (code).

### SEC-11: No security headers (CSP, frame-ancestors, etc.)
- **Evidence:** `next.config.ts` has no `headers()`, and `src/proxy.ts` sets none.
- **Impact:** the app can be framed (clickjacking) and has no CSP defense-in-depth against XSS.
- **Severity:** Low–Medium · **Complexity:** S–M (a CSP needs testing with Supabase, Fabric and fonts) · **Status:** CONFIRMED (code).

### SEC-12: Changing your password doesn't ask for the current password
- **Where:** `src/lib/actions/settings.ts:updateAccountPassword` calls `auth.updateUser({ password })`.
- **Impact:** a hijacked session, or an unlocked device, can take over the account for good. Supabase's "Secure password change" setting may add reauthentication, but that setting wasn't verified.
- **Severity:** Medium · **Complexity:** S · **Status:** CONFIRMED (code); Supabase setting NOT VERIFIED.

### SEC-13: The password-reset link's origin comes from the request's Host header
- **Where:** `src/lib/actions/auth.ts:getSiteOrigin` (`x-forwarded-host` / `host`).
- **Impact:** safe only if Supabase Auth's Redirect URL allowlist is strict (no broad wildcards). Vercel sets `x-forwarded-host` itself, which reduces the risk.
- **Recommended fix:** use a configured `SITE_URL` environment variable and verify the allowlist.
- **Severity:** Low–Medium · **Complexity:** S · **Status:** POTENTIAL RISK / NOT VERIFIED (Supabase configuration).

### SEC-14: Some SECURITY DEFINER functions don't pin `search_path`
- **Where:** `is_project_member`, `project_role`, `get_user_id_by_email` (`schema.sql:109-127, 184-191`). Newer functions already use `set search_path = public`.
- **Severity:** Low (Supabase linter class) · **Complexity:** S · **Status:** CONFIRMED (code).

### SEC-15: The storage-read policy for share links is path-based and ignores thumbnails
- **Where:** `is_media_path_shared` (`schema.sql:1288`) matches `storage_path`, `preview_storage_path` and `poster_storage_path`, but not `thumbnail_storage_path`.
- **Impact:** correct for access control, since revocation (deleting the link) cascades its items and read access ends. Shared galleries just can't use the small thumbnails, so client previews load full originals (a performance issue, see PERF-03). Share links have no expiry (MF-05).
- **Severity:** Low · **Status:** CONFIRMED (code).

---

## Data integrity

### DI-01: Client feedback wraps itself again on every save and replaces team notes
- **Where:** `src/app/preview/[token]/shared-gallery.tsx:136-190` (`formatFeedback`, `ReviewControls`).
- **Description:**
  - The review textarea is pre-filled with the stored `notes`. Each save stores `Status: X\n\nClient Feedback:\n"<textarea content>"`, and every status click also re-saves the notes.
  - Nothing parses the stored value back out. So the second save produces `Client Feedback:\n"Status: X\n\nClient Feedback:\n"…""`, one extra level per click.
  - The team's own Post Editor "Notes" field (`post-editor.tsx` around line 1527) is **the same column**. The client sees the team's internal notes, and saving feedback wraps and relabels them as "Client Feedback".
- **Reproduction:** open a share link → click Approve → click Changes Requested → reopen the post in the Post Editor → Notes shows nested `Status:`/`Client Feedback:` blocks.
- **Severity:** Medium (data corruption in a client-facing feature; can leak internal notes to clients).
- **Recommended fix:** store client feedback separately (a `review_feedback` column or a comments table) and stop exposing team `notes` to the anonymous preview.
- **Complexity:** M · **Status:** CONFIRMED (code trace), not browser-reproduced.

### DI-02: Writes can fail while the UI reports success
- **Where:** 17 awaited Supabase writes in `src/lib/actions` never read `error`, for example:
  - `posts.ts:71` `deletePost`
  - `stories.ts:340,350` story delete
  - `stories.ts:579` frame delete
  - `grid.ts:125` row delete
  - `posts.ts:555` link delete
  - `media.ts:203` poster link
  - `notifications.ts:8,18`
  - `task-automation.ts:39` auto-task insert
  - cover-transform resets at `grid.ts:558,575`, `posts.ts:497`, `media.ts:160`

  Callers update the UI optimistically and never learn about the failure.
- **Systemic part:** even where `error` *is* checked, an UPDATE or DELETE that RLS filters out returns **no error and 0 rows**. No write in the codebase uses `.select()` or `count` to confirm it actually hit a row.
- **Reproduction:** a transient network or DB error during a delete: the post disappears in the UI and comes back on the next visit. The same happens for a user whose role changed mid-session.
- **Severity:** Medium–High (the "UI says saved, DB didn't change" class the brief specifically asked about).
- **Recommended fix:** check `error` everywhere, and for destructive or important writes use `.select('id')` and treat an empty result as failure. Add a lint rule or wrapper helper.
- **Complexity:** M · **Status:** CONFIRMED (code).

### DI-03: Storage objects are never deleted, so files pile up and survive deletion
- **Where:**
  - `settings.ts:deleteProjectPermanently` deletes only the DB row (cascade).
  - `media.ts:saveMediaAssetPosterAnnotation` and the annotation save upload a **new** preview/poster file for every edit (`${projectId}/${uuid}-poster.jpg`) and never remove the old one.
  - The only `remove()` calls on `project-media` are upload-failure cleanups in `stories.ts:269,531`.
- **Impact:** unbounded storage growth (cost). Deleted customers' media stays in Storage indefinitely, which breaks the expectation of data deletion. Copy-on-write clones share the source's storage paths (`media.ts:108-111`), so a naive cleanup would break other posts. **Any cleanup must be reference-counted.**
- **Severity:** Medium (cost and privacy) · **Complexity:** M–L · **Status:** CONFIRMED (code). How much storage is actually orphaned is NOT VERIFIED.

### DI-04: The production schema is unknowable from the repository
- **Evidence:** there's no migration tool or history table. The repo has 12 hand-run SQL files (`supabase/*.sql`), and `schema.sql` has drifted from the later fixes (see SEC-01). Many code paths deliberately "isolate" columns that might not be migrated yet (`grid/page.tsx`, `data/posts.ts`), which shows the schema state has been uncertain before.
- **Impact:** you can't prove which security fixes are live, can't rebuild the environment reliably, and can't do a reliable disaster restore.
- **Recommended fix:** snapshot the production schema (`supabase db dump --schema-only`), diff it against the repo, and adopt Supabase CLI migrations from that baseline.
- **Severity:** High (operational) · **Complexity:** M · **Status:** CONFIRMED (process).

### DI-05: Concurrent edits: last write wins, with no conflict detection
- **Where:** `posts.ts:updatePost` and the other update actions write whole field sets with no `updated_at` or version check.
- **Impact:** two team members editing the same post silently overwrite each other. Same for the client-notes RPC against the team (DI-01).
- **Severity:** Low–Medium (acceptable for v1 if documented) · **Complexity:** M · **Status:** POTENTIAL RISK.

### DI-06: Inviting someone by email is case-sensitive
- **Where:** `members.ts:inviteMember` only `trim()`s the email. `get_user_id_by_email` compares with `=` against `auth.users.email`. Signup and login lowercase the email (`auth.ts:normalizeEmail`).
- **Impact:** inviting `Jane@Company.com` says "No account found" even though Jane is registered.
- **Recommended fix:** lowercase the email before lookup, or use `lower(email) = lower(p_email)`.
- **Severity:** Low–Medium · **Complexity:** S · **Status:** PROBABLE (depends on the stored email being lowercase, which is what Supabase does by default).

### DI-07: Media identity model (copy-on-write, archived clones)
- **Where:** `media.ts:cloneMediaAssetForDivergence` and the archive-based Library filtering.
- **Assessment:** the code is consistent. Clones are inserted `archived`, every Library listing filters archived rows out, and edits fail closed when a needed clone fails. The recent fixes (`9553252`, `da060c2`, `534d310`, `cc2b166`) are on main.
- **Residual risk:** the clone copies the source's storage paths (shared files), so DI-03 cleanup must be reference-aware. Existing tests don't cover identity; the reducer tests are pure-state only.
- **Status:** the design was reviewed (code). Real multi-post, multi-user behavior is NOT VERIFIED in this audit (it was user-QA'd in earlier sessions).

---

## Functional bugs

### BUG-01: "Today" is calculated in the server's timezone, not the user's
- **Where:**
  - `calendar/page.tsx:41,238` and `overview/page.tsx:26-28` use `format(new Date(), "yyyy-MM-dd")` in a Server Component.
  - The user's `timezone` preference (`account-settings.ts:15,50`, default `"UTC"`) isn't read anywhere outside Settings.
- **Impact:** on Vercel (UTC), a user at UTC+3 sees yesterday highlighted as "today" between 00:00 and 03:00 local time. The week and month boundaries and the "this week" counts are off in the same way. A user west of UTC sees tomorrow as "today" in the evening.
- **Severity:** Low–Medium · **Complexity:** S–M (compute on the client, or use the saved timezone) · **Status:** PROBABLE (assumes Vercel's default UTC runtime). The fact that the timezone setting does nothing is CONFIRMED (code).

### BUG-02: AI client has no error handling, a very long timeout and no usage capture
- **Where:** `src/lib/ai/client.ts`. `messages.create` is called with no try/catch, so SDK errors (429, 5xx, timeouts) become unhandled Server Action errors.
- **Problems:**
  - It relies on SDK defaults (10-minute timeout, 2 retries), so one call can run for up to ~30 minutes of wall clock. That exceeds Vercel function limits, and the client sees a generic failure.
  - `response.usage` and `stop_reason` are ignored. A truncated (`max_tokens`) or refused response is parsed as if it were normal.
  - The model is hardcoded in three places.
- **Severity:** Medium (becomes High with real users) · **Complexity:** S–M · **Status:** CONFIRMED (code).

### BUG-03: Landing page hydration mismatch
- **Where:** `/` (`src/app/(marketing)/page.tsx` and its client components).
- **Reproduction (performed locally):** load `/` in a clean Playwright Chromium at 375px or 1440px. The console shows "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties."
- **Severity:** Low (cosmetic or a flash; can hide real hydration bugs) · **Complexity:** S · **Status:** CONFIRMED (runtime, dev build).

### BUG-04: Post Editor has no unsaved-changes guard
- **Where:** there are no `beforeunload` or dirty-state guards except in `account-panel.tsx` and `brief-board.tsx`. The Post Editor (a modal via the intercepted route) keeps caption and notes in local state until submit.
- **Impact:** closing the modal, navigating away or tapping the backdrop can throw away caption edits without warning. The size of the impact depends on whether each field autosaves, which wasn't verified in a browser.
- **Severity:** Medium (data loss for the core writing task) · **Complexity:** S–M · **Status:** POTENTIAL RISK / NOT VERIFIED.

### BUG-05: Stale unmerged branch
- **Where:** `origin/fix/post-editor-media-scheduling` (2 commits, 2026-09-17).
- **Evidence:** `git cherry` shows both commits as already applied to `main` as equivalent patches, so nothing on it is missing from production.
- **Recommended action:** delete the branch after confirming, so no one mistakes it for pending work.
- **Severity:** Housekeeping · **Status:** CONFIRMED.

---

## Performance and reliability

### PERF-01: Grid page signs every Library asset on every load
- **Where:** `grid/page.tsx` signs thumbnail or original (plus video posters) for **all** non-archived assets, unpaginated. `MediaLibrary` and `MediaPickerDialog` render all of them.
- **Status:** signing is now batched (100 per call), cached per 30-minute window and lazily loaded (commit `77e9cdc`). RSC payload size and render cost still grow linearly with Library size. There's no pagination here, unlike the Post Editor Library.
- **Severity:** Medium at around 1,000+ assets · **Complexity:** M · **Status:** CONFIRMED (code). No real-dataset measurement.

### PERF-02: Server-side export routes are heavy and unguarded
- **Where:** `grid/export`, `grid/export-pdf` and `posts/[postId]/export` run `sharp`/`pdf-lib` over full-resolution originals, with no concurrency or rate limit and no size cap.
- **Severity:** Medium (Vercel duration and memory limits, cost) · **Status:** POTENTIAL RISK (not load-tested).

### PERF-03: Shared client galleries load full-size originals
- **Where:** see SEC-15. `share-preview.ts` signs `storage_path` and preview paths, never thumbnails.
- **Severity:** Low–Medium (slow client previews on mobile) · **Status:** PROBABLE (code; not measured).

### PERF-04: No real-user performance data
- **Description:** there's no RUM or analytics. The opt-in `?mediaDiag=1` instrumentation added in `77e9cdc` is the only timing tool.
- **Status:** CONFIRMED absence.
