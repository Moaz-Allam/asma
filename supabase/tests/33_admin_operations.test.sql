-- Position 16, spec 0011-16 (D197): admin operations.
--
-- Every new function refuses a customer, a provider and anon (R-13, AC-9); the columns and the admin rows of the
-- matrix (R-3, R-5, X-8); the request list, its filters, its shape and its refusals (R-1, R-2); the admin cancel in
-- each state of the matrix, its audit row, its replay, its mail and the open card page (R-3, R-4, X-1, X-2, X-9,
-- X-10); the extension once per pick and once per request, its caps, its refusals and a fresh allowance for a new
-- pick (R-5, X-5 to X-7); each guard carve out passing alone and failing with any other change (R-6, X-3, X-4); the
-- flag queue, the hand clear and the latch (R-7, X-15); the street line rule and its audit row (R-8, X-13); the
-- revenue signs over a paid, a refunded and a late payment, the grains and the ranges (R-9, X-11, X-12); and every
-- grant.
--
-- A condition that needs a row changed and put back runs inside pg_temp.probe, which rolls its own changes back.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(116);

SET CONSTRAINTS ALL IMMEDIATE;

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003300' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003370' || lpad(p::text, 2, '0'))::uuid $$;
-- The application of provider w (a1, a2, a3) on request p.
CREATE FUNCTION pg_temp.app(p integer, w text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-00000033' || CASE w WHEN 'a1' THEN '81' WHEN 'a2' THEN '82' ELSE '83' END
          || lpad(p::text, 2, '0'))::uuid $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1 the customer, a1 a2 a3 providers who apply everywhere, ad the admin. c1 and a1 have confirmed addresses, so the
-- cancel mail is queued.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559330001'), ('a1', '905559330002'), ('a2', '905559330003'), ('a3', '905559330004'),
               ('ad', '905559330005')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale, email, email_confirmed_at)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'tr', e, CASE WHEN e IS NOT NULL THEN now() END
  FROM (VALUES ('c1', 'customer', '905559330001', 'Yönetim Müşteri', 'c1-33@example.com'),
               ('a1', 'provider', '905559330002', 'Bir Usta', 'a1-33@example.com'),
               ('a2', 'provider', '905559330003', 'İki Usta', NULL),
               ('a3', 'provider', '905559330004', 'Üç Usta', NULL),
               ('ad', 'admin', '905559330005', 'Yönetici', NULL)) AS t(c, r, p, n, e);
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Usta'
 WHERE id IN (pg_temp.u('a1'), pg_temp.u('a2'), pg_temp.u('a3'));
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Yönetim"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Temizlik", "en": "Cleaning"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Moda"}', 1.00, true);
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key IN ('payments_enabled', 'emails_enabled');

CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text, true) $$;
-- A request of c1 (price 100000, commission 10000), starting in 3 days, offers of a1, a2 and a3, a street line.
CREATE FUNCTION pg_temp.req(p integer) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at, notes)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100}', 100000, 10000, 90000, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours',
    'Ring twice');
  INSERT INTO public.request_addresses (request_id, region, customer_id, line) VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), 'Moda Cad. No 7');
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT pg_temp.app(p, w), 'TR', pg_temp.r(p), pg_temp.u(w), 'An offer for the admin tests, long enough to pass.'
    FROM unnest(ARRAY['a1', 'a2', 'a3']) w;
  RETURN pg_temp.r(p);
