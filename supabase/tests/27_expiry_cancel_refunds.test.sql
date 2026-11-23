-- Position 12, spec 0011-12 (D181): expiry, cancellation, fee refunds.
--
-- The columns, the backfill's checks and the settings (AC-1, R-5, R-13); the matrix and the flags with their RLS
-- (AC-1, R-15); each new guard move and refusal (R-1, R-6); one case per §36 row (rows 1 to 12) through the functions;
-- the carried re-pick (AC-4, R-3, R-4); the failed pick limit and the start edge (AC-2, AC-3); the fee rows after a
-- pick ends (R-9); the provider fee in flight at a cancel (R-12); the refund by hand (R-10); suspend (AC-10, R-7);
-- the flags (AC-11); cancel_preview and admin_request_detail; no automatic refund after the reveal; every grant; and
-- a seeded property loop over random sequences (AC-13).
--
-- A condition that needs a row changed and put back runs inside pg_temp.probe, which rolls its own changes back.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(193);

SET CONSTRAINTS ALL IMMEDIATE;

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002700' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002770' || lpad(p::text, 2, '0'))::uuid $$;
-- The application of provider w (a1, a2, a3, b1) on request p.
CREATE FUNCTION pg_temp.app(p integer, w text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-00000027' || CASE w WHEN 'a1' THEN '81' WHEN 'a2' THEN '82' WHEN 'a3' THEN '83' ELSE '84' END
          || lpad(p::text, 2, '0'))::uuid $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1 the customer, c2 a stranger, a1 a2 a3 providers who apply everywhere, b1 the provider suspended below, ad admin.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559270001'), ('c2', '905559270002'), ('a1', '905559270003'), ('a2', '905559270004'),
               ('a3', '905559270005'), ('b1', '905559270006'), ('ad', '905559270007')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'tr'
  FROM (VALUES ('c1', 'customer', '905559270001', 'İptal Müşteri'), ('c2', 'customer', '905559270002', 'Yabancı'),
               ('a1', 'provider', '905559270003', 'Bir Usta'), ('a2', 'provider', '905559270004', 'İki Usta'),
               ('a3', 'provider', '905559270005', 'Üç Usta'), ('b1', 'provider', '905559270006', 'Askı Usta'),
               ('ad', 'admin', '905559270007', 'Yönetici')) AS t(c, r, p, n);
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Usta'
 WHERE id IN (pg_temp.u('a1'), pg_temp.u('a2'), pg_temp.u('a3'), pg_temp.u('b1'));
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "İptal"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Temizlik"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Moda"}', 1.00, true);
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'payments_enabled';

CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text, true) $$;
-- A request of c1 (price 100000, commission 10000 unless given), starting in 3 days, offers of a1, a2 and a3.
CREATE FUNCTION pg_temp.req(p integer, p_commission bigint DEFAULT 10000) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at, notes)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100}', 100000, p_commission, 100000 - p_commission, 'TRY', now() + interval '3 days',
    now() + interval '3 days 2 hours', 'Ring twice');
  INSERT INTO public.request_addresses (request_id, region, customer_id, line) VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), 'Moda Cad. No 7');
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT pg_temp.app(p, w), 'TR', pg_temp.r(p), pg_temp.u(w), 'An offer for the cancel tests, long enough to pass.'
    FROM unnest(ARRAY['a1', 'a2', 'a3']) w;
  RETURN pg_temp.r(p);
END $$;
CREATE FUNCTION pg_temp.choose(p integer, w text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user('c1');
  RETURN public.choose_provider(pg_temp.r(p), pg_temp.app(p, w), 'draft-1');
END $$;
CREATE FUNCTION pg_temp.cfee(p integer) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'commission' $$;
CREATE FUNCTION pg_temp.pfee(p integer, w text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'provider_fee' AND application_id = pg_temp.app(p, w) $$;
-- The customer presses Pay (an attempt), and optionally the verified payment lands.
CREATE FUNCTION pg_temp.paycom(p integer, p_apply boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_att uuid;
BEGIN
  PERFORM pg_temp.as_user('c1');
  v_att := (public.pay_commission(pg_temp.r(p), 'tr', NULL, 'draft-1') ->> 'attempt_id')::uuid;
  IF NOT p_apply THEN
    RETURN jsonb_build_object('attempt_id', v_att);
  END IF;
  RETURN public.apply_fee_paid(pg_temp.cfee(p), v_att, 'pay-27-c' || p, 10000, 'TRY', 300);
END $$;
-- The chosen provider w presses Pay, and optionally the verified payment lands.
CREATE FUNCTION pg_temp.payfee(p integer, w text, p_apply boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_att uuid;
BEGIN
  PERFORM pg_temp.as_user(w);
  v_att := (public.pay_provider_fee(pg_temp.app(p, w), 'tr', NULL, 'draft-1') ->> 'attempt_id')::uuid;
  IF NOT p_apply THEN
    RETURN jsonb_build_object('attempt_id', v_att);
  END IF;
  RETURN public.apply_fee_paid(pg_temp.pfee(p, w), v_att, 'pay-27-p' || p || w, 5000, 'TRY', 150);
END $$;
-- Move a request's windows into the past, as the clock would (its order checks kept).
CREATE FUNCTION pg_temp.age(p integer, k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  IF k = 'pay' THEN
    UPDATE public.requests SET selected_at = now() - interval '5 hours', payment_deadline = now() - interval '1 hour' WHERE id = pg_temp.r(p);
  ELSIF k = 'pay_in_hold' THEN
    UPDATE public.requests SET selected_at = now() - interval '5 hours', payment_deadline = now() - interval '5 minutes' WHERE id = pg_temp.r(p);
  ELSIF k = 'fee' THEN
    UPDATE public.requests SET selected_at = now() - interval '5 hours',
           payment_deadline = CASE WHEN payment_deadline IS NOT NULL THEN now() - interval '4 hours' END,
           fee_deadline = now() - interval '1 hour' WHERE id = pg_temp.r(p);
  ELSIF k = 'start' THEN
    UPDATE public.requests SET selected_at = CASE WHEN selected_at IS NOT NULL THEN now() - interval '5 hours' END,
           payment_deadline = CASE WHEN payment_deadline IS NOT NULL THEN now() - interval '4 hours' END,
           fee_deadline = CASE WHEN fee_deadline IS NOT NULL THEN now() - interval '3 hours' END,
           scheduled_start_at = now() - interval '10 minutes', scheduled_end_at = now() + interval '2 hours' WHERE id = pg_temp.r(p);
  ELSIF k = 'late' THEN
    UPDATE public.requests SET selected_at = now() - interval '40 hours', payment_deadline = now() - interval '39 hours',
           fee_deadline = now() - interval '38 hours', scheduled_start_at = now() - interval '27 hours',
           scheduled_end_at = now() - interval '25 hours' WHERE id = pg_temp.r(p);
  END IF;
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
END $$;
-- Age every open card page of a fee past the checkout hold.
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
CREATE FUNCTION pg_temp.fn(p_user text, p_fn text, p_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.%I(%L)::text', p_fn, p_id)) $$;
CREATE FUNCTION pg_temp.cancel(p integer, p_user text DEFAULT 'c1') RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.cancel_request(%L, NULL)::text', pg_temp.r(p))) $$;
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
-- The request's state, its failed picks, and each application's status (a1 a2 a3 b1, - when absent).
CREATE FUNCTION pg_temp.st(p integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT r.status || ' ' || r.failed_picks || ' '
         || coalesce((SELECT status FROM public.applications WHERE id = pg_temp.app(p, 'a1')), '-') || ' '
         || coalesce((SELECT status FROM public.applications WHERE id = pg_temp.app(p, 'a2')), '-') || ' '
         || coalesce((SELECT status FROM public.applications WHERE id = pg_temp.app(p, 'a3')), '-') || ' '
         || coalesce((SELECT status FROM public.applications WHERE id = pg_temp.app(p, 'b1')), '-')
    FROM public.requests r WHERE r.id = pg_temp.r(p) $$;
-- The request's refunds: count, then each reason and status.
CREATE FUNCTION pg_temp.refunds(p integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT count(*) || coalesce(' ' || string_agg(x.reason || ':' || x.status, ',' ORDER BY x.created_at), '')
    FROM public.fee_refunds x WHERE x.request_id = pg_temp.r(p) AND x.kind = 'fee' $$;
CREATE FUNCTION pg_temp.audit(p integer, p_action text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT new_value FROM public.audit_log WHERE action = p_action AND entity_id = pg_temp.r(p)::text ORDER BY id DESC LIMIT 1 $$;

SELECT pg_temp.req(g) FROM generate_series(1, 20) g;

-- ══ AC-1, R-5, R-13: columns, the close of a cancel, the settings ═════════════
SELECT is((SELECT count(*)::int FROM public.requests WHERE id = pg_temp.r(1) AND failed_picks = 0), 1, 'AC-1: failed_picks starts at 0');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET failed_picks = -1 WHERE id = %L$q$, pg_temp.r(1))], '1'),
  '23514', 'AC-1: failed_picks is never negative (the check holds with the guard aside)');
SELECT is_empty($$ SELECT id FROM public.requests WHERE status = 'CANCELLED' AND (closed_at IS NULL OR closed_by IS DISTINCT FROM cancelled_by) $$,
  'R-5: every CANCELLED request carries its close (the backfill ran)');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'customer' WHERE id = %L$q$, pg_temp.r(1))], '1'),
  '23514', 'R15 G-1: a CANCELLED request without closed_at and closed_by is refused');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'customer', closed_at = now(), closed_by = 'platform' WHERE id = %L$q$, pg_temp.r(1))], '1'),
  '23514', 'R-13: closed_by must equal cancelled_by');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'provider', closed_at = now(), closed_by = 'provider' WHERE id = %L$q$, pg_temp.r(1))], '1'),
  '1', 'AC-1: closed_by takes provider (and platform, admin)');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'max_reselections'$$), '23514',
  'AC-1: max_reselections below 1 is refused');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '11' WHERE region = 'TR' AND key = 'max_reselections'$$), '23514',
  'AC-1: max_reselections above 10 is refused');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '169' WHERE region = 'TR' AND key = 'start_grace_hours'$$), '23514',
  'AC-1: start_grace_hours above 168 is refused');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '"1"' WHERE region = 'TR' AND key = 'completion_grace_hours'$$), '23514',
  'AC-1: completion_grace_hours is a JSON number');
