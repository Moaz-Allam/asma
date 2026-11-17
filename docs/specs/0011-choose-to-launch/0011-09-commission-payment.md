# 0011-09. Customer pays the commission (position 09)

Child of [0011](index.md). Follows the cross child contract there. **High risk: money, a migration, personal data (the
payer's IP), and a change inside `lib/relay`.**

> **Amended 2026-11-17 (D175)** against what 06 (spec 0010), 07 (PR #35, `20261119090000_money_core`) and 08 (PR #38,
> `20261120090000_relay`, D173, D174) built, the way 0011-07 (D169) and 0011-08 (D173) were amended. Folds in D171 (a
> commission of 0 skips the card page), D172 (`payments_enabled`), 08's R-8 (the payer's IP and the locale on the
> attempt), 08's A-1 and S37 (the first real call), and R13's items for 09. The owner answered eight questions in chat
> (A-1 to A-8). Every AC changed: AC-2 now guards cancel, because 06 built no switch; AC-0, AC-1, AC-8 and AC-15, AC-16
> are new. Cross checked on Sonnet the same day (17 findings: 1 Critical, 6 Major, 10 Minor), applied as the rules
> R-1 to R-15 below. Accepted by the owner 2026-11-17. **Where a rule below and an AC differ, the rule wins.**

## Summary

In `SELECTED`, the request page shows the split (job price, the commission paid online now, the cash paid to the provider
after the job), the payment deadline and the agreement reminder, with a Pay button. Pay calls one database function that
opens the commission fee and a checkout attempt, or reuses a young one. A short pay page waits for the relay to open the
card page, then sends the browser there. Coming back, the callback lands on a return page that waits for the relay's
verified result. An accepted payment moves the request to `COMMISSION_PAID`, the chosen application to `AWAITING_FEE`,
and starts the provider's fee window. A commission of 0 skips the card page (D171). The customer gets a receipt page that
says plainly it is not a tax invoice.

## Requirements

**User stories**:
- As a customer, I want to see exactly what I pay now and what I pay in cash later, so that the cash model is clear.
- As a customer, I want a clear pending, success or failure state after the card page, so that I never pay twice by doubt.
- As a customer, I want a receipt, so that I can prove I paid.

**Prerequisites**: 08 merged (PR #38) and its migration in the cloud (S38). Branch `feat/09-commission-payment`. One
migration, `commission_payment`, after `20261120090000_relay`, builds AC-1 to AC-8 and AC-13. S24 for the final design
(else tokens and the old screens, umbrella). S16 for the agreement text (a draft marker until then, D100). Not needed
for the build or the local checks: S32, S33 and the S37 window (AC-16 needs them).

**Acceptance criteria**:
- **AC-0** (what 09 calls, as built): `open_fee(p_request_id, 'commission')` (internal, invoker: locks the request,
  returns an existing commission row whatever the request's state, and inserts a new one only in `SELECTED`, else
  `invalid_state`; so `pay_commission` step 3 carries the state guard); `payments_enabled(p_region)`
  (internal, fails closed); `checkout_settings(p_region)` (internal, `{hold_minutes, buyer_city}` or null);
  `apply_fee_paid` asks `accept_commission(p_fee, p_attempt)` before any change and calls `after_commission_paid(p_fee)`
  after the paid journal, both inside its transaction with the request and the fee locked (D169 order); `fail_attempt`
  and `lock_attempt` (internal); `isAllowedCheckoutUrl(url, hosts)` and `activeCheckoutHosts()` in `lib/payments`. No
  user path imports `lib/psp` or `lib/relay` (lint, D174). The payer's column grant on `fee_payments` leaves out
  `provider_id`, `psp_payment_id` and `psp_fee_amount`; 09 keeps it so (R13).
- **AC-1** (settings and the counter): `min_window_minutes` (60 ☐, an integer 1 to 1,440) and `checkouts_per_fee_hour`
  (10, an integer 1 to 100) per region, and `unlock_window_hours` (exists, 24 ☐) held to an integer 1 to 168, all by row
  checks under the `pricing_settings_guard` pattern. A missing or malformed key makes its reader refuse and alert:
  `unlock_settings_invalid` for the two window keys (a new `AlertReason`), `checkout_settings_invalid` for
  `checkouts_per_fee_hour`, which `checkout_settings` (replaced) returns as `checkouts_per_hour`. A table
  `action_counters (region, subject_id, action, window_start, count)`, primary key `(subject_id, action, window_start)`,
  RLS on with a deny policy and no API grant, is the umbrella's generic counter; 09 counts action `checkout` with the fee
  id as subject and the UTC hour as window.
- **AC-2** (cancel during a checkout, A-5): `cancel_request` is replaced. In `SELECTED` it refuses `checkout_open` while
  the commission fee has a `queued` or `ready` attempt started less than `checkout_hold_minutes` ago (locks: the request,
  then the fee; attempts are read). Otherwise it is 06's (spec 0010 AC-11). After the hold, cancel goes through; a payment
  that still lands is not accepted (AC-5) and is refunded as late. `COMMISSION_PAID` stays `not_cancellable` until 12
  adds its refund path. The cancel dialog shows "A card payment is in progress. Try again in a few minutes." on
  `checkout_open`.
- **AC-3** (`start_checkout` replaced, R-8 of 08): the migration drops `start_checkout(uuid)` and creates
  `start_checkout(p_fee_payment_id uuid, p_locale text, p_payer_ip inet)` (internal, no grant): 08's body (locks the
  request then the fee, a `pending` fee only, a `queued` attempt, the `checkout:<attempt_id>:init` outbox row,
  `relay_kick('drain')`) plus `locale` (`ar`, `tr`, `en`, else `validation_failed`) and `payer_ip` (null allowed) set in
  the insert. A pgTAP case proves the one argument version is gone. 10 calls the same function.
