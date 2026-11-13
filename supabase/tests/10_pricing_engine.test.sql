-- Position 03, spec 0007: the pricing engine, publishing and the question guard.
--
-- Every figure is fixture data from verify.md (Worked figures), never a real price. Amounts are minor
-- units, the unit is 100, the multiple is 20. The interpreter is proven pure through pricing_evaluate,
-- then end to end through quote_price as a real customer, and a seeded loop of 300 random formulas
-- stands in for fast-check, which cannot reach SQL. AC-4 to AC-13. The races are in 11.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(155);

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1: customer, a1: admin, u0: signed in with no profile yet.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at) VALUES
  ('00000000-0000-0000-0000-0000000010c1', 'authenticated', 'authenticated', '905554440001', now()),
  ('00000000-0000-0000-0000-0000000010a1', 'authenticated', 'authenticated', '905554440002', now()),
  ('00000000-0000-0000-0000-000000001000', 'authenticated', 'authenticated', '905554440003', now());
INSERT INTO public.profiles (id, role, region, phone, full_name, locale) VALUES
  ('00000000-0000-0000-0000-0000000010c1', 'customer', 'TR', '+905554440001', 'Can Müşteri', 'tr'),
  ('00000000-0000-0000-0000-0000000010a1', 'admin', 'TR', '+905554440002', 'Admin Bir', 'en');

