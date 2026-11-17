# Review, feat/05-feed-apply, 2026-11-17

**Reviewed by**: Sonnet 5.5 (author on a different model)
**Scope**: 54 files, branch vs origin/master (plus uncommitted docs and `e2e/provider-feed.spec.ts`)
**Verdict**: Approve with nits

## Summary
Position 05 adds the provider setup, a keyset paged feed, request detail, free apply and the applications list, all behind definer functions, plus the 04 review carry overs (R10). The SQL is careful: the request row lock is taken first and the cap race is closed, the contact scanner refusals return instead of raising so the rate count commits, the two reads build named columns only, and the strict zod parse is a second wall. No blocker or major found. The findings are small races and scale notes; none breaks a rule that never bends.

| # | Severity | Area | Finding | Resolution |
|---|---|---|---|---|
| 1 | Minor | SQL | Apply does not lock the provider row, so a suspension committing mid flight does not stop that one apply | fixed: step 4b takes `for share` on the providers row after the request lock and reads the standing again; dblink race case in pgTAP 15 (D156) |
| 2 | Minor | SQL | Feed and home counts evaluate hours and applicant counts for every matching request before the limit; filter arrays are unbounded on a direct call | fixed in part: filters over 50 services or 100 districts return an empty page (pgTAP 14); the per page cost at scale stays a note for 16 or 21 |
| 3 | Minor | Migration | `requests_commission_unit` validates every existing cloud row at push time | no change: the cloud holds 0 requests (read only count, 2026-11-17) |
| 4 | Nit | i18n | `tr` `form.counter` has no `[tr] ` prefix | no change: it holds no words, only the two placeholders |
| 5 | Nit | Code | `loadFeed` makes an extra `regions` round trip for the time zone | accepted: only on a date chip, and the dates must be known before the call |

## Minor
### 🟡 Apply reads standing without a lock, `supabase/migrations/20261117090000_provider_feed_apply.sql:1350`
**Problem**: `apply_to_request` reads `provider_standing` unlocked, while `save_provider_setup` and the 02 admin flows lock the providers row. Suspend commits between step 2 and the insert in step 13. The insert only takes a key share lock on the provider (the FK), and a suspension does not change the key, so it does not wait.
**Why it matters**: A provider suspended at that instant can still land one application. Narrow, free, no money or data exposed. The spec only promises the wait for the setup save.
**Suggested fix**: Take `for share` on the providers row in `provider_reader` or step 2, after the request lock so the order stays request, then provider. Or record it as accepted and add a line to the lock order comment at line 1324.

### 🟡 Feed cost and unbounded filter arrays, `supabase/migrations/20261117090000_provider_feed_apply.sql:1133`
**Problem**: The inner select computes `provider_outside_hours` and a correlated applicant count for every matching request, then sorts, then takes 21. `p_service_ids` and `p_zone_ids` have no cardinality cap in SQL; the 100 cap lives only in the page and zod.
**Why it matters**: Fine at launch volume. A provider calling PostgREST directly can pass huge arrays, and a big region makes the feed linear per page.
**Suggested fix**: Cap the arrays in the function (`cardinality(...) <= 100`, else null or refuse). Note the scale limit for later, for example a precomputed sort key. `requests_open_start_idx` already helps the open filter.

### 🟡 New check constraint on existing rows, `supabase/migrations/20261117090000_provider_feed_apply.sql:164`
**Problem**: `requests_commission_unit` is added validated. Any cloud row whose snapshot lacks `rounding_minor`, or whose commission is not a whole multiple of it, fails the whole migration. 04 writes `rounding_minor`, so test rows should pass.
**Why it matters**: A failed push leaves the owner mid way through step S for 05.
**Suggested fix**: Before the push, run a count of violating rows against the cloud (read only). If any exist, use `not valid` plus a later `validate`.

## Nits
- ⚪ `messages/tr.json` `ProviderFeed.form.counter`, `{count} / {max}` lacks the `[tr] ` prefix; harmless since it has no words, but the launch gate marker scan treats it as translated.
- ⚪ `lib/provider-feed/index.ts:112`, `loadFeed` reads `regions` for the time zone on a chip filter; `provider_feed` already returns `timezone`, so this could be avoided with a two step call or a cached setup value.

## Strengths
- Lock order is stated and honoured (request, counter, applications); cancel takes the same lock first, so apply after cancel gives `request_closed` and cancel after apply cancels the application, with a dblink race test in 15.
- Message handling: byte cap before any regex, scanner and length refusals return a status so the count commits, and the message key is scrubbed in camel and snake forms with a test.
- The two request reads build named columns in a helper, never `to_jsonb(requests)`, and a structured answer only leaves in its own JSON shape, so a string cannot ride out under a number or date question; tests check exact key sets.
- R10 carry overs (A1, A2, A6, A7, A8, B1, B4, B5, F6) each have a labelled pgTAP section in 14. Tables, RLS, grants and negative tests ship in one migration (rule 7); the function grant meta test in 10 was updated.
- UI: logical properties only (grep clean), all three catalogues have identical `ProviderFeed` keys, every new component has a registry row, and `RequestShortCard` is marked replaced.

## Test coverage
Strong. pgTAP 14 and 15 cover every refusal of apply, the cap, the hourly limit, the scanner corpus, rival rows, grants, the guards and paging across the divider; `tests/provider-feed.test.ts` covers the door, the actions and the pure helpers; the e2e spec covers the journey at 390px in all three locales. Not covered: finding 1 (suspension racing apply). AC-25 real calls are an owner step after the cloud push, as the brief says.
