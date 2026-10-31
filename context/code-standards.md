# Code Standards

> Binding rules for how code is written in this project. When these conflict with a habit or a tutorial, these win.

> ⛔ **The money model changed on 2026-10-30 (D87 to D95): no escrow.** The job price is cash from customer
> to provider; the gateway only takes the platform's two fees. Anything below about escrow, hold, release,
> payouts, sub-merchants, provider balances or disputes is history. `project-overview.md` and the decision
> log win.

---

## 1. TypeScript

- `strict: true`. No `any` — use `unknown` and narrow. If `any` is truly unavoidable, add `// eslint-disable-next-line` **with a reason**.
- No non-null assertions (`!`) on values that cross a boundary (input, DB row, API response). Validate instead.
- Prefer `type` for shapes, `enum`-like union literals for closed sets:
  ```ts
  export type RequestStatus = 'OPEN' | 'SELECTED' | 'COMMISSION_PAID' | 'UNLOCKED'
    | 'IN_PROGRESS' | 'AWAITING_CONFIRMATION' | 'COMPLETED' | 'CANCELLED';
  ```
- Database types are **generated** from Supabase, never hand-written. Regenerate after every migration.
- Exported functions get explicit return types.

## 2. Naming

| Thing | Convention | Example |
| --- | --- | --- |
| Files/folders | kebab-case | `unlock-fee.ts` |
| Components | PascalCase | `RequestCard.tsx` |
| Functions/vars | camelCase | `computeRequestPrice` |
| DB tables/columns | snake_case, tables plural | `unlock_fees`, `held_amount` |
| Constants | SCREAMING_SNAKE | `DEFAULT_HOLD_HOURS` |
| Booleans | `is/has/can` prefix | `isReleased`, `canApply` |
| Server Actions | verb-first | `createRequest`, `chooseProvider` |

Use the vocabulary from `project-overview.md` §7 exactly. It's a **request**, not an "order" or "job posting". It's an **application**, not a "bid" or "offer".

## 3. Project structure rules

- Server Components by default. Add `'use client'` only when you need state, effects, or browser APIs — and push it to the smallest leaf component.
- `lib/pricing`, `lib/money`, `lib/psp`, and anything using `service_role` start with:
  ```ts
  import 'server-only';
  ```
- One responsibility per module. If a file mixes data access, business rules, and formatting, split it.
- No business logic in components. Components render; `lib/` decides.

## 4. Data access

- **Never** use the `service_role` client to satisfy a normal user request. Use the user's session client so RLS applies. `service_role` is for webhooks, cron jobs, and admin operations that are themselves authorised.
- Never build SQL by string concatenation. Use the query builder or parameterised RPC.
- Select **explicit columns**. `select('*')` risks leaking a column that RLS was supposed to gate.
  ```ts
  // ❌ .select('*')
  // ✅ .select('id, service_id, zone_id, region, scheduled_start_at, fixed_price')
  ```
- Every new table gets RLS enabled in the **same migration** that creates it. No exceptions.

## 5. Money — the strictest rules in the codebase

**Never use floating point for money.** Store and compute in **integer minor units** (kuruş / halalas).

```ts
// lib/money/money.ts
export type Money = { amount: number; currency: 'TRY' | 'SAR' }; // amount = minor units, integer
```

- Database columns: `bigint` minor units (or `numeric` with fixed scale) — **never `float`/`double`**.
- Never do arithmetic on money in the client. Display only.
- Rounding is explicit and documented at the one place it happens (commission calculation). Never round twice.

### Every money operation must be

1. **Idempotent** — takes an `idempotencyKey`, protected by a unique constraint. Replaying is a no-op that returns the original result.
2. **Atomic** — the whole posting commits or none of it does.
3. **Balanced** — debits equal credits, checked by the posting function, which throws otherwise.
4. **Append-only** — never `UPDATE` or `DELETE` a `ledger_entries` row. Corrections are new compensating entries.

### Concurrency (read this twice)

```ts
// ❌ WRONG — classic double-spend
const balance = await getBalance(providerId);
if (balance.available >= fee) {
  await setBalance(providerId, balance.available - fee);
}

// ✅ RIGHT — atomic conditional update inside a transaction,
//    backed by a CHECK constraint that makes the bad state impossible
//    (SELECT ... FOR UPDATE, or UPDATE ... WHERE available >= fee, then assert rowCount === 1)
```