-- K1 holds fixture F. K2 holds the answer checks, a multi select and a service scoped question.
-- K3 is off. K4 is in KSA.
INSERT INTO public.service_categories (id, region, name, active) VALUES
  ('00000000-0000-0000-0000-00000010c001', 'TR', '{"tr": "Temizlik"}', true),
  ('00000000-0000-0000-0000-00000010c002', 'TR', '{"tr": "Tadilat"}', true),
  ('00000000-0000-0000-0000-00000010c003', 'TR', '{"tr": "Kapalı"}', false),
  ('00000000-0000-0000-0000-00000010c004', 'KSA', '{"ar": "تنظيف"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active) VALUES
  ('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-00000010c001', 'TR', '{"tr": "Ev"}', 2, 4, true),
  ('00000000-0000-0000-0000-000000105002', '00000000-0000-0000-0000-00000010c002', 'TR', '{"tr": "Boya"}', 2, 4, true),
  ('00000000-0000-0000-0000-000000105003', '00000000-0000-0000-0000-00000010c002', 'TR', '{"tr": "Sıva"}', 2, 4, true),
  ('00000000-0000-0000-0000-000000105004', '00000000-0000-0000-0000-00000010c003', 'TR', '{"tr": "Kapalı"}', 2, 4, true),
  ('00000000-0000-0000-0000-000000105005', '00000000-0000-0000-0000-00000010c004', 'KSA', '{"ar": "منزل"}', 2, 4, true),
  ('00000000-0000-0000-0000-000000105006', '00000000-0000-0000-0000-00000010c001', 'TR', '{"tr": "Ofis"}', 2, 4, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES
  ('00000000-0000-0000-0000-000000102001', 'TR', '{"tr": "Z1"}', 1.00, true),
  ('00000000-0000-0000-0000-000000102002', 'TR', '{"tr": "Z2"}', 1.15, true),
  ('00000000-0000-0000-0000-000000102003', 'TR', '{"tr": "Kapalı"}', 1.00, false),
  ('00000000-0000-0000-0000-000000102004', 'KSA', '{"ar": "Z"}', 1.00, true);
INSERT INTO public.addons (id, service_id, region, name, price, active) VALUES
  ('00000000-0000-0000-0000-00000010a001', '00000000-0000-0000-0000-000000105001', 'TR', '{"tr": "Cam"}', 40000, true),
  ('00000000-0000-0000-0000-00000010a002', '00000000-0000-0000-0000-000000105001', 'TR', '{"tr": "Kapalı"}', 10000, false),
  ('00000000-0000-0000-0000-00000010a003', '00000000-0000-0000-0000-000000105002', 'TR', '{"tr": "Başka"}', 10000, true);
INSERT INTO public.questions (category_id, service_id, region, key, label, type, required, affects_pricing, options, validation, active) VALUES
  ('00000000-0000-0000-0000-00000010c001', NULL, 'TR', 'rooms', '{"tr": "Oda"}', 'number', true, true, NULL, '{"min": 1, "max": 10, "step": 1}', true),
  ('00000000-0000-0000-0000-00000010c001', NULL, 'TR', 'bathrooms', '{"tr": "Banyo"}', 'number', true, true, NULL, '{"min": 1, "max": 10, "step": 1}', true),
  ('00000000-0000-0000-0000-00000010c001', NULL, 'TR', 'property_type', '{"tr": "Tip"}', 'single_select', true, true,
   '[{"value": "apartment", "label": {"tr": "Daire"}}, {"value": "villa", "label": {"tr": "Villa"}}, {"value": "studio", "label": {"tr": "Stüdyo"}}]', NULL, true),
  ('00000000-0000-0000-0000-00000010c001', NULL, 'TR', 'has_pets', '{"tr": "Evcil"}', 'boolean', true, true, NULL, NULL, true),
  ('00000000-0000-0000-0000-00000010c001', NULL, 'TR', 'garden', '{"tr": "Bahçe"}', 'boolean', false, true, NULL, NULL, true),
  ('00000000-0000-0000-0000-00000010c001', NULL, 'TR', 'notes', '{"tr": "Not"}', 'text', false, false, NULL, NULL, true),
  ('00000000-0000-0000-0000-00000010c002', NULL, 'TR', 'count', '{"tr": "Adet"}', 'number', true, false, NULL, '{"min": 1, "max": 10, "step": 2}', true),
  ('00000000-0000-0000-0000-00000010c002', NULL, 'TR', 'kind', '{"tr": "Tür"}', 'single_select', false, false,
   '[{"value": "a", "label": {"tr": "A"}}, {"value": "b", "label": {"tr": "B"}}]', NULL, true),
  ('00000000-0000-0000-0000-00000010c002', NULL, 'TR', 'extras', '{"tr": "Ekstra"}', 'multi_select', false, true,
   '[{"value": "a", "label": {"tr": "A"}}, {"value": "b", "label": {"tr": "B"}}, {"value": "c", "label": {"tr": "C"}}]', NULL, true),
  ('00000000-0000-0000-0000-00000010c002', NULL, 'TR', 'day', '{"tr": "Gün"}', 'date', false, false, NULL, NULL, true),
  ('00000000-0000-0000-0000-00000010c002', NULL, 'TR', 'at', '{"tr": "Saat"}', 'time', false, false, NULL, NULL, true),
  ('00000000-0000-0000-0000-00000010c002', NULL, 'TR', 'note', '{"tr": "Not"}', 'text', false, false, NULL, '{"maxLength": 40}', true),
  ('00000000-0000-0000-0000-00000010c002', '00000000-0000-0000-0000-000000105003', 'TR', 'size', '{"tr": "Boyut"}', 'number', true, true, NULL, '{"min": 0, "max": 10, "step": 1}', true);

-- Fixture F, as a draft: the array order is apply_order and a factor is a string.
CREATE FUNCTION pg_temp.f() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT
  '[{"question_key": "rooms", "match_type": "always", "match_value": null, "effect_type": "PER_UNIT", "amount": 40000, "factor": null},
    {"question_key": "bathrooms", "match_type": "always", "match_value": null, "effect_type": "PER_UNIT", "amount": 25000, "factor": null},
    {"question_key": "property_type", "match_type": "equals", "match_value": "villa", "effect_type": "MULTIPLIER", "amount": null, "factor": "1.30"},
    {"question_key": "has_pets", "match_type": "is_true", "match_value": null, "effect_type": "FIXED", "amount": 20000, "factor": null},
    {"question_key": "property_type", "match_type": "equals", "match_value": "studio", "effect_type": "FIXED", "amount": -40000, "factor": null}]'::jsonb $$;
-- One modifier with no question key, for the pure cases.
CREATE FUNCTION pg_temp.mul(p_factor text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('question_key', null, 'match_type', 'always', 'match_value', null,
                            'effect_type', 'MULTIPLIER', 'amount', null, 'factor', p_factor) $$;
CREATE FUNCTION pg_temp.fix(p_amount bigint) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('question_key', null, 'match_type', 'always', 'match_value', null,
                            'effect_type', 'FIXED', 'amount', p_amount, 'factor', null) $$;
-- The pure engine with the TR settings: unit 100, multiple 20.
CREATE FUNCTION pg_temp.ev(p_base bigint, p_mods jsonb, p_answers jsonb, p_addons bigint, p_mult numeric) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$ SELECT public.pricing_evaluate(p_base, p_mods, p_answers, p_addons, p_mult, 100, 20) $$;
CREATE FUNCTION pg_temp.price(p_result jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_result ->> 'price', p_result ->> 'status') $$;
CREATE FUNCTION pg_temp.refusal(p_answers jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.quote_price('00000000-0000-0000-0000-000000105002', '00000000-0000-0000-0000-000000102001', NULL, p_answers) $$;
GRANT EXECUTE ON FUNCTION pg_temp.refusal(jsonb) TO authenticated;
CREATE FUNCTION pg_temp.err(p_base bigint, p_mods jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.publish_pricing_formula('00000000-0000-0000-0000-000000105001', 1, p_base, p_mods) $$;
GRANT EXECUTE ON FUNCTION pg_temp.err(bigint, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.f(), pg_temp.mul(text), pg_temp.fix(bigint),
  pg_temp.ev(bigint, jsonb, jsonb, bigint, numeric), pg_temp.price(jsonb) TO authenticated;

-- ── worked figures, pure (AC-5, AC-6, AC-8) ──────────────────────────────────
SELECT is(pg_temp.price(pg_temp.ev(120000, pg_temp.f(), '{"rooms": 3, "bathrooms": 2, "property_type": "apartment", "has_pets": true}', 40000, 1.00)),
  '350000', 'the design''s own figure: 350000');
SELECT is(pg_temp.price(pg_temp.ev(120000, pg_temp.f(), '{"rooms": 3, "bathrooms": 2, "property_type": "villa", "has_pets": true}', 40000, 1.15)),
  '502600', 'half up after a zone: 502550 rounds to 502600');
SELECT is(pg_temp.price(pg_temp.ev(120000, pg_temp.f(), '{"rooms": 3, "bathrooms": 2, "property_type": "villa", "has_pets": true}', 0, 1.00)),
  '397000', 'order counts: the multiplier before the fixed amount');
SELECT is(pg_temp.price(pg_temp.ev(120000,
    jsonb_build_array(pg_temp.f() -> 0, pg_temp.f() -> 1, pg_temp.f() -> 3, pg_temp.f() -> 2, pg_temp.f() -> 4),
    '{"rooms": 3, "bathrooms": 2, "property_type": "villa", "has_pets": true}', 0, 1.00)),
  '403000', 'order counts, swapped: the fixed amount is multiplied too');
SELECT is(pg_temp.price(pg_temp.ev(120000, pg_temp.f(), '{"rooms": 1, "bathrooms": 1, "property_type": "studio", "has_pets": false}', 0, 1.00)),
  '145000', 'a discount');
SELECT is(pg_temp.price(pg_temp.ev(1040, jsonb_build_array(pg_temp.mul('1.10'), pg_temp.mul('1.10'), pg_temp.mul('1.10')), '{}', 0, 1)),
  '1400', 'one rounding: 1384.24 gives 1400, where rounding each step would give 1300');
SELECT is(pg_temp.ev(1040, jsonb_build_array(pg_temp.mul('1.10'), pg_temp.mul('1.10'), pg_temp.mul('1.10')), '{}', 0, 1) ->> 'unrounded',
  '1384.240000000000', 'nothing is rounded before the end');
SELECT is(pg_temp.price(pg_temp.ev(100050, '[]', '{}', 0, 1)), '100100', 'half up exactly: 1000.5 units give 1001');
SELECT is(pg_temp.price(pg_temp.ev(100000, jsonb_build_array(pg_temp.mul('10'), pg_temp.mul('2')), '{}', 0, 1)), '2000000', 'at the ceiling');
SELECT is(pg_temp.price(pg_temp.ev(100000, jsonb_build_array(pg_temp.mul('10'), pg_temp.mul('2.01')), '{}', 0, 1)), 'price_out_of_range', 'over the ceiling');
SELECT is(pg_temp.price(pg_temp.ev(30, '[]', '{}', 0, 1)), 'price_out_of_range', 'rounds to nothing');
SELECT is(pg_temp.price(pg_temp.ev(100, jsonb_build_array(pg_temp.fix(-100)), '{}', 0, 1)), 'price_out_of_range', 'a discount to nothing');
SELECT is(pg_temp.price(pg_temp.ev(100000,
    '[{"question_key": "rooms", "match_type": "range", "match_value": {"min": 3, "max": 5}, "effect_type": "PER_UNIT", "amount": 10000, "factor": null}]',
    '{"rooms": 4}', 0, 1)), '140000', 'a tier');
SELECT is(pg_temp.price(pg_temp.ev(100000,
    '[{"question_key": "rooms", "match_type": "range", "match_value": {"min": 3, "max": 5}, "effect_type": "PER_UNIT", "amount": 10000, "factor": null}]',
    '{"rooms": 6}', 0, 1)), '100000', 'a tier missed fires nothing');
SELECT is(pg_temp.price(pg_temp.ev(100000,
    '[{"question_key": "x", "match_type": "equals", "match_value": "a", "effect_type": "FIXED", "amount": 5000, "factor": null},
      {"question_key": "x", "match_type": "equals", "match_value": "b", "effect_type": "FIXED", "amount": 7000, "factor": null},
      {"question_key": "x", "match_type": "in", "match_value": ["b", "c"], "effect_type": "FIXED", "amount": 9000, "factor": null}]',
    '{"x": ["a", "b"]}', 0, 1)), '121000', 'a multi select: equals is among the chosen, in fires once');
SELECT is(pg_temp.price(pg_temp.ev(100000,
    '[{"question_key": "x", "match_type": "equals", "match_value": "a", "effect_type": "FIXED", "amount": 5000, "factor": null}]',
    '{"x": []}', 0, 1)), '100000', 'an empty multi select fires nothing');
SELECT is(pg_temp.price(pg_temp.ev(120000, pg_temp.f(), '{"rooms": 3, "bathrooms": 2, "property_type": "apartment", "has_pets": true}', 40000, 1.00)),
          pg_temp.price(pg_temp.ev(120000, pg_temp.f(), '{"rooms": 3, "bathrooms": 2, "property_type": "apartment", "has_pets": true}', 40000, 1.00)),
  'the same inputs give the same output');

-- The seeded loop: 300 random formulas, each a whole multiple of the unit between the floor and the
-- ceiling, or refused, and the same twice.
SELECT setseed(0.42);
CREATE TEMP TABLE loop_cases AS
  SELECT g,
         (1 + floor(random() * 1000000))::bigint AS base,
         (SELECT coalesce(jsonb_agg(CASE WHEN random() < 0.5
                                         THEN pg_temp.fix(((floor(random() * 200001) - 100000))::bigint * 100 + 1)
                                         ELSE pg_temp.mul((round((0.1 + random() * 9.9)::numeric, 4))::text) END), '[]'::jsonb)
            FROM generate_series(1, (g % 6)) k WHERE g > 0) AS mods,
         (floor(random() * 100000))::bigint AS addons,
         round((0.5 + random() * 1.5)::numeric, 2) AS mult
    FROM generate_series(1, 300) g;
SELECT is_empty(
  $$ SELECT g FROM (
       SELECT g, base, pg_temp.ev(base, mods, '{}', addons, mult) AS r, pg_temp.ev(base, mods, '{}', addons, mult) AS r2
         FROM loop_cases) x
      WHERE r <> r2
         OR (r ->> 'status' = 'ok' AND ((r ->> 'price')::bigint % 100 <> 0
                                        OR (r ->> 'price')::bigint < 100
                                        OR (r ->> 'price')::bigint > base * 20))
         OR (r ->> 'status' NOT IN ('ok', 'price_out_of_range')) $$,
  '300 seeded formulas: every price a whole multiple of the unit, inside the floor and the ceiling, or refused, and repeatable');
SELECT ok((SELECT count(*) FROM loop_cases WHERE pg_temp.ev(base, mods, '{}', addons, mult) ->> 'status' = 'ok') BETWEEN 30 AND 290,
  'the loop reaches both prices and refusals');

-- ── publish the fixtures (AC-12) ─────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010a1", "role": "authenticated"}', true);
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105001', 0, 120000, pg_temp.f()) - 'formula_id',
  '{"status": "ok", "version": 1}'::jsonb, 'admin publishes fixture F as version 1');
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105002', 0, 100000,
  '[{"question_key": "extras", "match_type": "equals", "match_value": "a", "effect_type": "FIXED", "amount": 5000, "factor": null},
    {"question_key": "extras", "match_type": "equals", "match_value": "b", "effect_type": "FIXED", "amount": 7000, "factor": null},
    {"question_key": "extras", "match_type": "in", "match_value": ["b", "c"], "effect_type": "FIXED", "amount": 9000, "factor": null}]') ->> 'status',
  'ok', 'an optional multi select may be read by a formula');
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105003', 0, 100000,
  '[{"question_key": "size", "match_type": "range", "match_value": {"min": 3, "max": 5}, "effect_type": "PER_UNIT", "amount": 10000, "factor": null}]') ->> 'status',
  'ok', 'a service scoped question is read by its own service');
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105004', 0, 100000, '[]') ->> 'status', 'ok',
  'a service under an off category can publish');
