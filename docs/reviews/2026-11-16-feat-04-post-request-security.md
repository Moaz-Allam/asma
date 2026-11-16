# Security review, feat/04-post-request, 2026-11-16

**Reviewed by**: `security-reviewer` agent on Opus (high), fresh context, static (no tests run). A second `security-reviewer` pass was run by Develop 04; its findings are to be merged into the table below (pass B).
**Branch**: `feat/04-post-request` (PR #28) · **Head**: `80055a4` · **Base**: `origin/master` at `287ee8b`
**Verdict**: ship. 0 Critical, 0 Major, 9 Minor (pass A).
**Fact**: migration `20261116090000_post_request.sql` is applied in the cloud (owner push, 2026-11-16). A SQL fix is a NEW migration, so every "new migration" row is deferred to 05's migration (tracker R10) unless the owner asks otherwise.

## Findings, pass A (Opus)

| id | sev | where | finding | fix | kind | resolution |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Minor | `post_request.sql:752-753`, `catalog_pricing.sql:913-914` | The quote limit is skipped when `quote_price` raises (`price_out_of_range`, `service_unavailable`, `zone_unavailable`, `addon_unavailable`): the raise rolls back the counter increment. A signed-in customer gets unlimited formula evaluations, each writing a `log.warn` to Sentry Logs (`lib/requests/index.ts:80-82`). AC-28 says a direct RPC cannot skip the limit; that holds only for refusals that return `invalid`. | In `quote_request` and `create_request`, wrap the `quote_price` call in a `begin ... exception when raise_exception` block and return a `refused` status, so the count commits. App side: map `refused` in `lib/requests`; rate limit or dedupe the warn. | new migration, then app | deferred, R10 |
| A2 | Minor | `post_request.sql:839`, `:843` | The street line and the notes have no byte cap before `catalog_trim` runs its regex. The Zod caps (`lib/requests/input.ts:37-38`) cover the Server Action only; a direct RPC can send megabytes into two `regexp_replace` passes. Same gap 03's Minor (b) closed for answers. | Refuse `address_invalid` or `notes_invalid` when `octet_length(...) > 4096`, before trimming. | new migration | deferred, R10 |
| A3 | Minor, choice | `post_request.sql:670`, `:748`; `12_requests.test.sql:322` | `request_catalog` and `quote_request` check that a profile exists, not its role. A provider can read the catalog and quote by direct RPC. The test asserts this on purpose; AC-4 calls it "the customer's only read". No PII involved. | Keep, and change AC-4's wording (any signed in profile reads the catalog; a provider's quotes count against their own limit), recorded as a decision row. Or restrict to customer and admin (new migration). | spec wording | fixed: AC-4 wording, D144 |
| A4 | Minor | `12_requests.test.sql:189-194` | The test that the two blank patterns match compares only the leading class (`^[\s` to `]+\|`). The trailing class after `\|` in each function is never compared and could drift. Both copies match today. | Compare the whole pattern literal, and the leading against the trailing class inside each function. | test | fixed: both classes compared (pgTAP 12) |
| A5 | Minor | `lib/observability/scrub.ts:63-66` | Exact keys only. The RPC argument names `p_address_line`, `p_notes`, `p_answers` match none of them. No path puts them into an event today. | Add the suffixes `_line`, `_notes`, `_answers` to `PERSONAL_SUFFIXES`, with a unit case. | app | fixed: suffixes `_line`, `_notes`, `_answers` (unit test) |
| A6 | Minor | `post_request.sql` (`requests`) | No delete guard on `requests`; only missing grants and the `request_addresses` foreign key protect it. `09_catalog.test.sql` shows that disabling the address guard lets requests be deleted. | A before-delete trigger that raises `request_immutable`. | new migration | deferred, R10 |
| A7 | Minor | `post_request.sql:485-498` | `requests_guard` freezes columns but allows any status change at trigger level (`postgres` could move `COMPLETED` back to `OPEN`). | A from to transition check, before 06 adds its transitions. | new migration (06) | deferred, R10 (before 06) |
| A8 | Minor | `post_request.sql` (`create_request`, `request_catalog`) | Neither reads `regions.active`, so they would work for a KSA profile if one existed. Defence in depth; sign up already gates. | Add an `r.active` check with a "region off" refusal code. | new migration | deferred, R10 |
| A9 | Minor | `supabase/tests/12_requests.test.sql` | `anon` has no `table_privs_are` check on the three new tables; anon reads of `quote_counters` are untested. | `table_privs_are(..., 'anon', ARRAY[]::text[])` for all three. | test | fixed: anon `table_privs_are` on the three tables (pgTAP 12) |

