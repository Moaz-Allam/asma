-- Position 11, spec 0011-11 (D180): work and close.
--
-- The settings (AC-1, R-2), start_job and finish_job with each refusal and replay (AC-2, AC-3, R-3, R-6),
-- confirm_job and customer_mark_done (AC-4, AC-5, R-3, R-9), the start day in the region's time zone (R-8),
-- auto_close_jobs behind its switch (AC-6, R-2, R-10), the guards (R-4), request_close_info and provider_jobs (R-5),
-- the contacts after a close (R-11), no money table touched (R-12), and every grant.
--
-- A condition that needs a row changed and put back runs inside pg_temp.probe, which rolls its own changes back.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(67);

SET CONSTRAINTS ALL IMMEDIATE;

CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002500' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002570' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.app(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002580' || lpad(p::text, 2, '0'))::uuid $$;

-- c1 the customer, c2 a stranger, a1 the chosen provider, a2 another provider.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559250001'), ('c2', '905559250002'), ('a1', '905559250003'), ('a2', '905559250004')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'tr'
  FROM (VALUES ('c1', 'customer', '905559250001', 'İş Müşteri'), ('c2', 'customer', '905559250002', 'Yabancı'),
               ('a1', 'provider', '905559250003', 'İş Usta'), ('a2', 'provider', '905559250004', 'Öteki Usta')) AS t(c, r, p, n);
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'İş Usta' WHERE id IN (pg_temp.u('a1'), pg_temp.u('a2'));
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "İş"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Temizlik"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Moda"}', 1.00, true);
-- Fees of 0 on both sides (D171), so each fixture reaches UNLOCKED with no card page.
UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key IN ('provider_fee_value', 'fee_min_minor');

-- The money tables as they stand, to prove no function here touches them (R-12).
CREATE FUNCTION pg_temp.money_sum() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(coalesce((SELECT string_agg(f::text, '|' ORDER BY f.id) FROM public.fee_payments f), '')
          || coalesce((SELECT string_agg(j::text, '|' ORDER BY j.id) FROM public.ledger_journals j), '')
          || coalesce((SELECT string_agg(e::text, '|' ORDER BY e.id) FROM public.ledger_entries e), '')
          || coalesce((SELECT string_agg(o::text, '|' ORDER BY o.id) FROM public.outbox_events o), '')) $$;

CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text, true) $$;
-- A request of c1 starting in 3 days, chosen on a1 (a2 also applied), both fees 0, so UNLOCKED.
CREATE FUNCTION pg_temp.req(p integer) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100}', 100000, 0, 100000, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours');
  INSERT INTO public.request_addresses (request_id, region, customer_id, line) VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), 'Moda Cad. No 5');
  INSERT INTO public.applications (id, region, request_id, provider_id, message) VALUES
    (pg_temp.app(p), 'TR', pg_temp.r(p), pg_temp.u('a1'), 'An offer for the work tests, long enough to pass.');
  PERFORM pg_temp.as_user('c1');
  PERFORM public.choose_provider(pg_temp.r(p), pg_temp.app(p));
  PERFORM public.pay_commission(pg_temp.r(p), 'tr', NULL);
  PERFORM pg_temp.as_user('a1');
  PERFORM public.pay_provider_fee(pg_temp.app(p), 'tr', NULL);
  RETURN pg_temp.r(p);
