# 0011-06. Choose a provider (position 06)

Child of [0011](index.md). Follows the cross child contract there.

## Summary

The customer sees everyone who applied, oldest application first, with a card per provider, and chooses one. The request
becomes `SELECTED` with a commission deadline of 24 hours (never past the start). Until they pay, the customer may switch
to another applicant, and the chosen provider may withdraw. Other applicants keep waiting; nobody is told "not selected"
until the reveal. A status timeline on the request page shows every step of the job, with the current deadline.

## Requirements

**User stories**:
- As a customer, I want to compare applicants on one page and choose one, so that I pick who I trust.
- As a customer, I want to change my mind before I pay, so that a misclick costs nothing.
- As a provider, I want to withdraw before I pay anything, so that I am not locked into a job I cannot do.
- As a customer, I want a timeline of my request with the next deadline, so that I always know what happens next.

**Prerequisites**: 05 merged with the items listed in the umbrella. Branch `feat/06-choose-provider`.

**Acceptance criteria**:
- **AC-1**: `request_applicants(p_request_id)` (definer) returns, only to the request's customer, the live applications
  (`APPLIED`, `SELECTED`, `AWAITING_FEE`) ordered by `applications.created_at` ascending, each with: application id,
  status, apply message, applied time, the provider's `approved_name`, entity type, years of experience, languages, bio
  cut to 160 characters, a verified badge (provider `approved`), and the job count (AC-2). `WITHDRAWN`, `EXPIRED`,
  `NOT_SELECTED` and `CANCELLED` are left out. Any other caller gets `not_found`.
- **AC-2**: The job count is the number of that provider's applications in `CONFIRMED`, computed at read. The reviews
  slot on the card renders nothing (17 is out of scope).
- **AC-3**: The customer can open each applicant's profile photo through a 60 second signed link made as the signed in
  customer (`lib/storage/server.ts`); a Storage policy allows it only while that provider has a live application on a
  request of that customer. Any other user is refused by Storage.
- **AC-4**: `provider_full_profile(p_request_id)` returns the full bio, the titles of approved skill certificates and the
  approval month, only to the customer of a request whose active selection is that provider **and** whose commission is
  paid (state `COMMISSION_PAID` or later). Before that it answers `forbidden`.
- **AC-5**: `choose_applicant(p_request_id, p_application_id)` (customer of the request only) on an `OPEN` request
  (12 adds the branch for a paid commission, with the same refusals): locks the request, refuses `not_found` unless the
  application belongs to `p_request_id`, returns the existing active selection when the same application is already
  `SELECTED` (a double click replays), refuses `start_passed` if `scheduled_start_at <= now()`, refuses
  `provider_unavailable` if the provider is not `approved`, refuses `invalid_state` unless the application is `APPLIED`;
  then inserts a `selections` row (`outcome` `active`, `provider_fee_amount` from `provider_fee_for(region,
  fixed_price)`, `provider_fee_kind` from settings, `payment_deadline` by the umbrella window rule), sets the application
  `SELECTED`, the request `SELECTED` and `active_selection_id`, and writes a `chosen` event.
- **AC-6**: While the request is `SELECTED`, calling `choose_applicant` with another `APPLIED` application switches: the
  old selection becomes `switched`, its application returns to `APPLIED`, a new active selection starts with a fresh
  deadline and a fresh fee figure, and a `switched` event is written. A switch is not a failed pick.
- **AC-7**: More than `picks_per_request_hour` choose or switch calls on one request in one hour refuse
  `too_many_picks` (counted in `action_counters`, subject the request id).
- **AC-8**: `withdraw_application(p_application_id)` (that provider only): from `APPLIED` sets `WITHDRAWN`; from
  `SELECTED` sets `WITHDRAWN`, the selection `withdrawn`, the request `OPEN` with `active_selection_id` null, and writes a
  `provider_withdrew` event with actor `provider` (it feeds the provider cancellation rate). From `AWAITING_FEE` it
  refuses `invalid_state` until 12. Any other caller gets `not_found`.
- **AC-9**: 04's `cancel_request` also accepts `SELECTED`: the selection becomes `cancelled`, every live application
  `CANCELLED`, the request `CANCELLED` with `cancelled_by` `customer`, and a `cancelled` event is written. Nothing is paid
  at this point, so nothing is refunded.
- **AC-10**: Every request has a `posted` event: a trigger writes it on insert, and the migration backfills existing
  requests from `created_at`. Events are append only: `update`, `delete` and `truncate` are refused for every role.
- **AC-11**: No role can update `requests.status`, `requests.active_selection_id`, `requests.failed_picks` or
  `applications.status` directly; 04's `requests_guard` is extended and a pgTAP meta test proves it for `authenticated`,
  `anon` and `service_role` (umbrella U-1).
