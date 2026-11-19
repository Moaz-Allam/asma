# 0011-15. Provider jobs and fees history (position 15, P1)

Child of [0011](index.md). Follows the cross child contract there. **Read only, but it touches money figures and the
provider's own rows: a migration (one function), the provider door, one page.**

> **Amended 2026-11-20 (D195)** against what 06 to 14 built (spec 0010, 0011-07 to 0011-14, D168 to D194), the way
> 0011-10 to 0011-14 were amended. There is no `selections` table: a provider's job is their application with
> `unlocked_at is not null` (10). The fee is a `fee_payments` row with `kind = 'provider_fee'`, `payer_id` the provider
> and `application_id` the application; its amount equals the fee frozen on the pick (`applications.provider_fee_amount`,
> 07). A fee of 0 opens no row at all (D171). A refund is a `fee_refunds` row (`kind = 'fee'`, `fee_payment_id`), with
> status `queued`, `failed`, `done` or `done_by_hand` (12); after the reveal only admin refunds, by hand (12, 14). The
> receipt page `/receipts/[feeId]` already serves any payer through `my_receipt` (09), the provider included. My jobs
> is `/provider/applications?tab=...` with the tabs `applied`, `chosen`, `active`, `done` (05, 11). The design's P9
> («المحفظة», balances and withdrawal) is the closest screen; only its list and filter layout is used (rule 9, D91).
> Every choice below is the recommended one, by the owner's standing rule (D183). Cross checked on Sonnet the same day
> (14 findings: 4 Major, 10 Minor, no Critical); 13 applied as X-1 to X-13, one declined (the e2e numbers do end at
> 41). **Where a rule below and an AC differ, the rule wins; an X rule wins over an R rule.** Accepted by the owner's
> standing rule, 2026-11-20.

## Amendment rules (D195)

- **R-1, what a row is.** One row per application of the caller with `provider_id = auth.uid()` and
  `unlocked_at is not null`, whatever its later status (`UNLOCKED`, `STARTED`, `COMPLETED`, `CONFIRMED`, `RATED`,
  `CANCELLED`). An application that never unlocked (not picked, expired pick, late payment) is not a row; a late
  payment's refund (`fee_refunds.kind = 'late'`) is out of scope (Follow-up).
- **R-2, the month.** `p_month` is any day of the month asked for; the function takes `date_trunc('month', p_month)`.
  A row belongs to a month by `requests.scheduled_start_at` read in `regions.timezone` of the request's region. The
  month must lie between the current month and 11 months before it, in that time zone; anything else returns
  `{ "status": "month_invalid" }`. Null means the current month.
- **R-3, the fee per row.** The `fee_payments` row with `kind = 'provider_fee'`, `application_id` = the row's
  application and `status in ('paid', 'refunded')`. None: the fee is 0 (D171, the frozen `provider_fee_amount` is 0) and
  there is no receipt id. The figure is `fee_payments.amount`, never recomputed.
- **R-4, the refund per row.** The `fee_refunds` row with `kind = 'fee'` and that `fee_payment_id` (unique per payment,
  `fee_refunds_psp_payment_unique`). `refund_state` is `none`, `pending` (`queued` or `failed`) or `done` (`done` or
  `done_by_hand`); `refund_amount` is its amount only when `done`. The refund reason and the admin are never returned.
- **R-5, the totals.** Over every row of the month (not only the rows returned): `jobs` (count), `fees_paid` (sum of
  R-3 figures), `refunds` (sum of `done` refund amounts), `net_fees` (`fees_paid - refunds`), `cash_completed` (sum of
  `requests.cash_due` over rows whose request is `COMPLETED`). All integer minor units in the region's currency, summed
  in Postgres (rule 4). No total is named or worded as earnings, a balance or anything held (rule 9).
- **R-6, the cash per row.** `requests.cash_due`, labelled as the cash the customer pays the provider in person. A
  cancelled request still shows its figure, struck through and left out of `cash_completed`.
- **R-7, one function, own rows only.** `provider_history(p_month date)`: `security definer`, `set search_path = ''`,
  `stable`, the caller from `auth.uid()` only (no provider id argument). No caller or no `providers` row returns
  `{ "status": "forbidden" }`. Any provider standing may read it (a suspended provider still sees what they paid).
  Granted to `authenticated` only; revoked from `public`, `anon`, `service_role`. No table grant or policy changes.
  The ledger is never read.
- **R-8, the row cap.** At most 200 rows, newest `scheduled_start_at` first, ties by application id; `truncated`
  is true when the month has more. Totals still cover the whole month (R-5).
- **R-9, the returned shape.** `{ status: 'ok', month, timezone, currency, months: [12 month starts, newest first],
  totals: {...}, truncated, rows: [{ application_id, request_id, scheduled_start_at, service_name (every locale, as
  `my_receipt` returns it), application_status, request_status, cash_due, fee_amount, receipt_id, refund_state,
  refund_amount }] }`. No customer name, phone, address, district or note: the history is money, not contact data.