END $$;
CREATE FUNCTION pg_temp.choose(p integer, w text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user('c1');
  RETURN public.choose_provider(pg_temp.r(p), pg_temp.app(p, w));
END $$;
CREATE FUNCTION pg_temp.cfee(p integer) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'commission' $$;
CREATE FUNCTION pg_temp.pfee(p integer, w text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'provider_fee' AND application_id = pg_temp.app(p, w) $$;
CREATE FUNCTION pg_temp.paycom(p integer, p_apply boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_att uuid;
BEGIN
  PERFORM pg_temp.as_user('c1');
  v_att := (public.pay_commission(pg_temp.r(p), 'tr', NULL) ->> 'attempt_id')::uuid;
  IF NOT p_apply THEN
    RETURN jsonb_build_object('attempt_id', v_att);
  END IF;
  RETURN public.apply_fee_paid(pg_temp.cfee(p), v_att, 'pay-33-c' || p, 10000, 'TRY', 300);
END $$;
CREATE FUNCTION pg_temp.payfee(p integer, w text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_att uuid;
BEGIN
  PERFORM pg_temp.as_user(w);
  v_att := (public.pay_provider_fee(pg_temp.app(p, w), 'tr', NULL) ->> 'attempt_id')::uuid;
  RETURN public.apply_fee_paid(pg_temp.pfee(p, w), v_att, 'pay-33-p' || p || w, 5000, 'TRY', 150);
END $$;
-- Move a revealed job's start and end far into the past, as the clock would.
CREATE FUNCTION pg_temp.age_late(p integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests SET selected_at = now() - interval '40 hours', payment_deadline = CASE WHEN payment_deadline IS NOT NULL THEN now() - interval '39 hours' END,
         fee_deadline = now() - interval '38 hours', scheduled_start_at = now() - interval '27 hours',
         scheduled_end_at = now() - interval '25 hours' WHERE id = pg_temp.r(p);
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
END $$;
CREATE FUNCTION pg_temp.age_attempts(p_fee uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE public.checkout_attempts DISABLE TRIGGER checkout_attempts_guard;
  UPDATE public.checkout_attempts SET started_at = now() - interval '1 hour' WHERE fee_payment_id = p_fee;
  ALTER TABLE public.checkout_attempts ENABLE TRIGGER checkout_attempts_guard;
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
-- Admin's calls, as admin through the API role.
CREATE FUNCTION pg_temp.cancel(p integer, p_by text DEFAULT 'platform', p_reason text DEFAULT 'The customer asked by phone.')
  RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as('ad', format('SELECT public.admin_cancel_request(%L, %L, %L)::text', pg_temp.r(p), p_by, p_reason)) $$;
CREATE FUNCTION pg_temp.extend(p integer, p_which text, p_hours integer, p_reason text DEFAULT 'The provider asked for time.')
  RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as('ad', format('SELECT public.admin_extend_deadline(%L, %L, %s, %L)::text', pg_temp.r(p), p_which, p_hours, p_reason)) $$;
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
-- A statement as postgres: 'ok', or the error it raised.
CREATE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.probe(ARRAY[p_sql], '''ok''') $$;
CREATE FUNCTION pg_temp.st(p integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT status || ' ' || coalesce(cancelled_by, '-') || ' ' || coalesce(cancel_reason, '-') FROM public.requests WHERE id = pg_temp.r(p) $$;
CREATE FUNCTION pg_temp.tr_today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE (SELECT timezone FROM public.regions WHERE code = 'TR'))::date $$;

-- ══ R-13, AC-9: every function refuses a customer, a provider and anon ════════
SELECT pg_temp.req(1);
CREATE TEMP TABLE calls (fn text, sql text);
INSERT INTO calls VALUES
  ('admin_requests', 'SELECT public.admin_requests(NULL, NULL, NULL, NULL, NULL, 1)::text'),
  ('admin_cancel_request', format('SELECT public.admin_cancel_request(%L, %L, %L)::text', pg_temp.r(1), 'platform', 'A reason long enough.')),
  ('admin_extend_deadline', format('SELECT public.admin_extend_deadline(%L, %L, 2, %L)::text', pg_temp.r(1), 'payment', 'A reason long enough.')),
  ('admin_flags', 'SELECT public.admin_flags(1)::text'),
  ('admin_clear_flag', format('SELECT public.admin_clear_flag(%L, %L)::text', gen_random_uuid(), 'A note long enough.')),
  ('admin_request_address', format('SELECT public.admin_request_address(%L, %L)::text', pg_temp.r(1), 'A reason long enough.')),
  ('admin_revenue', format('SELECT public.admin_revenue(%L, %L, %L)::text', current_date, current_date, 'day'));
SELECT is(pg_temp.call_as('c1', sql) || ' ' || pg_temp.call_as('a1', sql) || ' ' || pg_temp.call_as('anon', sql),
          'forbidden forbidden 42501', 'R-13: ' || fn || ' refuses a customer, a provider and anon')
  FROM calls ORDER BY fn;

-- ══ R-3, R-5, X-8: the columns and the matrix ════════════════════════════════
SELECT has_column('public', 'applications', 'payment_extended_at', 'R-5: applications.payment_extended_at');
SELECT has_column('public', 'applications', 'fee_extended_at', 'R-5: applications.fee_extended_at');
SELECT has_column('public', 'requests', 'confirm_extended_at', 'R-5: requests.confirm_extended_at');
SELECT results_eq(
  $$ SELECT region, state, allowed, commission_outcome, provider_fee_outcome, counts_against FROM public.cancellation_rules
      WHERE actor = 'admin' AND state IN ('OPEN', 'SELECTED') ORDER BY region, state $$,
  $$ VALUES ('KSA'::text, 'OPEN'::text, true, 'not_paid'::text, 'not_paid'::text, 'admin_attribution'::text),
            ('KSA', 'SELECTED', true, 'not_paid', 'not_paid', 'admin_attribution'),
            ('TR', 'OPEN', true, 'not_paid', 'not_paid', 'admin_attribution'),
            ('TR', 'SELECTED', true, 'not_paid', 'not_paid', 'admin_attribution') $$,
  'R-3, X-8: admin may cancel OPEN and SELECTED in both regions, nothing paid, counts against nobody by itself');

-- ══ R-1, R-2: the request list ═══════════════════════════════════════════════
SELECT pg_temp.req(g) FROM generate_series(2, 30) g;
SELECT pg_temp.as_user('ad');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.admin_requests(NULL, NULL, NULL, NULL, NULL, 1) -> 'rows' -> 0) k),
  ARRAY['created_at', 'currency', 'fixed_price', 'id', 'open_flags', 'open_report', 'region', 'scheduled_start_at',
        'service_name', 'status', 'timezone', 'zone_name'],
  'R-2: a row carries exactly these keys: no name, phone, address or note');
SELECT is((SELECT (public.admin_requests(NULL, NULL, NULL, NULL, NULL, 1) ->> 'total')::int), (SELECT count(*)::int FROM public.requests),
  'R-1: every request of every region is counted');
SELECT is((SELECT jsonb_array_length(public.admin_requests(NULL, NULL, NULL, NULL, NULL, 1) -> 'rows')), 20, 'R-2: 20 a page');
SELECT is((SELECT array_agg((x ->> 'id')::uuid) FROM jsonb_array_elements(public.admin_requests(NULL, 'TR', NULL, NULL, NULL, 2) -> 'rows') x),
          (SELECT array_agg(id) FROM (SELECT id FROM public.requests WHERE region = 'TR' ORDER BY created_at DESC, id LIMIT 20 OFFSET 20) t),
  'R-2: newest first, ties by id, page 2');
SELECT is((public.admin_requests('OPEN', NULL, NULL, NULL, NULL, 1) ->> 'total')::int, (SELECT count(*)::int FROM public.requests WHERE status = 'OPEN'),
  'R-2: the status filter');
SELECT is((public.admin_requests(NULL, 'KSA', NULL, NULL, NULL, 1) ->> 'total')::int, (SELECT count(*)::int FROM public.requests WHERE region = 'KSA'),
  'R-1: the region filter');
SELECT is((public.admin_requests(NULL, 'TR', pg_temp.tr_today() + 1, NULL, NULL, 1) ->> 'total')::int, 0,
  'R-2: created from tomorrow (in the row''s time zone) finds none');
SELECT is((public.admin_requests(NULL, 'TR', pg_temp.tr_today(), pg_temp.tr_today(), NULL, 1) ->> 'total')::int,
          (SELECT count(*)::int FROM public.requests WHERE region = 'TR' AND (created_at AT TIME ZONE (SELECT timezone FROM public.regions WHERE code = 'TR'))::date = pg_temp.tr_today()),
  'R-2: created today, both ends inclusive');
SELECT is(pg_temp.call_as('ad', 'SELECT public.admin_requests(''FOO'', NULL, NULL, NULL, NULL, 1)::text') || ' '
          || pg_temp.call_as('ad', 'SELECT public.admin_requests(NULL, ''XX'', NULL, NULL, NULL, 1)::text') || ' '
          || pg_temp.call_as('ad', format('SELECT public.admin_requests(NULL, NULL, %L, %L, NULL, 1)::text', current_date - 367, current_date)) || ' '
          || pg_temp.call_as('ad', format('SELECT public.admin_requests(NULL, NULL, %L, %L, NULL, 1)::text', current_date, current_date - 1)),
  'validation_failed validation_failed validation_failed validation_failed',
  'R-2: an unknown status or region, a range over 366 days or backwards is refused');
SELECT isnt(pg_temp.call_as('ad', format('SELECT public.admin_requests(NULL, NULL, %L, %L, NULL, 1)::text', current_date - 366, current_date)),
  'validation_failed', 'R-2: 366 days apart is allowed');

-- ══ R-3, X-1, X-9, R-4: the admin cancel in OPEN ═════════════════════════════
SELECT is(pg_temp.cancel(1, 'nobody'), 'validation_failed', 'R-3: the attribution is customer, provider or platform');
SELECT is(pg_temp.cancel(1, 'customer', ' short   '), 'reason_required', 'R-3: the reason is 10 to 500 characters, trimmed');
SELECT is(pg_temp.cancel(1, 'customer', repeat('x', 501)), 'reason_required', 'R-3: at most 500');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_cancel_request(%L, %L, %L)::text', gen_random_uuid(), 'customer', 'A reason long enough.')),
  'not_found', 'R-3: an unknown request');
SELECT is(pg_temp.cancel(1, 'customer'), '{"status": "ok", "replayed": false}', 'R-3: admin cancels an OPEN request');
SELECT is(pg_temp.st(1), 'CANCELLED admin -', 'R-3: CANCELLED by admin, cancel_reason stays null');
SELECT is((SELECT closed_by FROM public.requests WHERE id = pg_temp.r(1)), 'admin', 'R-3: closed by admin');
SELECT is((SELECT new_value ->> 'attributed_to' || ' | ' || (new_value ->> 'reason') || ' | ' || (new_value ->> 'commission_outcome')
             || ' | ' || coalesce(actor_id::text, '-')
             FROM public.audit_log WHERE action = 'request.admin_cancelled' AND entity_id = pg_temp.r(1)::text),
  'customer | The customer asked by phone. | not_paid | ' || pg_temp.u('ad')::text,
  'X-1: the attribution and the reason are on the cancel''s own audit row, with the actor');
SELECT is((SELECT count(*)::int FROM public.applications WHERE request_id = pg_temp.r(1) AND status = 'CANCELLED'), 3,
  'R-3: the live applications are cancelled');
SELECT is(pg_temp.cancel(1, 'provider'), '{"status": "ok", "replayed": true}', 'X-9: a second admin cancel is a replay');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'request.admin_cancelled' AND entity_id = pg_temp.r(1)::text), 1,
  'X-9: the replay writes nothing');
