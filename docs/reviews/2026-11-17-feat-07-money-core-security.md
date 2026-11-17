# Security review: position 07, money core (spec 0011-07)

Reviewed by the `security-reviewer` agent on Opus, read only, over commit `251ced5` on `feat/07-money-core`.
Recommendation: **fix then ship**. No confirmed vulnerability: no path lets anon, a customer or a provider call a
write function, read `psp_fee_amount`, read a ledger, outbox, PSP event, refund or attempt row, or read another
provider's data; no payment sets a fee `paid` unless it is pending, accepted and matches the fee's amount and
currency.

The code review on Sonnet (`2026-11-17-feat-07-money-core.md`) found the first two items below as well.

## Findings and what was done

| Id | Finding | Outcome |
| --- | --- | --- |
| S1 | `finish_outbox` had no fencing token: a relay whose lease ran out could finish a row another relay claimed since | **Fixed.** `claim_outbox` returns `claim_token` (the claim time); `finish_outbox(p_id, p_ok, p_error, p_claim_token)` acts only with the current token and returns `stale: true` otherwise. pgTAP 18 |
| S2 | One PSP payment could be booked to two fees on two requests at once (paid on one, late on the other): the cross table check was serialised only by the request lock | **Fixed.** `apply_fee_paid` takes `pg_advisory_xact_lock` on the payment id after the request lock. pgTAP 19 proves the second call waits and refuses `idempotency_conflict` |
| S3 | A later choose could fail where a fee was frozen before (the choose wrote null over other rows) | **Fixed** in the choose (`else` keeps a frozen fee). What a second choose of one row does is 12's (R13) |
| S4 | A fee of 0 is allowed but can never be paid (a price below the unit, or a floor and a value of 0) | **Owner: D171**, a fee of 0 skips its payment step (09, 10) |
| S5 | A `fee` refund was not tied to its fee's request or PSP payment | **Fixed.** FK `(fee_payment_id, request_id)`; `apply_fee_refunded` refuses `invalid_state` when the refund's PSP payment is not the fee's. pgTAP 18 |
| S6 | Inserting a fee row takes a key share lock on the provider; a later suspend that locks a request after the provider could deadlock | **Carried to 12** (R13): the rule "provider row only after the request row" and a race test |
| S7 | `psp_payload_strip` kept the buyer's personal data the PSP may echo | **Fixed.** The buyer object, names, email, phone, identity number, IP and any address key are stripped. pgTAP 18 |
| S8 | `checkout_attempts.url` is not restricted to iyzico | **Carried to 08** (R13): the host is a B3 fact, and the fake adapter needs its own |
| S9 | `ledger_check` missed late payment and PSP fee imbalances | **Fixed** for a late journal without a refund row (and the reverse) and a stored PSP fee that differs from its leg. A paid commission on a cancelled request is a state check for 12 (R13) |
| S10 | Append only holds against DML for every role, but the owner can disable a trigger | **Carried to 21** (R13): a daily check that alerts on a disabled trigger on a money table |
| S11 | TR money has no runtime off switch since the escrow flags are gone (D95) | **Owner: D172**, a `payments_enabled` flag, built in 08 |

Code review minors fixed in the same pass: the deferred checks proven deferrable and the balance check a
definer function (a real defect the race test found before review: a deferred trigger runs at commit as the
caller's role), a stable `payload_too_large` for a payload nested deeper than 32 levels, and the final state of
the payment then cancel race asserted.
