-- Position 03, spec 0007: the catalog tables, their checks, access and audit.
--
-- A hostile client calls PostgREST straight with its own token, so each rule is proven by calling the
-- database as that client: a customer, a provider and anon denied each of the seven tables, an admin
-- held to named columns, a demoted admin refused, and each branch of the two check helpers.
-- AC-1 to AC-3, AC-8, AC-14, AC-15. The engine and publishing are in 10.
--
-- Fixture users go straight into auth.users and profiles, as complete_onboarding leaves them.
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(147);

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1: customer, p1: provider, a1: admin, a2: an admin demoted below while their token lives.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at) VALUES
  ('00000000-0000-0000-0000-0000000003c1', 'authenticated', 'authenticated', '905553330001', now()),
  ('00000000-0000-0000-0000-0000000003b1', 'authenticated', 'authenticated', '905553330002', now()),
  ('00000000-0000-0000-0000-0000000003a1', 'authenticated', 'authenticated', '905553330003', now()),
  ('00000000-0000-0000-0000-0000000003a2', 'authenticated', 'authenticated', '905553330004', now());

INSERT INTO public.profiles (id, role, region, phone, full_name, locale) VALUES
  ('00000000-0000-0000-0000-0000000003c1', 'customer', 'TR', '+905553330001', 'Can Müşteri', 'tr'),
  ('00000000-0000-0000-0000-0000000003b1', 'provider', 'TR', '+905553330002', 'Ayşe Usta', 'tr'),
  ('00000000-0000-0000-0000-0000000003a1', 'admin', 'TR', '+905553330003', 'Admin Bir', 'en'),
  ('00000000-0000-0000-0000-0000000003a2', 'admin', 'TR', '+905553330004', 'Admin İki', 'en');

-- Rows an earlier local e2e run left behind; CI starts empty. Gone only inside this rolled back
-- transaction (the history guard is switched off for it, as only its owner can).
ALTER TABLE public.pricing_modifiers DISABLE TRIGGER pricing_history_guard;
ALTER TABLE public.pricing_formulas DISABLE TRIGGER pricing_history_guard;
DELETE FROM public.pricing_modifiers;
DELETE FROM public.pricing_formulas;
-- Since 04, a request (and its address, guarded the same way) refers to a service and a zone, so a database
-- an e2e run left behind needs them gone first.
ALTER TABLE public.request_addresses DISABLE TRIGGER request_addresses_guard;
DELETE FROM public.request_addresses;
ALTER TABLE public.request_addresses ENABLE TRIGGER request_addresses_guard;
-- Since 05, applications and provider picks refer to requests, services and zones, and requests refuse
-- a delete even as postgres; both guards are off for this rolled back clean up only.
-- Since 06 a chosen request names its application: the choose columns are cleared first.
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
UPDATE public.requests SET status = CASE WHEN status = 'SELECTED' THEN 'OPEN' ELSE status END,
       selected_application_id = NULL, selected_at = NULL, payment_deadline = NULL
 WHERE selected_application_id IS NOT NULL;
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
DELETE FROM public.applications;
ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
DELETE FROM public.provider_services;
DELETE FROM public.provider_zones;
ALTER TABLE public.requests DISABLE TRIGGER requests_delete_guard;
DELETE FROM public.requests;
ALTER TABLE public.requests ENABLE TRIGGER requests_delete_guard;
ALTER TABLE public.pricing_modifiers ENABLE TRIGGER pricing_history_guard;
ALTER TABLE public.pricing_formulas ENABLE TRIGGER pricing_history_guard;
DELETE FROM public.addons;
DELETE FROM public.questions;
DELETE FROM public.services;
DELETE FROM public.service_categories;
DELETE FROM public.zones;

-- Catalog rows, written as postgres (the trigger records them with a null actor).
INSERT INTO public.service_categories (id, region, name) VALUES
  ('00000000-0000-0000-0000-000000003c01', 'TR', '{"tr": "Temizlik", "en": "Cleaning"}'),
  ('00000000-0000-0000-0000-000000003c02', 'KSA', '{"ar": "تنظيف"}');
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max) VALUES
  ('00000000-0000-0000-0000-000000003501', '00000000-0000-0000-0000-000000003c01', 'TR', '{"tr": "Ev temizliği"}', 2, 4);
INSERT INTO public.addons (id, service_id, region, name, price) VALUES
  ('00000000-0000-0000-0000-000000003a01', '00000000-0000-0000-0000-000000003501', 'TR', '{"tr": "Cam"}', 40000);