SELECT is((SELECT count(*)::int FROM public.outbox_events
            WHERE kind = 'email.send' AND payload ->> 'template' = 'request_cancelled' AND payload ->> 'request_id' = pg_temp.r(1)::text),
  1, 'R-4: no pick, so only the customer is mailed');
SELECT is((SELECT payload ->> 'entity_id' FROM public.outbox_events
            WHERE kind = 'email.send' AND payload ->> 'template' = 'request_cancelled' AND payload ->> 'request_id' = pg_temp.r(1)::text),
  NULL, 'R-4: the customer''s mail names no refund');

-- ══ R-3: SELECTED, COMMISSION_PAID, UNLOCKED; R-4 with a pick ═══════════════
SELECT pg_temp.choose(2, 'a1');
SELECT is(pg_temp.cancel(2), '{"status": "ok", "replayed": false}', 'R-3: admin cancels a SELECTED request');
SELECT is((SELECT status FROM public.applications WHERE id = pg_temp.app(2, 'a1')), 'CANCELLED', 'R-3: the pick is cancelled');
SELECT is((SELECT string_agg(payload ->> 'recipient_id', ',' ORDER BY payload ->> 'recipient_id') FROM public.outbox_events
            WHERE kind = 'email.send' AND payload ->> 'template' = 'request_cancelled' AND payload ->> 'request_id' = pg_temp.r(2)::text),
  pg_temp.u('a1')::text || ',' || pg_temp.u('c1')::text, 'R-4, X-10: the customer and the pick''s provider are mailed');

SELECT pg_temp.choose(3, 'a1');
SELECT pg_temp.paycom(3);
SELECT is(pg_temp.cancel(3, 'provider'), '{"status": "ok", "replayed": false}', 'R-3: admin cancels a COMMISSION_PAID request');
SELECT is((SELECT status FROM public.fee_payments WHERE id = pg_temp.cfee(3)) || ' '
          || (SELECT count(*) FROM public.fee_refunds WHERE request_id = pg_temp.r(3))::text,
  'paid 0', 'AC-2, row 11: nothing is refunded by itself (by hand)');

