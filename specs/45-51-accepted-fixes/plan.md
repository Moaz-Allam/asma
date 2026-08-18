# 45–51 Accepted fixes — feature numbering and phase placement

Status: **confirmed**
Date: 2026-08-17 · confirmed 2026-08-17

## Intent

Give every piece of accepted-but-unnumbered work a feature number, so `progress-tracker.md` §12 can
track it and `build-plan.md` can order it. Nothing here is new scope — it is the audit findings
(G1–G21) and decisions D7–D14 turned into buildable, gated units.

## Ground truth

- **Phase:** 0 / Feature 01 not started. Nothing is built.
- **Blockers touching this plan:** B2, B3, B4, B5, B6, B9, B10 open. B9 gates feature 51 entirely.
- **Decisions consumed:** D7 (both regions), D8 (three locales), D9 (provider entity), D11 (G1–G16
  accepted), D12 (agent model), D13 (seed defaults), **D14 (single deployment — new, see below)**.

---

## ⚠️ D14 changes the architecture. Read this before the feature list.

**Decision:** one deployment serving both regions, with a `region` discriminator — **not** two
independent deployments.

**This contradicts three documents.** Resolved by `CLAUDE.md` precedence (a recorded human decision
outranks `architecture.md`), but each needs rewriting rather than quiet override:

| Document | Says today | Must become |
| --- | --- | --- |
| `architecture.md` — Currency | "One currency per deployment" | One currency **per region**; two live in one database |
| `project-overview.md` §16 | "Multi-city or multi-country operation in one deployment" is **out of scope** | In scope, deliberately. Move to §15 |
| `i18n.md` §2 | "Regions are separate deployments" | Region is a row value; locale and region stay independent axes |
| `.env.example` | `APP_REGION` build constant | Removed as a global; region is per-row. Per-region PSP credentials instead |

**What this costs.** The two-deployment model got currency isolation, blast-radius isolation, and
region isolation *for free* — different databases cannot leak into each other. A single deployment
must now **earn** each of those:

1. **Currency safety becomes a runtime invariant, not a deployment fact.** `ledger_entries.currency`
   already exists, but every aggregate — sum-to-zero, escrow conservation, balance projection,
   reconciliation — must now be asserted **per currency**. A global `SUM(debit) = SUM(credit)` across
   mixed TRY and SAR is meaningless and would pass while being wrong.
2. **Region becomes a security boundary**, so it becomes an RLS concern with its own negative tests.
3. **Blast radius is shared.** One bad migration, one exhausted connection pool, one runaway query
   now affects both markets. Feature 42's kill switches must be per-region.
4. **PSP, invoicing, settings, catalog, and zones all become region-scoped lookups** rather than
   env-selected singletons.

This is buildable and common — it is how most multi-market marketplaces run. But it is **feature 45,
and it must land before feature 03 writes any schema**, because it changes the primary key shape of
almost every table. Retrofitting a region column after Phase 3 means rewriting every RLS policy.

---

## The features

### 🔴 45 — Multi-region foundation  · Phase 1, **before 03**

Region as a first-class dimension.

- `regions` table (`code` PK `TR`|`KSA`, `currency`, `default_locale`, `psp_provider`, `active`).
- `region` FK column on every region-scoped table: `profiles`, `providers`, `requests`, `zones`,
  `service_categories`, `services`, `addons`, `questions`, `pricing_formulas`, `platform_settings`,
  `ledger_entries`, `escrows`, `payouts`, `invoices`, `outbox_events`.
- `platform_settings` keyed `(region, key)` — commission, fees, and both windows differ per market.
- **RLS: region isolation as a policy**, not a filter. A user reads only their own region's data.
- **All money invariants re-expressed per `(region, currency)`.** Global aggregates are forbidden.
- `Money` type carries currency already; add a runtime assertion that a posting group is single-currency.
- PSP + invoicing adapters selected **per row's region**, never from env.
- Indexes on `region` for every policy-bearing query.

### 46 — Localised content schema · Phase 2, with 05–07c

- Convert every user-visible label to localised `jsonb` (`{ar,tr,en}`) per `i18n.md` §5.
- Server-side resolution with fallback to the region's default locale.
- Admin catalog UI edits all three values; per-locale completeness indicator.
- `profiles.locale`; identifier columns pinned to a deterministic collation (`i18n.md` §6).
- (The `next-intl` runtime setup itself stays inside feature 01.)

### 47 — Lifecycle deadline hardening (G1, G2) · Phase 3, with 13

- `start_deadline`, `completion_deadline`, `reselection_count` on `requests`.
- Two expiry jobs; both idempotent, both flag for admin rather than auto-refunding.
- **Dispute reachable from `UNLOCKED` and `IN_PROGRESS`**, not only `AWAITING_CONFIRMATION`.
- Re-selection capped at 3, then full refund.
- Test: provider unlocks then vanishes → customer has a path and funds have an exit.

### 48 — Cancellation policy engine (G7) · Phase 5, after 20

- The 12-row matrix in `project-overview.md` §36 as **data**, not scattered branching.
- One `cancelRequest` action resolving `(actor, state, hours-to-start)` → outcome.
- Late-cancellation fee mechanism built, default 0.
- Refunds through the outbox; attribution written to metrics.
- Test: one per row + property test on `held = released + refunded + remaining`.

### 🔴 49 — PSP fee accounting (G3) · Phase 4, with 14