INSERT INTO public.zones (id, region, name, multiplier) VALUES
  ('00000000-0000-0000-0000-000000003201', 'TR', '{"tr": "Merkez"}', 1.15);
INSERT INTO public.questions (id, category_id, region, key, label, type, required, affects_pricing, validation, active) VALUES
  ('00000000-0000-0000-0000-000000003901', '00000000-0000-0000-0000-000000003c01', 'TR', 'rooms', '{"tr": "Oda"}',
   'number', true, true, '{"min": 1, "max": 10, "step": 1}', true);

-- ── structure (AC-1) ─────────────────────────────────────────────────────────
SELECT has_table('public', 'service_categories', 'service_categories exists');
SELECT has_table('public', 'services', 'services exists');
SELECT has_table('public', 'addons', 'addons exists');
SELECT has_table('public', 'zones', 'zones exists');
SELECT has_table('public', 'questions', 'questions exists');
SELECT has_table('public', 'pricing_formulas', 'pricing_formulas exists');
SELECT has_table('public', 'pricing_modifiers', 'pricing_modifiers exists');

-- 11 commits rows under its own prefix and removes them; a failed run of it may leave them for the next.
SELECT is(
  (SELECT count(*)::int FROM public.service_categories WHERE id::text !~ '^00000000-0000-0000-0000-0000(00003|001100)')
  + (SELECT count(*)::int FROM public.services WHERE id::text !~ '^00000000-0000-0000-0000-0000(00003|001100)')
  + (SELECT count(*)::int FROM public.questions WHERE id::text !~ '^00000000-0000-0000-0000-0000(00003|001100)')
  + (SELECT count(*)::int FROM public.pricing_formulas WHERE service_id::text !~ '^00000000-0000-0000-0000-0000001100'),
  0, 'the migration seeds no catalog row');

SELECT results_eq(
  $$ SELECT region, value FROM public.platform_settings WHERE key = 'price_rounding_minor' ORDER BY region $$,
  $$ VALUES ('KSA', '100'::jsonb), ('TR', '100'::jsonb) $$,
  'price_rounding_minor is 100 in both regions');

SELECT is(
  (SELECT active FROM public.service_categories WHERE id = '00000000-0000-0000-0000-000000003c01'), false,
  'a new catalog row starts off');

SELECT throws_ok(
  $$ INSERT INTO public.services (category_id, region, name, hours_min, hours_max)
     VALUES ('00000000-0000-0000-0000-000000003c02', 'TR', '{"tr": "X"}', 1, 2) $$,
  '23503', NULL, 'a TR service cannot sit under a KSA category');
SELECT throws_ok(
  $$ INSERT INTO public.addons (service_id, region, name, price)
     VALUES ('00000000-0000-0000-0000-000000003501', 'KSA', '{"ar": "X"}', 100) $$,
  '23503', NULL, 'a KSA addon cannot name a TR service');
SELECT throws_ok(
  $$ INSERT INTO public.questions (category_id, region, key, label, type)
     VALUES ('00000000-0000-0000-0000-000000003c01', 'KSA', 'notes', '{"ar": "X"}', 'boolean') $$,
  '23503', NULL, 'a KSA question cannot name a TR category');
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max)
  VALUES ('00000000-0000-0000-0000-000000003502', '00000000-0000-0000-0000-000000003c02', 'KSA', '{"ar": "Y"}', 1, 2);
SELECT set_config('pricing.publishing', 'on', true);
SELECT throws_ok(
  $$ INSERT INTO public.pricing_formulas (service_id, region, version, base_price)
     VALUES ('00000000-0000-0000-0000-000000003501', 'KSA', 1, 100) $$,
  '23503', NULL, 'a KSA formula cannot name a TR service');
INSERT INTO public.pricing_formulas (id, service_id, region, version, base_price)
  VALUES ('00000000-0000-0000-0000-000000003f01', '00000000-0000-0000-0000-000000003501', 'TR', 1, 100);
SELECT throws_ok(
  $$ INSERT INTO public.pricing_modifiers (formula_id, region, apply_order, match_type, effect_type, amount)
     VALUES ('00000000-0000-0000-0000-000000003f01', 'KSA', 1, 'always', 'FIXED', 100) $$,
  '23503', NULL, 'a KSA modifier cannot name a TR formula');
