-- Position 04, spec 0008: post a request.
--
-- Every figure is fixture data from verify.md (Worked figures), never a real price. Fixture F of 0007
-- prices 350000 at the first zone with one addon; at 10% the split is 35000 and 315000. The races
-- (two sessions through dblink) are in 13. AC-1 to AC-17, AC-28.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(172);

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1, c2: customers; c3: the rate limit; c4: the open cap; b1: a provider; a1: an admin;
-- d1: a KSA customer; u0: signed in with no profile.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at) VALUES
  ('00000000-0000-0000-0000-0000001200c1', 'authenticated', 'authenticated', '905557770001', now()),
  ('00000000-0000-0000-0000-0000001200c2', 'authenticated', 'authenticated', '905557770002', now()),
  ('00000000-0000-0000-0000-0000001200c3', 'authenticated', 'authenticated', '905557770003', now()),
  ('00000000-0000-0000-0000-0000001200c4', 'authenticated', 'authenticated', '905557770004', now()),
  ('00000000-0000-0000-0000-0000001200b1', 'authenticated', 'authenticated', '905557770005', now()),
  ('00000000-0000-0000-0000-0000001200a1', 'authenticated', 'authenticated', '905557770006', now()),
  ('00000000-0000-0000-0000-0000001200d1', 'authenticated', 'authenticated', '966555777001', now()),
  ('00000000-0000-0000-0000-000000120000', 'authenticated', 'authenticated', '905557770007', now());
INSERT INTO public.profiles (id, role, region, phone, full_name, locale) VALUES
  ('00000000-0000-0000-0000-0000001200c1', 'customer', 'TR', '+905557770001', 'Can Bir', 'tr'),
  ('00000000-0000-0000-0000-0000001200c2', 'customer', 'TR', '+905557770002', 'Can İki', 'tr'),
  ('00000000-0000-0000-0000-0000001200c3', 'customer', 'TR', '+905557770003', 'Can Üç', 'tr'),
  ('00000000-0000-0000-0000-0000001200c4', 'customer', 'TR', '+905557770004', 'Can Dört', 'tr'),
  ('00000000-0000-0000-0000-0000001200b1', 'provider', 'TR', '+905557770005', 'Usta Bir', 'tr'),
  ('00000000-0000-0000-0000-0000001200a1', 'admin', 'TR', '+905557770006', 'Admin Bir', 'en'),
  ('00000000-0000-0000-0000-0000001200d1', 'customer', 'KSA', '+966555777001', 'عميل', 'ar');

-- K1 holds S1 (bookable: fixture F), S2 (no formula) and S3 (off, with a formula). K2 is off, with S4.
-- K3 has only S6, with no formula. K4 is KSA, with S5.
INSERT INTO public.service_categories (id, region, name, display_order, active) VALUES
  ('00000000-0000-0000-0000-00000012c001', 'TR', '{"tr": "Temizlik", "en": "Cleaning"}', 1, true),
  ('00000000-0000-0000-0000-00000012c002', 'TR', '{"tr": "Kapalı"}', 2, false),
  ('00000000-0000-0000-0000-00000012c003', 'TR', '{"tr": "Boş"}', 3, true),
  ('00000000-0000-0000-0000-00000012c004', 'KSA', '{"ar": "تنظيف"}', 1, true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) VALUES
  ('00000000-0000-0000-0000-000000125001', '00000000-0000-0000-0000-00000012c001', 'TR', '{"tr": "Ev temizliği", "en": "Home cleaning"}', 3, 5, 1, true),
  ('00000000-0000-0000-0000-000000125002', '00000000-0000-0000-0000-00000012c001', 'TR', '{"tr": "Fiyatsız"}', 1, 2, 2, true),
  ('00000000-0000-0000-0000-000000125003', '00000000-0000-0000-0000-00000012c001', 'TR', '{"tr": "Kapalı hizmet"}', 1, 2, 3, false),
  ('00000000-0000-0000-0000-000000125004', '00000000-0000-0000-0000-00000012c002', 'TR', '{"tr": "Kapalı kategori"}', 1, 2, 1, true),
  ('00000000-0000-0000-0000-000000125005', '00000000-0000-0000-0000-00000012c004', 'KSA', '{"ar": "منزل"}', 1, 2, 1, true),
  ('00000000-0000-0000-0000-000000125006', '00000000-0000-0000-0000-00000012c003', 'TR', '{"tr": "Formülsüz"}', 1, 2, 1, true);
INSERT INTO public.zones (id, region, name, multiplier, display_order, active) VALUES
  ('00000000-0000-0000-0000-000000122001', 'TR', '{"tr": "Kadıköy"}', 1.00, 1, true),
  ('00000000-0000-0000-0000-000000122002', 'TR', '{"tr": "Beşiktaş"}', 1.15, 2, true),
  ('00000000-0000-0000-0000-000000122003', 'TR', '{"tr": "Kapalı"}', 1.00, 3, false),
  ('00000000-0000-0000-0000-000000122004', 'KSA', '{"ar": "الرياض"}', 1.00, 1, true);
INSERT INTO public.addons (id, service_id, region, name, price, display_order, active) VALUES
  ('00000000-0000-0000-0000-00000012a001', '00000000-0000-0000-0000-000000125001', 'TR', '{"tr": "Cam"}', 40000, 1, true),
  ('00000000-0000-0000-0000-00000012a002', '00000000-0000-0000-0000-000000125001', 'TR', '{"tr": "Kapalı"}', 10000, 2, false);
INSERT INTO public.questions (id, category_id, service_id, region, key, label, type, required, affects_pricing, options, validation, display_order, active) VALUES
  ('00000000-0000-0000-0000-00000012e001', '00000000-0000-0000-0000-00000012c001', NULL, 'TR', 'rooms', '{"tr": "Oda", "en": "Rooms"}', 'number', true, true, NULL, '{"min": 1, "max": 10, "step": 1}', 1, true),
  ('00000000-0000-0000-0000-00000012e002', '00000000-0000-0000-0000-00000012c001', NULL, 'TR', 'bathrooms', '{"tr": "Banyo"}', 'number', true, true, NULL, '{"min": 1, "max": 10, "step": 1}', 2, true),
  ('00000000-0000-0000-0000-00000012e003', '00000000-0000-0000-0000-00000012c001', NULL, 'TR', 'property_type', '{"tr": "Tip"}', 'single_select', true, true,
   '[{"value": "apartment", "label": {"tr": "Daire"}}, {"value": "villa", "label": {"tr": "Villa"}}, {"value": "studio", "label": {"tr": "Stüdyo"}}]', NULL, 3, true),
  ('00000000-0000-0000-0000-00000012e004', '00000000-0000-0000-0000-00000012c001', NULL, 'TR', 'has_pets', '{"tr": "Evcil"}', 'boolean', true, true, NULL, NULL, 4, true),
  ('00000000-0000-0000-0000-00000012e005', '00000000-0000-0000-0000-00000012c001', NULL, 'TR', 'details', '{"tr": "Ayrıntı"}', 'textarea', false, false, NULL, NULL, 5, true),
  ('00000000-0000-0000-0000-00000012e006', '00000000-0000-0000-0000-00000012c001', NULL, 'TR', 'old_q', '{"tr": "Eski"}', 'boolean', false, false, NULL, NULL, 6, false),
  ('00000000-0000-0000-0000-00000012e007', '00000000-0000-0000-0000-00000012c001', '00000000-0000-0000-0000-000000125002', 'TR', 's2_only', '{"tr": "Yalnız S2"}', 'boolean', false, false, NULL, NULL, 7, true);

