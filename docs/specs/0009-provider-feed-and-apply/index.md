# 0009. Provider feed and apply (position 05)

**Date**: 2026-11-16
**Status**: Accepted (confirmed by the owner 2026-11-16, after a cross check on Sonnet, 20 findings, all applied)

## Summary

An approved provider picks the services, districts and work days they cover (`p4`, moved here from 02), then sees a feed
of open requests that match, and applies to one with a short message. Applying is free. Before anyone has paid, a provider
sees only structured short details (service, district, dates, the job price, the cash they would collect, addons and the
answers to choice questions); the customer's name, phone, address, notes and typed answers never leave the database. Every
rule that matters lives in database functions, because a provider can call the database directly with a real token. No
money moves in this position, nothing is paid and nothing is revealed.

## Requirements

**User stories**:
- As a provider, I want to say once which services, districts and days I work, so that my feed shows only jobs I can take.
- As a provider, I want to judge a job from its short details and apply in under a minute on my phone, so that I win work.
- As a provider, I want to see my applications and where each stands, so that I know what to expect.
- As a customer, I want my identity, address and notes hidden from every provider until we have both paid, so that nobody
  can contact me or go around the fees.
- As the owner, I want rivals blind to each other's offers, a cap on offers per request and a limit on how fast one
  provider can apply, so that the marketplace stays fair and spam stays out.

**Prerequisites** (not acceptance criteria):
- **04 merged** (spec 0008, PR #28, migration `20261116090000_post_request`) and pushed to the cloud. Branch `feat/05-feed-apply`
  starts from that `master`. This spec reads `requests`, `regions.timezone`, `catalog_trim`, `cancel_request` and the
  settings pattern from 04, and `has_contact_info`, `provider_standing`, `provider_can_apply`, `is_admin` from 02.
- **Design source.** The live `claude_design` MCP did not connect for this spec (403, 2026-11-16), so this spec was drawn
  from the committed export: `docs/design/screens/provider/p4.jpg`, `p6.jpg`, `p8.jpg`, `p10.jpg`, `p17.jpg`, and
  `Nazzafly Provider Web.dc.html` in `docs/design/source/`. `/develop` reads the live project when the MCP connects and says
  out loud if it falls back to the export. The cash model corrections for `p8` and `p10` (S24) are applied by AC-12 below.
- **S21.** New strings go to the translator as `[tr]` keys.

**Acceptance criteria** (the contract):

*Setup (`p4`).*

- **AC-1**: The migration `provider_feed_apply` adds `provider_services`, `provider_zones`, `provider_availability`,
  `applications` and `apply_counters` as Feature design draws them, unique `(id, region)` on `providers`, and two settings
  per region in `platform_settings`: `max_applicants_per_request` 10 (an integer from 1 to 50) and `applications_per_hour`
  20 (an integer from 1 to 1000), each held to its shape by a row check like 04's keys. A missing or malformed value
  refuses `apply_settings_invalid` from `apply_settings(p_region)`; the action and the feed and detail page reads each raise
  an alert (as 04 AC-11).
- **AC-2**: `/{locale}/provider/setup` (`p4`) shows three groups: services (every active service of the provider's region,
  by category, name and note, as `ToggleChips` cards), districts (every active zone, as `ToggleChips`), and work days
  (seven day chips, Saturday to Friday in `ar`, Monday to Sunday in `tr` and `en`) with a start and end hour (`select`,
  whole hours, end after start). A summary card counts the picks. "Save" calls `saveProviderSetup`. The page states that
  changing services and districts never sends the file back to review. No "from" price, no "I bring my tools" tick (D152).
- **AC-3**: `save_provider_setup(p_service_ids, p_zone_ids, p_work_days, p_start_hour, p_end_hour)` replaces the caller's
  three sets in one transaction. It refuses `forbidden` without a `providers` row for `auth.uid()`, `provider_suspended`
  while suspended, and `setup_invalid` (with the failing field) for: no service, no zone or no work day; more than 50
  services or 100 zones; an id that is not active or not in the caller's region; a duplicate; a day outside 0 to 6 (0 is
  Sunday, as Postgres `dow`); `start_hour` outside 0 to 23, `end_hour` outside 1 to 24, or `end_hour <= start_hour`. Any
  standing but `suspended` may save, so a provider under review can be ready on approval. It first locks the caller's
  `providers` row (`select … for update`), so two saves run one after the other and a save that waits on a suspension sees
  it. A pick that admin later turns off stays stored and keeps covering requests already posted for it (AC-5); `p4` shows
  it greyed as "no longer offered" and does not send it again, so the next save drops it. An inactive id the function
  receives still refuses `setup_invalid`.