The database is the source of truth for whether an operation is allowed. Application-level checks are a UX nicety, never a guarantee.

### State transitions on money

Use a single atomic conditional update and assert exactly one row changed:

```ts
// FULL release: only from HELD, and only once.
const { count } = await tx.from('escrows')
  .update({ status: 'RELEASED', released_amount: heldAmount })
  .eq('id', escrowId).eq('status', 'HELD');
if (count !== 1) throw new ConflictError('escrow_not_held');
```

**Partial release is a different statement — do not copy the one above for it.** A dispute can resolve
to `PARTIALLY_RELEASED`, so the amount is not `heldAmount` and the status is not `RELEASED`. Set both
explicitly, and let the `escrow_conservation` CHECK (`released + refunded <= held`) be the backstop:

```ts
// PARTIAL release: split between provider and customer, still exactly once.
const { count } = await tx.from('escrows')
  .update({
    status: 'PARTIALLY_RELEASED',
    released_amount: releaseAmount,   // both explicit; must sum to <= held_amount
    refunded_amount: refundAmount,
  })
  .eq('id', escrowId).eq('status', 'HELD');
if (count !== 1) throw new ConflictError('escrow_not_held');
```

Either way the actual PSP release/refund is an `outbox_events` row, never an inline call (§26).

## 6. Validation

- One Zod schema per boundary, in `lib/validation/`, shared by client and server.
- **The server always re-validates.** Client validation is UX only.
- Parse at the edge, then pass typed values inward. Don't validate the same thing in five places.
- Validate **external** input too: webhook payloads, PSP responses.

## 7. Server Actions and Route Handlers

Every Server Action follows this shape:

```ts
'use server';
export async function chooseProvider(input: unknown) {
  const data = ChooseProviderSchema.parse(input);        // 1. validate
  const session = await requireRole('customer');          // 2. authenticate + authorise
  //                                                      // 3. authorise the *object*:
  //                                                      //    does this customer own this request?
  //                                                      // 4. do the work (server-side rules)
  //                                                      // 5. audit if sensitive
  //                                                      // 6. revalidate affected paths
}
```

Never trust an ID from the client to imply ownership. Check it.

## 8. Webhooks

Order is non-negotiable:

1. Read the **raw** body (do not parse first — signature verification needs the raw bytes).
2. **Verify the signature.** Invalid → 401, log, stop.
3. **Dedupe** on the PSP event id via `psp_events` unique constraint. Seen → 200 OK, do nothing.
4. **Re-verify amounts and status** against our record. Never trust the payload's claim about what was paid.
5. Apply the change in **one transaction**.
6. Return 2xx quickly. Slow work goes to a queue.

A redirect back from the PSP is **UX only** — it is never proof of payment. The webhook is the source of truth.

## 9. Errors

- Typed domain errors (`ConflictError`, `ForbiddenError`, `ValidationError`), not bare strings.
- **User-facing messages never leak internals** — no stack traces, SQL, or provider payloads.
- Log with correlation context (request id, user id) — but **never log PII, tokens, or card data**.
- Fail closed: if authorisation cannot be determined, deny.

## 10. Testing

v3, 2026-10-17: three layers, the tests first list, and the e2e wrapper (D24, D27, D31).

**Three layers.**

| Layer | Tool | Location | Covers |
| --- | --- | --- | --- |
| Database | pgTAP via `supabase test db` | `supabase/tests/NN_*.test.sql` | Migrations, RLS (negative cases), functions, triggers, constraints, two session races, meta tests over every table and function |
| Unit | Vitest 5 (+ fast-check for properties) | `tests/**/*.test.ts` | Data layer, logic, server actions with a database mock, lint rules, harness hooks, scripts |
| End to end | Playwright + axe | `e2e/*.spec.ts`, run by `npm run test:e2e` | Journeys at 390px in `ar`, `tr`, `en`, each with an accessibility scan |

**Tests first** (a failing test before the code) on every risky path:

- Every access rule: who can and cannot read and write, including anonymous, another region, another
  provider, and each role.
- Every money function (post, hold, release, refund, unlock fee), plus a two session race where exactly
  one wins, and a fast-check property: random operation sequences always balance and never go negative.
