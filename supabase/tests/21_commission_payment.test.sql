-- Position 09, spec 0011-09: the customer pays the commission.
--
-- The settings and their checks (AC-1), the counter table and its RLS (R-14), start_checkout with the locale
-- and the IP (AC-3), pay_commission's refusals in their order, reuse, the counter, a commission of 0 and the
-- IP rules (AC-4, R-4, R-10, R-11), accept_commission true and false for each condition (AC-5, R-1), the
-- move to COMMISSION_PAID with the fee window, the start cap and the floor (AC-6, R-8), cancel during a
-- checkout (AC-2, R-6), the payer's reads my_checkout and my_receipt (AC-7, AC-13, R-3, R-13), the late
-- reason (AC-8), and every grant.
--
-- A condition that needs a row changed and put back runs inside pg_temp.probe, which rolls its own changes
-- back, so the tests after it see the fixtures as they were.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(109);

SET CONSTRAINTS ALL IMMEDIATE;

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002100' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002170' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.app(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002180' || lpad(p::text, 2, '0'))::uuid $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1 the customer, c2 another customer, a1 the approved provider every request is chosen on.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559210001'), ('c2', '905559210002'), ('a1', '905559210003')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'tr'
  FROM (VALUES ('c1', 'customer', '905559210001', 'Ödeme Bir'), ('c2', 'customer', '905559210002', 'Ödeme İki'),
               ('a1', 'provider', '905559210003', 'Ayşe Usta')) AS t(c, r, p, n);
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Ayşe Usta' WHERE id = pg_temp.u('a1');
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Ödeme"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Temizlik", "en": "Cleaning"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Semt"}', 1.00, true);

-- A request of c1 (price 100000), an offer of a1 on it, and optionally chosen.
CREATE FUNCTION pg_temp.req(p integer, p_commission bigint, p_start interval, p_choose boolean DEFAULT true)
  RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100}', 100000, p_commission, 100000 - p_commission, 'TRY', now() + p_start,
    now() + p_start + interval '2 hours');
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  VALUES (pg_temp.app(p), 'TR', pg_temp.r(p), pg_temp.u('a1'), 'An offer for the payment tests, long enough.');
  IF p_choose THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u('c1'), 'role', 'authenticated')::text, true);
    PERFORM public.choose_provider(pg_temp.r(p), pg_temp.app(p));
  END IF;
  RETURN pg_temp.r(p);
END $$;
-- The commission fee of a request, and its newest attempt (as the owner).
CREATE FUNCTION pg_temp.fee(p integer) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'commission' $$;
CREATE FUNCTION pg_temp.att(p integer) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT a.id FROM public.checkout_attempts a WHERE a.fee_payment_id = pg_temp.fee(p)
   ORDER BY (a.status IN ('queued', 'ready')) DESC, a.started_at DESC, a.id LIMIT 1 $$;
-- A statement run as a signed in user (or anon): its first column as text, the refusal code, or the SQLSTATE.
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
-- pay_commission as c1 (or another user) on request p.
CREATE FUNCTION pg_temp.pay(p integer, p_locale text DEFAULT 'tr', p_ip text DEFAULT NULL, p_user text DEFAULT 'c1')
  RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.pay_commission(%L, %L, %L)::text', pg_temp.r(p), p_locale, p_ip)) $$;
-- Run setup statements and an expression, then roll all of it back. Returns the expression as text, or the
-- refusal of the first statement that raised (with its hint after a slash).
CREATE FUNCTION pg_temp.probe(p_setup text[], p_expr text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v     text;
  s     text;
  v_hint  text;
BEGIN
  BEGIN
    BEGIN
      FOREACH s IN ARRAY p_setup LOOP
        EXECUTE s;
      END LOOP;
      EXECUTE 'SELECT (' || p_expr || ')::text' INTO v;
    EXCEPTION
      WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
        v := sqlerrm || coalesce('/' || nullif(v_hint, ''), '');
      WHEN others THEN
        v := sqlstate;
    END;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'probe_rollback';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    RETURN v;
  END;
END $$;
-- The statement that signs c1 in, for a probe that calls a definer function as postgres.
CREATE FUNCTION pg_temp.as_c1() RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT set_config('request.jwt.claims', %L, true)$q$,
                jsonb_build_object('sub', pg_temp.u('c1'), 'role', 'authenticated')::text) $$;
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'none';
EXCEPTION
  WHEN raise_exception THEN RETURN sqlerrm;
  WHEN others THEN RETURN sqlstate;
END $$;

UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'payments_enabled';

