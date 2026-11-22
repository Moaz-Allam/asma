# /check review: feat/19a-trust-quality (commit ecae71c)

Reviewer: Sonnet 5.5 (author on a different model). Read only. Spec `docs/specs/0011-choose-to-launch/0011-19a-trust-quality.md`. Known deviations in D214 (1 to 8) were not re-raised.

## What was checked

- Every AC against the migration `20261202090000_trust_quality.sql`, the doors, the pages and the tests (pgTAP 38 with 156 assertions and 39 with 10, `tests/trust-quality.test.ts`, `e2e/trust-quality.spec.ts`). Each AC has an implementation and a test. AC-16 is covered by D214 (8).
- The replaced bodies of `apply_to_request`, `provider_feed`, `provider_request` and `provider_home_counts` were diffed against 06's. The only changes are the cap through `provider_apply_cap` and step 9b. 13's apply email gate is a trigger on `applications`, so it is untouched.
- The `jsonb_build_object` shapes of `provider_card_quality`, `provider_quality_with`, `my_provider_quality`, `admin_*`, and the stored `figure` against `lib/quality/summary.ts`, `lib/admin-quality/schemas.ts` and `lib/requests/schemas.ts`. They match, key for key. The strict parse is safe, including `pct` (integer from `round` on numeric) and the rating figure (`overall` and `threshold` with one decimal).
- Refusal codes. Every `raise exception` code maps in `ADMIN_QUALITY_DB_CODES` and in `Quality.admin.errors.*`, and `probation_limit` maps in `PROVIDER_FEED_DB_CODES` and `ProviderFeed.errors.probation_limit`, in three locales.
- Catalogues: 126 new keys, identical sets in `ar`, `tr` and `en`, no existing string changed. `[draft]` is on customer and provider copy and `[draft] [tr]` on Turkish, per D214 (3). The admin copy has only `[tr]`, which is right.
- `npm run lint:rtl` passes. The three unit test files that touch this work (232 tests) pass.
- Every new component has a `ui-registry` row (`QualityLine`, `MyQualityCard`, `QualityAction`, `AdminQualitySection`).
- Customer surfaces: `offer_card.quality` carries only `jobs_done`, `completion`, `on_time`, `window_days` and `grace_minutes`. The report rate, cancellation rate, follow through, flags and probation never reach `request_offers`, and the strict `CardQuality` schema would reject them. No rating is read by any new reader except `raise_quality_flags`, as AC-15 says.

## Findings

