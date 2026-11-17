# 0011-09. Customer pays the commission (position 09)

Child of [0011](index.md). Follows the cross child contract there. **High risk: money.**

## Summary

After choosing, the customer presses Pay, sees the split once more (job price, commission online now, cash to the provider
after the job) with the agreement reminder, and goes to the iyzico card page. When they come back, a pending page waits
for the relay to confirm the payment with iyzico. A confirmed payment moves the request to `COMMISSION_PAID` and starts
the chosen provider's 24 hour fee window. The customer gets a receipt page that says plainly it is not a tax invoice.

## Requirements

**User stories**:
- As a customer, I want to see exactly what I pay now and what I pay in cash later, so that the cash model is clear.
- As a customer, I want a clear pending, success or failure state after the card page, so that I never pay twice by doubt.
- As a customer, I want a receipt, so that I can prove I paid.

**Prerequisites**: 08 merged. Branch `feat/09-commission-payment`. S24 for the final design (else tokens and old screens,
umbrella). S16 for the agreement text (draft marker until then, D100).

**Acceptance criteria**:
- **AC-1**: `pay_commission(p_request_id, p_locale)` (customer of the request only): refuses `invalid_state` unless the
  request is `SELECTED`, `already_paid` when the commission fee is `paid`, `deadline_passed` after the selection's
  `payment_deadline`, `too_many_checkouts` past `checkouts_per_fee_hour` (counted in `action_counters`, subject the fee
  id, hourly window); else `open_fee` (07) and returns the attempt to use: a `queued` or `ready` attempt younger
  than `checkout_hold_minutes` is reused, otherwise `start_checkout` makes a new one with `p_locale`.
- **AC-2**: `choose_applicant` (06) refuses a switch with `checkout_open` while the commission has a `queued` or `ready`
  attempt younger than `checkout_hold_minutes`.
- **AC-3**: The pay page `/[locale]/pay/[attemptId]` (payer only, else 404) shows: job price, commission now, cash due
  to the provider after the job (all from `requests`), the agreement reminder line with a link to the terms (D92), and
  for `ar` a note that the card page opens in English. It polls the attempt every second for up to 15 seconds and
  redirects to the card URL once `ready`; on `failed` or timeout it offers Try again.
- **AC-4**: Back from the card page, the same route shows Pending, polling every 2 seconds for up to 2 minutes, then
  "We will update this page when iyzico confirms"; Success links to the request and the receipt; Failure offers Try
  again while the deadline holds.
- **AC-5**: `accept_commission(fee, attempt)` (07's state check) accepts only when the request is `SELECTED`, the fee
  is `pending`, no refund row exists for it, and the attempt started before the active selection's `payment_deadline`
  plus `checkout_hold_minutes`. Then the transition sets the request `COMMISSION_PAID`, the application `AWAITING_FEE`,
  the selection's `fee_deadline` by the umbrella window rule with `unlock_window_hours`, and writes a `commission_paid`
  event. Anything else is not accepted: the fee stays `pending` and the payment is refunded as `late` (07 AC-8),
  including a payment that lands after the window expired and the request reopened (owner's rule: a success after the
  hold is refunded).
- **AC-6**: The request page shows Pay commission with the amount and deadline while `SELECTED`, and "Waiting for the
  provider to pay their fee, until <deadline>" while `COMMISSION_PAID`; the timeline lights its step.
- **AC-7**: `/[locale]/receipts/[feeId]` (payer only, else 404) shows fee kind, amount, paid time in the region's time
  zone, the request's service and date, iyzico's payment id, and "This is a payment receipt, not a tax invoice" until B9
  decides invoicing.
- **AC-8**: Typed analytics events `payment_started` and `payment_succeeded` with fee kind and ids only.
- **AC-9**: e2e with the fake adapter in three locales: success, failure then retry, slow (pending then success),
  duplicate (one paid, one refunded with an alert), and a payment after the deadline plus hold (refunded); axe at 390px.

## Decision

The customer never sees a paid state from the redirect: only the relay's verified result changes the page.

## Feature design

**API surface**:

| Function or action | Kind | Inputs | Outputs | Auth | Errors |
| --- | --- | --- | --- | --- | --- |
| `pay_commission` | definer | request id, locale | attempt id | customer of the request | `invalid_state`, `deadline_passed`, `too_many_checkouts` |
| `attempt_status` | definer, stable | attempt id | status, url when ready | payer | `not_found` |
| `my_receipt` | definer, stable | fee id | receipt fields | payer | `not_found` |
| `actions/payments.ts`: `payCommission` | Server Action | request id | attempt id | `requireRole('customer')` | mapped |

**Value sourcing**:

| Value | Source |
| --- | --- |
| Job price, commission, cash due | `requests.fixed_price`, `commission_amount`, `cash_due` |
| Deadline shown | `selections.payment_deadline` |
| Agreement line and link | D92 text (S16, draft until then), `terms_version` |
| Receipt payment id | `fee_payments.psp_payment_id` |

**Security model**: only the payer reads an attempt or a receipt; the card URL is shown only to the payer.

**Critical test scenarios**: a switch during an open checkout is refused (AC-2); a paid result for a cancelled request is
refunded (AC-5); another customer opening the pay or receipt page gets 404 (AC-3, AC-7).

## Build plan

1. Tests first, then the migration: `pay_commission`, `attempt_status`, `my_receipt`, the hook, the switch check;
   satisfies **AC-1**, **AC-2**, **AC-5**.
2. Action and `lib/requests` additions; satisfies **AC-1**, **AC-8**.
3. UI: `PaySplit`, `AgreementLine`, the pay and pending page, request page states, receipt page; satisfies **AC-3**,
   **AC-4**, **AC-6**, **AC-7**.
4. e2e and axe; satisfies **AC-9**. Owner push, reviews with `security-reviewer`, merge.

## Consequences

- Positive: a payment is never shown as done before iyzico confirms it.
- Negative: a short pending wait after every card page.
- Neutral: the pay page is shared with 10.

## Rationale

Reusing a young attempt avoids two live card pages for one fee, which is the simplest way to stop double payment at the
source; the late payment path in 07 handles the rest.
