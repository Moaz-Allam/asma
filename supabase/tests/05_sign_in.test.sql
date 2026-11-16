-- Position 01, spec 0005: accounts, roles, the agreement, the audit trail.
--
-- The negative cases are the point: anon and other users denied every table, a client that cannot
-- touch role, region or phone, service_role that cannot rewrite history, and every refusal of the
-- Auth hook and complete_onboarding. AC-3, AC-8, AC-9, AC-14, AC-15, AC-16, AC-20.
--
-- Fixture users go straight into auth.users, as the real ones do after a verified code.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(99);

INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', '905551110001', now()),
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', '905551110002', now()),
  ('00000000-0000-0000-0000-0000000000a3', 'authenticated', 'authenticated', '905551110003', NULL),
  ('00000000-0000-0000-0000-0000000000a4', 'authenticated', 'authenticated', '966551110004', now()),
  ('00000000-0000-0000-0000-0000000000a5', 'authenticated', 'authenticated', '4915112345678', now()),
  ('00000000-0000-0000-0000-0000000000a6', 'authenticated', 'authenticated', '902121110006', now()),
  ('00000000-0000-0000-0000-0000000000a7', 'authenticated', 'authenticated', '905551110007', now()),
  ('00000000-0000-0000-0000-0000000000a8', 'authenticated', 'authenticated', NULL, NULL);

-- ── the seeds (AC-20) ────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT region, value FROM public.platform_settings WHERE key = 'terms_version' ORDER BY region $$,
  $$ VALUES ('KSA', '"draft-1"'::jsonb), ('TR', '"draft-1"'::jsonb) $$,
  'terms_version is draft-1 per region'
);

-- ── grants (D77: each table its own) ─────────────────────────────────────────
SELECT table_privs_are('public', 'profiles', 'anon', ARRAY[]::text[], 'anon holds no privilege on profiles');
SELECT table_privs_are('public', 'profiles', 'authenticated', ARRAY['SELECT'], 'signed in users read profiles');
SELECT table_privs_are('public', 'profiles', 'service_role', ARRAY['SELECT'], 'server jobs only read profiles');
SELECT table_privs_are('public', 'terms_acceptances', 'anon', ARRAY[]::text[], 'anon holds nothing on terms_acceptances');
SELECT table_privs_are('public', 'terms_acceptances', 'authenticated', ARRAY['SELECT'], 'signed in users only read terms_acceptances');
SELECT table_privs_are('public', 'terms_acceptances', 'service_role', ARRAY['SELECT'], 'service_role only reads terms_acceptances');
SELECT table_privs_are('public', 'audit_log', 'anon', ARRAY[]::text[], 'anon holds nothing on audit_log');
SELECT table_privs_are('public', 'audit_log', 'authenticated', ARRAY['SELECT'], 'signed in users only read audit_log');
SELECT table_privs_are('public', 'audit_log', 'service_role', ARRAY['SELECT'], 'service_role only reads audit_log');

