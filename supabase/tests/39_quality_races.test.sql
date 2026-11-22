-- Position 19a, spec 0011-19a (D213): the quality races, with real sessions through dblink.
--
-- Two established providers apply at once for the last slot that is not reserved: the second waits on the request
-- row, then counts the first and refuses request_full, so only one takes it (AC-7). Admin handles a flag while the
-- hourly job runs: the job waits on the provider's open flags, then sees the flag handled inside the cooldown and
-- raises nothing, so no flag is duplicated or lost (AC-8). Two admins end one probation at once: the second waits on
-- the provider row, then refuses already_waived, so one waiver stands (AC-5).
--
-- Like 36, this file commits its fixtures through a dblink session and removes them at the start and the end. Its ids
-- all start 00000000-0000-0000-0000-0000003900, and nothing else uses them. The hourly job runs inside a transaction
-- that is rolled back, so it leaves nothing behind for any other provider in the database.
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
    DELETE FROM public.outbox_events WHERE payload::text LIKE '%00000000-0000-0000-0000-0000003900%';
    DELETE FROM public.audit_log WHERE actor_id::text LIKE '00000000-0000-0000-0000-0000003900%'
       OR entity_id LIKE '00000000-0000-0000-0000-0000003900%'
       OR new_value::text LIKE '%00000000-0000-0000-0000-0000003900%';
    ALTER TABLE public.quality_flags DISABLE TRIGGER quality_flags_guard;
    DELETE FROM public.quality_flags WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000003900%';
    ALTER TABLE public.quality_flags ENABLE TRIGGER quality_flags_guard;
    ALTER TABLE public.probation_waivers DISABLE TRIGGER probation_waivers_append_only;
    DELETE FROM public.probation_waivers WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000003900%';
    ALTER TABLE public.probation_waivers ENABLE TRIGGER probation_waivers_append_only;
    ALTER TABLE public.problem_reports DISABLE TRIGGER problem_reports_guard;
    DELETE FROM public.problem_reports WHERE against_id::text LIKE '00000000-0000-0000-0000-0000003900%';
    ALTER TABLE public.problem_reports ENABLE TRIGGER problem_reports_guard;
    DELETE FROM public.action_counters WHERE subject_id::text LIKE '00000000-0000-0000-0000-0000003900%';
    DELETE FROM public.apply_counters WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000003900%';
    ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
    UPDATE public.requests SET status = 'OPEN', selected_application_id = NULL, selected_at = NULL, payment_deadline = NULL,
           fee_deadline = NULL, closed_at = NULL, closed_by = NULL, actual_started_at = NULL, actual_completed_at = NULL,
           confirm_deadline = NULL
     WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000003900%' AND selected_application_id IS NOT NULL;
    ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
    ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
    DELETE FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000003900%';
    ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
    ALTER TABLE public.requests DISABLE TRIGGER requests_delete_guard;
    DELETE FROM public.requests WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000003900%';
    ALTER TABLE public.requests ENABLE TRIGGER requests_delete_guard;
    DELETE FROM public.provider_services WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000003900%';
    DELETE FROM public.provider_zones WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000003900%';
    DELETE FROM public.provider_availability WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000003900%';
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000003900%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000003900%';
    DELETE FROM public.zones WHERE id::text LIKE '00000000-0000-0000-0000-0000003900%';
    DELETE FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000003900%';
    DELETE FROM public.profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000003900%';
    DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-0000003900%';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: c1 a customer; e1, e2 established (probation waived, setup complete); f1 to f7 approved
