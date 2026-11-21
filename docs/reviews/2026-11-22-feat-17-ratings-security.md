# Security review: feat/17-ratings (spec 0011-17)

Reviewer: `security-reviewer` agent (Opus), 2026-11-22, on `711708f` (`git diff origin/master...feat/17-ratings`), read only
(saved here by the main session). Severity labels: MJ = Major, M = Minor, I = Info. `ratings.sql` means
`supabase/migrations/20261130090000_ratings.sql`. How each finding was handled is in D207 (`context/progress-tracker.md`).

## Confirmed vulnerabilities

- **MJ-1 (privacy; the spec's Consequences accept a provider "estimating" a score, but the real precision is much
  higher).** Code path: `my_provider_rating` returns `provider_rating_summary` of the caller, which counts the newest
  rating at once, rounded to one decimal per dimension; `rating_received` is sent at once.
  - Exploit: a provider reads `/provider/profile` before and after each `rating_received` mail and works out the new
    customer's score on each of the four dimensions.
  - Worked example: 5 ratings of 4, C = 5, region mean 4 shows 4.0. The 6th rating then shows 3.7, 3.8, 3.9, 4.0 or
    4.1 for a score of 1, 2, 3, 4 or 5. One figure per score, so the score is exact.
  - How far it holds: exact up to about 10 ratings; 1 versus 5 is still visible at 20. At launch every provider is in
    that range, and the provider still holds that customer's phone and address. Decision 4's protection is gone.
  - Fix (owner decision and a spec amendment): add new ratings to the summary and the count only in batches of k ≥ 3,
    and send `rating_received` as a digest with no count. Or record the acceptance again with these numbers, and change
    "estimate" to "can deduce".
- Nothing else is exploitable. No API role other than admin reads a rating row, who gave it, or its score. No money or
  state row moves.

## Likely issues

- **M-1, `email_context`:** `request_id`, `service` and `start_at` are built for every template, `rating_received`
  included. Only the wording keeps the job out of the provider's mail; a `{service}` or `{start}` added when the `[tr]`
  strings are translated (S21) would name the rated job. Fix: null them for `rating_received`.
- **I-1, `rate_provider`:** no role check. A customer later promoted with `promote_to_admin` can still rate their own old
  jobs through a direct RPC call. Fix: also require `profiles.role = 'customer'`.
- **I-2, `queue_audit_email`:** the invite also goes to a customer whose job admin closed on a report the provider filed
  against that customer (14's `handle_report` `job_closed`, for example `did_not_pay_cash`). This nudges a revenge
  rating. Fix (owner): skip the invite when the closing report's `reporter_id` is the provider.
- **I-3, offer cost:** each offer card averages every visible rating in the region, and `request_offers` has no rate
  limit. Decision 1 accepts this until measured. Fix when it shows: compute M once per `request_offers` call.
- **I-4, `audit_log`:** the service role reads `rating.created` rows (who rated which job, not the score). "Nobody but
  admin" holds only because the service role is trusted server code. Fix: note it in the KVKK register (S16).

## Missing guardrails

- The AC-3 meta test strips every single quoted string, so `EXECUTE 'select … from public.ratings'` gets past it, and it
  scans only `pg_proc` in `public`. Fix: also scan views, materialized views and policies, and fail on dynamic SQL that
  names the tables.
- The table privilege check covers only `SELECT,INSERT,UPDATE,DELETE`; add `TRUNCATE,REFERENCES,TRIGGER`.
- No source test or lint rule ties the RPC names to their doors (`rate_provider`, `request_rating` to `lib/requests`;
  `my_provider_rating` to `lib/provider-feed`; both admin functions to `lib/admin-ratings`). Add the `lib/admin-ratings`
  row to the door table in `AGENTS.md`.
- The mail test checks only that `rating_received` has no score; also check, in three locales, that it holds no service
  name, start time or request id. `tests/i18n.test.ts` has no check that placeholders match across catalogues.
- Nothing ties `ratings.application_id`, `provider_id` and `region` to the request; only `rate_provider` keeps them
  aligned. Fix: a before insert trigger or composite foreign keys.
- No alert on bulk hides (for example more than 5 `rating.hidden` per admin per day), like R21's address view alert.
- Nine more fixed test OTPs in `supabase/config.toml`; the guard refusing `supabase config push` while test numbers exist
  is still owed (R21 I-4).

## Checked and sound

Tables (RLS on, deny policy, every API grant revoked, proven per role); the append only triggers on both tables; the
five definers (search path pinned, granted to `authenticated` only, internals without grant); `rate_provider` (caller
from the locked select, every owning id from the request row, three guards against a second rating, the race proven,
the money and state digest unchanged); `admin_hide_rating` (`is_admin()` from `profiles.role`, reason listed, note
trimmed, request row locked, audit row, no mail, the race proven); `admin_provider_ratings` (admin first, page bounded,
no customer id, strict schema); `request_rating` (null for anyone else, no existence probe); `my_provider_rating` (no
parameter, provider role required); `offer_card` (only `rating` added, only caller `request_offers`); the replaced mail
functions and `pricing_settings_guard` (word for word plus the named additions, grants repeated); mail payloads (ids
only, send time recheck); doors and actions (strict Zod, server session role, nothing from the client reaches SQL as a
price, provider, region or status); UI (only returned data, the note as text, `rp` held to digits); settings; analytics;
public pages; no contact data.

## Recommendation

**ship.** Nothing breaks a rule that never bends, and MJ-1 falls in the class the owner accepted in D205. The owner should
decide MJ-1 again with the numbers above before ratings show at G1. Carry M-1 and the missing guardrails over as R items.
