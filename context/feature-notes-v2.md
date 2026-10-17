# Feature notes (v2 archive)

v2 archive, created 2026-10-17. This is build-plan v2's numbered feature breakdown, **verbatim**,
kept as requirement seeds for position specs. Its phases, ordering, and the "full UI with mock data
first" principle are **superseded** by `build-plan.md` v3 (positions, tracer bullets). Use the old
feature map at the bottom of `build-plan.md` to find the notes for a position; `/architect` reads
them as INFER material, never as a decided spec.

---

# Numbered Feature Breakdown

## Core Principle

**Full page UI built with mock data first — verified visually before any logic is written.** Then functionality is built and wired to the UI step by step. Every feature must be visible and testable before moving to the next.

**One exception, and it is deliberate:** the money core (features 14–17) has correctness requirements that cannot be verified visually. Its ledger, idempotency, and invariant tests must pass before any money UI is wired to real operations. Build the money UI with mock data first, then wire it only after the core is proven.

Feature numbers below map 1:1 to the checklist in `progress-tracker.md`.

---

## Phase 1 — Foundation

### 01 Project Setup + Tokens
Next.js 16, React 19, TypeScript strict, Tailwind v4, shadcn/ui.

**Logic:**
- Next.js 16 App Router, React 19, TypeScript strict mode
- Tailwind v4 — tokens via `@theme` in `app/globals.css`. **No `tailwind.config.ts` for colours**
- shadcn/ui initialised, primitives only
- **i18n from day one** (`i18n.md`): `next-intl`, `app/[locale]/` segment, `i18n/routing.ts` with
  `locales: ['ar','tr','en']`, `messages/{ar,tr,en}.json`, `dirFor(locale)` helper
- Root layout: `<html lang={locale} dir={dirFor(locale)}>` — **derived, never hardcoded**. Font must
  cover Arabic **and** Latin Extended
- Env var schema validation — fail fast on missing vars: `APP_DEFAULT_LOCALE`,
  `APP_SUPPORTED_LOCALES`, and per-PSP credentials (`IYZICO_*`, `PAYTABS_*`).
  **No `APP_REGION` or `APP_CURRENCY`** — region is a row value and currency derives from it (D14)
- `@/` import alias
- 🔴 **`proxy.ts`**, never `middleware.ts`. Pin exact dependency versions; enable automated dependency PRs
- 🔴 Enable **pgTAP**; wire `supabase test db` into CI; add the schema-wide "RLS enabled everywhere" test
- 🔴 Configure the **transaction-mode pooler** and **disable prepared statements**
- **Pin identifier columns to a deterministic collation** — `lower()` is collation-dependent, and a
  Turkish collation maps `I`→`ı`, silently breaking email uniqueness (`i18n.md` §6)
- CI: typecheck, lint, test, guardrails, message-catalogue completeness

### 02 Auth + Roles
OTP authentication with a swappable channel.

**UI:**
- Login page — phone input, OTP code input, resend with countdown
- Role selection on first sign-up: customer or provider

**Logic:**
- `lib/auth/otp-channel.ts` — phone default, email interchangeable
- Role written to `app_metadata` server-side only
- `requireUser()` / `requireRole()` helpers
- **`proxy.ts`** (never `middleware.ts` — Next 16 silently ignores it) redirecting unauthenticated
  traffic from `/requests`, `/provider`, `/admin`. Routing/UX only — `requireRole()` in **every**
  action and handler is the actual authorisation. Add a smoke test asserting the redirect.
- Rate limits per phone / IP / device + bot challenge
- After login → redirect to role home

### 03 Database Schema + RLS Baseline
All tables and policies before any data is written.

**Logic:**
- Every table from `architecture.md` §13
- **RLS enabled deny-by-default on every table, in the creating migration**
- Constraints: non-negative balances, unique idempotency keys, one chosen application per request, escrow conservation
- Private `provider-documents` storage bucket
- Generate DB types
- **First RLS test: an unauthorised read fails**

### 04 App Shell + Navigation
The three role-based apps in one codebase.

**UI:**
- Top navbar, role-based items (see `project-overview.md` §12)
- Route groups `(customer)`, `(provider)`, `(admin)`
- Landing page — hero, how it works, categories, footer
- Empty/loading/error shells

