-- Position 15, spec 0011-15 (D195): the provider's jobs and fees history, read only.
--
-- provider_history(p_month): the caller's own unlocked applications only (R-1, AC-4), grouped by the job's start in
-- the region's time zone with half open month bounds (R-2, X-8, X-9), the valid months including future job months
-- (X-1), the fee from the paid or refunded fee row or 0 (R-3, X-5, X-6), the refund state (R-4, X-4), the totals over
-- the whole month (R-5, X-3, X-4), the cancelled row (X-3), the 200 row cap (R-8, X-11), the returned shape with no
-- contact field (R-9), every refusal (X-2, AC-4), any provider standing (X-10), one region and currency (X-7), and the
-- function's own signature, attributes and grants (R-7).
--
-- Jobs are seeded straight into the tables with the guards off, so each state, date and fee is exact; two jobs of a3
-- go through the real choose and pay functions, so the X-5 invariants are proved over real rows too.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(56);

SET CONSTRAINTS ALL IMMEDIATE;

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003200' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003270' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.app(p integer, w text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-00000032' || CASE w WHEN 'a1' THEN '81' WHEN 'a2' THEN '82' ELSE '83' END
          || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.fee(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003260' || lpad(p::text, 2, '0'))::uuid $$;

-- ── the clock: month starts in the TR time zone ─────────────────────────────
CREATE FUNCTION pg_temp.tz() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT timezone FROM public.regions WHERE code = 'TR' $$;
-- The first day of the current month in TR, moved by k months.
CREATE FUNCTION pg_temp.m(k integer) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (date_trunc('month', now() AT TIME ZONE pg_temp.tz()) + make_interval(months => k))::date $$;
-- The instant that month starts in TR.
CREATE FUNCTION pg_temp.start_of(k integer) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT pg_temp.m(k)::timestamp AT TIME ZONE pg_temp.tz() $$;
-- The fifteenth of that month at 10:00 in TR.
CREATE FUNCTION pg_temp.mid(k integer) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT (pg_temp.m(k) + interval '14 days 10 hours')::timestamp AT TIME ZONE pg_temp.tz() $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1 the customer, a1 the provider under test, a2 another provider, a3 the provider of the real flows, a4 the
-- provider of the 201 row month, b1 a provider still pending review, ad the admin.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559320001'), ('a1', '905559320002'), ('a2', '905559320003'), ('a3', '905559320004'),
               ('a4', '905559320005'), ('b1', '905559320006'), ('ad', '905559320007')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'en'
  FROM (VALUES ('c1', 'customer', '905559320001', 'Geçmiş Müşteri'),
               ('a1', 'provider', '905559320002', 'Bir Usta'),
               ('a2', 'provider', '905559320003', 'İki Usta'),
               ('a3', 'provider', '905559320004', 'Üç Usta'),
               ('a4', 'provider', '905559320005', 'Dört Usta'),
               ('b1', 'provider', '905559320006', 'Bekleyen Usta'),
               ('ad', 'admin', '905559320007', 'Yönetici')) AS t(c, r, p, n);
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Usta'
 WHERE id IN (pg_temp.u('a1'), pg_temp.u('a2'), pg_temp.u('a3'), pg_temp.u('a4'));
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Geçmiş"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Temizlik", "en": "Cleaning", "ar": "تنظيف"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Moda"}', 1.00, true);
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'payments_enabled';
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'auto_close_enabled';

CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text, true) $$;

-- A request of c1 with the cash p_cash (the commission 100.00 on top), starting at p_at.
CREATE FUNCTION pg_temp.request(p integer, p_at timestamptz, p_cash bigint, p_commission bigint DEFAULT 10000)
  RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100, "service": {"name": {"tr": "Temizlik", "en": "Cleaning"}}}', p_cash + p_commission, p_commission, p_cash, 'TRY', p_at, p_at + interval '2 hours') $$;