- `expense:psp_fees` in `ledger_accounts`.
- Fee posted from the **actual settlement figure**, never estimated.
- Platform absorbs it on refund (D13) — posted regardless of outcome.
- Test: reconstructed platform revenue reconciles against settlement with the fee accounted.

### 50 — Provider entity and tax identity (G17, G18) · Phase 1, with 02

- `entity_type`, `tax_number`, `legal_name`, `vat_number` on `providers` + CHECK constraint.
- **Never surfaced on the customer-facing profile** — admin and adapter only.
- PSP adapter maps `entity_type` to each provider's sub-merchant enum.
- Test: a company onboarded as an individual is rejected before it reaches the PSP.

### 51 — Invoicing adapter (G18) · Phase 6c · ⛔ **gated on B9**

- `lib/invoicing/{zatca,efatura}` behind `InvoiceProvider`, selected by row region.
- `invoices` table; outbox `event_type: invoice.issue | invoice.credit`.
- **Relay processes invoice events serially per region** — hash chaining makes issuance order-dependent.
- Build the seam and event types now; **do not implement clearance until B9 returns.**

### Folded into existing features (no new number)

| Finding | Goes into |
| --- | --- |
| G5 escrow unique index | 14 |
| G10 application rate limit | 11 |
| G11 max-price ceiling | 07b |
| G13 Server Action rate limiting | 02 |
| G14 fast-check | 14 |
| G15 partition maintenance job | 39 |
| G16 dual payout dates in earnings UI | 23 |
| G19 `region` on every log/metric/span | 41 |
| G20 message-catalogue CI gate | 01 (already in CI) |
| G21 guarantee reframed as mediation + refund | 34 |

### Revised phase order

```
Phase 1  01 → 45 → 02 → 50 → 03 → 04
Phase 2  05 → 06 → 07 → 07a → 07b → 07c → 46 → 08
Phase 3  09 → 10 → 11 → 12 → 13 → 47 → 40
Phase 4  14 → 49 → 38 → 39 → 15 → 16 → 17
Phase 5  18 → 19 → 20 → 48 → 21 → 22 → 23
Phase 6  29 → 30 → 31 → 24 → 25 → 26 → 32–37 → 41 → 42 → 43 → 51
Phase 7  44 → 27 → 28
```

**54 features total** (47 + 45–51).

---

## Rules engaged

- **Rule 2 (PII)** — 45's region policies must not weaken the unlock gate; they compose with it.
- **Rule 4 (integer minor units)** — 45 makes multi-currency real in one database; every aggregate becomes per-currency.
- **Rule 6 (idempotent, atomic, balanced)** — "balanced" now means balanced *per currency*.
- **Rule 7 (RLS + negative test)** — region isolation needs its own negative test: a TR user must not read a KSA row.
- **Rule 10 (i18n)** — 46; locale stays independent of region.
- **Rule 3 (no external call in a request path)** — 51's clearance calls go through the outbox like everything else.

## Tests

- Region isolation: a TR user reading a KSA request is denied (RLS negative).
- Cross-currency posting is rejected by the database, not only by application code.
- Sum-to-zero holds **per `(region, currency)`**; a mixed-currency aggregate must fail loudly.
- Per-row tests for the cancellation matrix; property test for escrow conservation.
- Provider entity mismatch rejected before PSP onboarding.
- Deadline expiry: unlocked-then-abandoned request reaches a terminal state.

## Definition of Done

Per-feature, from `build-plan.md`. 45 additionally: every region-scoped table has a region policy
**and** its negative test in the same migration.

## Decisions

| # | Decision | Reversible |
| --- | --- | --- |
| D14 | Single deployment, `region` discriminator column | ❌ Very hard after Phase 3 |
| — | Feature numbering 45–51 and the revised phase order above | ✅ |

## Open questions

**Answered 2026-08-17 — the D14 doc rewrites are applied.**

1. ✅ **Accounts do not span regions.** A person in both markets creates a separate account. This
   dissolves G23 entirely: one account → one region → one currency → one balance. `provider_balances`
   keeps `provider_id` as its key and account paths need no currency segment.
2. ✅ **Admins are global** (D15). No `admin_region`, no region predicate in admin policies. ⚠️ Carries
   a known future cost: scoping a regional ops hire later means rewriting every admin policy against
   live data. Mitigation applied — admin actions record the affected `region` in `audit_log` from day
   one, so the data exists before the policy needs it.
3. ✅ **One provider, one PSP** — follows from (1). `providers.psp_submerchant_id` stays a single
   column rather than becoming a table.
4. ✅ **Simplicity** is the reason for the single deployment. Recorded, so the trade in D14 is
   revisitable against its actual motivation rather than a guessed one.
5. ✅ **`project-overview.md` §16 rewritten** — multi-region moved out of "out of scope" and into
   the shipped feature list.

**New, raised by answer (1):** **G27 — separate accounts per region collide with phone-based OTP
identity.** Supabase maps one phone to one identity, so the same number cannot register twice.
Largely self-solving (a TR account uses `+90`, a KSA account `+966`), and the proposed fix is to
validate the dialling code against the chosen region at signup. **One residual product call:** a Saudi
resident holding a Turkish number is blocked by strict validation. Admin override, or accept at
launch? I have not chosen.

## Out of scope

- Currency conversion between regions. One request, one currency, always.
- Cross-region provider matching or requests.
- Implementing ZATCA clearance (gated on B9).
- Any UI theming (B4).
