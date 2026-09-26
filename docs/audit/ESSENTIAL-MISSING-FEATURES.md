# Essential Missing Features

Audit date: 2026-09-27 · Baseline: `main` @ `9300c00`

This is written from the point of view of a first-time **paying** customer. Every item was checked against the repository; "missing" means no code path exists (evidence in each item).

**Launch necessity** uses three levels:
- **Launch-critical:** don't take money without it.
- **Important:** expected by customers; can follow shortly after launch.
- **Optional:** feature expansion.

None of these block **AI development**, except where noted in `AI-INTEGRATION-READINESS.md`.

## Summary

| ID | Capability | Necessity | Complexity |
|---|---|---|---|
| MF-01 | Account deletion (self-serve) | Launch-critical | M |
| MF-02 | Invitations for people without an account, with acceptance and email | Launch-critical | M–L |
| MF-03 | Leave a project (non-owner self-removal) | Launch-critical | S |
| MF-04 | Terms of Service, Privacy Policy, AI-processing disclosure, consent at signup | Launch-critical (legal content needs professional review) | S (engineering) |
| MF-05 | Share-link expiry and management of existing links | Important | S–M |
| MF-06 | Honor the saved Timezone preference | Important | S–M |
| MF-07 | Unsaved-changes protection in the Post Editor | Important | S–M |
| MF-08 | Re-authentication for sensitive account changes | Important | S |
| MF-09 | Billing, plans, credits UI | Launch-critical **only if launching paid** (monetization phase) | L |
| MF-10 | AI usage balance, limits and history | Required **with AI** (see the AI readiness doc) | M |
| MF-11 | Data export (download my project's content and media) | Important | M |
| MF-12 | Resend verification email / clearer unverified-login handling | Important | S |
| MF-13 | Transactional email for app events (notifications, invites, reviews) | Important | M |
| MF-14 | Actual publishing to Instagram/TikTok | Optional (product decision: Flow:er is currently a planner) | L |
| MF-15 | Two-factor authentication | Optional for launch; important for agencies | M |

---

## Details

### MF-01: Account deletion
1. **What's missing:** a user can't delete their own account. There's no `deleteUser`, no admin auth deletion and no UI; `grep` for `deleteUser` returns nothing. `profiles` cascades from `auth.users`, but nothing triggers that deletion.
2. **Why users need it:** a basic expectation of ownership and privacy, and commonly required by privacy regulation and app-store and payment-provider policies (external legal verification required).
3. **Current behavior:** the only option is emailing support. There's also no documented support channel.
4. **Minimum viable implementation:** Account → Danger zone → confirm with the password. A server action that uses the service role:
   - Block if the user owns projects that have other members (require a transfer first), or delete sole-member projects.
   - Delete the Storage objects for deleted projects (see DI-03).
   - Call `auth.admin.deleteUser`.
5. **Launch necessity:** launch-critical.
6. **Complexity:** M (the ownership edge cases and storage cleanup are the real work).

### MF-02: Invitations for new users, with acceptance and email
1. **What's missing:**
   - `members.ts:inviteMember` works only if the invitee **already has an account** ("No account found with that email — they need to register first"). There's no pending-invitation record, no invite email, no accept/decline step, and no expiry or cancellation (nothing pending exists to cancel).
   - Existing users are **added immediately without consent**. They only receive an in-app notification.
2. **Why:** inviting a teammate or client who hasn't signed up yet is the core growth loop for a team tool.
3. **Current behavior:** the owner has to tell the person to register manually, then invite again. The lookup also reveals whether an email is registered (SEC-04), and it's case-sensitive (DI-06).
4. **Minimum viable implementation:**
   - An `invitations` table (email, project, role, token hash, expires_at, accepted_at, revoked_at).
   - An invite email containing a link.
   - Signup or login with the link joins the project.
   - A pending list in Team settings with Revoke and Resend.
5. **Launch necessity:** launch-critical.
6. **Complexity:** M–L (depends on the email provider, see MF-13).

### MF-03: Leave project
1. **What's missing:** no leave or self-remove action. `grep "leaveProject|Leave project"` finds nothing. `removeMember` requires owner or admin (`assertCanManageMembers`).
2. **Why:** freelancers and clients need to exit projects they no longer work on.
3. **Current:** they depend on an admin to remove them.
4. **MVI:** a "Leave project" button for non-owners; an RLS or RPC path that allows deleting your own membership row except as owner.
5. **Launch-critical** (small). 6. **S.**

### MF-04: Legal pages and consent
1. **What's missing:** no Terms or Privacy routes or links anywhere in `src/app`, no consent checkbox at signup (`register` page), and no disclosure that content may be sent to an AI provider (Anthropic).
2. **Why:** required before charging customers, and before sending customer content to a third-party AI.
3. **Current:** none.
4. **MVI:** static `/terms` and `/privacy` pages, links in the footer, signup and settings, plus a consent line at signup. **The content requires professional legal review; this audit makes no compliance claim.**
5. **Launch-critical.** 6. **S** (engineering only).

### MF-05: Share-link expiry and management
1. **What's missing:** `share_links` has no `expires_at` or `revoked_at` (`schema.sql:984-991`). Revocation is deletion (`share-links.ts:deleteShareLink`), which works and cascades access. There's no expiry, and no view-only mode (every link can approve and write notes).
2. **Why:** agencies send links to clients and need them to stop working after a campaign, or to share "view only".
3. **Current:** links live forever until deleted.
4. **MVI:** an optional `expires_at` checked in `get_shared_preview`, `is_media_path_shared` and the write RPCs, plus an "allow review" flag.
5. **Important.** 6. **S–M.**

### MF-06: Timezone preference has no effect
1. **What's missing:** the saved `timezone` (`account-settings.ts`) is never read outside Settings. "Today" is computed on the server (BUG-01).
2. **Why:** scheduling is date-based; showing the wrong "today" undermines trust.
3. **Current:** the setting is saved but ignored.
4. **MVI:** compute today and week boundaries on the client, or pass the saved timezone into server date math. Alternatively, hide the setting until it works.
5. **Important.** 6. **S–M.**

### MF-07: Unsaved-changes protection (Post Editor)
See BUG-04. **MVI:** track dirty state for caption, notes, date and time, and confirm before the modal closes or the route changes. **Important.** **S–M.**

### MF-08: Re-authentication for sensitive changes
`updateAccountPassword` and the email change in `updateAccountProfile` don't require the current password (SEC-12). **MVI:** require the current password, or enable Supabase's secure password and email change settings. **Important.** **S.**

### MF-09: Billing and plans
No payment provider, plan model, invoices or subscription state exists. Needed only when monetizing. See `AI-INTEGRATION-READINESS.md` §9. **L.**

### MF-10: AI usage, balance and limits
Required as part of AI integration (not before it). See the AI readiness doc, §3–§6. **M.**

### MF-11: Data export
There's no way to export a project (posts, captions, schedule and media as a zip). PDF and image export of the Grid exists (`grid/export`, `grid/export-pdf`), and per-post export exists. **MVI:** a "Download project archive" button (captions CSV plus originals). **Important.** **M.**

### MF-12: Email verification UX
`auth.ts:signup` returns "Check your email to confirm your account". There's no resend button, and login with an unverified email shows Supabase's raw error text. **MVI:** a resend-verification action plus a friendly message. **Important.** **S.**

### MF-13: Transactional email
Only Supabase Auth emails exist. Notifications are in-app only (`notifications` table). Invitations (MF-02), client-review results and due tasks have no email. **MVI:** choose an email provider and send invites plus review results first. **Important.** **M.**

### MF-14: Direct publishing
There's no social platform API integration; scheduling is for planning only. This is a product decision, **not** a gap in the current value proposition. **Optional.**

### MF-15: Two-factor authentication
There's no MFA UI. Supabase supports TOTP MFA. **Optional** for launch. **M.**

---

## Present and working (by code inspection; not browser-verified in this audit)

| Area | Present |
|---|---|
| Authentication | Registration, login/logout, forgot password, recovery callback, reset form, expired-link state (rendered locally: "Link expired."), change password, change email (with confirmation) |
| Projects | Create (`createProjectWithSetup`), edit, archive/unarchive, duplicate, permanent delete, ownership transfer, roles and custom permissions |
| Content | Grid with rows/slots, drag and drop, crop, undo/redo; Post Editor (caption, notes, links, date/time, carousel assets, replace, reorder); Stories; Calendar; Brief; Tasks (list/board, comments, auto-tasks); Overview/brand knowledge; Brand Assets launcher |
| Media | Direct uploads (50MB cap), thumbnails (client plus server fallback), Library with folders, copy-on-write per-post edits, Image Editor (Fabric), Copy/Paste Style, downloads, recovery of failed image loads (`77e9cdc`) |
| Collaboration | Share links, client approve/changes-requested plus notes, comments with @mentions, notifications, presence |
| Admin | Landing demo content, thumbnail backfill, dashboard |