- Every computed amount and its snapshot (price, commission, PSP fee leg).
- Every state machine transition, including illegal transitions refused.
- Time boundaries (payment, unlock, start, completion, release deadlines) exactly at, just before, just
  after; time comes from the database clock (`clock_timestamp()` after a lock wait), never the browser.
- Every PSP callback: bad signature refused, replay idempotent, late arrival, amount mismatch.
- Audit rows record who, when, old, new.
- Anything inside a single door (`architecture.md` §42).

**Race tests** use two real sessions (`dblink`), commit the fixtures through the second session, clean
up after, and scope every assertion to the test's own rows so leftover e2e data cannot break them.

**The e2e wrapper** (`scripts/e2e.mjs`) builds and serves the app with **local** values passed as
process variables (they beat env files, so cloud values are never used), turns analytics and error
reporting off, and runs Playwright. Later positions extend it: seeded accounts with random passwords,
time moved with one SQL statement, sent email read from a local outbox directory, per visitor IPs.

A money feature without a concurrency test is **not done**.

## 11. Migrations

- One logical change per migration; never edit a migration that has been applied.
- Every migration that creates a table also: enables RLS, adds policies, adds constraints, adds indexes.
- Reversible where possible; if not, say why in a comment.
- Regenerate DB types afterwards.

## 12. Secrets and config

- No secret in client code, in the repo, or in a `NEXT_PUBLIC_*` var.
- All env vars validated at startup against a schema; fail fast if missing.
- Separate keys per environment. Sandbox PSP keys in dev/staging — **never** live keys.
- `.env.example` lists every variable with a dummy value.

## 13. Comments

Comment **why**, not what. Mandatory comments on: money rounding, any concurrency guard, any RLS policy with non-obvious logic, and any deviation from these standards.

## 14. Git

- One position = one branch (`feat/NN-slug`) = one PR into `master`. Conventional Commits:
  `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`.
- Migration + policy + test land **in the same commit** as the feature.
- Commit or push only when the owner asks. Never force push. Long messages go in a file:
  `git commit -F <file>` (the bash guard scans message text).
- Pre commit: husky runs lint-staged (Prettier + ESLint on staged files). Never `--no-verify`.
- Never commit generated `.env`, keys, or real user data.

---

## 15. Engineering Mindset

The AI agent on this project operates as a senior engineer. This means:

- **Think before implementing** — understand what is being built and why before writing a line
- **Read context files first** — never assume, always verify against `architecture.md` and `project-overview.md`
- **Scope is sacred** — build only what the current feature requires. Never go beyond scope even if it seems helpful
- **Every feature must be testable** — if it cannot be verified immediately after implementation, it is incomplete
- **Clean over clever** — simple readable code beats clever abstractions
- **One thing at a time** — complete one feature fully before touching the next
- **Money code is different** — for anything touching the ledger, escrow, or balances, assume concurrent execution and retries by default. "It works when I click it once" is not evidence
- **Security failures are silent** — a missing RLS policy produces no error, just a leak. Write the negative test

---

## 16. Next.js 16 Conventions

- App Router only — no Pages Router
- React 19 APIs throughout
- All components are Server Components by default
- Only add `"use client"` when the component requires: `useState`/`useReducer`, `useEffect`, browser APIs, event listeners, or a client-only library
- Never add `"use client"` to layout files unless absolutely required
- Data fetching happens in Server Components — never fetch in Client Components directly
- Route handlers live in `app/api/` — never put business logic directly in a route handler
- **Server Actions live in `actions/`** — never define a Server Action inline in a component
- Caching is uncached by default — all dynamic code runs at request time
- Always read Next.js documentation before implementing a Next.js-specific feature — APIs may differ from training data

---

## 17. File and Folder Naming

- Folders: kebab-case — `provider-feed`, `unlock-fee`
- Component files: PascalCase — `ApplicantCard.tsx`, `EarningsSummary.tsx`
- **Everything else: kebab-case** — `contact-info.ts`, `money.ts`, `direction.ts`
- API route files: always `route.ts`
- Server Action files: kebab-case by domain — `requests.ts`, `unlock.ts`, `unlock-fee.ts`
- One component per file — never export multiple components from one file
- Index files only in `components/ui/` — never barrel export from other folders

