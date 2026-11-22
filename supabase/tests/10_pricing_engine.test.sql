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

SELECT plan(183);

-- 07's cross key check on the fee settings is deferred; this file rewrites the rounding unit and then
-- lifts a trigger, which a pending deferred event forbids, so the check runs per statement here.
SET CONSTRAINTS fee_settings_guard IMMEDIATE;

-- Since 04 (spec 0008 AC-28, D142), quote_price has no authenticated grant: a customer reaches it only through
-- quote_request and create_request, which count against the quote rate limit. This file still proves the
-- engine end to end as a real customer, so it grants it back for this rolled back transaction only;
-- supabase/tests/12 proves the grant is gone.
GRANT EXECUTE ON FUNCTION public.quote_price(uuid, uuid, uuid[], jsonb) TO authenticated;

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
  ('00000000-0000-0000-0000-000000105006', '00000000-0000-0000-0000-00000010c001', 'TR', '{"tr": "Ofis"}', 2, 4, true),
  ('00000000-0000-0000-0000-000000105007', '00000000-0000-0000-0000-00000010c001', 'TR', '{"tr": "Kapalı hizmet"}', 2, 4, false);
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
-- The same twice: the first answer is stored by one statement and read back by another, so a planner
-- folding two identical calls in one statement cannot make this pass; the whole output is compared.
CREATE TEMP TABLE first_run AS
  SELECT public.pricing_evaluate(120000, pg_temp.f(), '{"rooms": 3, "bathrooms": 2, "property_type": "villa", "has_pets": true}', 40000, 1.15, 100, 20) AS r;
SELECT is(public.pricing_evaluate(120000, pg_temp.f(), '{"rooms": 3, "bathrooms": 2, "property_type": "villa", "has_pets": true}', 40000, 1.15, 100, 20),
          (SELECT r FROM first_run),
  'the same inputs give the same output, across two statements');

-- The seeded loop: 300 random formulas, each a whole multiple of the unit between the floor and the
-- ceiling, or refused, and one more positive amount never lowers a price.
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
       SELECT g, base, pg_temp.ev(base, mods, '{}', addons, mult) AS r,
              pg_temp.ev(base, mods || jsonb_build_array(pg_temp.fix(10000)), '{}', addons, mult) AS r2
         FROM loop_cases) x
      WHERE (r ->> 'status' = 'ok' AND r2 ->> 'status' = 'ok' AND (r2 ->> 'price')::bigint < (r ->> 'price')::bigint)
         OR (r ->> 'status' = 'ok' AND ((r ->> 'price')::bigint % 100 <> 0
                                        OR (r ->> 'price')::bigint < 100
                                        OR (r ->> 'price')::bigint > base * 20))
         OR (r ->> 'status' NOT IN ('ok', 'price_out_of_range')) $$,
  '300 seeded formulas: every price a whole multiple of the unit, inside the floor and the ceiling, or refused, and monotonic');
SELECT ok((SELECT count(*) FROM loop_cases WHERE pg_temp.ev(base, mods, '{}', addons, mult) ->> 'status' = 'ok') BETWEEN 30 AND 290,
  'the loop reaches both prices and refusals');

