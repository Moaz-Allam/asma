# Architecture

> Read `project-overview.md` first. This file covers **how** we build what that file describes.

---

## 1. Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | **Next.js (App Router) + TypeScript** | Server Components by default |
| Styling | **Tailwind CSS** | See `ui-tokens.md` — no arbitrary values |
| Components | **shadcn/ui** | See `ui-rules.md`. Theme/templates supplied later |
| Backend | **Supabase** | Postgres, Auth, Storage, Edge Functions, Realtime |
| Database | **PostgreSQL** with **Row-Level Security on every table** | RLS is the security backbone |
| Validation | **Zod** | One schema per boundary, shared client/server |
| Hosting | **Vercel** (web) + **Supabase Cloud** (backend) | |
| Payments | **PSP adapter** — iyzico (TR) / PayTabs (KSA) | See §5. Never call a PSP SDK directly from feature code |

**Do not add a dependency** without recording it in `library-docs.md` with a justification.

---

## 2. The one principle

> **The browser is hostile.**

The Supabase anon key ships to every client. Anyone can open dev tools and query Postgres directly. Therefore:

- **Security is enforced in the database (RLS), not in the UI.** Hiding a field in React is not security.
- **All money and PII logic runs server-side** — Server Actions, Route Handlers, Edge Functions, or `SECURITY DEFINER` Postgres functions.
- **The `service_role` key never reaches the browser.** It exists only in server-side environments.

---

## 3. Trust boundaries

```
┌─ UNTRUSTED ──────────────────────────────────────────┐
│  Browser: customer / provider / admin UI             │
│  Holds: anon key + session JWT. Trusted for nothing.  │
└───────────────────────┬───────────────────────────────┘
                        │
┌─ TRUSTED (ours) ──────▼───────────────────────────────┐
│  Next.js server: Server Actions, Route Handlers       │
│  Supabase Edge Functions: PSP webhooks, scheduled jobs│
│  Holds: service_role key, PSP secrets                 │
└───────────────────────┬───────────────────────────────┘
                        │
┌─ ENFORCEMENT ─────────▼───────────────────────────────┐
│  Postgres: RLS on every table                         │
│  SECURITY DEFINER functions for money operations      │
│  Constraints: non-negative balances, unique idem keys │
└───────────────────────┬───────────────────────────────┘
                        │
┌─ EXTERNAL (untrusted) ▼───────────────────────────────┐
│  PSP (holds all funds) · SMS/WhatsApp · Email         │
│  Inbound webhooks: signature-verified + idempotent     │
└───────────────────────────────────────────────────────┘
```

Every arrow crossing a boundary is validated. Treat external services as untrusted input, always.

---

## 4. Data model

Names are canonical. Use these exact table names.

### Core

| Table | Purpose | Key columns |
| --- | --- | --- |
| `profiles` | One row per user | `id`, `role` (customer/provider/admin), `phone`, `full_name` |
| `providers` | Provider-specific data | `profile_id`, `status`, `rating_avg`, `jobs_completed`, `psp_submerchant_id` |
| `provider_documents` | Verification docs | `provider_id`, `type`, `storage_path`, `approved` |
| `provider_zones` | Where a provider works | `provider_id`, `zone_id` |
| `zones` | Districts / service areas | `id`, `name`, `city` |
| `service_categories` | Catalog grouping | `id`, `name` |
| `services` | Bookable services | `id`, `category_id`, `active` |
| `addons` | Optional extras | `id`, `service_id`, `price` |
| `questions` | Admin-defined questions per category/service | `id`, `category_id`, `service_id`, `key` (immutable), `label` (localised jsonb), `type`, `affects_pricing` |
| `pricing_formulas` | One active formula per service | `id`, `service_id`, `base_price`, `version`, `active` |
| `pricing_modifiers` | The formula body — **structured rows, never an expression string** | `id`, `formula_id`, `question_key`, `match_type`, `match_value`, `effect_type`, `amount`, `factor`, `apply_order` |
| `regions` | The two markets | `code` PK (`TR`\|`KSA`), `currency`, `default_locale`, `psp_provider`, `active` |
| `platform_settings` | Fees, commission %, windows | **`(region, key)` composite PK**, `value` — admin-editable. **G24: keyed on `key` alone, changing TR's commission would silently change KSA's** |

### Transaction

| Table | Purpose | Key columns |
| --- | --- | --- |
| `requests` | The central entity. **Full column list in §13 + §20** | `id`, `customer_id`, `chosen_provider_id`, `status`, `fixed_price`, `commission_amount`, `zone_id`, `address_id`, `answers`, `questions_snapshot`, `pricing_snapshot`, `scheduled_start_at`, `scheduled_end_at`, `payment_deadline`, `unlock_deadline`, `start_deadline`, `completion_deadline`, `release_deadline`, `reselection_count` |
| `request_addons` | Selected extras | `request_id`, `addon_id` |
| `applications` | Free provider bids | `id`, `request_id`, `provider_id`, `message`, `status`, `applied_at` |
| `unlock_fees` | Fee charged to chosen provider | `id`, `request_id`, `provider_id`, `amount`, `status`, `charged_at` |
| `escrows` | Held funds mirror | `id`, `request_id`, `held_amount`, `released_amount`, `refunded_amount`, `status`, `psp_reference` |
| `disputes` | Customer disputes | `id`, `request_id`, `reason`, `resolution`, `resolved_by`, `resolved_at` |
| `ratings` | Optional, post-release | `id`, `request_id`, `stars`, `notes` |
| `addresses` | Customer addresses | `id`, `profile_id`, `zone_id`, `line_full`, `geo` |

### Money

| Table | Purpose | Key columns |
| --- | --- | --- |
| `ledger_entries` | **Append-only double-entry. THE SOURCE OF TRUTH for all money.** | `id`, `account`, `debit`, `credit`, `currency`, `idempotency_key`, `ref_type`, `ref_id`, `created_at` |
| `provider_balances` | **Projection** of the ledger, for fast reads. Never authoritative | `provider_id`, `pending`, `available`, `paid_out` |
| `payouts` | Withdrawal requests | `id`, `provider_id`, `amount`, `status`, `psp_reference` |
| `psp_events` | Webhook dedupe | **`psp_provider`** + `psp_event_id` (**unique together**), `region`, `type`, `payload`, `processed_at` |

| `outbox_events` | **The only path to any external effect.** See §27 | `id`, `event_type`, `payload`, `idempotency_key` (unique), `status`, `attempts`, `next_attempt_at` |
| `ledger_accounts` | Chart of accounts. Every posting FKs to a `path` here | `path` PK, `type`, `allows_negative`, `active` |
| `idempotency_records` | Stores and **replays** the original response | `key` PK, `request_hash`, `response`, `psp_reference`, `status` |
| `invoices` | Our fee invoices to providers — **never to customers** (agent model, D12). See §41 | `id`, `provider_id`, `ref_type`, `ref_id`, `type` (`standard`\|`simplified`), `region`, `locale`, `xml_hash`, `previous_hash`, `clearance_status`, `issued_at` |

### Support

`notifications`, `audit_log` (append-only), `notification_templates`.

### Ledger vs balances — read this before writing any money code

`ledger_entries` is **truth**. `provider_balances` is a **cache**.

- A balance row is only ever updated **inside the same transaction** that posts the ledger entries. Never separately, never by a background sync that could diverge.
- Any disagreement between them is a **bug in the balance projection**, never a reason to correct the ledger.
- A reconciliation job recomputes balances from the ledger and **alerts on drift** — it does not silently "fix" it.
- Never derive a user-visible balance by summing in application code at read time; read the projection, which the invariant job verifies.

### Currency

**One currency per region.** Every `Money` value carries its currency, and mixing currencies in one
calculation must throw. Do not build multi-currency conversion — it is out of scope.

### Regions — single deployment, `region` discriminator (D14)

**Both regions run from one deployment and one database**, distinguished by a `region` column:
Turkey (`TR`, TRY, iyzico) and Saudi Arabia (`KSA`, SAR, PayTabs). Chosen for operational simplicity —
one codebase, one migration run, one place to look.

**An account belongs to exactly one region.** A person operating in both markets creates a second,
separate account. This is the decision that keeps the money model simple, and it is load-bearing:

- **One account → one region → one currency.** A provider can never hold two balances, so
  `provider_balances` stays keyed on `provider_id` and account paths stay
  `provider:available:{provider_id}` with no currency segment.
- **Every posting group is single-currency by construction**, because every request belongs to one
  region. Cross-currency arithmetic is not merely forbidden, it is unreachable.
- **Region is derived, never chosen per operation.** It is read from the owning row (the request, the
  provider), never passed in by a caller.

What a single deployment does **not** give you for free, and must therefore be built:

| Was free with two databases | Now must be explicit |
| --- | --- |
| Region isolation | An RLS policy per region-scoped table, with a negative test |
| Currency isolation | Every global aggregate grouped by `(region, currency)` — see §18 |
| Separate webhook namespaces | `psp_events` unique on `(psp_provider, psp_event_id)` — see below |
| Separate settings | `platform_settings` keyed `(region, key)` |
| Separate blast radius | Per-region kill switches (§38); one bad migration now reaches both markets |

