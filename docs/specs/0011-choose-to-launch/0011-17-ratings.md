# 0011-17. Ratings (position 17, P2)

Child of [0011](index.md). Follows the cross child contract there. **Touches personal data (a rating is tied to the
customer who gave it) and 13's mail functions: a migration (two tables, settings, functions), three doors, four
surfaces.**

> **Accepted by the owner 2026-11-21 (D205)**, written against what 01 to 16 and 01b built (spec 0010, 0011-07 to 0011-16, 0012; D168 to
> D202). Built now, before 21, by the owner's override of the build order (D203); gated and merged by D204. Every choice
> below is the recommended one. What 17 reads as built: a job ends
> `COMPLETED` through `close_job(p_request_id, p_by, p_action)` (11, 12), which sets `closed_at` and `closed_by`
> (`customer`, `auto`, `admin`) and writes one `audit_log` row whose action is `job.confirmed`, `job.customer_closed`,
> `job.auto_closed` or `job.closed_by_admin` (14). The provider is the one of `requests.selected_application_id`, whose
> `unlocked_at` is set; it never changes after the reveal (D193). The customer reads offers only through
> `request_offers`, which draws each card with `offer_card(application, timezone)` (06); the card shows "New" in place
> of a rating (D159). Mail hangs on `audit_log` through `queue_audit_email` and the `audit_log_email` trigger, and the
> relay reads what to say at send time through `email_context` (13, D191); the latest bodies of `queue_email`,
> `queue_audit_email` and `email_context` are in `20261129090000_phone_password.sql`, and of `pricing_settings_guard`
> in `20261126090000_report_problem.sql`. The notice topic `ratings` already exists for both roles (01 part 2,
> `lib/notifications/topics.ts`), so the account page already has its switch. No table, column or function for ratings
> exists yet. There is no account deletion (every foreign key to `profiles` is `on delete restrict`). Cross checked on
> Sonnet the same day (15 findings: 8 Major, 7 Minor, no Critical; every claim above about what exists held): 13 are
> folded into the text below, 2 declined with their reasons (see *Cross check*).

## Summary

After a job is `COMPLETED`, the customer may rate the provider on four things (punctuality, quality of work,
professionalism, value), one to five stars each, within 14 days. It is optional and changes nothing: no money, no state,
no other feature reads it. Customers see a provider's score on the offer card only once the provider has 5 ratings,
shrunk toward the platform average and weighted toward recent jobs, always with the count; before that the card says
"New". Ratings are never edited or deleted; admin may hide one with a recorded reason, and the score is computed from
the rows every time it is read, so nobody can make it disagree with the ratings.

## Requirements

**User stories**:
- As a customer, I want to rate a finished job in a few taps, or skip it with no effect, so that the next customer
  chooses better.
- As a customer choosing a provider, I want a score I can trust (only from completed jobs, never one lucky 5.0), so that
  I can compare offers without chatting.
- As a provider, I want to see the score customers see, so that I know where I stand.
- As admin, I want to hide a fake or forced rating with a recorded reason, never change a number, so that the score
  stays honest.

**Prerequisites**: 16 and 01b merged (2026-11-21, `d4c933f`). Branch `feat/17-ratings`.