SELECT set_config('pricing.publishing', 'off', true);
SELECT throws_ok(
  $$ INSERT INTO public.questions (category_id, service_id, region, key, label, type)
     VALUES ('00000000-0000-0000-0000-000000003c01', '00000000-0000-0000-0000-000000003502', 'TR', 'other', '{"tr": "X"}', 'boolean') $$,
  '23503', NULL, 'a question cannot be scoped to a service of another category');
SELECT throws_ok(
  $$ INSERT INTO public.services (category_id, region, name, hours_min, hours_max)
     VALUES ('00000000-0000-0000-0000-000000003c01', 'TR', '{"tr": "X"}', 3, 2) $$,
  '23514', NULL, 'hours_min above hours_max is refused');
SELECT throws_ok(
  $$ INSERT INTO public.services (category_id, region, name, hours_min, hours_max)
     VALUES ('00000000-0000-0000-0000-000000003c01', 'TR', '{"tr": "X"}', 1, 25) $$,
  '23514', NULL, 'more than 24 hours is refused');
SELECT throws_ok(
  $$ INSERT INTO public.addons (service_id, region, name, price)
     VALUES ('00000000-0000-0000-0000-000000003501', 'TR', '{"tr": "X"}', 0) $$,
  '23514', NULL, 'an addon of 0 is refused');
SELECT throws_ok(
  $$ INSERT INTO public.zones (region, name, multiplier) VALUES ('TR', '{"tr": "X"}', 2.01) $$,
  '23514', NULL, 'a zone multiplier above 2.00 is refused');
SELECT throws_ok(
  $$ INSERT INTO public.zones (region, name, multiplier) VALUES ('TR', '{"tr": "X"}', 0.49) $$,
  '23514', NULL, 'a zone multiplier below 0.50 is refused');

-- ── catalog_text_ok (AC-2), one branch at a time ─────────────────────────────
SELECT is_empty(
  $$ SELECT r.code FROM public.regions r
      WHERE NOT public.catalog_text_ok(jsonb_build_object(r.default_locale, 'x'), r.code, 10)
         OR public.catalog_text_ok(jsonb_build_object(CASE r.default_locale WHEN 'tr' THEN 'ar' ELSE 'tr' END, 'x'), r.code, 10) $$,
  'the locale map of catalog_text_ok equals regions.default_locale');
SELECT ok(public.catalog_text_ok('{"tr": "Temizlik", "en": "Cleaning", "ar": "تنظيف"}', 'TR', 120), 'all three locales pass');
SELECT ok(public.catalog_text_ok('{"tr": "Temizlik"}', 'TR', 120), 'the default locale alone passes');
SELECT ok(NOT public.catalog_text_ok(NULL, 'TR', 120), 'null fails, never passes');
SELECT ok(NOT public.catalog_text_ok('"Temizlik"', 'TR', 120), 'a bare string fails');
SELECT ok(NOT public.catalog_text_ok('{"en": "Cleaning"}', 'TR', 120), 'missing the default locale fails');
SELECT ok(NOT public.catalog_text_ok('{"tr": "Temizlik", "de": "Reinigung"}', 'TR', 120), 'an unknown locale key fails');
SELECT ok(NOT public.catalog_text_ok('{"tr": 5}', 'TR', 120), 'a non string fails');
SELECT ok(NOT public.catalog_text_ok('{"tr": "   "}', 'TR', 120), 'a blank value fails');
SELECT ok(NOT public.catalog_text_ok(jsonb_build_object('tr', E' ​'), 'TR', 120), 'NBSP and zero width only is blank');
SELECT ok(NOT public.catalog_text_ok('{"tr": "Temizlik", "en": ""}', 'TR', 120), 'a blank optional locale fails too');
SELECT ok(public.catalog_text_ok(jsonb_build_object('tr', repeat('ş', 120)), 'TR', 120), 'exactly 120 code points pass');
SELECT ok(NOT public.catalog_text_ok(jsonb_build_object('tr', repeat('ş', 121)), 'TR', 120), '121 code points fail');
SELECT ok(public.catalog_text_ok(jsonb_build_object('tr', '  ' || repeat('a', 120) || '  '), 'TR', 120), 'length counts after trim');
SELECT throws_ok(
  $$ INSERT INTO public.service_categories (region, name) VALUES ('TR', '{"en": "Cleaning"}') $$,
  '23514', NULL, 'a TR category with no tr name is refused');
