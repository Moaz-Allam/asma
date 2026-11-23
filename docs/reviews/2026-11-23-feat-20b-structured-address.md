# Review · feat/20b-structured-address (PR #77) · 2026-11-23

Reviewer: `/check review`, a different model from the author (Sonnet reading Opus's work). Read only, no code changed.
Spec: `docs/specs/0011-choose-to-launch/0011-20b-structured-address.md`. Diff: `git diff master...HEAD` at `4b2ae01`.
Not repeated here: the findings in `2026-11-23-feat-20b-structured-address-security.md`.

**Recommendation: fix then ship.** The money, privacy and RLS parts are sound. Two refusal codes never reach the user
because they are missing from the allowlists, which breaks one acceptance criterion in the UI (the contact scanner on
the address, and `address_required` at apply). Both are one line fixes with a test.

Checked here and passing: `tsc --noEmit` clean; `lint:rtl` clean; `messages/ar|tr|en.json` have the same keys, every new
`tr` string carries the `[tr]` marker, every new `ar` string is Arabic; `tests/structured-address.test.ts`,
`tests/observability-scrub.test.ts`, `tests/security-headers.test.ts` pass (197 tests).

## Findings

| id | severity | file:line | issue | fix | resolution |
| --- | --- | --- | --- | --- | --- |
| R20b-1 | High | `lib/requests/index.ts:59-104` (`REQUEST_DB_CODES`) | `address_parse` raises `contact_info_in_address` and `pin_invalid`, but neither is in the list `refusalCode()` accepts. A customer who types a phone number into the street, or sends a bad pin, gets an unmapped error: `createRequest` rethrows, Sentry gets a report, and the form shows the generic `action_failed`. The scanner is the one address rule only Postgres checks (the browser skips it, `parts.ts` says so), so this is the main server refusal and its message (`Requests.errors.contact_info_in_address`, `FIELD_CODES` in `RequestForm.tsx`) is dead. Breaks AC-3 and AC-11 in the UI. No test catches it: `tests/structured-address.test.ts` only reads the browser check | Add `'pin_invalid'` and `'contact_info_in_address'` to `REQUEST_DB_CODES`. Add a unit test that every code `create_request` and `address_parse` raise is in the list, and an e2e step: post with a phone number in `street` and expect the field message | fixed |
| R20b-2 | High | `lib/provider-feed/constants.ts:29-68` (`PROVIDER_FEED_DB_CODES`) | `apply_to_request` raises `address_required` (migration line 807), the message `ProviderFeed...errors.address_required` exists (`messages/en.json:1441`), but the code is not in `PROVIDER_FEED_DB_CODES`. `refusal()` in `lib/provider-feed/index.ts:68` returns null, so an approved provider with no address who taps Apply causes a thrown error and a Sentry report instead of "Add your address before you send an offer". Breaks AC-5 ("an approved provider with no address is asked once") at the apply step. pgTAP 14 proves the database refusal only | Add `'address_required'`. Add a unit test over the list, and an e2e: an approved provider with no address applies and sees the message and the link to `/provider/profile/address` | fixed |
| R20b-3 | Medium | `app/[locale]/(provider)/provider/feed/page.tsx:48-54` | `myAddressInDb()` sits in the `Promise.all` with no `.catch`, so one failed read of an optional banner takes the whole feed page down. The profile page does it right (`reportServerError` then `undefined`). The banner also shows to every standing (draft, pending, suspended), while AC-5 says an approved provider | Catch like the profile page and hide the banner on failure. Show it only when `standing === 'approved'` (a draft is already sent to the address step by onboarding) | fixed (catch, approved only) |
| R20b-4 | Medium | `lib/maps/AddressMap.tsx:63` | `instance.on('error', onFail)`: MapLibre fires `error` for any failed tile, glyph or sprite request, including a single network blip or an aborted tile. `MapPicker` then sets `mapFailed` for good and swaps the map for the "unavailable" note until the sheet is reopened. A pin the customer was placing is lost from view. The read only card map has no `onFail`, so a real failure leaves an empty box | Call `onFail` only for a style or auth failure (an error before `load`, or `event.error.status` 401/403/404 on the style URL); log other errors at most. Give the read only map a fallback (show the Open in Maps link, which is already there) | fixed (fails only before load; the card keeps Open in Maps) |
| R20b-5 | Low | migration `address_part_ok`, the zone checks; `lib/address/parts.ts` `CONTROL`, `EDGE_SPACE` | S20b-3's fix is correct for the ranges it lists (verified: the `\u` escapes work inside an ARE bracket, pgTAP 45 lines 205 to 208 probe a bidi override, an isolate, a zero width space and a BOM). It still leaves out other invisible format characters: U+061C (Arabic letter mark, a bidi control that matters here because `ar` is a launch locale), U+2028 and U+2029, U+00AD, U+180E, U+FFF9 to U+FFFB, U+E0000 to U+E007F. The same list is copied in four places (function, two zone checks, the client regex) | Add `؜  ­᠎￹-￻` (and the tag block) to all four, with a pgTAP probe for U+061C. Edit the migration in place: it is not in the cloud yet | fixed (tag block left out: astral, refused by no form) |
| R20b-6 | Low | `lib/address/parts.ts:8` | `z.config({ jitless: true })` is a module level, global side effect. The module is also imported on the server (`lib/requests/schemas.ts`, `lib/provider/db.ts`), so every zod schema in the process loses its JIT, not only the browser ones the CSP comment is about. Harmless for correctness, a small cost on hot parses | Set it only in the client entry (a `'use client'` module that already runs first in the browser), or in `lib/browser/` | accepted: the JIT gains nothing at our sizes |
| R20b-7 | Low | `lib/observability/scrub.ts` `isPathPrivateUrl`, `scrubUrl` | Verified S20b-1 and S20b-2: a MapTiler URL keeps only origin plus the first path segment in `scrubUrl`, in span `description` and `data.url`, fetch and xhr breadcrumbs are dropped, and `shouldCreateSpanForRequest` skips the origin; the tests cover forward, reverse and tile paths. Two edge gaps: the origin match is exact, so `https://api.maptiler.com:443/...` or a URL with userinfo is not treated as path private (the library never emits these today), and browser tracing's own `resource.*` spans come from the Performance API, not from `shouldCreateSpanForRequest`, so they rely on `scrubSpan` alone | Match on the parsed `URL.origin` (a default port normalises away). Add a test with a `resource.fetch` span for a tile URL | carry over (G-1) |
| R20b-8 | Low | `components/shared/ContactCard.tsx` (customer branch), `request_contacts` | The customer's "provider address" is read from the agreement content. If `queue_agreement` returns null (a broken path, the code comment says the caller alerts), `provider_address` is null and the card prints "Not given" although the provider has an address. That reads as a fact, not as a missing record | Print a different note (such as "Being prepared") when the agreement row is missing but the provider has an address, or fall back to the live row only while the agreement is absent. Accept if the alert is judged enough | carry over (the agreement alert covers it) |
| R20b-9 | Nit | `lib/requests/schemas.ts:1-2` | `import { StoredAddress } ...` was placed above `import 'server-only'`; the guard import should come first so a client import of this file still fails at once | Move `server-only` to the top | fixed |
| R20b-10 | Nit | `lib/maps/MapPicker.tsx` | The pin can be set only by click, tap or drag; a keyboard user cannot place it and Use my location is the only non pointer route. AC-11 allows this (the typed fields are complete without the map) | Accept, or add arrow key nudge to the marker later | accepted |
| R20b-11 | Info | CSP, `lib/maps/AddressMap.tsx` | Every map and geocoding call is stubbed in e2e (as the spec says). The real service has not been exercised against the new CSP (`connect-src`, `worker-src blob:`, `img-src blob:`), the `streets-v4` style name, or the domain locked key (S46) | Add one real call check on the preview deployment before launch, as done for earlier positions (an owed AC row) | carry over (S46 real call) |

## Acceptance criteria

| AC | State |
| --- | --- |
| AC-1 zone il and ilçe, trigger, never blocks posting | Met. `zone_place_required` mapped in `lib/catalog/writes.ts`, message present |
| AC-2 structured row, frozen il and ilçe, immutable | Met (shape, pin pair and pin box checks, the 04 guard untouched) |
| AC-3 posting with parts, old overload dropped, scanner | Met in Postgres. **UI refusal path broken: R20b-1** |
| AC-4 fields first, map optional, remove pin | Met. R20b-4 on the map's failure handling |
| AC-5 provider address, save, read, submit and apply gates, audit | Met in Postgres. **Apply refusal not mapped: R20b-2**; banner: R20b-3 |
| AC-6 reveal, rule 2 | Met. `request_contacts` gates on `contacts_visible` before any read; the provider's pin never leaves the provider and admin; the customer gets only the agreement's frozen copy; the direct read policy is dropped; `provider_addresses` has RLS, a deny policy, no grants and no delete or truncate |
| AC-7 admin, audited reads | Met. Reason in `audit_log` only, audited before the data returns |
| AC-8 agreement, `draft-2` | Met (new keys optional, `draft-1` still parses, `draft-1` off and `draft-2` on in one transaction) |
| AC-9 old rows fall back to `line` | Met (shape check allows an all null parts row) |
| AC-10 map door, key, CSP, geolocation header | Met (lint rules with proofs, lazy imports, header test). R20b-11 owed |
| AC-11 three locales, RTL, phone first | Met on keys, markers and logical classes. Not seen at runtime in this review |
| AC-12 tests | pgTAP 45 is thorough (zone, rules, scanner, freeze, RLS, reveal per party, admin, agreement, old row). Missing: the two UI refusals above |

## Rules that never bend

No break found. Rule 1 and 4 untouched (no price field added; the pin and parts are not priced). Rule 2 holds (see AC-6).
Rule 7: `provider_addresses` has RLS, a policy and its pgTAP in the same migration; every new definer pins
`search_path` and revokes `public`, `anon`, `authenticated` and `service_role` before granting `authenticated` only to
the callable ones. Rule 10: labels in the reader's locale, logical classes, values never case folded on the server
(`placeFold` is a browser note only). Rule 3: our server never calls MapTiler.

## Carry over from the security review (not repeated)

S20b-4 (no rate limit on `save_provider_address`), G-2 (lint ban on `.from('provider_addresses'|'request_addresses')`
outside the door), G-3 (an allowlist test of functions naming the two tables) are still open and stay as carry overs.
S20b-1, S20b-2 and S20b-3 are fixed in `4b2ae01` and verified (R20b-5 and R20b-7 only widen them).
