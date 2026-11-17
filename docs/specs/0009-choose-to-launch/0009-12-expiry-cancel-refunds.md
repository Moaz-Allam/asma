# 0009-12. Expiry, cancellation, fee refunds (position 12)

Child of [0009](index.md). Follows the cross child contract there. **High risk: money.**

## Summary

This position handles every way a request stops early. Windows that pass reopen the request; a paid commission carries to
the next pick, and after three failed picks, or when the start passes with nobody paid, it is refunded. Cancellation
follows the table in `project-overview.md` §36, stored as data. Refunds go through the relay and are retried; when iyzico
refuses for good, admin is alerted and records a refund by hand. Suspending a provider drops their unpaid picks. A small
admin request page shows fees, ledger lines and refunds, with a refund by hand action.

## Requirements

**User stories**:
- As a customer, I want my commission back automatically when no provider pays, so that I never pay for nothing.
- As a customer, I want to cancel and see the exact refund before I confirm.
- As admin, I want to refund a fee by hand with a reason, and to finish a refund iyzico refused.

**Prerequisites**: 11 merged; G1 passed. Branch `feat/12-expiry-cancel-refunds`.

**Acceptance criteria**:
- **AC-1**: `expire_windows()` runs every minute (`pg_cron`, no API grant), one request per transaction, skipping locked
  rows:
  - `SELECTED` past `payment_deadline` with no commission attempt younger than `checkout_hold_minutes`: selection
    `expired`, application `EXPIRED`, request `OPEN`, `active_selection_id` null, event `pick_expired` (row 4; not a
    failed pick).
  - `COMMISSION_PAID` past `fee_deadline` with no provider fee attempt younger than the hold: selection `expired`,
    application `EXPIRED`, request `OPEN`, `failed_picks + 1`, event `fee_expired` (row 6).
  - `OPEN` with a paid commission whose `scheduled_start_at` has passed: request `CANCELLED` by `platform`, commission
    refund queued, event `no_paid_pick` (§21 edge case).
- **AC-2**: When `failed_picks` reaches `max_reselections`, the same transaction cancels the request (`platform`) and
  queues the commission refund (row 7).
- **AC-3**: `choose_applicant` on an `OPEN` request with a paid commission goes straight to `COMMISSION_PAID`: the new
  selection gets `fee_deadline` (no `payment_deadline`), the application `AWAITING_FEE`, event `chosen` (D90). Every
  refusal of 06 AC-5 applies, `start_passed` included.
- **AC-3b**: A carried commission with no live applicant left stays `OPEN` and waits for new applicants until the start
  (AC-1, third bullet). This is the owner's choice of 2026-11-17 and overrides the "or no applicant left" wording of
  §36 row 7, which would refund at once.
- **AC-4**: `withdraw_application` from `AWAITING_FEE`: application `WITHDRAWN`, selection `withdrawn`, request `OPEN`,
  `failed_picks + 1`, event `provider_withdrew`; AC-2 applies.
- **AC-5**: `cancellation_rules` (per region, reference data, no write policy, seeded with §36 rows 1 to 12) holds for each
  (state, actor): allowed, commission outcome (`none`, `refund`), provider fee outcome (`none`), counts against
  (`nobody`, `customer`, `provider`), with `platform` rows for the system outcomes (rows 4, 6, 7 and the start edge
  case). `cancel_request` (customer), `provider_cancel_job` (provider, `UNLOCKED` and `IN_PROGRESS`) and
  `expire_windows` resolve the outcome from it and never from branching code; every cancel sets `closed_at`; an `OPEN` request with a carried commission
  uses the `COMMISSION_PAID` row (refund). `AWAITING_CONFIRMATION` and later refuse `not_cancellable`.
- **AC-6**: `cancel_preview(p_request_id)` returns, for the caller, whether they may cancel and the exact refund (amount
  or none) from the rules; the cancel dialog shows it before the user confirms. The provider's late cancel leads the
  customer to "Post again" (04 repeat) and to report (14).
- **AC-7**: `queue_fee_refund(p_fee_id, p_reason, p_by)` (internal) inserts the one `fee_refunds` row of kind `fee` for
  that fee and the outbox `refund.request` (key `refund:<fee_refund_id>`); a second call returns the first. Only
  `paid` fees can be refunded.
- **AC-8**: `admin_refund_fee(p_fee_id, p_reason)` (admin, row 11): reason required (10 to 500 characters), one
  `audit_log` row, then AC-7. Allowed only as the umbrella says: a commission when the request is `CANCELLED` or
  `UNLOCKED` or later, a provider fee for an `unlocked` selection; else `invalid_state`. After the reveal this is the
  only way a fee comes back (D90), and it does not hide the contacts.