SELECT pg_temp.choose(4, 'a1');
SELECT pg_temp.paycom(4);
SELECT pg_temp.payfee(4, 'a1');
SELECT is((SELECT status FROM public.requests WHERE id = pg_temp.r(4)), 'UNLOCKED', 'fixture: r4 revealed');

-- ══ R-8, X-13: the street line ═══════════════════════════════════════════════
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_request_address(%L, %L)::text', pg_temp.r(2), 'The provider cannot find it.')),
  'not_available', 'R-8: a pick never revealed shows no line');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_request_address(%L, %L)::text', pg_temp.r(4), 'short')),
  'reason_required', 'X-13: the reason is required');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_request_address(%L, %L)::text', pg_temp.r(4), 'The provider cannot find it.')),
  '{"line": "Moda Cad. No 7"}', 'R-8: revealed: the line');
SELECT is((SELECT count(*)::int || ' ' || bool_and(new_value ->> 'reason' = 'The provider cannot find it.')::text
                  || ' ' || bool_and(position('Moda' IN coalesce(new_value::text, '') || coalesce(old_value::text, '')) = 0)::text
             FROM public.audit_log WHERE action = 'request.address_viewed' AND entity_id = pg_temp.r(4)::text),
  '1 true true', 'R-8: one audit row per call, with the reason and never the line');

SELECT is(pg_temp.cancel(4, 'platform'), '{"status": "ok", "replayed": false}', 'R-3: admin cancels an UNLOCKED request');
SELECT is((SELECT count(*)::int FROM public.fee_payments WHERE request_id = pg_temp.r(4) AND status = 'paid'), 2,
  'row 11: both fees stay paid after the reveal');

-- AWAITING_CONFIRMATION and COMPLETED close through reports; a customer's cancel is not admin's.
SELECT pg_temp.choose(5, 'a1');
SELECT pg_temp.paycom(5);
SELECT pg_temp.payfee(5, 'a1');
SELECT pg_temp.age_late(5);
SELECT pg_temp.call_as('a1', format('SELECT public.start_job(%L)::text', pg_temp.r(5)));
SELECT pg_temp.call_as('a1', format('SELECT public.finish_job(%L)::text', pg_temp.r(5)));
SELECT is((SELECT status FROM public.requests WHERE id = pg_temp.r(5)), 'AWAITING_CONFIRMATION', 'fixture: r5 waits for confirmation');
SELECT is(pg_temp.cancel(5), 'not_cancellable', 'R-3: AWAITING_CONFIRMATION is refused');
SELECT is(pg_temp.probe(ARRAY[format('SELECT pg_temp.call_as(%L, %L)', 'c1', format('SELECT public.confirm_job(%L)::text', pg_temp.r(5)))],
                        format('pg_temp.cancel(5) || %L || (SELECT status FROM public.requests WHERE id = %L)', ' ', pg_temp.r(5))),
  'not_cancellable COMPLETED', 'R-3: COMPLETED is refused');
SELECT pg_temp.call_as('c1', format('SELECT public.cancel_request(%L, %L)::text', pg_temp.r(6), 'plans_changed'));
SELECT is(pg_temp.st(6) || ' ' || pg_temp.cancel(6), 'CANCELLED customer plans_changed not_cancellable',
  'X-9: a request the customer cancelled is not admin''s to cancel again');

-- An OPEN request with a carried commission reads the COMMISSION_PAID row (by hand): nothing comes back by itself.
SELECT pg_temp.choose(22, 'a1');
SELECT pg_temp.paycom(22);
SELECT pg_temp.call_as('a1', format('SELECT public.withdraw_application(%L)::text', pg_temp.app(22, 'a1')));
SELECT is((SELECT status FROM public.requests WHERE id = pg_temp.r(22)), 'OPEN', 'fixture: r22 reopened with its commission carried');
CREATE TEMP TABLE r22 AS SELECT pg_temp.cancel(22) AS res;
SELECT is((SELECT res FROM r22) || ' ' || (SELECT (new_value ->> 'rule_state') || ' ' || (new_value ->> 'commission_outcome')
                                          FROM public.audit_log WHERE action = 'request.admin_cancelled' AND entity_id = pg_temp.r(22)::text)
          || ' ' || (SELECT status FROM public.fee_payments WHERE id = pg_temp.cfee(22))
          || ' ' || (SELECT count(*) FROM public.fee_refunds WHERE request_id = pg_temp.r(22))::text,
  '{"status": "ok", "replayed": false} COMMISSION_PAID by_hand paid 0',
  'R-3: a carried commission is read as COMMISSION_PAID: cancelled by hand, the commission stays paid');

-- ══ R-5, X-5 to X-7: the extension ═══════════════════════════════════════════
SELECT is(pg_temp.extend(7, 'payment', 2), 'invalid_state', 'X-5: payment needs SELECTED');
SELECT pg_temp.choose(7, 'a1');
CREATE TEMP TABLE r7 AS SELECT payment_deadline AS old FROM public.requests WHERE id = pg_temp.r(7);
SELECT is(pg_temp.extend(7, 'payment', 0) || ' ' || pg_temp.extend(7, 'payment', 49) || ' ' || pg_temp.extend(7, 'week', 2) || ' '
          || pg_temp.extend(7, 'payment', 2, 'too short'),
  'validation_failed validation_failed validation_failed reason_required', 'R-5: 1 to 48 hours, a known deadline, a reason');
SELECT is(pg_temp.extend(7, 'fee', 2) || ' ' || pg_temp.extend(7, 'confirm', 2), 'invalid_state invalid_state',
  'X-5: fee and confirm need their own states');
SELECT is((pg_temp.extend(7, 'payment', 2))::jsonb ->> 'status', 'ok', 'R-5: admin extends the payment window');
SELECT is((SELECT payment_deadline FROM public.requests WHERE id = pg_temp.r(7)), (SELECT greatest(old, now()) + interval '2 hours' FROM r7),
  'X-5: the new deadline is greatest(old, now()) plus the hours');