-- R1 the main path; R2 open; R3 a commission of 0; R4 past its payment deadline; R5 the counter; R6 cancelled;
-- R8 starts in 5 hours (the start cap); R9 in 30 minutes (the floor); R11 the cancel checks; R12 the reads; R13 a commission of 0 whose provider is suspended.
SELECT pg_temp.req(1, 10000, interval '3 days');
SELECT pg_temp.req(2, 10000, interval '3 days', false);
SELECT pg_temp.req(3, 0, interval '3 days');
SELECT pg_temp.req(4, 10000, interval '3 days');
SELECT pg_temp.req(5, 10000, interval '3 days');
SELECT pg_temp.req(6, 10000, interval '3 days');
SELECT pg_temp.req(8, 10000, interval '5 hours');
SELECT pg_temp.req(9, 10000, interval '30 minutes');
SELECT pg_temp.req(11, 10000, interval '3 days');
SELECT pg_temp.req(12, 10000, interval '3 days');
SELECT pg_temp.req(13, 0, interval '3 days');
SELECT pg_temp.call_as('c1', format('SELECT public.cancel_request(%L, NULL)::text', pg_temp.r(6)));
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
UPDATE public.requests SET selected_at = now() - interval '2 days', payment_deadline = now() - interval '1 hour'
 WHERE id = pg_temp.r(4);
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;

-- ══ AC-1: the settings ═══════════════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT region, key, value FROM public.platform_settings
      WHERE key IN ('min_window_minutes', 'checkouts_per_fee_hour', 'unlock_window_hours') ORDER BY key, region $$,
  $$ VALUES ('KSA', 'checkouts_per_fee_hour', '10'::jsonb), ('TR', 'checkouts_per_fee_hour', '10'::jsonb),
            ('KSA', 'min_window_minutes', '60'::jsonb), ('TR', 'min_window_minutes', '60'::jsonb),
            ('KSA', 'unlock_window_hours', '24'::jsonb), ('TR', 'unlock_window_hours', '24'::jsonb) $$,
  'AC-1: the floor is 60 minutes, the limit 10 an hour, the unlock window 24 hours, in both regions');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'min_window_minutes' $$),
  '23514', 'AC-1: a floor of 0 is refused');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET value = '1441' WHERE region = 'TR' AND key = 'min_window_minutes' $$),
  '23514', 'AC-1: a floor over a day is refused');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'checkouts_per_fee_hour' $$),
  '23514', 'AC-1: a limit of 0 is refused');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET value = '101' WHERE region = 'TR' AND key = 'checkouts_per_fee_hour' $$),
  '23514', 'AC-1: a limit over 100 is refused');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET value = '169' WHERE region = 'TR' AND key = 'unlock_window_hours' $$),
  '23514', 'AC-1: an unlock window over a week is refused');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET value = '1.5' WHERE region = 'TR' AND key = 'unlock_window_hours' $$),
  '23514', 'AC-1: a fractional unlock window is refused');
SELECT is(pg_temp.err($$ DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'min_window_minutes' $$),
  'pricing_setting_required', 'AC-1: the floor cannot be deleted');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET key = 'unlock_hours' WHERE region = 'TR' AND key = 'unlock_window_hours' $$),
  'pricing_setting_required', 'AC-1: the unlock window cannot be renamed');
SELECT is(public.unlock_settings('TR'), '{"unlock_window_hours": 24, "min_window_minutes": 60}'::jsonb,
  'AC-1: unlock_settings reads both window keys');
SELECT is(public.checkout_limit('TR'), 10, 'R-6: checkout_limit reads the limit');
SELECT is(pg_temp.err($$ SELECT public.unlock_settings('XX') $$), 'unlock_settings_invalid',
  'AC-1: a missing window key refuses unlock_settings_invalid');
SELECT is(pg_temp.err($$ SELECT public.checkout_limit('XX') $$), 'checkout_settings_invalid',
  'R-6: a missing limit refuses checkout_settings_invalid');

-- ══ R-14: the counter table ══════════════════════════════════════════════════
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.action_counters'::regclass),
  'R-14: action_counters has RLS enabled');
SELECT policies_are('public', 'action_counters', ARRAY['action_counters_no_api'], 'R-14: and only its deny policy');
SELECT is_empty(
  $$ SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'action_counters'
        AND grantee IN ('anon', 'authenticated', 'service_role') $$,
  'R-14: no API role holds a grant on action_counters');
SELECT is(pg_temp.call_as('c1', 'SELECT count(*)::text FROM public.action_counters'), '42501',
  'R-14: a customer cannot read the counters');
SELECT is(pg_temp.call_as('c1', 'SELECT count(*)::text FROM public.checkout_attempts'), '42501',
  'AC-7: a customer still cannot read checkout_attempts');

