# Open questions, gaps, and unexamined assumptions

> **Archive since 2026-10-17 (playbook adoption).** The resolutions below are recorded; **live open
> questions are the Q rows in `progress-tracker.md` §4**, and open business items are its B rows. Read
> this file only for the reasoning behind a past resolution. The two items still open here map to
> tracker rows: G17 → B3/B11, G18 → B9.

> Companion to `contradictions.md`. That file catalogued places where the docs **disagree with each
> other** — all 13 are now fixed. This file is different: these are places where the docs **agree,
> and are silent, ambiguous, or resting on an assumption nobody has tested.**
>
> None of these are blocking Phase 0. Most bite between Phase 3 and Phase 5, which is exactly when
> they are most expensive to discover. Each entry states the failure, the trigger, and a proposed
> resolution. **Resolutions are proposals — the numbered blockers in `progress-tracker.md` §4 remain
> the human's call.**
>
> Raised 2026-08-17 from a full read of all nine context documents.

---

## 🔴 Critical — money can be stranded, or the model can be gamed

### G1 — A provider can unlock, take the PII, and then simply stop. Nothing times out.

Two deadlines exist: `unlock_deadline` (FUNDED → OPEN) and `release_deadline` (AWAITING_CONFIRMATION
→ RELEASED). **There is no deadline on `UNLOCKED → IN_PROGRESS`, and none on `IN_PROGRESS →
AWAITING_CONFIRMATION`.**

So: provider is selected, customer pays, provider pays the unlock fee, receives the customer's phone
and exact address — and then never marks the job started. The request sits in `UNLOCKED`
indefinitely. The customer's money is held at the PSP with no path out, because every automated exit
(`auto-release`, `unlock-expiry`) is keyed to a deadline that was never set. The customer's only
recourse is a dispute, and `disputes` is reachable only from `AWAITING_CONFIRMATION`.

This is the exact failure the docs warn about: *"a request must never sit funded with no owner of the
money"* (`architecture.md` §21). The invariant is stated; the mechanism that enforces it is missing.

**Proposed resolution.** Add two admin-configurable windows and the jobs that act on them:
- `start_deadline` — set at `UNLOCKED`, derived from `scheduled_start_at` plus a grace period. On
  expiry: flag the request, notify both parties, and open an admin-actionable state (not an automatic
  refund — the work may genuinely be underway offline).
- `completion_deadline` — set at `IN_PROGRESS`, derived from `scheduled_end_at` plus grace. On expiry:
  same.
- Allow the **customer** to raise a dispute from `UNLOCKED` and `IN_PROGRESS`, not only from
  `AWAITING_CONFIRMATION`. Today a customer whose provider vanished has no button to press.
- The unlock fee is **not** refunded in this path (the provider received the PII), which also removes
  the incentive in G4.

### G2 — Re-selection can outlive the PSP's hold window, and nothing counts the elapsed time.

`FUNDED → OPEN` on a missed unlock keeps the funds held while the customer picks another applicant.
Correct design. But there is **no cap on how many times this can cycle**, and no accounting of
cumulative held time against the PSP's maximum hold duration.

`progress-tracker.md` §6 question 1 asks only whether max hold *"must exceed our 72h release
window"*. That framing understates it. Real elapsed time is:
`payment window + (unlock window × N re-selections) + scheduled work duration + 72h release window`.
With a 24h unlock window and three cycles that is already past 5 days before work starts — and
`scheduled_start_at` is customer-chosen and could be weeks out.

**Proposed resolution.** Cap re-selections (suggest 3), then auto-refund and reopen as an unfunded
request. Store `funds_held_since` on the escrow and assert `now() - funds_held_since < psp_max_hold −
safety_margin` in the existing invariants job, alerting before the PSP force-releases or reverses.
Reject a `scheduled_start_at` further out than the safe hold window allows.

### G3 — PSP processing fees do not exist anywhere in the system.