RESET ROLE;
INSERT INTO public.pricing_formulas (service_id, region, version, base_price, active)
  VALUES ('00000000-0000-0000-0000-000000105005', 'KSA', 1, 100000, true);

-- ── quote_price, worked figures end to end (AC-5, AC-6, AC-9) ────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010c1", "role": "authenticated"}', true);
SELECT is(public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001',
          ARRAY['00000000-0000-0000-0000-00000010a001']::uuid[],
          '{"rooms": 3, "bathrooms": 2, "property_type": "apartment", "has_pets": true}') ->> 'price',
  '350000', 'a customer''s quote of the design''s own figure');
SELECT is(public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102002',
          ARRAY['00000000-0000-0000-0000-00000010a001']::uuid[],
          '{"rooms": 3, "bathrooms": 2, "property_type": "villa", "has_pets": true}') ->> 'price',
  '502600', 'half up after a zone, quoted');
SELECT is(public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001', NULL,
          '{"rooms": 3, "bathrooms": 2, "property_type": "villa", "has_pets": true}') ->> 'price',
  '397000', 'order counts, quoted; a null addon list means none');
SELECT is(public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001', '{}',
          '{"rooms": 1, "bathrooms": 1, "property_type": "studio", "has_pets": false, "notes": "  "}') ->> 'price',
  '145000', 'a discount, quoted; a blank optional text is no answer');
SELECT is(public.quote_price('00000000-0000-0000-0000-000000105002', '00000000-0000-0000-0000-000000102001', NULL,
          '{"count": 1, "extras": ["a", "b"]}') ->> 'price', '121000', 'a multi select, quoted');
