# Verify: Catalog and pricing engine (03) · spec 0007

_Steps derived from the spec's acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable
ones. A stub proves the SDK, never the handler, so the real call section stays manual on purpose. Every figure below is fixture data,
never a real price._

## Worked figures (AC-5, AC-6, AC-8): read this before the build

The pgTAP table. Amounts are minor units, `unit` is 100, the multiple is 20.

**Fixture F**: base 120000. Modifiers in order: (1) `rooms` `always` `PER_UNIT` 40000, (2) `bathrooms` `always` `PER_UNIT` 25000, (3) `property_type`
`equals` `villa` `MULTIPLIER` 1.30, (4) `has_pets` `is_true` `FIXED` 20000, (5) `property_type` `equals` `studio` `FIXED` -40000. Addon `windows` 40000.
Zones Z1 1.00, Z2 1.15.

| Case | Input | Working | Price |
| --- | --- | --- | --- |
| The design's own figure | F, rooms 3, bathrooms 2, apartment, pets, windows, Z1 | 120000 + 120000 + 50000 + 20000 + 40000 | 350000 |
| Half up after a zone | F, rooms 3, bathrooms 2, villa, pets, windows, Z2 | 290000 × 1.30 = 377000, + 20000, + 40000 = 437000, × 1.15 = 502550 | 502600 |
| Order counts | F as above, no windows, Z1 | 377000 + 20000 | 397000 |
| Order counts, swapped | Same, with (4) moved before (3) | (290000 + 20000) × 1.30 | 403000 |
| Discount | F, rooms 1, bathrooms 1, studio, no pets, no addon, Z1 | 185000 - 40000 | 145000 |
| One rounding | Base 1040, three `always` `MULTIPLIER` 1.10 | 1040 × 1.331 = 1384.24. Rounding each step would give 1300 | 1400 |
| Half up exactly | Base 100050, no modifiers | 1000.5 units | 100100 |
| At the ceiling | Base 100000, `MULTIPLIER` 10 and 2 | 2000000 is the limit | 2000000 |
| Over the ceiling | Base 100000, `MULTIPLIER` 10 and 2.01 | 2010000 | `price_out_of_range` |
| Rounds to nothing | Base 30 | 0.3 units | `price_out_of_range` |
| Discount to nothing | Base 100, `FIXED` -100 | 0 | `price_out_of_range` |
| Tier | Base 100000, `rooms` `range` 3 to 5 `PER_UNIT` 10000, rooms 4 | 100000 + 40000 | 140000 |
| Tier missed | Same, rooms 6 | Fires nothing | 100000 |
| Multi select | Base 100000, `FIXED` 5000 `equals` `a`, 7000 `equals` `b`, 9000 `in` `b`, `c`, chosen `a`, `b` | + 5000 + 7000 + 9000, once | 121000 |
| Empty multi select | Same formula, optional question, `[]` | No answer, fires nothing | 100000 |

## Answers refused (AC-7)

Each through a direct `quote_price` call: an unknown key; a required question missing, sent as null and as a string of NBSP; `"3"` for a number; 11 on a question up
to 10; 4 on min 1, step 2; an option `castle`; a multi select naming `a` twice; `2026-02-30`; `25:00`; text one character over its limit; a text answer with a phone
number; `p_answers` as an array; two faults at once returns both, sorted by key.

## `lib/money/parse.ts` (AC-22)

| Call | Result |
| --- | --- |
| `parseMinor('1200')` | 120000 |
| `parseMinor('1200.50')`, `parseMinor('1200,50')`, `parseMinor('1200٫50')` | 120050 |
| `parseMinor('١٢٠٠')`, `parseMinor('۱۲۰۰')` | 120000 |
| `parseMinor('0.05')` | 5 |
| `parseMinor('-400')` where a sign is allowed | -40000 |
| `parseMinor('1000000.01')`, `1.200,50`, `12.345`, `1e3`, a blank | Refused |
| `formatMinor(120050)`, `formatMinor(-40000)`, `formatMinor(5)` | `1200.50`, `-400`, `0.05` |
| `parseFactor('1,3')`, with 4 decimals allowed | `1.3` |
| `parseFactor('1.23456')`, with 4 decimals allowed; `parseFactor('1.234')`, with 2 | Refused, never rounded |

## On the local stack

- [ ] pgTAP: `09`, `10` and every older file pass; `npm run verify` is green → AC-1 to AC-15
- [ ] A KSA category and a TR service under it: the composite key refuses → AC-1
- [ ] Label with no `tr` on a TR row, a blank value, an unknown locale key: refused. Open in `ar` with `ar` missing: the Turkish shows → AC-2
- [ ] `affects_pricing` on a `text` question refused. A `number` with no min, max or step refused, one branch at a time. Two questions with one key in a category
      refused, including a retired one → AC-3