-- A second seeded loop over the branchy lines: PER_UNIT, equals, in and range on a number, a select, a
-- multi select and is_true on a boolean, against random answers (review of PR #27). The same two properties hold.
CREATE FUNCTION pg_temp.branchy(k integer) RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT CASE k % 8
    WHEN 0 THEN jsonb_build_object('question_key', 'q', 'match_type', 'always', 'match_value', null,
                                   'effect_type', 'PER_UNIT', 'amount', (1 + floor(random() * 50000))::bigint, 'factor', null)
    WHEN 1 THEN jsonb_build_object('question_key', 'q', 'match_type', 'range', 'match_value', '{"min": 2, "max": 6}'::jsonb,
                                   'effect_type', 'FIXED', 'amount', (floor(random() * 200001) - 100000)::bigint * 10 + 1, 'factor', null)
    WHEN 2 THEN jsonb_build_object('question_key', 'q', 'match_type', 'equals', 'match_value', 3,
                                   'effect_type', 'MULTIPLIER', 'amount', null, 'factor', (round((0.1 + random() * 9.9)::numeric, 4))::text)
    WHEN 3 THEN jsonb_build_object('question_key', 's', 'match_type', 'in', 'match_value', '["a", "b"]'::jsonb,
                                   'effect_type', 'FIXED', 'amount', (1 + floor(random() * 90000))::bigint, 'factor', null)
    WHEN 4 THEN jsonb_build_object('question_key', 's', 'match_type', 'equals', 'match_value', 'c',
                                   'effect_type', 'MULTIPLIER', 'amount', null, 'factor', (round((0.1 + random() * 9.9)::numeric, 4))::text)
    WHEN 5 THEN jsonb_build_object('question_key', 'm', 'match_type', 'equals', 'match_value', 'a',
                                   'effect_type', 'FIXED', 'amount', (1 + floor(random() * 90000))::bigint, 'factor', null)
    WHEN 6 THEN jsonb_build_object('question_key', 'm', 'match_type', 'in', 'match_value', '["b", "c"]'::jsonb,
                                   'effect_type', 'FIXED', 'amount', (1 + floor(random() * 90000))::bigint, 'factor', null)
    ELSE jsonb_build_object('question_key', 'b', 'match_type', 'is_true', 'match_value', null,
                            'effect_type', 'MULTIPLIER', 'amount', null, 'factor', (round((0.1 + random() * 9.9)::numeric, 4))::text)
  END $$;
SELECT setseed(0.17);
CREATE TEMP TABLE branchy_cases AS
  SELECT g,
         (1 + floor(random() * 1000000))::bigint AS base,
         (SELECT jsonb_agg(pg_temp.branchy((floor(random() * 8))::integer)) FROM generate_series(1, 1 + g % 6) k WHERE g > 0) AS mods,
         jsonb_build_object(
           'q', (floor(random() * 11))::integer,
           's', (ARRAY['a', 'b', 'c'])[1 + floor(random() * 3)::integer],
           'm', (SELECT coalesce(jsonb_agg(v), '[]'::jsonb) FROM unnest(ARRAY['a', 'b', 'c']) v WHERE random() < 0.5 AND g > 0),
           'b', random() < 0.5) AS answers,
         (floor(random() * 100000))::bigint AS addons,
         round((0.5 + random() * 1.5)::numeric, 2) AS mult
    FROM generate_series(1, 300) g;
SELECT is_empty(
  $$ SELECT g FROM (
       SELECT g, base, pg_temp.ev(base, mods, answers, addons, mult) AS r,
              pg_temp.ev(base, mods || jsonb_build_array(pg_temp.fix(10000)), answers, addons, mult) AS r2
         FROM branchy_cases) x
      WHERE (r ->> 'status' = 'ok' AND r2 ->> 'status' = 'ok' AND (r2 ->> 'price')::bigint < (r ->> 'price')::bigint)
         OR (r ->> 'status' = 'ok' AND ((r ->> 'price')::bigint % 100 <> 0
                                        OR (r ->> 'price')::bigint < 100
                                        OR (r ->> 'price')::bigint > base * 20))
         OR (r ->> 'status' NOT IN ('ok', 'price_out_of_range')) $$,
  '300 seeded formulas on number, select, multi select and boolean lines: whole units, in range or refused, monotonic');
SELECT ok(
  (SELECT count(*) FILTER (WHERE (l ->> 'fired')::boolean) FROM branchy_cases, pg_temp.ev(base, mods, answers, addons, mult) r,
          jsonb_array_elements(coalesce(r -> 'modifiers', '[]'::jsonb)) l) BETWEEN 100 AND 1500
  AND (SELECT count(*) FILTER (WHERE NOT (l ->> 'fired')::boolean) FROM branchy_cases, pg_temp.ev(base, mods, answers, addons, mult) r,
          jsonb_array_elements(coalesce(r -> 'modifiers', '[]'::jsonb)) l) > 50,
  'the branchy loop fires lines and leaves lines unfired');

-- The browser's match table (lib/catalog/options.ts MATCH_TABLE) equals this JSON; tests/catalog-lib.test.ts
-- reads it from here, and this test proves it against pricing_formula_errors, so the two cannot drift.
CREATE FUNCTION pg_temp.match_table() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $mt$ SELECT $json$
{
  "number": { "always": ["FIXED", "PER_UNIT", "MULTIPLIER"], "equals": ["FIXED", "PER_UNIT", "MULTIPLIER"], "range": ["FIXED", "PER_UNIT", "MULTIPLIER"] },
  "single_select": { "equals": ["FIXED", "MULTIPLIER"], "in": ["FIXED", "MULTIPLIER"] },
  "multi_select": { "equals": ["FIXED"], "in": ["FIXED"] },
  "boolean": { "is_true": ["FIXED", "MULTIPLIER"] },
  "none": { "always": ["FIXED", "MULTIPLIER"] }
}
$json$::jsonb $mt$;
SELECT is_empty(
  $$ WITH kinds(kind, key, service) AS (VALUES
       ('number', 'rooms', '00000000-0000-0000-0000-000000105001'::uuid),
       ('single_select', 'property_type', '00000000-0000-0000-0000-000000105001'::uuid),
       ('multi_select', 'extras', '00000000-0000-0000-0000-000000105002'::uuid),
       ('boolean', 'has_pets', '00000000-0000-0000-0000-000000105001'::uuid),
       ('none', NULL, '00000000-0000-0000-0000-000000105001'::uuid)),
     combos AS (
       SELECT k.kind, k.key, k.service, m.match, e.effect
         FROM kinds k, unnest(ARRAY['always', 'equals', 'in', 'range', 'is_true']) m(match),
              unnest(ARRAY['FIXED', 'PER_UNIT', 'MULTIPLIER']) e(effect)),
     judged AS (
       SELECT c.*, public.pricing_formula_errors(c.service, 100000, jsonb_build_array(jsonb_build_object(
                'question_key', c.key, 'match_type', c.match, 'effect_type', c.effect,
                'match_value', CASE c.match
                  WHEN 'equals' THEN CASE c.kind WHEN 'number' THEN '1'::jsonb WHEN 'single_select' THEN '"villa"'
                                                 WHEN 'multi_select' THEN '"a"' ELSE '"x"' END
                  WHEN 'in' THEN CASE c.kind WHEN 'single_select' THEN '["villa"]'::jsonb WHEN 'multi_select' THEN '["a"]' ELSE '["x"]' END
                  WHEN 'range' THEN '{"min": 1, "max": 2}'::jsonb
                  ELSE 'null'::jsonb END,
                'amount', CASE WHEN c.effect = 'MULTIPLIER' THEN NULL ELSE 100 END,
                'factor', CASE WHEN c.effect = 'MULTIPLIER' THEN '1.1' END))) AS errors
         FROM combos c)
     SELECT kind, match, effect FROM judged
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(errors) x
                         WHERE x ->> 'code' IN ('match_not_allowed', 'effect_not_allowed'))
            <> coalesce((pg_temp.match_table() -> kind -> match) ? effect, false) $$,
  'the match table JSON equals what pricing_formula_errors allows, for all 75 combinations');