SELECT is(public.quote_price('00000000-0000-0000-0000-000000105002', '00000000-0000-0000-0000-000000102001', NULL,
          '{"count": 1, "extras": []}') ->> 'price', '100000', 'an empty multi select, quoted');
SELECT is(public.quote_price('00000000-0000-0000-0000-000000105003', '00000000-0000-0000-0000-000000102001', NULL,
          '{"count": 1, "size": 4}') ->> 'price', '140000', 'a tier, quoted');
SELECT is(public.quote_price('00000000-0000-0000-0000-000000105003', '00000000-0000-0000-0000-000000102001', NULL,
          '{"count": 1, "size": 6}') ->> 'price', '100000', 'a tier missed, quoted');

-- The whole output shape, and only the lines that fired (AC-9).
SELECT is(
  public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001',
                     ARRAY['00000000-0000-0000-0000-00000010a001']::uuid[],
                     '{"rooms": 3, "bathrooms": 2, "property_type": "apartment", "has_pets": true}') - 'formula_id',
  '{"status": "ok", "price": 350000, "currency": "TRY", "formula_version": 1,
    "breakdown": {"base": 120000,
      "modifiers": [
        {"question_key": "rooms", "match_type": "always", "match_value": null, "effect_type": "PER_UNIT", "amount": 40000, "factor": null, "units": 3, "fired": true},
        {"question_key": "bathrooms", "match_type": "always", "match_value": null, "effect_type": "PER_UNIT", "amount": 25000, "factor": null, "units": 2, "fired": true},
        {"question_key": "has_pets", "match_type": "is_true", "match_value": null, "effect_type": "FIXED", "amount": 20000, "factor": null, "units": null, "fired": true}],
      "addons": [{"id": "00000000-0000-0000-0000-00000010a001", "name": {"tr": "Cam"}, "price": 40000}],
      "zone": {"id": "00000000-0000-0000-0000-000000102001", "name": {"tr": "Z1"}, "multiplier": "1.00"},
      "unrounded": "350000.00", "rounding_minor": 100}}'::jsonb,
  'the output shape; the villa and studio rules that did not fire are not shown');
CREATE TEMP TABLE named AS SELECT public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001', NULL,
  '{"rooms": 3, "bathrooms": 2, "property_type": "apartment", "has_pets": true}') ->> 'formula_id' AS id;
RESET ROLE;
SELECT is((SELECT id FROM named),
  (SELECT id::text FROM public.pricing_formulas WHERE service_id = '00000000-0000-0000-0000-000000105001' AND active),
  'the quote names the active formula');

-- ── answers refused (AC-7) ───────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010c1", "role": "authenticated"}', true);
SELECT is(pg_temp.refusal('{"count": 1, "zzz": 1}'), '{"status": "invalid", "errors": [{"key": "zzz", "code": "answer_unknown"}]}', 'an unknown key');
SELECT is(pg_temp.refusal('{"count": 1, "size": 1}'), '{"status": "invalid", "errors": [{"key": "size", "code": "answer_unknown"}]}', 'a question of another service is unknown here');
SELECT is(pg_temp.refusal('{}'), '{"status": "invalid", "errors": [{"key": "count", "code": "answer_required"}]}', 'a required question missing');
SELECT is(pg_temp.refusal('{"count": null}'), '{"status": "invalid", "errors": [{"key": "count", "code": "answer_required"}]}', 'sent as null');
SELECT is(pg_temp.refusal(jsonb_build_object('count', E'  ​')), '{"status": "invalid", "errors": [{"key": "count", "code": "answer_required"}]}', 'sent as NBSP and zero width');
SELECT is(pg_temp.refusal('{"count": "3"}'), '{"status": "invalid", "errors": [{"key": "count", "code": "answer_invalid"}]}', '"3" for a number');
SELECT is(pg_temp.refusal('{"count": 3.0}') ->> 'status', 'ok', 'a number equal to an integer is an integer');
SELECT is(pg_temp.refusal('{"count": 2.5}'), '{"status": "invalid", "errors": [{"key": "count", "code": "answer_invalid"}]}', 'a fraction for a number');
SELECT is(pg_temp.refusal('{"count": 11}'), '{"status": "invalid", "errors": [{"key": "count", "code": "answer_out_of_range"}]}', '11 on a question up to 10');
SELECT is(pg_temp.refusal('{"count": 4}'), '{"status": "invalid", "errors": [{"key": "count", "code": "answer_out_of_range"}]}', '4 on min 1, step 2');
SELECT is(pg_temp.refusal('{"count": 1, "kind": "castle"}'), '{"status": "invalid", "errors": [{"key": "kind", "code": "answer_invalid"}]}', 'an unknown option');
SELECT is(pg_temp.refusal('{"count": 1, "extras": ["a", "a"]}'), '{"status": "invalid", "errors": [{"key": "extras", "code": "answer_invalid"}]}', 'a repeated option');
SELECT is(pg_temp.refusal('{"count": 1, "extras": "a"}'), '{"status": "invalid", "errors": [{"key": "extras", "code": "answer_invalid"}]}', 'a bare string for a multi select');
SELECT is(pg_temp.refusal('{"count": 1, "day": "2026-02-30"}'), '{"status": "invalid", "errors": [{"key": "day", "code": "answer_invalid"}]}', 'a date that does not exist');
SELECT is(pg_temp.refusal('{"count": 1, "day": "2028-02-29", "at": "23:59"}') ->> 'status', 'ok', 'a leap day and the last minute are real');
SELECT is(pg_temp.refusal('{"count": 1, "at": "25:00"}'), '{"status": "invalid", "errors": [{"key": "at", "code": "answer_invalid"}]}', 'an hour past 23');
SELECT is(pg_temp.refusal(jsonb_build_object('count', 1, 'note', repeat('ş', 41))), '{"status": "invalid", "errors": [{"key": "note", "code": "answer_out_of_range"}]}', 'text one character over its limit');
SELECT is(pg_temp.refusal(jsonb_build_object('count', 1, 'note', repeat('ş', 40))) ->> 'status', 'ok', 'text at its limit');
SELECT is(pg_temp.refusal('{"count": 1, "note": "0555 123 45 67"}'), '{"status": "invalid", "errors": [{"key": "note", "code": "contact_info_in_answer"}]}', 'a text answer with a phone number');
SELECT is(pg_temp.refusal('{"count": 1, "kind": true}'), '{"status": "invalid", "errors": [{"key": "kind", "code": "answer_invalid"}]}', 'a boolean for a select');
SELECT is(pg_temp.refusal('[1]'), '{"status": "invalid", "errors": [{"key": null, "code": "answer_invalid"}]}', 'answers as an array');
SELECT is(pg_temp.refusal('null'), '{"status": "invalid", "errors": [{"key": null, "code": "answer_invalid"}]}', 'answers as JSON null');
SELECT is(pg_temp.refusal('{"zzz": 1, "count": 11, "at": "x"}'),
  '{"status": "invalid", "errors": [{"key": "at", "code": "answer_invalid"}, {"key": "count", "code": "answer_out_of_range"}, {"key": "zzz", "code": "answer_unknown"}]}',
  'every fault at once, sorted by key, with no price');
