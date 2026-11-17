# Review, feat/07-money-core, 2026-11-17

**Reviewed by**: Sonnet 5.5 (author on a different model)
**Scope**: the 07 commit 251ced5 (migration `20261119090000_money_core.sql`, pgTAP 18 and 19, guard, flags, alert, requests, i18n, TS tests). `git diff master...HEAD` also lists 05 and 06 because local `master` is behind; only 07 was judged. Branch vs base.
**Verdict**: Approve with nits

## Summary

The migration builds the fee settings and the one fee formula, the commission floor and cap, the frozen provider fee on the chosen application, the seven money tables with guards and append only triggers, and the relay's functions. I traced the money paths (replay vs conflict, double pay, late path, double refund, lock order, outbox retry schedule, ledger legs) and found no blocker and no major. The deliberate deviations are sound. Remaining items are defence in depth, a latent trap for position 12, and test claims that are weaker than their names.

Deviations judged:
- `post_journal` extra args (`p_fee_payment_id`, `p_response`): sound. The conflict check compares kind, currency, region, fee and normalised legs, and the replay returns the stored response.
- `p_region` on `enqueue_outbox` and `record_psp_event`: sound (every table has a non null region).
- `ledger_check` returning jsonb with an empty `imbalances`: sound.
- No op `after_*_paid` hooks: sound. They run after the journal and inside the same locked transaction.
- AC-2 lower bound read with R-1's cap: sound, and `fee_amount` and `pricing_split` use the same expression.
- `provider_fee_for` exemption in the rule 1 meta test: sound, keyed on oid and argument name, not a pattern.

## Minor

### 🟡 One PSP payment can be booked twice when two calls race, `supabase/migrations/20261119090000_money_core.sql:1206`
**Problem**: The "already used elsewhere" check (`fee_payments.psp_payment_id`, `fee_refunds.psp_payment_id`) is a sequential read. Uniqueness is per table, so the same PSP payment applied at once to fee F1 (paid) and fee F2 (late, in `fee_refunds`) commits both: different request locks, different journal keys (`fee:F1:paid`, `late:P:received`), different unique indexes.
**Why it matters**: Needs a relay that passes the wrong fee for a payment, so low odds, but the result is revenue and a refund liability for one card payment.
**Suggested fix**: Take `pg_advisory_xact_lock(hashtextextended(p_psp_payment_id, 0))` right after input validation (before the request lock, so lock order stays acyclic with the other functions, which never take it), or give both tables one shared uniqueness table. Add a dblink race case for it.

### 🟡 Frozen fee blocks a later choose after a reopen, `supabase/migrations/20261119090000_money_core.sql:396`
**Problem**: Step 7 of `choose_provider` writes `provider_fee_amount`/`kind` as `case ... end` for every APPLIED row, null for non chosen ones. `applications_guard` (line 310) allows a change only on `APPLIED -> SELECTED` from null. If 12's reopen puts a previously chosen row back to `APPLIED` with its fee kept (R-5 says "the frozen fee stays on the old row"), the next choose either raises `application_immutable` for that row (non chosen, new value null) or, if the same provider is re-chosen after a settings change, for the chosen one.
**Why it matters**: The customer could not re-pick after a missed window, with a cryptic code and no alert.
**Suggested fix**: Decide now, in the 12 note: the missed provider's row goes to a final status (then no issue), or the update leaves the fee columns untouched on rows that already hold one (`coalesce`) and the guard allows an unchanged value. Add one pgTAP case when 12 is built.

### 🟡 `finish_outbox` has no worker fence, `supabase/migrations/20261119090000_money_core.sql:1425`
**Problem**: A worker whose 2 minute lease ran out can still finish (done or failed) a row that another worker has re-claimed, and a stale failure spends the second worker's attempt.
**Why it matters**: Wrongly marks a delivery done, or schedules a duplicate. The PSP calls are idempotent by key, so the harm is bounded.
**Suggested fix**: Optional `p_worker` argument (or compare `claimed_at` token) and finish only when `claimed_by` matches. Decide before 08 writes the caller.

### 🟡 The "deferred at commit" claims are not proven, `supabase/tests/18_money_core.test.sql:23`
**Problem**: The file runs `SET CONSTRAINTS ALL IMMEDIATE`, and 10 and 12 set `fee_settings_guard` immediate. AC-6 ("refuses a commit where a journal does not balance") and R-2 ("a deferred constraint trigger") are then proved only per statement. Dropping `deferrable initially deferred` on `ledger_balanced` or `fee_settings_guard` leaves most tests green. Only the committed fixtures of file 19 touch the commit path, and they do not assert a refusal.
**Suggested fix**: Add a meta assertion on `pg_trigger.tgdeferrable and tginitdeferred` for the three constraint triggers, and one dblink case that commits an unbalanced journal and expects `ledger_unbalanced` at COMMIT.

### 🟡 Zero amount fee rows can never be paid or refunded, `supabase/migrations/20261119090000_money_core.sql:1000`
**Problem**: R-1 lets the commission and the provider fee be 0 for a price below the unit. `open_fee` creates the row (`amount >= 0`), but `apply_fee_paid` needs `p_amount >= 1` and `fee_refunds.amount > 0`. Such a row stays pending forever, and the request cannot advance.
**Suggested fix**: Only if a price below the unit can exist after 04's rounding (check the minimum price). Otherwise state in the spec that it cannot, or make `open_fee` refuse with `invalid_state` for an amount of 0.

