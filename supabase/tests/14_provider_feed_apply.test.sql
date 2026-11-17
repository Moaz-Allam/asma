-- Position 05, spec 0009: provider feed and apply.
--
-- A hostile provider calls PostgREST straight with a real token, so each rule is proven here by calling
-- the database as that provider: every refusal of apply_to_request, the exact keys the two reads return
-- (and that the notes, a typed answer and the address never ride out), a rival's rows, the cap, the
-- hourly limit, the scanner corpus of verify.md, cancel, the guards and the grants. The races (two
-- sessions through dblink) are in 15. The first section proves 04's review carry overs (tracker R10).
-- Every figure and every text is fixture data. AC-1, AC-3 to AC-8, AC-10, AC-13, AC-14, AC-16 to AC-19, AC-23.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(280);

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000001400' || p)::uuid $$;
CREATE FUNCTION pg_temp.s(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-00000014500' || p)::uuid $$;
CREATE FUNCTION pg_temp.z(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-00000014200' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000001470' || lpad(p::text, 2, '0'))::uuid $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- Providers: a1 A, a2 B, a3 C (approved, with a setup); a4 D (suspended); a5 draft; a6 pending;
-- a7 rejected; a8 an expired document; a9 approved with no setup; b1 a KSA provider; b2 the hourly
-- limit; b3 paging; b4 the corpus. c1, c2: customers. d1: an admin. e1: a KSA customer. 00: no profile.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('a1', '905559140001'), ('a2', '905559140002'), ('a3', '905559140003'), ('a4', '905559140004'),
               ('a5', '905559140005'), ('a6', '905559140006'), ('a7', '905559140007'), ('a8', '905559140008'),
               ('a9', '905559140009'), ('b1', '966559140001'), ('b2', '905559140011'), ('b3', '905559140012'),
               ('b4', '905559140013'), ('c1', '905559140014'), ('c2', '905559140015'), ('d1', '905559140016'),
               ('e1', '966559140002'), ('00', '905559140017')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
SELECT pg_temp.u(c), r, g, '+' || p, n, 'tr'
  FROM (VALUES ('a1', 'provider', 'TR', '905559140001', 'Usta A'), ('a2', 'provider', 'TR', '905559140002', 'Usta B'),
               ('a3', 'provider', 'TR', '905559140003', 'Usta C'), ('a4', 'provider', 'TR', '905559140004', 'Usta D'),
               ('a5', 'provider', 'TR', '905559140005', 'Usta E'), ('a6', 'provider', 'TR', '905559140006', 'Usta F'),
               ('a7', 'provider', 'TR', '905559140007', 'Usta G'), ('a8', 'provider', 'TR', '905559140008', 'Usta H'),
               ('a9', 'provider', 'TR', '905559140009', 'Usta I'), ('b1', 'provider', 'KSA', '966559140001', 'Usta K'),
               ('b2', 'provider', 'TR', '905559140011', 'Usta M'), ('b3', 'provider', 'TR', '905559140012', 'Usta P'),
               ('b4', 'provider', 'TR', '905559140013', 'Usta Q'), ('c1', 'customer', 'TR', '905559140014', 'FIXTURE_CUSTOMER'),
               ('c2', 'customer', 'TR', '905559140015', 'Can İki'), ('d1', 'admin', 'TR', '905559140016', 'Admin Bir'),
               ('e1', 'customer', 'KSA', '966559140002', 'Amil')) AS t(c, r, g, p, n);

-- K1 holds S1, S2 (on) and S3 (off). K2 is off, with S4 (on). K9 is KSA, with S9. Z3 is off; Z9 is KSA.
INSERT INTO public.service_categories (id, region, name, display_order, active) VALUES
  ('00000000-0000-0000-0000-00000014c001', 'TR', '{"tr": "Temizlik", "en": "Cleaning"}', 1, true),
  ('00000000-0000-0000-0000-00000014c002', 'TR', '{"tr": "Kapalı kategori"}', 2, false),
  ('00000000-0000-0000-0000-00000014c009', 'KSA', '{"ar": "تنظيف"}', 1, true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) VALUES
  (pg_temp.s(1), '00000000-0000-0000-0000-00000014c001', 'TR', '{"tr": "Ev temizliği", "en": "Home cleaning"}', 3, 5, 1, true),
  (pg_temp.s(2), '00000000-0000-0000-0000-00000014c001', 'TR', '{"tr": "Ofis temizliği"}', 1, 2, 2, true),
  (pg_temp.s(3), '00000000-0000-0000-0000-00000014c001', 'TR', '{"tr": "Kapalı hizmet"}', 1, 2, 3, false),
  (pg_temp.s(4), '00000000-0000-0000-0000-00000014c002', 'TR', '{"tr": "Kapalı kategoride"}', 1, 2, 1, true),
  (pg_temp.s(9), '00000000-0000-0000-0000-00000014c009', 'KSA', '{"ar": "منزل"}', 1, 2, 1, true);
INSERT INTO public.zones (id, region, name, multiplier, display_order, active) VALUES
  (pg_temp.z(1), 'TR', '{"tr": "Kadıköy"}', 1.00, 1, true),
  (pg_temp.z(2), 'TR', '{"tr": "Beşiktaş"}', 1.15, 2, true),
  (pg_temp.z(3), 'TR', '{"tr": "Kapalı semt"}', 1.00, 3, false),
  (pg_temp.z(4), 'TR', '{"tr": "Üsküdar"}', 1.00, 4, true),
  (pg_temp.z(5), 'TR', '{"tr": "Şişli"}', 1.00, 5, true),
  (pg_temp.z(9), 'KSA', '{"ar": "الرياض"}', 1.00, 1, true);
-- A flat formula on S1, so the carry over cases can quote it. S2 has none.
SELECT set_config('pricing.publishing', 'on', true);
INSERT INTO public.pricing_formulas (service_id, region, version, base_price, active) VALUES (pg_temp.s(1), 'TR', 1, 100000, true);
SELECT set_config('pricing.publishing', 'off', true);

-- Standings, as the admin functions leave them.
UPDATE public.providers SET status = 'approved', approved_at = now()
 WHERE id IN (pg_temp.u('a1'), pg_temp.u('a2'), pg_temp.u('a3'), pg_temp.u('a4'), pg_temp.u('a8'), pg_temp.u('a9'),
              pg_temp.u('b1'), pg_temp.u('b2'), pg_temp.u('b3'), pg_temp.u('b4'));
UPDATE public.providers SET status = 'pending', submitted_at = now(), review_reason = 'first_submission' WHERE id = pg_temp.u('a6');
UPDATE public.providers SET status = 'rejected', rejection_code = 'document_unclear' WHERE id = pg_temp.u('a7');
INSERT INTO public.provider_documents (provider_id, region, type, storage_path, object_id, mime_type, size_bytes, status, valid_until)
VALUES (pg_temp.u('a8'), 'TR', 'id_front', 'fixture-14/id-front.jpg', gen_random_uuid(), 'image/jpeg', 1000, 'approved', current_date - 1);

-- Helpers. Each runs as its caller; the grants let them run under the authenticated role.
CREATE FUNCTION pg_temp.as_user(p text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Europe/Istanbul')::date $$;
-- A start: p_days from today, at p_hour, in Istanbul.
CREATE FUNCTION pg_temp.at(p_days integer, p_hour integer) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT ((pg_temp.today() + p_days) + make_interval(hours => p_hour)) AT TIME ZONE 'Europe/Istanbul' $$;
-- The code of a refusal, with the failing field when there is one, or 'none'.
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_detail text;
BEGIN
  EXECUTE p_sql;
  RETURN 'none';
EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN sqlerrm || CASE WHEN v_detail <> '' THEN ':' || v_detail ELSE '' END;
END;
$$;
CREATE FUNCTION pg_temp.save(p_services uuid[], p_zones uuid[], p_days integer[], p_from integer, p_to integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.save_provider_setup(p_services, p_zones, p_days::smallint[], p_from, p_to) $$;
CREATE FUNCTION pg_temp.clean() RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'I can start on Saturday morning with two people.'::text $$;
-- The ids of a feed page, in order.
CREATE FUNCTION pg_temp.ids(p_page jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(x ->> 'id' ORDER BY ord), '{}') FROM jsonb_array_elements(p_page -> 'rows') WITH ORDINALITY AS t(x, ord) $$;
CREATE FUNCTION pg_temp.feed() RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.provider_feed(NULL, NULL, NULL, NULL, NULL, NULL, NULL) $$;
GRANT EXECUTE ON FUNCTION pg_temp.u(text), pg_temp.s(integer), pg_temp.z(integer), pg_temp.r(integer), pg_temp.as_user(text),
  pg_temp.today(), pg_temp.at(integer, integer), pg_temp.err(text), pg_temp.save(uuid[], uuid[], integer[], integer, integer),
  pg_temp.clean(), pg_temp.ids(jsonb), pg_temp.feed() TO authenticated;

-- A setup written straight, as save_provider_setup leaves it.
CREATE FUNCTION pg_temp.setup(p text, p_services uuid[], p_zones uuid[], p_days integer[], p_from integer, p_to integer) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.provider_services (provider_id, service_id, region)
  SELECT pg_temp.u(p), x, (SELECT region FROM public.providers WHERE id = pg_temp.u(p)) FROM unnest(p_services) x;
  INSERT INTO public.provider_zones (provider_id, zone_id, region)
  SELECT pg_temp.u(p), x, (SELECT region FROM public.providers WHERE id = pg_temp.u(p)) FROM unnest(p_zones) x;
  INSERT INTO public.provider_availability (provider_id, region, work_days, start_hour, end_hour)
  VALUES (pg_temp.u(p), (SELECT region FROM public.providers WHERE id = pg_temp.u(p)), p_days::smallint[], p_from, p_to);
$$;
-- A fixture request of c1, written straight: a typed answer, a sneaky string under a date question, notes.
CREATE FUNCTION pg_temp.req(p_id uuid, p_service uuid, p_zone uuid, p_start timestamptz, p_status text DEFAULT 'OPEN') RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, status, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at, notes,
    cancelled_at, cancelled_by)
  VALUES (p_id, 'TR', pg_temp.u('c1'), gen_random_uuid(), p_service, p_zone, p_status,
    '{"rooms": 3, "property_type": "villa", "extras": ["windows", "oven"], "has_pets": true, "visit_date": "2026-12-01",
      "visit_time": "09:30", "details": "FIXTURE_TEXT_ANSWER", "door_code": "FIXTURE_TEXT_SHORT", "sneaky": "FIXTURE_SNEAKY"}',
    '[{"key": "rooms", "type": "number", "label": {"tr": "Oda", "en": "Rooms"}, "options": null, "required": true},
      {"key": "property_type", "type": "single_select", "label": {"tr": "Tip"}, "required": true,
       "options": [{"value": "apartment", "label": {"tr": "Daire"}}, {"value": "villa", "label": {"tr": "Villa", "en": "Villa"}}]},
      {"key": "extras", "type": "multi_select", "label": {"tr": "Ekstralar"}, "required": false,
       "options": [{"value": "oven", "label": {"tr": "Fırın"}}, {"value": "fridge", "label": {"tr": "Buzdolabı"}}, {"value": "windows", "label": {"tr": "Cam"}}]},
      {"key": "has_pets", "type": "boolean", "label": {"tr": "Evcil"}, "options": null, "required": true},
      {"key": "visit_date", "type": "date", "label": {"tr": "Tarih"}, "options": null, "required": false},
      {"key": "visit_time", "type": "time", "label": {"tr": "Saat"}, "options": null, "required": false},
      {"key": "details", "type": "textarea", "label": {"tr": "Ayrıntı"}, "options": null, "required": false},
      {"key": "door_code", "type": "text", "label": {"tr": "Kapı"}, "options": null, "required": false},
      {"key": "sneaky", "type": "date", "label": {"tr": "Sinsi"}, "options": null, "required": false},
      {"key": "skipped", "type": "number", "label": {"tr": "Boş"}, "options": null, "required": false}]',
    '{"service": {"id": "00000000-0000-0000-0000-000000145001", "name": {"tr": "Ev temizliği", "en": "Home cleaning"}, "category_name": {"tr": "Temizlik"}},
      "breakdown": {"base": 120000, "modifiers": [], "unrounded": "350000", "rounding_minor": 100,
                    "addons": [{"id": "00000000-0000-0000-0000-00000014a001", "name": {"tr": "Cam"}, "price": 40000},
                               {"id": "00000000-0000-0000-0000-00000014a002", "name": {"tr": "Fırın"}, "price": 20000}],
                    "zone": {"id": "00000000-0000-0000-0000-000000142001", "name": {"tr": "Kadıköy"}, "multiplier": "1.15"}},
      "rounding_minor": 100, "price": 350000, "currency": "TRY", "commission_percent": "10", "formula_id": null, "formula_version": 1}',
    350000, 35000, 315000, 'TRY', p_start, p_start + interval '5 hours', 'FIXTURE_NOTES',
    CASE WHEN p_status = 'CANCELLED' THEN now() END, CASE WHEN p_status = 'CANCELLED' THEN 'customer' END)
  RETURNING id $$;