END $$;
-- Move a request's start into the past (its deadlines with it), as the clock would on the start day.
CREATE FUNCTION pg_temp.today(p integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests SET selected_at = now() - interval '5 hours', payment_deadline = now() - interval '4 hours',
         fee_deadline = now() - interval '3 hours', scheduled_start_at = now() - interval '1 hour',
         scheduled_end_at = now() + interval '1 hour'
   WHERE id = pg_temp.r(p);
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
END $$;
CREATE FUNCTION pg_temp.call_as(p_user text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     CASE WHEN p_user = 'anon' THEN '{"role": "anon"}'
                          ELSE jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', CASE WHEN p_user = 'anon' THEN 'anon' ELSE 'authenticated' END);
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION
    WHEN raise_exception THEN v := sqlerrm;
    WHEN others THEN v := sqlstate;
  END;
  RESET ROLE;
  RETURN v;
END $$;
CREATE FUNCTION pg_temp.job(p_fn text, p integer, p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.%I(%L)::text', p_fn, pg_temp.r(p))) $$;
CREATE FUNCTION pg_temp.probe(p_setup text[], p_expr text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v  text;
  s  text;
BEGIN
  BEGIN
    BEGIN
      FOREACH s IN ARRAY p_setup LOOP
        EXECUTE s;
      END LOOP;
      EXECUTE 'SELECT (' || p_expr || ')::text' INTO v;
    EXCEPTION
      WHEN raise_exception THEN v := sqlerrm;
      WHEN others THEN v := sqlstate;
    END;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'probe_rollback';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    RETURN v;
  END;
END $$;
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'none';
EXCEPTION
  WHEN raise_exception THEN RETURN sqlerrm;
  WHEN others THEN RETURN sqlstate;
END $$;
CREATE FUNCTION pg_temp.status(p integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT r.status || ' ' || a.status || ' ' || coalesce(r.closed_by, '-')
    FROM public.requests r JOIN public.applications a ON a.id = r.selected_application_id WHERE r.id = pg_temp.r(p) $$;

-- R1 untouched (UNLOCKED, starts in 3 days); R2 the provider's path; R3 the customer closes early (too early);
-- R4 the customer closes on the day; R5 done, then the customer tries to close; R6 the auto close; R7 replays.
SELECT pg_temp.req(g) FROM generate_series(1, 7) g;
-- The money tables after the fixtures (fees of 0 write none), to prove the work functions touch none (R-12).
CREATE TEMP TABLE money_before AS SELECT pg_temp.money_sum() AS sum;
-- S11-1: a2 lost R2 (written as 10's unlock leaves a losing applicant).
INSERT INTO public.applications (id, region, request_id, provider_id, message, status)
VALUES ('00000000-0000-0000-0000-000000259002', 'TR', pg_temp.r(2), pg_temp.u('a2'), 'A losing offer for the work tests, long enough.', 'NOT_SELECTED');
SELECT pg_temp.today(g) FROM unnest(ARRAY[2, 4, 5, 6, 7]) g;
UPDATE public.platform_settings SET value = '5' WHERE region = 'TR' AND key = 'provider_fee_value';
UPDATE public.platform_settings SET value = '1000' WHERE region = 'TR' AND key = 'fee_min_minor';

-- ══ AC-1, R-2: the settings ══════════════════════════════════════════════════
SELECT results_eq($$ SELECT region, value FROM public.platform_settings WHERE key = 'auto_close_enabled' ORDER BY region $$,
  $$ VALUES ('KSA'::text, 'false'::jsonb), ('TR', 'false'::jsonb) $$, 'R-2: the auto close is seeded off in both regions');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'confirm_window_hours'$$),
  '23514', 'AC-1: confirm_window_hours below 1 is refused');
SELECT is(pg_temp.err($$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'auto_close_enabled'$$),
  'pricing_setting_required', 'R-2: the switch cannot be deleted');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '"yes"' WHERE region = 'TR' AND key = 'auto_close_enabled'$$),
  '23514', 'R-2: the switch is a JSON boolean');

-- ══ AC-2: start_job ══════════════════════════════════════════════════════════
SELECT is(pg_temp.job('start_job', 2, 'c1'), 'not_found', 'AC-2: the customer cannot start');
SELECT is(pg_temp.job('start_job', 2, 'a2'), 'not_found', 'AC-2, R-12: another provider cannot start');
SELECT is(pg_temp.job('start_job', 2, 'c2'), 'not_found', 'AC-2: nor a stranger');
SELECT is(pg_temp.call_as('a1', format('SELECT public.start_job(%L)::text', gen_random_uuid())), 'not_found', 'AC-2: an unknown id');
SELECT is(pg_temp.job('start_job', 2, 'anon'), '42501', 'AC-2: anon cannot call it');
SELECT is(pg_temp.job('start_job', 1, 'a1'), 'too_early', 'AC-2: before the start day');
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.providers SET status = 'suspended', suspension_reason = 'A test of the work' WHERE id = %L$q$, pg_temp.u('a1'))],
                        format('pg_temp.job(%L, %s, %L)', 'start_job', 2, 'a1')), 'provider_suspended', 'AC-2, R-9: a suspended provider cannot start');
SELECT is(pg_temp.job('start_job', 2, 'a1'), '{"status": "ok", "replayed": false}', 'AC-2: started on the start day');
SELECT is(pg_temp.status(2), 'IN_PROGRESS STARTED -', 'AC-2: the request IN_PROGRESS, the application STARTED');
SELECT ok((SELECT r.actual_started_at = now() AND a.status_changed_at = now()
             FROM public.requests r JOIN public.applications a ON a.id = r.selected_application_id WHERE r.id = pg_temp.r(2)),
  'AC-2, R-6: actual_started_at and status_changed_at set');
