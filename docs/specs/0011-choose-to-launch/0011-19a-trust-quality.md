# 0011-19a. Trust and quality: metrics, probation, quality floor, funnel (position 19, part a, P2)

Child of [0011](index.md). Follows the cross child contract there. **Touches personal data (figures about a named
provider, warnings, suspensions) and 13's and 18's mail and notice functions, and changes the apply path (05, 06): a
migration (two tables, settings, functions, indexes), two doors, six surfaces.** Part b (structured application
answers) is [0011-19b](0011-19b-application-answers.md), its own branch and PR after this one.

> **Accepted 2026-11-22 under the owner's standing rule "always do whats recommended" (D213)**, after a Sonnet cross
> check (22 findings, every fix applied, see *Cross check*). Written against what 01 to 18 and 01b built (specs 0006, 0009, 0010, 0011-07 to 0011-18,
> 0012; D112 to D212). Built now, before 21, by the owner's override of the build order (D203); gated and merged by
> D204. Only the parts that need none of B7, B8 or Q9 are here (D203): **out** are the reputation migration, legacy job
> counts, rating invitations and Founding Provider (B8, Q9), and any public quality claim or new public wording such
> as "vetted" (B7). Every design choice below was the owner's pick in the `/architect` interview or, after the owner
> said "always do whats recommended", the recommended option.
>
> What 19a reads as built: a provider has five stored states, `draft`, `pending`, `approved`, `rejected`,
> `suspended` (02, D112), and `provider_standing(id)` reads `document_expired` for an approved provider with a required
> document past `valid_until` (no job). Only `approved` may apply (`apply_to_request`, latest body in
> `20261118090000_choose_provider.sql`), and the applicant cap counts `approved_applied_count(request)` against
> `max_applicants_per_request` (10) under the request row lock; `provider_feed`, `provider_request` and
> `provider_home_counts` (same file) hide or mark a request at the cap. The customer reads offers only through
> `request_offers`, in arrival order, each drawn by `offer_card(application, timezone)` (latest body in
> `20261130090000_ratings.sql`). A pick is `requests.selected_application_id`; after the reveal it never changes, and
> a cancel after the reveal keeps it (`cancel_by_rule`, 12). The cancel audit row carries `counts_against` from
> `cancellation_rules` (`provider_cancellation`, `provider_fee_follow_through`, `customer_late_cancel`, `admin_attribution`,
> `nobody`), and `admin_cancel_request` writes `attributed_to` (`customer`, `provider`, `platform`) on its
> `request.admin_cancelled` row (16). `request.commission_paid`, `request.fee_expired` and `request.provider_withdrew`
> rows carry `application_id` in `new_value`. `applications.unlocked_at`, `requests.actual_started_at`,
> `scheduled_start_at`, `closed_at` and `problem_reports.against_id` exist. `provider.approved` and `provider.rejected`
> rows (entity_type `provider`, entity_id the provider) record every decision, a second approval after a replaced
> document included. 14's `user_warnings` (reason list fixed to report reasons, `report_id` nullable) shows the oldest
> unacknowledged warning through `my_warning` and `WarningBanner`; `suspend_provider(id, reason)` (latest in
> `20261124090000_expiry_cancel_refunds.sql`) ends live picks and writes `provider.suspended`, and a report suspension
> stores `report:<reason>`, which `AccountStateBanner` translates. Mail and notices hang on `audit_log` through one
> recipient map, `audit_notices` (18, `20261201090000_notification_centre.sql`), and two triggers, `audit_log_email`
> (latest list in `20261130090000_ratings.sql`) and `audit_log_notice`; `notifications.kind` has a check. 17's meta
> test (pgTAP 35, D207) allows exactly eight readers of `ratings` and `rating_hides`, through
> `provider_rating_summary` included.

## Summary

19a turns what the platform already records into honest quality signals. The customer's offer card gains three
figures counted from real jobs (jobs done on Aldebyani, the completion rate, the on time rate), each rate shown only
after 5 jobs. A new provider is on probation for their first 5 completed jobs: at most 2 live jobs at once, and the
last 2 of a request's 10 applicant slots are kept for them. Admin gets a Quality page: a watchlist that an hourly job
fills when a provider crosses a threshold (low rating, many reports, many cancels, low follow through, or any report
or cancel during probation), where admin warns, suspends or clears; a probation list; and the vetting funnel with a
real acceptance rate. Nothing is stored that can drift from the rows, and nothing happens to a provider automatically.

## Requirements

**User stories**:
- As a customer choosing between offers without chatting, I want figures counted from real jobs on Aldebyani, so that
  I can tell a reliable provider from an unreliable one.
- As a new provider, I want a fair chance at requests that established providers fill fast, so that I can earn my
  first jobs.
- As admin, I want a list of providers whose numbers crossed a line, with the figure that crossed it, so that I warn
  or suspend the right people and keep the quality claim true.
- As admin, I want the real acceptance rate of the vetting funnel, so that any future quality claim (B7) rests on a
  figure the system computed.
- As a provider, I want a reminder before a required document expires, so that I am not blocked from applying.

**Prerequisites**: 18 merged (2026-11-22, `412ad4c`, docs `4d466d5`). Branch `feat/19a-trust-quality`. 19b waits for
this merge.

**Acceptance criteria**:

- **AC-1, settings**: twelve keys per region, seeded for TR and KSA with the defaults below, each held by its own check
  constraint (`platform_settings_<key>_valid`, whole numbers, 17's pattern), kept by `pricing_settings_guard` (replaced
  with every key it guards today plus these twelve), and read by one reader `quality_settings(p_region text) returns
  jsonb` (internal, no grant) that raises `quality_settings_invalid` when a key is missing or malformed, or when
  `probation_reserved_slots >= max_applicants_per_request` (it reads the cap through `apply_settings` and turns that
  reader's `apply_settings_invalid` into `quality_settings_invalid`, X-15). Callers resolve it once per region per
  call, never once per provider row (X-20). The reminder job (AC-14) reads only `document_reminder_days`, through its
  own fail closed `document_reminder_days(p_region)`, so a broken quality key never stops reminders.

  | Key | Default | Range | Meaning |
  | --- | --- | --- | --- |
  | `metrics_window_days` | 365 | 30 to 1095 | Rates count the last N days; jobs done is all time |
  | `metrics_min_jobs` | 5 | 5 to 50 | A rate shows, and a rate flag can raise, only past N in its own denominator |
  | `on_time_grace_minutes` | 15 | 0 to 120 | A start up to N minutes after the booked start is on time |
  | `probation_jobs` | 5 | 1 to 50 | Probation ends on the Nth `COMPLETED` job |
  | `probation_live_jobs` | 2 | 1 to 10 | Live jobs a provider on probation may hold before apply refuses |
  | `probation_reserved_slots` | 2 | 0 to 10 | Applicant slots only providers on probation may take |
  | `floor_rating_min_tenths` | 35 | 10 to 50 | Overall score below N / 10 raises `low_rating` |
  | `floor_report_rate_pct` | 10 | 1 to 100 | Report rate above N% raises `high_reports` |
  | `floor_cancel_rate_pct` | 10 | 1 to 100 | Cancellation rate above N% raises `high_cancellations` |
  | `floor_follow_through_pct` | 70 | 1 to 100 | Follow through below N% raises `low_follow_through` |
  | `quality_flag_cooldown_days` | 30 | 1 to 365 | After admin handles a rate flag, the same kind waits N days |
  | `document_reminder_days` | 14 | 1 to 60 | The expiry reminder goes N days before `valid_until` |

- **AC-2, the metrics**: `provider_quality(p_provider_id uuid) returns jsonb` (internal, no grant, `stable`) computes
  every figure from the rows each time it is read; nothing stores a result. W is `now() - make_interval(days =>
  metrics_window_days)`. A provider's jobs are the requests whose `selected_application_id` is an application of the
  provider with `unlocked_at` set. A **provider caused cancel** is such a request that is `CANCELLED` with
  `cancelled_by = 'provider'`, or `cancelled_by = 'admin'` with its `request.admin_cancelled` row's `attributed_to =
  'provider'`; it is defined by `cancelled_by` and the attribution, never by `cancellation_rules.counts_against` (X-9).
  Each rate returns `{ "num", "den", "pct" }`, `pct` = `round(100 * num / den)` in `numeric` (half away from zero, one
  rounding step), or null when `den = 0`:
  - `jobs_done`: the provider's jobs that are `COMPLETED`, all time (a whole number), from its own internal function
    `provider_jobs_done(p_provider_id uuid) returns integer` (no grant), which `provider_quality`,
    `provider_card_quality`, `provider_on_probation` and the admin lists call, so nothing needing only the count runs
    the seven rates (X-11).
  - `completion`: num = jobs `COMPLETED` with `closed_at` in W; den = num + provider caused cancels with
    `cancelled_at` in W (a cancel by the customer, the platform, or an admin cancel attributed to anyone else counts
    neither way).
  - `on_time`: den = jobs with `actual_started_at` in W; num = those with `actual_started_at <= scheduled_start_at +
    make_interval(mins => on_time_grace_minutes)`.
  - `cancellation`: den = applications of the provider with `unlocked_at` in W; num = provider caused cancels of those
    same jobs (selected application `unlocked_at` in W), so the rate never passes 100% (X-18).
  - `reports`: den = jobs `COMPLETED` with `closed_at` in W; num = `problem_reports` with `against_id` the provider,
    `side = 'customer'`, `created_at` in W, and not handled with `outcome = 'no_action'`.
  - `repeat_customers`: den = distinct customers with a `COMPLETED` job of the provider closed in W; num = those with
    two or more.
  - `response_minutes`: the median (`percentile_cont(0.5)`, then `round` to a whole minute) of `applications.created_at
    - requests.created_at` over the provider's applications created in W, with its count; null with none.
  - `follow_through`: num = applications of the provider with `unlocked_at` in W; missed = distinct applications of the
    provider named by a `request.fee_expired` or `request.provider_withdrew` row whose `new_value ->> 'counts_against'
    = 'provider_fee_follow_through'`, created in W (a fee expiry after a suspension is written `nobody` and does not
    count, X-9); den = num + missed.
  pgTAP builds each case on fixtures and checks the exact figure, including: a customer cancel after the reveal leaves
  `completion` unchanged; an admin cancel attributed to the provider lowers it; a start 15 minutes late is on time and
  16 minutes late is not; a report handled `no_action` does not count; a job outside W counts only in `jobs_done`.

- **AC-3, the offer card**: `provider_card_quality(p_provider_id uuid) returns jsonb` (internal, no grant) returns `{
  "jobs_done", "completion", "on_time", "window_days", "grace_minutes" }`, where `completion` and `on_time` are `{ "pct",
  "den" }` only when `den >= metrics_min_jobs`, else null. With broken settings it returns null (it catches
  `quality_settings_invalid` itself, because `offer_card` is plain SQL). `offer_card` is replaced in place (same
  signature, its `revoke` repeated) and adds `quality` to every offer and to the chosen provider, so `request_offers`
  returns it with no change of its own. `OfferCard` shows, under the name line, "12 jobs on Aldebyani" when `jobs_done
  >= 1`, then "· 92% completed" and "· 88% on time" when present; inside 17's "See ratings" disclosure (or a disclosure
  of its own when the provider is not rated) one line: "Counted from jobs on Aldebyani in the last 12 months.
  Completed counts jobs not cancelled by the customer; on time means started within 15 minutes of the booked time."
  with the window and the grace taken from the shape (`[draft]` until S16); the window reads in months when
  `window_days` is a multiple of 30 (`window_days / 30` months, so 365 reads "12 months" by `round(365 / 30.0)` =
  12) and in days otherwise (X-19). No report rate, cancellation rate, follow
  through, probation or watchlist word ever reaches a customer.

- **AC-4, the provider's own view**: `my_provider_quality() returns jsonb` (definer, `stable`, behind
  `provider_reader()`, which refuses `forbidden` for anyone else) returns `{ "quality": <AC-3 shape>, "probation": {
  "jobs_done", "jobs_needed", "live", "live_limit" } | null }` (`probation` set only while AC-5 says the caller is on
  probation). `/[locale]/provider/profile` gets a card "Your quality" (`MyQualityCard`, beside `MyRatingCard`): the
  three figures as customers see them, a rate below the minimum reading "Shown after 5 jobs"; while on probation, "Your
  first 5 jobs: 3 done" and "While in your first jobs you can hold 2 jobs at once." It never shows the watchlist, the
  report rate, the cancellation rate or follow through.

- **AC-5, probation**: `provider_on_probation(p_provider_id uuid) returns boolean` (internal, no grant) is true when
  `provider_standing` is `approved`, the provider's `jobs_done` (AC-2) is below `probation_jobs`, and no
  `probation_waivers` row exists for them. It is a reading, never a stored state (02's funnel stays as built, D112). With
  broken settings it returns false and logs `raise warning 'quality_settings_invalid region=%'` (fail open: probation
  is a fairness rule, and a broken setting must never stop anyone applying). Admin may end probation early with
  `admin_end_probation(p_provider_id uuid, p_note text) returns jsonb` (definer, checks `is_admin()` again): a note of
  10 to 500 characters after trim (else `reason_required`), the providers row locked first (`for update`), then an
  existing waiver refuses `already_waived` (checked before probation, so a waived provider never reads
  `not_on_probation`, X-21), then the provider on probation (else `not_on_probation`), one `probation_waivers` row (a
  waiver is final) and one `audit_log` row: action `provider.probation_ended`, entity_type `provider`, entity_id the provider,
  `new_value` `{ "note" }` (no mail or notice hangs on it). This is how a provider the business already trusts skips
  probation until the reputation migration (B8) exists.

- **AC-6, the live job limit**: `provider_live_jobs(p_provider_id uuid) returns integer` (internal, no grant) counts the
  requests whose selected application is the provider's and whose status is `COMMISSION_PAID`, `UNLOCKED`,
  `IN_PROGRESS` or `AWAITING_CONFIRMATION` (a pick awaiting the provider's fee counts, because it becomes a job when
  they pay). `apply_to_request` gains a step after the cap (step 9b): when the caller is on probation and
  `provider_live_jobs >= probation_live_jobs`, it raises `probation_limit`. Applications already sent are untouched,
  and choose, pay and the reveal are not changed (no money path moves), so a provider on probation chosen on several
  older applications at once can still exceed the limit; accepted. The apply page shows the refusal as "You can hold 2
  jobs at once during your first 5 jobs. Finish one to apply again." with the figures from AC-4, read by a second call
  after the refusal; they can differ from the instant of the refusal by a job that closed in between, accepted (X-22).

- **AC-7, reserved slots**: `provider_apply_cap(p_provider_id uuid, p_region text) returns integer` (internal, no grant)
  returns `max_applicants_per_request` for a provider on probation and `max_applicants_per_request -
  probation_reserved_slots` for anyone else (with broken quality settings: `max_applicants_per_request`, fail open, as
  AC-5). `apply_to_request` (steps 8 and 9), `provider_feed`, `provider_request` (its `cap` and `full`) and
  `provider_home_counts` are replaced in place, each reading the cap through `provider_apply_cap` for the caller instead
  of `max_applicants_per_request`, still against `approved_applied_count` and still under the request row lock in
  apply. With the defaults, once 8 approved applications are `APPLIED`, an established provider sees the request as
  full and gets `request_full`; a provider on probation still sees it and may take slots 9 and 10. The customer's offer
  list keeps arrival order; nothing on it says who used a reserved slot.

- **AC-8, the watchlist and the hourly job**: a `quality_flags` table (see *Data model*) holds one row per raised
  flag. `raise_quality_flags() returns integer` (`security definer`, `set search_path = ''`, every grant revoked;
  `pg_cron` job `providers-quality-flags`, `'41 * * * *'`, run as `postgres` like 12's `raise_deadline_flags`, so it
  calls nothing that reads `auth.uid()` or `is_admin()`, X-16) goes region by region (a region whose `quality_settings` raises is skipped with `raise warning
  'quality_flags_skipped region=% sqlstate=%'`) over providers whose standing is `approved` or `document_expired`, and
  inserts, each with `on conflict do nothing` so two runs never duplicate:
  - **rate kinds** (`source_id` null), one open flag per provider and kind, when the provider has no open flag of that
    kind and no flag of that kind handled after `now() - make_interval(days => quality_flag_cooldown_days)`:
    `low_rating` when `provider_rating_summary` is `rated` and `overall * 10 < floor_rating_min_tenths` (the summary's
    one decimal, as customers see it, compared as a whole number of tenths, X-17);
    `high_reports` when `reports.den >= metrics_min_jobs` and `100 * num > floor_report_rate_pct * den`;
    `high_cancellations` the same on `cancellation` with `floor_cancel_rate_pct`; `low_follow_through` when
    `follow_through.den >= metrics_min_jobs` and `100 * num < floor_follow_through_pct * den`. Comparisons use the
    exact integers, never the rounded percentage. `figure` stores what crossed: `{ "num", "den", "pct", "threshold" }`,
    or `{ "overall", "count", "threshold" }` for a rating.
  - **probation kinds**, only for a provider on probation now: `probation_report` for each `problem_reports` row with
    `against_id` the provider, `side = 'customer'`, `created_at >= providers.approved_at` (`source_id` the report id);
    `probation_cancel` for each provider caused cancel (AC-2) with `cancelled_at >= approved_at` (`source_id` the request
    id). Each source raises once, ever (`figure` `{ "source": "report" | "request" }`).
  The job writes nothing but `quality_flags` rows: no warning, no suspension, no mail, no notice, no change to any other
  table (pgTAP compares `providers`, `user_warnings`, `requests`, `applications` and `outbox_events` before and after a
  run). It returns the number of flags raised.

- **AC-9, admin handles a flag**: `admin_handle_quality_flag(p_flag_id uuid, p_outcome text, p_note text) returns jsonb`
  (definer, checks `is_admin()` again) takes `warned`, `suspended` or `cleared` (else `validation_failed`) and a note of
  10 to 500 characters after trim (else `reason_required`). It locks the flag row first (`for update`; unknown
  `not_found`, already handled `already_handled`), then:
  - `warned`: inserts one `user_warnings` row (region and `user_id` the provider's, `report_id` null, `created_by` the
    admin) with reason `low_rating`, `high_reports`, `high_cancellations` or `low_follow_through` for those kinds and
    `probation_issue` for both probation kinds. `user_warnings_reason_valid` is replaced to allow these five beside
    14's six. The provider sees 14's `WarningBanner` with the translated reason, never admin text. The app side widens
    with it (X-13): `lib/reports/constants.ts` gains `QUALITY_WARNING_REASONS` and a `WarningReason` union (report
    reasons plus these five); `my_warning`'s schema in `lib/reports`, `WarningBanner`'s `reason` prop and
    `lib/admin-reports`' `warningReason` take `WarningReason`; the catalogues gain the five `warning.<reason>` keys in
    three locales. `ReportReason` itself is unchanged (a report still has six reasons).
  - `suspended`: `providers.status` must be `approved` (else `not_approved`), so a provider whose standing reads
    `document_expired` may be suspended too (X-14); calls `suspend_provider(provider, 'quality:' || kind)`, so 12's
    effects, the `provider.suspended` row and its mail and notice all follow as today.
    `AccountStateBanner` translates a `quality:<kind>` reason as it does `report:<reason>`.
  - `cleared`: nothing else.
  Then it sets `handled_at`, `handled_by`, `outcome`, `note` on the flag and writes one `audit_log` row: action
  `quality.flag_handled`, entity_type `quality_flags`, entity_id the flag id, region the flag's, `new_value` `{ "kind",
  "outcome", "note" }` (no mail or notice hangs on it). Returns `{ "status": "ok", "outcome" }`.

- **AC-10, the Quality page, Watchlist tab**: `/[locale]/admin/quality` (in the admin rail as "Quality", `guardPage(['admin'])`)
  has three tabs by `?tab=` (`watchlist` default, `probation`, `funnel`; an invalid value falls back to the default)
  and `?page=`. `admin_quality_flags(p_page integer) returns jsonb` (definer, `stable`, checks `is_admin()` again; a
  page below 1 or above 10000 refuses `validation_failed`) returns `{ "rows", "total" }`: open flags, oldest first
  (then by id), 20 a page, each `{ "id", "kind", "figure", "raised_at", "provider_id", "provider_name", "standing",
  "region", "timezone" }` (`provider_name` the approved name, `standing` from `provider_standing`). Each row shows the
  kind and the figure in words ("Cancellation rate 3 of 12 jobs (25%), limit 10%"), the date in the region's time zone,
  the provider linking to `/[locale]/admin/providers/[id]`, and Warn, Suspend (while `standing` is `approved` or
  `document_expired`) and Clear, each
  opening a dialog that names the provider and the figure and asks for the note.

- **AC-11, Probation tab**: `admin_probation(p_page integer) returns jsonb` (definer, `stable`, checks `is_admin()`
  again, same page rules) returns `{ "rows", "total" }`: providers on probation, longest approved first, 20 a page, each
  `{ "provider_id", "provider_name", "region", "timezone", "approved_at", "jobs_done", "jobs_needed", "live",
  "live_limit", "reports", "open_flags" }` (`reports` = AC-8's probation reports so far). Each row has "End probation",
  a dialog asking for the note, calling AC-5.

- **AC-12, Funnel tab and the acceptance rate**: `admin_quality_funnel() returns jsonb` (definer, `stable`, checks
  `is_admin()` again) returns per region `{ "region", "timezone", "stages", "months" }`. `stages` counts providers now:
  `draft`, `pending`, `probation` (AC-5), `active` (approved, not on probation), `document_expired`, `rejected`,
  `suspended` (each provider in exactly one, by `provider_standing` then AC-5). `months` covers the current month and
  the 11 before it, months taken in the region's time zone: for each, `approved` and `rejected` count providers whose
  **first** decision (their earliest `provider.approved` or `provider.rejected` row) fell in that month, and `rate` =
  `round(100 * approved / (approved + rejected), 1)` in `numeric`, null when nobody was decided. A provider rejected
  and approved later counts once, as rejected. The tab shows the stages as counts and the months as a table; the page
  says "For admin only. No public claim uses this figure yet." (B7).

- **AC-13, the provider's admin page**: `/[locale]/admin/providers/[id]` gets a Quality section from
  `admin_provider_quality(p_provider_id uuid) returns jsonb` (definer, `stable`, checks `is_admin()` again; an id that is
  no provider `not_found`, then no section): `{ "metrics": <AC-2 shape>, "probation": <AC-4 probation shape> | null,
  "waiver": { "note", "by_name", "at" } | null, "flags": [...] }` with the last 20 flags of the provider, newest first,
  each with kind, figure, `raised_at`, and when handled `outcome`, `note`, `handled_by_name`, `handled_at`. All seven
  rates show with their counts ("4 of 5"), plus jobs done and the median response time.

- **AC-14, document expiry reminder**: `queue_document_reminders() returns integer` (`security definer`, `set
  search_path = ''`, every grant revoked; `pg_cron` job `providers-document-reminders`, `'0 6 * * *'`, run as
  `postgres`, X-16) inserts, for each provider whose standing is `approved` and each of
  their `provider_documents` of a type in `provider_required_types(region)` with `status = 'approved'` and `valid_until`
  between `current_date` and `current_date + document_reminder_days` (02 compares with `current_date` too), when no
  `provider.document_expiring` row names that document's `object_id`, one `audit_log` row: action
  `provider.document_expiring`, actor null, entity_type `provider`, entity_id the provider, region the provider's,
  `new_value` `{ "document_type", "valid_until", "object_id" }`. A replaced document has a new `object_id`, so it gets
  its own reminder later. The action joins both triggers' lists (`audit_log_email`, `audit_log_notice`); `audit_notices`
  gains a branch returning the provider as recipient, kind `document_expiring`, request null, **entity the
  `provider_documents.id`** found by the row's `object_id` (no branch output when that row no longer holds that object,
  so a document replaced before the trigger runs sends nothing), `send_until` = `(valid_until + 1)::timestamp at time
  zone regions.timezone` (the end of that local day), deadline the same instant, topic null (an account matter, as
  `account_*`) (X-10). The template `document_expiring` joins `queue_email`'s list, `email_context`'s `case` and
  `lib/email/values.ts`: at send time `email_context` reads the `provider_documents` row by the entity id, ends the
  mail as skipped unless it is still `approved` with `valid_until <= current_date + document_reminder_days` (a fresh
  replacement since means no mail), and returns the document type (rendered from 02's document type strings) and
  `valid_until` worded in the region's time zone. The kind joins `notifications.kind`'s check, `NOTICE_KINDS`,
  `NoticeKinds` strings and `noticeHref` (`/provider/profile/documents`); the notice, ids only (18), reads its date
  from `deadline_at` and names no type. Nothing sends while `emails_enabled` or `notifications_enabled` is off. Mail
  text: "Your <document> expires on <date>. Upload a new one before then to keep applying."; notice text: "A required
  document expires on <date>. Upload a new one to keep applying." (both `[draft]`).

- **AC-15, it gates nothing by itself (D4 holds)**: no flag, figure or probation reading changes a request, an
  application, a fee, the ledger or a provider's state; only admin's AC-9 and AC-5 actions act, each audited. 17's meta
  test (pgTAP 35) is updated to the nine readers: its eight plus `raise_quality_flags`, which reads
  `provider_rating_summary` to raise `low_rating`. `provider_quality`, `provider_card_quality` and the admin readers
  never read a rating. No public quality claim, no "vetted" wording, no acceptance rate leaves admin (B7).

- **AC-16, performance**: before review, a local seed of 200 approved providers with 50 closed jobs each, 10 offers on
  one request: `EXPLAIN (ANALYZE, BUFFERS)` of `request_offers` stays under 50 ms and of `raise_quality_flags` under
  5 s, with the plans pasted into the PR (R23 item 5). New indexes: `applications (provider_id, unlocked_at) where
  unlocked_at is not null`; `audit_log ((new_value ->> 'application_id')) where action in ('request.fee_expired',
  'request.provider_withdrew')`; `audit_log (entity_id, created_at) where action in ('provider.approved',
  'provider.rejected')`; `audit_log (entity_id, (new_value ->> 'object_id')) where action =
  'provider.document_expiring'`; `audit_log (entity_id) where action = 'request.admin_cancelled'`.

- **AC-17, three locales, phone first**: every new string in `ar`, `tr`, `en` (`Quality.*`, plus the new keys under the
  existing offer card, profile, banner, apply and email catalogues), customer and provider copy marked `[draft]` (Turkish
  `[draft] [tr]`) until S16; numbers and percentages through the locale's number format; the Quality page, the cards and
  the dialogs at 390px first, logical properties only (`lint:rtl`), axe clean in all three locales.

- **AC-18, tests**: pgTAP `38_trust_quality.test.sql` (every AC above, each refusal, each role: a customer and a
  provider calling any admin function get `forbidden`; `anon` has no execute grant; the two tables refuse every API
  role) and `39_quality_races.test.sql` (dblink: two providers racing for the last non reserved slot, one gets
  `request_full`; an admin handling a flag while the job runs never duplicates or loses a flag; two admins ending one
  probation, one gets `already_waived`); unit tests for the door schemas, the figure wording and `MyQualityCard`; e2e
  `trust-quality` at 390px in three locales (the offer card line, the profile card, a provider on probation taking slot
  9 while an established one sees the request full, the watchlist warn flow showing the banner, the funnel tab).
  Existing tests updated in the same change (X-12): `10_pricing_engine` (the authenticated callable allowlist gains
  `my_provider_quality()` and the six admin functions), `14_provider_feed_apply` (the exact keys and cap of
  `provider_request`, `provider_feed`, `provider_home_counts`), `16_choose_provider` (the exact keys of `offer_card`
  gain `quality`), `29_transactional_email` (the template list and `email_context`), `35_ratings` (nine readers),
  `37_notices` (the two trigger lists stay equal, the kind check, the map branch).

## Decision

**Chosen option**: compute every figure when read, keep 02's provider states and read the funnel and probation from
them, store only what admin acts on (flags and waivers), and let nothing act on a provider without admin.

19a adds two tables (`quality_flags`, `probation_waivers`), twelve settings, readers computed from the rows, an hourly
flag job and a daily reminder job, and replaces in place `offer_card`, `apply_to_request`, `provider_feed`,
`provider_request`, `provider_home_counts`, `audit_notices`, `queue_email`, `email_context`, `pricing_settings_guard`,
the two audit triggers and two check constraints.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`,
`.claude/skills/supabase-postgres-best-practices/`) · `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`)

