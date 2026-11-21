# Slice review: 17, ratings (spec 0011-17)

**Date:** 2026-11-22 · **Branch:** `feat/17-ratings` (base `origin/master`, five commits, 49 files) · **Reviewer:** `slice-reviewer` agent, read only (saved here by the main session) ·
**Recommendation:** fix then merge. How each finding was handled is in D207 (`context/progress-tracker.md`).

The reviewer did not run `npm run verify`, `npm run db:test` or the e2e; the gate results are as reported to it.

## Critical

None found. Ratings hold no contact data. Each read goes through a definer function with a pgTAP test for the wrong
caller. The two tables are closed to `anon`, `authenticated` and `service_role`, append only for every role, and touch no
money.

## Major

- `supabase/migrations/20261130090000_ratings.sql:965-979`. Problem: when a job closes by itself or by admin
  (`close_job`), the mail trigger now reads `rating_settings` in the same transaction. The `exception when
  raise_exception` block is the only thing stopping a broken rating setting from blocking that close, which is exactly
  the kind of gating D4 forbids. No test covers it: every `close_job` call in `supabase/tests/35_ratings.test.sql:589-592`
  runs with valid settings, so deleting that block would fail nothing. The `rate_provider` branch of `email_context`
  (:767-775) has the same gap. Fix: add a `pg_temp.probe` to 35. Turn off the guard trigger, delete
  `rating_window_days`, then run `close_job(..., 'auto', 'job.auto_closed')` and `close_job(..., 'admin',
  'job.closed_by_admin')`. Assert the request is `COMPLETED`, `job_completed>a1` is queued, and no `rate_provider` row
  exists. Then assert `email_context` on an already queued invite returns `skip`/`condition` rather than raising.

## Minor

- `supabase/tests/35_ratings.test.sql:392-399`. Problem: the AC-3 meta test only catches the words `ratings` and
  `rating_hides`. Anything that reads through `provider_rating_summary` passes unseen: `offer_card` today, and 19's
  planned quality floor later. Fix: match `\m(ratings|rating_hides|provider_rating_summary)\M` and pin the set, adding
  `admin_provider_ratings`, `my_provider_rating` and `offer_card`.
- `docs/specs/0011-choose-to-launch/0011-17-ratings.md:70`. Problem: the spec was not updated for D206. AC-3 still names
  seven functions (six were built). Line 127 names `lib/email/values.ts`, but the strict schema is `EmailValuesSchema`
  in `lib/email/types.ts`. Also missing: the refusal order, the page cap of 10000 with `not_found`, and the
  `provider_name` value. Fix: `/architect` writes D206 into the spec.
- `context/architecture.md:1214-1261`. Problem: lines 146, 169, 700, 1189 and 1255 still describe a stored
  `providers.rating_avg`, refreshed on insert and nightly, and say admin sets hide fields on `ratings`. That contradicts
  D205 and what was built. Fix: add a v section for 17.
- `AGENTS.md` (Single doors table). Problem: `lib/admin-ratings/` has no row; the `lib/requests` row lacks
  `rateProvider` and `loadRating`; the `lib/provider-feed` row lacks `loadMyRating`. Fix: add them at the merge.
- `components/features/ratings/RatingForm.tsx:66`. Problem: `router.refresh()` runs after every refusal. On
  `deadline_passed`, `invalid_state` or `rating_settings_invalid`, the refreshed page has `can_rate` false and no rating,
  so the page drops the whole section and the error alert unmounts. Fix: refresh only on success and on
  `already_rated`.
- `app/[locale]/(admin)/admin/providers/[id]/page.tsx:47`. Problem: `loadProviderRatings` throws on an unexpected error
  or a strict parse failure, which takes down admin's provider review and suspend page. The same applies to
  `loadMyRating` on the provider profile page. Fix: catch, `reportServerError`, render without the ratings section (D4).