- **AC-4**: Setup gates applying only (D151). 02's submit, approve and suspend flows do not change. A setup is complete
  when the provider has at least one active service, at least one active zone, and an availability row. An approved
  provider whose setup is not complete sees `EmptyState` "Set up your services and districts" with a link to
  `p4` in place of the feed, and `apply_to_request` refuses `setup_incomplete`. A suspended provider sees `p4` read only.

*Feed (`p10`) and short details (`p8`).*

- **AC-5**: `/{locale}/provider/feed` lists, for a provider with standing `approved` and a complete setup (AC-4), requests
  that are `OPEN`, have `scheduled_start_at > now()`, share the provider's region, and whose service is among the
  provider's stored services and zone among their stored districts (active or not, AC-3). `provider_feed` returns nothing
  to any other caller. A request is "outside hours" when its start, in the region's timezone, falls on a day not in
  `work_days`, or at an hour outside `[start_hour, end_hour)`; the end time is not tested. Order: inside hours first, then
  soonest start, then `id`, with the divider "Outside your working hours" before the first outside row (shown, not
  hidden); 20 a page with "show more", keyset on `(outside_hours, scheduled_start_at, id)`. Filter chips narrow within the
  provider's own services and districts: a filter is intersected with the setup, so an empty result is possible and a
  filter can never widen the feed. Date chips "this week", "next week", "all" (default) are computed by the action from
  the timezone `provider_feed` returns, as region local dates `[p_from, p_to)` (end not included); weeks start Monday in
  `tr` and `en`, Saturday in `ar`. Filters live in the URL search params. There is no minimum lead time: a request is
  open to applications until its start (04 already holds the lead time at posting).
- **AC-6**: A feed card shows: service name, district name, start day, date and hour in the region's timezone, the job price,
  "n of m offers" (`APPLIED` count against the cap), a "You applied" chip when the caller has an application, and "Details
  and apply". A full request (count at the cap) stays in the list, greyed, with "Reached the limit" and no button. Nothing
  else: no customer name, initial, phone, address, notes or typed answer.
- **AC-7**: Short details are structured only (D146). `provider_feed` and `provider_request` are the only provider reads of a
  request. They select columns by name and return: `id`, `service_id`, `zone_id`, the service name and the zone name from
  `pricing_snapshot`, the addon names from the fired addon lines of `pricing_snapshot`, `scheduled_start_at`,
  `scheduled_end_at`, `fixed_price`, `cash_due`, `currency`, the `APPLIED` count, the cap, `full`, `outside_hours`, and the
  caller's own application (id, status, created_at) or null; `provider_feed` also returns the region's `timezone` once per
  page. Addons come in breakdown order. `provider_request` adds the answers whose `questions_snapshot` type is
  `single_select`, `multi_select`, `number`, `boolean`, `date` or `time`, in the snapshot's question order, each as
  `{ key, label, type, value, option_labels }`: `label` is the question label in every stored locale; `value` is the
  stored integer, boolean, `YYYY-MM-DD` or `HH:MM` for `number`, `boolean`, `date`, `time` and null for the two select
  types; `option_labels` is an array of option labels (each in every stored locale) for the select types and null
  otherwise. The page renders a boolean as the localised "Yes" or "No". They never return `customer_id`, `client_key`, `notes`, a `text` or `textarea` answer, the rest of
  either snapshot, `commission_amount`, any cancel column, or anything from `request_addresses`. The customer's notes reach a
  provider only after both have paid (position 10).
- **AC-8**: `/{locale}/provider/feed/[id]` (`p8`) shows the short details of AC-7 as rows (service, addons, each structured
  answer, start and expected end, district, "Exact address after both of you have paid"), the price card of AC-12, and the
  apply form of AC-9. `provider_request` returns the request when it is in the caller's feed by AC-5 (so only for
  standing `approved` with a complete setup), or when the caller has an application on it, in any request or application
  state and any standing, so a provider can reread what they applied to (short details only, never more). Otherwise, including another
  region, an uncovered service or zone, an unknown or malformed id, it returns nothing and the page shows 404. A request
  that left `OPEN` or whose start passed, read by a provider who applied, shows the details with "This request is closed"
  and no form.

*Apply.*

- **AC-9**: The apply form has one required message field (20 to 600 code points after `catalog_trim`, with a live counter
  "n / 600"), the standing warning above it "Do not share phone numbers, emails, links or social handles. Messages with
  contact details are refused.", and "Apply, free". A `ConfirmDialog` restates: applying costs nothing; a provider fee is
  due only if the customer chooses you; your offer goes to the customer now. There is no price field, no question set and
  no proposed start (D152). There is no live scan while typing (as 02).
