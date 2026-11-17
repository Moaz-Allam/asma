# 0011-15. Provider jobs and fees history (position 15, P1)

Child of [0011](index.md). Follows the cross child contract there.

## Summary

A read only page for providers: each job they paid for, with its date, service, the cash it was worth, the fee they paid
and any refund, plus totals per month. There is no balance, no withdrawal and no top up anywhere (D91, rule 9).

## Requirements

**User stories**:
- As a provider, I want to see what each job cost me and what it was worth, so that I know whether the platform pays off.

**Prerequisites**: 14 merged. Branch `feat/15-provider-history`.

**Acceptance criteria**:
- **AC-1**: `provider_history(p_month date)` (the provider, own rows only) returns every application of theirs that
  reached `UNLOCKED`, in that month by `scheduled_start_at` in the region's time zone: scheduled date, service name, cash
  value (`cash_due`), fee paid (`provider_fee_amount` of the paid fee), refund amount if refunded, and the request state.
  Plus month totals: jobs, fees paid, refunds, cash value.
- **AC-2**: `/[locale]/provider/history` shows the month list with a month picker (newest first, 12 months back), each
  row linking to the job on My jobs, and a receipt link per fee (09 AC-7).
- **AC-3**: No word or figure on the page reads as a balance, earnings held, withdrawal or wallet; a catalogue test
  fails on those words in the page's keys in three locales.
- **AC-4**: Another provider, a customer or anon gets nothing; pgTAP negative tests.
- **AC-5**: Three locales, axe at 390px, e2e with two months of fixture jobs.

## Feature design

**Data model**: none new; reads `applications`, `selections`, `fee_payments`, `fee_refunds`, `requests`.

**Value sourcing**: cash value from `requests.cash_due`; fee from `fee_payments.amount`; refund from `fee_payments.amount`
where `status = 'refunded'`; month from `scheduled_start_at` in `regions.timezone`. Totals are sums in the function
(integer minor units), formatted by `MoneyDisplay`.

**Security model**: own rows only, through a definer function; no ledger access.

## Build plan

1. Tests first, then the function; satisfies **AC-1**, **AC-4**.
2. Page and catalogue test; satisfies **AC-2**, **AC-3**.
3. e2e and axe; satisfies **AC-5**. Reviews, merge.

## Consequences

- Positive: providers see their cost and value honestly, with no stored balance to get wrong.
- Negative: totals are computed per read (fine at launch volume).

## Rationale

Computing at read from the fee rows keeps one source of truth; a stored total would drift from refunds.
