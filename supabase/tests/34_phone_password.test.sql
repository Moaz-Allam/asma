-- Position 01b, spec 0012 (D199, D201): phone and password sign in, the database guards.
--
-- password_guard in every branch of AC-8: an insert never keeps a password, an Auth write that does not change it
-- changes nothing (no audit row, has_password untouched), a new password on an unproven phone or on an account with
-- no profile yet is blanked (D201), a kept one sets has_password and password_changed_at and writes auth.password_set
-- then auth.password_changed. phone_fixed. The grants, and two meta tests: every public trigger function on auth.users
-- is a locked definer, and no other public function writes has_password or password_changed_at. has_password survives
-- complete_onboarding and promote_to_admin. The mail map of AC-10 as amended by
-- D201: both actions queue password_changed to a confirmed address, and a new account (no confirmed address) gets none.
--
-- Fixture users go straight into auth.users, as Auth writes them; the triggers run on these writes exactly as on
-- Auth's own.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(57);

CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003400' || p)::uuid $$;
CREATE FUNCTION pg_temp.meta(p text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT raw_app_meta_data FROM auth.users WHERE id = pg_temp.u(p) $$;
CREATE FUNCTION pg_temp.pw(p text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encrypted_password FROM auth.users WHERE id = pg_temp.u(p) $$;
CREATE FUNCTION pg_temp.audits(p text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(action, ',' ORDER BY id), '') FROM public.audit_log
   WHERE entity_type = 'auth_users' AND entity_id = pg_temp.u(p)::text $$;
CREATE FUNCTION pg_temp.mails(p text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(payload ->> 'template', ',' ORDER BY created_at, id), '') FROM public.outbox_events
   WHERE kind = 'email.send' AND payload ->> 'recipient_id' = pg_temp.u(p)::text $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- p1: a proven phone, a profile with a confirmed address. p2: a phone no code has proven yet. p3: a proven phone,
-- no profile until it onboards. p5: no phone at all. p4 is inserted below.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at) VALUES
  (pg_temp.u('01'), 'authenticated', 'authenticated', '905559340001', now()),
  (pg_temp.u('02'), 'authenticated', 'authenticated', '905559340002', NULL),
  (pg_temp.u('03'), 'authenticated', 'authenticated', '905559340003', now()),
  (pg_temp.u('05'), 'authenticated', 'authenticated', NULL, NULL);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale, email, email_confirmed_at)
VALUES (pg_temp.u('01'), 'customer', 'TR', '+905559340001', 'Şifre Müşteri', 'tr', 'p1-34@example.com', now());
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'emails_enabled';

-- ── the functions and the triggers ───────────────────────────────────────────
SELECT hasnt_function('public', 'no_password', '0005''s no_password is gone');
SELECT results_eq(
  $$ SELECT tgname::text COLLATE "default" FROM pg_trigger
      WHERE tgrelid = 'auth.users'::regclass AND tgname IN ('no_password', 'password_guard', 'phone_fixed')
      ORDER BY tgname COLLATE "C" $$,
  $$ VALUES ('password_guard'::text), ('phone_fixed') $$,
  'auth.users carries password_guard and phone_fixed, not no_password');
SELECT matches(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'password_guard'),
  'BEFORE INSERT OR UPDATE OF encrypted_password ON auth.users FOR EACH ROW',
  'password_guard runs before an insert or a write that lists encrypted_password');
SELECT matches(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'phone_fixed'),
  'BEFORE UPDATE OF phone ON auth.users FOR EACH ROW',
  'phone_fixed runs before a write that lists phone');
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default", p.prosecdef, 'search_path=""' = ANY (p.proconfig) FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('password_guard', 'phone_fixed') ORDER BY p.proname COLLATE "C" $$,
  $$ VALUES ('password_guard'::text, true, true), ('phone_fixed', true, true) $$,
  'both are security definer with an empty search_path');
SELECT ok(NOT has_function_privilege('anon', 'public.password_guard()', 'EXECUTE'), 'anon cannot run password_guard');
SELECT ok(NOT has_function_privilege('authenticated', 'public.password_guard()', 'EXECUTE'), 'authenticated cannot run password_guard');
SELECT ok(NOT has_function_privilege('service_role', 'public.password_guard()', 'EXECUTE'), 'service_role cannot run password_guard');
SELECT ok(NOT has_function_privilege('anon', 'public.phone_fixed()', 'EXECUTE'), 'anon cannot run phone_fixed');
SELECT ok(NOT has_function_privilege('authenticated', 'public.phone_fixed()', 'EXECUTE'), 'authenticated cannot run phone_fixed');
SELECT ok(NOT has_function_privilege('service_role', 'public.phone_fixed()', 'EXECUTE'), 'service_role cannot run phone_fixed');

-- Guardrail: any trigger a later migration puts on auth.users from public must be locked the same way.
SELECT is(
  (SELECT coalesce(string_agg(DISTINCT p.proname, ','), '') FROM pg_trigger t
     JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal AND n.nspname = 'public'
      AND NOT (p.prosecdef AND 'search_path=""' = ANY (coalesce(p.proconfig, '{}'))
               AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
               AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
               AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))),
  '', 'every public trigger function on auth.users is a definer with an empty search_path and no API grant');