SELECT ok((SELECT payment_extended_at IS NOT NULL AND fee_extended_at IS NULL FROM public.applications WHERE id = pg_temp.app(7, 'a1')),
  'R-5: the pick''s payment allowance is spent');
SELECT is((SELECT (old_value ->> 'which') || ' ' || (new_value ->> 'hours') || ' ' || (new_value ->> 'reason')
             FROM public.audit_log WHERE action = 'request.deadline_extended' AND entity_id = pg_temp.r(7)::text),
  'payment 2 The provider asked for time.', 'R-5: audited with which, the hours and the reason');
SELECT is(pg_temp.extend(7, 'payment', 1), 'already_extended', 'R-5: once per pick');
SELECT is((SELECT count(*)::int FROM public.outbox_events WHERE kind = 'email.send' AND payload ->> 'request_id' = pg_temp.r(7)::text
            AND idempotency_key LIKE 'email:' || (SELECT max(id) FROM public.audit_log WHERE action = 'request.deadline_extended')::text || ':%'),
  0, 'R-5: no mail');

-- X-7: a new pick gets a fresh allowance.
SELECT pg_temp.call_as('a1', format('SELECT public.withdraw_application(%L)::text', pg_temp.app(7, 'a1')));
SELECT is((SELECT status FROM public.requests WHERE id = pg_temp.r(7)), 'OPEN', 'fixture: the pick withdrew, r7 is OPEN');
SELECT pg_temp.choose(7, 'a2');
SELECT is((pg_temp.extend(7, 'payment', 3))::jsonb ->> 'status', 'ok', 'X-7: the new pick has its own allowance');

-- X-5: never past the start.
SELECT pg_temp.choose(8, 'a1');
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
UPDATE public.requests SET scheduled_start_at = payment_deadline + interval '1 hour', scheduled_end_at = payment_deadline + interval '3 hours'
 WHERE id = pg_temp.r(8);
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
SELECT is(pg_temp.extend(8, 'payment', 2), 'deadline_after_start', 'X-5: payment never past the start');
SELECT ok((SELECT payment_extended_at IS NULL FROM public.applications WHERE id = pg_temp.app(8, 'a1')),
  'X-5: a refused extension spends nothing');
SELECT is((pg_temp.extend(8, 'payment', 1))::jsonb ->> 'status', 'ok', 'X-5: up to the start is allowed');

-- fee
SELECT pg_temp.choose(9, 'a1');
SELECT pg_temp.paycom(9);
SELECT is((pg_temp.extend(9, 'fee', 4))::jsonb ->> 'status', 'ok', 'R-5: admin extends the provider fee window');
SELECT ok((SELECT fee_extended_at IS NOT NULL FROM public.applications WHERE id = pg_temp.app(9, 'a1')), 'R-5: the fee allowance is spent');
SELECT is(pg_temp.extend(9, 'fee', 1) || ' ' || pg_temp.extend(9, 'payment', 1), 'already_extended invalid_state',
  'R-5: once per pick; payment is over once COMMISSION_PAID');

-- confirm
SELECT is((pg_temp.extend(5, 'confirm', 5))::jsonb ->> 'status', 'ok', 'R-5: admin extends the confirm deadline');
SELECT ok((SELECT confirm_extended_at IS NOT NULL FROM public.requests WHERE id = pg_temp.r(5)), 'R-5: the confirm allowance is spent');
SELECT is(pg_temp.extend(5, 'confirm', 1), 'already_extended', 'X-6: once per request');

-- ══ R-6, X-3, X-4: the guards, as postgres ════════════════════════════════════
SELECT pg_temp.choose(10, 'a1');
SELECT is(pg_temp.try(format('UPDATE public.requests SET payment_deadline = payment_deadline + interval ''1 hour'' WHERE id = %L', pg_temp.r(10))),
  'request_immutable', 'M-2: not without the pick''s allowance spent in the same transaction');
SELECT is(pg_temp.probe(ARRAY[format('UPDATE public.applications SET payment_extended_at = now() WHERE id = %L', pg_temp.app(10, 'a1')), format('UPDATE public.requests SET payment_deadline = payment_deadline + interval ''1 hour'' WHERE id = %L', pg_temp.r(10))], '''ok'''),
  'ok', 'X-4: the payment window alone moves later while SELECTED, the allowance spent now');
SELECT is(pg_temp.probe(ARRAY[format('UPDATE public.applications SET payment_extended_at = now() WHERE id = %L', pg_temp.app(10, 'a1')), format('UPDATE public.requests SET payment_deadline = payment_deadline + interval ''1 hour'', selected_at = selected_at - interval ''1 minute'' WHERE id = %L', pg_temp.r(10))], '''ok'''),
  'request_immutable', 'X-4: not with another change to the pick');
SELECT is(pg_temp.probe(ARRAY[format('UPDATE public.applications SET payment_extended_at = now() WHERE id = %L', pg_temp.app(10, 'a1')), format('UPDATE public.requests SET payment_deadline = greatest(payment_deadline, now()) + interval ''49 hours'' WHERE id = %L', pg_temp.r(10))], '''ok'''),
  'request_immutable', 'X-4: not past the 48 hour band');
SELECT is(pg_temp.probe(ARRAY[format('UPDATE public.applications SET payment_extended_at = now() WHERE id = %L', pg_temp.app(10, 'a1')), format('UPDATE public.requests SET payment_deadline = payment_deadline - interval ''1 minute'' WHERE id = %L', pg_temp.r(10))], '''ok'''),
  'request_immutable', 'X-4: never earlier');