SELECT throws_ok(
  $$ INSERT INTO public.services (category_id, region, name, note, hours_min, hours_max)
     VALUES ('00000000-0000-0000-0000-000000003c01', 'TR', '{"tr": "X"}', '{"tr": " "}', 1, 2) $$,
  '23514', NULL, 'a blank note is refused; a null one passes');

-- ── question_shape_ok (AC-3), one branch at a time ───────────────────────────
SELECT ok(public.question_shape_ok('number', NULL, '{"min": 0, "max": 10, "step": 1}', 'TR'), 'a number with min, max, step passes');
SELECT ok(NOT public.question_shape_ok('number', NULL, '{"min": 1}', 'TR'), 'a number with only min fails');
SELECT ok(NOT public.question_shape_ok('number', NULL, NULL, 'TR'), 'a number with no validation fails');
SELECT ok(NOT public.question_shape_ok('number', NULL, '{"min": 0, "max": 10}', 'TR'), 'a number with no step fails');
SELECT ok(NOT public.question_shape_ok('number', NULL, '{"min": 0, "max": 10, "step": 1, "x": 1}', 'TR'), 'an extra key fails');
SELECT ok(NOT public.question_shape_ok('number', NULL, '{"min": 0.5, "max": 10, "step": 1}', 'TR'), 'a fractional min fails');
SELECT ok(NOT public.question_shape_ok('number', NULL, '{"min": "0", "max": 10, "step": 1}', 'TR'), 'a string min fails');
SELECT ok(NOT public.question_shape_ok('number', NULL, '{"min": -1, "max": 10, "step": 1}', 'TR'), 'a negative min fails');
SELECT ok(NOT public.question_shape_ok('number', NULL, '{"min": 5, "max": 4, "step": 1}', 'TR'), 'min above max fails');
SELECT ok(NOT public.question_shape_ok('number', NULL, '{"min": 0, "max": 10001, "step": 1}', 'TR'), 'max above 10000 fails');
SELECT ok(NOT public.question_shape_ok('number', NULL, '{"min": 0, "max": 10, "step": 0}', 'TR'), 'step 0 fails');
SELECT ok(NOT public.question_shape_ok('number', '[]', '{"min": 0, "max": 10, "step": 1}', 'TR'), 'a number with options fails');
SELECT ok(public.question_shape_ok('single_select', '[{"value": "villa", "label": {"tr": "Villa"}}]', NULL, 'TR'), 'a select with one option passes');
SELECT ok(NOT public.question_shape_ok('single_select', '[]', NULL, 'TR'), 'a select with no option fails');
SELECT ok(NOT public.question_shape_ok('single_select', NULL, NULL, 'TR'), 'a select with null options fails');
SELECT ok(NOT public.question_shape_ok('multi_select',
  (SELECT jsonb_agg(jsonb_build_object('value', 'o' || g, 'label', '{"tr": "x"}'::jsonb)) FROM generate_series(1, 31) g), NULL, 'TR'),
  '31 options fail');
SELECT ok(public.question_shape_ok('multi_select',
  (SELECT jsonb_agg(jsonb_build_object('value', 'o' || g, 'label', '{"tr": "x"}'::jsonb)) FROM generate_series(1, 30) g), NULL, 'TR'),
  '30 options pass');