-- Guardrail: has_password and password_changed_at are written only by password_guard.
SELECT is(
  (SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname <> 'password_guard'
      AND (p.prosrc LIKE '%has_password%' OR p.prosrc LIKE '%password_changed_at%')),
  '', 'no public function but password_guard names has_password or password_changed_at');

-- ── insert: never a password ─────────────────────────────────────────────────
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at, encrypted_password, raw_app_meta_data)
VALUES (pg_temp.u('04'), 'authenticated', 'authenticated', '905559340004', now(), 'a-hash', '{"provider": "phone"}');
SELECT is(pg_temp.pw('04'), '', 'a sign up that carries a password saves none, even with a confirmed phone');
SELECT is(pg_temp.meta('04'), '{"provider": "phone", "has_password": false}'::jsonb,
  'the insert sets has_password false and keeps Auth''s own app_metadata');
SELECT is(pg_temp.audits('04'), '', 'an insert writes no audit row');

-- ── a password on a phone no code has proven: blanked ────────────────────────
UPDATE auth.users SET encrypted_password = 'b-hash' WHERE id = pg_temp.u('02');
SELECT is(pg_temp.pw('02'), '', 'a password before the code is blanked');
SELECT is(pg_temp.meta('02') -> 'has_password', 'false'::jsonb, 'the blanked branch leaves has_password false');
SELECT ok(NOT (pg_temp.meta('02') ? 'password_changed_at'), 'the blanked branch records no change time');
SELECT is(pg_temp.audits('02'), '', 'the blanked branch writes no audit row');
-- The same write together with the confirmation: the phone was not proven before it, so still blanked.
UPDATE auth.users SET encrypted_password = 'b-hash', phone_confirmed_at = now() WHERE id = pg_temp.u('02');
SELECT is(pg_temp.pw('02'), '', 'a password written with the confirmation itself is blanked too');

-- ── a proven phone with no profile yet: blanked (D201, the sign up race) ─────
UPDATE auth.users SET encrypted_password = 'e-hash' WHERE id = pg_temp.u('03');
SELECT is(pg_temp.pw('03'), '', 'a password on a proven phone before onboarding is blanked');
SELECT is(pg_temp.meta('03') -> 'has_password', 'false'::jsonb, 'and has_password stays false');
SELECT is(pg_temp.audits('03'), '', 'and no audit row is written');

-- ── an Auth write that does not change the password: nothing ─────────────────
UPDATE auth.users SET last_sign_in_at = now(), encrypted_password = encrypted_password WHERE id = pg_temp.u('01');
SELECT is(pg_temp.audits('01'), '', 'a write of last_sign_in_at alone writes no audit row');
SELECT is(pg_temp.meta('01'), '{"has_password": false}'::jsonb, 'and leaves app_metadata as the insert set it');

-- ── the first password on a proven, onboarded account: kept, auth.password_set ─
UPDATE auth.users SET encrypted_password = 'c-hash' WHERE id = pg_temp.u('01');
SELECT is(pg_temp.pw('01'), 'c-hash', 'a password after the code and onboarding is kept');
SELECT is(pg_temp.meta('01') -> 'has_password', 'true'::jsonb, 'has_password is true');
SELECT is((pg_temp.meta('01') ->> 'password_changed_at')::timestamptz, now(), 'password_changed_at is the change''s time');
SELECT is(pg_temp.audits('01'), 'auth.password_set', 'one audit row: auth.password_set');
SELECT results_eq(
  $$ SELECT actor_id, entity_type, region, old_value, new_value FROM public.audit_log
      WHERE entity_type = 'auth_users' AND entity_id = pg_temp.u('01')::text $$,
  $$ VALUES (pg_temp.u('01'), 'auth_users'::text, 'TR'::text, NULL::jsonb, NULL::jsonb) $$,
  'the actor is the account, the region the profile''s, and no value holds the hash');
-- D201: a first password is mailed to an owner with a confirmed address (an established account).
SELECT is(pg_temp.mails('01'), 'password_changed', 'auth.password_set queues the notice to a confirmed address');
SELECT results_eq(
  $$ SELECT payload ->> 'request_id', payload ->> 'entity_id' FROM public.outbox_events
      WHERE kind = 'email.send' AND payload ->> 'recipient_id' = pg_temp.u('01')::text $$,
  $$ VALUES (NULL::text, pg_temp.u('01')::text) $$,
  'the mail names the account, no request');
SELECT is(
  (SELECT public.email_context(o.id) - 'values' FROM public.outbox_events o
    WHERE o.kind = 'email.send' AND o.payload ->> 'recipient_id' = pg_temp.u('01')::text),
  jsonb_build_object('status', 'send', 'template', 'password_changed', 'email', 'p1-34@example.com', 'locale', 'tr',
                     'region_locale', 'tr', 'timezone', (SELECT timezone FROM public.regions WHERE code = 'TR')),
  'email_context sends password_changed to the confirmed address');