- **AC-4** (`pay_commission(p_request_id uuid, p_locale text, p_payer_ip text)`, definer, `search_path` empty, granted
  to `authenticated` only), in this order:
  1. Inputs: the locale in (`ar`, `tr`, `en`), else `validation_failed`; the IP cast to `inet` inside an exception block,
     anything invalid or longer than 45 characters becomes null (never an error).
  2. The request locked `for update` where `customer_id = auth.uid()`, else `not_found`.
  3. `COMMISSION_PAID` or later, or a commission fee already `paid`: `already_paid`. Any other state but `SELECTED`:
     `invalid_state`.
  4. `now() >= payment_deadline`: `deadline_passed`.
  5. `commission_amount = 0` (D171, A-2): AC-6's move at once; no fee row, no attempt, no switch or settings check;
     returns `{status: 'settled'}`.
  6. `payments_enabled(region)` false: `payments_disabled` (a new stable code).
  7. `checkout_settings(region)` null: `checkout_settings_invalid`.
  8. `open_fee(request, 'commission')`, then the fee row locked.
  9. A `queued` or `ready` attempt of the fee started less than `checkout_hold_minutes` ago is returned as it is:
     `{status: 'checkout', attempt_id, reused: true}`, nothing counted.
  10. One count in `action_counters`; above `checkouts_per_fee_hour`: `too_many_checkouts` (the raise rolls the count
      back).
  11. `start_checkout(fee, locale, ip)`: `{status: 'checkout', attempt_id, reused: false}`.

  One `audit_log` row (ids only, never the IP). Two presses at once: the second waits on the request lock and gets the
  first's attempt at step 9.
- **AC-5** (`accept_commission(p_fee, p_attempt)` replaced, stable, invoker): true only when the fee is a commission and
  `pending`, no `fee_refunds` row names it, the request is `SELECTED`, the attempt belongs to the fee and started at or
  before `payment_deadline`, `now()` is at or before `payment_deadline + checkout_hold_minutes`, and `now()` is before
  `scheduled_start_at` (A-1). A missing hold setting raises `checkout_settings_invalid`, so the relay retries and alerts
  and a real payment is never refunded for a missing setting. Anything else is false and 07's late path refunds the
  payment: after the window and the hold, after a cancel, after the start, a second payment for a paid fee, a mismatch.
- **AC-6** (`after_commission_paid(p_fee)` replaced, and the zero move): both call one internal function,
  `commission_settled(p_request_id)`, with the request already locked: the request `SELECTED → COMMISSION_PAID` with
  `fee_deadline = least(now() + unlock_window_hours, scheduled_start_at)`, raised to at least `now() +
  min_window_minutes` (the umbrella rule, A-1); the selected application `SELECTED → AWAITING_FEE` with
  `status_changed_at`; one `audit_log` row (ids and the deadline). `requests` gains `fee_deadline` (timestamptz, null,
  readable by the customer like the other columns). `requests_guard` is widened: `SELECTED → COMMISSION_PAID` is
  allowed, `fee_deadline` is written only on that move, and a check holds `fee_deadline` null or after `selected_at`.