SELECT is(pg_temp.err($$DELETE FROM public.platform_settings WHERE region = 'KSA' AND key = 'max_reselections'$$), 'pricing_setting_required',
  'AC-1: the limit cannot be deleted');

-- ══ AC-1, R-15: the matrix and the flags, RLS ═════════════════════════════════
SELECT results_eq($$ SELECT region, count(*)::int, count(*) FILTER (WHERE allowed)::int FROM public.cancellation_rules GROUP BY region ORDER BY region $$,
  $$ VALUES ('KSA'::text, 27, 17), ('TR', 27, 17) $$, 'AC-1: the matrix is seeded for TR and KSA (16 adds admin in OPEN and SELECTED)');
SELECT results_eq($$ SELECT state, actor, allowed, commission_outcome, provider_fee_outcome, counts_against FROM public.cancellation_rules
                      WHERE region = 'TR' AND (state, actor) IN (('COMMISSION_PAID', 'customer'), ('COMMISSION_PAID', 'provider'),
                            ('COMMISSION_PAID', 'platform'), ('UNLOCKED', 'customer'), ('AWAITING_CONFIRMATION', 'customer')) ORDER BY state, actor $$,
  $$ VALUES ('AWAITING_CONFIRMATION'::text, 'customer'::text, false, 'none'::text, 'none'::text, 'nobody'::text),
            ('COMMISSION_PAID', 'customer', true, 'refund', 'not_paid', 'nobody'),
            ('COMMISSION_PAID', 'platform', true, 'refund', 'not_paid', 'nobody'),
            ('COMMISSION_PAID', 'provider', true, 'carry', 'not_paid', 'provider_fee_follow_through'),
            ('UNLOCKED', 'customer', true, 'none', 'none', 'customer_late_cancel') $$,
  'AC-1: rows 5, 6, 7, 8 and 12 as §36 says');
-- Review of 12 (2026-11-19): every (state, actor) a function reads has its row in both regions.
SELECT is((SELECT count(*)::int FROM public.cancellation_rules c
            WHERE (c.state, c.actor) IN (('OPEN', 'customer'), ('OPEN', 'platform'), ('SELECTED', 'customer'), ('SELECTED', 'provider'),
                                         ('SELECTED', 'platform'), ('COMMISSION_PAID', 'customer'), ('COMMISSION_PAID', 'provider'),
                                         ('COMMISSION_PAID', 'platform'), ('COMMISSION_PAID', 'admin'), ('UNLOCKED', 'customer'),
                                         ('UNLOCKED', 'provider'), ('IN_PROGRESS', 'customer'), ('IN_PROGRESS', 'provider'))),
  26, 'Review: each (state, actor) the functions read is seeded in TR and KSA');
SELECT is(pg_temp.err($$INSERT INTO public.cancellation_rules VALUES ('TR', 'IN_PROGRESS', 'admin', true, 'refund', 'none', 'nobody') ON CONFLICT (region, state, actor) DO UPDATE SET commission_outcome = 'refund'$$),
  '23514', '§36 rule 1: no row may refund automatically after the reveal');
SELECT is(pg_temp.err($$UPDATE public.cancellation_rules SET allowed = true WHERE state = 'AWAITING_CONFIRMATION' AND actor = 'customer'$$),
  '23514', '§36 row 12: AWAITING_CONFIRMATION can never be made cancellable');
SELECT is(pg_temp.call_as('c2', 'SELECT count(*)::text FROM public.cancellation_rules'), '54', 'R-15: a signed in user reads the matrix');
SELECT is(pg_temp.call_as('c1', $$UPDATE public.cancellation_rules SET allowed = true RETURNING 'x'$$), '42501', 'R-15: no API write on the matrix');
SELECT is(pg_temp.call_as('ad', $$DELETE FROM public.cancellation_rules RETURNING 'x'$$), '42501', 'R-15: not even for admin');
SELECT is(pg_temp.call_as('anon', 'SELECT count(*)::text FROM public.cancellation_rules'), '42501', 'R-15: anon reads nothing');
INSERT INTO public.deadline_flags (region, request_id, kind) VALUES ('TR', pg_temp.r(20), 'start_late');
SELECT is(pg_temp.call_as('c1', 'SELECT count(*)::text FROM public.deadline_flags'), '0', 'R-15: the customer reads no flag, even on their own request');
SELECT is(pg_temp.call_as('a1', 'SELECT count(*)::text FROM public.deadline_flags'), '0', 'R-15: nor a provider');
SELECT is(pg_temp.call_as('ad', 'SELECT count(*)::text FROM public.deadline_flags'), '1', 'R-15: admin reads the flags');
SELECT is(pg_temp.call_as('ad', format($q$INSERT INTO public.deadline_flags (region, request_id, kind) VALUES ('TR', %L, 'completion_late') RETURNING 'x'$q$, pg_temp.r(20))),
  '42501', 'R-15: no API write on the flags, admin included');
SELECT is(pg_temp.err(format($q$INSERT INTO public.deadline_flags (region, request_id, kind) VALUES ('TR', %L, 'start_late')$q$, pg_temp.r(20))),
  '23505', 'AC-1: at most one open flag per request and kind');
SELECT public.clear_deadline_flags(pg_temp.r(20), NULL);
SELECT is(pg_temp.err(format($q$UPDATE public.deadline_flags SET note = 'changed' WHERE request_id = %L$q$, pg_temp.r(20))),
  'flag_immutable', 'AC-11: a cleared flag never changes');
SELECT is(pg_temp.err(format($q$DELETE FROM public.deadline_flags WHERE request_id = %L$q$, pg_temp.r(20))),
  'flag_immutable', 'AC-11: nor is deleted');

-- ══ R-1, R-6, R-15: the guards ════════════════════════════════════════════════
SELECT pg_temp.choose(2, 'a1');
SELECT is(pg_temp.err(format($q$UPDATE public.requests SET status = 'OPEN' WHERE id = %L$q$, pg_temp.r(2))),
  'request_transition_invalid', 'R-2: a reopen that keeps the pick is refused');
SELECT is(pg_temp.err(format($q$UPDATE public.requests SET status = 'OPEN', selected_application_id = NULL, selected_at = NULL, payment_deadline = NULL, failed_picks = 1 WHERE id = %L$q$, pg_temp.r(2))),
  'request_immutable', 'R-1: failed_picks grows only on COMMISSION_PAID -> OPEN');
SELECT is(pg_temp.err(format($q$UPDATE public.requests SET failed_picks = 1 WHERE id = %L$q$, pg_temp.r(1))),
  'request_immutable', 'R-1: failed_picks never changes without its move');
SELECT is(pg_temp.err(format($q$UPDATE public.requests SET status = 'COMMISSION_PAID', selected_application_id = %L, selected_at = now(), fee_deadline = now() + interval '1 hour' WHERE id = %L$q$,
                             pg_temp.app(1, 'a1'), pg_temp.r(1))),
  'request_transition_invalid', 'R-3: OPEN -> COMMISSION_PAID needs a carried commission');
SELECT is(pg_temp.err(format($q$UPDATE public.applications SET status = 'EXPIRED', status_changed_at = now() WHERE id = %L$q$, pg_temp.app(1, 'a1'))),
  'application_transition_invalid', 'R-6: an APPLIED application never EXPIRES');