**Logic:**
- Role-based redirect from `/`
- Nav renders only the current role's items

---

## Phase 2 — Catalog and Pricing

### 05 Admin Catalog — Full UI
**UI:** categories, services, addons, zones tables with create/edit/delete dialogs. Mock data.

### 06 Catalog CRUD Logic
**Logic:** Server Actions for all catalog entities; validation; audit log on change.

### 07 Pricing Rules + Engine
**UI:** pricing rules table by service × size × zone; addon prices; fee and commission fields.

**Logic:**
- `platform_settings`: commission %, unlock fee, hold hours, unlock window hours, applicant cap
- **`lib/pricing/` — server-only price engine**
- Test: a tampered client price is ignored; server value wins

### 08 Customer Browse + Price Preview
**UI:** category → service → size → addons → date/time → address; live price panel.

**Logic:** price computed server-side on every input change; never in the client.

---

## Phase 3 — Requests and Applications

### 09 Post Request — Full UI + Logic
**UI:** request form, confirmation, success message, my-requests list, request detail.

**Logic:** create with `status = OPEN`, server-computed `fixed_price` and `commission_amount`; address ownership check.

### 10 Provider Feed — Short Details Only
**UI:** feed list and detail. Service, district, date/time, price. **No customer name, phone, or street.**

**Logic:**
- RLS policy exposing PII-free columns only
- Filter by provider zones and availability
- **RLS test: provider cannot read customer PII on an open request**

### 11 Apply + Contact Scanner
**UI:** application form with a warning that contact info is rejected; my-applications list.

**Logic:**
- Free insert; unique `(request_id, provider_id)`; applicant cap
- `lib/scanner/contact-info.ts` — phones, emails, URLs, handles, **Arabic-Indic digits ٠-٩**, spaced/spelled digits
- Defence in depth, not a guarantee — pair with leakage monitoring (24)
- **RLS test: provider cannot read a rival's application**

### 12 Applicant List + Choose Provider
**UI:** applicant cards — rating, jobs completed, message; choose with confirmation.

**Logic:** chosen application → `SELECTED`, the rest → `NOT_SELECTED`; request → `SELECTED`; sets
**`payment_deadline`** (not `unlock_deadline` — that is set later, when the request becomes `FUNDED`);
notifies the chosen provider. See `architecture.md` §21.

### 13 Request Status + Realtime
**UI:** status badge and timeline from the canonical state machine.

**Logic:** Realtime scoped to the two involved parties; verify RLS applies before subscribing.

---

## Phase 4 — Money Core

> ⛔ No money UI is wired to real operations until 14–17 gates pass.

### 14 Money Primitives + Ledger
**Logic:**
- `Money` type — integer minor units, single currency per deployment
- `ledger_entries` append-only; `SECURITY DEFINER` balanced posting function that throws if unbalanced
- `provider_balances` projection updated **in the same transaction**
- Idempotency helper — deterministic keys, unique constraint
- **Test: concurrent debits never go negative**

### 15 PSP Adapter
**Logic:**
- `PaymentProvider` interface (`architecture.md` §5)
- **Both implementations live at once**, selected by the row's `region` — never by an env var (D14)
- Sub-merchant onboarding on provider approval
- Zod-validate every PSP response
- **Stop and ask if the PSP lacks a required capability**

### 16 Webhook Receiver
**Logic:**
- Raw body → verify signature → `psp_events` dedupe → re-verify amount/status → one transaction → fast 2xx
- **Test: duplicate webhook applies exactly once**

### 17 Invariant + Reconciliation Jobs
**Logic:**
- Assert `held = released + refunded + remaining`; alert on drift
- Reconcile ledger vs PSP settlement; alert, never auto-correct
- **Test: invariant holds after randomised operation sequences**

---

## Phase 5 — Unlock, Escrow, Release

### 18 Unlock Fee + Reveal
**UI:** "You were selected" panel, fee amount, confirmation dialog stating the exact amount, revealed customer details after success.

**Logic:**
- Charge chosen provider only, idempotent, via PSP
- On success: `unlock_fees` paid row + ledger + status `UNLOCKED`
- **RLS: PII visible only when a paid unlock row exists**
- **RLS test: PII hidden before, visible after — same query, same user**

