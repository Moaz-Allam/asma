-- Position 06, spec 0010: the races of choose, with two real sessions through dblink (AC-7, AC-18).
--
-- A lock only shows between two sessions, so this file commits its fixtures through a dblink session and
-- removes them at the start and the end. Its ids all start 00000000-0000-0000-0000-0000001700, and nothing
-- else uses that prefix. Requests and applications refuse a delete even as postgres, and a chosen request
-- names its application, so the clean up clears the choose columns and switches the guards off, inside one
-- transaction, as the owner.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT plan(12);

CREATE FUNCTION pg_temp.conn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('host=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database()) $$;

CREATE FUNCTION pg_temp.clean_up() RETURNS text LANGUAGE sql AS $fn$
  SELECT extensions.dblink_exec(pg_temp.conn(), $$
    BEGIN;
    DELETE FROM public.audit_log WHERE actor_id::text LIKE '00000000-0000-0000-0000-0000001700%'
       OR entity_id LIKE '00000000-0000-0000-0000-0000001700%';
    ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
    UPDATE public.requests SET status = CASE WHEN status = 'SELECTED' THEN 'OPEN' ELSE status END,
           selected_application_id = NULL, selected_at = NULL, payment_deadline = NULL
     WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000001700%' AND selected_application_id IS NOT NULL;
    ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
    -- Spec 0011-20: the agreements and acceptances of these picks (append only, so their guards are lifted here).
    ALTER TABLE public.service_agreements DISABLE TRIGGER USER;
    ALTER TABLE public.agreement_acceptances DISABLE TRIGGER USER;
    ALTER TABLE public.outbox_events DISABLE TRIGGER USER;
    DELETE FROM public.outbox_events WHERE kind = 'agreement.render'
       AND payload ->> 'agreement_id' IN (SELECT id::text FROM public.service_agreements WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001700%'));
    DELETE FROM public.service_agreements WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001700%');
    DELETE FROM public.agreement_acceptances WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001700%');
    ALTER TABLE public.outbox_events ENABLE TRIGGER USER;
    ALTER TABLE public.agreement_acceptances ENABLE TRIGGER USER;
    ALTER TABLE public.service_agreements ENABLE TRIGGER USER;
    ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
    DELETE FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001700%';
    ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
    DELETE FROM public.apply_counters WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001700%';
    DELETE FROM public.provider_services WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001700%';
    DELETE FROM public.provider_zones WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001700%';
    DELETE FROM public.provider_availability WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001700%';
    ALTER TABLE public.requests DISABLE TRIGGER requests_delete_guard;
    DELETE FROM public.requests WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000001700%';
    ALTER TABLE public.requests ENABLE TRIGGER requests_delete_guard;
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000001700%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000001700%';
    DELETE FROM public.zones WHERE id::text LIKE '00000000-0000-0000-0000-0000001700%';
    DELETE FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000001700%';
    DELETE FROM public.profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000001700%';
    DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-0000001700%';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: a customer, three approved providers with a setup, four open requests and their offers.
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  SELECT ('00000000-0000-0000-0000-0000001700' || lpad(g::text, 2, '0'))::uuid, 'authenticated', 'authenticated',
         '9055591700' || lpad(g::text, 2, '0'), now()
    FROM generate_series(1, 3) g;
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  VALUES ('00000000-0000-0000-0000-0000001700c1', 'authenticated', 'authenticated', '905559170099', now());
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  SELECT ('00000000-0000-0000-0000-0000001700' || lpad(g::text, 2, '0'))::uuid, 'provider', 'TR',
         '+9055591700' || lpad(g::text, 2, '0'), 'Seçim Usta ' || g, 'tr'
    FROM generate_series(1, 3) g;
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  VALUES ('00000000-0000-0000-0000-0000001700c1', 'customer', 'TR', '+905559170099', 'Seçim Müşteri', 'tr');
  UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Seçim Usta'
   WHERE id::text LIKE '00000000-0000-0000-0000-0000001700%';
  INSERT INTO public.service_categories (id, region, name, active) VALUES ('00000000-0000-0000-0000-0000001700ca', 'TR', '{"tr": "Seçim"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
  VALUES ('00000000-0000-0000-0000-000000170051', '00000000-0000-0000-0000-0000001700ca', 'TR', '{"tr": "Bir"}', 1, 2, true);
  INSERT INTO public.zones (id, region, name, multiplier, active) VALUES ('00000000-0000-0000-0000-000000170021', 'TR', '{"tr": "Semt"}', 1.00, true);
  INSERT INTO public.provider_services (provider_id, service_id, region)
  SELECT id, '00000000-0000-0000-0000-000000170051', 'TR' FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000001700%';
  INSERT INTO public.provider_zones (provider_id, zone_id, region)
  SELECT id, '00000000-0000-0000-0000-000000170021', 'TR' FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000001700%';
  INSERT INTO public.provider_availability (provider_id, region, work_days, start_hour, end_hour)
  SELECT id, 'TR', '{0,1,2,3,4,5,6}', 0, 24 FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000001700%';
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  SELECT ('00000000-0000-0000-0000-0000001700e' || g)::uuid, 'TR', '00000000-0000-0000-0000-0000001700c1', gen_random_uuid(),
         '00000000-0000-0000-0000-000000170051', '00000000-0000-0000-0000-000000170021', '{}', '[]',
         '{"rounding_minor": 100}', 100000, 10000, 90000, 'TRY', now() + interval '2 days', now() + interval '2 days 2 hours'
    FROM generate_series(1, 4) g;
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  VALUES ('00000000-0000-0000-0000-0000001700f1', 'TR', '00000000-0000-0000-0000-0000001700e1', '00000000-0000-0000-0000-000000170001', 'An offer for the first race, long enough.'),
         ('00000000-0000-0000-0000-0000001700f2', 'TR', '00000000-0000-0000-0000-0000001700e1', '00000000-0000-0000-0000-000000170002', 'A rival offer for the first race, as well.'),
         ('00000000-0000-0000-0000-0000001700f3', 'TR', '00000000-0000-0000-0000-0000001700e2', '00000000-0000-0000-0000-000000170001', 'An offer for the race with an apply.'),
         ('00000000-0000-0000-0000-0000001700f4', 'TR', '00000000-0000-0000-0000-0000001700e3', '00000000-0000-0000-0000-000000170001', 'An offer for the race with a suspension.'),
         ('00000000-0000-0000-0000-0000001700f5', 'TR', '00000000-0000-0000-0000-0000001700e4', '00000000-0000-0000-0000-000000170002', 'An offer for the race with a cancel.');
  COMMIT; $$);

CREATE FUNCTION pg_temp.as_sql(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000001700%s"}' $q$, p) $$;
CREATE FUNCTION pg_temp.choose_sql(p_request text, p_application text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$ SELECT public.choose_provider('00000000-0000-0000-0000-0000001700%s', '00000000-0000-0000-0000-0000001700%s', 'draft-1')::text $q$,
                p_request, p_application) $$;
CREATE FUNCTION pg_temp.one(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(pg_temp.conn(), p_sql) AS t(r text) $$;

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());
SELECT extensions.dblink_exec('a', $$ SET ROLE authenticated $$);
SELECT extensions.dblink_exec('b', $$ SET ROLE authenticated $$);

-- ── two tabs choose different offers at once: one wins ───────────────────────
SELECT extensions.dblink_exec('a', pg_temp.as_sql('c1'));
SELECT extensions.dblink_exec('b', pg_temp.as_sql('c1'));
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.choose_sql('e1', 'f1')) AS t(r text))::jsonb ->> 'status', 'ok',
  'the first tab chooses one offer, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.choose_sql('e1', 'f2'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'the second tab waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%not_choosable%', 'and then refuses not_choosable');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one($$ SELECT string_agg(status, ',' ORDER BY id) FROM public.applications WHERE request_id = '00000000-0000-0000-0000-0000001700e1' $$),
  'SELECTED,NOT_SELECTED', 'exactly one offer is SELECTED');

-- ── a choose first: the apply that waits refuses request_closed ──────────────
SELECT extensions.dblink_exec('b', pg_temp.as_sql('03'));
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.choose_sql('e2', 'f3')) AS t(r text))::jsonb ->> 'status', 'ok',
  'the customer chooses on E2, still uncommitted');