**Acceptance criteria**:
- **AC-1, who rates and when**: `rate_provider(p_request_id, p_punctuality, p_quality, p_professionalism, p_value)`
  locks the request row first, then accepts only the request's customer, only while `requests.status = 'COMPLETED'`,
  the selected application has `unlocked_at`, and `now() <= closed_at + make_interval(hours => 24 *
  rating_window_days)` (whole hours, so a clock change never moves it). Every way to `COMPLETED` counts, a job admin
  closed after a report (`job.closed_by_admin`, 14's `handle_report` outcome `job_closed`) included: the brief asks only
  that the request be completed. Each score is a whole number from 1 to 5 and all four are required. It inserts one
  `ratings` row (region, provider, application and customer taken from the request, never from the caller) and one
  `audit_log` row: action `rating.created`, `entity_type` `requests`, `entity_id` the request id, `region` the
  request's, `new_value` `{ "application_id", "rating_id" }` (ids only, no score), so 13's trigger finds the provider
  the way it does for every request move and never reads `ratings`. Refusals: a request
  that is not the caller's, or does not exist, `not_found`; any other state, or no unlocked pick, `invalid_state`; past
  the window `deadline_passed`; a bad score `validation_failed`; a second rating for the request `already_rated` (a
  unique `request_id`, so a double tap or a second tab cannot make two); a broken setting `rating_settings_invalid`.
  A provider, another customer and admin are all refused, so admin can never rate for anyone.
- **AC-2, append only**: `ratings` and `rating_hides` refuse every `update`, `delete` and `truncate`, for every role,
  by trigger (`rating_append_only`, the ledger's pattern, 07) and by revoked grants. No API role (`anon`,
  `authenticated`, `service_role`) may insert, update, delete or select either table directly: RLS is on with a deny
  policy (`using (false)`), and every read goes through the definer functions named below. pgTAP proves each refusal
  for each role.
- **AC-3, it gates nothing (D4)**: `rate_provider` changes no row of `requests`, `applications`, `fee_payments`,
  `fee_refunds`, `checkout_attempts`, `ledger_journals` or `ledger_entries` (pgTAP compares them before and after). A
  meta test reads `pg_proc.prosrc` of every function in `public`, strips `--` and `/* */` comments, matches the whole
  words `\m(ratings|rating_hides)\M`, and fails unless the matching set is exactly `rate_provider`, `request_rating`,
  `provider_rating_summary`, `my_provider_rating`, `admin_provider_ratings`, `admin_hide_rating` and `email_context`
  (the topic string `'ratings'` in `queue_audit_email` is a quoted literal the test skips by also stripping
  single quoted strings), so no later change can make anything wait on a rating. A `COMPLETED` request with
  no rating keeps every other behaviour: the report window, the provider history row, and the customer posting a new
  request (pgTAP and e2e).
- **AC-4, the score**: `provider_rating_summary(p_provider_id)` (internal, no grant) reads the provider's visible
  ratings (no `rating_hides` row). Fewer than `rating_min_count` gives `{ "state": "new", "count": n }`. Otherwise, for
  each dimension and for the overall score, `(C × M + Σ wᵢrᵢ) / (C + Σ wᵢ)`, where C is `rating_prior_weight`, M is the
  mean of that dimension over every visible rating of the provider's region (overall: the mean of the per rating means),
  rᵢ is the rating's score (overall: the mean of its four scores), and wᵢ is `power(0.5::numeric, age / half_life)` with
  `age = extract(epoch from now() - created_at) / 86400.0`. All arithmetic is `numeric`, never `double precision`; the
  denominator is at least C (at least 1), so it never divides by zero. Each figure is rounded once with
  `round(numeric, 1)` (half away from zero), giving `{ "state": "rated", "count", "overall", "punctuality", "quality",
  "professionalism", "value" }`. A broken setting gives `{ "state": "unavailable" }`: the summary catches
  `rating_settings_invalid` itself, because `offer_card` is plain SQL and cannot. Nothing stores the result (no
  `rating_avg` column anywhere), so it always equals what the rows say. pgTAP: one 5 shows `new`; four ratings show
  `new` and the fifth shows a score; five 5s in a region whose other ratings are all 3 show less than 5.0 (the test
  computes the exact figure); a rating 365 days old (with the default half life) weighs half of a new one; hiding a
  rating lowers the count and changes the figures at once, and hiding the fifth sends the provider back to `new`.
- **AC-5, the offer card**: `offer_card` is replaced in place (`create or replace`, same signature, its `revoke`
  repeated) and adds `rating` (AC-4's shape) to every offer and to the chosen provider, so `request_offers` (its only
  caller) returns it with no change of its own. A chosen provider suspended after the choose keeps their rating (06
  already hides only the message). `OfferCard` shows, when `rated`, "★ 4.8 · 26 ratings" in place
  of the "New" chip, and a disclosure ("See ratings") with the four dimensions as bars (s8) and one line:
  "Only customers of completed jobs can rate. Admin hides a rating only when it was fake or forced, never for being
  low." (`[draft]` until S16). When `new` it shows the "New" chip as today (D159); when `unavailable`, neither. The
  chosen provider's block on the request page shows the same line.
- **AC-6, the customer's form**: `request_rating(p_request_id uuid) returns jsonb` (definer, `stable`) returns, for the
  request's customer only (null otherwise), `{ "can_rate", "rate_until", "timezone", "rating" }`: `can_rate` is true
  only when AC-1 would accept now (no rating, `COMPLETED`, unlocked pick, window open, settings valid), `rate_until` the
  window's end or null, `rating` the four scores and `created_at`, or null. On `/[locale]/requests/[id]`, when the
  request is `COMPLETED`: while `can_rate`, a section "Your rating" with an
  "Optional" chip, the note "Your rating changes nothing about any payment, and you can't change it after you send it"
  (s9, without its release words), four rows of five stars (`RatingStars`: one radio group per dimension, with a
  legend, a label per star such as "4 of 5", arrow keys), and Send, enabled once all four are picked; after a send, or
  when a rating exists, the four scores read only with "You rated on <date>" in the region's time zone; when the window
  has passed with no rating, no section. `already_rated` from a second tab reloads the stored rating. No comment field
  (decision 3 below).
- **AC-7, the provider's view**: `my_provider_rating() returns jsonb` (definer, `stable`, behind `provider_reader()`,
  which refuses `forbidden` for anyone else) returns AC-4's summary of the caller. `/[locale]/provider/profile` gets a card "Your rating": when `new`, "Customers see your average after 5
  ratings. You have N."; when `rated`, the overall score, the count and the four bars. It never shows a single rating,
  a date, a request or a customer (the provider holds every customer's phone after the reveal, so a per job score
  invites pressure).