-- ══ AC-3: start_checkout replaced; the API surface ═══════════════════════════
SELECT hasnt_function('public', 'start_checkout', ARRAY['uuid'], 'AC-3: the one argument start_checkout is gone');
SELECT has_function('public', 'start_checkout', ARRAY['uuid', 'text', 'inet'], 'AC-3: start_checkout takes the locale and the IP');
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default", p.prosecdef,
            has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            has_function_privilege('service_role', p.oid, 'EXECUTE'),
            has_function_privilege('anon', p.oid, 'EXECUTE')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('accept_commission', 'after_commission_paid', 'checkout_limit', 'commission_settled', 'my_checkout',
                          'my_receipt', 'pay_commission', 'start_checkout', 'unlock_settings', 'cancel_request', 'fail_attempt')
      ORDER BY p.proname $$,
  $$ VALUES ('accept_commission', false, false, false, false), ('after_commission_paid', false, false, false, false),
            ('cancel_request', true, true, false, false), ('checkout_limit', false, false, false, false),
            ('commission_settled', false, false, false, false), ('fail_attempt', false, false, false, false),
            ('my_checkout', true, true, false, false), ('my_receipt', true, true, false, false),
            ('pay_commission', true, true, false, false), ('start_checkout', false, false, false, false),
            ('unlock_settings', false, false, false, false) $$,
  'AC-0, AC-4, AC-7, AC-13: definers only where a customer calls; internal functions have no grant');
SELECT is(pg_temp.err(format('SELECT public.start_checkout(%L, %L, NULL)', gen_random_uuid(), 'de')), 'validation_failed',
  'AC-3: a locale outside ar, tr, en is refused');

-- ══ AC-4: pay_commission, its refusals in order ═══════════════════════════════
SELECT is(pg_temp.pay(1, 'de'), 'validation_failed', 'AC-4 step 1: an unknown locale');
SELECT is(pg_temp.call_as('c1', format('SELECT public.pay_commission(%L, %L, NULL)::text', gen_random_uuid(), 'tr')),
  'not_found', 'AC-4 step 2: an unknown request');
SELECT is(pg_temp.pay(1, 'tr', NULL, 'c2'), 'not_found', 'AC-4 step 2: another customer''s request answers the same');
SELECT is(pg_temp.pay(1, 'tr', NULL, 'anon'), '42501', 'AC-4: anon cannot call it');
SELECT is(pg_temp.pay(2), 'invalid_state', 'AC-4 step 3: an OPEN request');
SELECT is(pg_temp.pay(6), 'invalid_state', 'AC-4 step 3: a cancelled request');
SELECT is(pg_temp.pay(4), 'deadline_passed', 'AC-4 step 4: after the payment deadline');
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'payments_enabled';
SELECT is(pg_temp.pay(1), 'payments_disabled', 'AC-4 step 6: payments switched off');

-- A commission of 0 (D171, A-2, R-4): settled at once, even with payments off, with no fee row.
SELECT is(pg_temp.pay(3), '{"status": "settled"}', 'AC-4 step 5: a commission of 0 is settled, payments off or not');
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'payments_enabled';
SELECT results_eq(
  $$ SELECT r.status, r.fee_deadline = now() + interval '24 hours', a.status,
            (SELECT count(*)::int FROM public.fee_payments f WHERE f.request_id = r.id)
       FROM public.requests r JOIN public.applications a ON a.id = r.selected_application_id WHERE r.id = pg_temp.r(3) $$,
  $$ VALUES ('COMMISSION_PAID', true, 'AWAITING_FEE', 0) $$,
  'R-4: a commission of 0 reaches COMMISSION_PAID, the pick AWAITING_FEE, the fee window set, with no fee row');
SELECT is(pg_temp.pay(3), 'already_paid', 'AC-4 step 3: a request past SELECTED is already paid');
SELECT is(pg_temp.probe(ARRAY[format($$UPDATE public.providers SET status = 'suspended', suspension_reason = 'A test of the pick' WHERE id = %L$$, pg_temp.u('a1'))],
                        'pg_temp.pay(13)'),
  'invalid_state', 'S09-2: a commission of 0 does not settle when the chosen provider is suspended');