Search the nine documents: the chart of accounts (`architecture.md` §29) has
`platform:revenue:unlock_fee`, `escrow:held`, `provider:available:{id}`. The pricing pipeline
(§19.3) goes base → modifiers → addons → zone → round → commission. **Neither models the fee the PSP
charges on every transaction.**

Consequences: gross revenue is overstated on every report; the reconciliation job compares a ledger
that never posted the fee against a settlement report that did, so it will alert on drift *by
construction*; and on a full refund the platform reverses commission but has still paid the PSP's
processing fee — an unposted real loss.

**Proposed resolution.** Add `expense:psp_fees` to `ledger_accounts` and post it as its own leg when
the settlement webhook reports the actual fee (never estimate it — it varies by card type, and mada
in KSA prices differently from international schemes). Decide explicitly who absorbs it on a refund,
and record that decision. This is the same failure class as C2 — *a fee that is deducted in reality
but never posted in the ledger* — which `architecture.md` §30 already names as "the most common
marketplace ledger bug".

### G4 — Refunding the unlock fee after unlock hands out customer PII for free.

`project-overview.md` §9 decision 6: *"Is the unlock fee refunded if the customer cancels
post-unlock? — Yes, refund to provider."*

The unlock fee is the price of the PII. Once revealed, it cannot be un-revealed. A refund makes the
reveal free whenever a cancellation follows, and a provider who wants contact details without paying
has an obvious route: unlock, then induce the customer to cancel.

**Proposed resolution.** Refund only when the cancellation is **not attributable to the provider** —
customer-initiated cancellation before `scheduled_start_at`, or platform/admin cancellation. Never on
provider no-show (G1) or provider-caused cancellation; `provider_metrics.cancellation_rate` already
distinguishes these. If a blanket rule is wanted, "no refund after reveal" is the safer default.

### G5 — Nothing prevents a request being funded twice.

`unlock_fees` has a unique `idempotency_key`. `psp_events` dedupes webhooks. `ledger_entries` has a
unique idempotency key. **`escrows` has no unique constraint on `request_id`.**

A customer who double-submits payment, or a webhook race across two rapid attempts, can create two
escrow rows for one request. Each satisfies `escrow_conservation` individually, so the constraint
does not catch it, and the money is real.

**Proposed resolution.** `CREATE UNIQUE INDEX ON escrows (request_id)` — one request funds once.
Derive the funding idempotency key deterministically as `fund:{request_id}` in the same style as
`unlock:{request_id}`.

---

## 🟠 Major — a requirement is ambiguous enough to build the wrong thing

### G6 ✅ RESOLVED 2026-08-17 — three locales, two regions.

**Answer: `ar` + `tr` + `en`, in both Turkey and Saudi Arabia, as two separate deployments.**
Position 3 below was the concern; the real answer was broader than any of the three options offered.
Direction is now derived from locale at runtime rather than hardcoded. Full specification in
[`i18n.md`](i18n.md); recorded as decisions D7 and D8. The original analysis is kept below.

<details>
<summary>Original finding (resolved)</summary>

Rule 10 makes Arabic-first RTL non-negotiable. Blocker B1 leaves the market open between Turkey and
Saudi Arabia. **Turkish is the native language of roughly 85–90% of Turkey and is written in Latin
script, left-to-right.** An Arabic-first RTL product in Turkey is not a localisation choice; it is a
different target market.

It can still be the right call — Turkey has an estimated 4–5 million Arabic speakers, concentrated in
Istanbul and the southeast, and a business already running through a 400-member WhatsApp group is
plausibly serving exactly that community. But that is a **substantial, unstated strategic assumption**
that caps the addressable market, and no document says it out loud.

**This needs a human answer, and it is upstream of B1, not downstream.** Three coherent positions:
1. KSA primary → Arabic-first RTL is simply correct. No change.
2. Turkey, Arabic-speaking community → correct as written, but say so explicitly in
   `project-overview.md` §18, because it changes marketing, zones, and provider sourcing.
