-- Position 04, spec 0008: the races, with two real sessions through dblink (AC-7, AC-12, AC-28).
--
-- A lock only shows between two sessions, so this file commits its fixtures through a dblink session
-- and removes them at the start and the end. Its ids all start 00000000-0000-0000-0000-0000001300, and
-- nothing else uses that prefix. Address rows and pricing history refuse a delete even as postgres, so
-- the clean up switches those guards off for its own delete, inside one transaction, as the tables' owner.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT plan(10);

CREATE FUNCTION pg_temp.conn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('host=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database()) $$;

CREATE FUNCTION pg_temp.clean_up() RETURNS text LANGUAGE sql AS $fn$
  SELECT extensions.dblink_exec(pg_temp.conn(), $$
    BEGIN;
    DELETE FROM public.audit_log WHERE actor_id::text LIKE '00000000-0000-0000-0000-0000001300%'
       OR entity_id LIKE '00000000-0000-0000-0000-0000001300%';
    ALTER TABLE public.request_addresses DISABLE TRIGGER request_addresses_guard;
    DELETE FROM public.request_addresses WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000001300%';
    ALTER TABLE public.request_addresses ENABLE TRIGGER request_addresses_guard;
    ALTER TABLE public.requests DISABLE TRIGGER requests_delete_guard;
    DELETE FROM public.requests WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000001300%';
    ALTER TABLE public.requests ENABLE TRIGGER requests_delete_guard;
    DELETE FROM public.quote_counters WHERE user_id::text LIKE '00000000-0000-0000-0000-0000001300%';
    ALTER TABLE public.pricing_formulas DISABLE TRIGGER pricing_history_guard;
    DELETE FROM public.pricing_formulas WHERE service_id::text LIKE '00000000-0000-0000-0000-0000001300%';
    ALTER TABLE public.pricing_formulas ENABLE TRIGGER pricing_history_guard;
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000001300%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000001300%';
    DELETE FROM public.zones WHERE id::text LIKE '00000000-0000-0000-0000-0000001300%';
    DELETE FROM public.profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000001300%';
    DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-0000001300%';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: three customers, one bookable service with a flat formula, one zone.
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at) VALUES
    ('00000000-0000-0000-0000-0000001300c1', 'authenticated', 'authenticated', '905558880001', now()),
    ('00000000-0000-0000-0000-0000001300c2', 'authenticated', 'authenticated', '905558880002', now()),
    ('00000000-0000-0000-0000-0000001300c3', 'authenticated', 'authenticated', '905558880003', now());
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale) VALUES
    ('00000000-0000-0000-0000-0000001300c1', 'customer', 'TR', '+905558880001', 'Yarış Bir', 'tr'),
    ('00000000-0000-0000-0000-0000001300c2', 'customer', 'TR', '+905558880002', 'Yarış İki', 'tr'),
    ('00000000-0000-0000-0000-0000001300c3', 'customer', 'TR', '+905558880003', 'Yarış Üç', 'tr');
  INSERT INTO public.service_categories (id, region, name, active) VALUES
    ('00000000-0000-0000-0000-0000001300ca', 'TR', '{"tr": "Yarış"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active) VALUES
    ('00000000-0000-0000-0000-000000130051', '00000000-0000-0000-0000-0000001300ca', 'TR', '{"tr": "Bir"}', 1, 2, true);
  INSERT INTO public.zones (id, region, name, multiplier, active) VALUES
    ('00000000-0000-0000-0000-000000130021', 'TR', '{"tr": "Semt"}', 1.00, true);
  SELECT set_config('pricing.publishing', 'on', true);
  INSERT INTO public.pricing_formulas (service_id, region, version, base_price, active) VALUES
    ('00000000-0000-0000-0000-000000130051', 'TR', 1, 100000, true);
  SELECT set_config('pricing.publishing', 'off', true);
  COMMIT; $$);

-- A publish of the flat service at 100000 (commission 10000), tomorrow at an hour.
CREATE FUNCTION pg_temp.post_sql(p_key text, p_hour integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format($q$ SELECT public.create_request(%L, '00000000-0000-0000-0000-000000130051',
                    '00000000-0000-0000-0000-000000130021', NULL, '{}',
                    ((now() AT TIME ZONE 'Europe/Istanbul')::date + 1), %s, 'Moda Cad. No 5', NULL, 100000, 10000)::text $q$,
                p_key, p_hour) $$;

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());