- [ ] With an admin token through REST: `PATCH questions` on `key` or `type`, `DELETE` on any catalog row, `PATCH pricing_formulas`: each refused → AC-3, AC-14
- [ ] As `postgres`: `update` of a published `base_price`, `delete` of a modifier: refused by `pricing_history_guard` → AC-12
- [ ] A question in the active formula: switch off, drop `affects_pricing`, drop `required`, remove a matched option: each `question_in_use`. Publish a version
      without it: all four work. An optional `multi_select` in a formula: allowed → AC-4
- [ ] Each row of Worked figures, through `pricing_evaluate` and through `quote_price` → AC-5, AC-6, AC-8
- [ ] Each case of Answers refused → AC-7
- [ ] Delete `price_rounding_minor`: `pricing_settings_invalid`, no price. Writing `"100"` as a string, 0, or 100001: refused by the check. `max_price_multiple` of 0 or
      1001: refused → AC-8
- [ ] Unit tests with a mocked refusal: `quotePrice` raises the alert on `pricing_settings_invalid` and only logs `price_out_of_range` → AC-8, AC-24
- [ ] `quote_price` for a service in an off category, in another region, with no formula; an off zone; a null zone; an addon of another service; one addon twice:
      each its code, in the stated order. A null addon list: priced with none → AC-9
- [ ] `quote_price` on answers that leave a modifier unfired: no line for it in the breakdown. The same draft in a preview: the line, `fired` false → AC-9, AC-13
- [ ] The tamper meta test fails on a scratch function with a `p_price` argument → AC-10
- [ ] Publish with a stale version: `stale_formula`. Two sessions: one wins. An unchanged draft: `no_changes`. An off service: publishes. Old versions unchanged after
      three publishes, one `active` → AC-12
- [ ] Each formula error of the spec through publish, a factor of `1.23456` and an amount of `100.5` among them: nothing written, the right card shows it → AC-12, AC-20
- [ ] A preview and the quote after publishing the same draft: equal output. A preview with an off zone, an off addon, and no zone at all: priced → AC-13
- [ ] A customer, a provider and anon on each of the seven tables: `select` returns no rows, `update` changes none, `insert` is refused → AC-14
- [ ] A demoted admin with a live token: `saveZone` on an existing row returns `forbidden`, and the row is unchanged → AC-14
- [ ] Each change on each of the five tables: one audit row with `to_jsonb` of old and new. A save that changes nothing: none. A publish: `pricing.formula_published` with
      `{ version, base_price }` → AC-15
- [ ] The rail from `lg`; on a phone the bottom bar stays three tabs, and `/admin` links to both pages → AC-16
- [ ] `?category=x&tab=y`, `?service=x`: fall back, no error. An empty region: each empty state → AC-17, AC-20
- [ ] Each question type through `QuestionBuilder`. Key, type and scope read only on edit → AC-18
- [ ] Service state chip in all three states, a service on under a category off reading `off`. The link from `no formula` opens that service → AC-19
- [ ] Reorder modifiers: the panel's figure follows. Only legal match types and effects are offered per question type. A draft changing `1.30` to `1.3`: Publish stays
      "Published, no changes" → AC-20
- [ ] The panel opens with no total. Answer every required priced question: the total shows, with the note that no zone means ×1. Type fast on a slow network: the
      newest figure stays → AC-21
- [ ] Network log: no price computed in the browser; `MoneyDisplay` shows server figures only → AC-21, AC-22
- [ ] 360, 390, 430, 1280 px, `tr` first, then `ar`, then `en`, with no overflow on Turkish strings → AC-23
- [ ] `npm run test:e2e` with the database → AC-25

## Real calls (a preview on the shared cloud project, after the migration push)

Test rows stay in the cloud as off rows, because nothing here can be deleted, until G3 wipes the project (R4).

- [ ] Cloud accepted the migration; advisors clean → AC-1, AC-14
- [ ] A real admin publishes the first row of Worked figures on a fixture service → AC-12, AC-26
- [ ] `POST /rest/v1/rpc/quote_price` with a real customer token returns 350000 → AC-9, AC-26
- [ ] With a real customer token and the public key only → AC-10, AC-14, AC-26:
      - the same call with an extra `p_price`: refused
      - `select` on each of the seven tables: no rows
      - `PATCH` on each catalog table: no row changed
      - `POST` on each catalog table, `publish_pricing_formula`, `preview_pricing_formula`: refused
- [ ] With the anon key: `quote_price` refused → AC-14, AC-26