## Rationale

*Context.* Customers cannot chat before choosing (overview §26), so every signal on the offer card carries the
decision, and a wrong or flattering figure is worse than none. The platform already records every fact the brief's
metrics need (picks, reveals, starts, closes, cancels with their attribution, reports, decisions), so the work is
reading them honestly, not collecting more. Two blockers shape the edges: B7 forbids a public quality claim until
its wording is decided, and B8 and Q9 hold the reputation migration, so on launch day every provider has zero platform
jobs. D4 (a rating gates nothing) is enforced by 17's meta test.

*Computed when read (owner's pick).* A projection table (feature notes §33) goes stale and needs its own guard against
a manual write; computing from the rows, as 17 does for the score (D205), means a figure can never disagree with the
jobs. Apply needs a live jobs count for probation and slots anyway, so a nightly table would not remove the live
reads. Runner up: a nightly `provider_metrics` table, kept as the fallback if AC-16's plan check fails.

*02's states kept (owner's pick).* The §30 state machine would rewrite `provider_can_apply`, the queue, three mails
and many pgTAP files for stages (background check, assessment) the business does not run as separate steps today:
the criminal record document is the background check where the region requires it. Probation as a reading (fewer
than 5 completed jobs, no waiver) needs no job to move anyone and cannot drift. Runner up: recorded admin checks
before approval.

