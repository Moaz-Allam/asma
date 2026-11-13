-- Position 02, spec 0006: provider onboarding and approval.
--
-- The negative cases are the point. A hostile client calls PostgREST and Storage straight with its own
-- token, so each rule is proven here by calling the database as that client: a second provider, a
-- customer, an admin and anon denied each table, each object and each function they must not reach,
-- every refusal code, the scanner corpus (verify.md), and the races by state (a replaced file, a rename,
-- a second click). AC-2, AC-3, AC-6 to AC-9, AC-12, AC-16 to AC-23.
--
-- Fixture users go straight into auth.users and profiles, as complete_onboarding leaves them. Storage
-- objects go straight into storage.objects as postgres, as the Storage API leaves them after an upload;
-- the upload policy itself is proven by inserting as the user. Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(248);

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- Rows an earlier local e2e run left behind; CI starts empty. Gone only inside this rolled back transaction.
DELETE FROM public.audit_log WHERE action LIKE 'provider.%' OR action LIKE 'document.%';
DELETE FROM public.provider_documents;
DELETE FROM public.provider_profiles;

-- p1, p2: providers. c1: a customer. a1, a2: admins.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at) VALUES
  ('00000000-0000-0000-0000-0000000002a1', 'authenticated', 'authenticated', '905552220001', now()),
  ('00000000-0000-0000-0000-0000000002a2', 'authenticated', 'authenticated', '905552220002', now()),
  ('00000000-0000-0000-0000-0000000002c1', 'authenticated', 'authenticated', '905552220003', now()),
  ('00000000-0000-0000-0000-0000000002d1', 'authenticated', 'authenticated', '905552220004', now()),
  ('00000000-0000-0000-0000-0000000002d2', 'authenticated', 'authenticated', '905552220005', now());

INSERT INTO public.profiles (id, role, region, phone, full_name, locale) VALUES
  ('00000000-0000-0000-0000-0000000002a1', 'provider', 'TR', '+905552220001', 'Ayşe Usta', 'tr'),
  ('00000000-0000-0000-0000-0000000002a2', 'provider', 'TR', '+905552220002', 'Mehmet Usta', 'tr'),
  ('00000000-0000-0000-0000-0000000002c1', 'customer', 'TR', '+905552220003', 'Can Müşteri', 'tr'),
  ('00000000-0000-0000-0000-0000000002d1', 'admin', 'TR', '+905552220004', 'Admin Bir', 'en'),
  ('00000000-0000-0000-0000-0000000002d2', 'admin', 'TR', '+905552220005', 'Admin İki', 'en');

-- Stand ins for uploaded objects: (bucket, name, mimetype, size, age).
CREATE FUNCTION pg_temp.put(p_bucket text, p_name text, p_mime text, p_size bigint, p_age interval DEFAULT '0')
  RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO storage.objects (bucket_id, name, metadata, created_at)
  VALUES (p_bucket, p_name, jsonb_build_object('mimetype', p_mime, 'size', p_size), now() - p_age)
  RETURNING id
$$;

-- ── structure: rows, grants, settings (AC-20, AC-21) ─────────────────────────
SELECT results_eq(
  $$ SELECT id::text, region, status FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-00000000020%' OR id::text LIKE '00000000-0000-0000-0000-0000000002%' ORDER BY id $$,
  $$ VALUES ('00000000-0000-0000-0000-0000000002a1', 'TR', 'draft'),
            ('00000000-0000-0000-0000-0000000002a2', 'TR', 'draft') $$,
  'a profile with role provider gets a draft providers row; a customer and an admin get none'
);

SELECT table_privs_are('public', 'providers', 'anon', ARRAY[]::text[], 'anon holds nothing on providers');
SELECT table_privs_are('public', 'providers', 'authenticated', ARRAY[]::text[], 'signed in users hold no table wide privilege on providers: their reads are column grants');
SELECT ok(has_column_privilege('authenticated', 'public.providers', 'status', 'SELECT') AND NOT has_column_privilege('authenticated', 'public.providers', 'status', 'UPDATE'), 'they read status, and write nothing');
SELECT ok(NOT has_column_privilege('authenticated', 'public.providers', 'decided_by', 'SELECT'), 'they never read decided_by, an admin id');
SELECT table_privs_are('public', 'providers', 'service_role', ARRAY['SELECT'], 'service_role only reads providers');
SELECT table_privs_are('public', 'provider_profiles', 'anon', ARRAY[]::text[], 'anon holds nothing on provider_profiles');
SELECT table_privs_are('public', 'provider_profiles', 'authenticated', ARRAY['SELECT'], 'signed in users only read provider_profiles');
SELECT table_privs_are('public', 'provider_profiles', 'service_role', ARRAY['SELECT'], 'service_role only reads provider_profiles');
SELECT table_privs_are('public', 'provider_documents', 'anon', ARRAY[]::text[], 'anon holds nothing on provider_documents');
SELECT table_privs_are('public', 'provider_documents', 'authenticated', ARRAY[]::text[], 'signed in users hold no table wide privilege on provider_documents: their reads are column grants');
SELECT ok(NOT has_column_privilege('authenticated', 'public.provider_documents', 'reviewed_by', 'SELECT'), 'they never read reviewed_by, an admin id');
SELECT table_privs_are('public', 'provider_documents', 'service_role', ARRAY['SELECT'], 'service_role only reads provider_documents');

SELECT ok(has_function_privilege('authenticated', 'public.save_provider_profile(text, text, text, text, integer, text[])', 'EXECUTE'), 'a signed in user may call save_provider_profile (the function checks who)');
SELECT ok(NOT has_function_privilege('anon', 'public.save_provider_profile(text, text, text, text, integer, text[])', 'EXECUTE'), 'anon may not');
SELECT ok(NOT has_function_privilege('anon', 'public.decide_provider(uuid, text, timestamp with time zone, text, text)', 'EXECUTE'), 'anon may not decide');
SELECT ok(NOT has_function_privilege('service_role', 'public.decide_provider(uuid, text, timestamp with time zone, text, text)', 'EXECUTE'), 'service_role may not decide');
SELECT ok(NOT has_function_privilege('authenticated', 'public.has_contact_info(text)', 'EXECUTE'), 'nobody probes the scanner through the API (AC-3)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.provider_caller()', 'EXECUTE'), 'the helpers are internal');
SELECT ok(NOT has_function_privilege('authenticated', 'public.provider_back_to_review(public.providers, text)', 'EXECUTE'), 'back to review is internal');
SELECT ok(NOT has_function_privilege('authenticated', 'public.provider_row()', 'EXECUTE'), 'the row trigger is not callable');

SELECT results_eq(
  $$ SELECT region, key, value FROM public.platform_settings
      WHERE key IN ('criminal_record_required', 'provider_docs_consent_version') ORDER BY region, key $$,
  $$ VALUES ('KSA', 'criminal_record_required', 'true'::jsonb),
            ('KSA', 'provider_docs_consent_version', '"provider-docs-draft-1"'::jsonb),
            ('TR', 'criminal_record_required', 'true'::jsonb),
            ('TR', 'provider_docs_consent_version', '"provider-docs-draft-1"'::jsonb) $$,
  'the two settings are seeded per region'
);

SELECT is(public.provider_required_types('TR'), ARRAY['profile_photo', 'id_front', 'id_back', 'selfie', 'criminal_record'], 'the record is required by default (C21)');
UPDATE public.platform_settings SET value = 'false' WHERE region = 'KSA' AND key = 'criminal_record_required';
SELECT is(public.provider_required_types('KSA'), ARRAY['profile_photo', 'id_front', 'id_back', 'selfie'], 'the JSON value false drops the record');
UPDATE public.platform_settings SET value = '"no"' WHERE region = 'KSA' AND key = 'criminal_record_required';
SELECT is(public.provider_required_types('KSA'), ARRAY['profile_photo', 'id_front', 'id_back', 'selfie', 'criminal_record'], 'an odd value reads as required');
DELETE FROM public.platform_settings WHERE region = 'KSA' AND key = 'criminal_record_required';
SELECT is(public.provider_required_types('KSA'), ARRAY['profile_photo', 'id_front', 'id_back', 'selfie', 'criminal_record'], 'a missing row reads as required');