-- B works every day but the day of R1 and R3, at any hour; the others work every day.
SELECT pg_temp.setup('a2', ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1), pg_temp.z(2)],
  (SELECT array_agg(d) FROM generate_series(0, 6) d WHERE d <> extract(dow FROM pg_temp.today() + 2)::integer), 0, 24);
SELECT pg_temp.setup('a3', ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(2)], ARRAY[0, 1, 2, 3, 4, 5, 6], 0, 24);
SELECT pg_temp.setup(c, ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[0, 1, 2, 3, 4, 5, 6], 8, 18)
  FROM unnest(ARRAY['a4', 'a5', 'a6', 'a7', 'a8']) c;
SELECT pg_temp.setup('b1', ARRAY[pg_temp.s(9)], ARRAY[pg_temp.z(9)], ARRAY[0, 1, 2, 3, 4, 5, 6], 0, 24);
SELECT pg_temp.setup(c, ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(4)], ARRAY[0, 1, 2, 3, 4, 5, 6], 8, 18) FROM unnest(ARRAY['b2', 'b3']) c;
SELECT pg_temp.setup('b4', ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(5)], ARRAY[0, 1, 2, 3, 4, 5, 6], 0, 24);
UPDATE public.providers SET status = 'suspended', suspension_reason = 'Repeated complaints from customers' WHERE id = pg_temp.u('a4');

-- R1 to R8 at Z1 with S1 unless said: R1 the fixture; R2 late in the evening; R3 at Z2; R4 for S2;
-- R5 cancelled; R6 chosen; R7 started already; R8 for the cap and the cancel.
SELECT pg_temp.req(pg_temp.r(1), pg_temp.s(1), pg_temp.z(1), pg_temp.at(2, 10));
SELECT pg_temp.req(pg_temp.r(2), pg_temp.s(1), pg_temp.z(1), pg_temp.at(3, 20));
SELECT pg_temp.req(pg_temp.r(3), pg_temp.s(1), pg_temp.z(2), pg_temp.at(2, 11));
SELECT pg_temp.req(pg_temp.r(4), pg_temp.s(2), pg_temp.z(1), pg_temp.at(2, 12));
SELECT pg_temp.req(pg_temp.r(5), pg_temp.s(1), pg_temp.z(1), pg_temp.at(2, 13), 'CANCELLED');
SELECT pg_temp.req(pg_temp.r(6), pg_temp.s(1), pg_temp.z(1), pg_temp.at(2, 14), 'SELECTED');
SELECT pg_temp.req(pg_temp.r(7), pg_temp.s(1), pg_temp.z(1), now() - interval '1 hour');
SELECT pg_temp.req(pg_temp.r(8), pg_temp.s(1), pg_temp.z(1), pg_temp.at(4, 10));
INSERT INTO public.request_addresses (request_id, region, customer_id, line) VALUES (pg_temp.r(1), 'TR', pg_temp.u('c1'), 'FIXTURE_ADDRESS 5');
-- D applied to R1 before the suspension.
INSERT INTO public.applications (region, request_id, provider_id, message)
VALUES ('TR', pg_temp.r(1), pg_temp.u('a4'), 'FIXTURE_RIVAL_MESSAGE, I can come on Saturday.');

-- ── schema and settings (AC-1) ───────────────────────────────────────────────
SELECT has_table('public', 'provider_services', 'provider_services exists');
SELECT has_table('public', 'provider_zones', 'provider_zones exists');
SELECT has_table('public', 'provider_availability', 'provider_availability exists');
SELECT has_table('public', 'applications', 'applications exists');
SELECT has_table('public', 'apply_counters', 'apply_counters exists');
SELECT col_is_unique('public', 'providers', ARRAY['id', 'region'], 'providers is unique on (id, region)');
SELECT col_is_unique('public', 'applications', ARRAY['request_id', 'provider_id'], 'one application per request and provider');
SELECT results_eq(
  $$ SELECT region, key, value FROM public.platform_settings
      WHERE key IN ('max_applicants_per_request', 'applications_per_hour') ORDER BY region, key $$,
  $$ VALUES ('KSA', 'applications_per_hour', '20'::jsonb), ('KSA', 'max_applicants_per_request', '10'),
            ('TR', 'applications_per_hour', '20'), ('TR', 'max_applicants_per_request', '10') $$,
  'the two settings are seeded in both regions');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'max_applicants_per_request' $$,
  '23514', NULL, 'a cap of 0 is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '51' WHERE region = 'TR' AND key = 'max_applicants_per_request' $$,
  '23514', NULL, 'a cap of 51 is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '2.5' WHERE region = 'TR' AND key = 'max_applicants_per_request' $$,
  '23514', NULL, 'a cap of 2.5 is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '"10"' WHERE region = 'TR' AND key = 'max_applicants_per_request' $$,
  '23514', NULL, 'a cap written as a string is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'applications_per_hour' $$,
  '23514', NULL, 'an hourly limit of 0 is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '1001' WHERE region = 'TR' AND key = 'applications_per_hour' $$,
  '23514', NULL, 'an hourly limit of 1001 is refused');
SELECT is(public.apply_settings('TR'), '{"max_applicants_per_request": 10, "applications_per_hour": 20}', 'apply_settings reads both');
SELECT throws_ok($$ INSERT INTO public.provider_services (provider_id, service_id, region) VALUES (pg_temp.u('a1'), pg_temp.s(9), 'TR') $$,
  '23503', NULL, 'a TR pick cannot name a KSA service, even as postgres (composite key)');
SELECT throws_ok($$ INSERT INTO public.provider_zones (provider_id, zone_id, region) VALUES (pg_temp.u('a1'), pg_temp.z(9), 'KSA') $$,
  '23503', NULL, 'nor a provider of another region');
SELECT throws_ok($$ INSERT INTO public.applications (region, request_id, provider_id, message)
                    VALUES ('TR', pg_temp.r(1), pg_temp.u('b1'), 'A KSA provider on a TR request.') $$,
  '23503', NULL, 'an application cannot join a provider and a request of two regions');
SELECT throws_ok($$ INSERT INTO public.applications (region, request_id, provider_id, message)
                    VALUES ('TR', pg_temp.r(2), pg_temp.u('a1'), 'too short') $$,
  '23514', NULL, 'a message under 20 code points cannot be stored');
SELECT throws_ok($$ INSERT INTO public.applications (region, request_id, provider_id, message, status)
                    VALUES ('TR', pg_temp.r(2), pg_temp.u('a1'), 'A message long enough to store.', 'PENDING') $$,
  '23514', NULL, 'nor a status off the twelve');
SELECT throws_ok($$ INSERT INTO public.provider_availability (provider_id, region, work_days, start_hour, end_hour)
                    VALUES (pg_temp.u('a9'), 'TR', '{1,1}', 8, 18) $$, '23514', NULL, 'a repeated work day cannot be stored');
SELECT throws_ok($$ INSERT INTO public.provider_availability (provider_id, region, work_days, start_hour, end_hour)
                    VALUES (pg_temp.u('a9'), 'TR', '{7}', 8, 18) $$, '23514', NULL, 'nor a day of 7');
SELECT throws_ok($$ INSERT INTO public.provider_availability (provider_id, region, work_days, start_hour, end_hour)
                    VALUES (pg_temp.u('a9'), 'TR', '{1}', 18, 18) $$, '23514', NULL, 'nor an end hour equal to the start');

-- ── 04 review carry overs (tracker R10) ──────────────────────────────────────
-- B5: the new invisible marks are blank everywhere.
SELECT is_empty(
  $$ SELECT to_hex(cp) FROM unnest(ARRAY[6068, 6069, 6155, 6156, 6157, 65529, 65530, 65531, 78896, 78911, 119155, 119162]) cp
      WHERE public.catalog_trim(chr(cp) || chr(cp)) <> ''
         OR NOT public.pricing_answer_blank(to_jsonb(chr(cp)))
         OR public.catalog_text_ok(jsonb_build_object('tr', chr(cp)), 'TR', 10) $$,
  'B5: Khmer vowels, Mongolian selectors, annotation, musical and Egyptian format marks are blank everywhere');