-- Every invisible mark counts as blank, in both copies of the pattern (review of PR #27).
SELECT is_empty(
  $$ SELECT to_hex(cp) FROM unnest(ARRAY[173, 847, 1564, 6158, 8206, 8207, 8234, 8235, 8236, 8237, 8238,
                                         8289, 8290, 8291, 8292, 8294, 8295, 8296, 8297, 8203, 160, 65279]) cp
      WHERE public.catalog_trim(chr(cp) || chr(cp)) <> ''
         OR NOT public.pricing_answer_blank(to_jsonb(chr(cp)))
         OR public.catalog_text_ok(jsonb_build_object('tr', chr(cp)), 'TR', 10) $$,
  'LRM, RLM, ALM, the soft hyphen, bidi controls and the other invisible marks are blank everywhere');

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
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105007', 0, 100000, '[]') ->> 'status', 'ok',
  'an off service under an on category can publish');
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105004', 0, 100000, '[]') ->> 'status', 'ok',
  'a service under an off category can publish');
RESET ROLE;
-- A KSA formula as a fixture, through the same door publish uses (pricing_history_guard refuses it otherwise).
SELECT set_config('pricing.publishing', 'on', true);
INSERT INTO public.pricing_formulas (service_id, region, version, base_price, active)
  VALUES ('00000000-0000-0000-0000-000000105005', 'KSA', 1, 100000, true);