SELECT is(pg_temp.probe(ARRAY[pg_temp.as_c1(), 'ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'checkout_hold_minutes'$$],
                        format('public.pay_commission(%L, %L, NULL)', pg_temp.r(1), 'tr')),
  'checkout_settings_invalid', 'AC-4 step 7: a missing hold setting refuses');

-- A new attempt, then the same one again.
CREATE TEMP TABLE pay1 AS SELECT pg_temp.pay(1, 'en', '203.0.113.7')::jsonb AS j;
SELECT is((SELECT j - 'attempt_id' FROM pay1), '{"status": "checkout", "reused": false}', 'AC-4 step 11: a new attempt');
SELECT results_eq(
  $$ SELECT a.id, a.status, a.locale, host(a.payer_ip), o.kind, o.status
       FROM public.checkout_attempts a JOIN public.outbox_events o ON o.idempotency_key = 'checkout:' || a.id || ':init'
      WHERE a.fee_payment_id = pg_temp.fee(1) $$,
  $$ VALUES ((SELECT (j ->> 'attempt_id')::uuid FROM pay1), 'queued', 'en', '203.0.113.7', 'checkout.initialize', 'pending') $$,
  'AC-3, AC-4: one queued attempt with the locale and the IP, and its outbox row');
SELECT results_eq(
  $$ SELECT region, action, window_start = date_trunc('hour', now(), 'UTC'), count FROM public.action_counters
      WHERE subject_id = pg_temp.fee(1) $$,
  $$ VALUES ('TR', 'checkout', true, 1) $$,
  'AC-4 step 10: one count for the fee in this UTC hour');
SELECT is(pg_temp.pay(1, 'en', '203.0.113.7')::jsonb,
  jsonb_build_object('status', 'checkout', 'attempt_id', (SELECT j ->> 'attempt_id' FROM pay1), 'reused', true),
  'AC-4 step 9: a young open attempt is returned as it is');
SELECT is((SELECT count FROM public.action_counters WHERE subject_id = pg_temp.fee(1)), 1, 'AC-4 step 9: and nothing is counted');
SELECT is((SELECT count(*)::int FROM public.checkout_attempts WHERE fee_payment_id = pg_temp.fee(1)), 1,
  'AC-4: still one attempt');
SELECT results_eq(
  $$ SELECT count(*)::int, bool_and(new_value::text NOT LIKE '%203.0.113%' AND NOT new_value ? 'payer_ip')
       FROM public.audit_log WHERE action = 'fee.checkout_requested' AND new_value ->> 'request_id' = pg_temp.r(1)::text $$,
  $$ VALUES (1, true) $$,
  'AC-4: one audit row for the new attempt, none for the reuse (S09-3), ids only, never the IP');

-- The IP (R-10): one full length address, else null, never an error. Each attempt is failed first.
CREATE FUNCTION pg_temp.ip_after(p_ip text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.fail_attempt(pg_temp.att(1), 'psp_failed');
  PERFORM pg_temp.pay(1, 'tr', p_ip);
  RETURN coalesce((SELECT host(payer_ip) FROM public.checkout_attempts WHERE id = pg_temp.att(1)), 'null');
END $$;
SELECT is(pg_temp.ip_after('not an address'), 'null', 'R-10: text that is not an address is stored as null');
SELECT is(pg_temp.ip_after('203.0.113.0/24'), 'null', 'R-10: a network, not one address, is stored as null');
SELECT is(pg_temp.ip_after(repeat('1', 46)), 'null', 'R-10: longer than 45 characters is stored as null');
SELECT is(pg_temp.ip_after('2001:db8::1'), '2001:db8::1', 'R-10: a full IPv6 address is kept');
SELECT is((SELECT count FROM public.action_counters WHERE subject_id = pg_temp.fee(1)), 5, 'AC-4 step 10: each new attempt counted');

-- The limit (AC-4 step 10, R-6).
SELECT pg_temp.pay(5);
UPDATE public.action_counters SET count = 10 WHERE subject_id = pg_temp.fee(5);
SELECT public.fail_attempt(pg_temp.att(5), 'psp_failed');
SELECT is(pg_temp.pay(5), 'too_many_checkouts', 'AC-4 step 10: above the limit');
SELECT results_eq(
  $$ SELECT (SELECT count FROM public.action_counters WHERE subject_id = pg_temp.fee(5)),
            (SELECT count(*)::int FROM public.checkout_attempts WHERE fee_payment_id = pg_temp.fee(5)) $$,
  $$ VALUES (10, 1) $$,
  'AC-4 step 10: the refusal rolled its count back and opened nothing');
SELECT is(pg_temp.probe(ARRAY[pg_temp.as_c1(), 'ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'checkouts_per_fee_hour'$$,
                              format('UPDATE public.action_counters SET count = 1 WHERE subject_id = %L', pg_temp.fee(5))],
                        format('public.pay_commission(%L, %L, NULL)', pg_temp.r(5), 'tr')),
  'checkout_settings_invalid', 'R-6: a missing limit refuses');

-- ══ AC-5, R-1: accept_commission ═════════════════════════════════════════════
-- R1's newest attempt is queued and young; the request is SELECTED, its pick stands.
CREATE FUNCTION pg_temp.accept1() RETURNS text LANGUAGE sql AS $$
  SELECT format('public.accept_commission(%L, %L)', pg_temp.fee(1), pg_temp.att(1)) $$;
SELECT ok(public.accept_commission(pg_temp.fee(1), pg_temp.att(1)), 'AC-5: a pending commission inside the window is accepted');
SELECT ok(NOT public.accept_commission(gen_random_uuid(), pg_temp.att(1)), 'AC-5: an unknown fee is not');
SELECT ok(NOT public.accept_commission(pg_temp.fee(1), pg_temp.att(5)), 'AC-5: nor an attempt of another fee');
SELECT is(pg_temp.probe(ARRAY[format($$UPDATE public.providers SET status = 'suspended', suspension_reason = 'A test of the pick' WHERE id = %L$$, pg_temp.u('a1'))],
                        pg_temp.accept1()),
  'false', 'R-1: not when the chosen provider is suspended');
SELECT is(pg_temp.probe(ARRAY[format($$UPDATE public.applications SET status = 'WITHDRAWN', status_changed_at = now() WHERE id = %L$$, pg_temp.app(1))],
                        pg_temp.accept1()),
  'false', 'R-1: not when the pick no longer stands');
SELECT is(pg_temp.probe(ARRAY[format($$INSERT INTO public.fee_refunds (region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency)
                                       VALUES ('TR', %L, 'fee', %L, 'pay-21-refund', 10000, 'TRY')$$, pg_temp.r(1), pg_temp.fee(1))],
                        pg_temp.accept1()),
  'false', 'AC-5: not when a refund names the fee');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($$UPDATE public.requests SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'customer', closed_at = now(), closed_by = 'customer' WHERE id = %L$$, pg_temp.r(1))],
                        pg_temp.accept1()),
  'false', 'AC-5: not after a cancel');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($$UPDATE public.requests SET selected_at = now() - interval '2 hours', payment_deadline = now() - interval '1 minute' WHERE id = %L$$, pg_temp.r(1))],
                        pg_temp.accept1()),
  'false', 'AC-5: not from an attempt started after the payment deadline');