SELECT is(pg_temp.probe(ARRAY[format('UPDATE public.applications SET payment_extended_at = now() WHERE id = %L', pg_temp.app(10, 'a1')), format('UPDATE public.requests SET payment_deadline = payment_deadline + interval ''1 hour'', notes = ''x'' WHERE id = %L', pg_temp.r(10))], '''ok'''),
  'request_immutable', 'X-4: not with any other column');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.applications DISABLE TRIGGER applications_guard',
                              format('UPDATE public.applications SET payment_extended_at = now() - interval ''1 day'' WHERE id = %L', pg_temp.app(10, 'a1')),
                              'ALTER TABLE public.applications ENABLE TRIGGER applications_guard'],
                        format('pg_temp.try(%L)', format('UPDATE public.requests SET payment_deadline = payment_deadline + interval ''1 hour'' WHERE id = %L', pg_temp.r(10)))),
  'request_immutable', 'M-2: not with an allowance spent in an earlier transaction');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.applications DISABLE TRIGGER applications_guard',
                              format('UPDATE public.applications SET fee_extended_at = now() - interval ''1 day'' WHERE id = %L', pg_temp.app(9, 'a1')),
                              'ALTER TABLE public.applications ENABLE TRIGGER applications_guard'],
                        format('pg_temp.try(%L)', format('UPDATE public.requests SET fee_deadline = fee_deadline + interval ''1 hour'' WHERE id = %L', pg_temp.r(9)))),
  'request_immutable', 'M-2: the fee window not with an allowance spent in an earlier transaction');
SELECT pg_temp.choose(11, 'a1');
SELECT pg_temp.paycom(11);
SELECT is(pg_temp.probe(ARRAY[format('UPDATE public.applications SET fee_extended_at = now() WHERE id = %L', pg_temp.app(11, 'a1')), format('UPDATE public.requests SET fee_deadline = fee_deadline + interval ''1 hour'' WHERE id = %L', pg_temp.r(11))], '''ok'''),
  'ok', 'X-4: the fee window alone moves later while COMMISSION_PAID, the allowance spent now');
SELECT is(pg_temp.probe(ARRAY[format('UPDATE public.applications SET fee_extended_at = now() WHERE id = %L', pg_temp.app(11, 'a1')), format('UPDATE public.requests SET fee_deadline = fee_deadline + interval ''1 hour'', selected_at = selected_at - interval ''1 minute'' WHERE id = %L', pg_temp.r(11))], '''ok'''),
  'request_immutable', 'X-4: the fee window not with another change to the pick');
SELECT is(pg_temp.try(format('UPDATE public.requests SET confirm_extended_at = NULL WHERE id = %L', pg_temp.r(5))),
  'request_immutable', 'X-6: the confirm allowance never goes back');
SELECT is(pg_temp.try(format('UPDATE public.requests SET confirm_extended_at = now() WHERE id = %L', pg_temp.r(11))),
  'request_immutable', 'R-6: the confirm allowance only while AWAITING_CONFIRMATION');
SELECT is(pg_temp.try(format('UPDATE public.applications SET payment_extended_at = NULL WHERE id = %L', pg_temp.app(8, 'a1'))),
  'application_immutable', 'R-6: the payment allowance never goes back');
SELECT is(pg_temp.try(format('UPDATE public.applications SET fee_extended_at = now() WHERE id = %L', pg_temp.app(10, 'a1'))),
  'application_immutable', 'R-6: the fee allowance only while the pick waits for its fee');
SELECT is(pg_temp.try(format('UPDATE public.applications SET payment_extended_at = now() WHERE id = %L', pg_temp.app(11, 'a1'))),
  'application_immutable', 'R-6: the payment allowance only while the pick waits for the commission');
SELECT is(pg_temp.try(format('UPDATE public.applications SET payment_extended_at = now() WHERE id = %L', pg_temp.app(10, 'a2'))),
  'application_immutable', 'R-6: never on an application that is not the pick');

SELECT pg_temp.choose(13, 'a1');
SELECT pg_temp.paycom(13);
SELECT pg_temp.payfee(13, 'a1');
SELECT pg_temp.age_late(13);
SELECT pg_temp.call_as('a1', format('SELECT public.start_job(%L)::text', pg_temp.r(13)));
SELECT pg_temp.call_as('a1', format('SELECT public.finish_job(%L)::text', pg_temp.r(13)));
SELECT is(pg_temp.try(format('UPDATE public.requests SET confirm_deadline = greatest(confirm_deadline, now()) + interval ''49 hours'', confirm_extended_at = now() WHERE id = %L', pg_temp.r(13))),
  'request_immutable', 'M-2: the confirm allowance moves the deadline at most 48 hours');
SELECT is(pg_temp.try(format('UPDATE public.requests SET confirm_deadline = confirm_deadline + interval ''2 hours'', confirm_extended_at = now() WHERE id = %L', pg_temp.r(13))),
  'ok', 'R-5: within 48 hours, spent now');
CREATE TEMP TABLE m1 AS
  SELECT public.cancel_by_rule(pg_temp.r(14), 'admin', NULL, NULL, 'request.admin_cancelled', pg_temp.u('ad'),
                               '{"status": "OPEN", "fee_refund_id": "00000000-0000-0000-0000-000000000000", "reason": "kept"}'::jsonb) AS x;
SELECT is((SELECT (new_value ->> 'status') || ' ' || coalesce(new_value ->> 'fee_refund_id', '-') || ' ' || (new_value ->> 'reason')
             FROM public.audit_log WHERE action = 'request.admin_cancelled' AND entity_id = pg_temp.r(14)::text),
  'CANCELLED - kept', 'M-1: p_meta adds keys but never changes the outcome the audit row records');

-- ══ R-7, X-15: the flag queue ════════════════════════════════════════════════
SELECT pg_temp.choose(12, 'a1');
SELECT pg_temp.paycom(12);
SELECT pg_temp.payfee(12, 'a1');
SELECT pg_temp.age_late(12);
SELECT public.raise_deadline_flags();
SELECT is((SELECT string_agg(kind, ',') FROM public.deadline_flags WHERE request_id = pg_temp.r(12) AND cleared_at IS NULL), 'start_late',
  'fixture: r12 is flagged start_late');