- **AC-9**: A refund of either kind (`fee` or `late`) that fails after the last relay try is `failed` and alerts
  `refund_failed`; the admin request page lists it with "Refund this payment by hand in the iyzico panel", and
  `admin_mark_refund_done(p_fee_refund_id, p_note)` sets `done_by_hand`, posts the refund journal of its kind and
  audits.
- **AC-10**: Suspending a provider (02's function, extended): `APPLIED` applications become `WITHDRAWN` by `platform`; a
  `SELECTED` or `AWAITING_FEE` pick becomes `removed`, its application `WITHDRAWN`, the request `OPEN` (no failed pick,
  commission carries); `UNLOCKED` and later stay, with a `provider_suspended` event that the admin page shows.
- **AC-11**: `raise_deadline_flags()` every 10 minutes: `UNLOCKED` past `scheduled_start_at + start_grace_hours` →
  `start_late`; `IN_PROGRESS` past `scheduled_end_at + completion_grace_hours` → `completion_late`. Flags clear by
  themselves (`cleared_by` null, note `auto`) on start, done, close or cancel; 11's `customer_mark_done` clears them too.
  A cleared flag can be raised again (for example after 14 returns a job to work).
- **AC-12**: `/[locale]/admin/requests/[id]` (admin, `aal2` from 21): request summary without address, selections with
  outcomes, fees with status, the request's ledger lines, refunds with status, flags, the event timeline, and the actions
  of AC-8 and AC-9. The admin dashboard gets a "Find request by id" field.
- **AC-13**: One pgTAP test per §36 row; a property test over random sequences (choose, pay, expire, withdraw, cancel,
  refund, suspend) proves a fee is refunded at most once, the commission is refunded automatically only by rows 5 and 7
  and the start edge case, and never automatically after the reveal (umbrella U-2).
- **AC-14**: The provider's Chosen tab offers Withdraw in `AWAITING_FEE`; customer and provider cancel buttons follow
  `cancel_preview`; e2e in three locales for expiry (by moving deadlines), carry, three failed picks, cancel with refund,
  provider late cancel; axe at 390px.

## Decision

The cancellation matrix is a table the functions read; refunds are always queued to the relay; a refund iyzico refuses
ends with a recorded refund by hand, never silence.

## Feature design

**Data model**: `deadline_flags` (umbrella table; `fee_refunds` comes from 07), `cancellation_rules (region, state, actor, allowed,
commission_outcome, provider_fee_outcome, counts_against)` with primary key (region, state, actor).

**API surface**:

| Function | Grant | Errors |
| --- | --- | --- |
| `expire_windows`, `raise_deadline_flags` | none (cron) | |
| `cancel_request` (extended), `provider_cancel_job`, `cancel_preview` | authenticated (own rows) | `not_cancellable`, `invalid_state` |
| `admin_refund_fee`, `admin_mark_refund_done`, `admin_request_detail` | admin | `forbidden`, `invalid_state`, `reason_required` |

**Value sourcing**:

| Value | Source |
| --- | --- |
| Refund shown before cancel | `cancellation_rules` + the paid `fee_payments` amount |
| Failed pick limit | `max_reselections` |
| Flag thresholds | `start_grace_hours`, `completion_grace_hours` |

**Security model**: customers and providers act only on their own requests; admin actions need `is_admin()` and are
audited; refund amounts are never an input.

**Critical test scenarios**: payment in flight at the deadline holds expiry, then a later success is refunded (AC-1, 07
AC-8); third failed pick refunds once (AC-2); concurrent cancel and payment success leave a balanced ledger and one refund
(AC-7, AC-13).

## Build plan

1. Tests first (one per §36 row, the property test), then the migration; satisfies **AC-1** to **AC-11**, **AC-13**.
2. Actions and `lib/requests` additions; the dialogs; satisfies **AC-6**, **AC-14**.
3. Admin request page; satisfies **AC-12**.
4. e2e; owner push; reviews with `security-reviewer`; merge.

## Consequences

- Positive: every refund has one row, one journal and one audit trail.
- Negative: a refund iyzico refuses needs a human; the cron jobs add three schedules to watch.
- Neutral: the matrix table makes a future policy change a data change plus a test.

## Rationale

§36 asks for the table as data so that each row is testable and nothing branches by accident; the hold before expiry
avoids taking a slot from a customer who is typing their card number.
