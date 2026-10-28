# Project Overview

v3, 2026-10-17: §0 doc map and precedence rewritten for the playbook layout; §1 gains the launch date,
scope test, and Turkey first launch; §5 becomes the canonical text of the rules that never bend.

> **Read this first** (after `AGENTS.md`). This file is the source of truth for **what** we are
> building and **why**. `architecture.md` covers **how**. Until the owner's brief is imported into
> `docs/brief/`, the product sections of this file stand in for it.

---

## 0. Document map

Read order: `AGENTS.md` (auto loaded) → this file (§1, §5, §6, §8) → `progress-tracker.md` → the
current position's spec in `docs/specs/` → only the one doc the task needs. **Do not read every doc**:
`context/` is about 6,000 lines and reading it all degrades output before any work begins.
`AGENTS.md` has the task to document routing table.

| File | Read it for |
| --- | --- |
| **project-overview.md** (this) | The business model, the flow, the rules that never bend, when to stop and ask |
| **progress-tracker.md** | Current state, blockers, decision log, open questions, owner steps. **Session start and end** |
| **build-plan.md** | Positions in order, gates G0–G3, cut list, target schedule |
| **architecture.md** | Stack, trust boundaries, single doors, data model, PSP adapter, folder layout |
| **code-standards.md** | How to write it: money, RLS, validation, errors, testing, tooling |
| **library-docs.md** | Approved dependencies and their real world gotchas |
| **ui-rules.md** / **ui-tokens.md** / **ui-registry.md** | Composition rules / raw values / every built component |
| **i18n.md** | Locales, direction, region model, translatable content, the Turkish casing hazard |
| **feature-notes-v2.md** | The old per feature notes, verbatim: requirement seeds for position specs |
| **architecture-review.md** | The v5 corrections in full (P0-1…P0-6) |
| **contradictions.md** | 13 places these documents disagreed. All fixed; a record of the failure modes |
| **open-questions.md** | Archive of gaps G1–G27 and their resolutions. Live questions are Q rows in the tracker |
| `docs/specs/` | One decision each, the contract a position is built and checked against |
| `docs/brief/`, `docs/design/`, `docs/reviews/` | The owner's brief · design references · dated review and verify reports |
| `docs/engineering-approach.md` | The general methodology (the playbook) |

### Precedence when documents conflict

1. **Rules that never bend** (§5) and money custody (§6) override everything
2. The `progress-tracker.md` decision log: a recorded owner decision beats a general rule
3. The spec being built, for its own feature (`docs/specs/`)
4. The product brief (`docs/brief/`; until imported, the product sections of this file)
5. `architecture.md`
6. `code-standards.md`, `ui-tokens.md`, `ui-rules.md`
7. `build-plan.md` task wording
8. `docs/engineering-approach.md`

A `v5` section overrides an earlier `v3`/`v4` section in the same file. A context doc that contradicts
the brief with no decision log entry explaining why is a bug in the context doc. If a conflict is not
resolved by this order, **stop and ask**. Do not pick one silently.

---

## 1. What this is

A **home-services marketplace** (starting with home cleaning) that connects **customers** who need a service with **providers** who perform it.

The platform is the intermediary. It sets prices, controls matching, and earns money two ways:

1. **Unlock fee** — a fixed fee paid by the provider *who gets chosen*, to reveal the customer's full details.
2. **Commission** — a percentage of the job price, deducted when the customer pays.

The business currently runs manually in a WhatsApp group of 400+ members. This platform replaces that.

**This release ships:** responsive web app (customer + provider + admin), in **three languages —
Arabic (RTL), Turkish, English** — built for **Turkey** and **Saudi Arabia** from **one deployment**,
separated by a `region` column (D14). See [`i18n.md`](i18n.md).
**Not in this release:** native mobile apps, multi-city expansion, AI features.

**Launch: 2026-11-28, Turkey only (D22; date replanned 2026-10-28, D65).** iyzico Marketplace holds the funds (D23). KSA stays in
the schema with its region switched off until a Saudi PSP is chosen (Q7); nothing may hardcode Turkey,
because the second region is a data change, not a rewrite.

**Priority** (D35, confirmed by the owner, D42): correct money and private data > the core journey
working end to end in all three locales > design polish > extra features.

**In scope test:** a feature is in scope only if it directly helps sell, operate, or learn. Anything not
in the brief is asked about before it is built, and logged as an override in the decision log.

---

## 2. Actors

| Actor | Description |
| --- | --- |
| **Customer** | Posts a service request, chooses a provider, pays, confirms completion, rates. |
| **Provider** | Applies to requests, pays the unlock fee when chosen, performs the service, gets paid. |
| **Admin** | Sets pricing formulas, fees, and commission. Approves providers. Resolves disputes. |
| **PSP** | External licensed payment service provider. Holds all money. See §6. |

---

## 3. The transaction flow — ⛔ SUPERSEDED BY §21. DO NOT IMPLEMENT FROM THIS SECTION.