3. Turkey, general market → **Rule 10 is wrong** and the UI needs Turkish/LTR with i18n from day one.
   Retrofitting direction-agnostic layout later is expensive; the logical-properties discipline
   already in `ui-rules.md` §3 makes it *possible*, but copy, fonts, and number formatting are not covered.

Whichever it is, record it in the decision log. Building Phase 0–3 under assumption 1 or 2 and then
discovering 3 wastes the whole UI layer.

</details>

---

## 🔴 Round 2 — raised by the decisions of 2026-08-17

### G17 — "No profile difference between individuals and companies" is true for us and false for the PSP.

D9 settles our side: one provider account shape, one profile UI, no branching. Correct — entity type
is not something a customer choosing a cleaner should see.

But **iyzico's sub-merchant API does not accept one shape.** It defines three sub-merchant types —
`PERSONAL`, `PRIVATE_COMPANY`, `LIMITED_OR_JOINT_STOCK_COMPANY` — and **the required fields differ by
type**: a limited/joint-stock sub-merchant must supply a tax number and legal company title, a
personal one supplies national identity details instead. PayTabs KYC branches similarly. Onboarding
a company as `PERSONAL` will either fail at registration or, worse, succeed and then fail at first
payout — after the provider has already done the work.

**Proposed resolution.** Capture the minimum the PSP needs, and keep it out of the public profile:
- `providers.entity_type` — `individual | private_company | incorporated`. Asked once during
  verification, alongside document upload. **Never rendered on the customer-facing profile.**
- `providers.tax_number` (nullable), `providers.legal_name` (nullable) — required only when
  `entity_type <> 'individual'`, enforced by a `CHECK`.
- The PSP adapter maps our three values to each provider's own enum. This is exactly what the adapter
  interface exists for — feature code stays entity-agnostic.
- Zod validation branches on `entity_type`; the profile UI does not.
- Confirm with each PSP whether an individual can be a sub-merchant at all — this is already
  `progress-tracker.md` §6 question 2 and is still unanswered.

### G18 ⚠️ PARTLY RESOLVED 2026-08-17 — we act as an **agent**, not the principal (D12).

**What this settles.** The provider sells the service to the customer. We sell two things, both to the
provider: intermediation (commission) and lead access (unlock fee). Therefore:

- **We do not invoice the customer for the job price.** That supply is the provider's, and most
  providers sit below the SAR 375,000 registration threshold, so frequently no VAT invoice is due for
  it at all.
- **The chart of accounts in `architecture.md` §29 is correct as written** — the held amount is a
  pass-through we never recognise as revenue. Only commission and unlock fees are ours. This is now
  true *by decision* rather than by accident; do not "simplify" it later.
- **We still build ZATCA, at roughly a quarter of the scope.** Our fees to providers are a taxable
  supply and need compliant invoices — XML, UUID, cryptographic stamp, QR, hash chaining, and the
  Phase 2 API. What we avoid is per-job invoicing, which was the bulk of the work.

**What is still open — three items.**

1. **B9: the agent position is asserted, not verified.** We set the price server-side and control
   matching. Both are textbook *principal* indicators, and non-custody of funds does not decide VAT
   treatment. A Saudi tax advisor must confirm this, and a Turkish one for e-Fatura. If it comes back
   "principal", VAT is owed on the full job price and the chart of accounts is wrong — which is why
   B9 is a release gate, not a nice-to-have.
2. **Invoice type branches on the provider's own VAT status.** A standard (B2B, cleared) invoice
   requires the buyer's VAT registration number. A provider below the threshold does not have one, so
   that supply is simplified instead. Capture `providers.vat_number` (nullable) alongside the
   `entity_type` fields from G17, and let the invoicing adapter pick the type per provider.
3. **Arabic remains mandatory on whatever we do issue** — the original finding below stands, scoped
   now to our own fee invoices rather than every job.

<details>
<summary>Original finding (still applies to fee invoices)</summary>

### ZATCA requires Arabic on invoices regardless of the user's chosen locale.

