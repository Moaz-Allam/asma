-- Position 20b, spec 0011-20b (D225, D229): structured addresses and a map pin.
--
-- The zone's il and ilçe and their guard (AC-1); compose_address (Address composition, X-16); address_parse, each rule
-- and the scanner (AC-3, X-2, X-8, X-9); create_request storing the parts, il and ilçe frozen from the zone, the line
-- composed (AC-2, AC-3); provider_addresses with RLS, no API grant and its guards, save and read, the audit row (AC-5,
-- X-11, X-23); the reveal for each party, a stranger, the other applicant and a suspended provider (AC-6, rule 2);
-- admin's two audited reads (AC-7); the agreement content and draft-2 active (AC-8); a row before 20b (AC-9).
-- address_required at submit is in 07, at apply in 14.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(96);

SET CONSTRAINTS ALL IMMEDIATE;

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000004500' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000004570' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.app(p integer, w text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-00000045' || CASE w WHEN 'a1' THEN '81' ELSE '82' END
          || lpad(p::text, 2, '0'))::uuid $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1 the customer, c2 a stranger, a1 the chosen provider (with an address), a2 another applicant, ad an admin.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559450001'), ('c2', '905559450002'), ('a1', '905559450003'), ('a2', '905559450004'),
               ('ad', '905559450005')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'tr'
  FROM (VALUES ('c1', 'customer', '905559450001', 'Ayşe Müşteri'),
               ('c2', 'customer', '905559450002', 'Yabancı'),
               ('a1', 'provider', '905559450003', 'İlker Usta'),
               ('a2', 'provider', '905559450004', 'İki Usta'),
               ('ad', 'admin', '905559450005', 'Yönetici')) AS t(c, r, p, n);
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Usta ' || right(id::text, 2)
 WHERE id IN (pg_temp.u('a1'), pg_temp.u('a2'));
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Ev"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Temizlik"}', 1, 2, true);
-- z1 has il and ilçe; z2 (staged by the owner) has neither (X-7).
INSERT INTO public.zones (id, region, name, multiplier, active, il, ilce)
VALUES (pg_temp.u('21'), 'TR', '{"tr": "Moda"}', 1.00, true, 'İstanbul', 'Kadıköy'),
       (pg_temp.u('22'), 'TR', '{"tr": "Yeni"}', 1.00, true, NULL, NULL);
SELECT set_config('pricing.publishing', 'on', true);
INSERT INTO public.pricing_formulas (service_id, region, version, base_price, active)
VALUES (pg_temp.u('51'), 'TR', 1, 100000, true);
SELECT set_config('pricing.publishing', 'off', true);
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'payments_enabled';

CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.call_as(p_user text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     CASE WHEN p_user = 'anon' THEN '{"role": "anon"}'
                          ELSE jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', CASE WHEN p_user = 'anon' THEN 'anon' ELSE 'authenticated' END);
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION
    WHEN raise_exception THEN v := sqlerrm;
    WHEN others THEN v := sqlstate;
  END;
  RESET ROLE;
  RETURN v;
END $$;
-- A statement as the owner, its refusal as text, or 'ok'.
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION
  WHEN raise_exception THEN RETURN sqlerrm;
  WHEN others THEN RETURN sqlstate;
END $$;
-- address_parse's refusal for a customer's p_address, or 'ok'.
CREATE FUNCTION pg_temp.parse(p jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.err(format('SELECT public.address_parse(%L::jsonb, %L, false)', p, 'TR')) $$;
CREATE FUNCTION pg_temp.good() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"mahalle": "Caferağa", "street": "Moda Cad.", "building_no": "12", "floor": "3", "apartment": "5",
           "postal_code": "34710", "directions": "Mavi kapı", "lat": 40.986345, "lng": 29.0252}'::jsonb $$;
-- The customer posts at zone z with p_address a, tomorrow at 10, the price 100000 and its commission.
CREATE FUNCTION pg_temp.post(z text, a jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_quote jsonb;
BEGIN
  PERFORM pg_temp.as_user('c1');
  SET LOCAL ROLE authenticated;
  v_quote := public.quote_request(pg_temp.u('51'), pg_temp.u(z), NULL, '{}');
  RETURN public.create_request(gen_random_uuid(), pg_temp.u('51'), pg_temp.u(z), NULL, '{}',
                               (now() AT TIME ZONE 'Europe/Istanbul')::date + 2, 10, a, NULL,
                               (v_quote ->> 'price')::bigint, (v_quote ->> 'commission')::bigint);
END $$;
-- A request of c1 at z1 with offers of a1 and a2; a structured address unless p_legacy.
CREATE FUNCTION pg_temp.base(p integer, p_legacy boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100, "service": {"name": {"tr": "Temizlik"}, "category_name": {"tr": "Ev"}}, "breakdown": {"addons": []}}',
    100000, 10000, 90000, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours');
  IF p_legacy THEN
    INSERT INTO public.request_addresses (request_id, region, customer_id, line)
    VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), 'Moda Cad. No 9 Daire 4');
  ELSE
    INSERT INTO public.request_addresses (request_id, region, customer_id, line, il, ilce, mahalle, street, building_no,
                                          apartment, directions, lat, lng)
    VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'),
            public.compose_address('Caferağa', 'Moda Cad.', '9', NULL, '4', NULL, 'Kadıköy', 'İstanbul'),
            'İstanbul', 'Kadıköy', 'Caferağa', 'Moda Cad.', '9', '4', 'Zile iki kez basın', 40.986345, 29.0252);
  END IF;
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  VALUES (pg_temp.app(p, 'a1'), 'TR', pg_temp.r(p), pg_temp.u('a1'), 'An offer for the address tests, long enough.'),
         (pg_temp.app(p, 'a2'), 'TR', pg_temp.r(p), pg_temp.u('a2'), 'Another offer for the address tests, long enough.');
