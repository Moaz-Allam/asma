# 0011. From choosing a provider to launch (positions 06 to 16 and 21)

**Date**: 2026-11-17
**Status**: Accepted (confirmed by the owner 2026-11-17, after a cross check on a second model; D165, D166). Not built:
each child is built in its own position, in build plan order

## Summary

This umbrella spec covers everything after a provider applies: the customer chooses one, both sides pay their fee on the
iyzico card page, contact details open both ways, the job runs and closes, and every way it can stop early (expiry,
cancellation, refunds, reports). It also covers transactional email, the provider's history, the admin tools and the
hardening before launch. Each position (06 to 16, then 21) has its own child spec and its own pull request, built in build
plan order after 05. This file holds the contract every child shares: the state machine, the settings, the ledger, the
outbox (a table of pending side effects that a background worker carries out) and the new public endpoints.

## Structure

| Child | Position | What it decides |
| --- | --- | --- |
| [0011-06-choose-provider.md](0011-06-choose-provider.md) (superseded by [0010](../0010-choose-a-provider/index.md), D168) | 06 | Applicant list, choose and switch, payment deadline, withdraw, status timeline |
| [0011-07-money-core.md](0011-07-money-core.md) | 07 | Fee rows, provider fee frozen at choose, fee floor, ledger and postings, outbox, PSP events, idempotency |
| [0011-08-iyzico-relay.md](0011-08-iyzico-relay.md) | 08 | `lib/psp` door (fake and iyzico), relay route driven by `pg_cron`, callback and webhook, reconciliation, alerts, R5 fix |
| [0011-09-commission-payment.md](0011-09-commission-payment.md) | 09 | Customer pays the commission, pending page, receipt |
| [0011-10-provider-fee-reveal.md](0011-10-provider-fee-reveal.md) | 10 | Provider pays the fee, mutual reveal by RLS, My jobs page, contact lifetime |
| [0011-11-work-and-close.md](0011-11-work-and-close.md) | 11 | Start, done, confirm, auto close, customer closes the job |
| [0011-12-expiry-cancel-refunds.md](0011-12-expiry-cancel-refunds.md) | 12 | Expiry jobs, cancellation matrix, refunds, suspension effects, minimal admin request page |
| [0011-13-transactional-email.md](0011-13-transactional-email.md) | 13 | `lib/email` door, templates in three locales, email confirmation link, event to email map |
| [0011-14-report-problem.md](0011-14-report-problem.md) | 14 | Report a problem, photos, admin queue, warnings, the agreement statement goes live |
| [0011-15-provider-history.md](0011-15-provider-history.md) | 15 | Read only jobs and fees history |
| [0011-16-admin-operations.md](0011-16-admin-operations.md) | 16 | Request list, flag queue, manual actions, address view, revenue report and CSV |
| [0011-21-launch-hardening.md](0011-21-launch-hardening.md) | 21 | Admin TOTP, staging, backups and restore drill, load check, retention jobs, security review, wipe |

Out of this spec (P2, cut list): 17 ratings, 18 notification centre, 19 trust and quality, 20 invoicing. Where a child
leaves a slot for them (the reviews slot on the applicant card), the slot renders nothing until they exist.

## Prerequisites (not acceptance criteria)

- **05 is built and merged first.** It has no spec yet. Besides its own scope it must carry: the R10 "04 review carry overs"
  section with pgTAP (D143); the fee settings (`provider_fee_kind`, `provider_fee_value`, `fee_min_minor`) and the SQL
  function `provider_fee_for(region, price)` exactly as 0011-07 AC-1 and AC-2 define them, plus the commission floor in
  `pricing_split` (0011-07 AC-3), because 05 already changes `pricing_split` for R10 B1 and shows the fee estimate in the
  feed and on apply; the `applications` table with statuses `APPLIED` and `WITHDRAWN` and the column names this spec reads
  (`id`, `region`, `request_id`, `provider_id`, `status`, `message`, `created_at`); the Applied tab of the provider's My
  jobs page (0011-10 extends it); apply allowed only while the request is `OPEN`; before the reveal a provider reads only
  the short details of a request (no `notes`, no address); and **a provider needs a confirmed email to apply**, because
  the chosen provider has a 24 hour paid window and email is their only notice (13 confirms addresses; the account page
  asks for one). If 05 names things differently, its spec wins and this spec's children follow it.