-- An attempt started 3 hours ago, on a window that closed 10 or 20 minutes ago (the hold is 15).
CREATE FUNCTION pg_temp.old_window(p_closed interval, p_start interval DEFAULT interval '3 days') RETURNS text[] LANGUAGE sql AS $f$
  SELECT ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
               format($$UPDATE public.requests SET selected_at = now() - interval '4 hours', payment_deadline = now() - %L::interval,
                        scheduled_start_at = now() + %L::interval WHERE id = %L$$, p_closed, p_start, pg_temp.r(1)),
               format($$INSERT INTO public.checkout_attempts (region, fee_payment_id, locale, started_at)
                        VALUES ('TR', %L, 'tr', now() - interval '3 hours')$$, pg_temp.fee(1))] $f$;
SELECT is(pg_temp.probe(pg_temp.old_window(interval '10 minutes'), 'public.accept_commission(' || quote_literal(pg_temp.fee(1))
            || ', (SELECT id FROM public.checkout_attempts WHERE started_at < now() - interval ''2 hours'' AND fee_payment_id = '
            || quote_literal(pg_temp.fee(1)) || '))'),
  'true', 'AC-5: inside the hold after the deadline, an attempt started in time is accepted');
SELECT is(pg_temp.probe(pg_temp.old_window(interval '20 minutes'), 'public.accept_commission(' || quote_literal(pg_temp.fee(1))
            || ', (SELECT id FROM public.checkout_attempts WHERE started_at < now() - interval ''2 hours'' AND fee_payment_id = '
            || quote_literal(pg_temp.fee(1)) || '))'),
  'false', 'AC-5: after the deadline plus the hold, not');
SELECT is(pg_temp.probe(pg_temp.old_window(interval '10 minutes', interval '0 minutes'), 'public.accept_commission(' || quote_literal(pg_temp.fee(1))
            || ', (SELECT id FROM public.checkout_attempts WHERE started_at < now() - interval ''2 hours'' AND fee_payment_id = '
            || quote_literal(pg_temp.fee(1)) || '))'),
  'false', 'AC-5, A-1: at or after the job''s start, not');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'checkout_hold_minutes'$$],
                        pg_temp.accept1()),
  'checkout_settings_invalid', 'AC-5: a missing hold raises, so a real payment is never refunded for it');

-- ══ AC-6: the verified payment moves the request ═════════════════════════════
-- The relay applies it (as the owner here: apply_fee_paid is a definer function, and 18 proves its grants).
CREATE TEMP TABLE att1 AS SELECT pg_temp.att(1) AS id;
CREATE TEMP TABLE paid1 AS SELECT public.apply_fee_paid(pg_temp.fee(1), (SELECT id FROM att1), 'pay-21-p1', 10000, 'TRY', 300) AS j;
SELECT is((SELECT j ->> 'status' FROM paid1), 'paid', 'AC-6: the payment is accepted');
SELECT results_eq(
  $$ SELECT r.status, r.fee_deadline = now() + interval '24 hours', a.status, a.status_changed_at = now()
       FROM public.requests r JOIN public.applications a ON a.id = r.selected_application_id WHERE r.id = pg_temp.r(1) $$,
  $$ VALUES ('COMMISSION_PAID', true, 'AWAITING_FEE', true) $$,
  'AC-6: COMMISSION_PAID, the fee window 24 hours from now, the pick AWAITING_FEE');