- **AC-7** (`my_checkout(p_attempt_id)`, definer, stable, `authenticated`, A-4): the attempt's fee payer must be
  `auth.uid()`, else `not_found` (the same answer for an id that does not exist). Returns `{attempt_id, request_id,
  fee_kind, fee_status, status, reason, url, locale}`; `reason` is null, `late` (`late_payment`), `paused`
  (`payments_disabled`) or `failed` (any other reason); `url` only while the attempt is `ready` and started less than
  `checkout_hold_minutes` ago, else null. Never the token, the IP or a PSP payment id. `checkout_attempts` keeps no API
  grant. 10 reuses the function for the provider fee.
- **AC-8** (a late attempt is closed, A-7): when `apply_fee_paid` answers `status: 'late'`, the relay
  (`lib/relay/handlers.ts`, `verifyPayment`) calls `mark_checkout_failed(attempt, 'late_payment')`. The migration adds
  `late_payment` to the `failure_reason` check and to `fail_attempt`'s list (replaced). `reconcile_pending` keeps
  rechecking only `psp_failed` and `abandoned` attempts, so a late one is not asked again. A replayed verify gets
  `{changed: false}`. Unit tests in `tests/relay-handlers.test.ts`.
- **AC-9** (the door and the actions): `lib/requests` gains `payCommission`, `checkoutStatus` and `loadReceipt`, with
  strict schemas. Server Actions in `actions/payments.ts` run `guardedAction` for the `customer` role; `payCommission`
  takes the request id, reads the locale from the route and the IP from Vercel's `x-real-ip` header (else null).
  `checkoutStatus` returns `my_checkout`'s fields, and a URL leaves the server only when
  `isAllowedCheckoutUrl(url, activeCheckoutHosts())` passes, else `url` is null and `checkout_url_refused` is logged with
  the attempt id only. Codes map to typed results: `not_found`, `invalid_state`, `already_paid`, `deadline_passed`,
  `payments_disabled`, `too_many_checkouts`, `checkout_open`, `checkout_settings_invalid`, `unlock_settings_invalid`. A
  raw SQLSTATE never reaches a page.
