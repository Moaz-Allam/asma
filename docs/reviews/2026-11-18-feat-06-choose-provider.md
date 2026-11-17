# Review, feat/06-choose-provider, 2026-11-18

**Reviewed by**: Sonnet 5.5 (author on a different model)
**Scope**: 38 committed files vs `feat/05-feed-apply` plus uncommitted docs and e2e changes, branch vs base
**Verdict**: Approve with nits

## Summary
Position 06 adds `request_offers` and `choose_provider` (definer, request lock then provider share then applications), three guarded columns on `requests`, a single blank class, a whole message digit rule, and the offers, next step and timeline UI plus the provider outcome lines. The SQL follows the spec closely: ownership is taken from `auth.uid()`, refusals are stable codes, customers have no direct `applications` or `requests` write, and the guard blocks any later change of the choose columns. No blocker or major found. The remaining items are small consistency and coverage points.

## Resolutions

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | Minor | Cap helper per application before the feed limit | accepted for launch volume (bounded by the cap of 10 per request); a precomputed count is a note for 16 or 21 |
| 2 | Minor | Page mixes two reads | fixed: every 06 branch reads `request_offers`' own status |
| 3 | Minor | e2e covers one journey | accepted: the other states are proven in pgTAP 16 (empty, expired, hidden message, suspended chosen, cancel in `SELECTED`); the journey covers AC-20 |
| 4 | Nit | `blank_marks()` holds U+1680 and a few other spaces | accepted: stripping them only joins two words in the scanner's copy |
| 5 | Nit | `v_now` is the transaction start | accepted: the choose is one short transaction; the lock wait is milliseconds |
| 6 | Nit | `revalidatePath` beside `router.refresh()` | kept: the layout and other open tabs need the revalidation |
| 7 | Nit | No cancelled marker on the chosen card | fixed: the card shows "Cancelled" |
| 8 | Nit | `catalog_text_ok` definer needs a comment | done in the migration, section 1 |
| 9 | Found by the e2e | Custom analytics events kept a record id in `$current_url` and `$pathname` | fixed: `filterAnalyticsEvent` replaces every uuid path segment in every URL property with `[id]`, with a unit test; this also covers 05's `application_submitted` |

## Minor
### 🟡 Cap helper evaluated per application before the feed limit, `supabase/migrations/20261118090000_choose_provider.sql:574`
**Problem**: `provider_feed` calls `approved_applied_count(r.id)` in the select list of the inner query that also filters by service, zone and dates. Each call runs `provider_standing` once per APPLIED row. Postgres may postpone the call until after `limit 21`, but nothing here guarantees it.
**Why it matters**: A provider with many matching open requests could pay one standing lookup per application per request on every feed load.
**Suggested fix**: Check the plan with `explain` on a seeded set. If the call runs before the limit, count after the limit (outer query) or in a lateral join.

### 🟡 Page mixes two non atomic reads, `app/[locale]/(customer)/requests/[id]/page.tsx:38`
**Problem**: `getMyRequest` and `loadOffers` run in parallel, and the page branches on `request.status` in some places and `offers.status` in others.
**Why it matters**: A choose or cancel that commits between the two reads renders a mixed page for one load (for example offers list empty with the chosen card absent, or Cancel offered on a cancelled request). It fixes itself on refresh and no money or privacy is involved.
**Suggested fix**: Branch on `offers.status` for everything the offers read decides, and keep `request.*` for stored figures only.

### 🟡 e2e covers one journey, `e2e/choose-provider.spec.ts:176`
**Problem**: AC-20 is met, but the empty state, the expired read only list, the "Message hidden" card, the unavailable chip and the cancel dialog note in `SELECTED` have no browser test.
**Why it matters**: These are branches of the page and `OfferList` that only unit or pgTAP data tests reach.
**Suggested fix**: Add one short spec for cancel in `SELECTED` (note text, provider reads "The customer cancelled") and one for the empty state. The others can stay pgTAP only.

## Nits
- ⚪ `supabase/migrations/20261118090000_choose_provider.sql:31`, `blank_marks()` still holds whitespace code points (U+1680, U+205F, and others). NFKC turns most into a plain space first, so the effect is harmless, but U+1680 is stripped and joins words. The spec text says "without its whitespace part".
- ⚪ `supabase/migrations/20261118090000_choose_provider.sql:386`, `v_now := now()` is the transaction start. After a long wait on the request lock the start check and `selected_at` use an older time. Negligible; `clock_timestamp()` would be exact.
- ⚪ `actions/requests.ts:90`, `revalidatePath('/', 'layout')` is heavy and the client calls `router.refresh()` anyway.
- ⚪ `components/features/requests/OfferCard.tsx`, the chosen card on a `CANCELLED` request shows the heading "Your provider" with no cancelled marker.
- ⚪ `supabase/migrations/20261118090000_choose_provider.sql:64`, `catalog_text_ok` is now definer and still executable by `authenticated`. It reads only its arguments, so this is safe, but say so in the migration comment.

## Strengths
- Lock order and the replay at step 2 match the spec and D156. pgTAP 17 proves two chooses, choose vs apply, vs cancel and vs suspension through real dblink sessions.
- `request_offers` returns named fields only, hides a flagged old message at read time, and the strict Zod schema refuses unknown keys. pgTAP checks the exact key sets and greps the output for names, ids and phones.
- The guard test sets the choose columns once and proves they never change, even as `postgres`. Every new function has the grant and `search_path` meta test, and `anon` negatives.
- All new strings are in three catalogues (`tr` with the `[tr] ` prefix), logical properties only, and the new components have `ui-registry.md` rows.

## Test coverage
pgTAP 16 (93 cases) and 17 (12 cases) cover every refusal listed in AC-18, the replay, the capped deadline, the cap helper, scanner corpus, blank class meta test and grants. 05 and 04 files were updated (AC-19). `tests/choose-provider.test.ts` covers the door, the strict parse, the alert on `choose_settings_invalid` only, and the event. Schemas for `payment_deadline` and `selected` are tested. AC-21 real calls are an owner step after the cloud push. The R11 items F1, F2 and G1 are closed with tests.