## Findings, pass B (Opus, the author's session, head 80055a4)

Verdict: ship, no Critical or Major. Duplicates of pass A are marked.

| # | Severity | Where | Finding | Fix | Kind | Resolution |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | Minor | `post_request.sql` `pricing_split` | Reads `price_rounding_minor` again, apart from `quote_price`; a unit changed in between could give a commission above the price | Refuse `pricing_settings_invalid` when the commission passes the price, or pass the quote's unit in | migration | deferred, R10 |
| B2 | Minor | `lib/analytics/client.ts` | Pageviews carried `/requests/<uuid>` (AC-25 says no id) | Replace uuid path segments with `[id]` | app | fixed: `withoutIds` (unit test) |
| B3 | Guardrail | `requests`, `request_addresses` | No delete or truncate guard | Before delete and before truncate triggers | migration | duplicate of A6; deferred, R10 |
| B4 | Guardrail | `requests` | Nothing ties the commission to the snapshot's rounding unit | A check that the commission is a whole multiple of the unit | migration | deferred, R10 |
| B5 | Guardrail | blank pattern | Misses U+180B-180D, U+17B4-17B5, U+FFF9-FFFB, U+1D173-1D17A, U+13430-1343F | Extend the SQL copies, `lib/requests/blank.ts` and the copies test together | migration | deferred, R10 |
| B6 | Guardrail | `supabase/tests/10` | The meta test exemption matched `proname` only; a future overload would be exempt too | Key it on the exact `regprocedure` | test | fixed |
| B7 | Guardrail | `request_addresses_read_own` | An admin reads the address of their own request; AC-17 says "admin none" | Record as intended, or add `not is_admin()` | spec | fixed: recorded as intended, D144 |
| B8 | Guardrail | `supabase/tests/13` | The dblink sessions ran as `postgres` with claims | `SET ROLE authenticated` in both sessions | test | fixed |
| B9 | Guardrail | request functions | No `regions.active` check | An `r.active` check and a "region off" code | migration | duplicate of A8; deferred, R10 |
| B10 | Minor | `quote_request`, `create_request` | A call that ends in a raise rolls its count back and is never rate limited | Status codes instead of raises, or an autonomous count | migration | duplicate of A1; deferred, R10 |
| B11 | Info | `pricing_split` | A small price gives a commission of 0 | 07 refuses or skips a payment of 0 | spec follow up | known (spec follow up, 07) |

## Checked and sound (pass A)

RLS on all three tables, select only grants, `is_admin()` reads the profile role not a claim; every new definer function pins `search_path = ''` and revokes PUBLIC, anon and service_role; `quote_price` lost its authenticated grant (proved); rule 1 holds (price, commission and cash due only from `quote_price` and `pricing_split`, `p_expected_*` compared once and never stored); integer minor units with one half up rounding step; role and region from `profiles`; idempotency with the profile row locked before the replay lookup; cancel locks the row and is audited without PII; `?from=` filters by `customer_id`; the 03 Minors (caps, null key echo, blank patterns, `platform_settings` audit trigger) are present and tested; all three actions use `guardedAction`, all pages `guardPage`; no PII in the audit rows or the telemetry events; pgTAP 12 and 13 hold the negative RLS cases rule 7 requires.