*Watchlist, admin acts (owner's pick).* Rates over a handful of jobs are noisy, and a suspension ends live picks (12),
so an automatic sanction would punish customers for a false positive and turn ratings into a gate, against D4. A flag
with the figure that crossed it, handled by a person with a recorded note, keeps the brief's floor (§31) and D4 both.
The hourly job writes only flags, so no trigger is added to a job or money path. Runner up: an automatic warning.

*Reserved slots (owner's pick).* The 10 applicant slots are the scarce resource: established providers who watch the
feed fill them first. Keeping the last 2 for providers on probation gives new supply a real chance without reordering
what the customer sees (arrival order stays neutral) and without any customer facing label. Runner up: new providers'
offers sorted first, which changes a neutral order into a ranking.

*Recommended calls made while writing.* (1) The live job limit is checked at apply only, never at choose or pay, so no
money path changes; the cost is a rare overshoot, accepted (AC-6). Runner up: refuse the choose. (2) Probation, slots
and the card fail open on a broken quality setting, unlike 17's fail closed readers, because they are fairness rules:
failing closed would stop every provider applying. Runner up: fail closed. (3) `admin_end_probation` exists because
on launch day every provider is on probation, including the trusted ones B8 would have migrated; §35 lets admin move
providers through the funnel, and a waiver is final and audited. Runner up: no waiver, accept the limit for everyone.
(4) Completion excludes cancels not caused by the provider, and reports exclude `no_action` outcomes, so a customer's
change of plans or an unfounded report never lowers a provider's figure. Runner up: the brief's raw ratios. (5) The
response time is a median, so one stale application does not dominate. Runner up: the mean. (6) A cooldown after a
rate flag is handled, so a cleared flag does not come back the next hour while the numbers are unchanged. Runner up:
raise again only after the figure falls back under the line and crosses again (needs stored history).

## Feature design

**Data model sketch**:

| Table | Column | Type | Null | Notes |
| --- | --- | --- | --- | --- |
| `quality_flags` | `id` | uuid | no | pk, `gen_random_uuid()` |
| | `region` | text | no | fk `regions(code)` on delete restrict |
| | `provider_id` | uuid | no | fk `(provider_id, region)` to `providers(id, region)` on delete restrict |
| | `kind` | text | no | check in `low_rating`, `high_reports`, `high_cancellations`, `low_follow_through`, `probation_report`, `probation_cancel` |
| | `source_id` | uuid | yes | report id or request id for probation kinds; null for rate kinds (check, both ways) |
| | `figure` | jsonb | no | object, `octet_length <= 1024` |
| | `raised_at` | timestamptz | no | default `now()` |
| | `handled_at` | timestamptz | yes | |
| | `handled_by` | uuid | yes | fk `profiles(id)` on delete restrict |
| | `outcome` | text | yes | check in `warned`, `suspended`, `cleared` |
| | `note` | text | yes | 10 to 500 characters |
| `probation_waivers` | `provider_id` | uuid | no | pk; fk `(provider_id, region)` to `providers(id, region)` |
| | `region` | text | no | fk `regions(code)` |
| | `waived_by` | uuid | no | fk `profiles(id)` on delete restrict |
| | `note` | text | no | 10 to 500 characters after trim |
| | `created_at` | timestamptz | no | default `now()` |

Constraints and indexes: `quality_flags_handled_together` (all four handled columns null, or all set, with
`handled_at >= raised_at`); unique open rate flag `(provider_id, kind) where handled_at is null and source_id is null`;
unique probation source `(kind, source_id) where source_id is not null`; queue `(raised_at, id) where handled_at is
null`; `(provider_id, raised_at desc)`; `(region)`; `(handled_by)`. `probation_waivers (region)`, `(waived_by)`. Both
tables: RLS on, a deny policy (`using (false)`), every table privilege revoked from `anon`, `authenticated` and
`service_role`; reads and writes only through the definer functions. `quality_flags_guard` (before update, delete,
truncate): an update may only move an open flag to handled, setting exactly the four handled columns; delete and
truncate refuse, for every role. `probation_waivers` is append only (`rating_append_only`'s pattern, 07). Settings:
twelve `platform_settings` rows per region (AC-1). Changed: `user_warnings_reason_valid` (five reasons added),
`notifications.kind`'s check (`document_expiring` added). Indexes of AC-16.

**State transitions**: no stored provider state is added. Readings, in order: `provider_standing` (02) →
`approved` splits into **probation** (jobs done below `probation_jobs`, no waiver) and **active**. Probation ends by
itself on the Nth `COMPLETED` job, or by `admin_end_probation` (final). A flag: **open** → **handled** (`warned`,
`suspended` or `cleared`), once; handled is final.

**API surface** (Postgres functions; the app calls them only through the doors):

| Function | Kind | Key inputs | Key outputs | Auth | Key errors |
| --- | --- | --- | --- | --- | --- |
| `quality_settings(p_region)` | internal | region | the twelve values | none (no grant) | `quality_settings_invalid` |
| `provider_quality(p_provider_id)` | internal | provider | AC-2 shape | none | |
| `provider_card_quality(p_provider_id)` | internal | provider | AC-3 shape or null | none | |
| `provider_jobs_done`, `provider_on_probation`, `provider_live_jobs`, `provider_apply_cap` | internal | provider (, region) | integer, boolean, integer, integer | none | |
| `document_reminder_days(p_region)` | internal | region | integer | none | `document_reminder_settings_invalid` |
| `raise_quality_flags()` | cron, hourly, definer | none | flags raised | none (`pg_cron` as `postgres`) | region skipped with a warning |
| `queue_document_reminders()` | cron, daily, definer | none | rows written | none (`pg_cron` as `postgres`) | region skipped with a warning |
| `my_provider_quality()` | definer, stable | none (caller from `auth.uid()`) | AC-4 shape | provider | `forbidden` |
| `admin_quality_flags(p_page)` | definer, stable | page | `{ rows, total }` | admin | `forbidden`, `validation_failed` |
| `admin_handle_quality_flag(p_flag_id, p_outcome, p_note)` | definer | flag, outcome, note | `{ status, outcome }` | admin | `forbidden`, `not_found`, `already_handled`, `validation_failed`, `reason_required`, `not_approved` |
| `admin_probation(p_page)` | definer, stable | page | `{ rows, total }` | admin | `forbidden`, `validation_failed` |
| `admin_end_probation(p_provider_id, p_note)` | definer | provider, note | `{ status }` | admin | `forbidden`, `reason_required`, `not_on_probation`, `already_waived` |
| `admin_quality_funnel()` | definer, stable | none | per region stages and months | admin | `forbidden` |
| `admin_provider_quality(p_provider_id)` | definer, stable | provider | AC-13 shape | admin | `forbidden`, `not_found` |
| `apply_to_request(p_request_id, p_message)` | replaced | as 05 | as 05 | provider | adds `probation_limit`; `request_full` now per caller cap |
| `offer_card`, `provider_feed`, `provider_request`, `provider_home_counts` | replaced | as before | adds `quality`; cap per caller | as before | as before |

Doors: **`lib/admin-quality/`** (new, server only, admin): `loadQualityFlags`, `handleQualityFlag`, `loadProbation`,
`endProbation`, `loadFunnel`, `loadProviderQuality`, strict Zod schemas on every reply; actions in
`actions/admin-quality.ts` through `guardedAction(['admin'])`, each returning a stable code. **`lib/provider-feed/`**
gains `loadMyQuality`. **`lib/requests/`** `loadOffers` schema gains `quality`. The `probation_limit` code joins the
apply action's codes and the catalogue. `AGENTS.md`'s door table gets `lib/admin-quality/` (by `/sync`).

**Value sourcing**:

| Action | Value produced / displayed | Source |
| --- | --- | --- |
| Offer card | jobs done, completion, on time | `provider_card_quality` from `requests`, `applications` (AC-2, AC-3) |
| Offer card | window and grace in the disclosure | the card shape's `window_days`, `grace_minutes` (settings) |
| Offer card | "rated or not" for where the disclosure sits | 17's `rating.state` already on the card |
| Profile card | probation progress and limit | `provider_jobs_done`, `probation_jobs`, `provider_live_jobs`, `probation_live_jobs` |
| Apply | caller's cap | `provider_apply_cap` (`max_applicants_per_request`, `probation_reserved_slots`, `provider_on_probation`) |
| Apply refusal | the two numbers in the message | `my_provider_quality().probation` read by the page |
| Hourly job | each threshold | `quality_settings(region)` |
| Hourly job | overall score | `provider_rating_summary` (17) |
| Hourly job | the probation start | `providers.approved_at` |
| Watchlist row | provider name, standing, region time zone | `providers.approved_name`, `provider_standing`, `regions.timezone` |
| Watchlist row | the figure in words | `quality_flags.figure` (stored at raise time) |
| Handle flag | warning reason | mapped from `quality_flags.kind` (AC-9) |
| Handle flag | suspension reason code | `'quality:' || kind` |
| Funnel | months in local time | `regions.timezone` |
| Funnel | first decision | earliest `audit_log` row `provider.approved` or `provider.rejected` per provider |
| Admin provider page | handler and waiver names | `profiles.full_name` of `handled_by`, `waived_by` |
| Reminder mail | document type, date | `provider_documents` row by the mail's entity id, read at send time; `regions.timezone` |
| Reminder notice | date | `notifications.deadline_at` (the end of `valid_until`, local) |
| Reminder | who and when to send | `audit_notices` branch (AC-14); `emails_enabled`, `notifications_enabled` |

**Key invariants**:
- No figure is stored except a flag's snapshot of what crossed; every displayed figure equals what the rows say now.
- Rates compare as exact integers (`100 * num` against `pct * den`); `pct` is rounded once, for display only.
- No customer ever reads a report rate, cancellation rate, follow through, probation state, flag or acceptance rate.
- Nothing changes a provider, a request, an application or money except admin's audited `admin_handle_quality_flag`
  and `admin_end_probation`; the jobs write only `quality_flags` and `audit_log`.
- A rate flag is open at most once per provider and kind; a probation flag is raised at most once per source.
- A handled flag and a waiver never change again.
- Exactly nine functions read ratings (17's meta test).

**Security model**: personal data under KVKK: figures about a named provider, warnings, suspensions, notes. Admin reads
every region (16, R-1), each admin function checks `is_admin()` again inside; a provider reads only their own three
figures and probation through `my_provider_quality` (identity from the token); a customer reads only AC-3's three
figures through `request_offers` (06's authorization, unchanged). The two tables have no API access at all. Notes
live only in `quality_flags.note`, `probation_waivers.note` and `audit_log`, never in a provider facing reply; a
suspension stores a fixed code. Audit rows for every admin action (rule set of §35). No new public endpoint, no new
secret.

**Configuration required**: none (no environment variable, no credential). Two `pg_cron` jobs, created in the
migration.

**Critical test scenarios**:
- Happy path: a provider with 6 completed jobs, one started 10 minutes late, shows "6 jobs · 100% completed · 100% on
  time" on the offer card in three locales, verifies **AC-2**, **AC-3**.
- Failure case: a provider cancels after the reveal during probation; the next job run raises one `probation_cancel`,
  a second run raises nothing; admin warns and the provider sees the banner; the flag cannot be handled twice,
  verifies **AC-8**, **AC-9**.
- Failure case: 8 approved applications are `APPLIED`; an established provider gets `request_full`, a provider on
  probation applies; a provider on probation with 2 live jobs gets `probation_limit`, verifies **AC-6**, **AC-7**.
- Auth: a customer or provider calling `admin_quality_flags` gets `forbidden`; no API role can select
  `quality_flags`, verifies **AC-10**, **AC-18**.

## Build plan

Tracer Bullet: the thinnest thread first (one metric from the rows to the card), then thicken.

1. Migration `20261202090000_trust_quality.sql`, slice 1: the twelve settings with checks and the guard,
   `quality_settings`, `provider_quality`, `provider_card_quality`, the indexes, `offer_card` replaced; pgTAP for the
   figures first (tests first: money adjacent readers). satisfies **AC-1**, **AC-2**, **AC-3**, **AC-16**
2. `lib/requests` schema and `OfferCard` line and disclosure in three locales; the seeded `EXPLAIN` check. satisfies
   **AC-3**, **AC-16**, **AC-17**
3. Same migration, slice 2: `probation_waivers`, `provider_on_probation`, `provider_live_jobs`, `provider_apply_cap`,
   `apply_to_request`, `provider_feed`, `provider_request`, `provider_home_counts` replaced, `my_provider_quality`,
   `admin_end_probation`; pgTAP and the race file. satisfies **AC-5**, **AC-6**, **AC-7**, **AC-18**
4. `lib/provider-feed` `loadMyQuality`, `MyQualityCard`, the `probation_limit` refusal on the apply page. satisfies
   **AC-4**, **AC-6**, **AC-17**
5. Same migration, slice 3: `quality_flags` with its guard, `raise_quality_flags` and its cron job,
   `admin_handle_quality_flag`, the `user_warnings` reasons, 17's meta test to nine; pgTAP. satisfies **AC-8**,
   **AC-9**, **AC-15**
6. `lib/admin-quality` door and actions, `/admin/quality` with the Watchlist tab and dialogs, the admin rail entry,
   `WarningBanner` and `AccountStateBanner` codes. satisfies **AC-9**, **AC-10**, **AC-17**
7. `admin_probation`, `admin_quality_funnel`, `admin_provider_quality`; the Probation and Funnel tabs and the provider
   page section. satisfies **AC-11**, **AC-12**, **AC-13**
8. Same migration, slice 4: `queue_document_reminders` and its cron job, `audit_notices`, `queue_email`,
   `email_context`, both triggers, the kind check; the template, `NoticeKinds`, `noticeHref`; pgTAP 29 and 37's lists
   updated. satisfies **AC-14**
9. e2e `trust-quality`, unit tests, `npm run verify`, `db:test`, e2e batches (D204), `/check verify`. satisfies
   **AC-17**, **AC-18**
10. Reviews: `slice-reviewer`, `security-reviewer` (personal data, apply path), `/check review` on another model;
    fixes; the owner pushes the migration after a dry run; merge on the owner's word. satisfies every AC

## Consequences

**Positive**:
- Customers get three honest figures counted from real jobs, and nobody can make them disagree with the jobs.
- New providers get two slots that fast established providers cannot fill.
- Admin sees who crossed a line and why, acts with a recorded note, and has a real acceptance rate ready for B7.
- Providers are reminded before an expired document blocks them.

**Negative / tradeoffs**:
- On launch day every provider is on probation (zero platform jobs, B8 not migrated): the 2 live job limit applies to
  everyone and reserved slots change nothing until some providers pass 5 jobs. Admin's waiver is the release valve,
  one provider at a time.
- Each offer card runs three more counts per provider; AC-16 bounds it, and the projection table is the fallback.
- The live job limit can be exceeded when several older applications are chosen at once (accepted, AC-6).
- Probation flags raise within the hour, not at once; a flag after a cooldown can repeat for a provider whose numbers
  stay bad, which is the point but adds admin work.
- A rate with a small window count stays hidden; a provider with few jobs shows only "N jobs".
- Twelve more settings to keep valid.

**Neutral**:
- `apply_to_request` and three feed functions are replaced again; their bodies are copied from
  `20261118090000_choose_provider.sql` with only the named change.
- 17's meta test moves from eight to nine readers.
- No analytics event is added (no id may travel, and the admin actions are in `audit_log`).

## Follow-up

- [ ] 19b (structured application answers) after this merge, in a fresh session: [0011-19b](0011-19b-application-answers.md).
- [ ] B7: when the claim wording is decided, any public figure derives from AC-12's rate; nothing in 19a shows it publicly.
- [ ] B8, Q9: the reputation migration replaces most waivers; legacy counts stay separate from `jobs_done` (overview §27).
- [ ] S16: the card disclosure, profile card and reminder copy leave `[draft]`; the KVKK register notes the flag notes
  and figures (admin only).
- [ ] If AC-16's plan check fails, a nightly projection for the card figures only, through `/architect`.
- [ ] `/sync`: `lib/admin-quality/` in the `AGENTS.md` door table; `ui-registry.md` rows for `MyQualityCard`, the
  Quality page tabs and the flag dialog.

## Cross check (Sonnet, 2026-11-22)

One read only pass over 19a and 19b on Sonnet: 22 findings (1 Critical, 13 Major, 8 Minor; 29 of 34 claims about
what exists held). Every fix taken as recommended (owner's standing rule, D213); those for 19a, written into the text
above with their tags: X-9 (follow through and fee expiry counted by `counts_against`; provider caused cancels by
`cancelled_by` and attribution), X-10 (the reminder's entity is the document row, read at send time; the notice names
no type), X-11 (`provider_jobs_done` on its own), X-12 (the existing tests named: 10, 14, 16, 29, 35, 37), X-13
(`WarningReason` across `lib/reports`, `WarningBanner`, `lib/admin-reports`), X-14 (suspend needs `status =
'approved'`, so `document_expired` too), X-15 (`apply_settings_invalid` folded in; reminders read their own key),
X-16 (both cron functions definer with a pinned path, no `auth.uid()`), X-17 (rating compared in tenths), X-18 (the
cancellation rate never passes 100%), X-19 (months or days in the disclosure), X-20 (settings once per region), X-21
(`already_waived` before `not_on_probation`), X-22 (the refusal's figures read a moment later, accepted). X-1 to X-8
are 19b's.