SELECT ok(EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'request.commission_paid' AND entity_id = pg_temp.r(1)::text
                     AND new_value = jsonb_build_object('status', 'COMMISSION_PAID', 'application_id', pg_temp.app(1),
                                                        'fee_deadline', now() + interval '24 hours')),
  'AC-6: one audit row with ids and the deadline');
SELECT ok(NOT public.accept_commission(pg_temp.fee(1), (SELECT id FROM att1)), 'AC-5: a paid fee accepts nothing more');
CREATE TEMP TABLE paid2 AS SELECT public.apply_fee_paid(pg_temp.fee(1), (SELECT id FROM att1), 'pay-21-p2', 10000, 'TRY', 300) AS j;
SELECT results_eq(
  $$ SELECT (SELECT j ->> 'status' FROM paid2), a.status FROM public.checkout_attempts a WHERE a.id = (SELECT id FROM att1) $$,
  $$ VALUES ('late', 'succeeded') $$,
  'R-3: a second payment on the same attempt goes late; the attempt stays succeeded');
SELECT is(pg_temp.pay(1), 'already_paid', 'AC-4 step 3: a paid commission is not paid again');
SELECT is(pg_temp.probe(ARRAY[]::text[], format($q$(pg_temp.call_as('c1', %L))::jsonb #>> '{refund,amount}'$q$,
                                                format('SELECT public.cancel_request(%L, NULL)::text', pg_temp.r(1)))),
  '10000', 'AC-2, 12 AC-6: since 12 COMMISSION_PAID is cancellable, its commission refunded (row 5)');

-- The start cap and the floor (A-1, R-8).
CREATE FUNCTION pg_temp.pay_and_apply(p integer, p_psp text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.pay(p);
  RETURN public.apply_fee_paid(pg_temp.fee(p), pg_temp.att(p), p_psp, 10000, 'TRY', 300) ->> 'status';
END $$;
SELECT is(pg_temp.pay_and_apply(8, 'pay-21-p8'), 'paid', 'AC-6: R8 paid');
SELECT is((SELECT fee_deadline = scheduled_start_at FROM public.requests WHERE id = pg_temp.r(8)), true,
  'AC-6: a start 5 hours away caps the fee window at the start');
SELECT is(pg_temp.pay_and_apply(9, 'pay-21-p9'), 'paid', 'AC-6: R9 paid');
SELECT results_eq(
  $$ SELECT fee_deadline = now() + interval '60 minutes', fee_deadline > scheduled_start_at FROM public.requests WHERE id = pg_temp.r(9) $$,
  $$ VALUES (true, true) $$,
  'AC-6, R-8: a start 30 minutes away is raised to the 60 minute floor, past the start');

-- A missing window key refuses the whole payment, so the relay retries and alerts (R-2); the money is untouched.
SELECT pg_temp.pay(12, 'ar');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'min_window_minutes'$$],
                        format('public.apply_fee_paid(%L, %L, %L, 10000, %L, 300)', pg_temp.fee(12), pg_temp.att(12), 'pay-21-p12', 'TRY')),
  'unlock_settings_invalid', 'AC-1, R-2: a missing window key refuses the payment whole');
SELECT is(pg_temp.probe(ARRAY[format($$UPDATE public.applications SET status = 'WITHDRAWN', status_changed_at = now() WHERE id = %L$$, pg_temp.app(12))],
                        format('public.commission_settled(%L)', pg_temp.r(12))),
  'invalid_state', 'R-1: commission_settled refuses when the pick no longer stands');

-- The request guard (AC-6).
SELECT is(pg_temp.err(format($$UPDATE public.requests SET status = 'COMMISSION_PAID', fee_deadline = now() + interval '1 day' WHERE id = %L$$, pg_temp.r(2))),
  'request_transition_invalid', 'AC-6: OPEN never moves straight to COMMISSION_PAID');
SELECT is(pg_temp.err(format($$UPDATE public.requests SET status = 'COMMISSION_PAID' WHERE id = %L$$, pg_temp.r(12))),
  'request_immutable', 'AC-6: COMMISSION_PAID always carries its fee window');
SELECT is(pg_temp.err(format($$UPDATE public.requests SET fee_deadline = now() + interval '9 days' WHERE id = %L$$, pg_temp.r(1))),
  'request_immutable', 'AC-6: the fee window is written once');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($$UPDATE public.requests SET fee_deadline = selected_at WHERE id = %L$$, pg_temp.r(1))], 'true'),
  '23514', 'R-8: the fee window always ends after the choose, even as postgres');

