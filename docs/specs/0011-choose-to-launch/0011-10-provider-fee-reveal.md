# 0011-10. Provider pays, mutual reveal (position 10)

Child of [0011](index.md). Follows the cross child contract there. **High risk: money, a migration, personal data (both
sides' phones, emails, the street line), and the pages 09 built for one payer.**

> **Amended 2026-11-17 (D178)** against what 06 (spec 0010), 07 (`20261119090000_money_core`), 08
> (`20261120090000_relay`, D173, D174) and 09 (PR #40, `20261121090000_commission_payment`, D175 to D177) built, the way
> 0011-09 was amended (D175). There is no `selections` table: the pick is `requests.selected_application_id`, the provider
> fee is frozen on that application (`provider_fee_amount`, 07), and the fee window is `requests.fee_deadline` (09). 07
> left `accept_provider_fee` (always false) and `after_provider_fee_paid` (no op) for 10 to fill. Folds in D171 (a fee of
> 0 skips its payment step), R-4 of 09 (the commission side reads "0 or paid"), the R14 items owned by 10 and R6's reveal
> item. The owner answered five questions in chat (A-1 to A-5, all the recommended option). Cross checked on Sonnet the
> same day (15 findings: 8 Major, 7 Minor), applied as the rules R-1 to R-15 below. **Where a rule below and an AC
> differ, the rule wins.** Accepted by the owner 2026-11-17.

## Summary

Once the commission is settled, the chosen provider's My jobs page shows a Chosen tab with the exact fee, the deadline
and Pay. Pay calls one database function that opens the provider fee and a checkout attempt, or reuses a young one, the
same way 09 does for the customer; 09's pay, return and receipt pages serve the provider too. When the relay applies a
verified payment, the request becomes `UNLOCKED`, the chosen application `UNLOCKED`, and every other live application of
the request `NOT_SELECTED`. A provider fee of 0 skips the card page (D171). From then on the customer sees the provider's
name, phone, WhatsApp link and email, and the provider sees the customer's name, phone, WhatsApp link, email, street line,
notes and zone. The database decides this (rule 2): one definer function for contacts and one RLS policy for the street
line. The details hide again 14 days after the job closes (11 and 12 close jobs).

## Requirements

**User stories**:
- As a chosen provider, I want to pay my fee only after the customer has paid, and then reach them at once.
- As a customer, I want the provider's contact only when they have paid, so that I deal with a committed provider.
- As either side, I want my details hidden from everyone else, and hidden again some time after the job.

**Prerequisites**: 09 merged (PR #40) and its migration in the cloud (S39). Branch `feat/10-provider-fee-reveal`. One
migration, `provider_fee_reveal`, after `20261121090000_commission_payment`, builds AC-1 to AC-7. S24 for the final
design (else tokens and the old screens, umbrella). S16 for the agreement text (a draft marker, D100). Not needed for the
build or the local checks: S32, S33 and the S37 window (AC-17, A-4).

**Acceptance criteria**:
- **AC-0** (what 10 calls, as built): `open_fee(p_request_id, 'provider_fee')` (07, internal, invoker: locks the
  request; returns the existing provider fee row of the selected application's provider; inserts one only when the
  request is `COMMISSION_PAID` and the application has a frozen `provider_fee_amount`, payer and provider that provider,
  else `invalid_state`); `start_checkout(fee, locale, ip)`, `payments_enabled`, `checkout_settings`, `action_counters`
  (action `checkout`, subject the fee id), `fail_attempt`, `my_checkout`, `my_receipt` (09; both already check the
  fee's `payer_id`, so they serve a provider unchanged); `apply_fee_paid` asks `accept_provider_fee(p_fee, p_attempt)`
  before any change and calls `after_provider_fee_paid(p_fee)` after the paid journal, inside its transaction with the
  request and the fee locked (D169 order). `requests.fee_deadline` is set by 09's `commission_settled`. The payer's
  column grant on `fee_payments` still leaves out `provider_id`, `psp_payment_id` and `psp_fee_amount` (R13).
- **AC-1** (columns and a setting): `requests.closed_at` (timestamptz, null; written by 11 and 12 with their terminal
  moves, never by 10; `requests_guard` lets it be set once, never changed or cleared) and `applications.unlocked_at`
  (timestamptz, null; set once by AC-4's move, never changed or cleared, by `applications_guard`). Setting
  `contact_visible_days` (14 ☐, an integer 1 to 365) per region, by a row check under the `pricing_settings_guard`
  pattern; a reader that finds it missing or malformed refuses `contact_settings_invalid` (a new `AlertReason`).
- **AC-2** (`pay_provider_fee(p_application_id uuid, p_locale text, p_payer_ip text)`, definer, `search_path` empty,
  granted to `authenticated` only), in this order:
  1. Inputs as 09 AC-4 step 1 (locale `ar`, `tr`, `en`, else `validation_failed`; the IP to `inet` or null, never an
     error).
  2. The application's request id read without a lock; the request locked `for update`; the caller's `providers` row
     `for share` (D156); the application read again. Not the caller's application, or none: `not_found`.
  3. The application `UNLOCKED` or later, or a provider fee for it already `paid`: `already_paid`. Otherwise
     `invalid_state` unless the request is `COMMISSION_PAID`, the application is its `selected_application_id` and
     `AWAITING_FEE`, and the provider's standing is `approved`.
  4. `now() >= fee_deadline`: `deadline_passed`.
  5. `provider_fee_amount = 0` (D171): AC-4's move at once; no fee row, no attempt, no switch or settings check;
     returns `{status: 'settled'}`.
  6. to 11. As 09 AC-4 steps 6 to 11, with `open_fee(request, 'provider_fee')`: `payments_disabled`,
     `checkout_settings_invalid`, reuse of a young attempt (no count, no audit row, D176), one count, `too_many_checkouts`,
     `start_checkout`.

  One `audit_log` row for a new attempt (ids only, never the IP).
- **AC-3** (`accept_provider_fee(p_fee, p_attempt)` replaced, stable, invoker): true only when the fee is a
  `provider_fee` and `pending`, no `fee_refunds` row names it, the request is `COMMISSION_PAID` with `fee_deadline` set,
  the fee's `provider_id` is the provider of `selected_application_id`, that application is `AWAITING_FEE` and its
  provider `approved`, the commission side is settled (`commission_amount = 0`, or the commission fee `paid` with no
  refund row; R-4 of 09), the attempt belongs to the fee and started at or before `fee_deadline`, `now()` is at or before
  `fee_deadline + checkout_hold_minutes`, and `now()` is before `scheduled_start_at`. A missing hold setting raises
  `checkout_settings_invalid` (09 R-2). Anything else is false and 07's late path refunds the payment, so a stale,
  suspended or expired provider's payment never reveals anything.
- **AC-4** (`after_provider_fee_paid(p_fee)` replaced, and the zero move): both call one internal function,
  `provider_fee_settled(p_request_id)`, with the request locked: the request `COMMISSION_PAID → UNLOCKED`; the selected
  application `AWAITING_FEE → UNLOCKED` with `unlocked_at = now()` and `status_changed_at`, refused (`invalid_state`) if
  the provider is no longer approved (as 09's S09-2); every other application of the request still `APPLIED` or
  `SELECTED` becomes `NOT_SELECTED` (06's rule: others wait until the reveal); one `audit_log` row (ids). `requests_guard`
  and `applications_guard` are widened for exactly these moves.
- **AC-5** (`request_contacts(p_request_id)`, definer, stable, `authenticated`): the caller is the request's customer or
  the provider of `selected_application_id`; that application has `unlocked_at` set (the reveal is a one way fact: a
  later admin refund does not hide it); and the request has no `closed_at`, or `closed_at` is less than
  `contact_visible_days` ago. Else `not_found` (the same answer for an id that does not exist, R-13 of 09). To the
  customer: the provider's `approved_name`, phone, WhatsApp link, email and whether it is confirmed. To the provider: the
  customer's `full_name`, phone, WhatsApp link, email and whether it is confirmed, the street line, the notes, the zone
  name and the scheduled start and end. Never another provider's or another request's data.
- **AC-6** (the street line policy): a new select policy on `request_addresses` for `authenticated` lets the selected
  provider read the row under exactly AC-5's condition (one helper, `contacts_visible(p_request_id)`, used by both). The
  same query as that provider returns no row before the reveal, the row after it, and none after the window. A second
  applicant, a stranger and `anon` never read it.
- **AC-7** (audit and links): the first `request_contacts` read by each side writes one `audit_log` row
  `contacts.viewed` (actor, request, side); later reads write none. The WhatsApp link is `https://wa.me/` plus the
  E.164 digits of `profiles.phone` with no plus sign, built in the function; no message text is prefilled.
- **AC-8** (the door and the actions): `lib/provider-feed` gains `payProviderFee` (wraps `pay_provider_fee`) and
  `listJobs`; `lib/requests` gains `loadContacts` (wraps `request_contacts`), all with strict schemas. Server Actions:
  `payProviderFeeAction` in `actions/payments.ts` runs `guardedAction('provider')`, takes the application id, the locale
  from the route and the IP as 09; `checkoutStatusAction` accepts both roles (R14, A-0 below), each still limited to its
  own attempts by `my_checkout`. Codes map to typed results as 09 AC-9 plus `contact_settings_invalid`.
- **AC-9** (09's pages serve both payers, R14): the pay page, the return page and the receipt page call
  `guardPage(['customer', 'provider'])`; ownership stays in `my_checkout` and `my_receipt`. Try again calls the action
  of the attempt's `fee_kind` (`payCommissionAction` with the request id, or `payProviderFeeAction` with the application
  id, which `my_checkout` returns for a provider fee as `application_id`); `canRetry` reads the right deadline
  (`payment_deadline` or `fee_deadline`). Links back go to the request page for the customer and to My jobs for the
  provider. The Success body and the receipt name the fee kind.
- **AC-10** (My jobs, A-1): `/[locale]/provider/applications` gains tabs Applied (05's list), Chosen (the fee amount,
  the deadline in the region's time zone, the agreement reminder, Pay "<fee>", or Continue for 0; after the deadline "The
  payment time ended", no button; Withdraw arrives with 12), Active (the contact card, AC-12) and Done (filled by 11).
  The phone bar tab and the header label read "My jobs"; the route does not change (D157 keeps three tabs). `listJobs`
  reads one definer function `provider_jobs(p_tab, p_after_created_at, p_after_id)` (stable, the caller's rows only, no
  contact field) or 05's `provider_applications` widened, whichever keeps one query per tab.
- **AC-11** (the customer's request page, A-3): in `COMMISSION_PAID` it keeps 06's offer card (first name and family
  initial, no photo, D159) and 09's "Waiting for the provider to pay their fee, until <fee_deadline>". In `UNLOCKED` it
  shows the contact card (AC-12) with the provider's approved name, and the timeline marks "Provider fee" done and
  "Contacts shared" current.
- **AC-12** (the contact card, A-2): one shared component renders what `request_contacts` returns: name, Call
  (`tel:`), WhatsApp (the link, new tab, `rel="noopener noreferrer"`), the email with "unconfirmed" when it is, and for
  the provider the street line, notes, zone and dates. It sits in a `data-pii` container (cheap, ready if replay is ever
  turned on; replay stays off, D68). The routes that render it send `Cache-Control: no-store`. Text in three locales.
- **AC-13** (analytics and telemetry): `contacts_unlocked: { side: 'customer' | 'provider' }` once per side when the
  card first renders, no ids. `payment_started` and `payment_succeeded` carry `fee: 'provider_fee'` for this fee, sent as
  09 sends them (`leaving: true` before the card page). The scrubber test proves no phone, email, street line or note
  enters a log, an event or an alert.
- **AC-14** (tests): pgTAP `23_provider_fee_reveal` (each refusal of `pay_provider_fee` in its order, reuse, the count,
  zero, payments off, `accept_provider_fee` true and false for each condition, the move with the others `NOT_SELECTED`,
  `request_contacts` and the address policy before, after and past the window for the customer, the provider, a second
  applicant, a stranger and `anon`, the one audit row per side, the WhatsApp link, grants) and `24_reveal_races` (dblink:
  two pays, pay against the deadline, the apply against a suspend). Unit tests for the door, the actions and the
  retry routing. e2e on the fake in `ar`, `tr`, `en` at 390px with axe: the whole thread post, apply, choose, commission,
  provider fee, reveal on both sides; a second provider sees nothing and reads `NOT_SELECTED`; a provider fee of 0; the
  provider's pay, return and receipt pages; another provider gets 404 on them.
- **AC-15** (R6, A-2): R6's reveal item closes as built (the marker) with a note: replay masking and a replay test are
  owed only if replay is ever enabled.
- **AC-16** (the e2e host, D176): the provider e2e signs in on `localhost`, the e2e app origin, as the commission spec
  does, so the callback returns the browser to its session.
- **AC-17** (the real call, A-4): no separate window. 09's S37 checklist gains: the provider pays the fee and both sides
  see the other's contacts, then the window closes as written.

## Owner answers (D178, 2026-11-17)

- **A-1** My jobs: the tabs go on `/provider/applications`, labelled "My jobs"; no new route.
- **A-2** Replay: a `data-pii` marker only, no replay test; R6's item closes with a note.
- **A-3** Before the reveal the customer sees 06's offer card as it is; the full name and contacts only after both fees.
- **A-4** The real call joins 09's S37 window.
- **A-5** A provider suspended after the reveal loses the customer's contacts at once: the provider side of
  `contacts_visible` also requires standing `approved`. The customer keeps seeing the provider's contacts. Lifting the
  suspension shows them again.

## Amendment rules (D178, cross check 2026-11-17)

- **R-1, `my_checkout` is replaced** (X-1). It also returns `application_id` (the selected application, for a
  `provider_fee` only, else null), `amount`, and `deadline` (`payment_deadline` for a commission, `fee_deadline` for a
  provider fee), read inside the definer function. `lib/requests/checkout-page.ts` builds `canRetry` and the receipt link
  from these fields alone, so the provider needs no read on `requests` and `loadCommissionFee` is not called for a
  provider fee. 09's pgTAP for `my_checkout` keys are updated.
- **R-2, the helper's grant** (X-2). `contacts_visible(p_request_id uuid) returns boolean`: definer, stable,
  `search_path` empty, granted to `authenticated` (an RLS policy runs as the caller), never to `anon`. It answers only
  for `auth.uid()`: true when the caller is the customer of a request whose selected application has `unlocked_at`, or
  is that application's provider with standing `approved` (A-5), and the window holds. pgTAP: a stranger, a second
  applicant and a suspended provider get false; `anon` has no execute.
- **R-3, the audit write** (X-3). `request_contacts` is `volatile`. It takes the request row `for share`, then
  inserts the `contacts.viewed` row only `where not exists` one for (request, actor), backed by a unique partial index
  on `audit_log (entity_id, actor_id) where action = 'contacts.viewed'`; a concurrent first read conflicts quietly
  (`on conflict do nothing`).
- **R-4, standing after the reveal** (X-4, A-5). As R-2. A test: suspend after the reveal, the provider's
  `request_contacts` and address read return nothing, the customer's still return the provider; lift, both return.
- **R-5, `unlocked_at` is guarded** (X-5). `applications_guard` refuses `unlocked_at` going from null to set unless the
  same update moves `AWAITING_FEE → UNLOCKED`, refuses any change or clear once set, and refuses `status = 'UNLOCKED'`
  with `unlocked_at` null. No API role holds an update grant on `applications` or `requests` (a meta test). A tamper
  test as `postgres` in a probe proves each refusal.
- **R-6, `requests_guard` is widened exactly** (X-6). `closed_at` joins the guard's compared columns list as
  "settable once": null to a value only with a move to `COMPLETED` or `CANCELLED` (11, 12), never changed or cleared.
  The allowed moves gain `COMMISSION_PAID → UNLOCKED`, and an `UNLOCKED` move is refused unless the selected
  application has `unlocked_at` (checked in `provider_fee_settled` and asserted by the guard).
- **R-7, the payment pages move to a shared group** (X-7). The pay, return and receipt pages move from
  `app/[locale]/(customer)/` to `app/[locale]/(payments)/` with its own layout (the same `AppShell`, which picks the menu
  from the role); URLs do not change. Each calls `guardPage(['customer', 'provider'])`. Back links go to
  `/requests/<id>` for a commission and `/provider/applications?tab=chosen` (or `active` once unlocked) for a provider
  fee. `lib/relay/callback.ts` keeps its target. e2e: a provider session on each URL of its own attempt, and 404 on
  another provider's.
- **R-8, the zero path asserts the commission side** (X-8). `provider_fee_settled` checks, inside its transaction, that
  the commission is 0 or its fee is `paid` with no refund row, else `invalid_state`. pgTAP: a commission refunded just
  before a zero fee Continue is refused.
- **R-9, a second payment** (X-9). pgTAP: two attempts both paid; the first reveals, the second is refunded as late
  because the fee is no longer `pending`.
- **R-10, the setting and a null email** (X-10). `contact_visible_days` seeded 14 for `TR` and `KSA`, a row check (an
  integer 1 to 365), added to the guard's required keys so it cannot be deleted or renamed. A null email: the card
  shows no email row; the WhatsApp link needs only the phone.
- **R-11, the tabs** (X-11). Applied: `APPLIED`, `SELECTED` (chosen, commission not yet paid: "The customer is paying
  the commission"). Chosen: `AWAITING_FEE`. Active: `UNLOCKED`, `STARTED`. Done: `COMPLETED`, `CONFIRMED`, `RATED`,
  `NOT_SELECTED`, `WITHDRAWN`, `EXPIRED`, `CANCELLED`. Sorted by `status_changed_at` descending, then id; the cursor
  is that pair. One definer function `provider_jobs(p_tab, p_after_changed_at, p_after_id)`, 20 rows a page.
- **R-12, the other applications** (X-12). Only `APPLIED` and `SELECTED` rows of other providers move to
  `NOT_SELECTED`; final rows (`WITHDRAWN`, `EXPIRED`, `CANCELLED`, `NOT_SELECTED`) are untouched. A pgTAP case holds one
  of each.
- **R-13, action role tests** (X-13). A provider on `payCommissionAction` and a customer on `payProviderFeeAction` get
  `forbidden` from `guardedAction`; unit tests for both.
- **R-14, more negative tests** (X-14). pgTAP 23 adds: a provider replaced after a stale read gets nothing; a customer
  reading another customer's `request_addresses`; `request_contacts` on a `CANCELLED` and on a never unlocked request;
  `pay_provider_fee` on another provider's application (`not_found`); `anon` on every new function.
- **R-15, the start overrun** (X-15). `fee_deadline` may pass `scheduled_start_at` by up to `min_window_minutes` (the
  floor, 09). A provider fee paid after `scheduled_start_at` is refunded as late, as the commission is (09 A-1), and
  the Chosen tab shows the deadline as `least(fee_deadline, scheduled_start_at)`. pgTAP: a payment in the overrun is
  refunded.

## Author notes

- **A-0, the status action.** `checkoutStatusAction` today runs `guardedAction('customer')`. 10 widens it to both roles;
  the database still answers `not_found` for anyone but the fee's payer, so no new read is opened.
- The contact window counts from `closed_at`, which 10 adds but never writes. Until 11 and 12 land, an `UNLOCKED` job
  never closes, so contacts stay visible; that is the intended behaviour for an open job.
- 12 owns what happens when `fee_deadline` passes unpaid (the failed pick and the re-pick); 10 only refuses the payment
  and refunds a late one.

## Decision

The reveal is enforced twice in the database: a definer function for phones and emails (which live in `profiles`, whose
own policy stays owner only) and an RLS policy for the street line, both reading one helper. React only renders what they
return. The provider fee reuses 09's machinery end to end; only the accept rule, the move and the pay function are new.

## Feature design

**Data model**: `requests.closed_at`, `applications.unlocked_at`, setting `contact_visible_days`. No new table.

**State transitions**: request `COMMISSION_PAID → UNLOCKED`; chosen application `AWAITING_FEE → UNLOCKED`; other live
applications `APPLIED`/`SELECTED → NOT_SELECTED`.

**API surface**:

| Function or action | Kind | Inputs | Outputs | Auth | Errors |
| --- | --- | --- | --- | --- | --- |
| `pay_provider_fee` | definer | application id, locale, IP text | `{status, attempt_id, reused}` | that provider | `not_found`, `invalid_state`, `already_paid`, `deadline_passed`, `payments_disabled`, `too_many_checkouts`, `checkout_settings_invalid` |
| `request_contacts` | definer, volatile (R-3) | request id | contact fields | customer or the unlocked, approved provider | `not_found`, `contact_settings_invalid` |
| `contacts_visible` | definer, stable, `authenticated` (R-2) | request id | boolean for the caller | any signed in user | none |
| `provider_jobs` (or 05's widened) | definer, stable | tab, cursor | job rows, no contacts | provider | none |
| `accept_provider_fee`, `after_provider_fee_paid`, `provider_fee_settled` | internal | see AC | | none | |
| `my_checkout` (replaced, R-1) | definer, stable | attempt id | 09's fields plus `application_id`, `amount`, `deadline` | payer | `not_found` |
| `actions/payments.ts`: `payProviderFeeAction`; `checkoutStatusAction` widened | Server Action | application id / attempt id | typed result | `guardedAction` | mapped |

**Value sourcing**:

| Value | Source |
| --- | --- |
| Fee amount shown | `applications.provider_fee_amount` of the selected application (frozen by 07) |
| Deadline shown | `requests.fee_deadline` (09) |
| Names | `providers.approved_name`, `profiles.full_name` |
| Phone, WhatsApp | `profiles.phone` |
| Email, confirmed flag | `profiles.email`, `profiles.email_confirmed_at` |
| Street line, notes, zone, dates | `request_addresses.line`, `requests.notes`, `zones.name` in the page locale, `scheduled_start_at`, `scheduled_end_at` |
| Visibility end | `requests.closed_at` + `contact_visible_days` |
| Time zone | `regions.timezone` |

**Key invariants**: `applications.unlocked_at` set on the selected application, which happens only after both sides are
settled for that (request, provider), is the only door to contacts; no provider reads another provider's data; an
`UNLOCKED` request has exactly one application with `unlocked_at`.

**Security model**: KVKK personal data; reads audited once per side; contacts never cached (`no-store`); the card URL
reaches only the payer after the host check (09).

**Critical test scenarios**: before and after on the same query for both sides (AC-5, AC-6); a second provider and a
stranger denied at every step; visibility ends after the window; a late, stale or suspended provider's fee is refunded,
not unlocked (AC-3); a provider fee of 0 reveals with no fee row (AC-2, AC-4); a provider on the pay pages of another
provider's attempt gets 404 (AC-9).

## Build plan

1. Tests first: pgTAP `23` and `24`, then the migration `provider_fee_reveal` (columns, setting, guards,
   `pay_provider_fee`, `accept_provider_fee`, `after_provider_fee_paid`, `provider_fee_settled`, `contacts_visible`,
   `request_contacts`, the address policy, the jobs read); `npm run db:types`; satisfies **AC-0** to **AC-7**.
2. The doors and the actions, the widened status action; unit tests; satisfies **AC-8**, **AC-13** (scrubber).
3. UI: 09's pages for both payers, My jobs tabs, the contact card on both sides, the timeline; satisfies **AC-9** to
   **AC-12**, **AC-15**.
4. e2e and axe; satisfies **AC-14**, **AC-16**. Owner push after a dry run, reviews with `security-reviewer`, merge. Then
   the S37 window covers **AC-17**.

## Consequences

- Positive: the most sensitive rule of the product is one helper behind one function and one policy, tested before and
  after; the provider fee adds no new money machinery.
- Negative: an unconfirmed email can be shown (owner choice, until 13); a mistyped address reaches the other side.
- Neutral: the 14 day window also bounds 14's report window, so both read the same `closed_at`.

## Rationale

Phones live in `profiles`, whose owner only policy protects every other screen; widening it would risk leaks elsewhere, so
a narrow definer function returns them only under the reveal condition. `unlocked_at` makes the reveal a one way fact
that later status moves (11, 12) and refunds cannot undo by accident.