The new locale model lets a KSA user run the app in `tr` or `en`. **Saudi e-invoicing does not follow
the user's preference: ZATCA requires invoice fields to be in Arabic** — Arabic alone, or Arabic plus
another language. A Turkish-locale customer in the KSA deployment must still receive an
Arabic-compliant invoice.

Two further consequences that touch architecture, not just copy:
- Phase 2 ("integration") requires **ZATCA clearance before the invoice reaches the buyer**, along
  with machine-readable XML, UUID, digital signature, and cryptographic stamp. That is an external
  call on the critical path — so it goes through the **outbox** like every other external effect, and
  the invoice is not "delivered" until clearance returns.
- Invoice generation is therefore **not** a UI concern and must not be built as one.

**Proposed resolution.** Treat invoicing as region-specific infrastructure behind an adapter, mirroring
the PSP adapter: `lib/invoicing/{zatca,efatura}`. Store invoices with their own locale field, fixed to
`ar` (or `ar`+`en` bilingual) for KSA, independent of `profiles.locale`. Add "who is the invoice
issuer of record — us or the PSP" to the PSP questions in §6; the answer decides whether we build this
at all. **Do not guess this one — it is a tax-compliance question** and already appears in the
stop-and-ask list.

</details>

## 🔴 Round 3 — created by D14 (single deployment, `region` column)

> The two-deployment model gave currency isolation, region isolation, and blast-radius isolation for
> free — separate databases cannot leak into each other. A single deployment must **earn** each of
> them. These five are the specific places that were relying on the free version.
>
> **Answered 2026-08-17: an account belongs to exactly one region** — a person operating in both
> markets creates a second account. That single answer dissolves G23 entirely and simplifies G25.
> **G22, G24, G25, G26 are now fixed in the source docs; G23 is closed as not-applicable; G27 is new.**

### G22 — `psp_events` dedupes on a key that is no longer unique. **This drops real payments.**

`CREATE UNIQUE INDEX ON psp_events (psp_event_id)` assumed one PSP. Two PSPs now write to one table,
and iyzico and PayTabs mint event ids in **independent id spaces** — nothing guarantees they never
collide.

A collision does not raise an error. The webhook handler inserts, hits the unique constraint, treats
it as a replay, and returns `200 OK` having done nothing. **The payment is never recorded, the escrow
row is never created, and the customer's money sits at the PSP with no row pointing at it.** Silent,
and on the money path.

**Fix:** `UNIQUE (psp_provider, psp_event_id)`. Add `psp_provider` to the table. One line, and it must
land in feature 03, not be discovered in production.

### G23 ✅ CLOSED — not applicable. One account, one region, one currency.

Because an account never spans regions, a provider can only ever hold one currency. The account path
`provider:available:{provider_id}` needs no currency segment and `provider_balances` stays keyed on
`provider_id`. **Nothing to change** — the original concern is recorded below so the reasoning is not
re-derived if the account model is ever revisited. If accounts are ever allowed to span regions, this
becomes live again immediately.

<details>
<summary>Original finding (not applicable under D14)</summary>

### `provider:available:{provider_id}` has no currency dimension.

The chart of accounts keys a provider's balance on provider id alone. If a provider operates in both
regions, TRY and SAR postings land in the same account, and its balance becomes a sum of two
currencies — a number that means nothing and that the invariant job will happily verify against an
equally meaningless ledger total.

Same problem in `provider_balances`, whose primary key is `provider_id`: one row, one set of amounts,
no currency.

**Fix (if accounts span regions):** account path becomes `provider:available:{provider_id}:{currency}`
and `provider_balances` is keyed `(provider_id, currency)`.

</details>

### G27 — Separate accounts per region collides with phone-based OTP identity.

Falls directly out of the D14 answer, and nothing in the docs covers it.

Accounts are per-region, but **Supabase phone auth maps one phone number to one identity**. A person
active in both markets therefore cannot register the same number twice — the second signup either
fails or silently logs them into the first account, in the wrong region.

