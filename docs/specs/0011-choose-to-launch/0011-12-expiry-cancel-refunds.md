# 0011-12. Expiry, cancellation, fee refunds (position 12)

Child of [0011](index.md). Follows the cross child contract there. **High risk: money (refunds), a migration, the
lifecycle.**

> **Amended 2026-11-18 (D181)** against what 06 to 11 built (spec 0010, 0011-07 to 0011-11, D168 to D180), the way
> 0011-09 to 0011-11 were amended. There is no `selections` table: a pick is `requests.selected_application_id` with
> its application's status, so a pick that ends is the application `EXPIRED` or `WITHDRAWN` and the request back to
> `OPEN` with the selection columns cleared. There is no `request_events` table: each move writes one `audit_log` row.
> 07 built `fee_refunds`, `apply_fee_refunded` and the `refund.request` outbox kind; 08's relay sends refunds, retries
> them and marks a refund `failed` (`mark_refund_failed`); the settings `max_reselections` (3), `start_grace_hours` and
> `completion_grace_hours` (24) exist since 00. G1 is its own checklist (D180 A-1), not a prerequisite. Every choice
> below is the recommended one, by the owner's standing rule of 2026-11-18 ("always do recommended"). Cross checked
> on Sonnet the same day (15 findings: 3 Critical, 9 Major, 3 Minor), applied as R-1 to R-15 below, each the
> recommended fix. **Where a rule below and an AC differ, the rule wins.** Accepted by the owner's standing rule,
> 2026-11-18.

## Amendment rules (D181, cross check 2026-11-18)

- **R-1, `requests_guard` replaced** (X-1). Its transition list gains `SELECTED → OPEN`, `COMMISSION_PAID → OPEN`,
  `OPEN → COMMISSION_PAID`, `COMMISSION_PAID → CANCELLED`, `UNLOCKED → CANCELLED`, `IN_PROGRESS → CANCELLED`. The
  selection columns change on `OPEN → SELECTED` (06), on a reopen (all cleared, R-2) and on a carried re-pick
  (`OPEN → COMMISSION_PAID`, R-3); `fee_deadline` is written on `SELECTED → COMMISSION_PAID` (09) and on a carried
  re-pick, and cleared on `COMMISSION_PAID → OPEN`; `failed_picks` only grows, and only on `COMMISSION_PAID → OPEN`.
  A pgTAP case per new move and per refusal.
- **R-2, clearing a pick** (X-2). One update sets `selected_application_id`, `selected_at`, `payment_deadline` and
  `fee_deadline` to null together with the move to `OPEN`.
- **R-3, the carried re-pick** (X-3). `requests_selection_together` is replaced: `selected_application_id` and
  `selected_at` are null together; `payment_deadline` may be null when the commission is carried, and a check holds
  `status <> 'SELECTED' or payment_deadline is not null`. The existing order checks stay for non null values. The re-pick
  sets `selected_application_id`, `selected_at = now()`, `payment_deadline` null, and `fee_deadline` by 09's rule
  (`least(now() + unlock_window_hours, scheduled_start_at)`, raised to at least `now() + min_window_minutes`), through
  09's `unlock_settings`.
- **R-4, the re-pick's application** (X-4). In one transaction the application goes `APPLIED → SELECTED` (the provider fee
  frozen there, as 07's guard allows) and then `SELECTED → AWAITING_FEE`; `open_fee` is not called until the provider
  presses Pay (10). `applications_one_selected_idx` holds throughout.
- **R-5, the backfill** (X-5). The migration widens `requests_closed_by_valid` to `customer`, `provider`, `platform`,
  `admin`, `auto`; disables `requests_guard` for one update that sets `closed_at = cancelled_at`, `closed_by =
  cancelled_by` on every `CANCELLED` row without them; enables it; then adds the validated check.
- **R-6, `applications_guard` replaced** (X-6). It gains `APPLIED`, `SELECTED`, `AWAITING_FEE`, `UNLOCKED`, `STARTED` →
  `CANCELLED`; `SELECTED`, `AWAITING_FEE` → `EXPIRED` and `WITHDRAWN`; `APPLIED → WITHDRAWN`. Tests per move.
- **R-7, the customer's attempt in flight** (X-7). `withdraw_application` from `SELECTED` and the suspend's drop of a
  `SELECTED` pick refuse or skip while the customer's commission attempt is younger than `checkout_hold_minutes`
  (`checkout_open` for the withdraw; the suspend leaves that pick for `expire_windows`, which then reopens it).
- **R-8, the suspend's order** (X-8). `suspend_provider` locks the provider's affected requests in ascending id order,
  each request before its applications (D169). A young provider fee attempt is left to land; 10's `accept_provider_fee`
  refuses a suspended provider, so 07's late path refunds it.