| id | severity | file:line | problem | recommended fix |
| --- | --- | --- | --- | --- |
| F1 | Major | `supabase/migrations/20261202090000_trust_quality.sql:1617-1624` with `lib/notifications/centre.ts:108-112` | The notice's `deadline_at` is `(valid_until + 1)` at local midnight, which is what AC-14 specifies. `renderNotices` formats it with `instantLabel` (weekday, day, month, **hour:minute**, in the region's zone). The notice therefore reads "A required document expires on Saturday, 29 November 00:00", the day after the real last valid day, with a meaningless time. The mail uses `valid_until` through `dayParts`, so the notice and the mail disagree by a day. | Keep `deadline_at` for the send window. For `document_expiring`, render the date as `deadline_at` minus 1 minute in the region's zone with a date-only label, or stop using `lineDeadline` for this kind and carry the day another way. Add a unit test over `renderNotices` with a `deadline_at` at local midnight. Raise it with `/architect`, because the spec text produces this. |
| F2 | Minor | `lib/i18n/client-messages.ts:47` | The whole `Quality` namespace is sent to the client on every page, including every `Quality.admin.*` string (the report-rate, cancellation and follow-through wording, the watchlist kinds and the funnel note). No figure leaks, but the admin-only vocabulary ships in the customer and provider bundles, and `Quality.admin` is about 100 strings of dead weight there. | Register only what client components read: `Quality.card`, `Quality.mine`, and the `Quality.admin` parts `QualityAction` uses (`actions`, `errors`, `note`). Moving those into a small `QualityDialog` namespace, or loading `Quality.admin` only in the admin layout, would do. |
| F3 | Minor | `app/[locale]/(admin)/admin/quality/page.tsx:112-116` | A `?page=` past the last page returns no rows but a positive `total`. The page then shows "No open flags" with no pager, which is wrong. The same applies to the probation tab. | When `rows` is empty and `total > 0`, redirect to the last page, or render the pager and a "page out of range" line. |
| F4 | Minor | `supabase/migrations/20261202090000_trust_quality.sql:582-605` and `:405-460` | `offer_card` calls `provider_card_quality` once per offer. Each call resolves `quality_settings` (13 settings reads plus `apply_settings`, inside a nested exception block, so a subtransaction each). X-20 is honoured for `admin_probation`, `raise_quality_flags` and `admin_quality_funnel`, not here. The D214 (8) numbers (18.5 ms for 10 offers) say this is fine now, so it is only a note. | Leave as is. If offers per request ever grow, pass the settings in once (`provider_card_quality_with`), as was done for the metrics. |
| F5 | Minor | `lib/provider-feed/index.ts` (`loadMyQuality`) | `raiseAlert('quality_settings_invalid')` fires on every profile view and every apply-form refusal while a region's settings are broken. That is alert noise, though the alert layer may dedupe. | Confirm `raiseAlert` dedupes per reason and region. If it does not, alert only from the hourly job and the admin page. |
| F6 | Minor | `supabase/tests/` (not in the diff: `14_provider_feed_apply`, `37_notices`) | The spec's AC-18 lists updates to 14 (exact keys and cap) and 37 (the trigger lists, the kind check, the map branch). Neither file is in the diff. 14 still passes because its fixtures read as probation (cap 10) and its custom caps fall to fail open. The 37 equivalents live in 38 and 29, and 38 asserts the reminder branch. The "established provider's cap is 8" case is covered only in 38 and 39. | Add one line to 14 asserting `provider_request` shows `cap` 8 for an established provider, or note in the PR that 38 covers it and 14 and 37 needed no change. |
| F7 | Nit | `lib/quality/summary.ts:141`, `lib/admin-quality/index.ts:35` | Unused exports: `MetricRate`, `AdminQualityCode` (used only as a type inside its own file), `FunnelStage` (schemas only), `RateFigure`, `RatingFigure` and `SourceFigure` (used only inside `FlagFigure`). | Drop the `export` on those, or keep them if the next position (19b) will use them. |
| F8 | Nit | `messages/*.json` `Quality.admin.openCount` and `Quality.admin.openFlags` | The two keys carry the same plural string. `Quality.admin.section` and `Quality.admin.title` are also the same word. Harmless. | Reuse `openFlags` for the watchlist count and delete `openCount`. |
| F9 | Nit | `lib/quality/summary.ts:117-121` | `windowSpan` returns months for a multiple of 365 (`(days/365)*12`), while the spec says "multiple of 30, and 365 reads 12 months by `round(365/30.0)`". They agree for 365 and 730 and for every multiple of 30. They differ for no value in range (the range is 30 to 1095), so this is only a wording difference from the spec. | None needed. |

## Verdict

**Fix then merge**: F1 is a visible off-by-one date on a provider notice that disagrees with the mail. It is small (render the date from `deadline_at` minus a minute, or change the spec's carrier) and sits in a path the spec mandated, so decide it before the migration reaches the cloud. F2 to F9 can ride along or be carried over. No Critical findings: no money, RLS, grant, idempotency or contact-reveal path is weakened, every new table refuses every API role, and every new function revokes `public`, `anon`, `authenticated` and `service_role` before any deliberate grant.

## Resolutions (author, 2026-11-22, D215)

| id | resolution |
| --- | --- |
| F1 | Fixed without a spec change: the notice still reads its date from `deadline_at` (AC-14), and `renderNotices` names the local day one minute before it (`lastValidDay`), as the mail names `valid_until`. Test in `tests/notifications-render.test.ts` |
| F2 | Carried (R25): the same holds today for `AdminFlags`, `AdminReports` and `AdminRatings`; one change for every admin namespace, not this one alone |
| F3 | Carried (R25): the flags and reports pages behave the same |
| F4 | Accepted (D214 (8) timings) |
| F5 | Carried (R25): check `raiseAlert`'s dedupe before G1 |
| F6 | No change: 14 and 37 pass unchanged (keys did not move); the cap of 8 is proven in 38 and 39 |
| F7 to F9 | Accepted as written |