SELECT is(pg_temp.job('start_job', 2, 'a1'), '{"status": "ok", "replayed": true}', 'R-3: a second press is a replay');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'job.started' AND entity_id = pg_temp.r(2)::text), 1,
  'AC-2: one audit row');

-- ══ AC-3: finish_job ═════════════════════════════════════════════════════════
SELECT is(pg_temp.job('finish_job', 1, 'a1'), 'invalid_state', 'AC-3: not before Started');
SELECT is(pg_temp.job('finish_job', 2, 'a2'), 'not_found', 'AC-3: not another provider');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'confirm_window_hours'$$],
                        format('pg_temp.job(%L, %s, %L)', 'finish_job', 2, 'a1')), 'confirm_settings_invalid',
  'AC-1: a missing confirm window refuses');
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.providers SET status = 'suspended', suspension_reason = 'A test of the work' WHERE id = %L$q$, pg_temp.u('a1'))],
                        format('pg_temp.job(%L, %s, %L)', 'finish_job', 2, 'a1')), 'provider_suspended',
  'R-1, S11-5: a provider suspended after Started cannot finish');
SELECT is(pg_temp.job('finish_job', 2, 'a1'), '{"status": "ok", "replayed": false}', 'AC-3: done');
SELECT ok((SELECT status_changed_at = now() FROM public.applications WHERE id = pg_temp.app(2)), 'R-6: Done sets status_changed_at');
SELECT is(pg_temp.status(2), 'AWAITING_CONFIRMATION COMPLETED -', 'AC-3: AWAITING_CONFIRMATION, the application COMPLETED');
SELECT ok((SELECT actual_completed_at = now() AND confirm_deadline = now() + interval '72 hours' FROM public.requests WHERE id = pg_temp.r(2)),
  'AC-3: actual_completed_at now, the confirm deadline 72 hours on');
SELECT is(pg_temp.job('finish_job', 2, 'a1'), '{"status": "ok", "replayed": true}', 'R-3: a second Done is a replay');
SELECT is(pg_temp.job('start_job', 2, 'a1'), 'invalid_state', 'R-3: Started after Done is refused, not a replay');

-- ══ AC-4: confirm_job ════════════════════════════════════════════════════════
SELECT is(pg_temp.job('confirm_job', 2, 'a1'), 'not_found', 'AC-4: the provider cannot confirm');
SELECT is(pg_temp.job('confirm_job', 2, 'c2'), 'not_found', 'AC-4, R-12: nor another customer');
SELECT is(pg_temp.job('confirm_job', 1, 'c1'), 'invalid_state', 'AC-4: not before Done');
SELECT is(pg_temp.job('confirm_job', 2, 'c1'), '{"status": "ok", "replayed": false}', 'AC-4: confirmed');
SELECT is(pg_temp.status(2), 'COMPLETED CONFIRMED customer', 'AC-4: COMPLETED by the customer, the application CONFIRMED');
SELECT ok((SELECT closed_at = now() FROM public.requests WHERE id = pg_temp.r(2)), 'AC-4: closed_at set');
SELECT is(pg_temp.job('confirm_job', 2, 'c1'), '{"status": "ok", "replayed": true}', 'R-3: a second confirm is a replay');
SELECT is((pg_temp.job('request_contacts', 2, 'a1'))::jsonb ->> 'street', 'Moda Cad. No 5', 'R-11: the provider still reads the contacts after the close');

-- ══ AC-5: customer_mark_done ═════════════════════════════════════════════════
SELECT is(pg_temp.job('customer_mark_done', 3, 'c1'), 'too_early', 'AC-5: before the start day');
SELECT is(pg_temp.job('customer_mark_done', 4, 'a1'), 'not_found', 'AC-5: the provider cannot');
SELECT is(pg_temp.job('customer_mark_done', 4, 'c1'), '{"status": "ok", "replayed": false}', 'AC-5: the customer closes from UNLOCKED');
SELECT is(pg_temp.status(4), 'COMPLETED CONFIRMED customer', 'AC-5: COMPLETED, CONFIRMED, by the customer');
SELECT ok((SELECT actual_started_at IS NULL AND actual_completed_at = now() FROM public.requests WHERE id = pg_temp.r(4)),
  'AC-5, R-7: no start, the completion now');
