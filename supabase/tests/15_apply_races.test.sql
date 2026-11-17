-- Position 05, spec 0009: the races, with two real sessions through dblink (AC-10, AC-16, AC-23).
--
-- A lock only shows between two sessions, so this file commits its fixtures through a dblink session
-- and removes them at the start and the end. Its ids all start 00000000-0000-0000-0000-0000001500, and
-- nothing else uses that prefix. Requests, addresses and applications refuse a delete even as postgres,
-- so the clean up switches those guards off for its own delete, inside one transaction, as the owner.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT plan(14);

CREATE FUNCTION pg_temp.conn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('host=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database()) $$;

CREATE FUNCTION pg_temp.clean_up() RETURNS text LANGUAGE sql AS $fn$
  SELECT extensions.dblink_exec(pg_temp.conn(), $$
    BEGIN;
    DELETE FROM public.audit_log WHERE actor_id::text LIKE '00000000-0000-0000-0000-0000001500%'
       OR entity_id LIKE '00000000-0000-0000-0000-0000001500%';
    ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
    DELETE FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001500%';
    ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
    DELETE FROM public.apply_counters WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001500%';
    DELETE FROM public.provider_services WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001500%';
    DELETE FROM public.provider_zones WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001500%';
    DELETE FROM public.provider_availability WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001500%';
    ALTER TABLE public.requests DISABLE TRIGGER requests_delete_guard;
    DELETE FROM public.requests WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000001500%';
    ALTER TABLE public.requests ENABLE TRIGGER requests_delete_guard;
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000001500%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000001500%';
    DELETE FROM public.zones WHERE id::text LIKE '00000000-0000-0000-0000-0000001500%';
    DELETE FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000001500%';
    DELETE FROM public.profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000001500%';
    DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-0000001500%';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: a customer, eleven approved providers with the same setup, one service, one
-- district, and three open requests.
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  SELECT ('00000000-0000-0000-0000-0000001500' || lpad(g::text, 2, '0'))::uuid, 'authenticated', 'authenticated',
         '9055591500' || lpad(g::text, 2, '0'), now()
    FROM generate_series(1, 11) g;
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  VALUES ('00000000-0000-0000-0000-0000001500c1', 'authenticated', 'authenticated', '905559150099', now());
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  SELECT ('00000000-0000-0000-0000-0000001500' || lpad(g::text, 2, '0'))::uuid, 'provider', 'TR',
         '+9055591500' || lpad(g::text, 2, '0'), 'Yarış Usta ' || g, 'tr'
    FROM generate_series(1, 11) g;
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  VALUES ('00000000-0000-0000-0000-0000001500c1', 'customer', 'TR', '+905559150099', 'Yarış Müşteri', 'tr');
  UPDATE public.providers SET status = 'approved', approved_at = now()
   WHERE id::text LIKE '00000000-0000-0000-0000-0000001500%';
  INSERT INTO public.service_categories (id, region, name, active) VALUES
    ('00000000-0000-0000-0000-0000001500ca', 'TR', '{"tr": "Yarış"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active) VALUES
    ('00000000-0000-0000-0000-000000150051', '00000000-0000-0000-0000-0000001500ca', 'TR', '{"tr": "Bir"}', 1, 2, true);
  INSERT INTO public.zones (id, region, name, multiplier, active) VALUES
    ('00000000-0000-0000-0000-000000150021', 'TR', '{"tr": "Semt"}', 1.00, true);
  INSERT INTO public.provider_services (provider_id, service_id, region)
  SELECT id, '00000000-0000-0000-0000-000000150051', 'TR' FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000001500%';
  INSERT INTO public.provider_zones (provider_id, zone_id, region)
  SELECT id, '00000000-0000-0000-0000-000000150021', 'TR' FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000001500%';
  INSERT INTO public.provider_availability (provider_id, region, work_days, start_hour, end_hour)
  SELECT id, 'TR', '{0,1,2,3,4,5,6}', 0, 24 FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000001500%';
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  SELECT ('00000000-0000-0000-0000-0000001500e' || g)::uuid, 'TR', '00000000-0000-0000-0000-0000001500c1', gen_random_uuid(),
         '00000000-0000-0000-0000-000000150051', '00000000-0000-0000-0000-000000150021', '{}', '[]',
         '{"rounding_minor": 100}', 100000, 10000, 90000, 'TRY', now() + interval '2 days', now() + interval '2 days 2 hours'
    FROM generate_series(1, 4) g;
  -- Nine offers on E1: the cap of ten minus one.
  INSERT INTO public.applications (region, request_id, provider_id, message)
  SELECT 'TR', '00000000-0000-0000-0000-0000001500e1', ('00000000-0000-0000-0000-0000001500' || lpad(g::text, 2, '0'))::uuid,
         'A fixture offer, long enough to store.'
    FROM generate_series(1, 9) g;
  COMMIT; $$);

CREATE FUNCTION pg_temp.as_sql(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000001500%s"}' $q$, p) $$;
CREATE FUNCTION pg_temp.apply_sql(p_request text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$ SELECT public.apply_to_request('00000000-0000-0000-0000-0000001500%s', 'I can start on Saturday morning with two people.')::text $q$, p_request) $$;
CREATE FUNCTION pg_temp.cancel_sql(p_request text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$ SELECT public.cancel_request('00000000-0000-0000-0000-0000001500%s', NULL)::text $q$, p_request) $$;
CREATE FUNCTION pg_temp.count_sql(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(pg_temp.conn(), p_sql) AS t(r text) $$;

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());
SELECT extensions.dblink_exec('a', $$ SET ROLE authenticated $$);
SELECT extensions.dblink_exec('b', $$ SET ROLE authenticated $$);

-- ── two providers take the last slot at once: one wins, the cap holds (AC-10) ─
SELECT extensions.dblink_exec('a', pg_temp.as_sql('10'));
SELECT extensions.dblink_exec('b', pg_temp.as_sql('11'));
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.apply_sql('e1')) AS t(r text))::jsonb ->> 'status', 'ok',
  'the first provider takes the tenth slot, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.apply_sql('e1'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'the second waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is((SELECT count(*)::int FROM extensions.dblink_get_result('b', false) AS t(r text)), 0, 'the second apply returns no result');
SELECT ok(extensions.dblink_error_message('b') LIKE '%request_full%', 'it gets request_full');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.count_sql($$ SELECT count(*)::text FROM public.applications
                                WHERE request_id = '00000000-0000-0000-0000-0000001500e1' AND status = 'APPLIED' $$),
  '10', 'exactly the cap: ten applications');