- **AC-10**: `apply_to_request(p_request_id, p_message)` is the only way to create an application (D148). In one
  transaction, in this order, it:
  1. refuses `forbidden` unless `auth.uid()` has a `providers` row and a `provider` profile;
  2. reads `provider_standing(auth.uid())`: `suspended` refuses `provider_suspended`; anything but `approved` refuses
     `not_approved` (so `document_expired` is refused);
  3. refuses `setup_incomplete` unless the setup is complete (AC-4);
  4. locks the request row (`select … for update`); an unknown id or another region refuses `not_found`;
  5. if the caller already has an application on this request, returns it as `{ status: 'ok', replayed: true, application }`
     with no write, whatever the request's state now (D155);
  6. refuses `not_found` when the request's service or zone is not among the caller's stored picks (same code as unknown,
     so ids cannot be probed);
  7. refuses `request_closed` unless the request is `OPEN` with `scheduled_start_at > now()`;
  8. reads `apply_settings(region)`, or raises `apply_settings_invalid`;
  9. refuses `request_full` when the request's `APPLIED` count is at `max_applicants_per_request`;
  10. counts one application attempt in `apply_counters` and raises `too_many_applications` past `applications_per_hour`;
  11. trims the message with `catalog_trim` and returns `{ status: 'refused', code: 'message_invalid' }` outside 20 to 600;
  12. returns `{ status: 'refused', code: 'contact_info_in_message' }` when `has_contact_info` flags it;
  13. inserts the application (`APPLIED`, the trimmed message, the request's region) and returns
      `{ status: 'ok', replayed: false, application: { id, status, created_at } }`.
  Steps 11 and 12 return instead of raising, so the count from step 10 commits: probing the scanner costs rate limit.
  Lock order, a rule for every later position that touches applications: the request row first, then the caller's
  `apply_counters` row, then `applications` rows. No `raise` and no returned error detail ever carries the message text.
  The fixed window allows up to twice the limit across a window edge; accepted.
- **AC-11**: Every provider facing refusal has copy in all three catalogues, keeps the message in the field, and sends no
  Sentry report except `apply_settings_invalid` (alert) and unknown errors. `contact_info_in_message` reads "Your message
  has contact details. Remove phone numbers, emails, links and social handles." `request_full` and `request_closed`
  replace the form with the matching line. `too_many_applications` reads "Too many applications in the last hour. Try
  again later." A replay shows the stored application's status chip and time ("You applied" only while `APPLIED`, never
  "the customer will see your offer" for a final status). After a new application the page shows "You applied.
  The customer will see your offer." and `revalidatePath` refreshes the feed and the applications list.
- **AC-12**: Money shown (D147). `p8`'s price card and `p10`'s card show the job price (`fixed_price`) large through
  `MoneyDisplay`. `p8` adds "Cash you collect from the customer after the service" with `cash_due`, and the line "Applying
  is free. A provider fee is due only if you are chosen." with no figure (07 and 10 add the fee). Nothing on these pages
  computes money; every figure comes from the function as minor units.

*Applications and home.*

- **AC-13**: `/{locale}/provider/applications` lists the caller's applications, newest first, 20 a page (keyset on
  `(created_at, id)`), each with the service, district, start, job price, a `StatusChip` for the application status, and a
  link to `p8`. Empty: `EmptyState` with a link to the feed. Withdraw is position 12 (`p13`), not here.
- **AC-14**: `/{locale}/provider` for `approved` replaces 02's `EmptyState` with two count cards from
  `provider_home_counts()`: open requests in my feed that are not full (AC-5, inside working hours or not) and my
  `APPLIED` applications (including those whose request start has passed, until position 12 expires them), each linking
  to its page, or the setup `EmptyState` of AC-4. Other standings keep 02's pages.
- **AC-15**: The provider navigation gains "Available requests" (`/provider/feed`), "My applications"
  (`/provider/applications`) and "Services and districts" (`/provider/setup`, also linked from `p7`). Feed, detail and
  applications use `guardPage(['provider'])`; setup the same; every action uses `guardedAction(['provider'])`. A customer
  or admin is sent away from all four pages. By standing (a `provider` profile with no `providers` row reads as `draft`,
  as in 02):

  | Standing | `/provider/setup` | `/provider/feed` | `/provider/feed/[id]` | `/provider/applications` |
  | --- | --- | --- | --- | --- |
  | `approved`, setup complete | Edit | Feed | Details and form | List |
  | `approved`, setup not complete | Edit | Setup `EmptyState` | Own applications only, else 404 | List |
  | `draft`, `pending`, `rejected` | Edit | 02's standing page | Own applications only, else 404 | List (empty) |
  | `document_expired` | Edit | 02's standing page | Own applications only, no form | List |
  | `suspended` | Read only | 02's standing page | Own applications only, no form | List |

