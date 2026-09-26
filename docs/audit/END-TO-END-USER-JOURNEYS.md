# End-to-End User Journeys

Audit date: 2026-09-27 · Baseline: `main` @ `9300c00`

**Headline: none of the authenticated journeys (A–I) was executed end to end in this audit.** No test account, production session or permission to create accounts or data in the live Supabase project was available. The rules forbid modifying live data, and signing up would create a real auth user.

Each journey below lists what **was** done (static tracing, plus a local runtime check where it's safe) and where it's likely to fail. A journey counts as VERIFIED only after a real run by someone with authorized test accounts.

| Journey | Result | Verified parts |
|---|---|---|
| A: Register → verify → login → project → invite → work | **NOT VERIFIED** | The register and login pages render (desktop and mobile, no console errors) |
| B: Forgot password → email → reset → login | **NOT VERIFIED** (email delivery can't be tested) | The forgot-password and reset pages render; the expired-link state renders "Link expired." |
| C: Upload → Grid → edit → save → refresh → reopen | **NOT VERIFIED** | Code traced; image-loading recovery was mock-tested in `77e9cdc` |
| D: One Library image in several posts → independent edits → reset one | **NOT VERIFIED** in this audit (it was user-QA'd in earlier sessions) | Code traced (copy-on-write) |
| E: Create post → media → caption → schedule → save → reopen → refresh | **NOT VERIFIED** | Code traced |
| F: Carousel → add → reorder → edit → save → reopen | **NOT VERIFIED** | Code traced |
| G: Share → client reviews → approve/reject → feedback → owner sees it | **NOT VERIFIED**; failure predicted (DI-01) | Invalid token → "Preview Unavailable" page renders |
| H: Mobile: project → Grid → Post Editor → Library → edit → save | **NOT VERIFIED** | Public pages have no horizontal overflow at 375px |
| I: Recovery (failed upload, interrupted save, expired session, network, invalid file, unauthorized) | **NOT VERIFIED**; several failures predicted | See the per-case notes |

---

### Journey A: Onboarding
**Trace:**
1. `register/page.tsx` → `auth.ts:signup` (Zod: name ≥ 2 characters, password ≥ 8, lowercased email). If email confirmation is on, the user sees "Check your email…".
2. Login goes to `resolveLandingPath` and on to `/projects`.
3. `createProjectWithSetup` creates the project; the `handle_new_project` trigger makes the creator the owner.
4. The invitation goes through `settings/team` → `inviteMember`.

**Predicted failure points:**
- **Inviting someone who hasn't registered fails** ("No account found… they need to register first"). There's no pending invite and no email (MF-02). A new customer's first attempt to invite a colleague is likely to hit this.
- Mixed-case invite email → "No account found" (DI-06).
- An invited existing user is added silently, with only an in-app notification.
- There's no resend-verification path (MF-12).

**To verify:** two fresh test accounts on a staging Supabase project.

### Journey B: Password recovery
**Trace:**
1. `login/forgot-password` → `requestPasswordReset` (same response whether or not the account exists, which is good). The `redirectTo` comes from the Host header (SEC-13).
2. `/auth/callback` exchanges the code (open redirect in `next`, SEC-03).
3. `/auth/reset-password` → `updateRecoveryPassword` → sign out → `/login?reset=success`.

**Runtime check (local):** the reset page with no session renders "Link expired." The callback with a bogus code redirects to `next?error=invalid_link`.

**Not verifiable here:** email delivery (Supabase SMTP configuration), link lifetime, and whether the Redirect URL allowlist includes the production domain.

### Journey C: Media round trip
**Trace:**
1. `uploadFilesConcurrently` → direct Storage upload → client thumbnail (server `sharp` fallback for HEIC) → `uploadMedia`.
2. Assign to a slot (`grid-board.tsx`).
3. Image Editor → `saveMediaAssetAnnotation` (copy-on-write when the asset is shared).
4. Reload: `grid-data.ts` resolves the display path.

**Risks:**
- Every save uploads a new preview file and never deletes the old one (DI-03, cost only).
- A failed poster link write is ignored (`media.ts:203`, DI-02).

**To verify:** a real upload of JPEG, HEIC and a large video on desktop and iOS.

### Journey D: Reuse and isolation
**Trace:** `cloneMediaAssetForDivergence` inserts an archived clone and repoints only the edited post's `post_assets` row. Edits fail closed when a required clone fails.

**Status:** the design is consistent. Not re-executed in this audit; it relies on the prior user QA of commits `9553252`, `da060c2`, `534d310`, `cc2b166`. There are no automated identity tests (a test gap).

### Journey E: Post lifecycle
**Trace:** the Post Editor (intercepted modal) → `updatePost` (whole-form write, last write wins, DI-05). Date and time are stored as `date` + `time` with no timezone.

**Predicted issues:**
- Closing the modal with unsaved caption edits may lose them (BUG-04).
- "Today" in the Calendar can be off by one day depending on the user's timezone (BUG-01).
- Deleting a post ignores DB errors (DI-02).

### Journey F: Carousel
**Trace:** `SortableAsset` plus dnd-kit reorder, add from the paginated Library (24 per page), replace-from-library, per-asset edit.

**Status:** code traced only.

### Journey G: Client review
**Trace:**
1. `createShareLink` (UUID token) → `/preview/[token]` → `get_shared_preview`.
2. Approve or request changes → `set_*_review_status_by_token`, plus a notes rewrite → `notifyProjectMembers`.

**Predicted failures:**
- **Client feedback wraps itself again on each click and replaces the team's own Notes** (DI-01).
- The client sees the team's internal Notes (the same column).
- There's no expiry (MF-05) and no length or rate limits on anonymous writes (SEC-07).
- The owner is notified in-app only (no email).

### Journey H: Mobile
**Runtime check (local, public pages only):**
- `/`, `/login`, `/register`, `/login/forgot-password`, `/auth/reset-password` and `/preview/<invalid>` at 375×812: no horizontal overflow and no console errors.
- The exception is `/`, which has a hydration mismatch warning (BUG-03).

**Authenticated mobile surfaces** (Grid, Post Editor, Library, Image Editor) were **not** exercised. Past sessions' notes say the "Mobile UX pass #2" was also not browser-verified.

### Journey I: Recovery cases
| Case | Predicted behavior (code) |
|---|---|
| Failed upload | Grid: per-file error toast and the placeholder is removed (`use-library-items.ts`). Stories: uploaded files are cleaned up on failure (`stories.ts:269,531`). |
| Interrupted save | Optimistic UI plus server action. Some writes ignore errors (DI-02), so the UI can show success while the DB didn't change. |
| Expired session | The proxy redirects page navigations to `/login`. Server actions called with an expired session: most return "Not signed in" or an RLS-empty result. Not verified. |
| Temporary network failure (images) | Bounded recovery with `RecoverableImg` (merged in `77e9cdc`; mock-verified). |
| Invalid file | Only the size is checked client-side; the MIME type isn't enforced server-side (SEC-09). HEIC falls back to the server thumbnail. |
| Unauthorized operation | RLS blocks writes. Deletes blocked by RLS return **no error**, so the UI may show success (DI-02). |

## Required to close this document
1. A **staging Supabase project** with a copy of the production schema (see DI-04), and two or three test accounts (owner, editor, client).
2. The journeys run with Playwright (desktop Chromium plus mobile WebKit emulation), plus one real iPhone pass.
3. Record pass or fail with screenshots per step, and link failures to register IDs.