> ⚠️ **Corrected 2026-08-18.** This previously said *"Utility files: camelCase — `contactInfo.ts`,
> `supabase-server.ts`"*, which contradicted §2 (*Files/folders: kebab-case*) **and** contradicted
> itself — `supabase-server.ts` is kebab-case, not camelCase. It also named a file that no longer
> exists: the Supabase clients live in `lib/db/{client,server,admin}.ts` (see `architecture.md` §6
> and §11), not flat at `lib/supabase-*.ts`. **Kebab-case wins**, everywhere except components.

---

## 18. Component Structure

Every component follows this exact order:

```typescript
"use client"; // only if needed

// 1. External imports
import { useState } from "react";
import { Button } from "@/components/ui/button";

// 2. Internal imports
import { MoneyDisplay } from "@/components/shared/MoneyDisplay";

// 3. Type definitions
type Props = {
  requestId: string;
  unlockFee: Money;
};

// 4. Component
export function UnlockFeePanel({ requestId, unlockFee }: Props) {
  // state
  // derived values
  // handlers
  // return JSX
}
```

- Never use default exports for components — always named exports
- Props type defined directly above the component
- No inline styles — all styling via Tailwind classes using tokens from `ui-tokens.md`

---

## 19. Server Action Template

```typescript
// actions/unlock.ts
"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/db/server";
import { requireRole } from "@/lib/auth/session";
import { UnlockSchema } from "@/lib/validation/unlock";

export async function payUnlockFee(input: unknown) {
  try {
    const data = UnlockSchema.parse(input);
    const user = await requireRole("provider");
    // authorise the OBJECT: is THIS provider the chosen one for THIS request,
    // and is the request actually FUNDED? Unlock is blocked before funding.
    //
    // Then ONE transaction, and no external call inside it:
    //   1. insert unlock_fees row (status 'pending', idempotency_key)
    //   2. insert balanced ledger entries  — ON CONFLICT (idempotency_key) DO NOTHING
    //   3. insert outbox_events row        — event_type 'psp.charge_fee'
    //                                        idempotency_key `unlock:${data.requestId}`
    // COMMIT. Nothing external has happened yet. The relay worker makes the PSP
    // call and the webhook flips the row to 'paid' — which is what reveals PII.
    //
    // ⛔ Never call the PSP adapter here. See §26 and architecture.md §27.
    revalidatePath(`/provider/jobs/${data.requestId}`);
    return { success: true };
  } catch (error) {
    console.error("[actions/unlock]", error);
    // A stable code, never a user facing string: the client maps it through
    // messages/{ar,tr,en}.json (rule 10). Unexpected errors also go to the error tracker.
    return { success: false, error: "action_failed" };
  }
}
```

- Every Server Action has a try/catch
- Every Server Action returns `{ success: boolean, data?: T, error?: string }`, where `error` is a
  **stable code** listed in the message catalogues, never display text (D39)
- **Never throw from a Server Action** — always return the error
- Always `revalidatePath` after mutations that affect page data
- Always validate, then authenticate, then authorise the **object** (does this user own this row?)

---

## 20. Route Handler Template

```typescript
// app/api/webhooks/psp/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();               // RAW body — do not parse first
    const event = await psp.verifyWebhook(raw, req.headers);  // 401 if invalid
    // dedupe on psp_events, re-verify amount, apply in one transaction
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[webhooks/psp]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
```

- Every route handler has a try/catch and validates before processing
- Errors logged with the route path as prefix: `[webhooks/psp]`
- Always return `{ success: boolean, data?: T, error?: string }`
- Never return raw data without the success wrapper
- Never expose internals in the response

---

## 21. Import Aliases

Always use `@/` — never relative imports that go up more than one level.

```typescript
// Correct
import { Button } from "@/components/ui/button";
import { createSupabaseServer } from "@/lib/db/server";
import { DEFAULT_HOLD_HOURS } from "@/lib/utils";

// Never
import { Button } from "../../../components/ui/button";
```

---

## 22. Environment Variables

All env vars defined in `.env.local` for development, validated at startup. Never hardcode a key, URL, or secret anywhere.