SELECT is(
  (SELECT (public.email_context(o.id) -> 'values' ->> 'changed_at')::timestamptz FROM public.outbox_events o
    WHERE o.kind = 'email.send' AND o.payload ->> 'recipient_id' = pg_temp.u('01')::text),
  now(), 'its changed_at is the change''s time');

UPDATE auth.users SET last_sign_in_at = now(), encrypted_password = encrypted_password WHERE id = pg_temp.u('01');
SELECT is(pg_temp.audits('01'), 'auth.password_set', 'an unchanged write after the set writes no audit row');
SELECT is(pg_temp.meta('01') -> 'has_password', 'true'::jsonb, 'and leaves has_password true');

-- ── a change: auth.password_changed and its mail (AC-10) ─────────────────────
UPDATE auth.users SET encrypted_password = 'd-hash' WHERE id = pg_temp.u('01');
SELECT is(pg_temp.pw('01'), 'd-hash', 'a change on a proven phone is kept');
SELECT is(pg_temp.audits('01'), 'auth.password_set,auth.password_changed', 'the change writes auth.password_changed');
SELECT is(pg_temp.mails('01'), 'password_changed,password_changed', 'auth.password_changed queues the notice too');

-- ── has_password survives promote_to_admin (it merges into app_metadata) ─────
SELECT lives_ok($$ SELECT public.promote_to_admin('+905559340001') $$, 'p1 is promoted');
SELECT is(pg_temp.meta('01') ->> 'role', 'admin', 'promote_to_admin sets the role');
SELECT ok(pg_temp.meta('01') -> 'has_password' = 'true'::jsonb AND pg_temp.meta('01') ? 'password_changed_at',
  'and keeps has_password and password_changed_at');

-- ── onboarding keeps app_metadata, then a password is kept; a new account gets no mail ─
UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"password_changed_at": "2026-01-02T09:00:00+00:00"}'
 WHERE id = pg_temp.u('03');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000340003", "role": "authenticated"}';
SELECT lives_ok($$ SELECT public.complete_onboarding('customer', 'Yeni Kişi', 'tr', true) $$, 'p3 onboards');
RESET ROLE;
SELECT ok(pg_temp.meta('03') ->> 'role' = 'customer' AND pg_temp.meta('03') ->> 'password_changed_at' = '2026-01-02T09:00:00+00:00',
  'complete_onboarding merges: the role is added and the earlier keys stay');
UPDATE auth.users SET encrypted_password = 'f-hash' WHERE id = pg_temp.u('03');
SELECT is(pg_temp.pw('03'), 'f-hash', 'after onboarding the same password write is kept');
SELECT is(pg_temp.audits('03'), 'auth.password_set', 'and audited as auth.password_set');
SELECT is(pg_temp.mails('03'), '', 'a new account has no confirmed address, so no mail');
-- Clearing the password (Auth never does, but the column allows it): has_password false, no audit row.
UPDATE auth.users SET encrypted_password = '' WHERE id = pg_temp.u('03');
SELECT is(pg_temp.meta('03') -> 'has_password', 'false'::jsonb, 'a cleared password sets has_password false');
SELECT is(pg_temp.audits('03'), 'auth.password_set', 'and writes no audit row');

-- ── a provider with a profile and no address ─────────────────────────────────
-- The local test runner may not become supabase_auth_admin (permission denied), so the chain under Auth's own role is
-- proven by the e2e journeys, which write through the real Auth server.
INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
VALUES (pg_temp.u('04'), 'provider', 'TR', '+905559340004', 'Rol Sağlayıcı', 'tr');
UPDATE auth.users SET encrypted_password = 'g-hash' WHERE id = pg_temp.u('04');
SELECT is(pg_temp.pw('04'), 'g-hash', 'a provider''s password after onboarding is kept');
SELECT is(pg_temp.audits('04'), 'auth.password_set', 'and audited as auth.password_set');
SELECT is(pg_temp.mails('04'), '', 'with no address, no mail');

-- ── phone_fixed ──────────────────────────────────────────────────────────────
SELECT throws_ok($$ UPDATE auth.users SET phone = '905559349999' WHERE id = pg_temp.u('01') $$,
  'P0001', 'phone_immutable', 'a set phone cannot change');
SELECT lives_ok($$ UPDATE auth.users SET phone = '905559340001' WHERE id = pg_temp.u('01') $$,
  'writing the same phone again is allowed');
SELECT lives_ok($$ UPDATE auth.users SET phone = '905559340005' WHERE id = pg_temp.u('05') $$,
  'a first phone on an account with none is allowed');

-- ── no API role writes auth.users ────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000340001", "role": "authenticated"}';
SELECT throws_ok($$ UPDATE auth.users SET raw_app_meta_data = '{"has_password": true}' WHERE id = auth.uid() $$,
  '42501', NULL, 'a signed in user cannot write app_metadata');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