END $$;
CREATE FUNCTION pg_temp.cfee(p integer) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'commission' $$;
CREATE FUNCTION pg_temp.pfee(p integer) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'provider_fee' AND status = 'pending' $$;
-- Choose a1 and pay the commission (verified), on the active template draft-2.
CREATE FUNCTION pg_temp.paid_commission(p integer, p_legacy boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_att uuid;
BEGIN
  PERFORM pg_temp.base(p, p_legacy);
  PERFORM pg_temp.as_user('c1');
  PERFORM public.choose_provider(pg_temp.r(p), pg_temp.app(p, 'a1'));
  v_att := (public.pay_commission(pg_temp.r(p), 'tr', NULL, 'draft-2') ->> 'attempt_id')::uuid;
  PERFORM public.apply_fee_paid(pg_temp.cfee(p), v_att, 'pay-45-c' || p, 10000, 'TRY', 300);
END $$;
-- Both fees paid: UNLOCKED, and the agreement frozen.
CREATE FUNCTION pg_temp.revealed(p integer, p_legacy boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_att uuid;
BEGIN
  PERFORM pg_temp.paid_commission(p, p_legacy);
  PERFORM pg_temp.as_user('a1');
  v_att := (public.pay_provider_fee(pg_temp.app(p, 'a1'), 'tr', NULL, 'draft-2') ->> 'attempt_id')::uuid;
  PERFORM public.apply_fee_paid(pg_temp.pfee(p), v_att, 'pay-45-p' || p,
                                (SELECT amount FROM public.fee_payments WHERE id = pg_temp.pfee(p)), 'TRY', 150);
END $$;
CREATE FUNCTION pg_temp.contacts(p integer, p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.request_contacts(%L)::text', pg_temp.r(p))) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

-- ══ AC-1: il and ilçe on the zone ════════════════════════════════════════════
SELECT has_column('public', 'zones', 'il', 'AC-1: zones.il');
SELECT has_column('public', 'zones', 'ilce', 'AC-1: zones.ilce');
SELECT is(pg_temp.err($$ UPDATE public.zones SET il = ' İstanbul' WHERE id = pg_temp.u('21') $$), '23514',
  'AC-1: an untrimmed il is refused by the check');
SELECT is(pg_temp.err($$ UPDATE public.zones SET ilce = 'K' WHERE id = pg_temp.u('21') $$), '23514',
  'AC-1: an ilçe of one character is refused');
SELECT is(pg_temp.err($$ UPDATE public.zones SET il = NULL WHERE id = pg_temp.u('21') $$), 'ok',
  'X-7: the owner may stage an active zone without il (the guard binds the API roles)');
SELECT is(pg_temp.call_as('ad', format($$ UPDATE public.zones SET il = NULL WHERE id = %L RETURNING 'ok' $$, pg_temp.u('21'))),
  'zone_place_required', 'AC-1: admin cannot save an active TR zone without il and ilçe');
SELECT is(pg_temp.call_as('ad', format($$ UPDATE public.zones SET il = 'İstanbul', ilce = 'Kadıköy' WHERE id = %L RETURNING 'ok' $$, pg_temp.u('21'))),
  'ok', 'AC-1: and saves it with both');
SELECT is(pg_temp.call_as('ad', format($$ UPDATE public.zones SET active = false WHERE id = %L RETURNING 'ok' $$, pg_temp.u('22'))),
  'ok', 'AC-1: an inactive zone needs neither');
UPDATE public.zones SET active = true WHERE id = pg_temp.u('22');
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE action = 'catalog.updated' AND entity_id = pg_temp.u('21')::text
             AND actor_id = pg_temp.u('ad') AND old_value ->> 'il' IS NULL AND new_value ->> 'il' = 'İstanbul'), 1, 'X-15: the catalog audit trigger records il and ilçe');
SELECT is((SELECT z ->> 'il' || '/' || (z ->> 'ilce')
             FROM jsonb_array_elements(pg_temp.call_as('c1', 'SELECT public.request_catalog()::text')::jsonb -> 'zones') z
            WHERE z ->> 'id' = pg_temp.u('21')::text), 'İstanbul/Kadıköy', 'X-10: request_catalog returns il and ilçe');

-- ══ Address composition (X-16) ═══════════════════════════════════════════════
SELECT is(public.compose_address('Caferağa', 'Moda Cad.', '12', '3', '5', '34710', 'Kadıköy', 'İstanbul'),
  'Caferağa Mah., Moda Cad., No: 12, Kat: 3, Daire: 5, 34710 Kadıköy/İstanbul', 'the spec''s example');
SELECT is(public.compose_address('Caferağa Mahallesi', 'Moda Cad.', '12', NULL, NULL, NULL, NULL, NULL),
  'Caferağa Mahallesi, Moda Cad., No: 12', 'no suffix on Mahallesi, nothing for what is not given');
SELECT is(public.compose_address('CAFERAĞA MAH.', 'Moda', '1', NULL, NULL, NULL, 'Kadıköy', NULL),
  'CAFERAĞA MAH., Moda, No: 1, Kadıköy', 'the suffix test is case blind, without lower()');
SELECT is(public.compose_address('Caferağa Mh.', 'Moda', '1', NULL, NULL, '34710', NULL, NULL),
  'Caferağa Mh., Moda, No: 1, 34710', 'Mh. counts as a suffix too');
SELECT is(char_length(public.compose_address(repeat('a', 80), repeat('b', 80), 'A-123/BCDE', 'A-123/BCDE', 'A-123/BCDE',
                                             '34710', repeat('c', 60), repeat('d', 60))), 348,
  'D230: every part at its maximum composes to 348 code points');
SELECT ok(NOT has_function_privilege('authenticated', 'public.compose_address(text, text, text, text, text, text, text, text)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.address_parse(jsonb, text, boolean)', 'EXECUTE'),
  'X-12: compose_address and address_parse are internal');

-- ══ AC-3, X-8, X-9: the rules ════════════════════════════════════════════════
SELECT is(pg_temp.parse(pg_temp.good()), 'ok', 'a full address passes');
SELECT is(pg_temp.parse('{"mahalle": "Caferağa", "street": "Moda", "building_no": "1"}'), 'ok', 'the three required parts alone pass');
SELECT is(pg_temp.parse(pg_temp.good() - 'mahalle'), 'address_invalid', 'no mahalle');
SELECT is(pg_temp.parse(pg_temp.good() - 'building_no'), 'address_invalid', 'no building number');
SELECT is(pg_temp.parse(pg_temp.good() || '{"street": "   "}'), 'address_invalid', 'a blank street counts as none');
SELECT is(pg_temp.parse(pg_temp.good() || '{"phone": "+90"}'), 'address_invalid', 'an unknown key is refused');
SELECT is(pg_temp.parse(pg_temp.good() || '{"il": "İstanbul"}'), 'address_invalid', 'a customer cannot send il (it comes from the zone)');
SELECT is(pg_temp.parse(pg_temp.good() || '{"floor": 3}'), 'address_invalid', 'a number where a string belongs');
SELECT is(pg_temp.parse('[1]'), 'address_invalid', 'not an object');
SELECT is(pg_temp.parse(pg_temp.good() || jsonb_build_object('directions', repeat('a', 4100))), 'address_invalid',
  'more than 4096 bytes');
SELECT is(pg_temp.parse(pg_temp.good() || jsonb_build_object('street', 'Moda' || chr(7))), 'address_invalid', 'a control character');
SELECT is(pg_temp.parse(pg_temp.good() || jsonb_build_object('street', repeat('ş', 81))), 'address_invalid', 'a street of 81');
SELECT is(pg_temp.parse(pg_temp.good() || jsonb_build_object('directions', repeat('ş', 301))), 'address_invalid', 'directions of 301');
SELECT is(pg_temp.parse(pg_temp.good() || '{"postal_code": "3471"}'), 'address_invalid', 'a postal code of four digits');
SELECT is(pg_temp.parse(pg_temp.good() || '{"building_no": "12/A"}'), 'ok', 'a building number like 12/A');
SELECT is(pg_temp.parse(pg_temp.good() || '{"apartment": "5551234"}'), 'address_invalid', 'X-2: a number part of seven digits');
SELECT is(pg_temp.parse(pg_temp.good() || '{"floor": "3#"}'), 'address_invalid', 'a number part with a sign it cannot hold');
SELECT is(pg_temp.parse(pg_temp.good() || '{"lat": "40.98"}'), 'pin_invalid', 'a string pin');
SELECT is(pg_temp.parse(pg_temp.good() - 'lng'), 'pin_invalid', 'half a pin');
SELECT is(pg_temp.parse(pg_temp.good() || '{"lat": 48.8566, "lng": 2.3522}'), 'pin_invalid', 'a pin outside Turkey');
SELECT is(pg_temp.parse(pg_temp.good() || '{"lat": 40.9863451}'), 'pin_invalid', 'seven decimals');
SELECT is(pg_temp.parse(pg_temp.good() || '{"directions": "beni 0555 123 45 67 numaradan ara"}'), 'contact_info_in_address',
  'a phone in the directions');
SELECT is(pg_temp.parse(pg_temp.good() || '{"street": "ali@example.com sokağı"}'), 'contact_info_in_address', 'an email in the street');
SELECT is(pg_temp.parse(pg_temp.good() || '{"street": "Moda 0555 123", "directions": "45 67"}'), 'contact_info_in_address',
  'a phone split across two free text parts');
SELECT is(pg_temp.parse(pg_temp.good() || '{"building_no": "1234", "floor": "12", "apartment": "34", "postal_code": "34710"}'),
  'ok', 'X-2: the number parts never join a scan');
SELECT is(public.address_parse('{"mahalle": " Caferağa ", "street": "Moda", "building_no": "1", "floor": "", "lat": 41, "lng": 29}', 'TR', false),
  '{"lat": 41.000000, "lng": 29.000000, "street": "Moda", "mahalle": "Caferağa", "building_no": "1"}', 'X-9: trimmed, empty dropped, the pin at six decimals');

-- ══ AC-2, AC-3: posting ══════════════════════════════════════════════════════
CREATE TEMP TABLE posted AS SELECT pg_temp.post('21', pg_temp.good()) AS r;
RESET ROLE;
SELECT is((SELECT r ->> 'status' FROM posted), 'ok', 'AC-3: the customer posts with parts and a pin');
SELECT results_eq(
  $$ SELECT line, il, ilce, mahalle, street, building_no, floor, apartment, postal_code, directions, lat, lng
       FROM public.request_addresses WHERE request_id = (SELECT (r ->> 'id')::uuid FROM posted) $$,
  $$ VALUES ('Caferağa Mah., Moda Cad., No: 12, Kat: 3, Daire: 5, 34710 Kadıköy/İstanbul'::text, 'İstanbul'::text, 'Kadıköy'::text,
             'Caferağa'::text, 'Moda Cad.'::text, '12'::text, '3'::text, '5'::text, '34710'::text, 'Mavi kapı'::text,
             40.986345::numeric, 29.025200::numeric) $$,
  'AC-2: the parts, the pin, il and ilçe from the zone, the line composed in Postgres');
UPDATE public.zones SET ilce = 'Üsküdar' WHERE id = pg_temp.u('21');
SELECT is((SELECT ilce FROM public.request_addresses WHERE request_id = (SELECT (r ->> 'id')::uuid FROM posted)), 'Kadıköy',
  'AC-2: a later zone edit never changes a posted address');
UPDATE public.zones SET ilce = 'Kadıköy' WHERE id = pg_temp.u('21');
CREATE TEMP TABLE posted2 AS SELECT pg_temp.post('22', '{"mahalle": "Yeni", "street": "Gül Sok.", "building_no": "4"}') AS r;
RESET ROLE;
SELECT results_eq(
  $$ SELECT line, il, ilce FROM public.request_addresses WHERE request_id = (SELECT (r ->> 'id')::uuid FROM posted2) $$,
  $$ VALUES ('Yeni Mah., Gül Sok., No: 4'::text, NULL::text, NULL::text) $$,
  'X-7: a zone without il and ilçe never blocks posting; the line leaves them out');
SELECT is(pg_temp.err($$ SELECT pg_temp.post('21', '{"mahalle": "Caferağa", "street": "Moda", "building_no": "1", "lat": 30, "lng": 29}') $$),
  'pin_invalid', 'AC-3: create_request refuses a pin outside the box');
RESET ROLE;
SELECT is(pg_temp.err($$ SELECT pg_temp.post('21', pg_temp.good() || '{"directions": "ara 0555 123 45 67"}') $$),
  'contact_info_in_address', 'AC-3: and a phone in the address');
RESET ROLE;
SELECT is(pg_temp.err($$ UPDATE public.request_addresses SET floor = '4' WHERE request_id = (SELECT (r ->> 'id')::uuid FROM posted) $$),
  'request_address_immutable', 'AC-2: the row stays immutable');
SELECT is(pg_temp.err($$ INSERT INTO public.request_addresses (request_id, region, customer_id, line, mahalle)
                         VALUES (gen_random_uuid(), 'TR', gen_random_uuid(), 'x', 'Moda') $$), '23514',
  'AC-2: a row with some parts but no street or building number is refused by the shape check');
SELECT is(pg_temp.call_as('c1', format('SELECT mahalle || %L || lat FROM public.request_addresses WHERE request_id = %L', ' ',
                                       (SELECT (r ->> 'id')::uuid FROM posted))), 'Caferağa 40.986345',
  'AC-6: the customer reads their own parts and pin');
SELECT ok(to_regprocedure('public.create_request(uuid, uuid, uuid, uuid[], jsonb, date, integer, text, text, bigint, bigint)') IS NULL
          AND has_function_privilege('authenticated', 'public.create_request(uuid, uuid, uuid, uuid[], jsonb, date, integer, jsonb, text, bigint, bigint)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.create_request(uuid, uuid, uuid, uuid[], jsonb, date, integer, jsonb, text, bigint, bigint)', 'EXECUTE'),
  'X-12: the old overload is gone; the new one is for signed in callers only');

-- ══ AC-5, X-11: provider_addresses ═══════════════════════════════════════════
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.provider_addresses'::regclass), 'X-11: RLS is on');
SELECT is((SELECT count(*)::integer FROM pg_policies WHERE schemaname = 'public' AND tablename = 'provider_addresses'
             AND policyname = 'provider_addresses_no_api' AND qual = 'false'), 1, 'X-11: one deny policy');
SELECT ok(NOT has_table_privilege('authenticated', 'public.provider_addresses', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.provider_addresses', 'INSERT')
          AND NOT has_table_privilege('anon', 'public.provider_addresses', 'SELECT')
          AND NOT has_table_privilege('service_role', 'public.provider_addresses', 'SELECT'),
  'X-11: no API grant');
SELECT is(pg_temp.call_as('a1', 'SELECT count(*)::text FROM public.provider_addresses'), '42501', 'X-11: a provider cannot read the table');
SELECT is(pg_temp.call_as('c1', $$ SELECT public.save_provider_address('{"il": "İstanbul", "ilce": "Kadıköy", "mahalle": "Rasimpaşa", "street": "Rıhtım Cad.", "building_no": "3"}')::text $$),
  'forbidden', 'AC-5: a customer cannot save a provider address');
SELECT is(pg_temp.call_as('a1', $$ SELECT public.save_provider_address('{"mahalle": "Rasimpaşa", "street": "Rıhtım Cad.", "building_no": "3"}')::text $$),
  'address_invalid', 'AC-5: a provider needs il and ilçe');
SELECT is(pg_temp.call_as('a1', $$ SELECT public.save_provider_address('{"il": "İstanbul", "ilce": "Kadıköy", "mahalle": "Rasimpaşa", "street": "Rıhtım Cad.", "building_no": "3", "directions": "x"}')::text $$),
  'address_invalid', 'AC-5: and has no directions');
SELECT is(pg_temp.call_as('a1', $$ SELECT public.save_provider_address('{"il": "İstanbul", "ilce": "Kadıköy", "mahalle": "Rasimpaşa", "street": "Rıhtım Cad.", "building_no": "3", "lat": 40.99, "lng": 29.02}')::text $$),
  '{"ok": true}', 'AC-5: the provider saves an address with a pin');
SELECT is(pg_temp.call_as('a1', $$ SELECT public.save_provider_address('{"il": "İstanbul", "ilce": "Kadıköy", "mahalle": "Rasimpaşa", "street": "Rıhtım Cad.", "building_no": "3", "lat": 40.99, "lng": 29.02}')::text $$),
  '{"ok": true}', 'AC-5: the same save again');
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE action = 'provider.address_changed' AND actor_id = pg_temp.u('a1')), 1,
  'AC-5: one provider.address_changed row; an unchanged save writes none');
