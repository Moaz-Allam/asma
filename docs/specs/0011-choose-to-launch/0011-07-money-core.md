# 0011-07. Money core, database only (position 07)

Child of [0011](index.md). Follows the cross child contract there. **High risk: money.**

> **Amended 2026-11-18 (D169)** against what 05 (spec 0009) and 06 (spec 0010) built, as D168 asks: the chosen
> application is the pick (there is no `selections` table); AC-1 to AC-3 were not built in 05 and are built here; the
> pgTAP files are 18 and 19. New AC-0; changed AC-1 to AC-4, AC-13, AC-14, the lock order and the value sourcing.
> Cross checked on Sonnet the same day (12 findings, all applied as the rules R-1 to R-12 below) and accepted by the
> owner 2026-11-18. **Where a rule below and an AC differ, the rule wins.**

## Summary

This position builds the money tables and functions in Postgres with no screen and no PSP call: a row per fee, a row per
card page opening, an append only ledger (a book of balanced money lines that is never edited), the outbox the relay will
read, and a table of every fact the PSP sends us. Every money function is idempotent (running it twice gives the same
result), atomic and balanced. It also cleans up 00b's dead escrow flags. The fee settings and the fee formula land
here too: 05 did not carry them (D167), and no page shows a fee figure before 10 (0009 D147).

## Requirements

**User stories**:
- As the owner, I want every fee payment and refund recorded once in a balanced ledger, so that money is provably right.
- As the relay (08), I want one set of database functions to apply verified PSP facts, so that no other code writes money.

