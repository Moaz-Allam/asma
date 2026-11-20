# 0011-16. Admin operations (position 16, P1)

Child of [0011](index.md). Follows the cross child contract there. **Touches personal data and money reports.**

> **Amended 2026-11-20 (D197)** against what 06 to 15 built (spec 0010, 0011-07 to 0011-15, D168 to D196), the way
> 0011-10 to 0011-15 were amended. There is no `selections` and no `request_events` table: a pick is the request's
> `selected_application_id` with its `payment_deadline` and `fee_deadline` on `requests` (06, 09), and every move writes
> one `audit_log` row (`entity.past_verb`), which 13's `audit_log_email` trigger may turn into mail. Flags are 12's
> `deadline_flags` (`start_late`, `completion_late`), raised by cron and cleared automatically; nothing writes
> `cleared_by` yet. Cancels go through 12's `cancel_by_rule` and its `cancellation_rules` matrix (admin rows:
> `COMMISSION_PAID`, `UNLOCKED`, `IN_PROGRESS`, all `by_hand`). 12's `/admin/requests/[id]` and `admin_request_detail`
> are the detail view; `/admin/requests` only redirects by id today. Admins are not scoped by region (`is_admin()` reads
> only the role). The ledger signs credits negative: revenue accounts carry negative amounts, refund accounts and
> `psp_fees` positive (07). No `aal2` exists yet (21). Every choice below is the recommended one, by the owner's
> standing rule (D183). Cross checked on Sonnet (16 findings, all applied as X-1 to X-16). **Where a rule below and an AC
> differ, the rule wins; an X rule wins over an R rule.** Accepted by the owner's standing rule, 2026-11-20.

## Amendment rules (D197)

- **R-1, all regions.** Admin sees every region (as 12 and 14 do); lists carry each row's `region` and accept an optional
  region filter. Dates are read in each row's own `regions.timezone`. This replaces "the admin's region" in AC-1 and the
  Value sourcing row "Admin region".
- **R-2, the request list.** `admin_requests(p_status text, p_region text, p_from date, p_to date, p_has_flag boolean,
  p_page integer)`: definer, `is_admin()` checked again, 20 a page, newest `created_at` first, ties by id, `total` for
  the pager. A row: `id`, `region`, `status`, `service_name`, `zone_name` (every locale), `created_at`,
  `scheduled_start_at`, `fixed_price`, `currency`, `timezone`, `open_flags` (kinds), `open_report` (boolean). No name,
  phone, address or note. `p_from` and `p_to` bound `created_at` by day in the row's time zone, at most 366 days apart;
  null means no bound. Search by id stays 12's form (`/admin/requests?id=` redirects to the detail page); the list page
  is `/admin/requests` without `id`.
- **R-3, the admin cancel.** `admin_cancel_request(p_request_id, p_attributed_to, p_reason)` calls `cancel_by_rule` with
  actor `admin` and action `request.admin_cancelled`. The migration adds `cancellation_rules` rows for actor `admin` in
  `OPEN` and `SELECTED` (allowed, commission `not_paid`, provider fee `not_paid`, counts against nobody), in both
  regions; `AWAITING_CONFIRMATION` and `COMPLETED` stay refused (`not_cancellable`): those close through 14's
  `handle_report`. `p_attributed_to` is `customer`, `provider` or `platform`; `p_reason` is 10 to 500 characters. Both go
  only to the audit row's `new_value` (`requests.cancel_reason` stays null, its check allows only the customer's codes).
  `cancelled_by` is `admin`. Nothing is refunded automatically (every admin row is `not_paid` or `by_hand`); the dialog
  lists each paid fee with a link to 12's refund action on the same page.
- **R-4, the cancel mail.** `request.admin_cancelled` maps to 13's `request_cancelled` template, to the customer
  (`leadCustomer`) and, when the request has a pick, to its provider (`leadProvider`); the `refund` line is never added
  (no automatic refund). `queue_audit_email` and the `audit_log_email` trigger are replaced from their latest bodies (14)
  plus this mapping. Mail stays off until S43.
- **R-5, the extension, once per pick.** `admin_extend_deadline(p_request_id, p_which, p_hours, p_reason)`, `p_which`
  `payment` (request `SELECTED`), `fee` (request `COMMISSION_PAID` with a pick) or `confirm` (request
  `AWAITING_CONFIRMATION`); `p_hours` 1 to 48; reason 10 to 500 characters. New columns: `applications.payment_extended_at`
  and `applications.fee_extended_at` (the pick's, so a new pick gets a fresh allowance with no change to 06's choose) and
  `requests.confirm_extended_at`. A second call for the same deadline raises `already_extended`. The new `payment` or
  `fee` deadline is at most `scheduled_start_at` (`deadline_after_start` otherwise); `confirm` has no cap. Audit
  `request.deadline_extended` with `which`, the old and new deadline and the reason; no mail (the pages show the new
  deadline).