SELECT is(public.catalog_trim(chr(6155) || 'Moda' || chr(65531)), 'Moda', 'B5: and are trimmed from both ends');
-- B1: a unit changed after the engine read it can round the commission past the price.
UPDATE public.platform_settings SET value = '90' WHERE region = 'TR' AND key = 'commission_percent';
UPDATE public.platform_settings SET value = '1000' WHERE region = 'TR' AND key = 'price_rounding_minor';
SELECT throws_ok($$ SELECT public.pricing_split('TR', 600) $$, 'P0001', 'pricing_settings_invalid',
  'B1: a commission above the price refuses');
SELECT is(public.pricing_split('TR', 2000) - 'commission_percent', '{"commission": 2000, "cash_due": 0}',
  'B1: a commission equal to the price is the edge that stands');
UPDATE public.platform_settings SET value = '10' WHERE region = 'TR' AND key = 'commission_percent';
-- The unit is still 1000 while the engine's quote of S1 says 100000 rounded to 1000: both agree here.
-- A unit the split reads but the quote did not use is refused.
SELECT ok((SELECT prosrc ~ 'v_commission % \(v_quote -> ''breakdown'' ->> ''rounding_minor''\)::bigint <> 0'
             FROM pg_proc WHERE proname = 'create_request'),
  'B1: create_request compares the commission with the quote''s own unit');
UPDATE public.platform_settings SET value = '100' WHERE region = 'TR' AND key = 'price_rounding_minor';
-- A6, B3: never deleted, never truncated, as postgres.
SELECT throws_ok($$ DELETE FROM public.requests WHERE id = pg_temp.r(2) $$, 'P0001', 'request_immutable',
  'A6: a request is never deleted, even as postgres');
SELECT throws_ok($$ TRUNCATE public.requests CASCADE $$, 'P0001', 'request_immutable', 'B3: nor truncated');
SELECT throws_ok($$ TRUNCATE public.request_addresses $$, 'P0001', 'request_address_immutable', 'B3: nor are the addresses');
-- A7: the status move.
SELECT throws_ok($$ UPDATE public.requests SET status = 'SELECTED' WHERE id = pg_temp.r(2) $$,
  'P0001', 'request_transition_invalid', 'A7: OPEN to SELECTED is not a move yet');
SELECT throws_ok($$ UPDATE public.requests SET status = 'COMPLETED' WHERE id = pg_temp.r(6) $$,
  'P0001', 'request_transition_invalid', 'A7: nor SELECTED to COMPLETED');
SELECT throws_ok($$ UPDATE public.requests SET status = 'OPEN', cancelled_at = NULL, cancelled_by = NULL WHERE id = pg_temp.r(5) $$,
  'P0001', 'request_transition_invalid', 'A7: a cancelled request never opens again');
SELECT lives_ok($$ UPDATE public.requests SET status = 'OPEN' WHERE id = pg_temp.r(2) $$, 'A7: an update that keeps the status passes');
-- B4: the commission and the snapshot's unit.
SELECT throws_ok($$ INSERT INTO public.requests (region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
                      pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
                    VALUES ('TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.s(1), pg_temp.z(1), '{}', '[]',
                      '{"rounding_minor": 100}', 350000, 35050, 314950, 'TRY', now() + interval '1 day', now() + interval '2 days') $$,
  '23514', NULL, 'B4: a commission that is not a whole multiple of the snapshot unit is refused');
SELECT throws_ok($$ INSERT INTO public.requests (region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
                      pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
                    VALUES ('TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.s(1), pg_temp.z(1), '{}', '[]',
                      '{}', 350000, 35000, 315000, 'TRY', now() + interval '1 day', now() + interval '2 days') $$,
  '23514', NULL, 'B4: and so is a snapshot with no unit');
-- A8: a region that is switched off.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e1');
SELECT throws_ok($$ SELECT public.request_catalog() $$, 'P0001', 'region_unavailable', 'A8: the catalog refuses a region that is off');
SELECT throws_ok($$ SELECT public.quote_request(pg_temp.s(9), pg_temp.z(9), NULL, '{}') $$, 'P0001', 'region_unavailable', 'A8: so does a quote');
SELECT throws_ok($$ SELECT public.create_request(gen_random_uuid(), pg_temp.s(9), pg_temp.z(9), NULL, '{}', pg_temp.today() + 1, 10,
                      'King Fahd Road 5', NULL, 1, 1) $$, 'P0001', 'region_unavailable', 'A8: and a publish');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.quote_counters WHERE user_id = pg_temp.u('e1')), 0, 'A8: and nothing was counted');
-- A1: a quote the engine refuses comes back as a status, and counts.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c2');
SELECT is(public.quote_request(pg_temp.s(1), pg_temp.z(1), NULL, '{}') ->> 'status', 'ok', 'A1: a good quote still works');
SELECT is(public.quote_request(pg_temp.s(1), pg_temp.z(3), NULL, '{}'), '{"status": "refused", "code": "zone_unavailable"}',
  'A1: an off zone comes back refused');
SELECT is(public.quote_request(pg_temp.s(2), pg_temp.z(1), NULL, '{}'), '{"status": "refused", "code": "service_unavailable"}',
  'A1: a service with no formula comes back refused');
SELECT is(public.quote_request(pg_temp.s(1), pg_temp.z(1), ARRAY[gen_random_uuid()], '{}'), '{"status": "refused", "code": "addon_unavailable"}',
  'A1: an unknown addon comes back refused');
SELECT is(public.create_request(gen_random_uuid(), pg_temp.s(2), pg_temp.z(1), NULL, '{}', pg_temp.today() + 1, 10, 'Moda Cad. No 5', NULL, 1, 1),
  '{"status": "refused", "code": "service_unavailable"}', 'A1: a publish the engine refuses comes back refused too');
RESET ROLE;
SELECT is((SELECT count FROM public.quote_counters WHERE user_id = pg_temp.u('c2')), 5, 'A1: all five counted against the hourly limit');
SELECT is((SELECT count(*)::int FROM public.requests WHERE customer_id = pg_temp.u('c2') AND service_id = pg_temp.s(2) AND created_at = now() AND id <> pg_temp.r(4)), 0,
  'A1: and the refused publish wrote no request');
-- A2: bytes are capped before the trim. Both texts are fine once trimmed.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c2');
SELECT throws_ok($$ SELECT public.create_request(gen_random_uuid(), pg_temp.s(1), pg_temp.z(1), NULL, '{}', pg_temp.today() + 1, 10,
                      'Moda Cad. No 5' || repeat(' ', 5000), NULL, 100000, 10000) $$, 'P0001', 'address_invalid',
  'A2: a street line over 4096 bytes refuses before any trim');
SELECT throws_ok($$ SELECT public.create_request(gen_random_uuid(), pg_temp.s(1), pg_temp.z(1), NULL, '{}', pg_temp.today() + 1, 10,
                      'Moda Cad. No 5', 'temiz olsun' || repeat(' ', 5000), 100000, 10000) $$, 'P0001', 'notes_invalid',
  'A2: so do notes over 4096 bytes');
RESET ROLE;
-- F6: with a lead of 0 days and every hour open, the hour that is running now has already started.
UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key IN ('request_lead_days', 'request_first_hour');
UPDATE public.platform_settings SET value = '23' WHERE region = 'TR' AND key = 'request_last_hour';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c2');
SELECT throws_ok($$ SELECT public.create_request(gen_random_uuid(), pg_temp.s(1), pg_temp.z(1), NULL, '{}', pg_temp.today(),
                      extract(hour FROM now() AT TIME ZONE 'Europe/Istanbul')::integer, 'Moda Cad. No 5', NULL, 100000, 10000) $$,
  'P0001', 'schedule_invalid', 'F6: a start already past is refused with a lead of 0 days');
SELECT is(public.create_request(gen_random_uuid(), pg_temp.s(1), pg_temp.z(5), NULL, '{}', pg_temp.today() + 1,
            extract(hour FROM now() AT TIME ZONE 'Europe/Istanbul')::integer, 'Moda Cad. No 5', NULL, 100000, 10000) ->> 'status',
  'ok', 'F6: the same hour tomorrow is accepted');
RESET ROLE;
UPDATE public.platform_settings SET value = '1' WHERE region = 'TR' AND key = 'request_lead_days';
UPDATE public.platform_settings SET value = '8' WHERE region = 'TR' AND key = 'request_first_hour';
UPDATE public.platform_settings SET value = '18' WHERE region = 'TR' AND key = 'request_last_hour';

-- The general cases below are not about the hourly limit: it gets its own section.
UPDATE public.platform_settings SET value = '1000' WHERE region = 'TR' AND key = 'applications_per_hour';

-- ── setup (AC-3, AC-4) ───────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(public.provider_setup() -> 'complete', 'false', 'before a save the setup is not complete');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(NULL, ARRAY[pg_temp.z(1)], ARRAY[1], 8, 18) $$), 'setup_invalid:services', 'no service list');
SELECT is(pg_temp.err($$ SELECT pg_temp.save('{}', ARRAY[pg_temp.z(1)], ARRAY[1], 8, 18) $$), 'setup_invalid:services', 'an empty service list');
SELECT is(pg_temp.err($$ SELECT pg_temp.save((SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 51)), ARRAY[pg_temp.z(1)], ARRAY[1], 8, 18) $$),
  'setup_invalid:services', '51 services');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1), pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[1], 8, 18) $$), 'setup_invalid:services', 'a service twice');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1), NULL], ARRAY[pg_temp.z(1)], ARRAY[1], 8, 18) $$), 'setup_invalid:services', 'a null service');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(3)], ARRAY[pg_temp.z(1)], ARRAY[1], 8, 18) $$), 'setup_invalid:services', 'a service that is off');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(4)], ARRAY[pg_temp.z(1)], ARRAY[1], 8, 18) $$), 'setup_invalid:services', 'a service whose category is off');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(9)], ARRAY[pg_temp.z(1)], ARRAY[1], 8, 18) $$), 'setup_invalid:services', 'a service of another region');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[gen_random_uuid()], ARRAY[pg_temp.z(1)], ARRAY[1], 8, 18) $$), 'setup_invalid:services', 'an unknown service');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], NULL, ARRAY[1], 8, 18) $$), 'setup_invalid:zones', 'no district list');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], '{}', ARRAY[1], 8, 18) $$), 'setup_invalid:zones', 'an empty district list');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 101)), ARRAY[1], 8, 18) $$),
  'setup_invalid:zones', '101 districts');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1), pg_temp.z(1)], ARRAY[1], 8, 18) $$), 'setup_invalid:zones', 'a district twice');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(3)], ARRAY[1], 8, 18) $$), 'setup_invalid:zones', 'a district that is off');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(9)], ARRAY[1], 8, 18) $$), 'setup_invalid:zones', 'a district of another region');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], NULL, 8, 18) $$), 'setup_invalid:work_days', 'no work days');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], '{}', 8, 18) $$), 'setup_invalid:work_days', 'an empty work day list');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[7], 8, 18) $$), 'setup_invalid:work_days', 'a day of 7');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[-1], 8, 18) $$), 'setup_invalid:work_days', 'a day of -1');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[2, 2], 8, 18) $$), 'setup_invalid:work_days', 'a day twice');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[1, NULL], 8, 18) $$), 'setup_invalid:work_days', 'a null day');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[1], -1, 18) $$), 'setup_invalid:hours', 'a start hour of -1');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[1], 24, 24) $$), 'setup_invalid:hours', 'a start hour of 24');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[1], 8, 25) $$), 'setup_invalid:hours', 'an end hour of 25');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[1], 8, 8) $$), 'setup_invalid:hours', 'an end hour equal to the start');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[1], 9, 8) $$), 'setup_invalid:hours', 'an end hour before the start');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[1], NULL, 18) $$), 'setup_invalid:hours', 'no start hour');