SELECT is(pg_temp.err(format($q$UPDATE public.applications SET status = 'APPLIED' WHERE id = %L$q$, pg_temp.app(2, 'a2'))),
  'application_final', 'R-6: NOT_SELECTED comes back only when its request reopens');
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.applications SET status = 'WITHDRAWN', status_changed_at = now() WHERE id = %L$q$, pg_temp.app(2, 'a1'))],
                        format($q$(SELECT status FROM public.applications WHERE id = %L)$q$, pg_temp.app(2, 'a1'))),
  'WITHDRAWN', 'R-6: SELECTED -> WITHDRAWN is a move');

-- ══ §36 row 1: OPEN, the customer cancels ═════════════════════════════════════
SELECT is(pg_temp.cancel(1), '{"status": "ok"}', 'row 1: the customer cancels an OPEN request');
SELECT is(pg_temp.st(1) || ' ' || (SELECT closed_by || ' ' || (closed_at = cancelled_at)::text FROM public.requests WHERE id = pg_temp.r(1)),
  'CANCELLED 0 CANCELLED CANCELLED CANCELLED - customer true', 'row 1: CANCELLED, closed by the customer at once, the offers CANCELLED');
SELECT is(pg_temp.refunds(1), '0', 'row 1: nothing to refund');
SELECT is(pg_temp.cancel(1), '{"status": "ok"}', 'AC-6: a second cancel is ok');

-- ══ §36 row 2: SELECTED, the customer cancels ═════════════════════════════════
SELECT pg_temp.paycom(2, false);
SELECT is(pg_temp.cancel(2), 'checkout_open', 'AC-6: 09''s guard stays: not under a young card page');
SELECT pg_temp.age_attempts(pg_temp.cfee(2));
SELECT is(pg_temp.cancel(2), '{"status": "ok"}', 'row 2: the customer cancels a SELECTED request');
SELECT is(pg_temp.st(2) || ' ' || pg_temp.refunds(2), 'CANCELLED 0 CANCELLED NOT_SELECTED NOT_SELECTED - 0', 'row 2: no refund, the pick CANCELLED');

-- ══ §36 row 3: SELECTED, the provider withdraws (AC-5, R-7) ═══════════════════
SELECT pg_temp.choose(3, 'a1');
SELECT pg_temp.paycom(3, false);
SELECT is(pg_temp.fn('a1', 'withdraw_application', pg_temp.app(3, 'a1')), 'checkout_open', 'R-7: never under the customer''s card page');
SELECT is(pg_temp.fn('a2', 'withdraw_application', pg_temp.app(3, 'a1')), 'not_found', 'AC-5: another provider''s application reads not_found');
SELECT is(pg_temp.fn('c1', 'withdraw_application', pg_temp.app(3, 'a1')), 'not_found', 'AC-5: and so does the customer');
SELECT is(pg_temp.fn('anon', 'withdraw_application', pg_temp.app(3, 'a1')), '42501', 'AC-5: anon cannot call it');
SELECT pg_temp.age_attempts(pg_temp.cfee(3));
SELECT is(pg_temp.fn('a1', 'withdraw_application', pg_temp.app(3, 'a1')), '{"status": "ok", "replayed": false}', 'row 3: the chosen provider withdraws');
SELECT is(pg_temp.st(3), 'OPEN 0 WITHDRAWN APPLIED APPLIED -', 'row 3: the request OPEN, not a failed pick; the others restored (D162)');
SELECT ok((SELECT selected_application_id IS NULL AND selected_at IS NULL AND payment_deadline IS NULL AND fee_deadline IS NULL FROM public.requests WHERE id = pg_temp.r(3)),
  'R-2: the four selection columns cleared together');
SELECT is(pg_temp.audit(3, 'request.provider_withdrew') ->> 'counts_against', 'provider_cancellation', 'row 3: counts against the provider');
SELECT is(pg_temp.fn('a1', 'withdraw_application', pg_temp.app(3, 'a1')), '{"status": "ok", "replayed": true}', 'AC-5: a second press is a replay');
SELECT is(pg_temp.fn('a2', 'withdraw_application', pg_temp.app(3, 'a2')), '{"status": "ok", "replayed": false}', 'AC-5: an APPLIED offer is withdrawn too');
SELECT is(pg_temp.st(3), 'OPEN 0 WITHDRAWN WITHDRAWN APPLIED -', 'AC-5: no count, the request untouched');
SELECT is((pg_temp.choose(3, 'a3') ->> 'payment_deadline') IS NOT NULL, true, 'AC-4: with nothing paid the next pick has a payment window again');
SELECT is(pg_temp.st(3), 'SELECTED 0 WITHDRAWN WITHDRAWN SELECTED -', 'AC-4: a3 SELECTED');

-- ══ §36 row 4: SELECTED, the payment window expires (AC-2.1, R-9) ═════════════
SELECT pg_temp.choose(4, 'a1');
SELECT pg_temp.paycom(4, false);
SELECT pg_temp.age(4, 'pay_in_hold');
SELECT is(public.expire_request(pg_temp.r(4)), 'none', 'AC-2.1: inside the checkout hold after the deadline nothing moves');
SELECT pg_temp.age(4, 'pay');
SELECT is(public.expire_request(pg_temp.r(4)), 'held', 'AC-2.1: a card page younger than the hold holds the expiry');
SELECT pg_temp.age_attempts(pg_temp.cfee(4));
CREATE TEMP TABLE r4_fee AS SELECT pg_temp.cfee(4) AS id;
SELECT is(public.expire_windows() >= 1, true, 'AC-2: expire_windows takes it');
SELECT is(pg_temp.st(4), 'OPEN 0 EXPIRED APPLIED APPLIED -', 'row 4: the pick EXPIRED, the request OPEN, not a failed pick, the others restored');
SELECT ok((SELECT actor_id IS NULL FROM public.audit_log WHERE action = 'request.pick_expired' AND entity_id = pg_temp.r(4)::text),
  'AC-2.1: one pick_expired row, no actor');
SELECT is(pg_temp.call_as('c1', format('SELECT public.choose_provider(%L, %L, ''draft-1'')::text', pg_temp.r(4), pg_temp.app(4, 'a1'))),
  'provider_not_eligible', 'AC-4: the provider whose pick expired is never picked again');
SELECT pg_temp.choose(4, 'a2');
SELECT is((pg_temp.paycom(4, false) ->> 'attempt_id') IS NOT NULL AND pg_temp.cfee(4) = (SELECT id FROM r4_fee), true,
  'R-9: the commission row is kept pending and reused by the next pick');
-- Owner, 2026-11-18: a card page opened under the earlier pick is refused; the payment goes the late path.
CREATE TEMP TABLE r4_att AS
  SELECT (SELECT id FROM public.checkout_attempts WHERE fee_payment_id = pg_temp.cfee(4) ORDER BY started_at LIMIT 1) AS old_id,
         (SELECT id FROM public.checkout_attempts WHERE fee_payment_id = pg_temp.cfee(4) ORDER BY started_at DESC LIMIT 1) AS new_id;
SELECT ok(NOT public.accept_commission(pg_temp.cfee(4), (SELECT old_id FROM r4_att)),
  'accept_commission: an attempt started before the current pick is refused');
SELECT ok(public.accept_commission(pg_temp.cfee(4), (SELECT new_id FROM r4_att)),
  'accept_commission: an attempt of the current pick is accepted');
SELECT is(public.apply_fee_paid(pg_temp.cfee(4), (SELECT old_id FROM r4_att), 'pay-27-c4-old', 10000, 'TRY', 300) ->> 'status', 'late',
  'accept_commission: the earlier pick''s payment is booked late, to be refunded');
SELECT is((SELECT r.status || ' ' || f.status FROM public.requests r JOIN public.fee_payments f ON f.request_id = r.id AND f.kind = 'commission'
            WHERE r.id = pg_temp.r(4)), 'SELECTED pending', 'accept_commission: the new pick and its commission are untouched');

-- ══ §36 row 5: COMMISSION_PAID, the customer cancels; R-12 ════════════════════
SELECT pg_temp.choose(5, 'a1');
SELECT pg_temp.paycom(5);
SELECT is(pg_temp.st(5), 'COMMISSION_PAID 0 AWAITING_FEE NOT_SELECTED NOT_SELECTED -', 'fixture: R5 COMMISSION_PAID');
SELECT pg_temp.payfee(5, 'a1', false);
CREATE TEMP TABLE r5_cancel AS SELECT (pg_temp.cancel(5))::jsonb AS j;
SELECT is((SELECT j FROM r5_cancel), jsonb_build_object('status', 'ok', 'refund',
            jsonb_build_object('fee_refund_id', (SELECT id FROM public.fee_refunds WHERE fee_payment_id = pg_temp.cfee(5)), 'amount', 10000, 'currency', 'TRY')),
  'row 5, R-12: the customer cancels under the provider''s card page, the commission refunded');
