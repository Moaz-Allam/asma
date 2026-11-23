-- Position 11, spec 0011-11 R-13: the work races, with two real sessions through dblink.
--
-- Two Started presses at once start once (R-3); a customer's confirm that holds the row makes the auto close skip
-- it, and an auto close that holds the row makes a waiting confirm refuse (R-3, AC-6): never two closes.
--
-- Like 24, this file commits its fixtures through a dblink session and removes them at the start and the end. Its
-- ids all start 00000000-0000-0000-0000-0000002600, and nothing else uses them. It sets the fee settings to 0 only
-- inside its fixture transaction, and turns auto_close_enabled on for TR only between its fixtures and its clean up.
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
    UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'auto_close_enabled';
    DELETE FROM public.audit_log WHERE actor_id::text LIKE '00000000-0000-0000-0000-0000002600%'
       OR entity_id LIKE '00000000-0000-0000-0000-0000002600%'
       OR new_value::text LIKE '%00000000-0000-0000-0000-0000002600%';
    ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
    UPDATE public.requests SET status = 'OPEN', selected_application_id = NULL, selected_at = NULL, payment_deadline = NULL,
           fee_deadline = NULL, closed_at = NULL, closed_by = NULL, actual_started_at = NULL, actual_completed_at = NULL,
           confirm_deadline = NULL
     WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000002600%' AND selected_application_id IS NOT NULL;
    ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
    -- Spec 0011-20: the agreements and acceptances of these picks (append only, so their guards are lifted here).
    ALTER TABLE public.service_agreements DISABLE TRIGGER USER;
    ALTER TABLE public.agreement_acceptances DISABLE TRIGGER USER;
    ALTER TABLE public.outbox_events DISABLE TRIGGER USER;
    DELETE FROM public.outbox_events WHERE kind = 'agreement.render'
       AND payload ->> 'agreement_id' IN (SELECT id::text FROM public.service_agreements WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000002600%'));
    DELETE FROM public.service_agreements WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000002600%');
    DELETE FROM public.agreement_acceptances WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000002600%');
    ALTER TABLE public.outbox_events ENABLE TRIGGER USER;
    ALTER TABLE public.agreement_acceptances ENABLE TRIGGER USER;
    ALTER TABLE public.service_agreements ENABLE TRIGGER USER;
    ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
    DELETE FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000002600%';
    ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
    ALTER TABLE public.requests DISABLE TRIGGER requests_delete_guard;
    DELETE FROM public.requests WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000002600%';
    ALTER TABLE public.requests ENABLE TRIGGER requests_delete_guard;
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000002600%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000002600%';
    DELETE FROM public.zones WHERE id::text LIKE '00000000-0000-0000-0000-0000002600%';
    DELETE FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000002600%';
    DELETE FROM public.profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000002600%';
    DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-0000002600%';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: a customer and a provider; E1 unlocked on its start day; E2 and E3 done, their confirm deadline
-- passed. Both fees are 0 (set inside this transaction only), so no money row is written.
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key IN ('provider_fee_value', 'fee_min_minor');
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  VALUES ('00000000-0000-0000-0000-000000260001', 'authenticated', 'authenticated', '905559260001', now()),
         ('00000000-0000-0000-0000-0000002600c1', 'authenticated', 'authenticated', '905559260099', now());
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  VALUES ('00000000-0000-0000-0000-000000260001', 'provider', 'TR', '+905559260001', 'Yarış Usta', 'tr'),
         ('00000000-0000-0000-0000-0000002600c1', 'customer', 'TR', '+905559260099', 'Yarış Müşteri', 'tr');
  UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Yarış'
   WHERE id = '00000000-0000-0000-0000-000000260001';
  INSERT INTO public.service_categories (id, region, name, active) VALUES ('00000000-0000-0000-0000-0000002600ca', 'TR', '{"tr": "Yarış"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
  VALUES ('00000000-0000-0000-0000-000000260051', '00000000-0000-0000-0000-0000002600ca', 'TR', '{"tr": "Bir"}', 1, 2, true);
  INSERT INTO public.zones (id, region, name, multiplier, active) VALUES ('00000000-0000-0000-0000-000000260021', 'TR', '{"tr": "Semt"}', 1.00, true);
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  SELECT ('00000000-0000-0000-0000-0000002600e' || g)::uuid, 'TR', '00000000-0000-0000-0000-0000002600c1', gen_random_uuid(),
         '00000000-0000-0000-0000-000000260051', '00000000-0000-0000-0000-000000260021', '{}', '[]',
         '{"rounding_minor": 100}', 100000, 0, 100000, 'TRY', now() + interval '2 days', now() + interval '2 days 2 hours'
    FROM generate_series(1, 3) g;
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT ('00000000-0000-0000-0000-0000002600f' || g)::uuid, 'TR', ('00000000-0000-0000-0000-0000002600e' || g)::uuid,
         '00000000-0000-0000-0000-000000260001', 'An offer for the work races, long enough.'
    FROM generate_series(1, 3) g;
  SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000002600c1", "role": "authenticated"}', true);
  SELECT public.choose_provider(('00000000-0000-0000-0000-0000002600e' || g)::uuid, ('00000000-0000-0000-0000-0000002600f' || g)::uuid, 'draft-1')
    FROM generate_series(1, 3) g;
  SELECT public.pay_commission(('00000000-0000-0000-0000-0000002600e' || g)::uuid, 'tr', NULL, 'draft-1') FROM generate_series(1, 3) g;
  SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000260001", "role": "authenticated"}', true);
  SELECT public.pay_provider_fee(('00000000-0000-0000-0000-0000002600f' || g)::uuid, 'tr', NULL, 'draft-1') FROM generate_series(1, 3) g;
  UPDATE public.platform_settings SET value = '5' WHERE region = 'TR' AND key = 'provider_fee_value';
  UPDATE public.platform_settings SET value = '1000' WHERE region = 'TR' AND key = 'fee_min_minor';
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests SET selected_at = now() - interval '5 hours', payment_deadline = now() - interval '4 hours',
         fee_deadline = now() - interval '3 hours', scheduled_start_at = now() - interval '1 hour', scheduled_end_at = now() + interval '1 hour'
   WHERE customer_id = '00000000-0000-0000-0000-0000002600c1';
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
  SELECT public.start_job(('00000000-0000-0000-0000-0000002600e' || g)::uuid) FROM generate_series(2, 3) g;
  SELECT public.finish_job(('00000000-0000-0000-0000-0000002600e' || g)::uuid) FROM generate_series(2, 3) g;
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests SET actual_completed_at = now() - interval '4 days', confirm_deadline = now() - interval '1 day'
   WHERE id IN ('00000000-0000-0000-0000-0000002600e2', '00000000-0000-0000-0000-0000002600e3');
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
  UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'auto_close_enabled';
  COMMIT; $$);

CREATE FUNCTION pg_temp.one(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(pg_temp.conn(), p_sql) AS t(r text) $$;
CREATE FUNCTION pg_temp.result(p_conn text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT r::jsonb FROM extensions.dblink_get_result(p_conn, false) AS t(r text) $$;
CREATE FUNCTION pg_temp.call_sql(p_fn text, p text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.%I(%L)::text', p_fn, '00000000-0000-0000-0000-0000002600e' || p) $$;
CREATE FUNCTION pg_temp.as_user(p_conn text, p_id text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.dblink_exec(p_conn, 'RESET ROLE')
      || extensions.dblink_exec(p_conn, 'SET ROLE authenticated')
      || extensions.dblink_exec(p_conn, format($q$ SET request.jwt.claims = '{"sub": "%s", "role": "authenticated"}' $q$, p_id)) $$;
CREATE FUNCTION pg_temp.status(p text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.one(format($q$ SELECT r.status || ' ' || coalesce(r.closed_by, '-') FROM public.requests r
                                  WHERE r.id = '00000000-0000-0000-0000-0000002600e%s' $q$, p)) $$;

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());

-- ── two Started presses at once: one start ───────────────────────────────────
SELECT pg_temp.as_user('a', '00000000-0000-0000-0000-000000260001');
SELECT pg_temp.as_user('b', '00000000-0000-0000-0000-000000260001');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.call_sql('start_job', '1')) AS t(r text)), '{"status": "ok", "replayed": false}',
  'R-13: the first press starts E1, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.call_sql('start_job', '1'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'R-13: the second press waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b'), '{"status": "ok", "replayed": true}', 'R-3: and then is a replay');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);

-- ── a confirm holds E2: the auto close skips it, the confirm wins ────────────
SELECT pg_temp.as_user('a', '00000000-0000-0000-0000-0000002600c1');
SELECT extensions.dblink_exec('b', 'RESET ROLE');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.call_sql('confirm_job', '2')) AS t(r text)), '{"status": "ok", "replayed": false}',
  'R-13: the customer confirms E2, still uncommitted');
