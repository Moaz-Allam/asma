# Review: feat/15-provider-history (PR #51), 2026-11-20

Reviewer: Sonnet (author was a different run). Diff `217ed0f...HEAD`, spec 0011-15 with X rules over R rules over ACs.
Ran `npm run typecheck`, `npm run lint`, and the history, menu and i18n unit tests: all green. Docker, db:test, e2e and
build were not run.

| id | severity | file:line | finding | suggested fix |
|---|---|---|---|---|
| F-1 | Major | supabase/tests/32_provider_history.test.sql:187 (`real(21, 0)`) and the X-5 assertion for app 21 | `real(21, 0)` skips `apply_fee_paid`, but the provider fee is still the seeded 5% with a 1000 floor (`money_core.sql:120-123`), so it freezes 5000 and `pay_provider_fee` opens a pending card attempt. The application stays AWAITING_FEE, never unlocks, and is not a history row. The assertion `'0 -'` then reads a null row and fails (test 30 zeroes `provider_fee_value` and `fee_min_minor` before its fee of 0 jobs, line 224). | Create job 21 after `UPDATE platform_settings SET value = '0' ... key IN ('provider_fee_value','fee_min_minor')` (after job 20), as test 30 does. Then confirm with `npm run db:test`. |
| F-2 | Minor | migration:76 | `coalesce(f.amount, a.provider_fee_amount, 0)` counts the frozen fee as paid when an unlocked pick has no paid or refunded fee row. R-3 says no row means fee 0. The X-5 invariant is proved only on pgTAP data, so a data fault in production would show as a fee paid in `fees_paid`. | Keep (X-5 asks for it) but add a comment that the pgTAP invariant is what makes it safe; or use `coalesce(f.amount, 0)` and keep the invariant test. |
| F-3 | Minor | migration:62-64 vs spec AC-2 | `months` holds 12 to 24 entries (X-1 widens the window). AC-2 says "12 returned months". X wins, so this is fine, but the horizontal chip row on 390px grows long. | None needed; optionally note in the spec that AC-2's 12 is superseded by X-1. |
| F-4 | Nit | lib/provider-feed/schemas.ts:`HistoryTotals.net_fees` | `Minor` unbounded below is correct (refunds could exceed fees only by data fault); other totals are `nonnegative`. No issue found. | None. |

Checked and fine: function list matches the spec (one function, one migration); signature, `security definer`, `stable`,
empty `search_path`, grants (authenticated only), and the pgTAP signature and grant assertions; month bounds are half
open in the region time zone; null month means current; sums cast to bigint; coalesce on every sum; 200 cap uses
`row_number` with whole month totals and `count(*) > 200`; no contact fields in the row shape and the strict zod schema
refuses extras; no float or client side money arithmetic (page only formats through `MoneyDisplay`); no balance or
wallet wording and R-13 word test covers `History.*` in three locales including `History.nav`; logical properties only;
`tr` strings carry `[tr]`. pgTAP plan 54 matches the 54 assertions. Fixture rows satisfy the table checks I looked up
(`requests_*`, `applications_unlocked_at_status`, `fee_payments_paid_fields`/`pick`, `fee_refunds_psp_refund_set`/
`finished`/`kind_fee`). Every AC and R/X rule maps to a pgTAP, unit or e2e test. No unused exports found. No new
component, so no `ui-registry.md` row is owed (`monthLabel`, `jobTabFor` are helpers, not components).

Verdict: ship after fixes (F-1 must be fixed and db:test run; the rest are optional).

## Resolutions (author, 2026-11-20)

| id | resolution |
|---|---|
| F-1 | Fixed: the fee settings go to 0 after job 20 and before job 21, as 30 does. Proven by GitHub's `database` check (no local db:test, owner rule). |
| F-2 | Kept (X-5); a comment at the coalesce names the invariant pgTAP 32 proves. A database guard for it is a carry over (security review G-1). |
| F-3 | No change: X-1 supersedes AC-2's 12 months. |
| F-4 | No change. |