SELECT set_config('pricing.publishing', 'off', true);

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
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105007', '00000000-0000-0000-0000-000000102001', NULL, '{}') $$,
  'P0001', 'service_unavailable', 'an off service, under an on category and with a formula');
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
SELECT throws_ok($$ DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'price_rounding_minor' $$,
  'P0001', 'pricing_setting_required', 'the rounding unit cannot be deleted, even as postgres');
SELECT throws_ok($$ UPDATE public.platform_settings SET key = 'price_rounding_old' WHERE region = 'TR' AND key = 'max_price_multiple' $$,
  'P0001', 'pricing_setting_required', 'nor can the price multiple be renamed away');
SELECT lives_ok($$ UPDATE public.platform_settings SET value = '100' WHERE region = 'TR' AND key = 'price_rounding_minor' $$,
  'a value may still change, inside the checks');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010a1", "role": "authenticated"}', true);
SELECT throws_ok($$ DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'max_price_multiple' $$,
  'P0001', 'pricing_setting_required', 'an admin token, which the settings policy lets write, cannot delete it either');
RESET ROLE;
-- A missing row can still happen by migration; simulate it in this rolled back transaction.
ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard;
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
ALTER TABLE public.platform_settings ENABLE TRIGGER pricing_settings_guard;
UPDATE public.platform_settings SET value = '100.0' WHERE region = 'TR' AND key = 'price_rounding_minor';
INSERT INTO public.questions (category_id, region, key, label, type, validation, active)
  VALUES ('00000000-0000-0000-0000-00000010c002', 'TR', 'memo', '{"tr": "Not"}', 'text', '{"maxLength": 200.0}', true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010c1", "role": "authenticated"}', true);
SELECT is(pg_temp.refusal('{"count": 1, "extras": ["a"], "memo": "kısa not"}') ->> 'price', '105000',
  'a rounding unit stored as 100.0 and a maxLength stored as 200.0 still price');
SELECT is(pg_temp.refusal(jsonb_build_object('count', 1, 'memo', repeat('ş', 201))) -> 'errors',
  '[{"key": "memo", "code": "answer_out_of_range"}]', 'and 200.0 still limits the answer to 200');
RESET ROLE;
UPDATE public.questions SET active = false WHERE key = 'memo';
UPDATE public.platform_settings SET value = '100' WHERE region = 'TR' AND key = 'price_rounding_minor';

-- ── size caps (security review 2026-11-15) ───────────────────────────────────
CREATE FUNCTION pg_temp.timed_refusal(p_answers jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  t0 timestamptz := clock_timestamp();
  r jsonb;
BEGIN
  r := public.quote_price('00000000-0000-0000-0000-000000105002', '00000000-0000-0000-0000-000000102001', NULL, p_answers);
  RETURN jsonb_build_object('result', r, 'seconds', extract(epoch FROM clock_timestamp() - t0));
END;
$fn$;
GRANT EXECUTE ON FUNCTION pg_temp.timed_refusal(jsonb) TO authenticated;
CREATE TEMP TABLE big_answers AS
  SELECT jsonb_object_agg('junk_' || g, 1) AS answers FROM generate_series(1, 200000) g;
GRANT SELECT ON big_answers TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010c1", "role": "authenticated"}', true);
CREATE TEMP TABLE big_result AS SELECT pg_temp.timed_refusal(answers) AS r FROM big_answers;
SELECT is((SELECT r -> 'result' FROM big_result),
  '{"status": "invalid", "errors": [{"key": null, "code": "answer_invalid"}]}',
  '200,000 junk keys come back as one answer_invalid');
SELECT ok((SELECT (r ->> 'seconds')::numeric FROM big_result) < 1,
  'and fast, with no work per key');
SELECT is(jsonb_array_length(pg_temp.refusal(
    (SELECT jsonb_object_agg('junk_' || g, 1) FROM generate_series(1, 90) g) || '{"count": 1}') -> 'errors'), 50,
  'at most 50 errors come back');
SELECT throws_ok($$ SELECT public.quote_price('00000000-0000-0000-0000-000000105001', '00000000-0000-0000-0000-000000102001',
                    (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 51)), '{}') $$,
  'P0001', 'addon_unavailable', 'more than 50 addons are refused before any lookup');
RESET ROLE;

-- ── tamper (AC-10, AC-11) ────────────────────────────────────────────────────
CREATE TEMP VIEW money_args AS
  SELECT n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))
     AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proargnames, '{}'::text[])) a
                  WHERE a ~* '(price|amount|total|fee|commission|base|factor|multiplier|rounding|cost|discount|unit)'
                    -- The one exemption (spec 0008 AC-10, D140): the figures the customer saw, compared and never
                    -- stored. Keyed on the function and the argument pair; supabase/tests/12 reads the source.
                    AND NOT (p.oid = 'public.create_request(uuid, uuid, uuid, uuid[], jsonb, date, integer, text, text, bigint, bigint)'::regprocedure
                             AND a IN ('p_expected_price', 'p_expected_commission'))
                    -- The second (spec 0011-07 AC-2, R-12): the fee formula, granted to signed in users by the
                    -- spec. It stores nothing and returns a figure from the settings; every figure that is
                    -- frozen or shown is computed in the database from a stored price.
                    AND NOT (p.oid = 'public.provider_fee_for(text, bigint)'::regprocedure AND a = 'p_price'))
     AND p.proname NOT IN ('publish_pricing_formula', 'preview_pricing_formula');