-- ── two tabs take the cap's last slot at once: one wins (AC-7) ───────────────
SELECT extensions.dblink_exec('a', $$ SET ROLE authenticated $$);
SELECT extensions.dblink_exec('a', $$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000001300c1"}' $$);
SELECT extensions.dblink_exec('b', $$ SET ROLE authenticated $$);
SELECT extensions.dblink_exec('b', $$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000001300c1"}' $$);
SELECT count(*) FROM generate_series(9, 12) h,
  LATERAL extensions.dblink('a', pg_temp.post_sql(gen_random_uuid()::text, h)) AS t(r text);
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.post_sql(gen_random_uuid()::text, 13)) AS t(r text))::jsonb ->> 'status',
  'ok', 'the first tab takes the fifth slot, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.post_sql(gen_random_uuid()::text, 14));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'the second tab waits on the profile row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is((SELECT count(*)::int FROM extensions.dblink_get_result('b', false) AS t(r text)), 0, 'the second publish returns no result');
SELECT ok(extensions.dblink_error_message('b') LIKE '%too_many_open_requests%', 'it gets too_many_open_requests');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(
  (SELECT r FROM extensions.dblink(pg_temp.conn(), $$ SELECT count(*)::text FROM public.requests
                                                        WHERE customer_id = '00000000-0000-0000-0000-0000001300c1' $$) AS t(r text)),
  '5', 'the cap holds: five requests');

-- ── a double tap: the same client key from two sessions (AC-12) ──────────────
SELECT extensions.dblink_exec('a', $$ SET ROLE authenticated $$);
SELECT extensions.dblink_exec('a', $$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000001300c2"}' $$);
SELECT extensions.dblink_exec('b', $$ SET ROLE authenticated $$);
SELECT extensions.dblink_exec('b', $$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000001300c2"}' $$);
SELECT extensions.dblink_exec('a', 'BEGIN');
CREATE TEMP TABLE tap_a AS
  SELECT r::jsonb AS r FROM extensions.dblink('a', pg_temp.post_sql('00000000-0000-0000-0000-0000001300f1', 10)) AS t(r text);
SELECT extensions.dblink_send_query('b', pg_temp.post_sql('00000000-0000-0000-0000-0000001300f1', 10));
SELECT pg_sleep(0.3);
SELECT extensions.dblink_exec('a', 'COMMIT');
CREATE TEMP TABLE tap_b AS SELECT r::jsonb AS r FROM extensions.dblink_get_result('b') AS t(r text);
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is((SELECT r FROM tap_b), (SELECT r FROM tap_a), 'both taps get the same id');
SELECT is(
  (SELECT r FROM extensions.dblink(pg_temp.conn(), $$ SELECT count(*)::text FROM public.requests
                                                        WHERE customer_id = '00000000-0000-0000-0000-0000001300c2' $$) AS t(r text)),
  '1', 'and one row exists');

-- ── two quotes race the last slot of the hour (AC-28) ────────────────────────
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  INSERT INTO public.quote_counters (user_id, region, window_start, count)
  VALUES ('00000000-0000-0000-0000-0000001300c3', 'TR', now(), 59) $$);
SELECT extensions.dblink_exec('a', $$ SET ROLE authenticated $$);
SELECT extensions.dblink_exec('a', $$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000001300c3"}' $$);
SELECT extensions.dblink_exec('b', $$ SET ROLE authenticated $$);
SELECT extensions.dblink_exec('b', $$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000001300c3"}' $$);
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', $$ SELECT public.quote_request('00000000-0000-0000-0000-000000130051',
             '00000000-0000-0000-0000-000000130021', NULL, '{}')::text $$) AS t(r text))::jsonb ->> 'status',
  'ok', 'the first quote takes the 60th slot');
SELECT extensions.dblink_send_query('b', $$ SELECT public.quote_request('00000000-0000-0000-0000-000000130051',
             '00000000-0000-0000-0000-000000130021', NULL, '{}')::text $$);
SELECT pg_sleep(0.3);
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%too_many_quotes%', 'the second gets too_many_quotes');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(
  (SELECT r FROM extensions.dblink(pg_temp.conn(), $$ SELECT count::text FROM public.quote_counters
                                                        WHERE user_id = '00000000-0000-0000-0000-0000001300c3' $$) AS t(r text)),
  '60', 'the counter stops at the limit');

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();

SELECT * FROM finish();
ROLLBACK;