-- Formulas through the door publish uses: fixture F on S1, a flat one on S3, S4 and S5.
SELECT set_config('pricing.publishing', 'on', true);
INSERT INTO public.pricing_formulas (id, service_id, region, version, base_price, active) VALUES
  ('00000000-0000-0000-0000-00000012f001', '00000000-0000-0000-0000-000000125001', 'TR', 1, 120000, true),
  ('00000000-0000-0000-0000-00000012f003', '00000000-0000-0000-0000-000000125003', 'TR', 1, 100000, true),
  ('00000000-0000-0000-0000-00000012f004', '00000000-0000-0000-0000-000000125004', 'TR', 1, 100000, true),
  ('00000000-0000-0000-0000-00000012f005', '00000000-0000-0000-0000-000000125005', 'KSA', 1, 100000, true);
INSERT INTO public.pricing_modifiers (formula_id, region, apply_order, question_key, match_type, match_value, effect_type, amount, factor) VALUES
  ('00000000-0000-0000-0000-00000012f001', 'TR', 1, 'rooms', 'always', NULL, 'PER_UNIT', 40000, NULL),
  ('00000000-0000-0000-0000-00000012f001', 'TR', 2, 'bathrooms', 'always', NULL, 'PER_UNIT', 25000, NULL),
  ('00000000-0000-0000-0000-00000012f001', 'TR', 3, 'property_type', 'equals', '"villa"', 'MULTIPLIER', NULL, 1.30),
  ('00000000-0000-0000-0000-00000012f001', 'TR', 4, 'has_pets', 'is_true', NULL, 'FIXED', 20000, NULL),
  ('00000000-0000-0000-0000-00000012f001', 'TR', 5, 'property_type', 'equals', '"studio"', 'FIXED', -40000, NULL);
SELECT set_config('pricing.publishing', 'off', true);

