-- Position 00b, spec 0004: the money flags per region, KSA switched off, and the health ping.
--
-- The negative cases are the point: a string under an `_enabled` key, anon reading a flag, a
-- signed in user who is not an admin flipping one. AC-10, AC-14, AC-15.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(23);

-- ── KSA is switched off (AC-15) ──────────────────────────────────────────────
SELECT is(
  (SELECT active FROM public.regions WHERE code = 'KSA'),
  false, 'KSA is inactive until a Saudi PSP is chosen (D22, D70)'
);
SELECT is(
  (SELECT active FROM public.regions WHERE code = 'TR'),
  true, 'TR stays active'
);

-- ── the five flags, per region (AC-14, AC-15) ────────────────────────────────
SELECT results_eq(
  $$ SELECT region, key, value
       FROM public.platform_settings
      WHERE key IN ('funding_enabled', 'unlock_enabled', 'payouts_enabled',
                    'auto_release_enabled', 'notifications_enabled')
      ORDER BY region, key $$,
  $$ VALUES ('KSA', 'auto_release_enabled',  'false'::jsonb),
            ('KSA', 'funding_enabled',       'false'::jsonb),
            ('KSA', 'notifications_enabled', 'false'::jsonb),
            ('KSA', 'payouts_enabled',       'false'::jsonb),
            ('KSA', 'unlock_enabled',        'false'::jsonb),
            ('TR',  'auto_release_enabled',  'true'::jsonb),
            ('TR',  'funding_enabled',       'true'::jsonb),
            ('TR',  'notifications_enabled', 'true'::jsonb),
            ('TR',  'payouts_enabled',       'true'::jsonb),
            ('TR',  'unlock_enabled',        'true'::jsonb) $$,
  'five money flags per region: TR on, KSA off'
);

SELECT is_empty(
  $$ SELECT key FROM public.platform_settings
      WHERE region = 'KSA' AND right(key, 8) = '_enabled' AND value <> 'false'::jsonb $$,
  'every KSA flag is false'
);

-- ── only a JSON boolean under an `_enabled` key (AC-14) ──────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', 'x_enabled', '"false"') $$,
  '23514', NULL,
  'a string under an _enabled key is rejected (the string "false" is truthy in JavaScript)'
);
SELECT throws_ok(
  $$ INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', 'y_enabled', '0') $$,
  '23514', NULL,
  'a number under an _enabled key is rejected'
);
SELECT throws_ok(
  $$ UPDATE public.platform_settings SET value = '"true"' WHERE region = 'TR' AND key = 'funding_enabled' $$,
  '23514', NULL,
  'an existing flag cannot be updated to a string either'
);
SELECT lives_ok(
  $$ INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', 'xenabled', '"text"') $$,
  'the check matches the `_enabled` suffix only: `xenabled` may hold a string'
);
SELECT lives_ok(
  $$ INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', 'z_enabled', 'false') $$,
  'a JSON boolean under an _enabled key is accepted'
);

-- ── health_ping() (AC-10) ────────────────────────────────────────────────────
SELECT is(public.health_ping(), true, 'health_ping() answers true');
SELECT ok(has_function_privilege('anon', 'public.health_ping()', 'EXECUTE'), 'anon may call health_ping()');
SELECT ok(
  has_function_privilege('authenticated', 'public.health_ping()', 'EXECUTE'),
  'authenticated may call health_ping()'
);
SELECT is(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.health_ping()'::regprocedure),
  false, 'health_ping() runs as the caller (security invoker), so it can never lift a privilege'
);

-- ── the grants are exactly the access model, on every stack (owner, 2026-10-28) ──
-- Pinned so a platform's default privileges can never widen them silently again.
SELECT table_privs_are('public', 'regions', 'anon', ARRAY[]::text[], 'anon holds no privilege on regions');
SELECT table_privs_are(
  'public', 'regions', 'authenticated', ARRAY['SELECT'], 'signed in users may only read regions'
);
SELECT table_privs_are(
  'public', 'regions', 'service_role', ARRAY['SELECT'], 'server jobs may only read regions'
);
SELECT table_privs_are(
  'public', 'platform_settings', 'anon', ARRAY[]::text[], 'anon holds no privilege on platform_settings'
);
SELECT table_privs_are(
  'public', 'platform_settings', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'signed in users read and write platform_settings, and the admin only policy decides the write'
);
SELECT table_privs_are(
  'public', 'platform_settings', 'service_role', ARRAY['SELECT'], 'server jobs may only read platform_settings'
);

-- ── anon reads no flag (security model) ──────────────────────────────────────
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT key FROM public.platform_settings $$,
  '42501', NULL,
  'anon cannot read platform_settings at all, so an anonymous flag read fails and lib/flags returns false'
);
RESET ROLE;

-- ── a signed in user reads a flag; only an admin flips one (D15) ────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1", "role": "authenticated", "app_metadata": {}}';
SELECT is(
  (SELECT value FROM public.platform_settings WHERE region = 'TR' AND key = 'funding_enabled'),
  'true'::jsonb,
  'a signed in user reads a flag live (the isEnabled path, AC-14)'
);
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'funding_enabled';
RESET ROLE;
SELECT is(
  (SELECT value FROM public.platform_settings WHERE region = 'TR' AND key = 'funding_enabled'),
  'true'::jsonb,
  'a signed in user who is not an admin cannot switch a flag off'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "role": "authenticated", "app_metadata": {"role": "admin"}}';
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'funding_enabled';
RESET ROLE;
SELECT is(
  (SELECT value FROM public.platform_settings WHERE region = 'TR' AND key = 'funding_enabled'),
  'false'::jsonb,
  'an admin switches a flag off with a row update, no deploy (AC-14)'
);

SELECT * FROM finish();
ROLLBACK;