SELECT is((SELECT count(*)::int FROM public.provider_services), 0, 'none of the refused saves stored anything');
SELECT is(pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1), pg_temp.z(2)], ARRAY[6, 0, 3], 0, 24), '{"status": "ok"}', 'a first save, at the edges of the hours');
SELECT is(pg_temp.save(ARRAY[pg_temp.s(1), pg_temp.s(2)], ARRAY[pg_temp.z(1)], ARRAY[6, 5, 4, 3, 2, 1, 0], 8, 18), '{"status": "ok"}', 'a second save replaces the first');
SELECT results_eq($$ SELECT service_id FROM public.provider_services ORDER BY service_id $$,
  $$ VALUES (pg_temp.s(1)), (pg_temp.s(2)) $$, 'the services are the second save''s, and only the caller''s rows are read');
SELECT results_eq($$ SELECT zone_id FROM public.provider_zones $$, $$ VALUES (pg_temp.z(1)) $$, 'the districts too');
SELECT results_eq($$ SELECT work_days, start_hour::int, end_hour::int, region FROM public.provider_availability $$,
  $$ VALUES ('{0,1,2,3,4,5,6}'::smallint[], 8, 18, 'TR') $$, 'one availability row, the days sorted');
CREATE TEMP TABLE setup_a AS SELECT public.provider_setup() AS j;
SELECT is((SELECT array_agg(k ORDER BY k) FROM setup_a, jsonb_object_keys(j) k),
  ARRAY['availability', 'categories', 'complete', 'region', 'timezone', 'zones'], 'provider_setup returns these keys');
SELECT is((SELECT j - 'categories' - 'zones' FROM setup_a),
  '{"region": "TR", "timezone": "Europe/Istanbul", "complete": true, "availability": {"work_days": [0, 1, 2, 3, 4, 5, 6], "start_hour": 8, "end_hour": 18}}',
  'the region, its time zone, the complete flag and the hours');
SELECT is((SELECT jsonb_agg(sv ORDER BY ord) FROM setup_a, jsonb_path_query(j, '$.categories[*].services[*]') WITH ORDINALITY AS q(sv, ord)
            WHERE sv ->> 'id' LIKE '00000000-0000-0000-0000-00000014%'),
  '[{"id": "00000000-0000-0000-0000-000000145001", "name": {"tr": "Ev temizliği", "en": "Home cleaning"}, "note": null, "selected": true, "inactive": false},
    {"id": "00000000-0000-0000-0000-000000145002", "name": {"tr": "Ofis temizliği"}, "note": null, "selected": true, "inactive": false}]',
  'the offered services with the picks; no service that is off, none of an off category');
SELECT is((SELECT jsonb_agg(zn ORDER BY ord) FROM setup_a, jsonb_array_elements(j -> 'zones') WITH ORDINALITY AS q(zn, ord)
            WHERE zn ->> 'id' LIKE '00000000-0000-0000-0000-00000014%'),
  '[{"id": "00000000-0000-0000-0000-000000142001", "name": {"tr": "Kadıköy"}, "selected": true, "inactive": false},
    {"id": "00000000-0000-0000-0000-000000142002", "name": {"tr": "Beşiktaş"}, "selected": false, "inactive": false},
    {"id": "00000000-0000-0000-0000-000000142004", "name": {"tr": "Üsküdar"}, "selected": false, "inactive": false},
    {"id": "00000000-0000-0000-0000-000000142005", "name": {"tr": "Şişli"}, "selected": false, "inactive": false}]',
  'the active districts of the region with the picks; no off district, none of KSA');
SELECT pg_temp.as_user('a6');
SELECT is(pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[1, 2], 9, 17), '{"status": "ok"}', 'a provider under review may save, to be ready on approval');
SELECT pg_temp.as_user('a4');
SELECT throws_ok($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[1], 8, 18) $$, 'P0001', 'provider_suspended', 'a suspended provider cannot save');
SELECT is(public.provider_setup() -> 'complete', 'true', 'but still reads the setup');
SELECT pg_temp.as_user('c1');
SELECT throws_ok($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[1], 8, 18) $$, 'P0001', 'forbidden', 'a customer cannot save a setup');
SELECT throws_ok($$ SELECT public.provider_setup() $$, 'P0001', 'forbidden', 'nor read one');
SELECT pg_temp.as_user('d1');
SELECT throws_ok($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[1], 8, 18) $$, 'P0001', 'forbidden', 'an admin cannot save a setup');
SELECT pg_temp.as_user('00');
SELECT throws_ok($$ SELECT public.provider_setup() $$, 'P0001', 'forbidden', 'no profile: forbidden');
RESET ROLE;

-- ── the feed (AC-5 to AC-7) ──────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
CREATE TEMP TABLE feed_a AS SELECT pg_temp.feed() AS j;
SELECT is((SELECT array_agg(k ORDER BY k) FROM feed_a, jsonb_object_keys(j) k), ARRAY['has_more', 'rows', 'timezone'], 'the feed returns exactly these keys');
SELECT is((SELECT j - 'rows' FROM feed_a), '{"timezone": "Europe/Istanbul", "has_more": false}', 'the region''s time zone, once per page');
SELECT is((SELECT pg_temp.ids(j) FROM feed_a), ARRAY[pg_temp.r(1), pg_temp.r(4), pg_temp.r(8), pg_temp.r(2)]::text[],
  'A: open, future, covered requests; inside hours first, then soonest; no cancelled, chosen, started or uncovered one');
SELECT is((SELECT array_agg(k ORDER BY k) FROM feed_a, jsonb_object_keys(j -> 'rows' -> 0) k),
  ARRAY['addon_names', 'application', 'applied_count', 'cap', 'cash_due', 'currency', 'fixed_price', 'full', 'id', 'outside_hours',
        'scheduled_end_at', 'scheduled_start_at', 'service_id', 'service_name', 'zone_id', 'zone_name'],
  'a feed row has exactly the allowed keys');
SELECT is((SELECT j -> 'rows' -> 0 FROM feed_a),
  jsonb_build_object('id', pg_temp.r(1), 'service_id', pg_temp.s(1), 'zone_id', pg_temp.z(1),
    'service_name', '{"tr": "Ev temizliği", "en": "Home cleaning"}'::jsonb, 'zone_name', '{"tr": "Kadıköy"}'::jsonb,
    'addon_names', '[{"tr": "Cam"}, {"tr": "Fırın"}]'::jsonb, 'scheduled_start_at', pg_temp.at(2, 10),
    'scheduled_end_at', pg_temp.at(2, 15), 'fixed_price', 350000, 'cash_due', 315000, 'currency', 'TRY',
    'applied_count', 1, 'cap', 10, 'full', false, 'outside_hours', false, 'application', NULL),
  'the fixture row: names from the snapshot, addons in order, the price, the cash, one offer of ten');
SELECT ok((SELECT j::text !~* 'FIXTURE|multiplier|modifier|formula|commission|customer|client_key|notes|answers' FROM feed_a),
  'no notes, typed answer, address, customer, rival message, commission or pricing internals in the feed');
SELECT is((SELECT jsonb_agg(x -> 'outside_hours' ORDER BY ord) FROM feed_a, jsonb_array_elements(j -> 'rows') WITH ORDINALITY AS t(x, ord)),
  '[false, false, false, true]', 'the evening request is outside A''s hours, and shown last');
SELECT is(pg_temp.ids(public.provider_feed(ARRAY[pg_temp.s(2)], NULL, NULL, NULL, NULL, NULL, NULL)), ARRAY[pg_temp.r(4)]::text[], 'a service filter narrows');
SELECT is(pg_temp.ids(public.provider_feed(ARRAY[pg_temp.s(3), pg_temp.s(9)], NULL, NULL, NULL, NULL, NULL, NULL)), '{}', 'a service outside the setup returns no row');
SELECT is(pg_temp.ids(public.provider_feed(NULL, ARRAY[pg_temp.z(2)], NULL, NULL, NULL, NULL, NULL)), '{}', 'a district outside the setup returns no row: a filter never widens');
SELECT is(pg_temp.ids(public.provider_feed('{}', NULL, NULL, NULL, NULL, NULL, NULL)), '{}', 'an empty filter list returns no row');
SELECT is(pg_temp.ids(public.provider_feed(NULL, NULL, pg_temp.today() + 3, pg_temp.today() + 4, NULL, NULL, NULL)), ARRAY[pg_temp.r(2)]::text[],
  'a date range in the region''s days, end not included');
SELECT is(pg_temp.ids(public.provider_feed(NULL, NULL, pg_temp.today() + 2, pg_temp.today() + 3, NULL, NULL, NULL)), ARRAY[pg_temp.r(1), pg_temp.r(4)]::text[],
  'the day of the fixture');
SELECT is(pg_temp.ids(public.provider_feed(NULL, NULL, NULL, NULL, false, pg_temp.at(2, 12), pg_temp.r(4))), ARRAY[pg_temp.r(8), pg_temp.r(2)]::text[],
  'a cursor continues after its row');
SELECT pg_temp.as_user('a2');
SELECT is(pg_temp.ids(pg_temp.feed()), ARRAY[pg_temp.r(2), pg_temp.r(8), pg_temp.r(1), pg_temp.r(3)]::text[],
  'B: both districts, no request for the service B did not pick; the day B does not work comes last');