**Proposed resolution — the constraint is largely self-solving.** Phone numbers are country-scoped in
practice: a Turkish account uses a `+90` number and a Saudi one a `+966` number, so the same person in
both markets genuinely has a different number in each. Make that explicit rather than incidental:

- Validate the dialling code against the account's region at signup — `+90` for `TR`, `+966` for `KSA`.
  Reject a mismatch with a clear message rather than creating a cross-region account.
- Region is chosen **before** the OTP step, so the number can be validated against it, and it is stored
  on `profiles.region` at creation. It is never editable afterwards — changing it would strand the
  account's requests, ledger history, and PSP sub-merchant registration.
- One provider therefore onboards to **one** PSP only, which keeps `providers.psp_submerchant_id` a
  single column rather than a table.

**Residual edge case — decided 2026-08-17 (D16): strict, no override at launch.** A Saudi resident
holding a Turkish number is rejected with a clear message. Accepted because the volume is unknown and
the rule is trivially loosened later; an admin override can be added without a migration once real
signup data shows whether it matters. Track rejections so that decision has evidence behind it.

### G24 — `platform_settings` is keyed on `key` alone.

Commission %, unlock fee, hold period, unlock window, and applicant cap all differ per market. With a
single `key` column, an admin changing the TR commission changes KSA's at the same time, silently.

**Fix:** key on `(region, key)`. Cheap now, and it is the kind of change that is nearly impossible
once real settings history exists.

### G25 — Every money invariant is expressed globally and must become per-currency.

`SUM(debit) = SUM(credit)`, escrow conservation, balance-equals-ledger, platform-revenue
reconstruction — all currently written as single aggregates. Across mixed TRY and SAR they are not
merely wrong, they are **meaningless yet passing**: two unbalanced currencies can sum to zero together.

**Fix:** every invariant assertion groups by `(region, currency)`. Add a database-level guard that a
single posting group cannot contain two currencies. Reconciliation runs per PSP, per region.

### G26 — Three documents still assert "one currency per deployment".

`architecture.md` (Currency section), `i18n.md` §2, and `open-questions.md` A5 all still describe the
two-deployment model. `project-overview.md` §16 still lists multi-country-in-one-deployment as
**out of scope** — the thing D14 just chose.

**Fix:** rewrite all four. Listed in `docs/specs/0002-review-fixes-45-51.md` under D14. Not yet applied —
the plan is `proposed`, and rewriting the architecture on an unconfirmed plan is how docs and
intentions drift apart.

---

### G21 ✅ RESOLVED 2026-08-17 — the guarantee is dropped (D17).

`project-overview.md` §34 rewritten. Trust now rests on **escrow + vetting + ratings**, and disputes
handle disagreement. The distinction is kept explicit in §34 because it is the whole point: a
*guarantee* is a principal's obligation to make the work right; a *dispute process* is an
intermediary deciding where held money goes. We do the second.

"You don't pay until the job is done" survives as marketing — it describes escrow, is factually true,
and carries no principal risk. Added to §16 out-of-scope so it does not creep back.

**Trade recorded:** a weaker customer proposition than a guarantee, accepted as the price of the agent
position. If B9 returns "principal", revisit — the constraint would no longer apply.

<details>
<summary>Original finding (resolved)</summary>

### The satisfaction guarantee undercuts the agent position we just took.

`project-overview.md` §34 says the platform *"carries the residual risk"* and specifies a
**satisfaction guarantee / re-do policy**, plus marketing escrow as *"you don't pay until the job is
done."*

A party that sets the price, controls matching, holds the customer relationship, **and guarantees the
outcome** looks materially like a principal. Each of those alone is survivable; together they are the
standard checklist a tax authority applies. D12 says we are an agent — §34 is the strongest evidence
against it in the whole document set, and the two were written without reference to each other.

**Proposed resolution.** Do not drop the guarantee — it is the trust mechanism the product is built
on, and `project-overview.md` §26 is right that quality must be defensible. Instead, make its
*mechanism* consistent with the agent model:

- Frame the guarantee as **mediation and a refund of held funds**, not as us re-performing or
  procuring the service. We return the customer's money; we do not sell them a replacement job.
- Pay any goodwill remedy from **our commission**, not from the job price.
- Say in the T&C that the service contract is between customer and provider, and that we act as an
  intermediary and payment facilitator.
- **Put §34's exact wording in front of the B9 advisor**, not just the abstract question. The wording
  is what gets assessed, and "we guarantee the work" reads very differently from "we hold your money
  until you confirm."

Also worth resolving in the same conversation: the escrow marketing line is fine, but *"satisfaction
guarantee"* and *"re-do policy"* are the phrases that carry principal risk.

</details>

### G19 — Two deployments double every operational surface, and nothing accounts for it.

D7 gives two independent deployments. One codebase, but: two databases, two migration runs, two sets
of cron jobs (auto-release, unlock-expiry, reconcile, invariants, relay), two outbox queues, two
alert channels, two feature-flag states, two PSP integrations under test, two seed datasets.

The observability spec (`architecture.md` §37) and the kill switches (§38) are written as though there
is one environment. A flag flipped in TR and forgotten in KSA is a silent divergence.

**Proposed resolution.** Tag every log line, metric, span, and alert with `APP_REGION` from the start —
retrofitting this is painful. One dashboard per region plus a combined view. Make the kill-switch
runbook explicitly per-region and state whether a Sev-1 in one region should halt the other (default:
no, they are independent). Add region to the CI matrix so migrations are proven against both.

### G20 — Message catalogue completeness is a build-time guarantee nobody owns yet.

Three locales × every string, with admin-authored labels living in the database as localised JSONB
(`i18n.md` §5). Two distinct failure modes: a **missing message key** renders a raw key to a customer,
and a **missing database translation** renders the fallback locale silently.

**Proposed resolution.** Fail the build when a key exists in one catalogue and not the others — cheap
to enforce, and it is the difference between catching this in CI and catching it in production. For
database labels, show admins a per-locale completeness indicator in the catalog UI, and surface a
"missing translations" count on the admin dashboard. Never block a save on a missing translation —
that would stop an admin fixing an urgent price at 2am.

### G7 — "Refund per policy" — the policy is never written.

`architecture.md` §21: `FUNDED/UNLOCKED → CANCELLED` → *"Full refund of held funds + compensating
ledger entry reversing commission."* Elsewhere cancellation is *"per policy"*. But nothing defines:
who may cancel, in which states, how close to `scheduled_start_at`, with what penalty, and whether
the provider is compensated for a late customer cancellation.

Cancellation is not an edge case — it is the second most common outcome after completion in every
services marketplace, and it is the one users complain about publicly.

**Proposed resolution.** Write a cancellation matrix — `{who} × {state} × {time to scheduled_start}`
→ `{refund %, unlock fee treatment, commission treatment, metric attribution}` — and store the
thresholds in `platform_settings` like every other window.

### G8 — The unlock-fee price has no model behind it, and leakage is the core risk of this design.

The model deliberately reveals contact details and forbids masking, accepting that some jobs will
complete off-platform. `project-overview.md` §3 justifies this: *"leakage is handled economically —
we already took the unlock fee."*

That holds only if the unlock fee is priced against the expected loss. **Industry estimates for
marketplace leakage run from ~30% to as high as 80% of revenue**, and services marketplaces where the
parties meet in person are at the high-risk end — the structural opposite of a marketplace like Uber,
where the platform is genuinely hard to route around. Commission is the larger revenue line, and
commission is exactly what leaks. The unlock fee is currently a flat, admin-set number (decision:
"Flat, admin-configurable") with no stated relationship to `price × commission_% × P(leak)`.