CREATE FUNCTION pg_temp.offer(p integer, w text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  VALUES (pg_temp.app(p, w), 'TR', pg_temp.r(p), pg_temp.u(w), 'An offer for the history tests, long enough to pass.') $$;

-- A job of provider w, seeded exact: the request in p_req, the pick in p_app, unlocked two hours before the start,
-- the fee p_fee frozen on the pick and, above 0, paid (or refunded) on its own fee row; p_refund is the refund row's
-- status, or null for none.
CREATE FUNCTION pg_temp.job(p integer, w text, p_at timestamptz, p_req text, p_app text, p_cash bigint, p_fee bigint,
                            p_refund text DEFAULT NULL, p_refund_amount bigint DEFAULT NULL) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.request(p, p_at, p_cash);
  PERFORM pg_temp.offer(p, w);
  ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
  UPDATE public.applications
     SET status = p_app, status_changed_at = p_at - interval '2 hours', unlocked_at = p_at - interval '2 hours',
         provider_fee_amount = p_fee, provider_fee_kind = 'fixed'
   WHERE id = pg_temp.app(p, w);
  ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests
     SET status = p_req, selected_application_id = pg_temp.app(p, w), selected_at = p_at - interval '5 hours',
         payment_deadline = p_at - interval '4 hours', fee_deadline = p_at - interval '3 hours',
         actual_started_at = CASE WHEN p_req IN ('IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED') THEN p_at END,
         actual_completed_at = CASE WHEN p_req IN ('AWAITING_CONFIRMATION', 'COMPLETED') THEN p_at + interval '1 hour' END,
         confirm_deadline = CASE WHEN p_req = 'AWAITING_CONFIRMATION' THEN p_at + interval '2 days' END,
         closed_at = CASE WHEN p_req IN ('COMPLETED', 'CANCELLED') THEN p_at + interval '3 hours' END,
         closed_by = CASE p_req WHEN 'COMPLETED' THEN 'customer' WHEN 'CANCELLED' THEN 'customer' END,
         cancelled_at = CASE WHEN p_req = 'CANCELLED' THEN p_at + interval '3 hours' END,
         cancelled_by = CASE WHEN p_req = 'CANCELLED' THEN 'customer' END
   WHERE id = pg_temp.r(p);
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
  IF p_fee > 0 THEN
    INSERT INTO public.fee_payments (id, region, request_id, kind, payer_id, provider_id, application_id, amount, currency,
                                     status, psp_payment_id, psp_fee_amount, paid_at)
    VALUES (pg_temp.fee(p), 'TR', pg_temp.r(p), 'provider_fee', pg_temp.u(w), pg_temp.u(w), pg_temp.app(p, w), p_fee, 'TRY',
            CASE WHEN p_refund IN ('done', 'done_by_hand') THEN 'refunded' ELSE 'paid' END, 'pay-32-' || p, 0,
            p_at - interval '2 hours');
  END IF;
  IF p_refund IS NOT NULL THEN
    INSERT INTO public.fee_refunds (region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency, reason,
                                    status, psp_refund_id, finished_at)
    VALUES ('TR', pg_temp.r(p), 'fee', pg_temp.fee(p), 'pay-32-' || p, coalesce(p_refund_amount, p_fee), 'TRY', 'admin_refund',
            p_refund, CASE WHEN p_refund = 'done' THEN 'ref-32-' || p END,
            CASE WHEN p_refund IN ('done', 'done_by_hand') THEN now() END);
  END IF;
END $$;

-- a1, the current month (in start order): p6 at the very start, p1, p2, p3, p4, p11.
SELECT pg_temp.job(6, 'a1', pg_temp.start_of(0), 'UNLOCKED', 'UNLOCKED', 30000, 0);
SELECT pg_temp.job(1, 'a1', pg_temp.mid(0) + interval '1 minute', 'UNLOCKED', 'UNLOCKED', 90000, 5000);
SELECT pg_temp.job(2, 'a1', pg_temp.mid(0) + interval '2 minutes', 'COMPLETED', 'CONFIRMED', 50000, 0);
SELECT pg_temp.job(3, 'a1', pg_temp.mid(0) + interval '3 minutes', 'CANCELLED', 'CANCELLED', 70000, 4000, 'done');
SELECT pg_temp.job(4, 'a1', pg_temp.mid(0) + interval '4 minutes', 'UNLOCKED', 'UNLOCKED', 60000, 3000, 'queued');
SELECT pg_temp.job(11, 'a1', pg_temp.mid(0) + interval '11 minutes', 'AWAITING_CONFIRMATION', 'COMPLETED', 10000, 0);
-- a1, the month before: p7 one second before this month, p5 refunded in part by hand.
SELECT pg_temp.job(7, 'a1', pg_temp.start_of(0) - interval '1 second', 'UNLOCKED', 'UNLOCKED', 20000, 0);
SELECT pg_temp.job(5, 'a1', pg_temp.mid(-1), 'COMPLETED', 'RATED', 40000, 2000, 'done_by_hand', 1000);
-- a1, a job two months ahead (X-1) and one twelve months back (outside the window).
SELECT pg_temp.job(10, 'a1', pg_temp.mid(2), 'UNLOCKED', 'UNLOCKED', 80000, 1000);
SELECT pg_temp.job(9, 'a1', pg_temp.mid(-12), 'COMPLETED', 'CONFIRMED', 15000, 0);
-- a2's job this month, with a1's offer on the same request left unpicked (never unlocked).
SELECT pg_temp.job(8, 'a2', pg_temp.mid(0) + interval '8 minutes', 'UNLOCKED', 'UNLOCKED', 25000, 5000);
SELECT pg_temp.offer(8, 'a1');
-- a1's unlocked pick two months back whose request names another pick (unreachable today, security review I-2).
SELECT pg_temp.job(12, 'a1', pg_temp.mid(-2), 'UNLOCKED', 'UNLOCKED', 12000, 0);
SELECT pg_temp.offer(12, 'a2');
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
UPDATE public.requests SET selected_application_id = pg_temp.app(12, 'a2') WHERE id = pg_temp.r(12);
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;

-- a3's two real jobs: through choose_provider, pay_commission and pay_provider_fee, as 30 does.
CREATE FUNCTION pg_temp.real(p integer, p_commission bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_att uuid;
BEGIN
  PERFORM pg_temp.request(p, now() + interval '3 days', 100000 - p_commission, p_commission);
  PERFORM pg_temp.offer(p, 'a3');
  PERFORM pg_temp.as_user('c1');
  PERFORM public.choose_provider(pg_temp.r(p), pg_temp.app(p, 'a3'));
  v_att := (public.pay_commission(pg_temp.r(p), 'tr', NULL) ->> 'attempt_id')::uuid;
  IF p_commission > 0 THEN
    PERFORM public.apply_fee_paid((SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'commission'),
                                  v_att, 'pay-32-c' || p, p_commission, 'TRY', 300);
  END IF;
  PERFORM pg_temp.as_user('a3');
  v_att := (public.pay_provider_fee(pg_temp.app(p, 'a3'), 'tr', NULL) ->> 'attempt_id')::uuid;
  IF p_commission > 0 THEN
    PERFORM public.apply_fee_paid((SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'provider_fee'),
                                  v_att, 'pay-32-p' || p, 5000, 'TRY', 150);
  END IF;
END $$;
-- r20 pays a real fee, so it is made before the fee settings go to 0 for r21 (as 30 does).
SELECT pg_temp.real(20, 10000);
UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key IN ('provider_fee_value', 'fee_min_minor');
SELECT pg_temp.real(21, 0);

-- a4's month before: 201 jobs closed by the customer, the fee 0, the cash 100.00 each (X-11), in one statement each.
INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
  pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
SELECT ('00000000-0000-0000-0000-00000098' || lpad(g::text, 4, '0'))::uuid, 'TR', pg_temp.u('c1'), gen_random_uuid(),
       pg_temp.u('51'), pg_temp.u('21'), '{}', '[]', '{"rounding_minor": 100}', 20000, 10000, 10000, 'TRY',
       pg_temp.mid(-1) + make_interval(mins => g), pg_temp.mid(-1) + make_interval(mins => g) + interval '2 hours'
  FROM generate_series(1, 201) g;
INSERT INTO public.applications (id, region, request_id, provider_id, message)
SELECT ('00000000-0000-0000-0000-00000099' || lpad(g::text, 4, '0'))::uuid, 'TR',
       ('00000000-0000-0000-0000-00000098' || lpad(g::text, 4, '0'))::uuid, pg_temp.u('a4'),
       'An offer for the history cap test, long enough.'
  FROM generate_series(1, 201) g;
ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
UPDATE public.applications SET status = 'CONFIRMED', unlocked_at = now() - interval '40 days', provider_fee_amount = 0,
       provider_fee_kind = 'fixed'
 WHERE provider_id = pg_temp.u('a4');
ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
UPDATE public.requests r
   SET status = 'COMPLETED', selected_application_id = a.id, selected_at = r.scheduled_start_at - interval '5 hours',
       payment_deadline = r.scheduled_start_at - interval '4 hours', fee_deadline = r.scheduled_start_at - interval '3 hours',
       actual_started_at = r.scheduled_start_at, actual_completed_at = r.scheduled_start_at + interval '1 hour',
       closed_at = r.scheduled_start_at + interval '3 hours', closed_by = 'auto'
  FROM public.applications a
 WHERE a.request_id = r.id AND a.provider_id = pg_temp.u('a4');
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;

-- ── callers ──────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.call_as(p_user text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     CASE WHEN p_user = 'anon' THEN '{"role": "anon"}'
                          WHEN p_user = 'service' THEN '{"role": "service_role"}'
                          ELSE jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', CASE WHEN p_user = 'anon' THEN 'anon'
                                           WHEN p_user = 'service' THEN 'service_role' ELSE 'authenticated' END);
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION
    WHEN raise_exception THEN v := sqlerrm;
    WHEN others THEN v := sqlstate;
  END;
  RESET ROLE;
  RETURN v;
END $$;
-- The history of p_user for month k (null: no month given), as text.
CREATE FUNCTION pg_temp.h(p_user text, k integer) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.provider_history(%L::date)::text', pg_temp.m(k))) $$;
CREATE FUNCTION pg_temp.hj(p_user text, k integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.h(p_user, k)::jsonb $$;
-- The application ids of a result's rows, in order, by their fixture names.
CREATE FUNCTION pg_temp.ids(p_result jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(right(x ->> 'application_id', 4), ' ' ORDER BY n)
    FROM jsonb_array_elements(p_result -> 'rows') WITH ORDINALITY AS t(x, n) $$;
CREATE FUNCTION pg_temp.row_of(p_result jsonb, p integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT x FROM jsonb_array_elements(p_result -> 'rows') x WHERE (x ->> 'application_id')::uuid = pg_temp.app(p, 'a1') $$;
CREATE FUNCTION pg_temp.totals(p_result jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(' ', p_result -> 'totals' ->> 'jobs', p_result -> 'totals' ->> 'fees_paid', p_result -> 'totals' ->> 'refunds',
                   p_result -> 'totals' ->> 'net_fees', p_result -> 'totals' ->> 'cash_closed') $$;

-- ══ R-7, X-2: the function itself ═══════════════════════════════════════════
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'provider_history'), 1, 'R-7: one provider_history, no overload');
SELECT is(pg_get_function_identity_arguments('public.provider_history'::regproc), 'p_month date',
  'AC-4: the only argument is the month; no provider id');
SELECT is((SELECT p.prosecdef AND p.provolatile = 's' AND 'search_path=""' = ANY (p.proconfig)
             FROM pg_proc p WHERE p.oid = 'public.provider_history'::regproc), true,
  'R-7: security definer, stable, empty search_path');
SELECT matches((SELECT prosrc FROM pg_proc WHERE oid = 'public.provider_history'::regproc), 'public\.provider_reader\(\)',
  'X-2, AC-4: the caller comes from provider_reader(), so from auth.uid() only');
SELECT doesnt_match((SELECT prosrc FROM pg_proc WHERE oid = 'public.provider_history'::regproc), 'ledger_',
  'R-7: the ledger is never read');
SELECT results_eq(
  $$ SELECT has_function_privilege('anon', 'public.provider_history(date)', 'EXECUTE'),
            has_function_privilege('authenticated', 'public.provider_history(date)', 'EXECUTE'),
            has_function_privilege('service_role', 'public.provider_history(date)', 'EXECUTE') $$,
  $$ VALUES (false, true, false) $$,
  'R-7: authenticated only; not anon, not service_role');

-- ══ AC-4, X-2: refusals ═════════════════════════════════════════════════════
SELECT is(pg_temp.h('anon', 0), '42501', 'AC-4: anon cannot call it');
SELECT is(pg_temp.h('service', 0), '42501', 'R-7: service_role cannot call it');
SELECT is(pg_temp.h('c1', 0), 'forbidden', 'AC-4: a customer is refused');
SELECT is(pg_temp.h('ad', 0), 'forbidden', 'AC-4: admin is refused');
SELECT is(pg_temp.call_as('a1', 'SELECT public.provider_history(NULL)::text')::jsonb ->> 'month', pg_temp.m(0)::text,
  'R-2: null is the current month');

-- ══ R-2, X-1, X-8: months ═══════════════════════════════════════════════════
SELECT is(pg_temp.h('a1', -12), 'validation_failed', 'R-2: twelve months back is refused');
SELECT is(pg_temp.call_as('a1', 'SELECT public.provider_history(''infinity''::date)::text'), 'validation_failed',
  'I-1: infinity is refused');
SELECT is(pg_temp.hj('a1', -11) ->> 'month', pg_temp.m(-11)::text, 'R-2: eleven months back is read');
SELECT is(pg_temp.hj('a1', 2) ->> 'month', pg_temp.m(2)::text, 'X-1: the month of a future job is read');
SELECT is(pg_temp.h('a1', 3), 'validation_failed', 'X-1: a month after the latest job is refused');
SELECT is(pg_temp.h('b1', 1), 'validation_failed', 'X-1: with no future job, next month is refused');
SELECT is(pg_temp.call_as('a1', format('SELECT public.provider_history(%L::date)::text', pg_temp.m(0) + 20))::jsonb ->> 'month',
  pg_temp.m(0)::text, 'R-2: any day of a month reads that month');
SELECT is((SELECT jsonb_array_length(pg_temp.hj('a1', 0) -> 'months')), 14, 'X-1: eleven back through two ahead, fourteen months');
SELECT is(pg_temp.hj('a1', 0) -> 'months' ->> 0, pg_temp.m(2)::text, 'X-1: newest first');
SELECT is(pg_temp.hj('a1', 0) -> 'months' ->> 13, pg_temp.m(-11)::text, 'X-1: the oldest is eleven months back');
SELECT is((SELECT jsonb_array_length(pg_temp.hj('b1', 0) -> 'months')), 12, 'R-2: twelve months with no future job');
SELECT is(pg_temp.ids(pg_temp.hj('a1', 0)), '8111 8104 8103 8102 8101 8106',
  'R-1, R-8, X-8: this month, newest first, the job at the very start included');
SELECT is(pg_temp.ids(pg_temp.hj('a1', -1)), '8107 8105', 'X-8: one second before the month is the month before');
SELECT is(pg_temp.ids(pg_temp.hj('a1', 2)), '8110', 'X-1: the future job sits in its own month');
SELECT is((SELECT count(*)::int FROM generate_series(-11, 2) k
            WHERE pg_temp.hj('a1', k) -> 'rows' @> jsonb_build_array(jsonb_build_object('application_id', pg_temp.app(9, 'a1')))),
  0, 'R-2: a job twelve months back is in no month');

-- ══ R-1, AC-4: own rows only ════════════════════════════════════════════════
SELECT is((SELECT count(*)::int FROM generate_series(-11, 2) k,
                  jsonb_array_elements(pg_temp.hj('a1', k) -> 'rows') x
            WHERE (x ->> 'application_id')::uuid IN (pg_temp.app(8, 'a1'), pg_temp.app(8, 'a2'))),
  0, 'R-1, AC-4: neither a2''s job nor a1''s unpicked offer on it');
SELECT is(pg_temp.ids(pg_temp.hj('a2', 0)), '8208', 'AC-4: a2 reads only its own job');
SELECT is(pg_temp.totals(pg_temp.hj('a2', 0)), '1 5000 0 5000 0', 'AC-4: a2''s totals hold only its own job');
SELECT is(pg_temp.totals(pg_temp.hj('b1', 0)) || ' ' || (pg_temp.hj('b1', 0) -> 'rows')::text, '0 0 0 0 0 []',
  'X-10: a provider pending review reads an empty month');

-- ══ R-3 to R-6, X-3 to X-6: the rows ════════════════════════════════════════
SELECT is((SELECT concat_ws(' ', x ->> 'fee_amount', x ->> 'receipt_id', x ->> 'refund_state', coalesce(x ->> 'refund_amount', '-'),
                            x ->> 'request_status', x ->> 'application_status', x ->> 'cash_due')
             FROM pg_temp.row_of(pg_temp.hj('a1', 0), 1) x),
  concat_ws(' ', '5000', pg_temp.fee(1)::text, 'none', '-', 'UNLOCKED', 'UNLOCKED', '90000'),
  'R-3, R-6: a paid fee with its receipt id and the cash');
SELECT is((SELECT concat_ws(' ', x ->> 'fee_amount', coalesce(x ->> 'receipt_id', '-'), x ->> 'refund_state', x ->> 'request_status')
             FROM pg_temp.row_of(pg_temp.hj('a1', 0), 2) x),
  '0 - none COMPLETED', 'R-3, D171: a fee of 0 has no receipt');
SELECT is((SELECT concat_ws(' ', x ->> 'fee_amount', x ->> 'receipt_id', x ->> 'refund_state', x ->> 'refund_amount', x ->> 'request_status',
                            x ->> 'cash_due')
             FROM pg_temp.row_of(pg_temp.hj('a1', 0), 3) x),
  concat_ws(' ', '4000', pg_temp.fee(3)::text, 'done', '4000', 'CANCELLED', '70000'),
  'R-4, X-3: a refunded fee keeps its receipt; the cancelled job keeps its cash figure');
SELECT is((SELECT concat_ws(' ', x ->> 'fee_amount', x ->> 'refund_state', coalesce(x ->> 'refund_amount', '-'))
             FROM pg_temp.row_of(pg_temp.hj('a1', 0), 4) x),
  '3000 pending -', 'X-4: a queued refund is pending, with no amount');
SELECT is((SELECT concat_ws(' ', x ->> 'refund_state', x ->> 'refund_amount')
             FROM pg_temp.row_of(pg_temp.hj('a1', -1), 5) x),
  'done 1000', 'R-4: a refund by hand counts as done, with its own amount');
SELECT is((SELECT x ->> 'request_status' FROM pg_temp.row_of(pg_temp.hj('a1', 0), 11) x), 'AWAITING_CONFIRMATION',
  'X-3: finished work waiting for the customer');
SELECT is((SELECT x -> 'service_name' ->> 'en' FROM pg_temp.row_of(pg_temp.hj('a1', 0), 1) x), 'Cleaning',
  'R-9: the service name in every locale');
SELECT is((SELECT x ->> 'request_id' FROM pg_temp.row_of(pg_temp.hj('a1', 0), 1) x), pg_temp.r(1)::text, 'R-9: the request id');
SELECT is((SELECT coalesce(x ->> 'request_status', 'hidden') || ' ' || (pg_temp.hj('a1', -2) -> 'totals' ->> 'cash_closed')
             FROM pg_temp.row_of(pg_temp.hj('a1', -2), 12) x),
  'hidden 0', 'S11-1, I-2: the request state of a pick the request no longer names is hidden');

-- ══ R-5, X-3, X-4: totals ═══════════════════════════════════════════════════
SELECT is(pg_temp.totals(pg_temp.hj('a1', 0)), '6 12000 4000 8000 50000',
  'R-5, X-3, X-4: jobs, every paid fee in full, done refunds only, net, cash from closed jobs only');
SELECT is(pg_temp.totals(pg_temp.hj('a1', -1)), '2 2000 1000 1000 40000', 'R-5: the month before');
SELECT is(pg_temp.totals(pg_temp.hj('a1', 2)), '1 1000 0 1000 0', 'X-1: the future month');
SELECT is(pg_temp.totals(pg_temp.hj('a1', -11)) || ' ' || (pg_temp.hj('a1', -11) -> 'rows')::text, '0 0 0 0 0 []',
  'R-5: an empty month');

-- ══ R-9: the shape, with no contact field ═══════════════════════════════════
SELECT is((SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(pg_temp.hj('a1', 0)) k),
  'currency,month,months,rows,timezone,totals,truncated', 'R-9, X-2: the top level keys, no status');
SELECT is((SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(pg_temp.hj('a1', 0) -> 'totals') k),
  'cash_closed,fees_paid,jobs,net_fees,refunds', 'R-5, X-3: the totals, none named as a balance');
SELECT is((SELECT string_agg(DISTINCT k, ',' ORDER BY k)
             FROM jsonb_array_elements(pg_temp.hj('a1', 0) -> 'rows') x, jsonb_object_keys(x) k),
  'application_id,application_status,cash_due,fee_amount,receipt_id,refund_amount,refund_state,request_id,request_status,scheduled_start_at,service_name',
  'R-9: the row keys; no name, phone, address, district or note');
SELECT is((SELECT (j ->> 'timezone') || ' ' || (j ->> 'currency') FROM pg_temp.hj('a1', 0) j),
  (SELECT timezone || ' ' || currency FROM public.regions WHERE code = 'TR'), 'X-7: the time zone and currency of the region');

-- ══ X-7: one region, one currency ═══════════════════════════════════════════
SELECT is((SELECT count(*)::int FROM public.applications a JOIN public.requests r ON r.id = a.request_id
            LEFT JOIN public.fee_payments f ON f.application_id = a.id AND f.kind = 'provider_fee'
            WHERE a.provider_id = pg_temp.u('a1') AND (r.currency <> 'TRY' OR f.currency <> 'TRY' OR a.region <> 'TR')),
  0, 'X-7: every summed request and fee of a1 is in the region''s currency');

-- ══ X-5: the fee of 0 is proved, over the seeded and the real rows ══════════
SELECT is((SELECT concat_ws(' ', x ->> 'fee_amount', x ->> 'receipt_id')
             FROM jsonb_array_elements(pg_temp.call_as('a3', format('SELECT public.provider_history(%L::date)::text',
                    ((now() + interval '3 days') AT TIME ZONE pg_temp.tz())::date))::jsonb -> 'rows') x
            WHERE (x ->> 'application_id')::uuid = pg_temp.app(20, 'a3')),
  concat_ws(' ', '5000', (SELECT id::text FROM public.fee_payments WHERE application_id = pg_temp.app(20, 'a3'))),
  'X-5: a real paid fee, with its receipt');
SELECT is((SELECT concat_ws(' ', x ->> 'fee_amount', coalesce(x ->> 'receipt_id', '-'))
             FROM jsonb_array_elements(pg_temp.call_as('a3', format('SELECT public.provider_history(%L::date)::text',
                    ((now() + interval '3 days') AT TIME ZONE pg_temp.tz())::date))::jsonb -> 'rows') x
            WHERE (x ->> 'application_id')::uuid = pg_temp.app(21, 'a3')),
  '0 -', 'X-5, D171: a real fee of 0, no receipt');
SELECT is((SELECT count(*)::int FROM public.applications a
             JOIN public.fee_payments f ON f.application_id = a.id AND f.kind = 'provider_fee' AND f.status IN ('paid', 'refunded')
            WHERE a.unlocked_at IS NOT NULL AND f.amount IS DISTINCT FROM a.provider_fee_amount),
  0, 'X-5: every fee row equals the fee frozen on the pick');
SELECT is((SELECT count(*)::int FROM public.applications a
            WHERE a.unlocked_at IS NOT NULL AND a.provider_fee_amount IS DISTINCT FROM 0
              AND NOT EXISTS (SELECT 1 FROM public.fee_payments f
                               WHERE f.application_id = a.id AND f.kind = 'provider_fee' AND f.status IN ('paid', 'refunded'))),
  0, 'X-5: an unlocked pick with no fee row froze a fee of 0');

-- ══ R-8, X-11: the cap ══════════════════════════════════════════════════════
SELECT is((SELECT jsonb_array_length(j -> 'rows') || ' ' || (j ->> 'truncated') FROM pg_temp.hj('a4', -1) j), '200 true',
  'R-8, X-11: 200 rows of 201, truncated');
SELECT is((SELECT (j -> 'rows' -> 0 ->> 'application_id') || ' ' || (j -> 'rows' -> 199 ->> 'application_id') FROM pg_temp.hj('a4', -1) j),
  '00000000-0000-0000-0000-000000990201 00000000-0000-0000-0000-000000990002', 'R-8: the newest 200');
SELECT is(pg_temp.totals(pg_temp.hj('a4', -1)), '201 0 0 0 2010000', 'R-8, X-11: the totals cover all 201');
SELECT is(pg_temp.hj('a1', 0) ->> 'truncated', 'false', 'R-8: not truncated under the cap');

SELECT * FROM finish();
ROLLBACK;
