# Project Overview

v7, 2026-10-30: the money model changed to cash, no escrow (D87 to D95). §1 to §7, §9, §11 to §17, §19,
§21, §22, §24, §34 and §36 are rewritten for it. v3, 2026-10-17: §0 doc map and precedence rewritten for
the playbook layout; §5 became the canonical text of the rules that never bend.

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

1. **Commission**: a percentage of the job price, paid online by the customer after choosing a provider. It is part of the price, not on top: on a 7000 job at 10%, the customer pays 700 online and 6300 in cash, 7000 in total.
2. **Provider fee**: paid online by the chosen provider to take the request and reach the customer. A fixed amount or a percent of the job price, whichever admin sets for the region.

Both payments mark both sides as responsible and serious. **The job price never passes through the platform:** the customer pays the provider in cash, in person, after the service, and the platform is not responsible if the customer does not pay (D87).

The business currently runs manually in a WhatsApp group of 400+ members. This platform replaces that.

**This release ships:** responsive web app (customer + provider + admin), in **three languages —
Arabic (RTL), Turkish, English** — built for **Turkey** and **Saudi Arabia** from **one deployment**,
separated by a `region` column (D14). See [`i18n.md`](i18n.md).
**Not in this release:** native mobile apps, multi-city expansion, AI features.

**Launch: 2026-11-20, Turkey only (D22; date D94).** Standard iyzico checkout takes the two fees (D93). KSA stays in
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
| **Customer** | Posts a service request, chooses a provider, pays the commission online, pays the provider in cash after the service, confirms completion, rates. |
| **Provider** | Applies to requests, pays the provider fee when chosen, performs the service, collects the cash. |
| **Admin** | Sets pricing formulas, commission and fees. Approves providers. Handles problem reports. Can refund a fee by hand with a recorded reason. |
| **PSP** | External licensed payment service provider. Takes the platform's two fees, nothing else. Never sees the cash. See §6. |

---

## 3. The transaction flow