-- applicants on R (seven of the eight slots open to established providers); p1 on probation; w1 with five COMPLETED
-- jobs (J1 to J5) and a report, so its report rate is 1 of 5 and it holds an open high_reports flag; ad the admin.
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  SELECT ('00000000-0000-0000-0000-0000003900' || t.c)::uuid, 'authenticated', 'authenticated', '9055593900' || t.n, now()
    FROM (VALUES ('c1', '01'), ('e1', '02'), ('e2', '03'), ('f1', '04'), ('f2', '05'), ('f3', '06'), ('f4', '07'),
                 ('f5', '08'), ('f6', '09'), ('f7', '10'), ('a1', '11'), ('b1', '12'), ('ad', '13')) AS t(c, n);
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  SELECT ('00000000-0000-0000-0000-0000003900' || t.c)::uuid,
         CASE t.c WHEN 'c1' THEN 'customer' WHEN 'ad' THEN 'admin' ELSE 'provider' END, 'TR', '+9055593900' || t.n,
         'Yarış ' || upper(t.c), 'tr'
    FROM (VALUES ('c1', '01'), ('e1', '02'), ('e2', '03'), ('f1', '04'), ('f2', '05'), ('f3', '06'), ('f4', '07'),
                 ('f5', '08'), ('f6', '09'), ('f7', '10'), ('a1', '11'), ('b1', '12'), ('ad', '13')) AS t(c, n);
  UPDATE public.providers SET status = 'approved', approved_at = now() - interval '30 days', approved_name = 'Yarış Usta'
   WHERE id::text LIKE '00000000-0000-0000-0000-0000003900%';
  INSERT INTO public.probation_waivers (provider_id, region, waived_by, note)
  VALUES ('00000000-0000-0000-0000-0000003900e1', 'TR', '00000000-0000-0000-0000-0000003900ad', 'Established before launch.'),
         ('00000000-0000-0000-0000-0000003900e2', 'TR', '00000000-0000-0000-0000-0000003900ad', 'Established before launch.');
  INSERT INTO public.service_categories (id, region, name, active) VALUES ('00000000-0000-0000-0000-0000003900ca', 'TR', '{"tr": "Yarış"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
  VALUES ('00000000-0000-0000-0000-000000390051', '00000000-0000-0000-0000-0000003900ca', 'TR', '{"tr": "Bir"}', 1, 2, true);
  INSERT INTO public.zones (id, region, name, multiplier, active) VALUES ('00000000-0000-0000-0000-000000390021', 'TR', '{"tr": "Semt"}', 1.00, true);
  INSERT INTO public.provider_services (provider_id, service_id, region)
  SELECT ('00000000-0000-0000-0000-0000003900' || e)::uuid, '00000000-0000-0000-0000-000000390051', 'TR' FROM unnest(ARRAY['e1', 'e2']) e;
  INSERT INTO public.provider_zones (provider_id, zone_id, region)
  SELECT ('00000000-0000-0000-0000-0000003900' || e)::uuid, '00000000-0000-0000-0000-000000390021', 'TR' FROM unnest(ARRAY['e1', 'e2']) e;
  INSERT INTO public.provider_availability (provider_id, region, work_days, start_hour, end_hour)
  SELECT ('00000000-0000-0000-0000-0000003900' || e)::uuid, 'TR', '{0,1,2,3,4,5,6}', 0, 24 FROM unnest(ARRAY['e1', 'e2']) e;
  -- R, an OPEN request in two days, and J1 to J5, w1's (here b1's) jobs.
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  SELECT ('00000000-0000-0000-0000-00000039000' || g)::uuid, 'TR', '00000000-0000-0000-0000-0000003900c1', gen_random_uuid(),
         '00000000-0000-0000-0000-000000390051', '00000000-0000-0000-0000-000000390021', '{}', '[]',
         '{"rounding_minor": 100}', 100000, 10000, 90000, 'TRY',
         CASE WHEN g = 0 THEN now() + interval '2 days' ELSE now() - interval '4 hours' END,
         CASE WHEN g = 0 THEN now() + interval '2 days 2 hours' ELSE now() - interval '2 hours' END
    FROM generate_series(0, 5) g;
  INSERT INTO public.applications (region, request_id, provider_id, message)
  SELECT 'TR', '00000000-0000-0000-0000-000000390000', ('00000000-0000-0000-0000-0000003900' || f)::uuid,
         'A filler offer for the slot race, long enough to pass.'
    FROM unnest(ARRAY['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7']) f;
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT ('00000000-0000-0000-0000-0000003901f' || g)::uuid, 'TR', ('00000000-0000-0000-0000-00000039000' || g)::uuid,
         '00000000-0000-0000-0000-0000003900b1', 'An offer for the flag race, long enough to pass.'
    FROM generate_series(1, 5) g;
  ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
  UPDATE public.applications SET status = 'CONFIRMED', status_changed_at = now() - interval '6 hours',
         unlocked_at = now() - interval '6 hours', provider_fee_amount = 0, provider_fee_kind = 'fixed'
   WHERE provider_id = '00000000-0000-0000-0000-0000003900b1';
  ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests r
     SET status = 'COMPLETED', selected_application_id = ('00000000-0000-0000-0000-0000003901f' || right(r.id::text, 1))::uuid,
         selected_at = now() - interval '9 hours', payment_deadline = now() - interval '8 hours',
         fee_deadline = now() - interval '7 hours', actual_started_at = now() - interval '4 hours',
         actual_completed_at = now() - interval '3 hours', closed_at = now() - interval '1 hour', closed_by = 'customer'
   WHERE r.customer_id = '00000000-0000-0000-0000-0000003900c1' AND r.id <> '00000000-0000-0000-0000-000000390000';
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
  INSERT INTO public.problem_reports (region, request_id, reporter_id, against_id, side, reason, text)
  VALUES ('TR', '00000000-0000-0000-0000-000000390001', '00000000-0000-0000-0000-0000003900c1',
          '00000000-0000-0000-0000-0000003900b1', 'customer', 'poor_work', 'The work was not finished as agreed on the day.');
  INSERT INTO public.quality_flags (id, region, provider_id, kind, figure)
  VALUES ('00000000-0000-0000-0000-0000003900ff', 'TR', '00000000-0000-0000-0000-0000003900b1', 'high_reports',
          '{"num": 1, "den": 5, "pct": 20, "threshold": 10}');
  COMMIT; $$);