SELECT pg_temp.job('start_job', 5, 'a1');
SELECT pg_temp.job('finish_job', 5, 'a1');
SELECT is(pg_temp.job('customer_mark_done', 5, 'c1'), 'invalid_state', 'R-12: not from AWAITING_CONFIRMATION');
SELECT is(pg_temp.job('customer_mark_done', 1, 'c1'), 'too_early', 'R-8: R1 starts in 3 days');

-- ══ R-8: the start day in the region's time zone ═════════════════════════════
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
  format($q$UPDATE public.requests SET selected_at = now() - interval '2 days', payment_deadline = now() - interval '1 day 23 hours', fee_deadline = now() - interval '1 day 22 hours', scheduled_start_at = (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') + interval '1 day 30 minutes') AT TIME ZONE 'Europe/Istanbul',
                                     scheduled_end_at = (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') + interval '1 day 3 hours') AT TIME ZONE 'Europe/Istanbul'
            WHERE id = %L$q$, pg_temp.r(1))], format('public.start_day_reached(%L)', pg_temp.r(1))), 'false',
  'R-8: 00:30 tomorrow local is not yet the start day');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
  format($q$UPDATE public.requests SET selected_at = now() - interval '2 days', payment_deadline = now() - interval '1 day 23 hours', fee_deadline = now() - interval '1 day 22 hours',
                                     scheduled_start_at = (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') + interval '23 hours 59 minutes') AT TIME ZONE 'Europe/Istanbul',
                                     scheduled_end_at = (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') + interval '1 day 2 hours') AT TIME ZONE 'Europe/Istanbul'
            WHERE id = %L$q$, pg_temp.r(1))], format('public.start_day_reached(%L)', pg_temp.r(1))), 'true',
  'R-8: 23:59 today local is the start day from 00:00');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
  format($q$UPDATE public.requests SET selected_at = now() - interval '2 days', payment_deadline = now() - interval '1 day 23 hours', fee_deadline = now() - interval '1 day 22 hours',
                                     scheduled_start_at = (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul')) AT TIME ZONE 'Europe/Istanbul',
                                     scheduled_end_at = (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') + interval '2 hours') AT TIME ZONE 'Europe/Istanbul'
            WHERE id = %L$q$, pg_temp.r(1))], format('public.start_day_reached(%L)', pg_temp.r(1))), 'true',
  'R-8: a start at exactly 00:00 local is its own start day');

-- ══ AC-6, R-2: the auto close ════════════════════════════════════════════════
SELECT pg_temp.job('start_job', 6, 'a1');
SELECT pg_temp.job('finish_job', 6, 'a1');
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
UPDATE public.requests SET actual_completed_at = now() - interval '4 days', confirm_deadline = now() - interval '1 day' WHERE id = pg_temp.r(6);
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
SELECT is(public.auto_close_jobs(), 0, 'R-2: with the switch off nothing closes');
SELECT is(pg_temp.status(6), 'AWAITING_CONFIRMATION COMPLETED -', 'R-2: the job waits');
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'auto_close_enabled';
SELECT is(public.auto_close_jobs(), 1, 'AC-6: with the switch on the job past its deadline closes');
SELECT is(pg_temp.status(6), 'COMPLETED CONFIRMED auto', 'AC-6: COMPLETED by auto, the application CONFIRMED');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'job.auto_closed' AND entity_id = pg_temp.r(6)::text AND actor_id IS NULL), 1,
  'R-10: one audit row, no actor');
SELECT is(pg_temp.job('confirm_job', 6, 'c1'), 'invalid_state', 'R-3: a confirm after the auto close is refused, not a replay');
SELECT is(public.auto_close_jobs(), 0, 'AC-6: the next run finds nothing');
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'auto_close_enabled';

-- ══ R-4: the guards ══════════════════════════════════════════════════════════
SELECT is(pg_temp.err(format($q$UPDATE public.requests SET closed_by = 'auto' WHERE id = %L$q$, pg_temp.r(2))), 'request_immutable',
  'R-4: closed_by never changes');
SELECT is(pg_temp.err(format($q$UPDATE public.requests SET status = 'COMPLETED' WHERE id = %L$q$, pg_temp.r(1))), '23514',
  'R-4: COMPLETED needs closed_at and closed_by');
SELECT is(pg_temp.err(format($q$UPDATE public.applications SET status = 'COMPLETED', status_changed_at = now() WHERE id = %L$q$, pg_temp.app(1))),
  'application_transition_invalid', 'R-4: UNLOCKED cannot jump to COMPLETED');
SELECT is(pg_temp.err(format($q$UPDATE public.applications SET status = 'STARTED' WHERE id = %L$q$, pg_temp.app(2))),
  'application_final', 'R-4: CONFIRMED is final');
