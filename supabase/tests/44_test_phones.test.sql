-- Spec 0013 (D224): test phones. An exact allow list of numbers outside TR and KSA, filed in a region, read by
-- phone_region(), the before_user_created hook and the profiles guard. Empty, nothing changes (D16 holds).
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(16);

SELECT has_table('public', 'test_phones', 'test_phones exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.test_phones'::regclass), 'RLS is on');
SELECT table_privs_are('public', 'test_phones', 'anon', ARRAY[]::text[], 'anon holds nothing');
SELECT table_privs_are('public', 'test_phones', 'authenticated', ARRAY[]::text[], 'authenticated holds nothing');
SELECT table_privs_are('public', 'test_phones', 'service_role', ARRAY[]::text[], 'service_role holds nothing');

-- Empty list: exactly D16.
SELECT is(public.phone_region('+201012345678'), NULL, 'an unlisted +20 number has no region');
SELECT is(public.check_new_user('{"user": {"phone": "201012345678"}}'::jsonb) -> 'error' ->> 'message', 'phone_not_supported',
  'the hook refuses it');
SELECT is(public.phone_region('+905551234567'), 'TR', 'a Turkish mobile is still TR');

-- Listed: filed in TR.
INSERT INTO public.test_phones (phone, note) VALUES ('+201012345678', 'FIXTURE');
SELECT is(public.phone_region('+201012345678'), 'TR', 'a listed number reads its region');
SELECT is(public.check_new_user('{"user": {"phone": "201012345678"}}'::jsonb), '{}'::jsonb, 'the hook lets a listed number through');
SELECT is(public.phone_region('+201099999999'), NULL, 'a neighbouring unlisted number does not');
SELECT throws_ok($$ INSERT INTO public.test_phones (phone) VALUES ('+905551234567') $$, '23514', NULL,
  'a real region mobile can never be listed');
SELECT throws_ok($$ INSERT INTO public.test_phones (phone) VALUES ('201012345670') $$, '23514', NULL, 'not E.164 is refused');

-- The profiles guard.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
VALUES ('00000000-0000-0000-0000-000000440001', 'authenticated', 'authenticated', '201012345678', now());
SELECT lives_ok($$ INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  VALUES ('00000000-0000-0000-0000-000000440001', 'customer', 'TR', '+201012345678', 'Test Kişi', 'en') $$,
  'a listed number makes a TR profile');
SELECT throws_ok($$ UPDATE public.profiles SET region = 'KSA' WHERE id = '00000000-0000-0000-0000-000000440001' $$, 'P0001',
  'immutable_field', 'its region never changes (01''s guard)');
DELETE FROM public.test_phones WHERE phone = '+201012345678';
SELECT throws_ok($$ UPDATE public.profiles SET phone = '+201012345678' WHERE id = '00000000-0000-0000-0000-000000440001' $$, '23514',
  'phone_region_mismatch', 'once unlisted, the number cannot be written again');

SELECT * FROM finish();
ROLLBACK;