SELECT is((SELECT new_value FROM public.audit_log WHERE action = 'provider.address_changed' AND actor_id = pg_temp.u('a1')),
  '{"first": true}', 'X-23: ids only, never the address');
SELECT is(pg_temp.call_as('a1', 'SELECT public.my_provider_address() ->> ''line'''), 'Rasimpaşa Mah., Rıhtım Cad., No: 3, Kadıköy/İstanbul',
  'AC-5: the provider reads their own composed address');
SELECT is(pg_temp.call_as('a2', 'SELECT coalesce(public.my_provider_address()::text, ''none'')'), 'none',
  'AC-5: another provider reads only their own (none)');
SELECT is(pg_temp.err($$ DELETE FROM public.provider_addresses $$), 'provider_address_final', 'X-11: no row is ever deleted');
SELECT is(pg_temp.err($$ TRUNCATE public.provider_addresses $$), 'provider_address_final', 'X-11: nor truncated');

-- ══ AC-6: the reveal (rule 2) ════════════════════════════════════════════════
SELECT pg_temp.paid_commission(1, false);
RESET ROLE;
SELECT is(pg_temp.contacts(1, 'a1'), 'not_found', 'AC-6: before the provider fee, no address for the provider');
SELECT is(pg_temp.contacts(1, 'c1'), 'not_found', 'AC-6: nor the provider''s address for the customer');
SELECT pg_temp.revealed(2, false);
RESET ROLE;
CREATE TEMP TABLE seen AS SELECT pg_temp.contacts(2, 'a1')::jsonb AS p, pg_temp.contacts(2, 'c1')::jsonb AS c;
SELECT is((SELECT p -> 'address' ->> 'mahalle' || '|' || (p -> 'address' ->> 'directions') || '|' || (p -> 'address' ->> 'lat') FROM seen),
  'Caferağa|Zile iki kez basın|40.986345', 'AC-6: after both fees the provider reads the parts, the directions and the pin');