⛔ The old flow that stood here (escrow, then unlock) is gone (D87). The one flow is
[§21](#21-corrected-transaction-order-important). The number stays so cross references keep working.

### Why the design is this way (do not "improve" these)

| Rule | Reason |
| --- | --- |
| Applying is free; only the chosen provider pays | Competitors charge for shared leads that never convert. Charging only on won work is our differentiator. |
| Both sides pay before either sees a contact | Each payment marks its side as serious, and neither side can go around their fee (D89). |
| The job price is cash, outside the platform | The platform never holds job money, so it carries no custody risk and no payment dispute (D87). |
| Rating never gates anything | Otherwise providers pressure customers for good ratings, and ratings become worthless. |
| No number masking | The model deliberately reveals contact. Leakage is handled economically: both fees are already paid. |
| Price is computed server-side, always | The client is hostile. A client-supplied price is always ignored. |

---

## 4. Request state machine

The canonical states. Do not invent new ones without updating this file.

```
OPEN → SELECTED → COMMISSION_PAID → UNLOCKED → IN_PROGRESS → AWAITING_CONFIRMATION → COMPLETED
```

Per-state meanings are in [§21](#21-corrected-transaction-order-important).

Branches:
- `OPEN → CANCELLED` (customer cancels or request expires)
- `SELECTED → OPEN` (customer does not pay within the payment window, or the chosen provider withdraws; applicants restored)
- `SELECTED → CANCELLED` (customer cancels)
- **`COMMISSION_PAID → OPEN`** (chosen provider misses the pay window or withdraws, that application → `EXPIRED` or `WITHDRAWN`). **The commission stays paid:** the customer's next pick goes straight back to `COMMISSION_PAID` with no new payment. After 3 failed picks, or when no applicant is left, the commission is refunded and the request → `CANCELLED`
- `COMMISSION_PAID → CANCELLED` (customer cancels; the commission is refunded automatically)
- `UNLOCKED | IN_PROGRESS → CANCELLED` (either side cancels; no automatic refund, §36)
- `UNLOCKED` and `IN_PROGRESS` also pass `start_deadline` / `completion_deadline` (G1): this flags the request for admin, and nothing moves by itself, since the work may be underway offline
- `AWAITING_CONFIRMATION → COMPLETED` (customer confirms, or the confirm window passes)

Terminal states: `COMPLETED`, `CANCELLED`. A problem report (D92) is not a state: it never moves a request.

---

## 5. Rules that never bend

**Canonical text** (v3, 2026-10-17, D33). These are correctness requirements, not preferences: a change
that breaks one is a bug even when every test passes, and most break **silently**, with a leak or lost
money instead of an error. Each rule names the layer that enforces it, lowest first. Refer to them by
number everywhere ("rule 3"); `AGENTS.md` carries a one line summary and this text wins.

1. **Price, commission, and fees are computed on the server.** The client sends answers, never a price.
   The job price is computed **inside Postgres** by `quote_price`, from structured formula rows and the
   caller's answers; no function a customer or provider can run takes an amount (D121, spec 0007). The
   commission and the cash due are split inside Postgres too, by `pricing_split`, and stored with the price
   at publish (D139). The one named exemption: `create_request` takes the two figures the customer saw,
   compares them and never stores them (D140, spec 0008).
   `lib/pricing/` (server only) is the app's thin door to it, and 04's `create_request` calls `quote_price`
   in its own transaction, so no caller can hand a price in. The request stores `pricing_snapshot`.
   Enforced by the function signatures, a pgTAP meta test on every function an API role can run, and a
   tamper test with a real token. *Why:* §1, §20; a tampered price loses money on every job.
2. **Contact details are visible only after both sides have paid, and no provider ever reads another
   provider's data.** RLS on the PII tables requires a `paid` commission and a `paid` provider fee for
   that `(request, provider)`; request status `COMMISSION_PAID` is **not** sufficient. The reveal is
   mutual (§25): the provider gets the customer's contact and exact address, the customer gets the
   provider's contact. A provider can never read another provider's application or fee history.
   Enforced by RLS with negative pgTAP tests, never by hiding a field in React. *Why:* §14, §21; the
   reveal is what both fees buy.
3. **No external call in a request path; money state changes only on verified PSP facts.** Money flow
   is DB transaction → `outbox_events` → relay worker → PSP; the relay is the only mutating caller of
   `lib/psp`. A payment or refund is recorded only from a verified callback or a server to server
   lookup, never from a browser redirect. Enforced by lint (single door), the write guard, CI,
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
   together or not at all; a fee is charged at most once per `(request, provider, kind)` and refunded at
   most once; amounts are computed once on the server and stored, never recomputed. Enforced by the
   posting function, constraints, property and race tests. *Why:* §6, D20; a double charge or a lost fee
   is real money.
7. **RLS enabled + policy written + negative test proving the wrong user is denied, in the same
   migration and commit as the table.** Default deny; each position adds only its own write path; meta
   pgTAP tests enumerate every table and function so a new one cannot slip past. *Why:* a missing
   policy throws no error, it just leaks.
8. **Never execute an admin authored string.** No `eval`, `new Function`, or dynamic import of admin
   input. Pricing formulas are structured rows interpreted by our own code. Enforced by the write guard
   and lint. *Why:* D10; an admin account is not a code execution boundary.
9. **The platform never holds or moves job money.** The job price passes in cash from customer to
   provider, outside the platform. The gateway takes only the platform's own two fees (standard iyzico
   checkout in Turkey, D93); our database is a ledger of those fees. No wallet top up, no stored balance;
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

## 6. Money custody: read carefully

> **The platform never holds, touches, or controls job money (D87).**

Holding customer money in escrow, or holding stored balances in provider wallets, is exactly what causes a platform to be classified as a **regulated money transmitter / e-money issuer**. That would require a licence we do not have.

| Money (a 7000 job at 10%) | Who pays | Who receives | How |
| --- | --- | --- | --- |
| Commission, 700 | Customer | Platform | Online, hosted card page, after choosing a provider |
| Provider fee | Chosen provider | Platform | Online, hosted card page, within the pay window |
| Cash due, 6300 | Customer | Provider | **Cash, in person, after the service. Outside the platform** |

**Therefore:**

- The gateway only ever moves money **to the platform**. There is no escrow, no hold, no release, no payout, no sub-merchant, no provider balance.
- **The platform is not responsible if the customer does not pay the provider**, and the terms say so plainly (B2, S16). The agreement statement (D92) covers legal action against a party that does wrong.
- The two fees are the platform's own revenue, not user funds. A fee that goes back is a **refund of a fee** (§36), never a release of held money.
- Our database stores a ledger of those fees. It records our revenue; it records nothing about the cash.
- Standard iyzico checkout in Turkey (D93); the Saudi PSP is chosen before the KSA launch (Q7). See `architecture.md` v7.

### No wallet

A provider's page is a read only **jobs and fees history** (D91): jobs taken, fees paid, the cash each job was worth. Nothing in it is a balance.

Each fee is charged **per payment** on a hosted card page, with no saved cards at launch (D93). Money state changes only on a verified PSP fact, and refunds go through `outbox_events` and the relay (`architecture.md` §27).

> ⛔ **A stored, pre-loadable balance (provider tops up, spends later) is NOT to be implemented.**
> It sits behind the feature flag `FEATURE_STORED_BALANCE_WALLET`, which is **OFF** and must remain off until written legal sign-off is recorded in `progress-tracker.md`. If a task asks you to build top-up, **STOP and ask** (see §8).

---

## 7. Glossary

| Term | Meaning |
| --- | --- |
| **Request** | A job posted by a customer. The central entity. (Not "order".) |
| **Application** | A provider's free bid on a request, with a message. |
| **Job price** | The fixed price the platform computes from the customer's answers. Commission plus cash due. |
| **Commission** | The platform's percentage of the job price, paid online by the customer after choosing a provider. Part of the price, not on top. |
| **Provider fee** | Paid online by the chosen provider to take the request and reach the customer. Fixed or a percent of the job price, per region (D88). |
| **Cash due** | The job price minus the commission: what the customer hands the provider in cash after the service. |
| **Reveal, unlock** | Both fees are paid, so each side sees the other's contact details. State `UNLOCKED`. |
| **Payment window** | Time the customer has to pay the commission after choosing (default 24h). |
| **Pay window** | Time a chosen provider has to pay the provider fee before the request reopens (default 24h). |
| **Confirm window** | Time after the provider marks a job done before it closes by itself (default 72h, admin-configurable). |
| **Short details** | The PII-free subset of a request that providers see before the reveal. |
| **Report** | A problem report from either side to admin (D92). Not a state of the request. |
| **Agreement statement** | The statement users accept that the platform may take legal action if one of the two parties does something wrong (D92). |
| **PSP** | Payment Service Provider: the licensed gateway that takes the platform's two fees. |
| **Ledger** | Append-only double-entry record of the platform's fees and refunds. |

---

## 8. When you MUST stop and ask the human

Do not guess on these. Stop, state the question (multiple choice, one recommended option), and wait.

- Something is **not in the brief**, or a decision has **no spec**.
- A value an action must produce, compute, or display has **no named source** (an input, a column, a
  derivation, or a prior spec).
- Two documents disagree and the precedence order in §0 does not settle it.
- Money, auth, or personal data is touched and the spec is silent on it.
- The same problem survives one corrective attempt: stop patching and run `/debug` from a reproduction.
- A task requires **taking or holding job money**, or implementing **wallet top-up / stored balance**.
- A change would let either side see the other's **contact details before both have paid**, or a provider see **another provider's data**.
- You need to **weaken, disable, or bypass an RLS policy** to make something work.
- A money operation cannot be made **idempotent or atomic** as specified.
- The **PSP does not support** a capability this document assumes (e.g. no hosted checkout, no refund API).
- The target market (**Turkey vs Saudi Arabia**) affects the task and is not yet recorded in `progress-tracker.md`.
- A **legal, tax, KYC, or invoicing (ZATCA/e-fatura)** requirement is implicated.
- Anything in §5 would have to be violated.

---

## 9. Open decisions (owned by the human, not you)

Do not invent answers. If blocked, use the default and flag it in `progress-tracker.md`.

| # | Decision | Default until decided |
| --- | --- | --- |
| 1 | ~~Target market: Turkey or Saudi Arabia (or both)~~ | ✅ Both, one deployment (D14); Turkey launches first, KSA later (D22). Still never hardcode either |
| 2 | ~~Provider fee: flat amount or percent~~ | ✅ Admin picks either, per region (D88) |
| 3 | Confirm window before a job closes by itself | 72 hours |
| 4 | Pay window before the request reopens | 24 hours |
| 5 | Max applications per request | 10 |
| 6 | ~~Are fees refunded after the reveal?~~ | ✅ Not automatically; admin by hand with a reason (D90) |
| 7 | Commission percent and provider fee values | From S17, per region |

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
/requests/[id]             → Customer: request detail + applicants + commission payment
/provider                  → Provider: dashboard
/provider/feed             → Provider: open requests — SHORT DETAILS ONLY
/provider/feed/[id]        → Provider: request detail + apply
/provider/applications     → Provider: my applications
/provider/jobs/[id]        → Provider: won job detail (post-unlock, full details)
/provider/history          → Provider: jobs and fees history (read only)
/provider/profile          → Provider: profile, zones, availability, documents
/admin                     → Admin: dashboard
/admin/catalog             → Admin: categories, services, addons, zones
/admin/pricing             → Admin: pricing rules
/admin/settings            → Admin: commission, provider fee, windows
/admin/providers           → Admin: provider approval queue
/admin/requests            → Admin: request management
/admin/problems            → Admin: problem report queue
/admin/reports             → Admin: reports
```

---

## 12. Navigation

Top navbar only. No sidebar. Full width layout on all pages. Nav items are **role-based** — a user only ever sees their own set.

```
Customer:   الطلبات (Requests)      طلب جديد (New Request)      حسابي (Account)
Provider:   الفرص (Feed)            طلباتي (Applications)       سجلّي (History)       حسابي (Account)
Admin:      لوحة التحكم (Dashboard)  الطلبات (Requests)          البلاغات (Reports)    الإعدادات (Settings)
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
- Logged-in users → redirect to their role home (through `/continue`, which also moves the URL to the language on their profile)
- Logged-out users → CTA to `/login`

### Onboarding

- User signs in with a phone and a 6 digit SMS code. There are no passwords on any account (D104)
- Role chosen at first sign-up: customer or provider. One phone holds one role, for good (D99)
- **Required tick:** the user accepts the terms and the agreement statement (D92). Stored with the terms version and date
- Provider → redirected to `/provider/profile` to complete registration (two steps: profile, then documents at `/provider/profile/documents`; services and districts come in 05, D111); cannot apply to requests until admin-approved
- Customer → redirected to `/requests/new`

### Customer — post a request

- Selects category → service → size/rooms → addons → date/time → address
- **Price is computed server-side and displayed before confirmation**
- Confirms → request created with status `OPEN`
- As built in 04 (spec 0008): one page, two steps (`/requests/new`, then review). The district is a chip; the
  street line goes to `request_addresses`, readable by its customer only. Days run from tomorrow to 14 days
  ahead, hours 08:00 to 18:00 in the region's time zone (settings). The price card shows the job price, the
  commission paid online after choosing a provider and the cash due to the provider after the service. At most
  5 live open requests per customer and 60 quotes an hour. `/requests` lists them (All, Active, Closed);
  `/requests/[id]` cancels while open and repeats with the same answers (D56)
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
- Customer picks one → that application becomes `SELECTED`, the rest `NOT_SELECTED` (UPPERCASE enum, §22)
- Request status → `SELECTED`, `payment_deadline` starts (default 24h)
- Chosen provider is notified

### Customer — pay the commission

- The page shows the split: job price, the commission to pay now, the cash due to the provider after the service
- A short reminder line with a link to the agreement statement sits above the payment button (D92)
- Customer pays on the hosted card page. On a verified payment → `COMMISSION_PAID`, `provider_pay_deadline` starts (default 24h)
- If the customer does not pay in time → back to `OPEN`, applicants restored

### Provider — pay the fee

- Chosen provider sees "You were selected", the exact fee, and the cash they will collect
- The same reminder line sits above the payment button
- A confirmation dialog states the exact amount first; the provider pays on the hosted card page
- On a verified payment → `UNLOCKED`, **each side sees the other's contact details**, and the provider gets the exact address
- **Both parties may now contact each other directly. There is no masking**
- If the provider does not pay in time → `OPEN`. The commission stays paid and the customer's next pick needs no new payment (max 3 failed picks, then a refund)

### Service and completion

- Provider marks the job started → `IN_PROGRESS`
- Provider marks it done → `AWAITING_CONFIRMATION`, `confirm_deadline` set (default 72h)
- **The customer pays the provider the cash due, in person.** The platform records nothing about the cash
- Customer confirms, or the deadline passes → `COMPLETED`. No money depends on this step

### Rating

- After `COMPLETED`, the customer is invited to rate
- **Optional.** Skipping it changes nothing

### Provider — jobs and fees history

- Read only: jobs taken, fees paid, the cash each job was worth
- **There is no balance, no withdrawal, and no top up**

### Report a problem

- Either side can report from the request after the reveal: no-show, cash not paid, bad work
- Admin reviews, can warn or suspend, and can refund a fee by hand with a recorded reason
- The platform makes no promise to collect the cash

### Admin

- Approves or rejects providers after reviewing documents
- Manages catalog, pricing rules, commission, provider fee, and the windows
- Handles problem reports
- Views reports and the leakage watchlist

---

## 14. Data Architecture

### Request data
- Lives in `requests`
- Created by the customer; `fixed_price`, `commission_amount` and `cash_due` are written **server-side only**
- Status transitions are performed only by server code, never by a client write

### PII (contact details + exact address)
- Lives in `profiles` and `addresses`
- **Visible to the other side only when both fees are `paid` for that request and provider**
- Enforced by RLS, not by the UI

### Money data
- `ledger_entries` is the source of truth for the platform's fees and refunds. Append-only
- Fee payment rows mirror the gateway: one per fee, with its kind, amount and status (position 07's spec names them)
- The cash is not recorded anywhere as money: `cash_due` is what the page shows, nothing confirms it was paid
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
- Admin settings — commission %, provider fee (fixed or %), the windows, applicant cap
- Customer request posting with server-computed fixed price
- Provider feed with short details only
- Free applications with contact-info rejection
- Applicant comparison and provider selection
- Commission paid online by the customer after choosing
- Provider fee paid online by the chosen provider only
- Mutual reveal of contact details once both have paid
- The split shown to both sides: commission now, cash due after the service
- Job tracking with no money attached: started, done, confirmed, timed auto close
- Fee refunds: automatic before the reveal, by admin with a recorded reason after it
- Report a problem, handled by admin
- Agreement statement: required tick at sign up, reminder above every payment button
- Provider jobs and fees history (read only)
- Optional ratings after completion
- Notifications on key events
- Admin problem report queue, request management, reports
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
- **Escrow, held funds, payouts, provider balances, sub-merchants** (D87)
- Taking the job price through the platform, or collecting or tracking the cash
- Multi-currency or currency conversion
- Automatic provider assignment (fastest / nearest / highest-rated)
- Scheduled or recurring bookings
- **Satisfaction guarantee or re-do policy** — dropped by D17. Both sides' fees, vetting, and ratings carry
  the trust burden; problem reports handle disagreement. A guarantee of the outcome is a principal's
  obligation and contradicts the agent position (D12)
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
commission_paid;       // { userId, requestId, amount }
provider_fee_paid;     // { providerId, requestId, amount }
fee_refunded;          // { requestId, kind: 'commission' | 'provider_fee', amount, trigger: 'no_provider' | 'customer_cancelled' | 'admin' }
job_completed;         // { requestId, providerId, trigger: 'confirmed' | 'auto' }
problem_reported;      // { userId, requestId }
```

Sign in, analytics only (spec 0005 AC-22, `lib/analytics/events.ts`). No phone, code, name or id, ever:

```typescript
code_requested;        // {}
code_verified;         // {}
code_limited;          // { limit: 'limit_phone' | 'limit_ip' | 'limit_sms_cap' | 'limit_sends' | 'limit_checks' }
phone_rejected;        // { reason: 'not_mobile' | 'too_short' | 'other_country' }
onboarding_completed;  // { role: 'customer' | 'provider' }
```

Provider onboarding, analytics only (spec 0006 AC-24). No name, phone, bio, tax number, file name or link:

```typescript
provider_file_submitted; // {}
provider_decided;        // { decision: 'approved' | 'rejected' }
document_upload_failed;  // { reason: 'too_large' | 'wrong_type' | 'refused' | 'network' }
```

---

## 18. Target Users

**Customer** — a household decision-maker, usually on a phone, arriving from a WhatsApp link. Wants a fixed transparent price, a trustworthy provider, and no haggling.

**Provider** — a cleaning professional working across a few districts. Not highly technical. Wants relevant nearby jobs, a clear history, and to pay only for work actually won.

**Admin** — the operator replacing manual WhatsApp coordination. Wants central control over pricing and fees, provider approval, handling problem reports, and visibility of revenue.

---

## 19. Success Criteria

- A customer can post a request and see a price in under 2 minutes
- A provider sees a matching request and can apply in under 1 minute
- Neither side can see the other's contact details before both fees are paid — proven by an RLS test, not by inspection
- Each fee is charged exactly once per selection, even under retries
- A fee is refunded at most once in every path, including a cancellation racing a pay window expiry
- A customer who paid never pays the commission twice for one request, however many picks fail
- The ledger reconciles against the PSP settlement report with zero unexplained drift
- Every screen is correct in RTL Arabic
- The platform never holds job money at any point

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
| Fees | Commission %, provider fee (fixed or %), payment, pay and confirm windows, applicant cap |

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
- The price is always computed **server-side** from the answers; the client sends answers, never a price.
  Since spec 0007 (D121) that is inside Postgres: `quote_price`, with exact `numeric` and one rounding

### What 03 leaves out (D123, the four cuts)

- **Dates and times never price.** A date or time answer cannot move the price, so a weekend surcharge cannot be expressed yet; it
  needs a new match type later.
- **A service question adds, never overrides.** A question is asked for every service of its category or for one service, and one key
  means one thing in a category.
- **A service stays in its category.** To move one, admin makes a new service and turns the old one off.
- **No customer form preview in admin.** The test panel on `/admin/pricing` prices sample answers; the customer form arrives with 04.

---

# ⚠️ v3 CORRECTIONS — SUPERSEDES EARLIER SECTIONS

> §21 and §22 were rewritten in v7 (D87 to D95) and agree with §3, §4 and §6 above. Read them before implementing anything.

## 21. Corrected transaction order (IMPORTANT)

v7, 2026-10-30 (D87 to D92): this replaces the escrow order. The example is a 7000 job at 10% commission.

```
1.  Customer posts request (fixed price computed server-side from answers)
2.  Providers see SHORT DETAILS ONLY
3.  Providers APPLY FREE with a message
    → 📧 CUSTOMER IS NOTIFIED of each application (in-app + email)
4.  Customer reviews applicants and CHOOSES ONE
    → 📧 CHOSEN PROVIDER IS NOTIFIED (in-app + email)
5.  ⭐ CUSTOMER PAYS THE COMMISSION ONLINE (700)
    → to the platform, on the hosted card page
6.  ⭐ CHOSEN PROVIDER PAYS THE PROVIDER FEE ONLINE, within the pay window
    → to the platform, on the hosted card page
    → only now does each side see the other's contact details
7.  Provider starts on the agreed start date → IN_PROGRESS
8.  Provider marks done on/near the completion date
9.  ⭐ CUSTOMER PAYS THE PROVIDER THE CASH DUE (6300), IN PERSON
    → outside the platform. The platform records nothing about it and is not responsible for it
10. Customer confirms, or the confirm window closes the job. No money depends on this
11. Optional rating (never gates anything)
```

**Why this order:** the customer goes first because their commission is safe until the reveal: it carries to the next pick, and it is refunded if no provider ever pays. The provider then pays only for a customer who has already paid. It also stops a customer choosing a provider and then vanishing.

### Corrected request state machine

```
OPEN → SELECTED → COMMISSION_PAID → UNLOCKED → IN_PROGRESS → AWAITING_CONFIRMATION → COMPLETED
```

| State | Meaning |
| --- | --- |
| `OPEN` | Posted; providers may apply |
| `SELECTED` | Customer chose a provider; **awaiting the commission** |
| `COMMISSION_PAID` | Customer paid the commission; **awaiting the provider fee** |
| `UNLOCKED` | Provider paid the fee; **contact details revealed both ways** |
| `IN_PROGRESS` | Provider started |
| `AWAITING_CONFIRMATION` | Provider marked done; confirm window running |
| `COMPLETED` | Customer confirmed, or the confirm window passed |
| `CANCELLED` | Cancelled; fees per §36 |

Branches are in §4, and every cancellation outcome is in §36.

> **Edge case that must be handled:** the commission is paid from `COMMISSION_PAID` onward. If no provider ever pays their fee and the request is cancelled or runs out of applicants, the commission is **refunded to the customer in full** with a compensating ledger entry.

## 22. Application status lifecycle

`applications.status` mirrors the request lifecycle so a provider can see exactly where each application stands.

| Status | Meaning | Set when |
| --- | --- | --- |
| `APPLIED` | Waiting for the customer to choose | Provider applies |
| `SELECTED` | Chosen — waiting for the customer to pay the commission | Customer chooses |
| `AWAITING_FEE` | Customer paid — **provider must pay the provider fee** | Request becomes `COMMISSION_PAID` |
| `UNLOCKED` | Fee paid, details revealed | Provider pays |
| `STARTED` | Work underway | Provider starts |
| `COMPLETED` | Provider marked done | Provider marks done |
| `CONFIRMED` | Job closed | Customer confirms, or the confirm window passes |
| `RATED` | Customer left a rating | Rating submitted |
| `NOT_SELECTED` | Another provider was chosen | Customer chooses someone else |
| `WITHDRAWN` | Provider withdrew | Provider action, before paying the fee |
| `EXPIRED` | Pay window passed without payment | Pay window expiry job |
| `CANCELLED` | Request cancelled | Cancellation |

## 23. Request dates

Every request carries explicit start and completion dates — not one vague timestamp.

| Field | Meaning |
| --- | --- |
| `scheduled_start_at` | Agreed start date/time — **chosen by the customer at posting** |
| `scheduled_end_at` | Expected completion date/time (from the service's estimated duration, adjustable) |
| `actual_started_at` | Set when the provider starts |
| `actual_completed_at` | Set when the provider marks complete |

Rules: `scheduled_start_at` must be in the future at posting; `scheduled_end_at` after `scheduled_start_at`; the confirm deadline is computed from `actual_completed_at`, not the scheduled date; providers see the scheduled dates in short details (they need them to decide whether to apply).

## 24. Notifications matrix

Every notification goes to **both the in-app notification centre and email**. WhatsApp/SMS is used where configured.

| # | Event | Recipient | In-app | Email |
| --- | --- | --- | --- | --- |
| 1 | New request matches your zones | Provider | ✅ | ✅ |
| 2 | **A provider applied to your request** | **Customer** | ✅ | ✅ |
| 3 | **You were chosen — awaiting the customer's payment** | **Provider** | ✅ | ✅ |
| 4 | Commission received — waiting for the provider | Customer | ✅ | ✅ |
| 5 | **Customer paid — pay your fee to see the contact details** | **Provider** | ✅ | ✅ |
| 6 | Pay window closing soon | Provider | ✅ | ✅ |
| 7 | Both paid — here are the provider's contact details | Customer | ✅ | ✅ |
| 8 | Both paid — here is the customer's contact | Provider | ✅ | ✅ |
| 9 | Work started | Customer | ✅ | ✅ |
| 10 | Work marked done — please confirm | Customer | ✅ | ✅ |
| 11 | Job closes by itself soon | Customer | ✅ | ✅ |
| 12 | Job completed | Provider | ✅ | ✅ |
| 13 | Please rate your provider | Customer | ✅ | ✅ |
| 14 | You received a rating | Provider | ✅ | ✅ |
| 15 | Problem reported | Admin + the reporter | ✅ | ✅ |
| 16 | Your report was handled | The reporter | ✅ | ✅ |
| 17 | Request cancelled | Affected party | ✅ | ✅ |
| 18 | Your account was approved / rejected | Provider | ✅ | ✅ |
| 19 | Fee refunded | The payer | ✅ | ✅ |

**In-app notification centre:** bell icon in the navbar with an unread count, a dropdown of recent items, and a full `/notifications` page. Each item links to the relevant request. Marked read on click.

## 25. Provider profile and verification

**Position 02 (spec 0006, D111 to D120) is built to this; it wins where the rest of this section differs.**

### Registration → verification → active

1. Provider signs up and completes their profile (individual or company, bio, years, languages, photo)
2. Accepts the documents consent, then uploads the required documents (`draft`)
3. Sends the file: status `pending` — **cannot apply to any request**
4. Admin shows each document (each view is recorded), marks it matching or rejected with one of six
   reasons, then approves or rejects the file
5. `approved` → can apply. Admin may suspend (`suspended`, with a reason shown as written) and lift
6. A replaced document or photo, a name change, or a change to the company details sends an approved file
   back to `pending`. A required document past its `valid_until` reads as `document_expired`: no applying
   until it is replaced
7. **The ID number is never asked for or stored.** Replaced files are deleted at once (D114)

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
| `phone`, `email` | ⛔ **Only after both have paid** | Gated by RLS |
| Documents | ⛔ Admin only | Never customer-visible |

### Required documents

| Document | Required |
| --- | --- |
| National ID / residence permit | ✅ |
| Selfie holding ID (liveness) | ✅ |
| Skill certificate | Optional |
| Criminal record certificate | Configurable by admin |

Documents live in a **private** bucket, are readable only by the owning provider and admins, and are served via short-lived signed URLs. Each has `status` (`pending`/`approved`/`rejected`) and a rejection reason.

> **What the customer sees when choosing:** display name, photo, bio, years of experience, skills, rating, jobs completed, verified badge, and the application message. **Never** phone, email, or full address before the reveal.

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
| `jobs_completed` | Jobs completed **on the platform** | **Derived** from completed requests. Never editable |
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
- **Only a completed request can be rated.** This is a genuine advantage over open review sites — say so publicly.
- Ratings are **immutable** once submitted. An admin may **hide** one with a recorded reason (audited); nobody may edit the number.

## 29. Provider quality metrics (derived, never editable)

Shown on the profile so customers can judge without chatting:

| Metric | Derivation |
| --- | --- |
| Completion rate | completed ÷ unlocked |
| On-time rate | actual start ≤ scheduled start |
| Cancellation rate | provider-caused cancellations ÷ unlocked |
| Report rate | problem reports against the provider ÷ completed |
| Repeat-customer rate | customers with more than one completed request |
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
- Report rate and cancellation rate monitored **separately** from rating.
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

## 34. Trust mechanism: both sides commit, no guarantee

> ⚠️ **Changed 2026-08-17 (D17), rewritten 2026-10-30 (D87, D92).** The satisfaction guarantee stays
> dropped: combined with server-side pricing and controlled matching, a guarantee of the outcome is the
> standard checklist for being treated as the **principal** in a transaction, which contradicts D12 (we
> act as an agent). Escrow is gone too.

The customer cannot verify quality before choosing. Four things carry that risk, and none of them is
a promise about the work itself:

1. **Both sides pay.** A customer and a provider who have each paid are serious, and the customer pays
   the provider only after the job is done. **Market it plainly: "Pay the provider in cash after the
   job is done."** That statement is factually true and carries no principal risk.
2. **Vetting.** Every provider is ID-verified and background-checked through the funnel in §30, and
   the platform computes a real acceptance rate. Any public quality claim derives from that figure
   (§26) — never from an unsubstantiated superlative.
3. **Ratings.** Only a completed request can be rated (§28), which is a genuine advantage over open
   review sites and is worth saying so.
4. **Reports and the agreement statement** (D92). Either side can report a problem to admin, and users
   accept that the platform may take legal action if one of the two parties does something wrong.

### Reports are not a guarantee — keep the distinction

| | |
| --- | --- |
| **A guarantee** | We promise the work will be satisfactory, and we make it right — by re-performing or procuring a replacement. That is a **principal's** obligation |
| **A problem report** | We look at what happened, act on the account (warn, suspend), and may refund our own fee. That is an **intermediary's** function |

We do the second. Never write copy — in the product, the T&C, or marketing — that promises the first,
or that promises the platform will collect the cash for anyone. Any goodwill payment comes from **our
own fees** and is recorded as such.

> **Trade accepted:** this is a weaker customer proposition than a guarantee. It is the price of the
> agent position (D12), which keeps the job price off our books and shrinks e-invoicing to our own
> fees. If B9 comes back saying we are a principal anyway, revisit this section — the reason for the
> constraint would be gone.

## 35. Admin capabilities and limits (summary)

**Admin CAN:** import legacy job counts (flagged), issue rating-invitation links, grant Founding Provider, edit bio/skills/experience with a provenance flag, verify/reject documents with reasons, move providers through the vetting funnel, suspend with a reason, hide a rating with a recorded reason, refund a fee by hand with a recorded reason, configure thresholds and guarantee policy.

**Admin CANNOT:** set or edit `rating_avg` or `jobs_completed` (derived), submit a rating on behalf of a customer, delete a rating, merge legacy counts into platform counts, or make any of the above changes without an audit-log entry.

---

# v6 — CANCELLATION POLICY (rewritten for the cash model, D87, D90)

> Closes gap G7. Cancellation is not an edge case — after completion it is the most common outcome in
> any services marketplace, and it is the one users complain about publicly. All thresholds live in
> `platform_settings`; the values below are seed defaults (D13).

## 36. Who may cancel, when, and what happens

| # | State | Who or what | Commission | Provider fee | Counts against |
| --- | --- | --- | --- | --- | --- |
| 1 | `OPEN` | Customer cancels | not paid | not paid | nobody |
| 2 | `SELECTED` | Customer cancels | not paid | not paid | nobody |
| 3 | `SELECTED` | Provider withdraws | not paid | not paid | provider cancellation rate |
| 4 | `SELECTED` | Payment window expires | not paid: back to `OPEN` | not paid | nobody |
| 5 | `COMMISSION_PAID` | Customer cancels | **refunded automatically** | not paid | nobody |
| 6 | `COMMISSION_PAID` | Pay window expires, or provider withdraws | **stays paid**, carries to the next pick | not paid | provider (fee follow-through) |
| 7 | `COMMISSION_PAID` | 3rd failed pick, or no applicant left (G2) | **refunded automatically** | not paid | nobody |
| 8 | `UNLOCKED` / `IN_PROGRESS` | Customer cancels | no automatic refund | no automatic refund | customer late-cancel rate |
| 9 | `UNLOCKED` / `IN_PROGRESS` | Provider cancels | no automatic refund | no automatic refund | provider cancellation rate |
| 10 | `UNLOCKED` / `IN_PROGRESS` | Provider no-show (deadline flag, G1) | no automatic refund; admin may refund | no automatic refund | provider cancellation + no-show rate |
| 11 | any paid state | Admin | by hand, with a recorded reason | by hand, with a recorded reason | per admin attribution |
| 12 | `AWAITING_CONFIRMATION` onward | — | ⛔ **not cancellable** — this is a report, not a cancellation | | |

### The rules behind the table

1. **A fee buys the introduction.** Until the reveal nothing was delivered, so the commission goes back
   (rows 5, 7) or carries over (row 6). After the reveal the introduction happened, so neither fee
   comes back by itself (rows 8 to 10).
2. **Admin can always correct a case by hand**, with a recorded reason (row 11): for example a provider
   no-show. That is a decision about one case, not a rule, and it is audited.
3. **Every refund is a compensating ledger entry.** Never edit the original posting.
4. **The PSP's processing fee is not recovered** on a refund — the platform absorbs it (D13). It is
   posted to `expense:psp_fees` regardless of outcome.
5. **Every cancellation is attributed** to customer, provider, or platform, and feeds
   `provider_metrics` / customer-side counters. An unattributed cancellation is a bug — the metrics
   in §29 depend on it.
6. **Cancellation is not a report.** Once the provider marks the work done, the path is a problem
   report handled by admin. Row 12 exists to stop anyone adding a cancel button there.
7. **The cash is never part of this table.** Whatever happens, the platform moves no job money.

### Implementation notes

- One Server Action, `cancelRequest`, resolves `(actor, state)` → an outcome from this table. **The
  table is data, not branching logic scattered across handlers** — the same reasoning as pricing
  modifiers.
- The outcome is computed **server-side**; the client never sends a refund amount.
- Refunds go through the outbox like every other PSP effect (`architecture.md` §27).
- The confirmation dialog states the exact refund, or that there is none, **before** the user confirms
  (`ui-rules.md` §5).
- Tests: one per row, plus a property test that a fee is refunded at most once in any sequence.