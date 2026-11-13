-- Position 01, part 2, spec 0005: the contact email and the notification preferences.
--
-- The email is for notices only and never signs anyone in; it is confirmed in position 13, so until
-- then it is never "confirmed". Preferences are a user's own rows, in the region of their own profile.
-- AC-15, AC-32, AC-33.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(35);

INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', '905552220001', now()),
  ('00000000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated', '905552220002', now());

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "role": "authenticated", "app_metadata": {}}';
SELECT public.complete_onboarding('customer', 'Birinci Kişi', 'tr', true);
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "role": "authenticated", "app_metadata": {}}';
SELECT public.complete_onboarding('provider', 'İkinci Kişi', 'tr', true);
RESET ROLE;

-- ── columns and grants ───────────────────────────────────────────────────────
SELECT has_column('public', 'profiles', 'email', 'profiles has a contact email');
SELECT has_column('public', 'profiles', 'email_confirmed_at', 'and the time it was confirmed');
SELECT ok(has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE'), 'a user may update their email');
SELECT ok(NOT has_column_privilege('authenticated', 'public.profiles', 'email_confirmed_at', 'UPDATE'), 'but never its confirmation');
SELECT ok(NOT has_column_privilege('service_role', 'public.profiles', 'email_confirmed_at', 'UPDATE'), 'not even service_role: position 13 adds its own path');

SELECT table_privs_are('public', 'notification_preferences', 'anon', ARRAY[]::text[], 'anon holds nothing on notification_preferences');
SELECT table_privs_are('public', 'notification_preferences', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE'], 'a user reads and writes their own, and never deletes');
SELECT table_privs_are('public', 'notification_preferences', 'service_role', ARRAY['SELECT'], 'server jobs only read');

-- ── the email: a plain lower case address, or nothing ────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "role": "authenticated", "app_metadata": {"role": "customer"}}';
SELECT lives_ok($$ UPDATE public.profiles SET email = 'ali@example.com' WHERE id = auth.uid() $$, 'a user sets their email');
SELECT throws_ok($$ UPDATE public.profiles SET email = 'Ali@Example.com' WHERE id = auth.uid() $$, '23514', NULL, 'a capital letter is refused: the app lowercases first, with plain toLowerCase');
SELECT throws_ok($$ UPDATE public.profiles SET email = 'not an email' WHERE id = auth.uid() $$, '23514', NULL, 'a word that is not an address is refused');
SELECT throws_ok($$ UPDATE public.profiles SET email = 'a@b' WHERE id = auth.uid() $$, '23514', NULL, 'an address with no dot after the at is refused');
SELECT throws_ok($$ UPDATE public.profiles SET email = repeat('a', 250) || '@example.com' WHERE id = auth.uid() $$, '23514', NULL, 'a very long address is refused');
SELECT throws_ok($$ UPDATE public.profiles SET email_confirmed_at = now() WHERE id = auth.uid() $$, '42501', NULL, 'a user cannot mark their own email confirmed');
RESET ROLE;

SELECT is(
  (SELECT email_confirmed_at FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000d1'),
  NULL, 'an email stays unconfirmed until position 13'
);

-- A changed email is audited, with who, old, new and region (AC-15).
SELECT results_eq(
  $$ SELECT actor_id, old_value, new_value, region FROM public.audit_log
      WHERE action = 'profile.email_changed' AND entity_id = '00000000-0000-0000-0000-0000000000d1' $$,
  $$ VALUES ('00000000-0000-0000-0000-0000000000d1'::uuid, '{"email": null}'::jsonb, '{"email": "ali@example.com"}'::jsonb, 'TR') $$,
  'the first email writes one audit row'
);

-- A confirmed address that changes goes back to unconfirmed, and clearing it works.
UPDATE public.profiles SET email_confirmed_at = now() WHERE id = '00000000-0000-0000-0000-0000000000d1';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "role": "authenticated", "app_metadata": {"role": "customer"}}';
UPDATE public.profiles SET email = 'ali@example.com' WHERE id = auth.uid();
RESET ROLE;
SELECT isnt(
  (SELECT email_confirmed_at FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000d1'),
  NULL, 'saving the same address keeps its confirmation'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "role": "authenticated", "app_metadata": {"role": "customer"}}';
UPDATE public.profiles SET email = 'veli@example.com' WHERE id = auth.uid();
RESET ROLE;
SELECT is(
  (SELECT email_confirmed_at FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000d1'),
  NULL, 'a different address is unconfirmed again'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "role": "authenticated", "app_metadata": {"role": "customer"}}';
SELECT lives_ok($$ UPDATE public.profiles SET email = NULL WHERE id = auth.uid() $$, 'the email can be removed');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE action = 'profile.email_changed' AND entity_id = '00000000-0000-0000-0000-0000000000d1'),
  3, 'three real changes, three audit rows (not the repeat save)'
);

-- ── a user writes only their own preferences, in their own region (AC-33) ───
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "role": "authenticated", "app_metadata": {"role": "customer"}}';
SELECT lives_ok(
  $$ INSERT INTO public.notification_preferences (user_id, topic, email_enabled) VALUES (auth.uid(), 'new_offer', false) $$,
  'a user turns a topic off'
);
SELECT is(
  (SELECT region FROM public.notification_preferences WHERE user_id = auth.uid() AND topic = 'new_offer'),
  'TR', 'the region comes from their own profile, not from the client'
);
SELECT lives_ok(
  $$ INSERT INTO public.notification_preferences (user_id, topic, email_enabled) VALUES (auth.uid(), 'new_offer', true)
     ON CONFLICT (user_id, topic) DO UPDATE SET email_enabled = excluded.email_enabled $$,
  'and back on, as an upsert'
);
SELECT is(
  (SELECT email_enabled FROM public.notification_preferences WHERE user_id = auth.uid() AND topic = 'new_offer'),
  true, 'the upsert held'
);
SELECT throws_ok(
  $$ INSERT INTO public.notification_preferences (user_id, topic, email_enabled) VALUES (auth.uid(), 'payments', false) $$,
  '23514', NULL, 'a topic that cannot be turned off is not a topic: money and deadline notices are always on'
);
SELECT throws_ok(
  $$ INSERT INTO public.notification_preferences (user_id, topic, email_enabled)
     VALUES ('00000000-0000-0000-0000-0000000000d2', 'ratings', false) $$,
  '42501', NULL, 'a user cannot write a row for someone else'
);
INSERT INTO public.notification_preferences (user_id, topic, region, email_enabled) VALUES (auth.uid(), 'ratings', 'KSA', false);
SELECT is(
  (SELECT region FROM public.notification_preferences WHERE user_id = auth.uid() AND topic = 'ratings'),
  'TR', 'a region sent by the client is ignored: the trigger writes the one on their profile'
);
SELECT throws_ok($$ DELETE FROM public.notification_preferences $$, '42501', NULL, 'rows are never deleted: off is a row too');