RESET ROLE;

-- ── quote_price refusals, in their order (AC-9) ──────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000001000", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001', NULL, '{}') $$,
  'P0001', 'forbidden', 'no profile: forbidden, before anything else');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010c1", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105004', NULL, NULL, '[]') $$,
  'P0001', 'service_unavailable', 'a service under an off category, before the zone and the answers');
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105005', '00000000-0000-0000-0000-000000102004', NULL, '{}') $$,
  'P0001', 'service_unavailable', 'a service of another region');
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105006', '00000000-0000-0000-0000-000000102001', NULL, '{}') $$,
  'P0001', 'service_unavailable', 'a service with no formula');
SELECT throws_ok($$ SELECT public.quote_price(gen_random_uuid(), '00000000-0000-0000-0000-000000102001', NULL, '{}') $$,
  'P0001', 'service_unavailable', 'a service that does not exist');
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102003', NULL, '[]') $$,
  'P0001', 'zone_unavailable', 'an off zone, before the addons and the answers');
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105001', NULL, NULL, '{}') $$,
  'P0001', 'zone_unavailable', 'a null zone');
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102004', NULL, '{}') $$,
  'P0001', 'zone_unavailable', 'a zone of another region');
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001',
                    ARRAY['00000000-0000-0000-0000-00000010a003']::uuid[], '[]') $$,
  'P0001', 'addon_unavailable', 'an addon of another service, before the answers');
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001',
                    ARRAY['00000000-0000-0000-0000-00000010a001', '00000000-0000-0000-0000-00000010a001']::uuid[], '{}') $$,
  'P0001', 'addon_unavailable', 'one addon twice');
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001',
                    ARRAY['00000000-0000-0000-0000-00000010a002']::uuid[], '{}') $$,
  'P0001', 'addon_unavailable', 'an off addon');
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001',
                    ARRAY[NULL]::uuid[], '{}') $$,
  'P0001', 'addon_unavailable', 'a null addon id');
RESET ROLE;

-- ── settings (AC-8) ──────────────────────────────────────────────────────────
DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'price_rounding_minor';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010c1", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001', NULL, '[]') $$,
  'P0001', 'pricing_settings_invalid', 'a missing rounding unit refuses every quote, before the answers, with no default');
RESET ROLE;
INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', 'price_rounding_minor', '100');
DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'max_price_multiple';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010c1", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001', NULL, '{}') $$,
  'P0001', 'pricing_settings_invalid', 'a missing price multiple too');
RESET ROLE;
INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', 'max_price_multiple', '1');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010c1", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001', NULL,
                    '{"rooms": 3, "bathrooms": 2, "property_type": "apartment", "has_pets": true}') $$,
  'P0001', 'price_out_of_range', 'over the ceiling, a quote refuses');
SELECT is(public.quote_price('00000000-0000-0000-0000-000000105003', '00000000-0000-0000-0000-000000102001', NULL,
          '{"count": 1, "size": 6}') ->> 'price', '100000', 'other answers still price');
RESET ROLE;
UPDATE public.platform_settings SET value = '20' WHERE region = 'TR' AND key = 'max_price_multiple';

-- ── tamper (AC-10, AC-11) ────────────────────────────────────────────────────
CREATE TEMP VIEW money_args AS
  SELECT n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))
     AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proargnames, '{}'::text[])) a
                  WHERE a ~* '(price|amount|total|fee|commission|base)')
     AND p.proname NOT IN ('publish_pricing_formula', 'preview_pricing_formula');
SELECT is_empty($$ SELECT signature FROM money_args $$,
  'no function a customer or provider can run takes an argument named for money (rule 1)');
CREATE FUNCTION public.scratch_quote(p_price bigint) RETURNS bigint LANGUAGE sql SET search_path = '' AS $$ SELECT p_price $$;
GRANT EXECUTE ON FUNCTION public.scratch_quote(bigint) TO authenticated;
SELECT isnt_empty($$ SELECT signature FROM money_args $$, 'the meta test catches a scratch function with a p_price argument');
DROP FUNCTION public.scratch_quote(bigint);
SELECT is_empty(
  $$ SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname ~ '^(pricing_|quote_price|publish_pricing|preview_pricing|catalog_|question_shape|questions_guard)'
        AND p.prosrc ~* 'execute' $$,
  'no pricing function runs a string (rule 8)');
SELECT is_empty(
  $$ SELECT c.table_name || '.' || c.column_name FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name IN ('pricing_formulas', 'pricing_modifiers')
        AND c.column_name ~* '(expression|formula_text|script|code)' $$,
  'no column holds an expression');
SELECT ok(NOT has_function_privilege('authenticated', 'public.pricing_evaluate(bigint, jsonb, jsonb, bigint, numeric, bigint, numeric)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.pricing_compute(text, uuid, bigint, jsonb, uuid, uuid[], jsonb, boolean)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.pricing_answer_errors(jsonb, jsonb, boolean)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.pricing_formula_errors(uuid, bigint, jsonb)', 'EXECUTE'),
  'the engine''s inner functions are internal');
SELECT ok(NOT has_function_privilege('anon', 'public.quote_price(uuid, uuid, uuid[], jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('service_role', 'public.quote_price(uuid, uuid, uuid[], jsonb)', 'EXECUTE'),
  'anon and service_role cannot quote');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010c1", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT public.publish_pricing_formula('00000000-0000-0000-0000-000000105001', 1, 1, '[]') $$,
  'P0001', 'forbidden', 'a customer cannot publish');
SELECT throws_ok($$ SELECT public.preview_pricing_formula('00000000-0000-0000-0000-000000105001', 1, '[]', NULL, NULL, '{}') $$,
  'P0001', 'forbidden', 'a customer cannot preview');
SELECT is_empty($$ SELECT id FROM public.pricing_modifiers $$, 'a customer reads no formula row');
RESET ROLE;