-- Helpers. Every one runs as its caller; the grants let them run under the authenticated role.
CREATE FUNCTION pg_temp.as_user(p_id text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Europe/Istanbul')::date $$;
CREATE FUNCTION pg_temp.ans() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"rooms": 3, "bathrooms": 2, "property_type": "apartment", "has_pets": true, "details": "  "}'::jsonb $$;
-- Publish fixture F at Z1 with A1: 350000, commission 35000.
CREATE FUNCTION pg_temp.post(p_key uuid, p_date date, p_hour integer, p_line text, p_notes text,
                             p_price bigint, p_commission bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.create_request(p_key, '00000000-0000-0000-0000-000000125001', '00000000-0000-0000-0000-000000122001',
                               ARRAY['00000000-0000-0000-0000-00000012a001']::uuid[], pg_temp.ans(),
                               p_date, p_hour, p_line, p_notes, p_price, p_commission) $$;
CREATE FUNCTION pg_temp.post_at(p_date date, p_hour integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.post(gen_random_uuid(), p_date, p_hour, 'Moda Cad. No 5', NULL, 350000, 35000) $$;
CREATE FUNCTION pg_temp.quote() RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.quote_request('00000000-0000-0000-0000-000000125001', '00000000-0000-0000-0000-000000122001',
                              ARRAY['00000000-0000-0000-0000-00000012a001']::uuid[], pg_temp.ans()) $$;
-- n quotes in a row; the number that worked before the first refusal.
CREATE FUNCTION pg_temp.quotes(n integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  ok integer := 0;
BEGIN
  FOR i IN 1..n LOOP
    PERFORM pg_temp.quote();
    ok := ok + 1;
  END LOOP;
  RETURN ok;
EXCEPTION WHEN raise_exception THEN
  RETURN ok;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text), pg_temp.today(), pg_temp.ans(),
  pg_temp.post(uuid, date, integer, text, text, bigint, bigint), pg_temp.post_at(date, integer),
  pg_temp.quote(), pg_temp.quotes(integer) TO authenticated;

-- ── schema (AC-1, AC-2) ──────────────────────────────────────────────────────
SELECT has_table('public', 'requests', 'requests exists');
SELECT has_table('public', 'request_addresses', 'request_addresses exists');
SELECT has_table('public', 'quote_counters', 'quote_counters exists');
SELECT results_eq($$ SELECT code, timezone FROM public.regions ORDER BY code $$,
  $$ VALUES ('KSA', 'Asia/Riyadh'), ('TR', 'Europe/Istanbul') $$, 'each region has its IANA time zone');
SELECT col_not_null('public', 'regions', 'timezone', 'regions.timezone is not null');
SELECT throws_ok($$ UPDATE public.regions SET timezone = 'Mars/Olympus' WHERE code = 'TR' $$,
  'P0001', 'timezone_invalid', 'a time zone that is not an IANA name is refused');
SELECT throws_ok($$ UPDATE public.regions SET timezone = 'UTC+3' WHERE code = 'TR' $$,
  'P0001', 'timezone_invalid', 'nor a POSIX offset that at time zone would accept');
SELECT results_eq(
  $$ SELECT region, key, value FROM public.platform_settings
      WHERE key IN ('commission_percent', 'request_lead_days', 'request_horizon_days', 'request_first_hour',
                    'request_last_hour', 'max_open_requests', 'quotes_per_hour')
      ORDER BY region, key $$,
  $$ VALUES ('KSA', 'commission_percent', '10'::jsonb), ('KSA', 'max_open_requests', '5'), ('KSA', 'quotes_per_hour', '60'),
            ('KSA', 'request_first_hour', '8'), ('KSA', 'request_horizon_days', '14'), ('KSA', 'request_last_hour', '18'),
            ('KSA', 'request_lead_days', '1'),
            ('TR', 'commission_percent', '10'), ('TR', 'max_open_requests', '5'), ('TR', 'quotes_per_hour', '60'),
            ('TR', 'request_first_hour', '8'), ('TR', 'request_horizon_days', '14'), ('TR', 'request_last_hour', '18'),
            ('TR', 'request_lead_days', '1') $$,
  'the seven settings are seeded in both regions');
SELECT throws_ok($$ INSERT INTO public.requests (region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
                      pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
                    VALUES ('TR', '00000000-0000-0000-0000-0000001200c1', gen_random_uuid(), '00000000-0000-0000-0000-000000125001',
                      '00000000-0000-0000-0000-000000122004', '{}', '[]', '{}', 100, 0, 100, 'TRY', now(), now() + interval '1 hour') $$,
  '23503', NULL, 'a TR request cannot name a KSA zone, even as postgres (composite key)');
SELECT throws_ok($$ INSERT INTO public.requests (region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
                      pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
                    VALUES ('TR', '00000000-0000-0000-0000-0000001200c1', gen_random_uuid(), '00000000-0000-0000-0000-000000125001',
                      '00000000-0000-0000-0000-000000122001', '{}', '[]', '{}', 100, 10, 100, 'TRY', now(), now() + interval '1 hour') $$,
  '23514', NULL, 'cash_due must be the price less the commission');

-- ── setting checks (AC-1) ────────────────────────────────────────────────────
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'commission_percent' $$,
  '23514', NULL, 'a commission of 0 percent is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '100' WHERE region = 'TR' AND key = 'commission_percent' $$,
  '23514', NULL, 'a commission of 100 percent is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '"10"' WHERE region = 'TR' AND key = 'commission_percent' $$,
  '23514', NULL, 'a commission written as a string is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '10.555' WHERE region = 'TR' AND key = 'commission_percent' $$,
  '23514', NULL, 'a commission with three decimals is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '31' WHERE region = 'TR' AND key = 'request_lead_days' $$,
  '23514', NULL, 'a lead of 31 days is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '1.5' WHERE region = 'TR' AND key = 'request_lead_days' $$,
  '23514', NULL, 'a lead of 1.5 days is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'request_horizon_days' $$,
  '23514', NULL, 'a horizon of 0 days is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '24' WHERE region = 'TR' AND key = 'request_first_hour' $$,
  '23514', NULL, 'an hour of 24 is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'max_open_requests' $$,
  '23514', NULL, 'an open cap of 0 is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'quotes_per_hour' $$,
  '23514', NULL, 'a quote limit of 0 is refused');
SELECT ok((SELECT tgdeferrable AND tginitdeferred FROM pg_trigger WHERE tgname = 'request_settings_guard'),
  'the pair guard is deferred to commit');
SET CONSTRAINTS request_settings_guard IMMEDIATE;
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '15' WHERE region = 'TR' AND key = 'request_lead_days' $$,
  'P0001', 'request_settings_invalid', 'a lead past the horizon is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '19' WHERE region = 'TR' AND key = 'request_first_hour' $$,
  'P0001', 'request_settings_invalid', 'a first hour after the last is refused');
SELECT lives_ok($$ UPDATE public.platform_settings SET value = CASE key WHEN 'request_lead_days' THEN '20'::jsonb ELSE '30'::jsonb END
                    WHERE region = 'TR' AND key IN ('request_lead_days', 'request_horizon_days') $$,
  'both of a pair changed together to a valid pair are accepted');
SELECT lives_ok($$ UPDATE public.platform_settings SET value = CASE key WHEN 'request_lead_days' THEN '1'::jsonb ELSE '14'::jsonb END
                    WHERE region = 'TR' AND key IN ('request_lead_days', 'request_horizon_days') $$,
  'and back');
SET CONSTRAINTS request_settings_guard DEFERRED;

-- ── 03's security Minors, fixed here (tracker Next, 2026-11-15) ──────────────
SELECT is(
  (SELECT substring(prosrc FROM position('^[\s' IN prosrc) FOR position(']+|' IN prosrc) - position('^[\s' IN prosrc))
     FROM pg_proc WHERE proname = 'catalog_trim'),
  (SELECT substring(prosrc FROM position('^[\s' IN prosrc) FOR position(']+|' IN prosrc) - position('^[\s' IN prosrc))
     FROM pg_proc WHERE proname = 'catalog_text_ok'),
  'the two copies of the blank pattern are the same');
SELECT is_empty(
  $$ SELECT to_hex(cp) FROM unnest(ARRAY[4447, 4448, 12644, 65440, 10240, 65024, 65039, 917505, 917536, 917631, 917760, 917999]) cp
      WHERE public.catalog_trim(chr(cp) || chr(cp)) <> ''
         OR NOT public.pricing_answer_blank(to_jsonb(chr(cp)))
         OR public.catalog_text_ok(jsonb_build_object('tr', chr(cp)), 'TR', 10) $$,
  'Hangul fillers, the braille blank, variation selectors and tags are blank everywhere');
SELECT is(public.catalog_trim(chr(12644) || 'Moda' || chr(65039)), 'Moda', 'and are trimmed from both ends');
SELECT is(public.pricing_answer_errors('[{"key": "details", "type": "textarea", "required": false}]',
            jsonb_build_object('details', repeat('a', 20000)), false),
  '[{"key": "details", "code": "answer_out_of_range"}]', 'one answer over 16 KiB is out of range, before any trim');
SELECT is(public.pricing_answer_errors('[{"key": "extras", "type": "multi_select", "required": false, "options": [{"value": "a"}]}]',
            jsonb_build_object('extras', (SELECT jsonb_agg('a'::text) FROM generate_series(1, 31))), false),
  '[{"key": "extras", "code": "answer_out_of_range"}]', 'a multi select of more than 30 items is out of range');
SELECT is(public.pricing_answer_errors('[]', (SELECT jsonb_object_agg('k' || g, repeat('a', 15000)) FROM generate_series(1, 5) g), false),
  '[{"key": null, "code": "answer_invalid"}]', 'answers over 64 KiB in all are one answer_invalid');
SELECT is(public.pricing_answer_errors('[]', jsonb_build_object(repeat('x', 500), 1, 'zz', 1, 'Büyük', 1), false),
  '[{"key": "zz", "code": "answer_unknown"}, {"key": null, "code": "answer_unknown"}]',
  'an unknown key is echoed only when it could be a question key; the others come back once, as null');
UPDATE public.platform_settings SET value = '11' WHERE region = 'TR' AND key = 'commission_percent';
SELECT is((SELECT jsonb_build_object('old', old_value -> 'value', 'new', new_value -> 'value') FROM public.audit_log
            WHERE action = 'settings.update' AND entity_id = 'TR:commission_percent' ORDER BY id DESC LIMIT 1),
  '{"old": 10, "new": 11}', 'a settings change writes an audit row');
UPDATE public.platform_settings SET value = '10' WHERE region = 'TR' AND key = 'commission_percent';

-- ── the split, worked figures (AC-5) ─────────────────────────────────────────
SELECT is(public.pricing_split('TR', 350000), '{"commission_percent": "10", "commission": 35000, "cash_due": 315000}',
  '350000 at 10%: 35000 and 315000');
SELECT is(public.pricing_split('TR', 125500) - 'commission_percent', '{"commission": 12600, "cash_due": 112900}',
  '125.5 lira rounds up');
SELECT is(public.pricing_split('TR', 125400) - 'commission_percent', '{"commission": 12500, "cash_due": 112900}',
  '125.4 lira rounds down');
SELECT is(public.pricing_split('TR', 100) - 'commission_percent', '{"commission": 0, "cash_due": 100}',
  'the smallest price: the commission can be 0');
UPDATE public.platform_settings SET value = '15' WHERE region = 'TR' AND key = 'commission_percent';
SELECT is(public.pricing_split('TR', 320000), '{"commission_percent": "15", "commission": 48000, "cash_due": 272000}',
  'the design''s 3200 at its 15%');
UPDATE public.platform_settings SET value = '12.5' WHERE region = 'TR' AND key = 'commission_percent';
SELECT is(public.pricing_split('TR', 350000), '{"commission_percent": "12.5", "commission": 43800, "cash_due": 306200}',
  'a two decimal percent: 437.5 rounds up');
UPDATE public.platform_settings SET value = '10.50' WHERE region = 'TR' AND key = 'commission_percent';
SELECT is(public.pricing_split('TR', 100000) ->> 'commission_percent', '10.5', '10.50 reads back as 10.5');
DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'commission_percent';
SELECT throws_ok($$ SELECT public.pricing_split('TR', 350000) $$, 'P0001', 'pricing_settings_invalid',
  'a missing commission percent refuses, never a default');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c2');
SELECT throws_ok($$ SELECT pg_temp.quote() $$, 'P0001', 'pricing_settings_invalid', 'and so does every quote');
SELECT throws_ok($$ SELECT pg_temp.post_at(pg_temp.today() + 1, 10) $$, 'P0001', 'pricing_settings_invalid',
  'and every publish');
INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', 'commission_percent', '10');
ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard;
UPDATE public.platform_settings SET key = 'price_rounding_gone' WHERE region = 'TR' AND key = 'price_rounding_minor';
SELECT throws_ok($$ SELECT public.pricing_split('TR', 350000) $$, 'P0001', 'pricing_settings_invalid',
  'a missing rounding unit refuses the split too');
UPDATE public.platform_settings SET key = 'price_rounding_minor' WHERE region = 'TR' AND key = 'price_rounding_gone';
ALTER TABLE public.platform_settings ENABLE TRIGGER pricing_settings_guard;

-- ── a missing request setting (AC-1b) ────────────────────────────────────────
-- Each of the five deleted in turn, as postgres with c2's claims: the catalog and a publish refuse.
CREATE FUNCTION pg_temp.missing_setting_codes() RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  k text;
  v jsonb;
  out text[] := '{}';
BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000001200c2');
  FOREACH k IN ARRAY ARRAY['request_lead_days', 'request_horizon_days', 'request_first_hour', 'request_last_hour',
                           'max_open_requests'] LOOP
    SELECT value INTO v FROM public.platform_settings WHERE region = 'TR' AND key = k;
    DELETE FROM public.platform_settings WHERE region = 'TR' AND key = k;
    BEGIN
      PERFORM public.request_catalog();
      out := out || (k || ':catalog:none');
    EXCEPTION WHEN raise_exception THEN
      out := out || (k || ':catalog:' || sqlerrm);
    END;
    BEGIN
      PERFORM pg_temp.post_at(pg_temp.today() + 1, 10);
      out := out || (k || ':create:none');
    EXCEPTION WHEN raise_exception THEN
      out := out || (k || ':create:' || sqlerrm);
    END;
    INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', k, v);
  END LOOP;
  RETURN array_to_string(out, ',');
END;
$fn$;
SELECT is(pg_temp.missing_setting_codes(),
  'request_lead_days:catalog:request_settings_invalid,request_lead_days:create:request_settings_invalid,'
  'request_horizon_days:catalog:request_settings_invalid,request_horizon_days:create:request_settings_invalid,'
  'request_first_hour:catalog:request_settings_invalid,request_first_hour:create:request_settings_invalid,'
  'request_last_hour:catalog:request_settings_invalid,request_last_hour:create:request_settings_invalid,'
  'max_open_requests:catalog:request_settings_invalid,max_open_requests:create:request_settings_invalid',
  'each of the five request settings deleted in turn refuses the catalog and a publish');
DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'quotes_per_hour';
SELECT throws_ok($$ SELECT pg_temp.quote() $$, 'P0001', 'request_settings_invalid',
  'a missing quote limit refuses every quote');
INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', 'quotes_per_hour', '60');

-- ── the catalog (AC-4) ───────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c1');
CREATE TEMP TABLE cat AS SELECT public.request_catalog() AS c;
SELECT is((SELECT jsonb_path_query_array(c, '$.categories[*].id') FROM cat),
  '["00000000-0000-0000-0000-00000012c001"]', 'only an active category with a bookable service');
SELECT is((SELECT jsonb_path_query_array(c, '$.categories[*].services[*].id') FROM cat),
  '["00000000-0000-0000-0000-000000125001"]', 'no off service, no service without a formula');
SELECT is((SELECT jsonb_path_query_array(c, '$.categories[0].services[0].questions[*].key') FROM cat),
  '["rooms", "bathrooms", "property_type", "has_pets", "details"]',
  'the service''s questions, in display order, with no off question and no other service''s');
SELECT is((SELECT array_agg(k ORDER BY k) FROM cat, jsonb_object_keys(c -> 'categories' -> 0 -> 'services' -> 0 -> 'questions' -> 0) k),
  ARRAY['help_text', 'key', 'label', 'options', 'required', 'service_id', 'type', 'validation'],
  'a question carries no affects_pricing');
SELECT is((SELECT c -> 'categories' -> 0 -> 'services' -> 0 -> 'addons' FROM cat),
  '[{"id": "00000000-0000-0000-0000-00000012a001", "name": {"tr": "Cam"}, "price": 40000}]', 'only the active addon, with its price');
SELECT is((SELECT c -> 'zones' FROM cat),
  '[{"id": "00000000-0000-0000-0000-000000122001", "name": {"tr": "Kadıköy"}}, {"id": "00000000-0000-0000-0000-000000122002", "name": {"tr": "Beşiktaş"}}]',
  'the active zones of the region, with no multiplier');
SELECT is((SELECT (c -> 'categories' -> 0 -> 'services' -> 0) - 'questions' - 'addons' FROM cat),
  '{"id": "00000000-0000-0000-0000-000000125001", "name": {"en": "Home cleaning", "tr": "Ev temizliği"}, "note": null, "hours_min": 3, "hours_max": 5}',
  'a service: its name, note and hours');
SELECT is((SELECT c - 'zones' - 'categories' FROM cat),
  jsonb_build_object('region', 'TR', 'currency', 'TRY', 'timezone', 'Europe/Istanbul', 'today', to_char(pg_temp.today(), 'YYYY-MM-DD'),
                     'schedule', '{"lead_days": 1, "horizon_days": 14, "first_hour": 8, "last_hour": 18}'::jsonb),
  'the region, the currency, the time zone, the local date and the schedule');
SELECT ok((SELECT c::text !~* '(formula|modifier|affects_pricing|multiplier|factor)' FROM cat),
  'no formula, modifier, affects_pricing, multiplier or factor anywhere in the tree');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200b1');
SELECT is(public.request_catalog(), (SELECT c FROM cat), 'a provider gets the same tree');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200d1');
SELECT is(jsonb_path_query_array(public.request_catalog(), '$.categories[*].services[*].id'),
  '["00000000-0000-0000-0000-000000125005"]', 'a KSA customer reads the KSA catalog only');
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000120000');
SELECT throws_ok($$ SELECT public.request_catalog() $$, 'P0001', 'forbidden', 'no profile: forbidden');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.request_catalog()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.quote_request(uuid, uuid, uuid[], jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.create_request(uuid, uuid, uuid, uuid[], jsonb, date, integer, text, text, bigint, bigint)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.cancel_request(uuid, text)', 'EXECUTE'),
  'anon runs none of the four');
SELECT ok(NOT has_function_privilege('authenticated', 'public.request_settings(text)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.pricing_split(text, bigint)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.count_quote(uuid, text)', 'EXECUTE'),
  'the settings reader, the split and the counter are internal');

-- ── quoting (AC-5, AC-28) ────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c1');
SELECT is((SELECT jsonb_build_object('price', q -> 'price', 'commission_percent', q -> 'commission_percent',
                                     'commission', q -> 'commission', 'cash_due', q -> 'cash_due') FROM pg_temp.quote() q),
  '{"price": 350000, "commission_percent": "10", "commission": 35000, "cash_due": 315000}',
  'a quote carries the split');
SELECT is(public.quote_request('00000000-0000-0000-0000-000000125001', '00000000-0000-0000-0000-000000122001', NULL, '{"rooms": 3}'),
  '{"status": "invalid", "errors": [{"key": "bathrooms", "code": "answer_required"}, {"key": "has_pets", "code": "answer_required"}, {"key": "property_type", "code": "answer_required"}]}',
  'answer errors come back with no price');
SELECT throws_ok($$ SELECT public.quote_request('00000000-0000-0000-0000-000000125001', '00000000-0000-0000-0000-000000122004', NULL, '{}') $$,
  'P0001', 'zone_unavailable', 'a zone of another region refuses');
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000125001', '00000000-0000-0000-0000-000000122001', NULL, '{}') $$,
  '42501', NULL, 'a customer token cannot call quote_price directly');
RESET ROLE;
SELECT ok(NOT has_function_privilege('authenticated', 'public.quote_price(uuid, uuid, uuid[], jsonb)', 'EXECUTE'),
  'quote_price has no authenticated grant');

-- ── publishing (AC-7 to AC-10, AC-12) ────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c1');
CREATE TEMP TABLE r1 AS
  SELECT pg_temp.post('00000000-0000-0000-0000-0000001200f1', pg_temp.today() + 1, 10,
                      '   Moda Cad. No 5, D 3   ', ' ' || chr(160) || chr(8203) || ' ', 350000, 35000) AS r;
SELECT is((SELECT r - 'id' FROM r1), '{"status": "ok"}', 'the customer publishes');
RESET ROLE;
SELECT results_eq(
  $$ SELECT q.status, q.fixed_price, q.commission_amount, q.cash_due, q.currency, q.region, q.customer_id::text, q.notes,
            q.addon_ids::text
       FROM public.requests q WHERE q.id = (SELECT (r ->> 'id')::uuid FROM r1) $$,
  $$ VALUES ('OPEN', 350000::bigint, 35000::bigint, 315000::bigint, 'TRY', 'TR', '00000000-0000-0000-0000-0000001200c1',
             NULL::text, '{00000000-0000-0000-0000-00000012a001}') $$,
  'stored as OPEN with the server''s figures; notes of blank marks stored as null');
SELECT results_eq(
  $$ SELECT q.scheduled_start_at, q.scheduled_end_at,
            to_char(q.scheduled_end_at AT TIME ZONE 'UTC', 'HH24:MI'), to_char(q.scheduled_end_at AT TIME ZONE 'Europe/Istanbul', 'HH24:MI')
       FROM public.requests q WHERE q.id = (SELECT (r ->> 'id')::uuid FROM r1) $$,
  $$ SELECT make_timestamptz(extract(year FROM pg_temp.today() + 1)::int, extract(month FROM pg_temp.today() + 1)::int,
                              extract(day FROM pg_temp.today() + 1)::int, 10, 0, 0, 'Europe/Istanbul'),
            make_timestamptz(extract(year FROM pg_temp.today() + 1)::int, extract(month FROM pg_temp.today() + 1)::int,
                              extract(day FROM pg_temp.today() + 1)::int, 15, 0, 0, 'Europe/Istanbul'),
            '12:00', '15:00' $$,
  'a start at 10:00 local; hours_max 5 ends at 15:00 local, stored as 12:00 UTC');
SELECT is((SELECT line FROM public.request_addresses WHERE request_id = (SELECT (r ->> 'id')::uuid FROM r1)),
  'Moda Cad. No 5, D 3', 'the address line, trimmed, in its own table');
SELECT is((SELECT answers FROM public.requests WHERE id = (SELECT (r ->> 'id')::uuid FROM r1)),
  '{"rooms": 3, "bathrooms": 2, "property_type": "apartment", "has_pets": true}', 'a blank answer is removed');
SELECT is((SELECT jsonb_path_query_array(questions_snapshot, '$[*].key') FROM public.requests WHERE id = (SELECT (r ->> 'id')::uuid FROM r1)),
  '["rooms", "bathrooms", "property_type", "has_pets", "details"]', 'the questions as asked');
SELECT is((SELECT array_agg(k ORDER BY k) FROM public.requests, jsonb_object_keys(questions_snapshot -> 0) k
            WHERE id = (SELECT (r ->> 'id')::uuid FROM r1)),
  ARRAY['key', 'label', 'options', 'required', 'type'], 'each with key, type, label, options and required');
SELECT is((SELECT jsonb_build_object('service', pricing_snapshot -> 'service', 'zone', pricing_snapshot -> 'breakdown' -> 'zone' -> 'name',
                                     'percent', pricing_snapshot -> 'commission_percent', 'unit', pricing_snapshot -> 'rounding_minor',
                                     'version', pricing_snapshot -> 'formula_version', 'price', pricing_snapshot -> 'price')
             FROM public.requests WHERE id = (SELECT (r ->> 'id')::uuid FROM r1)),
  '{"service": {"id": "00000000-0000-0000-0000-000000125001", "name": {"en": "Home cleaning", "tr": "Ev temizliği"}, "category_name": {"en": "Cleaning", "tr": "Temizlik"}},
    "zone": {"tr": "Kadıköy"}, "percent": "10", "unit": 100, "version": 1, "price": 350000}',
  'the pricing snapshot names the service, its category and the zone, with the percent and the unit');
