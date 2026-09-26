# AI Integration Readiness

Audit date: 2026-09-27 · Baseline: `main` @ `9300c00` · This is an audit only; nothing here is implemented.

Every recommendation has one of four tags:
- **[PRE-AI BLOCKER]**: resolve before any AI feature reaches real users, or before `ANTHROPIC_API_KEY` is set in production.
- **[WITH AI]**: build as part of the AI integration itself; it isn't a separate prerequisite.
- **[MONETIZATION]**: can wait until paid credits or subscriptions launch.
- **[OPTIONAL]**: a future improvement.

---

## 0. Summary

Flow:er **already contains AI code**: `src/lib/ai/client.ts` plus eight server actions that call it (brand writer, brand summary, personality spectrum, brand sections, AI insights, document analysis, Brief design generation). That code was written as a prototype.
- No per-request authorization or membership check (SEC-02).
- No usage tracking, limits, kill switch or error handling (BUG-02).

The architecture itself (Next.js Server Actions on Vercel, Supabase with RLS, the official SDK already installed) is a good base. The missing pieces are a **single AI gateway**, a **usage and credit ledger** and **financial controls**. There's no need to re-architect.

Blocking before AI work starts: only the items marked [PRE-AI BLOCKER] in §8. They are a small set of security and verification items plus locking down the existing AI actions. Missing SaaS features (account deletion, invitations, and so on) do **not** block AI development.

---

## 1. Existing infrastructure that can be reused

| Asset | Where | Reuse |
|---|---|---|
| Official Anthropic TypeScript SDK | `package.json` (`@anthropic-ai/sdk ^0.115.0`) | Keep it. Don't use raw `fetch`. |
| Server-only key access | `client.ts` reads `process.env.ANTHROPIC_API_KEY` (no `NEXT_PUBLIC_`) | Correct: the key never reaches the browser. Keep it that way, and add `import "server-only"` to the gateway module so an accidental client import fails the build. |
| Server Actions as the AI entry point | `src/lib/actions/*.ts` | The right integration point. Short, non-streaming calls fit Server Actions. Streaming chat UIs should use a Route Handler (see §2). |
| Auth and project authorization primitives | `createClient()` + `auth.getUser()`, `project_members`, `project_role()`, `canEditContent` (`src/lib/role-permissions.ts`) | The gateway's authorization step is built from these. |
| RLS-scoped context building | `src/lib/ai/brand-writer-context.ts`, `overview.ts:fetchBrandContextRows` | This is what prevents cross-project leakage: context is read with the **user's** client, so RLS applies. Keep building prompts only from RLS-scoped reads, never from a service-role client. |
| Service-role client, admin gate | `src/lib/supabase/service-role.ts`, `src/lib/admin-auth.ts` | Suitable for writing the usage ledger and for admin reports, **after** SEC-01 is verified. |
| Admin area | `/admin/dashboard`, `/admin/landing`, `/admin/thumbnails` | The natural home for AI spend views and the kill switch (§7). |
| Event logging table | `system_events` + `src/lib/system-event-log.ts` | Can record AI failures in the short term. It is **not** a financial ledger (no idempotency or balance semantics). |
| Structured JSON parsing | `parseAiJson` in `client.ts` | Replace with structured outputs (`output_config.format`) where JSON is required. The current regex approach fails on truncated output. |

## 2. Anthropic integration architecture

**Recommended shape:** one module, e.g. `src/lib/ai/gateway.ts`, marked server-only. It's the only code allowed to construct the Anthropic client. Every feature calls something like `runAiOperation({ userId, projectId, operation, buildPrompt, maxOutputTokens })`.

The gateway performs, in this order:

1. **Authenticate.** `auth.getUser()`; reject if there's no user. **[PRE-AI BLOCKER]** for the existing actions.
2. **Authorize.** The caller must be a member of `projectId`, with a role allowed to use this operation (e.g. not `viewer` or `client`). **[PRE-AI BLOCKER]**
3. **Kill switch.** A global flag, plus optional per-operation flags. **[PRE-AI BLOCKER]** (the simplest version is an environment variable; see §6).
4. **Validate input.** Enforce per-field character caps (`request`, `history` turns, `currentText`, document size and page count), a maximum image count and size, and a Zod schema per operation. **[WITH AI]**
5. **Estimate and reserve credits** (§4). **[WITH AI]**
6. **Call Anthropic** with an explicit per-operation `max_tokens`, an explicit timeout below Vercel's limit (the SDK default is 10 minutes, per the Claude API reference; TypeScript units are milliseconds), and explicit `maxRetries` (the default is 2). **[WITH AI]**
7. **Handle the result.** Check `stop_reason` (`max_tokens` means truncated, `refusal` means declined). Catch typed SDK errors (`Anthropic.RateLimitError`, `APIError` and so on). Don't string-match messages. **[WITH AI]**
8. **Record usage** from `response.usage` and **settle** the reservation (§3, §4). **[WITH AI]**
9. **Return a safe error.** A generic message to the user; details go to the server log or ledger, never prompt text or keys. **[WITH AI]**

**Model configuration:** the model is currently hardcoded as `"claude-opus-5"` in three functions. The Claude API reference (cached 2026-06-24) lists `claude-opus-5` as a valid current model at $5 / $25 per million input/output tokens.
- Put the model in one configuration point, per operation.
- The current code sends `thinking: { type: "disabled" }` with `output_config.effort: "low"`. Per the reference this combination is accepted on Opus 5 (disabled thinking is allowed at effort `high` or below). The reference also documents failure modes with disabled thinking, such as tag leakage and tool calls written as text, and recommends adaptive thinking with low effort instead. Re-evaluate this per operation. **[WITH AI]**

**Streaming:** the current operations are short, single-shot and JSON-returning, so non-streaming inside Server Actions is fine. A future chat-style or long-output feature should stream through a Route Handler and use the SDK's `finalMessage()` for usage accounting. **[OPTIONAL]** until such a feature exists.

**Vercel constraints:** Server Actions run as Vercel Functions with a maximum duration that depends on your plan and configuration (**verify**). The AI timeout plus retries must fit inside it. Long document analysis (`analyzeBrandDocument` sends a whole PDF as base64) may need a background job pattern. Also note `experimental.serverActions.bodySizeLimit: "20mb"` in `next.config.ts`: large inputs can reach the action, so the gateway must enforce its own caps.

**Must be checked against current official Anthropic documentation before implementing** (these are not claims made by this audit):
- Current model IDs and pricing, including cache-write and cache-read multipliers.
- Rate limits for your organization's tier.
- Workspace-level spend limits and alerts in the Anthropic Console.
- The Usage & Cost Admin API (the reference notes this is raw HTTP, not in the SDKs).
- Data retention and zero-data-retention eligibility.
- Commercial terms.
- An Anthropic *consumer* subscription (Claude Pro/Max) does **not** fund API usage. API usage is billed separately on the API organization's account, so verify the billing setup.

## 3. Cost tracking architecture [WITH AI]

**Principle:** record what the provider actually reports (`response.usage`), not estimates. Estimates are used only for pre-flight reservation.

Proposed table `ai_usage_events` (append-only; writable only by the service role, readable by the user for their own rows and by site admins):

| Column | Notes |
|---|---|
| `id` | uuid |
| `idempotency_key` | unique. Generated per user action, so a double-submit or retry can't double-charge. |
| `user_id`, `project_id` | Who and where. `project_id` is nullable for account-level operations. |
| `operation` | e.g. `brand_writer`, `brand_summary`, `document_analysis`, `brief_design` |
| `model` | Taken from `response.model`, not from the request. |
| `status` | `reserved` → `succeeded` / `failed` / `refunded` |
| `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` | Copied directly from `response.usage`. |
| `provider_cost_usd_micros` | Computed server-side from a **versioned price table** (`ai_model_prices`: model, per-million input/output/cache prices, effective_from). Never hardcode prices inside feature code. |
| `credits_reserved`, `credits_charged` | Flow:er's internal units, deliberately separate from provider cost. |
| `stop_reason`, `error_category`, `latency_ms`, `request_id` | For support and for "why was I charged?". Never store prompt text by default (§5). |
| `created_at`, `settled_at` | |

