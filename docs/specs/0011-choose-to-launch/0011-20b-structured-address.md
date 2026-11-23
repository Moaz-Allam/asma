# 0011-20b. Structured addresses and a map pin (position 20b, P1)

Child of [0011](index.md). Follows the cross child contract there. **Touches personal data (both parties' addresses and an
exact map pin), the reveal (10), the provider's onboarding (02), the post request form (04), the service agreement
(20), admin's audited address read (16) and the CSP: a migration (zone columns, address columns, one new table,
functions), a new map door `lib/maps`, five surfaces.** Built after [0011-20](0011-20-service-agreement.md) merged,
on its own branch, before 21 (D225).

> **Accepted 2026-11-23 by the owner (D229)**, after a Sonnet cross check (X-1 to X-23 applied). Written 2026-11-23 from the owner's picks in the `/architect 20b` interview (each the recommended option, except two
> owner calls: the map is optional and the typed fields come first; the provider's address is also shown to the
> customer after the reveal). A scope change outside the brief, recorded as D225.

## Summary

The request address stops being one free line. The customer types it in Turkish parts (mahalle, street, building
number, optional floor, apartment, postal code and directions), with il and ilçe taken from the district they picked.
A map is optional: opening it, searching or using the phone's location and dropping a pin fills the fields, which stay
editable. Providers give their own address at onboarding. Both addresses and the pin stay hidden until both fees are
paid (rule 2), then show to the other party, and print on the service agreement (template `draft-2`).

## Requirements

**User stories**:
- As a customer, I want to type my address in the parts a Turkish address has, and optionally drop a pin, so that the
  provider finds my door without a call.
- As a provider, I want the exact address and a map link once both of us have paid, so that I can plan the trip.
- As either party, I want the other side's address on the agreement, so that the record names both.