- **R-9, fee rows after a pick ends** (X-9). The commission row stays as it is (`pending` or `paid`) and is reused by
  the next pick (`open_fee` returns it). A provider fee row of an ended pick stays `pending` and is never paid:
  `accept_provider_fee` refuses it (the application is no longer `AWAITING_FEE`), so a late payment on it is refunded
  by 07's late path. A test for each.
- **R-10, refund by hand** (X-10). `admin_mark_refund_done` requires the refund `failed`; it sets `done_by_hand`, posts
  the same journal `apply_fee_refunded` would (same key, so it is idempotent), sets the fee `refunded`, and audits the
  note. A later PSP success for it is refused by `apply_fee_refunded` and alerts `reconcile_mismatch` (08); a test.
- **R-11, the reason** (X-11). `fee_refunds.reason` holds a code (`customer_cancel`, `no_paid_pick`, `failed_picks`,
  `admin_refund`); the admin's free text (10 to 500 characters) goes only into the `audit_log` row.
- **R-12, a provider fee in flight at a customer cancel** (X-12). Allowed (the cancel is not held for a provider fee
  attempt); a payment that lands later is refunded by the late path. A race case in `28`.
- **R-13, `closed_by` on a cancel** (X-13). It equals `cancelled_by`; a check holds `status <> 'CANCELLED' or closed_by =
  cancelled_by`.
- **R-14, an unpaid `OPEN` request after its start** (X-14). Out of scope here; 04's list already shows it as passed.
  Recorded for 16.
- **R-15, more negative tests** (X-15). Each new guard refusal; no automatic refund after the reveal by any path;
  `withdraw_application` after the reveal; `provider_cancel_job` by anyone but the unlocked provider; RLS on
  `cancellation_rules` and `deadline_flags` (no API write; `deadline_flags` admin read only).

## Summary

Every way a request stops early. A payment window that passes reopens the request; a paid commission carries to the
next pick, and after `max_reselections` failed picks, or when the start passes with nobody paid, it is refunded.
Cancellation follows `project-overview.md` §36, stored as data. Refunds go through the relay and are retried; when the
PSP refuses for good, admin is alerted and records a refund by hand. Suspending a provider drops their unpaid picks.
Deadline flags show a job that did not start or finish. A small admin request page shows fees, ledger lines, refunds
and flags, with refund by hand.

## Requirements

**User stories**:
- As a customer, I want my commission back automatically when no provider pays, so that I never pay for nothing.
- As a customer, I want to cancel and see the exact refund before I confirm.
- As a provider, I want to withdraw from a request I can no longer take, before the reveal.
- As admin, I want to refund a fee by hand with a reason, and to finish a refund the PSP refused.

**Prerequisites**: 11 built (PR unmerged while its push is owed; stacked). Branch `feat/12-expiry-cancel-refunds`,
cut from `feat/11-work-and-close`. One migration, `expiry_cancel_refunds`, after `20261123090000_work_and_close`.

**Acceptance criteria**:
- **AC-0** (what 12 calls, as built): `fee_refunds` (07: kind `fee` needs `fee_payment_id`, one per fee by a unique
  index; kind `late`), `post_journal`, `enqueue_outbox('refund.request', 'refund:<id>', …)`, `apply_fee_refunded`
  (07, the relay's), `mark_refund_failed` (08), `open_fee` (a provider fee row per (request, provider), so a new pick
  gets its own), `choose_provider` (06), `cancel_request` (09's: refuses `checkout_open` during a young commission
  attempt), `commission_settled` (09), `suspend_provider` (02), `closed_at`/`closed_by` (10, 11),
  `contacts_visible` (10: the window counts from `coalesce(closed_at, cancelled_at)`), `pg_cron` (08).
- **AC-1** (columns, tables, settings): `requests.failed_picks` (integer, 0, never negative, written only by the moves
  below). `closed_by` gains `provider`, `admin`, `platform`. **R15 G-1, the `CANCELLED` half:** every `CANCELLED`
  request has `closed_at` and `closed_by` (a backfill from `cancelled_at`/`cancelled_by` first, then a validated
  check). `cancellation_rules (region, state, actor, allowed, commission_outcome, provider_fee_outcome,
  counts_against)`, primary key `(region, state, actor)`, RLS on, `authenticated` reads, no API write, seeded for
  `TR` and `KSA` with §36 rows 1 to 12 (actors `customer`, `provider`, `platform`, `admin`); the functions read it and
  never branch on their own. `deadline_flags (id, region, request_id, kind, raised_at, cleared_at, cleared_by, note)`,
  kinds `start_late`, `completion_late`, at most one open flag per (request, kind), RLS on, admin reads, no API
  write. The three settings get row checks (`max_reselections` 1 to 10; the two grace settings 1 to 168) and join the
  guard's required keys.