**Reconciliation:** periodically compare the ledger totals with Anthropic's own usage and cost reporting (Console, or the Usage & Cost Admin API; verify availability for your organization). A mismatch means some call path isn't going through the gateway.

**Existing tables that could hold this:** none. `system_events` has no balance or idempotency semantics, and `activity_log` is user-facing project history. A new table is required.

## 4. Credit and allowance system

**Keep two things separate:**
- **Provider cost:** real USD from token usage.
- **Credits:** Flow:er's product unit (e.g. one "caption generation" = N credits). Their price can change independently of provider pricing.

Proposed tables:
- `ai_credit_accounts` (one per user, or per workspace later): `balance`, `monthly_allowance`, `allowance_resets_at`. Written only through SECURITY DEFINER functions or the service role; **clients can never write it**.
- `ai_credit_transactions` (append-only ledger): `grant_initial`, `allowance_reset`, `purchase`, `reserve`, `settle`, `refund`, `admin_adjustment`, `expire`. Each row has an `idempotency_key` and a reference (usage event id or payment id). The balance is derivable from the ledger. `balance` is a cached value maintained in the same transaction.

**Preventing concurrent overspend (the key requirement)** [WITH AI]:
1. **Reserve** atomically in one Postgres function:
   ```sql
   update ai_credit_accounts
      set balance = balance - $est
    where user_id = $uid and balance >= $est
   returning balance
   ```
   Insert the `reserve` transaction in the same function. If zero rows are updated, the user has insufficient balance, so reject **before** calling Anthropic. A single conditional UPDATE is race-safe under concurrent requests, with no read-then-write gap. `SELECT … FOR UPDATE` is an alternative.
2. **Call** the provider.
3. **Settle:** charge the actual credits (from real usage) and release the difference. On provider failure or a timeout before any output, **refund** the whole reservation. Settling is idempotent on `idempotency_key`.
4. **Sweep:** a scheduled job refunds `reserved` rows older than N minutes (crashed functions).
5. Also cap **concurrent in-flight operations per user** (e.g. at most 2 `reserved` rows at a time), which is enforced in the reservation function.

| Capability | Tag |
|---|---|
| Initial free credits (grant on signup via the `handle_new_user` trigger or first use) | [WITH AI] |
| Per-user allowance and remaining-balance display | [WITH AI] |
| Insufficient-balance handling (a clear message; no provider call) | [WITH AI] |
| Refunds after failed operations | [WITH AI] |
| Administrative adjustments (admin-only function, audited) | [WITH AI] (minimal) |
| Usage history for the user | [WITH AI] (a simple list) |
| Purchased credits, subscription allowances, monthly resets tied to a billing cycle | [MONETIZATION] |

## 5. Security and data privacy

- **Authorization** [PRE-AI BLOCKER]: see §2 steps 1–2. Today any registered account can invoke AI for any `projectId` (SEC-02).
- **Cross-project leakage** [WITH AI]:
  - Build context **only** with the user-scoped Supabase client (RLS), and only for the verified `projectId`.
  - Never pass a service-role client into context builders.
  - Never cache AI outputs or context under keys that don't include the project id. Note that `signed-url-cache.ts` shares cached values across users by path. Don't copy that pattern for AI content.
  - `generateBriefDesign` reads the task by `taskId` without checking `task.project_id === projectId`. RLS limits it to the user's own projects, but assert it explicitly anyway.
- **Prompt injection** [WITH AI]:
  - Brand documents, links, captions, Brief notes and client share-link feedback (writable by **anonymous** share-link holders, SEC-07) all end up in prompts.
  - Put untrusted content in clearly delimited data blocks, keep instructions in the system prompt, and treat model output as untrusted text: render it as text, never as HTML. Don't give the model tools that act (send, delete, publish) without human confirmation.
  - The current features only return text to a human, which is low risk.