- **AC-10** (the request page): in `SELECTED` before the deadline, 06's pay panel gains the split from `requests`
  (`fixed_price`, `commission_amount`, `cash_due`: "Job price", "Pay now online", "Pay in cash to the provider after the
  job"), the deadline in the region's time zone, the agreement reminder with a link to the terms (D92, draft until S16),
  for `ar` a note that the card page opens in English, and the button "Pay <commission>" ("Continue" for 0). 06's line
  "Payment opens here soon" goes. After the deadline: "The payment time ended", no button (12 reopens). Each action
  error has a message in three locales (`payments_disabled`: "Payments are paused. Try again later."). In
  `COMMISSION_PAID`: "Waiting for the provider to pay their fee, until <fee_deadline>", and a receipt link when a fee row
  exists. The timeline gains "Commission paid" (the time from the fee's `paid_at`, none for 0) and greys "Provider fee".
- **AC-11** (the pay page `/[locale]/pay/[attemptId]`): payer only (`not_found` is a 404). It says "Opening the secure
  card page" and polls `checkoutStatus` every second for up to 15 seconds; on a URL it calls
  `window.location.replace(url)`, so Back never lands on a page that bounces to the card page again. On `failed`,
  `paused` or the timeout it shows the message and Try again (which calls `payCommission`, reusing a young attempt). A
  fee already `paid` shows Success.
- **AC-12** (the return page `/[locale]/pay/[attemptId]/return`, A-3): 09 changes the 303 target of
  `lib/relay/callback.ts` from `/<locale>/pay/<attempt_id>` to this route, with its test. Payer only (404). Pending: it
  polls every 2 seconds for up to 2 minutes, then shows "We will update this page when iyzico confirms" and Refresh. The
  fee `paid`: Success with links to the request and the receipt (plus "A second payment was refunded" when this attempt
  is `late`). `late` with the fee still `pending`: "Your payment came after the time ended. It is refunded in full."
  `failed`: Failure with Try again while the deadline holds.
- **AC-13** (the receipt `/[locale]/receipts/[feeId]`, A-6): `my_receipt(p_fee_id)` (definer, stable, `authenticated`,
  payer only, else `not_found`, a 404) returns the fee id (the receipt number), kind, amount and currency, status (`paid`
  or `refunded`), paid time, the region's time zone, and the request's service and date. No PSP payment id (R13). The
  page shows them with "This is a payment receipt, not a tax invoice" until B9 decides invoicing.
- **AC-14** (analytics, D68): `payment_started: { fee: 'commission' | 'provider_fee' }` when `payCommission` returns a
  new attempt, and `payment_succeeded: { fee }` once when the return page first sees `paid`. No ids.
- **AC-15** (tests): pgTAP `21_commission_payment` (each refusal of `pay_commission` in its order, reuse, the counter,
  zero, payments off, a missing setting, `accept_commission` true and false for each condition, the fee window with the
  start cap and the floor, cancel refused and allowed, `my_checkout` and `my_receipt` denied to another customer, a
  provider and `anon`, no one argument `start_checkout`, grants) and `22_commission_races` (dblink: two pays, pay against
  cancel, apply against cancel, apply at the deadline plus hold). The tests that relied on 07's `false` stub (`18`, `20`,
  `tests/relay-handlers.test.ts`, `e2e/relay.spec.ts`) move their late case to a payment after the window (08 A-4 ends).
  Unit tests for the door and the actions. e2e on the fake in `ar`, `tr`, `en` at 390px with axe: success, failure then
  retry, slow (pending then success), duplicate (one paid, one refunded, both pages say so), late (the deadline moved
  into the past by a local test helper), zero commission, payments off, cancel refused during an open checkout, and
  another customer getting 404 on the pay, return and receipt pages.
- **AC-16** (the real call, A-8, S37): on a preview after S32 and S33, the owner runs a window of at most one hour with a
  fixed checklist. Open: Vault `relay_url` to the preview, `payments_enabled` true for `TR`, Vault `fake_psp_allowed`
  `true`. Run success, failure and a late payment. Close: delete `fake_psp_allowed`, `payments_enabled` false, `relay_url`
  back to production; read all three back. While it is open the risk is test data only: no real fee exists before
  launch, production runs `PSP_DRIVER=off`, and a production pay press in that hour gets a refused card page (its host
  list is empty). G3's checklist gains one line: the `fake_psp_allowed` secret is absent.

## Owner answers (D175, 2026-11-17)

Each picked the recommended option.

- **A-1, the fee window**: the umbrella rule with `min_window_minutes`, landing in 09; a commission after the job start
  is refunded as late.
- **A-2, a commission of 0**: the pay panel stays, with Continue; no fee row, no attempt, even with payments off.
- **A-3, the return route**: `/pay/<attemptId>/return`, the callback target changed by 09; the pay page leaves with
  `location.replace`.
- **A-4, the status read**: one definer function, `my_checkout`; no table grant.
- **A-5, cancel during a checkout**: refused `checkout_open` while an attempt is younger than the hold.
- **A-6, the receipt**: our fee id is the receipt number; no PSP payment id.
- **A-7, a late attempt**: the relay fails it `late_payment`.
- **A-8, the real call**: a time boxed S37 window with a checklist, and one G3 line.

## Author notes

- **N-1, the IP is the caller's word.** A customer calling `pay_commission` directly can pass any IP for their own
  attempt; it changes only that payment's fraud signal at iyzico. Accepted. It is never logged and is cleared 2 hours
  after the attempt started or finished (D174).
- **N-2, gaps until 12.** A `COMMISSION_PAID` request cannot be cancelled, a passed `payment_deadline` or `fee_deadline`
  moves nothing, and a pending commission row on a cancelled request stays `pending`. Before launch that is acceptable;
  12 owns each.
- **N-3, not built here.** The umbrella's `SELECTED → SELECTED` switch row and `request_events` stay unbuilt; the
  timeline reads columns (spec 0010 AC-10).
- **N-4, 08's A-4 ends.** With a real accept check, the end to end loop of 08 tests the late path with a payment after
  the window.

## Amendment rules (D175, cross check 2026-11-17)

Sonnet found 17 (1 Critical, 6 Major, 10 Minor), checked against the migrations and the relay, all applied below; one
(B-1 to B-11 of 08 match the code) needed no change. **A rule wins over an AC and over the author notes.**

- **R-1, the pick must still stand (Critical).** `accept_commission` also requires the application named by
  `requests.selected_application_id` to be `SELECTED` and `provider_standing(provider) = 'approved'`; else false, and the
  payment is refunded as late (a suspended provider could never pay their fee). `commission_settled` raises
  `invalid_state` when its application update changes no row.
- **R-2, a missing setting alerts at once.** `verifyPayment` catches `checkout_settings_invalid` and
  `unlock_settings_invalid` from `apply_fee_paid`, raises that alert on the first try and when the row fails, and retries
  by the schedule (joins AC-8's relay change and 08 AC-19's list). The money stays untouched until the setting is fixed.
- **R-3, a refunded payment is always shown.** A duplicate payment on the same attempt leaves it `succeeded`, and a late
  payment on a `failed` attempt keeps its first reason; neither can become `late_payment`. So `my_checkout` also returns
  `late_refund` (true when a `late` `fee_refunds` row exists for the attempt's request, created after the attempt
  started), and the return page (AC-12) shows the refund line from it, not from `reason` alone.
- **R-4, a commission of 0 counts as paid.** The commission side of the reveal is "`requests.commission_amount = 0` or the
  commission fee is `paid`" (D171). 10's unlock check and rule 2's contact check use this predicate; 09 adds a pgTAP case
  that a zero request reaches `COMMISSION_PAID` with no fee row, and states it in `architecture.md`'s money section.
- **R-5, a carried commission is 12's.** A re-pick with a paid commission goes `OPEN → COMMISSION_PAID` at the choose
  (umbrella, 12), so it never reaches `pay_commission`. Step 3's `already_paid` in `SELECTED` stays only as a defence.
- **R-6, the limit has its own reader.** `checkout_settings` is not changed; a new internal `checkout_limit(p_region)`
  returns `checkouts_per_fee_hour` or raises `checkout_settings_invalid`, read only by `pay_commission` step 10 (and 10's
  pay function). `cancel_request` with a missing hold setting fails safe: any `queued` or `ready` commission attempt counts
  as young (`checkout_open`), and it alerts `checkout_settings_invalid`.
- **R-7, every caller of the old `start_checkout`.** The commit that drops `start_checkout(uuid)` updates its callers:
  pgTAP `18_money_core`, `19_money_races`, `20_relay`, `e2e/relay.spec.ts`, and `lib/db/database.types.ts`
  (`npm run db:types`). No wrapper.
- **R-8, the fee window may pass the start.** The floor can put `fee_deadline` after `scheduled_start_at` by up to
  `min_window_minutes`, as the umbrella rule intends; 10's accept check reads `fee_deadline`, never the start. The
  `requests` check holds only `fee_deadline > selected_at`.
- **R-9, old counter rows.** `action_counters` rows older than 2 days are deleted by 21's `retention` task; until then
  they stay (a few rows per fee).
- **R-10, the IP is one address and never logged.** Step 1 also nulls an `inet` whose mask is not the full length
  (`/32` or `/128`). The scrubber (`lib/observability/scrub.ts`) gains `payer_ip` and `p_payer_ip`, with a test.
- **R-11, a stuck queued attempt.** When the relay is down, Try again returns the same `queued` attempt until the hold
  ends; the pay page then says "The card page is taking longer than usual. Try again in a few minutes."
- **R-12, the hold covers the token.** 08b's checklist (08 AC-4 (k)) gains: `checkout_hold_minutes` is at least the card
  page token lifetime, so a payment after a cancel past the hold cannot happen.
- **R-13, one 404.** The pay, return and receipt pages answer the same 404, with no redirect, for an id that does not
  exist and for someone else's id.
- **R-14, the counter's RLS.** `21_commission_payment` proves `action_counters` has RLS on, the deny policy, and no API
  grant (rule 7, negative test).
- **R-15, 08's B-12 is owed.** The callback target and the late attempt change are 09's own work, recorded in 08 as owed
  by 09, not as built.

## Decision

The customer never sees a paid state from the redirect: only the relay's verified result changes a page. One database
function per customer action, reads through payer only definer functions, and 07's accept and transition hooks filled
in under 07's lock order.

## Feature design

**Data model**: `requests.fee_deadline`; `action_counters`; settings `min_window_minutes` and `checkouts_per_fee_hour`
per region; `late_payment` in `checkout_attempts.failure_reason`. No new money table.

**State transitions**: request `SELECTED → COMMISSION_PAID`; application `SELECTED → AWAITING_FEE`; attempt `ready →
failed (late_payment)` after a late apply.

**API surface**:

| Function or action | Kind | Inputs | Outputs | Auth | Errors |
| --- | --- | --- | --- | --- | --- |
| `pay_commission` | definer | request id, locale, IP text | `{status, attempt_id, reused}` | customer of the request | `invalid_state`, `already_paid`, `deadline_passed`, `payments_disabled`, `too_many_checkouts`, `checkout_settings_invalid` |
| `my_checkout` | definer, stable | attempt id | status, reason, URL while young | payer | `not_found` |
| `my_receipt` | definer, stable | fee id | receipt fields | payer | `not_found` |
| `cancel_request` (replaced) | definer | request id, reason | `{status}` | customer | adds `checkout_open` |
| `start_checkout`, `accept_commission`, `after_commission_paid`, `commission_settled`, `fail_attempt` | internal | see AC | | none | |
| `actions/payments.ts`: `payCommission`, `checkoutStatus` | Server Action | request id / attempt id | typed result | `guardedAction('customer')` | mapped |

**Value sourcing**:

| Value | Source |
| --- | --- |
| Job price, commission, cash due | `requests.fixed_price`, `commission_amount`, `cash_due` (stored, never computed here) |
| Payment deadline | `requests.payment_deadline` (06) |
| Fee deadline | `requests.fee_deadline`, from `unlock_window_hours`, `min_window_minutes`, `scheduled_start_at` |
| Checkout hold | `checkout_hold_minutes` (08, 15 ☐) |
| Checkout limit | `checkouts_per_fee_hour` (10) |
| Payments on or off | `payments_enabled(region)` (08) |
| Attempt locale | the route's locale |
| Payer IP | Vercel's `x-real-ip` header, else null |
| Card page hosts | `activeCheckoutHosts()` (08) |
| Agreement line and link | D92 text (S16, draft until then), `terms_version` |
| Receipt number | `fee_payments.id` |
| Receipt service and date | the request's service name in the page locale (04's catalog read) and `scheduled_start_at` |
| Time zone | `regions.timezone` |