**Prerequisites**: 20 and its review fixes merged (PR #73, #74). Branch `feat/20b-structured-address`. The owner creates
a MapTiler key (S46) before the map shows anywhere but locally; without a key the typed fields work alone.

**Acceptance criteria**:

- **AC-1, il and ilçe on the zone**: `zones` gains `il` and `ilce` (text, trimmed, 2 to 60 characters, Turkish proper
  names). The admin catalog's zone editor (`/admin/catalog`, Zones tab) edits both; an active `TR` zone cannot be saved without
  them (a trigger on active TR zones, not a check, X-7). A zone still without them never blocks posting: the address
  stores `il` and `ilce` as null and the composed line leaves them out until admin fills the zone (S47, X-7).

- **AC-2, the structured request address**: `request_addresses` keeps `line` and gains `il`, `ilce` (copied from the
  zone at creation, frozen: a later zone edit never changes a posted address), `mahalle`, `street`, `building_no`
  (required for new rows), `floor`, `apartment`, `postal_code`, `directions` (optional), and `lat`, `lng` (optional, both
  or neither). For new rows `line` is composed by Postgres from the parts (*Address composition*), so every reader that
  shows one line keeps working. The row stays immutable (04's guard): fixed once posted; a wrong address means cancel
  and post again.

- **AC-3, posting with parts**: `create_request(uuid, uuid, uuid, uuid[], jsonb, date, integer, text, text, bigint,
  bigint)` is dropped and created again with `p_address jsonb` in place of `p_address_line` (grants written again, no
  old overload left). Postgres checks each part (*Address rules*): `mahalle`, `street`, `building_no` required;
  `postal_code` five digits when given; `directions` at most 300 characters; `lat` and `lng` together, inside the
  region's bounds (TR: latitude 35.5 to 42.5, longitude 25.5 to 45.0), six decimals. The free text parts (`mahalle`, `street`,
  `directions`) each pass the contact scanner (no phone, email or link), refusing `contact_info_in_address`; the number
  parts (`building_no`, `floor`, `apartment`, `postal_code`) are checked only against their own formats, never joined
  into a scan (X-2). Other refusals:
  `address_invalid` (a missing or malformed part), `pin_invalid`. Every caller changes in the same position: `lib/requests`
  `createRequest`, its input schema, the post request form, the regenerated `lib/db/database.types.ts`.

- **AC-4, the form: fields first, the map optional**: the post request form shows il and ilçe read only (from the chosen
  zone) and the part fields; the address is complete with the fields alone. A **Pick on the map** button opens the map
  (a sheet on a phone, a panel from `lg`), centred on the zone's ilçe (one forward geocode of `"<ilçe>, <il>"`). On the
  map: a **search box** (forward geocoding, debounced 300 ms, country `tr`, language `tr`, at most 5 results), **Use my
  location** (the browser asks permission; a refusal shows a short note and nothing else), and a draggable pin. When the
  pin settles (dropped, a search result chosen, or the location found), one reverse geocode fills `mahalle`, `street`,
  `building_no` and `postal_code` with what the geocoder returned (a part it did not return keeps what was typed), and
  stores `lat`, `lng`. Every field stays editable after. If the geocoder's ilçe differs from the zone's ilçe, a polite
  note says so (the price follows the zone); nothing is blocked. **Remove pin** clears `lat` and `lng`. No key, a
  network error or a geocoder failure hides the map button or shows a short note; the fields always work.

- **AC-5, the provider's address**: a new table `provider_addresses` (one row per provider) holds `il`, `ilce`,
  `mahalle`, `street`, `building_no` (required), `floor`, `apartment`, `postal_code` (optional), `lat`, `lng` (optional),
  with the same rules and scanner as AC-3 (no `directions`). A provider has no zone, so `il` and `ilce` are typed (or
  filled by the map's reverse geocode). It is written only by `save_provider_address(p_address jsonb)` and read by its
  provider through `my_provider_address()`. The onboarding profile step (02) gains the address with the same form
  component (map optional); `submit_provider_file` refuses `address_required` without it. An approved provider with no
  address is asked once: `apply_to_request` refuses `address_required`, and the feed shows a banner linking to the
  profile. A provider may change the address any time (an agreement already made keeps its frozen copy, AC-8); each change
  writes an `audit_log` row `provider.address_changed` (ids only).

- **AC-6, the reveal (rule 2)**: nothing of either address or the pin reaches the other party before both fees are paid.
  `request_contacts` (replaced) returns, only while `contacts_visible` holds (both fees paid, an approved provider, the
  contacts window, as today):
  - to the chosen provider: the customer's parts, `line`, `directions`, and `lat`, `lng`;
  - to the customer: the provider's composed address **as frozen into the agreement content at the reveal** (X-6), so a
    later edit by the provider never makes the card and the agreement disagree; "not given" when the provider had none
    (X-14). The provider's pin is never shown to anyone but the provider and admin.
  The provider's contact card shows the address, the pin on a read only `AddressMap` (no static image endpoint, X-5)
  and an **Open in Maps** link (`https://www.google.com/maps/search/?api=1&query=<lat>,<lng>`, `rel="noopener
  noreferrer"`, X-5); with no pin, the link searches the composed line. The customer always
  sees their own address and pin on the request page, as today's own street line.

- **AC-7, admin**: `admin_request_address` (replaced) returns the parts and the pin with the line, still audited with a
  reason as in 16. `admin_provider_address(p_provider_id, p_reason)` returns a provider's address after writing an
  `audit_log` row `provider.address_viewed` (reason in `audit_log` only), shown on demand on the admin provider page.

- **AC-8, the agreement**: the content frozen at the reveal (20's `queue_agreement`, replaced) adds `customer_address`
  (the composed customer line: the parts, or the old `line` for a request posted before 20b), `customer_directions` (X-3)
  and `provider_address` (the composed provider line, or null with no row), and keeps `street_line`. The three new keys
  are optional in `AgreementContentSchema`, so `draft-1` content still parses (X-4). The template field list
  (`agreement_field_names`) gains `customer_address`, `customer_directions` and `provider_address`. A migration adds template **`draft-2`** for
  TR (every text `[draft] `), printing both addresses and the customer's directions, and makes it the active one in one statement (`draft-1` off and `draft-2` on together, X-4); `draft-1`
  stays for picks that already accepted it (20's AC-3: the customer's version binds). The renderer prints `NOT_GIVEN` for
  a missing value.

- **AC-9, requests posted before 20b**: their rows keep the single `line` and null parts and pin; every reader (the
  request page, the contact card, admin, the agreement) falls back to `line`. No backfill.

- **AC-10, the map door and configuration**: a new door `lib/maps/` is the only module that imports `maplibre-gl` and
  `@maptiler/client` or reads `NEXT_PUBLIC_MAPTILER_KEY` (lint enforced with proofs, like the other doors). The key is
  public by design and locked to our domains in MapTiler (S46); `lib/env.ts` treats it as optional. Map code loads only
  on the client and only when opened (a dynamic import), never in the first page bundle. `Permissions-Policy` changes `geolocation=()` to
  `geolocation=(self)` with a header test (X-1). The CSP adds `https://api.maptiler.com` to `connect-src` (tiles, styles, glyphs and geocoding are all fetched; the map's worker
  already fits `worker-src blob:`). Every call goes from the browser to MapTiler: no geocoding in our server request path
  (rule 3's spirit).

- **AC-11, three locales, phone first**: every new string in `ar`, `tr`, `en` (Turkish with the `[tr]` marker until the
  translator); the address field labels are in the reader's locale, the values stay as typed. 390px first, logical
  properties, axe clean. The map is a progressive extra: the whole address is enterable by keyboard without it; the map
  dialog has a labelled close, search and location buttons, and announces the filled fields.

- **AC-12, tests**: pgTAP `45_structured_address.test.sql` (the zone columns and the `zone_unavailable` refusal; each
  address rule and the scanner; `il`/`ilce` frozen from the zone; RLS and grants on `provider_addresses`; the reveal for
  each party, a stranger, the other applicant and a suspended provider; admin's two audited reads; `address_required` at
  submit and apply; the agreement content and `draft-2` active; an old row's fallback). Tests 10 (the function
  allowlist), 12, 14, 16, 23 and 42 updated in the same change. Unit tests for the geocoder result mapping (`lib/maps`),
  the address composition, and the input schemas. e2e `structured-address` at 390px in three locales: post with typed
  fields only; post with the map (MapTiler answered by a Playwright route stub, never the real service in CI); a provider
  adds the address at onboarding; after both pay, each side sees the other's address and the provider the Open in Maps
  link; the agreement PDF's text holds both addresses.

## Cross check resolutions (Sonnet, 2026-11-23, owner: "apply the recommended fixes")

Binding for the build; the ACs above already carry X-1 to X-7 and X-14.

- **X-8**: callers of the old `create_request`: `lib/requests/index.ts`, `input.ts`, `prefill.ts` (`addressLine`),
  `RequestForm.tsx`, `database.types.ts`, the scrubber (`p_address`), and the `RequestDetail` read (`.select('line')`,
  now the parts). Post again copies the parts, never the pin. `p_address` is guarded: an allow list of keys (unknown keys
  refused), string values except `lat` and `lng`, at most 4096 bytes.
- **X-9**: parts are trimmed and an empty string becomes null; `lat` and `lng` are JSON numbers; more than six decimals,
  a string pin or one of the two alone is `pin_invalid`; `address_invalid` covers a missing required part, a control
  character, or a length outside the column's range.
- **X-10**: `request_catalog` (last in `20261117090000`) returns `il` and `ilce` on each zone; its zod schema,
  `loadRequestCatalog` and test 09 change with it.
- **X-11**: `provider_addresses` has RLS on, no API grant and a deny policy; only `save_provider_address`,
  `my_provider_address`, `request_contacts` and `admin_provider_address` touch it; a guard refuses delete and truncate;
  tests 00 and 02 cover it.
- **X-12**: dropped and created: `create_request`. Replaced in place, revokes and grants written again:
  `apply_to_request(uuid, text, jsonb, text)`, `submit_provider_file()`, `request_contacts(uuid)`,
  `admin_request_address(uuid, text)`, `request_catalog()`. Internal, revoked from every role: `queue_agreement`,
  `agreement_field_names`, `compose_address` (immutable). New, granted to `authenticated`: `save_provider_address`,
  `my_provider_address`, `admin_provider_address`. Tests 10 and 02 list them.
- **X-13**: onboarding gains an **Address** step after the profile step (`save_provider_profile` keeps its six
  arguments); `submit_provider_file` adds `address` to its missing list; approved providers without one see the feed
  banner and `address_required` at apply.
- **X-15**: the zone editor trims `il` and `ilce` and requires them (one zod schema for browser and server); names are
  stored as typed and never compared with `lower()` (rule 10); the form's ilçe mismatch note compares with a Turkish
  aware fold in the browser only. `il` and `ilce` join the zones column grants and the catalog audit trigger.
- **X-16**: `compose_address` tests the suffix with `~* '(mah\.|mahallesi|mh\.)$'`, never `lower()`; it adds no street
  suffix; `line`'s length check becomes 1 to 300, with a test that every part at its maximum fits.
- **X-17**: the geocoder mapping is unit tested against recorded MapTiler responses saved as fixtures; the feature types
  mapped are named in `lib/maps/geocode.ts`; `maplibre-gl` and `@maptiler/client` are pinned at build, the MapLibre CSS
  imported inside the map component only.
- **X-18**: `draft-2` is `draft-1`'s seven sections plus an address paragraph naming `{{customer_address}}`,
  `{{customer_directions}}` and `{{provider_address}}`; the renderer already wraps 300 characters; agreement unit tests
  and e2e text checks update.
- **X-19**: `provider_history` and `provider_jobs` never read `line`; `request_contacts` and `admin_request_address`
  (and `admin_request_detail` if it reads it) are the readers to change.
- **X-20**: the policy `request_addresses_read_unlocked` (if present) is dropped: the chosen provider reads the address
  and the pin only through `request_contacts`; pgTAP proves a direct select returns nothing.
- **X-21**: the centring geocode is never stored and never feeds the price; the browser checks the same pin bounds as the
  server and shows `pin_invalid` inline; a failed map call shows `map_unavailable`.
- **X-22**: a CSP test row for `api.maptiler.com`; the e2e fails on any console CSP error with MapTiler stubbed.
- **X-23**: the scrubber gains `address`, `mahalle`, `street`, `building_no`, `directions`, `lat`, `lng`, `p_address`;
  `provider.address_changed` carries ids only; the provider's address follows 21's account deletion rules.

## Decision

**Chosen option**: typed Turkish address parts as the source of truth, with an optional MapLibre map on MapTiler tiles
and geocoding called from the browser to fill them; il and ilçe from the zone; the parts and the pin in the private
address tables behind the existing reveal; the provider's address in its own table; agreement template `draft-2`.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`,
`.claude/skills/supabase-postgres-best-practices/`) · `supabase` (same repo, `.claude/skills/supabase/`) · `maptiler`
(`maptiler/maptiler-skills`, to vendor into `.claude/skills/maptiler/` at the start of `/develop 20b`, after a line by
line review, pinned to a commit) · `shadcn` (`shadcn-ui/ui`, `.claude/skills/shadcn/`, the sheet and the fields)

## Rationale

*Why fields first.* The owner's call: most customers know their address and type it faster than they place a pin;
Turkish geocoding (any provider) misses some mahalle and building numbers, so a pin can only suggest. Making the fields
the record and the map a helper keeps the address right when the map is wrong, absent, or blocked.

*Why MapTiler and MapLibre.* MapTiler processes in the EU (Switzerland), matching D62's EU data rule and the KVKK case
better than a US provider; its free tier covers a pre launch marketplace; MapLibre GL JS is the open source map library
under it, so the map code is not locked to one vendor. Runner up: Google Maps Platform (the best Turkish address data,
but a US transfer of coordinates and higher cost past its free caps). Owner's pick.

*Why the browser calls MapTiler.* A public key locked to our domains is how map providers are meant to be used; a server
proxy would put an external call in our request path (rule 3's spirit), add latency and cost, and hide nothing worth
hiding. The address only reaches our server when the customer posts it.

*Why il and ilçe from the zone.* The zone already sets the price; letting the address name another district would let
the two disagree. Freezing them into the address row keeps a posted address stable when admin edits a zone.

*Why the provider's address in its own table.* It changes with the provider (they move), while a request address is
frozen; one row per provider, written by one definer function, read through the reveal and admin's audited view,
follows the street line's pattern.

*Owner picks* (the `/architect 20b` interview, 2026-11-23): MapLibre and MapTiler; the browser calls MapTiler; the map
optional and the fields first (owner's own wording); mahalle, street and building number required; the provider's
address at onboarding and before an approved provider's next apply; the provider's address also shown to the customer
after the reveal (owner's call over agreement and admin only); il and ilçe from the zone; the pin seen like the street
line; template `draft-2`; old requests keep their line; a search box and Use my location; the address fixed once posted;
the MapTiler skill vendored.

*Recommended calls made while writing*: (1) the composed Turkish line format (*Address composition*), so one string
reads the same on every surface and the PDF; (2) six decimals for the pin (about 0.1 m) in `numeric(9,6)`; (3) the
geocoder's ilçe mismatch is a note, never a block (the price follows the zone, and geocoders get district boundaries
wrong); (4) the provider's pin is never shown to the customer (a home location the customer does not need);
(5) `@maptiler/client` for geocoding and MapLibre with a MapTiler style URL for the map, not the heavier `@maptiler/sdk`;
(6) the Open in Maps link uses a coordinates only URL so no request id or name rides in it; (7) versions pinned at
`/develop` time with the project's rule (the newest release at least a week old, recorded in AGENTS.md).

## Feature design

**Data model sketch**:

| Table | Column | Type | Null | Notes |
| --- | --- | --- | --- | --- |
| `zones` | `il`, `ilce` | text | yes | trimmed, 2 to 60; required by the catalog for TR; `create_request` refuses a null |
| `request_addresses` | `line` | text | no | kept; composed from the parts for new rows (5 to 200 today; raised to 300) |
| | `il`, `ilce` | text | yes | copied from the zone at creation; null only on rows before 20b |
| | `mahalle`, `street` | text | yes | required for new rows; 2 to 80 |
| | `building_no` | text | yes | required for new rows; 1 to 10 (`12`, `12/A`) |
| | `floor`, `apartment` | text | yes | 1 to 10 |
| | `postal_code` | text | yes | `^[0-9]{5}$` |
| | `directions` | text | yes | at most 300 |
| | `lat`, `lng` | numeric(9,6) | yes | both or neither; inside the region's bounds |
| `provider_addresses` | `provider_id` | uuid | no | pk, fk `providers(id)` |
| | `region` | text | no | fk; the provider's region |
| | `il`, `ilce`, `mahalle`, `street`, `building_no` | text | no | as above |
| | `floor`, `apartment`, `postal_code` | text | yes | as above |
| | `lat`, `lng` | numeric(9,6) | yes | both or neither |
| | `updated_at` | timestamptz | no | set on each save |

Constraints and guards: the part checks are table checks (a direct write cannot skip them); `request_addresses` stays
immutable (04's guard); `provider_addresses` changes only through `save_provider_address` (no API write grant). RLS on
`provider_addresses` with its provider reading their own row and nothing else for any API role (rule 7, negative tests
in the same migration).

**Address composition** (Postgres function `compose_address`, one place, used for `line`, the contact card and the
agreement): `<mahalle> Mah.` (the suffix added unless the name already ends in `Mah.` or `Mahallesi`), `<street>`,
`No: <building_no>`, `Kat: <floor>` and `Daire: <apartment>` when given, then `<postal_code> <ilçe>/<il>`, joined by
`, `. Example: `Caferağa Mah., Moda Cad., No: 12, Kat: 3, Daire: 5, 34710 Kadıköy/İstanbul`. Directions are never in the
line; they print beside it.

**Address rules** (in Postgres, the client checks the same for messages): trimmed; no control characters; the lengths
above; the contact scanner on each text part and on all of them joined; `postal_code` five digits; the pin both or
neither and inside the region's bounds (`TR`: latitude 35.5 to 42.5, longitude 25.5 to 45.0).

**Geocoder mapping** (`lib/maps/geocode.ts`, unit tested): the reverse result's features and their context are read by
type: the neighbourhood (mahalle) to `mahalle`, the street (or the address feature's street) to `street`, the house
number to `building_no`, the postal code to `postal_code`, the municipal district to the ilçe compared with the zone's;
the exact type names come from MapTiler's response (the vendored skill and its docs), verified at build. Values are
trimmed and cut to the column limits; nothing else from the response is kept.

**State transitions**: a request address: typed (and optionally pinned) in the form → posted (frozen). A provider
address: none → saved → changed (each change audited). Visibility: hidden → visible to the other party while
`contacts_visible` holds → hidden again when the contacts window closes.

**API surface**:

| Function or action | Kind | Key inputs | Key outputs | Auth | Key errors |
| --- | --- | --- | --- | --- | --- |
| `create_request(..., p_address jsonb, ...)` | replaced | the parts, the pin | as 04 | customer | + `address_invalid`, `pin_invalid`, `contact_info_in_address`, `zone_unavailable` |
| `save_provider_address(p_address jsonb)` | definer | the parts, the pin | `{ok}` | provider (own) | `address_invalid`, `pin_invalid`, `contact_info_in_address` |
| `my_provider_address()` | definer, read | none | the parts or null | provider (own) | |
| `submit_provider_file()` | replaced | as 02 | as 02 | provider | + `address_required` |
| `apply_to_request(...)` | replaced | as 19b | as 19b | provider | + `address_required` |
| `request_contacts(p_request_id)` | replaced | request | + the other side's address (and the customer's pin to the provider) | either party, while visible | as 10 |
| `admin_request_address(p_request_id, p_reason)` | replaced | as 16 | + parts and pin | admin, audited | as 16 |
| `admin_provider_address(p_provider_id, p_reason)` | definer | provider, reason | the parts and pin | admin, audited | `forbidden`, `not_found`, `validation_failed` |
| `queue_agreement`, `agreement_field_names` | replaced, internal | as 20 | + `customer_address`, `provider_address` | none | |
| `createRequestAction`, `saveProviderAddressAction` | Server Actions | the parts, the pin | as before / ok | customer / provider | stable codes |
| `lib/maps` `forwardGeocode`, `reverseGeocode`, `AddressMap` | client door | text or a point | candidates, parts, a map | browser | `map_unavailable` |

**Value sourcing**:

| Action | Value produced / displayed | Source |
| --- | --- | --- |
| Form | il and ilçe shown | the chosen zone's `zones.il`, `zones.ilce` (through `request_catalog`, replaced to return them) |
| Form, map | the map's first centre | one forward geocode of `"<zones.ilce>, <zones.il>"` |
| Form, map | the parts filled by a pin | MapTiler's reverse geocode of the pin (`lib/maps` mapping) |
| Form, map | the pin | the map's marker position (drag, search result, or `navigator.geolocation`) |
| Post | `il`, `ilce` stored | `zones` at creation (never the client) |
| Post | every other part and the pin | `p_address`, checked by Postgres |
| Post | `line` | `compose_address` of the stored parts |
| Provider card | the customer's address, pin, directions | `request_addresses` through `request_contacts` while `contacts_visible` |
| Customer card | the provider's address | `provider_addresses` through `request_contacts` while `contacts_visible` |
| Open in Maps | the URL | the stored `lat`, `lng` (or the composed line when no pin) |
| Agreement | `customer_address`, `provider_address` | `compose_address` of the two rows at the reveal, frozen into `content` |
| Admin | a request's or provider's address | the replaced and new audited functions |

**Key invariants**:
- No address part or pin of either party reaches the other before both fees are paid, and never a provider other than
  the chosen one (rule 2).
- `il` and `ilce` on a posted request come from its zone, never from the client.
- A posted request address never changes; a provider's change never alters an agreement already made.
- Our server makes no call to MapTiler; only the browser does.

**Security model**: the parts and the pin are personal data (KVKK), kept in the private tables (`request_addresses`,
which only its customer reads today, and `provider_addresses`, which only its provider reads); the other party reads
them only through `request_contacts` while `contacts_visible` holds; admin only through the two audited functions with
a reason. No API role writes either table directly. The map key is public and domain locked; the browser sends MapTiler
the search text and the pin the person chose (to be named in the privacy notice, S16). The scrubber treats `address`,
`mahalle`, `street`, `building_no`, `directions`, `lat`, `lng` and `p_address` as personal keys. Logs and alerts carry ids
only.

**Configuration required**: `NEXT_PUBLIC_MAPTILER_KEY` (optional; the map hides without it), set in Vercel and the local
env file by the owner (S46), locked to `aldebyani.vercel.app`, the preview pattern and the real domain in MapTiler's
dashboard, with a usage alert there. The CSP's `connect-src` gains `https://api.maptiler.com`.

**Critical test scenarios**:
- Happy path: a customer types the parts, posts; a second customer pins on the map, the fields fill, edits one, posts;
  after both pay the provider sees the address, the pin and Open in Maps, the customer the provider's address, and the
  agreement prints both, verifies **AC-2** to **AC-4**, **AC-6**, **AC-8**.
- Failure case: no key, a geocoder error and a refused location each leave the typed fields working, verifies **AC-4**.
- Failure case: a phone number in the directions, a pin outside Turkey, a five digit rule broken, each refused with its
  code, verifies **AC-3**.
- Auth: a stranger, the other applicant, a suspended provider and anyone before both paid get no address or pin; admin's
  reads are audited, verifies **AC-6**, **AC-7**.

## Build plan

Tracer Bullet: one address from typed parts to the provider's card first (columns, `create_request`, the form fields,
`request_contacts`), then the map, the provider's address, admin, and the agreement.

1. Migration `20261206090000_structured_address.sql`: the zone columns; the address columns and checks; `compose_address`;
   `provider_addresses` with RLS, the deny paths and negative tests; `create_request` dropped and created with
   `p_address`; `request_catalog`, `request_contacts`, `admin_request_address`, `submit_provider_file`,
   `apply_to_request`, `queue_agreement`, `agreement_field_names` replaced; `save_provider_address`,
   `my_provider_address`, `admin_provider_address`; template `draft-2` active; pgTAP 45 first, tests 10, 12, 14, 16, 23,
   42 updated. Satisfies **AC-1** to **AC-3**, **AC-5** to **AC-9**, **AC-12**.
2. `lib/requests` and the post request form with the typed parts (no map yet); the request page and the contact card
   showing the parts (and the old line fallback); regenerated types. Satisfies **AC-2**, **AC-3**, **AC-6**, **AC-9**.
3. Vendor the MapTiler skill; pin `maplibre-gl` and `@maptiler/client`; `lib/maps` (the door, the lint rule and its
   proofs, the geocoder mapping, the `AddressMap` component loaded on demand); the CSP; the form's Pick on the map with
   search and Use my location; the provider card's static map and Open in Maps. Satisfies **AC-4**, **AC-6**, **AC-10**,
   **AC-11**.
4. The provider's address in onboarding and on the profile, the feed banner, `address_required`. Satisfies **AC-5**.
5. Admin: the zone editor's il and ilçe, the request page's parts and pin, the provider page's audited address.
   Satisfies **AC-1**, **AC-7**.
6. The agreement: the renderer and its unit tests for the new fields, `draft-2`'s text. Satisfies **AC-8**.
7. e2e `structured-address` (MapTiler stubbed), unit tests, the local gate, `/check verify`. Satisfies **AC-11**, **AC-12**.
8. Reviews (`security-reviewer` for PII and the reveal, `/check review` on another model), fixes, the migration pushed
   after a dry run right before the merge (the old build calling `create_request` with a line is refused, so the deploy
   follows the push at once), and the owner fills `il` and `ilce` on the cloud zones (S47) before posting works again.

## Consequences

**Positive**:
- Providers get a findable address and, when given, an exact pin; fewer "where are you" calls before a job.
- The agreement names both parties' addresses in the Turkish form an authority expects.
- The map is an extra: a blocked, failing or keyless map never stops a request.

**Negative / tradeoffs**:
- `create_request` changes signature again; the old build is refused until it redeploys.
- Existing cloud zones need `il` and `ilçe` filled by admin before new requests post (S47).
- A new vendor (MapTiler) with its own key, usage limits and a privacy notice line; the browser sends it the search text
  and the pin.
- Two map packages in the bundle (loaded only when opened), and a vendored skill to keep current.
- Approved providers without an address cannot apply until they add one.

**Neutral**:
- Requests posted before 20b keep one line.
- KSA keeps the single line until its own address shape is decided.

## Follow-up

- [ ] S46 (owner): a MapTiler account and a key locked to our domains, with a usage alert; `NEXT_PUBLIC_MAPTILER_KEY` in
  Vercel and the local env file.
- [ ] S47 (owner, at the merge): fill `il` and `ilçe` on each TR zone in `/admin/catalog`.
- [ ] S16 (owner's lawyer): name MapTiler (EU) and the map pin in the privacy notice; the `draft-2` text with the lawyer's
  version later.
- [ ] Spec 0011-20 gains a note that 20b adds `customer_address` and `provider_address` (D225); `/architect` folds D226,
  D227 there too.
- [ ] `AGENTS.md` (`/sync`): `lib/maps` as a door, the map packages and versions in the stack table, the vendored MapTiler
  skill, the declined MapLibre skills and the third party MCP servers.
- [ ] KSA's address shape before KSA opens.
- [ ] `ui-registry.md`: `AddressFields`, `AddressMap`, the contact card's map.