- **AC-8, admin**: on `/[locale]/admin/providers/[id]`, a Ratings section: `admin_provider_ratings(p_provider_id uuid,
  p_page integer) returns jsonb` (definer, `stable`, checks `is_admin()` again; a page below 1 refuses
  `validation_failed`) returns `{ "summary", "total", "timezone", "rows" }`, rows newest first (then by id), 20 a page,
  each `{ "id", "created_at", "request_id", "punctuality", "quality", "professionalism", "value", "hide" }`, `hide`
  null or `{ "reason", "note", "hidden_by_name", "hidden_at" }` with the admin's `profiles.full_name`. The page shows
  the date in the region's time zone, the request id linking to `/[locale]/admin/requests/[id]`, the four scores and
  the hide. `admin_hide_rating(p_rating_id uuid, p_reason text, p_note text) returns jsonb` (definer, checks
  `is_admin()` again) takes a reason from `fake`, `pressure`, `customer_asked`, `other` and a note of 1 to 500
  characters after trim, locks the rating's request row first, inserts one `rating_hides` row with the region copied
  from the rating (a second refuses `already_hidden`; a hide is final) and one `audit_log` row: action `rating.hidden`,
  `entity_type` `ratings`, `entity_id` the rating id, `new_value` `{ "reason", "note" }` (no mail hangs on it). A
  confirm dialog names the rating's date and scores first. No path changes a score.