- **R-6, the guards for R-5.** `requests_guard` (latest body, 14) gains one move: `payment_deadline` or `fee_deadline`
  later by 1 to 48 hours with no other change to the pick, only while the request is `SELECTED` or `COMMISSION_PAID`
  respectively; `confirm_deadline` already moves forward under 14's rule. `applications_guard` (latest body, 12) lets
  `payment_extended_at` and `fee_extended_at` go from null to a value once, never back. `expire_windows`,
  `expire_request` and `auto_close_jobs` read the live columns, so they honour the new deadline unchanged.
- **R-7, the flag queue.** `admin_flags(p_page integer)`: open flags oldest `raised_at` first, 20 a page, each with
  `id`, `kind`, `raised_at`, `request_id`, `region`, `request_status`, `timezone`. `admin_clear_flag(p_flag_id, p_note)`
  sets `cleared_at`, `cleared_by = auth.uid()` and the note (10 to 500 characters); a flag already cleared raises
  `already_cleared`; audit `request.flag_cleared`. `raise_deadline_flags` (replaced from 12) never raises again a
  `(request, kind)` that admin cleared by hand (`cleared_by is not null`). The queue is also reachable from the request
  page's flags list (a Clear button per open flag).
- **R-8, the street line.** `admin_request_address(p_request_id)` returns `request_addresses.line` only when the
  request's pick has `unlocked_at` or the request has a `problem_reports` row (any status); else `not_available`. Each
  call writes one audit row `request.address_viewed` (no line in it). The button calls a Server Action that returns the
  line to a client component, so nothing is cached or rendered on the server page. No phone.
- **R-9, the revenue lines.** `admin_revenue(p_from date, p_to date, p_grain text)` groups `ledger_entries` by
  `ledger_journals.region`, `currency` and the day or month of `ledger_entries.created_at` in that region's time zone:
  `commission_revenue` and `provider_fee_revenue` as the negated sums, `commission_refunds`, `provider_fee_refunds` and
  `psp_fees` as the sums, `net = revenues - refunds - psp_fees`; `late_received` (the negated negative `refunds_due`
  entries) and `late_refunded` (the positive ones) shown apart and never in `net`. `p_grain` is `day` (range at most 92
  days) or `month` (at most 24 months); anything else `validation_failed`. Integer minor units, summed as `bigint`.
  pgTAP proves the signs with one paid and one refunded fee.
- **R-10, the CSV.** `GET /api/admin/revenue?from=&to=&grain=` (Route Handler): `requireRole('admin')`, the same rows
  through the same door, `text/csv`, `Cache-Control: no-store`, header row, amounts as decimal text built from minor
  units by integer division (no float, rule 4), file name `revenue-<from>-<to>-<grain>.csv`. No personal data and no
  free text, so no formula injection. The `aal2` check is 21's (it adds it to every admin route); this route is listed
  in 01's action guard test as a guarded route, not a machine endpoint.
