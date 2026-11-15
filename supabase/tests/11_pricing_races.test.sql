-- Position 03, spec 0007: the races, with two real sessions through dblink (AC-4, AC-12).
--
-- A lock only shows between two sessions, so this file commits its fixtures through a dblink session
-- and removes them at the start and the end. Its ids all start 00000000-0000-0000-0000-0000001100, and
-- nothing else uses that prefix. Pricing history refuses a delete even as postgres, so the clean up
-- switches the guard off for its own delete, inside one transaction, as the tables' owner.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT plan(9);

-- The server's own network address, not loopback: loopback trusts without a password, and dblink lets a
-- role that is not superuser connect only with a password it really used.
CREATE FUNCTION pg_temp.conn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('host=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database()) $$;

-- One transaction: the guard off, this file's rows gone, the guard on again.
CREATE FUNCTION pg_temp.clean_up() RETURNS text LANGUAGE sql AS $fn$
  SELECT extensions.dblink_exec(pg_temp.conn(), $$
    BEGIN;
    ALTER TABLE public.pricing_modifiers DISABLE TRIGGER pricing_history_guard;
    ALTER TABLE public.pricing_formulas DISABLE TRIGGER pricing_history_guard;
    DELETE FROM public.pricing_modifiers WHERE formula_id IN (SELECT id FROM public.pricing_formulas
                                                              WHERE service_id::text LIKE '00000000-0000-0000-0000-0000001100%');
    DELETE FROM public.pricing_formulas WHERE service_id::text LIKE '00000000-0000-0000-0000-0000001100%';
    ALTER TABLE public.pricing_modifiers ENABLE TRIGGER pricing_history_guard;
    ALTER TABLE public.pricing_formulas ENABLE TRIGGER pricing_history_guard;
    DELETE FROM public.questions WHERE id::text LIKE '00000000-0000-0000-0000-0000001100%';
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000001100%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000001100%';
    DELETE FROM public.audit_log WHERE entity_id LIKE '00000000-0000-0000-0000-0000001100%'
       OR (action = 'pricing.formula_published' AND actor_id = '00000000-0000-0000-0000-0000001100a1');
    DELETE FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000001100a1';
    DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000001100a1';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: an admin, one category, two services, a priced boolean question.
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  -- app_metadata as complete_onboarding leaves it, so 05 holds even while a failed run left this row behind.
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at, raw_app_meta_data) VALUES
    ('00000000-0000-0000-0000-0000001100a1', 'authenticated', 'authenticated', '905556660001', now(),
     '{"role": "admin", "region": "TR"}');
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale) VALUES
    ('00000000-0000-0000-0000-0000001100a1', 'admin', 'TR', '+905556660001', 'Admin Yarış', 'en');
  INSERT INTO public.service_categories (id, region, name, active) VALUES
    ('00000000-0000-0000-0000-0000001100c1', 'TR', '{"tr": "Yarış"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active) VALUES
    ('00000000-0000-0000-0000-000000110051', '00000000-0000-0000-0000-0000001100c1', 'TR', '{"tr": "Bir"}', 1, 2, true),
    ('00000000-0000-0000-0000-000000110052', '00000000-0000-0000-0000-0000001100c1', 'TR', '{"tr": "İki"}', 1, 2, true),
    ('00000000-0000-0000-0000-000000110053', '00000000-0000-0000-0000-0000001100c1', 'TR', '{"tr": "Üç"}', 1, 2, true);
  INSERT INTO public.questions (id, category_id, region, key, label, type, required, affects_pricing, active) VALUES
    ('00000000-0000-0000-0000-000000110091', '00000000-0000-0000-0000-0000001100c1', 'TR', 'pets', '{"tr": "Evcil"}', 'boolean', true, true, true),
    ('00000000-0000-0000-0000-000000110092', '00000000-0000-0000-0000-0000001100c1', 'TR', 'stairs', '{"tr": "Merdiven"}', 'boolean', true, true, true),
    ('00000000-0000-0000-0000-000000110093', '00000000-0000-0000-0000-0000001100c1', 'TR', 'lift', '{"tr": "Asansör"}', 'boolean', true, true, true);
  COMMIT; $$);

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());
SELECT extensions.dblink_exec('a', $$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000001100a1"}' $$);
SELECT extensions.dblink_exec('b', $$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000001100a1"}' $$);

-- ── two admins publish version 1 at once: one wins (AC-12) ───────────────────
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is(
  (SELECT r FROM extensions.dblink('a', $$ SELECT public.publish_pricing_formula('00000000-0000-0000-0000-000000110051', 0, 100000,
     '[{"question_key": "pets", "match_type": "is_true", "match_value": null, "effect_type": "FIXED", "amount": 5000, "factor": null}]')::text $$)
     AS t(r text))::jsonb ->> 'version',
  '1', 'the first admin publishes version 1, still uncommitted');
SELECT extensions.dblink_send_query('b', $$ SELECT public.publish_pricing_formula('00000000-0000-0000-0000-000000110051', 0, 120000, '[]')::text $$);
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'the second admin waits on the service row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is((SELECT count(*)::int FROM extensions.dblink_get_result('b', false) AS t(r text)), 0, 'the second publish returns no result');
SELECT ok(extensions.dblink_error_message('b') LIKE '%stale_formula%', 'the second admin gets stale_formula once the first commits');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);  -- the empty result that frees the connection
SELECT is(
  (SELECT r FROM extensions.dblink(pg_temp.conn(), $$ SELECT string_agg(version || ':' || active || ':' || base_price, ',' ORDER BY version)
                                                        FROM public.pricing_formulas WHERE service_id = '00000000-0000-0000-0000-000000110051' $$)
     AS t(r text)),
  '1:true:100000', 'exactly one version was written, the winner''s');

-- ── a publish holds its question: a switch off waits, then is refused (AC-4) ──
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is(
  (SELECT r FROM extensions.dblink('a', $$ SELECT public.publish_pricing_formula('00000000-0000-0000-0000-000000110052', 0, 100000,
     '[{"question_key": "stairs", "match_type": "is_true", "match_value": null, "effect_type": "FIXED", "amount": 5000, "factor": null}]')::text $$)
     AS t(r text))::jsonb ->> 'status',
  'ok', 'a publish reading stairs, still uncommitted');
SELECT extensions.dblink_send_query('b', $$ UPDATE public.questions SET active = false WHERE id = '00000000-0000-0000-0000-000000110092' $$);
SELECT pg_sleep(0.3);
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT * FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%question_in_use%',
  'the switch off waited for the publish, then the guard saw the new formula and refused');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);  -- the empty result that frees the connection

-- ── a switch off holds its question: a publish waits, then sees it off (AC-12) ─
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT extensions.dblink_exec('a', $$ UPDATE public.questions SET active = false WHERE id = '00000000-0000-0000-0000-000000110093' $$);
SELECT extensions.dblink_send_query('b', $$ SELECT public.publish_pricing_formula('00000000-0000-0000-0000-000000110053', 0, 100000,
     '[{"question_key": "lift", "match_type": "is_true", "match_value": null, "effect_type": "FIXED", "amount": 5000, "factor": null}]')::text $$);
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'the publish waits on the question being switched off');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is((SELECT r FROM extensions.dblink_get_result('b') AS t(r text))::jsonb,
  '{"status": "invalid_formula", "errors": [{"index": 1, "code": "question_not_priced"}]}',
  'then it sees the question off and writes nothing');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);  -- the empty result that frees the connection

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();

SELECT * FROM finish();
ROLLBACK;