SELECT is_empty($$ SELECT signature FROM money_args $$,
  'no function a customer or provider can run takes an argument named for money (rule 1)');
CREATE FUNCTION public.scratch_quote(p_price bigint) RETURNS bigint LANGUAGE sql SET search_path = '' AS $$ SELECT p_price $$;
GRANT EXECUTE ON FUNCTION public.scratch_quote(bigint) TO authenticated;
SELECT isnt_empty($$ SELECT signature FROM money_args $$, 'the meta test catches a scratch function with a p_price argument');
DROP FUNCTION public.scratch_quote(bigint);
-- Rule 8 over every function we own, not only the pricing ones: no dynamic SQL, and no format() feeding one.
-- A function that needs one is named here, with its reason, after review.
CREATE TEMP TABLE allowed_dynamic (proname text PRIMARY KEY);
SELECT is_empty(
  $$ SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
        AND (p.prosrc ~* '\mexecute\M' OR p.prosrc ~* 'format\s*\(')
        AND p.proname NOT IN (SELECT proname FROM allowed_dynamic) $$,
  'no function in public runs a string or builds one with format() (rule 8)');
-- Every definer function a signed in user can run, reviewed by name: a new grant fails here until it is added.
SELECT set_eq(
  $$ SELECT n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')'
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') $$,
  $$ VALUES ('public.accept_provider_docs_consent(text)'),
            ('public.admin_mark_refund_done(uuid, text)'),
            ('public.admin_may_read(uuid, text)'),
            ('public.admin_refund_fee(uuid, text)'),
            ('public.admin_request_detail(uuid)'),
            -- Spec 0011-16: admin operations (the list, cancel, extend, flags, the street line, revenue).
            ('public.admin_cancel_request(uuid, text, text)'),
            ('public.admin_clear_flag(uuid, text)'),
            ('public.admin_extend_deadline(uuid, text, integer, text)'),
            ('public.admin_flags(integer)'),
            ('public.admin_request_address(uuid, text)'),
            ('public.admin_requests(text, text, date, date, boolean, integer)'),
            ('public.admin_revenue(date, date, text)'),
            -- Spec 0011-17: ratings. The customer's rating and its form, the provider's own summary, admin's list and hide.
            ('public.rate_provider(uuid, integer, integer, integer, integer)'),
            ('public.request_rating(uuid)'),
            ('public.my_provider_rating()'),
            ('public.admin_provider_ratings(uuid, integer)'),
            ('public.admin_hide_rating(uuid, text, text)'),
            ('public.cancel_preview(uuid)'),
            ('public.provider_cancel_job(uuid)'),
            ('public.withdraw_application(uuid)'),
            -- Spec 0011-14: the parties' report functions, admin's report functions and the storage check.
            ('public.acknowledge_warning(uuid)'),
            ('public.add_report_photo(uuid, text)'),
            ('public.admin_report_detail(uuid)'),
            ('public.admin_reports(text, integer)'),
            ('public.admin_reports_open_count()'),
            ('public.handle_report(uuid, text, text, uuid, text)'),
            ('public.log_report_photo_view(uuid)'),
            ('public.my_report(uuid)'),
            ('public.my_warning()'),
            ('public.open_report(uuid, text, text)'),
            ('public.report_photo_allowed(text, boolean)'),
            -- Spec 0011-18 AC-5, AC-6: the caller's own notices, their count, open one, mark all read.
            ('public.my_notices(uuid, integer)'),
            ('public.my_notice_count()'),
            ('public.open_notice(uuid)'),
            ('public.mark_all_notices_read()'),
            -- Spec 0011-13 AC-7: the signed in owner asks for a link and confirms an address.
            ('public.request_email_confirmation()'),
            ('public.confirm_email(text)'),
            ('public.apply_to_request(uuid, text)'),
            ('public.choose_provider(uuid, uuid)'),
            ('public.provider_applications(timestamp with time zone, uuid)'),
            ('public.provider_feed(uuid[], uuid[], date, date, boolean, timestamp with time zone, uuid)'),
            ('public.provider_home_counts()'),
            ('public.provider_request(uuid)'),
            ('public.provider_setup()'),
            ('public.save_provider_setup(uuid[], uuid[], smallint[], integer, integer)'),
            ('public.cancel_request(uuid, text)'),
            ('public.catalog_text_ok(jsonb, text, integer)'),
            ('public.complete_onboarding(text, text, text, boolean)'),
            ('public.confirm_job(uuid)'),
            ('public.customer_mark_done(uuid)'),
            ('public.finish_job(uuid)'),
            ('public.request_close_info(uuid)'),
            ('public.start_job(uuid)'),
            ('public.contacts_visible(uuid)'),
            ('public.create_request(uuid, uuid, uuid, uuid[], jsonb, date, integer, text, text, bigint, bigint)'),
            ('public.decide_provider(uuid, text, timestamp with time zone, text, text)'),
            ('public.is_admin()'),
            ('public.ledger_check(text)'),
            ('public.provider_fee_for(text, bigint)'),
            ('public.log_document_view(uuid, uuid)'),
            ('public.my_checkout(uuid)'),
            ('public.my_receipt(uuid)'),
            ('public.pay_commission(uuid, text, text)'),
            ('public.pay_provider_fee(uuid, text, text)'),
            ('public.provider_jobs(text, timestamp with time zone, uuid)'),
            -- Spec 0011-15: the provider's own jobs and fees history, read only.
            ('public.provider_history(date)'),
            ('public.preview_pricing_formula(uuid, bigint, jsonb, uuid, uuid[], jsonb)'),
            ('public.provider_may_store(text, text)'),
            ('public.public_region_info()'),
            ('public.publish_pricing_formula(uuid, integer, bigint, jsonb)'),
            ('public.quote_price(uuid, uuid, uuid[], jsonb)'),
            ('public.quote_request(uuid, uuid, uuid[], jsonb)'),
            ('public.register_provider_document(text, text)'),
            ('public.request_catalog()'),
            ('public.request_contacts(uuid)'),
            ('public.request_offers(uuid)'),
            ('public.reinstate_provider(uuid)'),
            ('public.review_provider_documents(uuid, uuid[], uuid[], text, text, text, date)'),
            ('public.save_provider_profile(text, text, text, text, integer, text[])'),
            ('public.submit_provider_file()'),
            ('public.suspend_provider(uuid, text)') $$,
  'every definer function a signed in user can run is on the reviewed list');
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
                    VALUES ('00000000-0000-0000-0000-000000105001', 'TR', 9, 100, false) $$,
  'P0001', 'pricing_history_immutable', 'a formula row comes in only through publish, even as postgres');
