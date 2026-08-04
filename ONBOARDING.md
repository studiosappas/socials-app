# Social Content Planner — Onboarding

Internal content-planning tool for a social media agency workflow (inspired by
entiresocials.com, not a clone — see Design System section). Next.js 16 (App
Router) + Supabase (Postgres, Auth, Storage) + Tailwind v4.

**This file exists because the project was moved between machines/accounts.**
It captures decisions, gotchas, and in-progress work that don't live in the
code itself. Read this before making changes.

## Tech stack & environment

- Next.js 16.2.12 (App Router, Turbopack). **This is NOT the Next.js you
  know** — breaking changes vs. older versions. Check
  `node_modules/next/dist/docs/` before assuming an API works the old way.
- Supabase: Postgres + Auth + Storage, accessed via `@supabase/ssr`.
- Tailwind CSS v4, `@tiptap/react` v3 for the Brief rich-text editor,
  `@dnd-kit` for all drag-and-drop.
- `.env.local` holds `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  The Supabase project is cloud-hosted — no database migration needed when
  moving machines, just carry this file over.
- On this dev machine, `node`/`npm` are not on PATH in a fresh shell; full
  path is `C:\Program Files\nodejs\`. Add to PATH properly on a new machine
  to avoid this.

## Database

`supabase/schema.sql` is the **single source of truth** for the schema —
every table, RLS policy, and storage bucket that exists in the live Supabase
project is captured there. If setting up a fresh Supabase project, run that
file once in the SQL Editor. The currently-linked Supabase project already
has everything in it applied (built up incrementally across this session).

Storage buckets: `project-media` (private, signed URLs, main grid/post/story
assets) and `brief-media` (public, permanent URLs, images pasted into the
Brief doc — see Design System section for why).

Dev convenience: Supabase Auth → Email → "Confirm email" is currently
**disabled** so signup works instantly without email delivery. Re-enable
before any real launch.

## What's built

- **Auth & Foundation**: login/register, `projects` + `project_members`,
  role-gated (owner/admin/designer), RLS scoped by project membership.
- **Project Overview** (`/projects/[id]`): stat tiles (posts/stories this
  week, draft/scheduled/published pipeline), recent-feed thumbnail preview.
- **Grid** (`/projects/[id]/grid`): 3-panel layout — brand/profile settings
  (left) | 3-column feed grid at 4:5 ratio (middle) | media library (right).
  Drag images from the library onto grid slots; dropping a second image on
  an occupied slot builds a carousel. Rows are addable/removable.
- **Post editor**: opens as a **modal** over the grid (via Next.js parallel +
  intercepting routes — see Architecture below), or as a full page on direct
  navigation. Carousel assets (3:4 ratio, drag-to-reorder), a **+ upload
  tile** to add new images directly as frames, caption/notes/status/type,
  links.
- **Stories** (`/projects/[id]/stories`): gallery of story cards; each opens
  the same modal pattern with 9:16 frames, drag-to-reorder, per-frame link,
  a **+ upload tile**, "add from library."
- **Calendar** (`/projects/[id]/calendar`): month view. Drag any post/story
  from the "Unscheduled" panel onto a date, or between dates, to
  (re)schedule. **Clicking an empty day** opens a menu: assign an
  unscheduled item, create a new post/story for that date (opens its editor
  immediately), or add a free-text note pinned to that day.
- **Brief** (`/projects/[id]/brief`): Notion-style rich-text doc per project
  (Tiptap: bold/italic/headings/lists). Images and links insert as small
  clickable icon-chips rather than inline full-size content — see Design
  System.
- **Members**: invite by email, assign owner/admin/designer roles.

## Explicitly deferred (user decision)

- **Instagram connection / AI performance analytics page**: skipped for now.
  Building it for real requires a Meta Developer app, business verification,
  and Meta's app-review process — real calendar time outside of coding, and
  it reverses the project's original "internal planning only, no real
  platform API" scope. Revisit as its own project later.
- The original plan's "Design Tasks" (assignable task list w/ templates) was
  replaced by the simpler "Brief" (single shared doc) per a later, more
  detailed spec from the user — see Design System section.

## Architecture notes / non-obvious decisions

- **`proxy.ts` (the middleware replacement in this Next version) must live
  at `src/proxy.ts`**, not the project root — because `app/` is under `src/`.
  Next 16 renamed `middleware.ts` → `proxy.ts`; wrong location = auth guard
  silently never runs.
- **Post/Story editors are both a modal AND a full page**, via Next's
  parallel routes (`@modal` slot in `src/app/projects/[projectId]/`) +
  intercepting routes (`(.)posts/[postId]`, `(.)stories/[storyId]`). Clicking
  from within the project (Grid/Calendar) opens the modal via soft
  navigation; a direct link or page refresh renders the full page instead.
  Next 16 requires an explicit `default.tsx` for every parallel-route slot
  (returns `null`) or the build fails — this is a real breaking change from
  older Next versions.
- **Supabase RLS + `INSERT ... RETURNING` gotcha**: if a table's SELECT
  policy relies on a row that an `AFTER INSERT` trigger creates (e.g.
  auto-adding the project creator to `project_members`), the trigger fires
  too late for the RETURNING check on the *same* insert — causes "new row
  violates row-level security policy" on the very first insert. Fix: the
  SELECT policy must also allow `created_by = auth.uid()` directly, not just
  membership-based access.
- Media in `project-media` (grid/posts/stories) uses **signed URLs
  regenerated on every page load** (1hr TTL) since the bucket is private.
  Brief images use a **separate public bucket** (`brief-media`) with
  permanent URLs instead, since a long-lived doc can't practically refresh
  signed URLs the same way.

## Design system rework — IN PROGRESS

The user sent a very detailed design "bible" (editorial/Swiss/Apple-software
aesthetic: warm white background, near-black text, thin 1px borders, no
shadows, no gradients, Poppins font, uppercase labels, minimal radius, 150–200ms
motion max) plus screenshots of entiresocials.com's actual UI, and asked for
the whole app to match it. **Full text of the bible and reference screenshots
are only in the conversation history, not saved as a file yet** — if you
don't have access to that conversation, ask the user to resend the bible
before making further visual decisions.

Done so far:
- Global tokens (`globals.css`): warm-white background, near-black
  foreground, muted/border/accent/success/warning/error tokens. **Dark mode
  was deliberately removed** — the bible describes one calm light aesthetic,
  no dark variant.
- Switched font from Geist to Inter (`layout.tsx`), then later from Inter to
  Poppins per an explicit pixel-fidelity request against Figma screenshots
  (same file, `--font-poppins` CSS variable).
- Shared primitives: `src/components/ui/button.tsx` (primary/secondary/ghost
  variants), `switch.tsx` (CSS-only toggle switch, native checkbox
  underneath for form compatibility), `dialog.tsx` (local-state modal, for
  things like Edit Profile that don't need URL routing).
- Restructured nav into two tiers matching the reference: a global shell
  (`src/app/projects/layout.tsx` — logo + Clients/Logout) and the
  project-level breadcrumb + tab row (`src/app/projects/[projectId]/layout.tsx`).
- Reworked: login/register forms, projects list, Grid page + BrandPanel
  (including turning "Edit profile preview" into a **real modal** matching
  the reference exactly — added `ig_display_name`, `ig_posts_count`,
  `ig_following_count`, `ig_website_link` columns for this), media library,
  the shared Modal wrapper.

**Still needs a pass**: Calendar, Stories, Brief, Members, and the Overview
page compile and function correctly (verified), but haven't been fully swept
for the new design tokens the same thorough way Grid/BrandPanel were — check
them against the bible before considering the redesign done. Also worth
building out: consistent use of the `Button`/`Switch` components everywhere
a raw `<button>`/checkbox currently does the job instead.

## Gotchas hit this session (avoid repeating)

- **PowerShell treats `[projectId]` (and any `[...]` folder name) as a
  wildcard glob pattern, not a literal path.** `Remove-Item`/`Get-ChildItem`
  on a path containing `[projectId]` silently matches nothing and can
  no-op without an error. Always use `-LiteralPath` for any path under
  `src/app/projects/[projectId]/...`.
- **Never batch-edit source files via PowerShell text pipelines**
  (`Get-Content -Raw` / `Set-Content -Encoding utf8` in Windows PowerShell
  5.1 mis-decodes BOM-less UTF-8 as Windows-1252 on read, then re-encodes on
  write — silently corrupts em-dashes, arrows, emoji into mojibake). Use the
  Edit tool for source file changes, even for "simple" find/replace sweeps.
- **Turbopack's dev cache can get corrupted** after heavy file restructuring
  (adding parallel/intercepting routes, deleting/moving files) — symptoms:
  "Could not parse module" errors, or deleted routes still appearing in
  `next build` output. Fix: stop the dev server, delete `.next`, restart with
  no other process concurrently writing to it (i.e. don't run `next build`
  while `next dev` is still running against the same `.next` folder).
- **Tiptap + `window.prompt()`**: the native blocking prompt dialog clears
  the editor's text selection while open. Capture `{ from, to }` before
  calling `window.prompt()` and explicitly `setTextSelection({from, to})`
  before applying a mark/command afterward, or the command silently no-ops.
- **React + `useActionState` + hidden fields**: a hidden `<input>` with a
  `value` prop and no `onChange` triggers "changing an uncontrolled input to
  controlled" warnings. Use `defaultValue` for hidden passthrough fields.
- Give every `<DndContext>` an explicit `id` prop — otherwise dnd-kit's
  internal accessibility-id counter can mismatch between server and client
  render, causing a (harmless but noisy) hydration-mismatch warning.

## Design bible (verbatim, sent by user)

This is the full design spec the redesign pass is working from. Reference
screenshots of entiresocials.com's actual UI (Overview, Grid, Studio,
Calendar, Settings, post editor modal, Assets, profile-edit modal,
onboarding guide modals) were sent alongside this text but only exist as
images in the conversation, not saved as files — ask the user to resend
them if you need to check exact layouts again.

> ### Core Philosophy
>
> This is not an admin dashboard.
>
> This is a professional creative workspace for agencies and brands.
>
> The interface should feel invisible.
>
> The user's content is always the hero.
>
> Every screen should feel calm, quiet and intentional.
>
> The interface should resemble:
>
> - Editorial publishing software
> - Swiss design systems
> - Modern gallery spaces
> - Apple software
> - High-end creative tools
> - Fashion industry software
>
> Never resemble:
>
> - Bootstrap
> - Material UI
> - SaaS templates
> - Corporate dashboards
> - Crypto products
> - Gaming interfaces
>
> ### Emotional Direction
>
> Every screen should communicate: Calm, Confidence, Focus, Precision,
> Luxury, Editorial, Professionalism, Intentional whitespace.
>
> The interface should never feel: Playful, Colorful, Busy, Decorative,
> Noisy, Overdesigned.
>
> ### Design DNA
>
> The product language is built around:
>
> - Photography first
> - Typography second
> - Interface third
>
> The UI exists only to support the content. Images always receive the
> visual attention.
>
> ### Layout Principles
>
> Every page follows the same overall structure:
>
> Global Header → Workspace Navigation → Page Header → Main Content →
> Optional Side Panel → Footer Actions
>
> Layouts should remain extremely consistent. Never redesign layouts
> between pages.
>
> ### Grid System
>
> Use a strict grid. Desktop width: 1440–1600px. Content should align to
> invisible columns. Large horizontal breathing room. Large vertical
> spacing. Every element should visually align with another. Never place
> elements randomly.
>
> ### White Space
>
> Whitespace is part of the design. Do not fill empty areas. The interface
> should breathe. Large empty spaces are intentional. Never compress
> content.
>
> ### Typography
>
> Typography drives hierarchy. Use Poppins. Weights: 300, 400, 500, 600, 700.
> (Switched from Inter to Poppins per explicit request during the Grid page
> pixel-fidelity pass -- see changelog below.)
> Avoid heavy bold text. Use uppercase only for: Labels, Categories,
> Navigation, Section titles. Main titles remain sentence case. Spacing
> between letters should feel editorial.
>
> ### Color System
>
> - Background: Warm White
> - Cards: Pure White
> - Primary Text: Near Black
> - Secondary Text: Medium Gray
> - Borders: Very Light Gray
> - Accent: Black only
> - Success: Muted Green
> - Warning: Muted Amber
> - Error: Muted Red
>
> Never use saturated colors.
>
> ### Borders
>
> Borders define structure. Not shadows. Use 1px borders, very light gray.
> No thick borders.
>
> ### Shadows
>
> Shadows should almost never exist. If absolutely required: very subtle
> elevation only. Never floating cards. Never dramatic depth.
>
> ### Radius
>
> Minimal corner radius. Cards: 8–12px. Buttons: 6–8px. Modals: 8–12px.
> Never pill-shaped UI.
>
> ### Buttons
>
> Buttons are simple.
>
> - Primary: Black background, White text
> - Secondary: White background, Thin border
> - Ghost: Text only
> - Outline: White with border
>
> No gradients. No shadows. No animations.
>
> ### Forms
>
> Forms should feel quiet. Underline inputs are preferred. Labels above
> fields. Generous spacing. Never place many controls together. One clear
> action.
>
> ### Navigation
>
> Navigation should always feel minimal. Uppercase labels. Thin typography.
> Clear active state. No colorful indicators. No oversized icons.
>
> ### Icons
>
> Icons support information. Never decoration. Use thin line icons. Simple
> stroke. No filled icons unless necessary.
>
> ### Cards
>
> Cards should disappear visually. No heavy styling. No colorful
> backgrounds. Content defines the card, not the container.
>
> ### Modals
>
> Every modal follows exactly the same structure: Header → Divider →
> Content → Divider → Footer. Consistent spacing. Consistent button
> placement. Never redesign modal layouts.
>
> ### Tables
>
> Tables should resemble editorial layouts. Minimal borders. Lots of
> whitespace. Readable typography. No zebra stripes.
>
> ### Calendar
>
> Calendar is planning software. Not Google Calendar. Large whitespace.
> Large cells. Minimal chrome. Content remains the focus.
>
> ### Media
>
> Photography is the hero. Images should be large. Cropping should feel
> intentional. Media previews should dominate the interface.
>
> ### Motion
>
> Motion should almost disappear. 150–200ms maximum. No bounce. No elastic
> effects. No dramatic page transitions. No floating animations.
>
> ### Interaction
>
> - Hover: Slight border darkening, small opacity changes
> - Focus: Simple outline
> - Pressed: Very subtle opacity reduction
>
> Nothing scales dramatically.
>
> ### Empty States
>
> Empty states should feel elegant. Never cartoon illustrations. Prefer
> typography. Simple line illustration if necessary. Large whitespace.
> Helpful guidance.
>
> ### Responsive Philosophy
>
> Desktop first. Tablet second. Mobile last. Do not redesign layouts. Only
> adapt them. The experience should remain identical.
>
> ### Component Philosophy
>
> Every component must be reusable. Never duplicate UI. If a pattern
> appears twice, convert it into a shared component.
>
> ### Design Consistency
>
> Every new screen must answer: "Does it look like it already existed?" If
> the answer is no, redesign it.
>
> ### Photography Rules
>
> Photography defines emotion. UI never competes with photography. Use
> large previews. Neutral framing. Natural colors. Minimal overlays.
>
> ### Content Rules
>
> Short labels. Short paragraphs. Simple language. No unnecessary
> descriptions. Whitespace replaces explanation.
>
> ### Accessibility
>
> Readable typography. High contrast. Clear focus. Large click areas.
> Keyboard friendly.
>
> ### Things Claude Must NEVER Do
>
> Never add gradients. Never add glassmorphism. Never add neumorphism.
> Never add colorful cards. Never invent new layouts. Never invent new
> button styles. Never invent new spacing. Never invent shadows. Never
> create dashboard widgets. Never add decorative illustrations. Never use
> random icons. Never introduce a second visual language. Never redesign
> existing components. Never change typography hierarchy. Never introduce
> visual noise.
>
> ### Component Creation Rules
>
> Before creating a new component ask: Does a similar component already
> exist? Can an existing component be extended? Can this become a Variant
> instead? Create a new component only as a last resort.
>
> ### Golden Rule
>
> If a user notices the interface before noticing their content, the
> interface has failed.

## Testing approach used throughout

No test suite — verification was done by driving the actual running app
with Playwright (`chromium.launch()`) via ad-hoc Node scripts in the
scratchpad directory, checking for console errors and taking screenshots.
`npm run build` + `npx tsc --noEmit` + `npm run lint` were run after every
meaningful change and must stay clean.