**Prerequisites**: 06 merged (PR #32). Branch `feat/07-money-core`. One migration, `money_core`, after 06's
`20261118090000_choose_provider`, builds AC-0 to AC-15.

**Acceptance criteria**:
- **AC-0** (D169): the pick is the request's `SELECTED` application (`requests.selected_application_id`, spec 0010).
  `applications` gains `provider_fee_amount` (bigint null, `>= 0`) and `provider_fee_kind` (`percent` or `fixed`, null),
  null together, written only on the move `APPLIED → SELECTED` and never changed after (`applications_guard` widened, for
  every role). `choose_provider` is replaced to set both from `provider_fee_for(region, fixed_price)` and the setting in the
  same transaction, after its standing check; a missing or malformed setting refuses the choose `fee_settings_invalid`
  (alert). Rows already `SELECTED` locally are back filled; the cloud has none.
- **AC-1**: Settings `provider_fee_kind` (`percent` or `fixed`), `provider_fee_value` (integer: percent 0 to 100, or
  minor units) and `fee_min_minor` (integer ≥ 0, a whole multiple of `price_rounding_minor`) exist per region with row
  checks; a missing or malformed key makes every reader refuse `fee_settings_invalid` and alert. Seeds: `percent`, 5,
  1000, all ☐ until S17.
- **AC-2**: `provider_fee_for(p_region, p_price)` (definer, stable, integer arithmetic only): percent → `p_price ×
  value / 100` rounded half up to `price_rounding_minor` in one step; fixed → `value`; then raised to `fee_min_minor`
  and capped at `p_price`. Callable by `authenticated` (it reveals no formula, only a setting). A seeded loop of 2,000
  prices proves: result ≥ min(`fee_min_minor`, price), ≤ price, a whole multiple of the rounding unit unless capped.
- **AC-3**: `pricing_split` (04; 05's migration only added the R10 B1 refusal, so the floor is new here) raises the
  commission to `fee_min_minor` and caps it at the price (R-1), before `cash_due = fixed_price − commission_amount`. Requests stored before that change keep their
  figures (`requests_guard`). The 04 and 06 pgTAP cases that assert a split change in the same branch.
- **AC-4**: `fee_payments` exists as in the umbrella, with the two partial unique indexes. `open_fee(p_request_id,
  p_kind)` (internal, called by 09 and 10's pay functions) returns the existing row for that (request, kind, provider) or
  creates it `pending` with the amount from `requests.commission_amount` or, for the provider fee, the
  `provider_fee_amount` of the request's selected application, and the request's currency. `fee_payments` names the
  pick by `application_id` (FK `(application_id, request_id)` to `applications (id, request_id)`) in place of the
  umbrella's `selection_id`. A row's amount, kind, payer, application and request never change.
- **AC-5**: `checkout_attempts` exists; `start_checkout(p_fee_payment_id)` (internal) inserts a `queued` attempt and an
  outbox `checkout.initialize` row with key `checkout:<attempt_id>:init`, in one transaction.
- **AC-6**: `ledger_journals` and `ledger_entries` exist. `update`, `delete` and `truncate` are revoked from every API
  role and refused by trigger for every role, `postgres` included (rule 5). A deferred constraint trigger refuses a
  commit where a journal's entries do not sum to zero or a journal has fewer than two entries.
- **AC-7**: `post_journal(p_kind, p_key, p_currency, p_region, p_legs jsonb)` (internal, no API grant) inserts a journal
  and its legs; a second call with the same key returns the stored response and inserts nothing; a second call with the
  same key and different legs raises `idempotency_conflict` and alerts.
- **AC-8**: `apply_fee_paid(p_fee_payment_id, p_attempt_id, p_psp_payment_id, p_amount, p_currency, p_psp_fee)`
  (service role only, called by the relay with whatever it retrieved) locks the request row, then the fee row (umbrella
  lock order), and:
  - when the same `p_psp_payment_id` was already applied (as paid or as late): returns the stored result (replay);
  - otherwise asks the kind's state check `accept_<kind>(fee, attempt)` **before any change** (09 and 10 write them; in
    07 a test stub accepts when the fee is `pending`);
  - accepted, with amount and currency equal to the fee's: sets `paid`, `paid_at`, `psp_payment_id`,
    `psp_fee_amount`, the attempt `succeeded`, posts the paid journal (key `fee:<id>:paid`), then runs the kind's
    transition (09, 10);
  - not accepted, or a mismatch: the fee stays as it was; posts `late:<psp_payment_id>:received` to `refunds_due`,
    inserts a `fee_refunds` row of kind `late` and its outbox `refund.request`, and alerts `late_payment_refunded` (or
    `reconcile_mismatch` for an amount or currency difference).
  - `p_psp_fee` missing from the retrieve result: posted as 0 and alerted `reconcile_mismatch`, so the daily reconcile
    corrects it with a new posting.
- **AC-9**: `fee_refunds` exists (umbrella table; 12 adds the reasons and admin paths). `apply_fee_refunded(
  p_fee_refund_id, p_psp_refund_id)` (service role only) locks in the umbrella order and, once: sets the refund `done`;
  for kind `fee` sets the fee `refunded` and posts `fee:<id>:refund`; for kind `late` posts `late:<psp_payment_id>:refund`
  from `refunds_due`. A replay returns the stored result. A fee and a PSP payment are each refunded at most once.
- **AC-10**: `outbox_events` exists. `enqueue_outbox(p_kind, p_key, p_payload)` (internal) is idempotent by key.
  `claim_outbox(p_limit, p_worker)` (service role only) claims due `pending` rows, and `claimed` rows whose 2 minute lease
  passed, with `for update skip locked`. `finish_outbox(p_id, p_ok, p_error)` sets `done`, or schedules the next try at
  1, 5, 30, 120, then 720 minutes and sets `failed` after the sixth try.
- **AC-11**: `psp_events` exists. `record_psp_event(p_source, p_event_key, p_payload)` (service role only) inserts once
  per (source, event key) and returns whether it was new. Payloads pass a key filter: no card data field is stored (the
  hosted page never sends us one; the filter is a second line).
- **AC-12**: `ledger_check(p_region)` (service role and admin) returns every (currency, account) total and every
  imbalance: per journal, per region and currency, a `paid` fee with no paid journal or more than one, a `refunded` fee
  with no refund journal. It returns no rows when the books are right.
- **AC-13**: Read access: a payer reads their own `fee_payments` rows (status, amount, paid time; never `psp_fee_amount`);
  the request's customer and the selected application's provider read the status of the other side's fee only as `paid` or not
  (through 09 and 10's views); `ledger_*`, `outbox_events`, `psp_events` have no API read except admin through
  `ledger_check` and 16's report. Negative tests for every other role (rule 7).
- **AC-14**: Property test: random sequences of open fee, start checkout, apply paid (with replays and duplicates),
  apply refunded (with replays) against the local stack keep `ledger_check` empty, every fee paid at most once and
  refunded at most once, and no not accepted payment ever sets a fee `paid` (umbrella U-2). Two session races: two
  `apply_fee_paid` calls for one fee with different PSP payments commit one `paid` and one `late`; a customer cancel (06's
  `cancel_request`) and a payment for the same request at once finish in one order, never a deadlock (12 adds expiry).
  Lock order (D169): the `requests` row, then its `applications`, then `fee_payments`, then `fee_refunds`.
- **AC-15**: The 00b flags `funding_enabled`, `unlock_enabled`, `payouts_enabled`, `auto_release_enabled` and
  `late_cancel_cutoff_hours` are deleted; `hold_hours` becomes `confirm_window_hours` with its value (D95).
- **AC-16**: The write guard rule `commission-netted` allows the cash due calculation only in `lib/pricing`, with a guard
  suite case that a copy in another file is blocked (D96).


## Amendment rules (D169, cross check 2026-11-18)

- **R-1, the floor and the cap.** The commission is `round(price × percent / 100 / unit) × unit` (04), then raised to
  `fee_min_minor`, then capped at `price − price % unit` (the price rounded down to the unit), all with the same
  `price_rounding_minor` read once. A price below the floor gives a commission equal to that capped price and a cash due
  that may be 0; this is allowed and tested. `provider_fee_for` follows the same cap. 04's case "the smallest price: the
  commission can be 0" (pgTAP 12) changes to the new figure in the same branch.
- **R-2, the settings.** Row checks: `provider_fee_kind` in (`percent`, `fixed`); `provider_fee_value` an integer, 0 to
  100 for `percent`, 0 to 100,000,000 minor units for `fixed`; `fee_min_minor` an integer 0 to 100,000,000. A deferred
  constraint trigger checks across keys, in both directions, that `fee_min_minor` and a `fixed` value are whole multiples
  of `price_rounding_minor` (so changing the unit later is refused too). The `pricing_settings_guard` pattern (no delete,
  no rename, no region move) covers the three new keys. A `fixed` value is still raised to the floor and capped.
- **R-3, alerts.** SQL never sends an alert. `fee_settings_invalid` and `idempotency_conflict` are raised as errors; the
  door that maps them (`lib/requests` for the choose, the relay for its calls) calls `raiseAlert` with a new reason each.
  `apply_fee_paid` and `apply_fee_refunded` return an `alerts` array (`late_payment_refunded`, `reconcile_mismatch`) in
  their result, write one `audit_log` row with ids only, and the relay (08) raises each alert.
- **R-4, the frozen fee (AC-0).** `applications_guard` lets `provider_fee_amount` and `provider_fee_kind` change only when
  `old.status = 'APPLIED'`, `new.status = 'SELECTED'` and the old values are null; any other change raises
  `application_immutable`. A check holds them null together; they stay null on every row that was never chosen. The
  back fill of local `SELECTED` rows runs before the new guard is created. `choose_provider` reads the fee settings at
  step 4 beside `choose_settings` (so it refuses before any application lock), computes the fee from `v_req.fixed_price`
  after the standing check, and sets the two columns in the same statement that marks the chosen row `SELECTED`. The
  replay at step 2 is unchanged. A test proves the fee never changes after the choose, even when the settings change.
- **R-5, locks and the reopen.** `apply_fee_paid` reads the fee's `request_id` without a lock, locks the `requests` row,
  then re-reads the fee `for update`, then the application, and checks that the attempt belongs to the fee; `p_amount`
  and `p_psp_fee` are bigint minor units (the relay converts with `lib/money/parse`). It never takes a provider lock. Note
  for 12: a reopen after `COMMISSION_PAID` must restore `NOT_SELECTED` rows to `APPLIED` (spec 0010 follow up) and clear
  the request's three choose columns; the frozen fee stays on the old row, and a new choose freezes a new one.
- **R-6, the accept stubs.** 07 ships `accept_commission(p_fee uuid, p_attempt uuid)` and `accept_provider_fee(p_fee uuid,
  p_attempt uuid)` returning `false` (every payment goes the late path until 09 and 10 replace them). Tests replace them
  inside their own transaction with versions that accept a `pending` fee on a `SELECTED` request. 07 does not change
  `cancel_request`; 09 and 12 decide what a cancel does to an open checkout attempt, and the real payment against cancel
  race is 09's.
- **R-7, fee rows.** `application_id` is null for the commission (it is carried across picks) and required for the
  provider fee (a check). `payer_id` is the request's customer for the commission and the application's provider for
  the provider fee. Unique: one commission per request; one provider fee per (request, provider). `open_fee` checks state
  or raises `invalid_state`: the commission needs `SELECTED`; the provider fee needs `COMMISSION_PAID` and the selected
  application. A guard keeps `amount`, `kind`, `payer_id`, `application_id`, `request_id` unchanged, moves status only
  `pending → paid → refunded`, refuses delete and truncate for every role, and a check requires `psp_payment_id` and
  `paid_at` on a `paid` row. `psp_payment_id` is unique in `fee_payments` and in `fee_refunds`.
- **R-8, the ledger.** `apply_fee_paid` and `apply_fee_refunded` build the legs themselves from the umbrella chart (the
  revenue or refund account by fee kind); `post_journal` has no API grant and is never given legs from outside the
  database. `ledger_entries` carry `region` and `currency`, one region and one currency per journal (a check through the
  journal). `p_psp_fee` must be `0 <= fee <= amount`, else it is treated as missing (posted 0, `reconcile_mismatch`). A
  late payment's journal has a null `fee_payment_id`.
- **R-9, PSP payloads and reads.** `record_psp_event` strips these keys at any depth before storing: `cardNumber`,
  `cardHolderName`, `cvc`, `cvv`, `expireMonth`, `expireYear`, `binNumber`, `lastFourDigits`, `cardToken`,
  `cardUserKey`, and any key containing `card`; a payload over 64 KiB is refused `payload_too_large`. The payer's read of
  `fee_payments` uses column grants that leave out `psp_fee_amount`.
- **R-10, retries.** `attempts` increments when a row is claimed; a lease that runs out and is claimed again counts as a
  new attempt; after the sixth claimed attempt fails, the row is `failed`.
- **R-11, the dead flags.** AC-15's change also edits `lib/flags/index.ts`, `lib/observability/alert.ts`,
  `tests/flags.test.ts`, the `tests/observability-*.test.ts` cases and `supabase/tests/03_flags_and_health.test.sql` in
  the same commit; `lib/flags` reads nothing new (11 reads `confirm_window_hours`).
- **R-12, one formula.** Any fee estimate shown later (0009 D147, 10) calls `provider_fee_for` with the same inputs, so
  the figure a provider sees matches the frozen one.

## Decision

All money state lives in Postgres behind internal or service role functions; the relay is their only caller. The PSP fee
comes from the verified PSP result, never a setting. One fee row per fee, many checkout attempts.

## Feature design

**Data model**: `fee_payments` (with `application_id` in place of `selection_id`, AC-4), `checkout_attempts`,
`fee_refunds`, `ledger_journals`, `ledger_entries`, `outbox_events`, `psp_events` (umbrella tables); two columns on
`applications` (AC-0). Accounts are a check constraint on `ledger_entries.account` with the seven names of the umbrella chart.

**State transitions**: fee `pending → paid → refunded`; attempt `queued → ready → succeeded | failed | abandoned`;
outbox `pending → claimed → done | pending (retry) | failed`.

**API surface** (all `security definer`, `search_path` empty, granted only as said):

| Function | Grant | Inputs | Output | Errors |
| --- | --- | --- | --- | --- |
| `provider_fee_for` | authenticated, service_role | region, price | fee | `fee_settings_invalid` |
| `open_fee`, `start_checkout`, `enqueue_outbox`, `post_journal` | none (called inside other definer functions) | see AC | row id | `invalid_state`, `idempotency_conflict` |
| `apply_fee_paid`, `apply_fee_refunded`, `claim_outbox`, `finish_outbox`, `record_psp_event` | service_role | see AC | result jsonb | `not_found`, `amount_mismatch` |
| `ledger_check` | service_role, admin through `is_admin()` | region | imbalance rows | `forbidden` |

**Value sourcing**:

| Value | Source |
| --- | --- |
| Commission fee amount | `requests.commission_amount` |
| Provider fee amount | `applications.provider_fee_amount` of `requests.selected_application_id`, frozen at the choose (AC-0) |
| Provider fee at the choose | `provider_fee_for(requests.region, requests.fixed_price)` and the `provider_fee_kind` setting |
| Currency | `requests.currency` |
| PSP fee | `p_psp_fee` from the relay, read from the verified retrieve result |
| Retry schedule | constants in `finish_outbox` (1, 5, 30, 120, 720 minutes, 6 tries) |

**Key invariants**: journals balance; ledger rows never change; a fee's amount never changes; at most one paid and one
refund journal per fee; integer minor units everywhere (rule 4).

**Security model**: no API role writes any of these tables; `authenticated` runs only `provider_fee_for` and its own
reads. The service role is used only by the relay route and jobs (door rule).

**Critical test scenarios**: replay of a paid fact (AC-8); duplicate payment goes to `refunds_due` (AC-8, AC-14); a direct
`update` of a ledger row fails even as `postgres` (AC-6); an unbalanced journal fails at commit (AC-6); a customer token
reads no ledger, outbox or PSP event (AC-13); the guard blocks a cash due copy outside `lib/pricing` (AC-16).

## Build plan

1. Tests first (pgTAP `18_money_core`, the meta tests for append only and grants), then the migration; satisfies **AC-4**
   to **AC-13**, **AC-15**.
2. The fee settings, `provider_fee_for`, the commission floor and the pick columns with the replaced `choose_provider`,
   tested in the same file, and the 04 and 06 cases that assert a split or a choose updated; satisfies **AC-0** to
   **AC-3**.
3. The property tests against the local stack and the races in pgTAP `19_money_races` (dblink); satisfies **AC-14**.
4. Write guard change and its suite case; satisfies **AC-16**.
5. `npm run db:types`; docs (`architecture.md` money section as built); owner push after a dry run; reviews including
   `security-reviewer`; merge.

## Consequences

- Positive: 08 to 12 only call functions; correctness is proven in the database where it is enforced.
- Negative: no visible feature in this PR; the late payment path adds a seventh account.
- Neutral: settlement into the bank is not posted (we do not see the bank); reconciliation compares only (08).

## Rationale

Keeping every money write behind a few service role functions makes rules 3, 5 and 6 checkable by meta tests instead of
by review. A separate `refunds_due` account keeps a payment we must return out of revenue, so the revenue report never
counts it.