- **AC-12**: The request page shows a timeline of the lifecycle: Posted, Chosen, Commission paid, Provider fee paid,
  Started, Done, Confirmed. Past steps show their time (from `request_events`, in the region's time zone), the current
  step shows its deadline, later steps are greyed. A cancelled request shows the cancel step instead of the rest.
- **AC-13**: My requests and the request page show the live applicant count per request.
- **AC-14**: The request page lists the applicant cards (AC-1, AC-2, AC-3) with a Choose button; Choose opens a confirm
  dialog that states the commission to pay (`requests.commission_amount`) and the deadline before the customer confirms
  (`ui-rules.md` §5). While `SELECTED`, the chosen card is marked and the others show Switch. Cancel is offered in
  `OPEN` and `SELECTED`.
- **AC-15**: On the provider's Applied tab (05), an application whose request is `SELECTED` or `COMMISSION_PAID` with
  another provider shows "The customer chose another provider for now"; a chosen provider sees "You were chosen,
  waiting for the customer to pay" and a Withdraw button.
- **AC-16**: Typed analytics events `applicant_chosen`, `pick_switched`, `application_withdrawn` carry only ids already
  allowed by the scrubber (no names, no messages).
- **AC-17**: All new strings in three locales; the pages pass axe at 390px in `ar`, `tr`, `en`; e2e covers choose,
  switch, withdraw and cancel in all three locales (umbrella U-6).

## Decision

Selections are their own rows (one per pick), so switches, withdrawals and expiries leave a history and the provider fee
is frozen with the pick. Other applicants stay `APPLIED` (umbrella, application states).

## Feature design

**Data model**: `selections`, `request_events`, `action_counters`, and `requests.active_selection_id`,
`requests.failed_picks` (umbrella table). RLS: `selections` readable by the request's customer and by the selection's
provider; `request_events` readable by the request's customer and by any provider with a live or past application on it,
only the kinds that concern them (`posted`, `chosen`, `switched`, `cancelled`, and events whose actor is that provider);
`action_counters` no API access. No write grant on any of them: definer functions only.

**State transitions**: `OPEN → SELECTED`, `SELECTED → SELECTED` (switch), `SELECTED → OPEN` (withdraw),
`SELECTED → CANCELLED` (customer). Application `APPLIED ↔ SELECTED`, `APPLIED | SELECTED → WITHDRAWN`.

**API surface**:

| Function or action | Kind | Key inputs | Key outputs | Auth | Key errors |
| --- | --- | --- | --- | --- | --- |
| `request_applicants` | definer, stable | request id | applicant cards | customer of the request | `not_found` |
| `provider_full_profile` | definer, stable | request id | full profile | customer, after commission | `forbidden` |
| `choose_applicant` | definer | request id, application id | selection id, deadline | customer of the request | `start_passed`, `provider_unavailable`, `invalid_state`, `too_many_picks` |
| `withdraw_application` | definer | application id | new status | that provider | `invalid_state`, `not_found` |
| `cancel_request` (04, extended) | definer | request id, reason | status | customer | `invalid_state` |
| `actions/selection.ts`: `chooseApplicant`, `withdrawApplication` | Server Actions via `guardedAction` | ids (Zod uuid) | typed result | `requireRole('customer')` / `('provider')` | mapped codes |

`lib/requests/` gains `listApplicants`, `getFullProfile`, `chooseApplicant`, `withdrawApplication`.

**Value sourcing**:

| Action | Value | Source |
| --- | --- | --- |
| Applicant card | name, entity type, years, languages, bio | `providers.approved_name`, `providers.entity_type`, `provider_profiles` |
| Applicant card | job count | count of `applications.status = 'CONFIRMED'` for that provider |
| Applicant card | photo | `profile_photo` object of that provider, signed by the customer |
| Choose | provider fee figure | `provider_fee_for(region, requests.fixed_price)` (05, defined in 0011-07) |
| Choose | payment deadline | `payment_window_hours`, `min_window_minutes`, `scheduled_start_at` |
| Choose dialog | commission to pay | `requests.commission_amount` |
| Timeline | step times | `request_events.created_at`, shown in `regions.timezone` |
| Rate limit | limit | `picks_per_request_hour` |

**Key invariants**: at most one `active` selection per request; `requests.active_selection_id` points to it exactly when
the request is `SELECTED` (from 09 also `COMMISSION_PAID` and later); a selection's fee never changes after insert.

**Security model**: customer reads only their own request's applicants; provider reads only their own selection; no
provider reads another provider's application or selection (rule 2); no contact field is in any return set. Photos are
opened by Storage policy, not by the app.

**Critical test scenarios**: choose then switch then cancel, each with the right rows and events (AC-5, AC-6, AC-9); a
second customer, a provider and anon get `not_found` or nothing (AC-1, AC-4); two sessions choosing different
applicants at once leave exactly one active selection (AC-5); choose after start refuses (AC-5); a direct status update
fails for every role (AC-11); withdraw from `SELECTED` reopens the request (AC-8).

## Build plan

1. Tests first, then the migration: three tables, two request columns, the guard extension, the `posted` trigger and
   backfill, the Storage policy for photos, `request_applicants`, `provider_full_profile`, `choose_applicant`,
   `withdraw_application`, `cancel_request` extended; pgTAP `13_selection` with the two session race; `npm run db:types`;
   satisfies **AC-1** to **AC-11**.
2. `lib/requests/` additions, `actions/selection.ts`, analytics events, unit tests; satisfies **AC-7**, **AC-16**.
3. UI: `ApplicantCard`, `StatusTimeline`, the choose dialog on `/requests/[id]`, count badges, the provider Applied tab
   copy; satisfies **AC-12** to **AC-15**.
4. Catalogues and e2e in three locales with axe; satisfies **AC-17**.
5. Owner pushes the migration after a dry run; reviews; merge.

## Consequences

- Positive: 09 and 12 find the pick, its deadline and its fee ready; the timeline is shared by every later child.
- Negative: no notice reaches the chosen provider until 13 (they see it on the Applied tab only); the job count is 0 for
  everyone at launch.
- Neutral: the `posted` backfill touches every existing request once.

## Rationale

A selection table instead of columns on `requests` keeps every pick's fee and deadline as history, which 12 needs to count
failed picks and 15 needs to show what a provider was offered. The photo goes through a Storage policy because the reveal
rule is RLS, never React (rule 2).
