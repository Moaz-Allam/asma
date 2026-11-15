# 0008. Post a request (position 04)

**Date**: 2026-11-14
**Status**: Accepted (confirmed by the owner 2026-11-14, after a cross check on a second model). Amended 2026-11-15: AC-28,
a per user quote rate limit, from the owner's answer to a security review finding on position 03 (D142)

## Summary

A customer picks a service, answers its questions, chooses a district, a day and an hour, types the street line, and sees a
fixed price that the server computes live. A review step then publishes the request as `OPEN`. The database computes and
stores the price, the platform's commission and the cash due in the same transaction that creates the request, so nothing a
browser sends can change them. The exact address lives in its own table that only its customer can read, until position 10
opens it to a provider who has paid. The customer also gets a list of their requests, a detail page, cancel while `OPEN`, and
repeat a past request with the same answers (D56).

## Requirements

**User stories**:
- As a customer, I want a form built from the service's questions with the price shown before I publish, so that I know what
  I will pay and nothing changes after.
- As a customer, I want to see how much I pay online after choosing a provider and how much I hand over in cash, so that the
  cash model is clear before I commit.
- As a customer, I want my exact address hidden from every provider until we have both paid, so that I am not exposed to
  people I did not choose.
- As a customer, I want to see, cancel and repeat my requests, so that a regular job takes one minute the second time.
- As the owner, I want the price, commission and cash due fixed by the server at posting, so that a tampered browser never
  costs money (rule 1).

**Prerequisites** (not acceptance criteria):
- **02 and 03 merged.** This position calls `quote_price` (spec 0007), reads the catalog tables, and reuses `is_admin()`,
  `has_contact_info()`, `localized()`, `MoneyDisplay`, `StatusChip`, `ChoiceChips`, `ToggleChips`, `Stepper`, `FormField`,
  `ConfirmDialog`, `ErrorState` and `EmptyState`. Branch `feat/04-post-request` starts from that `master`.
- **Design source.** `s4`, `s5`, `s10`, `s14` (row 1 only) and the repeat action of `s9` in `Nazzafly Web Mockups.dc.html`.
  This spec was written from `docs/design/source/`, after checking the live project's etag (`1792782744390011`, unchanged
  since 2026-11-02; the export equals it once CRLF is removed). `/develop` reads the live project through `claude_design`
  from the main folder. The money copy of `s4`, `s5` is the old escrow model (S24 not done); this spec's copy wins. Figures
  in the design are illustration only.
- **S17 blocks real prices, not the build.** Tests use fixture catalog rows. `commission_percent` is seeded at 10, unconfirmed.
- **S21.** New strings go to the translator as `[tr]` keys.

**Acceptance criteria** (the contract):

*Data.*

- **AC-1**: The migration `post_request` adds `requests` and `request_addresses` as Feature design draws them, `regions.timezone`
  (`Europe/Istanbul`, `Asia/Riyadh`, not null, a valid IANA name checked against `pg_timezone_names`), and six settings per
  region: `commission_percent` 10, `request_lead_days` 1, `request_horizon_days` 14, `request_first_hour` 8,
  `request_last_hour` 18, `max_open_requests` 5, and `quotes_per_hour` 60 (AC-28, an integer from 1 to 10000). Row checks on `platform_settings` hold each key's own shape: the percent a
  JSON number above 0 and below 100 with at most 2 decimals; lead an integer from 0 to 30; horizon an integer from 1 to 90;
  hours integers from 0 to 23; the cap an integer from 1 to 100. A deferred constraint trigger, `request_settings_guard`,
  holds the rules across two rows at commit: horizon at least lead, first hour at most last hour, so a pair is changed in one
  transaction. A trigger on `regions` refuses a `timezone` that `now() at time zone` rejects (a check cannot read
  `pg_timezone_names`). Order in the migration: add the column nullable, set both rows, then `not null`.
- **AC-1b**: A missing or malformed lead, horizon, hour or cap setting refuses `request_settings_invalid` from
  `request_catalog` and `create_request`, never a default, and the action raises an alert with the region.
- **AC-2**: A child row cannot name a parent of another region: `requests (service_id, region)`, `(zone_id, region)` and
  `request_addresses (request_id, region, customer_id)` are composite foreign keys, so an address row always has its
  request's region and customer. Every reference is on delete restrict. No API role inserts, updates or deletes either
  table; only the definer functions below write them. Nothing is ever deleted.
- **AC-3**: Money on a request is integer minor units (rule 4): `fixed_price` at least 1, `commission_amount` from 0 to
  `fixed_price`, and a check that `cash_due = fixed_price - commission_amount`. A before update trigger, `requests_guard`,
  refuses any change to `id`, `region`, `customer_id`, `client_key`, `service_id`, `zone_id`, `addon_ids`, the three money
  columns, `currency`, `answers`, both snapshots, `notes`, both schedule columns and `created_at`, even from `postgres`, and
  a trigger on `request_addresses` refuses every update and delete. Only `status` and the three cancel columns move here;
  later positions add their own columns to the allowed list in their own migration.