SELECT ok(has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE'), 'a user may update full_name');
SELECT ok(has_column_privilege('authenticated', 'public.profiles', 'locale', 'UPDATE'), 'a user may update locale');
SELECT ok(NOT has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'), 'no API role updates role (AC-9)');
SELECT ok(NOT has_column_privilege('authenticated', 'public.profiles', 'region', 'UPDATE'), 'no API role updates region (AC-9)');
SELECT ok(NOT has_column_privilege('authenticated', 'public.profiles', 'phone', 'UPDATE'), 'no API role updates phone (AC-9)');
SELECT ok(NOT has_column_privilege('service_role', 'public.profiles', 'role', 'UPDATE'), 'service_role does not update role (AC-9)');

-- ── who may call what ────────────────────────────────────────────────────────
SELECT ok(has_function_privilege('anon', 'public.public_region_info()', 'EXECUTE'), 'anon reads the public region facts');
SELECT ok(has_function_privilege('authenticated', 'public.public_region_info()', 'EXECUTE'), 'so does a signed in user');

SELECT ok(has_function_privilege('authenticated', 'public.complete_onboarding(text, text, text, boolean)', 'EXECUTE'), 'a signed in user may finish onboarding');
SELECT ok(NOT has_function_privilege('anon', 'public.complete_onboarding(text, text, text, boolean)', 'EXECUTE'), 'anon may not');
SELECT ok(NOT has_function_privilege('service_role', 'public.complete_onboarding(text, text, text, boolean)', 'EXECUTE'), 'service_role may not');

SELECT ok(has_function_privilege('supabase_auth_admin', 'public.check_new_user(jsonb)', 'EXECUTE'), 'Auth may call the hook');
SELECT ok(NOT has_function_privilege('anon', 'public.check_new_user(jsonb)', 'EXECUTE'), 'anon may not call the hook');
SELECT ok(NOT has_function_privilege('authenticated', 'public.check_new_user(jsonb)', 'EXECUTE'), 'a signed in user may not call the hook');
SELECT ok(NOT has_function_privilege('service_role', 'public.check_new_user(jsonb)', 'EXECUTE'), 'service_role may not call the hook');

SELECT ok(NOT has_function_privilege('anon', 'public.promote_to_admin(text)', 'EXECUTE'), 'anon may not promote (AC-16)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.promote_to_admin(text)', 'EXECUTE'), 'a signed in user may not promote (AC-16)');
SELECT ok(NOT has_function_privilege('service_role', 'public.promote_to_admin(text)', 'EXECUTE'), 'service_role may not promote (AC-16)');

SELECT ok(NOT has_function_privilege('authenticated', 'public.phone_region(text)', 'EXECUTE'), 'phone_region is internal');

-- ── one sample table for the mobile pattern (AC-3; tests/region-phone.test.ts holds the same table) ──
SELECT results_eq(
  $$ SELECT s.phone, public.phone_region(s.phone)
       FROM (VALUES ('+905551234567'), ('+905001234567'), ('+966551234567'), ('+902121234567'),
                    ('+90555123456'), ('+9055512345678'), ('+966451234567'), ('+4915112345678'),
                    ('905551234567'), ('')) AS s(phone) $$,
  $$ VALUES ('+905551234567', 'TR'), ('+905001234567', 'TR'), ('+966551234567', 'KSA'),
            ('+902121234567', NULL), ('+90555123456', NULL), ('+9055512345678', NULL),
            ('+966451234567', NULL), ('+4915112345678', NULL), ('905551234567', NULL), ('', NULL) $$,
  'phone_region: mobile numbers of the two regions, nothing else'
);

-- ── the Auth hook (AC-3) ─────────────────────────────────────────────────────
SELECT is(public.check_new_user('{"user": {"phone": "905551234567", "email": ""}}'), '{}'::jsonb, 'a Turkish mobile passes, as Auth stores it');
SELECT is(public.check_new_user('{"user": {"phone": "+905551234567"}}'), '{}'::jsonb, 'a leading plus changes nothing');

CREATE TEMP TABLE refused AS
  SELECT '{"error": {"http_code": 400, "message": "phone_not_supported"}}'::jsonb AS response;

SELECT is(public.check_new_user('{"user": {"phone": "4915112345678"}}'), (SELECT response FROM refused), 'a foreign number is refused');
SELECT is(public.check_new_user('{"user": {"phone": "902121234567"}}'), (SELECT response FROM refused), 'a landline is refused');
SELECT is(public.check_new_user('{"user": {"phone": "966551234567"}}'), (SELECT response FROM refused), 'KSA is refused while the region is off');
SELECT is(public.check_new_user('{"user": {"phone": ""}}'), (SELECT response FROM refused), 'an empty phone is refused');
SELECT is(public.check_new_user('{"user": {"email": "a@example.com"}}'), (SELECT response FROM refused), 'an email sign up is refused');
SELECT is(public.check_new_user('{"user": {"phone": "905551234567", "email": "a@example.com"}}'), (SELECT response FROM refused), 'a phone with an email is refused');
SELECT is(public.check_new_user('{}'), (SELECT response FROM refused), 'an empty event is refused');

UPDATE public.regions SET active = true WHERE code = 'KSA';
SELECT is(public.check_new_user('{"user": {"phone": "966551234567"}}'), '{}'::jsonb, 'switching KSA on is a data change, with no code change');
UPDATE public.regions SET active = false WHERE code = 'KSA';

-- ── no account holds a password (AC-3, D104) ─────────────────────────────────
INSERT INTO auth.users (id, aud, role, phone, encrypted_password)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', '905551110099', 'a-hash');
SELECT is(
  (SELECT encrypted_password FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000b1'),
  '', 'a password given at sign up is dropped'
);
UPDATE auth.users SET encrypted_password = 'a-hash' WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT is(
  (SELECT encrypted_password FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000a1'),
  '', 'a password set later is dropped too'
);

-- ── complete_onboarding: anon (AC-8) ─────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT public.complete_onboarding('customer', 'Ayşe Yılmaz', 'tr', true) $$,
  '42501', NULL, 'anon cannot finish onboarding'
);
RESET ROLE;

-- ── complete_onboarding: refusals (AC-3, AC-8) ───────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1", "role": "authenticated", "app_metadata": {}}';

SELECT throws_ok($$ SELECT public.complete_onboarding('admin', 'Ayşe Yılmaz', 'tr', true) $$, 'P0001', 'validation_failed', 'admin cannot be chosen');
SELECT throws_ok($$ SELECT public.complete_onboarding('customer', 'Ayşe Yılmaz', 'tr', false) $$, 'P0001', 'validation_failed', 'the statement must be ticked');
SELECT throws_ok($$ SELECT public.complete_onboarding('customer', 'Ayşe Yılmaz', 'tr', NULL) $$, 'P0001', 'validation_failed', 'an unset tick is refused');
SELECT throws_ok($$ SELECT public.complete_onboarding('customer', ' A ', 'tr', true) $$, 'P0001', 'validation_failed', 'a name of one character after trim is refused');
SELECT throws_ok($$ SELECT public.complete_onboarding('customer', 'Ayşe Yılmaz', 'de', true) $$, 'P0001', 'validation_failed', 'an unknown locale is refused');

SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a3", "role": "authenticated", "app_metadata": {}}';
SELECT throws_ok($$ SELECT public.complete_onboarding('customer', 'Ayşe Yılmaz', 'tr', true) $$, 'P0001', 'phone_not_eligible', 'an unconfirmed phone is refused');
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a4", "role": "authenticated", "app_metadata": {}}';
SELECT throws_ok($$ SELECT public.complete_onboarding('customer', 'Ayşe Yılmaz', 'tr', true) $$, 'P0001', 'phone_not_eligible', 'a phone of an inactive region is refused, with the hook off');
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a5", "role": "authenticated", "app_metadata": {}}';
SELECT throws_ok($$ SELECT public.complete_onboarding('customer', 'Ayşe Yılmaz', 'tr', true) $$, 'P0001', 'phone_not_eligible', 'a foreign phone is refused, with the hook off');
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a6", "role": "authenticated", "app_metadata": {}}';
SELECT throws_ok($$ SELECT public.complete_onboarding('customer', 'Ayşe Yılmaz', 'tr', true) $$, 'P0001', 'phone_not_eligible', 'a landline is refused, with the hook off');
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a8", "role": "authenticated", "app_metadata": {}}';
SELECT throws_ok($$ SELECT public.complete_onboarding('customer', 'Ayşe Yılmaz', 'tr', true) $$, 'P0001', 'phone_not_eligible', 'a user with no phone is refused');
RESET ROLE;

-- ── complete_onboarding: the one transaction (AC-8, AC-20) ───────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1", "role": "authenticated", "app_metadata": {}}';
SELECT is(
  public.complete_onboarding('customer', '  Ayşe Yılmaz  ', 'tr', true),
  '{"role": "customer", "region": "TR", "created": true}'::jsonb,
  'the first call creates the account'
);
SELECT is(
  public.complete_onboarding('provider', 'Someone Else', 'en', true),
  '{"role": "customer", "region": "TR", "created": false}'::jsonb,
  'a second call with another role keeps the first role and changes nothing'
);
RESET ROLE;

SELECT results_eq(
  $$ SELECT role, region, phone COLLATE "default", full_name, locale FROM public.profiles
      WHERE id = '00000000-0000-0000-0000-0000000000a1' $$,
  $$ VALUES ('customer', 'TR', '+905551110001', 'Ayşe Yılmaz', 'tr') $$,
  'the profile comes from the verified auth row, trimmed, as E.164'
);
SELECT results_eq(
  $$ SELECT region, terms_version, locale FROM public.terms_acceptances
      WHERE user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  $$ VALUES ('TR', 'draft-1', 'tr') $$,
  'one acceptance row with the region''s terms version'
);
SELECT results_eq(
  $$ SELECT action, entity_type, entity_id, region, actor_id FROM public.audit_log
      WHERE entity_id = '00000000-0000-0000-0000-0000000000a1' $$,
  $$ VALUES ('account.created', 'profile', '00000000-0000-0000-0000-0000000000a1', 'TR',
             '00000000-0000-0000-0000-0000000000a1'::uuid) $$,
  'one audit row, even after the repeat call (AC-15)'
);
SELECT is(
  (SELECT raw_app_meta_data ->> 'role' FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000a1'),
  'customer', 'the role reaches app_metadata'
);
SELECT is(
  (SELECT raw_app_meta_data ->> 'region' FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000a1'),
  'TR', 'the region reaches app_metadata'
);

-- A second account, a provider.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "role": "authenticated", "app_metadata": {}}';
SELECT is(
  public.complete_onboarding('provider', 'Mehmet Demir', 'ar', true),
  '{"role": "provider", "region": "TR", "created": true}'::jsonb,
  'a provider onboards the same way'
);
RESET ROLE;

-- ── phone_taken: an Auth phone change frees the old number in auth.users only ──
UPDATE auth.users SET phone = '905551119999' WHERE id = '00000000-0000-0000-0000-0000000000a1';
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
VALUES ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', '905551110001', now());
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c1", "role": "authenticated", "app_metadata": {}}';
SELECT throws_ok($$ SELECT public.complete_onboarding('customer', 'Yeni Kişi', 'tr', true) $$, 'P0001', 'phone_taken', 'a number still held by a profile is refused');
RESET ROLE;

-- The admin fixture is promoted for the RLS checks below (AC-16).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a7", "role": "authenticated", "app_metadata": {}}';
SELECT public.complete_onboarding('customer', 'Yönetici Bir', 'tr', true);
RESET ROLE;
SET LOCAL request.jwt.claims = '';  -- the SQL editor carries no session

SELECT throws_ok($$ SELECT public.promote_to_admin('+905559999999') $$, 'P0001', 'no_profile', 'promotion needs an existing profile');
SELECT lives_ok($$ SELECT public.promote_to_admin('+905551110007') $$, 'the SQL editor can promote');
SELECT is(
  (SELECT role FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000a7'),
  'admin', 'promotion sets the profile'
);
SELECT is(
  (SELECT raw_app_meta_data ->> 'role' FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000a7'),
  'admin', 'promotion sets app_metadata'
);
SELECT results_eq(
  $$ SELECT actor_id, old_value, new_value, region FROM public.audit_log WHERE action = 'account.promoted'
       AND entity_id = '00000000-0000-0000-0000-0000000000a7' $$,
  $$ VALUES (NULL::uuid, '{"role": "customer"}'::jsonb, '{"role": "admin"}'::jsonb, 'TR') $$,
  'promotion is audited, with no actor from the SQL editor'
);

-- ── anon reads nothing (AC-14) ───────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT id FROM public.profiles $$, '42501', NULL, 'anon cannot read profiles');
SELECT throws_ok($$ SELECT id FROM public.terms_acceptances $$, '42501', NULL, 'anon cannot read terms_acceptances');
SELECT throws_ok($$ SELECT id FROM public.audit_log $$, '42501', NULL, 'anon cannot read audit_log');
SELECT results_eq(
  $$ SELECT code, dial_code, support_whatsapp FROM public.public_region_info() $$,
  $$ VALUES ('TR', '+90', NULL::text) $$,
  'anon sees only active regions, public facts only'
);
RESET ROLE;

INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', 'support_whatsapp', '"+905550000000"');
SET LOCAL ROLE anon;
SELECT is(
  (SELECT support_whatsapp FROM public.public_region_info()),
  '+905550000000', 'the support number appears when the row exists'
);
RESET ROLE;

-- ── a user sees only their own rows (AC-14) ──────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "role": "authenticated", "app_metadata": {"role": "provider"}}';
SELECT results_eq(
  $$ SELECT id FROM public.profiles $$,
  $$ VALUES ('00000000-0000-0000-0000-0000000000a2'::uuid) $$,
  'a provider reads only their own profile'
);
SELECT results_eq(
  $$ SELECT user_id FROM public.terms_acceptances $$,
  $$ VALUES ('00000000-0000-0000-0000-0000000000a2'::uuid) $$,
  'a provider reads only their own acceptance'
);
SELECT is_empty($$ SELECT id FROM public.audit_log $$, 'a provider reads no audit row');

-- ── a client cannot change role, region, phone or history (AC-9, AC-14) ──────
SELECT throws_ok($$ UPDATE public.profiles SET role = 'admin' WHERE id = auth.uid() $$, '42501', NULL, 'a client cannot change role');
SELECT throws_ok($$ UPDATE public.profiles SET region = 'KSA' WHERE id = auth.uid() $$, '42501', NULL, 'a client cannot change region');
SELECT throws_ok($$ UPDATE public.profiles SET phone = '+905550000001' WHERE id = auth.uid() $$, '42501', NULL, 'a client cannot change phone');
SELECT throws_ok(
  $$ INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
     VALUES (auth.uid(), 'admin', 'TR', '+905550000002', 'Bir Kişi', 'tr') $$,
  '42501', NULL, 'a client cannot insert a profile'
);
SELECT throws_ok($$ DELETE FROM public.profiles WHERE id = auth.uid() $$, '42501', NULL, 'a client cannot delete a profile');
SELECT throws_ok(
  $$ INSERT INTO public.terms_acceptances (user_id, region, terms_version, locale)
     VALUES (auth.uid(), 'TR', 'forged', 'tr') $$,
  '42501', NULL, 'a client cannot forge an acceptance'
);
SELECT throws_ok(
  $$ INSERT INTO public.audit_log (action, entity_type, entity_id) VALUES ('x', 'y', 'z') $$,
  '42501', NULL, 'a client cannot write the audit log'
);

-- Another user's row is simply out of reach: RLS turns the update into zero rows.
UPDATE public.profiles SET full_name = 'Hacked Name' WHERE id = '00000000-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT is(
  (SELECT full_name FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000a1'),
  'Ayşe Yılmaz', 'a user cannot rename another user'
);

-- ── a name change is audited by the database, even from a direct API call (AC-15) ──
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "role": "authenticated", "app_metadata": {"role": "provider"}}';
UPDATE public.profiles SET full_name = 'Mehmet Yeni' WHERE id = auth.uid();
UPDATE public.profiles SET locale = 'en' WHERE id = auth.uid();
RESET ROLE;
SELECT results_eq(
  $$ SELECT actor_id, old_value, new_value, region FROM public.audit_log
      WHERE action = 'profile.name_changed' AND entity_id = '00000000-0000-0000-0000-0000000000a2' $$,
  $$ VALUES ('00000000-0000-0000-0000-0000000000a2'::uuid, '{"full_name": "Mehmet Demir"}'::jsonb,
             '{"full_name": "Mehmet Yeni"}'::jsonb, 'TR') $$,
  'a rename writes one audit row with who, old, new and region; a locale change writes none'
);

-- ── the trigger refuses region and phone for every role (AC-9) ───────────────
SELECT throws_ok($$ UPDATE public.profiles SET region = 'KSA' WHERE id = '00000000-0000-0000-0000-0000000000a2' $$, 'P0001', 'immutable_field', 'even the owner role cannot move a region');
SELECT throws_ok($$ UPDATE public.profiles SET phone = '+905550000003' WHERE id = '00000000-0000-0000-0000-0000000000a2' $$, 'P0001', 'immutable_field', 'even the owner role cannot change a phone');

-- ── the D16 check, literal in the table (AC-3) ───────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
     VALUES ('00000000-0000-0000-0000-0000000000a5', 'customer', 'TR', '+4915112345678', 'Bir Kişi', 'en') $$,
  '23514', NULL, 'a phone that does not match the region cannot be stored'
);
SELECT throws_ok(
  $$ INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
     VALUES ('00000000-0000-0000-0000-0000000000a5', 'customer', 'KSA', '+905551234567', 'Bir Kişi', 'en') $$,
  '23514', NULL, 'a Turkish phone cannot sit in KSA'
);

-- ── service_role cannot rewrite history (AC-14) ──────────────────────────────
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$ INSERT INTO public.terms_acceptances (user_id, region, terms_version, locale)
     VALUES ('00000000-0000-0000-0000-0000000000a2', 'TR', 'forged', 'tr') $$,
  '42501', NULL, 'service_role cannot insert an acceptance'
);
SELECT throws_ok($$ UPDATE public.terms_acceptances SET terms_version = 'x' $$, '42501', NULL, 'service_role cannot update an acceptance');
SELECT throws_ok($$ DELETE FROM public.terms_acceptances $$, '42501', NULL, 'service_role cannot delete an acceptance');
SELECT throws_ok($$ INSERT INTO public.audit_log (action, entity_type, entity_id) VALUES ('x', 'y', 'z') $$, '42501', NULL, 'service_role cannot insert an audit row');
SELECT throws_ok($$ UPDATE public.audit_log SET action = 'x' $$, '42501', NULL, 'service_role cannot update an audit row');
SELECT throws_ok($$ DELETE FROM public.audit_log $$, '42501', NULL, 'service_role cannot delete an audit row');
RESET ROLE;