- **AC-2** (`expire_windows()`, cron every minute, no API grant): rows `for update skip locked`, at most 200 a run,
  each in its own subtransaction:
  1. `SELECTED` past `payment_deadline`, no commission attempt younger than `checkout_hold_minutes`: the application
     `EXPIRED`, the request `OPEN` with the selection cleared; `audit_log` `pick_expired` (§36 row 4, not a failed
     pick).
  2. `COMMISSION_PAID` past `least(fee_deadline, scheduled_start_at)`, no provider fee attempt younger than the hold:
     the application `EXPIRED`, the request `OPEN` with the selection cleared, `failed_picks + 1`; `fee_expired`
     (row 6); then AC-3.
  3. `OPEN` with a paid, unrefunded commission whose `scheduled_start_at` has passed: the request `CANCELLED` by
     `platform`, the commission refund queued (AC-7); `no_paid_pick` (row 7's edge, D180 umbrella answer).
- **AC-3** (the failed pick limit): when `failed_picks` reaches `max_reselections`, the same transaction cancels the
  request (`platform`) and queues the commission refund (row 7).
- **AC-4** (the carried commission, D90): `choose_provider` is replaced. On `OPEN` with a paid, unrefunded commission
  it moves straight to `COMMISSION_PAID`: the application `SELECTED → AWAITING_FEE` (the provider fee frozen as 07
  does), `selected_at`, `fee_deadline` from 09's rule, no payment step. Every refusal of 06 applies, `start_passed`
  included, and a provider who expired or withdrew on this request cannot be picked again (umbrella answer). A carried
  commission with no live applicant stays `OPEN` until the start (AC-2.3).
- **AC-5** (`withdraw_application(p_application_id)`, the provider): from `APPLIED` (no count), `SELECTED` (row 3: the
  request `OPEN`, counts against the provider) or `AWAITING_FEE` (row 6: the request `OPEN`, `failed_picks + 1`, then
  AC-3); the application `WITHDRAWN`; `audit_log` `provider_withdrew`. Refused `invalid_state` after the reveal (that
  is AC-6's provider cancel) and `checkout_open` while the provider's own fee attempt is young.
- **AC-6** (cancellation): `cancel_request` (customer) is replaced and `provider_cancel_job(p_request_id)` (the
  unlocked provider, `UNLOCKED` or `IN_PROGRESS`) is new. Both resolve `allowed` and the outcomes from
  `cancellation_rules` for (region, state, actor), set `CANCELLED`, `cancelled_*`, `closed_at`, `closed_by`, turn the
  live applications `CANCELLED`, and queue a commission refund only where the rule says `refund` (row 5, and an
  `OPEN` request with a carried commission reads the `COMMISSION_PAID` row). `AWAITING_CONFIRMATION` and later refuse
  `not_cancellable` (row 12). 09's `checkout_open` guard stays.
- **AC-7** (`queue_fee_refund(p_fee_id, p_reason, p_by)`, internal): for a `paid` fee only, inserts its one `fee`
  refund row and the `refund.request` outbox row in the same transaction; a second call returns the first. The amount is
  the fee's own; never an input.
- **AC-8** (`admin_refund_fee(p_fee_id, p_reason)`, admin, row 11): reason 10 to 500 characters (`reason_required`);
  allowed for a commission when the request is `CANCELLED` or `UNLOCKED` or later, for a provider fee when its
  application has `unlocked_at`; else `invalid_state`. One `audit_log` row, then AC-7. It never hides contacts (D90).
- **AC-9** (a refused refund): a refund 08 marks `failed` alerts `refund_failed` (08 raises it); the admin page lists
  it with "Refund this payment by hand in the PSP panel", and `admin_mark_refund_done(p_fee_refund_id, p_note)` sets
  `done_by_hand`, posts that refund's journal (`apply_fee_refunded`'s posting, by hand) and audits.
- **AC-10** (suspend, 02's function replaced): the provider's `APPLIED` applications become `WITHDRAWN`; a `SELECTED` or
  `AWAITING_FEE` pick becomes `WITHDRAWN` and its request `OPEN` (not a failed pick; the commission carries); `UNLOCKED`
  and later stay, with an `audit_log` row the admin page shows (10's A-5 already hides the customer's contacts).
- **AC-11** (`raise_deadline_flags()`, cron every 10 minutes): `UNLOCKED` past `scheduled_start_at +
  start_grace_hours` raises `start_late`; `IN_PROGRESS` past `scheduled_end_at + completion_grace_hours` raises
  `completion_late`. A flag clears by itself (`cleared_by` null, note `auto`) on start, done, close or cancel (11's
  functions are replaced to clear it). A cleared flag can be raised again.
- **AC-12** (`/[locale]/admin/requests/[id]`, admin): the request summary without the address, the pick and past picks
  (application statuses), fees with status, the request's ledger lines, refunds with status, flags, the `audit_log`
  timeline, and the actions of AC-8 and AC-9; `admin_request_detail(p_request_id)` (admin only) reads it. The admin
  home gets a "Find request by id" field.
- **AC-13** (tests): pgTAP `27_expiry_cancel_refunds`, one case per §36 row, the backfill and checks, each refusal;
  `28_cancel_races` (dblink): a cancel against a verified payment, the expiry against a payment in flight (held, then
  a later success refunded as late), two refunds of one fee (one row); a seeded property loop (as 07's) over random
  sequences proves a fee is refunded at most once, the commission is refunded automatically only by rows 5 and 7 and
  the start edge, never after the reveal, and the books balance. Unit tests for the doors and actions.
- **AC-14** (UI): Withdraw on My jobs (Applied and Chosen); the customer's and the provider's cancel buttons follow
  `cancel_preview(p_request_id)` (the caller may cancel, and the exact refund from the rules and the paid amount), shown
  in the dialog before confirming; a provider's late cancel leads the customer to "Post again" (04's repeat). e2e in
  three locales at 390px with axe: expiry (deadlines moved), carry and a new pick, three failed picks refunded, a
  cancel with refund, a provider late cancel.

## Decision

The cancellation matrix is a table the functions read; refunds are always queued to the relay; a refund the PSP refuses
ends with a recorded refund by hand, never silence. A pick that ends clears the request's selection rather than keeping
a history table: the applications keep the history.

## Feature design

**Data model**: `requests.failed_picks`; `cancellation_rules`; `deadline_flags`; `closed_by` widened; the `CANCELLED`
close check.

**State transitions**: request `SELECTED → OPEN` (row 4, row 3), `COMMISSION_PAID → OPEN` (row 6), `OPEN → COMMISSION_PAID`
(a carried re-pick), `COMMISSION_PAID → CANCELLED` (rows 5, 7), `OPEN → CANCELLED` by `platform` (start edge),
`UNLOCKED | IN_PROGRESS → CANCELLED` (rows 8, 9); application `SELECTED | AWAITING_FEE → EXPIRED | WITHDRAWN`, `APPLIED →
WITHDRAWN`, live applications `→ CANCELLED` on a cancel.

**API surface**:

| Function | Grant | Errors |
| --- | --- | --- |
| `expire_windows`, `raise_deadline_flags` | none (cron) | |
| `cancel_request` (replaced), `provider_cancel_job`, `withdraw_application`, `cancel_preview` | authenticated (own rows) | `not_found`, `not_cancellable`, `invalid_state`, `checkout_open` |
| `choose_provider` (replaced) | authenticated | 06's, plus `provider_not_eligible` |
| `admin_refund_fee`, `admin_mark_refund_done`, `admin_request_detail` | authenticated, `is_admin()` inside | `forbidden`, `invalid_state`, `reason_required` |
| `queue_fee_refund` | none (internal) | `invalid_state` |

**Value sourcing**:

| Value | Source |
| --- | --- |
| Refund shown before cancel | `cancellation_rules` + the paid fee's `amount` |
| Failed pick limit | `max_reselections` |
| Flag thresholds | `start_grace_hours`, `completion_grace_hours` |
| Who cancelled | the function (`customer`, `provider`, `platform`, `admin`) |

**Security model**: customers and providers act only on their own requests; admin actions need `is_admin()` and are
audited; refund amounts are never an input; no function moves job money (rule 9).

**Critical test scenarios**: a payment in flight at the deadline holds the expiry, then a later success is refunded
(AC-2, 07 AC-8); the third failed pick refunds once (AC-3); a cancel and a payment success at once leave a balanced
ledger and one refund (AC-7, AC-13); nothing refunds automatically after the reveal (AC-13).

## Build plan

1. Tests first: pgTAP `27`, `28` and the property loop, then the migration and the cron jobs; `npm run db:types`;
   satisfies **AC-0** to **AC-11**, **AC-13**.
2. Doors and actions, `cancel_preview` in the dialogs, Withdraw; satisfies **AC-14** (UI parts).
3. The admin request page; satisfies **AC-12**.
4. e2e; reviews with `security-reviewer`; PR; the owner pushes the migration later (deferred), then merge in order.

## Consequences

- Positive: every refund has one row, one journal and one audit trail; every cancel has an attribution and a close.
- Negative: a refund the PSP refuses needs a human; two more cron jobs to watch.
- Neutral: the matrix table makes a future policy change a data change plus a test.

## Rationale

§36 asks for the table as data so that each row is testable and nothing branches by accident; the hold before expiry
avoids taking a slot from a customer who is typing their card number.