- **R-11, doors.** `lib/admin-requests/` (12's door) gains `listRequests`, `cancelRequest`, `extendDeadline`,
  `showAddress`, `listFlags`, `clearFlag`; a new `lib/admin-revenue/` holds `loadRevenue` and `revenueCsv`. Strict
  schemas, each function checks `is_admin()` again in Postgres. No amount is ever sent.
- **R-12, the rail.** `ADMIN_RAIL` gains `requests`, `flags` (with an open count badge, like reports) and `revenue`;
  the phone tabs stay three, so `ADMIN_LINKS` carries them below `lg`.
- **R-13, tests.** pgTAP 33 for every function: customer, provider and anon refused; each state of the cancel matrix;
  the extension once per pick, its caps and guards; the hand clear not raised again; the address rule and its audit row;
  the revenue signs, grains and ranges; the grants. e2e for the list, cancel, extend, clear and the CSV (test numbers
  after 43), axe at 390px in three locales.
- **R-14, no analytics event.** Admin actions are audited, not tracked.

## Cross check rules (Sonnet, 2026-11-20)

Cross checked on Sonnet the same day: 16 findings (6 Major, 10 Minor, no Critical), all applied below. **An X rule wins
over an R rule.**

- **X-1, the cancel's audit row** (Major, R-3). `cancel_by_rule` is replaced (latest body, 12) with a seventh argument
  `p_meta jsonb default null`, merged into its audit row's `new_value`; its three callers keep six arguments.
  `admin_cancel_request` passes `{attributed_to, reason}`. `audit_log` stays append only.
- **X-2, an open card page** (Major, R-3). The admin cancel raises `checkout_open` while `attempt_open()` is true for the
  request's commission or the pick's provider fee, as the customer's and provider's cancels do; admin waits for the page
  to end.
- **X-3, the applications guard base** (Major, R-6). `applications_guard` is replaced from its latest body, 14's
  (`20261126090000_report_problem.sql`), which keeps `COMPLETED -> STARTED`.
- **X-4, the requests guard edits** (Major, R-6). Three edits to 14's `requests_guard`: `confirm_extended_at` joins both
  exclusion arrays of the top "other columns unchanged" check; a carve out in the pick tuple check lets
  `payment_deadline` alone move later while `SELECTED`; a carve out in the `fee_deadline` check lets it alone move later
  while `COMMISSION_PAID`. Each carve out requires status, `selected_application_id`, `selected_at` and the other
  deadline unchanged and the new value within X-5's band. pgTAP proves each passes alone and fails with any other change.
- **X-5, the extension's base** (Major, R-5). The new deadline is `greatest(old, now()) + p_hours`. `payment` and `fee`
  raise `deadline_after_start` when that passes `scheduled_start_at`; a request no longer in the deadline's state raises
  `invalid_state`. `*_extended_at` is set only on success, in the same update.
- **X-6, the confirm allowance** (Minor, R-5). Once per request: `confirm_extended_at` is not reset by 14's return to
  work.
- **X-7, why once per pick holds** (Minor, R-5). An ended pick's application is final (`applications_guard`) and
  `(request_id, provider_id)` is unique, so one application row is one pick. A reminder already sent for a window
  (13, keyed per application) is not sent again after an extension: accepted, since R-5 sends no mail.
- **X-8, counts against** (Minor, R-3). The new admin rows use `counts_against = 'admin_attribution'`, as 12's admin
  rows do.
- **X-9, a replay** (Minor, R-3). A second admin cancel on a request already `CANCELLED` by admin returns
  `{status: 'ok', replayed: true}` and writes nothing; cancelled by anyone else, `not_cancellable`.
- **X-10, the mail list** (Minor, R-4). `request.admin_cancelled` joins both the trigger's `when` list and
  `queue_audit_email`'s map, and pgTAP 29's mapping check gains it. A paid commission is refunded only by 12's action,
  which sends its own `fee_refunded` mail.
- **X-11, PSP fees in net** (Major, R-9). `psp_fees` counts every journal, late ones included: a late payment's PSP fee
  is a real cost the platform keeps. `net` subtracts it. pgTAP covers a late payment refunded.
- **X-12, buckets and ranges** (Minor, R-9). Only buckets with entries are returned. Both ends are inclusive days; `month`
  grain widens them to whole months. A refund is dated by its own day, so a bucket's `net` can be negative.
- **X-13, the address** (Minor, R-8). The rule is only the pick's `unlocked_at` (a report exists only after the reveal).
  Admin reading the line is the owner approved admin path of AC-5, outside rule 2's two parties. `p_reason` (10 to 500
  characters) is required and goes to the audit row.
- **X-14, the CSV route** (Minor, R-10). 01's action guard test finds the route by itself; the handler catches
  `AuthRefusal` and answers 401 or 403. Amounts reuse `formatMinor` (`lib/money/parse.ts`) if it handles a negative value
  with two decimals (TRY and SAR), else a helper beside it with unit tests. `lib/admin-revenue/` joins the door table in
  `AGENTS.md` at the merge.
- **X-15, the flag clear** (Minor, R-7). `admin_clear_flag` locks the flag row `for update` before it checks
  `cleared_at`, so it never races the cron clear into `flag_immutable`. The hand clear latch is permanent per
  `(request, kind)`.
- **X-16, the AC text** (Minor). AC-1, AC-3, AC-5 and AC-7 are patched below to the rules.

## Summary

Admin gets a request list with filters, a queue of late start and late completion flags, three manual actions (cancel with
attribution, extend a deadline, clear a flag), a way to view a street line on click (audited), and a revenue report from
the ledger by day or month with a CSV download for the accountant. 12's request page is the detail view for all of it.

## Requirements

**User stories**:
- As admin, I want to find any request and act on it with a recorded reason, so that stuck jobs get unstuck.
- As the owner, I want revenue per day and month from the ledger, so that the books match what iyzico paid.

**Prerequisites**: 15 merged (2026-11-20, `4677c70`). Branch `feat/16-admin-operations`.

**Acceptance criteria** (the rules above win where they differ):
- **AC-1**: `/[locale]/admin/requests` (admin): requests of every region (R-1), filters by status, region, created
  date range and "has open flag", newest first, 20 a page; search by id through 12's form; no name, address or phone
  (R-2).