SELECT pg_temp.as_user('a3');
SELECT is(pg_temp.ids(pg_temp.feed()), ARRAY[pg_temp.r(3)]::text[], 'C: only the other district');
SELECT pg_temp.as_user('b1');
SELECT is(pg_temp.feed(), '{"timezone": "Asia/Riyadh", "has_more": false, "rows": []}', 'a KSA provider sees no TR request');
CREATE TEMP TABLE not_approved AS
  SELECT c, (SELECT pg_temp.as_user(c)) AS who, NULL::jsonb AS j FROM unnest(ARRAY['a4', 'a5', 'a6', 'a7', 'a8', 'a9']) c;
RESET ROLE;
CREATE FUNCTION pg_temp.feed_as(p text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(p);
  RETURN pg_temp.feed();
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.feed_as(text) TO authenticated;
SET LOCAL ROLE authenticated;
SELECT is((SELECT jsonb_object_agg(c, jsonb_array_length(pg_temp.feed_as(c) -> 'rows')) FROM unnest(ARRAY['a4', 'a5', 'a6', 'a7', 'a8', 'a9']) c),
  '{"a4": 0, "a5": 0, "a6": 0, "a7": 0, "a8": 0, "a9": 0}',
  'a suspended, draft, pending, rejected or expired document provider, and one with no setup, get an empty feed');
SELECT pg_temp.as_user('c1');
SELECT throws_ok($$ SELECT pg_temp.feed() $$, 'P0001', 'forbidden', 'a customer cannot read the feed');
SELECT pg_temp.as_user('d1');
SELECT throws_ok($$ SELECT pg_temp.feed() $$, 'P0001', 'forbidden', 'nor an admin');

-- ── one request (AC-7, AC-8) ─────────────────────────────────────────────────
SELECT pg_temp.as_user('a1');
CREATE TEMP TABLE one_a AS SELECT public.provider_request(pg_temp.r(1)) AS j;
SELECT is((SELECT array_agg(k ORDER BY k) FROM one_a, jsonb_object_keys(j) k),
  ARRAY['addon_names', 'answers', 'application', 'applied_count', 'cap', 'cash_due', 'closed', 'currency', 'fixed_price', 'full', 'id',
        'outside_hours', 'scheduled_end_at', 'scheduled_start_at', 'service_id', 'service_name', 'timezone', 'zone_id', 'zone_name'],
  'provider_request has exactly the allowed keys');
SELECT is((SELECT j -> 'answers' FROM one_a),
  '[{"key": "rooms", "label": {"tr": "Oda", "en": "Rooms"}, "type": "number", "value": 3, "option_labels": null},
    {"key": "property_type", "label": {"tr": "Tip"}, "type": "single_select", "value": null, "option_labels": [{"tr": "Villa", "en": "Villa"}]},
    {"key": "extras", "label": {"tr": "Ekstralar"}, "type": "multi_select", "value": null, "option_labels": [{"tr": "Fırın"}, {"tr": "Cam"}]},
    {"key": "has_pets", "label": {"tr": "Evcil"}, "type": "boolean", "value": true, "option_labels": null},
    {"key": "visit_date", "label": {"tr": "Tarih"}, "type": "date", "value": "2026-12-01", "option_labels": null},
    {"key": "visit_time", "label": {"tr": "Saat"}, "type": "time", "value": "09:30", "option_labels": null},
    {"key": "sneaky", "label": {"tr": "Sinsi"}, "type": "date", "value": null, "option_labels": null}]',
  'the structured answers in the snapshot''s order; no typed answer, no unanswered question, and a string under a date question stays in');
SELECT ok((SELECT j::text !~* 'FIXTURE|multiplier|modifier|formula|commission|customer|client_key|notes' FROM one_a),
  'no notes, typed answer, address, customer, rival message, commission or pricing internals in the details');
SELECT is((SELECT j - 'answers' FROM one_a), (SELECT (j -> 'rows' -> 0) || '{"closed": false, "timezone": "Europe/Istanbul"}' FROM feed_a),
  'and otherwise the feed row, open, with the time zone');
SELECT is(public.provider_request(pg_temp.r(3)), NULL, 'A: a request in a district A does not cover reads as nothing');
SELECT is(public.provider_request(pg_temp.r(5)), NULL, 'A: a cancelled request A never applied to');
SELECT is(public.provider_request(pg_temp.r(6)), NULL, 'A: a chosen one');
SELECT is(public.provider_request(pg_temp.r(7)), NULL, 'A: a started one');
SELECT is(public.provider_request(gen_random_uuid()), NULL, 'A: an unknown id');
SELECT is(public.provider_request(NULL), NULL, 'A: no id');
SELECT pg_temp.as_user('a2');
SELECT is(public.provider_request(pg_temp.r(4)), NULL, 'B: a request for a service B did not pick');
SELECT is(public.provider_request(pg_temp.r(1)) -> 'outside_hours', 'true', 'B: the fixture, flagged outside B''s days');
SELECT pg_temp.as_user('a3');
SELECT is(public.provider_request(pg_temp.r(1)), NULL, 'C: the fixture is outside C''s setup');
SELECT pg_temp.as_user('b1');
SELECT is(public.provider_request(pg_temp.r(1)), NULL, 'a KSA provider reads no TR request');
SELECT pg_temp.as_user('a9');
SELECT is(public.provider_request(pg_temp.r(1)), NULL, 'an approved provider with no setup reads none');
SELECT pg_temp.as_user('a4');
SELECT is(public.provider_request(pg_temp.r(1)) -> 'application' ->> 'status', 'APPLIED', 'D, suspended, rereads the request D applied to');
SELECT is(public.provider_request(pg_temp.r(2)), NULL, 'but no other');
SELECT pg_temp.as_user('c1');
SELECT throws_ok($$ SELECT public.provider_request(pg_temp.r(1)) $$, 'P0001', 'forbidden', 'a customer cannot call provider_request, even for their own request');

-- ── apply: every refusal (AC-10, AC-23) ──────────────────────────────────────
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(1), pg_temp.clean()) $$, 'P0001', 'forbidden', 'a customer token');
SELECT pg_temp.as_user('d1');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(1), pg_temp.clean()) $$, 'P0001', 'forbidden', 'an admin token');
SELECT pg_temp.as_user('00');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(1), pg_temp.clean()) $$, 'P0001', 'forbidden', 'no profile');
SELECT pg_temp.as_user('a5');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(1), pg_temp.clean()) $$, 'P0001', 'not_approved', 'a draft provider');
SELECT pg_temp.as_user('a6');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(1), pg_temp.clean()) $$, 'P0001', 'not_approved', 'a pending provider');
SELECT pg_temp.as_user('a7');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(1), pg_temp.clean()) $$, 'P0001', 'not_approved', 'a rejected provider');
SELECT pg_temp.as_user('a8');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(1), pg_temp.clean()) $$, 'P0001', 'not_approved', 'a provider with an expired document');
SELECT pg_temp.as_user('a4');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(2), pg_temp.clean()) $$, 'P0001', 'provider_suspended', 'a suspended provider');
SELECT pg_temp.as_user('a9');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(1), pg_temp.clean()) $$, 'P0001', 'setup_incomplete', 'an approved provider with no setup');
SELECT pg_temp.as_user('b1');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(1), pg_temp.clean()) $$, 'P0001', 'not_found', 'a request of another region');
SELECT pg_temp.as_user('a2');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(4), pg_temp.clean()) $$, 'P0001', 'not_found', 'an uncovered service reads as unknown');
SELECT pg_temp.as_user('a1');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(3), pg_temp.clean()) $$, 'P0001', 'not_found', 'an uncovered district reads as unknown');
SELECT throws_ok($$ SELECT public.apply_to_request(gen_random_uuid(), pg_temp.clean()) $$, 'P0001', 'not_found', 'an unknown id');
SELECT throws_ok($$ SELECT public.apply_to_request(NULL, pg_temp.clean()) $$, 'P0001', 'not_found', 'no id');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(5), pg_temp.clean()) $$, 'P0001', 'request_closed', 'a CANCELLED request');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(6), pg_temp.clean()) $$, 'P0001', 'request_closed', 'a SELECTED request');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(7), pg_temp.clean()) $$, 'P0001', 'request_closed', 'a request whose start passed');
RESET ROLE;
SELECT is_empty($$ SELECT 1 FROM public.apply_counters WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001400%' $$,
  'no refusal before step 10 counted an attempt');

-- The message (steps 11 and 12): refused by a returned status, kept out of the table, and counted.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(public.apply_to_request(pg_temp.r(1), NULL), '{"status": "refused", "code": "message_invalid"}', 'no message');
SELECT is(public.apply_to_request(pg_temp.r(1), repeat('a', 19)), '{"status": "refused", "code": "message_invalid"}', '19 code points');
SELECT is(public.apply_to_request(pg_temp.r(1), '   ' || repeat('ş', 19) || chr(160) || chr(8203)), '{"status": "refused", "code": "message_invalid"}',
  '19 code points after the trim');
SELECT is(public.apply_to_request(pg_temp.r(1), repeat('ş', 601)), '{"status": "refused", "code": "message_invalid"}', '601 code points');
SELECT is(public.apply_to_request(pg_temp.r(1), repeat(' ', 30) || repeat(chr(160), 5) || repeat(chr(8203), 5)), '{"status": "refused", "code": "message_invalid"}',
  'only spaces, NBSP and zero width characters');
SELECT is(public.apply_to_request(pg_temp.r(1), pg_temp.clean() || repeat(' ', 9000)), '{"status": "refused", "code": "message_invalid"}',
  'over 8192 bytes, before any trim');
SELECT is(public.apply_to_request(pg_temp.r(1), 'Merhaba, işi yaparım, beni 0555 123 45 67 numarasından arayın lütfen'),
  '{"status": "refused", "code": "contact_info_in_message"}', 'a phone number in the message');
RESET ROLE;
SELECT is((SELECT count FROM public.apply_counters WHERE provider_id = pg_temp.u('a1')), 7, 'each refused message counted one attempt');
SELECT is((SELECT count(*)::int FROM public.applications WHERE provider_id = pg_temp.u('a1')), 0, 'and stored nothing');

-- The happy path, and the replay (D155).
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
CREATE TEMP TABLE app_a AS SELECT public.apply_to_request(pg_temp.r(1), '  ' || pg_temp.clean() || chr(160)) AS j;
SELECT is((SELECT (j - 'application') || jsonb_build_object('status_of', j -> 'application' -> 'status',
                    'keys', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(j -> 'application') k)) FROM app_a),
  '{"status": "ok", "replayed": false, "status_of": "APPLIED", "keys": ["created_at", "id", "status"]}',
  'a clean message applies: ok, not a replay, APPLIED, with id, status and created_at only');