-- ── publishing (AC-12) ───────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010a1", "role": "authenticated"}', true);
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105001', 1, 120000, pg_temp.f()),
  '{"status": "no_changes"}', 'an unchanged draft writes nothing');
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105001', 1, 120000,
          jsonb_set(pg_temp.f(), '{2,factor}', '"1.3"')),
  '{"status": "no_changes"}', 'numbers compare by value: 1.3 equals 1.30');
SELECT throws_ok($$ SELECT public.publish_pricing_formula('00000000-0000-0000-0000-000000105001', 0, 130000, pg_temp.f()) $$,
  'P0001', 'stale_formula', 'a stale expected version');
SELECT throws_ok($$ SELECT public.publish_pricing_formula(gen_random_uuid(), 0, 130000, '[]') $$,
  'P0001', 'service_unavailable', 'a service that does not exist');

SELECT is(pg_temp.err(0, '[]'), '{"status": "invalid_formula", "errors": [{"index": null, "code": "base_price_out_of_range"}]}', 'base_price_out_of_range');
SELECT is(pg_temp.err(100000001, '[]') -> 'errors' -> 0 ->> 'code', 'base_price_out_of_range', 'a base above the limit');
SELECT is(pg_temp.err(1000, (SELECT jsonb_agg(pg_temp.fix(100)) FROM generate_series(1, 51))),
  '{"status": "invalid_formula", "errors": [{"index": null, "code": "too_many_modifiers"}]}', 'too_many_modifiers');
SELECT is(pg_temp.err(1000, '{}'), '{"status": "invalid_formula", "errors": [{"index": null, "code": "modifier_malformed"}]}', 'modifiers that are not an array');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.mul('1.23456'))) -> 'errors', '[{"index": 1, "code": "modifier_malformed"}]', 'a factor of 1.23456');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.fix(1) || '{"amount": 100.5}')) -> 'errors', '[{"index": 1, "code": "modifier_malformed"}]', 'an amount of 100.5');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.fix(1) || '{"amount": "100"}')) -> 'errors', '[{"index": 1, "code": "modifier_malformed"}]', 'an amount as a string');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.mul('1.3') || '{"factor": 1.3}')) -> 'errors', '[{"index": 1, "code": "modifier_malformed"}]', 'a factor as a number');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.fix(1) || '{"extra": 1}')) -> 'errors', '[{"index": 1, "code": "modifier_malformed"}]', 'an extra key');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.fix(1) || '{"factor": "1.1"}')) -> 'errors', '[{"index": 1, "code": "modifier_malformed"}]', 'an amount and a factor');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.mul('1.1') - 'factor')) -> 'errors', '[{"index": 1, "code": "modifier_malformed"}]', 'a missing factor');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.fix(1) || '{"match_type": "sometimes"}')) -> 'errors', '[{"index": 1, "code": "modifier_malformed"}]', 'an unknown match type');
SELECT is(pg_temp.err(1000, '[{"question_key": "rooms", "match_type": "range", "match_value": {"min": 5, "max": 3}, "effect_type": "FIXED", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "modifier_malformed"}]', 'a range with min above max');
SELECT is(pg_temp.err(1000, '[{"question_key": "rooms", "match_type": "range", "match_value": {"min": 3}, "effect_type": "FIXED", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "modifier_malformed"}]', 'a range with no max');
SELECT is(pg_temp.err(1000, '[{"question_key": "property_type", "match_type": "in", "match_value": [], "effect_type": "FIXED", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "modifier_malformed"}]', 'an empty in');
SELECT is(pg_temp.err(1000, '[{"question_key": "property_type", "match_type": "in", "match_value": ["villa", "villa"], "effect_type": "FIXED", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "modifier_malformed"}]', 'a repeated in');
SELECT is(pg_temp.err(1000, '[{"question_key": "rooms", "match_type": "equals", "match_value": 2.5, "effect_type": "FIXED", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "modifier_malformed"}]', 'a fractional equals on a number');
SELECT is(pg_temp.err(1000, '[{"question_key": "has_pets", "match_type": "is_true", "match_value": true, "effect_type": "FIXED", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "modifier_malformed"}]', 'a value where the match takes none');
SELECT is(pg_temp.err(1000, '[{"question_key": "zzz", "match_type": "always", "match_value": null, "effect_type": "FIXED", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "question_not_priced"}]', 'an unknown question');
SELECT is(pg_temp.err(1000, '[{"question_key": "notes", "match_type": "always", "match_value": null, "effect_type": "FIXED", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "question_not_priced"}]', 'a question that does not affect the price');
SELECT is(pg_temp.err(1000, '[{"question_key": "size", "match_type": "always", "match_value": null, "effect_type": "FIXED", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "question_not_priced"}]', 'a question outside this service''s questions');
SELECT is(pg_temp.err(1000, '[{"question_key": "garden", "match_type": "is_true", "match_value": null, "effect_type": "FIXED", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "question_not_required"}]', 'a formula on an optional boolean is refused, or a customer could skip a surcharge');
SELECT is(pg_temp.err(1000, '[{"question_key": "rooms", "match_type": "is_true", "match_value": null, "effect_type": "FIXED", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "match_not_allowed"}]', 'is_true on a number');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.fix(1) || '{"match_type": "equals", "match_value": "a"}')) -> 'errors',
  '[{"index": 1, "code": "match_not_allowed"}]', 'no question, a match other than always');
SELECT is(pg_temp.err(1000, '[{"question_key": "property_type", "match_type": "equals", "match_value": "villa", "effect_type": "PER_UNIT", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "effect_not_allowed"}]', 'PER_UNIT on a select');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.fix(1) || '{"effect_type": "PER_UNIT"}')) -> 'errors',
  '[{"index": 1, "code": "effect_not_allowed"}]', 'PER_UNIT with no question');
SELECT is(pg_temp.err(1000, '[{"question_key": "property_type", "match_type": "equals", "match_value": "castle", "effect_type": "FIXED", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "option_unknown"}]', 'an unknown option');
SELECT is(pg_temp.err(1000, '[{"question_key": "property_type", "match_type": "in", "match_value": ["villa", "castle"], "effect_type": "FIXED", "amount": 1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "option_unknown"}]', 'an unknown option in a list');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.fix(0))) -> 'errors', '[{"index": 1, "code": "amount_out_of_range"}]', 'a fixed amount of 0');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.fix(100000001))) -> 'errors', '[{"index": 1, "code": "amount_out_of_range"}]', 'a fixed amount above the limit');
SELECT is(pg_temp.err(1000, '[{"question_key": "rooms", "match_type": "always", "match_value": null, "effect_type": "PER_UNIT", "amount": -1, "factor": null}]') -> 'errors',
  '[{"index": 1, "code": "amount_out_of_range"}]', 'a negative PER_UNIT');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.mul('10.5'))) -> 'errors', '[{"index": 1, "code": "factor_out_of_range"}]', 'a factor above 10');