- **Owner steps.** S1 (iyzico sandbox) before 08's iyzico adapter leaves the fake; S2 and live keys before G3; S4 and S5
  before 13 sends a real email; S16 before 14's agreement text and the retention periods are final; S17 for every money
  value marked unconfirmed; S24 for the money screens (if it is late, they are built from tokens and old screens and get a
  design pass later). New owner steps from this spec: S32 to S34 (see Follow-up). None of them blocks writing code: each
  child builds against the fake PSP and draft copy, and names the hard check its gate needs.
- **Design source.** `claude_design` failed to connect on 2026-11-17 (`FIRST_PARTY_AUTH_REJECTED`). Run `/design-login`
  again before the first UI task; `docs/design/source/` is the fallback, said out loud when used (D110).
- **Launch date.** This spec does not change it (owner, 2026-11-17).

## Cross child contract

> **Note (D168, 2026-11-18).** Position 06 was built to spec 0010, not 0011-06. Where this contract names `selections`,
> `active_selection_id`, `request_events`, switch or withdraw, the child that first needs them amends it through `/architect`
> against what 05 (spec 0009) and 06 (spec 0010) built.
>
> **The pick (D169, 2026-11-18).** The chosen application is the pick: read `selections` as the request's `SELECTED`
> application (`requests.selected_application_id`), `selection_id` as `application_id`, `selections.provider_fee_amount`
> and `provider_fee_kind` as the same columns on `applications` (frozen at the choose, 07 AC-0), and the lock order as
> request, applications, fee_payments, fee_refunds. `payment_deadline` lives on `requests` (06); `fee_deadline` and the
> extension times join `requests` or `applications` in the child that first needs them. `request_events` and
> `failed_picks` come with the first child that needs them (12 or 13).

Every child builds to this section. A child may add to it, never contradict it.

### Request states

`requests.status` keeps 04's eight values. Each change runs inside one database function, takes the request row lock
(`for update`) first, checks the current state, and writes one `request_events` row in the same transaction.

| From | To | Trigger | Child |
| --- | --- | --- | --- |
| `OPEN` | `SELECTED` | Customer chooses, no commission paid yet | 06 |
| `OPEN` | `COMMISSION_PAID` | Customer chooses while a commission is already paid (carried, D90) | 06, 12 |
| `SELECTED` | `SELECTED` | Customer switches pick (no open commission checkout attempt) | 06 |
| `SELECTED` | `OPEN` | Chosen provider withdraws; commission window expires; chosen provider suspended | 06, 12 |
| `SELECTED` | `COMMISSION_PAID` | Relay applies a verified commission payment | 09 |
| `COMMISSION_PAID` | `UNLOCKED` | Relay applies a verified provider fee payment | 10 |
| `COMMISSION_PAID` | `OPEN` | Provider fee window expires or provider withdraws (failed pick +1); provider suspended (no failed pick) | 12 |
| `UNLOCKED`, `IN_PROGRESS` | `IN_PROGRESS` / `AWAITING_CONFIRMATION` | Provider starts (from the start day) / marks done (after start) | 11 |
| `UNLOCKED`, `IN_PROGRESS`, `AWAITING_CONFIRMATION` | `COMPLETED` | Customer confirms or marks the job done from the start day; confirm deadline passes with no open report | 11 |
| `AWAITING_CONFIRMATION` | `IN_PROGRESS` | Admin sends a reported job back to work | 14 |
| `OPEN`, `SELECTED`, `COMMISSION_PAID` | `CANCELLED` | Customer cancels; third failed pick; start passes with a carried commission and no paid pick; admin | 04, 12, 16 |
| `UNLOCKED`, `IN_PROGRESS` | `CANCELLED` | Customer or provider cancels (no automatic refund); admin | 12, 16 |