| Variable | Used in | Secret |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/db/client.ts` | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/db/client.ts` | No |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/db/admin.ts` | **Yes** |
| `SUPABASE_DB_POOL_URL` | server data access; **optional until a direct Postgres consumer exists** (D38), shape validated when present | **Yes** |
| `IYZICO_API_KEY` / `IYZICO_SECRET_KEY` | `lib/psp/iyzico/*` | **Yes** |
| `IYZICO_WEBHOOK_SECRET` | `app/api/webhooks/psp` | **Yes** |
| `IYZICO_BASE_URL` | `lib/psp/iyzico/*` | No |
| `PAYTABS_PROFILE_ID` / `PAYTABS_SERVER_KEY` | KSA, deferred (D22, Q7) | **Yes** |
| `PAYTABS_WEBHOOK_SECRET` | KSA, deferred (D22, Q7) | **Yes** |
| `PAYTABS_BASE_URL` | KSA, deferred (D22, Q7) | No |
| `OTP_CHANNEL` | `lib/auth/otp-channel.ts` | No (`phone` \| `email`) |
| `SMS_API_KEY` | `lib/auth/otp-channel.ts` | **Yes** |
| `WHATSAPP_API_KEY` | notifications | **Yes** |
| `EMAIL_API_KEY` | notifications | **Yes** |
| `APP_DEFAULT_LOCALE` | `lib/i18n` | No (`ar` \| `tr` \| `en`) |
| `APP_SUPPORTED_LOCALES` | `lib/i18n` | No (`ar,tr,en`) |

> ⚠️ **There is no `APP_REGION` and no `APP_CURRENCY` (D14).** Both regions run from one deployment,
> so region is a **column** read from the owning row and currency derives from `regions.currency`.
> A global region constant would be trusted as truth and silently mis-scope every query.

`NEXT_PUBLIC_` means the variable is exposed to the browser. **Never add `NEXT_PUBLIC_` to a secret.** There is no legitimate reason for the service role key, any PSP key, or any messaging key to be public.

---

## 23. Constants

Defined once in `lib/utils.ts`. Never hardcode these values anywhere else.

```typescript
export const DEFAULT_HOLD_HOURS = 72;             // auto-release window
export const DEFAULT_UNLOCK_WINDOW_HOURS = 24;    // chosen provider must pay within this
export const MAX_APPLICATIONS_PER_REQUEST = 10;   // applicant cap
export const MIN_PAYOUT_AMOUNT = 0;               // set from PSP minimum
```

Runtime-configurable equivalents live in `platform_settings` and **override these defaults**. The constants are fallbacks, not the source of truth in production.

---

## 24. Approved Dependencies

> v3, 2026-10-17: the **authoritative, pinned** list is the `AGENTS.md` stack table (`.npmrc` has
> `save-exact=true`). Adding anything goes through the tooling gap scan: ask first, pin exactly,
> record it there. The list below is the original intent and still applies as guidance.

Never install a package without a reason. Before installing, check: does Next.js provide it? Does shadcn/ui have it? Is there a simpler native solution?

- `@supabase/supabase-js` + `@supabase/ssr` — database, auth, storage, realtime
- `zod` — schema validation
- `lucide-react` — icons
- `tailwindcss` (v4) — styling
- `shadcn/ui` components — UI primitives
- `date-fns` — date handling (UTC storage, display-time conversion)
- PSP SDK — **only inside `lib/psp/`**, never imported elsewhere

Do not install any other package without updating this list and `library-docs.md` first. **Anything touching money, auth, or PII requires a stop-and-ask.**

---

## 25. Admin-Configurable Logic — Hard Rules

Admins configure questions and pricing formulas as **data**. This creates one specific danger, and one rule that must never be broken.

```typescript
// ⛔ NEVER — an admin account is not a code-execution boundary
eval(formula.expression);
new Function("answers", formula.expression)(answers);
```

The pricing formula is **structured rows** (`pricing_modifiers`) evaluated by our own interpreter in `lib/pricing/`. There is no expression string anywhere in the system.

Additional rules:

- Question `key` is **immutable after creation**. The edit form must not expose it. Renaming would orphan stored answers and silently break formulas
- Questions and services are **soft-deleted** (`active = false`). A hard delete would make historical requests unreadable
- Answers are validated against a **runtime-generated Zod schema** built from the active questions. Unknown keys are rejected, not ignored
- Only questions with `affects_pricing = true` may be referenced by a modifier. `text` and `textarea` may never be
- Every request stores `answers`, `questions_snapshot`, and `pricing_snapshot`. **Never re-price an existing request** when configuration changes
- The pricing pipeline has exactly **one rounding step** (`architecture.md` §19.3). Rounding inside the modifier loop causes drift
- `MULTIPLIER` factors are bounded so a typo cannot produce an absurd price
- Every catalog, question, and formula change writes to `audit_log`

---

# ⚠️ v5 — REVIEW FIXES (MANDATORY RULES)

## 26. 🔴 Never call an external service in a request path

```typescript
// ⛔ WRONG — dual write. Cannot be atomic. This was in earlier docs. Do not do it.
const result = await psp.chargeFee({...});
await db.insertLedger({...});

// ✅ RIGHT — DB first, outbox second, relay calls the PSP
await db.transaction(async (tx) => {
  await tx.insertDomainChange({...});
  await tx.insertLedgerEntries({...});          // ON CONFLICT DO NOTHING
  await tx.insertOutboxEvent({
    event_type: 'psp.charge_fee',
    idempotency_key: `unlock:${requestId}`,      // deterministic
    payload: {...},
  });
});
// the relay worker performs the PSP call
```

**The only module allowed to call `lib/psp` for mutations is the outbox relay worker.** If a Server Action imports the PSP adapter to charge, release, refund, or pay out — that is a bug.

## 27. 🔴 `proxy.ts`, never `middleware.ts`

Next.js 16 renamed the convention. A leftover `middleware.ts` is **silently ignored** — no error, no warning, route protection simply dead.

- File: `proxy.ts` at project root, exporting a function named `proxy`.
- Codemod: `npx @next/codemod@canary middleware-to-proxy .`
- `config.matcher` unchanged; the `runtime` option is unavailable (Node.js runtime by default).
- **Proxy is routing/UX only.** Never rely on it for authorisation.
- Every Server Action and Route Handler calls `requireRole()` **independently**. There are no exceptions and no "it's already protected by proxy" shortcuts.
- Keep a smoke test asserting an unauthenticated request to a protected route redirects.

## 28. 🔴 Idempotency must replay the original response

```typescript
// Same key, same payload  -> return the STORED response (no re-execution)
// Same key, different payload -> throw ConflictError (do NOT serve the old response)
// New key -> execute, store response + psp_reference, return
```

Never treat a replay as a silent no-op that returns nothing — callers cannot distinguish that from failure.

## 29. 🔴 Ledger writes

- Insert with `ON CONFLICT (idempotency_key) DO NOTHING` — always replay-safe.
- Every posting references a valid `ledger_accounts.path`. **No free-text account strings.**
- **Commission is its own posting.** Never compute `escrow = price - commission` and post a single line.
- Corrections are new compensating postings. `UPDATE`/`DELETE` are revoked at the database level — if you find yourself wanting them, you are solving the wrong problem.

## 30. 🔴 RLS policies must be written for the planner

- Index every column referenced in a policy, and every foreign key.
- Use `(select auth.uid())` in policy predicates so it evaluates once per query, not per row.
- Keep policies simple; push complexity into a `SECURITY DEFINER` helper with an indexed lookup.
- Run `EXPLAIN ANALYZE` on any policy-bearing list query before merging. A sequential scan over a growing table fails review.
- Target under 50 ms at expected volume.

## 31. 🔴 Pooler-safe code

Serverless uses the **transaction-mode pooler**. Therefore:
- **Disable prepared statements** in the Supabase/Postgres client config.
- No `SET` expecting session persistence — `SET LOCAL` inside an explicit transaction only.
- No `LISTEN`/`NOTIFY`.
- No reliance on any session-level state.
- Direct connection only for migrations and long-lived jobs.

## 32. PSP adapter resilience

Every adapter method declares: timeout, retry policy (bounded, jittered, retryable errors only), and circuit-breaker participation. **An ambiguous timeout is never success** — let the outbox retry with the same idempotency key.

## 33. Logging and tracing

- Propagate a `correlation_id` through every layer, including the outbox payload, so a money flow is traceable end to end.
- Structured JSON logs with a fixed schema. **Never log PII, tokens, card data, or full PSP payloads.**
- Emit OpenTelemetry spans around DB transactions, outbox claims, and PSP calls.

## 34. Dependency patch policy

The framework ships frequent security releases, including auth-bypass classes (13 CVEs in May 2026, 9 more in July 2026).

- **Pin exact versions.** Commit the lockfile.
- Automated dependency PRs enabled.
- **Security patches applied within 72 hours** of disclosure.
- Release checklist includes: "framework is on a patched version."

## 35. High-risk paths (extra care, not a merge gate)

> ⚠️ **Changed 2026-08-18 (D18).** This previously required a code-owner review before merge,
> enforced by `.github/CODEOWNERS`. **This is a one-engineer project** — the author and the reviewer
> are the same person, so that gate was theatre, and a control everyone believes in but which does
> nothing is the `middleware.ts` failure class. CODEOWNERS has been removed rather than left to rot.
>
> The paths still matter. What replaces the gate (v3, 2026-10-17): `/check review` on a different
> model, the `slice-reviewer` agent, and `security-reviewer` whenever money, auth, PII, or storage is
> touched; green CI on all three jobs; and **an explicit statement in the summary when a diff touches
> one of them** so the human chooses to look. Restore CODEOWNERS + branch protection the day a second
> engineer joins.

These paths carry the risk, regardless of who or what wrote the change:

- `lib/money/**`, `lib/psp/**`, the outbox relay
- `supabase/migrations/**` (especially any RLS policy or `REVOKE`)
- `lib/pricing/**`
- Anything that changes an idempotency key derivation

An agent that can weaken a policy to make a test pass is a data-breach vector. With no second
reviewer, the controls that remain are mechanical: the guard hooks refuse the write, CI refuses the
merge, and the reviewer agents refuse the "done".

## 36. Updated Definition of Done — money and policy work

- [ ] No PSP call in a request path; the flow goes DB → outbox → relay
- [ ] Idempotency replay returns the original stored response
- [ ] Ledger insert is `ON CONFLICT DO NOTHING`; commission posted as its own leg
- [ ] Account paths exist in `ledger_accounts`; `allows_negative` correct
- [ ] `REVOKE UPDATE, DELETE` verified on history tables
- [ ] pgTAP suite green, including the schema-wide "RLS enabled everywhere" test
- [ ] `EXPLAIN ANALYZE` reviewed for any policy-bearing query
- [ ] Concurrency + idempotency + invariant tests pass
- [ ] `/check review`, `slice-reviewer`, and `security-reviewer` run, and any §35 path touched is called out explicitly in the summary

---

## 37. Quality tooling (v3, 2026-10-17)

| Tool | Where | Rule |
| --- | --- | --- |
| Prettier 3.9.9 | `.prettierrc.json`, `.prettierignore` | Code and JSON and CSS only; Markdown is never formatted, so prose diffs stay clean. The `format-on-write` hook formats every file an agent writes |
| husky + lint-staged | `.husky/pre-commit`, `package.json` | Staged code files: Prettier, then ESLint with `--max-warnings=0` |
| ESLint single door rules | `eslint.config.mjs` | One door per risky system (`architecture.md` §42); each rule has a proof in `tests/lint/eslint-rules.test.ts` |
| `lint:rtl` | `scripts/check-logical-classes.mjs` | Fails on physical direction classes with the logical replacement; its own test in `tests/scripts/` |
| Meta pgTAP tests | `supabase/tests/00_*`, `02_*` | Every table has RLS; no function is executable by `PUBLIC` or `anon` unless listed; every `SECURITY DEFINER` function pins `search_path` |
| Action guard meta test | added by position 01 | Imports every Server Action module and proves each refuses an anonymous caller |
| gitleaks | CI `checks` job | Secret scan of the full history on every push and PR |
| CI | `.github/workflows/ci.yml` | Three jobs: `checks` (guards, typecheck, lint, `lint:rtl`, format check, unit, build), `database` (pgTAP on a clean local stack), `e2e` (Playwright at 390px in three locales) |

Expected failures are return values (`{ success: false, error: '<code>' }`, §19) whose code maps to a
message in all three catalogues; unexpected errors also go to the error tracker. Users never see raw
codes or internals (D39).