SELECT is(public.apply_to_request(pg_temp.r(1), 'Another message that is long enough.'), (SELECT j || '{"replayed": true}' FROM app_a),
  'a second apply returns the stored application as a replay');
SELECT is(public.apply_to_request(pg_temp.r(1), NULL), (SELECT j || '{"replayed": true}' FROM app_a), 'whatever the message');
SELECT results_eq($$ SELECT message, status, region, request_id FROM public.applications $$,
  $$ VALUES (pg_temp.clean(), 'APPLIED', 'TR', pg_temp.r(1)) $$, 'one row, the first message, trimmed, in the request''s region');
SELECT is(public.provider_request(pg_temp.r(1)) -> 'application', (SELECT j -> 'application' FROM app_a), 'the details now carry the caller''s application');
SELECT is((pg_temp.feed() -> 'rows' -> 0) - 'application', (SELECT (j -> 'rows' -> 0) - 'application' || '{"applied_count": 2}' FROM feed_a),
  'and the feed row counts two offers');
RESET ROLE;
SELECT is((SELECT count FROM public.apply_counters WHERE provider_id = pg_temp.u('a1')), 8, 'the apply counted one attempt; the replays counted nothing');

-- The cap (steps 8 and 9) and a setting that is missing.
UPDATE public.platform_settings SET value = '2' WHERE region = 'TR' AND key = 'max_applicants_per_request';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(1), pg_temp.clean()) $$, 'P0001', 'request_full', 'a request at the cap refuses');
SELECT is((SELECT x - 'id' FROM jsonb_array_elements(pg_temp.feed() -> 'rows') x WHERE x ->> 'id' = pg_temp.r(1)::text) -> 'full', 'true',
  'and stays in the feed, flagged full');
SELECT pg_temp.as_user('a1');
SELECT is(public.apply_to_request(pg_temp.r(1), pg_temp.clean()) ->> 'replayed', 'true', 'a replay still answers on a full request');
RESET ROLE;
DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'max_applicants_per_request';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(1), pg_temp.clean()) $$, 'P0001', 'apply_settings_invalid', 'a missing cap refuses the apply, never a default');
SELECT throws_ok($$ SELECT pg_temp.feed() $$, 'P0001', 'apply_settings_invalid', 'and the feed');
SELECT throws_ok($$ SELECT public.provider_request(pg_temp.r(1)) $$, 'P0001', 'apply_settings_invalid', 'and the details');
SELECT throws_ok($$ SELECT public.provider_home_counts() $$, 'P0001', 'apply_settings_invalid', 'and the home counts');
RESET ROLE;
INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', 'max_applicants_per_request', '10');
DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'applications_per_hour';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(1), pg_temp.clean()) $$, 'P0001', 'apply_settings_invalid', 'a missing hourly limit refuses too');
RESET ROLE;
INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', 'applications_per_hour', '1000');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT is(public.apply_to_request(pg_temp.r(1), 'B: I have my own tools and I can start at ten.') ->> 'status', 'ok', 'with the cap back at ten, B applies');
SELECT is(public.apply_to_request(pg_temp.r(8), 'B: I can also take this one next week.') ->> 'status', 'ok', 'and to R8');

-- ── a rival's rows (AC-18, AC-23) ────────────────────────────────────────────
SELECT results_eq($$ SELECT provider_id FROM public.applications $$, $$ VALUES (pg_temp.u('a2')), (pg_temp.u('a2')) $$, 'B reads only B''s applications');
SELECT is_empty($$ SELECT id FROM public.applications WHERE provider_id <> pg_temp.u('a2') $$, 'no row of A or D');
SELECT ok(public.provider_request(pg_temp.r(1))::text !~ 'RIVAL|Saturday morning', 'and nothing of a rival''s message in the details');
SELECT is(public.provider_request(pg_temp.r(1)) -> 'applied_count', '3', 'only the count: three offers');
SELECT is_empty($$ SELECT id FROM public.requests $$, 'a provider token still reads no request row directly');
SELECT is_empty($$ SELECT request_id FROM public.request_addresses $$, 'nor any address');
SELECT is_empty($$ SELECT provider_id FROM public.provider_services WHERE provider_id <> pg_temp.u('a2') $$, 'nor another provider''s services');
SELECT is_empty($$ SELECT provider_id FROM public.provider_zones WHERE provider_id <> pg_temp.u('a2') $$, 'nor districts');
SELECT is_empty($$ SELECT provider_id FROM public.provider_availability WHERE provider_id <> pg_temp.u('a2') $$, 'nor hours');
SELECT is_empty($$ SELECT provider_id FROM public.apply_counters $$, 'nor any counter, not even their own');
SELECT throws_ok($$ INSERT INTO public.applications (region, request_id, provider_id, message)
                    VALUES ('TR', pg_temp.r(2), pg_temp.u('a2'), 'A direct insert past the function.') $$, '42501', NULL,
  'a provider token cannot insert an application directly');
SELECT throws_ok($$ UPDATE public.applications SET status = 'SELECTED' $$, '42501', NULL, 'nor update one');
SELECT throws_ok($$ DELETE FROM public.applications $$, '42501', NULL, 'nor delete one');
SELECT throws_ok($$ INSERT INTO public.provider_services (provider_id, service_id, region) VALUES (pg_temp.u('a2'), pg_temp.s(2), 'TR') $$, '42501', NULL,
  'nor write a pick past the function');
SELECT throws_ok($$ UPDATE public.provider_availability SET end_hour = 23 $$, '42501', NULL, 'nor the hours');
SELECT throws_ok($$ UPDATE public.apply_counters SET count = 1 $$, '42501', NULL, 'nor a counter');
SELECT throws_ok($$ SELECT public.has_contact_info('0555 123 45 67') $$, '42501', NULL, 'nobody probes the scanner through the API');
SELECT throws_ok($$ SELECT public.count_application(pg_temp.u('a1'), 'TR', 1) $$, '42501', NULL, 'nor counts an attempt for someone else');
SELECT pg_temp.as_user('c1');
SELECT is_empty($$ SELECT id FROM public.applications $$, 'a customer reads no application, not even on their own request');
SELECT is_empty($$ SELECT provider_id FROM public.provider_services $$, 'nor any pick');
SELECT is_empty($$ SELECT provider_id FROM public.provider_zones $$, 'nor any district');
SELECT is_empty($$ SELECT provider_id FROM public.provider_availability $$, 'nor any hours');
SELECT pg_temp.as_user('d1');
SELECT is((SELECT count(*)::int FROM public.applications WHERE request_id = pg_temp.r(1)), 3, 'an admin reads every application');
SELECT isnt_empty($$ SELECT 1 FROM public.provider_services WHERE provider_id = pg_temp.u('a1') $$, 'and the picks');
SELECT isnt_empty($$ SELECT 1 FROM public.provider_zones WHERE provider_id = pg_temp.u('a1') $$, 'and the districts');
SELECT isnt_empty($$ SELECT 1 FROM public.provider_availability WHERE provider_id = pg_temp.u('a1') $$, 'and the hours');
SELECT isnt_empty($$ SELECT 1 FROM public.apply_counters WHERE provider_id = pg_temp.u('a1') $$, 'and the counters');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT id FROM public.applications $$, '42501', NULL, 'anon cannot read applications');
SELECT throws_ok($$ SELECT provider_id FROM public.provider_services $$, '42501', NULL, 'nor picks');
SELECT throws_ok($$ SELECT provider_id FROM public.apply_counters $$, '42501', NULL, 'nor counters');
RESET ROLE;
SELECT is_empty(
  $$ SELECT t || ':' || r FROM unnest(ARRAY['provider_services', 'provider_zones', 'provider_availability', 'applications', 'apply_counters']) t,
            unnest(ARRAY['anon', 'authenticated', 'service_role']) r
      WHERE has_table_privilege(r, 'public.' || t, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         OR (r <> 'authenticated' AND has_table_privilege(r, 'public.' || t, 'SELECT')) $$,
  'no API role writes any of the five tables; only signed in users read, through the policies');
SELECT table_privs_are('public', 'applications', 'authenticated', ARRAY['SELECT'], 'signed in users only read applications');
SELECT table_privs_are('public', 'applications', 'service_role', ARRAY[]::text[], 'service_role holds nothing on applications');
SELECT policy_cmd_is('public', 'applications', 'applications_insert_own', 'insert', 'the insert policy stays as defence in depth');
SELECT ok((SELECT with_check ~ 'provider_can_apply' AND with_check ~ 'provider_id' FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'applications' AND policyname = 'applications_insert_own'),
  'and checks the caller and provider_can_apply');
SELECT policies_are('public', 'applications', ARRAY['applications_read_own', 'applications_read_admin', 'applications_insert_own'],
  'applications has these three policies and no other');
SELECT policies_are('public', 'apply_counters', ARRAY['apply_counters_read_admin'], 'apply_counters is read by an admin only');

-- ── function grants (AC-19) ──────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND p.proname IN ('apply_settings', 'provider_setup', 'save_provider_setup', 'provider_feed', 'provider_request', 'apply_to_request',
                          'count_application', 'provider_applications', 'provider_home_counts', 'cancel_request', 'applications_guard',
                          'work_days_ok', 'provider_reader', 'provider_setup_complete', 'provider_outside_hours', 'provider_short_details',
                          'provider_structured_answers', 'requests_delete_guard') $$,
  $$ VALUES ('provider_setup()'), ('save_provider_setup(uuid[],uuid[],smallint[],integer,integer)'),
            ('provider_feed(uuid[],uuid[],date,date,boolean,timestamp with time zone,uuid)'), ('provider_request(uuid)'),
            ('apply_to_request(uuid,text)'), ('provider_applications(timestamp with time zone,uuid)'), ('provider_home_counts()'),
            ('cancel_request(uuid,text)') $$,
  'a signed in user runs the eight functions of the spec and none of the internal ones');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE'))
        AND p.proname IN ('apply_settings', 'provider_setup', 'save_provider_setup', 'provider_feed', 'provider_request', 'apply_to_request',
                          'count_application', 'provider_applications', 'provider_home_counts', 'cancel_request', 'applications_guard',
                          'work_days_ok', 'provider_reader', 'provider_setup_complete', 'provider_outside_hours', 'provider_short_details',
                          'provider_structured_answers', 'requests_delete_guard', 'has_contact_info') $$,
  'anon and service_role run none of them, nor the scanner');