SELECT is((SELECT p ->> 'street' FROM seen), 'Caferağa Mah., Moda Cad., No: 9, Daire: 4, Kadıköy/İstanbul',
  'AC-6: and the composed line');
SELECT is((SELECT c ->> 'provider_address' FROM seen), 'Rasimpaşa Mah., Rıhtım Cad., No: 3, Kadıköy/İstanbul',
  'AC-6, X-6: the customer reads the provider''s address as frozen in the agreement');
SELECT ok((SELECT NOT (c ? 'address') AND NOT (c ? 'lat') AND position('40.99' IN c::text) = 0 FROM seen),
  'AC-6: the customer never gets the provider''s pin or a parts object');
SELECT is(pg_temp.contacts(2, 'a2'), 'not_found', 'AC-6: the other applicant reads nothing');
SELECT is(pg_temp.contacts(2, 'c2'), 'not_found', 'AC-6: a stranger reads nothing');
SELECT is(pg_temp.contacts(2, 'anon'), '42501', 'AC-6: anon cannot call it');
SELECT is(pg_temp.call_as('a1', format('SELECT count(*)::text FROM public.request_addresses WHERE request_id = %L', pg_temp.r(2))), '0',
  'X-20: the chosen provider''s direct select returns nothing');
UPDATE public.providers SET status = 'suspended', suspension_reason = 'Address tests suspension' WHERE id = pg_temp.u('a1');
SELECT is(pg_temp.contacts(2, 'a1'), 'not_found', 'AC-6: a suspended provider reads no address');
UPDATE public.providers SET status = 'approved', suspension_reason = NULL WHERE id = pg_temp.u('a1');
-- A later provider edit never changes what the customer sees (X-6).
SELECT pg_temp.call_as('a1', $$ SELECT public.save_provider_address('{"il": "İstanbul", "ilce": "Beşiktaş", "mahalle": "Sinanpaşa", "street": "Çarşı Cad.", "building_no": "8"}')::text $$);
SELECT is(pg_temp.contacts(2, 'c1')::jsonb ->> 'provider_address', 'Rasimpaşa Mah., Rıhtım Cad., No: 3, Kadıköy/İstanbul',
  'X-6: a provider''s later change never makes the card and the agreement disagree');
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE action = 'provider.address_changed' AND actor_id = pg_temp.u('a1')), 2,
  'AC-5: a change writes a second provider.address_changed row');