SELECT ok(NOT public.question_shape_ok('single_select', '[{"value": "a", "label": {"tr": "A"}}, {"value": "a", "label": {"tr": "B"}}]', NULL, 'TR'), 'a repeated value fails');
SELECT ok(NOT public.question_shape_ok('single_select', '[{"value": "Villa", "label": {"tr": "Villa"}}]', NULL, 'TR'), 'a value outside ^[a-z0-9_]{1,40}$ fails');
SELECT ok(NOT public.question_shape_ok('single_select', '[{"value": "villa", "label": {"en": "Villa"}}]', NULL, 'TR'), 'an option label with no tr fails');
SELECT ok(NOT public.question_shape_ok('single_select', '[{"value": "villa"}]', NULL, 'TR'), 'an option with no label fails');
SELECT ok(NOT public.question_shape_ok('single_select', '[{"value": "villa", "label": {"tr": "V"}, "x": 1}]', NULL, 'TR'), 'an option with an extra key fails');
SELECT ok(NOT public.question_shape_ok('single_select', '[{"value": "villa", "label": {"tr": "Villa"}}]', '{"min": 1}', 'TR'), 'a select with validation fails');
SELECT ok(public.question_shape_ok('boolean', NULL, NULL, 'TR'), 'a boolean passes bare');
SELECT ok(NOT public.question_shape_ok('boolean', '[]', NULL, 'TR'), 'a boolean with options fails');
SELECT ok(public.question_shape_ok('text', NULL, NULL, 'TR'), 'a text with the default length passes');
SELECT ok(public.question_shape_ok('text', NULL, '{"maxLength": 500}', 'TR'), 'a text up to 500 passes');
SELECT ok(NOT public.question_shape_ok('text', NULL, '{"maxLength": 501}', 'TR'), 'a text over 500 fails');
SELECT ok(public.question_shape_ok('textarea', NULL, '{"maxLength": 2000}', 'TR'), 'a textarea up to 2000 passes');
SELECT ok(NOT public.question_shape_ok('textarea', NULL, '{"maxLength": 0}', 'TR'), 'a length of 0 fails');
SELECT ok(public.question_shape_ok('date', NULL, NULL, 'TR') AND public.question_shape_ok('time', NULL, NULL, 'TR'), 'date and time pass bare');
SELECT ok(NOT public.question_shape_ok('date', NULL, '{"maxLength": 5}', 'TR'), 'a date with validation fails');
SELECT ok(NOT public.question_shape_ok('rating', NULL, NULL, 'TR'), 'an unknown type fails');
SELECT ok(NOT public.question_shape_ok(NULL, NULL, NULL, 'TR'), 'a null type fails');

SELECT throws_ok(
  $$ INSERT INTO public.questions (category_id, region, key, label, type, affects_pricing)
     VALUES ('00000000-0000-0000-0000-000000003c01', 'TR', 'notes', '{"tr": "Not"}', 'text', true) $$,
  '23514', NULL, 'a text question can never affect the price');
SELECT throws_ok(
  $$ INSERT INTO public.questions (category_id, region, key, label, type, affects_pricing)
     VALUES ('00000000-0000-0000-0000-000000003c01', 'TR', 'never_textarea', '{"tr": "X"}', 'textarea', true) $$,
  '23514', NULL, 'a textarea question can never affect the price');
SELECT throws_ok(
  $$ INSERT INTO public.questions (category_id, region, key, label, type, affects_pricing)
     VALUES ('00000000-0000-0000-0000-000000003c01', 'TR', 'never_date', '{"tr": "X"}', 'date', true) $$,
  '23514', NULL, 'a date question can never affect the price');
SELECT throws_ok(
  $$ INSERT INTO public.questions (category_id, region, key, label, type, affects_pricing)
     VALUES ('00000000-0000-0000-0000-000000003c01', 'TR', 'never_time', '{"tr": "X"}', 'time', true) $$,
  '23514', NULL, 'a time question can never affect the price');
SELECT throws_ok(
  $$ INSERT INTO public.questions (category_id, region, key, label, type)
     VALUES ('00000000-0000-0000-0000-000000003c01', 'TR', 'Rooms', '{"tr": "Oda"}', 'boolean') $$,
  '23514', NULL, 'a key with a capital is refused');
SELECT throws_ok(
  $$ INSERT INTO public.questions (category_id, region, key, label, type)
     VALUES ('00000000-0000-0000-0000-000000003c01', 'TR', '1rooms', '{"tr": "Oda"}', 'boolean') $$,
  '23514', NULL, 'a key starting with a digit is refused');
UPDATE public.questions SET active = false WHERE id = '00000000-0000-0000-0000-000000003901';
SELECT throws_ok(
  $$ INSERT INTO public.questions (category_id, region, key, label, type)
     VALUES ('00000000-0000-0000-0000-000000003c01', 'TR', 'rooms', '{"tr": "Oda"}', 'boolean') $$,
  '23505', NULL, 'a key is unique in its category, retired keys included');
SELECT throws_ok(
  $$ INSERT INTO public.questions (category_id, region, key, label, type, validation)
     VALUES ('00000000-0000-0000-0000-000000003c01', 'TR', 'size', '{"tr": "Boyut"}', 'number', '{"min": 1}') $$,
  '23514', NULL, 'a number question with no max is refused by the table');