SELECT is_empty(
  $$ SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND p.proname LIKE ANY (ARRAY['provider_setup', 'save_provider_setup', 'provider_feed', 'provider_request', 'apply_to_request',
                                      'provider_applications', 'provider_home_counts'])
        AND pg_get_function_arguments(p.oid) ~ 'provider_id' $$,
  'no function a signed in user can run takes a provider id: identity comes from the token');
SELECT ok((SELECT prosrc !~* 'raise[^;]*(p_message|v_message)' FROM pg_proc WHERE proname = 'apply_to_request'),
  'no raise in apply_to_request carries the message');

-- ── cancel (AC-16) ───────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(public.apply_to_request(pg_temp.r(8), pg_temp.clean()) ->> 'status', 'ok', 'A applies to R8 as well');
SELECT pg_temp.as_user('c1');
SELECT is(public.cancel_request(pg_temp.r(8), 'plans_changed'), '{"status": "ok"}', 'the customer cancels R8');
RESET ROLE;
SELECT results_eq($$ SELECT status, status_changed_at = now() FROM public.applications WHERE request_id = pg_temp.r(8) ORDER BY provider_id $$,
  $$ VALUES ('CANCELLED', true), ('CANCELLED', true) $$, 'both APPLIED applications of R8 are CANCELLED in the same transaction');
SELECT is((SELECT count(*)::int FROM public.applications WHERE request_id = pg_temp.r(1) AND status = 'APPLIED'), 3, 'no other request''s application moved');
SELECT is_empty($$ SELECT 1 FROM public.applications a JOIN public.requests r ON r.id = a.request_id WHERE r.status = 'CANCELLED' AND a.status = 'APPLIED' $$,
  'a CANCELLED request holds no APPLIED application');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a3');
SELECT pg_temp.as_user('a1');
SELECT is(public.provider_request(pg_temp.r(8)) - 'answers' - 'applied_count' - 'cap' - 'full' - 'outside_hours' - 'addon_names' - 'service_name' - 'zone_name'
            - 'scheduled_start_at' - 'scheduled_end_at' - 'fixed_price' - 'cash_due' - 'currency' - 'service_id' - 'zone_id' - 'timezone' #- '{application,id}' #- '{application,created_at}',
  jsonb_build_object('id', pg_temp.r(8), 'closed', true, 'application', '{"status": "CANCELLED"}'::jsonb),
  'A rereads the cancelled request: closed, the application CANCELLED');
SELECT is(public.apply_to_request(pg_temp.r(8), pg_temp.clean()) #>> '{application,status}', 'CANCELLED', 'a replay shows the final status');
SELECT ok(NOT (pg_temp.ids(pg_temp.feed()) @> ARRAY[pg_temp.r(8)::text]), 'and R8 left the feed');
RESET ROLE;
-- A provider who had not applied meets request_closed after the cancel.
SELECT pg_temp.setup('a9', ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[0, 1, 2, 3, 4, 5, 6], 0, 24);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a9');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(8), pg_temp.clean()) $$, 'P0001', 'request_closed', 'an apply after a cancel refuses request_closed');
RESET ROLE;

-- ── the applications guard (AC-17) ───────────────────────────────────────────
SELECT throws_ok($$ DELETE FROM public.applications WHERE request_id = pg_temp.r(1) $$, 'P0001', 'application_immutable', 'an application is never deleted, even as postgres');
SELECT throws_ok($$ TRUNCATE public.applications $$, 'P0001', 'application_immutable', 'nor truncated');
SELECT throws_ok($$ UPDATE public.applications SET message = 'Another message, long enough to pass.' WHERE request_id = pg_temp.r(1) $$,
  'P0001', 'application_immutable', 'its message never changes');
SELECT throws_ok($$ UPDATE public.applications SET provider_id = pg_temp.u('a3') WHERE request_id = pg_temp.r(1) AND provider_id = pg_temp.u('a1') $$,
  'P0001', 'application_immutable', 'nor its provider');
SELECT throws_ok($$ UPDATE public.applications SET request_id = pg_temp.r(2) WHERE request_id = pg_temp.r(1) AND provider_id = pg_temp.u('a1') $$,
  'P0001', 'application_immutable', 'nor its request');
SELECT throws_ok($$ UPDATE public.applications SET created_at = now() - interval '1 day' WHERE request_id = pg_temp.r(1) $$,
  'P0001', 'application_immutable', 'nor its creation time');
SELECT throws_ok($$ UPDATE public.applications SET id = gen_random_uuid() WHERE request_id = pg_temp.r(1) $$,
  'P0001', 'application_immutable', 'nor its id');
SELECT throws_ok($$ UPDATE public.applications SET status = 'APPLIED' WHERE request_id = pg_temp.r(8) $$,
  'P0001', 'application_final', 'a CANCELLED application never moves again');
SELECT lives_ok($$ UPDATE public.applications SET status = 'NOT_SELECTED', status_changed_at = now() WHERE request_id = pg_temp.r(1) AND provider_id = pg_temp.u('a4') $$,
  'a later position may move an APPLIED application');
SELECT is((SELECT string_agg(st, ',' ORDER BY st) FROM unnest(ARRAY['NOT_SELECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED', 'CONFIRMED', 'RATED']) st
            WHERE (SELECT prosrc FROM pg_proc WHERE proname = 'applications_guard') ~ ('''' || st || '''')),
  'CANCELLED,CONFIRMED,EXPIRED,NOT_SELECTED,RATED,WITHDRAWN', 'the six final statuses are the guard''s list');

-- ── a service admin turns off (AC-3 to AC-5, AC-23) ──────────────────────────
-- I picks S2 only, then admin turns S2 off: I's setup is not complete any more, A keeps seeing R4.
DELETE FROM public.provider_services WHERE provider_id = pg_temp.u('a9');
INSERT INTO public.provider_services (provider_id, service_id, region) VALUES (pg_temp.u('a9'), pg_temp.s(2), 'TR');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a9');
SELECT is(pg_temp.ids(pg_temp.feed()), ARRAY[pg_temp.r(4)]::text[], 'I, who picked S2, sees the S2 request');
RESET ROLE;
UPDATE public.services SET active = false WHERE id = pg_temp.s(2);
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.ids(pg_temp.feed()), '{}', 'with S2 off, a provider whose picks are all inactive gets an empty feed');
SELECT throws_ok($$ SELECT public.apply_to_request(pg_temp.r(4), pg_temp.clean()) $$, 'P0001', 'setup_incomplete', 'and cannot apply');
SELECT is(public.provider_setup() -> 'complete', 'false', 'the setup reads not complete');
SELECT pg_temp.as_user('a1');
SELECT ok(pg_temp.ids(pg_temp.feed()) @> ARRAY[pg_temp.r(4)::text], 'A, who also has S1, still sees the request for the service that was turned off');
SELECT is((SELECT sv - 'name' - 'note' FROM jsonb_path_query(public.provider_setup(), '$.categories[*].services[*]') sv WHERE sv ->> 'id' = pg_temp.s(2)::text),
  jsonb_build_object('id', pg_temp.s(2), 'selected', true, 'inactive', true), 'A''s stored pick is listed as no longer offered');
SELECT is(pg_temp.err($$ SELECT pg_temp.save(ARRAY[pg_temp.s(1), pg_temp.s(2)], ARRAY[pg_temp.z(1)], ARRAY[0, 1, 2, 3, 4, 5, 6], 8, 18) $$),
  'setup_invalid:services', 'sending the inactive pick again is refused');
SELECT is(public.apply_to_request(pg_temp.r(4), 'A: I still cover this service for old requests.') ->> 'status', 'ok', 'A may still apply to the request posted before');
SELECT is(pg_temp.save(ARRAY[pg_temp.s(1)], ARRAY[pg_temp.z(1)], ARRAY[0, 1, 2, 3, 4, 5, 6], 8, 18), '{"status": "ok"}', 'the next save drops it');
SELECT ok(NOT (pg_temp.ids(pg_temp.feed()) @> ARRAY[pg_temp.r(4)::text]), 'and the S2 request leaves A''s feed');
SELECT is(public.provider_request(pg_temp.r(4)) -> 'application' ->> 'status', 'APPLIED', 'but A still rereads it, having applied');
RESET ROLE;

-- ── paging across the divider (AC-5, AC-23) ──────────────────────────────────
-- 25 requests at Z4: 15 inside P's hours, 10 late in the evening.
CREATE TEMP TABLE many AS
  SELECT g, pg_temp.req(gen_random_uuid(), pg_temp.s(1), pg_temp.z(4),
                        pg_temp.at(1 + g / 5, CASE WHEN g % 5 < 3 THEN 9 + g % 5 ELSE 19 + g % 5 END)) AS id
    FROM generate_series(0, 24) g;
GRANT SELECT ON many TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b3');
CREATE TEMP TABLE page1 AS SELECT pg_temp.feed() AS j;
CREATE TEMP TABLE page2 AS
  SELECT public.provider_feed(NULL, NULL, NULL, NULL, (l ->> 'outside_hours')::boolean, (l ->> 'scheduled_start_at')::timestamptz, (l ->> 'id')::uuid) AS j
    FROM (SELECT j -> 'rows' -> 19 AS l FROM page1) x;
SELECT is((SELECT jsonb_build_object('rows', jsonb_array_length(j -> 'rows'), 'has_more', j -> 'has_more') FROM page1), '{"rows": 20, "has_more": true}', 'the first page holds 20 rows and says there are more');
SELECT is((SELECT jsonb_build_object('rows', jsonb_array_length(j -> 'rows'), 'has_more', j -> 'has_more') FROM page2), '{"rows": 5, "has_more": false}', 'the second holds the last 5');
SELECT is((SELECT pg_temp.ids(j) FROM page1) || (SELECT pg_temp.ids(j) FROM page2),
  (SELECT array_agg(m.id::text ORDER BY (m.g % 5 >= 3), pg_temp.at(1 + m.g / 5, CASE WHEN m.g % 5 < 3 THEN 9 + m.g % 5 ELSE 19 + m.g % 5 END)) FROM many m),
  'the two pages list all 25 once, inside hours first, across the divider');
SELECT is((SELECT count(*)::int FROM page1, jsonb_array_elements(j -> 'rows') x WHERE (x ->> 'outside_hours')::boolean), 5, 'the divider falls inside the first page');

-- ── the hourly limit (AC-10 step 10, AC-23) ──────────────────────────────────
RESET ROLE;
UPDATE public.platform_settings SET value = '20' WHERE region = 'TR' AND key = 'applications_per_hour';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b2');
SELECT is((SELECT count(*)::int FROM many m WHERE m.g < 19 AND public.apply_to_request(m.id, pg_temp.clean()) ->> 'status' = 'ok'), 19, '19 applications in an hour work');
SELECT is((SELECT public.apply_to_request(m.id, '0555 123 45 67 numarasından beni arayın') ->> 'code' FROM many m WHERE m.g = 19), 'contact_info_in_message',
  'the 20th attempt is a refused message');
SELECT is(pg_temp.err(format('SELECT public.apply_to_request(%L, pg_temp.clean())', (SELECT m.id FROM many m WHERE m.g = 19))), 'too_many_applications',
  'so the 21st attempt refuses: a refused message still counted');
SELECT is((SELECT public.apply_to_request(m.id, NULL) ->> 'replayed' FROM many m WHERE m.g = 0), 'true', 'a replay still answers past the limit');
RESET ROLE;
SELECT is((SELECT count FROM public.apply_counters WHERE provider_id = pg_temp.u('b2')), 20, 'the counter stops at the limit');
UPDATE public.apply_counters SET window_start = window_start - interval '1 hour' WHERE provider_id = pg_temp.u('b2');
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.apply_to_request(m.id, pg_temp.clean()) ->> 'status' FROM many m WHERE m.g = 19), 'ok', 'the first attempt after the window works');
SELECT is((SELECT public.apply_to_request(m.id, pg_temp.clean()) ->> 'status' FROM many m WHERE m.g = 20), 'ok', 'and the next');
RESET ROLE;
SELECT is((SELECT count FROM public.apply_counters WHERE provider_id = pg_temp.u('b2')), 2, 'in a new window, counted from 1');