SELECT is(pg_temp.call_as('c1', format($q$UPDATE public.requests SET actual_started_at = now() WHERE id = %L RETURNING 'x'$q$, pg_temp.r(1))), '42501',
  'R-12: the customer cannot update the request');

-- ══ R-5: the reads ═══════════════════════════════════════════════════════════
SELECT is(pg_temp.job('request_close_info', 1, 'c1'), '{"can_mark_done": false, "auto_close_enabled": false}', 'R-5: R1 cannot be closed yet');
SELECT is((pg_temp.job('request_close_info', 7, 'c1'))::jsonb ->> 'can_mark_done', 'true', 'R-5: R7 can be closed on its day');
SELECT is(pg_temp.job('request_close_info', 7, 'a1'), 'not_found', 'R-5: the provider cannot read it');
SELECT ok((SELECT bool_or((x ->> 'application_id')::uuid = pg_temp.app(5) AND (x ->> 'request_status') = 'AWAITING_CONFIRMATION')
             FROM jsonb_array_elements((pg_temp.call_as('a1', $$SELECT public.provider_jobs('active', NULL, NULL)::text$$))::jsonb -> 'rows') x),
  'A-3, R-5: a job waiting for the customer stays in Active with its state');
SELECT ok((SELECT bool_or((x ->> 'application_id')::uuid = pg_temp.app(7) AND (x ->> 'can_start')::boolean)
             FROM jsonb_array_elements((pg_temp.call_as('a1', $$SELECT public.provider_jobs('active', NULL, NULL)::text$$))::jsonb -> 'rows') x),
  'R-5: can_start is true on the start day');
SELECT ok((SELECT bool_or((x ->> 'application_id')::uuid = pg_temp.app(2))
             FROM jsonb_array_elements((pg_temp.call_as('a1', $$SELECT public.provider_jobs('done', NULL, NULL)::text$$))::jsonb -> 'rows') x),
  'A-3: a confirmed job is in Done');
SELECT is((SELECT jsonb_build_object('s', x -> 'request_status', 'a', x -> 'actual_started_at', 'd', x -> 'confirm_deadline', 'c', x -> 'closed_at', 'k', x -> 'can_start')
             FROM jsonb_array_elements((pg_temp.call_as('a2', $$SELECT public.provider_jobs('done', NULL, NULL)::text$$))::jsonb -> 'rows') x
            WHERE x ->> 'application_id' = '00000000-0000-0000-0000-000000259002'),
  '{"a": null, "c": null, "d": null, "k": false, "s": null}'::jsonb,
  'S11-1: the losing provider learns nothing of the winner''s job');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET status = 'AWAITING_CONFIRMATION' WHERE id = %L$q$, pg_temp.r(1))], '1'), '23514',
  'S11-4: AWAITING_CONFIRMATION needs its deadline (the check holds even with the guard aside)');

-- ══ R-12: no money moved; grants ═════════════════════════════════════════════
SELECT is(pg_temp.money_sum(), (SELECT sum FROM money_before),
  'R-12, D91, S11-5: no fee, journal, entry or outbox row was written or changed by the work functions');
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default", p.prosecdef, has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            has_function_privilege('service_role', p.oid, 'EXECUTE'), has_function_privilege('anon', p.oid, 'EXECUTE')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('auto_close_enabled', 'auto_close_jobs', 'close_job', 'confirm_job', 'confirm_settings', 'customer_mark_done',
                          'finish_job', 'job_for_provider', 'request_close_info', 'start_day_reached', 'start_job')
      ORDER BY p.proname $$,
  $$ VALUES ('auto_close_enabled', false, false, false, false), ('auto_close_jobs', true, false, false, false),
            ('close_job', false, false, false, false), ('confirm_job', true, true, false, false),
            ('confirm_settings', false, false, false, false), ('customer_mark_done', true, true, false, false),
            ('finish_job', true, true, false, false), ('job_for_provider', false, false, false, false),
            ('request_close_info', true, true, false, false), ('start_day_reached', false, false, false, false),
            ('start_job', true, true, false, false) $$,
  'R-10: definers only where a user calls; the auto close and the helpers have no API grant');
SELECT is((SELECT count(*)::int FROM cron.job WHERE jobname = 'jobs-auto-close' AND schedule = '*/10 * * * *'), 1,
  'AC-6: the cron job runs every 10 minutes');

SELECT * FROM finish();
ROLLBACK;