CREATE FUNCTION pg_temp.one(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(pg_temp.conn(), p_sql) AS t(r text) $$;
CREATE FUNCTION pg_temp.as_user(p_conn text, p_id text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.dblink_exec(p_conn, 'RESET ROLE')
      || extensions.dblink_exec(p_conn, 'SET ROLE authenticated')
      || extensions.dblink_exec(p_conn, format($q$ SET request.jwt.claims = '{"sub": "%s", "role": "authenticated"}' $q$, p_id)) $$;
CREATE FUNCTION pg_temp.wrap(p_sql text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$ DO $d$ BEGIN PERFORM set_config('race.out', (%s)::text, false);
                    EXCEPTION WHEN raise_exception THEN PERFORM set_config('race.out', sqlerrm, false); END $d$ $q$, p_sql) $$;
CREATE FUNCTION pg_temp.out(p_conn text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(p_conn, $q$ SELECT current_setting('race.out', true) $q$) AS t(r text) $$;

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());

-- ── two established providers, one slot left ────────────────────────────────
SELECT pg_temp.as_user('a', '00000000-0000-0000-0000-0000003900e1');
SELECT pg_temp.as_user('b', '00000000-0000-0000-0000-0000003900e2');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT extensions.dblink_exec('a', pg_temp.wrap($q$ public.apply_to_request('00000000-0000-0000-0000-000000390000',
  'I can come in two days with my own tools and finish early.') ->> 'status' $q$));
SELECT is(pg_temp.out('a'), 'ok', 'AC-7: the first takes slot 8, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.wrap($q$ public.apply_to_request('00000000-0000-0000-0000-000000390000',
  'I can also come in two days with my own tools, gladly.') ->> 'status' $q$));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-7: the second waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.out('b'), 'request_full', 'AC-7: and then counts eight and refuses: the last two slots are reserved');
SELECT is(pg_temp.one($q$ SELECT count(*)::text FROM public.applications WHERE request_id = '00000000-0000-0000-0000-000000390000' $q$),
  '8', 'AC-7: eight offers stand');

-- ── admin handles a flag while the hourly job runs ──────────────────────────
SELECT pg_temp.as_user('a', '00000000-0000-0000-0000-0000003900ad');
SELECT extensions.dblink_exec('b', 'RESET ROLE');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT extensions.dblink_exec('a', pg_temp.wrap($q$ public.admin_handle_quality_flag('00000000-0000-0000-0000-0000003900ff',
  'cleared', 'One report, already settled with the customer.') ->> 'outcome' $q$));
SELECT is(pg_temp.out('a'), 'cleared', 'AC-9: admin clears the flag, still uncommitted');
SELECT extensions.dblink_exec('b', 'BEGIN');
SELECT extensions.dblink_send_query('b', pg_temp.wrap($q$ public.raise_quality_flags() $q$));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-8: the job waits on the provider''s open flags');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is((SELECT r FROM extensions.dblink('b', $q$ SELECT count(*)::text || ' ' || count(*) FILTER (WHERE handled_at IS NULL)::text
                                                 FROM public.quality_flags WHERE provider_id = '00000000-0000-0000-0000-0000003900b1' $q$) AS t(r text)),
  '1 0', 'AC-8: then sees it handled inside the cooldown: one flag, handled, none duplicated, none lost');
SELECT extensions.dblink_exec('b', 'ROLLBACK');

-- ── two admins end one probation ─────────────────────────────────────────────
SELECT pg_temp.as_user('a', '00000000-0000-0000-0000-0000003900ad');
SELECT pg_temp.as_user('b', '00000000-0000-0000-0000-0000003900ad');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT extensions.dblink_exec('a', pg_temp.wrap($q$ public.admin_end_probation('00000000-0000-0000-0000-0000003900a1',
  'Worked with us for years before launch.') ->> 'status' $q$));
SELECT is(pg_temp.out('a'), 'ok', 'AC-5: the first waiver, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.wrap($q$ public.admin_end_probation('00000000-0000-0000-0000-0000003900a1',
  'Also known to us for years before launch.') ->> 'status' $q$));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-5: the second waits on the provider row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.out('b'), 'already_waived', 'AC-5, X-21: and then refuses already_waived; one waiver stands');

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();

SELECT * FROM finish();
ROLLBACK;
