# 0008. Post a request: rationale

Decision record for [index.md](index.md). `/develop` does not need this file.

## Context

> ⚠️ Premise note: the scope is honestly about a day and a half against the owner's pace of one position a day, because the
> owner brought the commission split into 04 and kept the detail page. 02 (PR #26) and 03 (`feat/03-catalog-pricing`) are not
> merged, so 04 cannot start its build until both land. Launch is 2026-11-20 with no buffer (R2).

This is the first position that writes a customer's money figures and their exact address. Forces that shaped it:

- **The APIs are public.** A signed in customer holds a real token and can call `/rest/v1` directly, so whatever writes a
  request must not take a figure from the caller. 0007 already moved the engine into Postgres for this reason (D121).
- **The service role stays out of request paths** (door rule), so the write must be a definer function the customer runs.
- **The price card must show the split** (`docs/design/README.md`, S24 list) and the owner wants the real figures now, while
  the fee settings were planned for 07.
- **0007's tamper meta test** refuses any customer function with a money named argument, yet 0007's follow up asks 04 to
  refuse `price_changed`, which needs the figure the customer saw.
- **The zone changes the price and the customer chooses it** (0007 follow up). There is no geocoding and no admin capacity.
- **The address is personal data under KVKK** and must stay hidden from every provider until both fees are paid (rule 2);
  10 builds that reveal, and 04 must leave it one policy away.
- **`s4`, `s5` still draw the escrow copy** (S24 not done). The newer live file `Aldebyani Web Mockups.html` (a bundled copy,
  checked 2026-11-14) still says "deducted from the provider's share on release".
- **The design has no time zone source**: `regions` has no time zone column, and the slots are local hours.

## Options considered

### Where a request is written

**One definer function that prices, splits and inserts (chosen).** `create_request` calls `quote_price` and `pricing_split`
in its own transaction.

- Pros: no caller can supply a stored figure; price and request commit together; no service role; one place to test.
- Cons: a long PL/pgSQL function; the meta test needs one named exemption for the compare only arguments.

**A Server Action with the service role inserts after `quotePrice`.** Simpler SQL, TypeScript logic.

- Pros: easier to read; Zod at the edge.
- Cons: a service role in a request path (door rule); quote and insert in two transactions, so a price can move between them.

**Insert under RLS with a trigger that overwrites the figures.** The customer inserts a row; a trigger recomputes.

- Pros: no RPC; PostgREST insert.
- Cons: every column becomes writable by grant, a trigger silently replaces what the caller sent, and `price_changed` cannot
  be refused cleanly.

### How the customer reads the catalog

**A definer function returning one tree (chosen).** `request_catalog()`.

- Pros: one call per page; formulas, modifiers, `affects_pricing` and multipliers never leave the database; no table policy
  widened.
- Cons: a large JSON payload; a second query shape to keep equal to `quote_price`'s question set.

**Read policies on active catalog rows.** Customers `select` the five catalog tables directly.

- Pros: plain PostgREST queries.
- Cons: column grants per role to hide multipliers and `affects_pricing`; five round trips; the bookable rule repeated in
  TypeScript.

### Where the address lives

**One row per request (chosen, owner 2026-11-14).** `request_addresses`, 1 to 1, never edited.

- Pros: the reveal in 10 is one policy on one table; a revealed address can never change under a provider; repeat copies it.
- Cons: no address book; the customer types the line again unless they repeat.

**A saved address book.** `addresses` owned by the customer, reused.

- Pros: faster for regular customers.
- Cons: edit rules so a revealed address stays fixed; a picker UI; more RLS.

## Rationale

The definer function is the only shape where the stored figures never pass through anything the caller controls and the
request commits atomically with its price, which is exactly what the public API force and rule 6 demand. The named meta test
exemption is safe because the two expected figures are only compared: a lower value refuses, an equal value stores the
server's own number, and a test proves both. Comparing only the formula version, the runner up, would miss a zone, addon or
setting change, each of which moves the price silently.

The district picker inside the address keeps the form in the design's order and makes the zone part of where the job is. The
owner accepted the risk that a customer picks a cheaper district; it surfaces at the reveal as a problem report, and no cheap
check exists without geocoding. The address table being separate from `requests` is what lets 05 show the district from
`requests.zone_id` without any PII, and 10 add one policy.

Freezing the commission at posting follows rule 6 (amounts computed once and stored) and matches the price, which is also
fixed at posting. Rounding it to the price unit keeps the cash due whole, which suits cash in hand.

## Calls made while writing

Each is a small call the design needed. The runner up is named.

| Call | Why | Runner up |
| --- | --- | --- |
| The zone sits on `requests`, the line on `request_addresses` | 05 shows the district with no PII read; the owner's "district in the address" is the form's order | `zone_id` on the address row |
| `regions.timezone` | Slots are local hours and `regions` has no zone; `make_timestamptz` keeps time zone maths out of TypeScript | A constant per region in `lib/region` |
| The start travels as a date and an hour | The database builds the timestamp in the region's zone; nothing to forge or misparse | An ISO string from the browser |
| `client_key` per form, unique with the customer | A double tap must not post twice; the stored id is the replayed response | No key, a disabled button only |
| The open cap counts live `OPEN` only | Expired requests are not live and would block a regular customer | Count every `OPEN` |
| The cap race is serialised by locking the caller's `profiles` row | Two parallel publishes could both pass the count | An advisory lock keyed on the customer |
| Expected price and commission both compared | Both are shown on the card; a percent change moves only the commission | Price only |
| `answers` keeps only asked keys, blanks removed | The snapshot must read back the same as what priced | Store the raw submission |
| Address line not scanned for contact details | It is revealed only after both pay; a phone there leaks nothing early | Scan it like notes |
| Notes scanned with `has_contact_info` | Notes reach providers before the reveal in 05 | No scan until 05 |
| "Expired" is a reading, not a state | §21 has no such state, and no job runs in 04 | A new `EXPIRED` status |
| Repeat drops answers that are no longer valid | A retired question or a removed option would fail the quote | Refuse the repeat |
| Tabs All, Active, Closed | Only `OPEN` and `CANCELLED` exist in 04; the design's four tabs name escrow states | The design's four tabs |
| No public reference number | A running number shows customers the platform's volume; the posted date is enough | An identity column shown as `#8412` |
| Admins post through the same pages, by URL | The owner allowed admin posting; no menu row keeps the admin console clean | An admin only form |
| Only `request_posted` as analytics | §17 lists it; the analytics rule allows no id, price or text | Also a cancel event |
| Scrubber keys `line`, `address_line`, `notes`, `answers` | An action payload in an error report would carry the address | Rely on the regex scrubbers |
| e2e seeds a fixture catalog as `postgres` | 03's admin journey already proves the admin path; 04's journey needs a known price | Build the catalog through the admin pages in every run |
| Quote rate limit: 60 per user per fixed hour, in a counter table, counted inside the definer functions (amended 2026-11-15, D142) | A customer can rebuild a private formula from many quotes, because every fired line returns its match, amount and factor. 60 is a starting value: one form takes about 15 quotes (one per answer change after the 400 ms wait, plus addons and the district), so two full forms with edits fit with room; tune after the real calls (S17). A fixed window is one row and one upsert. It slows a script; it cannot stop a patient one, which the owner accepted | A sliding window log of every quote (more rows, exact), or limiting only in the Server Action (a direct RPC call skips it) |
| Number questions render chips up to 8 values | The design draws rooms as chips; a long range needs a field | Always a number field |

## Cross check

2026-11-14, on Sonnet (the author is Opus), read only, from the spec text and the 03 branch's SQL. Verdict before fixes: not ready to
build, 13 gaps and 10 soundness points. The owner chose to apply every recommended fix:

- **Fixed defects**: cross row settings rules moved to a deferred constraint trigger and the time zone check to a trigger (a check cannot
  read two rows or a view); names on list and detail come from snapshots (customers read no catalog table); the lock now comes before the
  idempotency lookup; the address carries a composite key on `(request_id, region, customer_id)`; `requests_guard` and
  `request_addresses_guard` hold immutability even against `postgres`.
- **Closed gaps**: `request_settings_invalid`; argument types and null rules (`is distinct from`, role from `profiles`); `catalog_trim`
  and `pricing_answer_blank` reused; the catalog JSON shape and order; `trim_scale` for the percent text; an opaque microsecond cursor;
  tab predicates in the query; the eight states and the cancel column checks; admin cancel scope and reason validation; fallback for an
  unbookable `?service=`; `price_changed` reuses the quote shape; the meta test exemption keyed on the argument pair with a source check;
  `for no key update` on the lock; KVKK follow up widened to answers; 05 warned off a whole row policy.
- **Kept, against a suggestion**: an opaque quote token instead of the named exemption. The owner had picked the exemption, and the
  source check plus the pair key close the risk the critic named.

## Owner answers (2026-11-14)

Two steps on one page · district picker in the address · one address row per request · commission into 04 (stored at
publish, whole lira half up, seeded at 10 and unconfirmed) · tomorrow to 14 days, hourly 08:00 to 18:00 · named exemption for
the expected figures · no expiry job · open cap 5 · notes as a request column · category chips then services · cancel with an
optional reason · repeat as a prefilled form · a minimal detail page · admin reads requests, not addresses · district plus one
line · no daily limit (recommended was 10 a day) · customers and admins may post (recommended was customers only) · data model
confirmed · no References section.
