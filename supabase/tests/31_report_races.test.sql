-- Position 14, spec 0011-14 (D193): the report races, with two real sessions through dblink.
--
-- Two reports by one person at once, on two requests, past the daily limit: the second waits on the reporter's profile
-- row and then refuses (R-4). An admin's return to work that waits behind the customer's Confirm finds the job
-- closed and refuses (the customer's word wins, R-6 of 14, R-3 of 11): never a close and a return both.
--
-- Like 26, this file commits its fixtures through a dblink session and removes them at the start and the end. Its
-- ids all start 00000000-0000-0000-0000-0000003100, and nothing else uses them. It sets the fee settings to 0 and the
-- daily report limit to 1 only between its fixtures and its clean up.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT plan(7);

CREATE FUNCTION pg_temp.conn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('host=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database()) $$;

CREATE FUNCTION pg_temp.clean_up() RETURNS text LANGUAGE sql AS $fn$
  SELECT extensions.dblink_exec(pg_temp.conn(), $$
    BEGIN;
    UPDATE public.platform_settings SET value = '5' WHERE region = 'TR' AND key = 'reports_per_user_day';
    DELETE FROM public.outbox_events WHERE payload::text LIKE '%00000000-0000-0000-0000-0000003100%';
    DELETE FROM public.audit_log WHERE actor_id::text LIKE '00000000-0000-0000-0000-0000003100%'
       OR entity_id LIKE '00000000-0000-0000-0000-0000003100%'
       OR new_value::text LIKE '%00000000-0000-0000-0000-0000003100%';
    ALTER TABLE public.problem_reports DISABLE TRIGGER problem_reports_guard;
    DELETE FROM public.problem_reports WHERE reporter_id::text LIKE '00000000-0000-0000-0000-0000003100%';
    ALTER TABLE public.problem_reports ENABLE TRIGGER problem_reports_guard;
    ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
    UPDATE public.requests SET status = 'OPEN', selected_application_id = NULL, selected_at = NULL, payment_deadline = NULL,
           fee_deadline = NULL, closed_at = NULL, closed_by = NULL, actual_started_at = NULL, actual_completed_at = NULL,
           confirm_deadline = NULL
     WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000003100%' AND selected_application_id IS NOT NULL;
    ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
    ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
    DELETE FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000003100%';
    ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
    ALTER TABLE public.requests DISABLE TRIGGER requests_delete_guard;
    DELETE FROM public.requests WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000003100%';
    ALTER TABLE public.requests ENABLE TRIGGER requests_delete_guard;
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000003100%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000003100%';
    DELETE FROM public.zones WHERE id::text LIKE '00000000-0000-0000-0000-0000003100%';
    DELETE FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000003100%';
    DELETE FROM public.profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000003100%';
    DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-0000003100%';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: a customer, a provider and an admin; E1, E2 and E3 unlocked on their start day (both fees 0, set
-- inside this transaction only), E3 done and reported by the customer.
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key IN ('provider_fee_value', 'fee_min_minor');
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  VALUES ('00000000-0000-0000-0000-000000310001', 'authenticated', 'authenticated', '905559310001', now()),
         ('00000000-0000-0000-0000-0000003100c1', 'authenticated', 'authenticated', '905559310099', now()),
         ('00000000-0000-0000-0000-0000003100ad', 'authenticated', 'authenticated', '905559310098', now());
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  VALUES ('00000000-0000-0000-0000-000000310001', 'provider', 'TR', '+905559310001', 'Yarış Usta', 'tr'),
         ('00000000-0000-0000-0000-0000003100c1', 'customer', 'TR', '+905559310099', 'Yarış Müşteri', 'tr'),
         ('00000000-0000-0000-0000-0000003100ad', 'admin', 'TR', '+905559310098', 'Yarış Yönetici', 'tr');
  UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Yarış'
   WHERE id = '00000000-0000-0000-0000-000000310001';
  INSERT INTO public.service_categories (id, region, name, active) VALUES ('00000000-0000-0000-0000-0000003100ca', 'TR', '{"tr": "Yarış"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
  VALUES ('00000000-0000-0000-0000-000000310051', '00000000-0000-0000-0000-0000003100ca', 'TR', '{"tr": "Bir"}', 1, 2, true);
  INSERT INTO public.zones (id, region, name, multiplier, active) VALUES ('00000000-0000-0000-0000-000000310021', 'TR', '{"tr": "Semt"}', 1.00, true);
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  SELECT ('00000000-0000-0000-0000-0000003100e' || g)::uuid, 'TR', '00000000-0000-0000-0000-0000003100c1', gen_random_uuid(),
         '00000000-0000-0000-0000-000000310051', '00000000-0000-0000-0000-000000310021', '{}', '[]',
         '{"rounding_minor": 100}', 100000, 0, 100000, 'TRY', now() + interval '2 days', now() + interval '2 days 2 hours'
    FROM generate_series(1, 3) g;
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT ('00000000-0000-0000-0000-0000003100f' || g)::uuid, 'TR', ('00000000-0000-0000-0000-0000003100e' || g)::uuid,
         '00000000-0000-0000-0000-000000310001', 'An offer for the report races, long enough.'
    FROM generate_series(1, 3) g;
  SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000003100c1", "role": "authenticated"}', true);
  SELECT public.choose_provider(('00000000-0000-0000-0000-0000003100e' || g)::uuid, ('00000000-0000-0000-0000-0000003100f' || g)::uuid)
    FROM generate_series(1, 3) g;
  SELECT public.pay_commission(('00000000-0000-0000-0000-0000003100e' || g)::uuid, 'tr', NULL) FROM generate_series(1, 3) g;
  SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000310001", "role": "authenticated"}', true);
  SELECT public.pay_provider_fee(('00000000-0000-0000-0000-0000003100f' || g)::uuid, 'tr', NULL) FROM generate_series(1, 3) g;
  UPDATE public.platform_settings SET value = '5' WHERE region = 'TR' AND key = 'provider_fee_value';
  UPDATE public.platform_settings SET value = '1000' WHERE region = 'TR' AND key = 'fee_min_minor';
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests SET selected_at = now() - interval '5 hours', payment_deadline = now() - interval '4 hours',
         fee_deadline = now() - interval '3 hours', scheduled_start_at = now() - interval '1 hour', scheduled_end_at = now() + interval '1 hour'
   WHERE customer_id = '00000000-0000-0000-0000-0000003100c1';
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
  SELECT public.start_job('00000000-0000-0000-0000-0000003100e3');
  SELECT public.finish_job('00000000-0000-0000-0000-0000003100e3');
  SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000003100c1", "role": "authenticated"}', true);
  SELECT public.open_report('00000000-0000-0000-0000-0000003100e3', 'poor_work', 'Not done: the tiles are still missing.');
  UPDATE public.platform_settings SET value = '1' WHERE region = 'TR' AND key = 'reports_per_user_day';
  COMMIT; $$);

CREATE FUNCTION pg_temp.one(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(pg_temp.conn(), p_sql) AS t(r text) $$;
CREATE FUNCTION pg_temp.result(p_conn text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink_get_result(p_conn, false) AS t(r text) $$;
CREATE FUNCTION pg_temp.as_user(p_conn text, p_id text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.dblink_exec(p_conn, 'RESET ROLE')
      || extensions.dblink_exec(p_conn, 'SET ROLE authenticated')
      || extensions.dblink_exec(p_conn, format($q$ SET request.jwt.claims = '{"sub": "%s", "role": "authenticated"}' $q$, p_id)) $$;
-- A call that reports its refusal as text, so a waiting session's error comes back as a result.
CREATE FUNCTION pg_temp.wrap(p_sql text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$ DO $d$ BEGIN PERFORM set_config('race.out', (%s)::text, false);
                    EXCEPTION WHEN raise_exception THEN PERFORM set_config('race.out', sqlerrm, false); END $d$ $q$, p_sql) $$;
CREATE FUNCTION pg_temp.out(p_conn text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(p_conn, $q$ SELECT current_setting('race.out', true) $q$) AS t(r text) $$;

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());

-- ── two reports by one person at once, past the daily limit ──────────────────
SELECT pg_temp.as_user('a', '00000000-0000-0000-0000-000000310001');
SELECT pg_temp.as_user('b', '00000000-0000-0000-0000-000000310001');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT extensions.dblink_exec('a', pg_temp.wrap($q$ public.open_report('00000000-0000-0000-0000-0000003100e1', 'did_not_pay_cash', 'The customer did not pay the cash after.') ->> 'status' $q$));
SELECT is(pg_temp.out('a'), 'ok', 'R-4: the first report, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.wrap($q$ public.open_report('00000000-0000-0000-0000-0000003100e2', 'did_not_pay_cash', 'The customer did not pay the cash again.') ->> 'status' $q$));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'R-4: the second waits on the reporter''s profile row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.out('b'), 'too_many_reports', 'R-4: and then counts the first and refuses');
SELECT is(pg_temp.one($q$ SELECT count(*)::text FROM public.problem_reports WHERE reporter_id = '00000000-0000-0000-0000-000000310001' $q$), '1',
  'R-4: one report stands');

-- ── a Confirm holds E3: the admin's return to work waits, then refuses ───────
SELECT pg_temp.as_user('a', '00000000-0000-0000-0000-0000003100c1');
SELECT pg_temp.as_user('b', '00000000-0000-0000-0000-0000003100ad');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT extensions.dblink_exec('a', pg_temp.wrap($q$ public.confirm_job('00000000-0000-0000-0000-0000003100e3') ->> 'status' $q$));
SELECT is(pg_temp.out('a'), 'ok', 'R-6: the customer confirms E3 while a report is open, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.wrap(format($q$ public.handle_report(%L, 'returned_to_work', 'Back to work, the tiles are missing.') ->> 'outcome' $q$,
  pg_temp.one($q$ SELECT id::text FROM public.problem_reports WHERE request_id = '00000000-0000-0000-0000-0000003100e3' $q$))));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'X-1: the handle waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.out('b') || ' / ' || pg_temp.one($q$ SELECT status || ' ' || closed_by FROM public.requests WHERE id = '00000000-0000-0000-0000-0000003100e3' $q$),
  'invalid_state / COMPLETED customer', 'R-6: the confirm wins and the return refuses');

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();

SELECT * FROM finish();
ROLLBACK;