### 19 Unlock Expiry Job
**Logic:** **`FUNDED`** past `unlock_deadline` → back to `OPEN`, **funds stay held**, notify customer,
application → `EXPIRED` (not `NOT_SELECTED` — that value means another provider was chosen).
Increment `reselection_count`; at 3, refund in full instead of reopening (G2).
A separate job handles `SELECTED` past `payment_deadline` → `OPEN`, applications restored to `APPLIED`.

### 20 Customer Payment + Escrow Hold
**UI:** payment panel showing price, commission, and held amount; redirect handling.

**Logic:**
- PSP split payment: commission to platform, remainder held
- `escrows` row created **from the webhook**, not the redirect
- Status `FUNDED`

### 21 Completion + Confirm + Auto-Release
**UI:** provider "start" / "mark complete"; customer confirm panel with auto-release deadline shown.

**Logic:**
- `IN_PROGRESS` → `AWAITING_CONFIRMATION` + `release_deadline`
- Confirm → atomic release; PSP release call; ledger; `provider_balances.available` up
- Auto-release job at deadline
- **Test: dispute racing auto-release moves funds exactly once**

### 22 Disputes + Admin Resolution
**UI:** dispute form (only before deadline); admin dispute queue with release / partial / refund.

**Logic:** suspends release; resolution posts balanced ledger entries; audit logged.

### 23 Earnings + Payouts
**UI:** pending / available / paid out; transaction history; withdrawal form with confirmation.

**Logic:**
- **Read-only mirror. No top-up. No stored balance**
- Payout via PSP; `available` → `paid_out`; payout-in-progress state prevents double-spend

---

## Phase 6 — Completion and Admin

### 24 Ratings
**UI:** optional rating prompt after release.
**Logic:** **must not gate payment**; updates `rating_avg` and `jobs_completed`.

### 25 Notifications
**Logic:** queued with retry and dead-letter; events per `project-overview.md` §17; admin-editable templates. Never inline in a request path.

### 26 Admin Dashboard + Reports + Leakage
**UI:** dashboard stats, request management, reports.
**Logic:** revenue split by unlock fees vs commission; **leakage watchlist — providers with many unlocks but few releases**.

---

## Phase 7 — Hardening

### 27 Security + Load Testing
Full RLS suite, STRIDE review of auth/unlock/escrow/webhook, load test to target concurrency, pooled connections verified.

### 28 Launch Prep
Backups with a tested restore, monitoring and alerts, Arabic/RTL pass, accessibility pass, seed data, provider onboarding runbook, **legal/PSP custody confirmation recorded**.

---

## Feature Count

**47 features.** The original 28, plus 07a–07c (dynamic questions and pricing), 29–31 (notifications,
provider profile, scheduling), 32–37 (trust and quality), and 38–44 (the v5 review fixes). The
authoritative checklist is `progress-tracker.md` §12.

> ⚠️ This section previously said "28 features across 7 phases" — stated *after* the document had
> already added the other nineteen.

**Features 14–17 and 38–39 are the highest-risk in the project** — the only ones where a silent bug
loses real money. 38 (transactional outbox) must be built **before** 18.

---

# Added Features — Dynamic Questions and Pricing Formula

> Inserted into **Phase 2**, between 07 and 08. Existing feature numbers are unchanged.
> Features **08 and 09 depend on these** — the customer request form is generated from questions, so build these first.
> Full specification: `architecture.md` §19.

### 07a Admin Question Builder

Admins define the questions for each category (and per-service overrides) with no code change.

**UI:**
- Questions list per category, ordered, drag to reorder
- Add / edit question dialog: key, Arabic label, help text, type, required, `affects_pricing`, validation (min/max/step/maxLength)
- Options editor for `single_select` / `multi_select` — value + Arabic label rows
- Per-service override section: inherit category questions, or override
- Deactivate (soft delete) — never a hard delete button
- Live preview of the resulting customer form

**Logic:**
- `questions` table per `architecture.md` §19.2
- Exactly one of `category_id` / `service_id` set; unique `key` per scope
- **`key` is immutable after creation** — the edit form must not allow changing it
- Deactivating a question used by an active modifier warns and requires confirmation
- Reordering writes `display_order`
- All changes written to `audit_log`