-- ── settings checks (AC-8) ───────────────────────────────────────────────────
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '"100"' WHERE region = 'TR' AND key = 'price_rounding_minor' $$,
  '23514', NULL, 'the rounding unit as a string is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'price_rounding_minor' $$,
  '23514', NULL, 'a rounding unit of 0 is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '100001' WHERE region = 'TR' AND key = 'price_rounding_minor' $$,
  '23514', NULL, 'a rounding unit above 100000 is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '1.5' WHERE region = 'TR' AND key = 'price_rounding_minor' $$,
  '23514', NULL, 'a fractional rounding unit is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'max_price_multiple' $$,
  '23514', NULL, 'a price multiple of 0 is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '1001' WHERE region = 'TR' AND key = 'max_price_multiple' $$,
  '23514', NULL, 'a price multiple above 1000 is refused');

-- ── grants (AC-3, AC-14) ─────────────────────────────────────────────────────
SELECT is_empty(
  $$ SELECT t FROM unnest(ARRAY['service_categories', 'services', 'addons', 'zones', 'questions',
                                 'pricing_formulas', 'pricing_modifiers']) t
      WHERE has_table_privilege('anon', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') $$,
  'anon holds nothing on the seven tables');
SELECT is_empty(
  $$ SELECT t FROM unnest(ARRAY['service_categories', 'services', 'addons', 'zones', 'questions',
                                 'pricing_formulas', 'pricing_modifiers']) t
      WHERE NOT has_table_privilege('service_role', 'public.' || t, 'SELECT')
         OR has_table_privilege('service_role', 'public.' || t, 'INSERT, UPDATE, DELETE, TRUNCATE') $$,
  'service_role only reads the seven tables');
SELECT is_empty(
  $$ SELECT t FROM unnest(ARRAY['service_categories', 'services', 'addons', 'zones', 'questions',
                                 'pricing_formulas', 'pricing_modifiers']) t
      WHERE NOT has_table_privilege('authenticated', 'public.' || t, 'SELECT')
         OR has_table_privilege('authenticated', 'public.' || t, 'DELETE, TRUNCATE')
         OR has_any_column_privilege('authenticated', 'public.' || t, 'INSERT') <> (t NOT LIKE 'pricing_%')
         OR has_any_column_privilege('authenticated', 'public.' || t, 'UPDATE') <> (t NOT LIKE 'pricing_%') $$,
  'signed in users read all seven, write only the five catalog tables, and delete nothing');
SELECT is_empty(
  $$ SELECT c FROM unnest(ARRAY['questions.key', 'questions.type', 'questions.category_id', 'questions.service_id',
                                 'questions.region', 'questions.id', 'services.category_id', 'services.region',
                                 'addons.service_id', 'addons.region', 'zones.region', 'service_categories.region',
                                 'service_categories.created_at']) c
      WHERE has_column_privilege('authenticated', 'public.' || split_part(c, '.', 1), split_part(c, '.', 2), 'UPDATE') $$,
  'no API role updates an id, a parent id, a region, created_at, or a question''s key or type');
SELECT ok(
  has_column_privilege('authenticated', 'public.questions', 'key', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.questions', 'id', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.questions', 'created_at', 'INSERT'),
  'a key is set on insert; id and created_at never are');
SELECT ok(
  has_function_privilege('authenticated', 'public.catalog_text_ok(jsonb, text, integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.question_shape_ok(text, jsonb, jsonb, text)', 'EXECUTE'),
  'the two check helpers run as the caller, so the caller holds them');
SELECT is_empty(
  $$ SELECT f FROM unnest(ARRAY['public.catalog_audit()', 'public.questions_guard()', 'public.pricing_history_guard()',
                                 'public.catalog_trim(text)']) f
      WHERE has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('service_role', f, 'EXECUTE') $$,
  'the triggers and helpers are internal');

-- ── who reads and writes what (AC-14) ────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.service_categories $$, '42501', NULL, 'anon cannot read service_categories');
SELECT throws_ok($$ SELECT 1 FROM public.services $$, '42501', NULL, 'anon cannot read services');
SELECT throws_ok($$ SELECT 1 FROM public.addons $$, '42501', NULL, 'anon cannot read addons');
SELECT throws_ok($$ SELECT 1 FROM public.zones $$, '42501', NULL, 'anon cannot read zones');
SELECT throws_ok($$ SELECT 1 FROM public.questions $$, '42501', NULL, 'anon cannot read questions');
SELECT throws_ok($$ SELECT 1 FROM public.pricing_formulas $$, '42501', NULL, 'anon cannot read pricing_formulas');
SELECT throws_ok($$ SELECT 1 FROM public.pricing_modifiers $$, '42501', NULL, 'anon cannot read pricing_modifiers');
SELECT throws_ok($$ INSERT INTO public.zones (region, name) VALUES ('TR', '{"tr": "X"}') $$, '42501', NULL, 'anon cannot insert');
RESET ROLE;