-- ══ AC-8: the agreement ══════════════════════════════════════════════════════
SELECT is((SELECT string_agg(version || ':' || active, ',' ORDER BY version) FROM public.agreement_templates WHERE region = 'TR'),
  'draft-1:false,draft-2:true', 'AC-8, X-4: draft-2 is the one active TR template; draft-1 stays');
SELECT ok(public.agreement_field_names() @> ARRAY['customer_address', 'customer_directions', 'provider_address']::text[],
  'AC-8: the three new field names');
SELECT ok((SELECT bool_and(t ~ '^\[draft\] ') FROM public.agreement_templates a,
             jsonb_array_elements(a.body) s, LATERAL (SELECT s ->> 'heading' UNION ALL SELECT jsonb_array_elements_text(s -> 'paragraphs')) x(t)
            WHERE a.version = 'draft-2'), 'AC-8: every text of draft-2 starts [draft]');
SELECT ok((SELECT body::text LIKE '%{{customer_address}}%' AND body::text LIKE '%{{customer_directions}}%'
                  AND body::text LIKE '%{{provider_address}}%' AND jsonb_array_length(body) = 7
             FROM public.agreement_templates WHERE version = 'draft-2'), 'X-18: draft-2 prints both addresses and the directions, in seven sections');
SELECT results_eq(
  $$ SELECT content ->> 'customer_address', content ->> 'customer_directions', content ->> 'provider_address', content ->> 'street_line'
       FROM public.service_agreements WHERE request_id = pg_temp.r(2) $$,
  $$ VALUES ('Caferağa Mah., Moda Cad., No: 9, Daire: 4, Kadıköy/İstanbul'::text, 'Zile iki kez basın'::text,
             'Rasimpaşa Mah., Rıhtım Cad., No: 3, Kadıköy/İstanbul'::text, 'Caferağa Mah., Moda Cad., No: 9, Daire: 4, Kadıköy/İstanbul'::text) $$,
  'AC-8: the content frozen at the reveal holds both addresses and the directions, and keeps street_line');