SELECT is((SELECT r FROM extensions.dblink('b', 'SELECT public.auto_close_jobs()::text') AS t(r text)), '1',
  'R-13: the auto close skips the locked E2 and closes only E3');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.status('2') || ' / ' || pg_temp.status('3'), 'COMPLETED customer / COMPLETED auto',
  'R-13: E2 closed by the customer, E3 by the auto close: one close each');

-- ── the auto close holds a row: a waiting confirm refuses ────────────────────
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
  UPDATE public.requests SET status = 'AWAITING_CONFIRMATION', closed_at = NULL, closed_by = NULL
   WHERE id = '00000000-0000-0000-0000-0000002600e3';
  UPDATE public.applications SET status = 'COMPLETED' WHERE id = '00000000-0000-0000-0000-0000002600f3';
  ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
  COMMIT; $$);
SELECT extensions.dblink_exec('b', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('b', 'SELECT public.auto_close_jobs()::text') AS t(r text)), '1',
  'R-13: the auto close takes E3 again, still uncommitted');
SELECT extensions.dblink_send_query('a', pg_temp.call_sql('confirm_job', '3'));
SELECT pg_sleep(0.3);
SELECT extensions.dblink_exec('b', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('a', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('a') LIKE '%invalid_state%', 'R-3: the waiting confirm then refuses: closed by auto, not a replay');
SELECT count(*) FROM extensions.dblink_get_result('a', false) AS t(r text);

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();

SELECT * FROM finish();
ROLLBACK;