-- A customer and a provider: reads return no rows, updates change none, inserts are refused.
CREATE FUNCTION pg_temp.non_admin_checks(p_who text) RETURNS SETOF text LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN NEXT is_empty($$ SELECT id FROM public.service_categories UNION ALL SELECT id FROM public.services
                          UNION ALL SELECT id FROM public.addons UNION ALL SELECT id FROM public.zones
                          UNION ALL SELECT id FROM public.questions UNION ALL SELECT id FROM public.pricing_formulas
                          UNION ALL SELECT id FROM public.pricing_modifiers $$,
                       p_who || ' reads no row of the seven tables');
  RETURN NEXT is_empty($$ UPDATE public.service_categories SET active = true RETURNING id $$, p_who || ' changes no category');
  RETURN NEXT is_empty($$ UPDATE public.services SET active = true RETURNING id $$, p_who || ' changes no service');
  RETURN NEXT is_empty($$ UPDATE public.addons SET price = 1 RETURNING id $$, p_who || ' changes no addon');
  RETURN NEXT is_empty($$ UPDATE public.zones SET multiplier = 0.5 RETURNING id $$, p_who || ' changes no zone');
  RETURN NEXT is_empty($$ UPDATE public.questions SET active = true RETURNING id $$, p_who || ' changes no question');
  RETURN NEXT throws_ok($$ INSERT INTO public.service_categories (region, name) VALUES ('TR', '{"tr": "X"}') $$,
                        '42501', NULL, p_who || ' cannot insert a category');
  RETURN NEXT throws_ok($$ INSERT INTO public.zones (region, name) VALUES ('TR', '{"tr": "X"}') $$,
                        '42501', NULL, p_who || ' cannot insert a zone');
  RETURN NEXT throws_ok($$ INSERT INTO public.services (category_id, region, name, hours_min, hours_max)
                           VALUES ('00000000-0000-0000-0000-000000003c01', 'TR', '{"tr": "X"}', 1, 2) $$,
                        '42501', NULL, p_who || ' cannot insert a service');
  RETURN NEXT throws_ok($$ INSERT INTO public.addons (service_id, region, name, price)
                           VALUES ('00000000-0000-0000-0000-000000003501', 'TR', '{"tr": "X"}', 1) $$,
                        '42501', NULL, p_who || ' cannot insert an addon');
  RETURN NEXT throws_ok($$ INSERT INTO public.questions (category_id, region, key, label, type)
                           VALUES ('00000000-0000-0000-0000-000000003c01', 'TR', 'pets', '{"tr": "X"}', 'boolean') $$,
                        '42501', NULL, p_who || ' cannot insert a question');
  RETURN NEXT throws_ok($$ INSERT INTO public.pricing_formulas (service_id, region, version, base_price)
                           VALUES ('00000000-0000-0000-0000-000000003501', 'TR', 1, 100) $$,
                        '42501', NULL, p_who || ' cannot insert a formula');
  RETURN NEXT throws_ok($$ DELETE FROM public.zones $$, '42501', NULL, p_who || ' cannot delete');