### 🟡 `commission-netted` guard is narrow, `.claude/hooks/guard.mjs:61`
**Problem**: The regex needs the words `price|amount|total` directly before `- commission`. `req.fixed_price - req.commission_amount`, `p - commission` and a destructured `{ fixedPrice, commissionAmount }` form (`fixedPrice - commissionAmount` does match) mostly slip through. The new suite proves two matching shapes and one allowed path only. The exemption regex `lib/pricing/` also matches any path that merely contains that segment (for example `x/lib/pricing/y.ts`).
**Suggested fix**: Add the member access and snake case shapes to the pattern and to the suite, and anchor the exemption to the repo's `lib/pricing/`. Rule is a second line anyway; Postgres is the source of the figure.

### 🟡 `ledger_check` misses some imbalances, `supabase/migrations/20261119090000_money_core.sql:1558`
**Problem**: It does not report a `late_received` journal with no matching `fee_refunds` row, a late refund row with no `late_received` journal, or a `refunds_due` total that differs from the sum of queued late refunds. A `done` fee kind refund with a fee still `paid` is also silent.
**Suggested fix**: Add these as checks (the daily reconcile in 08 will otherwise only compare with the PSP). Cheap and the property test can assert them.

### 🟡 `psp_payload_strip` recursion depth, `supabase/migrations/20261119090000_money_core.sql:1116`
**Problem**: A 64 KiB payload can nest tens of thousands of levels; the recursive plpgsql call hits `max_stack_depth` and raises a non domain error instead of `payload_too_large`. Source is the verified PSP, so the risk is low.
**Suggested fix**: Reject nesting above a small depth (for example 20) before stripping, with a stable code.

### 🟡 Race file asserts timing and an unasserted end state, `supabase/tests/19_money_races.test.sql:176`
**Problem**: "the payment waits" relies on `pg_sleep(0.3)` then `dblink_is_busy`, which can flake on a slow runner. In the payment first then cancel case (line 189 to 196) the test only checks "ok, no deadlock"; the final state (commission paid, request cancelled, no refund queued) is not asserted, so a later change that leaves a paid fee on a cancelled request passes.
**Suggested fix**: Poll for `pg_locks`/`pg_stat_activity` wait state instead of a sleep; assert the final request and fee status and leave a comment naming 09 as the owner of the fix.

## Nits

- ⚪ `lib/observability/alert.ts:34`, R-3 names an `idempotency_conflict` alert reason too; only `fee_settings_invalid` was added. Fine if 08 adds it, say so in the tracker.
- ⚪ `supabase/migrations/20261119090000_money_core.sql:1425`, `finish_outbox` returns a row of status `done`/`failed` unchanged for a stale call with no signal that nothing was applied; a `changed` boolean would help the relay log it.
- ⚪ `supabase/migrations/20261119090000_money_core.sql:640`, the column grant also leaves out `psp_payment_id` and `provider_id` (R-9 only names `psp_fee_amount`); safer than the spec, but note it in the spec for 09 and 10's views.

## Strengths

- Lock order is consistent in every function (request, then fee, then attempt or refund) and the choose reads its fee settings before any application lock; the dblink races prove the two orders against a cancel with no deadlock.
- Replay vs conflict is handled exactly: same PSP payment replays as paid or late, with a differing amount, currency or fee it raises `idempotency_conflict`, and a payment already on another fee is refused. The late path never touches the fee and books to `refunds_due`.
- Append only holds for every role (triggers, not only revokes), fee rows are frozen by a guard that also refuses delete and truncate, and the journal check is a deferred constraint trigger fed by a one statement insert.
- Retry schedule is exact (1, 5, 30, 120, 720 minutes, failed on the sixth claimed attempt) and proved attempt by attempt, including the expired lease at attempts 2 and 6.
- The choose replacement is a clean diff against 06's function; the frozen fee, the cap and the single formula (`fee_amount`) are shared by the choose, the backfill and `provider_fee_for`.

## Test coverage

pgTAP 18 (190 assertions) covers settings checks, 2,000 price loop plus four settings shapes, the floor and cap, the frozen fee (including a settings change after the choose), fee rows and guards, attempts, ledger append only and balance, journal replay and conflict, paid (late, accepted, mismatch, currency, missing and oversized PSP fee, replay, second payment), refunds (late and fee, replay, conflict, never paid), the outbox lease and schedule, PSP event stripping, who reads what for four roles and anon, `ledger_check`, and a 600 step seeded property test whose assertions are real (it checks the recorded pre state against the result, so a paid result without an accepted pre state fails). File 19 covers the two payment race, the same payment twice, both cancel orders and two relays claiming. Gaps are the commit time behaviour of the deferred triggers, the cross fee PSP race, account correctness for provider fee refunds, and the late journal checks in `ledger_check` (see minors). TS side: the flags, alert and choose tests were updated and add a `fee_settings_invalid` case; the guard suite adds the D96 cases.

## Outcome (after the review, same branch)

Fixed in the 07 migration, with tests: the PSP payment id race across requests (advisory lock, pgTAP 19), the
`finish_outbox` fence (claim token, `stale` in the result), the frozen fee kept on other rows by the choose, the
deferred checks proven deferrable (pgTAP 18), the payload depth (refused `payload_too_large` past 32 levels), two
more `ledger_check` imbalances (late journal without its refund row and the reverse, a PSP fee that differs from
its leg), and the final state of the payment then cancel race. Carried, in the tracker (R13): the frozen fee on a
reopened pick (12), the zero amount fee (owner question), the wider cash due regex, the `idempotency_conflict`
alert reason (08), and the fee columns a payer reads (09, 10). The `pg_sleep(0.3)` waits follow 17's pattern.
See also the security review, `2026-11-17-feat-07-money-core-security.md`.