*Reading the catalog and quoting.*

- **AC-4**: `request_catalog()` is the customer's only read of the catalog. It returns, for the caller's region, every
  active category with at least one bookable service (active, in an active category, with an active formula), each service's
  name, note, `hours_min`, `hours_max`, the questions asked for it (key, type, label, help text, required, options,
  validation) in `display_order`, its active addons (id, name, price), every active zone (id, name), the currency, the
  timezone, the local date today, and the four schedule settings, in the shape under Feature design. The function never
  returns a formula, a modifier, `affects_pricing` or a zone multiplier (a quote's own fired lines, the zone multiplier
  among them, are the customer's to see, as 0007 decided). A caller with no profile gets `forbidden`; an empty region
  returns empty lists, and the page shows its empty state.
- **AC-5**: `quote_request` returns what `quote_price` returns, and on `ok` adds `commission_percent` (text,
  `trim_scale(percent)::text`, so 10 and 10.50 read `10` and `10.5`), `commission` and `cash_due`. The commission is
  `round(price × percent / 100 / unit) × unit`, half up, in exact `numeric`, where `unit` is `price_rounding_minor`, so both
  figures are whole lira (D122). A missing or malformed `commission_percent` or `price_rounding_minor` refuses with
  `pricing_settings_invalid` inside `pricing_split` itself, never a default. `pricing_split` is the one place the split is computed; no TypeScript computes
  a commission or a cash due.
- **AC-6**: The form asks for a quote after every change, 400 ms after the last one, and a late answer never replaces a
  newer one. No quote is asked until a service, every required question and a district are chosen; until then the price
  card says what is missing. Answer errors (`{ key, code }` from 0007 AC-7) show beside their question.
- **AC-28**: Quote rate limit (amended 2026-11-15, D142). Every quote a customer can cause counts against one per user
  fixed window of one hour, in `quote_counters`, and refuses `too_many_quotes` past `quotes_per_hour` (starting value 60).
  The check and the count happen inside the definer function, in the same transaction, so a direct `/rest/v1/rpc` call
  cannot skip them:
  - `quote_request` becomes `volatile` (it now writes) and counts before it quotes;
  - `create_request` counts at its step 7, so a replay (step 3) never counts;
  - `quote_price` loses its `authenticated` grant: only `quote_request` and `create_request` reach it, as their definer
    owner, which changes 0007 AC-9 ("the only way") and the 0007 AC-26 real call to go through `quote_request`.
  The count is one atomic `insert … on conflict (user_id) do update`, which resets the window when it is older than an hour,
  so two parallel quotes cannot both slip past the last slot. A refused call counts nothing more and writes nothing else.
  The price card shows "Too many price checks. Try again within the hour." and keeps the answers; a refused publish shows
  the same on the review step. pgTAP proves: the 61st `quote_request` in a window refuses and the first after the window
  works; `create_request` past the limit refuses and creates nothing; a customer token calling `quote_price` directly is
  refused; a customer reads and writes no `quote_counters` row.

*Publishing.*

- **AC-7**: `create_request` is the only way to create a request. In one transaction, in this order, it:
  1. refuses `forbidden` unless `profiles.role` of `auth.uid()` (never the token's claim) is `customer` or `admin`;
  2. locks that `profiles` row `for no key update`, which serialises the caller's publishes;
  3. returns `{ status: 'ok', id }` of the caller's row with this `client_key` if one exists, whatever its status now,
     and skips every check below (AC-12);
  4. refuses `request_settings_invalid` (AC-1b), then `schedule_invalid` unless `p_start_date` and `p_start_hour` are
     not null, the hour is from `request_first_hour` to `request_last_hour`, and the date is from today plus
     `request_lead_days` to today plus `request_horizon_days`, today being the local date in `regions.timezone`;
  5. normalises the line and the notes with 03's `catalog_trim` (whitespace, NBSP and zero width characters), counts
     code points after it, and refuses `address_invalid` unless the line is 5 to 200; blank notes become null, over 500
     refuse `notes_invalid`, and `contact_info_in_notes` when `has_contact_info` flags them;
  6. refuses `too_many_open_requests` when the caller already has at least `max_open_requests` live requests (`OPEN`
     with a start after `now()`), admins included;
  7. counts one quote and refuses `too_many_quotes` past the limit (AC-28), then calls `quote_price`, letting its refusals through and returning `{ status: 'invalid', errors }` on answer errors,
     then `pricing_split`;
  8. refuses with `{ status: 'price_changed', quote }`, where `quote` has the `quote_request` shape, when
     `p_expected_price` or `p_expected_commission` is null or `is distinct from` the new figure;
  9. inserts the request as `OPEN` with the normalised values, its address row and a `request.created` audit row, and
     returns `{ status: 'ok', id }`.
  A null `p_addon_ids` means none. An admin switching a service, zone or addon off in the milliseconds between step 7 and
  step 9 still lets this request through, valid as quoted; accepted, because the quote and its figures agree.
- **AC-8**: `scheduled_end_at` is `scheduled_start_at` plus the service's `hours_max` hours. The review step shows the start,
  the expected end, and the estimate `hours_min` to `hours_max`.
- **AC-9**: Snapshots. `answers` holds only keys of the questions asked, with blank answers removed by 03's
  `pricing_answer_blank`. `questions_snapshot` holds those questions as asked (key, type, label, options, required) in
  every locale admin wrote. `pricing_snapshot` holds the quote output (formula id, version, fired breakdown with the zone's
  name and multiplier, price, currency, rounding unit), `commission_percent`, and `service: { id, name, category_name }` in
  every locale. List and detail read names only from the snapshots, because customers read no catalog table (0007 AC-14)
  and a retired row must still show. A later formula, question, name or setting change never changes a stored request.
- **AC-10**: Rule 1, tamper proof. 0007's meta test gains exactly one exemption, keyed on the pair: `create_request` with
  `p_expected_price` and `p_expected_commission`, and no other argument or function. A pgTAP test reads the function source
  and fails if either name appears outside the comparison of step 8, so the figures are compared and never stored. Tests
  prove a lower or null expected figure refuses `price_changed`, an equal one stores the server's own number, and a direct
  `insert` or `update` on `requests` with a real customer token is refused.
- **AC-11**: The action raises an alert on `pricing_settings_invalid` and `request_settings_invalid` and logs
  `price_out_of_range`, as `quotePrice` does,
  because the stored price never passes through that door. Either way the customer sees "this service cannot be priced
  right now".
- **AC-12**: A double tap, a retry or a back and publish again with the same `client_key` creates one request and returns
  its id, even if the replay's inputs differ or the request has since been cancelled. The key is a random uuid made when the
  form opens and kept across the two steps; it is unique per customer, so another customer's equal key is a new request.

*My requests, detail, cancel, repeat.*

- **AC-13**: `/{locale}/requests` (`s10`): the caller's requests, newest first, 20 a page with a "show more" link, tabs All,
  Active and Closed (`?tab=`, validated, falling back to All). The cursor `?after=` is opaque: `created_at::text` and the id,
  read back as `timestamptz`, so microseconds survive; a malformed cursor shows page 1. Tabs filter in the query against the
  server's `now()`: Active is `OPEN` with a future start plus `SELECTED` to `AWAITING_CONFIRMATION`; Closed is `CANCELLED`,
  `COMPLETED` and `OPEN` with a past start. A row shows the status chip, the service name and the district (from the
  snapshot), the start, the job price in `MoneyDisplay` and the posted date. A live `OPEN` request reads "Open, waiting for
  offers"; a past one reads "Expired". Each tab has an empty state with a link to `/requests/new`.
- **AC-14**: `/{locale}/requests/[id]`: the status, the review rows from the stored snapshots (never the live catalog), the
  price card with the stored figures, Cancel while `OPEN` (expired included), and Repeat unless the request is live `OPEN`.
  Another customer's id, an unknown id and a malformed id all show the 404 page. Position 06 adds the applicants here.
- **AC-15**: Cancel (`s14` row 1). A `ConfirmDialog` says nothing was paid and nothing comes back, with optional reason chips
  (`plans_changed`, `found_elsewhere`, `price`, `other`). `cancel_request` refuses `validation_failed` for any other non
  null reason, locks the row `for update`, refuses `not_found` unless the caller owns it (an admin cancels only their own
  requests here; cancelling others is 16's), returns `ok` if it is already `CANCELLED`, refuses `not_cancellable` unless it
  is `OPEN`, sets `CANCELLED`, `cancelled_at`, `cancelled_by` `customer` and the reason, and writes `request.cancelled`.
- **AC-16**: Repeat (D56). `/requests/new?from=<id>` opens the form prefilled from the caller's own request: service,
  answers to questions still asked (an answer no longer valid is dropped), addons still active on that service, the district
  if still active, the address line and the notes. The date and hour are never copied. The price is a fresh quote. If the
  service is no longer bookable (by the catalog's rule), the form opens at the category chips with a message. Another
  customer's id, an unknown or a malformed one prefills nothing, silently; so does a `?service=` that is not bookable.

*Access and personal data.*

- **AC-17**: RLS (rule 7), each with a negative pgTAP test. `requests`: the customer reads their own rows, an admin reads
  every row through `is_admin()`, a provider and anon read none. `request_addresses`: only its customer reads it; admin,
  provider and anon read none (position 10 adds the both paid rule, 16 an audited admin read). No API role writes either
  table. `service_role` reads `requests` only. 05 must open a column limited path for providers (never `answers` text,
  never `request_addresses`), not a row policy on the whole table.
- **AC-18**: The exact address, the notes and the answers never reach logs, Sentry, PostHog or `audit_log`. The scrubber's
  key list gains `line`, `address_line`, `notes` and `answers`. Audit rows hold ids, status, `fixed_price` and the region
  only.

*Pages and UI.*

- **AC-19**: `/{locale}/requests/new` (`s4`, `s5`, one page, two steps): `FlowHeader` with the three step `Stepper` and
  Cancel; category chips (only categories with a bookable service), then the service cards; general questions, then the
  service's own; addons as `ToggleRow`s with their price; the address block (district chips or a select when more than 8,
  then the line); day chips for the allowed dates and hour chips; notes, marked as never changing the price; and the sticky
  `PriceCard`. `?service=` preselects both chips and is validated, falling back silently. The review step (`s5`) shows every
  answer, the addons, start, expected end, district, address line and notes, a "before you publish" panel, Publish and Back
  to edit, which keeps every answer.
- **AC-20**: `PriceCard` shows the job price large, the fired breakdown lines by name, then the split: "online after you
  choose a provider" with the commission, and "in cash to the provider after the service" with the cash due, all in
  `MoneyDisplay` from server figures. Copy follows the cash model (D87): no "held", no "released", no "deducted from the
  provider's share".
- **AC-21**: `DynamicQuestionForm` renders each 0007 type: `number` as chips when it has at most 8 values, else a number
  field with min, max and step; `single_select` and `boolean` as `ChoiceChips`; `multi_select` as `ToggleChips`; `text` and
  `textarea` with their length counter; `date` and `time` as native inputs. Labels come from the server in the page's
  locale. Required and range hints are plain TypeScript in the browser (no Zod, D106); the server is the check.
- **AC-22**: On publish the customer lands on `/requests/[id]` with the success line ("Your request is posted. Offers from
  providers will come soon."). On `price_changed` the review step shows the new figures and asks again. Every refusal code
  maps to a catalogue string, and a mapped code reaches no Sentry report.
- **AC-23**: `/requests`, `/requests/new` and `/requests/[id]` use `guardPage(['customer', 'admin'])`, every action uses
  `guardedAction` with the same roles, and the customer menu keeps its two existing rows. Admins reach the pages by URL only.
- **AC-24**: UI: every value comes from the design source and `ui-tokens.md`. Every new string is in all three catalogues,
  Turkish as `[tr] `, and stored codes map to catalogue keys. Loading, empty and error states exist for each page; controls
  work by keyboard and have labels; targets are at least 44 px; state is never colour alone. Screens pass at 360, 390, 430
  and 1280 px, `tr` first. New components get `ui-registry.md` rows.

*Signals and proof.*

- **AC-25**: `AnalyticsEvents` gains `request_posted: { repeated: boolean }`, sent from the browser after a successful
  publish. No other event. No id, price or text in it.
- **AC-26**: e2e at 390 px with axe in `ar`, `tr`, `en`, on the real local database with a fixture catalog: a customer opens
  `/requests/new`, answers, sees the fixture price and split, picks a district, a day and an hour, reviews, publishes, sees the
  request in the list and on its page, repeats it and sees the answers prefilled, then cancels the first one. A second
  journey: a provider is sent away from all three pages, and another customer's request id shows 404.
- **AC-27**: Real calls, recorded in `verify.md`, on a preview against the cloud project: a real customer token cannot read
  another customer's request or address, cannot insert or update `requests`, gets `price_changed` with a lower expected
  price, and creates a request whose stored figures equal the worked figures.

## Decision

**Chosen option**: one definer function, `create_request`, prices, splits and inserts the request and its address in one
transaction, and the customer reads the catalog through one definer function that returns no formula.

The browser sends answers, a district, a date and an hour, the street line, the notes and the figures it saw; the database
recomputes everything and refuses when the figures differ. Reasoning and options: see [rationale.md](rationale.md).

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.agents/skills/supabase/`) ·
`supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) ·
`shadcn` (`shadcn-ui/ui`, `.claude/skills/shadcn/`) · `tailwind-design-system` (`.claude/skills/tailwind-design-system/`).

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model** (owner confirmed 2026-11-14). One migration, `post_request`. `lib/db/database.types.ts` follows through
`npm run db:types`. CI greps migrations, so the phrase `create table` stays out of comments, and `region` starts its own line
in each table. Later positions add their own columns (chosen provider, deadlines, actual times).

`requests`:

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid PK | default `gen_random_uuid()` |
| `region` | text not null | FK `regions(code)`; the caller's `profiles.region` |
| `customer_id` | uuid not null | FK `profiles(id)` |
| `client_key` | uuid not null | Unique with `customer_id` |
| `service_id` | uuid not null | FK `(service_id, region)` to `services(id, region)` |
| `zone_id` | uuid not null | FK `(zone_id, region)` to `zones(id, region)`. Needs unique `(id, region)` on `zones`, added here |
| `addon_ids` | uuid[] not null | default `'{}'`; for repeat |
| `status` | text not null | default `OPEN`; check in `OPEN`, `SELECTED`, `COMMISSION_PAID`, `UNLOCKED`, `IN_PROGRESS`, `AWAITING_CONFIRMATION`, `COMPLETED`, `CANCELLED` |
| `answers` | jsonb not null | an object |
| `questions_snapshot` | jsonb not null | an array |
| `pricing_snapshot` | jsonb not null | an object |
| `fixed_price` | bigint not null | `>= 1` |
| `commission_amount` | bigint not null | `0 <= commission_amount <= fixed_price` |
| `cash_due` | bigint not null | `= fixed_price - commission_amount` |
| `currency` | text not null | `regions.currency` |
| `scheduled_start_at` | timestamptz not null | |
| `scheduled_end_at` | timestamptz not null | `> scheduled_start_at` |
| `notes` | text null | `char_length <= 500` |
| `cancelled_at` | timestamptz null | check: not null exactly when `status = 'CANCELLED'` |
| `cancelled_by` | text null | `customer`, `provider`, `platform`, `admin`; check: not null exactly when `cancelled_at` is |
| `cancel_reason` | text null | `plans_changed`, `found_elsewhere`, `price`, `other`; check: null unless `cancelled_at` is set |
| `created_at` | timestamptz not null | default `now()` |

`request_addresses`:

| Column | Type | Rules |
| --- | --- | --- |
| `request_id` | uuid PK | FK `(request_id, region, customer_id)` to `requests(id, region, customer_id)`. Needs that unique on `requests` |
| `region` | text not null | FK `regions(code)` |
| `customer_id` | uuid not null | FK `profiles(id)`; held equal to the request's by the composite key, so RLS needs no join |
| `line` | text not null | 5 to 200 code points after trim |
| `created_at` | timestamptz not null | default `now()` |

`quote_counters` (AC-28): `user_id` uuid PK FK `profiles(id)`, `region` text not null FK `regions(code)`, `window_start`
timestamptz not null, `count` integer not null (`>= 1`). One row per user, overwritten, no personal data. RLS on; admin reads
through `is_admin()`; no API role writes; no grant but `select` to `authenticated` (filtered by RLS).

Indexes: `requests (customer_id, created_at desc, id)`, `(region)`, `(service_id)`, `(zone_id)`, unique
`(customer_id, client_key)`, unique `(id, region)`, unique `(id, region, customer_id)`; `request_addresses (customer_id)`,
`(region)`. Relations: a profile has
many requests, a request has exactly one address, a service and a zone have many requests.

**State transitions** (this position): `OPEN → CANCELLED` by the customer through `cancel_request`. "Expired" is a reading,
not a state: `OPEN` with `scheduled_start_at <= now()`. Every other transition belongs to a later position.

**Database functions** (each revokes `PUBLIC`, pins `search_path = ''`, passes `supabase/tests/02`):

| Function | Kind | Executable by | Job |
| --- | --- | --- | --- |
| `request_catalog()` | definer, stable | `authenticated` | AC-4. Returns jsonb; text stays localised jsonb, `localized()` picks it in TypeScript |
| `request_settings(p_region)` | invoker, stable | none | AC-1b. Reads and checks the five schedule and cap settings, or raises `request_settings_invalid` |
| `pricing_split(p_region text, p_price bigint)` | invoker, stable | none | AC-5. Returns `{ commission_percent, commission, cash_due }` or raises `pricing_settings_invalid` |
| `quote_request(p_service_id uuid, p_zone_id uuid, p_addon_ids uuid[], p_answers jsonb)` | definer, volatile | `authenticated` | AC-5, AC-28. `count_quote`, `quote_price`, then `pricing_split` |
| `count_quote(p_user_id uuid, p_region text)` | invoker, volatile | none | AC-28. The atomic window upsert; raises `too_many_quotes` |
| `create_request(p_client_key uuid, p_service_id uuid, p_zone_id uuid, p_addon_ids uuid[], p_answers jsonb, p_start_date date, p_start_hour integer, p_address_line text, p_notes text, p_expected_price bigint, p_expected_commission bigint)` | definer, volatile | `authenticated` | AC-7 to AC-12 |
| `cancel_request(p_request_id uuid, p_reason text)` | definer, volatile | `authenticated` | AC-15 |
| `requests_guard()`, `request_addresses_guard()` | invoker, trigger | none | AC-3. Before update (and delete on addresses) |
| `request_settings_guard()` | invoker, deferred constraint trigger | none | AC-1. On `platform_settings` insert or update of the six keys |
| `regions_timezone_guard()` | invoker, trigger | none | AC-1. Before insert or update of `regions.timezone` |

`quote_request` returns the 0007 output shape plus `commission_percent`, `commission`, `cash_due`. `create_request` returns
`{ status: 'ok', id }`, `{ status: 'invalid', errors }` or `{ status: 'price_changed', quote }` with `quote` in that same
shape, so the client has one parser, and raises every other code. The start is `make_timestamptz(y, m, d, p_start_hour, 0,
0, regions.timezone)`, so no time zone arithmetic happens in TypeScript.

**`request_catalog()` shape**. Every list is ordered by `display_order`, then `id`. `today` is `YYYY-MM-DD`:

```json
{ "region": "TR", "currency": "TRY", "timezone": "Europe/Istanbul", "today": "2026-11-14",
  "schedule": { "lead_days": 1, "horizon_days": 14, "first_hour": 8, "last_hour": 18 },
  "zones": [{ "id": "…", "name": { "tr": "…" } }],
  "categories": [{ "id": "…", "name": { "tr": "…" },
    "services": [{ "id": "…", "name": { "tr": "…" }, "note": null, "hours_min": 3, "hours_max": 5,
      "questions": [{ "key": "rooms", "type": "number", "label": { "tr": "…" }, "help_text": null, "required": true,
                     "service_id": null, "options": null, "validation": { "min": 1, "max": 8, "step": 1 } }],
      "addons": [{ "id": "…", "name": { "tr": "…" }, "price": 40000 }] }] }] }
```

Grants (D77): `select` on `requests` to `authenticated`, `service_role`; `select` on `request_addresses` to `authenticated`.
Nothing else. Policies wrap `auth.uid()` and `is_admin()` in a subselect (architecture §32).

**Routes**:

| Path | Group | Who | Notes |
| --- | --- | --- | --- |
| `/{locale}/requests/new` | `(customer)` | customer, admin | `?service=`, `?from=`, each validated |
| `/{locale}/requests` | `(customer)` | customer, admin | `?tab=`, `?after=` (keyset cursor), each validated |
| `/{locale}/requests/[id]` | `(customer)` | customer, admin | 404 unless RLS returns the row; `?posted=1` shows the success line |

**API surface**. `lib/requests/` is the new server only module (`import 'server-only'`): `loadRequestCatalog`,
`quoteRequest`, `createRequest`, `cancelRequest`, `listMyRequests`, `getMyRequest`, `prefillFrom`. Each parses the result
with Zod and maps codes as `lib/pricing/` does. Actions in `actions/requests.ts`.

| Name | Kind | Key inputs | Key outputs | Auth | Key errors |
| --- | --- | --- | --- | --- | --- |
| `quoteRequestAction` | Server Action | `serviceId`, `zoneId`, `addonIds`, `answers` | price, commission, cash due, breakdown, or `errors` | `['customer', 'admin']` | `service_unavailable`, `zone_unavailable`, `addon_unavailable`, `price_out_of_range`, `pricing_settings_invalid` |
| `createRequestAction` | Server Action | `clientKey`, `serviceId`, `zoneId`, `addonIds`, `answers`, `startDate`, `startHour`, `addressLine`, `notes`, `expectedPrice`, `expectedCommission` | `id`, or `errors`, or new figures | `['customer', 'admin']` | AC-7 codes, `price_changed` |
| `cancelRequestAction` | Server Action | `requestId`, `reason?` | ok | `['customer', 'admin']` | `not_found`, `not_cancellable` |
| `request_catalog` | RPC through `loadRequestCatalog` | none | catalog tree | signed in, with a profile | `forbidden` |
| `requests` select | PostgREST through `listMyRequests`, `getMyRequest` | `tab`, cursor, or `id` | rows | RLS | none (empty) |

**Value sourcing**:

| Action | Value | Source |
| --- | --- | --- |
| Catalog, quote, create | Region | `profiles.region` of `auth.uid()`, inside the function |
| Catalog | Bookable services | Active service, active category, an active formula row |
| Catalog | Questions per service | Active questions of the category with `service_id` null or this service, `display_order` then `id` |
| Catalog, pages | Text in one locale | `localized(value, getLocale(), regions.default_locale)` |
| Form | Allowed dates | Catalog `today` (`(now() at time zone regions.timezone)::date`) plus `request_lead_days` to plus `request_horizon_days` |
| Form | Allowed hours | `request_first_hour` to `request_last_hour` |
| Form | `client_key` | `crypto.randomUUID()` when the form mounts, kept in component state across both steps |
| Quote | Price, breakdown | `quote_price` (spec 0007) |
| Quote, create | Commission percent, unit | `platform_settings (region, 'commission_percent')`, `(region, 'price_rounding_minor')` |
| Quote, create | Commission, cash due | `pricing_split` |
| Create | Expected figures | The last `ok` quote the form showed |
| Create | `scheduled_start_at` | `p_start_date`, `p_start_hour`, `regions.timezone` |
| Create | `scheduled_end_at` | Start plus `services.hours_max` hours |
| Create | Role | `profiles.role` of `auth.uid()`, never the token claim |
| Create | Live open count, cap | `requests` `OPEN` with a start after `now()` for the caller, `>= max_open_requests` refuses |
| Create | Stored line, notes | `catalog_trim` of the inputs; blank notes null |
| Create | `pricing_snapshot.service` | `services.name`, `service_categories.name`, read in the function |
| Create | `currency` | `regions.currency` |
| Create | `questions_snapshot` | The same question query as the catalog, all locales |
| Create | `status`, `created_at` | `OPEN`, `now()` |
| Review step | Expected end, estimate | Start plus `hours_max`; `hours_min`, `hours_max` from the catalog |
| Review step | Answer labels | Option labels from the catalog in the page's locale |
| List, detail | Service and category name | `pricing_snapshot.service` |
| List, detail | District | `pricing_snapshot.breakdown.zone.name` |
| List | Cursor | `created_at::text` and `id` of the last row, opaque |
| List | Tab filter, Expired | `status` and `scheduled_start_at` against `now()` in the query |
| Detail | Answers, labels, figures | `answers`, `questions_snapshot`, `pricing_snapshot`, the three money columns |
| Detail | Address line | `request_addresses` through RLS |
| Repeat | Prefill | The caller's own request row and address, filtered against the current catalog |
| Cancel | `cancelled_by` | `customer`, inside the function |
| Alert | `recordId`, region | The service id, the caller's region |
| Analytics | `repeated` | Whether the form opened with a valid `?from=` |

**Key invariants**:
- The client sends answers and choices, never a figure that is stored (rule 1). The expected figures are only compared.
- Price, commission and cash due are computed once, in the database, and never updated (rule 4, rule 6), held by
  `requests_guard` even against `postgres`.
- An address row's region and customer are its request's, by the composite key.
- `cash_due = fixed_price - commission_amount`, both whole multiples of `price_rounding_minor`.
- A request and its address commit together, or neither does.
- A request's region is its customer's, its service's and its zone's.
- No provider reads a request or an address in this position.
- Text answers and notes never change a price.

**Security model**: the threat is a signed in user calling `/rest/v1` directly with a real token. Writes happen only inside
definer functions that take no stored figure. The exact address and notes are personal data under KVKK (Turkey's data
protection law): the address table is readable by its customer only, and no log, event or audit row carries the address,
notes or answers. Admins are global (D15) and read requests, never addresses, in this position. Providers read nothing here;
05 opens PII free short details, 10 the both paid reveal.

**Failure handling**:
- The price moves between the quote and publish (formula, zone, addon or setting): `price_changed`, new figures, ask again.
- A service, zone or addon goes off while the form is open: its code, the form says so and keeps the answers.
- A double tap or a network retry: the lock comes before the replay lookup, so the second call waits and gets the first id.
- Two tabs publish at once near the cap: the `profiles` row lock serialises them, so the cap holds.
- A schedule or cap setting row deleted or malformed: `request_settings_invalid`, an alert, no form; no default.
- An admin changes lead and horizon in two transactions: the deferred trigger refuses the one that breaks the pair.
- The start hour passes while the customer reviews: `schedule_invalid`, the day and hour chips reload.
- `commission_percent` or `price_rounding_minor` missing: every quote refuses and alerts; no default.
- Cancel races a later position's select: both lock the row; the loser gets `not_cancellable` and the page reloads.
- The catalog read fails: `ErrorState` and no form.

**Configuration required**: no new variable, secret or dependency. Six new `platform_settings` keys and `regions.timezone`,
edited by SQL until the settings page (16). The migration push is an owner step.

**Critical test scenarios**:
- Happy path: the AC-26 journey in three locales, verifies **AC-13**, **AC-14**, **AC-16**, **AC-19** to **AC-22**.
- Worked figures: each row of `verify.md` through `pricing_split` and `create_request`, verifies **AC-3**, **AC-5**, **AC-7**.
- Tamper: a lower expected price and a lower expected commission each refuse; a direct insert and update are refused; the
  meta test still passes with only the named exemption, verifies **AC-2**, **AC-10**.
- Idempotency: the same `client_key` twice, in two `dblink` sessions at once, returns one id and one row; after a cancel the
  replay still returns that id, verifies **AC-7**, **AC-12**.
- Immutability: as `postgres`, an update of `fixed_price`, `answers` or `scheduled_start_at`, and an update or delete of an
  address row, are each refused; a status change to `CANCELLED` with its columns works, verifies **AC-3**.
- Settings: each of the five request settings deleted in turn refuses `request_settings_invalid`; horizon below lead and
  first above last hour are refused at commit; `Mars/Olympus` as a time zone is refused, verifies **AC-1**, **AC-1b**.
- Race: two sessions through `dblink` publish the cap's last slot, one wins, verifies **AC-7**.
- Schedule: today, past the horizon, minute 30, hour 19, a DST free zone check, verifies **AC-7**, **AC-8**.
- Permission: another customer, a provider and anon read no request and no address; admin reads a request and no address,
  verifies **AC-17**.
- Snapshot: publish, then change the formula, rename a label and retire a question; the stored request is unchanged,
  verifies **AC-9**.
- Privacy: a unit test feeds the scrubber an action payload with `line`, `notes` and `answers` and gets them redacted,
  verifies **AC-18**.

## Build plan

Tracer bullet, tests first on every access rule and every computed amount. One pull request, `feat/04-post-request`. The thin
thread is tasks 1 to 3: a fixture request created by `create_request` and listed. **High risk paths, said out loud:**
`supabase/migrations/`, `lib/requests/`, the 0007 meta test exemption, `lib/observability/scrub.ts`.

1. Tests first, then the migration: both tables, the two guard triggers, `regions.timezone` and its trigger, `zones (id,
   region)` unique, the six settings, their row checks and `request_settings_guard`, `request_settings`, RLS, grants,
   `request_catalog`, `pricing_split`, `quote_counters`, `count_quote`, `quote_request`, the revoke on `quote_price`; pgTAP
   `12_requests` (shape, guards, settings, RLS, split figures, the rate limit); `npm run db:types`; satisfies **AC-1**,
   **AC-1b**, **AC-2** to **AC-5**, **AC-17**, **AC-28**.
2. Tests first, then `create_request` and `cancel_request` with the meta test exemption, the race and the idempotency test;
   satisfies **AC-7** to **AC-10**, **AC-12**, **AC-15**.
3. `lib/requests/`, `actions/requests.ts`, the alert and the log, the scrubber keys, `request_posted`, with unit tests;
   satisfies **AC-6**, **AC-11**, **AC-18**, **AC-25**.
4. Read `s4`, `s5`, `s10`, `s14` through `claude_design`. `FlowHeader`, `PriceCard`, `ToggleRow`, `DynamicQuestionForm`;
   satisfies **AC-20**, **AC-21**, **AC-24**.
5. `/requests/new`: both steps, the address block, schedule chips, quote loop, publish, repeat prefill; satisfies **AC-6**,
   **AC-16**, **AC-19**, **AC-22**, **AC-23**.
6. `/requests` and `/requests/[id]` with `RequestRow`, cancel and repeat; satisfies **AC-13** to **AC-15**, **AC-23**.
7. Catalogues, `[tr]` count, the screen pass; satisfies **AC-24**.
8. e2e journeys with a fixture catalog seeded as `postgres` in the e2e setup, and axe; satisfies **AC-26**.
9. Owner: dry run, then push the migration. Then the real calls of `verify.md`, `/check verify`, `slice-reviewer`,
   `security-reviewer`, `/check review` on another model, merge; satisfies **AC-27**.

Docs in the same change: `project-overview.md` §5 rule 1 (the split is in the database too) and §13 (the post flow as built);
`architecture.md` §4, §20 (the `requests` columns as built, the address table) with a position section on what this spec
overrides (`addresses` becomes `request_addresses`; §19.6 runtime Zod stays overridden by D125); `ui-registry.md`;
`build-plan.md` row 04; the tracker's decision log, the D13 defaults table and owner steps.

## Consequences

**Positive**:
- Price, commission and cash due are fixed at posting by the database, so 06 and 07 read stored numbers.
- The address has its own table, so 10's reveal rule is one policy on one table.
- Repeat makes a second booking about a minute.
- No new dependency, secret, job or service role use.

**Negative / tradeoffs**:
- About a day and a half against the pace of one a day (R2), with 02 and 03 not yet merged.
- The customer picks the district and could pick a cheaper one; it shows only at the reveal, as a problem report.
- The price shows only after the district is chosen, at the bottom of the form.
- The commission rate is frozen at posting; a rate change reaches only new requests.
- The commission rounds to whole lira, so a small price can carry a commission of 0 (a 100 kuruş job at 10%).
- Expired requests stay `OPEN` in the database until a jobs position closes them; every reader must apply the start time.
- 0007's tamper meta test carries one named exemption.
- No address book: a customer types the street line again unless they repeat.
- No daily limit: post, cancel and repost has no ceiling beyond the open cap.

**Neutral**:
- `commission_percent` arrives before the rest of 07's fee settings, which join it in 07.
- `architecture.md`'s `addresses` table becomes `request_addresses`.

## Follow-up

- [ ] Position 05: the feed filters `OPEN` with a future start; short details read `zone_id`, the dates, the price, the
      service and the notes through a column limited path (a definer function or a view), never a row policy on all of
      `requests`, never free text answers, never `request_addresses`.
- [ ] Position 06: the applicants on `/requests/[id]`; cancel in `SELECTED` (§36 row 2).
- [ ] Position 07: provider fee settings join `commission_percent`; a commission of 0 (skip the payment, or a minimum).
- [ ] Position 10: the both paid policy on `request_addresses`.
- [ ] Position 16: an audited admin read of addresses; the six settings on the settings page.
- [ ] Jobs position: close expired `OPEN` requests as `CANCELLED` by `platform`.
- [ ] KVKK: retention and erasure of `request_addresses.line`, `requests.notes` and text in `requests.answers` (architecture
      §39), before G3. Erasure will need a narrow exception in `requests_guard` and `request_addresses_guard`.
- [ ] Owner: confirm the commission percent (S17), and the schedule window (D13 table).
- [ ] S24: when the cash model export lands, check `s4`, `s5` against AC-20's copy.
