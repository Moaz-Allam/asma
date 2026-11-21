# Review, feat/17-ratings, 2026-11-22

**Reviewed by**: Sonnet 5.5 (author on a different model)
**Scope**: 49 files, branch vs master (merge base d4c933f)
**Verdict**: Approve with nits

## Summary

Position 17 adds optional ratings: two append only tables behind deny policies, definer functions for the customer, provider and admin, a score computed from the rows on every read, an `offer_card` that carries it, two mail templates, and the UI in three locales. I found no blocker or major. The access rules, the lock order (request row first), the append only triggers, the numeric formula with one rounding step, and the replaced mail functions all match the spec. I diffed the replaced `email_context`, `queue_audit_email` and `queue_email` against their 0012 bodies: the only changes are the named additions. The findings below are small.

## Minor

### 🟡 Provider card text hardcodes "5 ratings", `messages/*.json` (Ratings.mine.new), `supabase/migrations/20261130090000_ratings.sql:152`
**Problem**: `rating_min_count` may be raised to 50 by an admin, but the provider's "Customers see your average after 5 ratings" line stays at 5 (D206 item 9 already notes it).
**Why it matters**: the provider is told a wrong threshold once an admin changes the setting. Harmless today because the seed is 5.
**Suggested fix**: when it next matters, return the minimum with the `new` summary and pass it to the string. Keep it on the follow up list.

### 🟡 One unexpected error takes down the whole admin provider page, `app/[locale]/(admin)/admin/providers/[id]/page.tsx:46`
**Problem**: `loadProviderRatings` throws on any unmapped error (and on a schema parse failure), and the page awaits it with no catch. The customer request page, by contrast, catches `loadRating` and hides the section.
**Why it matters**: a ratings problem would block admin's provider review, which is a launch critical page.
**Suggested fix**: catch, report through `reportServerError`, and render the page without the section, the way the request page does.

### 🟡 Offer list cost grows with offers times region ratings, `supabase/migrations/20261130090000_ratings.sql:530`
**Problem**: `offer_card` calls `provider_rating_summary` per card, and each call rescans the region's visible ratings for the mean M, with a `not exists` against `rating_hides`.
**Why it matters**: decision 1 accepted this for launch volume and names the switch point, so it is not a defect. It is the first thing to measure once ratings pile up.
**Suggested fix**: nothing now; when an offer page read is slow, compute M once per `request_offers` call.

## Nits

- ⚪ `supabase/tests/35_ratings.test.sql:398`, the meta test matches six functions while spec AC-3 says seven (D206 item 1 explains why). The spec text still needs the fix at the next `/architect` pass.
- ⚪ `lib/admin-ratings/index.ts:56`, `Math.floor(page)` on a non finite number gives NaN; the page route already restricts it, so only a direct caller could hit it.
- ⚪ `admin_provider_ratings` shows each rating with its request id to admin without an audit row. The spec does not ask for one and admin already sees every request; mention it only if S16 asks for access logging on customer to score links.

## Strengths

- Append only is enforced three ways (revoked grants, deny policy, trigger for update, delete and truncate), and `rate_provider` takes region, provider, application and customer from the request, never the caller.
- Refusal order is deliberate: someone else's request is `not_found` and never locked, so no existence or state leak and no lock contention.
- The summary catches its own `rating_settings_invalid` and returns `unavailable`, so the plain SQL `offer_card` cannot fail on a bad setting, and the doors raise the alert.
- The `rate_provider` invite is skipped at send time once a rating exists or the window closes, and is queued only for auto and admin closes. The mail carries no score.
- A real two session race test (`36_rating_races`) covers both double rate and double hide.
- Native radios and a native `details` make the stars and the disclosure work before hydration, with logical properties and a label per star.

## Test coverage

Good. pgTAP covers every role on every function (anon, customer, other customer, provider, admin), the append only refusals per role, the formula (new at 4, rated at 5, shrinkage below 5.0, half life, hide lowering the count), the D4 meta test, the unchanged tables before and after, and the mail cases including skip on rated or past window. Vitest covers the doors and schemas (`tests/ratings.test.ts`), the templates and the analytics event. The e2e spec runs in three locales with axe at 390px. I found no new untested branching logic. The one gap is the admin page failure path in the first Minor finding, which has no test because it has no handling.