> **The payment order below is WRONG and was corrected in v3.** It has the provider paying the
> unlock fee *before* the customer pays. The real order is the reverse: **the customer pays first,
> then the chosen provider unlocks.** The provider must not risk the unlock fee until the customer's
> money is already secured.
>
> **Read [§21](#21-corrected-transaction-order-important) instead.** Steps 1–4 and 8–11 below are
> still accurate; steps 5–7 are inverted. Kept only as history — the "do not improve these" table
> that follows applies to the *reasoning*, not to the sequence.

```
1.  Customer posts a request
       → platform computes a FIXED price from an admin-configured formula (server-side only)

2.  Eligible providers see SHORT DETAILS ONLY
       → service type, general area (district, never street), date/time, price
       → NEVER: customer name, phone, exact address

3.  Providers APPLY FOR FREE, each with a message
       → message is scanned server-side; contact info (phone/email/links/handles) is REJECTED

4.  Customer reviews applicants (rating, completed jobs, message) and CHOOSES ONE

5.  The CHOSEN provider pays a FIXED UNLOCK FEE
       → this is platform revenue, captured immediately
       → only the chosen provider ever pays; applying is always free

6.  Customer's full details are revealed to the provider
       → both parties may now contact each other freely; there is NO number masking

7.  Customer pays the full price
       → commission goes to the platform
       → the remainder is HELD (escrow) at the PSP

8.  Service is performed offline

9.  Provider marks the job complete → then ONE of:
       a. Customer confirms          → funds released
       b. Hold period expires         → funds AUTO-RELEASE
       c. Customer disputes in time   → release suspended, admin resolves

10. Funds land in the provider's earnings balance → provider withdraws

11. Customer may OPTIONALLY rate. Rating NEVER gates payment.
```

### Why the design is this way (do not "improve" these)

| Rule | Reason |
| --- | --- |
| Applying is free; only the chosen provider pays | Competitors charge for shared leads that never convert. Charging only on won work is our differentiator. |
| Auto-release exists | Without it, an inactive or hostile customer traps the provider's money forever. |
| Rating never gates payment | Otherwise providers pressure customers for good ratings, and ratings become worthless. |
| No number masking | The model deliberately reveals contact. Leakage is handled economically — we already took the unlock fee. |
| Price is computed server-side, always | The client is hostile. A client-supplied price is always ignored. |

---

## 4. Request state machine

The canonical states. Do not invent new ones without updating this file.

```
OPEN → SELECTED → FUNDED → UNLOCKED → IN_PROGRESS → AWAITING_CONFIRMATION → RELEASED
```

> ⚠️ **Corrected in v3.** This previously read `SELECTED → UNLOCKED → FUNDED`. `FUNDED` comes
> **before** `UNLOCKED` — the customer pays, then the chosen provider unlocks. Per-state meanings and
> the full guard table are in [§21](#21-corrected-transaction-order-important) and
> `architecture.md` §21.

Branches:
- `OPEN → CANCELLED` (customer cancels or request expires)
- `SELECTED → OPEN` (customer does not pay within the payment window — applicants restored)
- **`FUNDED → OPEN`** (chosen provider misses the unlock window — **funds STAY HELD**, the customer re-selects without paying again, that application → `EXPIRED`). Capped at 3 re-selections, then full refund
- **`UNLOCKED | IN_PROGRESS | AWAITING_CONFIRMATION → DISPUTED`** (G1). A customer whose provider took the PII and then vanished must be able to act — dispute was previously reachable only from `AWAITING_CONFIRMATION`, which left money held with no exit
- `UNLOCKED → *` and `IN_PROGRESS → *` also expire on `start_deadline` / `completion_deadline` (G1) — flags the request for admin action; never an automatic refund, since the work may be underway offline
- `DISPUTED → RELEASED | REFUNDED | PARTIALLY_RELEASED` (admin resolution)

Terminal states: `RELEASED`, `REFUNDED`, `PARTIALLY_RELEASED`, `CANCELLED`.

---

## 5. Rules that never bend

**Canonical text** (v3, 2026-10-17, D33). These are correctness requirements, not preferences: a change
that breaks one is a bug even when every test passes, and most break **silently**, with a leak or lost
money instead of an error. Each rule names the layer that enforces it, lowest first. Refer to them by
number everywhere ("rule 3"); `AGENTS.md` carries a one line summary and this text wins.

1. **Price, commission, and fees are computed on the server.** The client sends answers, never a price.
   `lib/pricing/` (server only) evaluates structured formula rows; the request stores
   `pricing_snapshot`; a client supplied price is ignored. Enforced by the server action and a tamper
   test. *Why:* §1, §20; a tampered price loses money on every job.
2. **Customer PII is visible only after a paid unlock, and no provider ever reads another provider's
   data.** RLS on the PII tables requires a `paid` row in `unlock_fees` for that `(request, provider)`;
   request status `FUNDED` is **not** sufficient. A provider can never read another provider's
   application, earnings, or balance. Enforced by RLS with negative pgTAP tests, never by hiding a
   field in React. *Why:* §3, §14, §21; the reveal is what the unlock fee sells.
3. **No external call in a request path; money state changes only on verified PSP facts.** Money flow
   is DB transaction → `outbox_events` → relay worker → PSP; the relay is the only mutating caller of
   `lib/psp`. A payment, refund, or release is recorded only from a verified callback or a server to
   server lookup, never from a browser redirect. Enforced by lint (single door), the write guard, CI,
   and callback tests. *Why:* `architecture-review.md` P0-1; an inline call cannot be atomic with the
   commit.
4. **Money is integer minor units.** No float or double anywhere money flows, no client side money
   arithmetic, one rounding step at the documented place in the pricing pipeline. Enforced by the
   `Money` type, column types, and the write guard. *Why:* D6; float rounding is unacceptable in a
   ledger.
5. **`ledger_entries` and `ratings` are append only.** `UPDATE` and `DELETE` are `REVOKE`d at the
   database level; corrections are new compensating postings; a rating may be hidden, never edited.
   Enforced by grants and pgTAP. *Why:* `architecture.md` §28; history must be reconstructible.
6. **Every money operation is idempotent, atomic, and balanced.** Deterministic keys derived from domain
   ids with a unique constraint; a replay returns the **stored** response; debits and credits commit
   together or not at all; balances never go negative (database constraint); held funds leave exactly
   once (`held = released + refunded + remaining`, per `(region, currency)`); **commission is its own
   ledger leg**, never `escrow = price − commission` as one line. Enforced by the posting function,
   constraints, property and race tests. *Why:* §6, D20; a double charge or a lost fee is real money.
7. **RLS enabled + policy written + negative test proving the wrong user is denied, in the same
   migration and commit as the table.** Default deny; each position adds only its own write path; meta
   pgTAP tests enumerate every table and function so a new one cannot slip past. *Why:* a missing
   policy throws no error, it just leaks.
8. **Never execute an admin authored string.** No `eval`, `new Function`, or dynamic import of admin
   input. Pricing formulas are structured rows interpreted by our own code. Enforced by the write guard
   and lint. *Why:* D10; an admin account is not a code execution boundary.
9. **The platform never holds user funds.** A licensed PSP holds everything (iyzico Marketplace in
   Turkey); our database is a ledger that mirrors it. No wallet top up, no stored balance;
   `FEATURE_STORED_BALANCE_WALLET` stays OFF until legal sign off is recorded. *Why:* §6; custody makes
   the platform a regulated money transmitter.
10. **Three locales and two regions, by construction.** `ar` (RTL), `tr`, `en`; direction derived from
    the locale at runtime, never hardcoded; logical properties and semantic tokens only; no hardcoded
    user facing strings; region is a column on the owning row, never an env var; never case fold an
    identifier with a Turkish locale (`I`↔`ı`). Enforced by the write guard, `lint:rtl`, the catalogue
    check, and e2e in all three locales. *Why:* D8, D14, [`i18n.md`](i18n.md).
11. **`proxy.ts`, never `middleware.ts`; authorization runs in every action.** The proxy is routing and
    UX only; `requireRole()` runs inside every Server Action and Route Handler, proven by a meta test
    over every exported action. *Why:* Next 16 silently ignores `middleware.ts`, so route protection
    would be dead code.

Candidate rules waiting for the owner (Q10): user written content is always rendered escaped,
including in emails; a secret is read only inside its single door.

---

## 6. Money custody — read carefully

> **The platform must never hold, touch, or control user funds.**

Holding customer money in escrow, or holding stored balances in provider wallets, is exactly what causes a platform to be classified as a **regulated money transmitter / e-money issuer**. That would require a licence we do not have.

**Therefore:**

- All funds are held by a **licensed PSP**: iyzico Marketplace in Turkey (D23); the Saudi PSP is chosen before the KSA launch (Q7). See `architecture.md` §5.
- Providers are onboarded to the PSP as **sub-merchants**; the PSP pays them directly.
- Escrow "hold" and "release" are **PSP operations we trigger by API**, not money sitting in our account.
- Our database stores a **ledger that mirrors** the PSP's state. It is a record, not a treasury.

### The wallet — default is NON-CUSTODIAL

The provider "wallet" is, by default, a **read-only earnings view**: pending, available, and paid-out amounts mirrored from the PSP.

The unlock fee is charged **per transaction**, either:
- **(A default)** to the provider's saved card **at unlock — i.e. once the request is already `FUNDED`**, or
- **(B)** netted out of the provider's payout on that job.

> ⚠️ **Corrected in v3.** This previously said "at the moment of selection". After the payment-order
> correction (§21) the fee is charged at **unlock**, which happens strictly *after* the customer has
> paid and the request has reached `FUNDED`. A provider is never asked for money before the
> customer's funds are secured. The charge is also **never inline** — it is an `outbox_events` row
> processed by the relay (`architecture.md` §27).

> ⛔ **A stored, pre-loadable balance (provider tops up, spends later) is NOT to be implemented.**
> It sits behind the feature flag `FEATURE_STORED_BALANCE_WALLET`, which is **OFF** and must remain off until written legal sign-off is recorded in `progress-tracker.md`. If a task asks you to build top-up, **STOP and ask** (see §8).

---

## 7. Glossary

| Term | Meaning |
| --- | --- |
| **Request** | A job posted by a customer. The central entity. (Not "order".) |
| **Application** | A provider's free bid on a request, with a message. |
| **Unlock fee** | Fixed fee paid by the chosen provider to reveal customer details. |
| **Commission** | Platform's percentage of the job price. |
| **Escrow / hold** | Customer funds held at the PSP between payment and release. |
| **Release** | Moving held funds to the provider. |
| **Hold period** | Time after completion before funds auto-release (default 72h, admin-configurable). |
| **Unlock window** | Time a chosen provider has to pay the fee before the request reopens (default 24h). |
| **Short details** | The PII-free subset of a request that providers see before unlock. |
| **PSP** | Payment Service Provider — the licensed party that holds funds. |
| **Sub-merchant** | A provider registered with the PSP so it can pay them directly. |
| **Ledger** | Append-only double-entry record of all money movement. |

---

## 8. When you MUST stop and ask the human

Do not guess on these. Stop, state the question (multiple choice, one recommended option), and wait.

- Something is **not in the brief**, or a decision has **no spec**.
- A value an action must produce, compute, or display has **no named source** (an input, a column, a
  derivation, or a prior spec).
- Two documents disagree and the precedence order in §0 does not settle it.
- Money, auth, or personal data is touched and the spec is silent on it.
- The same problem survives one corrective attempt: stop patching and run `/debug` from a reproduction.
- A task requires **holding user funds** in a platform account, or implementing **wallet top-up / stored balance**.
- A change would let a provider see **customer PII before unlock**, or see **another provider's data**.
- You need to **weaken, disable, or bypass an RLS policy** to make something work.
- A money operation cannot be made **idempotent or atomic** as specified.
- The **PSP does not support** a capability this document assumes (e.g. no hold/release API, no sub-merchant payouts).
- The target market (**Turkey vs Saudi Arabia**) affects the task and is not yet recorded in `progress-tracker.md`.
- A **legal, tax, KYC, or invoicing (ZATCA/e-fatura)** requirement is implicated.
- Anything in §5 would have to be violated.

---

## 9. Open decisions (owned by the human, not you)

Do not invent answers. If blocked, use the default and flag it in `progress-tracker.md`.

| # | Decision | Default until decided |
| --- | --- | --- |
| 1 | ~~Target market: Turkey or Saudi Arabia (or both)~~ | ✅ Both, one deployment (D14); Turkey launches first, KSA later (D22). Still never hardcode either |
| 2 | Unlock fee: flat amount or % band of price | Flat, admin-configurable |
| 3 | Hold period before auto-release | 72 hours |
| 4 | Unlock window before request reopens | 24 hours |
| 5 | Max applications per request | 10 |
| 6 | Is the unlock fee refunded if the customer cancels post-unlock? | Yes, refund to provider |
| 7 | Withdrawal minimum and payout schedule | PSP default |
| 8 | Unlock fee charged to card (A) or netted from payout (B) | A |

---

## 10. Reserved

_This number was vacated during an earlier revision. Kept as a placeholder so §11 onward keep their
numbers — cross-references throughout the docs cite these section numbers._

---

## 11. Pages

```
/                          → Landing page
/login                     → OTP auth (phone default)
/requests/new              → Customer: post a request
/requests                  → Customer: my requests list
/requests/[id]             → Customer: request detail + applicants + payment
/provider                  → Provider: dashboard
/provider/feed             → Provider: open requests — SHORT DETAILS ONLY
/provider/feed/[id]        → Provider: request detail + apply
/provider/applications     → Provider: my applications
/provider/jobs/[id]        → Provider: won job detail (post-unlock, full details)
/provider/earnings         → Provider: earnings + payouts
/provider/profile          → Provider: profile, zones, availability, documents
/admin                     → Admin: dashboard
/admin/catalog             → Admin: categories, services, addons, zones
/admin/pricing             → Admin: pricing rules
/admin/settings            → Admin: fees, commission, hold window, unlock window
/admin/providers           → Admin: provider approval queue
/admin/requests            → Admin: request management
/admin/disputes            → Admin: dispute queue
/admin/reports             → Admin: reports
```

---

## 12. Navigation

Top navbar only. No sidebar. Full width layout on all pages. Nav items are **role-based** — a user only ever sees their own set.

```
Customer:   الطلبات (Requests)      طلب جديد (New Request)      حسابي (Account)
Provider:   الفرص (Feed)            طلباتي (Applications)       أرباحي (Earnings)     حسابي (Account)
Admin:      لوحة التحكم (Dashboard)  الطلبات (Requests)          النزاعات (Disputes)   الإعدادات (Settings)
```

- Active item: accent colour, weight 500
- Inactive item: muted colour, weight 500
- No underline — active state is colour change only
- Navbar is always surface background, full viewport width
- **RTL:** navbar flows right-to-left; the logo sits on the right

---

## 13. Core User Flow

### Landing

- Hero, how it works, service categories, footer
- Logged-in users → redirect to their role home
- Logged-out users → CTA to `/login`

### Onboarding

- User signs in via OTP (phone by default)
- Role chosen at first sign-up: customer or provider
- Provider → redirected to `/provider/profile` to complete registration; cannot apply to requests until admin-approved
- Customer → redirected to `/requests/new`

### Customer — post a request

- Selects category → service → size/rooms → addons → date/time → address
- **Price is computed server-side and displayed before confirmation**
- Confirms → request created with status `OPEN`
- Message shows: "تم نشر طلبك — سيصلك عروض من مقدمي الخدمة قريبًا"

### Provider — see and apply

- Feed lists open requests matching the provider's zones and availability
- **Each card shows short details only:** service, district, date/time, price. Never customer name, phone, or street address
- Provider opens a request → sees the same short details plus service notes
- Applies with a short message. **Applying is free**
- Message input warns before submit that contact info is not allowed
- If the message contains a phone, email, link, or handle → rejected with a clear reason
- Provider sees their own applications and their status in `/provider/applications`

### Customer — choose a provider

- Request detail lists all applicants: rating, jobs completed, message
- Customer picks one → that application becomes `SELECTED`, the rest `NOT_SELECTED` (12-value enum, UPPERCASE — `architecture.md` §13)
- Request status → `SELECTED`, `unlock_deadline` starts (default 24h)
- Chosen provider is notified

### Provider — unlock

- Chosen provider sees "You were selected" with the fixed unlock fee shown
- Pays the fee → confirmation dialog states the exact amount first
- On success → request status `UNLOCKED`, customer's full details revealed to the provider
- **Both parties may now contact each other directly. There is no masking**
- If the provider does not pay within the unlock window → request returns to `OPEN` and the customer may pick again

### Customer — pay

- After unlock, the customer pays the full price
- Commission is deducted to the platform; the remainder is **held at the PSP**
- Request status → `FUNDED`

### Service and completion

- Provider marks the job started → `IN_PROGRESS`
- Provider marks complete → `AWAITING_CONFIRMATION`, `release_deadline` set (default 72h)
- Then exactly one of:
  - Customer confirms → funds released
  - Deadline passes with no action → **auto-release**
  - Customer disputes before the deadline → release suspended, admin resolves

### Rating

- After release, the customer is invited to rate
- **Optional. Never blocks payment.** Skipping it changes nothing about the money

### Provider — earnings

- Earnings screen shows pending / available / paid out
- **Read-only mirror of the ledger. There is no top-up and no stored balance**
- Provider requests a withdrawal of available balance → payout via PSP

### Admin

- Approves or rejects providers after reviewing documents
- Manages catalog, pricing rules, fees, commission, and the two windows
- Resolves disputes: full release, partial release, or refund
- Views reports and the leakage watchlist

---

## 14. Data Architecture

### Request data
- Lives in `requests`
- Created by the customer; `fixed_price` and `commission_amount` are written **server-side only**
- Status transitions are performed only by server code, never by a client write

### PII (customer contact + exact address)
- Lives in `profiles` and `addresses`
- **Visible to a provider only when a paid `unlock_fees` row exists for that request and provider**
- Enforced by RLS, not by the UI

### Money data
- `ledger_entries` is the source of truth. Append-only
- `provider_balances` is a projection, updated in the same transaction as the ledger
- `escrows` mirrors funds held at the PSP. The PSP holds the money; we hold the record
- **No agent, job, or admin action ever edits a ledger row**

### Application data
- Lives in `applications`
- A provider can read only their own applications, never a rival's
- Message text is validated server-side before insert

---

## 15. Features In Scope

- Landing page with hero, how it works, categories, footer
- Role-based top navbar — customer, provider, admin
- OTP authentication (phone default, email fallback via adapter)
- Three role-based apps in one codebase
- Provider registration, document upload, admin approval
- Provider zones and availability
- Admin catalog management — categories, services, addons, zones
- Admin pricing rules and server-side pricing engine
- Admin settings — commission %, unlock fee, hold period, unlock window, applicant cap
- Customer request posting with server-computed fixed price
- Provider feed with short details only
- Free applications with contact-info rejection
- Applicant comparison and provider selection
- Fixed unlock fee charged to the chosen provider only
- Reveal of customer details after unlock
- Customer payment with commission split and escrow hold
- Completion, customer confirmation, and timed auto-release
- Disputes with admin resolution — full, partial, or refund
- Provider earnings view and payout requests
- Optional post-release ratings
- Notifications on key events
- Admin dispute queue, request management, reports
- Leakage monitoring — unlocks vs completions
- Append-only audit log
- Three-locale UI throughout (`ar` RTL, `tr` LTR, `en` LTR) with a locale switcher
- Localised admin-authored content — category, service, addon, zone, and question labels per locale
- **Two regions (TR / KSA) in one deployment**, separated by a `region` column (D14). An account
  belongs to exactly one region; a person operating in both markets creates a second account

## 16. Features Out of Scope

- Native mobile apps
- Number masking / in-app chat between customer and provider
- **Wallet top-up or any stored, pre-loadable balance**
- Multi-currency or currency conversion
- Automatic provider assignment (fastest / nearest / highest-rated)
- Scheduled or recurring bookings
- Cash on delivery
- **Satisfaction guarantee or re-do policy** — dropped by D17. Escrow, vetting, and ratings carry the
  trust burden; disputes handle disagreement. A guarantee of the outcome is a principal's obligation
  and contradicts the agent position (D12)
- Provider-set pricing or negotiation
- Subscriptions or provider membership tiers
- Referral or loyalty programmes
- Email marketing
- Public provider profiles or SEO landing pages per provider
- Team or multi-user accounts
- Browser extension
- AI features of any kind

---

## 17. Event Names

Fired for analytics and the audit log. These are the only events. Do not invent new ones without adding them here first.

```typescript
request_posted;        // { userId, requestId, serviceId, zoneId, price }
application_submitted; // { userId, requestId, providerId }
provider_chosen;       // { userId, requestId, providerId }
unlock_paid;           // { providerId, requestId, amount }
request_funded;        // { userId, requestId, amount, commission }
funds_released;        // { requestId, providerId, amount, trigger: 'confirmed' | 'auto' | 'dispute' }
dispute_opened;        // { userId, requestId }
payout_requested;      // { providerId, amount }
```

---

## 18. Target Users

**Customer** — a household decision-maker, usually on a phone, arriving from a WhatsApp link. Wants a fixed transparent price, a trustworthy provider, and no haggling.

**Provider** — a cleaning professional working across a few districts. Not highly technical. Wants relevant nearby jobs, clear earnings, and to pay only for work actually won.

**Admin** — the operator replacing manual WhatsApp coordination. Wants central control over pricing and fees, provider approval, dispute resolution, and visibility of revenue.

---

## 19. Success Criteria

- A customer can post a request and see a price in under 2 minutes
- A provider sees a matching request and can apply in under 1 minute
- A provider can never see customer contact or street address before the unlock fee is paid — proven by an RLS test, not by inspection
- The unlock fee is charged exactly once per selection, even under retries
- Held funds are released, refunded, or split **exactly once** in every path, including a dispute racing auto-release
- `held = released + refunded + remaining` holds across all escrows at all times
- No provider balance can go negative under concurrent operations
- The ledger reconciles against the PSP settlement report with zero unexplained drift
- Every screen is correct in RTL Arabic
- The platform holds no user funds at any point

---

## 20. Dynamic Questions and Pricing (added)

The catalog is **fully admin-configurable**. Adding a new service category, its questions, and its pricing must require **zero code changes**.

```
Category  →  has Questions  →  Customer answers  →  Formula reads answers  →  FIXED PRICE
```

### What the admin can manage

| Area | Admin can |
| --- | --- |
| Categories | Add, edit, reorder, deactivate |
| Services | Add, edit, deactivate, assign to a category |
| **Questions** | Add, edit, reorder, deactivate — **per category**, with per-service overrides |
| Question types | number, single-select, multi-select, boolean, text, textarea, date, time |
| Options | Add/edit the choices for select questions |
| Validation | Required, min, max, step, max length |
| **Pricing formula** | Base price + ordered modifiers reading the answers |
| Modifier effects | Fixed amount, per-unit amount, or multiplier |
| Addons | Add, edit, price |
| Zones | Add, edit, zone price multiplier |
| Fees | Commission %, unlock fee, hold period, unlock window, applicant cap |

### Example — a "Home Cleaning" category

Questions: `rooms` (number), `bathrooms` (number), `property_type` (single-select: apartment / villa), `has_pets` (boolean), `notes` (textarea — never affects price).

Formula: base price, `+ per-unit` on `rooms`, `+ per-unit` on `bathrooms`, `× multiplier` when `property_type = villa`, `+ fixed` when `has_pets = true`, then addons, then the zone multiplier, then **round once**.

### Rules that protect this system

- **Questions have a stable `key` that is never renamed** — stored answers and formula modifiers reference it
- Questions are **deactivated, never deleted**, so historical answers stay readable
- Every request stores a **snapshot** of the questions and the pricing breakdown used
- **Editing a formula never re-prices an existing request**
- Text and textarea answers can **never** affect price
- ⛔ **The formula is structured data, never an expression the admin writes. Nothing admin-authored is ever executed as code**
- The price is always computed **server-side** from the answers; the client sends answers, never a price

---

# ⚠️ v3 CORRECTIONS — SUPERSEDES EARLIER SECTIONS

> These corrections **override** §3, §4, §6 and §17 above wherever they conflict. Read this before implementing anything.

## 21. Corrected transaction order (IMPORTANT)

The customer pays **before** the provider pays the unlock fee. Earlier text had this reversed.

```
1.  Customer posts request (fixed price computed server-side from answers)
2.  Providers see SHORT DETAILS ONLY
3.  Providers APPLY FREE with a message
    → 📧 CUSTOMER IS NOTIFIED of each application (in-app + email)
4.  Customer reviews applicants and CHOOSES ONE
    → 📧 CHOSEN PROVIDER IS NOTIFIED (in-app + email)
5.  ⭐ CUSTOMER PAYS THE FULL PRICE
    → commission to platform, remainder HELD in escrow at the PSP
6.  ⭐ CHOSEN PROVIDER PAYS THE FIXED UNLOCK FEE
    → only now are the customer's full details revealed
7.  Provider starts on the agreed start date → IN_PROGRESS
8.  Provider marks complete on/near the completion date
9.  Customer confirms, or auto-release after the hold period, or disputes
10. Funds released to the provider's earnings
11. Optional rating (never gates payment)
```

**Why this order:** the provider only risks the unlock fee once the customer's money is already secured. It also stops a customer choosing a provider and then vanishing.

### Corrected request state machine

```
OPEN → SELECTED → FUNDED → UNLOCKED → IN_PROGRESS → AWAITING_CONFIRMATION → RELEASED
```

| State | Meaning |
| --- | --- |
| `OPEN` | Posted; providers may apply |
| `SELECTED` | Customer chose a provider; **awaiting customer payment** |
| `FUNDED` | Customer paid; commission taken, remainder held; **awaiting provider unlock** |
| `UNLOCKED` | Provider paid the fee; **customer details revealed**; both may contact |
| `IN_PROGRESS` | Provider started |
| `AWAITING_CONFIRMATION` | Provider marked complete; release deadline running |
| `RELEASED` | Funds moved to the provider |

Branches:
- `SELECTED → OPEN` — customer does not pay within the payment window; applicants restored
- `FUNDED → OPEN` — **provider fails to pay the unlock fee within the unlock window. Funds STAY HELD; the customer picks another applicant without paying again**
- `FUNDED/UNLOCKED → CANCELLED` → refund per policy
- **`UNLOCKED | IN_PROGRESS | AWAITING_CONFIRMATION → DISPUTED → RELEASED | REFUNDED | PARTIALLY_RELEASED`** — widened by G1 so a customer can act on a provider who unlocked and then stopped

> **Edge case that must be handled:** money is held from `FUNDED` onward. If no provider ever unlocks and the request is cancelled or expires, the held amount is **refunded to the customer in full**, and the platform's commission is reversed with a compensating ledger entry.

## 22. Application status lifecycle

`applications.status` mirrors the request lifecycle so a provider can see exactly where each application stands.

| Status | Meaning | Set when |
| --- | --- | --- |
| `APPLIED` | Waiting for the customer to choose | Provider applies |
| `SELECTED` | Chosen — waiting for the customer to pay | Customer chooses |
| `AWAITING_UNLOCK` | Customer paid — **provider must pay the unlock fee** | Request becomes `FUNDED` |
| `UNLOCKED` | Fee paid, details revealed | Provider pays |
| `STARTED` | Work underway | Provider starts |
| `COMPLETED` | Provider marked complete | Provider completes |
| `RELEASED` | Provider paid | Funds released |
| `RATED` | Customer left a rating | Rating submitted |
| `NOT_SELECTED` | Another provider was chosen | Customer chooses someone else |
| `WITHDRAWN` | Provider withdrew | Provider action, only while `APPLIED` |
| `EXPIRED` | Unlock window passed without payment | Unlock expiry job |
| `CANCELLED` | Request cancelled | Cancellation |

## 23. Request dates

Every request carries explicit start and completion dates — not one vague timestamp.

| Field | Meaning |
| --- | --- |
| `scheduled_start_at` | Agreed start date/time — **chosen by the customer at posting** |
| `scheduled_end_at` | Expected completion date/time (from the service's estimated duration, adjustable) |
| `actual_started_at` | Set when the provider starts |
| `actual_completed_at` | Set when the provider marks complete |

Rules: `scheduled_start_at` must be in the future at posting; `scheduled_end_at` after `scheduled_start_at`; the release deadline is computed from `actual_completed_at`, not the scheduled date; providers see the scheduled dates in short details (they need them to decide whether to apply).

## 24. Notifications matrix

Every notification goes to **both the in-app notification centre and email**. WhatsApp/SMS is used where configured.

| # | Event | Recipient | In-app | Email |
| --- | --- | --- | --- | --- |
| 1 | New request matches your zones | Provider | ✅ | ✅ |
| 2 | **A provider applied to your request** | **Customer** | ✅ | ✅ |
| 3 | **You were chosen — awaiting customer payment** | **Provider** | ✅ | ✅ |
| 4 | Payment received — provider must unlock | Customer | ✅ | ✅ |
| 5 | **Customer paid — pay the unlock fee to see details** | **Provider** | ✅ | ✅ |
| 6 | Unlock window closing soon | Provider | ✅ | ✅ |
| 7 | Provider unlocked — here are their contact details | Customer | ✅ | ✅ |
| 8 | Details unlocked — here is the customer's contact | Provider | ✅ | ✅ |
| 9 | Work started | Customer | ✅ | ✅ |
| 10 | Work marked complete — please confirm | Customer | ✅ | ✅ |
| 11 | Auto-release approaching | Customer | ✅ | ✅ |
| 12 | Funds released to your earnings | Provider | ✅ | ✅ |
| 13 | Please rate your provider | Customer | ✅ | ✅ |
| 14 | You received a rating | Provider | ✅ | ✅ |
| 15 | Dispute opened | Provider + Admin | ✅ | ✅ |
| 16 | Dispute resolved | Both | ✅ | ✅ |
| 17 | Request cancelled | Affected party | ✅ | ✅ |
| 18 | Your account was approved / rejected | Provider | ✅ | ✅ |
| 19 | Payout sent | Provider | ✅ | ✅ |

**In-app notification centre:** bell icon in the navbar with an unread count, a dropdown of recent items, and a full `/notifications` page. Each item links to the relevant request. Marked read on click.

## 25. Provider profile and verification

### Registration → verification → active

1. Provider signs up and completes their profile
2. Uploads required documents
3. Status `PENDING` — **cannot apply to any request**
4. Admin reviews and approves or rejects (with a reason)
5. `APPROVED` → can apply; PSP sub-merchant onboarding runs

### Profile fields

| Field | Shown to customers | Notes |
| --- | --- | --- |
| `display_name` | ✅ | |
| `photo_url` | ✅ | Private bucket, signed URL |
| `bio` | ✅ | Short Arabic description |
| `years_experience` | ✅ | |
| `skills` | ✅ | Tags |
| `languages` | ✅ | |
| `service_ids` | ✅ | Services offered |
| `work_addresses` | Partially | **District shown; full address never shown** |
| `zones` | ✅ | Districts served |
| `availability` | ✅ | Weekly schedule |
| `rating_avg` | ✅ | |
| `jobs_completed` | ✅ | |
| `member_since` | ✅ | |
| `verified_badge` | ✅ | True when approved |
| `phone`, `email` | ⛔ **Only after unlock** | Gated by RLS |
| Documents | ⛔ Admin only | Never customer-visible |

### Required documents

| Document | Required |
| --- | --- |
| National ID / residence permit | ✅ |
| Selfie holding ID (liveness) | ✅ |
| Skill certificate | Optional |
| Criminal record certificate | Configurable by admin |
| IBAN / bank details | ✅ before payout (via PSP) |

Documents live in a **private** bucket, are readable only by the owning provider and admins, and are served via short-lived signed URLs. Each has `status` (`pending`/`approved`/`rejected`) and a rejection reason.

> **What the customer sees when choosing:** display name, photo, bio, years of experience, skills, rating, jobs completed, verified badge, and the application message. **Never** phone, email, or full address before unlock.

---

# v4 — TRUST, QUALITY & REPUTATION MIGRATION

> Adds the quality system. Also **corrects one v2/v3 inconsistency**: at `UNLOCKED` the reveal is **mutual** — the provider gets the customer's contact and exact address, and the customer gets the provider's contact. Both need it to coordinate. Earlier text saying only one direction is superseded.

## 26. Why this exists

The platform tells customers its providers are exceptional, and customers **cannot chat before choosing**. Every selection decision rests on profile, rating, bio, and structured application answers. So the quality signal must be real, measurable, and defensible — not a marketing claim.

> ⚠️ **Never ship an unsubstantiated superiority claim** ("top 1%", "the best in the country"). Unsubstantiated comparative advertising is a consumer-protection exposure in both target markets. Claims must be backed by a measurable, published criterion — e.g. an acceptance rate the system actually computes, or "every provider is ID-verified and background-checked."

## 27. Reputation migration (one-time, launch only)

The business already has trusted providers and ~500 customers. That reputation exists in WhatsApp history, not in the database. Migrating it is a **one-time window** — if skipped, day one looks like an empty marketplace.

### Legacy data is separate from platform data — always

| Field | Meaning | Rule |
| --- | --- | --- |
| `legacy_jobs_completed` | Jobs done before the platform | Admin-imported. **Never merged** into platform counts |
| `legacy_note` | Provenance, e.g. "migrated from WhatsApp, Jan 2026" | Required on import |
| `jobs_completed` | Jobs completed **on the platform** | **Derived** from released requests. Never editable |
| `rating_avg` | Platform rating | **Derived** from ratings. Never editable |
| `is_founding_provider` | Verified pre-platform history | Admin-granted, audit-logged |

**Display rule:** shown separately and labelled — *"١٢٠ خدمة قبل الانضمام · ٨ خدمات على المنصة"*. Never a single blended number. Blending legacy into platform figures is **fabrication** and is forbidden.

### Seeded ratings

- Admin generates **one-time rating invitation links** for past customers, tied to a provider and a described past job.
- The past customer submits the rating themselves. **The admin never submits a rating on anyone's behalf.**
- Seeded ratings are stored with `source = 'migrated'` and are visibly distinguishable in the provider's rating history.
- Invitation links are single-use and expiring.

## 28. Ratings — how they are computed

Naive averages break at low volume: one 5.0 would outrank fifty 4.8s.

- **Bayesian shrinkage** toward the platform mean until a provider has enough ratings.
- **No average is shown below 5 ratings** — show a `NEW` badge instead.
- **Recency weighting** so old reputation doesn't shield current decline.
- **Always show the count** beside the average.
- **Dimension ratings**, not one blended star: punctuality, quality of work, professionalism, value.
- **Only a released (paid and completed) request can be rated.** This is a genuine advantage over open review sites — say so publicly.
- Ratings are **immutable** once submitted. An admin may **hide** one with a recorded reason (audited); nobody may edit the number.

## 29. Provider quality metrics (derived, never editable)

Shown on the profile so customers can judge without chatting:

| Metric | Derivation |
| --- | --- |
| Completion rate | completed ÷ unlocked |
| On-time rate | actual start ≤ scheduled start |
| Cancellation rate | provider-caused cancellations ÷ unlocked |
| Dispute rate | disputes ÷ completed |
| Repeat-customer rate | customers with more than one released request |
| Avg. response time | application submitted − request posted |
| Unlock follow-through | unlocked ÷ selected — **a leakage signal** |

## 30. Vetting funnel (makes the quality claim provable)

```
APPLIED → DOCUMENTS_SUBMITTED → DOCUMENTS_VERIFIED → BACKGROUND_CHECKED
        → ASSESSED → PROBATION → ACTIVE
                   ↘ REJECTED (with reason)   ↘ SUSPENDED
```

- `PROBATION` — first N jobs monitored more tightly; tighter thresholds.
- The platform **computes and stores the acceptance rate** (accepted ÷ applied). Any public quality claim must be derived from this real figure.
- Rejection always carries a reason; the criteria are published.

## 31. Quality floor (the claim stays true only if people are removed)

- Minimum rating threshold → automatic warning → suspension.
- Dispute rate and cancellation rate monitored **separately** from rating.
- Documents have expiry dates; re-verification is required.
- Admin can suspend with a reason; suspended providers cannot apply.

## 32. Structured application answers (replaces free text)

Because there is no chat, the application must carry real signal. Admin-configurable per category, same engine as the request questions:

- "How will you approach this job?"
- "What is included in your price?"
- "When exactly can you start?"

Contact-info scanning applies to every free-text answer, as before.

## 33. Cold-start protection

Rating-based selection creates a rich-get-richer loop that starves new supply. Mitigate with: a `NEW — vetted` badge, a temporary visibility boost for a provider's first few requests, and the probation period.

## 34. Trust mechanism — escrow, not a guarantee

> ⚠️ **Changed 2026-08-17 (D17).** This section previously promised a *satisfaction guarantee and
> re-do policy*. **That is dropped.** Combined with server-side pricing and controlled matching, a
> guarantee of the outcome is the standard checklist for being treated as the **principal** in a
> transaction — which directly contradicts D12 (we act as an agent) and would put VAT on the full job
> price rather than on our fees. See G21.

The customer cannot verify quality before choosing. Three things carry that risk, and none of them is
a promise about the work itself:

1. **Escrow.** Money is not released until the customer confirms or the hold window passes. This is
   the strongest mechanism in the product and it is real, not a claim. **Market it plainly: "You
   don't pay until the job is done."** That statement is factually true and carries no principal risk.
2. **Vetting.** Every provider is ID-verified and background-checked through the funnel in §30, and
   the platform computes a real acceptance rate. Any public quality claim derives from that figure
   (§26) — never from an unsubstantiated superlative.
3. **Ratings.** Only a released request can be rated (§28), which is a genuine advantage over open
   review sites and is worth saying so.

### Disputes are not a guarantee — keep the distinction

Dropping the guarantee does **not** leave customers unprotected. A customer may still open a dispute
(now reachable from `UNLOCKED`, `IN_PROGRESS`, and `AWAITING_CONFIRMATION` — see §4), and an admin
resolves it as full release, partial release, or refund.

The difference is precise and matters legally:

| | |
| --- | --- |
| **A guarantee** | We promise the work will be satisfactory, and we make it right — by re-performing or procuring a replacement. That is a **principal's** obligation |
| **A dispute process** | We hold the money, and if the parties disagree we decide where it goes. That is an **intermediary's** function |

We do the second. Never write copy — in the product, the T&C, or marketing — that promises the first.
Any goodwill payment made outside a dispute outcome comes from **our commission**, never from the job
price, and is recorded as such.

> **Trade accepted:** this is a weaker customer proposition than a guarantee. It is the price of the
> agent position (D12), which keeps the job price off our books and shrinks e-invoicing to our own
> fees. If B9 comes back saying we are a principal anyway, revisit this section — the reason for the
> constraint would be gone.

## 35. Admin capabilities and limits (summary)

**Admin CAN:** import legacy job counts (flagged), issue rating-invitation links, grant Founding Provider, edit bio/skills/experience with a provenance flag, verify/reject documents with reasons, move providers through the vetting funnel, suspend with a reason, hide a rating with a recorded reason, configure thresholds and guarantee policy.

**Admin CANNOT:** set or edit `rating_avg` or `jobs_completed` (derived), submit a rating on behalf of a customer, delete a rating, merge legacy counts into platform counts, or make any of the above changes without an audit-log entry.

---

# v6 — CANCELLATION POLICY

> Closes gap G7. Earlier documents said only *"refund per policy"* and never wrote the policy.
> Cancellation is not an edge case — after completion it is the most common outcome in any services
> marketplace, and it is the one users complain about publicly. All thresholds live in
> `platform_settings`; the values below are seed defaults (D13).

## 36. Who may cancel, when, and what happens

`T` = hours until `scheduled_start_at` at the moment of cancellation. Cutoff default: **24h**.

| # | State | Who cancels | Held funds | Commission | Unlock fee | Counts against |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `OPEN` | Customer | none held | — | — | nobody |
| 2 | `SELECTED` | Customer | none held | — | not yet charged | nobody |
| 3 | `SELECTED` | Provider withdraws | none held | — | not yet charged | provider cancellation rate |
| 4 | `FUNDED` (no unlock yet) | Customer | **full refund** | reversed | not yet charged | nobody |
| 5 | `FUNDED` | Unlock window expires | **stays held** — request returns to `OPEN` | untouched | — | provider (unlock follow-through) |
| 6 | `FUNDED` | 3rd re-selection fails (G2) | **full refund** | reversed | — | nobody |
| 7 | `UNLOCKED` / `IN_PROGRESS`, `T ≥ 24h` | Customer | **full refund** | reversed | **refunded** to provider | nobody |
| 8 | `UNLOCKED` / `IN_PROGRESS`, `T < 24h` | Customer | refund **minus late-cancellation fee** | reversed | **refunded** | customer late-cancel rate |
| 9 | `UNLOCKED` / `IN_PROGRESS` | Provider | **full refund** | reversed | **not refunded** | provider cancellation rate |
| 10 | `UNLOCKED` / `IN_PROGRESS` | Provider no-show (deadline expired, G1) | **full refund** | reversed | **not refunded** | provider cancellation + no-show rate |
| 11 | any funded state | Admin (dispute or ops) | per resolution: full / partial / refund | reversed proportionally | admin decides, with reason | per admin attribution |
| 12 | `AWAITING_CONFIRMATION` onward | — | ⛔ **not cancellable** — this is a dispute, not a cancellation | | | |

**Late-cancellation fee** (row 8): default **0** at launch. The column exists so the mechanism is
built and can be switched on without a migration. When non-zero it is paid to the provider as
compensation for a held slot, and posted as its own ledger leg — never netted.

### The rules behind the table

1. **The unlock fee is refunded on any customer-initiated cancellation before the work starts**
   (rows 1–8), and **never when the provider caused the cancellation** (rows 9, 10). That split is the
   whole point: refunding a provider who induced a cancellation would make customer contact details
   free, which is the abuse path G4 identified.
   **A late customer cancellation is compensated by the late-cancellation fee, not by keeping the
   unlock fee.** Two separate mechanisms — one prices the PII, the other prices the lost slot.
   Conflating them punishes the provider for the customer's timing.
2. **Commission follows the money.** Any refund of held funds reverses the commission with a
   compensating ledger entry. Never edit the original posting.
3. **The PSP's processing fee is not recovered** on a refund — the platform absorbs it (D13). It is
   posted to `expense:psp_fees` regardless of outcome.
4. **Every cancellation is attributed** to customer, provider, or platform, and feeds
   `provider_metrics` / customer-side counters. An unattributed cancellation is a bug — the metrics
   in §29 depend on it.
5. **Cancellation is not dispute.** Once the provider marks the work complete, the path is
   `AWAITING_CONFIRMATION → DISPUTED`, resolved by an admin. Row 12 exists to stop anyone adding a
   cancel button there.
6. **Every path still terminates in exactly one of released / refunded / partially released.** The
   invariant from `architecture.md` §21 is unchanged; this table enumerates the refund branches it
   always implied.

### Implementation notes

- One Server Action, `cancelRequest`, resolves `(actor, state, T)` → an outcome from this table. **The
  table is data, not branching logic scattered across handlers** — the same reasoning as pricing
  modifiers.
- The outcome is computed **server-side**; the client never sends a refund amount.
- Refunds go through the outbox like every other PSP effect (`architecture.md` §27).
- The confirmation dialog states the exact refund amount and any fee **before** the customer confirms
  (`ui-rules.md` §5).
- Tests: one per row, plus a property test asserting `held = released + refunded + remaining` after
  randomised cancellation sequences.