-- ── the scanner corpus (AC-3, verify.md) ────────────────────────────────────
SELECT is_empty(
  $$ SELECT t FROM (VALUES
       ('0555 123 45 67'), ('+90 555 123 4567'), ('٠٥٥٥١٢٣٤٥٦٧'), ('۰۵۵۵۱۲۳۴۵۶۷'),
       ('0 5 5 5 1 2 3 4 5 6 7'), ('0555.123.45.67'), ('0555-123-45-67'),
       (E'0​5​5​5 1​2​3 4​5 6​7'),
       ('sıfır beş beş beş bir iki üç dört'), ('zero five five five one two three'),
       ('صفر خمسة خمسة خمسة واحد اثنان ثلاثة'),
       ('ali@example.com'), ('ali at example dot com'), ('ali [at] example [dot] com'),
       ('https://example.com'), ('www.example.com'),
       ('example.com'), ('example.net'), ('example.com.tr'),
       ('wa.me/905551234567'), ('t.me/ali'), ('@ali_temizlik'),
       ('WhatsApp'), ('whatsapp''tan yaz'), ('telegram'), ('Instagram'), ('insta'),
       ('واتساب'), ('وتساب'), ('تلجرام'), ('تيليجرام'), ('انستقرام'), ('انستا')
     ) AS c(t)
     WHERE NOT public.has_contact_info(t) $$,
  'every must catch row of the corpus is flagged'
);
SELECT is_empty(
  $$ SELECT t FROM (VALUES
       ('6 years of experience in homes and villas'), ('since 2019'), ('5 rooms and 2 bathrooms'),
       ('3 bedrooms, 2 bathrooms, 1 kitchen'), ('I work Monday to Friday, 9 to 5.'),
       ('Marble, parquet and glass: safe for children and pets.'),
       ('10 yıldır temizlik yapıyorum'), ('2019''dan beri evlerde çalışıyorum'), ('bir iki saatte biter'),
       ('Mutfak, banyo ve cam temizliği yaparım.'),
       ('خبرة 6 سنوات في تنظيف المنازل والفلل'), ('بدأت العمل عام 2019'), ('أعمل من 9 إلى 5')
     ) AS c(t)
     WHERE public.has_contact_info(t) $$,
  'every must pass row of the corpus passes'
);
SELECT ok(public.has_contact_info('SIFIR BEŞ BEŞ BEŞ BİR'), 'capitals fold with no Turkish locale: spelled digits in capitals are caught');
SELECT ok(public.has_contact_info('ＷｈａｔｓＡｐｐ'), 'full width letters fold under NFKC');
SELECT ok(public.has_contact_info('2015-2020'), 'known false positive, accepted: 8 digits with a one character gap');
SELECT ok(NOT public.has_contact_info('ali nokta example'), 'known miss, accepted: an email spelled in Turkish words');
SELECT ok(NOT public.has_contact_info('instant service, installation'), 'insta inside another word is not the brand');
SELECT ok(NOT public.has_contact_info(NULL), 'null is clean');

-- ── RLS: who reads what (AC-21) ──────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.providers $$, '42501', NULL, 'anon cannot read providers');
SELECT throws_ok($$ SELECT 1 FROM public.provider_documents $$, '42501', NULL, 'anon cannot read provider_documents');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT results_eq($$ SELECT id::text FROM public.providers $$, $$ VALUES ('00000000-0000-0000-0000-0000000002a1') $$, 'a provider reads only their own providers row');
SELECT throws_ok($$ UPDATE public.providers SET status = 'approved' $$, '42501', NULL, 'a provider cannot set their status directly');
SELECT throws_ok($$ INSERT INTO public.provider_documents (provider_id, region, type, storage_path, object_id, mime_type, size_bytes) VALUES ('00000000-0000-0000-0000-0000000002a1', 'TR', 'selfie', 'x', gen_random_uuid(), 'image/jpeg', 1) $$, '42501', NULL, 'a provider cannot write a document row directly');
SELECT throws_ok($$ INSERT INTO public.provider_profiles (provider_id, region, bio, years_experience, languages) VALUES ('00000000-0000-0000-0000-0000000002a1', 'TR', repeat('x', 40), 1, '{tr}') $$, '42501', NULL, 'a provider cannot write provider_profiles directly');

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002c1", "role": "authenticated"}', true);
SELECT is_empty($$ SELECT 1 FROM public.providers $$, 'a customer reads no providers row');
SELECT is(public.provider_standing('00000000-0000-0000-0000-0000000002a1'), NULL, 'a customer gets a null standing, never a guess');
SELECT ok(NOT public.provider_can_apply('00000000-0000-0000-0000-0000000002a1'), 'and provider_can_apply is false for them');

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.providers WHERE id IN ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-0000000002a2')), 2, 'an admin reads every providers row');
SELECT ok(public.is_admin(), 'is_admin() reads profiles.role');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT throws_ok($$ UPDATE public.providers SET status = 'approved' $$, '42501', NULL, 'service_role cannot write providers either');
RESET ROLE;

-- ── forbidden: a customer and an admin call every provider function (AC-21) ──
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002c1", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.save_provider_profile('individual', NULL, NULL, repeat('a', 40), 3, '{tr}') $$, 'P0001', 'forbidden', 'a customer cannot save a provider profile');
SELECT throws_ok($$ SELECT public.accept_provider_docs_consent('tr') $$, 'P0001', 'forbidden', 'a customer cannot accept the documents consent');
SELECT throws_ok($$ SELECT public.register_provider_document('selfie', 'x') $$, 'P0001', 'forbidden', 'a customer cannot register a document');
SELECT throws_ok($$ SELECT public.submit_provider_file() $$, 'P0001', 'forbidden', 'a customer cannot submit');
SELECT throws_ok($$ SELECT public.decide_provider('00000000-0000-0000-0000-0000000002a1', 'approved', now(), NULL, NULL) $$, 'P0001', 'forbidden', 'a customer cannot decide');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.save_provider_profile('individual', NULL, NULL, repeat('a', 40), 3, '{tr}') $$, 'P0001', 'forbidden', 'an admin cannot save a provider profile');
SELECT throws_ok($$ SELECT public.accept_provider_docs_consent('tr') $$, 'P0001', 'forbidden', 'an admin cannot accept the documents consent');
SELECT throws_ok($$ SELECT public.register_provider_document('selfie', 'x') $$, 'P0001', 'forbidden', 'an admin cannot register a document');
SELECT throws_ok($$ SELECT public.submit_provider_file() $$, 'P0001', 'forbidden', 'an admin cannot submit');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.decide_provider('00000000-0000-0000-0000-0000000002a1', 'approved', now(), NULL, NULL) $$, 'P0001', 'forbidden', 'a provider calling decide_provider gets forbidden');
SELECT throws_ok($$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[gen_random_uuid()], ARRAY[gen_random_uuid()], 'approved', NULL, NULL, NULL) $$, 'P0001', 'forbidden', 'a provider cannot mark their own document');
SELECT throws_ok($$ SELECT public.suspend_provider('00000000-0000-0000-0000-0000000002a2', 'because') $$, 'P0001', 'forbidden', 'a provider cannot suspend');
SELECT throws_ok($$ SELECT public.log_document_view(gen_random_uuid(), gen_random_uuid()) $$, 'P0001', 'forbidden', 'a provider cannot log a view');
RESET ROLE;

-- ── save_provider_profile (AC-2, AC-3, AC-12) ────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.save_provider_profile('individual', NULL, NULL, '  short bio  ', 3, '{tr}') $$, 'P0001', 'validation_failed', 'a bio under 30 characters after trim is refused');
SELECT throws_ok($$ SELECT public.save_provider_profile('individual', NULL, NULL, repeat('a', 601), 3, '{tr}') $$, 'P0001', 'validation_failed', 'a bio over 600 is refused');
SELECT throws_ok($$ SELECT public.save_provider_profile('individual', NULL, NULL, repeat('a', 40), 61, '{tr}') $$, 'P0001', 'validation_failed', 'years over 60 are refused');
SELECT throws_ok($$ SELECT public.save_provider_profile('individual', NULL, NULL, repeat('a', 40), -1, '{tr}') $$, 'P0001', 'validation_failed', 'negative years are refused');
SELECT throws_ok($$ SELECT public.save_provider_profile('individual', NULL, NULL, repeat('a', 40), 3, '{}') $$, 'P0001', 'validation_failed', 'no language is refused');
SELECT throws_ok($$ SELECT public.save_provider_profile('individual', NULL, NULL, repeat('a', 40), 3, '{tr,de}') $$, 'P0001', 'validation_failed', 'a language off the list is refused');
SELECT throws_ok($$ SELECT public.save_provider_profile('person', NULL, NULL, repeat('a', 40), 3, '{tr}') $$, 'P0001', 'validation_failed', 'an unknown entity type is refused');
SELECT throws_ok($$ SELECT public.save_provider_profile('company', 'A', '1234567890', repeat('a', 40), 3, '{tr}') $$, 'P0001', 'validation_failed', 'a legal name under 2 characters is refused');
SELECT throws_ok($$ SELECT public.save_provider_profile('company', 'Usta Ltd', '12345678901', repeat('a', 40), 3, '{tr}') $$, 'P0001', 'validation_failed', 'an 11 digit number (a national ID) is refused as a Turkish tax number');
SELECT throws_ok($$ SELECT public.save_provider_profile('company', 'Usta Ltd', NULL, repeat('a', 40), 3, '{tr}') $$, 'P0001', 'validation_failed', 'a company needs a tax number');
SELECT throws_ok($$ SELECT public.save_provider_profile('individual', NULL, NULL, 'Ev temizliği yaparım, bana 0555 123 45 67 numarasından ulaşın.', 3, '{tr}') $$, 'P0001', 'contact_info_in_bio', 'a bio with a phone is refused through a direct call');
SELECT throws_ok($$ SELECT public.save_provider_profile('individual', NULL, NULL, 'Ev temizliği yaparım, sıfır beş beş beş bir iki üç dört diye arayın.', 3, '{tr}') $$, 'P0001', 'contact_info_in_bio', 'a bio with a spelled Turkish phone is refused too');
SELECT is_empty($$ SELECT 1 FROM public.provider_profiles $$, 'nothing was saved by any refusal');