`AWAITING_CONFIRMATION` and later are never cancellable (overview §36 row 12). Every `CANCELLED` row has
`cancelled_by` in (`customer`, `provider`, `platform`, `admin`) (04's check). An `OPEN` request may hold a paid commission
(carried): that is the only state where a paid fee and `OPEN` coexist.

**Lock order** (every function, no exception): the `requests` row first, then its `selections`, then its `fee_payments`,
then `fee_refunds`. A function that starts from a fee or an attempt (the relay's `apply_fee_paid`) resolves the request
id and locks the request row before anything else, so expiry, cancel, choose and payment results are serialised per
request and cannot deadlock.

**Every close sets `closed_at`**: `COMPLETED` and `CANCELLED` (all cancel paths, 04's included) set `closed_at` and, for
`COMPLETED`, `closed_by`. 06's migration backfills `closed_at` from `cancelled_at` for requests already cancelled.

**Event kinds** (`request_events.kind`, a check constraint; a child adds a kind only by amending this list):
`posted`, `applied`, `chosen`, `switched`, `provider_withdrew`, `commission_paid`, `unlocked`, `started`, `done`,
`confirmed`, `customer_closed`, `auto_closed`, `pick_expired`, `fee_expired`, `no_paid_pick`, `provider_suspended`,
`cancelled`, `extended`, `reported`, `report_handled`, `returned_to_work`. Providers read events through a view that
leaves out `meta` and `actor_id` and shows only `posted`, `chosen`, `switched`, `cancelled` and events about their own
application; `meta` (attribution, admin notes) is for the customer's own actions and admin only.

### Application states

`applications.status` (05 creates the table). Others stay waiting while one is picked; they become `NOT_SELECTED` only
when the request reaches `UNLOCKED`.

| Status | Set when |
| --- | --- |
| `APPLIED` | Provider applies (05); a switched away pick returns here |
| `SELECTED` | Customer picks this application, commission not yet paid |
| `AWAITING_FEE` | Commission paid; this provider must pay their fee |
| `UNLOCKED` | Provider fee paid |
| `STARTED`, `COMPLETED`, `CONFIRMED` | Mirror `IN_PROGRESS`, `AWAITING_CONFIRMATION`, `COMPLETED` |
| `NOT_SELECTED` | Another application of the request reached `UNLOCKED` |
| `WITHDRAWN` | Provider withdrew (`APPLIED`, `SELECTED`, `AWAITING_FEE`), or platform withdrew it on suspension |
| `EXPIRED` | This pick's commission or fee window passed |
| `CANCELLED` | The request was cancelled while this application was still live |

A `WITHDRAWN` or `EXPIRED` application never returns to the list of that request (owner, 2026-11-17).

### Settings (`platform_settings`, per region, admin editable)

Read by the database functions; a missing or malformed key refuses with `<area>_settings_invalid` and raises an alert
(the 04 pattern, D141). "☐" means unconfirmed until S17 or S16.

| Key | Default | Unit | Child | Note |
| --- | --- | --- | --- | --- |
| `payment_window_hours` | 24 | hours | 06 | Exists (00); commission window ☐ |
| `unlock_window_hours` | 24 | hours | 10 | Exists (00); provider fee window ☐ |
| `min_window_minutes` | 60 | minutes | 06 | New. A window capped by the start never ends sooner than this from now |
| `max_reselections` | 3 | count | 12 | Exists (00); failed picks before the commission is refunded (D13) |
| `checkout_hold_minutes` | 15 | minutes | 08, 12 | New. Expiry waits while a checkout attempt is younger than this |
| `provider_fee_kind` | `percent` | `percent` or `fixed` | 07 (lands in 05) | New ☐ |
| `provider_fee_value` | 5 | percent, or minor units when fixed | 07 (lands in 05) | New ☐ |
| `fee_min_minor` | 1000 | minor units | 07 (lands in 05) | New ☐. Floor for both fees, capped at the job price |
| `confirm_window_hours` | 72 | hours | 11 | Replaces `hold_hours` (D95) ☐ |
| `start_grace_hours`, `completion_grace_hours` | 24 | hours | 12 | Exist (00, D13) |
| `contact_visible_days` | 14 | days | 10 | New. Contacts hidden this long after the job closes |
| `pay_reminder_hours` | 4 | hours | 13 | New. Skipped when the window is shorter |
| `email_link_hours` | 24 | hours | 13 | New |
| `report_window_days` | 14 | days | 14 | New. After `COMPLETED` or `CANCELLED` |
| `report_photo_retention_days` | 180 | days | 21 | New ☐ (S16) |
| `provider_file_retention_days` | none | days | 21 | New, no seed: the job does nothing until S16 gives the period (D114) |
| `picks_per_request_hour` | 20 | count | 06 | New |
| `checkouts_per_fee_hour` | 10 | count | 09, 10 | New |
| `psp_buyer_city` | `Istanbul` | text | 08 | New ☐. Buyer city sent to iyzico (zones have no city, D125) |
| `reports_per_user_day` | 5 | count | 14 | New |

07's migration deletes the dead 00b flags (`funding_enabled`, `unlock_enabled`, `payouts_enabled`,
`auto_release_enabled`, `hold_hours`, `late_cancel_cutoff_hours`) and moves `hold_hours` to `confirm_window_hours` (D95).

### Windows and time

- Every deadline is a `timestamptz` computed in the database from `now()` and a setting:
  `least(now() + window, scheduled_start_at)`, then raised to at least `now() + min_window_minutes`.
- "The start day" means the calendar day of `scheduled_start_at` in `regions.timezone` (D141).
- No deadline is ever read from the client.
- `checkout_hold_minutes` must be at least iyzico's checkout token lifetime (S1 confirms it; 15 until then), so a payer
  whose card page is still valid is never refused by expiry.
- A checkout attempt still `ready` 2 hours after it started gets one final retrieve; if not paid it becomes
  `abandoned` and is never checked again.

### Money (07 owns, everyone obeys)

- Two fee kinds: `commission` (the customer, one per request, carried across picks) and `provider_fee` (the chosen
  provider, one per request and provider). Amounts in integer minor units, frozen when created, never recomputed.
- Chart of accounts, per (region, currency): `psp_clearing` (money iyzico holds for us), `commission_revenue`,
  `provider_fee_revenue`, `commission_refunds` and `provider_fee_refunds` (contra revenue), `psp_fees` (expense),
  `refunds_due` (money received that we must send back: a late or duplicate payment).
- Posting signs: debit positive, credit negative; every journal sums to zero.
  - Fee paid, amount A, PSP fee F from the verified result: `psp_clearing +(A − F)`, `psp_fees +F`, revenue `−A`.
  - Fee refunded: refunds account `+A`, `psp_clearing −A`. F is never recovered (D13).
  - Late or duplicate payment received: `psp_clearing +(A − F)`, `psp_fees +F`, `refunds_due −A`; its refund:
    `refunds_due +A`, `psp_clearing −A`.
- Idempotency keys are text built from domain ids, never random:
  journals `fee:<fee_payment_id>:paid`, `fee:<fee_payment_id>:refund`, `late:<psp_payment_id>:received`,
  `late:<psp_payment_id>:refund`; outbox `checkout:<attempt_id>:init`, `checkout:<attempt_id>:verify:<n>` (n counts
  the verify requests of that attempt, so a later callback, webhook or reconcile can always ask again),
  `refund:<fee_refund_id>`, `email:<event_id>:<recipient_id>:<template>`, and for reminders
  `email:<selection_id>:<window>:pay_window_closing`. A replay returns the stored result.
- Only the relay calls `lib/psp` (rule 3). Only the relay moves a fee to `paid` or `refunded`.
- **Accept or late, decided before any change.** `apply_fee_paid` locks the request, then asks the kind's state check
  (09, 10) whether this payment is acceptable now. Only an accepted payment sets the fee `paid` and posts revenue. A
  payment that is not accepted (wrong state, past deadline plus hold, a second payment, amount or currency mismatch)
  leaves the fee as it was, posts only the `late:<psp_payment_id>:received` journal to `refunds_due`, and inserts a
  `late` refund.
- **The reveal is a one way fact.** Once a selection is `unlocked`, contacts follow that selection and the visibility
  window; a later refund of either fee by admin does not hide them. The unlock check refuses if a refund row exists for
  the request's commission.
- **Admin refunds are state bound.** A commission refund by hand only when the request is `CANCELLED` or `UNLOCKED` or
  later; a provider fee refund only for an `unlocked` selection. Before the reveal, refunds come only from the
  cancellation rules (12).

### Outbox kinds

| Kind | Written by | Relay does |
| --- | --- | --- |
| `checkout.initialize` | 09, 10 pay action | `initializeCheckout`, stores URL and token on the attempt |
| `payment.verify` | 08 callback, webhook, reconcile | `retrieveCheckout`, checks amount, currency, status, then applies |
| `refund.request` | 12 functions, admin refund | `refundPayment`, retries, then marks failed and alerts |
| `email.send` | 13 trigger on `request_events` and confirmation | Resend call with the key as `Idempotency-Key` |

A row is claimed with `for update skip locked` and a 2 minute lease; a crashed claim is reclaimed after the lease.

### New public machine endpoints

`/api/relay` (secret header), `/api/psp/callback`, `/api/psp/webhook`. No session, so no `requireRole()`; they join the
named exemptions of 01's action guard meta test and the `AGENTS.md` table, with a lint proof each. Each stores what it
receives and returns; none changes money state itself.

### Alerts (through the server only DSN from 08, R5)

`ledger_unbalanced`, `relay_stalled`, `refund_failed`, `reconcile_mismatch`, `late_payment_refunded`,
`<area>_settings_invalid`. Each is a `raiseAlert` call with a record id (spec 0004 AC-11).

### Rate limits

One generic counter table, `action_counters (subject_id, action, window_start, count)`, fixed windows, checked and
counted inside the function that acts (the `quote_counters` pattern of 04, which stays as it is). Refusal code
`too_many_<action>`.

### Errors

Database functions raise stable codes (`not_found`, `forbidden`, `invalid_state`, `deadline_passed`, `start_passed`,
`checkout_open`, `already_paid`, `too_many_*`, `<area>_settings_invalid`); `lib/*` doors map them to typed results, and
the UI maps those to messages in three locales. A raw SQLSTATE never reaches a user.

## Requirements

**User stories**:
- As a customer, I want to choose one applicant, pay my commission once, and see the provider's contact only when they
  have paid too, so that both of us are committed.
- As a provider, I want to know my fee before I apply and pay it only for a customer who has already paid, so that my
  money buys a real job.
- As the owner, I want every fee charged at most once, refunded at most once, and visible in a balanced ledger, so that
  money and private data stay correct (priority line, D42).

**Umbrella acceptance criteria** (every child also proves its own):
- **U-1**: Every state change of a request or an application goes through one database function that locks the request
  row, checks the source state from the tables above, and writes a `request_events` row; a pgTAP meta test fails if any
  role can `update` `requests.status` or `applications.status` directly.
- **U-2**: For every request, the sum of `ledger_entries` per (region, currency) is zero, at every commit; a property test
  over random sequences of pay, duplicate pay, expiry, cancel and refund holds it, and no fee is paid or refunded twice.
- **U-3**: No row of `profiles.phone`, `profiles.email`, `request_addresses` or a provider's private fields is readable by
  the other side before both fees of that (request, provider) are `paid`; the same query run before and after the
  second payment returns nothing, then the contacts (rule 2).
- **U-4**: No user facing path calls iyzico or Resend; a source test fails if `lib/psp` or `lib/email` is imported
  outside the relay (rule 3, the door rules).
- **U-5**: Every new table has `region`, RLS enabled, its policies and grants, and a negative test in the migration that
  creates it (rule 7, the CI region check).
- **U-6**: Every new user string exists in `ar`, `tr` (as `[tr]` until S21) and `en`; every new screen passes axe at
  390px in all three locales.
- **U-7**: G1 is checked after 11, G2 after 14, G3 after 21, with the gate lists of `build-plan.md`, plus the real calls
  of 02 and 03 (D133, D135) at G1.

## Decision

**Chosen option**: one umbrella with a shared contract and one child spec per position, built in strict build plan order,
one branch and one pull request per position.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) ·
`supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) ·
`resend` (`resend/resend-skills`, `.claude/skills/resend/`) · `shadcn` (`shadcn-ui/ui`, `.claude/skills/shadcn/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Data model (target for all children)

New columns on existing tables:

| Table | Column | Type | Child |
| --- | --- | --- | --- |
| `requests` | `active_selection_id` | uuid null, FK `selections` | 06 |
| `requests` | `failed_picks` | smallint not null default 0, 0 to `max_reselections` | 06, 12 |
| `requests` | `actual_started_at`, `actual_completed_at` | timestamptz null | 11 |
| `requests` | `confirm_deadline` | timestamptz null | 11 |
| `requests` | `confirm_extended_at` | timestamptz null | 16 |
| `requests` | `closed_at` | timestamptz null (set at `COMPLETED` or `CANCELLED`) | 11, 12 |
| `requests` | `closed_by` | text null: `customer`, `auto`, `admin` | 11 |

New tables (all with `id uuid` primary key, `region` FK `regions`, `created_at`):

| Table | Key fields | Rules | Child |
| --- | --- | --- | --- |
| `selections` | request_id, application_id, provider_id, picked_at, `payment_deadline` null, `fee_deadline` null, `provider_fee_amount` bigint, `provider_fee_kind`, `payment_extended_at` null, `fee_extended_at` null, outcome (`active`, `switched`, `withdrawn`, `expired`, `cancelled`, `removed`, `unlocked`) | one `active` per request (partial unique); fee frozen at insert | 06 |
| `request_events` | request_id, kind, actor (`customer`, `provider`, `platform`, `admin`), actor_id null, meta jsonb | append only | 06 |
| `action_counters` | subject_id, action, window_start, count | primary key (subject_id, action, window_start) | 06 |
| `fee_payments` | request_id, kind, payer_id, provider_id null, selection_id null, amount, currency, status (`pending`, `paid`, `refunded`), psp_payment_id null, psp_fee_amount null, paid_at null | unique (request_id) where kind `commission`; unique (request_id, provider_id) where kind `provider_fee` | 07 |
| `checkout_attempts` | fee_payment_id, status (`queued`, `ready`, `succeeded`, `failed`, `abandoned`), locale, psp_token null, url null, started_at, finished_at null | fee 1:N | 07 |
| `ledger_journals` | kind, currency, idempotency_key unique, fee_payment_id null, response jsonb | balanced by a deferred constraint trigger | 07 |
| `ledger_entries` | journal_id, account, amount bigint (non zero) | append only (rule 5) | 07 |
| `outbox_events` | kind, payload jsonb, idempotency_key unique, status (`pending`, `claimed`, `done`, `failed`), attempts, next_attempt_at, claimed_at, claimed_by, last_error | | 07 |
| `psp_events` | source (`callback`, `webhook`, `retrieve`, `reconcile`), event_key, payload jsonb, received_at | unique (source, event_key) | 07 |
| `fee_refunds` | kind (`fee`, `late`), fee_payment_id null, psp_payment_id, amount, currency, reason, requested_by (null means system), status (`queued`, `done`, `failed`, `done_by_hand`), psp_refund_id null, finished_at null | unique (psp_payment_id); unique (fee_payment_id) where not null: one refund per PSP payment and per fee. A `late` row refunds a payment that never became a fee's payment | 07, 12 |
| `deadline_flags` | request_id, kind (`start_late`, `completion_late`), raised_at, cleared_at null, cleared_by null, note null | unique (request_id, kind) where `cleared_at` is null, so a flag can be raised again after a clear | 12 |
| `email_confirmations` | profile_id, email, token_hash, expires_at, used_at null | one live per profile | 13 |
| `problem_reports` | request_id, reporter_id, against_id, reason, text, status (`open`, `handled`), outcome null, handled_by null, handled_at null | one open per (request, reporter) | 14 |
| `report_photos` | report_id, object_path, created_at | at most 3 per report | 14 |
| `user_warnings` | user_id, report_id null, reason, created_by, acknowledged_at null | | 14 |

The reveal has no table: a definer function returns the other side's contacts only when both fees are `paid` (0011-10).

### Value sourcing (shared values)

| Value | Source |
| --- | --- |
| Commission amount | `requests.commission_amount`, stored at publish (D139); the floor applies to requests posted after 05 ships |
| Provider fee amount | `selections.provider_fee_amount`, from `provider_fee_kind`, `provider_fee_value`, `fee_min_minor`, `price_rounding_minor` at choose |
| PSP fee | The verified retrieve result of that payment (iyzico reports its own cut per payment; S1 confirms the field) |
| Every deadline | Settings above, `now()` and `requests.scheduled_start_at` |
| Region time zone | `regions.timezone` (D141) |
| Locale of an email | `profiles.locale` (exists since 01), kept current by 13 |

### Security model (shared)

- Reads and writes go through RLS or definer functions that check `auth.uid()` against the owning row; admin through
  `is_admin()` (D116), which requires `aal2` from 21.
- No service role in a user path; the relay route is the only server code with the service role besides webhooks and
  jobs (door rule).
- Personal data under KVKK: phones, emails, street lines, report text and photos. Reads of contacts and street lines by
  the other side or by admin are audited (0011-10, 0011-16).

## Build plan

Tracer bullet, strict order, one branch and one PR per position, each through the full loop of `AGENTS.md`. Tests first
on every money path, every access rule and every state change. **High risk paths, said out loud:** every child touches
`supabase/migrations/**`; 07, 08, 09, 10, 12 touch `lib/money/**` and `lib/psp/**`; 07 touches `lib/pricing/**` and the
write guard (`.claude/hooks/guard.mjs`, D96).

1. 05 (its own spec, with the prerequisites above).
2. 06 → 07 → 08 → 09 → 10 → 11 → **G1**.
3. 12 → 13 → 14 → **G2**.
4. 15 → 16 → 21 → **G3**.

Each child's own build plan lists its tasks with the AC each satisfies. Every child also updates, in the same change:
`architecture.md` (its tables as built), `ui-registry.md` (new components), `build-plan.md` (its row), the tracker
(decisions, settings defaults table, owner steps).

## Consequences

**Positive**:
- One state machine and one settings table, so twelve pull requests cannot drift apart.
- Money moves only through the relay and only on verified facts; the ledger proves every step.
- Each position stays one day sized and reviewable on its own.

**Negative / tradeoffs**:
- Thirteen positions in strict order: nothing runs in parallel, so a slip in 07 or 08 moves everything after it.
- The relay adds a background path to operate (cron, lease, alerts) before any real payment exists.
- No kill switch (owner override of 21): stopping payments in an incident needs a deploy or a settings change by hand.
- The money UI may ship before S24 and need a second design pass.

**Neutral**:
- 05 must carry four items for this spec (fee settings, `provider_fee_for` and the commission floor; the fee estimate in
  the feed; the applications columns; the My jobs Applied tab).
- Four new owner steps (S32 to S34) and new env vars (see 08, 13, 21).

## Follow-up

- [ ] Add owner steps to the tracker: **S32** Sentry server only project and DSN (08, R5); **S33** `RELAY_SECRET` in Vercel
  and Supabase Vault (08); **S34** staging Supabase project with iyzico sandbox keys, previews pointed at it (21).
- [ ] Record the decisions of this spec in the tracker log (D165 onward) and the settings in the defaults table.
- [ ] `build-plan.md`: link this spec on rows 06 to 16 and 21; row 08 says "Next route driven by `pg_cron`", row 21 drops
  kill switches (owner override).
- [ ] Write spec 0010 for position 05 before building it, with the three items under Prerequisites.
- [ ] `/design-login` again before the first UI task (S26 shows `FIRST_PARTY_AUTH_REJECTED`).
