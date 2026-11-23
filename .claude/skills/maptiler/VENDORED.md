# Vendored: maptiler

- Source: `maptiler/maptiler-skills` @ `cba6dc657495a0c2b28f7c542b09f1ed3bb28795`, path `skills/`, MIT (`LICENSE.md`).
- Vendored 2026-11-23 for spec 0011-20b (the optional map and geocoding), position 20b.

## Kept

- `SKILL.md`, byte for byte. It is documentation only: no installer, no command that runs on load, no instruction
  aimed at the agent beyond API key hygiene.
- `references/cloud-api-geocoding.md`, `references/cloud-api-authentication.md`, `references/cloud-api-maps.md`, byte for byte.

## Left out

- Every other reference (mobile SDKs, weather, static maps, tiles, admin API and the examples): 20b does not use them.
- `.claude-plugin/`, the update workflow and its script, `README.md`, the logo.

## Overrides (spec 0011-20b wins)

- The skill recommends `@maptiler/sdk` over raw MapLibre. We use `maplibre-gl` 6.18.0 with a MapTiler style URL and
  `@maptiler/client` 3.2.0 for geocoding (spec 0011-20b Decision, recommended call 5). No `@maptiler/sdk`, no CDN script.
- Only `lib/maps/` imports the map packages or reads `NEXT_PUBLIC_MAPTILER_KEY` (lint).
- The geocoder's place types for Turkey were recorded on 2026-11-23 (`tests/fixtures/maptiler/`): mahalle is
  `municipal_district`, ilçe is `joint_municipality`, il is `county`. `region` is the geographic region, never the il.