SELECT is(
  public.save_provider_profile('company', '  Usta Temizlik Ltd  ', ' ١٢٣ ٤٥٦-٧٨٩٠ ', '  Ev ve ofis temizliğinde on yıllık deneyim, özenle çalışırım.  ', 10, '{tr,ar,tr}'),
  '{"backToReview": false}'::jsonb,
  'a company saves'
);
SELECT results_eq(
  $$ SELECT entity_type, legal_name, tax_number COLLATE "default" FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1' $$,
  $$ VALUES ('company', 'Usta Temizlik Ltd', '1234567890') $$,
  'Arabic Indic digits with spaces and a dash are stored as 10 Western digits; the name is trimmed'
);
SELECT results_eq(
  $$ SELECT bio, years_experience::int, languages FROM public.provider_profiles $$,
  $$ VALUES ('Ev ve ofis temizliğinde on yıllık deneyim, özenle çalışırım.', 10, ARRAY['ar', 'tr']) $$,
  'the bio is trimmed and the languages are one sorted set'
);
RESET ROLE;
SELECT is_empty($$ SELECT 1 FROM public.audit_log WHERE action = 'provider.company_changed' $$, 'the first save of the company fields writes no company_changed row');

CREATE TEMP TABLE before_save AS SELECT * FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT is(
  public.save_provider_profile('company', 'Usta Temizlik Ltd', '123 456 78 90', 'Ev ve ofis temizliğinde on yıllık deneyim, özenle çalışırım.', 10, '{ar,tr}'),
  '{"backToReview": false}'::jsonb,
  'saving the same values in another spelling'
);
RESET ROLE;
SELECT is_empty(
  $$ SELECT entity_type, legal_name, tax_number, status, review_reason FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1'
     EXCEPT SELECT entity_type, legal_name, tax_number, status, review_reason FROM before_save $$,
  'saving twice changes nothing but updated_at'
);
SELECT is_empty($$ SELECT 1 FROM public.audit_log WHERE action = 'provider.company_changed' $$, 'and writes no company_changed row');

-- ── the documents consent (AC-6) ─────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT ok(NOT public.provider_may_store('provider-documents', '00000000-0000-0000-0000-0000000002a1/selfie/10000000-0000-4000-8000-000000000001.jpg'), 'no document upload before the consent');
SELECT ok(public.provider_may_store('provider-photos', '00000000-0000-0000-0000-0000000002a1/profile_photo/10000000-0000-4000-8000-000000000001.jpg'), 'the photo bucket does not need it');
SELECT throws_ok($$ SELECT public.accept_provider_docs_consent('de') $$, 'P0001', 'validation_failed', 'an unknown locale is refused');
SELECT is(public.accept_provider_docs_consent('tr'), '{"version": "provider-docs-draft-1"}'::jsonb, 'the consent is accepted');
SELECT is(public.accept_provider_docs_consent('en'), '{"version": "provider-docs-draft-1"}'::jsonb, 'a retry answers the same');
RESET ROLE;
SELECT results_eq(
  $$ SELECT region, terms_version, locale FROM public.terms_acceptances WHERE user_id = '00000000-0000-0000-0000-0000000002a1' $$,
  $$ VALUES ('TR', 'provider-docs-draft-1', 'tr') $$,
  'one terms_acceptances row with the version and the first locale; the retry added nothing'
);

-- ── provider_may_store (AC-22) ───────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT ok(public.provider_may_store('provider-documents', '00000000-0000-0000-0000-0000000002a1/selfie/10000000-0000-4000-8000-000000000001.jpg'), 'with the consent, a document upload to their own folder is allowed');
SELECT ok(public.provider_may_store('provider-documents', '00000000-0000-0000-0000-0000000002a1/criminal_record/10000000-0000-4000-8000-000000000001.pdf'), 'a PDF record is allowed');
SELECT ok(NOT public.provider_may_store('provider-documents', '00000000-0000-0000-0000-0000000002a1/selfie/10000000-0000-4000-8000-000000000001.pdf'), 'a PDF selfie is not');
SELECT ok(NOT public.provider_may_store('provider-documents', '00000000-0000-0000-0000-0000000002a2/selfie/10000000-0000-4000-8000-000000000001.jpg'), 'another provider''s folder is not');
SELECT ok(NOT public.provider_may_store('provider-documents', '00000000-0000-0000-0000-0000000002a1/profile_photo/10000000-0000-4000-8000-000000000001.jpg'), 'the photo type in the documents bucket is not');
SELECT ok(NOT public.provider_may_store('provider-photos', '00000000-0000-0000-0000-0000000002a1/profile_photo/10000000-0000-4000-8000-000000000001.png'), 'a PNG photo is not');
SELECT ok(NOT public.provider_may_store('provider-documents', '00000000-0000-0000-0000-0000000002a1/selfie/../x.jpg'), 'a climbing path is not');
SELECT ok(NOT public.provider_may_store('provider-documents', '00000000-0000-0000-0000-0000000002A1/selfie/10000000-0000-4000-8000-000000000001.jpg'), 'an upper case folder is not');
SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name) VALUES ('provider-documents', '00000000-0000-0000-0000-0000000002a2/selfie/10000000-0000-4000-8000-000000000009.jpg') $$,
  '42501', NULL, 'the insert policy refuses an upload into another provider''s folder'
);
SELECT lives_ok(
  $$ INSERT INTO storage.objects (bucket_id, name) VALUES ('provider-photos', '00000000-0000-0000-0000-0000000002a1/profile_photo/10000000-0000-4000-8000-000000000009.jpg') $$,
  'the insert policy allows the provider''s own photo'
);
RESET ROLE;

-- A customer and an admin store nothing, even with a terms_acceptances row for the consent version.
INSERT INTO public.terms_acceptances (user_id, region, terms_version, locale) VALUES
  ('00000000-0000-0000-0000-0000000002c1', 'TR', 'provider-docs-draft-1', 'tr'),
  ('00000000-0000-0000-0000-0000000002d1', 'TR', 'provider-docs-draft-1', 'tr');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002c1", "role": "authenticated"}', true);
SELECT ok(NOT public.provider_may_store('provider-documents', '00000000-0000-0000-0000-0000000002c1/selfie/10000000-0000-4000-8000-000000000001.jpg'), 'a customer may store no document');
SELECT ok(NOT public.provider_may_store('provider-photos', '00000000-0000-0000-0000-0000000002c1/profile_photo/10000000-0000-4000-8000-000000000001.jpg'), 'nor a photo');
SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name) VALUES ('provider-photos', '00000000-0000-0000-0000-0000000002c1/profile_photo/10000000-0000-4000-8000-000000000001.jpg') $$,
  '42501', NULL, 'Storage refuses a customer''s upload'
);
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT ok(NOT public.provider_may_store('provider-documents', '00000000-0000-0000-0000-0000000002d1/selfie/10000000-0000-4000-8000-000000000001.jpg'), 'an admin may store no document');
SELECT ok(NOT public.provider_may_store('provider-photos', '00000000-0000-0000-0000-0000000002d1/profile_photo/10000000-0000-4000-8000-000000000001.jpg'), 'nor a photo');
RESET ROLE;

-- The cap: 20 counted objects. Fresh orphans count; orphans older than 24 hours do not (D120).
SELECT pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a2/skill_certificate/' || gen_random_uuid() || '.pdf', 'application/pdf', 10, '25 hours')
  FROM generate_series(1, 20);