### 07b Pricing Formula Builder

Admins compose the price formula from structured rules — never free text.

**UI:**
- Per service: base price field
- Modifier list, ordered by `apply_order`, drag to reorder
- Add modifier: pick question → match type (`equals` / `in` / `range` / `is_true` / `always`) → match value → effect (`FIXED` / `PER_UNIT` / `MULTIPLIER`) → amount or factor
- Only questions with `affects_pricing = true` are selectable
- **Live formula preview:** enter sample answers, see the full breakdown and final price
- Zone multiplier and addon prices shown as later pipeline stages, read-only here

**Logic:**
- `pricing_formulas` + `pricing_modifiers` tables
- ⛔ **No expression strings. No `eval`. No `Function()`.** Structured rows only
- Reject a modifier referencing a `text` / `textarea` question
- Bound `MULTIPLIER` factors (suggested 0.1–10)
- Saving increments `pricing_formulas.version`; exactly one active formula per service
- Existing requests are **never re-priced** by an edit
- Audit-logged

### 07c Dynamic Question Renderer + Server Pricing

The customer form is generated from the active questions, and the price is computed from the answers.

**UI:**
- `DynamicQuestionForm` renders each question by type: `number`, `single_select`, `multi_select`, `boolean`, `text`, `textarea`, `date`, `time`
- Arabic labels, RTL, visible labels, inline errors
- Live price panel updating as answers change — **value always from the server**
- Price breakdown display: base, each modifier that fired, addons, zone, total

**Logic:**
- `loadActiveQuestions(serviceId)` — category questions plus service overrides
- **Zod schema built at runtime** from question types and validation
- Server rejects: unknown keys, missing required answers, out-of-range values
- `lib/pricing/` evaluates the pipeline in `architecture.md` §19.3 — **single rounding step**
- Returns `{ price, commission, breakdown }`; the client renders it and never computes it
- On submit: store `answers`, `questions_snapshot`, `pricing_snapshot` on the request

**Tests:**
- Tampered price from the client is ignored; server value wins
- Unknown answer key rejected
- Required question missing → rejected
- Editing a formula does not change an existing request's price
- Same answers + same formula version → identical price (deterministic)
- Rounding happens exactly once (no drift across modifier chains)

---

# ⚠️ v3 CORRECTIONS TO FEATURES

Corrected order: **customer pays → provider unlocks.** See `project-overview.md` §21–25.

### Corrections to existing features

| Feature | Correction |
| --- | --- |
| 03 Database Schema | Add `provider_profiles`, `provider_work_addresses`, full `notifications` table. Requests get `scheduled_start_at`, `scheduled_end_at`, `actual_started_at`, `actual_completed_at`, `payment_deadline`. Applications get the 12-value status enum |
| 09 Post Request | Customer picks **start date and expected completion date**, both validated |
| 11 Apply | On insert → **notify the customer (in-app + email)** |
| 12 Choose Provider | Sets `SELECTED` + `payment_deadline`; notifies the chosen provider |
| **20 → now runs BEFORE 18** | Customer payment now precedes unlock. Build 20 first |
| 18 Unlock Fee | Only from `FUNDED`. Blocked if the request is not yet funded |
| 19 Unlock Expiry | **Funds stay held.** Request → `OPEN`, application → `EXPIRED`, customer re-selects free |
| 25 Notifications | Implement the full 19-row matrix, both channels |

### 29 In-App Notification Centre

**UI:** navbar bell with unread count; dropdown of recent notifications; `/notifications` page with read/unread; each item links to its request.

**Logic:** `notifications` table; RLS own-rows-only; in-app row written synchronously in the same transaction as the triggering event; email/WhatsApp queued; mark-read action; unread count via scoped aggregate.

### 30 Provider Profile + Verification

**UI:** profile editor (display name, photo, bio, years of experience, skills, languages, services); work addresses manager; document upload with per-document status and rejection reason; public profile preview as the customer sees it; admin review queue with approve/reject + reason.

**Logic:** `provider_profiles`, `provider_work_addresses`; documents with status and reviewer; **provider cannot apply until `APPROVED`**; approval triggers PSP sub-merchant onboarding; RLS — full work address is provider+admin only, customers see the zone; documents never customer-readable.