- **AC-9, mail**: two templates through 13's machinery, in three locales; nothing sends while `emails_enabled` is off
  (S43). Each is added, in the migration, to the template list of `queue_email`, to the `case` of `email_context`, and
  to the strict values schema in `lib/email/values.ts`.
  - `rate_provider` to the customer, only on `job.auto_closed` and `job.closed_by_admin` (a customer who just confirmed
    or closed the job is looking at the form already): a second `queue_audit_mail` in `queue_audit_email`'s existing
    job closed branch, beside the provider's `job_completed`; entity the application id; topic `ratings`; `send_until`
    = `closed_at + make_interval(hours => 24 * rating_window_days)`. At send time `email_context` ends it as skipped
    unless no `ratings` row exists for the request and the window, recomputed from the current setting, is still open;
    its values add the provider's display name (`offer_display_name` of the approved name, 06) and the window's end.
  - `rating_received` to the provider on `rating.created` (the action joins the `audit_log_email` trigger's list), topic
    `ratings`, sent at once, saying only that a new rating arrived and linking to `/provider/profile`: no score, no
    customer, no request.
- **AC-10, settings**: four keys per region, seeded for TR and KSA, each held by its own check constraint
  (`platform_settings_<key>_valid`, whole numbers, 14's pattern), kept by `pricing_settings_guard` (replaced with every
  key it guards today plus these four), and read by one fail closed reader `rating_settings(p_region)`: `rating_window_days` 14 (1
  to 90), `rating_min_count` 5 (5 to 50, so no admin edit can show an average below 5 ratings, overview §28),
  `rating_prior_weight` 5 (1 to 50), `rating_half_life_days` 365 (30 to 3650). A door that meets
  `rating_settings_invalid` (a refusal, or a summary in state `unavailable`) raises the alert of that name.
- **AC-11, analytics**: `rating_submitted` with no properties, sent after a successful send, in `events.ts` and the
  filter.
- **AC-12, public surfaces**: no public page shows a rating, and the JSON-LD keeps no `aggregateRating` (B7). The
  landing line "Ratings come from completed jobs only" holds by AC-1.
- **AC-13, tests**: every new string in `ar`, `tr` (as `[tr]` until S21) and `en`; axe at 390px in all three on every
  changed screen; negative tests: a provider, another customer and an admin token on `rate_provider` and
  `request_rating`, a customer and a provider token on both admin functions, a customer on `my_provider_rating`; e2e
  `ratings` (run in batches with `--workers=1`, D204): a customer completes a job, skips the rating and posts a new
  request; rates and sees it read only; the provider sees "New" and the count; with five seeded ratings the offer card
  and the provider card show a score; admin hides one and both figures change. **Seeding**: no API role can insert a
  rating, so pgTAP and the e2e SQL helper insert as `postgres`, through one helper that builds each `COMPLETED` request
  with its unlocked pick and then inserts the rating with a chosen `created_at` (the append only trigger blocks only
  update and delete); five ratings need five requests, because `request_id` is unique.

## Feature design

**Data model** (migration `20261130090000_ratings.sql`):

| Table | Columns | Rules |
| --- | --- | --- |
| `ratings` | `id` uuid primary key default `gen_random_uuid()`; `region` text not null, FK `regions(code)`; `request_id` uuid not null unique, FK `requests` on delete restrict; `application_id` uuid not null, FK `applications` on delete restrict; `provider_id` uuid not null, FK `providers` on delete restrict; `customer_id` uuid not null, FK `profiles` on delete restrict; `punctuality`, `quality`, `professionalism`, `value` smallint not null, each `between 1 and 5`; `created_at` timestamptz not null default `now()` | Append only (AC-2). Index `(provider_id, created_at desc)` for the summary and the admin list, `(region)` for the region mean. One per request |
| `rating_hides` | `rating_id` uuid primary key, FK `ratings` on delete restrict; `region` text not null, FK `regions(code)`, copied from the rating by `admin_hide_rating`; `reason` text not null, in (`fake`, `pressure`, `customer_asked`, `other`); `note` text not null, 1 to 500 characters after trim; `hidden_by` uuid not null, FK `profiles` on delete restrict; `created_at` timestamptz not null default `now()` | Append only (AC-2). At most one per rating; no unhide |

Four settings rows per region (AC-10). No column is added to any existing table; `requests.status` and
`applications.status` gain no value (no `RATED` state: a rating is its own row, which is what keeps D4 true).

**State transitions**: none. A rating exists or not; a hide exists or not; both are final.

**API surface** (database functions; the doors wrap them; every Server Action runs `guardedAction` with its role):

| Function | Door, caller | Key inputs | Key outputs | Key errors |
| --- | --- | --- | --- | --- |
| `rate_provider(uuid, integer, integer, integer, integer) returns jsonb` | `lib/requests` `rateProvider`, customer | request id, four scores | `{ "rating_id" }` | `not_found`, `invalid_state`, `deadline_passed`, `validation_failed`, `already_rated`, `rating_settings_invalid` |
| `request_rating` | `lib/requests` `loadRating`, customer | request id | AC-6's object, or null | none (null when not the caller's) |
| `request_offers` (unchanged) via `offer_card` (replaced) | `lib/requests` `loadOffers`, customer | request id | each card gains `rating` | as today |
| `my_provider_rating` | `lib/provider-feed` `loadMyRating`, provider | none | AC-4's summary | `forbidden` |
| `admin_provider_ratings` | `lib/admin-ratings` `loadProviderRatings`, admin | provider id, page (1 based) | `{ "summary", "total", "rows" }` | `forbidden` |
| `admin_hide_rating` | `lib/admin-ratings` `hideRating`, admin | rating id, reason, note | `{ "hidden_at" }` | `forbidden`, `not_found`, `validation_failed`, `already_hidden` |
| `provider_rating_summary`, `rating_settings` | internal, no grant | provider id / region | AC-4 / AC-10 | `rating_settings_invalid` (reader only) |
| `queue_email`, `queue_audit_email`, `email_context`, `pricing_settings_guard`, trigger `audit_log_email` | replaced from their latest bodies, each change named in a comment | | the two templates, the `rating.created` action, the four keys | as today |