INSERT INTO public.terms_acceptances (user_id, region, terms_version, locale)
VALUES ('00000000-0000-0000-0000-0000000002a2', 'TR', 'provider-docs-draft-1', 'tr');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a2", "role": "authenticated"}', true);
SELECT ok(public.provider_may_store('provider-documents', '00000000-0000-0000-0000-0000000002a2/selfie/10000000-0000-4000-8000-000000000001.jpg'), '20 orphans older than 24 hours do not block an upload');
RESET ROLE;
SELECT pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a2/skill_certificate/' || gen_random_uuid() || '.pdf', 'application/pdf', 10)
  FROM generate_series(1, 20);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a2", "role": "authenticated"}', true);
SELECT ok(NOT public.provider_may_store('provider-documents', '00000000-0000-0000-0000-0000000002a2/selfie/10000000-0000-4000-8000-000000000001.jpg'), '20 fresh orphans do');
RESET ROLE;
-- A signed upload URL is checked when it is made; Storage writes the object later as service_role, past
-- RLS. The trigger runs the same rules at that insert.
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name) VALUES ('provider-documents', '00000000-0000-0000-0000-0000000002a2/selfie/10000000-0000-4000-8000-000000000002.jpg') $$,
  '42501', 'upload_refused', 'a signed upload past the cap is refused at the insert'
);
SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name) VALUES ('provider-photos', '00000000-0000-0000-0000-0000000002c1/profile_photo/10000000-0000-4000-8000-000000000002.jpg') $$,
  '42501', 'upload_refused', 'a signed upload into a customer folder is refused'
);
SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name) VALUES ('provider-photos', 'not-a-uuid/profile_photo/10000000-0000-4000-8000-000000000002.jpg') $$,
  '42501', 'upload_refused', 'a signed upload with no provider folder is refused'
);
SELECT lives_ok(
  $$ INSERT INTO storage.objects (bucket_id, name) VALUES ('provider-photos', '00000000-0000-0000-0000-0000000002a1/profile_photo/10000000-0000-4000-8000-000000000008.jpg') $$,
  'a signed upload within the rules is written'
);
RESET ROLE;
-- Clear p2's folder for what follows (Storage refuses an SQL delete without this setting).
SET LOCAL storage.allow_delete_query = 'true';
DELETE FROM storage.objects WHERE name LIKE '00000000-0000-0000-0000-0000000002a2/%';
DELETE FROM storage.objects WHERE name IN ('00000000-0000-0000-0000-0000000002a1/profile_photo/10000000-0000-4000-8000-000000000009.jpg',
                                          '00000000-0000-0000-0000-0000000002a1/profile_photo/10000000-0000-4000-8000-000000000008.jpg');

