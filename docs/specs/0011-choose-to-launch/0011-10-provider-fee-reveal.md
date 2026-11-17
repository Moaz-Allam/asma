# 0011-10. Provider pays, mutual reveal (position 10)

Child of [0011](index.md). Follows the cross child contract there. **High risk: money, personal data.**

## Summary

Once the customer has paid, the chosen provider sees "Pay your fee" with the exact amount and a 24 hour deadline on their
My jobs page. When iyzico confirms that payment, the request becomes `UNLOCKED`: the customer sees the provider's name,
phone, WhatsApp and email, and the provider sees the customer's name, phone, WhatsApp, email, street line and notes. The
database decides this (rule 2), and the details disappear 14 days after the job closes. The other applicants are now told
they were not selected.

## Requirements

**User stories**:
- As a chosen provider, I want to pay my fee only after the customer has paid, and then reach them at once.
- As a customer, I want the provider's contact only when they have paid, so that I deal with a committed provider.
- As either side, I want my details hidden from everyone else, and hidden again some time after the job.

**Prerequisites**: 09 merged. Branch `feat/10-provider-fee-reveal`. R6's replay items land here.

**Acceptance criteria**:
- **AC-1**: `pay_provider_fee(p_application_id, p_locale)` (that provider only): refuses `invalid_state` unless the
  application is `AWAITING_FEE`, `already_paid`, `deadline_passed` after the selection's `fee_deadline`,
  `too_many_checkouts` (subject the fee id, as 09); else
  `open_fee` for `provider_fee` and returns an attempt, reusing a young one (09 AC-1 rules). The pay and pending page and
  the receipt of 09 serve this fee too.
- **AC-2**: `accept_provider_fee(fee, attempt)` accepts only when the request is `COMMISSION_PAID`, the fee belongs to
  the active selection's provider, the commission is `paid` with no refund row, the fee is `pending`, and the attempt
  started before `fee_deadline` plus the hold. Then the transition sets the request `UNLOCKED`, the application
  `UNLOCKED`, the selection `unlocked`, every other live application of the request `NOT_SELECTED`, and writes an
  `unlocked` event. Anything else stays `pending` and is refunded as `late` (07 AC-8), so a stale or expired provider's
  payment can never reveal anything.
- **AC-3**: `request_contacts(p_request_id)` (definer, stable) returns, only when the request has a selection with
  outcome `unlocked` for that provider (the reveal is a one way fact: a later admin refund does not hide it), and the
  request is still open or closed less than `contact_visible_days` ago:
  to the customer, the provider's `approved_name`, phone, WhatsApp link, email and whether it is confirmed; to that
  provider, the customer's full name, phone, WhatsApp link, email and whether it is confirmed, the street line, notes and
  zone name. Anyone else, or any other time, gets `forbidden`.
- **AC-4**: A new policy on `request_addresses` lets that provider select the row under exactly the AC-3 condition; the
  same query as that provider returns no row before the second payment and the row after it, and no row after the
  visibility window (umbrella U-3). A second applicant never reads it.
- **AC-5**: The first `request_contacts` read by each side writes one `audit_log` row `contacts.viewed` (actor, request,
  side); later reads write none.
- **AC-6**: The WhatsApp link is `https://wa.me/` plus the E.164 digits of the stored phone (no plus sign), built in the
  database function from `profiles.phone`; no message text is prefilled.
- **AC-7**: My jobs page (`/[locale]/provider/jobs`, 05 builds Applied) gains tabs Chosen (fee amount, deadline, Pay;
  Withdraw arrives with 12), Active (contacts with Call and WhatsApp buttons, street line, notes, start date) and Done (filled
  by 11). The customer's request page shows the provider's contacts with Call and WhatsApp; an unconfirmed email is
  labelled "unconfirmed".
- **AC-8**: Contacts render inside a `data-pii` container that session replay blocks, and replay scrubs DOM attributes
  beyond `maskAttributes` (R6); a test proves a replay of the reveal page carries no phone.
- **AC-9**: Analytics `contacts_unlocked` with ids only. No contact field ever enters a log, event or alert (scrubber
  test).
- **AC-10**: e2e in three locales: the full thread post → apply → choose → commission → provider fee → reveal on both
  sides with the fake PSP; a second provider sees nothing; axe at 390px.

## Decision

The reveal is enforced twice in the database: a definer function for phones and emails (which live in `profiles`, whose
own policy stays owner only) and an RLS policy for the street line. React only renders what these return.

## Feature design

**API surface**:

| Function or action | Kind | Inputs | Outputs | Auth | Errors |
| --- | --- | --- | --- | --- | --- |
| `pay_provider_fee` | definer | application id, locale | attempt id | that provider | `invalid_state`, `deadline_passed`, `too_many_checkouts` |
| `request_contacts` | definer, stable | request id | contact fields | customer or unlocked provider | `forbidden` |
| `my_jobs(p_tab)` | definer, stable | tab | job rows (no contacts) | provider | none |
| `actions/payments.ts`: `payProviderFee` | Server Action | application id | attempt id | `requireRole('provider')` | mapped |

**Value sourcing**:

| Value | Source |
| --- | --- |
| Fee amount shown | `selections.provider_fee_amount` |
| Deadline shown | `selections.fee_deadline` |
| Names | `providers.approved_name`, `profiles.full_name` |
| Phone, WhatsApp | `profiles.phone` |
| Email, confirmed flag | `profiles.email`, `profiles.email_confirmed_at` |
| Street line, notes, zone | `request_addresses.line`, `requests.notes`, the zone name in `pricing_snapshot` |
| Visibility end | `requests.closed_at` + `contact_visible_days` |

**Key invariants**: an `unlocked` selection, which exists only after both fees were accepted as paid for that
(request, provider), is the only door to contacts; no provider reads another
provider's data; an `UNLOCKED` request has exactly one `unlocked` selection.

**Security model**: KVKK personal data; reads audited once per side; contacts never cached in the browser beyond the page
(`no-store` on the route).

**Critical test scenarios**: before and after on the same query for both sides (AC-3, AC-4); provider B and a stranger
denied at every step (AC-3); visibility ends after the window (AC-3); a late provider fee is refunded, not unlocked (AC-2).

## Build plan

1. Tests first (the before and after queries), then the migration: `pay_provider_fee`, hook, `request_contacts`, the
   address policy, `my_jobs`; satisfies **AC-1** to **AC-6**.
2. Action, replay settings, scrubber tests; satisfies **AC-8**, **AC-9**.
3. UI: My jobs tabs, contact card on both sides; satisfies **AC-7**.
4. e2e full thread; satisfies **AC-10**. Owner push, reviews with `security-reviewer`, merge.

## Consequences

- Positive: the most sensitive rule of the product is one function and one policy, both tested before and after.
- Negative: an unconfirmed email can be shown (owner choice); a mistyped address reaches the other side.
- Neutral: the 14 day window also bounds 14's report window, so both read the same `closed_at`.

## Rationale

Phones live in `profiles`, whose owner only policy protects every other screen; widening it would risk leaks elsewhere, so
a narrow definer function returns them only under the reveal condition.