SELECT is((SELECT new_value FROM public.audit_log WHERE action = 'request.created' AND entity_id = (SELECT r ->> 'id' FROM r1)),
  '{"status": "OPEN", "fixed_price": 350000, "service_id": "00000000-0000-0000-0000-000000125001", "zone_id": "00000000-0000-0000-0000-000000122001"}',
  'the audit row holds ids, the status and the price only');

-- Replays (AC-12).
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c1');
SELECT is(pg_temp.post('00000000-0000-0000-0000-0000001200f1', pg_temp.today() + 1, 10, 'Moda Cad. No 5', NULL, 350000, 35000),
  (SELECT r FROM r1), 'the same client key returns the same id');
SELECT is(public.create_request('00000000-0000-0000-0000-0000001200f1', '00000000-0000-0000-0000-000000125001',
            '00000000-0000-0000-0000-000000122002', NULL, '{"rooms": 1}', NULL, NULL, 'x', NULL, 1, 1),
  (SELECT r FROM r1), 'even with other inputs, checking nothing');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c2');
SELECT isnt((SELECT pg_temp.post('00000000-0000-0000-0000-0000001200f1', pg_temp.today() + 1, 10, 'Moda Cad. No 5', NULL, 350000, 35000) ->> 'id'),
  (SELECT r ->> 'id' FROM r1), 'another customer''s equal key is a new request');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.requests WHERE client_key = '00000000-0000-0000-0000-0000001200f1'), 2,
  'one row per customer and key');