**Proposed resolution.** This is a business decision, not an engineering one, but engineering must
supply the input: the `unlock_follow_through` metric in `provider_metrics` (unlocked ÷ released) is
the leakage estimator and is already specified. Ship the metric in Phase 3, measure it against real
data before Phase 7, and treat "unlock fee ≥ expected commission loss per unlock" as the pricing
floor. Also reconsider what actually keeps people on-platform: escrow is the strongest lever already
built — `project-overview.md` §34 says to market it prominently, which is correct.

### G9 — The rating invariant is not satisfiable as written.

`architecture.md` §24 computes `rating_avg` with **recency weighting** (`w_i` = recent ratings weigh
more). `architecture.md` §26 asserts the invariant *"`rating_avg` is always reproducible from
non-hidden `ratings`"*.

Recency weight is a function of elapsed time, so recomputing tomorrow yields a different number than
today's stored value, from the identical rating set. The invariant job will alert on every provider,
every night, forever — and an alert that always fires is an alert nobody reads.

**Proposed resolution.** Pin the weighting to the computation instant: store `rating_avg`,
`rating_computed_at`, and the shrinkage constant used, then restate the invariant as *"reproducible
from non-hidden ratings **as of `rating_computed_at`**"*. Recompute nightly and on insert, as
specified.

### G10 — Providers can flood the applicant cap.

Applications are free, the cap is 10 per request, and the feed is filtered only by zone and
availability. Nothing rate-limits a provider across requests. A provider (or a script) can take one
of the ten slots on every request in a zone within seconds of posting, which both starves other
providers and makes the cold-start protection in §33 ineffective.

**Proposed resolution.** Rate-limit applications per provider per rolling window in
`platform_settings`; weight feed ordering by `unlock_follow_through` and response time so
high-volume low-conversion applicants sink; consider a short delay before a brand-new request accepts
applications, so speed alone does not win the slot.

### G11 — Compounding multipliers have no ceiling on the final price.

`architecture.md` §19.4 bounds each `MULTIPLIER` factor to roughly 0.1–10 — **per modifier**. Modifiers
apply in sequence, so five stacked multipliers of 10 produce a 100,000× price. The zone multiplier
then applies on top. Every individual value passes validation.

**Proposed resolution.** Bound the *output*, not just the inputs: a `max_price_minor` per service in
`platform_settings`, asserted after step 5 of the pipeline. Exceeding it is a configuration error —
fail the price computation loudly rather than presenting an absurd price to a customer. Add a
property-based test asserting the computed price stays within bounds across randomised valid formulas.

---

## 🟡 Stack and operations — real, but cheaper to fix later

### G12 — The outbox makes payment feel asynchronous, and no UI state covers the gap.

Correct pattern, unavoidable consequence: the PSP call now happens after the transaction commits, in
a relay driven by Supabase cron whose **minimum schedule is one minute**. A provider clicking "pay the
unlock fee" may wait up to a minute for anything to change, and `ui-rules.md` §4 only defines
loading / empty / error / success.

**Proposed resolution.** Add an explicit `submitted / processing` UI state for every outbox-backed
action, driven by the outbox row's status, with honest copy ("payment submitted — confirming with the
provider"). Pair the cron with the on-demand trigger `architecture.md` §27 already mentions so the
common path is fast, and keep cron purely as the retry safety net. Define the SLO for outbox drain
lag alongside the others in §37.

### G13 — Server Actions are public endpoints with no abuse control specified.

`library-docs.md` correctly notes that Server Actions are public HTTP endpoints and that being
server-side is not authorisation. But rate limiting is specified **only** for OTP. Nothing covers
request posting, application submission, or payment initiation — all of which are unauthenticated-ish
in cost terms (they hit the database, the pricing engine, and the PSP).

**Proposed resolution.** A shared rate-limit helper applied at the top of every mutating action,
keyed by user and IP, with limits in `platform_settings`. Note also that this framework has shipped
authorisation-bypass CVEs in this layer (`code-standards.md` §34 already mandates a 72-hour patch
cadence) — which is another reason authorisation lives in the action, not the proxy.

