# 0009-16. Admin operations (position 16, P1)

Child of [0009](index.md). Follows the cross child contract there. **Touches personal data and money reports.**

## Summary

Admin gets a request list with filters, a queue of late start and late completion flags, three manual actions (cancel with
attribution, extend a deadline, clear a flag), a way to view a street line on click (audited), and a revenue report from
the ledger by day or month with a CSV download for the accountant. 12's request page is the detail view for all of it.

## Requirements

**User stories**:
- As admin, I want to find any request and act on it with a recorded reason, so that stuck jobs get unstuck.
- As the owner, I want revenue per day and month from the ledger, so that the books match what iyzico paid.

**Prerequisites**: 15 merged. Branch `feat/16-admin-operations`.

**Acceptance criteria**:
- **AC-1**: `/[locale]/admin/requests` (admin): requests of the admin's region, filters by status, created date range and
  "has open flag", search by id, newest first, 20 a page; no address, no phone.
- **AC-2**: `admin_cancel_request(p_request_id, p_attributed_to, p_reason)` for any state before
  `AWAITING_CONFIRMATION`: `cancelled_by` `admin`, attribution (`customer`, `provider`, `platform`) stored on the
  `cancelled` event for metrics, reason required; no fee is refunded automatically except what `cancellation_rules` row
  11 says (nothing); admin refunds separately with 12's action. The cancel dialog lists every paid fee and, for a paid
  commission, links straight to the refund action. Audited.
- **AC-3**: `admin_extend_deadline(p_request_id, p_which, p_hours, p_reason)`: `p_which` one of `payment`, `fee`,
  `confirm`; 1 to 48 hours; once per deadline, stored as `selections.payment_extended_at`, `fee_extended_at` or
  `requests.confirm_extended_at` (a second call refuses `already_extended`); `payment` and `fee` never past
  `scheduled_start_at` (the umbrella window rule; `confirm` has no such cap); reason required; audited; an `extended`
  event.
- **AC-4**: `/[locale]/admin/flags`: open flags oldest first; `admin_clear_flag(p_flag_id, p_note)` sets `cleared_at`,
  `cleared_by`, note; audited.
- **AC-5**: On the request page, Show address calls `admin_request_address(p_request_id)`, allowed only when the request
  reached `UNLOCKED` or has an open report; each call writes one `audit_log` row; the line is never cached (`no-store`).
- **AC-6**: `/[locale]/admin/revenue`: by day or by month for a chosen range, per region and currency: commission
  revenue, provider fee revenue, commission refunds, provider fee refunds, PSP fees, net (revenue minus refunds minus
  PSP fees), all summed from `ledger_entries` by `admin_revenue(p_from, p_to, p_grain)`. `refunds_due` is shown apart
  and never counted as revenue.
- **AC-7**: `GET /api/admin/revenue` (Route Handler, `requireRole('admin')` with `aal2` from 21) returns the same rows as
  CSV with amounts as decimal text from minor units (integer formatting, rule 4) and a header row; the file name holds
  the range.
- **AC-8**: The admin rail lists Requests, Flags, Reports, Revenue with counts for open flags and reports.
- **AC-9**: Every admin action has a negative test for a customer and a provider token; three locales, axe at 390px, e2e
  for cancel, extend, clear and the CSV.

## Feature design

**Data model**: none new; `request_events.meta` carries the attribution and extension.

**API surface**: `admin_requests`, `admin_cancel_request`, `admin_extend_deadline`, `admin_clear_flag`,
`admin_request_address`, `admin_revenue` (admin, `is_admin()`); the CSV route.

**Value sourcing**:

| Value | Source |
| --- | --- |
| Revenue lines | `ledger_entries.account` sums, per `ledger_journals.region`, `currency` |
| Day boundaries | `regions.timezone` |
| Admin region | `profiles.region` of the admin |

**Security model**: admin only, region scoped by the admin's profile; street lines on click, audited; the CSV carries no
personal data.

## Build plan

1. Tests first, then the migration (functions only); satisfies **AC-2** to **AC-7**.
2. List, flags, revenue pages and the CSV route; satisfies **AC-1**, **AC-6** to **AC-8**.
3. e2e; reviews with `security-reviewer`; merge; satisfies **AC-9**.

## Consequences

- Positive: support work needs no SQL editor.
- Negative: per region admins cannot see the other region (fine while KSA is off).
- Neutral: cut list: the revenue report is the first thing cut from 16 if time runs out; the flag queue stays.

## Rationale

The report reads the ledger, not the fee rows, so it always matches what the books prove; an extension limit of once and
48 hours keeps a manual action from replacing the windows.
