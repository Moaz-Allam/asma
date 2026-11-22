-- Position 19b, spec 0011-19b: the races, with two real sessions through dblink (AC-1 X-4, AC-4, AC-9).
--
-- A lock only shows between two sessions, so this file commits its fixtures through a dblink session and removes
-- them at the start and the end. Its ids all start 00000000-0000-0000-0000-0000004100, and nothing else uses that
-- prefix. Applications, requests and application questions refuse a delete even as postgres, so the clean up
-- switches those guards off for its own delete, inside one transaction, as the owner.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT plan(8);

CREATE FUNCTION pg_temp.conn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('host=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database()) $$;

CREATE FUNCTION pg_temp.clean_up() RETURNS text LANGUAGE sql AS $fn$
  SELECT extensions.dblink_exec(pg_temp.conn(), $$
    BEGIN;
    DELETE FROM public.audit_log WHERE actor_id::text LIKE '00000000-0000-0000-0000-0000004100%'
       OR entity_id LIKE '00000000-0000-0000-0000-0000004100%';
    ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
    DELETE FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000004100%';
    ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
    DELETE FROM public.apply_counters WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000004100%';
    DELETE FROM public.provider_services WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000004100%';
    DELETE FROM public.provider_zones WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000004100%';
    DELETE FROM public.provider_availability WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000004100%';
    ALTER TABLE public.requests DISABLE TRIGGER requests_delete_guard;
    DELETE FROM public.requests WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000004100%';
    ALTER TABLE public.requests ENABLE TRIGGER requests_delete_guard;
    ALTER TABLE public.application_questions DISABLE TRIGGER application_questions_guard;
    DELETE FROM public.application_questions WHERE id::text LIKE '00000000-0000-0000-0000-0000004100%';
    ALTER TABLE public.application_questions ENABLE TRIGGER application_questions_guard;
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000004100%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000004100%';
    DELETE FROM public.zones WHERE id::text LIKE '00000000-0000-0000-0000-0000004100%';
    DELETE FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000004100%';
    DELETE FROM public.profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000004100%';
    DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-0000004100%';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: a customer, two admins, two approved providers, category K (two active questions) with one
-- service and two open requests, category L (four active questions, two more inactive).
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  SELECT ('00000000-0000-0000-0000-0000004100' || c)::uuid, 'authenticated', 'authenticated', p, now()
    FROM (VALUES ('c1', '905559410001'), ('d1', '905559410002'), ('d2', '905559410003'), ('01', '905559410004'),
                 ('02', '905559410005')) AS t(c, p);
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  SELECT ('00000000-0000-0000-0000-0000004100' || c)::uuid, r, 'TR', '+' || p, 'Yarış ' || c, 'tr'
    FROM (VALUES ('c1', 'customer', '905559410001'), ('d1', 'admin', '905559410002'), ('d2', 'admin', '905559410003'),
                 ('01', 'provider', '905559410004'), ('02', 'provider', '905559410005')) AS t(c, r, p);
  UPDATE public.providers SET status = 'approved', approved_at = now()
   WHERE id::text LIKE '00000000-0000-0000-0000-0000004100%';
  INSERT INTO public.service_categories (id, region, name, active) VALUES
    ('00000000-0000-0000-0000-0000004100ca', 'TR', '{"tr": "Yarış K"}', true),
    ('00000000-0000-0000-0000-0000004100cb', 'TR', '{"tr": "Yarış L"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active) VALUES
    ('00000000-0000-0000-0000-000000410051', '00000000-0000-0000-0000-0000004100ca', 'TR', '{"tr": "Bir"}', 1, 2, true);
  INSERT INTO public.zones (id, region, name, multiplier, active) VALUES
    ('00000000-0000-0000-0000-000000410021', 'TR', '{"tr": "Semt"}', 1.00, true);
  INSERT INTO public.provider_services (provider_id, service_id, region)
  SELECT id, '00000000-0000-0000-0000-000000410051', 'TR' FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000004100%';
  INSERT INTO public.provider_zones (provider_id, zone_id, region)
  SELECT id, '00000000-0000-0000-0000-000000410021', 'TR' FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000004100%';
  INSERT INTO public.provider_availability (provider_id, region, work_days, start_hour, end_hour)
  SELECT id, 'TR', '{0,1,2,3,4,5,6}', 0, 24 FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000004100%';
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  SELECT ('00000000-0000-0000-0000-0000004100e' || g)::uuid, 'TR', '00000000-0000-0000-0000-0000004100c1', gen_random_uuid(),
         '00000000-0000-0000-0000-000000410051', '00000000-0000-0000-0000-000000410021', '{}', '[]',
         '{"rounding_minor": 100}', 100000, 10000, 90000, 'TRY', now() + interval '2 days', now() + interval '2 days 2 hours'
    FROM generate_series(1, 2) g;
  INSERT INTO public.application_questions (id, category_id, region, key, label, type, required, display_order) VALUES
    ('00000000-0000-0000-0000-0000004100a1', '00000000-0000-0000-0000-0000004100ca', 'TR', 'first', '{"tr": "Bir"}', 'boolean', true, 1),
    ('00000000-0000-0000-0000-0000004100a2', '00000000-0000-0000-0000-0000004100ca', 'TR', 'second', '{"tr": "İki"}', 'boolean', false, 2);
  INSERT INTO public.application_questions (id, category_id, region, key, label, type, display_order)
  SELECT ('00000000-0000-0000-0000-0000004100b' || g)::uuid, '00000000-0000-0000-0000-0000004100cb', 'TR', 'q' || g,
         '{"tr": "Soru"}', 'boolean', g
    FROM generate_series(1, 6) g;
  UPDATE public.application_questions SET active = true
   WHERE id::text LIKE '00000000-0000-0000-0000-0000004100a%'
      OR id IN ('00000000-0000-0000-0000-0000004100b1', '00000000-0000-0000-0000-0000004100b2',
                '00000000-0000-0000-0000-0000004100b3', '00000000-0000-0000-0000-0000004100b4');
  COMMIT; $$);

CREATE FUNCTION pg_temp.as_sql(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000004100%s"}' $q$, p) $$;
CREATE FUNCTION pg_temp.apply_sql(p_request text, p_version text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$ SELECT public.apply_to_request('00000000-0000-0000-0000-0000004100%s', NULL, '{"first": true, "second": false}', %L)::text $q$,
                p_request, p_version) $$;
CREATE FUNCTION pg_temp.one(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(pg_temp.conn(), p_sql) AS t(r text) $$;

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());
SELECT extensions.dblink_exec('a', $$ SET ROLE authenticated $$);
SELECT extensions.dblink_exec('b', $$ SET ROLE authenticated $$);

-- The version the providers' forms were drawn from, before any change.
SELECT extensions.dblink_exec('b', pg_temp.as_sql('01'));
CREATE TEMP TABLE v AS
SELECT r AS version FROM extensions.dblink('b', $$ SELECT public.provider_request('00000000-0000-0000-0000-0000004100e1') ->> 'questions_version' $$)
  AS t(r text);

-- ── admin retires a question while a provider applies ────────────────────────
SELECT extensions.dblink_exec('a', pg_temp.as_sql('d1'));
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT extensions.dblink_exec('a', $$ UPDATE public.application_questions SET active = false WHERE id = '00000000-0000-0000-0000-0000004100a2' $$);
SELECT is((SELECT r FROM extensions.dblink('b', pg_temp.apply_sql('e1', (SELECT version FROM v))) AS t(r text))::jsonb ->> 'status', 'ok',
  'with the retire uncommitted, the apply sees the old set and goes through');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.one($$ SELECT jsonb_build_object('answers', answers, 'keys', (SELECT jsonb_agg(q ->> 'key') FROM jsonb_array_elements(questions_snapshot) q))::text
                          FROM public.applications WHERE request_id = '00000000-0000-0000-0000-0000004100e1' $$)::jsonb,
  '{"answers": {"first": true, "second": false}, "keys": ["first", "second"]}'::jsonb,
  'and stores the old set, answers and snapshot agreeing');
SELECT extensions.dblink_exec('b', pg_temp.as_sql('02'));
SELECT is((SELECT r FROM extensions.dblink('b', pg_temp.apply_sql('e2', (SELECT version FROM v))) AS t(r text))::jsonb,
  '{"status": "refused", "code": "questions_changed"}'::jsonb, 'once it commits, a form drawn from the old set gets questions_changed');
SELECT is(pg_temp.one($$ SELECT count(*)::text FROM public.applications WHERE request_id = '00000000-0000-0000-0000-0000004100e2' $$), '0',
  'and stores nothing');
SELECT is(pg_temp.one($$ SELECT count::text FROM public.apply_counters WHERE provider_id = '00000000-0000-0000-0000-000000410002' $$), '1',
  'the stale form cost an attempt');

-- ── two admins activate the fifth and the sixth at once (X-4) ────────────────
SELECT extensions.dblink_exec('b', pg_temp.as_sql('d2'));
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT extensions.dblink_exec('a', $$ UPDATE public.application_questions SET active = true WHERE id = '00000000-0000-0000-0000-0000004100b5' $$);
SELECT extensions.dblink_send_query('b', $$ UPDATE public.application_questions SET active = true WHERE id = '00000000-0000-0000-0000-0000004100b6' $$);
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'the second admin waits on the category row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%too_many_questions%', 'and then gets too_many_questions');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one($$ SELECT count(*)::text FROM public.application_questions
                          WHERE category_id = '00000000-0000-0000-0000-0000004100cb' AND active $$), '5', 'five active, never six');

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();

SELECT * FROM finish();
ROLLBACK;