-- Tamper (AC-10).
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c1');
SELECT is((SELECT r ->> 'status' FROM pg_temp.post(gen_random_uuid(), pg_temp.today() + 1, 11, 'Moda Cad. No 5', NULL, 349900, 35000) r),
  'price_changed', 'an expected price one unit lower refuses');
SELECT is((SELECT r -> 'quote' -> 'price' FROM pg_temp.post(gen_random_uuid(), pg_temp.today() + 1, 11, 'Moda Cad. No 5', NULL, 349900, 35000) r),
  '350000', 'with the new figures in the quote shape');
SELECT is((SELECT r ->> 'status' FROM pg_temp.post(gen_random_uuid(), pg_temp.today() + 1, 11, 'Moda Cad. No 5', NULL, 350000, 34900) r),
  'price_changed', 'an expected commission one unit lower refuses');
SELECT is((SELECT r ->> 'status' FROM pg_temp.post(gen_random_uuid(), pg_temp.today() + 1, 11, 'Moda Cad. No 5', NULL, NULL, 35000) r),
  'price_changed', 'a null expected price refuses');
SELECT is((SELECT r ->> 'status' FROM pg_temp.post(gen_random_uuid(), pg_temp.today() + 1, 11, 'Moda Cad. No 5', NULL, 350000, NULL) r),
  'price_changed', 'a null expected commission refuses');
