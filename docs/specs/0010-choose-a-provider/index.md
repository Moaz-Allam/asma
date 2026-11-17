# 0010. Choose a provider (position 06)

**Date**: 2026-11-17
**Status**: Accepted (confirmed by the owner 2026-11-17, after a cross check on Sonnet, 17 findings, all applied)

## Summary

The customer opens their open request, reads the offers (each provider's first name and family initial, a
verified chip, how long they have been on the platform, and their message), and chooses one. The chosen
offer becomes `SELECTED`, every other offer `NOT_SELECTED`, the request `SELECTED`, and a payment deadline
starts (24 hours, or the job's start if that comes first). Nothing is paid here and no contact detail
opens: position 09 takes the commission and 10 the reveal. Because the customer now reads provider
messages, this position also closes the contact scanner gaps the 05 security review found (R11).

## Requirements

**User stories**:
- As a customer, I want to compare the offers on my request and choose one, so that my job gets done by
  someone I picked.
- As a customer, I want to see what happens next and by when, so that I do not lose the provider I chose.
- As a provider, I want to know whether I was chosen, so that I can get ready to pay my fee and do the job.
- As the owner, I want no provider to pass a phone number to the customer inside a message, and no
  suspended provider to be chosen or to hold an offer slot.

**Prerequisites** (not acceptance criteria):
- **05 merged** (spec 0009, PR #30, migration `20261117090000_provider_feed_apply` pushed, S31). 06 starts
  from that `master` on `feat/06-choose-provider`.
- **Design source**: the exported `docs/design/screens/customer/s6.jpg` and `s18.jpg` (phone), with the
  cash model correction for `s6` from `docs/design/README.md`: "choosing a provider says the commission is
  due next". `/develop` reads the live project if the `claude_design` MCP connects, and says so if it falls
  back to the export.
- **S21**: new strings go to the translator as `[tr]` keys.

**Acceptance criteria** (the contract):

*Offers (`s6`).*

- **AC-1**: `/{locale}/requests/[id]` for the customer's own request in `OPEN` (start in the future) shows
  "n offers" and one `OfferCard` per offer that can be chosen: an `APPLIED` application whose provider's
  standing is `approved` now. Oldest first (first come). Each card shows the provider's display name (AC-3)
  with a letter avatar, a "Verified" chip, "On Aldebyani since {month year}", "New" in place of a rating
  (ratings arrive in 17, job counts in 19), the message, and "Choose {first name}". Nothing else: no full
  name, photo, phone, email, provider id, tax number or document.
- **AC-2**: The request page reads offers only from `request_offers(p_request_id)`, a definer function. The
  caller must be the request's customer (an admin reads their own requests only, as D144); otherwise, and
  for an unknown or malformed id, it returns `null` (the page shows 404). Customers keep no read policy on
  `applications`. It returns one object with exactly these keys:
  - `status`, `timezone` (the region's), `payment_window_hours`, `selected_at`, `payment_deadline`,
    `cancelled_at` (each null until set);
  - `offers`: in `OPEN`, the choosable offers of AC-1, each `{ application_id, display_name, first_name,
    approved_since, message, message_hidden, created_at }`; `[]` in any other status;
  - `chosen`: in any status after a choose, the `SELECTED` (or, after a cancel, `CANCELLED`) application
    that `selected_application_id` names, with the same keys plus `status` and `suspended` (true when its
    provider is not `approved` now), whatever the provider's standing; `null` before a choose.
- **AC-3**: `display_name` is the first word of `providers.approved_name` plus a space and the first code
  point of its last word plus a full stop (`Ahmet Y.`, `أحمد س.`); a single word name returns the word; a
  blank or null name returns the localised word "Provider" on the page (the function returns null). Never
  case folded (rule 10). `approved_since` is the first day of the month of `providers.approved_at` in the
  region's time zone (`approved_at` is never null for an approved provider).
- **AC-4**: No offer yet: `EmptyState` "No offers yet. Providers in your district can see your request."
  An expired `OPEN` request (start passed) shows its offers read only, with "This request has expired" and
  no choose button.
- **AC-5**: Offers whose provider is not `approved` now (suspended, document expired) are hidden from
  `offers`, cannot be chosen, and no longer count toward the applicant cap. One helper,
  `approved_applied_count(p_request_id)`, counts `APPLIED` applications whose provider's standing is
  `approved`, and `apply_to_request`, `provider_feed`, `provider_request` and `provider_home_counts` all use
  it (R11, review F2). Their rows do not change. A reinstated provider can push the live count above the
  cap; that is allowed, and `request_full` still refuses at `count >= cap`.

*Choose.*

- **AC-6**: "Choose {first name}" opens a `ConfirmDialog` that restates: you choose this provider; you pay
  the commission of {commission} online next, within {payment_window_hours} hours or before the start if
  that is sooner; the rest, {cash due}, you pay the provider in cash after the service; the provider's
  contact details open after both of you have paid. Every figure is the stored minor units of the request.
  The exact deadline is shown only after the choose, from the stored value.
- **AC-7**: `choose_provider(p_request_id, p_application_id)`, a definer function, is the only way to
  choose. In one transaction, in this order, it:
  1. locks the request row (`select … for update`); an unknown id or another customer's request refuses
     `not_found`;
  2. if the request is `SELECTED` with `selected_application_id = p_application_id`, returns the replay
     with no write;
  3. refuses `not_choosable` unless the request is `OPEN` with `scheduled_start_at > now()` (a request
     already past `SELECTED`, such as `COMMISSION_PAID` from 09, also refuses here);
  4. reads `choose_settings(region)` (an integer, `payment_window_hours`), or raises
     `choose_settings_invalid`;
  5. reads the application without a lock (safe: every change to this request's applications takes the
     request lock first, and `provider_id` never changes), locks its provider's `providers` row `for share`,
     then locks the request's `applications` rows `for update`;
  6. refuses `offer_unavailable` unless the application belongs to this request, is `APPLIED`, and its
     provider's standing, read after the share lock, is `approved`;
  7. sets the chosen application `SELECTED` and every other `APPLIED` application of the request
     `NOT_SELECTED` (each with `status_changed_at = now()`);
  8. sets the request `SELECTED`, `selected_application_id`, `selected_at = now()` and
     `payment_deadline = least(now() + payment_window_hours, scheduled_start_at)`;
  9. writes one `audit_log` row (`request.provider_chosen`, ids and the deadline only).
  Both the new choose and the replay return `{ status: 'ok', replayed, selected_at, payment_deadline }`.
  Lock order is the one D156 set: request, provider (shared), applications.
- **AC-8**: Every refusal has copy in all three catalogues and sends no Sentry report, except
  `choose_settings_invalid` (alert) and unknown errors. `offer_unavailable` refreshes the offers.
  `not_choosable` refreshes the page into its current state.

*After the choose.*

- **AC-9**: The request page in `SELECTED` shows the chosen provider's card (AC-1 fields, no choose button,
  "Unavailable" when `suspended`), a "Next: pay the commission" panel with the commission, the cash due and
  the stored deadline in the region's time zone, and the line "Payment opens here soon" in place of a button
  (09 adds the hosted card page). The other offers are not listed.
- **AC-10**: A status timeline on the request page, from `request_offers` and the stored request only:
  Posted (`created_at`), Provider chosen (`selected_at`), Cancelled (`cancelled_at`), and the next step
  greyed ("Commission payment" in `SELECTED`). No new events table; 09 to 11 add their own steps from their
  own columns.
- **AC-11**: `cancel_request` (replaced again) also cancels a `SELECTED` request (§36 row 2): the request
  becomes `CANCELLED` and its `SELECTED` application `CANCELLED`; `NOT_SELECTED` rows stay. Nothing was paid,
  so nothing comes back. The audit row records the real old status. The cancel dialog of 04 is offered in
  `SELECTED` too, and says the chosen provider's application is cancelled.
- **AC-12**: The provider sees the outcome without a notification (13 and 18 add those): a chosen
  application reads "Chosen" with "The customer is paying the commission by {deadline}. Your fee comes after
  that." on `p8` and in My applications; a `NOT_SELECTED` one reads "Not chosen"; a `CANCELLED` one after a
  `SELECTED` request reads "The customer cancelled". `provider_request` and `provider_applications` add
  `payment_deadline`, set only when the caller's own application is `SELECTED`, else null, and
  `provider_request` still reports `closed: true` after the choose. `provider_home_counts` adds `selected`, shown as a third card "Chosen, waiting for the customer"
  when above 0. 05's strict schemas in `lib/provider-feed/schemas.ts` gain both keys, with unit tests.

*Contact scanner (R11).*

- **AC-13**: A new `message_has_contact_info(p_text)` is `has_contact_info(p_text)` or at least
  `message_digit_limit()` (10) digits in the whole normalised message. `apply_to_request` uses it at step 12.
  Bios, notes and answers keep `has_contact_info` unchanged. Messages stored before 06 are not rescanned;
  instead `request_offers` runs the new rule on each message it returns and, on a hit, returns
  `message: null, message_hidden: true`, and the card says "Message hidden".
- **AC-14**: The blank class (whitespace and invisible marks) has one SQL source, `blank_class()`.
  `catalog_trim` and `catalog_text_ok` build their pattern from it whole. `contact_normalise` strips the
  class without its whitespace part (`blank_marks()`), so word gaps stay and the 0006 and 0009 corpora stay
  green. A pgTAP meta test proves every non whitespace code point of the class is removed by
  `contact_normalise` and every code point by `catalog_trim`; the TypeScript copy test
  (`tests/requests-helpers.test.ts` over `lib/requests/blank.ts`) reads the new source.

*Access, privacy, observability.*

- **AC-15**: RLS and grants (rule 7): no new table; customers keep no direct read of `applications`;
  `request_offers` and `choose_provider` are executable by `authenticated` only, take identity from
  `auth.uid()`, pin `search_path`, and have an `anon` negative case. Every helper of this position has no API
  grant.
- **AC-16**: The message reaches the customer only through `request_offers` for their own request, never a
  log, an error, Sentry, PostHog or `audit_log`. `AnalyticsEvents` gains `provider_chosen:
  Record<string, never>`, sent from the browser after a new choose (a replay sends nothing).

*Quality.*

- **AC-17**: UI from the design source and `ui-tokens.md`, logical properties only, every string in all
  three catalogues, money and dates through the existing formatters in the region's time zone, 390 px first.
  New components get a `ui-registry.md` row: `OfferCard` and `OfferList` (rows exist, update them),
  `NextStepPanel`, `RequestTimeline` (row exists, update it).
- **AC-18**: pgTAP proves, each as its own case: every `choose_provider` refusal (unknown, other customer,
  provider token, admin on another's request, `SELECTED` with another application, `CANCELLED`, start
  passed, application of another request, `NOT_SELECTED`, `CANCELLED` application, suspended provider,
  expired document, missing setting); the replay writes nothing and returns the same shape; the deadline is
  capped by the start; the others become `NOT_SELECTED`; the guard refuses a write of the three columns
  outside `OPEN → SELECTED` and any later change to them; `request_offers` returns the exact key sets in
  `OPEN`, `SELECTED`, `CANCELLED` and expired, hides a suspended provider's offer, keeps a suspended chosen
  one with `suspended: true`, and hides a flagged message; `offer_display_name` on a single word, a blank
  name, an Arabic name and extra spaces; the cap ignores a suspended provider's row and allows over cap after
  a reinstatement; the cancel of a `SELECTED` request; the new scanner rule over the corpus of `verify.md`
  and the old corpora; the blank class meta test. Races through dblink: two chooses of different offers at
  once leave one `SELECTED`; a choose racing an apply, a cancel and a suspension each end in one consistent
  state.
- **AC-19**: The 05 and 04 pgTAP files that assert what 06 changes are updated in the same change: in 14,
  `OPEN → SELECTED` no longer refuses, `SELECTED` fixtures set the three columns (or go through
  `choose_provider`), the `provider_home_counts` results gain `selected`, the function grant list and the
  plan count follow; in 12, cancelling a `SELECTED` request now succeeds.
- **AC-20**: e2e at 390 px with axe in `ar`, `tr`, `en`: a customer sees two offers with no full name or
  phone on the page, chooses one, sees the next step panel with the commission and the deadline and the
  timeline; the chosen provider reads "Chosen", the other "Not chosen"; a provider is sent away from the
  customer's request page.
- **AC-21**: Real calls, recorded in `verify.md`, on a preview against the cloud after the push: a provider
  token calling `request_offers` and `choose_provider` is refused; a customer token reads no
  `applications` row through `/rest/v1`; a customer calling `choose_provider` on another customer's request
  gets `not_found`.

Reasoning and options: see [rationale.md](rationale.md).

## Decision

**Chosen option**: two definer functions (one read, one write) on the existing tables, three new columns on
`requests`, and the scanner tightened for messages only.

The customer reads offers only through `request_offers`, which returns named fields for their own request,
and chooses only through `choose_provider`, which takes the request lock first, then the chosen provider's
row, then the applications, so it serialises with apply, cancel and suspension. The scanner gains a
whole message digit rule that applies to apply messages only, and one shared blank class.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.agents/skills/supabase/`) ·
`supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) ·
`shadcn` (`shadcn-ui/ui`, `.claude/skills/shadcn/`) · `tailwind-design-system` (`.claude/skills/tailwind-design-system/`).

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model** (one migration, `20261118090000_choose_provider`, after 05's `20261117090000`). No new table.

`requests` gains:

| Column | Type | Rules |
| --- | --- | --- |
| `selected_application_id` | uuid null | FK `(selected_application_id, id)` to `applications(id, request_id)` |
| `selected_at` | timestamptz null | |
| `payment_deadline` | timestamptz null | `<= scheduled_start_at` |

A check holds the three null together, and `status = 'SELECTED'` requires them set. They stay set after
`SELECTED` (09 to 11 read them; 12 clears them when a request reopens). The key ties the chosen application
to this request; the region follows, because `applications (request_id, region)` already references
`requests (id, region)`. `applications` gains unique `(id, request_id)`. Index `(selected_application_id)`.

`requests_guard` adds the three columns to the list that may change, with two more rules: they may be
written only on the move `OPEN → SELECTED`, and once set they never change (12 widens this for its reopen).
The moves allowed become `OPEN → CANCELLED`, `OPEN → SELECTED` and `SELECTED → CANCELLED`.

`platform_settings` gains `payment_window_hours` in both regions: the JSON number 24, an integer from 1 to
72, held by a row check like 04's keys.

**State transitions** (this position):
- Request: `OPEN → SELECTED` by `choose_provider`; `SELECTED → CANCELLED` by `cancel_request`.
- Application: `APPLIED → SELECTED` and `APPLIED → NOT_SELECTED` by `choose_provider`; `SELECTED →
  CANCELLED` by `cancel_request`. `NOT_SELECTED` stays final until 12 widens `applications_guard` to
  restore it when a request reopens.

**Database functions** (each revokes `PUBLIC`, pins `search_path = ''`, passes `supabase/tests/02`):

| Function | Kind | Executable by | Job |
| --- | --- | --- | --- |
| `request_offers(p_request_id uuid)` | definer, stable | `authenticated` | AC-2 to AC-5, AC-9, AC-10, AC-13 |
| `choose_provider(p_request_id uuid, p_application_id uuid)` | definer, volatile | `authenticated` | AC-7 |
| `choose_settings(p_region text)` | invoker, stable | none | AC-7 step 4: returns the integer or raises |
| `approved_applied_count(p_request_id uuid)` | invoker, stable | none | AC-5 |
| `offer_display_name(p_name text)` | invoker, immutable | none | AC-3 |
| `message_digit_limit()`, `message_has_contact_info(p_text text)` | invoker, immutable | none | AC-13 |
| `blank_class()`, `blank_marks()` | invoker, immutable | none | AC-14 |
| `cancel_request`, `apply_to_request`, `provider_feed`, `provider_request`, `provider_applications`, `provider_home_counts`, `catalog_trim`, `catalog_text_ok`, `contact_normalise`, `requests_guard` | replaced | unchanged | AC-5, AC-11 to AC-14; the three blank function replacements are mechanical; `catalog_text_ok` becomes a definer function (the catalog checks run as the writing admin, and `catalog_trim` has no API grant) |

**API surface** (Server Actions in `actions/requests.ts`; reads in `lib/requests/` through `lib/db`):

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
| --- | --- | --- | --- | --- | --- |
| `/{locale}/requests/[id]` | page (exists) | `id` | adds `request_offers()`, the next step panel, the timeline | `guardPage(['customer', 'admin'])` | 404 when null |
| `chooseProviderAction` | Server Action | `requestId` uuid, `applicationId` uuid | `{ replayed, selectedAt, paymentDeadline }` | `['customer', 'admin']` | `not_found`, `not_choosable`, `offer_unavailable`, `choose_settings_invalid` |
| `cancelRequestAction` | Server Action (exists) | unchanged | unchanged | unchanged | `not_cancellable` now only past `SELECTED` |
| `/{locale}/provider/feed/[id]`, `/{locale}/provider/applications`, `/{locale}/provider` | pages (exist) | none | the chosen, not chosen and cancelled lines and the third count | `guardPage(['provider'])` | unchanged |

Zod at the action boundary is strict (unknown keys refused), as 05. The page reads `selected_at`,
`payment_deadline` and `cancelled_at` from `request_offers`, so 04's `getMyRequest` schema does not change.

**Value sourcing**:

| Action | Value | Source |
| --- | --- | --- |
| Offers | Display name, first name | `providers.approved_name` through `offer_display_name` (AC-3) |
| Offers | "On Aldebyani since" | `providers.approved_at`, first of its month in `regions.timezone`, from `request_offers` |
| Offers | Verified | `provider_standing() = 'approved'` (only such offers are returned in `offers`) |
| Offers | Message, hidden flag, order | `applications.message` checked by `message_has_contact_info`; `applications.created_at` |
| Confirm | Commission, cash due, currency | `requests.commission_amount`, `requests.cash_due`, `requests.currency` (stored at publish, D139) |
| Confirm | The window | `payment_window_hours` returned by `request_offers` from `platform_settings` of the request's region |
| Choose | Deadline | `least(now() + window, requests.scheduled_start_at)`, in Postgres |
| Next step, timeline | Deadline, steps | `request_offers`: `payment_deadline`, `selected_at`, `cancelled_at`; `requests.created_at` |
| Provider | Chosen line deadline | `requests.payment_deadline` through `provider_request`, own `SELECTED` application only |
| Home | Chosen count | `applications` with `status = 'SELECTED'` of the caller |
| Scanner | Digit count, limit | `contact_normalise(p_text)` digits 0 to 9; `message_digit_limit()` |

**Key invariants**:
- A request has at most one `SELECTED` application, and it is the one `selected_application_id` names.
- `status = 'SELECTED'` implies the three columns are set, and `payment_deadline <= scheduled_start_at`.
- The three columns are written once, on the choose, and never changed in 06.
- No customer reads another customer's offers; no provider reads any offer but their own.
- A provider not `approved` now is never chosen and holds no cap slot.
- No new apply message holds `message_digit_limit()` or more digits or anything `has_contact_info` flags,
  and no older one that would is shown to a customer.
- No money moves and no contact detail opens in 06.

**Security model**: the threat is a customer calling `/rest/v1/rpc` directly with a real token to read
another customer's offers or to choose on another's request, and a provider passing a phone number to the
customer inside a message before paying the fee. Identity comes from `auth.uid()` only; the request is
locked and owned before anything is read or written. The message is free text that may hold personal data,
so it is read only by its author, admin and the request's customer, and scrubbed everywhere else. Noted for
the security reviewer: `provider_standing(uuid)` has been executable by `authenticated` since 02, so any
signed in user can read any provider's standing by id (existing, out of scope here). **High risk paths
touched**: `supabase/migrations/**`, RLS, personal data. The `security-reviewer` agent runs before merge.

**Failure handling**:
- Two tabs choose different offers at once: the request lock serialises them; the second gets
  `not_choosable` (the request is `SELECTED`), or the replay when it chose the same offer.
- Choose while a provider applies: whoever locks the request first wins; an apply after the choose refuses
  `request_closed`.
- Choose while admin suspends the chosen provider: the share lock makes one wait; a choose after the
  suspension refuses `offer_unavailable`.
- Choose while the customer cancels in another tab: the request lock serialises them; a choose after the
  cancel refuses `not_choosable`, and a cancel after the choose cancels the `SELECTED` request (AC-11).
- The chosen provider is suspended after the choose: the request stays `SELECTED` until the customer
  cancels or the payment window ends (12 reopens it); the card reads "Unavailable".
- The start passes between page load and choose: `not_choosable`, the page refreshes.
- Setting missing: `choose_settings_invalid` and an alert; the page shows a generic error and the offers.
- Network loss on choose: a retry hits the replay at step 2.

**Configuration required**: none. No new environment variable, secret or service.

**Critical test scenarios**:
- Happy path: the customer chooses one of two offers, verifies **AC-6**, **AC-7**, **AC-9**, **AC-12**, **AC-20**.
- Failure case: two chooses at once leave one `SELECTED`; a choose racing a suspension, verifies **AC-7**, **AC-18**.
- Privacy: `request_offers` key sets, a rival customer gets `null`, a flagged old message is hidden, verifies **AC-2**, **AC-13**, **AC-15**, **AC-21**.
- Scanner: the corpus through `apply_to_request` with the new rule, and the old corpora unchanged, verifies **AC-13**, **AC-14**.

## Build plan

Tracer Bullet: one thin thread from the migration to a chosen offer on the page, then thicken.

1. pgTAP file 16 first (tests first, code standards §10): the choose refusals, the replay, the deadline, the
   guards, the grants, `request_offers` key sets, the display name, the cap helper, the scanner rule and the
   blank class meta test; dblink races in 17; satisfies **AC-18**.
2. Migration `20261118090000_choose_provider`: the three columns, the key and checks, the setting, the
   guards widened, `blank_class` and `blank_marks` with the three functions rebuilt on them,
   `message_digit_limit`, `message_has_contact_info`, `choose_settings`, `offer_display_name`,
   `approved_applied_count`; satisfies **AC-5**, **AC-13**, **AC-14**, **AC-15**.
3. `request_offers` and `choose_provider`; `cancel_request` replaced; the cap counts moved onto
   `approved_applied_count`; the provider's deadline and the `selected` count; then update pgTAP 12 and 14
   for what 06 changes; `npm run db:types`; satisfies **AC-2**, **AC-3**, **AC-5**, **AC-7**, **AC-11**,
   **AC-12**, **AC-19**.
4. `lib/requests/` (`loadOffers`, `chooseProvider`), `chooseProviderAction` (strict Zod, error mapping,
   alert), the event; `lib/provider-feed/schemas.ts` gains `payment_deadline` and `selected`, with tests;
   `lib/requests/blank.ts` and its copies test follow `blank_class`; satisfies **AC-8**, **AC-12**,
   **AC-14**, **AC-16**.
5. UI thread: `OfferList` and `OfferCard` with the confirm dialog on `/requests/[id]`, then
   `NextStepPanel` and `RequestTimeline`, in `ar` first then `tr` and `en`, at 390 px; satisfies **AC-1**,
   **AC-4**, **AC-6**, **AC-9**, **AC-10**, **AC-17**.
6. The provider side: the chosen, not chosen and cancelled lines on `p8` and My applications, the third home
   card; the cancel dialog in `SELECTED`; satisfies **AC-11**, **AC-12**.
7. e2e journey and axe; satisfies **AC-20**.
8. After the owner pushes the migration: the real calls in `verify.md`; satisfies **AC-21**.

## Consequences

**Positive**:
- The core loop reaches its first decision point: post, apply, choose.
- The customer reads offers through one function with a fixed field list, so nothing new about a provider
  leaks by accident.
- The lock order now covers choose, so 09, 10 and 12 inherit a rule that already works.
- One blank class ends the drift between the trim, the checks and the scanner.

**Negative / tradeoffs**:
- Offers show no rating or job count until 17 and 19, so early providers look alike.
- The whole message digit rule refuses some honest messages with many numbers (a full date and time, sizes,
  years); the provider rewrites them. A spelled phone split into short runs with words between can still
  pass.
- An older message the new rule would refuse is hidden from the customer rather than shown, so a provider
  who applied before 06 may lose their message.
- A chosen provider suspended after the choose keeps the request `SELECTED` until the customer cancels or
  12 reopens it at the end of the payment window.
- `NOT_SELECTED` is final until 12 restores it, so 12 must widen `applications_guard` and `requests_guard`.

**Neutral**:
- No notification is sent in 06; the provider learns the outcome on their own pages until 13.

## Follow-up

- [ ] Position 09: the pay button in the next step panel, `COMMISSION_PAID`, and the provider fee window.
- [ ] Position 12: payment window expiry (`SELECTED → OPEN`), restoring `NOT_SELECTED` to `APPLIED`, clearing
      the three columns (widening both guards), the reopen of a request whose chosen provider was suspended,
      and the re-pick rule for `EXPIRED` rows blocked by the unique key (0009 follow up).
- [ ] Position 13: notification 3 ("You were chosen") from the `SELECTED` application.
- [ ] Position 17 and 19: rating, job counts and reviews on the offer card.
- [ ] Position 21: whether `provider_standing(uuid)` should stay executable by every signed in user.
- [ ] Leakage monitoring (old feature 24): the scanner is defence in depth, not a guarantee.