SELECT is(pg_temp.st(5) || ' ' || pg_temp.refunds(5), 'CANCELLED 0 CANCELLED NOT_SELECTED NOT_SELECTED - 1 customer_cancel:queued',
  'row 5: one refund queued, reason customer_cancel (R-11)');
SELECT results_eq(
  format($q$ SELECT o.kind, o.payload ->> 'amount', o.payload ->> 'psp_payment_id' FROM public.outbox_events o
              WHERE o.idempotency_key = 'refund:' || (SELECT id FROM public.fee_refunds WHERE fee_payment_id = %L) $q$, pg_temp.cfee(5)),
  $$ VALUES ('refund.request'::text, '10000'::text, 'pay-27-c5'::text) $$, 'AC-7: its refund.request outbox row, the fee''s own figures');
SELECT is((public.apply_fee_paid(pg_temp.pfee(5, 'a1'),
                                 (SELECT a.id FROM public.checkout_attempts a WHERE a.fee_payment_id = pg_temp.pfee(5, 'a1')),
                                 'pay-27-late5', 5000, 'TRY', 150)) ->> 'status', 'late',
  'R-12: the provider fee that lands after the cancel is refunded by the late path');
SELECT is((SELECT status FROM public.fee_payments WHERE id = pg_temp.pfee(5, 'a1')), 'pending', 'R-9: and the fee row stays pending');

-- ══ §36 row 6: the fee window expires; the carried re-pick (AC-4, R-3, R-4) ═══
SELECT pg_temp.choose(6, 'a1');
SELECT pg_temp.paycom(6);
SELECT pg_temp.payfee(6, 'a1', false);
SELECT pg_temp.age(6, 'fee');
SELECT is(public.expire_request(pg_temp.r(6)), 'held', 'AC-2.2: the provider''s young card page holds the expiry');
SELECT pg_temp.age_attempts(pg_temp.pfee(6, 'a1'));
SELECT is(public.expire_request(pg_temp.r(6)), 'reopened', 'AC-2.2: then the fee window expires');
SELECT is(pg_temp.st(6) || ' ' || pg_temp.refunds(6), 'OPEN 1 EXPIRED APPLIED APPLIED - 0', 'row 6: a failed pick, the commission carries, no refund');
SELECT is((SELECT status FROM public.fee_payments WHERE id = pg_temp.cfee(6)), 'paid', 'row 6: the commission stays paid');
SELECT is(pg_temp.audit(6, 'request.fee_expired') ->> 'counts_against', 'provider_fee_follow_through', 'row 6: counts against the provider');
SELECT is(pg_temp.fn('c1', 'cancel_preview', pg_temp.r(6))::jsonb #>> '{refund,amount}', '10000',
  'AC-6: an OPEN request with a carried commission reads the COMMISSION_PAID row (the preview offers the refund)');
CREATE TEMP TABLE r6_pick AS SELECT pg_temp.choose(6, 'a2') AS j;
SELECT is((SELECT j - 'selected_at' - 'fee_deadline' FROM r6_pick), '{"status": "ok", "carried": true, "replayed": false, "payment_deadline": null}'::jsonb,
  'AC-4: the carried re-pick needs no payment');
SELECT is(pg_temp.st(6), 'COMMISSION_PAID 1 EXPIRED AWAITING_FEE NOT_SELECTED -', 'R-3, R-4: straight to COMMISSION_PAID, the pick AWAITING_FEE');
SELECT ok((SELECT r.payment_deadline IS NULL AND r.selected_at = now()
                  AND r.fee_deadline = greatest(least(now() + make_interval(hours => (public.unlock_settings('TR') ->> 'unlock_window_hours')::integer), r.scheduled_start_at),
                                                now() + make_interval(mins => (public.unlock_settings('TR') ->> 'min_window_minutes')::integer))
                  AND a.provider_fee_amount = 5000
             FROM public.requests r JOIN public.applications a ON a.id = r.selected_application_id WHERE r.id = pg_temp.r(6)),
  'R-3, R-4: no payment window, the fee window by 09''s rule, the provider fee frozen');
SELECT is((SELECT count(*)::int FROM public.fee_payments WHERE request_id = pg_temp.r(6) AND kind = 'commission'), 1, 'AC-4: still one commission fee');
SELECT is((pg_temp.choose(6, 'a2') ->> 'replayed')::boolean, true, 'AC-4: choosing the same offer again is a replay');
SELECT is(pg_temp.call_as('c1', format('SELECT public.choose_provider(%L, %L, ''draft-1'')::text', pg_temp.r(6), pg_temp.app(6, 'a3'))),
  'not_choosable', 'AC-4: a picked request takes no other choose');
SELECT is((pg_temp.payfee(6, 'a2')) ->> 'status', 'paid', 'AC-4: the new pick pays its own fee');
SELECT is(pg_temp.st(6), 'UNLOCKED 1 EXPIRED UNLOCKED NOT_SELECTED -', 'AC-4: and the carried commission unlocks the request');
SELECT is((SELECT status FROM public.fee_payments WHERE id = pg_temp.pfee(6, 'a1')), 'pending', 'R-9: the ended pick''s fee row stays pending');
SELECT is((public.apply_fee_paid(pg_temp.pfee(6, 'a1'), (SELECT a.id FROM public.checkout_attempts a WHERE a.fee_payment_id = pg_temp.pfee(6, 'a1')),
                                 'pay-27-late6', 5000, 'TRY', 150)) ->> 'status', 'late',
  'R-9: a late payment on it is refunded by 07''s late path, never accepted');

-- ══ §36 row 8: UNLOCKED, the customer cancels; no automatic refund ════════════
SELECT is(pg_temp.cancel(6), '{"status": "ok"}', 'row 8: the customer cancels after the reveal');
SELECT is(pg_temp.st(6) || ' ' || pg_temp.refunds(6), 'CANCELLED 1 EXPIRED CANCELLED NOT_SELECTED - 0', 'row 8: no fee refunded automatically');
SELECT is(pg_temp.audit(6, 'request.cancelled') ->> 'counts_against', 'customer_late_cancel', 'row 8: counts against the customer');
SELECT ok((SELECT a.unlocked_at IS NOT NULL FROM public.applications a WHERE a.id = pg_temp.app(6, 'a2')), 'row 8: the pick keeps its reveal');

-- ══ §36 row 6 (withdraw from AWAITING_FEE), AC-5 ══════════════════════════════
SELECT pg_temp.choose(7, 'a1');
SELECT pg_temp.paycom(7);
SELECT pg_temp.payfee(7, 'a1', false);
SELECT is(pg_temp.fn('a1', 'withdraw_application', pg_temp.app(7, 'a1')), 'checkout_open', 'AC-5: not under the provider''s own young card page');
SELECT pg_temp.age_attempts(pg_temp.pfee(7, 'a1'));
SELECT is(pg_temp.fn('a1', 'withdraw_application', pg_temp.app(7, 'a1')), '{"status": "ok", "replayed": false}', 'row 6: the chosen provider withdraws before paying');
SELECT is(pg_temp.st(7) || ' ' || pg_temp.refunds(7), 'OPEN 1 WITHDRAWN APPLIED APPLIED - 0', 'row 6: a failed pick, the commission carries');

-- ══ §36 row 7, AC-3: the third failed pick refunds once ═══════════════════════
SELECT pg_temp.choose(8, 'a1');
SELECT pg_temp.paycom(8);
SELECT pg_temp.age(8, 'fee');
SELECT public.expire_request(pg_temp.r(8));
SELECT pg_temp.choose(8, 'a2');
SELECT pg_temp.age(8, 'fee');
SELECT public.expire_request(pg_temp.r(8));
SELECT is(pg_temp.st(8) || ' ' || pg_temp.refunds(8), 'OPEN 2 EXPIRED EXPIRED APPLIED - 0', 'AC-3: two failed picks, still carried');
SELECT pg_temp.choose(8, 'a3');
SELECT pg_temp.age(8, 'fee');
SELECT is(public.expire_request(pg_temp.r(8)), 'cancelled', 'AC-3: the third failed pick cancels');
SELECT is(pg_temp.st(8) || ' ' || pg_temp.refunds(8), 'CANCELLED 3 EXPIRED EXPIRED EXPIRED - 1 failed_picks:queued',
  'row 7: CANCELLED, the commission refunded once, reason failed_picks');
SELECT is((SELECT cancelled_by || ' ' || closed_by FROM public.requests WHERE id = pg_temp.r(8)), 'platform platform', 'R-13: by the platform');
SELECT is(public.expire_request(pg_temp.r(8)), 'none', 'AC-3: a later run does nothing more');

