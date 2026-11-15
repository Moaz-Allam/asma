# Verify: Post a request (04) · spec 0008

_Steps derived from the spec's acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable
ones. A stub proves the SDK, never the handler, so the real call section stays manual on purpose. Every figure below is fixture data,
never a real price._

## Worked figures (AC-3, AC-5): read this before the build

`pricing_split` and `create_request`. Amounts are minor units, `unit` (`price_rounding_minor`) is 100. Half up means `.5` goes up.

| Price | Percent | Commission | Cash due | Why this row |
| --- | --- | --- | --- | --- |
| 350000 | 10 | 35000 | 315000 | 0007 Fixture F, first row (₺3,500) |
| 320000 | 15 | 48000 | 272000 | The design's ₺3,200 at its 15% |
| 125500 | 10 | 12600 | 112900 | 125.5 lira rounds up |
| 125400 | 10 | 12500 | 112900 | 125.4 lira rounds down |
| 350000 | 12.5 | 43800 | 306200 | Two decimal percent, 437.5 rounds up |
| 100 | 10 | 0 | 100 | Smallest price: the commission can be 0 (Follow-up, 07) |

Settings refused by the row checks: `commission_percent` 0, 100, `"10"` as a string, 10.555; `request_lead_days` 31 or 1.5;
`request_horizon_days` 0; `request_first_hour` 24; `max_open_requests` 0. Refused at commit by `request_settings_guard`: horizon 1 with
lead 2; first hour 19 with last 18; both changed together in one transaction to a valid pair: accepted. A missing `commission_percent` or
`price_rounding_minor`: `pricing_settings_invalid` from `quote_request` and `create_request`, and an alert from the action. Each of the
five request settings deleted in turn: `request_settings_invalid` from `request_catalog` and `create_request`, and an alert.
`regions.timezone` set to `Mars/Olympus`: refused. `commission_percent` 10.50 reads back as `"10.5"` in the snapshot.

## Schedule (AC-7, AC-8)

Dates relative to the local date in `Europe/Istanbul` (Turkey keeps one offset all year), settings 1, 14, 8, 18.

| Date | Hour | Result |
| --- | --- | --- |
| today | 10 | `schedule_invalid` (lead 1) |
| today + 1 | 8 | ok |
| today + 1 | 18 | ok |
| today + 1 | 7, 19 | `schedule_invalid` |
| today + 14 | 12 | ok |
| today + 15 | 12 | `schedule_invalid` |
| null, or hour null | | `schedule_invalid` |

A service with `hours_max` 5 starting today + 1 at 10: `scheduled_end_at` is 15:00 local, stored as 12:00 UTC.

## On the local stack

- [ ] pgTAP `12_requests` and every older file pass; `npm run verify` is green → AC-1 to AC-17
- [ ] A request for a KSA zone under a TR service: the composite key refuses → AC-2
- [ ] Each row of Worked figures through `pricing_split`, then one through `create_request`; stored `cash_due` equals the table → AC-3, AC-5
- [ ] `request_catalog` as a TR customer: no off service, no service without a formula, no `affects_pricing`, no multiplier, no
      formula id; a provider gets the same tree; anon refused → AC-4
- [ ] Each row of Schedule → AC-7, AC-8
- [ ] Address of 4 code points, 201, all spaces: `address_invalid`. Notes of 501: `notes_invalid`; notes with a phone, an email, a link:
      `contact_info_in_notes` → AC-7
- [ ] Five live requests, then a sixth: `too_many_open_requests`. Cancel one, or let one expire by moving its start back as `postgres`: a
      sixth works → AC-7
- [ ] Two sessions through `dblink` publish the fifth slot at once: one `ok`, one `too_many_open_requests` → AC-7
- [ ] `p_expected_price` one unit lower, `p_expected_commission` one unit lower: each `price_changed` with the new figures, nothing written;
      both equal: stored figures are the server's → AC-7, AC-10
- [ ] The meta test passes with exactly the one exemption; renaming another function's argument to `p_price` still fails it → AC-10
- [ ] With a customer token through REST: `POST /rest/v1/requests`, `PATCH` on `fixed_price`, `DELETE`, the same on `request_addresses`:
      each refused → AC-2, AC-10, AC-17
- [ ] Same `client_key` twice: one row, the same id back; same key with other answers: the first id back; two `dblink` sessions with one
      key at once: one row, both get its id; after a cancel: still that id; customer B with A's key: a new request → AC-7, AC-12