-- Someone else's row is out of reach.
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "role": "authenticated", "app_metadata": {"role": "provider"}}';
INSERT INTO public.notification_preferences (user_id, topic, email_enabled) VALUES (auth.uid(), 'new_matching_request', false);
SELECT results_eq(
  $$ SELECT user_id, topic FROM public.notification_preferences $$,
  $$ VALUES ('00000000-0000-0000-0000-0000000000d2'::uuid, 'new_matching_request') $$,
  'a user reads only their own preferences'
);
UPDATE public.notification_preferences SET email_enabled = true WHERE user_id = '00000000-0000-0000-0000-0000000000d1';
RESET ROLE;
SELECT is(
  (SELECT email_enabled FROM public.notification_preferences WHERE user_id = '00000000-0000-0000-0000-0000000000d1' AND topic = 'new_offer'),
  true, 'the other user''s row was untouched by the update that matched nothing'
);

-- Anon reads nothing; service_role reads but never writes.
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.notification_preferences $$, '42501', NULL, 'anon cannot read preferences');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT lives_ok($$ SELECT 1 FROM public.notification_preferences $$, 'service_role reads, for position 13');
SELECT throws_ok(
  $$ INSERT INTO public.notification_preferences (user_id, topic, region, email_enabled)
     VALUES ('00000000-0000-0000-0000-0000000000d1', 'ratings', 'TR', false) $$,
  '42501', NULL, 'service_role does not write'
);
RESET ROLE;

-- The user and topic key is the primary key; the region rides along and can never change.
SELECT col_is_pk('public', 'notification_preferences', ARRAY['user_id', 'topic'], 'one row per user and topic');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "role": "authenticated", "app_metadata": {"role": "customer"}}';
SELECT throws_ok(
  $$ UPDATE public.notification_preferences SET region = 'KSA' WHERE user_id = auth.uid() $$,
  '42501', NULL, 'a region cannot be rewritten'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