-- ── register_provider_document (AC-7, AC-8) ──────────────────────────────────
CREATE TEMP TABLE obj (k text PRIMARY KEY, id uuid, name text);
INSERT INTO obj VALUES
  ('photo',  pg_temp.put('provider-photos',    '00000000-0000-0000-0000-0000000002a1/profile_photo/20000000-0000-4000-8000-000000000001.jpg', 'image/jpeg', 50000, '10 minutes'), '00000000-0000-0000-0000-0000000002a1/profile_photo/20000000-0000-4000-8000-000000000001.jpg'),
  ('front',  pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a1/id_front/20000000-0000-4000-8000-000000000002.jpg', 'image/jpeg', 50000, '10 minutes'), '00000000-0000-0000-0000-0000000002a1/id_front/20000000-0000-4000-8000-000000000002.jpg'),
  ('back',   pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a1/id_back/20000000-0000-4000-8000-000000000003.png', 'image/png', 50000, '10 minutes'), '00000000-0000-0000-0000-0000000002a1/id_back/20000000-0000-4000-8000-000000000003.png'),
  ('selfie', pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a1/selfie/20000000-0000-4000-8000-000000000004.jpg', 'image/jpeg', 50000, '10 minutes'), '00000000-0000-0000-0000-0000000002a1/selfie/20000000-0000-4000-8000-000000000004.jpg'),
  ('record', pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a1/criminal_record/20000000-0000-4000-8000-000000000005.pdf', 'application/pdf', 50000, '10 minutes'), '00000000-0000-0000-0000-0000000002a1/criminal_record/20000000-0000-4000-8000-000000000005.pdf'),
  ('liar',   pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a1/criminal_record/20000000-0000-4000-8000-000000000006.pdf', 'image/png', 50000, '10 minutes'), '00000000-0000-0000-0000-0000000002a1/criminal_record/20000000-0000-4000-8000-000000000006.pdf'),
  ('p2self', pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a2/selfie/20000000-0000-4000-8000-000000000007.jpg', 'image/jpeg', 50000), '00000000-0000-0000-0000-0000000002a2/selfie/20000000-0000-4000-8000-000000000007.jpg');
GRANT SELECT ON obj TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.register_provider_document('selfie', '00000000-0000-0000-0000-0000000002a1/selfie/20000000-0000-4000-8000-0000000000ff.jpg') $$, 'P0001', 'file_missing', 'an object that does not exist is file_missing');
SELECT throws_ok($$ SELECT public.register_provider_document('selfie', (SELECT name FROM obj WHERE k = 'p2self')) $$, 'P0001', 'file_missing', 'another provider''s object is file_missing');
SELECT throws_ok($$ SELECT public.register_provider_document('id_back', (SELECT name FROM obj WHERE k = 'selfie')) $$, 'P0001', 'file_missing', 'an object of another type is file_missing');
SELECT throws_ok($$ SELECT public.register_provider_document('criminal_record', (SELECT name FROM obj WHERE k = 'liar')) $$, 'P0001', 'file_type_refused', 'a stored type that does not match the extension is refused');
SELECT throws_ok($$ SELECT public.register_provider_document('passport', 'x') $$, 'P0001', 'validation_failed', 'an unknown type is refused');

SELECT is((public.register_provider_document('profile_photo', (SELECT name FROM obj WHERE k = 'photo')) ->> 'created')::boolean, true, 'the photo registers');
SELECT is((public.register_provider_document('profile_photo', (SELECT name FROM obj WHERE k = 'photo')) ->> 'created')::boolean, false, 'a retry with the same object writes nothing');
SELECT is((public.register_provider_document('id_front', (SELECT name FROM obj WHERE k = 'front')) ->> 'status'), 'pending', 'the ID front registers as pending');
SELECT is((public.register_provider_document('id_back', (SELECT name FROM obj WHERE k = 'back')) ->> 'mime_type'), 'image/png', 'the type comes from storage.objects');
RESET ROLE;

SELECT results_eq(
  $$ SELECT d.object_id, d.size_bytes, d.mime_type FROM public.provider_documents d WHERE d.type = 'id_back' $$,
  $$ SELECT o.id, (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype' FROM storage.objects o WHERE o.name = (SELECT name FROM obj WHERE k = 'back') $$,
  'object id, size and type match storage.objects'
);
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'document.registered'), 3, 'one document.registered row per registration; the retry wrote none');
SELECT is((SELECT old_value FROM public.audit_log WHERE action = 'document.registered' ORDER BY id LIMIT 1), NULL, 'a first upload has a null old_value');

-- ── submit_provider_file (AC-9) ──────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT is(
  public.submit_provider_file(),
  '{"status": "draft", "missing": ["selfie", "criminal_record"], "rejected": [], "objectsMissing": []}'::jsonb,
  'with documents missing, submit names them and writes nothing'
);
SELECT lives_ok($$ SELECT public.register_provider_document('selfie', (SELECT name FROM obj WHERE k = 'selfie')) $$, 'the selfie registers');
SELECT lives_ok($$ SELECT public.register_provider_document('criminal_record', (SELECT name FROM obj WHERE k = 'record')) $$, 'the record registers');
RESET ROLE;

-- An object removed behind a row is file_missing at submit.
SET LOCAL storage.allow_delete_query = 'true';
DELETE FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'selfie');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT is(public.submit_provider_file() -> 'objectsMissing', '["selfie"]'::jsonb, 'a row whose object is gone is reported, not submitted');
RESET ROLE;
UPDATE obj SET id = pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a1/selfie/20000000-0000-4000-8000-000000000014.jpg', 'image/jpeg', 50000, '5 minutes'),
               name = '00000000-0000-0000-0000-0000000002a1/selfie/20000000-0000-4000-8000-000000000014.jpg'
 WHERE k = 'selfie';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT lives_ok($$ SELECT public.register_provider_document('selfie', (SELECT name FROM obj WHERE k = 'selfie')) $$, 'the selfie is uploaded again');
SELECT is(public.submit_provider_file() ->> 'status', 'pending', 'a complete file goes to pending');
SELECT is(public.submit_provider_file() ->> 'status', 'pending', 'a second submit answers the status');
SELECT is(public.provider_standing('00000000-0000-0000-0000-0000000002a1'), 'pending', 'the standing reads pending');
RESET ROLE;
SELECT results_eq(
  $$ SELECT status, review_reason, submitted_at IS NOT NULL FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1' $$,
  $$ VALUES ('pending', 'first_submission', true) $$,
  'pending, first_submission, submitted_at set'
);
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'provider.submitted'), 1, 'one provider.submitted row, after two submits');

-- ── admin: Show, then the verdicts (AC-16, AC-17) ────────────────────────────
CREATE TEMP TABLE doc AS SELECT type, id, object_id FROM public.provider_documents WHERE provider_id = '00000000-0000-0000-0000-0000000002a1';
GRANT SELECT ON doc TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT is_empty($$ SELECT 1 FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'front') $$, 'an admin with no view row reads no object (no signed link)');
SELECT throws_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM doc WHERE type = 'selfie')], ARRAY[(SELECT object_id FROM doc WHERE type = 'selfie')], 'approved', NULL, NULL, NULL) $$,
  'P0001', 'view_required', 'Match before Show is view_required'
);
SELECT throws_ok($$ SELECT public.log_document_view((SELECT id FROM doc WHERE type = 'selfie'), gen_random_uuid()) $$, 'P0001', 'stale_document', 'Show with a changed object is stale_document');
SELECT is(
  public.log_document_view((SELECT id FROM doc WHERE type = 'selfie'), (SELECT object_id FROM doc WHERE type = 'selfie')) ->> 'bucket',
  'provider-documents', 'Show returns the bucket and path'
);
SELECT is((SELECT count(*)::int FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'selfie')), 1, 'with a fresh view row the admin reads that object');
SELECT lives_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM doc WHERE type = 'selfie')], ARRAY[(SELECT object_id FROM doc WHERE type = 'selfie')], 'approved', NULL, NULL, NULL) $$,
  'Match after Show passes'
);
SELECT throws_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM doc WHERE type = 'selfie')], ARRAY[(SELECT object_id FROM doc WHERE type = 'selfie')], 'approved', NULL, NULL, current_date + 30) $$,
  'P0001', 'valid_until_invalid', 'a date on the selfie is refused'
);
SELECT throws_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM doc WHERE type = 'selfie')], ARRAY[(SELECT object_id FROM doc WHERE type = 'selfie')], 'rejected', NULL, NULL, NULL) $$,
  'P0001', 'reason_required', 'Reject with no chip is refused'
);
SELECT throws_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM doc WHERE type = 'id_front')], ARRAY[(SELECT object_id FROM doc WHERE type = 'id_front')], 'rejected', 'document_unclear', NULL, NULL) $$,
  'P0001', 'validation_failed', 'one ID side alone is refused: both sides take one verdict'
);
SELECT lives_ok($$ SELECT public.log_document_view((SELECT id FROM doc WHERE type = 'id_front'), (SELECT object_id FROM doc WHERE type = 'id_front')) $$, 'Show the front');
SELECT throws_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM doc WHERE type = 'id_front'), (SELECT id FROM doc WHERE type = 'id_back')], ARRAY[(SELECT object_id FROM doc WHERE type = 'id_front'), (SELECT object_id FROM doc WHERE type = 'id_back')], 'approved', NULL, NULL, current_date + 365) $$,
  'P0001', 'view_required', 'Match on the ID needs both sides shown'
);
SELECT lives_ok($$ SELECT public.log_document_view((SELECT id FROM doc WHERE type = 'id_back'), (SELECT object_id FROM doc WHERE type = 'id_back')) $$, 'Show the back');
SELECT throws_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM doc WHERE type = 'id_front'), (SELECT id FROM doc WHERE type = 'id_back')], ARRAY[(SELECT object_id FROM doc WHERE type = 'id_front'), (SELECT object_id FROM doc WHERE type = 'id_back')], 'approved', NULL, NULL, NULL) $$,
  'P0001', 'valid_until_required', 'Match on the ID with no date is refused'
);
SELECT throws_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM doc WHERE type = 'id_front'), (SELECT id FROM doc WHERE type = 'id_back')], ARRAY[(SELECT object_id FROM doc WHERE type = 'id_front'), (SELECT object_id FROM doc WHERE type = 'id_back')], 'approved', NULL, NULL, current_date - 1) $$,
  'P0001', 'valid_until_invalid', 'a past date is refused'
);
SELECT throws_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM doc WHERE type = 'id_front'), (SELECT id FROM doc WHERE type = 'id_back')], ARRAY[(SELECT object_id FROM doc WHERE type = 'id_front'), (SELECT object_id FROM doc WHERE type = 'id_back')], 'approved', NULL, NULL, (current_date + interval '16 years')::date) $$,
  'P0001', 'valid_until_invalid', 'a date 16 years ahead is refused'
);
SELECT throws_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM doc WHERE type = 'id_front'), (SELECT id FROM doc WHERE type = 'id_back')], ARRAY[(SELECT object_id FROM doc WHERE type = 'id_front'), gen_random_uuid()], 'approved', NULL, NULL, current_date + 365) $$,
  'P0001', 'stale_document', 'a verdict naming an object it did not see is stale_document'
);
SELECT lives_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM doc WHERE type = 'id_front'), (SELECT id FROM doc WHERE type = 'id_back')], ARRAY[(SELECT object_id FROM doc WHERE type = 'id_front'), (SELECT object_id FROM doc WHERE type = 'id_back')], 'approved', NULL, NULL, current_date + 365) $$,
  'one click marks both ID sides'
);
SELECT throws_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a2', ARRAY[(SELECT id FROM doc WHERE type = 'selfie')], ARRAY[(SELECT object_id FROM doc WHERE type = 'selfie')], 'approved', NULL, NULL, NULL) $$,
  'P0001', 'not_found', 'a draft provider is not found by an admin function (AC-14, AC-15)'
);
SELECT throws_ok(
  $$ SELECT public.decide_provider('00000000-0000-0000-0000-0000000002a1', 'approved', (SELECT updated_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1'), NULL, NULL) $$,
  'P0001', 'documents_not_reviewed', 'Approve stays closed while the photo and the record are unreviewed'
);
SELECT throws_ok(
  $$ SELECT public.decide_provider('00000000-0000-0000-0000-0000000002a1', 'rejected', (SELECT updated_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1'), NULL, NULL) $$,
  'P0001', 'reason_required', 'Reject with no rejected document and no note is refused'
);
SELECT lives_ok($$ SELECT public.log_document_view((SELECT id FROM doc WHERE type = 'profile_photo'), (SELECT object_id FROM doc WHERE type = 'profile_photo')) $$, 'Show the photo');
SELECT lives_ok($$ SELECT public.log_document_view((SELECT id FROM doc WHERE type = 'criminal_record'), (SELECT object_id FROM doc WHERE type = 'criminal_record')) $$, 'Show the record');
SELECT lives_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM doc WHERE type = 'profile_photo')], ARRAY[(SELECT object_id FROM doc WHERE type = 'profile_photo')], 'approved', NULL, NULL, NULL) $$,
  'the photo matches'
);
SELECT lives_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM doc WHERE type = 'criminal_record')], ARRAY[(SELECT object_id FROM doc WHERE type = 'criminal_record')], 'rejected', 'criminal_record_invalid', '  older than six months  ', NULL) $$,
  'the record is rejected with a chip and a note'
);
RESET ROLE;
SELECT results_eq(
  $$ SELECT status, rejection_code, rejection_note, valid_until FROM public.provider_documents WHERE type = 'criminal_record' $$,
  $$ VALUES ('rejected', 'criminal_record_invalid', 'older than six months', NULL::date) $$,
  'the verdict, its code and the trimmed note are stored'
);

-- The admin's view row lasts 2 minutes, and is for that admin only.
UPDATE public.audit_log SET created_at = now() - interval '3 minutes'
 WHERE action = 'document.viewed' AND entity_id = (SELECT id::text FROM doc WHERE type = 'selfie');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT is_empty($$ SELECT 1 FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'selfie') $$, 'a view row older than 2 minutes opens nothing');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d2", "role": "authenticated"}', true);
SELECT is_empty($$ SELECT 1 FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'front') $$, 'another admin''s view row opens nothing for this admin');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a2", "role": "authenticated"}', true);
SELECT is_empty($$ SELECT 1 FROM storage.objects WHERE name LIKE '00000000-0000-0000-0000-0000000002a1/%' $$, 'another provider reads none of these objects');
SELECT is_empty($$ SELECT 1 FROM public.provider_documents WHERE provider_id = '00000000-0000-0000-0000-0000000002a1' $$, 'nor these rows');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002c1", "role": "authenticated"}', true);
SELECT is_empty($$ SELECT 1 FROM storage.objects WHERE bucket_id IN ('provider-documents', 'provider-photos') $$, 'a customer reads no object');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM storage.objects WHERE name LIKE '00000000-0000-0000-0000-0000000002a1/%'), 6, 'a provider reads their own objects');
RESET ROLE;