-- ══ AC-2, R-6: cancel during a checkout ══════════════════════════════════════
SELECT pg_temp.pay(11);
CREATE FUNCTION pg_temp.cancel11() RETURNS text LANGUAGE sql AS $$
  SELECT format('public.cancel_request(%L, NULL)', pg_temp.r(11)) $$;
SELECT is(pg_temp.call_as('c1', 'SELECT ' || pg_temp.cancel11() || '::text'), 'checkout_open',
  'AC-2: a cancel is refused while a young attempt is open');
SELECT is(pg_temp.probe(ARRAY[pg_temp.as_c1(), 'ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'checkout_hold_minutes'$$],
                        pg_temp.cancel11()),
  'checkout_open/checkout_settings_invalid', 'R-6: with the hold missing, any open attempt is young, and the refusal says why');
SELECT is(pg_temp.probe(ARRAY[pg_temp.as_c1(), format($$SELECT public.fail_attempt(%L, 'psp_failed')$$, pg_temp.att(11)),
                              format($$INSERT INTO public.checkout_attempts (region, fee_payment_id, status, url, psp_token, started_at)
                                       VALUES ('TR', %L, 'ready', 'https://pay.example.test/p/old', 'tok-21-old', now() - interval '20 minutes')$$, pg_temp.fee(11))],
                        pg_temp.cancel11()),
  '{"status": "ok"}', 'AC-2: after the hold, the cancel goes through');
SELECT public.fail_attempt(pg_temp.att(11), 'psp_failed');
SELECT is(pg_temp.call_as('c1', 'SELECT ' || pg_temp.cancel11() || '::text'), '{"status": "ok"}',
  'AC-2: with no open attempt, the cancel goes through');
SELECT is((SELECT status FROM public.requests WHERE id = pg_temp.r(11)), 'CANCELLED', 'AC-2: the request is cancelled');
SELECT is(public.apply_fee_paid(pg_temp.fee(11), pg_temp.att(11), 'pay-21-p11', 10000, 'TRY', 300) ->> 'status', 'late',
  'AC-5: a payment that lands after the cancel is refunded as late');

-- ══ AC-7, AC-8, R-3: my_checkout ═════════════════════════════════════════════
CREATE FUNCTION pg_temp.checkout_as(p_user text, p_attempt uuid) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.my_checkout(%L)::text', p_attempt)) $$;
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.checkout_as('c1', pg_temp.att(12))::jsonb) k),
  ARRAY['amount', 'application_id', 'attempt_id', 'deadline', 'fee_id', 'fee_kind', 'fee_status', 'late_refund', 'locale', 'reason', 'request_id', 'status', 'url'],
  'AC-7: the named fields only: no token, no IP, no PSP payment id');
SELECT is(pg_temp.checkout_as('c1', pg_temp.att(12))::jsonb - 'attempt_id' - 'amount' - 'application_id' - 'deadline' - 'fee_id',
  jsonb_build_object('request_id', pg_temp.r(12), 'fee_kind', 'commission', 'fee_status', 'pending', 'status', 'queued',
                     'reason', NULL, 'url', NULL, 'locale', 'ar', 'late_refund', false),
  'AC-7: a queued attempt, with no URL yet');
SELECT public.mark_checkout_ready(pg_temp.att(12), 'tok-21-12', 'https://pay.example.test/p/tok-21-12');
SELECT is(pg_temp.checkout_as('c1', pg_temp.att(12))::jsonb ->> 'url', 'https://pay.example.test/p/tok-21-12',
  'AC-7: a young ready attempt gives the payer its URL');
CREATE FUNCTION pg_temp.att_row(p_status text, p_reason text, p_age interval) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.checkout_attempts (region, fee_payment_id, status, failure_reason, url, psp_token, started_at, finished_at)
  VALUES ('TR', pg_temp.fee(12), p_status, p_reason, 'https://pay.example.test/p/' || gen_random_uuid(),
          'tok-' || gen_random_uuid(), now() - p_age, CASE WHEN p_status <> 'ready' THEN now() END)
  RETURNING id $$;
SELECT is(pg_temp.checkout_as('c1', pg_temp.att_row('ready', NULL, interval '20 minutes'))::jsonb -> 'url', 'null'::jsonb,
  'AC-7: an attempt older than the hold gives no URL');
SELECT is(pg_temp.checkout_as('c1', pg_temp.att_row('failed', 'late_payment', interval '1 minute'))::jsonb ->> 'reason', 'late',
  'AC-7, AC-8: late_payment reads late');
SELECT is(pg_temp.checkout_as('c1', pg_temp.att_row('failed', 'payments_disabled', interval '1 minute'))::jsonb ->> 'reason', 'paused',
  'AC-7: payments_disabled reads paused');