SELECT is((SELECT count(*)::int FROM public.requests), 1, 'and none of them wrote a row');
SELECT is((SELECT r ->> 'status' FROM public.create_request(gen_random_uuid(), '00000000-0000-0000-0000-000000125001',
             '00000000-0000-0000-0000-000000122001', NULL, '{"rooms": 3}', pg_temp.today() + 1, 11, 'Moda Cad. No 5', NULL, 1, 1) r),
  'invalid', 'answer errors come back as invalid');
SELECT throws_ok($$ INSERT INTO public.requests (region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
                      pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
                    VALUES ('TR', '00000000-0000-0000-0000-0000001200c1', gen_random_uuid(), '00000000-0000-0000-0000-000000125001',
                      '00000000-0000-0000-0000-000000122001', '{}', '[]', '{}', 100, 0, 100, 'TRY', now(), now() + interval '1 hour') $$,
  '42501', NULL, 'a customer token cannot insert a request');
SELECT throws_ok($$ UPDATE public.requests SET fixed_price = 1 $$, '42501', NULL, 'nor update one');
SELECT throws_ok($$ DELETE FROM public.requests $$, '42501', NULL, 'nor delete one');
SELECT throws_ok($$ INSERT INTO public.request_addresses (request_id, region, customer_id, line)
                    VALUES ((SELECT (r ->> 'id')::uuid FROM r1), 'TR', '00000000-0000-0000-0000-0000001200c1', 'Başka sokak') $$,
  '42501', NULL, 'nor insert an address');
SELECT throws_ok($$ UPDATE public.request_addresses SET line = 'Başka sokak' $$, '42501', NULL, 'nor update one');
SELECT throws_ok($$ DELETE FROM public.request_addresses $$, '42501', NULL, 'nor delete one');
RESET ROLE;
SELECT is((SELECT (length(prosrc) - length(replace(prosrc, 'p_expected_', ''))) / length('p_expected_')
             FROM pg_proc WHERE proname = 'create_request'), 2,
  'each expected figure is named once in the body');
SELECT ok((SELECT prosrc ~ 'if p_expected_price is distinct from v_price or p_expected_commission is distinct from v_commission then'
             FROM pg_proc WHERE proname = 'create_request'),
  'and only in the comparison of step 8');
SELECT is_empty($$ SELECT s FROM pg_proc p, regexp_split_to_table(p.prosrc, ';') s
                    WHERE p.proname = 'create_request' AND s ~* '\minsert\M' AND s ~ 'p_expected_' $$,
  'no insert reads an expected figure: they are compared, never stored');

-- Schedule (AC-7, AC-8). The cap is lifted for c2 meanwhile.
UPDATE public.platform_settings SET value = '100' WHERE region = 'TR' AND key = 'max_open_requests';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c2');
SELECT throws_ok($$ SELECT pg_temp.post_at(pg_temp.today(), 10) $$, 'P0001', 'schedule_invalid', 'today, with a lead of one day');
SELECT is(pg_temp.post_at(pg_temp.today() + 1, 8) ->> 'status', 'ok', 'tomorrow at the first hour');
SELECT is(pg_temp.post_at(pg_temp.today() + 1, 18) ->> 'status', 'ok', 'tomorrow at the last hour');
SELECT throws_ok($$ SELECT pg_temp.post_at(pg_temp.today() + 1, 7) $$, 'P0001', 'schedule_invalid', 'an hour before the first');
SELECT throws_ok($$ SELECT pg_temp.post_at(pg_temp.today() + 1, 19) $$, 'P0001', 'schedule_invalid', 'an hour after the last');
SELECT is(pg_temp.post_at(pg_temp.today() + 14, 12) ->> 'status', 'ok', 'the last day of the horizon');
SELECT throws_ok($$ SELECT pg_temp.post_at(pg_temp.today() + 15, 12) $$, 'P0001', 'schedule_invalid', 'a day past the horizon');
SELECT throws_ok($$ SELECT pg_temp.post_at(NULL, 12) $$, 'P0001', 'schedule_invalid', 'a null date');
SELECT throws_ok($$ SELECT pg_temp.post_at(pg_temp.today() + 1, NULL) $$, 'P0001', 'schedule_invalid', 'a null hour');

-- The street line and the notes (AC-7).
SELECT throws_ok($$ SELECT pg_temp.post(gen_random_uuid(), pg_temp.today() + 2, 10, 'Moda', NULL, 350000, 35000) $$,
  'P0001', 'address_invalid', 'a line of 4 code points');
SELECT throws_ok($$ SELECT pg_temp.post(gen_random_uuid(), pg_temp.today() + 2, 10, repeat('ş', 201), NULL, 350000, 35000) $$,
  'P0001', 'address_invalid', 'a line of 201 code points');
SELECT throws_ok($$ SELECT pg_temp.post(gen_random_uuid(), pg_temp.today() + 2, 10, '      ' || chr(160), NULL, 350000, 35000) $$,
  'P0001', 'address_invalid', 'a line of only spaces');
SELECT throws_ok($$ SELECT pg_temp.post(gen_random_uuid(), pg_temp.today() + 2, 10, NULL, NULL, 350000, 35000) $$,
  'P0001', 'address_invalid', 'no line');
SELECT is(pg_temp.post(gen_random_uuid(), pg_temp.today() + 2, 10, repeat('ş', 200), repeat('ğ', 500), 350000, 35000) ->> 'status',
  'ok', 'a line of 200 and notes of 500 code points');
SELECT throws_ok($$ SELECT pg_temp.post(gen_random_uuid(), pg_temp.today() + 2, 10, 'Moda Cad. No 5', repeat('ğ', 501), 350000, 35000) $$,
  'P0001', 'notes_invalid', 'notes of 501 code points');
SELECT throws_ok($$ SELECT pg_temp.post(gen_random_uuid(), pg_temp.today() + 2, 10, 'Moda Cad. No 5', 'beni ara 0555 123 45 67', 350000, 35000) $$,
  'P0001', 'contact_info_in_notes', 'notes with a phone number');
SELECT throws_ok($$ SELECT pg_temp.post(gen_random_uuid(), pg_temp.today() + 2, 10, 'Moda Cad. No 5', 'yaz bana ali@example.com', 350000, 35000) $$,
  'P0001', 'contact_info_in_notes', 'notes with an email');
SELECT throws_ok($$ SELECT pg_temp.post(gen_random_uuid(), pg_temp.today() + 2, 10, 'Moda Cad. No 5', 'bak https://example.com/x', 350000, 35000) $$,
  'P0001', 'contact_info_in_notes', 'notes with a link');
RESET ROLE;
UPDATE public.platform_settings SET value = '5' WHERE region = 'TR' AND key = 'max_open_requests';

-- Who may publish (AC-7).
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200b1');
SELECT throws_ok($$ SELECT pg_temp.post_at(pg_temp.today() + 1, 10) $$, 'P0001', 'forbidden', 'a provider cannot publish');
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000120000');
SELECT throws_ok($$ SELECT pg_temp.post_at(pg_temp.today() + 1, 10) $$, 'P0001', 'forbidden', 'no profile: forbidden');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200a1');
SELECT is(pg_temp.post_at(pg_temp.today() + 1, 10) ->> 'status', 'ok', 'an admin may publish their own request');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c1');
SELECT throws_ok($$ SELECT public.create_request(NULL, '00000000-0000-0000-0000-000000125001', '00000000-0000-0000-0000-000000122001', NULL,
                      pg_temp.ans(), pg_temp.today() + 1, 10, 'Moda Cad. No 5', NULL, 350000, 35000) $$,
  'P0001', 'validation_failed', 'a null client key');
SELECT throws_ok($$ SELECT public.create_request(gen_random_uuid(), '00000000-0000-0000-0000-000000125002', '00000000-0000-0000-0000-000000122001', NULL,
                      '{}', pg_temp.today() + 1, 10, 'Moda Cad. No 5', NULL, 1, 1) $$,
  'P0001', 'service_unavailable', 'a service with no formula');
SELECT throws_ok($$ SELECT public.create_request(gen_random_uuid(), '00000000-0000-0000-0000-000000125001', '00000000-0000-0000-0000-000000122003', NULL,
                      pg_temp.ans(), pg_temp.today() + 1, 10, 'Moda Cad. No 5', NULL, 1, 1) $$,
  'P0001', 'zone_unavailable', 'an off zone');
SELECT throws_ok($$ SELECT public.create_request(gen_random_uuid(), '00000000-0000-0000-0000-000000125001', '00000000-0000-0000-0000-000000122001',
                      ARRAY['00000000-0000-0000-0000-00000012a002']::uuid[], pg_temp.ans(), pg_temp.today() + 1, 10, 'Moda Cad. No 5', NULL, 1, 1) $$,
  'P0001', 'addon_unavailable', 'an off addon');
RESET ROLE;

-- The open cap (AC-7): five live, a sixth refused; an expired one and a cancelled one free a slot.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c4');
CREATE TEMP TABLE c4 AS SELECT h, pg_temp.post_at(pg_temp.today() + 1, h) AS r FROM generate_series(9, 13) h;
SELECT is((SELECT count(*)::int FROM c4 WHERE r ->> 'status' = 'ok'), 5, 'five live requests');
SELECT throws_ok($$ SELECT pg_temp.post_at(pg_temp.today() + 2, 9) $$, 'P0001', 'too_many_open_requests', 'a sixth is refused');
RESET ROLE;
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
UPDATE public.requests SET scheduled_start_at = now() - interval '2 hours', scheduled_end_at = now() - interval '1 hour'
 WHERE id = (SELECT (r ->> 'id')::uuid FROM c4 WHERE h = 9);
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c4');
SELECT is(pg_temp.post_at(pg_temp.today() + 2, 9) ->> 'status', 'ok', 'an expired one frees a slot');
SELECT is(public.cancel_request((SELECT (r ->> 'id')::uuid FROM c4 WHERE h = 10), NULL), '{"status": "ok"}', 'cancel one');
SELECT is(pg_temp.post_at(pg_temp.today() + 2, 10) ->> 'status', 'ok', 'and so does a cancelled one');
SELECT throws_ok($$ SELECT pg_temp.post_at(pg_temp.today() + 2, 11) $$, 'P0001', 'too_many_open_requests', 'then the cap holds again');
RESET ROLE;

-- ── the quote rate limit (AC-28) ─────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c3');
CREATE TEMP TABLE r3 AS SELECT pg_temp.post_at(pg_temp.today() + 1, 10) AS r;
RESET ROLE;
SELECT is((SELECT count FROM public.quote_counters WHERE user_id = '00000000-0000-0000-0000-0000001200c3'), 1,
  'a publish counts one quote');
DELETE FROM public.quote_counters WHERE user_id = '00000000-0000-0000-0000-0000001200c3';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c3');
SELECT is(pg_temp.quotes(60), 60, '60 quotes in an hour work');
SELECT throws_ok($$ SELECT pg_temp.quote() $$, 'P0001', 'too_many_quotes', 'the 61st refuses');
SELECT throws_ok($$ SELECT pg_temp.post_at(pg_temp.today() + 2, 10) $$, 'P0001', 'too_many_quotes', 'and so does a publish past the limit');
SELECT is((SELECT public.create_request(q.client_key, q.service_id, q.zone_id, NULL, '{}', NULL, NULL, NULL, NULL, NULL, NULL)
             FROM public.requests q WHERE q.id = (SELECT (r ->> 'id')::uuid FROM r3)),
  (SELECT r FROM r3), 'a replay of an existing key still returns its id past the limit');
SELECT is_empty($$ SELECT user_id FROM public.quote_counters $$, 'a customer reads no counter row, not even their own');
SELECT throws_ok($$ INSERT INTO public.quote_counters (user_id, region, window_start, count)
                    VALUES ('00000000-0000-0000-0000-0000001200c3', 'TR', now(), 1) $$,
  '42501', NULL, 'nor inserts one');
SELECT throws_ok($$ UPDATE public.quote_counters SET count = 1 $$, '42501', NULL, 'nor updates one');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200a1');
SELECT is((SELECT count FROM public.quote_counters WHERE user_id = '00000000-0000-0000-0000-0000001200c3'), 60,
  'an admin reads the counter: the refusals counted nothing more');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.requests WHERE customer_id = '00000000-0000-0000-0000-0000001200c3'), 1,
  'the refused publish created nothing');