SELECT throws_ok($$ INSERT INTO public.pricing_modifiers (formula_id, region, apply_order, question_key, match_type, effect_type, amount)
                    SELECT id, 'TR', 99, NULL, 'always', 'FIXED', 100 FROM public.pricing_formulas
                     WHERE service_id = '00000000-0000-0000-0000-000000105001' AND active $$,
  'P0001', 'pricing_history_immutable', 'no modifier can be added under a published version, even as postgres');
SELECT set_config('pricing.publishing', 'on', true);
SELECT throws_ok($$ INSERT INTO public.pricing_formulas (service_id, region, version, base_price, active)
                    VALUES ('00000000-0000-0000-0000-000000105001', 'TR', 9, 100, true) $$,
  '23505', NULL, 'a service has at most one active formula');
SELECT set_config('pricing.publishing', 'off', true);

-- A whole amount written with a decimal point is still whole: no raw 22P02 (security review 2026-11-15).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010a1", "role": "authenticated"}', true);
SELECT is(public.preview_pricing_formula('00000000-0000-0000-0000-000000105003', 100000,
    '[{"question_key": null, "match_type": "always", "match_value": null, "effect_type": "FIXED", "amount": 100.0, "factor": null}]',
    NULL, NULL, '{"count": 1, "size": 1}') ->> 'price', '100100', 'a preview reads 100.0 as 100');
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105006', 0, 100000,
    '[{"question_key": null, "match_type": "always", "match_value": null, "effect_type": "FIXED", "amount": 100.0, "factor": null}]') ->> 'status',
  'ok', 'a publish stores 100.0 as 100');