-- ── a cancel first: the apply that waits refuses request_closed (AC-16) ──────
SELECT extensions.dblink_exec('a', pg_temp.as_sql('c1'));
SELECT extensions.dblink_exec('b', pg_temp.as_sql('01'));
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.cancel_sql('e2')) AS t(r text)), '{"status": "ok"}',
  'the customer cancels E2, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.apply_sql('e2'));
SELECT pg_sleep(0.3);
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%request_closed%', 'the apply that waited gets request_closed');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.count_sql($$ SELECT count(*)::text FROM public.applications WHERE request_id = '00000000-0000-0000-0000-0000001500e2' $$),
  '0', 'and wrote nothing');

-- ── an apply first: the cancel that waits cancels it (AC-16) ─────────────────
SELECT extensions.dblink_exec('a', pg_temp.as_sql('01'));
SELECT extensions.dblink_exec('b', pg_temp.as_sql('c1'));
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.apply_sql('e3')) AS t(r text))::jsonb ->> 'status', 'ok',
  'a provider applies to E3, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.cancel_sql('e3'));
SELECT pg_sleep(0.3);
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is((SELECT r FROM extensions.dblink_get_result('b') AS t(r text)), '{"status": "ok"}', 'the cancel that waited goes through');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.count_sql($$ SELECT string_agg(a.status, ',') FROM public.applications a
                                WHERE a.request_id = '00000000-0000-0000-0000-0000001500e3' $$),
  'CANCELLED', 'and cancels the application: no APPLIED row on a CANCELLED request');

-- ── a suspension racing an apply: the apply waits on the provider row (review F2) ─
SELECT extensions.dblink_exec('a', 'RESET ROLE');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT extensions.dblink_exec('a', $$ UPDATE public.providers SET status = 'suspended', suspension_reason = 'Repeated complaints from customers'
                                      WHERE id = '00000000-0000-0000-0000-000000150002' $$);
SELECT extensions.dblink_exec('b', pg_temp.as_sql('02'));
SELECT extensions.dblink_send_query('b', pg_temp.apply_sql('e4'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'the apply waits on the provider row the suspension holds');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%provider_suspended%', 'and then refuses provider_suspended');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.count_sql($$ SELECT count(*)::text FROM public.applications WHERE request_id = '00000000-0000-0000-0000-0000001500e4' $$),
  '0', 'no application from a suspended provider');

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();

SELECT * FROM finish();
ROLLBACK;