-- ══ AC-3 with a commission of 0 (D171; review of 12, 2026-11-19) ═════════════
-- No fee row, so nothing carries: each pick settles 0 at once. The limit still cancels, through the expiry and
-- through the last provider's withdraw, and nothing is refunded.
SELECT pg_temp.req(21, 0);
SELECT pg_temp.req(22, 0);
SELECT pg_temp.choose(21, 'a1');
SELECT pg_temp.paycom(21, false);
SELECT pg_temp.age(21, 'fee');
SELECT public.expire_request(pg_temp.r(21));
SELECT pg_temp.choose(21, 'a2');
SELECT pg_temp.paycom(21, false);
SELECT pg_temp.age(21, 'fee');
SELECT public.expire_request(pg_temp.r(21));
SELECT pg_temp.choose(22, 'a1');
SELECT pg_temp.paycom(22, false);
SELECT pg_temp.age(22, 'fee');
SELECT public.expire_request(pg_temp.r(22));
SELECT pg_temp.choose(22, 'a2');
SELECT pg_temp.paycom(22, false);
SELECT pg_temp.age(22, 'fee');
SELECT public.expire_request(pg_temp.r(22));
SELECT pg_temp.choose(21, 'a3');
SELECT pg_temp.paycom(21, false);
SELECT pg_temp.age(21, 'fee');
SELECT is(public.expire_request(pg_temp.r(21)), 'cancelled', 'AC-3, commission 0: the third failed pick cancels');
SELECT is(pg_temp.st(21) || ' ' || pg_temp.refunds(21), 'CANCELLED 3 EXPIRED EXPIRED EXPIRED - 0',
  'AC-3, commission 0: CANCELLED, nothing to refund');
SELECT is((SELECT cancelled_by || ' ' || closed_by FROM public.requests WHERE id = pg_temp.r(21)), 'platform platform',
  'AC-3, commission 0: by the platform');
SELECT pg_temp.choose(22, 'a3');
SELECT pg_temp.paycom(22, false);
SELECT is(pg_temp.fn('a3', 'withdraw_application', pg_temp.app(22, 'a3')), '{"status": "ok", "replayed": false}',
  'AC-5, commission 0: the provider at the limit may withdraw');
SELECT is(pg_temp.st(22) || ' ' || pg_temp.refunds(22), 'CANCELLED 3 EXPIRED EXPIRED WITHDRAWN - 0',
  'AC-3, commission 0: the withdraw that reaches the limit cancels, nothing refunded');

-- ══ AC-2.3: the start edge ════════════════════════════════════════════════════
SELECT pg_temp.choose(9, 'a1');
SELECT pg_temp.paycom(9);
SELECT pg_temp.age(9, 'start');
SELECT is(public.expire_request(pg_temp.r(9)), 'cancelled', 'AC-2.2, AC-2.3: at the start the fee window ends and nobody paid');
SELECT is(pg_temp.st(9) || ' ' || pg_temp.refunds(9), 'CANCELLED 1 EXPIRED NOT_SELECTED NOT_SELECTED - 1 no_paid_pick:queued',
  'AC-2.3: CANCELLED by the platform, the commission refunded, reason no_paid_pick');
SELECT pg_temp.choose(10, 'a1');
SELECT pg_temp.paycom(10);
SELECT pg_temp.fn('a1', 'withdraw_application', pg_temp.app(10, 'a1'));
SELECT pg_temp.age(10, 'start');
SELECT is(public.expire_windows() >= 1, true, 'AC-2.3: expire_windows finds the OPEN request with a carried commission past its start');
SELECT is(pg_temp.st(10) || ' ' || pg_temp.refunds(10), 'CANCELLED 1 WITHDRAWN CANCELLED CANCELLED - 1 no_paid_pick:queued',
  'AC-2.3: cancelled, refunded once');
SELECT ok((SELECT actor_id IS NULL FROM public.audit_log WHERE action = 'request.no_paid_pick' AND entity_id = pg_temp.r(10)::text),
  'AC-2.3: one no_paid_pick row');
SELECT pg_temp.choose(11, 'a1');
SELECT pg_temp.age(11, 'start');
SELECT is(public.expire_request(pg_temp.r(11)), 'reopened', 'AC-2.1: at the start an unpaid pick ends');
SELECT is(pg_temp.st(11), 'OPEN 0 EXPIRED APPLIED APPLIED -', 'R-14: with nothing paid the OPEN request stays (16 decides)');

-- ══ §36 row 9: the provider cancels after the reveal ══════════════════════════
SELECT pg_temp.choose(12, 'a1');
SELECT pg_temp.paycom(12);
SELECT pg_temp.payfee(12, 'a1');
SELECT is(pg_temp.fn('c1', 'provider_cancel_job', pg_temp.r(12)), 'not_found', 'R-15: the customer cannot use the provider''s cancel');
SELECT is(pg_temp.fn('a2', 'provider_cancel_job', pg_temp.r(12)), 'not_found', 'R-15: nor a losing provider');
SELECT is(pg_temp.fn('a1', 'provider_cancel_job', pg_temp.r(7)), 'not_found', 'R-15: nor a provider before their reveal');
SELECT is(pg_temp.fn('a1', 'withdraw_application', pg_temp.app(12, 'a1')), 'invalid_state', 'R-15: after the reveal there is no withdraw');
SELECT is(pg_temp.fn('a1', 'cancel_preview', pg_temp.r(12))::jsonb - 'state',
  '{"actor": "provider", "refund": null, "can_cancel": true, "checkout_open": false, "counts_against": "provider_cancellation", "commission_outcome": "none", "provider_fee_outcome": "none"}'::jsonb,
  'AC-14: the provider''s preview: may cancel, nothing refunded');
SELECT is(pg_temp.fn('a1', 'provider_cancel_job', pg_temp.r(12)), '{"status": "ok"}', 'row 9: the unlocked provider cancels');
SELECT is(pg_temp.st(12) || ' ' || pg_temp.refunds(12) || ' ' || (SELECT cancelled_by || ' ' || closed_by FROM public.requests WHERE id = pg_temp.r(12)),
  'CANCELLED 0 CANCELLED NOT_SELECTED NOT_SELECTED - 0 provider provider', 'row 9: CANCELLED by the provider, nothing refunded');
SELECT is((SELECT count(*)::int FROM public.fee_payments WHERE request_id = pg_temp.r(12) AND status = 'paid'), 2, 'row 9: both fees stay paid');
SELECT is(pg_temp.fn('a1', 'provider_cancel_job', pg_temp.r(12)), '{"status": "ok"}', 'AC-6: a second press is ok');
SELECT is(pg_temp.fn('c1', 'cancel_preview', pg_temp.r(12))::jsonb ->> 'can_cancel', 'false', 'AC-14: a cancelled request offers no cancel');
SELECT is((pg_temp.fn('c1', 'request_contacts', pg_temp.r(12)))::jsonb ->> 'side', 'customer', 'AC-0: the contact window runs from the close');

-- ══ §36 rows 8 and 9 IN_PROGRESS, row 10 and AC-11: the flags ═════════════════
SELECT pg_temp.choose(13, 'a1');
SELECT pg_temp.paycom(13);
SELECT pg_temp.payfee(13, 'a1');
SELECT pg_temp.age(13, 'late');
SELECT is(public.raise_deadline_flags() >= 1, true, 'AC-11: UNLOCKED past the start plus the grace raises a flag');
SELECT is((SELECT string_agg(kind, ',') FROM public.deadline_flags WHERE request_id = pg_temp.r(13) AND cleared_at IS NULL), 'start_late', 'AC-11: start_late');
SELECT public.raise_deadline_flags();
SELECT is((SELECT count(*)::int FROM public.deadline_flags WHERE request_id = pg_temp.r(13)), 1, 'AC-11: a second run raises no second flag');
SELECT is(pg_temp.refunds(13), '0', 'row 10: a no-show refunds nothing by itself');
SELECT public.clear_deadline_flags(pg_temp.r(13), NULL);
SELECT public.raise_deadline_flags();
SELECT is((SELECT count(*)::int || ' ' || count(*) FILTER (WHERE cleared_at IS NULL) FROM public.deadline_flags WHERE request_id = pg_temp.r(13)), '2 1',
  'AC-11: a cleared flag can be raised again');
SELECT pg_temp.fn('a1', 'start_job', pg_temp.r(13));
SELECT is((SELECT count(*)::int FROM public.deadline_flags WHERE request_id = pg_temp.r(13) AND cleared_at IS NULL), 0, 'AC-11: Started clears start_late');
SELECT is((SELECT note || ' ' || coalesce(cleared_by::text, '-') FROM public.deadline_flags WHERE request_id = pg_temp.r(13) ORDER BY raised_at DESC, cleared_at DESC LIMIT 1), 'auto -',
  'AC-11: by itself, note auto');