-- ══ AC-9: a request before 20b ═══════════════════════════════════════════════
SELECT pg_temp.revealed(3, true);
RESET ROLE;
SELECT is(pg_temp.contacts(3, 'a1')::jsonb -> 'address' ->> 'line', 'Moda Cad. No 9 Daire 4', 'AC-9: the old row''s line reaches the provider');
SELECT is(pg_temp.contacts(3, 'a1')::jsonb -> 'address' ->> 'mahalle', NULL, 'AC-9: with null parts');
SELECT is((SELECT content ->> 'customer_address' FROM public.service_agreements WHERE request_id = pg_temp.r(3)),
  'Moda Cad. No 9 Daire 4', 'AC-9: the agreement falls back to the line');

-- ══ AC-7: admin ══════════════════════════════════════════════════════════════
SELECT is(pg_temp.call_as('c1', format('SELECT public.admin_request_address(%L, %L)::text', pg_temp.r(2), 'The provider cannot find it.')),
  'forbidden', 'AC-7: a customer cannot use admin''s read');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_request_address(%L, %L)::jsonb ->> %L', pg_temp.r(2), 'The provider cannot find it.', 'apartment')),
  '4', 'AC-7: admin reads the parts with the line');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_request_address(%L, %L)::jsonb ->> %L', pg_temp.r(2), 'The provider cannot find it.', 'lng')),
  '29.025200', 'AC-7: and the pin');