Each deployment serves **all three locales** — locale and region are independent axes, and currency
derives from region, never from locale. An Arabic speaker in Turkey is a core segment; conflating the
two breaks exactly that user. See [`i18n.md`](i18n.md) §2.

### Connection pooling (required)

Serverless functions open many short-lived connections and will exhaust Postgres. **Use Supabase's pooled connection string** (transaction mode) for all serverless/Edge access. Direct connections are for migrations only. This is not an optimisation — without it the app fails under the launch spike.

### Critical constraints

```sql
-- balances can never go negative
ALTER TABLE provider_balances ADD CONSTRAINT non_negative_available CHECK (available >= 0);

-- every money operation is idempotent
CREATE UNIQUE INDEX ON ledger_entries (idempotency_key);
-- G22: dedupe must be scoped to the PSP that minted the id. iyzico and PayTabs
-- issue event ids in INDEPENDENT id spaces, so a bare unique index on
-- psp_event_id can collide across providers. A collision raises no error — the
-- handler treats a genuine webhook as a replay, returns 200, and does nothing.
-- The payment is then never recorded and the customer's money sits at the PSP
-- with no row pointing at it. Scope the constraint, always.
CREATE UNIQUE INDEX ON psp_events (psp_provider, psp_event_id);

-- exactly one chosen application per request.
-- The literal MUST match applications.status casing exactly — see §13. A casing
-- mismatch makes this index match zero rows, with no error, and the invariant
-- it exists to enforce silently disappears.
CREATE UNIQUE INDEX one_chosen_per_request ON applications (request_id)
  WHERE status IN ('SELECTED','AWAITING_UNLOCK','UNLOCKED','STARTED','COMPLETED','RELEASED','RATED');

-- a provider applies once per request
CREATE UNIQUE INDEX ON applications (request_id, provider_id);

-- escrow can never over-disburse
ALTER TABLE escrows ADD CONSTRAINT escrow_conservation
  CHECK (released_amount + refunded_amount <= held_amount);

-- G5: a request funds EXACTLY once. Without this, a double-submit or a webhook
-- race creates two escrow rows for one request; each satisfies escrow_conservation
-- individually, so that constraint does not catch it, and the money is real.
CREATE UNIQUE INDEX one_escrow_per_request ON escrows (request_id);
```

---

## 5. PSP adapter (important)

The target market is **not yet decided** (Turkey vs Saudi Arabia). **Never call a PSP SDK from feature code.** All payment work goes through one interface.

```ts
// lib/psp/types.ts
export interface PaymentProvider {
  onboardSubMerchant(input: SubMerchantInput): Promise<{ subMerchantId: string }>;
  createSplitPayment(input: SplitPaymentInput): Promise<{ paymentId: string; transactionId: string }>;
  chargeFee(input: FeeChargeInput): Promise<{ paymentId: string }>;   // unlock fee
  releaseHeld(input: { transactionId: string }): Promise<void>;        // approve transfer to provider
  refundHeld(input: { transactionId: string; amount?: Money }): Promise<void>;
  createPayout(input: PayoutInput): Promise<{ payoutId: string }>;
  verifyWebhook(rawBody: string, headers: Headers): Promise<PspEvent>; // throws if invalid
}
```

- Implementations live in `lib/psp/iyzico/` and `lib/psp/paytabs/`.
- **Both are live at once** (D14 — one deployment, two regions). The implementation is selected from
  `regions.psp_provider` for **the row being processed**, never from an env var. Feature code calls
  `getPaymentProvider(region)` and knows nothing about which one it got.
- Credentials are per PSP: `IYZICO_*` and `PAYTABS_*`. There is no `PSP_PROVIDER` global.
- Build against the interface. If a provider lacks a capability, **STOP and ask** — do not silently degrade.

**What both providers give us:** funds held by the PSP, split payment with commission, hold-and-release triggered by our API call, sub-merchant onboarding and payouts.

**Provider-specific facts to verify before integration** (record answers in `progress-tracker.md`):
- Maximum hold duration — must exceed our 72h release window.
- Whether individual (non-company) providers can be sub-merchants.
- Settlement/blockage delay after release — affects what we promise providers.
- Saudi only: ZATCA e-invoicing responsibilities.

---

## 6. Layout

```
app/
  (customer)/            # customer routes
  (provider)/            # provider routes
  (admin)/               # admin routes
  api/
    webhooks/psp/        # PSP webhook receiver (Route Handler)
lib/
  psp/                   # adapter + iyzico/ + paytabs/
  pricing/               # price formula — server only
  money/                 # ledger, idempotency, Money type
  auth/                  # session, role helpers
  db/                    # typed Supabase clients
  validation/            # zod schemas
components/
  ui/                    # shadcn primitives — see ui-rules.md
  features/              # composed feature components
supabase/
  migrations/            # schema + RLS, version controlled
  functions/             # Edge Functions (webhooks, cron)
tests/
```

**Rule:** anything under `lib/pricing`, `lib/money`, or `lib/psp` is **server-only**. Mark with `import 'server-only'`. Never import into a Client Component.

---

## 7. Request lifecycle in code

| Step | Where it runs | Guard |
| --- | --- | --- |
| Post request | Server Action | Price computed server-side from the answers + active formula |
| List open requests to providers | RLS-filtered query | Policy exposes short-details columns only |
| Apply | Server Action | Contact-info scan; applicant cap; unique constraint |
| Choose provider | Server Action | Application → `SELECTED`; request → `SELECTED`; sets **`payment_deadline`** |
| Customer pays | Server Action → outbox → relay | Commission its own ledger leg; escrow row created **by the webhook**; sets **`unlock_deadline`** |
| Pay unlock fee | Server Action → outbox → relay | Only from `FUNDED`. Idempotent; `unlock_fees` + ledger + outbox in one transaction |
| Reveal details | RLS policy | Visible only when a **`paid`** `unlock_fees` row exists — `FUNDED` alone is not enough |
| Webhook confirms | Edge Function | Signature verified + `psp_events` dedupe |
| Mark complete | Server Action | Sets `release_deadline` |
| Confirm / auto-release | Server Action / scheduled job | Single atomic transition |
| Dispute | Server Action | Only before deadline; suspends release |
| Payout | Server Action → PSP | Moves `available` → `paid_out` |

---

## 8. Concurrency — the two races you must handle

**1. Double-spend on balance.** Two requests read balance 100, both see 50 available, both subtract 50 → ends at 50 instead of 0.
→ Use `SELECT ... FOR UPDATE` or a conditional atomic update inside a transaction, plus the CHECK constraint. Never read-then-write in application code.

**2. Dispute racing auto-release.** Both try to move the same held amount to different parties.
→ One atomic conditional state transition (`UPDATE ... WHERE status = 'HELD'` and check rows affected). The `escrow_conservation` constraint is the backstop.

A scheduled job asserts `held = released + refunded + remaining` across all escrows and alerts on drift.

---

## 9. Realtime, jobs, notifications

- **Realtime** — request status for the two involved parties only. Verify RLS applies to Realtime; never broadcast a table with PII columns.
- **Scheduled jobs** (Supabase cron / Edge Functions): auto-release expired holds, reopen expired unlock windows, reconcile ledger vs PSP, assert invariants.
- **Notifications** — queued and retried, never sent inline in a request path. A failing provider must not fail a user action.

---

## 10. Security checklist for every feature

- [ ] RLS policy written **and tested** for new tables/columns
- [ ] Server-side Zod validation on every input
- [ ] No PII in short-details queries
- [ ] Money ops idempotent + atomic
- [ ] Secrets server-side only, per-environment
- [ ] Sensitive actions written to `audit_log`
- [ ] Arabic/RTL verified

---

## 11. Folder Structure