`lib/admin-ratings/` is a new server only door (admin), joining the door table in `AGENTS.md` at the merge.

**Value sourcing**:

| Action | Value | Source |
| --- | --- | --- |
| Rate | region, provider, application, customer | the request row and its `selected_application_id`, never the caller |
| Rate | the window's end | `requests.closed_at` + `rating_window_days` of the request's region |
| Summary | C, minimum count, half life | `rating_prior_weight`, `rating_min_count`, `rating_half_life_days` of the provider's region |
| Summary | M per dimension | mean of visible `ratings` of that region (the provider's region equals each rating's region: one account, one region) |
| Summary | a rating's age | `now()` minus `ratings.created_at`, in days |
| Summary | rounding | Postgres `round(x, 1)` on numeric, once |
| Displayed score | digits | `Intl.NumberFormat` with one decimal, `ar` as `ar-u-nu-latn` (i18n §7) |
| Bar width | display only | the figure ÷ 5, as a CSS percentage |
| Dates shown | time zone | `regions.timezone` of the row's region |
| Mail recipients | customer, provider | the request's `customer_id`; the selected application's `provider_id` |
| Mail `rate_provider` | provider's name, service, link, last day | `offer_display_name` of the provider's approved name (06), `services` name in the locale, `/requests/<id>`, `closed_at + rating_window_days` |
| Hide | who | `auth.uid()` of the admin |