END;
$fn$;
GRANT EXECUTE ON FUNCTION pg_temp.non_admin_checks(text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000003c1", "role": "authenticated"}', true);
SELECT * FROM pg_temp.non_admin_checks('a customer');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000003b1", "role": "authenticated"}', true);
SELECT * FROM pg_temp.non_admin_checks('a provider');
RESET ROLE;

-- An admin reads all seven and writes the five catalog tables on named columns only.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000003a1", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);
SELECT is((SELECT count(*)::int FROM public.services WHERE id = '00000000-0000-0000-0000-000000003501'), 1, 'an admin reads services');
SELECT lives_ok(
  $$ INSERT INTO public.service_categories (region, name) VALUES ('TR', '{"tr": "Bahçe 03"}') $$,
  'an admin inserts a category');
SELECT throws_ok(
  $$ INSERT INTO public.service_categories (id, region, name) VALUES (gen_random_uuid(), 'TR', '{"tr": "X"}') $$,
  '42501', NULL, 'an admin never chooses an id');
SELECT isnt_empty(
  $$ UPDATE public.zones SET name = '{"tr": "Merkez", "en": "Centre"}' WHERE id = '00000000-0000-0000-0000-000000003201' RETURNING id $$,
  'an admin updates a zone');
SELECT throws_ok($$ UPDATE public.questions SET key = 'room_count' WHERE id = '00000000-0000-0000-0000-000000003901' $$,
  '42501', NULL, 'an admin cannot change a question''s key');
SELECT throws_ok($$ UPDATE public.questions SET type = 'boolean' WHERE id = '00000000-0000-0000-0000-000000003901' $$,
  '42501', NULL, 'an admin cannot change a question''s type');
SELECT throws_ok($$ UPDATE public.services SET category_id = '00000000-0000-0000-0000-000000003c02' $$,
  '42501', NULL, 'an admin cannot move a service to another category');
SELECT throws_ok($$ UPDATE public.zones SET region = 'KSA' $$, '42501', NULL, 'an admin cannot change a region');
SELECT throws_ok($$ DELETE FROM public.zones $$, '42501', NULL, 'an admin cannot delete a zone');
SELECT throws_ok($$ DELETE FROM public.questions $$, '42501', NULL, 'an admin cannot delete a question');
SELECT throws_ok($$ INSERT INTO public.pricing_formulas (service_id, region, version, base_price)
                    VALUES ('00000000-0000-0000-0000-000000003501', 'TR', 1, 100) $$,
  '42501', NULL, 'an admin cannot write a formula directly');
SELECT throws_ok($$ UPDATE public.pricing_formulas SET base_price = 1 $$, '42501', NULL, 'an admin cannot update a formula directly');
RESET ROLE;

-- A demoted admin with a live token: is_admin() reads profiles.role, so the update changes nothing.
UPDATE public.profiles SET role = 'customer' WHERE id = '00000000-0000-0000-0000-0000000003a2';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000003a2", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);
SELECT is_empty(
  $$ UPDATE public.zones SET multiplier = 2 WHERE id = '00000000-0000-0000-0000-000000003201' RETURNING id $$,
  'a demoted admin with an admin token changes no row');
SELECT throws_ok($$ INSERT INTO public.zones (region, name) VALUES ('TR', '{"tr": "X"}') $$,
  '42501', NULL, 'and inserts nothing');
RESET ROLE;
SELECT is((SELECT multiplier FROM public.zones WHERE id = '00000000-0000-0000-0000-000000003201'), 1.15::numeric(3,2),
  'the zone is unchanged');

-- ── audit (AC-15) ────────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT a.actor_id::text, a.region, a.old_value IS NULL, a.new_value = to_jsonb(c)
       FROM public.audit_log a
       JOIN public.service_categories c ON c.id::text = a.entity_id
      WHERE a.action = 'catalog.created' AND a.entity_type = 'service_categories' AND c.name ->> 'tr' = 'Bahçe 03' $$,
  $$ VALUES ('00000000-0000-0000-0000-0000000003a1', 'TR', true, true) $$,
  'an insert writes catalog.created with who, the region and the new row');
SELECT results_eq(
  $$ SELECT actor_id::text, old_value -> 'name', new_value -> 'name', old_value - 'name' = new_value - 'name'
       FROM public.audit_log
      WHERE action = 'catalog.updated' AND entity_type = 'zones' AND entity_id = '00000000-0000-0000-0000-000000003201'
        AND actor_id IS NOT NULL $$,
  $$ VALUES ('00000000-0000-0000-0000-0000000003a1', '{"tr": "Merkez"}'::jsonb, '{"tr": "Merkez", "en": "Centre"}'::jsonb, true) $$,
  'an update writes catalog.updated with the old and the new row');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_id = '00000000-0000-0000-0000-000000003201'), 2,
  'the zone has two audit rows: created as postgres and updated once');
UPDATE public.zones SET multiplier = 1.15 WHERE id = '00000000-0000-0000-0000-000000003201';
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_id = '00000000-0000-0000-0000-000000003201'), 2,
  'an update that changes nothing writes nothing');
SELECT ok(
  (SELECT count(DISTINCT entity_type)::int FROM public.audit_log
    WHERE action = 'catalog.created' AND entity_id LIKE '00000000-0000-0000-0000-000000003%') = 5,
  'the trigger records all five catalog tables');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log
    WHERE action = 'catalog.updated' AND entity_id = '00000000-0000-0000-0000-000000003901'), 1,
  'a change from the SQL editor is recorded too (the question switched off above)');

SELECT * FROM finish();
ROLLBACK;