- `messages/en.json:2072`. Problem: "after 5 ratings" and "fewer than 5" (and in `ar` and `tr`) are fixed numbers, but
  `rating_min_count` is a setting from 5 to 50 (D206 item 9). Fix: return the minimum inside the `new` summary.
- `e2e/ratings.spec.ts:345`. Problem: `offerAfter` differs from `offerBefore` only because the count text changes. The
  offer card's score figure is never compared. Fix: pull out the score number and compare it.
- `components/features/ratings/AdminRatingsSection.tsx:78`. Problem: a page past the last one (`?rp=999`) with
  `total > 0` says "No customer has rated this provider yet". Fix: show the empty text only when `total === 0`; otherwise
  link back to page 1.
- `messages/en.json:2086`. Problem: `AdminRatings.date` and `AdminRatings.scores` (same in `ar` and `tr`) are never used.
  Fix: remove them.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC-1 | Met | `rate_provider` locks the request row first, takes region, provider and customer from the request, one audit row with ids only. Every refusal tested in 35; race test in 36 |
| AC-2 | Met | RLS on, a deny policy, all grants revoked, four append only triggers; tests in 35 |
| AC-3 | Partial | No money or state row changes; report window, history row and posting again still work (35, e2e). The meta test lists six functions, not seven (D206, spec not amended), and misses readers through `provider_rating_summary` |
| AC-4 | Met | `numeric` throughout, rounded once, `unavailable` caught inside the summary, nothing stored; tests in 35 |
| AC-5 | Met | `offer_card` replaced in place; `OfferList` and the chosen block show `RatingSummary`; tests in 35 and e2e |
| AC-6 | Met | `request_rating`, `RatingForm`, the request page; tests in 35 and e2e. Error display gap under Minor |
| AC-7 | Met | `my_provider_rating`, `loadMyRating`, `MyRatingCard`; tests in 35 and e2e |
| AC-8 | Met | `admin_provider_ratings`, `admin_hide_rating`, `lib/admin-ratings/`, `AdminRatingsSection`, `HideRatingDialog`; tests in 35, 36 and e2e |
| AC-9 | Met | `queue_email`, `email_context`, `queue_audit_email` and the trigger, each diffed against the 0012 bodies: only additions. Templates and values; tests in 35 and `tests/email-templates.test.ts` |
| AC-10 | Met | Checks, seeds, the guard (14's list plus four) and the reader; tests in 35; alerts in the doors |
| AC-11 | Met | `events.ts`, the filter, `RatingForm`, e2e, `tests/analytics.test.ts` |
| AC-12 | Met | No public surface added; `lib/seo/json-ld.ts` with `tests/seo.test.ts` |
| AC-13 | Met | Strings in three locales, `tr` marked `[tr]`; axe at 390px on every changed screen; wrong caller tests; the seeding helper in 35 and the e2e |

## Verification gaps

- The reviewer did not run the local gate; run it on this head (D204).
- The migration is not in the cloud yet. Confirm with `supabase migration list` that 20261129090000 is applied in the
  cloud, then dry run before pushing.
- No `/check verify` at 360, 430 or 1280px; the right to left layout of the bars, stars and pager in `ar` has not been
  looked at by eye.
- Neither new mail has been sent for real (mail is off until S43); capture the `fake` driver's output in three locales.
- Offer page cost: run `EXPLAIN ANALYZE` on `request_offers` with seeded volume before 19 adds more readers.

## High risk paths touched

- `supabase/migrations/20261130090000_ratings.sql`: two new tables, plus replacements of 13's and 0012's mail functions
  and trigger, 14's settings guard and 06's `offer_card`.
- Idempotency key derivation: not changed. Both new mails reuse `queue_audit_mail`'s `email:<audit_id>:<recipient>:<template>`.
- Not touched: `lib/money`, `lib/psp`, `lib/pricing`, `supabase/functions`, `.claude`.

## Recommendation

**fix then merge**