SELECT is(pg_temp.checkout_as('c1', pg_temp.att_row('failed', 'psp_failed', interval '1 minute'))::jsonb ->> 'reason', 'failed',
  'AC-7: any other reason reads failed');
SELECT is(pg_temp.checkout_as('c1', (SELECT id FROM att1))::jsonb ->> 'late_refund', 'true',
  'R-3: a refunded second payment on a succeeded attempt is shown');
CREATE FUNCTION pg_temp.other_att(p_fee uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.checkout_attempts (region, fee_payment_id, status, failure_reason, started_at, finished_at)
  VALUES ('TR', p_fee, 'failed', 'psp_failed', now() - interval '1 minute', now()) RETURNING id $$;
CREATE TEMP TABLE other1 AS SELECT pg_temp.other_att(pg_temp.fee(1)) AS id;
SELECT is(pg_temp.checkout_as('c1', (SELECT id FROM other1))::jsonb ->> 'late_refund',
  'false', 'S09-1: another attempt of the same fee does not show that refund');
SELECT is(pg_temp.checkout_as('c2', pg_temp.att(12)), 'not_found', 'AC-7, R-13: another customer gets not_found');
SELECT is(pg_temp.checkout_as('a1', pg_temp.att(12)), 'not_found', 'AC-7, R-13: the provider gets not_found');
SELECT is(pg_temp.checkout_as('c1', gen_random_uuid()), 'not_found', 'R-13: an unknown id answers the same');
SELECT is(pg_temp.checkout_as('anon', pg_temp.att(12)), '42501', 'AC-7: anon cannot call it');

-- AC-8: the late reason exists for the relay.
CREATE TEMP TABLE late12 AS SELECT pg_temp.att_row('ready', NULL, interval '1 minute') AS id;
SELECT is(public.mark_checkout_failed((SELECT id FROM late12), 'late_payment'), '{"changed": true, "status": "failed"}',
  'AC-8: an attempt can be failed late_payment');
SELECT is(public.mark_checkout_failed((SELECT id FROM late12), 'late_payment'), '{"changed": false, "status": "failed"}',
  'AC-8: a replay changes nothing');
SELECT is(pg_temp.err($$ SELECT public.mark_checkout_failed(gen_random_uuid(), 'late') $$), 'validation_failed',
  'AC-8: an unknown reason is refused');

-- ══ AC-13: my_receipt ════════════════════════════════════════════════════════
CREATE FUNCTION pg_temp.receipt_as(p_user text, p_fee uuid) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.my_receipt(%L)::text', p_fee)) $$;
SELECT is(pg_temp.receipt_as('c1', pg_temp.fee(1))::jsonb,
  jsonb_build_object('receipt_number', pg_temp.fee(1), 'kind', 'commission', 'amount', 10000, 'currency', 'TRY',
                     'status', 'paid', 'paid_at', (SELECT paid_at FROM public.fee_payments WHERE id = pg_temp.fee(1)),
                     'timezone', (SELECT timezone FROM public.regions WHERE code = 'TR'), 'request_id', pg_temp.r(1),
                     'service_name', '{"tr": "Temizlik", "en": "Cleaning"}'::jsonb,
                     'scheduled_start_at', (SELECT scheduled_start_at FROM public.requests WHERE id = pg_temp.r(1))),
  'AC-13: the receipt: our fee id as the number, the amount, the paid time, the service and date; no PSP id');
SELECT is(pg_temp.receipt_as('c1', pg_temp.fee(12)), 'not_found', 'AC-13: a pending fee has no receipt');
SELECT is(pg_temp.receipt_as('c2', pg_temp.fee(1)), 'not_found', 'AC-13, R-13: another customer gets not_found');
SELECT is(pg_temp.receipt_as('a1', pg_temp.fee(1)), 'not_found', 'AC-13, R-13: the provider gets not_found');
SELECT is(pg_temp.receipt_as('c1', gen_random_uuid()), 'not_found', 'R-13: an unknown id answers the same');
SELECT is(pg_temp.receipt_as('anon', pg_temp.fee(1)), '42501', 'AC-13: anon cannot call it');

-- ══ R13 of the tracker: the payer's column grant on fee_payments is unchanged ═════
SELECT is_empty(
  $$ SELECT column_name FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND table_name = 'fee_payments' AND grantee = 'authenticated'
        AND column_name IN ('provider_id', 'psp_payment_id', 'psp_fee_amount') $$,
  'AC-0: the payer still cannot read the provider, the PSP payment id or the PSP fee');
SELECT is(pg_temp.call_as('c1', format('SELECT fee_deadline::text FROM public.requests WHERE id = %L', pg_temp.r(1))),
  (SELECT fee_deadline::text FROM public.requests WHERE id = pg_temp.r(1)), 'AC-6: the customer reads the fee window');

SELECT * FROM finish();
ROLLBACK;
