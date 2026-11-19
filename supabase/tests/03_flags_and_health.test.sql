-- Position 00b, spec 0004: the money flags per region, KSA switched off, and the health ping.
--
-- The negative cases are the point: a string under an `_enabled` key, anon reading a flag, a
-- signed in user who is not an admin flipping one. AC-10, AC-14, AC-15.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(25);

-- ── KSA is switched off (AC-15) ──────────────────────────────────────────────
SELECT is(
  (SELECT active FROM public.regions WHERE code = 'KSA'),
  false, 'KSA is inactive until a Saudi PSP is chosen (D22, D70)'
);
SELECT is(
  (SELECT active FROM public.regions WHERE code = 'TR'),
  true, 'TR stays active'
);

-- ── the flags, per region (AC-14, AC-15; 07 deleted the four escrow flags, D95; 08 added
--    payments_enabled, seeded off by its migration and turned on for TR by the local seed only, so its
--    TR value is not pinned here: supabase/tests/20 proves the fail closed reading; 13 added emails_enabled
--    the same way, proved in supabase/tests/29) ──
SELECT results_eq(
  $$ SELECT region, key, CASE WHEN key IN ('payments_enabled', 'emails_enabled') AND region = 'TR' THEN 'null'::jsonb ELSE value END
       FROM public.platform_settings
      WHERE right(key, 8) = '_enabled'
      ORDER BY region, key $$,
  $$ VALUES ('KSA', 'auto_close_enabled', 'false'::jsonb),
            ('KSA', 'emails_enabled', 'false'::jsonb),
            ('KSA', 'notifications_enabled', 'false'::jsonb),
            ('KSA', 'payments_enabled', 'false'::jsonb),
            ('TR',  'auto_close_enabled', 'false'::jsonb),
            ('TR',  'emails_enabled', 'null'::jsonb),
            ('TR',  'notifications_enabled', 'true'::jsonb),
            ('TR',  'payments_enabled', 'null'::jsonb) $$,
  'two money flags per region: notifications TR on, KSA off; payments KSA off'
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
  $$ UPDATE public.platform_settings SET value = '"true"' WHERE region = 'TR' AND key = 'notifications_enabled' $$,
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
  (SELECT value FROM public.platform_settings WHERE region = 'TR' AND key = 'notifications_enabled'),
  'true'::jsonb,
  'a signed in user reads a flag live (the isEnabled path, AC-14)'
);
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'notifications_enabled';
RESET ROLE;
SELECT is(
  (SELECT value FROM public.platform_settings WHERE region = 'TR' AND key = 'notifications_enabled'),
  'true'::jsonb,
  'a signed in user who is not an admin cannot switch a flag off'
);

-- Rule 7's negative tests for the other two writes the grant allows (review 2026-10-29): a DELETE
-- would turn a feature off (the read finds no row), an INSERT of a missing flag as true would turn
-- one on. Only the admin policy stops both, so both are proven here.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1", "role": "authenticated", "app_metadata": {}}';
DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'notifications_enabled';
SELECT throws_ok(
  $$ INSERT INTO public.platform_settings (region, key, value) VALUES ('KSA', 'wallet_enabled', 'true') $$,
  '42501', NULL,
  'a signed in user who is not an admin cannot add a flag'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.platform_settings WHERE region = 'TR' AND key = 'notifications_enabled'),
  1,
  'a signed in user who is not an admin cannot delete a flag'
);

-- Who is admin comes from profiles.role, never the token (D116, migration 20261111120000).
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
VALUES ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', '905550000002', now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
VALUES ('00000000-0000-0000-0000-0000000000a2', 'admin', 'TR', '+905550000002', 'Flag Admin', 'en')
ON CONFLICT (id) DO UPDATE SET role = 'admin';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "role": "authenticated", "app_metadata": {"role": "admin"}}';
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'notifications_enabled';
RESET ROLE;
SELECT is(
  (SELECT value FROM public.platform_settings WHERE region = 'TR' AND key = 'notifications_enabled'),
  'false'::jsonb,
  'an admin switches a flag off with a row update, no deploy (AC-14)'
);

SELECT * FROM finish();
ROLLBACK;