**Tests:** a `PENDING` provider cannot apply; a customer cannot read a provider's documents or full address; contact details are hidden until the request is `UNLOCKED`.

### 31 Request Scheduling

**UI:** start date/time and expected completion pickers on the request form; both shown in provider short details; timeline showing scheduled vs actual.

**Logic:** validate future start and end-after-start; `actual_started_at` / `actual_completed_at`; **release deadline computed from `actual_completed_at`**; overdue flag when past `scheduled_end_at` without completion.

---

# v4 FEATURES — TRUST & QUALITY

### 32 Rating System

**UI:** dimension rating form (punctuality, quality, professionalism, value); provider rating display with count, `NEW` badge under 5 ratings, dimension breakdown, rating history.

**Logic:** append-only `ratings`; **Bayesian shrinkage with recency weighting** (`architecture.md` §24); recompute on insert and nightly; admin **hide with reason** only — no edit, no delete; hidden ratings excluded from computation.

**Tests:** one 5.0 does not outrank fifty 4.8s; averages hidden under 5 ratings; hiding recomputes correctly; **no code path writes `rating_avg` directly**.

### 33 Provider Quality Metrics

**UI:** metrics on the provider profile and in the applicant card.

**Logic:** `provider_metrics` projection recomputed nightly from source tables; `unlock_follow_through` feeds the leakage watchlist. **No manual write path.**

### 34 Vetting Funnel

**UI:** admin pipeline view by stage; stage transition with reason; rejection/suspension reasons; acceptance-rate stat.

**Logic:** `vetting_status` state machine; only `active`/`probation` may apply; probation counter decrements on release; **platform computes the real acceptance rate** — any public quality claim must derive from it.

### 35 Reputation Migration (launch only)

**UI:** admin import screen for `legacy_jobs_completed` + provenance note; rating-invitation generator (provider + job description → single-use link); public rating form at the invitation link; Founding Provider toggle.

**Logic:** legacy fields stored **separately**; `source = 'migrated'` on seeded ratings; single-use expiring tokens; **admin can never submit a rating themselves**; every action audit-logged.

**Tests:** legacy counts never appear inside `jobs_completed`; an invitation token works once; an admin cannot POST a rating.

### 36 Structured Application Answers

**UI:** application form renders admin-configured questions per category instead of one free-text box; answers shown in the applicant card.

**Logic:** reuses the question engine (§19); contact-info scanning on every free-text answer.

### 37 Quality Floor + Cold Start

**Logic:** minimum-rating threshold → warning → suspension; dispute and cancellation rates monitored separately; document expiry and re-verification; `NEW — vetted` badge; temporary visibility boost for a new provider's first few requests.

---

# ⚠️ v5 — REVIEW FIXES TO THE PLAN

> From [`architecture-review.md`](architecture-review.md) (P0-1…P0-6). Items 🔴 are **pre-money-flow blockers**.

## Corrections to existing features

| Feature | Correction |
| --- | --- |
| 01 Project Setup | 🔴 Use **`proxy.ts`** not `middleware.ts`. Pin exact dependency versions; enable automated dependency PRs. 🔴 Enable **pgTAP**; wire `supabase test db` into CI; add the schema-wide "RLS enabled everywhere" test. 🔴 Configure the **transaction-mode pooler** and **disable prepared statements** |
| 02 Auth + Roles | 🔴 `proxy.ts` is routing/UX only. `requireRole()` in **every** action and handler. Add a smoke test asserting an unauthenticated protected-route request redirects |
| 03 Database Schema | 🔴 Add `outbox_events`, `ledger_accounts`, `idempotency_records`. 🔴 `REVOKE UPDATE, DELETE` on `ledger_entries` and `ratings`. 🔴 Deferred sum-to-zero constraint trigger. Index every policy column and FK. Partition time-series tables |
| 10 Provider Feed | 🔴 `EXPLAIN ANALYZE` the feed query with the policy applied; index policy columns; use `(select auth.uid())`. Must be under 50 ms at expected volume |
| 14 Money Primitives | 🔴 **Rewrite:** DB-first + outbox. Idempotency stores and replays the response. Account paths from `ledger_accounts` |
| 15 PSP Adapter | 🔴 Adapter is called **only by the relay**. Add timeouts, bounded jittered retries, circuit breaker, degraded mode |
| 16 Webhook Receiver | Unchanged in shape; confirm it writes state + ledger + any follow-on outbox event in one transaction |
| 17 Invariant Jobs | 🔴 Add `available == SUM(ledger)` assertion and platform-revenue reconstruction. Alert, never auto-correct |
| 18 Unlock Fee | 🔴 No inline PSP call. Charge is an outbox event |
| 20 Customer Payment | 🔴 **Commission posted as its own ledger leg** — never `price − commission` in one line |
| 21 Release | 🔴 Release is an outbox event; the atomic state transition happens in the DB first |