SELECT is(public.raise_deadline_flags() >= 1, true, 'AC-11: IN_PROGRESS past the end plus the grace raises completion_late');
SELECT is((SELECT string_agg(kind, ',') FROM public.deadline_flags WHERE request_id = pg_temp.r(13) AND cleared_at IS NULL), 'completion_late', 'AC-11: completion_late');
SELECT is(pg_temp.probe(ARRAY[format('SELECT pg_temp.fn(%L, %L, %L)', 'a1', 'finish_job', pg_temp.r(13))],
                        format('(SELECT count(*) FROM public.deadline_flags WHERE request_id = %L AND cleared_at IS NULL)', pg_temp.r(13))), '0',
  'AC-11: Done clears it');
SELECT is(pg_temp.probe(ARRAY[]::text[], format('pg_temp.cancel(%s)', 13)), '{"status": "ok"}', 'row 8: the customer may cancel IN_PROGRESS');
SELECT is(pg_temp.fn('a1', 'provider_cancel_job', pg_temp.r(13)), '{"status": "ok"}', 'row 9: the provider cancels IN_PROGRESS');
SELECT is(pg_temp.st(13) || ' ' || pg_temp.refunds(13) || ' ' || (SELECT count(*) FROM public.deadline_flags WHERE request_id = pg_temp.r(13) AND cleared_at IS NULL),
  'CANCELLED 0 CANCELLED NOT_SELECTED NOT_SELECTED - 0 0', 'AC-11, row 9: the cancel clears the flag, nothing refunded');

-- ══ §36 row 12: AWAITING_CONFIRMATION onward ══════════════════════════════════
SELECT pg_temp.choose(14, 'a1');
SELECT pg_temp.paycom(14);
SELECT pg_temp.payfee(14, 'a1');
SELECT pg_temp.age(14, 'start');
SELECT pg_temp.fn('a1', 'start_job', pg_temp.r(14));
SELECT pg_temp.fn('a1', 'finish_job', pg_temp.r(14));
SELECT is(pg_temp.cancel(14), 'not_cancellable', 'row 12: the customer cannot cancel AWAITING_CONFIRMATION');
SELECT is(pg_temp.fn('a1', 'provider_cancel_job', pg_temp.r(14)), 'not_cancellable', 'row 12: nor the provider');
SELECT is(pg_temp.fn('c1', 'cancel_preview', pg_temp.r(14))::jsonb ->> 'can_cancel', 'false', 'row 12: the preview offers no cancel');
SELECT is(pg_temp.st(14), 'AWAITING_CONFIRMATION 0 COMPLETED NOT_SELECTED NOT_SELECTED -', 'row 12: unchanged');

-- ══ §36 row 11, AC-8: admin refunds by hand ═══════════════════════════════════
SELECT pg_temp.choose(15, 'a1');
SELECT pg_temp.paycom(15);
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_refund_fee(%L, %L)::text', pg_temp.cfee(15), 'The customer asked us by phone')),
  'invalid_state', 'AC-8: not a commission still before the reveal (it refunds by itself on a cancel)');
SELECT pg_temp.payfee(15, 'a1');
SELECT is(pg_temp.call_as('c1', format('SELECT public.admin_refund_fee(%L, %L)::text', pg_temp.cfee(15), 'The customer asked us by phone')),
  'forbidden', 'AC-8: only admin');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_refund_fee(%L, %L)::text', pg_temp.cfee(15), ' too short ')),
  'reason_required', 'AC-8: a reason of 10 to 500 characters');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_refund_fee(%L, %L)::text', gen_random_uuid(), 'The customer asked us by phone')),
  'not_found', 'AC-8: an unknown fee');
SELECT is((pg_temp.call_as('ad', format('SELECT public.admin_refund_fee(%L, %L)::text', pg_temp.cfee(15), 'Provider no-show, confirmed by phone')))::jsonb ->> 'replayed',
  'false', 'row 11: admin refunds the commission of a revealed job');
SELECT is((pg_temp.call_as('ad', format('SELECT public.admin_refund_fee(%L, %L)::text', pg_temp.pfee(15, 'a1'), 'Provider fee back, a goodwill gesture')))::jsonb ->> 'replayed',
  'false', 'row 11: and the provider fee of the revealed pick');
SELECT is(pg_temp.refunds(15), '2 admin_refund:queued,admin_refund:queued', 'R-11: each a refund row with the reason code');
SELECT is((pg_temp.call_as('ad', format('SELECT public.admin_refund_fee(%L, %L)::text', pg_temp.cfee(15), 'The customer asked us by phone')))::jsonb ->> 'replayed',
  'true', 'AC-7: a second refund of one fee returns the first');
SELECT is((SELECT new_value ->> 'reason' FROM public.audit_log WHERE action = 'fee.refund_by_admin' AND entity_id = pg_temp.cfee(15)::text),
  'Provider no-show, confirmed by phone', 'R-11: the free text lives only in the audit row');
SELECT is((pg_temp.fn('c1', 'request_contacts', pg_temp.r(15)))::jsonb ->> 'side', 'customer', 'AC-8, D90: a refund never hides contacts');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_refund_fee(%L, %L)::text', pg_temp.pfee(7, 'a1'), 'Provider fee back, a goodwill gesture')),
  'invalid_state', 'AC-8: not a provider fee that was never paid');

-- ══ AC-7, AC-9, R-10: a refused refund, finished by hand ══════════════════════
SELECT is(pg_temp.err(format('SELECT public.queue_fee_refund(%L, %L, NULL)', pg_temp.cfee(15), 'whim')), 'validation_failed', 'R-11: only the reason codes');
SELECT is(pg_temp.err(format('SELECT public.queue_fee_refund(%L, %L, NULL)', pg_temp.cfee(4), 'admin_refund')), 'invalid_state', 'AC-7: only a paid fee');
SELECT is(public.queue_fee_refund(pg_temp.cfee(5), 'admin_refund', NULL), (SELECT id FROM public.fee_refunds WHERE fee_payment_id = pg_temp.cfee(5)),
  'AC-7: a second call returns the first refund');
CREATE TEMP TABLE r15_refund AS SELECT id FROM public.fee_refunds WHERE fee_payment_id = pg_temp.cfee(15);
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_mark_refund_done(%L, %L)::text', (SELECT id FROM r15_refund), 'Refunded in the panel, ref 123')),
  'invalid_state', 'R-10: only a refund the relay marked failed');
SELECT public.mark_refund_failed((SELECT id FROM r15_refund));
SELECT is(pg_temp.call_as('c1', format('SELECT public.admin_mark_refund_done(%L, %L)::text', (SELECT id FROM r15_refund), 'Refunded in the panel, ref 123')),
  'forbidden', 'R-10: only admin');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_mark_refund_done(%L, %L)::text', (SELECT id FROM r15_refund), 'done')),
  'reason_required', 'R-10: a note of 10 to 500 characters');
SELECT is((pg_temp.call_as('ad', format('SELECT public.admin_mark_refund_done(%L, %L)::text', (SELECT id FROM r15_refund), 'Refunded in the panel, ref 123')))::jsonb ->> 'replayed',
  'false', 'AC-9: admin records the refund made by hand');
SELECT is((SELECT x.status || ' ' || f.status || ' ' || (x.finished_at IS NOT NULL)::text FROM public.fee_refunds x JOIN public.fee_payments f ON f.id = x.fee_payment_id
            WHERE x.id = (SELECT id FROM r15_refund)), 'done_by_hand refunded true', 'R-10: done_by_hand; the fee refunded');
SELECT is((SELECT jsonb_agg(jsonb_build_object(e.account, e.amount) ORDER BY e.account) FROM public.ledger_entries e
             JOIN public.ledger_journals j ON j.id = e.journal_id WHERE j.idempotency_key = 'fee:' || pg_temp.cfee(15) || ':refund'),
  '[{"commission_refunds": 10000}, {"psp_clearing": -10000}]'::jsonb, 'R-10: the journal apply_fee_refunded would post, under its key');
SELECT is((pg_temp.call_as('ad', format('SELECT public.admin_mark_refund_done(%L, %L)::text', (SELECT id FROM r15_refund), 'Refunded in the panel, ref 123')))::jsonb ->> 'replayed',
  'true', 'R-10: a second record is a replay');
SELECT is(pg_temp.err(format('SELECT public.apply_fee_refunded(%L, %L)', (SELECT id FROM r15_refund), 'psp-refund-27')), 'invalid_state',
  'R-10: a later PSP success for it is refused (the relay alerts reconcile_mismatch)');
SELECT is((SELECT new_value ->> 'note' FROM public.audit_log WHERE action = 'fee.refund_done_by_hand' AND entity_id = (SELECT id::text FROM r15_refund)),
  'Refunded in the panel, ref 123', 'R-10: the note is audited');

-- ══ AC-10, R-7, R-8: suspend ══════════════════════════════════════════════════
INSERT INTO public.applications (id, region, request_id, provider_id, message)
SELECT pg_temp.app(g, 'b1'), 'TR', pg_temp.r(g), pg_temp.u('b1'), 'An offer of the provider who is suspended, long enough.'
  FROM generate_series(16, 20) g;
