-- Feature 45 — regions and platform_settings.
--
-- The negative cases are the point. RLS that denies nothing raises no error, and
-- reference data that anyone can rewrite is not reference data.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(14);

-- ── shape ────────────────────────────────────────────────────────────────────
SELECT has_table('public', 'regions', 'regions exists');
SELECT has_table('public', 'platform_settings', 'platform_settings exists');

SELECT col_is_pk('public', 'regions', 'code', 'regions is keyed on code');
SELECT col_is_pk(
  'public', 'platform_settings', ARRAY['region', 'key'],
  'platform_settings is keyed on (region, key) — G24: `key` alone would make TR and KSA share a value'
);
SELECT has_column('public', 'regions', 'dial_code', 'regions carries dial_code (D16)');
SELECT has_column('public', 'regions', 'active', 'regions carries active');

-- ── RLS enabled (Rule 7) ─────────────────────────────────────────────────────
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.regions'::regclass),
  true, 'regions has RLS ENABLED'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.platform_settings'::regclass),
  true, 'platform_settings has RLS ENABLED'
);

-- ── the negative cases ───────────────────────────────────────────────────────
-- regions is migration-only: a read policy exists, and NOTHING else. If someone
-- adds an INSERT/UPDATE/DELETE policy later, this fails loudly.
SELECT is(
  (SELECT count(*)::int FROM pg_policy
    WHERE polrelid = 'public.regions'::regclass AND polcmd <> 'r'),
  0, 'regions has NO write policy — adding a market is a deploy, not a runtime insert'
);

SELECT isnt_empty(
  $$ SELECT 1 FROM pg_policy WHERE polrelid = 'public.regions'::regclass AND polcmd = 'r' $$,
  'regions is readable by signed-in users'
);

SELECT isnt_empty(
  $$ SELECT 1 FROM pg_policy WHERE polrelid = 'public.platform_settings'::regclass $$,
  'platform_settings has policies (RLS on with none would deny everything silently)'
);

-- ── referential integrity ────────────────────────────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.platform_settings (region, key, value) VALUES ('XX', 'k', '1') $$,
  '23503',
  NULL,
  'platform_settings rejects an unknown region'
);

-- ── seed matches lib/region/index.ts REGION_CONFIG ───────────────────────────
SELECT results_eq(
  $$ SELECT code, currency, default_locale, psp_provider, dial_code
       FROM public.regions ORDER BY code $$,
  $$ VALUES ('KSA','SAR','ar','paytabs','+966'), ('TR','TRY','tr','iyzico','+90') $$,
  'seeded regions match REGION_CONFIG field-for-field'
);

SELECT is(
  (SELECT count(DISTINCT region)::int FROM public.platform_settings),
  2, 'both regions have their own settings — neither shares the other''s values'
);

SELECT * FROM finish();
ROLLBACK;
