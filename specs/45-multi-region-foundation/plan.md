# 45 Multi-region foundation

Status: **reviewed**
Date: 2026-08-18

```
FEATURE   45 Multi-region foundation
INTENT    Region becomes a real, queryable dimension — so every table feature 02
          and 03 create can carry it from birth rather than be retrofitted.
ACTORS    admin (reads settings) · every later feature (FKs against it). No customer
          or provider surface yet.
TRIGGER   Nothing at runtime. This is schema + convention.
OUTCOME   `regions` and `platform_settings` exist with RLS and tests; the migration
          template, a CI check and a pgTAP test make a region-less table impossible
          to ship from here on.
NOT DOING Adding a `region` column to profiles/requests/... — THOSE TABLES DO NOT
          EXIST YET (see open question 3). No auth, no catalog, no money.
```

## Ground truth

- **Phase 1**, order `01 → 45 → 02 → 50 → 03 → 04`. Feature 01 is closed and pushed.
- **Blockers:** none block this. B4/B3/B5/B6 are downstream. **B2/B9 do not gate schema.**
- **Decisions consumed:** D14 (one deployment, `region` column), D15 (admins global — no
  `admin_region`), D16 (phone dial code must match region), D13 (seed defaults per region).
- `supabase/migrations/` currently holds only the template. **No table exists.**

## Rules engaged

| Rule | How this respects it |
| --- | --- |
| **7** — RLS + negative test | Both new tables get RLS **and** a policy **and** a pgTAP negative test in the same migration. The schema-wide "RLS enabled everywhere" test starts having something to check |
| **4 / 6** — money | No money moves, but this establishes `(region, currency)` as the grouping key every later invariant uses. `regions.currency` is the single source |
| **10** — locales | `regions.default_locale` — but see **open question 1**, which is blocking |
| **D14** | Region is a row value. `lib/region` already throws if asked to read it from env |
| **D15** | Admin policies carry **no** region predicate |

## Design questions

**Data.** Two tables.

`regions` — reference data, not user data:
`code` PK (`TR`|`KSA`), `currency`, `default_locale`, `psp_provider`, `dial_code`, `active`, `created_at`.
Seeded by the migration itself. **RLS: readable by any authenticated user, writable by nobody** —
adding a region is a migration, never a runtime insert, exactly like `ledger_accounts`.
*Negative case the test proves:* an authenticated non-admin `INSERT`/`UPDATE` on `regions` is denied.

`platform_settings` — `(region, key)` composite PK, `value jsonb`, `updated_at`, `updated_by`.
**RLS: read by authenticated, write by admin only.** Keyed on `(region, key)` because commission,
unlock fee, hold period and both windows differ per market (G24 — with `key` alone, changing TR's
commission silently changed KSA's).
*Negative case:* a non-admin `UPDATE` is denied; a customer reading another region's settings is
denied only if question 2 says region is a read boundary.

Indexes: `platform_settings(region)`; FK `platform_settings.region → regions.code`.

**State.** n/a — no request lifecycle.

**Money.** Nothing moves. But this is where `(region, currency)` becomes the grouping key for every
later invariant (G25). Seeds `regions.currency` so no later code has to guess.

**PII.** n/a — neither table holds user data.

**Concurrency.** n/a at runtime. Migration is single-shot and idempotent (`on conflict do nothing`
on the seed rows) so a re-run cannot duplicate a region.

**Trust.** Nothing client-supplied. Admin writes to `platform_settings` come later (feature 07);
this feature ships the table and the policy, not a UI.

**Failure.** A missing region row means every FK insert fails loudly — correct. There is no silent
degradation path here, which is the point.

**Verification.** pgTAP: RLS enabled on both · policies exist · non-admin write denied on each ·
seed rows present with the right currency · `platform_settings` FK rejects an unknown region.

## Most likely failure mode

**Feature 03 creates fifteen tables and quietly omits `region` on three of them.** Nothing fails —
the tables work, queries return rows, tests pass. The gap only surfaces when the second market goes
live and a KSA user sees a TR zone, by which point every one of those tables has data and adding a
`NOT NULL` FK means a backfill under load.

This feature's real deliverable is therefore **not the two tables — it is making the omission
impossible.** Three mechanisms, because a convention alone will not survive fifteen tables in one
migration:
1. The migration template already enforces order; add `region` to its skeleton with a comment saying which tables are exempt and why.
2. A **CI check**: any `CREATE TABLE` in `supabase/migrations/` whose name is not on an explicit exempt list must have a `region` column. Exemptions are a visible list, not a silent omission.
3. A **pgTAP test** asserting the same against the live schema, so a table created outside a migration is caught too.

Secondary: writing an `admin_region` predicate out of habit, which D15 explicitly removed.

## Migration

`supabase/migrations/<ts>_regions_and_settings.sql` — tables, RLS, policies, constraints, indexes,
seed rows, in the template's mandatory order.

## Server

`lib/region/index.ts` already exists and needs reconciling with the table (**open question 2**).
No new Server Actions — nothing to call yet.

## Outbox events

**None.**

## UI

**None.** No screen. `ui-registry.md` unchanged.

## Tests

| Test | Proves |
| --- | --- |
| pgTAP: RLS enabled on `regions` and `platform_settings` | Rule 7 |
| pgTAP: non-admin write to `regions` denied | Reference data is migration-only |
| pgTAP: non-admin write to `platform_settings` denied | Admin-only writes |
| pgTAP: `platform_settings` FK rejects region `'XX'` | Referential integrity |
| pgTAP: seed rows exist — TR/TRY/iyzico, KSA/SAR/paytabs | Seeds match `lib/region` |
| vitest: `REGION_CONFIG` matches the seeded values field-for-field | Code and table cannot drift |
| CI: a `CREATE TABLE` without `region` and not on the exempt list fails | The failure mode above |

## Definition of Done

- [ ] Both tables: RLS + policy + negative test in the **same** migration
- [ ] `region` CI check live and proven to fail on a bad fixture
- [ ] `lib/region` reconciled with the table shape
- [ ] `supabase test db` green
- [ ] `npm run verify` green
- [ ] `progress-tracker.md` updated

## Decisions

| Decision | Reason | Reversible |
| --- | --- | --- |
| `regions` is migration-only reference data | Adding a market is a deploy, not a runtime action — same reasoning as `ledger_accounts` | Yes |
| 45 ships the *convention enforcement*, not the columns | The tables it would annotate do not exist yet | — |
| Seed rows in the migration, `on conflict do nothing` | Re-running a migration must not duplicate a region | Yes |

## Open questions — all resolved 2026-08-18

1. ✅ **Locale URLs: always prefixed (D19).** `as-needed` cannot express a per-region default —
   one unprefixed route can only mean one language, and region is unknown until login. `/` is now a
   negotiation endpoint. Applied: `routing.ts`, `i18n.md` §4 + L1/L3, D13 defaults row.
2. ✅ **The table is the source of truth.** `regions` gains `dial_code` (D16) and `active`.
   `REGION_CONFIG` mirrors it field-for-field and says so; `active` stays out of the constant because
   deactivating a region is live state, not a compile-time fact. Two tests assert they match.
3. ✅ **Scope confirmed: tables + enforcement only.** The `region` columns land in 02 and 03, where
   those tables are born, held to it by the CI check this feature ships.

## Out of scope

- `region` columns on profiles/providers/requests/etc — they belong to the migration that creates
  each table (02, 03), enforced by this feature's CI check.
- Auth, catalog, money, UI.
- Localised content columns (feature 46).