- [ ] As `postgres`: update `fixed_price`, `answers`, `scheduled_start_at` or `customer_id` on a request, update or delete an address row:
      each refused by the guards; an address row naming another customer than its request: refused by the composite key → AC-2, AC-3
- [ ] `p_expected_price` null: `price_changed`. The source test fails if `p_expected_` appears in an `insert` → AC-10
- [ ] Notes of only NBSP and zero width spaces: stored null. An address line padded with spaces: stored trimmed → AC-7
- [ ] Rename the service and the zone after publishing: list and detail still show the names at posting → AC-9, AC-13
- [ ] `/requests?after=garbage`: page 1. 25 requests: page 2 has 5 and none repeated → AC-13
- [ ] Rate limit, `quotes_per_hour` set to 60: 60 `quote_request` calls work, the 61st refuses `too_many_quotes`; move `window_start` back
      an hour as `postgres`: the next works and the count is 1. Past the limit, `create_request` refuses and creates nothing; a replay of
      an existing `client_key` still returns its id. Two `dblink` sessions racing the 60th slot: one works. A customer token calling
      `quote_price` directly: refused. `select`, `insert`, `update` on `quote_counters` as a customer: no row, refused, none changed;
      deleting `quotes_per_hour`: `request_settings_invalid` → AC-28
- [ ] `cancel_request` with reason `bored`: `validation_failed`; an admin cancelling another customer's request: `not_found` → AC-15
- [ ] Publish, then publish a new formula version, rename a question label, retire a question, change `commission_percent`: the request's
      figures and snapshots are unchanged → AC-9
- [ ] `cancel_request`: another customer's id `not_found`; a cancelled one by its owner `ok`; a request set to `SELECTED` as `postgres`
      `not_cancellable`; the audit row has no notes or address → AC-15, AC-18
- [ ] RLS: customer B reads none of A's requests or addresses; admin reads A's request and no address; a provider and anon read none →
      AC-17
- [ ] Unit: `createRequestAction` with a mocked `pricing_settings_invalid` raises the alert, with `price_out_of_range` only logs → AC-11
- [ ] Unit: the scrubber redacts `line`, `address_line`, `notes`, `answers` at any depth → AC-18

## In the browser (`/check verify`, 360, 390, 430, 1280 px, `tr` first, then `ar`, `en`)

- [ ] `/requests/new`: category chips, service cards, questions in order, addons with prices, district chips, line, day and hour chips,
      notes; the price card says what is missing until the district and required questions are set → AC-6, AC-19
- [ ] Change an answer quickly three times: the card ends on the last answer's price → AC-6
- [ ] The card shows the job price, the fired lines, the online part and the cash part; no escrow words → AC-20
- [ ] Review step: every answer label in the page's locale, start, expected end, the hour estimate, district, line, notes; Back to edit
      keeps everything → AC-8, AC-19
- [ ] Change the formula as admin while on review, then publish: the new figures show and ask again → AC-22
- [ ] Publish: lands on `/requests/[id]` with the success line; the row is in `/requests` under All and Active → AC-13, AC-14, AC-22
- [ ] Repeat from the detail page: everything but the date prefilled, a fresh price → AC-16
- [ ] Cancel: the dialog says nothing was paid; the row moves to Closed → AC-15
- [ ] `/requests/<another customer's id>`, `/requests/not-a-uuid`: 404 → AC-14
- [ ] As a provider: all three pages send you to your own home → AC-23
- [ ] PostHog shows `request_posted` with `repeated` only; a forced server error in Sentry carries no address, notes or answers →
      AC-18, AC-25

## Real calls (a preview on the shared cloud project, after the migration push)

Test rows stay in the cloud, because nothing here can be deleted, until G3 wipes the project (R4).

- [ ] Cloud accepted the migration; security advisors clean → AC-1, AC-17
- [ ] With a fixture service a real admin published (0007's first row): a real customer token publishes and the stored figures are
      350000, 35000, 315000 → AC-3, AC-27
- [ ] With a real customer token and the public key only → AC-10, AC-17, AC-27:
      - `select` on another customer's request and address: no rows
      - `POST` and `PATCH` on `requests` and `request_addresses`: refused
      - `create_request` with `p_expected_price` one unit lower: `price_changed`
- [ ] With the anon key: `request_catalog`, `quote_request`, `create_request` refused → AC-17, AC-27