SELECT is(pg_temp.err(1000, jsonb_build_array(pg_temp.mul('0.05'))) -> 'errors', '[{"index": 1, "code": "factor_out_of_range"}]', 'a factor below 0.1');
SELECT is(pg_temp.err(0, jsonb_build_array(pg_temp.fix(1), pg_temp.fix(0), pg_temp.mul('11'))) -> 'errors',
  '[{"index": null, "code": "base_price_out_of_range"}, {"index": 2, "code": "amount_out_of_range"}, {"index": 3, "code": "factor_out_of_range"}]',
  'every error at once, each on its own card');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.pricing_formulas WHERE service_id = '00000000-0000-0000-0000-000000105001'), 1,
  'no refused draft wrote a formula');

-- Publish version 2 and 3, then look at history.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010a1", "role": "authenticated"}', true);
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105001', 1, 120000,
          jsonb_set(pg_temp.f(), '{0,amount}', '45000')) ->> 'version', '2', 'a changed modifier publishes version 2');
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105001', 2, 125000,
          jsonb_set(pg_temp.f(), '{0,amount}', '45000')) ->> 'version', '3', 'a changed base publishes version 3');
UPDATE public.services SET active = false WHERE id = '00000000-0000-0000-0000-000000105003';
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105003', 1, 110000,
  '[{"question_key": "size", "match_type": "range", "match_value": {"min": 3, "max": 5}, "effect_type": "PER_UNIT", "amount": 10000, "factor": null}]') ->> 'version',
  '2', 'an off service publishes');
UPDATE public.services SET active = true WHERE id = '00000000-0000-0000-0000-000000105003';
RESET ROLE;
SELECT results_eq(
  $$ SELECT version, base_price, active, created_by::text FROM public.pricing_formulas
      WHERE service_id = '00000000-0000-0000-0000-000000105001' ORDER BY version $$,
  $$ VALUES (1, 120000::bigint, false, '00000000-0000-0000-0000-0000000010a1'),
            (2, 120000::bigint, false, '00000000-0000-0000-0000-0000000010a1'),
            (3, 125000::bigint, true, '00000000-0000-0000-0000-0000000010a1') $$,
  'three versions, one active, each by its admin');
SELECT results_eq(
  $$ SELECT m.apply_order, m.question_key::text COLLATE "default", m.amount, m.factor FROM public.pricing_modifiers m
       JOIN public.pricing_formulas f ON f.id = m.formula_id
      WHERE f.service_id = '00000000-0000-0000-0000-000000105001' AND f.version = 1 ORDER BY m.apply_order $$,
  $$ VALUES (1, 'rooms', 40000::bigint, NULL::numeric), (2, 'bathrooms', 25000::bigint, NULL), (3, 'property_type', NULL, 1.3000),
            (4, 'has_pets', 20000::bigint, NULL), (5, 'property_type', -40000::bigint, NULL) $$,
  'version 1 is unchanged after three publishes');
SELECT results_eq(
  $$ SELECT actor_id::text, region, old_value, new_value FROM public.audit_log
      WHERE action = 'pricing.formula_published' AND entity_type = 'pricing_formula'
        AND entity_id IN (SELECT id::text FROM public.pricing_formulas WHERE service_id = '00000000-0000-0000-0000-000000105001')
      ORDER BY id $$,
  $$ VALUES ('00000000-0000-0000-0000-0000000010a1', 'TR', NULL::jsonb, '{"version": 1, "base_price": 120000}'::jsonb),
            ('00000000-0000-0000-0000-0000000010a1', 'TR', '{"version": 1, "base_price": 120000}'::jsonb, '{"version": 2, "base_price": 120000}'::jsonb),
            ('00000000-0000-0000-0000-0000000010a1', 'TR', '{"version": 2, "base_price": 120000}'::jsonb, '{"version": 3, "base_price": 125000}'::jsonb) $$,
  'each publish writes pricing.formula_published with the old and new version and base');

-- History never changes, even as postgres (AC-12).
SELECT throws_ok($$ UPDATE public.pricing_formulas SET base_price = 1 WHERE service_id = '00000000-0000-0000-0000-000000105001' AND version = 1 $$,
  'P0001', 'pricing_history_immutable', 'a published base price never changes, even as postgres');
SELECT throws_ok($$ UPDATE public.pricing_formulas SET active = true WHERE service_id = '00000000-0000-0000-0000-000000105001' AND version = 1 $$,
  'P0001', 'pricing_history_immutable', 'an old version never comes back');
SELECT throws_ok($$ UPDATE public.pricing_formulas SET active = false, base_price = 1 WHERE service_id = '00000000-0000-0000-0000-000000105001' AND version = 3 $$,
  'P0001', 'pricing_history_immutable', 'switching off may change nothing else');
SELECT throws_ok($$ DELETE FROM public.pricing_modifiers WHERE region = 'TR' $$,
  'P0001', 'pricing_history_immutable', 'a modifier is never deleted, even as postgres');
SELECT throws_ok($$ UPDATE public.pricing_modifiers SET amount = 1 WHERE region = 'TR' $$,
  'P0001', 'pricing_history_immutable', 'a modifier is never updated');
SELECT throws_ok($$ DELETE FROM public.pricing_formulas WHERE region = 'TR' $$,
  'P0001', 'pricing_history_immutable', 'a formula is never deleted');
SELECT throws_ok($$ INSERT INTO public.pricing_formulas (service_id, region, version, base_price, active)
                    VALUES ('00000000-0000-0000-0000-000000105001', 'TR', 9, 100, true) $$,
  '23505', NULL, 'a service has at most one active formula');

-- ── preview (AC-13) ──────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010a1", "role": "authenticated"}', true);
CREATE TEMP TABLE same_number AS SELECT
  public.preview_pricing_formula('00000000-0000-0000-0000-000000105001', 125000, jsonb_set(pg_temp.f(), '{0,amount}', '45000'),
    '00000000-0000-0000-0000-000000102002', ARRAY['00000000-0000-0000-0000-00000010a001']::uuid[],
    '{"rooms": 3, "bathrooms": 2, "property_type": "villa", "has_pets": true}') AS preview,
  public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102002',
    ARRAY['00000000-0000-0000-0000-00000010a001']::uuid[],
    '{"rooms": 3, "bathrooms": 2, "property_type": "villa", "has_pets": true}') AS quote;