```
/
│  ✅ = built (feature 01) · everything else is the target layout, not yet created.
│
├── .gitignore                              ✅ NOTES.md, .env*, .next, node_modules
├── .nvmrc                                  ✅ node 22
├── package.json                            ✅ exact-pinned deps; `npm run verify` = the whole chain
├── tsconfig.json                           ✅ strict + noUncheckedIndexedAccess; `@/*` alias
├── next.config.ts                          ✅ next-intl plugin; no `eslint` key (removed in Next 16)
├── postcss.config.mjs                      ✅ Tailwind v4 via PostCSS; no tailwind.config by design
├── eslint.config.mjs                       ✅ flat config; ESLint pinned to 9.x — see progress-tracker
├── vitest.config.ts                        ✅ `@/` alias + server-only stub
├── instrumentation.ts                      ✅ calls getEnv() once at server boot = real fail-fast
├── CLAUDE.md                               → Agent rules + task-to-doc routing. Always loaded
├── AGENTS.md                               → Cross-tool pointer to CLAUDE.md; skill + MCP inventory
├── SETUP.md                                → Human-only setup steps, sequenced by what they unblock
├── .env.example                            → Every variable, secret-classified. No global APP_REGION
├── .mcp.json                               → context7 · supabase · playwright
├── .claude/
│   ├── settings.json                       → Hooks + permission rules
│   ├── hooks/guard.mjs                     → PreToolUse: 18 silent-failure rules
│   ├── hooks/session-context.mjs           → SessionStart: phase, blockers, standing facts
│   ├── evals/guard.test.mjs                → Regression suite for the guards themselves
│   ├── skills/                             → architect · review · recover · remember · imprint
│   └── tools/docx-to-md.py                 → Convert context/docs/*.docx on demand
├── .github/
│   ├── dependabot.yml                      ✅ weekly npm PRs; eslint held at 9.x deliberately
│   └── workflows/ci.yml                    ✅ guardrails · typecheck · lint · test · catalogues · pgTAP
├── specs/<NN>-<slug>/plan.md               → /architect output. The contract /review checks against
├── context/
│   ├── project-overview.md                 → What and why. Business rules, stop-and-ask
│   ├── architecture.md                     → This file. Schema, trust boundaries, outbox, pricing
│   ├── i18n.md                             → Locales, direction, regions, translatable content
│   ├── ui-tokens.md
│   ├── ui-rules.md
│   ├── ui-registry.md
│   ├── code-standards.md
│   ├── library-docs.md
│   ├── build-plan.md
│   ├── progress-tracker.md                 → Living state. Read at session start
│   ├── architecture-review.md              → The v5 corrections in full (P0-1…P0-6)
│   ├── contradictions.md                   → 13 doc conflicts, all fixed. Kept as a record
│   ├── open-questions.md                   → Gaps, ambiguities, unstated assumptions
│   └── docs/                               → Human-authored .docx/.xlsx originals (agent cannot read)
├── app/
│   ├── globals.css                         ✅ Tailwind v4 @theme tokens — the ONLY token definition
│   ├── [locale]/                           → EVERY user-facing route lives under here. ar | tr | en
│   │   ├── layout.tsx                      → renders <html lang={locale} dir={dirFor(locale)}>,
│   │   │                                     generateStaticParams, hasLocale→notFound,
│   │   │                                     setRequestLocale, NextIntlClientProvider, fonts  ✅
│   │   ├── page.tsx                        ✅ Landing page (placeholder content until B4)
│   │   ├── not-found.tsx                   ✅ reached by hasLocale→notFound(); localised
│   │   ├── error.tsx                       ✅ route error boundary; logs digest, never renders it
│   │   ├── (auth)/
│   │   │   └── login/page.tsx              → OTP request + verify
│   │   ├── (customer)/
│   │   │   ├── requests/page.tsx           → My requests
│   │   │   ├── requests/new/page.tsx       → Post a request
│   │   │   └── requests/[id]/page.tsx      → Request detail, applicants, payment
│   │   ├── (provider)/
│   │   │   └── provider/
│   │   │       ├── page.tsx                → Provider dashboard
│   │   │       ├── feed/page.tsx           → Open requests — SHORT DETAILS ONLY
│   │   │       ├── feed/[id]/page.tsx      → Request detail + apply
│   │   │       ├── applications/page.tsx   → My applications
│   │   │       ├── jobs/[id]/page.tsx      → Won job — full details post-unlock
│   │   │       ├── earnings/page.tsx       → Earnings + payouts
│   │   │       └── profile/page.tsx        → Profile, zones, availability, documents
│   │   └── (admin)/
│   │       └── admin/
│   │           ├── page.tsx                → Admin dashboard
│   │           ├── catalog/page.tsx        → Categories, services, addons, zones
│   │           ├── pricing/page.tsx        → Questions + formula builders
│   │           ├── settings/page.tsx       → Fees, commission, windows — per region
│   │           ├── providers/page.tsx      → Approval queue
│   │           ├── requests/page.tsx       → Request management
│   │           ├── disputes/page.tsx       → Dispute queue
│   │           └── reports/page.tsx        → Reports
│   └── api/                                → OUTSIDE [locale] — machine endpoints are not localised
│       └── webhooks/psp/route.ts           → PSP webhook — raw body, signature verify, dedupe
│
│   ⚠️ Route groups live INSIDE [locale], not beside it. A route group `(customer)` as a sibling of
│      [locale] produces `/requests` with no locale segment, which next-intl cannot resolve.
│   ⚠️ There is NO root app/layout.tsx. `[locale]/layout.tsx` renders <html>; next-intl documents
│      removing pass-through root layouts because they conflict with the localized one. Add a root
│      layout only if a root app/page.tsx is ever introduced.
├── actions/
│   ├── requests.ts                         → Post, cancel, choose provider
│   ├── applications.ts                     → Apply, withdraw
│   ├── unlock.ts                           → Charge unlock fee, reveal
│   ├── payments.ts                         → Fund request, confirm completion
│   ├── disputes.ts                         → Open, resolve
│   ├── payouts.ts                          → Request withdrawal
│   ├── provider.ts                         → Profile, zones, availability, documents
│   └── admin.ts                            → Catalog, pricing, settings, approvals
├── lib/
│   ├── db/                                 → typed Supabase clients (⚠️ NOT flat `lib/supabase-*.ts`
│   │   │                                     — an earlier draft of this tree said that; §6 and
│   │   │                                     build-plan.md both say `lib/db/`, which is what exists)
│   │   ├── client.ts                       ✅ Browser client — anon key only, Zod-validated env
│   │   ├── server.ts                       ✅ Server client — session-scoped, RLS APPLIES. The default
│   │   └── admin.ts                        ✅ service_role — BYPASSES RLS. Webhooks/cron ONLY
│   ├── env.ts                              ✅ Zod env schema; REJECTS APP_REGION/APP_CURRENCY (D14)
│   ├── pricing/                            → Price engine — server-only
│   ├── money/
│   │   └── money.ts                        ✅ Money type, integer minor units. Arithmetic = feature 14
│   ├── psp/
│   │   ├── index.ts                        → getPaymentProvider() factory
│   │   ├── types.ts                        → PaymentProvider interface
│   │   ├── iyzico/                         → Turkey implementation
│   │   └── paytabs/                        → Saudi implementation
│   ├── auth/
│   │   ├── session.ts                      → requireRole, requireUser
│   │   └── otp-channel.ts                  → Swappable phone/email OTP adapter
│   ├── validation/index.ts                 ✅ shared Zod primitives; one schema per boundary elsewhere
│   ├── scanner/contact-info.ts             → Application message scanner (Arabic-Indic + Turkish digits)
│   ├── i18n/                               → see i18n.md
│   │   ├── direction.ts                    ✅ LOCALES + dirFor() — the ONLY place direction is decided
│   │   ├── routing.ts                      ✅ defineRouting, localePrefix 'as-needed'
│   │   ├── request.ts                      ✅ per-request locale + messages
│   │   └── navigation.ts                   ✅ createNavigation — use these, not next/link
│   ├── invoicing/                          → region adapter: zatca/ (KSA) + efatura/ (TR) — see §41
│   ├── region/index.ts                     ✅ getRegion(row); throws if asked to read env (D14)
│   └── utils.ts                            → Shared constants + helpers
├── proxy.ts                                ✅ Locale negotiation + route redirects. NOT middleware.ts,
│                                             and NOT a security boundary — requireRole() does that
├── messages/                               ✅ every key must exist in all three; CI enforces
│   ├── ar.json
│   ├── tr.json
│   └── en.json
├── components/
│   ├── ui/                                 → shadcn/ui only
│   ├── layout/                             → Navbar, Footer, RoleNav
│   │   └── LocaleSwitcher.tsx              ✅ Intl.DisplayNames — never hardcoded language names
│   ├── shared/                             → MoneyDisplay, StatusBadge, EmptyState...
│   └── features/
│       ├── requests/
│       ├── applications/
│       ├── money/
│       ├── provider/
│       └── admin/
├── supabase/
│   ├── config.toml                         ✅ from `supabase init`
│   ├── migrations/
│   │   └── *_template.sql.example          ✅ mandatory order: RLS → policies → constraints → indexes
│   ├── tests/
│   │   └── 00_rls_enabled_everywhere.test.sql  ✅ pgTAP; standing negative test, predates the first table
│   └── functions/
│       ├── auto-release/                   → Cron: release expired holds
│       ├── unlock-expiry/                  → Cron: reopen expired selections
│       ├── reconcile/                      → Cron: ledger vs PSP
│       └── invariants/                     → Cron: assert held = released + refunded + remaining
└── tests/                                  ✅ 27 passing
    ├── i18n.test.ts                        ✅ dirFor per locale + catalogue completeness
    ├── region.test.ts                      ✅ region from row not env; phone/region match (D16)
    ├── money.test.ts                       ✅ integer minor units; refuses mixed currency
    ├── env.test.ts                         ✅ fail-fast; pooler url; rejects APP_REGION (D14)
    ├── turkish-casing.test.ts              ✅ I/ı/İ/i round-trip through identifier comparison
    ├── stubs/server-only.ts                ✅ test-only; the real guarantee is Next's, at build time
    ├── rls/                                → Policy tests — every table
    ├── money/                              → Concurrency, idempotency, invariants
    └── integration/                        → Full flow
```

---

## 12. Data Flow

### UI Mutations (Server Actions)

```
Client Component
  → Server Action in actions/
    → validate with Zod
    → requireRole() + object ownership check
    → business logic in lib/
    → Supabase session client (RLS applies)
    → revalidatePath()
    → return { success, data?, error? }
```

Used for: posting requests, applying, choosing a provider, marking complete, confirming, opening disputes, admin edits.

### Money Operations (Server Action → DB → outbox → relay → PSP)

> ⚠️ **Corrected in v5 (§27).** An earlier version of this section had the Server Action call the PSP
> and then post the ledger "in one transaction". That is impossible — an external HTTP call cannot be
> made atomic with a database commit. The dual write loses money whenever the process dies between
> the two halves.

```
Server Action
  → validate + authorise (role AND object ownership)
  → derive DETERMINISTIC idempotency key from domain ids
  → BEGIN
      domain state change      (e.g. unlock_fees row, status transition)
      balanced ledger entries  (ON CONFLICT (idempotency_key) DO NOTHING)
      outbox_events row        (event_type = psp.charge_fee | psp.release | …)
      audit_log entry
    COMMIT                     ← nothing external has happened yet
  → return { success, data?, error? }

Relay worker (the ONLY mutating caller of lib/psp)
  → claims a pending outbox row atomically (status → in_flight)
  → calls the PSP with that row's idempotency_key
  → success: status → succeeded, psp_reference stored
  → failure: attempts++, exponential backoff, eventually 'dead' + alert
```

Used for: unlock fee, funding a request, release, refund, payout requests, and
**notifications** — the in-app row is written in the transaction, the email/WhatsApp send is an
outbox event so a provider outage never fails a user action.

### PSP Webhooks (Route Handler)

```
POST /api/webhooks/psp
  → read RAW body
  → verifyWebhook() — signature. Invalid → 401, log, stop
  → insert into psp_events (unique psp_event_id). Duplicate → 200, no-op
  → re-verify amount + status against our record
  → apply state change + ledger postings in ONE transaction
  → return 2xx fast; queue slow work
```

**The webhook is the only source of truth for payment success.** A browser redirect is never proof.

### Scheduled Jobs (Edge Functions)

```
auto-release    → escrows past release_deadline still HELD → release (atomic)
unlock-expiry   → requests SELECTED past unlock_deadline → back to OPEN
reconcile       → compare ledger to PSP settlement, alert on drift
invariants      → assert held = released + refunded + remaining, alert on drift
```

All jobs are idempotent and safe to re-run.

---

## 13. Database Schema

Every table has RLS enabled in the migration that creates it. Money is stored in **integer minor units**.

### `profiles`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | matches auth user id |
| `role` | text | `customer` \| `provider` \| `admin` — set server-side only |
| `phone` | text | **PII** |
| `full_name` | text | **PII** |
| `locale` | text | `ar` \| `tr` \| `en` — chosen at signup, editable. Wins over the cookie; notifications are sent in it. See [`i18n.md`](i18n.md) §4 |
| `region` | text | `TR` \| `KSA` — **immutable after creation.** Changing it would strand the account's requests, ledger history, and PSP sub-merchant registration |
| `created_at` | timestamptz | |

> **D16 — the phone's dialling code must match the region.** `+90` for `TR`, `+966` for `KSA`,
> enforced at signup and by a `CHECK`. This is what makes "one account per region" workable under
> phone-based OTP, where one number maps to one identity: the same person in both markets genuinely
> holds a different number in each, so the phone carries the region naturally.
> **No override at launch** — a user whose dialling code does not match their region is rejected with
> a clear message. Revisit once the blocked-user volume is known.
>
> **D15 — admins are global.** An `admin` reads and acts across **both** regions; there is no
> `admin_region` column and no region predicate in admin policies. This matches launch reality (one
> operator). ⚠️ **Known future cost:** hiring region-scoped ops staff later means rewriting every
> admin policy against live data. Admin actions must therefore record the affected `region` in
> `audit_log` from day one, so the scoping data exists before the policy needs it.

> **Identifier columns must not carry a Turkish collation.** `lower()` is collation-dependent, and
> under `tr_TR` it maps `I` → `ı`, silently breaking case-insensitive email uniqueness and any
> identifier lookup. Pin these columns (and any case-insensitive index on them) to a deterministic
> collation, e.g. `COLLATE "C"`. Locale-aware collation is for **sorting display lists only**. See
> [`i18n.md`](i18n.md) §6.

### `providers`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `profile_id` | uuid FK | |
| `status` | text | `pending` \| `approved` \| `rejected` \| `suspended` |
| `rating_avg` | numeric | maintained on rating insert |
| `jobs_completed` | int | maintained on release |
| `psp_submerchant_id` | text | set at PSP onboarding; required before payout |

### `requests`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `customer_id` | uuid FK | |
| `chosen_provider_id` | uuid FK null | set on selection |
| `service_id` | uuid FK | |
| `zone_id` | uuid FK | provider-visible |
| `address_id` | uuid FK | **PII — gated** |
| `status` | text | canonical state machine |
| `fixed_price` | bigint | minor units, **server-computed** |
| `commission_amount` | bigint | minor units, server-computed |
| `unlock_fee_amount` | bigint | snapshot at selection |
| ~~`scheduled_at`~~ | — | **Replaced in v3** by `scheduled_start_at` / `scheduled_end_at` — see §20 |
| `payment_deadline` | timestamptz | set on **selection** — customer must pay before this |
| `unlock_deadline` | timestamptz | set when the request becomes **`FUNDED`**, not on selection |
| `start_deadline` | timestamptz | **G1** — set at `UNLOCKED`, from `scheduled_start_at` + grace |
| `completion_deadline` | timestamptz | **G1** — set at `IN_PROGRESS`, from `scheduled_end_at` + grace |
| `release_deadline` | timestamptz | set from `actual_completed_at` on completion |
| `reselection_count` | int default 0 | **G2** — incremented on each `FUNDED → OPEN`; capped |

> **G1 — every state that holds money must have an exit.** Without `start_deadline` and
> `completion_deadline`, a provider who unlocks (taking the customer's phone and address) and then
> stops leaves the request in `UNLOCKED` forever: no automated job fires, because every job keys off a
> deadline that was never set, and the customer cannot even dispute — `disputes` was reachable only
> from `AWAITING_CONFIRMATION`. Expiry of either deadline flags the request, notifies both parties,
> and opens an admin-actionable state. It does **not** auto-refund: the work may genuinely be underway
> offline. **The unlock fee is never refunded on this path** — the provider already received the PII.
>
> **The customer may open a dispute from `UNLOCKED` and `IN_PROGRESS`, not only from
> `AWAITING_CONFIRMATION`.**
| `created_at` | timestamptz | |

### `applications`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `request_id` | uuid FK | |
| `provider_id` | uuid FK | |
| `message` | text | scanned for contact info before insert |
| `status` | text | **UPPERCASE, 12 values — see §20.** `APPLIED` \| `SELECTED` \| `AWAITING_UNLOCK` \| `UNLOCKED` \| `STARTED` \| `COMPLETED` \| `RELEASED` \| `RATED` \| `NOT_SELECTED` \| `WITHDRAWN` \| `EXPIRED` \| `CANCELLED` |
| `applied_at` | timestamptz | |

Unique: `(request_id, provider_id)`. Partial unique: one `SELECTED` per request.

> ⚠️ **Casing is load-bearing, and this is a silent-failure trap.** An earlier version of this row
> listed four *lowercase* values (`applied | chosen | not_chosen | withdrawn`). The partial unique
> index in §4 matches on an uppercase literal, so storing lowercase makes the index match **zero
> rows** — Postgres raises no error and the "exactly one chosen application per request" invariant
> is silently unenforced. Add a `CHECK` constraint listing the twelve values so a mismatch fails
> loudly at write time instead of quietly at index time:
>
> ```sql
> ALTER TABLE applications ADD CONSTRAINT applications_status_valid CHECK (status IN (
>   'APPLIED','SELECTED','AWAITING_UNLOCK','UNLOCKED','STARTED','COMPLETED',
>   'RELEASED','RATED','NOT_SELECTED','WITHDRAWN','EXPIRED','CANCELLED'));
> ```

### `unlock_fees`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `request_id` | uuid FK | |
| `provider_id` | uuid FK | |
| `amount` | bigint | minor units |
| `status` | text | `pending` \| `paid` \| `failed` \| `refunded` |
| `psp_reference` | text | |
| `idempotency_key` | text UNIQUE | |
| `charged_at` | timestamptz | |

**A `paid` row here is what unlocks PII.**

### `escrows`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `request_id` | uuid FK | |
| `held_amount` | bigint | |
| `released_amount` | bigint | default 0 |
| `refunded_amount` | bigint | default 0 |
| `status` | text | `held` \| `released` \| `refunded` \| `partially_released` |
| `release_deadline` | timestamptz | |
| `psp_transaction_id` | text | used for the PSP release call |

Constraint: `released_amount + refunded_amount <= held_amount`.

### `ledger_entries`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `account` | text | e.g. `platform_revenue`, `escrow_held`, `provider_available` |
| `debit` | bigint | minor units |
| `credit` | bigint | minor units |
| `currency` | text | single currency per deployment |
| `idempotency_key` | text UNIQUE | |
| `ref_type` / `ref_id` | text / uuid | what caused this entry |
| `created_at` | timestamptz | |

**Append-only. No UPDATE. No DELETE. Ever.**

### `provider_balances`
| Column | Type | Notes |
| --- | --- | --- |
| `provider_id` | uuid PK | |
| `pending` | bigint | held, not yet released |
| `available` | bigint | released, withdrawable — CHECK >= 0 |
| `paid_out` | bigint | withdrawn |

Projection only. Updated in the same transaction as the ledger.

### Other tables
`addresses`, `zones`, `service_categories`, `services`, `addons`, `questions`, `pricing_formulas`, `pricing_modifiers`, `platform_settings`, `provider_documents`, `provider_zones`, `provider_availability`, `disputes`, `ratings`, `payouts`, `psp_events`, `notifications`, `audit_log`, `outbox_events`, `ledger_accounts`, `idempotency_records`, `invoices`.

> ⚠️ **`pricing_rules` no longer exists.** It was the v1 flat price table and was replaced in v2 by
> `questions` + `pricing_formulas` + `pricing_modifiers` (§19.2). Any reference to it is stale.

---

## 14. Storage

| Bucket | Access | Contents |
| --- | --- | --- |
| `provider-documents` | **PRIVATE** | ID and skill documents. Signed URLs only, short TTL |

- No public buckets for any user upload.
- MIME type and size validated server-side; never trust the client's declared type.
- Only the owning provider and admins may generate a signed URL.

---

## 15. Authentication

- OTP via `lib/auth/otp-channel.ts` — phone by default, email interchangeable.
- Role lives in `app_metadata`, set server-side only. A client can never change its own role.
- `requireUser()` and `requireRole(role)` in `lib/auth/session.ts` are used at the top of every Server Action and protected page.
- Rate limits on OTP request and verify: per phone, per IP, per device, plus a bot challenge.
- **`proxy.ts`** (not `middleware.ts` — see §34) redirects unauthenticated traffic away from
  `/requests`, `/provider`, `/admin`. This is **routing/UX only, never a security boundary**;
  `requireRole()` runs independently inside every Server Action and Route Handler.

---

## 16. Supabase Client Pattern

```typescript
// Browser — Client Components only. Anon key. RLS always applies.
import { createSupabaseBrowser } from "@/lib/db/client";

// Server — Server Components, Server Actions, Route Handlers. Session-scoped. RLS applies.
import { createSupabaseServer } from "@/lib/db/server";
const supabase = await createSupabaseServer();

// Admin — service_role. BYPASSES RLS. Webhooks and cron ONLY.
import { createSupabaseAdmin } from "@/lib/db/admin";
```

- Never use the browser client in server context, or the server client in browser context.
- **Never use the admin client to serve a normal user request.** If you reach for it in a Server Action, stop and reconsider — you are about to bypass the security model.
- Always scope queries to the current user; never rely on RLS alone as a substitute for an explicit filter.

---

## 17. PSP Pattern

```typescript
import { getPaymentProvider } from "@/lib/psp";

const psp = getPaymentProvider(request.region); // region comes from the ROW, never from env
const result = await psp.chargeFee({
  subMerchantId: provider.psp_submerchant_id,
  amount: request.unlock_fee_amount,
  idempotencyKey: `unlock:${request.id}`,       // deterministic — safe to retry
});
```

- Never import `iyzico` or `paytabs` directly outside `lib/psp/`.
- Idempotency keys are **deterministic and derived from domain ids**, never random — a retry must produce the same key.
- Every PSP response is validated with Zod before use.

---

## 18. Invariants

Statements that must hold at all times. A violation is a Sev-1 bug.

- `held_amount = released_amount + refunded_amount + remaining` for every escrow
- `provider_balances.available >= 0` for every provider
- Sum of ledger debits = sum of ledger credits, globally and per transaction
- Exactly one `chosen` application per request
- A provider can read customer PII **only** when a `paid` `unlock_fees` row exists for that `(request, provider)`
- `fixed_price` and `commission_amount` are never written from client input
- No ledger row is ever updated or deleted
- The platform's own account never holds user funds

---

## 19. Dynamic Questions and the Pricing Formula

> Added in v2 of this document. Categories and services are not enough — **each category defines its own set of questions**, the customer's answers drive the price, and admins configure both without a code change.

### 19.1 Concept

```
Category  →  has Questions  →  Customer answers them
                                      ↓
Service   →  has a Pricing Formula  →  reads those answers  →  FIXED PRICE
```

Everything is **data**, editable by an admin. Adding a new category with its own questions and pricing must require **zero code changes**.

### 19.2 Tables

#### `questions`
Questions belong to a category (inherited by all its services) or to a specific service (overrides).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `category_id` | uuid FK null | set when the question applies to a whole category |
| `service_id` | uuid FK null | set when it applies to one service only |
| `key` | text | stable machine key, e.g. `rooms`, `has_pets`. **Never renamed** — the formula and stored answers reference it |
| `label` | text | Arabic label shown to the customer |
| `help_text` | text null | optional hint |
| `type` | text | see question types below |
| `required` | boolean | |
| `options` | jsonb null | for select types: `[{ value, label }]` |
| `validation` | jsonb null | `{ min, max, step, maxLength }` |
| `affects_pricing` | boolean | if true, the formula may reference it |
| `display_order` | int | |
| `active` | boolean | soft delete — never hard-delete a question in use |

Constraint: exactly one of `category_id` / `service_id` is non-null. Unique `key` per category/service scope.

#### Question types

| Type | Stored answer | Can drive pricing |
| --- | --- | --- |
| `number` | integer | ✅ per-unit and tier modifiers |
| `single_select` | option value | ✅ fixed and multiplier modifiers |
| `multi_select` | array of values | ✅ fixed per selected option |
| `boolean` | true/false | ✅ fixed and multiplier |
| `text` | string | ❌ never affects price |
| `textarea` | string | ❌ never affects price |
| `date` / `time` | ISO string | ✅ multiplier (e.g. weekend surcharge) |

#### `pricing_formulas`
One active formula per service.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `service_id` | uuid FK | |
| `base_price` | bigint | minor units |
| `version` | int | incremented on any change |
| `active` | boolean | exactly one active per service |

#### `pricing_modifiers`
The formula body. **Structured rows, never an expression string.**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `formula_id` | uuid FK | |
| `question_key` | text null | which answer this reads; null = unconditional |
| `match_type` | text | `equals` \| `in` \| `range` \| `is_true` \| `always` |
| `match_value` | jsonb | e.g. `"large"`, `["a","b"]`, `{ "min": 3, "max": 5 }` |
| `effect_type` | text | `FIXED` \| `PER_UNIT` \| `MULTIPLIER` |
| `amount` | bigint null | minor units, for `FIXED` and `PER_UNIT` |
| `factor` | numeric null | for `MULTIPLIER`, e.g. `1.25` |
| `apply_order` | int | deterministic evaluation order |
| `active` | boolean | |

#### `requests` — new columns

| Column | Type | Notes |
| --- | --- | --- |
| `answers` | jsonb | `{ "rooms": 3, "has_pets": true }` — keyed by question `key` |
| `questions_snapshot` | jsonb | the questions as they were at submission |
| `pricing_snapshot` | jsonb | formula version + full breakdown |

### 19.3 The pricing pipeline

Order of operations is fixed. **Never reorder — the result would change.**

```
1.  subtotal = formula.base_price
2.  for each active modifier, in apply_order:
      match the customer's answer against match_type / match_value
      if matched:
        FIXED       → subtotal += amount
        PER_UNIT    → subtotal += amount × numeric answer
        MULTIPLIER  → subtotal = subtotal × factor
3.  subtotal += Σ selected addon prices
4.  subtotal = subtotal × zone multiplier
5.  price = round(subtotal)                    ← THE ONLY ROUNDING STEP
6.  commission = round(price × commission_pct)  ← rounded once, from the final price
7.  provider_amount = price − commission
```

- All arithmetic in **integer minor units**. `MULTIPLIER` and zone factor are the only non-integer inputs; round only at step 5.
- **Never round twice.** Rounding inside the loop produces drift.
- The engine returns a **full breakdown** (every modifier that fired, with its effect), which is stored in `pricing_snapshot` and shown to the customer.

### 19.4 Security rules for the formula engine

- ⛔ **Never `eval()`, `Function()`, or otherwise execute an admin-authored string.** The formula is structured rows only. An admin account is not a trusted code-execution boundary
- ⛔ Never accept a price, subtotal, or breakdown from the client — answers come from the client, **the price never does**
- Every answer is validated server-side against its question's `type` and `validation` before pricing
- An answer whose `key` does not exist in the active question set is **rejected**, not ignored
- A `required` question with no answer is rejected
- Modifiers referencing a `text`/`textarea` question are rejected at save time
- `MULTIPLIER` factors are bounded (suggested `0.1`–`10`) so a mis-typed value cannot produce an absurd price

### 19.5 Versioning and snapshots (important)

Admins will change questions and prices while requests are live.

- A request stores `answers`, `questions_snapshot`, and `pricing_snapshot` **at submission**
- An existing request is **never re-priced** when an admin edits a formula or question
- Questions are soft-deleted (`active = false`), never hard-deleted, so historical answers stay interpretable
- `pricing_formulas.version` increments on every change; the version is recorded in the snapshot
- Changing a question's `key` is **forbidden** — it would orphan stored answers and break modifiers

### 19.6 Dynamic validation

Zod schemas for the answer set are **built at runtime from the active questions**:

```
loadActiveQuestions(serviceId)
  → build a Zod object schema from each question's type + validation
  → parse the submitted answers
  → reject unknown keys, missing required, out-of-range values
```

The same generated schema shape drives the client form and the server check — but **the server always rebuilds and re-parses**. Client validation is UX only.

---

# ⚠️ v3 CORRECTIONS — SUPERSEDES §13 SCHEMA WHERE THEY CONFLICT

See `project-overview.md` §21–25. Corrected order: **customer pays, then provider unlocks.**

## 20. Corrected and added tables

### `requests` — corrected columns

| Column | Type | Notes |
| --- | --- | --- |
| `status` | text | `OPEN`→`SELECTED`→`FUNDED`→`UNLOCKED`→`IN_PROGRESS`→`AWAITING_CONFIRMATION`→`RELEASED` |
| `scheduled_start_at` | timestamptz | Agreed start — required, must be future at posting |
| `scheduled_end_at` | timestamptz | Expected completion — must be after start |
| `actual_started_at` | timestamptz null | Set when provider starts |
| `actual_completed_at` | timestamptz null | Set on completion; **release deadline derives from this** |
| `payment_deadline` | timestamptz null | Customer must pay after selection |
| `unlock_deadline` | timestamptz null | Set when request becomes `FUNDED` |
| `release_deadline` | timestamptz null | Set from `actual_completed_at` |
| `answers` | jsonb | Answers to the category's questions |
| `questions_snapshot` | jsonb | Questions as they were at submission |
| `pricing_snapshot` | jsonb | Formula version + full breakdown |

`scheduled_at` is **replaced** by `scheduled_start_at` / `scheduled_end_at`.

### `applications` — corrected status

`status`: `APPLIED` \| `SELECTED` \| `AWAITING_UNLOCK` \| `UNLOCKED` \| `STARTED` \| `COMPLETED` \| `RELEASED` \| `RATED` \| `NOT_SELECTED` \| `WITHDRAWN` \| `EXPIRED` \| `CANCELLED`

Application status is derived from the request lifecycle and updated **in the same transaction** as the request status change — never by a separate job.

### `notifications` — full definition

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `recipient_id` | uuid FK | |
| `type` | text | matches the matrix in `project-overview.md` §24 |
| `title` / `body` | text | rendered from a template, Arabic |
| `link_url` | text null | deep link to the request |
| `read_at` | timestamptz null | null = unread |
| `channels_sent` | jsonb | `{ in_app: true, email: true, whatsapp: false }` |
| `created_at` | timestamptz | |

- RLS: a user reads only their own notifications.
- In-app row is written **synchronously**; email/WhatsApp are **queued** so a provider outage never fails a user action.
- Unread count is a scoped aggregate query, not a full table scan.

### `provider_profiles` — new

`provider_id` PK, `display_name`, `photo_url`, `bio`, `years_experience` int, `skills` jsonb, `languages` jsonb, `member_since`.

### `provider_work_addresses` — new

`id`, `provider_id`, `label`, `zone_id`, `line_full` (**admin-only**), `geo`, `is_primary`.
RLS: full address readable by the owning provider and admins only. Customers see the zone/district.

### `provider_documents` — corrected

Add `status` (`pending`/`approved`/`rejected`), `rejection_reason`, `reviewed_by`, `reviewed_at`, `expires_at`.

## 21. Corrected lifecycle guards

| Transition | Guard |
| --- | --- |
| `OPEN → SELECTED` | Customer owns the request; applicant exists; sets `payment_deadline` |
| `SELECTED → FUNDED` | **PSP webhook confirms payment**; commission split; escrow created; sets `unlock_deadline` |
| `SELECTED → OPEN` | Payment deadline passed; applications restored to `APPLIED` |
| `FUNDED → UNLOCKED` | Unlock fee charged to the **chosen provider only**, idempotent; reveals PII |
| **`FUNDED → OPEN`** | **Unlock deadline passed. Funds REMAIN HELD. Customer re-selects without paying again. Application → `EXPIRED`** |
| `UNLOCKED → IN_PROGRESS` | Provider starts; sets `actual_started_at` |
| `IN_PROGRESS → AWAITING_CONFIRMATION` | Provider completes; sets `actual_completed_at` and `release_deadline` |
| `AWAITING_CONFIRMATION → RELEASED` | Customer confirms **or** auto-release job; atomic, exactly once |
| `FUNDED/UNLOCKED → CANCELLED` | **Full refund of held funds + compensating ledger entry reversing commission** |

> **Critical:** money is held from `FUNDED` onward. Every path out of `FUNDED` must terminate in exactly one of: released, refunded, or partially released. A request must never sit funded with no owner of the money.

## 22. Corrected PII reveal rule

PII is revealed when the request reaches `UNLOCKED` — that is, when a **paid** `unlock_fees` row exists. Being `FUNDED` is **not** sufficient. RLS must check the unlock row, never the request status alone.

---

# v4 — TRUST & QUALITY SCHEMA

See `project-overview.md` §26–35. **Correction: at `UNLOCKED` the contact reveal is mutual** — provider gets customer contact + full address, customer gets provider contact.

## 23. New and changed tables

### `provider_profiles` — added columns
| Column | Type | Notes |
| --- | --- | --- |
| `legacy_jobs_completed` | int default 0 | **Admin-imported.** Displayed separately, never merged |
| `legacy_note` | text | Provenance, required on import |
| `is_founding_provider` | boolean | Admin-granted, audited |
| `bio_source` | text | `provider` \| `admin` — provenance flag |

### `providers` — added / changed
| Column | Type | Notes |
| --- | --- | --- |
| `vetting_status` | text | `applied`→`documents_submitted`→`documents_verified`→`background_checked`→`assessed`→`probation`→`active`; plus `rejected`, `suspended` |
| `vetting_reason` | text | Required on reject/suspend |
| `probation_jobs_remaining` | int | |
| `rating_avg` | numeric | **DERIVED. No admin write path** |
| `jobs_completed` | int | **DERIVED from released requests. No admin write path** |
| `entity_type` | text | **G17** — `individual` \| `private_company` \| `incorporated`. Captured at verification |
| `tax_number` | text null | **G17** — required when `entity_type <> 'individual'` |
| `legal_name` | text null | **G17** — required when `entity_type <> 'individual'` |
| `vat_number` | text null | **G18** — present only if the provider is VAT-registered; decides standard vs simplified invoice |

> **G17 — one profile shape for everyone, four fields the PSP needs anyway.** Decision D9 says an
> individual and a company are the same kind of provider account: same profile UI, same customer-facing
> view, no branching in feature code. That holds. But **the PSP does not accept one shape** — iyzico
> defines three sub-merchant types with different required fields (a company must supply a tax number
> and legal title). Onboarding a company as `PERSONAL` either fails at registration or, worse,
> succeeds and fails at the first payout, after the work is already done.
>
> So these four columns exist for **PSP onboarding and invoicing only**. They are admin- and
> adapter-facing; **none of them ever appears on the customer-facing profile.** The PSP adapter maps
> `entity_type` to each provider's own enum — which is exactly what the adapter interface is for.
>
> ```sql
> ALTER TABLE providers ADD CONSTRAINT company_fields_present CHECK (
>   entity_type = 'individual' OR (tax_number IS NOT NULL AND legal_name IS NOT NULL));
> ```
>
> Zod branches on `entity_type`; the profile UI does not.

### `ratings` — changed
| Column | Type | Notes |
| --- | --- | --- |
| `source` | text | `platform` \| `migrated` |
| `punctuality`, `quality`, `professionalism`, `value` | int 1–5 | Dimension scores |
| `hidden_at`, `hidden_by`, `hidden_reason` | | Hide only — **never edit or delete** |

Ratings are **append-only**. There is no UPDATE path on the score columns.

### `rating_invitations` — new
`id`, `provider_id`, `customer_phone`, `job_description`, `token` (single-use), `expires_at`, `used_at`, `created_by`.
The **past customer** submits the rating; the admin only issues the link.

### `provider_metrics` — new (derived projection)
`provider_id`, `completion_rate`, `on_time_rate`, `cancellation_rate`, `dispute_rate`, `repeat_customer_rate`, `avg_response_seconds`, `unlock_follow_through`, `computed_at`.
Recomputed by a scheduled job from source tables. **Never written by hand.**

### `application_answers` — new
Structured answers on applications, using the same question engine as requests (`architecture.md` §19). Free-text answers pass the contact-info scanner.

## 24. Rating computation

```
displayed_rating = (C × M + Σ(w_i × r_i)) / (C + Σ w_i)

  M   = platform mean rating
  C   = shrinkage constant (suggested 5)
  r_i = individual rating
  w_i = recency weight (recent ratings weigh more)
```

- Below 5 ratings → display `NEW`, not a number.
- Recompute on rating insert and on the nightly job; store in `providers.rating_avg`.
- **`rating_avg` has no admin write path.** It is only ever written by the computation function.

## 25. Access control additions

| Data | Rule |
| --- | --- |
| `rating_avg`, `jobs_completed`, `provider_metrics` | Read-only to everyone. Written only by derivation functions |
| `legacy_jobs_completed`, `is_founding_provider` | Admin write, audit-logged, always displayed as legacy |
| `ratings` | Insert by the rating customer only; no update/delete. Admin may set hide fields only |
| `rating_invitations` | Admin creates; token grants a one-time public rating form |
| Hidden ratings | Excluded from computation; visible to admins with the reason |

## 26. Invariants (v4)

- `rating_avg` is always reproducible from non-hidden `ratings` — an admin cannot make it disagree
- `jobs_completed` always equals the count of released requests for that provider
- `legacy_jobs_completed` is **never** added to `jobs_completed` in any query, view, or UI
- No rating row is ever updated or deleted
- A provider not in `vetting_status = 'active'` (or `probation`) cannot apply to any request

---

# ⚠️ v5 — ARCHITECTURE REVIEW FIXES (MANDATORY)

> From [`architecture-review.md`](architecture-review.md) (P0-1…P0-6). **These override earlier sections where they conflict.** Items marked 🔴 must be implemented before any money moves.

## 27. 🔴 Transactional outbox — the money write path was WRONG

**Earlier docs said:** "call the PSP via the adapter, then post the ledger in one transaction."
**That is impossible.** You cannot atomically perform an external HTTP call and a database commit. The correct pattern is **database-first, then outbox → PSP**.

### Tables

**`outbox_events`**
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `aggregate_type` / `aggregate_id` | text / uuid | e.g. `request`, request id |
| `event_type` | text | `psp.charge_fee`, `psp.release`, `psp.refund`, `psp.payout`, `notify.email` |
| `payload` | jsonb | everything the relay needs |
| `idempotency_key` | text UNIQUE | deterministic, derived from domain ids |
| `status` | text | `pending` \| `in_flight` \| `succeeded` \| `failed` \| `dead` |
| `attempts` | int | |
| `next_attempt_at` | timestamptz | exponential backoff |
| `last_error` | text | |
| `psp_reference` | text | filled on success |
| `created_at` / `completed_at` | timestamptz | |

Index: `(status, next_attempt_at)`.

### The mandatory flow

```
1. BEGIN
2.   validate + authorise
3.   write domain state change  (e.g. unlock_fees row, status transition)
4.   write ledger entries        (balanced, idempotency key)
5.   write outbox_events row     (event_type = psp.charge_fee)
6. COMMIT                        ← nothing external has happened yet
7. Relay worker picks up pending outbox rows
8.   claims the row (status -> in_flight, atomic)
9.   calls the PSP with the row's idempotency_key
10.  on success  -> status = succeeded, psp_reference stored
11.  on failure  -> attempts++, backoff, eventually status = dead (alert)
```

> ⛔ **No feature code may call the PSP inline in a request path.** The only caller of `lib/psp` is the relay worker (and read-only status queries).

### Rules

- Ledger inserts are replay-safe at SQL level: `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`.
- Outbox events are idempotent by construction — the same key produces the same PSP call.
- A `dead` outbox row raises an alert and appears in an admin queue for manual retry. It is never silently dropped.
- **Notifications use the same outbox.** The in-app row is written in the transaction; the email/WhatsApp send is an outbox event.
- The relay is a scheduled Edge Function plus an on-demand trigger; it must be safe to run concurrently (row claiming is atomic).

## 28. 🔴 Database-enforced ledger integrity

Append-only and balanced were **conventions** in earlier docs. They must be **controls**.

```sql
-- Append-only: no application role may mutate history
REVOKE UPDATE, DELETE ON ledger_entries FROM authenticated, anon, service_role;
REVOKE UPDATE, DELETE ON ratings         FROM authenticated, anon, service_role;
-- Writes go only through SECURITY DEFINER posting functions.

-- Sum-to-zero enforced by the database, per transaction group,
-- as a DEFERRED constraint trigger checked at COMMIT.
-- Application-level checks stay as a second layer, not the only one.
```

Also: `provider_balances.available >= 0` CHECK (already specified) **plus** a job asserting `available == SUM(ledger for that account)`.

## 29. 🔴 Chart of accounts (replaces free-text `account`)

`ledger_entries.account text` invited typos and ad-hoc names. Replace with a reference table:

**`ledger_accounts`**: `path` PK (stable, machine-readable, e.g. `platform:revenue:unlock_fee`, `platform:revenue:commission`, `escrow:held`, `provider:available:{provider_id}`, **`expense:psp_fees`**), `type`, `allows_negative` boolean, `active`.

> **G3 — the PSP's own fee must be a posted leg.** Every transaction carries a processing fee that
> earlier drafts modelled nowhere: not in this chart, not in the pricing pipeline (§19.3), not in the
> refund reversal. Left unposted, gross revenue is overstated on every report, and the reconciliation
> job compares a ledger missing the fee against a settlement report that includes it — so it alerts on
> drift **by construction**, and a real alert gets lost in the noise.
>
> Post `expense:psp_fees` from the **actual** figure in the settlement webhook, never an estimate —
> it varies by card scheme, and mada in KSA prices differently from international cards. On a full
> refund the platform reverses its commission but has still paid this fee: **decide explicitly who
> absorbs it and record the decision.** This is the same failure class as §30 (a fee deducted in
> reality but never posted), which is already named as the most common marketplace ledger bug.

- Every posting references a valid `path` (FK).
- **`allows_negative` is explicit per account.** Provider available balance: false. Clearing accounts: may be true.
- New accounts are added by migration, never at runtime.

> **This chart is AGENT-shaped, by decision D12 — do not "simplify" it into a principal shape.**
> We are an intermediary: the provider sells the service to the customer, and we sell two things to
> the provider (commission and unlock fee). Therefore **the job price is never platform revenue.** It
> passes through `escrow:held` and lands on `provider:available:{id}`; only
> `platform:revenue:commission` and `platform:revenue:unlock_fee` are ours.
>
> If anyone ever posts the full job price to a platform revenue account, that is not a rounding
> difference — it silently converts us into a principal, and VAT would then be owed on the whole
> amount rather than on our fees. Add a test asserting that platform revenue reconstructed from the
> ledger never exceeds `Σ(commission) + Σ(unlock fees)`.
>
> The agent position itself is **asserted, not yet legally verified** — blocker B9.

## 30. 🔴 Commission is its own posting

The most common marketplace ledger bug is a fee **netted from a settlement amount but never posted**. Therefore:

- At funding, post **three** legs: external → escrow held (provider portion), external → platform revenue (commission), and the balancing entry. Never compute escrow as `price − commission` and post one line.
- Add an explicit test: total platform revenue reconstructed from the ledger equals the sum of expected commissions.

## 31. 🔴 Idempotency stores and replays the response

An idempotent replay must return the **original result**, not just skip.

**`idempotency_records`**: `key` PK, `request_hash`, `response` jsonb, `psp_reference`, `status`, `created_at`.

- Same key + different payload → reject as a conflict (do not silently serve the old response).
- Store the PSP reference so reconciliation can match.

## 32. 🔴 RLS performance rules

RLS is a correctness mechanism **and** a performance liability. A naive policy turns a list query into a sequential scan; `limit`/`offset` still scans all rows to determine order.

Mandatory:
- **Index every column referenced in a policy** (and every foreign key).
- Wrap auth calls so they evaluate **once per query, not per row**: use `(select auth.uid())` rather than a bare `auth.uid()` inside policy predicates.
- Keep policies simple; move complex logic into a `SECURITY DEFINER` helper with a stable, indexed lookup.
- **CI gate:** `EXPLAIN ANALYZE` on every policy-bearing list query (provider feed, applications, notifications, ledger history). Fail the build on a sequential scan over a growing table.
- Run Supabase's **database advisors** (unindexed foreign keys, RLS misconfiguration) in CI.
- Target: policy-bearing list queries under 50 ms at expected data volume.

## 33. 🔴 Connection pooler constraints

Use the **transaction-mode pooler** URL for all serverless/Edge access. Direct connection is for migrations and long-lived jobs only.

**Transaction mode forbids** (this is where mystery failures come from):
- Prepared statements held across statements → **disable prepared statements in the client**
- `SET` that must persist beyond the statement (use `SET LOCAL` inside an explicit transaction only)
- `LISTEN` / `NOTIFY` on a pooled connection
- Any session-level state

## 34. `proxy.ts`, not `middleware.ts` — and it is NOT a security boundary

Next.js 16 **deprecated and renamed** the `middleware.ts` convention to **`proxy.ts`** (function renamed from `middleware` to `proxy`). A leftover `middleware.ts` is **silently ignored — no error** — so route protection becomes dead code.

- Use `proxy.ts` at project root, exporting `proxy`. Codemod: `npx @next/codemod@canary middleware-to-proxy .`
- `config.matcher` syntax is unchanged. Proxy defaults to the Node.js runtime; the `runtime` option is unavailable.
- **Proxy is a routing/UX layer only.** Authentication and authorisation live in `requireRole()` inside **every** Server Action and Route Handler. Next.js itself now recommends avoiding reliance on this layer.
- Add a smoke test: request a protected route unauthenticated and assert a redirect, so a silent regression is caught.

## 35. PSP resilience contract

The adapter interface must specify:
- **Timeouts** per call (connect and read).
- **Bounded retries** with exponential backoff and jitter — only on retryable errors, never on a definitive decline.
- **Circuit breaker**: after N consecutive failures, open the circuit, stop calling, surface a maintenance state, and drain the outbox when it closes.
- **Degraded mode**: block new funding attempts with an honest message rather than failing mid-flow.
- Ambiguous timeout is **never** treated as success — the outbox retries with the same idempotency key.

## 36. Saga / compensation model

Multi-step flows (fund → hold → unlock → release/refund) are sagas. Each step declares its compensating action, and compensations are **new ledger postings**, never edits:

| Step | Compensation |
| --- | --- |
| Commission posted | Reverse commission posting |
| Escrow held | Refund posting |
| Unlock fee charged | Unlock fee refund posting |
| Payout initiated | Payout reversal posting |

Every compensation is itself idempotent and driven through the outbox.

## 37. Observability specification

- **Tracing:** OpenTelemetry spans across Server Action → DB → outbox → relay → PSP, with a correlation id propagated end to end.
- **Structured logs:** fixed JSON schema with `correlation_id`, `user_id`, `request_id`, `event`, **`region`**. **Never** log PII, tokens, or card data.
- **Alerts with owners:** webhook signature failures, outbox `dead` rows, invariant drift, reconciliation mismatch, circuit-breaker open, auto-release job failure.
- **Dashboards:** money flow funnel (posted → selected → funded → unlocked → released), outbox health, ledger invariants. **One per region plus a combined view** (G19).

### SLO targets

Earlier drafts named the metrics but set no numbers, which makes an alert unactionable — nobody can
say whether a value is bad. These are launch targets at the expected scale (~500 customers, ~400
providers); revisit at 10×.

| SLO | Target | Alert (warn → page) | Why this number |
| --- | --- | --- | --- |
| Funding success rate | ≥ 98% | < 95% → < 90% | Below this the PSP or our payload is broken, not the users |
| Unlock success rate | ≥ 95% | < 90% → < 80% | Card declines are normal; a cliff means the charge path broke |
| Webhook processing lag (p95) | < 5 s | > 30 s → > 2 min | The webhook is the only proof of payment; lag stalls the funnel |
| **Outbox drain lag (p95)** | < 30 s | > 2 min → > 10 min | The user is waiting on this. Cron floor is 60 s, so the on-demand trigger must carry the common path |
| Outbox `dead` rows | 0 | ≥ 1 → ≥ 5 | Each one is money that did not move. Never auto-retried into silence |
| Reconciliation drift | 0 | any → any | Zero tolerance. A non-zero value is a Sev-1 by definition |
| Invariant job (`held = released + refunded + remaining`) | pass | any failure pages | Same |
| Auto-release job success | 100% | any failure → 2 consecutive | A missed run strands provider funds past the promised window |
| Policy-bearing query p95 | < 50 ms | > 200 ms → > 1 s | Matches the RLS performance gate in §32 |
| Relay claim contention | < 1% retried | > 5% | Indicates the atomic claim is degrading under concurrency |

Every alert carries `region` (G19) — a threshold breached in TR and healthy in KSA is a different
incident from one breached in both.


## 38. Feature flags and kill switches

Flags for: `funding_enabled`, `unlock_enabled`, `payouts_enabled`, `auto_release_enabled`, `notifications_enabled`. Each must be flippable **without a deploy**, with a documented kill-switch runbook. A money system with no kill switch is not operable.

## 39. Retention, partitioning, and PII deletion

- **Partition** `ledger_entries`, `notifications`, `audit_log`, `outbox_events` by time.
- **Financial records are retained long-term** (align with local statutory requirements; 7 years is the common norm).
- **PII deletion requests** (KVKK/GDPR) are satisfied by **anonymising personal identifiers while retaining financial rows** — document this resolution; never delete ledger history.
- Archive completed `outbox_events` after a retention window.

## 40. Updated invariants

> **G25 — every global aggregate below is scoped `GROUP BY (region, currency)`. Never bare.**
> With two currencies in one database, an ungrouped `SUM(debit) = SUM(credit)` is not merely wrong —
> it is **meaningless yet passing**: a TRY imbalance and an opposite SAR imbalance sum to zero
> together, and the invariant job reports green while the books are broken in both markets.
> The same applies to escrow conservation, balance-equals-ledger, and platform-revenue
> reconstruction. Reconciliation runs **per PSP, per region**.
>
> Per *transaction group* the check stays unscoped, because a posting group is single-currency by
> construction — one request belongs to one region, and an account belongs to one region. Add a
> database guard asserting that anyway: a posting group containing two currencies is a bug that must
> fail loudly rather than be relied upon not to happen.

Adding to §26:
- Every PSP call originates from an `outbox_events` row — never from a request path
- `SUM(debit) = SUM(credit)` **per `(region, currency)`** and per transaction group, enforced by a DB trigger
- No posting group ever contains more than one currency
- `provider_balances.available == SUM(ledger for that provider's available account)` — asserted by a job
- Platform revenue reconstructed from the ledger equals the sum of expected commissions and unlock fees
- No `ledger_entries` or `ratings` row is mutable by any application role (enforced by `REVOKE`)
- Every account path referenced by a posting exists in `ledger_accounts`

---

## 41. Invoicing adapter (region-specific)

> Added with decision D12. We act as an **agent**: the provider sells the service to the customer, so
> **we never invoice the customer for the job price.** We invoice the *provider* for our two supplies
> — commission and unlock fee. That is a quarter of the scope of principal treatment, but not zero.
> The agent position itself is unverified — blocker B9.

Same shape as the PSP adapter, and for the same reason: two regions, two obligations, and feature
code must not know which.

```ts
// lib/invoicing/types.ts   — import 'server-only'
export interface InvoiceProvider {
  issue(input: InvoiceInput): Promise<{ invoiceId: string; clearanceStatus: ClearanceStatus }>;
  credit(input: CreditNoteInput): Promise<{ invoiceId: string }>;  // refunds, reversals
  status(invoiceId: string): Promise<ClearanceStatus>;
}
```

- Implementations in `lib/invoicing/zatca/` (KSA) and `lib/invoicing/efatura/` (TR); selected by
  the row's `region`, exactly like the PSP adapter. Feature code calls `getInvoiceProvider(region)` only.
- **⛔ Never called from a request path.** Clearance is an external call, so it is an
  `outbox_events` row (`event_type: 'invoice.issue' | 'invoice.credit'`) exactly like every PSP
  effect. An invoice is not "delivered" until clearance returns.
- **Invoice numbering is sequential and hash-chained** — each invoice references the previous one's
  hash. That makes issuance **order-dependent**, which the outbox relay must respect: claim and
  process invoice events for a region **serially**, never in parallel. This is the one place the
  relay's concurrency model differs from PSP calls.
- Invoices are immutable. A correction is a **credit note**, never an edit — the same rule as the
  ledger, for the same reason.
- Store `invoices` with `psp_reference`, `clearance_status`, `xml_hash`, `previous_hash`, `region`,
  and `locale` — **locale is fixed to `ar` for KSA regardless of the recipient's UI language**, since
  ZATCA mandates Arabic fields (G18).

### What branches per provider

| Provider is | Invoice type | Needs |
| --- | --- | --- |
| VAT-registered (≥ SAR 375k) | **Standard** — cleared before delivery | Buyer VAT number (`providers.vat_number`) |
| Below threshold | **Simplified** — reported after issue | No buyer VAT number |

So `providers.vat_number` is nullable and the adapter picks the type. Combined with `entity_type`
from G17, provider verification captures: entity type, tax number, legal name, VAT number — **all
admin/PSP-facing, none of it on the public profile.**

### Not built until B9 returns

Build the seam and the outbox event types now — they are cheap and they prevent a refactor. Do **not**
implement clearance until the agent position is confirmed, because the answer changes what gets
invoiced, not just how.
