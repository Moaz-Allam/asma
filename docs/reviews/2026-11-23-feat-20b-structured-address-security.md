# Security review · feat/20b-structured-address (PR #77) · 2026-11-23

Reviewer: `security-reviewer` (Opus), read only. Spec 0011-20b. **Recommendation: fix then ship.** No break of rule 2.

## Confirmed

| id | severity | file:line | issue | fix | resolution |
| --- | --- | --- | --- | --- | --- |
| S20b-1 | High | `lib/observability/scrub.ts` (`scrubUrl`, `redactPath`), `lib/observability/client.ts:63`, `lib/maps/geocode.ts` | `@maptiler/client` puts the search text and the pin in the URL path (`geocoding/<query>.json`, `geocoding/<lng>,<lat>.json`). Tracing makes an `http.client` span and a fetch breadcrumb for each; `scrubUrl` drops the query but keeps the path, so Sentry stores the customer's typed address and exact location | Cut every third party URL to its origin plus the first path segment; exclude `MAPTILER_ORIGIN` in `shouldCreateSpanForRequest`; drop fetch and xhr breadcrumbs to it in `beforeBreadcrumb`; scrubber unit rows for a forward, a reverse and a tile URL | owed |
| S20b-2 | Medium | `lib/maps/AddressMap.tsx` (ContactCard at zoom 16, MapPicker at 17) | Tile paths (`/tiles/v3/16/x/y.pbf`) in spans and breadcrumbs place the customer's home to about 600 m | Covered by the S20b-1 fix; its test includes a tile URL | owed |

## Likely

| id | severity | file:line | issue | fix | resolution |
| --- | --- | --- | --- | --- | --- |
| S20b-3 | Low | migration `address_part_ok`, the zone checks | `[[:cntrl:]]` likely misses Unicode format characters (bidi overrides U+202A to 202E, U+2066 to 2069, zero width), which could make an address read differently on the card, the PDF and for admin | Confirm with a pgTAP probe, then refuse `[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]` in `address_part_ok`, the zone checks and the client `CONTROL` regex | owed |
| S20b-4 | Low | `save_provider_address` | No rate limit; each change writes an audit row, so a script can flood `audit_log` | A per provider hourly counter, like `count_application` | carry over |
| S20b-5 | Info | the number parts (X-2) | The four number parts together can carry a split phone; never breaks rule 2 (both phones are shown at the same moment) | Accept, as the spec does | accepted |

## Missing guardrails

| id | file | guardrail |
| --- | --- | --- |
| G-1 | `tests/observability-scrub.test.ts` | A meta test: any URL outside our origin and Supabase keeps only its origin and first path segment in breadcrumbs, spans and replay |
| G-2 | `eslint.config.mjs` | Ban `.from('provider_addresses')` and `.from('request_addresses')` outside `lib/requests/index.ts` |
| G-3 | `supabase/tests/02_*` | An allowlist of every function whose body names `provider_addresses` or `request_addresses` (from `pg_proc.prosrc`) |
| G-4 | migration checks | One shared check refusing Unicode format characters in every free text PII column |

## Checked and sound

The reveal (`request_contacts` through `contacts_visible`; the other applicant, a stranger, anon and a suspended
provider get nothing, pgTAP 45); the dropped direct read policy; `provider_addresses` (RLS, deny policy, no grants, no
delete); every definer pins `search_path` and the helpers are revoked; `address_parse` (shape, keys, types, size, the
pin, the scanner, table checks repeat the rules); il and ilçe from the zone; admin's reads audited with the reason only;
ids only in `request.created` and `provider.address_changed`; ContactCard (map and Open in Maps for the provider only,
`rel="noopener noreferrer"`); the MapTiler key read only in server only `lib/maps/key.ts`, our server never calls
MapTiler; CSP and Permissions-Policy; scrubber keys; PostHog autocapture and recording off; strict action schemas; post
again never copies the pin.