- **AC-2**: `admin_cancel_request(p_request_id, p_attributed_to, p_reason)` for any state before
  `AWAITING_CONFIRMATION`: `cancelled_by` `admin`, attribution (`customer`, `provider`, `platform`) stored on the
  cancel's audit row (X-1), reason required; no fee is refunded automatically except what `cancellation_rules` row
  11 says (nothing); admin refunds separately with 12's action. The cancel dialog lists every paid fee and, for a paid
  commission, links straight to the refund action. Audited.
- **AC-3**: `admin_extend_deadline(p_request_id, p_which, p_hours, p_reason)`: `p_which` one of `payment`, `fee`,
  `confirm`; 1 to 48 hours from `greatest(old, now())`; once per pick (`applications.payment_extended_at`,
  `applications.fee_extended_at`) or per request (`requests.confirm_extended_at`), a second call refuses
  `already_extended`; `payment` and `fee` never past `scheduled_start_at`; reason required; audited as
  `request.deadline_extended` (R-5, R-6, X-4 to X-7).
- **AC-4**: `/[locale]/admin/flags`: open flags oldest first; `admin_clear_flag(p_flag_id, p_note)` sets `cleared_at`,
  `cleared_by`, note; audited.
- **AC-5**: On the request page, Show address calls `admin_request_address(p_request_id, p_reason)`, allowed only when
  the pick has `unlocked_at`; each call writes one `audit_log` row with the reason and never the line; the line
  reaches only a client component through a Server Action, never cached (R-8, X-13).
- **AC-6**: `/[locale]/admin/revenue`: by day or by month for a chosen range, per region and currency: commission
  revenue, provider fee revenue, commission refunds, provider fee refunds, PSP fees, net (revenue minus refunds minus
  PSP fees), all summed from `ledger_entries` by `admin_revenue(p_from, p_to, p_grain)`. `refunds_due` is shown apart
  and never counted as revenue.
- **AC-7**: `GET /api/admin/revenue` (Route Handler, `requireRole('admin')`; 21 adds `aal2`) returns the same rows as
  CSV with amounts as decimal text from minor units (integer formatting, rule 4), a header row and `no-store`; the
  file name holds the range (R-10, X-14).
- **AC-8**: The admin rail lists Requests, Flags, Reports, Revenue with counts for open flags and reports.
- **AC-9**: Every admin action has a negative test for a customer and a provider token; three locales, axe at 390px, e2e
  for cancel, extend, clear and the CSV.

## Feature design

**Data model** (R-5): three nullable columns, `applications.payment_extended_at`, `applications.fee_extended_at`,
`requests.confirm_extended_at`; `cancellation_rules` rows for admin in `OPEN` and `SELECTED` (R-3). The audit row's
`new_value` carries the attribution and the extension. Migration `20261128090000_admin_operations.sql`.

**API surface**: `admin_requests`, `admin_cancel_request`, `admin_extend_deadline`, `admin_flags`, `admin_clear_flag`,
`admin_request_address`, `admin_revenue` (admin, `is_admin()`); replaced `requests_guard`, `applications_guard`,
`raise_deadline_flags`, `queue_audit_email` and the `audit_log_email` trigger (R-4, R-6, R-7); the CSV route.

**Value sourcing**:

| Value | Source |
| --- | --- |
| Revenue lines | `ledger_entries.account` sums, per `ledger_journals.region`, `currency`; signs as in R-9 |
| Day boundaries | `regions.timezone` of each row's region (R-1) |
| Region shown | each row's own `region` column (R-1) |
| Cancel attribution, extension | the audit row's `new_value` (R-3, R-5) |
| Extension allowance | `applications.*_extended_at` of the pick, `requests.confirm_extended_at` (R-5) |
| Address | `request_addresses.line`, behind R-8's rule |

**Security model**: admin only, region scoped by the admin's profile; street lines on click, audited; the CSV carries no
personal data.

## Build plan

1. Tests first, then the migration (functions only); satisfies **AC-2** to **AC-7**.
2. List, flags, revenue pages and the CSV route; satisfies **AC-1**, **AC-6** to **AC-8**.
3. e2e; reviews with `security-reviewer`; merge; satisfies **AC-9**.

## Consequences

- Positive: support work needs no SQL editor.
- Negative: every admin sees every region (R-1); a per region admin role is a later change if KSA gets its own team.
- Neutral: cut list: the revenue report is the first thing cut from 16 if time runs out; the flag queue stays.

## Rationale

The report reads the ledger, not the fee rows, so it always matches what the books prove; an extension limit of once and
48 hours keeps a manual action from replacing the windows.