-- ── an admin reads across users (AC-14, D15) ─────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a7", "role": "authenticated", "app_metadata": {"role": "admin"}}';
SELECT is((SELECT count(*)::int FROM public.profiles WHERE id IN ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a7')), 3, 'an admin reads every profile');
SELECT is((SELECT count(*)::int FROM public.terms_acceptances WHERE user_id IN ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a7')), 3, 'an admin reads every acceptance');
SELECT cmp_ok((SELECT count(*)::int FROM public.audit_log), '>=', 5, 'an admin reads the audit log');
RESET ROLE;

-- A forged claim in user_metadata means nothing: the policy reads app_metadata.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "role": "authenticated", "app_metadata": {"role": "provider"}, "user_metadata": {"role": "admin"}}';
SELECT is((SELECT count(*)::int FROM public.profiles), 1, 'user_metadata cannot grant admin');
RESET ROLE;

-- ── the invariant: the two copies of the role agree (Key invariants) ─────────
SELECT is_empty(
  $$ SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id = p.id
      WHERE u.raw_app_meta_data ->> 'role' IS DISTINCT FROM p.role
         OR u.raw_app_meta_data ->> 'region' IS DISTINCT FROM p.region $$,
  'profiles.role and region equal app_metadata for every user'
);

SELECT * FROM finish();
ROLLBACK;