- **R-10, the door and the page.** `loadHistory(month)` in `lib/provider-feed/` (the provider's door) wraps the
  function with a strict schema, the 05 pattern. The page `/[locale]/provider/history` calls `guardPage(['provider'])`,
  reads `?month=YYYY-MM` (anything else falls back to the current month), and formats every figure with `MoneyDisplay`
  and every date with the returned time zone. No client side arithmetic.
- **R-11, links.** Each row links to My jobs on the tab its application status belongs to (`active` for `UNLOCKED`,
  `STARTED`, `COMPLETED`; `done` otherwise), through one pure helper next to `JOB_TABS` that reuses 11's sets. A row
  with a `receipt_id` links to `/receipts/<receipt_id>`.
- **R-12, navigation.** `history` joins `PROVIDER_NAV` (the `lg` header and the links on `/provider`), not the phone
  tabs (three at most, ui-rules §13).
- **R-13, the word test.** A unit test fails when any string under `History.*` in `ar`, `tr` or `en` contains a banned
  word: en `balance`, `wallet`, `withdraw`, `earning`, `payout`, `held`; tr `bakiye`, `cüzdan`, `para çek`, `kazanç`;
  ar `رصيد`, `محفظة`, `سحب`, `أرباح`. Matching folds case without a Turkish locale (rule 10).
- **R-14, no analytics event and no mail.** Viewing history is not tracked and sends nothing.

## Cross check rules (Sonnet, 2026-11-20)

- **X-1, future months** (Major, R-2). A job can be scheduled after the current month, so a fee already paid would sit
  in no valid month. The valid months (and `months` in the result) run from 11 months before the current month through
  the latest month that holds one of the caller's rows, at most 12 months after the current month, newest first.
- **X-2, errors are raised, the 05 convention** (Major, R-7, R-10). The function starts with `provider_reader()`
  (05; it raises `forbidden` unless the caller's profile has role `provider` and a `providers` row) and raises
  `validation_failed` for a month outside X-1. The success shape is R-9 without `status`. `loadHistory` maps the codes
  through `PROVIDER_FEED_DB_CODES`, as the other provider reads do. This replaces R-7's JSON statuses.
- **X-3, cancelled and closed are the request's status** (Major, R-5, R-6). A row is struck through when
  `request_status = 'CANCELLED'` (a cancel after the reveal, by either side, cancels the request). The cash total is
  `cash_closed`: the sum of `cash_due` over rows whose request is `COMPLETED` (confirmed by the customer or closed
  automatically), labelled "cash from closed jobs". Finished work still waiting for the customer's confirmation is not
  in it; the page says so under the figure. This replaces R-5's `cash_completed`.
- **X-4, a pending refund** (Major, R-4, R-5). `fees_paid` counts every paid fee in full, including one whose refund is
  queued or failed; `refunds` counts only `done` refunds; `net_fees` is labelled "after completed refunds". A row with a
  pending refund shows "refund in progress" and no amount.
- **X-5, the fee of 0 is proved, not inferred** (Minor, R-3). `fee_amount` is `coalesce(fee.amount,
  a.provider_fee_amount)`. pgTAP proves that every row with a fee row has `fee.amount = a.provider_fee_amount`, and
  that an unlocked application with no fee row has `provider_fee_amount = 0`.
- **X-6, the fee join** (Minor, R-3). Join on `fee_payments.application_id = a.id` and `kind = 'provider_fee'`. A
  provider has at most one fee row per request (`fee_payments_one_provider_fee_idx`, 07), so the join needs no `limit` or
  `distinct`.
- **X-7, one region, one currency** (Minor, R-9). Rows are only those with `a.region` equal to the caller's
  `providers.region`; `currency` and `timezone` come from that region. pgTAP proves every summed fee row and request
  carries that currency.
- **X-8, the month bounds** (Minor, R-2). One time zone, the caller's region's. Month start `m` is
  `date_trunc('month', p_month)`; a row is in the month when `scheduled_start_at >= (m at time zone tz)` and
  `< ((m + interval '1 month') at time zone tz)` (half open); the current month is `date_trunc('month', now() at time
  zone tz)`.
- **X-9, months are job months** (Minor). Every figure is grouped by the job's scheduled start, not by `paid_at` or a
  refund's finish time. The page says "by job date" next to the month picker, so a total never reads as monthly cash
  flow.
- **X-10, provider standing** (Minor, R-7). Any standing passes `provider_reader()` (pending, approved, suspended,
  rejected); a provider with no unlocked jobs gets an empty month.
- **X-11, the cap** (Minor, R-8). The 200 row cap stays for launch (Consequences). `truncated` is
  `count(*) > 200` over the month's rows. pgTAP seeds 201 rows with `generate_series` in one statement.
- **X-12, the nav label is word tested** (Minor, R-12, R-13). The menu label lives at `History.nav` and the nav reads it
  from there, so R-13's test covers it.
- **X-13, one tab helper** (Minor, R-11). The helper takes 11's sets from one shared constant next to `JOB_TABS`
  (`provider_jobs` in `20261123090000_work_and_close.sql` puts `COMPLETED` in `active`); a unit test proves the helper
  and that constant agree.

## Summary

A read only page for providers: each job they paid to unlock, with its date, service, the cash the customer pays
them in person, the fee they paid and any refund, plus month totals. There is no balance, no withdrawal and no top up
anywhere (D91, rule 9).

## Requirements

**User stories**:
- As a provider, I want to see what each job cost me and what it was worth, so that I know whether the platform pays off.

**Prerequisites**: 14 merged (2026-11-19, `376d333`). Branch `feat/15-provider-history`.

**Acceptance criteria** (the R rules above win where they differ):
- **AC-1**: `provider_history(p_month date)` returns the caller's own unlocked applications for that month (R-1, R-2)
  with date, service name, cash value, fee paid, refund state and amount, and the request state (R-3, R-4, R-6, R-9),
  plus month totals (R-5), at most 200 rows (R-8).
- **AC-2**: `/[locale]/provider/history` shows the month with a month picker (the 12 returned months, newest first),
  the totals, and the rows; each row links to My jobs and, when a fee was paid, to its receipt (R-10, R-11). An empty
  month shows `EmptyState`. The page is in `PROVIDER_NAV` (R-12).
- **AC-3**: No word or figure on the page reads as a balance, earnings, money held, withdrawal or wallet; the word test
  (R-13) passes in three locales.
- **AC-4**: Another provider, a customer, admin and anon get nothing of another provider's rows; pgTAP negative tests,
  plus a test that the function takes no provider id and reads only `auth.uid()`.
- **AC-5**: Three locales, axe at 390px, e2e with fixture jobs across two months (one with a done refund, one with a
  fee of 0, one cancelled).

## Feature design

**Data model**: none new. Reads `applications`, `requests`, `regions`, `services`, `fee_payments`, `fee_refunds`.
Migration `20261127090000_provider_history.sql` adds only the function, its grants and comment.

**Value sourcing**:

| Value | Source |
|---|---|
| Row set | `applications` where `provider_id = auth.uid()` and `unlocked_at is not null` (R-1) |
| Month | `requests.scheduled_start_at` in `regions.timezone` (R-2) |
| Cash value | `requests.cash_due` (R-6) |
| Fee | `fee_payments.amount` of the paid or refunded `provider_fee` row; 0 when none (R-3, D171) |
| Receipt id | that `fee_payments.id` (the receipt number, 09 A-6) |
| Refund | `fee_refunds.amount` and status, `kind = 'fee'` (R-4) |
| Currency | `regions.currency` of the provider's region (one region per account) |
| Totals | sums in the function (R-5) |

**Security model**: own rows only, through the definer function (R-7); no new grant on any table; no contact data
in the result (R-9). pgTAP (`supabase/tests/32_provider_history.test.sql`) covers each refusal, the month bounds, a
fee of 0, a pending and a done refund, a cancelled job, the 200 row cap with whole month totals, and the grants.

**UI**: P9's list and filter layout, without its balance cards and withdrawal (rule 9). New components get rows in
`context/ui-registry.md` in the same change. Strings in `History.*`; `tr` lines carry the `[tr]` marker until
translated (D100).

## Decision

Compute at read in one definer function, over the fee rows, as above. **Implementation skills**: `supabase`,
`supabase-postgres-best-practices` (the function), `shadcn` (only if a primitive is missing).

## Build plan

1. Tests first: pgTAP 32 for the function (refusals, rows, months, totals, cap, grants); then the migration. Satisfies
   **AC-1**, **AC-4**.
2. The door `loadHistory` with its strict schema and unit tests; the tab helper (R-11) with its test; the word test
   (R-13). Satisfies **AC-3**.
3. The page, the nav entry, the strings in three locales, registry rows. Satisfies **AC-2**.
4. e2e (new test numbers after 41 in `e2e/numbers.ts` and `supabase/config.toml`) with axe at 390px. Satisfies
   **AC-5**. Local typecheck, lint, unit tests; GitHub's three checks; reviews (code on a different model;
   `security-reviewer` because it reads money rows); push the migration right before the merge.

## Consequences

- Positive: providers see their cost and value honestly, with no stored balance to drift from refunds.
- Negative: totals are computed per read (fine at launch volume); a month with more than 200 jobs shows only the newest
  200 rows (the totals stay whole).

## Follow-up

- Late payment refunds (`fee_refunds.kind = 'late'`, no fee row) are not shown; add them if providers ask.
- An export (CSV) of a month, if asked for.

## Rationale

Computing at read from the fee rows keeps one source of truth; a stored total would drift from refunds. One definer
function with no provider id argument keeps "own rows only" in one place that pgTAP can prove.