- **Sensitive content and logging** [WITH AI]: don't log prompts or outputs by default (the ledger stores metadata only). If prompts are ever retained for debugging, set a retention period and put it in the privacy policy.
- **Provider data handling** [PRE-LAUNCH, external]: verify Anthropic's current commercial terms, data retention and training-use policy for API data. Decide whether customers must be told, or must consent, that their brand content is sent to a third-party AI provider. **This needs legal review; this audit claims no compliance.**
- **Rate limiting** [WITH AI]: per user and per IP on AI endpoints, independent of credits (credits limit money; rate limits limit abuse and bursts).
- **Output handling** [WITH AI]: check `stop_reason`, and never write truncated or refused output back to `brand_strategy` and similar fields as if it were valid. Today `overview.ts:analyzeBrandDocument` writes the *error message* into `ai_analysis`, which then gets fed into later prompts.

## 6. Financial protection

| Control | Mandatory before real users? | Tag |
|---|---|---|
| Per-request auth and membership (no anonymous or non-member calls) | Yes | [PRE-AI BLOCKER] |
| **Emergency kill switch**, checked server-side on every call. v0: an `AI_ENABLED` env var (a redeploy toggles it). v1: a DB flag the admin UI can flip instantly. | Yes | [PRE-AI BLOCKER] (v0), [WITH AI] (v1) |
| **Provider-level hard limit:** a monthly spend limit and alerts on the Anthropic organization or workspace (Console). This is the backstop if app-level controls have a bug. Verify the current Console features. | Yes | [PRE-AI BLOCKER] (configuration only) |
| A dedicated API key or workspace just for production Flow:er, so its spend is isolated and the key can be rotated or revoked independently | Yes | [PRE-AI BLOCKER] (configuration) |
| Explicit `max_tokens` per operation (currently 2048 / 4096; review per feature) | Yes | [WITH AI] |
| Input caps (characters, pages, image count and size) | Yes | [WITH AI] |
| Per-user daily and monthly credit allowance, enforced server-side via the reservation function | Yes | [WITH AI] |
| Per-user concurrency cap | Yes | [WITH AI] |
| Global daily spend circuit breaker (sum of today's `provider_cost` > threshold → auto-disable plus alert) | Yes | [WITH AI] |
| Usage alerts to the owner (email or Slack when the daily total exceeds X) | Yes (simple version) | [WITH AI] |
| Per-project limits | No, unless a single project can burn a shared budget | [MONETIZATION] |
| Suspicious-activity detection (spikes, many accounts from one IP) | No | [OPTIONAL] |

**Never trust client-side counters.** The credit display is informational only. All enforcement lives in the database function called by the server.

## 7. Administrative control

Where it lives: under the existing `/admin/*` area, gated by `requireAdminServiceClient` (`src/lib/admin-auth.ts`). **Verify SEC-01 first**: this gate is only as strong as the `profiles.is_admin` write policy.

| Capability | Initial AI launch? |
|---|---|
| Kill switch (global, plus per-operation) | Yes |
| Total spend (today, month) from `ai_usage_events` | Yes |
| Spend per user and per project (top N) | Yes |
| Failed requests list (error category, count) | Yes |
| Manual credit adjustment (writes an `admin_adjustment` transaction with the admin's id and a reason) | Yes (minimal) |
| Per-user limit override or suspension | Yes (a simple flag) |
| Full usage history drill-down, exports, anomaly detection | Later |

## 8. Database changes likely required

| Change | Tag |
|---|---|
| Verify and fix the `profiles` update policy (SEC-01) and take a production schema snapshot (DI-04) | [PRE-AI BLOCKER] |
| `ai_settings` (kill switch and per-operation flags); an env var is acceptable for v0 | [WITH AI] |
| `ai_model_prices` (versioned) | [WITH AI] |
| `ai_usage_events` (§3) | [WITH AI] |
| `ai_credit_accounts`, `ai_credit_transactions` plus `reserve`/`settle`/`refund` SECURITY DEFINER functions (§4) | [WITH AI] |
| RLS: users read only their own usage and balance; there are no client write policies; admins read everything via the service role | [WITH AI] |
| `payments` / `subscriptions` / `webhook_events` (unique provider event id, for idempotency) | [MONETIZATION] |

## 9. Payment readiness [MONETIZATION]

No payment provider is present in the codebase, and none is assumed. Minimum architecture when monetization starts:
- **Checkout:** a server-created session with the provider. Credits are granted **only from a verified webhook**, never from a client redirect.
- **Webhooks:** verify the signature, store the provider event id in `webhook_events` with a unique constraint, process each event in one transaction, and make processing idempotent.
- **Credit purchase:** a `purchase` transaction linked to the payment id.
- **Refunds:** a negative `refund` transaction. Decide the policy for credits already spent.
- **Subscriptions:** a plan table and subscription status. The allowance reset is driven by the provider's billing-cycle webhook. Handle failed payments with dunning and a grace period, and handle cancellation, upgrades and downgrades (proration policy).
- **Billing history page:** read-only, from the ledger and payments.

**What's needed now vs later:** only the credit ledger design (§4) needs to anticipate `purchase` and `subscription_allowance` transaction types. Build the free allowance on the same ledger so paid credits plug in later without migrating data.

## 10. Recommended integration sequence

1. **[PRE-AI BLOCKER]** Verify production RLS (SEC-01) and snapshot the schema (DI-04).
2. **[PRE-AI BLOCKER]** Lock down the existing AI actions: add auth, membership, an `AI_ENABLED` kill switch and input caps to all eight entry points, or put them behind the kill switch until the gateway exists. Set a provider spend limit and use a dedicated production key before setting `ANTHROPIC_API_KEY` in production.
3. **[PRE-AI BLOCKER]** Fix the small, independent security items that AI would amplify: SEC-03 (open redirect), SEC-05 (email exposure), SEC-04, SEC-06.
4. **[WITH AI]** Build the gateway (`gateway.ts`): authorization, validation, timeout, typed errors, `stop_reason` handling, usage capture. Migrate the 8 existing call sites to it.
5. **[WITH AI]** Build the usage ledger and price table, then the credit accounts and transactions with reserve/settle/refund, then free allowances.
6. **[WITH AI]** Rate limits, per-user concurrency cap, global circuit breaker, admin spend page and kill switch UI, alerts.
7. **[WITH AI]** Error monitoring (e.g. Sentry or equivalent), required to see AI failures in production.
8. **[WITH AI]** End-to-end tests: unauthenticated or non-member rejected; concurrent requests can't overdraw; a failed call refunds; the kill switch blocks; truncated output isn't persisted.
9. **[MONETIZATION]** Payments, purchases, subscriptions, billing history.

## 11. Critical risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| The API key is set in production before step 2 | Any free account can spend without limit (SEC-02) | Kill switch plus auth first; provider spend limit as the backstop |
| `is_admin` is self-assignable in production (SEC-01) | The admin area gets the service role, so every project's data and every future credit adjustment is exposed | Verify before building the admin AI controls |
| Double-charging or overdraft under concurrency | Money and customer trust | Atomic conditional UPDATE reservation; idempotency keys |
| Ledger drifts from the provider bill | Unexplained expense | Only the gateway constructs the SDK client; reconcile regularly |
| Prompt injection through client or anonymous content | Manipulated outputs | Data/instruction separation; outputs never auto-executed |
| Unknown schema state (DI-04) | New AI tables and policies can't be applied or tested reliably | Snapshot plus the CLI migration baseline first |
| Vercel timeouts on large documents | Paid calls whose results are lost | Explicit timeouts, background jobs for documents, refund on timeout |

## 12. Estimated complexity

| Work | Estimate |
|---|---|
| Pre-AI blockers (steps 1–3) | 2–4 days, plus production verification by someone with DB access |
| Gateway plus migrating 8 call sites | 2–3 days |
| Usage ledger, price table, credit accounts, reserve/settle/refund functions, free allowance | 4–6 days |
| Rate limits, circuit breaker, admin spend page, alerts, monitoring | 3–5 days |
| AI end-to-end and concurrency tests | 2–3 days |
| Payments and subscriptions (later) | 1–3 weeks, depending on the provider and plan complexity |

These are engineering estimates. They don't include legal or privacy review.