RESET ROLE;
SELECT is((SELECT m.amount FROM public.pricing_modifiers m JOIN public.pricing_formulas f ON f.id = m.formula_id
            WHERE f.service_id = '00000000-0000-0000-0000-000000105006'), 100::bigint, 'stored as the whole number 100');

-- A real publish must shut the door behind itself: the function's own
-- set_config(..., 'off') is the only thing that does (a function's SET clause does not undo another variable),
-- so deleting that line has to fail this test (security delta review of PR #27).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000010a1", "role": "authenticated"}', true);
SELECT is(public.publish_pricing_formula('00000000-0000-0000-0000-000000105006',
            coalesce((SELECT version FROM public.pricing_formulas WHERE service_id = '00000000-0000-0000-0000-000000105006' AND active), 0),
            150000, '[]'::jsonb) ->> 'status', 'ok', 'an admin publishes a first version of another service');
RESET ROLE;
SELECT isnt(coalesce(current_setting('pricing.publishing', true), ''), 'on', 'publish leaves the door shut behind it');
SELECT throws_ok($$ INSERT INTO public.pricing_modifiers (formula_id, region, apply_order, question_key, match_type, effect_type, amount)
                    SELECT id, 'TR', 99, NULL, 'always', 'FIXED', 100 FROM public.pricing_formulas
                     WHERE service_id = '00000000-0000-0000-0000-000000105006' AND active $$,
  'P0001', 'pricing_history_immutable', 'after a publish, a direct insert is refused again, even as postgres');

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

-- ── the question guard (AC-3, AC-4) ─────────────────────────────────────────
SELECT throws_ok($$ UPDATE public.questions SET key = 'room_count' WHERE key = 'rooms' $$,
  'P0001', 'question_immutable', 'a key never changes, even as postgres');
SELECT throws_ok($$ UPDATE public.questions SET type = 'boolean', validation = NULL WHERE key = 'notes' $$,
  'P0001', 'question_immutable', 'a type never changes, even as postgres');
SELECT throws_ok($$ UPDATE public.questions SET service_id = '00000000-0000-0000-0000-000000105006' WHERE key = 'notes' $$,
  'P0001', 'question_immutable', 'nor does a scope');
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