SELECT pg_temp.choose(17, 'b1');
SELECT pg_temp.choose(18, 'b1');
SELECT pg_temp.paycom(18);
SELECT pg_temp.choose(19, 'b1');
SELECT pg_temp.paycom(19);
SELECT pg_temp.payfee(19, 'b1');
SELECT pg_temp.choose(20, 'b1');
SELECT pg_temp.paycom(20, false);
SELECT is(pg_temp.call_as('c1', format('SELECT public.suspend_provider(%L, %L)::text', pg_temp.u('b1'), 'Repeated complaints')), 'forbidden', 'AC-10: only admin suspends');
SELECT is(pg_temp.call_as('ad', format('SELECT public.suspend_provider(%L, %L)::text', pg_temp.u('b1'), 'Repeated complaints')), '{"status": "suspended"}', 'AC-10: admin suspends b1');
SELECT is(pg_temp.st(16), 'OPEN 0 APPLIED APPLIED APPLIED WITHDRAWN', 'AC-10: an APPLIED offer WITHDRAWN');
SELECT is(pg_temp.st(17), 'OPEN 0 APPLIED APPLIED APPLIED WITHDRAWN', 'AC-10: a SELECTED pick WITHDRAWN, the request OPEN, the others restored');
SELECT is(pg_temp.st(18) || ' ' || pg_temp.refunds(18) || ' ' || (public.carried_commission(pg_temp.r(18)) IS NOT NULL)::text,
  'OPEN 0 APPLIED APPLIED APPLIED WITHDRAWN 0 true', 'AC-10: an AWAITING_FEE pick WITHDRAWN: not a failed pick, the commission carries');
SELECT is(pg_temp.st(19) || ' ' || pg_temp.refunds(19), 'UNLOCKED 0 NOT_SELECTED NOT_SELECTED NOT_SELECTED UNLOCKED 0',
  'AC-10: after the reveal the job stays, nothing refunded');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'request.provider_suspended' AND entity_id = pg_temp.r(19)::text), 1,
  'AC-10: with an audit row the admin page shows');
SELECT is(pg_temp.st(20), 'SELECTED 0 NOT_SELECTED NOT_SELECTED NOT_SELECTED SELECTED', 'R-7: a pick under the customer''s card page is left');
SELECT is(public.expire_request(pg_temp.r(20)), 'held', 'R-7: expire_windows holds it while the page is young');
SELECT pg_temp.age_attempts(pg_temp.cfee(20));
SELECT is(public.expire_request(pg_temp.r(20)), 'reopened', 'R-7: then drops it once the page is no longer in use');
SELECT is(pg_temp.st(20), 'OPEN 0 APPLIED APPLIED APPLIED WITHDRAWN', 'R-7: WITHDRAWN, not EXPIRED, and the request reopened');
SELECT is((public.apply_fee_paid(pg_temp.cfee(20), (SELECT a.id FROM public.checkout_attempts a WHERE a.fee_payment_id = pg_temp.cfee(20)),
                                 'pay-27-late20', 10000, 'TRY', 300)) ->> 'status', 'late', 'R-8: a payment for the dropped pick is refunded as late');
SELECT is(pg_temp.call_as('c1', format('SELECT public.choose_provider(%L, %L, ''draft-1'')::text', pg_temp.r(17), pg_temp.app(17, 'b1'))),
  'provider_not_eligible', 'AC-10: the suspended provider is not picked again');

-- ══ AC-12, AC-14: the reads ═══════════════════════════════════════════════════
SELECT is(pg_temp.fn('c1', 'admin_request_detail', pg_temp.r(15)), 'forbidden', 'AC-12: only admin reads the request page');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys((pg_temp.fn('ad', 'admin_request_detail', pg_temp.r(15)))::jsonb) k),
  ARRAY['applications', 'fees', 'flags', 'ledger', 'refunds', 'request', 'timeline'], 'AC-12: every section');
SELECT ok(position('Moda Cad' IN pg_temp.fn('ad', 'admin_request_detail', pg_temp.r(15))) = 0, 'AC-12: never the street line');
SELECT is((SELECT jsonb_array_length(j -> 'fees') || ' ' || jsonb_array_length(j -> 'refunds') || ' ' || jsonb_array_length(j -> 'applications')
             FROM (SELECT (pg_temp.fn('ad', 'admin_request_detail', pg_temp.r(15)))::jsonb AS j) x), '2 2 3', 'AC-12: its fees, refunds and applications');
SELECT is(pg_temp.fn('c2', 'cancel_preview', pg_temp.r(15)), 'not_found', 'AC-14: a stranger previews nothing');
SELECT is(pg_temp.fn('c1', 'cancel_preview', pg_temp.r(18))::jsonb - 'actor',
  '{"state": "COMMISSION_PAID", "refund": {"kind": "commission", "amount": 10000, "currency": "TRY"}, "can_cancel": true, "checkout_open": false, "counts_against": "nobody", "commission_outcome": "refund", "provider_fee_outcome": "not_paid"}'::jsonb,
  'AC-14: the exact refund before the customer confirms');
SELECT pg_temp.choose(16, 'a1');
SELECT pg_temp.paycom(16, false);
SELECT is(pg_temp.fn('c1', 'cancel_preview', pg_temp.r(16))::jsonb ->> 'checkout_open', 'true', 'AC-14: a card page in use is named');

-- ══ No automatic refund after the reveal, by any path (R-15) ══════════════════
SELECT is_empty($$ SELECT x.id FROM public.fee_refunds x
                    WHERE x.kind = 'fee' AND x.reason IN ('customer_cancel', 'no_paid_pick', 'failed_picks')
                      AND EXISTS (SELECT 1 FROM public.applications a WHERE a.request_id = x.request_id AND a.unlocked_at IS NOT NULL) $$,
  'R-15: no automatic refund on any request that reached the reveal');
SELECT is(public.expire_request(pg_temp.r(19)) || public.expire_request(pg_temp.r(14)), 'nonenone', 'R-15: the expiry never touches a revealed job');

-- ══ The books, grants and cron ════════════════════════════════════════════════
SELECT pg_temp.as_user('ad');
SELECT is((SELECT jsonb_agg(i) FROM jsonb_array_elements(public.ledger_check('TR') -> 'imbalances') i), NULL, 'AC-13: the books balance');
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default", p.prosecdef, has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            has_function_privilege('service_role', p.oid, 'EXECUTE'), has_function_privilege('anon', p.oid, 'EXECUTE')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('admin_mark_refund_done', 'admin_refund_fee', 'admin_request_detail', 'after_reopen', 'attempt_open',
                          'cancel_by_rule', 'cancel_preview', 'cancel_request', 'cancel_rule', 'cancel_state', 'carried_commission',
                          'choose_provider', 'clear_deadline_flags', 'end_pick', 'expire_request', 'expire_windows', 'grace_hours',
                          'provider_cancel_job', 'queue_fee_refund', 'raise_deadline_flags', 'reselection_limit', 'suspend_provider',
                          'withdraw_application')
      ORDER BY p.proname $$,
  $$ VALUES ('admin_mark_refund_done', true, true, false, false), ('admin_refund_fee', true, true, false, false),
            ('admin_request_detail', true, true, false, false), ('after_reopen', false, false, false, false),
            ('attempt_open', false, false, false, false), ('cancel_by_rule', false, false, false, false),
            ('cancel_preview', true, true, false, false), ('cancel_request', true, true, false, false),
            ('cancel_rule', false, false, false, false), ('cancel_state', false, false, false, false),
            ('carried_commission', false, false, false, false), ('choose_provider', true, true, false, false),
            ('clear_deadline_flags', false, false, false, false), ('end_pick', false, false, false, false),
            ('expire_request', false, false, false, false), ('expire_windows', true, false, false, false),
            ('grace_hours', false, false, false, false), ('provider_cancel_job', true, true, false, false),
            ('queue_fee_refund', false, false, false, false), ('raise_deadline_flags', true, false, false, false),
            ('reselection_limit', false, false, false, false), ('suspend_provider', true, true, false, false),
            ('withdraw_application', true, true, false, false) $$,
  'every grant: definers only where a user calls; the cron jobs and helpers have no API grant');
SELECT results_eq($$ SELECT jobname::text, schedule::text FROM cron.job WHERE jobname LIKE 'requests-%' ORDER BY jobname $$,
  $$ VALUES ('requests-deadline-flags', '*/10 * * * *'), ('requests-expire-windows', '* * * * *') $$,
  'AC-2, AC-11: the expiry every minute, the flags every 10 minutes');

