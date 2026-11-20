# Security review: feat/15-provider-history (PR #51), 2026-11-20

Reviewer: `security-reviewer` agent (read only; this file was saved by the author from its report). Diff
`217ed0f...HEAD`, spec 0011-15. Verdict: **ship**. No caller can read another provider's rows, any customer contact
data, or the state of a request that is not theirs; the caller comes only from `auth.uid()`; grants are
`authenticated` only; `search_path` is pinned; the page is `force-dynamic` and per user; no client money arithmetic;
nothing reads or implies a balance (rule 9).

| id | severity | file:line | finding | fix | resolution |
|---|---|---|---|---|---|
| L-1 | Low | `lib/provider-feed/constants.ts:81` | `?month=0000-01` passed the regex; Postgres has no year 0, so the date cast fails (22008), `call()` throws, and the provider gets a 500 instead of R-10's fallback. | Bound the year. | Fixed: the regex takes years 1900 to 2099; unit tests cover `0000-01` and `9999-01`. |
| I-1 | Info | migration, `v_month` | `p_month = 'infinity'` fell back to the current month instead of `validation_failed`. Harmless (own data). | Refuse a non finite month. | Fixed: `not isfinite(p_month)` raises `validation_failed`; pgTAP 32 asserts it. |
| I-2 | Info | migration, `request_status` | The branch that hides the request state of a pick the request no longer names is unreachable today and untested. | Add a pgTAP case. | Fixed: pgTAP 32 seeds that case and asserts the state is hidden and left out of `cash_closed`. |

## Missing guardrails (carry overs, not in this position's scope)

- G-1: X-5 (a provider fee row's amount equals `applications.provider_fee_amount`) is proven only on test data; a
  constraint or trigger on `fee_payments` would keep cloud data from drifting.
- G-2: `fee_refunds.amount` is checked `> 0` but not `<= fee_payments.amount` for `kind = 'fee'`, so `net_fees` could go
  negative if a refund path were ever wrong.
- G-3: a meta pgTAP test that calls every provider facing definer function (05 to 15) and fails on any contact key in
  the result (`full_name`, `phone`, `street`, `address`, `note`, `district`).