*Races and lifecycle.*

- **AC-16**: Cancel (D155). 05 replaces 04's `cancel_request` so that, after it locks the request row and sets
  `CANCELLED`, it sets every `APPLIED` application of that request to `CANCELLED` with `status_changed_at = now()`, in the
  same transaction. Apply and cancel both lock the request row first, so one waits for the other: an apply after a cancel
  refuses `request_closed`; a cancel after an apply cancels it. Position 06's choose must take the same lock first.
- **AC-17**: Applications statuses are the twelve of `project-overview.md` §22. This position writes `APPLIED` (apply) and
  `CANCELLED` (cancel) only. `applications_guard` (before update and delete, even against `postgres`) refuses a delete, any
  change to `id`, `region`, `request_id`, `provider_id`, `message`, `created_at`, and a status change out of a final status
  (`NOT_SELECTED`, `WITHDRAWN`, `EXPIRED`, `CANCELLED`, `CONFIRMED`, `RATED`); later positions widen it for their own
  transitions.

*Access, privacy, observability.*

- **AC-18**: RLS (rule 7), each with a negative pgTAP test in the same migration. `applications`: a provider reads only rows
  with `provider_id = auth.uid()`; admin reads all through `is_admin()`; a customer and anon read none (06 adds the
  customer's read of applications on their own requests). An INSERT policy `with check (provider_id = auth.uid() and
  provider_can_apply(auth.uid()))` stays as defence in depth, but no API role, `service_role` included, holds an insert,
  update or delete grant on `applications`. `provider_services`, `provider_zones`, `provider_availability`: a provider
  reads only their own rows, admin reads all, a customer and anon read none, no API role writes. `apply_counters`: admin
  reads, nobody else reads, no API role writes. `requests` and `request_addresses` keep 04's policies: a provider token
  still reads zero rows from both directly.
- **AC-19**: Every new or replaced function revokes all from `public, anon, authenticated, service_role` (as 02 does),
  then grants only what the functions table lists; pins `search_path = ''`; and passes `supabase/tests/02`, with a pgTAP
  case per function that `anon` cannot execute it. The provider functions refuse a token without a `providers` row with
  `forbidden`. No function an API role can execute takes a provider id: identity comes from `auth.uid()` only
  (`count_application` takes one but has no API grant). `has_contact_info` keeps no API grant.
- **AC-20**: The message text, the notes, the answers and the address never reach logs, Sentry, PostHog or `audit_log`. A
  Server Action body is not keyed, so the key list is a second line, not the guard: no Sentry event attaches a request
  body (`sendDefaultPii` stays off and no request body option is turned on), and a unit test feeds a failing
  `applyToRequest` through `captureRequestError` and the scrubber and asserts the event has no message text. The
  scrubber's key list also gains `application_message` (the action's input is `applicationMessage`, never a bare
  `message`, so error messages keep flowing). No event or log carries a request's district or service with a time, only
  ids.
- **AC-21**: `AnalyticsEvents` gains `provider_setup_saved: { services: number; zones: number }` and
  `application_submitted: Record<string, never>`, sent from the browser after a success (a replay sends nothing), each in
  `filter.ts` with its allowed keys.

*Quality.*

- **AC-22**: UI: every value comes from the design source and `ui-tokens.md`; logical properties only (`npm run lint:rtl`);
  every new string in all three catalogues; numbers, money and dates through the existing formatters with the region's
  timezone. New components get a `ui-registry.md` row in the same change: `FeedCard`, `ShortDetailsList`,
  `ApplicationForm` (row exists; drop "live scan chip" and "structured answers"), `ProviderSetupForm`, `ApplicationRow`.
- **AC-23**: pgTAP proves, each as its own case: every AC-10 refusal, including each standing (`draft`, `pending`,
  `rejected`, `suspended`, `document_expired`), a customer token, an admin token, setup incomplete, uncovered service,
  uncovered zone, other region, `CANCELLED`, `SELECTED`, start passed, full at the cap, the 21st attempt in an hour and the
  first after the window; the replay returns the first row and counts nothing; the message must catch and must pass
  corpus of [verify.md](verify.md) through `apply_to_request`; a refused message still counts; `provider_feed` and
  `provider_request` never return a forbidden key (assert the exact key set of the jsonb, and that a fixture `text`
  answer and the notes are absent); a rival provider reads no row of another's application and gets nothing from
  `provider_request` for a request outside their setup; two parallel applies at cap minus one (through dblink, as 03 D134)
  leave exactly cap rows; cancel and apply in parallel never leave an `APPLIED` row on a `CANCELLED` request;
  `provider_feed` returns nothing to a `draft`, `pending`, `rejected`, `suspended` or `document_expired` provider and to
  an approved provider whose picks are all inactive; paging across the outside hours divider neither skips nor repeats a
  row; a filter id outside the setup returns no row; a request for a service admin turned off stays in the feed of a
  provider who picked it; `anon` cannot execute any new function.
- **AC-24**: e2e at 390 px with axe in `ar`, `tr`, `en` on the real local database: an approved provider without setup sees
  the setup prompt, saves `p4`, sees the fixture request in the feed with no name, phone, address, notes or typed answer on
  the page, applies, sees "You applied" and the row in My applications; a message with an Arabic Indic phone is refused and
  kept; a second provider sees "1 of 10 offers" and never the first provider's message; the customer cancels and the
  application shows `CANCELLED`. A customer is sent away from the four provider pages.
- **AC-25**: Real calls, recorded in `verify.md`, on a preview against the cloud project after the push: a real provider
  token reading `requests`, `request_addresses` and another provider's `applications` through `/rest/v1` gets zero rows; a
  direct `POST /rest/v1/applications` is refused; `/rest/v1/rpc/has_contact_info` is refused; `apply_to_request` with a
  contact detail message is refused and the Sentry and PostHog payloads of that request carry no message text.

Reasoning and options: see [rationale.md](rationale.md).

## Decision

**Chosen option**: definer functions as the only provider reads and writes, structured short details, setup that gates
applying only.

Providers read requests only through two definer functions that select named columns, and write applications only through
`apply_to_request`, which checks standing, setup coverage, request state, the cap, the rate limit and the contact scanner in
one locked transaction; the build plan's "`provider_can_apply()` in the insert policy" survives as a defence in depth
policy on a table no API role may insert into.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.agents/skills/supabase/`) ·
`supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) ·
`shadcn` (`shadcn-ui/ui`, `.claude/skills/shadcn/`) · `tailwind-design-system` (`.claude/skills/tailwind-design-system/`).

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model** (owner confirmed 2026-11-16). One migration, `provider_feed_apply`, timestamped after 04's
`20261116090000_post_request`. `lib/db/database.types.ts` follows through `npm run db:types`. CI greps migrations, so the
phrase `create table` stays out of comments, and `region` starts its own line in each table. Every foreign key has a
covering index, every table an index on `region`, every reference is on delete restrict.

`providers` gains unique `(id, region)`, so the tables below can hold a provider's region by key.

`provider_services`:

| Column | Type | Rules |
| --- | --- | --- |
| `provider_id` | uuid not null | FK `(provider_id, region)` to `providers(id, region)` |
| `service_id` | uuid not null | FK `(service_id, region)` to `services(id, region)` |
| `region` | text not null | FK `regions(code)` |
| `created_at` | timestamptz not null | default `now()` |

PK `(provider_id, service_id)`; index `(service_id)`.

`provider_zones`: the same shape with `zone_id` FK `(zone_id, region)` to `zones(id, region)` (04 adds that unique). PK
`(provider_id, zone_id)`; index `(zone_id)`.

`provider_availability`:

| Column | Type | Rules |
| --- | --- | --- |
| `provider_id` | uuid PK | FK `(provider_id, region)` to `providers(id, region)` |
| `region` | text not null | FK `regions(code)` |
| `work_days` | smallint[] not null | 1 to 7 distinct values, each 0 to 6 (0 Sunday, Postgres `dow`); a check through an immutable helper |
| `start_hour` | smallint not null | 0 to 23 |
| `end_hour` | smallint not null | 1 to 24, `> start_hour` |
| `updated_at` | timestamptz not null | default `now()` |

`applications`:

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid PK | default `gen_random_uuid()` |
| `region` | text not null | FK `regions(code)` |
| `request_id` | uuid not null | FK `(request_id, region)` to `requests(id, region)` |
| `provider_id` | uuid not null | FK `(provider_id, region)` to `providers(id, region)` |
| `message` | text not null | `char_length` 20 to 600 (the function trims first) |
| `status` | text not null | default `APPLIED`; check in the twelve values of §22 |
| `created_at` | timestamptz not null | default `now()` |
| `status_changed_at` | timestamptz not null | default `now()` |

Unique `(request_id, provider_id)`. Indexes: `(provider_id, created_at desc, id)`, `(request_id, status)`.

`apply_counters`: `provider_id` uuid PK FK `providers(id)`, `region` text not null FK `regions(code)`, `window_start`
timestamptz not null, `count` integer not null (`>= 1`). One row per provider, overwritten, no personal data.

Relations: a provider has many services, zones and applications and at most one availability row; a request has many
applications; a provider applies to a request at most once.

**State transitions** (this position): application `(none) → APPLIED` by `apply_to_request`; `APPLIED → CANCELLED` by
`cancel_request` when the customer cancels. Request transitions are unchanged from 04. "Closed" for a provider is a
reading: the request is not `OPEN`, or its start passed. Every other application transition belongs to 06 (`SELECTED`,
`NOT_SELECTED`), 09 and 10 (`AWAITING_FEE`, `UNLOCKED`), 11 (`STARTED`, `COMPLETED`, `CONFIRMED`), 12 (`WITHDRAWN`,
`EXPIRED`) and 17 (`RATED`).

**Database functions** (each revokes `PUBLIC`, pins `search_path = ''`, passes `supabase/tests/02`):

| Function | Kind | Executable by | Job |
| --- | --- | --- | --- |
| `apply_settings(p_region text)` | invoker, stable | none | AC-1. Reads and checks both keys or raises `apply_settings_invalid` |
| `provider_setup()` | definer, stable | `authenticated` | AC-2. The caller's picks plus active services (with category) and zones of their region, names as localised jsonb, and `inactive` flags for stored picks admin turned off |
| `save_provider_setup(p_service_ids uuid[], p_zone_ids uuid[], p_work_days smallint[], p_start_hour integer, p_end_hour integer)` | definer, volatile | `authenticated` | AC-3 |
| `provider_feed(p_service_ids uuid[], p_zone_ids uuid[], p_from date, p_to date, p_after_outside boolean, p_after_start timestamptz, p_after_id uuid)` | definer, stable | `authenticated` | AC-5 to AC-7. Nulls mean no filter or first page; filters are intersected with the setup; returns `{ timezone, has_more, rows }`, 20 rows, each with `outside_hours` |
| `provider_request(p_request_id uuid)` | definer, stable | `authenticated` | AC-7, AC-8. Null when not visible |
| `apply_to_request(p_request_id uuid, p_message text)` | definer, volatile | `authenticated` | AC-10 |
| `count_application(p_provider_id uuid, p_region text, p_limit integer)` | invoker, volatile | none | AC-10 step 10. One atomic `insert … on conflict (provider_id) do update` that resets a window older than an hour; raises `too_many_applications` |
| `provider_applications(p_after_created_at timestamptz, p_after_id uuid)` | definer, stable | `authenticated` | AC-13. The caller's rows with the same short detail columns as the feed (no message needed in the list) |
| `provider_home_counts()` | definer, stable | `authenticated` | AC-14 |
| `cancel_request(p_request_id uuid, p_reason text)` | definer, volatile | `authenticated` | Replaced, AC-16. 04's behaviour plus the applications update |
| `applications_guard()` | invoker, trigger | none | AC-17 |

**API surface** (Server Actions in `actions/provider-feed.ts`; reads in `lib/provider-feed/` through `lib/db`):

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
| --- | --- | --- | --- | --- | --- |
| `/{locale}/provider/setup` | page | none | `provider_setup()` | `guardPage(['provider'])` | 404 none; suspended read only |
| `saveProviderSetup` | Server Action | `serviceIds`, `zoneIds`, `workDays`, `startHour`, `endHour` | `ok` | `['provider']` | `setup_invalid` (field), `provider_suspended`, `forbidden` |
| `/{locale}/provider/feed` | page | search params `service`, `zone`, `when` (`week`, `next`, `all`), cursor | `provider_feed()` | `guardPage(['provider'])` | setup prompt; not approved → 02's standing page |
| `/{locale}/provider/feed/[id]` | page | `id` (uuid, Zod) | `provider_request()` | `guardPage(['provider'])` | 404 when null or malformed |
| `applyToRequest` | Server Action | `requestId` uuid, `applicationMessage` string | `{ status, replayed, application }` or `{ status: 'refused', code }` | `['provider']` | the AC-10 codes |
| `/{locale}/provider/applications` | page | cursor | `provider_applications()` | `guardPage(['provider'])` | empty state |
| `/{locale}/provider` | page (exists) | none | adds `provider_home_counts()` for `approved` | exists | exists |

Zod at every action boundary rejects unknown keys and bounds arrays (50 services, 100 zones, 7 days) and the message (2000
characters before the trim, so the database sees the real refusal).

**Value sourcing**:

| Action | Value | Source |
| --- | --- | --- |
| Setup | Service and zone lists | `services`, `zones` where `active` and the caller's region, through `provider_setup()` |
| Setup | Caller's region | `providers.region` for `auth.uid()` |
| Feed | Matching requests | `requests` joined to the caller's `provider_services` and `provider_zones`, `status = 'OPEN'`, `scheduled_start_at > now()` |
| Feed | Service, district, addon names | `requests.pricing_snapshot` (`service.name`, the zone line, the addon lines), as 04 AC-9 |
| Feed | Date chip bounds | Today in `regions.timezone` of the caller's region; week start by locale (AC-5) |
| Feed | Outside hours flag | `extract(dow / hour from scheduled_start_at at time zone regions.timezone)` against `provider_availability` |
| Feed, detail | Offers count, cap, full | `count(*)` of `applications` with `status = 'APPLIED'`; `apply_settings(region)` |
| Detail | Structured answers | `requests.answers` filtered by the `type` of each key in `requests.questions_snapshot` (AC-7) |
| Detail, card | Job price, cash to collect, currency | `requests.fixed_price`, `requests.cash_due`, `requests.currency` |
| Detail | Provider fee | Not shown; a fixed line with no figure until 07 and 10 (D147) |
| Apply | Standing | `provider_standing(auth.uid())` (02) |
| Apply | Cap, hourly limit | `platform_settings` keys of AC-1 for the request's region |
| Apply | Message checks | `catalog_trim` (03), `has_contact_info` (02) |
| Apply | Application region | `requests.region`, equal to `providers.region` by the composite keys |
| Applications | Status label | `applications.status` through `StatusChip` |
| Home | Counts | `provider_home_counts()`: the AC-5 set and the caller's `APPLIED` rows |

**Key invariants**:
- No provider reads `customer_id`, `client_key`, `notes`, a typed answer or any `request_addresses` column before position
  10's both paid rule.
- A provider never reads another provider's application, message or identity.
- An application's region is its request's and its provider's, by key.
- At most one application per `(request_id, provider_id)`.
- At most `max_applicants_per_request` `APPLIED` rows per request, held by the row lock in `apply_to_request`.
- A `CANCELLED` request holds no `APPLIED` application.
- No application message that `has_contact_info` flags is ever stored.
- No money figure is computed outside the database; 05 moves no money.

**Security model**: the threat is a provider calling `/rest/v1` directly with a real token, and a provider fishing for a
customer's identity or a rival's offer. Writes happen only inside definer functions that take identity from `auth.uid()`,
never from an input. Reads of requests happen only through two definer functions with a fixed column list, so a later
column added to `requests` stays hidden until someone adds it on purpose. The exact address, notes and typed answers are
personal data under KVKK (Turkey's data protection law) and stay inside 04's tables. The apply message is free text and
may hold personal data despite the scanner, so it is scrubbed everywhere and read only by its author, admin and (from 06)
the customer of that request. **High risk paths touched**: `supabase/migrations/**`, RLS, and personal data. The
`security-reviewer` agent runs before merge.

**Failure handling**:
- Two applies at the last slot: the row lock serialises them; the second refuses `request_full`.
- Apply while the customer cancels: whoever locks first wins (AC-16).
- Apply while 06 chooses: 06 locks the same row; an apply after the choose refuses `request_closed`.
- Admin turns off a service or zone: open requests for it stay visible to providers whose stored picks cover it (the
  request was valid when posted); new requests for it cannot be posted (04); a provider whose only picks are inactive has
  an incomplete setup (AC-4) until they pick again.
- A provider is suspended after applying: their `APPLIED` rows stay; 06 decides whether the customer may still choose them.
- Settings missing or malformed: `apply_settings_invalid` and an alert. The apply form shows a generic error line and keeps
  the message; the feed and detail pages, which need the cap, show `ErrorState`.
- Network loss on apply: a retry hits the replay at step 5 and returns the stored row.

**Configuration required**: none. No new environment variable, secret or service.

**Critical test scenarios**:
- Happy path: approved provider saves setup, sees the request, applies, sees it in My applications, verifies **AC-3**,
  **AC-5**, **AC-10**, **AC-13**, **AC-24**.
- Failure case: two parallel applies at cap minus one leave cap rows; cancel and apply race, verifies **AC-16**, **AC-23**.
- Privacy: the jsonb of `provider_feed` and `provider_request` has exactly the allowed keys, with a fixture text answer and
  notes absent, verifies **AC-7**, **AC-23**.
- Auth and permission: a rival provider, a customer, admin and anon each get their refusal or zero rows, verifies
  **AC-10**, **AC-18**, **AC-25**.
- Scanner: the verify corpus through `apply_to_request`, verifies **AC-10**, **AC-23**.

## Build plan

Tracer Bullet: one thin thread from the migration to an applied offer first, then thicken.

1. Migration `provider_feed_apply`: the five tables, unique `(id, region)` on `providers`, settings and checks, RLS, grants,
   `applications_guard`, `apply_settings`, `count_application`. pgTAP file 14 first (tests first, code standards §10):
   RLS negatives, grants, guard, settings shape; satisfies **AC-1**, **AC-17**, **AC-18**, **AC-19**.
2. `save_provider_setup` and `provider_setup` with pgTAP for every `setup_invalid` branch and the suspended refusal;
   satisfies **AC-3**, **AC-4**.
3. `provider_feed` and `provider_request` with the exact key set tests and the visibility rules; satisfies **AC-5**,
   **AC-7**, **AC-8**.
4. `apply_to_request` with every refusal, the replay, the corpus and the races (dblink); then `cancel_request` replaced
   with its race test; satisfies **AC-10**, **AC-16**, **AC-23**.
5. `provider_applications`, `provider_home_counts`; `npm run db:types`; satisfies **AC-13**, **AC-14**.
6. `lib/provider-feed/` (server only reads through `lib/db`), `actions/provider-feed.ts` (Zod, `guardedAction`, error
   mapping, alert), scrubber key and events; satisfies **AC-1**, **AC-11**, **AC-19**, **AC-20**, **AC-21**.
7. Thin UI thread: `/provider/setup`, `/provider/feed`, `/provider/feed/[id]` with the apply form, in `ar` first then `tr`
   and `en`, at 390 px; satisfies **AC-2**, **AC-6**, **AC-8**, **AC-9**, **AC-11**, **AC-12**, **AC-22**.
8. `/provider/applications`, the `/provider` counts, the navigation and guards; satisfies **AC-13**, **AC-14**, **AC-15**.
9. Filters, date chips, the outside hours divider, pagination, full and closed states; satisfies **AC-5**, **AC-6**.
10. e2e journey and axe; satisfies **AC-24**.
11. After the owner pushes the migration: the real calls in `verify.md`; satisfies **AC-25**.

## Consequences

**Positive**:
- Providers get a working feed and a free apply, the second half of the marketplace's core loop.
- Customer privacy holds by construction: a new column on `requests` stays invisible to providers until a function
  selects it.
- The row lock gives 06 a clear rule for choose: lock the request first.

**Negative / tradeoffs**:
- Typed answers and notes are hidden until the reveal, so a provider may apply to a job they would have skipped, and the
  customer may get offers that miss a detail they wrote in notes.
- Two definer read functions duplicate some of 04's reading logic; a change to the snapshot shape needs both updated.
- 05 depends on 04 merging first and replaces 04's `cancel_request`, so the two must merge in order.
- The rate limit adds a second counter table beside `quote_counters` rather than one shared table.
- Design extras on `p8` and `p4` (application questions, proposed start, the offer preview, the tools tick, "from"
  prices) are not built; the design and the build diverge until 19 or a later scope call.

**Neutral**:
- `/provider/setup` is a new page; `p4` in the design sat at `/provider/profile`. The setup lives apart because it changes
  without review, while the profile sends the file back.
- The provider fee figure joins `p8` in 07 or 10.

## Follow-up

- [ ] Position 06: the customer's read of applications on their own request (a policy or a definer function), `SELECTED`
      and `NOT_SELECTED`, and choose locks the request row first (AC-16). Decide whether a suspended provider's `APPLIED`
      row can be chosen.
- [ ] Position 07 or 10: the provider fee figure on `p8` and `p10` (AC-12).
- [ ] Position 10: the customer's notes and typed answers for the chosen provider after both have paid.
- [ ] Position 12: withdraw (`p13`), `EXPIRED`, and what happens to `APPLIED` rows when a request's start passes.
- [ ] Positions 06 and 12: a request back to `OPEN` after a missed pay window keeps `NOT_SELECTED` and `EXPIRED` rows, which
      block those providers from applying again through the unique key; decide the re-pick rule there. Both follow the
      lock order of AC-10.
- [ ] 05 replaces `cancel_request`; 04's pgTAP cases for it keep running unchanged, so a drift from 04's behaviour fails CI.
- [ ] Position 13 or 18: notification 2 ("a provider applied") from `applications` rows; 05 writes no event (D155).
- [ ] Position 16: the two new settings on the settings page; admin view of a provider's services and districts.
- [ ] Position 19: structured application questions and a proposed start, if the owner wants them (D152).
- [ ] Jobs position: notification 1 ("new request matches your zones") reads `provider_services` and `provider_zones`.
- [ ] KVKK: retention and erasure of `applications.message` (architecture §39), before G3.
- [ ] Leakage monitoring (old feature 24): the scanner is defence in depth, not a guarantee.