SELECT extensions.dblink_send_query('b', $$ SELECT public.apply_to_request('00000000-0000-0000-0000-0000001700e2', 'A late offer that should not land.')::text $$);
SELECT pg_sleep(0.3);
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%request_closed%', 'the apply that waited refuses request_closed');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one($$ SELECT count(*)::text FROM public.applications WHERE request_id = '00000000-0000-0000-0000-0000001700e2' $$),
  '1', 'and wrote nothing');

-- ── a suspension first: the choose that waits refuses offer_unavailable ──────
SELECT extensions.dblink_exec('a', 'RESET ROLE');
SELECT extensions.dblink_exec('b', pg_temp.as_sql('c1'));
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT extensions.dblink_exec('a', $$ UPDATE public.providers SET status = 'suspended', suspension_reason = 'Repeated complaints from customers'
                                      WHERE id = '00000000-0000-0000-0000-000000170001' $$);
SELECT extensions.dblink_send_query('b', pg_temp.choose_sql('e3', 'f4'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'the choose waits on the provider row the suspension holds');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%offer_unavailable%', 'and then refuses offer_unavailable');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one($$ SELECT status FROM public.requests WHERE id = '00000000-0000-0000-0000-0000001700e3' $$),
  'OPEN', 'the request stays OPEN');

-- ── a cancel first: the choose that waits refuses not_choosable ──────────────
SELECT extensions.dblink_exec('a', 'SET ROLE authenticated');
SELECT extensions.dblink_exec('a', pg_temp.as_sql('c1'));
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', $$ SELECT public.cancel_request('00000000-0000-0000-0000-0000001700e4', NULL)::text $$) AS t(r text)),
  '{"status": "ok"}', 'the customer cancels E4 in one tab, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.choose_sql('e4', 'f5'));
SELECT pg_sleep(0.3);
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%not_choosable%', 'the choose in the other tab refuses not_choosable');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();

SELECT * FROM finish();
ROLLBACK;