SELECT is((SELECT (preview - 'formula_id' - 'formula_version') #- '{breakdown,modifiers}' FROM same_number),
          (SELECT (quote - 'formula_id' - 'formula_version') #- '{breakdown,modifiers}' FROM same_number),
  'a preview and the quote after publishing the same draft give the same output');
SELECT is((SELECT jsonb_path_query_array(preview, '$.breakdown.modifiers[*] ? (@.fired == true)') FROM same_number),
          (SELECT quote -> 'breakdown' -> 'modifiers' FROM same_number),
  'the fired lines are the same lines');
SELECT is((SELECT jsonb_build_array(preview -> 'formula_id', preview -> 'formula_version') FROM same_number), '[null, null]',
  'a preview has null ids and version');
SELECT is((SELECT preview -> 'breakdown' -> 'modifiers' -> 4 FROM same_number),
  '{"question_key": "property_type", "match_type": "equals", "match_value": "studio", "effect_type": "FIXED", "amount": -40000, "factor": null, "units": null, "fired": false}',
  'a preview shows every line, fired or not');
SELECT is(public.preview_pricing_formula('00000000-0000-0000-0000-000000105001', 120000, pg_temp.f(),
    '00000000-0000-0000-0000-000000102003', ARRAY['00000000-0000-0000-0000-00000010a002']::uuid[],
    '{"rooms": 3, "bathrooms": 2, "property_type": "apartment", "has_pets": true}') ->> 'price',
  '320000', 'a preview prices with an off zone and an off addon');
SELECT is((public.preview_pricing_formula('00000000-0000-0000-0000-000000105001', 120000, pg_temp.f(), NULL, NULL,
    '{"rooms": 3, "bathrooms": 2, "property_type": "apartment", "has_pets": true}') -> 'breakdown') - 'modifiers'::text - 'addons'::text,
  '{"base": 120000, "zone": null, "unrounded": "310000", "rounding_minor": 100}',
  'a preview with no zone multiplies by 1');
SELECT is(public.preview_pricing_formula('00000000-0000-0000-0000-000000105001', 120000, pg_temp.f(), NULL, NULL,
    '{"rooms": 3, "bathrooms": 2, "property_type": "apartment", "has_pets": true, "notes": "0555 123 45 67"}') ->> 'price',
  '310000', 'a preview checks only priced questions');
SELECT is(public.preview_pricing_formula('00000000-0000-0000-0000-000000105001', 120000, pg_temp.f(), NULL, NULL, '{"rooms": 3}'),
  '{"status": "invalid", "errors": [{"key": "bathrooms", "code": "answer_required"}, {"key": "has_pets", "code": "answer_required"}, {"key": "property_type", "code": "answer_required"}]}',
  'a preview with priced questions unanswered shows no total');
SELECT is(public.preview_pricing_formula('00000000-0000-0000-0000-000000105001', 120000, jsonb_build_array(pg_temp.fix(0)), NULL, NULL, '{}'),
  '{"status": "invalid_formula", "errors": [{"index": 1, "code": "amount_out_of_range"}]}',
  'a preview runs the formula checks first');
SELECT throws_ok($$ SELECT public.preview_pricing_formula('00000000-0000-0000-0000-000000105001', 100000,
                    jsonb_build_array(pg_temp.mul('10'), pg_temp.mul('2.01')), NULL, NULL,
                    '{"rooms": 1, "bathrooms": 1, "property_type": "apartment", "has_pets": false}') $$,
  'P0001', 'price_out_of_range', 'a preview shows the ceiling before publish');
SELECT is((SELECT count(*)::int FROM public.pricing_formulas WHERE service_id = '00000000-0000-0000-0000-000000105001'), 3,
  'a preview writes nothing');
RESET ROLE;

-- ── the question guard (AC-4) ────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010a1", "role": "authenticated"}', true);
SELECT throws_ok($$ UPDATE public.questions SET active = false WHERE key = 'has_pets' $$,
  'P0001', 'question_in_use', 'a question the active formula reads cannot be turned off');
SELECT throws_ok($$ UPDATE public.questions SET affects_pricing = false WHERE key = 'has_pets' $$,
  'P0001', 'question_in_use', 'nor lose affects_pricing');
SELECT throws_ok($$ UPDATE public.questions SET required = false WHERE key = 'has_pets' $$,
  'P0001', 'question_in_use', 'nor stop being required');
SELECT throws_ok($$ UPDATE public.questions SET options = '[{"value": "apartment", "label": {"tr": "Daire"}}, {"value": "studio", "label": {"tr": "Stüdyo"}}]'
                    WHERE key = 'property_type' $$,
  'P0001', 'question_in_use', 'nor lose an option a modifier matches');
SELECT lives_ok($$ UPDATE public.questions SET options = '[{"value": "villa", "label": {"tr": "Villa"}}, {"value": "studio", "label": {"tr": "Stüdyo"}}]'
                   WHERE key = 'property_type' $$,
  'an option no modifier matches can go');
SELECT lives_ok($$ UPDATE public.questions SET label = '{"tr": "Evcil hayvan"}' WHERE key = 'has_pets' $$,
  'a label can change while in use');
SELECT lives_ok($$ UPDATE public.questions SET required = false WHERE key = 'extras' $$,
  'a multi select in use may be optional');
SELECT lives_ok($$ UPDATE public.questions SET active = false WHERE key = 'garden' $$,
  'a question no formula reads can be turned off');
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105001', 3, 125000,
          jsonb_build_array(pg_temp.f() -> 0, pg_temp.f() -> 1)) ->> 'version', '4',
  'publish a version without the question first');
SELECT lives_ok($$ UPDATE public.questions SET required = false, affects_pricing = false, active = false,
                          options = CASE WHEN type = 'boolean' THEN NULL ELSE '[{"value": "apartment", "label": {"tr": "Daire"}}]'::jsonb END
                    WHERE key IN ('has_pets', 'property_type') $$,
  'then all four work');
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105001', 4, 125000, pg_temp.f()) -> 'errors',
  '[{"index": 3, "code": "question_not_priced"}, {"index": 4, "code": "question_not_priced"}, {"index": 5, "code": "question_not_priced"}]',
  'a formula cannot read a retired question');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
