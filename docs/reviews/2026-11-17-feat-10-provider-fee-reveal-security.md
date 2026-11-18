# Security review: feat/10-provider-fee-reveal

2026-11-18 · `security-reviewer` on Opus, read only, on `master...HEAD` at `4e32bc8`. Spec 0011-10 (D178). The agent had
no write tool; its findings were saved here by the author session, in substance as given.

**Counts:** Critical 0 · Major 1 · Minor 9 · Info 5. **Recommendation: fix then ship** (S10-1, then the test gaps
S10-6 and S10-7). No path found where anyone but the request's customer or its unlocked, approved, selected provider
reads a phone, email, street line or note before both sides are settled.

## Findings

| id | sev | file | finding | fix | resolution |
|---|---|---|---|---|---|
| S10-1 | Major | `20261122090000_provider_fee_reveal.sql` `pay_provider_fee` step 4; `my_checkout`; `lib/requests/checkout-page.ts` | R-15 held only in React: inside the floor overrun after the start, Try again or a direct call opens a checkout that is always refunded (PSP fee lost both ways), and a fee of 0 could unlock contacts after the start | Refuse at `least(fee_deadline, scheduled_start_at)` before the zero path; `my_checkout` caps the deadline | Fixed: both in the migration; pgTAP 23 (after the start refused, deadline capped). Same as code review F-1 |
| S10-2 | Minor | `my_checkout` | Returned the request's current pick, not the fee's own application: latent cross provider id once 12 adds the re-pick | Use `f.application_id` | Fixed |
| S10-3 | Minor | `contacts_visible` | `provider_standing` is `document_expired` when a document lapses: a paid provider would lose the customer's contacts mid job | Owner call | Fixed per the owner (A-6, D179): only suspension hides; pgTAP 23 proves an expired document keeps a paid job's contacts |
| S10-4 | Minor | `contacts_visible` | The window counts only from `closed_at`; a terminal move that forgets it keeps contacts forever | `coalesce(closed_at, cancelled_at)`; a check later | Fixed in part: `coalesce(closed_at, cancelled_at)`. The check that every terminal request has `closed_at` (G-1) is carried to 11 and 12 (R15) |
| S10-5 | Minor | `request_addresses_read_unlocked` | A per row definer call with no cheap filter: a bare select costs every address row | A cheap filter first | Fixed: the caller's own unlocked applications first |
| S10-6 | Minor | `24_reveal_races` | No "pay against the deadline" and no "apply against a suspend" race | Add both | Fixed in part: pgTAP 23 proves a payment after a suspend goes late and is refunded. The deadline is a time, not a lock; its cases are in 23. A two session apply against suspend race is carried (R15) |
| S10-7 | Minor | `23` | Missing `accept_provider_fee` false cases | One probe per condition | Fixed: another fee's attempt, past the window plus the hold, a refund naming the fee, the pick no longer `AWAITING_FEE` |
| S10-8 | Minor | `23` | `anon` not tested on `request_addresses`; R-14's stale pick absent | Add | Fixed: anon gets 42501. The stale pick needs 12's re-pick: carried (R15) |
| S10-9 | Minor | `lib/observability/scrub.ts` | No scrubber test for a contacts answer; `whatsapp` not a personal key | Add the key and a test | Fixed: `whatsapp` in `PERSONAL_KEYS`; both sides scrubbed in `tests/observability-scrub.test.ts` |
| S10-10 | Minor | `tests/provider-fee-reveal.test.ts` | Try again routing by fee kind untested | A component test | Carried (R15): no component test harness yet; e2e covers the provider's pay path |
| S10-11 | Info | `ContactCard.tsx` | `mailto:` not encoded | `encodeURIComponent` | Fixed |
| S10-12 | Info | the two contact routes | `no-store` relied on Next's default | Set it explicitly | Fixed: `export const dynamic = 'force-dynamic'` on both |
| S10-13 | Info | `contacts_visible` | A provider who cancels after the reveal keeps contacts until the window ends | 12 decides | Carried to 12 (R15) |
| S10-14 | Info | `PROVIDER_FEED_DB_CODES` | Shared code list now maps `validation_failed`, `invalid_state` quietly for every provider function | A per function list | Carried (R15) |
| S10-15 | Info | `proxy.ts` | `/pay` and `/receipts` not in `PRIVATE_PAGE` | Add them | Fixed |

## Missing guardrails (carried, R15)

G-1 every terminal request has `closed_at` (11, 12); G-2 a meta test that each `pay_*` window equals its `accept_*`
window; G-3 a meta test that each policy calling a definer function filters cheaply first; G-4 a lint rule on
`mailto:`/`tel:` built from unencoded values; G-5 a meta test that every `Contacts` key is a personal key (the new
scrub test covers today's keys).

## Checked and sound

`contacts_visible` answers only for the caller and is no oracle; `request_contacts` answers every non party the same
`not_found`, each side gets only the other's fields, the audit row is once per actor; no API role updates `requests`
or `applications` and both guards refuse `unlocked_at`/`UNLOCKED`/`closed_at` outside their moves; `pay_provider_fee`
owns, locks (request, provider shared, fee), charges the frozen fee, reuses and counts as 09, and its zero path
rechecks the commission; a second payment goes late and is refunded once; `my_checkout` and `my_receipt` filter by
payer; the relay builds the buyer from the payer; the `(payments)` pages guard both roles and keep ownership in SQL;
each action has its own role; `provider_jobs` returns own rows and no contact field; telemetry carries the side only.