-- ── rejected, then fixed (AC-8, AC-9, AC-18) ─────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT is(
  public.decide_provider('00000000-0000-0000-0000-0000000002a1', 'rejected', (SELECT updated_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1'), 'criminal_record_invalid', NULL) ->> 'status',
  'rejected', 'Reject opens when a required document is rejected'
);
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT is(public.provider_standing('00000000-0000-0000-0000-0000000002a1'), 'rejected', 'the provider sees rejected');
SELECT is(public.submit_provider_file() -> 'rejected', '["criminal_record"]'::jsonb, 'resubmitting with the rejected document unchanged is refused');
RESET ROLE;
INSERT INTO obj VALUES ('record2', pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a1/criminal_record/20000000-0000-4000-8000-000000000008.pdf', 'application/pdf', 60000, '1 minute'), '00000000-0000-0000-0000-0000000002a1/criminal_record/20000000-0000-4000-8000-000000000008.pdf');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
CREATE TEMP TABLE replaced AS SELECT public.register_provider_document('criminal_record', (SELECT name FROM obj WHERE k = 'record2')) AS r;
SELECT is((SELECT r ->> 'previous_path' FROM replaced), (SELECT name FROM obj WHERE k = 'record'), 'replacing returns the previous path');
SELECT is((SELECT r -> 'sweep' FROM replaced), jsonb_build_array((SELECT name FROM obj WHERE k = 'record'), (SELECT name FROM obj WHERE k = 'liar')), 'and every older unpointed object in that folder to delete');
SELECT is((SELECT r ->> 'status' FROM replaced), 'pending', 'the replaced document is pending again');
RESET ROLE;
SELECT results_eq(
  $$ SELECT count(*)::int, min(storage_path COLLATE "default"), min(rejection_code), min(reviewed_by::text) FROM public.provider_documents WHERE type = 'criminal_record' $$,
  $$ VALUES (1, (SELECT name FROM obj WHERE k = 'record2'), NULL::text, NULL::text) $$,
  'one row still, the new path, the verdict and reviewer cleared'
);
SELECT ok(
  (SELECT old_value ->> 'status' = 'rejected' FROM public.audit_log WHERE action = 'document.registered' ORDER BY id DESC LIMIT 1),
  'the document.registered row keeps the old status'
);

-- The provider's delete right reaches orphans only.
SET LOCAL storage.allow_delete_query = 'true';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
DELETE FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'record2');
DELETE FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'record');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
DELETE FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'liar');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a2", "role": "authenticated"}', true);
DELETE FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'liar');
RESET ROLE;
SELECT ok(EXISTS (SELECT 1 FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'record2')), 'a provider cannot delete a current file');
SELECT ok(NOT EXISTS (SELECT 1 FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'record')), 'a provider deletes their own orphan');
SELECT ok(EXISTS (SELECT 1 FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'liar')), 'an admin and another provider delete nothing');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polcmd = 'w' AND polname LIKE 'provider_files%'), 0, 'there is no update policy, so overwrite and move fail');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT is(public.submit_provider_file() ->> 'status', 'pending', 'the fixed file is resubmitted');
RESET ROLE;
SELECT is((SELECT review_reason FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1'), 'resubmitted', 'with review_reason resubmitted');

-- ── a replaced file between Show and Match; a rename before Approve (AC-16 to AC-18) ──
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
CREATE TEMP TABLE seen_record AS SELECT id, object_id FROM public.provider_documents WHERE type = 'criminal_record';
SELECT lives_ok($$ SELECT public.log_document_view((SELECT id FROM seen_record), (SELECT object_id FROM seen_record)) $$, 'admin shows the new record');
RESET ROLE;
-- The provider replaces it in another session and reuses the old path with new bytes.
SET LOCAL storage.allow_delete_query = 'true';
UPDATE public.provider_documents SET storage_path = 'tmp-path' WHERE type = 'criminal_record';
DELETE FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'record2');
UPDATE public.provider_documents SET storage_path = (SELECT name FROM obj WHERE k = 'record2') WHERE type = 'criminal_record';
SELECT pg_temp.put('provider-documents', (SELECT name FROM obj WHERE k = 'record2'), 'application/pdf', 70000);
UPDATE public.provider_documents SET storage_path = 'tmp-path' WHERE type = 'criminal_record';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT lives_ok($$ SELECT public.register_provider_document('criminal_record', (SELECT name FROM obj WHERE k = 'record2')) $$, 'the provider registers new bytes at the old path');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT is_empty($$ SELECT 1 FROM storage.objects WHERE name = (SELECT name FROM obj WHERE k = 'record2') $$, 'the fresh view row of the replaced file does not open the new object at the reused path');
SELECT throws_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM seen_record)], ARRAY[(SELECT object_id FROM seen_record)], 'approved', NULL, NULL, current_date + 180) $$,
  'P0001', 'stale_document', 'marking the file admin saw is stale_document'
);
SELECT throws_ok($$ SELECT public.log_document_view((SELECT id FROM seen_record), (SELECT object_id FROM seen_record)) $$, 'P0001', 'stale_document', 'so is showing it');
CREATE TEMP TABLE seen_record2 AS SELECT id, object_id FROM public.provider_documents WHERE type = 'criminal_record';
SELECT lives_ok($$ SELECT public.log_document_view((SELECT id FROM seen_record2), (SELECT object_id FROM seen_record2)) $$, 'Show the current record');
SELECT lives_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1', ARRAY[(SELECT id FROM seen_record2)], ARRAY[(SELECT object_id FROM seen_record2)], 'approved', NULL, NULL, current_date + 180) $$,
  'the current record matches'
);
RESET ROLE;
-- One test is one transaction, where now() never moves: the page load is set an hour back by hand.
UPDATE public.providers SET updated_at = now() - interval '1 hour' WHERE id = '00000000-0000-0000-0000-0000000002a1';
CREATE TEMP TABLE seen_version AS SELECT updated_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1';
GRANT SELECT ON seen_version TO authenticated;
-- A rename in another session after the page loaded.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
UPDATE public.profiles SET full_name = 'Ayşe Yıldız' WHERE id = '00000000-0000-0000-0000-0000000002a1';
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.decide_provider('00000000-0000-0000-0000-0000000002a1', 'approved', (SELECT updated_at FROM seen_version), NULL, NULL) $$,
  'P0001', 'stale_profile', 'a rename after the page loaded is stale_profile'
);
SELECT is(
  public.decide_provider('00000000-0000-0000-0000-0000000002a1', 'approved', (SELECT updated_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1'), NULL, NULL),
  '{"status": "approved", "replayed": false}'::jsonb, 'with the current version, Approve passes'
);
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d2", "role": "authenticated"}', true);
SELECT is(
  public.decide_provider('00000000-0000-0000-0000-0000000002a1', 'rejected', (SELECT updated_at FROM seen_version), NULL, 'late'),
  '{"status": "approved", "replayed": true}'::jsonb, 'a second admin gets the state as it stands, marked as a replay'
);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'provider.approved'), 1, 'one provider.approved row after two decisions');
SELECT results_eq(
  $$ SELECT status, approved_at IS NOT NULL, approved_name, decided_by::text FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1' $$,
  $$ VALUES ('approved', true, 'Ayşe Yıldız', '00000000-0000-0000-0000-0000000002d1') $$,
  'approved_at set, approved_name is the current name, decided_by the admin'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT ok(public.provider_can_apply('00000000-0000-0000-0000-0000000002a1'), 'an approved provider may apply');
RESET ROLE;
CREATE TEMP TABLE first_approval AS SELECT approved_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1';

-- ── back to review (AC-12) ───────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT is(
  public.save_provider_profile('company', 'Usta Temizlik Ltd', '١٢٣٤٥٦٧٨٩٠', 'Ev ve ofis temizliğinde on beş yıllık deneyim, özenle çalışırım.', 15, '{tr}'),
  '{"backToReview": false}'::jsonb, 'bio, years and languages save at once with no review; the same tax number in Arabic digits is no change'
);
SELECT is(public.provider_standing('00000000-0000-0000-0000-0000000002a1'), 'approved', 'still approved');
SELECT is(
  public.save_provider_profile('company', 'Usta Temizlik Ltd', '1234567899', 'Ev ve ofis temizliğinde on beş yıllık deneyim, özenle çalışırım.', 15, '{tr}'),
  '{"backToReview": true}'::jsonb, 'a tax number change through a direct call, skipping the dialog, goes back to review'
);
RESET ROLE;
SELECT results_eq(
  $$ SELECT status, review_reason FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1' $$,
  $$ VALUES ('pending', 'company_changed') $$, 'pending with company_changed'
);
SELECT ok(
  (SELECT old_value ->> 'tax_number_last4' = '7890' AND new_value ->> 'tax_number_last4' = '7899'
          AND NOT (old_value ? 'tax_number') AND NOT (new_value ? 'tax_number')
     FROM public.audit_log WHERE action = 'provider.company_changed'),
  'one provider.company_changed row with old and new, the tax number as its last four digits only (D127)'
);
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'provider.back_to_review'), 1, 'one provider.back_to_review row');