### G14 — The property-based testing library is still "to be chosen".

`library-docs.md` requires property-based testing for ledger invariants but leaves the library
unnamed, and an unnamed dependency never gets installed.

**Proposed resolution.** For a TypeScript codebase this is **fast-check** — it integrates with any
test runner and has the shrinking behaviour the doc asks for. Name it, pin it, record it.

### G15 — Partitioned tables need a maintenance job that is not in the plan.

`architecture.md` §39 partitions `ledger_entries`, `notifications`, `audit_log`, and `outbox_events`
by time. Partitions do not create themselves; when none exists for the current period, inserts fail —
and for `ledger_entries` that means money operations stop.

**Proposed resolution.** Either `pg_partman`, or a scheduled job that pre-creates the next N periods,
plus an alert when the furthest-out partition is closer than N periods away. Add it to feature 39.

### G16 — Provider payout timing is promised loosely and may be much slower than expected.

`library-docs.md` notes iyzico has a *"settlement/blockage delay after approval"* and says to surface
honest copy. Public documentation suggests that for **newly registered** sub-merchants this can run to
roughly 60 days, dropping to about 7–14 days once established — against a product that tells providers
their money is released the moment the customer confirms.

For a provider migrating from a WhatsApp group where they were paid in cash on the day, "released" but
not *received* for weeks is the single most likely reason to reject the platform.

**Proposed resolution.** Confirm the real figure with the PSP before Phase 5 (this is
`progress-tracker.md` §6 question 3 — it is currently blank and deserves priority). Then show
providers two distinct dates: *released to your balance* and *expected in your bank*. Never conflate
them in the earnings UI.

---

## Assumptions this project rests on that no document states

Not defects — decisions made implicitly. Each is defensible; each should be recorded so it can be
revisited deliberately rather than discovered.

| # | Assumption | If it is wrong |
| --- | --- | --- |
| ~~A1~~ | ~~The target user reads Arabic~~ | ✅ **Corrected 2026-08-17.** Three locales (`ar`/`tr`/`en`), two regions (TR/KSA). See `i18n.md` |
| A2 | Providers will accept paying to unlock work they have already won | The unlock fee — one of two revenue lines — has no takers |
| A3 | Customers will pay in full **before** knowing who they are dealing with | Funnel drops at the payment step; the order may need revisiting |
| A4 | Enough leakage is deterred by escrow alone (G8) | Commission revenue collapses; unlock fee must carry the business |
| A5 | ~~One currency per deployment; two deployments~~ | ✅ **Revised 2026-08-17 (D14, superseding D7).** **One** deployment, `region` column, both currencies in one database. An account belongs to exactly one region, so one account still means one currency. Global money aggregates must group by `(region, currency)` — see G25 |
| ~~A6~~ | ~~Providers are individuals, not companies~~ | ✅ **Corrected 2026-08-17 (D9).** Both, with **no profile difference**. See G17 — the difference survives at the PSP, not in our schema |
| A7 | Admins are trustworthy but **never** a code-execution boundary | ✅ Confirmed 2026-08-17 (D10). Enforced by rule 8 and the guard hook |
| A8 | The WhatsApp community migrates | Day one is an empty marketplace; §27 migration is the mitigation |
| A9 | 400 members and ~500 customers is the launch scale | RLS performance targets (§32) are sized for this, not for 100× |

---

## Suggested order of resolution

1. **G6** — answer before any UI work. It is upstream of everything and cheapest now.
2. **G1, G5** — schema-level; land with feature 03 while migrations are still cheap.
3. **G3** — chart of accounts; land with feature 14/39 before money moves.
4. **G2, G16** — both need PSP answers; fold into `progress-tracker.md` §6 and ask the PSP once.
5. **G7, G4** — policy decisions; needed before feature 22 (disputes).
6. **G9, G11, G15, G14** — before their owning features (32, 07b, 39, 14).
7. **G8, G10** — measure first, tune before launch.
8. **G12, G13** — before Phase 7 hardening.