SELECT is(pg_temp.call_as('a1', format('SELECT public.admin_provider_address(%L, %L)::text', pg_temp.u('a1'), 'Checking a complaint about the address.')),
  'forbidden', 'AC-7: a provider cannot use admin''s provider read');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_provider_address(%L, %L)::text', pg_temp.u('a1'), 'short')),
  'validation_failed', 'AC-7: a reason of 10 to 500 characters');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_provider_address(%L, %L)::text', pg_temp.u('a2'), 'Checking a complaint about the address.')),
  'not_found', 'AC-7: a provider with no address');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_provider_address(%L, %L)::jsonb ->> %L', pg_temp.u('a1'), 'Checking a complaint about the address.', 'line')),
  'Sinanpaşa Mah., Çarşı Cad., No: 8, Beşiktaş/İstanbul', 'AC-7: admin reads the provider''s current address');
SELECT results_eq(
  $$ SELECT entity_type, entity_id, new_value ->> 'reason' FROM public.audit_log WHERE action = 'provider.address_viewed' $$,
  $$ VALUES ('provider'::text, pg_temp.u('a1')::text, 'Checking a complaint about the address.'::text) $$,
  'AC-7: one provider.address_viewed row with the reason, and only for the read that succeeded');

SELECT * FROM finish();
ROLLBACK;
