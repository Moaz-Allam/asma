# Security review: feat/09-commission-payment

2026-11-17 · `security-reviewer` on Opus, read only, on the uncommitted working tree over `826bf0d`. Spec 0011-09
(D175). The agent had no write tool; its findings were saved here by the author session, verbatim in substance.

**Counts:** Critical 0 · Major 0 · Minor 5 · Info 2 (plus 2 notes for 10). **Recommendation: ship**; fix S09-1
before 10 reuses `my_checkout`.

## Questions answered

- Non-payer reads of an attempt, card URL or receipt: blocked, the same `not_found` for anyone but the fee's payer.
- Client influence on an amount: none; the request id only, the database charges the stored commission.
- Payment after cancel, after the window plus hold, or after the start: refunded as late.
- Two presses: one attempt; a second real payment is refunded.
- PSP id, token, IP or PII to a user or telemetry: none; the analytics filter replaces ids in paths, the scrubber
  removes IPs.
- Card URL: host checked with `isAllowedCheckoutUrl` before the redirect.
- `guardedAction('customer')` on every action.
- Redirect as proof of payment: never; paid is shown only from the database.

## Likely issues

| id | sev | file:line | finding | fix | resolution |
|---|---|---|---|---|---|
| S09-1 | Minor | `supabase/migrations/20261121090000_commission_payment.sql:642-644` | `late_refund` matches any late refund on the request created after the attempt started, not this attempt's own: a `late` view for an attempt that can still be paid; in 10 a provider fee page could show the customer's refunded commission | Match the attempt's own fee and payment | Fixed: `late_refund` joins the refund to its `late_received` journal and matches that journal's `attempt_id`; pgTAP 21 case (another attempt of the same fee reads false) |
| S09-2 | Minor | same file `:554-558`, `:320-326` | A zero commission settles without the provider standing check `accept_commission` applies (R-1) | Check standing before the zero move | Fixed: `commission_settled` requires the provider approved in its application update; pgTAP 21 case (suspended, zero commission: `invalid_state`) |
| S09-3 | Minor | same file `:574-587`; `actions/payments.ts:58-64` | The reuse branch writes an `audit_log` row on every call with no count; a direct RPC loop grows `audit_log`. The status poll has no limit | No audit row on reuse | Fixed in part: no audit row on a reuse (pgTAP 21 count now 1). The status poll limit is carried (R14) |
| S09-4 | Minor | same file `:516-529`; `actions/payments.ts:32-35` | `pay_commission` is granted to `authenticated`, so a caller picks `p_payer_ip` sent to iyzico as the buyer IP. Accepted in the spec (N-1) | Keep N-1 | Accepted (spec N-1) |
| S09-5 | Minor | `lib/relay/handlers.ts:224-231`; `20261120090000_relay.sql:592-593` | A setting missing for over 26 hours ends the retries: a captured payment is neither applied nor refunded, only the alert remains | Reconcile lists verified payments with no fee or refund row (12, 21) | Carried (R14): reconcile lists verified payments with neither fee nor refund row (12 or 21) |

## Missing guardrails

| id | sev | file:line | finding | fix | resolution |
|---|---|---|---|---|---|
| S09-6 | Info | `supabase/tests/02` (meta) | No meta test proves every `security definer` function granted to `authenticated` filters by `auth.uid()` | Catalog meta test with a named allowlist | Carried (R14, 21) |
| S09-7 | Info | `supabase/tests/21_commission_payment.test.sql` | No cases for the late flag across attempts (S09-1), a zero commission with a suspended provider (S09-2), Pay on a refunded commission | Add the cases | Two of three added (S09-1, S09-2); Pay on a refunded commission waits for 12, which builds the refund |

## Checked and sound

- `pay_commission`: ownership under the request lock first; deadline before the zero path; `payment_deadline <=
  scheduled_start_at` is a constraint; switch and settings before the fee opens; the count rolls back on refusal.
- Grants: anon and PUBLIC revoked, `search_path` pinned; internal functions have no API grant; `action_counters` has
  RLS, a deny policy and no grants.
- `accept_commission` covers each AC-5 condition plus R-1. `apply_fee_paid` records once (advisory lock, `pending`).
- Cancel and payment serialise on the request lock (pgTAP 19, 22). `requests_guard` writes `fee_deadline` once.
- `fee_payments` column grants still leave out the provider, the PSP payment id and the PSP fee.
- The callback redirects by attempt id only; a replayed late verify is a no op; analytics carry the fee kind only.

## Notes for 10

- The return page admits customers only, and Try again calls `payCommissionAction` whatever the fee kind
  (`components/features/payments/CheckoutWaiter.tsx:118`).
- The header comment claims one lock order "in every function here", but cancel and `commission_settled` lock the fee
  before the applications; the request lock first prevents a deadlock, so only the comment is wrong (same as code
  review F7).