**Security model**: only the payer reads an attempt or a receipt, through definer functions; the card URL reaches only
the payer and only after the host check; no PSP payment id, token or IP leaves the database to a user. Money changes
only inside `apply_fee_paid`.

**Critical test scenarios**: a cancel during an open checkout is refused (AC-2); a payment after a cancel, after the
window plus hold, or after the start is refunded (AC-5); a missing setting never refunds a real payment (AC-5); two
presses make one attempt (AC-4); a commission of 0 reaches `COMMISSION_PAID` with no fee row (AC-4, AC-6); another
customer gets 404 on the pay, return and receipt pages (AC-7, AC-13); the late page stops spinning (AC-8, AC-12).

## Build plan

1. Tests first: pgTAP `21` and `22`, then the migration `commission_payment` (settings, `action_counters`,
   `fee_deadline`, the guard, `start_checkout`, `pay_commission`, `accept_commission`, `after_commission_paid`,
   `commission_settled`, `cancel_request`, `my_checkout`, `my_receipt`, `fail_attempt`); `npm run db:types`; satisfies
   **AC-0** to **AC-7**, **AC-13**.
2. The relay changes (late attempt, callback target) and the moved late tests; satisfies **AC-8**, **AC-12** (route),
   **AC-15** (moved cases).
3. The door, the actions and their unit tests; satisfies **AC-9**, **AC-14**.
4. UI: the pay panel with the split and `AgreementLine`, the pay page, the return page, the request page states, the
   receipt page, registry rows; satisfies **AC-10** to **AC-13**.
5. e2e and axe; satisfies **AC-15**. Owner push after a dry run, reviews with `security-reviewer`, merge. Then the S37
   window (**AC-16**).

## Consequences

- Positive: a payment is never shown as done before iyzico confirms it; a late payment says so and is refunded.
- Negative: a short pending wait after every card page; a cancel can wait up to the hold.
- Neutral: the pay, return and receipt pages and `my_checkout` serve 10 too.

## Rationale

Reusing a young attempt avoids two live card pages for one fee, the simplest way to stop double payment at the source;
07's late path handles the rest. Filling 07's two hooks keeps every money change inside `apply_fee_paid`, under one lock
order. Definer functions for the payer's reads keep 07's rule that no role reads a money table directly.