-- ══ AC-13: a seeded property test over random sequences ═══════════════════════
-- Twelve requests and random moves: choose, pay either fee, a payment landing late, the windows passing, withdraw,
-- cancel by either side, suspend-free admin refunds, refunds confirmed or failed and finished by hand. Every refusal
-- is a stable code; afterwards every fee is refunded at most once, the commission is refunded automatically only by
-- rows 5 and 7 and the start edge and never after the reveal, and the books balance.
SELECT pg_temp.req(30 + g) FROM generate_series(1, 12) g;
CREATE TEMP TABLE prop_err (n integer, op integer, err text);
CREATE TEMP TABLE prop_auto (n integer, request_id uuid, revealed boolean, reason text);
SELECT setseed(0.2712);
DO $$
DECLARE
  v_p      integer;
  v_op     integer;
  v_w      text;
  v_fee    uuid;
  v_att    uuid;
  v_rid    uuid;
  v_ids    uuid[];
  v_rev    boolean;
BEGIN
  FOR k IN 1..500 LOOP
    v_p := 31 + floor(random() * 12)::integer;
    v_op := (ARRAY[0, 0, 0, 1, 1, 1, 2, 2, 3, 4, 4, 5, 6, 7, 8, 9, 9, 10])[1 + floor(random() * 18)::integer];
    v_w := (ARRAY['a1', 'a2', 'a3'])[1 + floor(random() * 3)::integer];
    v_rev := EXISTS (SELECT 1 FROM public.applications a WHERE a.request_id = pg_temp.r(v_p) AND a.unlocked_at IS NOT NULL);
    v_ids := ARRAY(SELECT x.id FROM public.fee_refunds x WHERE x.request_id = pg_temp.r(v_p));
    BEGIN
      IF v_op = 0 THEN
        PERFORM pg_temp.choose(v_p, v_w);
      ELSIF v_op = 1 THEN
        PERFORM pg_temp.as_user('c1');
        v_att := (public.pay_commission(pg_temp.r(v_p), 'tr', NULL, 'draft-1') ->> 'attempt_id')::uuid;
        IF v_att IS NOT NULL AND random() < 0.8 THEN
          PERFORM public.apply_fee_paid(pg_temp.cfee(v_p), v_att, 'prop-27-' || k, 10000, 'TRY', 300);
        END IF;
      ELSIF v_op = 2 THEN
        SELECT p.w INTO v_w FROM unnest(ARRAY['a1', 'a2', 'a3']) p(w)
          JOIN public.requests r ON r.selected_application_id = pg_temp.app(v_p, p.w) WHERE r.id = pg_temp.r(v_p);
        IF v_w IS NOT NULL THEN
          PERFORM pg_temp.as_user(v_w);
          v_att := (public.pay_provider_fee(pg_temp.app(v_p, v_w), 'tr', NULL, 'draft-1') ->> 'attempt_id')::uuid;
          IF v_att IS NOT NULL AND random() < 0.8 THEN
            PERFORM public.apply_fee_paid(pg_temp.pfee(v_p, v_w), v_att, 'prop-27-' || k, 5000, 'TRY', 150);
          END IF;
        END IF;
      ELSIF v_op = 3 THEN
        -- A payment lands on any attempt of the request, in time or not.
        SELECT a.id, a.fee_payment_id INTO v_att, v_fee FROM public.checkout_attempts a JOIN public.fee_payments f ON f.id = a.fee_payment_id
         WHERE f.request_id = pg_temp.r(v_p) ORDER BY random() LIMIT 1;
        IF v_att IS NOT NULL THEN
          PERFORM public.apply_fee_paid(v_fee, v_att, 'prop-27-' || k, (SELECT amount FROM public.fee_payments WHERE id = v_fee), 'TRY', 0);
        END IF;
      ELSIF v_op = 4 THEN
        PERFORM pg_temp.age_attempts(f.id) FROM public.fee_payments f WHERE f.request_id = pg_temp.r(v_p);
        IF (SELECT status FROM public.requests WHERE id = pg_temp.r(v_p)) = 'SELECTED' THEN
          PERFORM pg_temp.age(v_p, 'pay');
        ELSIF (SELECT status FROM public.requests WHERE id = pg_temp.r(v_p)) = 'COMMISSION_PAID' THEN
          PERFORM pg_temp.age(v_p, 'fee');
        END IF;
        PERFORM public.expire_request(pg_temp.r(v_p));
      ELSIF v_op = 5 THEN
        PERFORM pg_temp.as_user(v_w);
        PERFORM public.withdraw_application(pg_temp.app(v_p, v_w));
      ELSIF v_op = 6 THEN
        PERFORM pg_temp.as_user('c1');
        PERFORM public.cancel_request(pg_temp.r(v_p), NULL);
      ELSIF v_op = 7 THEN
        PERFORM pg_temp.as_user(v_w);
        PERFORM public.provider_cancel_job(pg_temp.r(v_p));
      ELSIF v_op = 8 THEN
        SELECT f.id INTO v_fee FROM public.fee_payments f WHERE f.request_id = pg_temp.r(v_p) ORDER BY random() LIMIT 1;
        IF v_fee IS NOT NULL THEN
          PERFORM pg_temp.as_user('ad');
          PERFORM public.admin_refund_fee(v_fee, 'A refund decided by admin in the property test');
        END IF;
      ELSIF v_op = 9 THEN
        SELECT x.id INTO v_rid FROM public.fee_refunds x WHERE x.request_id = pg_temp.r(v_p) AND x.status IN ('queued', 'done', 'failed')
         ORDER BY random() LIMIT 1;
        IF v_rid IS NOT NULL THEN
          IF random() < 0.6 THEN
            PERFORM public.apply_fee_refunded(v_rid, 'prop-refund-' || v_rid);
          ELSE
            PERFORM public.mark_refund_failed(v_rid);
          END IF;
        END IF;
      ELSE
        SELECT x.id INTO v_rid FROM public.fee_refunds x WHERE x.request_id = pg_temp.r(v_p) ORDER BY random() LIMIT 1;
        IF v_rid IS NOT NULL THEN
          PERFORM pg_temp.as_user('ad');
          PERFORM public.admin_mark_refund_done(v_rid, 'Refunded by hand in the property test');
        END IF;
      END IF;
      -- Every automatic fee refund this step queued, with whether the request had reached the reveal before it.
      INSERT INTO prop_auto
      SELECT k, x.request_id, v_rev, x.reason FROM public.fee_refunds x
       WHERE x.request_id = pg_temp.r(v_p) AND x.kind = 'fee' AND x.reason <> 'admin_refund' AND NOT (x.id = ANY (v_ids));
    EXCEPTION WHEN raise_exception THEN
      IF sqlerrm NOT IN ('invalid_state', 'not_found', 'not_choosable', 'offer_unavailable', 'provider_not_eligible',
                         'not_cancellable', 'checkout_open', 'already_paid', 'deadline_passed', 'too_many_checkouts') THEN
        INSERT INTO prop_err VALUES (k, v_op, sqlerrm);
      END IF;
    END;
  END LOOP;
END $$;

SELECT is_empty($$ SELECT n, op, err FROM prop_err $$, 'AC-13: every refusal in 500 random steps is a stable code');
SELECT ok((SELECT count(*) FROM public.fee_refunds WHERE request_id IN (SELECT pg_temp.r(30 + g) FROM generate_series(1, 12) g)) >= 6
          AND (SELECT count(*) FROM public.requests WHERE id IN (SELECT pg_temp.r(30 + g) FROM generate_series(1, 12) g) AND status = 'CANCELLED') >= 4,
  'AC-13: the sequence reached refunds and cancels');
SELECT is_empty(
  $$ SELECT f.id FROM public.fee_payments f
      WHERE f.request_id IN (SELECT pg_temp.r(30 + g) FROM generate_series(1, 12) g)
        AND ((SELECT count(*) FROM public.fee_refunds x WHERE x.fee_payment_id = f.id) > 1
             OR (SELECT count(*) FROM public.ledger_journals j WHERE j.fee_payment_id = f.id AND j.kind = 'fee_refund') > 1) $$,
  'AC-13: every fee refunded at most once');
SELECT is_empty(
  $$ SELECT x.id FROM public.fee_refunds x JOIN public.fee_payments f ON f.id = x.fee_payment_id
      WHERE x.request_id IN (SELECT pg_temp.r(30 + g) FROM generate_series(1, 12) g)
        AND x.reason <> 'admin_refund' AND (f.kind <> 'commission' OR x.reason NOT IN ('customer_cancel', 'failed_picks', 'no_paid_pick')) $$,
  'AC-13: automatic refunds are commissions, only by row 5, row 7 or the start edge');
SELECT is_empty($$ SELECT n, request_id FROM prop_auto WHERE revealed $$, 'AC-13: never an automatic refund after the reveal');
SELECT pg_temp.as_user('ad');
SELECT is((SELECT jsonb_agg(i) FROM jsonb_array_elements(public.ledger_check('TR') -> 'imbalances') i), NULL,
  'AC-13: the books balance after 500 random steps');

SELECT * FROM finish();
ROLLBACK;