-- Approve again, then a rename while approved.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT is(public.decide_provider('00000000-0000-0000-0000-0000000002a1', 'approved', (SELECT updated_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1'), NULL, NULL) ->> 'status', 'approved', 'approved again');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
UPDATE public.profiles SET full_name = 'Ayşe Yıldız' WHERE id = '00000000-0000-0000-0000-0000000002a1';
SELECT is(public.provider_standing('00000000-0000-0000-0000-0000000002a1'), 'approved', 'saving the same name changes nothing');
UPDATE public.profiles SET full_name = 'Ayşe Kaya' WHERE id = '00000000-0000-0000-0000-0000000002a1';
RESET ROLE;
SELECT results_eq(
  $$ SELECT status, review_reason, approved_name FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1' $$,
  $$ VALUES ('pending', 'name_changed', 'Ayşe Yıldız') $$,
  'a rename while approved goes back to review; approved_name keeps the approved name'
);
SELECT ok(
  (SELECT new_value ->> 'approved_name' = 'Ayşe Yıldız' FROM public.audit_log WHERE action = 'provider.back_to_review' ORDER BY id DESC LIMIT 1),
  'the back_to_review row carries the approved name'
);
SELECT is((SELECT approved_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1'), (SELECT approved_at FROM first_approval), 'approved_at survives later reviews');

-- Approve, then a document replaced while approved (even the optional certificate).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT is(public.decide_provider('00000000-0000-0000-0000-0000000002a1', 'approved', (SELECT updated_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1'), NULL, NULL) ->> 'status', 'approved', 'approved a third time');
RESET ROLE;
INSERT INTO obj VALUES ('cert', pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a1/skill_certificate/20000000-0000-4000-8000-000000000010.pdf', 'application/pdf', 1000), '00000000-0000-0000-0000-0000000002a1/skill_certificate/20000000-0000-4000-8000-000000000010.pdf');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT is((public.register_provider_document('skill_certificate', (SELECT name FROM obj WHERE k = 'cert')) ->> 'backToReview')::boolean, true, 'registering the optional certificate while approved goes back to review');
RESET ROLE;
SELECT results_eq(
  $$ SELECT status, review_reason FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1' $$,
  $$ VALUES ('pending', 'document_replaced') $$, 'pending with document_replaced'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT is(public.decide_provider('00000000-0000-0000-0000-0000000002a1', 'approved', (SELECT updated_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1'), NULL, NULL) ->> 'status', 'approved', 'a pending certificate does not block approval');
RESET ROLE;

-- ── expiry (AC-8, AC-20) ─────────────────────────────────────────────────────
UPDATE public.provider_documents SET valid_until = current_date - 1 WHERE type IN ('id_front', 'id_back') AND provider_id = '00000000-0000-0000-0000-0000000002a1';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT is(public.provider_standing('00000000-0000-0000-0000-0000000002a1'), 'document_expired', 'a required document past valid_until reads document_expired');
SELECT ok(NOT public.provider_can_apply('00000000-0000-0000-0000-0000000002a1'), 'and the provider cannot apply');
RESET ROLE;
INSERT INTO obj VALUES ('front2', pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a1/id_front/20000000-0000-4000-8000-000000000011.jpg', 'image/jpeg', 1000), '00000000-0000-0000-0000-0000000002a1/id_front/20000000-0000-4000-8000-000000000011.jpg');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT lives_ok($$ SELECT public.register_provider_document('id_front', (SELECT name FROM obj WHERE k = 'front2')) $$, 'the expired front is replaced');
RESET ROLE;
SELECT results_eq(
  $$ SELECT status, rejection_code, reviewed_by FROM public.provider_documents WHERE type = 'id_back' $$,
  $$ VALUES ('rejected', 'document_expired', NULL::uuid) $$,
  'the expired back is rejected by the database, with no reviewer'
);
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'document.reviewed' AND actor_id IS NULL), 1, 'one document.reviewed row for it');
INSERT INTO obj VALUES ('front3', pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a1/id_front/20000000-0000-4000-8000-000000000012.jpg', 'image/jpeg', 1000), '00000000-0000-0000-0000-0000000002a1/id_front/20000000-0000-4000-8000-000000000012.jpg');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT lives_ok($$ SELECT public.register_provider_document('id_front', (SELECT name FROM obj WHERE k = 'front3')) $$, 'the front is replaced again');
RESET ROLE;
SELECT is((SELECT status FROM public.provider_documents WHERE type = 'id_back'), 'rejected', 'the expired back stays rejected: it is not returned to pending');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'document.reviewed' AND actor_id IS NULL), 1, 'and no second database verdict is written');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.decide_provider('00000000-0000-0000-0000-0000000002a1', 'approved', (SELECT updated_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1'), NULL, NULL) $$,
  'P0001', 'documents_not_reviewed', 'Approve stays closed until the back is replaced'
);
RESET ROLE;
INSERT INTO obj VALUES ('back2', pg_temp.put('provider-documents', '00000000-0000-0000-0000-0000000002a1/id_back/20000000-0000-4000-8000-000000000013.jpg', 'image/jpeg', 1000), '00000000-0000-0000-0000-0000000002a1/id_back/20000000-0000-4000-8000-000000000013.jpg');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT is((public.register_provider_document('id_back', (SELECT name FROM obj WHERE k = 'back2')) ->> 'status'), 'pending', 'the back replaced is pending');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT lives_ok($$ SELECT public.log_document_view(d.id, d.object_id) FROM public.provider_documents d WHERE d.type IN ('id_front', 'id_back') $$, 'admin shows both new sides');
SELECT lives_ok(
  $$ SELECT public.review_provider_documents('00000000-0000-0000-0000-0000000002a1',
       (SELECT array_agg(id ORDER BY type) FROM public.provider_documents WHERE type IN ('id_front', 'id_back')),
       (SELECT array_agg(object_id ORDER BY type) FROM public.provider_documents WHERE type IN ('id_front', 'id_back')),
       'approved', NULL, NULL, current_date + 3650) $$,
  'and marks them'
);
SELECT is(public.decide_provider('00000000-0000-0000-0000-0000000002a1', 'approved', (SELECT updated_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1'), NULL, NULL) ->> 'status', 'approved', 'then Approve opens');
RESET ROLE;

-- ── suspend and lift (AC-19) ─────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.suspend_provider('00000000-0000-0000-0000-0000000002a2', 'Complaints from customers') $$, 'P0001', 'not_found', 'a draft provider cannot be suspended: no admin function finds it');
SELECT throws_ok($$ SELECT public.suspend_provider('00000000-0000-0000-0000-0000000002a1', ' bad ') $$, 'P0001', 'validation_failed', 'a reason under 5 characters is refused');
SELECT throws_ok($$ SELECT public.reinstate_provider('00000000-0000-0000-0000-0000000002a1') $$, 'P0001', 'not_suspended', 'a provider not suspended cannot be lifted');
SELECT is(public.suspend_provider('00000000-0000-0000-0000-0000000002a1', 'Repeated complaints from customers'), '{"status": "suspended"}'::jsonb, 'suspended');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT is(public.provider_standing('00000000-0000-0000-0000-0000000002a1'), 'suspended', 'the provider reads suspended');
SELECT throws_ok($$ SELECT public.save_provider_profile('individual', NULL, NULL, repeat('a', 40), 3, '{tr}') $$, 'P0001', 'provider_suspended', 'a profile save is refused');
SELECT throws_ok($$ SELECT public.register_provider_document('id_back', (SELECT name FROM obj WHERE k = 'back2')) $$, 'P0001', 'provider_suspended', 'a register is refused');
SELECT throws_ok($$ SELECT public.submit_provider_file() $$, 'P0001', 'provider_suspended', 'a submit is refused');
SELECT throws_ok($$ SELECT public.accept_provider_docs_consent('tr') $$, 'P0001', 'provider_suspended', 'the consent is refused');
SELECT ok(NOT public.provider_may_store('provider-photos', '00000000-0000-0000-0000-0000000002a1/profile_photo/30000000-0000-4000-8000-000000000001.jpg'), 'Storage refuses an upload');
SELECT throws_ok($$ UPDATE public.profiles SET full_name = 'Başka Ad' WHERE id = '00000000-0000-0000-0000-0000000002a1' $$, 'P0001', 'provider_suspended', 'a rename is refused');
SELECT is((SELECT suspension_reason FROM public.providers), 'Repeated complaints from customers', 'the provider reads their own file and the reason as written');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT is(public.reinstate_provider('00000000-0000-0000-0000-0000000002a1'), '{"status": "approved"}'::jsonb, 'lifted');
RESET ROLE;
SELECT results_eq(
  $$ SELECT status, suspension_reason FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a1' $$,
  $$ VALUES ('approved', NULL::text) $$, 'back to approved, the reason cleared'
);
SELECT ok(
  (SELECT old_value ->> 'suspension_reason' = 'Repeated complaints from customers' FROM public.audit_log WHERE action = 'provider.reinstated'),
  'audit_log keeps the reason'
);

-- ── a demoted admin loses admin at once (AC-21) ──────────────────────────────
UPDATE public.profiles SET role = 'customer' WHERE id = '00000000-0000-0000-0000-0000000002d2';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d2", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);
SELECT is_empty($$ SELECT 1 FROM public.providers $$, 'a demoted admin with an old admin token reads nothing');
SELECT throws_ok($$ SELECT public.suspend_provider('00000000-0000-0000-0000-0000000002a1', 'Repeated complaints') $$, 'P0001', 'forbidden', 'and calls no admin function');
RESET ROLE;

-- ── review fixes of 2026-11-11 ───────────────────────────────────────────────
-- AC-21 negatives on the profile and document tables (provider_profiles opens to customers in 06).
SELECT isnt_empty($$ SELECT 1 FROM public.provider_profiles WHERE provider_id = '00000000-0000-0000-0000-0000000002a1' $$, 'p1 has a profile row to hide');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002c1", "role": "authenticated"}', true);
SELECT is_empty($$ SELECT 1 FROM public.provider_profiles $$, 'a customer reads no provider_profiles row');
SELECT is_empty($$ SELECT 1 FROM public.provider_documents $$, 'a customer reads no provider_documents row');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a2", "role": "authenticated"}', true);
SELECT is_empty($$ SELECT 1 FROM public.provider_profiles WHERE provider_id <> '00000000-0000-0000-0000-0000000002a2' $$, 'a provider reads no other provider''s profile');
RESET ROLE;

-- No policy anywhere decides who is admin from the token (D116): a demoted admin loses it at once.
SELECT is_empty(
  $$ SELECT c.relname || '.' || p.polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%app_metadata%' $$,
  'no policy reads app_metadata'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d2", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);
SELECT is((SELECT count(*)::int FROM public.profiles), 1, 'a demoted admin with an old admin token reads only their own profile');
SELECT is_empty($$ SELECT 1 FROM public.audit_log $$, 'and no audit_log row');
RESET ROLE;

-- p3, a provider whose objects were never stored; and admin a1 with a providers row of their own.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
VALUES ('00000000-0000-0000-0000-0000000002a3', 'authenticated', 'authenticated', '905552220006', now());
INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
VALUES ('00000000-0000-0000-0000-0000000002a3', 'provider', 'TR', '+905552220006', 'Zeynep Usta', 'tr');
INSERT INTO public.provider_documents (id, provider_id, region, type, storage_path, object_id, mime_type, size_bytes)
SELECT ('00000000-0000-4000-8000-0000000003' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-0000000002a3', 'TR', t,
       '00000000-0000-0000-0000-0000000002a3/' || t || '/' || gen_random_uuid() || '.jpg',
       ('10000000-0000-4000-8000-0000000003' || lpad(n::text, 2, '0'))::uuid, 'image/jpeg', 10
  FROM unnest(ARRAY['profile_photo', 'id_front', 'id_back', 'selfie', 'criminal_record']) WITH ORDINALITY AS u(t, n);
INSERT INTO public.providers (id, region, status) VALUES ('00000000-0000-0000-0000-0000000002d1', 'TR', 'approved');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.log_document_view('00000000-0000-4000-8000-000000000304', '10000000-0000-4000-8000-000000000304') $$, 'P0001', 'not_found', 'a draft provider''s document cannot be shown, even by a direct call');
SELECT throws_ok($$ SELECT public.suspend_provider('00000000-0000-0000-0000-0000000002a3', 'Repeated complaints') $$, 'P0001', 'not_found', 'a draft provider is not found by any admin function');
SELECT throws_ok($$ SELECT public.suspend_provider('00000000-0000-0000-0000-0000000002d1', 'Repeated complaints') $$, 'P0001', 'forbidden', 'an admin cannot act on their own providers row');
SELECT ok(NOT public.provider_can_apply('00000000-0000-0000-0000-0000000002d1'), 'an approved providers row behind an admin profile cannot apply');
RESET ROLE;

-- A lost object blocks approve, and is a reason to reject with no note.
UPDATE public.providers SET status = 'pending', submitted_at = now(), review_reason = 'first_submission'
 WHERE id = '00000000-0000-0000-0000-0000000002a3';
UPDATE public.provider_documents SET status = 'approved', valid_until = CASE WHEN type IN ('id_front', 'id_back', 'criminal_record') THEN current_date + 30 END
 WHERE provider_id = '00000000-0000-0000-0000-0000000002a3';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002d1", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.decide_provider('00000000-0000-0000-0000-0000000002a3', 'approved', (SELECT updated_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a3'), NULL, NULL) $$, 'P0001', 'file_missing', 'approve refuses a file whose objects are gone');
SELECT is(public.decide_provider('00000000-0000-0000-0000-0000000002a3', 'rejected', (SELECT updated_at FROM public.providers WHERE id = '00000000-0000-0000-0000-0000000002a3'), 'document_unclear', NULL), '{"status": "rejected", "replayed": false}'::jsonb, 'reject goes through, with no note needed');
SELECT is(public.decide_provider('00000000-0000-0000-0000-0000000002a3', 'rejected', now(), NULL, NULL), '{"status": "rejected", "replayed": true}'::jsonb, 'a replay says it is one, so the decision event fires once');
RESET ROLE;

-- Only a provider-docs- version counts as the documents consent.
UPDATE public.platform_settings SET value = '"terms-v9"' WHERE region = 'TR' AND key = 'provider_docs_consent_version';
INSERT INTO public.terms_acceptances (user_id, region, terms_version, locale) VALUES ('00000000-0000-0000-0000-0000000002a3', 'TR', 'terms-v9', 'tr');
SELECT ok(NOT public.provider_has_docs_consent('00000000-0000-0000-0000-0000000002a3', 'TR'), 'a version outside the provider-docs- namespace is never the documents consent');
UPDATE public.platform_settings SET value = '"provider-docs-draft-1"' WHERE region = 'TR' AND key = 'provider_docs_consent_version';

-- The same path registered again with new bytes: no previous_path, so the action deletes nothing.
SET LOCAL storage.allow_delete_query = 'true';
DELETE FROM storage.objects WHERE name = (SELECT storage_path FROM public.provider_documents WHERE provider_id = '00000000-0000-0000-0000-0000000002a1' AND type = 'selfie');
SELECT pg_temp.put('provider-documents', (SELECT storage_path FROM public.provider_documents WHERE provider_id = '00000000-0000-0000-0000-0000000002a1' AND type = 'selfie'), 'image/jpeg', 10);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000002a1", "role": "authenticated"}', true);
SELECT ok(
  (SELECT r ->> 'previous_path' IS NULL AND (r ->> 'created')::boolean
     FROM (SELECT public.register_provider_document('selfie', (SELECT storage_path FROM public.provider_documents WHERE type = 'selfie')) AS r) x),
  'a reused path registers as new, with no previous_path to delete'
);
RESET ROLE;

-- ── every audit action of AC-23 was written by the database ──────────────────
SELECT is_empty(
  $$ SELECT a FROM unnest(ARRAY['provider.submitted', 'provider.approved', 'provider.rejected', 'provider.suspended',
                                'provider.reinstated', 'provider.back_to_review', 'provider.company_changed',
                                'document.registered', 'document.reviewed', 'document.viewed']) a
      WHERE NOT EXISTS (SELECT 1 FROM public.audit_log l WHERE l.action = a AND l.region = 'TR') $$,
  'every audit action of AC-23 appears, with its region'
);

SELECT * FROM finish();
ROLLBACK;