**Key invariants**:
- At most one rating per request, only for a `COMPLETED` request with an unlocked pick, only by its customer.
- No rating or hide row is ever updated or deleted.
- Every figure shown equals AC-4's formula over the visible rows at that moment; nothing is stored.
- No function outside this spec reads `ratings` or `rating_hides` (AC-3's meta test).
- No average shows below 5 ratings in any region.

**Security model**: customers write only their own request's rating and read only their own rating and the summaries
on their own request's offers; providers read only their own summary; admin reads every rating with its request id
and hides with a reason, audited; nobody reads who gave a rating except admin. Ratings carry no contact data, so rule 2
is untouched. Personal data under KVKK: the link between a customer and their scores, held admin only. Mail values are
read by the relay at send time (13), never stored in the outbox row.

**Configuration required**: no new environment variable. Four settings (AC-10).

**UI** (design source: `docs/design/source/` fallback, said out loud, D110): s9's rating block for the form, s8's bars
for the dimensions, the registry's `RatingStars` (five 44px circles, `bg-accent-muted` with ★, picked `bg-accent`).
New or now built components get rows in `context/ui-registry.md`: `RatingStars`, `RatingForm`, `RatingSummary` (the
line and its disclosure), `RatingBars`, `MyRatingCard`, `AdminRatingsSection`, `HideRatingDialog`.

**Critical test scenarios**:
- Happy path: a customer confirms, sees the form, sends four scores, sees them read only; the provider gets one mail
  row; verifies AC-1, AC-6, AC-9.
- Skip: a customer completes and never rates; every other flow behaves the same; verifies AC-3.
- Shrinkage: five 5s in a region of 3s show less than 5.0; four ratings show New; verifies AC-4, AC-5.
- Race: two `rate_provider` calls in parallel make one row and one `already_rated` (`36_rating_races`); verifies AC-1.
- Permission: an admin token on `rate_provider` gets `not_found`; a customer token on `admin_hide_rating` gets
  `forbidden`; an `update` on `ratings` as `postgres` fails on the trigger; verifies AC-1, AC-2, AC-8.

## Decision

1. **The score is computed when read, never stored.** Runner up: `providers.rating_avg` refreshed on each insert and by
   a nightly job (`architecture.md` §24). A stored figure goes stale between runs (recency weights and the region mean
   move every day) and needs a write path that rule "no admin write" must then police; reading it fresh makes the
   invariant true by construction. The cost: each offer card reads its provider's ratings (indexed) and the region's
   ratings for M, so an offer list costs offers × region ratings rows; at launch volume that is a few thousand rows at
   most. Switch to a nightly projection, or compute M once per `request_offers` call, when a measured offer page read
   is slow.
2. **A hide is its own append only row** (`rating_hides`). Runner up: hide columns on `ratings` with an update path for
   them only. The separate row keeps `ratings` strictly append only (rule 5) with no column level exception to test.
3. **No text comment in 17.** Runner up: an optional comment (s9 draws one, s8 lists them), scanned for contact
   details. Public text about a named provider brings moderation, the contact scanner, defamation and KVKK questions
   that the brief (§28) does not ask for; scores alone carry the signal. The s8 review list waits for 19's profile page
   and an owner decision.
4. **Providers see only their summary.** Runner up: each rating with its job. The provider holds the customer's phone
   after the reveal (rule 2, no masking), so a per job score invites the pressure the brief warns about (overview §3).
5. **The form sits on the request page** (s9), not a page of its own; the mail links there.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) ·
`supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) ·
`shadcn` (`shadcn-ui/ui`, `.claude/skills/shadcn/`)

## Build plan

Tracer bullet, tests first on the access rules and the formula. **High risk path, said out loud:**
`supabase/migrations/**` (a new migration that also replaces 13's mail functions and the settings guard).

1. pgTAP first: `35_ratings.test.sql` (AC-1 to AC-4, AC-8 to AC-10, the meta test) and `36_rating_races.test.sql`;
   then the migration: settings and their checks, both tables with RLS, deny policies, revoked grants and the append
   only triggers, the readers and functions, `offer_card` replaced, the mail functions and the trigger replaced;
   `npm run db:types`; satisfies **AC-1** to **AC-4**, **AC-8** to **AC-10**.
2. Doors: `lib/requests` (`rateProvider`, `loadRating`, the `rating` field in the offers schema), `lib/provider-feed`
   (`loadMyRating`), `lib/admin-ratings` (`loadProviderRatings`, `hideRating`), strict schemas, error mapping and the
   alert; `lib/email` (two templates, their values, `Email.*` strings); `rating_submitted` in `lib/analytics`; unit
   tests; satisfies **AC-5** to **AC-11**.
3. UI: `RatingStars`, `RatingForm` on the request page, `RatingSummary` and `RatingBars` on `OfferCard` and the chosen
   provider block, `MyRatingCard` on the provider profile, `AdminRatingsSection` with `HideRatingDialog`; strings in
   three locales; registry rows; satisfies **AC-5** to **AC-8**, **AC-12**.
4. e2e `ratings` and axe at 390px in `ar`, `tr`, `en`; local gate (D204); `/check verify`; satisfies **AC-13**.
5. PR; `slice-reviewer` and `security-reviewer` (personal data, admin powers, the mail functions); fixes; the
   migration to the cloud after a dry run; the owner decides the merge (D204).

## Consequences

- Positive: the brief's trust leg (§34 item 3) goes live; the landing line about ratings becomes true; the figure can
  never drift from the rows.
- Negative: a provider can still estimate one customer's score by watching their own average move after a rating
  (true of any visible average; decision 4 removes the direct view). A provider could rate themselves through a fake
  customer, but each fake rating costs both fees; 19's signals can look for it. A hide is final, so a mistaken hide
  stays (it is audited with its reason). Hidden or not, ratings stay forever; the retention period and the erasure
  answer for a customer's link to their scores wait for S16.
- Neutral: the first week shows "New" everywhere (D96: nobody has 5 ratings yet). 21's wipe of test data must lift the
  append only triggers of `ratings` and `rating_hides` the way it handles the ledger.

## Follow-up

- [ ] Umbrella `index.md`: a Structure row for this child and the P2 line amended (done in this change).
- [ ] `build-plan.md` row 17: link this spec (done in this change); the status moves with the build.
- [ ] Tracker at acceptance: a decision row for this spec, the four settings in the defaults table, and the override
      of the overview's `RATED` application status (§22 lists it; 17 adds no status, so D4 holds by construction).
- [ ] 19: `source = 'migrated'` ratings from invitation links (B8, Q9), which needs an `alter table` adding `source`
      (default `platform`) and a nullable `request_id` on the append only table; the customer facing profile (s8) with
      its review list, jobs completed, and the quality floor reading `provider_rating_summary`.
- [ ] S16: legal review of the disclosure line under AC-5 (Turkish rules on consumer reviews) and of the retention of
      ratings; the line carries `[draft]` until then, so `launch:gate` fails while it stays.
- [ ] 21: the wipe handles `ratings` and `rating_hides` like the ledger.
- [ ] Owner, later: whether ratings get a text comment (decision 3).

## Cross check (Sonnet, 2026-11-21)

Applied: the audit row's shape (AC-1), the mail changes named one by one and the invite only where the customer did not
just see the form (AC-9), admin closed jobs rateable (AC-1), the seeding helper (AC-13), the meta test's exact match
and list (AC-3), `numeric` arithmetic (AC-4), `offer_card` replaced in place and the summary catching its own setting
error (AC-4, AC-5), full signatures and row keys (AC-6 to AC-8), the hide's region copied (data model), the window in
whole hours (AC-1), the `RATED` override and 19's `alter table` (Follow-up), hiding the fifth rating, the guard's full
key list and per key checks (AC-4, AC-10).

Declined, with reasons:
- **Delay or drop `rating_received`.** A delay hides nothing: the provider's count moves the moment a rating lands, and
  below 5 ratings no score is ever shown, so the mail adds only what the count already says. The brief lists the notice
  (overview §24 row 14); it stays, without a score.
- **Compute the region mean once per offer list now.** It needs `offer_card`'s signature changed for a cost that is
  small at launch volume; decision 1 now states the real cost and when to switch.

## Rationale

Ratings are P2 and optional, so 17 builds the smallest honest version: four scores, one per completed job, a figure
that cannot be gamed by one rating or edited by anyone, and no surface that lets a provider pressure a customer. The
score is read fresh because a stored copy is one more thing to keep true; the hide is its own row because rule 5 allows
no exception on `ratings`; everything else (comments, the profile page, migrated ratings, the quality floor) belongs to
19 or to an owner decision.