-- ── my applications (AC-13) ──────────────────────────────────────────────────
-- Spread M's 21 applications over 21 seconds, so the order is theirs alone.
ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
UPDATE public.applications a SET created_at = now() - make_interval(secs => m.g)
  FROM many m WHERE a.request_id = m.id AND a.provider_id = pg_temp.u('b2');
ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b2');
CREATE TEMP TABLE apps1 AS SELECT public.provider_applications(NULL, NULL) AS j;
CREATE TEMP TABLE apps2 AS
  SELECT public.provider_applications((l #>> '{application,created_at}')::timestamptz, (l #>> '{application,id}')::uuid) AS j
    FROM (SELECT j -> 'rows' -> 19 AS l FROM apps1) x;
SELECT is((SELECT array_agg(k ORDER BY k) FROM apps1, jsonb_object_keys(j) k), ARRAY['has_more', 'rows', 'timezone'], 'the list returns exactly these keys');
SELECT is((SELECT array_agg(k ORDER BY k) FROM apps1, jsonb_object_keys(j -> 'rows' -> 0) k),
  ARRAY['addon_names', 'application', 'cash_due', 'currency', 'fixed_price', 'id', 'scheduled_end_at', 'scheduled_start_at', 'service_id',
        'service_name', 'zone_id', 'zone_name'], 'a list row has the short details and the application, no message');
SELECT is((SELECT pg_temp.ids(j) FROM apps1) || (SELECT pg_temp.ids(j) FROM apps2), (SELECT array_agg(m.id::text ORDER BY m.g) FROM many m WHERE m.g <= 20),
  'newest first, 20 a page, the 21st on the second page, none twice');
SELECT is((SELECT jsonb_build_object('one', j -> 'has_more') FROM apps1) || (SELECT jsonb_build_object('two', j -> 'has_more') FROM apps2),
  '{"one": true, "two": false}', 'has_more on the first page only');
SELECT ok((SELECT j::text !~* 'FIXTURE|Saturday|message|customer|notes|commission' FROM apps1), 'no message, notes or customer in the list');
SELECT pg_temp.as_user('a3');
SELECT is(public.provider_applications(NULL, NULL), '{"timezone": "Europe/Istanbul", "has_more": false, "rows": []}', 'a provider with no application gets an empty list');
SELECT pg_temp.as_user('a4');
SELECT is(public.provider_applications(NULL, NULL) #>> '{rows,0,application,status}', 'NOT_SELECTED', 'a suspended provider still lists theirs, with its status');
SELECT pg_temp.as_user('c1');
SELECT throws_ok($$ SELECT public.provider_applications(NULL, NULL) $$, 'P0001', 'forbidden', 'a customer cannot list applications');

-- ── the home counts (AC-14) ──────────────────────────────────────────────────
SELECT throws_ok($$ SELECT public.provider_home_counts() $$, 'P0001', 'forbidden', 'nor read the home counts');
SELECT pg_temp.as_user('a1');
SELECT is(public.provider_home_counts(), '{"setup_complete": true, "open_requests": 2, "applied": 2}',
  'A: two open requests in the feed (R1, R2), two APPLIED applications (R1, R4); the cancelled one does not count');
SELECT pg_temp.as_user('a9');
SELECT is(public.provider_home_counts(), '{"setup_complete": false, "open_requests": 0, "applied": 0}', 'I: no complete setup, nothing counted');
SELECT pg_temp.as_user('a4');
SELECT is(public.provider_home_counts(), '{"setup_complete": true, "open_requests": 0, "applied": 0}', 'D, suspended: no open request counted');
RESET ROLE;
UPDATE public.platform_settings SET value = '2' WHERE region = 'TR' AND key = 'max_applicants_per_request';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(public.provider_home_counts() -> 'open_requests', '1', 'a full request (R1, two offers at a cap of two) is not counted as open');
RESET ROLE;
UPDATE public.platform_settings SET value = '10' WHERE region = 'TR' AND key = 'max_applicants_per_request';

-- ── the scanner corpus through apply_to_request (AC-10, AC-23, verify.md) ────
UPDATE public.platform_settings SET value = '1000' WHERE region = 'TR' AND key = 'applications_per_hour';
SELECT pg_temp.req(pg_temp.r(50), pg_temp.s(1), pg_temp.z(5), pg_temp.at(5, 10));
CREATE TEMP TABLE must_catch (t text);
INSERT INTO must_catch VALUES
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
  ('واتساب'), ('وتساب'), ('تلجرام'), ('تيليجرام'), ('انستقرام'), ('انستا'),
  ('0555 - 123 - 45 - 67'), ('0555   123   4567'), ('0555 x 123 x 4567'), ('0555 / 123 / 4567'),
  ('0 5 5 5 - 1 2 3 - 4 5 6 7'),
  ('Merhaba, işi yaparım, beni 0555 123 45 67 numarasından arayın lütfen'),
  ('أستطيع البدء يوم السبت، اتصل على ٠٥٥٥١٢٣٤٥٦٧ للتفاصيل'),
  ('call me on five five five 123 45 67 tomorrow'),
  (E'I can start Saturday.\n0555\n123 4567'),
  ('send photos to ali at example dot com and I will reply'),
  ('see my work on @ali_temizlik before you choose'),
  ('fotoğrafları whatsapp''tan atarım, iş kolay'),
  ('أرسل لك الصور على واتساب قبل البدء بالعمل');
CREATE TEMP TABLE must_pass (n integer GENERATED ALWAYS AS IDENTITY, t text, id uuid);
INSERT INTO must_pass (t) VALUES
  ('6 years of experience in homes and villas'), ('since 2019'), ('5 rooms and 2 bathrooms'),
  ('3 bedrooms, 2 bathrooms, 1 kitchen'), ('I work Monday to Friday, 9 to 5.'),
  ('Marble, parquet and glass: safe for children and pets.'),
  ('10 yıldır temizlik yapıyorum'), ('2019''dan beri evlerde çalışıyorum'), ('bir iki saatte biter'),
  ('Mutfak, banyo ve cam temizliği yaparım.'),
  ('خبرة 6 سنوات في تنظيف المنازل والفلل'), ('بدأت العمل عام 2019'), ('أعمل من 9 إلى 5'),
  ('9 to 5, 10 years since 2015'), ('3 bedrooms, 2 bathrooms, 1 kitchen, 6 years since 2019'),
  ('I can start at 13:00 on Saturday and finish in about 7 hours with two people.'),
  ('I have cleaned 40 villas after renovation, I bring all tools and safe products.'),
  ('Cumartesi 13:00''te başlayabilirim, iki kişiyle yaklaşık 7 saatte biter.'),
  ('Tadilat sonrası temizlikte 8 yıllık deneyimim var, malzemeleri ben getiririm.'),
  ('أستطيع البدء السبت الساعة 1 ظهرا مع فريق من شخصين، والعمل يستغرق 7 ساعات تقريبا.'),
  ('خبرة 8 سنوات في تنظيف الفلل بعد التشطيب، وأحضر أدواتي ومنظفاتي.'),
  (repeat('ş', 600)), ('exactly twenty chars');
UPDATE must_pass SET id = pg_temp.req(gen_random_uuid(), pg_temp.s(1), pg_temp.z(5), pg_temp.at(6, 8) + make_interval(mins => n));
GRANT SELECT ON must_catch, must_pass TO authenticated;
-- A row shorter than 20 code points is padded with words that carry no digit, as verify.md says.
CREATE FUNCTION pg_temp.padded(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN char_length(p) >= 20 THEN p ELSE 'Merhaba, temiz iş: ' || p END $$;
GRANT EXECUTE ON FUNCTION pg_temp.padded(text) TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b4');
SELECT is_empty($$ SELECT t FROM must_catch WHERE public.apply_to_request(pg_temp.r(50), pg_temp.padded(t)) IS DISTINCT FROM
                     '{"status": "refused", "code": "contact_info_in_message"}'::jsonb $$,
  'every must catch row of the corpus is refused through apply_to_request');
SELECT is_empty($$ SELECT t FROM must_pass WHERE public.apply_to_request(id, pg_temp.padded(t)) ->> 'status' IS DISTINCT FROM 'ok' $$,
  'every must pass row applies, a message of exactly 20 and one of 600 code points included');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.applications WHERE provider_id = pg_temp.u('b4')), (SELECT count(*)::int FROM must_pass),
  'one application per must pass row, none for a must catch row');
SELECT is((SELECT count FROM public.apply_counters WHERE provider_id = pg_temp.u('b4')), (SELECT count(*)::int FROM must_catch) + (SELECT count(*)::int FROM must_pass),
  'and every attempt of the corpus was counted');
SELECT is_empty($$ SELECT 1 FROM public.audit_log WHERE created_at = now() AND (old_value::text || new_value::text) ~* 'Saturday|FIXTURE|temiz iş' $$,
  'no message, note or answer reached the audit log');

SELECT * FROM finish();
ROLLBACK;