UPDATE public.quote_counters SET window_start = window_start - interval '1 hour'
 WHERE user_id = '00000000-0000-0000-0000-0000001200c3';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c3');
SELECT is(pg_temp.quote() ->> 'status', 'ok', 'the first quote after the window works');
RESET ROLE;
SELECT is((SELECT count FROM public.quote_counters WHERE user_id = '00000000-0000-0000-0000-0000001200c3'), 1,
  'and opens a new window at 1');

-- ── guards (AC-3) ────────────────────────────────────────────────────────────
SELECT throws_ok($$ UPDATE public.requests SET fixed_price = 1, cash_due = 1 - commission_amount WHERE id = (SELECT (r ->> 'id')::uuid FROM r1) $$,
  'P0001', 'request_immutable', 'the price never changes, even as postgres');
SELECT throws_ok($$ UPDATE public.requests SET answers = '{}' WHERE id = (SELECT (r ->> 'id')::uuid FROM r1) $$,
  'P0001', 'request_immutable', 'nor the answers');
SELECT throws_ok($$ UPDATE public.requests SET scheduled_start_at = scheduled_start_at + interval '1 hour' WHERE id = (SELECT (r ->> 'id')::uuid FROM r1) $$,
  'P0001', 'request_immutable', 'nor the start');
SELECT throws_ok($$ UPDATE public.requests SET customer_id = '00000000-0000-0000-0000-0000001200c2' WHERE id = (SELECT (r ->> 'id')::uuid FROM r1) $$,
  'P0001', 'request_immutable', 'nor the customer');
SELECT throws_ok($$ UPDATE public.request_addresses SET line = 'Başka sokak' WHERE request_id = (SELECT (r ->> 'id')::uuid FROM r1) $$,
  'P0001', 'request_address_immutable', 'an address row never changes');
SELECT throws_ok($$ DELETE FROM public.request_addresses WHERE request_id = (SELECT (r ->> 'id')::uuid FROM r1) $$,
  'P0001', 'request_address_immutable', 'and is never deleted');