SELECT pg_temp.as_user('ad');
SELECT is((public.admin_flags(1) ->> 'total')::int, (SELECT count(*)::int FROM public.deadline_flags WHERE cleared_at IS NULL),
  'R-7: the queue counts every open flag');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.admin_flags(1) -> 'rows' -> 0) k),
  ARRAY['id', 'kind', 'raised_at', 'region', 'request_id', 'request_status', 'timezone'], 'R-7: a row carries exactly these keys');
SELECT is((SELECT array_agg((x ->> 'id')::uuid) FROM jsonb_array_elements(public.admin_flags(1) -> 'rows') x),
          (SELECT array_agg(id) FROM (SELECT id FROM public.deadline_flags WHERE cleared_at IS NULL ORDER BY raised_at, id LIMIT 20) t),
  'R-7: oldest first');
CREATE TEMP TABLE f12 AS SELECT id FROM public.deadline_flags WHERE request_id = pg_temp.r(12) AND cleared_at IS NULL;
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_clear_flag(%L, %L)::text', (SELECT id FROM f12), 'short')), 'reason_required',
  'R-7: the note is 10 to 500 characters');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_clear_flag(%L, %L)::text', gen_random_uuid(), 'Called the provider, on the way.')),
  'not_found', 'R-7: an unknown flag');
SELECT is((pg_temp.call_as('ad', format('SELECT public.admin_clear_flag(%L, %L)::text', (SELECT id FROM f12), 'Called the provider, on the way.')))::jsonb ->> 'status',
  'ok', 'R-7: admin clears the flag');
SELECT is((SELECT (cleared_at IS NOT NULL)::text || ' ' || cleared_by::text || ' ' || note FROM public.deadline_flags WHERE id = (SELECT id FROM f12)),
  'true ' || pg_temp.u('ad')::text || ' Called the provider, on the way.', 'R-7: cleared_at, cleared_by and the note');
SELECT is((SELECT new_value ->> 'note' FROM public.audit_log WHERE action = 'request.flag_cleared' AND entity_id = pg_temp.r(12)::text),
  'Called the provider, on the way.', 'R-7: audited');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_clear_flag(%L, %L)::text', (SELECT id FROM f12), 'Called the provider, on the way.')),
  'already_cleared', 'R-7: a cleared flag cannot be cleared again');
SELECT public.raise_deadline_flags();
SELECT is((SELECT count(*)::int FROM public.deadline_flags WHERE request_id = pg_temp.r(12)), 1,
  'R-7, X-15: a (request, kind) cleared by hand is never raised again');

-- ══ R-9, X-11, X-12: revenue ═════════════════════════════════════════════════
-- Deltas over a snapshot, so the rows other sections posted today do not matter.
SELECT pg_temp.as_user('ad');
CREATE FUNCTION pg_temp.rev(p_grain text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce((SELECT x FROM jsonb_array_elements(public.admin_revenue(pg_temp.tr_today(), pg_temp.tr_today(), p_grain) -> 'rows') x
                    WHERE x ->> 'region' = 'TR' AND x ->> 'currency' = 'TRY'), '{}'::jsonb) $$;
CREATE TEMP TABLE rev0 AS SELECT pg_temp.rev('day') AS d, pg_temp.rev('month') AS m;

-- r20: both fees paid, cancelled by admin after the reveal, both refunded by hand.
SELECT pg_temp.choose(20, 'a1');
SELECT pg_temp.paycom(20);
SELECT pg_temp.payfee(20, 'a1');
SELECT pg_temp.cancel(20);
SELECT pg_temp.call_as('ad', format('SELECT public.admin_refund_fee(%L, %L)::text', pg_temp.cfee(20), 'Refund after the cancel.'));
SELECT pg_temp.call_as('ad', format('SELECT public.admin_refund_fee(%L, %L)::text', pg_temp.pfee(20, 'a1'), 'Refund after the cancel.'));
SELECT public.apply_fee_refunded(x.id, 'psp-refund-33-' || x.kind || x.amount) FROM public.fee_refunds x WHERE x.request_id = pg_temp.r(20);

-- r21: a card page open blocks the cancel (X-2); once it ends, the cancel goes through and the payment lands late.
SELECT pg_temp.choose(21, 'a1');
CREATE TEMP TABLE r21 AS SELECT (pg_temp.paycom(21, false) ->> 'attempt_id')::uuid AS att;
SELECT is(pg_temp.cancel(21), 'checkout_open', 'X-2: never under an open card page');
SELECT pg_temp.age_attempts(pg_temp.cfee(21));
SELECT is(pg_temp.cancel(21), '{"status": "ok", "replayed": false}', 'X-2: once the page ended, admin cancels');
SELECT is(public.apply_fee_paid(pg_temp.cfee(21), (SELECT att FROM r21), 'pay-33-late', 10000, 'TRY', 300) ->> 'status', 'late',
  'fixture: the payment after the cancel is booked late');
SELECT public.apply_fee_refunded(x.id, 'psp-refund-33-late') FROM public.fee_refunds x WHERE x.request_id = pg_temp.r(21) AND x.kind = 'late';

SELECT pg_temp.as_user('ad');
CREATE TEMP TABLE rev1 AS SELECT pg_temp.rev('day') AS d, pg_temp.rev('month') AS m;
CREATE FUNCTION pg_temp.delta(p_col text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'commission_revenue', coalesce((r1 ->> 'commission_revenue')::bigint, 0) - coalesce((r0 ->> 'commission_revenue')::bigint, 0),
    'provider_fee_revenue', coalesce((r1 ->> 'provider_fee_revenue')::bigint, 0) - coalesce((r0 ->> 'provider_fee_revenue')::bigint, 0),
    'commission_refunds', coalesce((r1 ->> 'commission_refunds')::bigint, 0) - coalesce((r0 ->> 'commission_refunds')::bigint, 0),
    'provider_fee_refunds', coalesce((r1 ->> 'provider_fee_refunds')::bigint, 0) - coalesce((r0 ->> 'provider_fee_refunds')::bigint, 0),
    'psp_fees', coalesce((r1 ->> 'psp_fees')::bigint, 0) - coalesce((r0 ->> 'psp_fees')::bigint, 0),
    'net', coalesce((r1 ->> 'net')::bigint, 0) - coalesce((r0 ->> 'net')::bigint, 0),
    'late_received', coalesce((r1 ->> 'late_received')::bigint, 0) - coalesce((r0 ->> 'late_received')::bigint, 0),
    'late_refunded', coalesce((r1 ->> 'late_refunded')::bigint, 0) - coalesce((r0 ->> 'late_refunded')::bigint, 0))
  FROM (SELECT CASE p_col WHEN 'd' THEN (SELECT d FROM rev0) ELSE (SELECT m FROM rev0) END AS r0,
               CASE p_col WHEN 'd' THEN (SELECT d FROM rev1) ELSE (SELECT m FROM rev1) END AS r1) t $$;
SELECT is(pg_temp.delta('d'),
  '{"commission_revenue": 10000, "provider_fee_revenue": 5000, "commission_refunds": 10000, "provider_fee_refunds": 5000,
    "psp_fees": 750, "net": -750, "late_received": 10000, "late_refunded": 10000}'::jsonb,
  'R-9, X-11: revenues are the negated credits, refunds and PSP fees the sums, late money apart and never in net, every PSP fee in net');