### 38 Transactional Outbox + Relay

> 🔴 **Build BEFORE feature 18.**

**Logic:**
- `outbox_events` table with status, attempts, backoff, `next_attempt_at`, dead state
- Relay worker: atomic row claiming (safe to run concurrently), calls `lib/psp` with the row's idempotency key, records `psp_reference`, backs off on failure, marks `dead` after N attempts and **alerts**
- Scheduled Edge Function + on-demand trigger
- Admin queue for `dead` rows with manual retry
- Notifications routed through the same outbox

**Tests:**
- Kill the relay mid-flight → the event is retried, and the PSP is charged **once** (same idempotency key)
- Two relay instances racing one row → claimed once
- A permanently failing event reaches `dead` and alerts
- **No PSP call exists in any request path** — enforce with a lint rule or import check

### 39 Ledger Integrity Enforcement

**Logic:** `REVOKE UPDATE, DELETE` on history tables; deferred sum-to-zero constraint trigger; `ledger_accounts` chart with `allows_negative`; `idempotency_records` storing responses.

**Tests:** a direct `UPDATE` on `ledger_entries` as any app role fails; an unbalanced posting is rejected by the **database** (not just the function); an unknown account path is rejected; a replay returns the stored response; the same key with a different payload raises a conflict.

### 40 RLS Performance Hardening

**Logic:** indexes on all policy columns and FKs; `(select auth.uid())` rewrites; Supabase database advisors in CI; `EXPLAIN ANALYZE` gate on policy-bearing list queries.

**Tests:** each list query is index-scanned, not sequential-scanned, at seeded volume; p95 under target.

### 41 Observability

**Logic:** OpenTelemetry tracing action → DB → outbox → relay → PSP with a propagated correlation id; structured JSON logs (no PII/tokens); SLOs and alert thresholds for funding success, unlock success, webhook lag, **outbox drain lag**, reconciliation drift, auto-release success; dashboards for the money funnel and outbox health.

### 42 Feature Flags + Kill Switches

**Logic:** `funding_enabled`, `unlock_enabled`, `payouts_enabled`, `auto_release_enabled`, `notifications_enabled` — flippable without a deploy, with a documented kill-switch runbook.

### 43 Admin Operational Tooling

**UI/Logic:** manual escrow release with reason; stuck-request recovery; force-refund with dual approval; webhook replay; outbox retry; dead-letter queue view. All audit-logged. **Without these, engineers will fix production with raw SQL — which is how ledgers get corrupted.**

### 44 Incident Runbooks + DR

**Deliverables:** runbooks for stuck escrow, webhook storm, failed payout, PSP outage, ledger drift, duplicate charge, outbox backlog. Defined **RPO/RTO** with a rehearsed restore into a scratch project. Retention/partitioning/PII-anonymisation policy documented.

## Revised phase order (important)

```
Phase 4 (Money Core) now = 14 → 38 (outbox) → 39 (integrity) → 15 → 16 → 17
Phase 3 gains 40 (RLS perf) as its exit gate
Phase 5 unchanged in scope but every PSP interaction goes through the outbox
Phase 7 gains 41, 42, 44
Phase 6 gains 43
```

**Phase 4 exit gate (all must pass):** outbox retry charges once · relay concurrency safe · DB rejects unbalanced postings · `UPDATE` on ledger fails · idempotency replays response · `available == SUM(ledger)` holds · escrow conservation holds · no PSP call in any request path.