CREATE TEMP TABLE bare AS
  WITH ins AS (INSERT INTO public.requests (region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
                 pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
               VALUES ('TR', '00000000-0000-0000-0000-0000001200c3', gen_random_uuid(), '00000000-0000-0000-0000-000000125001',
                 '00000000-0000-0000-0000-000000122001', '{}', '[]', '{}', 100, 0, 100, 'TRY', now() + interval '1 day', now() + interval '2 days')
               RETURNING id)
  SELECT id FROM ins;
SELECT throws_ok($$ INSERT INTO public.request_addresses (request_id, region, customer_id, line)
                    VALUES ((SELECT id FROM bare), 'TR', '00000000-0000-0000-0000-0000001200c1', 'Başka sokak') $$,
  '23503', NULL, 'an address naming another customer than its request is refused by the composite key');

-- ── snapshots never move (AC-9) ──────────────────────────────────────────────
CREATE TEMP TABLE r1_before AS SELECT to_jsonb(q) AS j FROM public.requests q WHERE q.id = (SELECT (r ->> 'id')::uuid FROM r1);
UPDATE public.pricing_formulas SET active = false WHERE id = '00000000-0000-0000-0000-00000012f001';
SELECT set_config('pricing.publishing', 'on', true);
INSERT INTO public.pricing_formulas (service_id, region, version, base_price, active)
  VALUES ('00000000-0000-0000-0000-000000125001', 'TR', 2, 200000, true);
SELECT set_config('pricing.publishing', 'off', true);
UPDATE public.services SET name = '{"tr": "Yeni ad"}' WHERE id = '00000000-0000-0000-0000-000000125001';
UPDATE public.zones SET name = '{"tr": "Yeni semt"}' WHERE id = '00000000-0000-0000-0000-000000122001';
UPDATE public.questions SET label = '{"tr": "Yeni etiket"}' WHERE key = 'rooms' AND category_id = '00000000-0000-0000-0000-00000012c001';
UPDATE public.questions SET active = false WHERE key = 'details' AND category_id = '00000000-0000-0000-0000-00000012c001';
UPDATE public.platform_settings SET value = '15' WHERE region = 'TR' AND key = 'commission_percent';
SELECT is((SELECT to_jsonb(q) FROM public.requests q WHERE q.id = (SELECT (r ->> 'id')::uuid FROM r1)), (SELECT j FROM r1_before),
  'a new formula, a renamed service and zone, a relabelled and a retired question and a new percent change nothing stored');

-- ── cancel (AC-15) ───────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c1');
SELECT throws_ok($$ SELECT public.cancel_request((SELECT (r ->> 'id')::uuid FROM r1), 'bored') $$,
  'P0001', 'validation_failed', 'a reason off the list');
SELECT throws_ok($$ SELECT public.cancel_request(gen_random_uuid(), NULL) $$, 'P0001', 'not_found', 'an unknown id');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c2');
SELECT throws_ok($$ SELECT public.cancel_request((SELECT (r ->> 'id')::uuid FROM r1), NULL) $$,
  'P0001', 'not_found', 'another customer''s request');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200a1');
SELECT throws_ok($$ SELECT public.cancel_request((SELECT (r ->> 'id')::uuid FROM r1), NULL) $$,
  'P0001', 'not_found', 'an admin cancels only their own requests here');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c1');
SELECT is(public.cancel_request((SELECT (r ->> 'id')::uuid FROM r1), 'plans_changed'), '{"status": "ok"}', 'the owner cancels');
SELECT is(public.cancel_request((SELECT (r ->> 'id')::uuid FROM r1), NULL), '{"status": "ok"}', 'cancelling again is ok');
SELECT is(pg_temp.post('00000000-0000-0000-0000-0000001200f1', pg_temp.today() + 1, 10, 'x', NULL, NULL, NULL), (SELECT r FROM r1),
  'a replay after a cancel still returns that id');
RESET ROLE;
SELECT results_eq(
  $$ SELECT status, cancelled_by, cancel_reason, cancelled_at IS NOT NULL FROM public.requests WHERE id = (SELECT (r ->> 'id')::uuid FROM r1) $$,
  $$ VALUES ('CANCELLED', 'customer', 'plans_changed', true) $$, 'CANCELLED, by the customer, with the reason');
SELECT is((SELECT jsonb_build_object('old', old_value, 'new', new_value) FROM public.audit_log
            WHERE action = 'request.cancelled' AND entity_id = (SELECT r ->> 'id' FROM r1)),
  '{"old": {"status": "OPEN"}, "new": {"status": "CANCELLED", "fixed_price": 350000}}',
  'one audit row, with no notes and no address');
UPDATE public.requests SET status = 'SELECTED' WHERE id = (SELECT (r ->> 'id')::uuid FROM c4 WHERE h = 11);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c4');
SELECT throws_ok($$ SELECT public.cancel_request((SELECT (r ->> 'id')::uuid FROM c4 WHERE h = 11), NULL) $$,
  'P0001', 'not_cancellable', 'a SELECTED request cannot be cancelled here');
SELECT is(public.cancel_request((SELECT (r ->> 'id')::uuid FROM c4 WHERE h = 9), 'other'), '{"status": "ok"}',
  'an expired OPEN request can be cancelled');
RESET ROLE;

-- ── RLS (AC-17) ──────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c2');
SELECT is_empty($$ SELECT id FROM public.requests WHERE customer_id = '00000000-0000-0000-0000-0000001200c1' $$,
  'customer B reads none of A''s requests');
SELECT is_empty($$ SELECT request_id FROM public.request_addresses WHERE customer_id = '00000000-0000-0000-0000-0000001200c1' $$,
  'nor A''s addresses');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200c1');
SELECT is((SELECT count(*)::int FROM public.requests), 1, 'A reads their own request');
SELECT is((SELECT count(*)::int FROM public.request_addresses), 1, 'and its address');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200a1');
SELECT isnt_empty($$ SELECT id FROM public.requests WHERE customer_id = '00000000-0000-0000-0000-0000001200c1' $$,
  'an admin reads A''s request');
SELECT is_empty($$ SELECT request_id FROM public.request_addresses WHERE customer_id <> '00000000-0000-0000-0000-0000001200a1' $$,
  'but no other customer''s address');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000001200b1');
SELECT is_empty($$ SELECT id FROM public.requests $$, 'a provider reads no request');
SELECT is_empty($$ SELECT request_id FROM public.request_addresses $$, 'nor any address');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT id FROM public.requests $$, '42501', NULL, 'anon cannot read requests');
SELECT throws_ok($$ SELECT request_id FROM public.request_addresses $$, '42501', NULL, 'nor addresses');
RESET ROLE;
SELECT table_privs_are('public', 'requests', 'service_role', ARRAY['SELECT'], 'service_role only reads requests');
SELECT table_privs_are('public', 'request_addresses', 'service_role', ARRAY[]::text[], 'and never an address');
SELECT table_privs_are('public', 'requests', 'authenticated', ARRAY['SELECT'], 'signed in users only read requests');
SELECT table_privs_are('public', 'request_addresses', 'authenticated', ARRAY['SELECT'], 'and addresses');
SELECT table_privs_are('public', 'quote_counters', 'authenticated', ARRAY['SELECT'], 'and counters');

-- Every definer function a signed in user can run, as this migration leaves it: quote_price is gone.
SELECT set_eq(
  $$ SELECT n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')'
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND p.proname IN ('quote_price', 'request_catalog', 'quote_request', 'create_request', 'cancel_request') $$,
  $$ VALUES ('public.request_catalog()'), ('public.quote_request(uuid, uuid, uuid[], jsonb)'),
            ('public.create_request(uuid, uuid, uuid, uuid[], jsonb, date, integer, text, text, bigint, bigint)'),
            ('public.cancel_request(uuid, text)') $$,
  'a signed in user reaches the engine only through quote_request and create_request');

SELECT * FROM finish();
ROLLBACK;