SELECT is(pg_temp.delta('m'), pg_temp.delta('d'), 'X-12: the month bucket holds the same entries');
SELECT is((SELECT pg_temp.rev('month') ->> 'bucket'), to_char(date_trunc('month', pg_temp.tr_today()), 'YYYY-MM-DD'),
  'X-12: a month bucket is its first day');
SELECT is((SELECT (r ->> 'net')::bigint = (r ->> 'commission_revenue')::bigint + (r ->> 'provider_fee_revenue')::bigint
                   - (r ->> 'commission_refunds')::bigint - (r ->> 'provider_fee_refunds')::bigint - (r ->> 'psp_fees')::bigint
             FROM (SELECT pg_temp.rev('day') AS r) t), true, 'R-9: net = revenues - refunds - PSP fees');
SELECT is(jsonb_array_length(public.admin_revenue(pg_temp.tr_today() + 1, pg_temp.tr_today() + 1, 'day') -> 'rows'), 0,
  'X-12: only buckets with entries');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_revenue(%L, %L, %L)::text', current_date, current_date, 'week')) || ' '
          || pg_temp.call_as('ad', format('SELECT public.admin_revenue(%L, %L, %L)::text', current_date - 92, current_date, 'day')) || ' '
          || pg_temp.call_as('ad', format('SELECT public.admin_revenue(%L, %L, %L)::text', current_date, current_date - 1, 'day')) || ' '
          || pg_temp.call_as('ad', format('SELECT public.admin_revenue(%L, %L, %L)::text', date '2026-01-15', date '2028-01-01', 'month')) || ' '
          || pg_temp.call_as('ad', 'SELECT public.admin_revenue(NULL, NULL, ''day'')::text'),
  'validation_failed validation_failed validation_failed validation_failed validation_failed',
  'R-9: an unknown grain, a day range over 92 days, a backwards range, over 24 months, no range: refused');
SELECT is((pg_temp.call_as('ad', format('SELECT public.admin_revenue(%L, %L, %L)::text', current_date - 91, current_date, 'day')))::jsonb ->> 'grain', 'day',
  'R-9: 92 days is allowed');
SELECT is((SELECT (j ->> 'from') || ' ' || (j ->> 'to')
             FROM (SELECT (pg_temp.call_as('ad', format('SELECT public.admin_revenue(%L, %L, %L)::text', date '2026-01-15', date '2027-12-01', 'month')))::jsonb AS j) t),
  '2026-01-01 2027-12-31', 'X-12: 24 months allowed, widened to whole months');

-- ══ 12's detail, fixed: no pick means selected is false, never null ══════════
SELECT pg_temp.as_user('ad');
SELECT is((SELECT array_agg(DISTINCT x -> 'selected') FROM jsonb_array_elements(public.admin_request_detail(pg_temp.r(30)) -> 'applications') x),
  ARRAY['false'::jsonb], 'admin_request_detail: an OPEN request''s applications are not selected (false, not null)');

-- ══ Grants and attributes ════════════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default", p.prosecdef, has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            has_function_privilege('service_role', p.oid, 'EXECUTE'), has_function_privilege('anon', p.oid, 'EXECUTE')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('admin_cancel_request', 'admin_clear_flag', 'admin_extend_deadline', 'admin_flags', 'admin_request_address',
                          'admin_requests', 'admin_revenue', 'cancel_by_rule', 'extension_in_band')
      ORDER BY p.proname $$,
  $$ VALUES ('admin_cancel_request'::text, true, true, false, false),
            ('admin_clear_flag', true, true, false, false),
            ('admin_extend_deadline', true, true, false, false),
            ('admin_flags', true, true, false, false),
            ('admin_request_address', true, true, false, false),
            ('admin_requests', true, true, false, false),
            ('admin_revenue', true, true, false, false),
            ('cancel_by_rule', false, false, false, false),
            ('extension_in_band', false, false, false, false) $$,
  'R-11: the admin functions are definers signed in users may call; the helpers have no API grant');
SELECT is((SELECT pronargs::int FROM pg_proc WHERE proname = 'cancel_by_rule' AND pronamespace = 'public'::regnamespace), 7,
  'X-1: one cancel_by_rule, with the seventh argument');

SELECT * FROM finish();
ROLLBACK;
