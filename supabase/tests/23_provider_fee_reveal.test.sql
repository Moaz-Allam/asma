-- Position 10, spec 0011-10 (D178): the chosen provider pays the provider fee, then contacts are shared both ways.
--
-- The setting and its check (AC-1, R-10), the two new columns and their guards (AC-1, R-5, R-6), pay_provider_fee's
-- refusals in their order, reuse, the count and a provider fee of 0 (AC-2, R-8), accept_provider_fee true and false
-- for each condition (AC-3, R-15), the move to UNLOCKED with the others NOT_SELECTED (AC-4, R-12), request_contacts
-- and the street line policy before, after and past the window for every party (AC-5, AC-6, R-2, R-4, R-14), the one
-- audit row per side and the WhatsApp link (AC-7, R-3), my_checkout's new fields (R-1), a second payment (R-9), the
-- jobs read and its tabs (R-11), and every grant.
--
-- A condition that needs a row changed and put back runs inside pg_temp.probe, which rolls its own changes back.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(103);

SET CONSTRAINTS ALL IMMEDIATE;

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002300' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002370' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.app(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002380' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.app2(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002390' || lpad(p::text, 2, '0'))::uuid $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1 the customer, c2 a stranger, a1 the chosen provider, a2 a second applicant.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559230001'), ('c2', '905559230002'), ('a1', '905559230003'), ('a2', '905559230004')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale, email)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'tr', e
  FROM (VALUES ('c1', 'customer', '905559230001', 'Ece Müşteri', 'ece@example.test'),
               ('c2', 'customer', '905559230002', 'Can Yabancı', NULL),
               ('a1', 'provider', '905559230003', 'Ayşe Usta', 'ayse@example.test'),
               ('a2', 'provider', '905559230004', 'Bora Usta', NULL)) AS t(c, r, p, n, e);
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Ayşe Usta' WHERE id = pg_temp.u('a1');
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Bora Usta' WHERE id = pg_temp.u('a2');
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Açılış"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Temizlik"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Moda"}', 1.00, true);
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'payments_enabled';

-- A request of c1 (price 100000, the given commission), offers of a1 and a2, a1 chosen, and the commission
-- settled: a commission of 0 settles at once; any other is paid through an attempt and apply_fee_paid.
CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.req(p integer, p_commission bigint, p_start interval, p_settle boolean DEFAULT true)
  RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_fee uuid;
  v_att uuid;
BEGIN
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at, notes)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100}', 100000, p_commission, 100000 - p_commission, 'TRY', now() + p_start,
    now() + p_start + interval '2 hours', 'Ring twice');
  INSERT INTO public.request_addresses (request_id, region, customer_id, line)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), 'Moda Cad. No 5');
  INSERT INTO public.applications (id, region, request_id, provider_id, message) VALUES
    (pg_temp.app(p), 'TR', pg_temp.r(p), pg_temp.u('a1'), 'An offer for the reveal tests, long enough.'),
    (pg_temp.app2(p), 'TR', pg_temp.r(p), pg_temp.u('a2'), 'A second offer for the reveal tests, long enough.');
  PERFORM pg_temp.as_user('c1');
  PERFORM public.choose_provider(pg_temp.r(p), pg_temp.app(p));
  IF p_settle THEN
    IF p_commission = 0 THEN
      PERFORM public.pay_commission(pg_temp.r(p), 'tr', NULL);
    ELSE
      v_att := (public.pay_commission(pg_temp.r(p), 'tr', NULL) ->> 'attempt_id')::uuid;
      SELECT f.id INTO v_fee FROM public.fee_payments f WHERE f.request_id = pg_temp.r(p) AND f.kind = 'commission';
      PERFORM public.apply_fee_paid(v_fee, v_att, 'pay-23-c' || p, p_commission, 'TRY', 0);
    END IF;
  END IF;
  RETURN pg_temp.r(p);
END $$;
CREATE FUNCTION pg_temp.pfee(p integer) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'provider_fee' $$;
CREATE FUNCTION pg_temp.att(p integer) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT a.id FROM public.checkout_attempts a WHERE a.fee_payment_id = pg_temp.pfee(p)
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
CREATE FUNCTION pg_temp.pay(p integer, p_user text DEFAULT 'a1', p_app uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.pay_provider_fee(%L, %L, NULL)::text', coalesce(p_app, pg_temp.app(p)), 'tr')) $$;
CREATE FUNCTION pg_temp.contacts(p integer, p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.request_contacts(%L)::text', pg_temp.r(p))) $$;
CREATE FUNCTION pg_temp.street(p integer, p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT coalesce(max(line), %L) FROM public.request_addresses WHERE request_id = %L', 'none', pg_temp.r(p))) $$;
CREATE FUNCTION pg_temp.visible(p integer, p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.contacts_visible(%L)::text', pg_temp.r(p))) $$;
-- Run setup statements and an expression, then roll all of it back.
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
CREATE FUNCTION pg_temp.suspend(p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$UPDATE public.providers SET status = 'suspended', suspension_reason = 'A test of the reveal' WHERE id = %L$q$, pg_temp.u(p_user)) $$;

-- R1 the main path (commission 10000 paid); R2 a provider fee of 0 (commission 0); R3 not settled (SELECTED);
-- R4 past its fee window; R5 the counter; R6 accept checks; R7 a second payment; R8 the zero path against a
-- refunded commission; R9 starts within the floor (the overrun).
SELECT pg_temp.req(1, 10000, interval '3 days');
SELECT pg_temp.req(3, 10000, interval '3 days', false);
SELECT pg_temp.req(4, 0, interval '3 days');
SELECT pg_temp.req(5, 0, interval '3 days');
SELECT pg_temp.req(6, 0, interval '3 days');
SELECT pg_temp.req(7, 0, interval '3 days');
SELECT pg_temp.req(9, 0, interval '30 minutes');
-- R2 and R8: a provider fee of 0 (the fee settings set to 0 for the choose, then put back).
UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key IN ('provider_fee_value', 'fee_min_minor');
SELECT pg_temp.req(2, 0, interval '3 days');
SELECT pg_temp.req(8, 10000, interval '3 days');
UPDATE public.platform_settings SET value = '5' WHERE region = 'TR' AND key = 'provider_fee_value';
UPDATE public.platform_settings SET value = '1000' WHERE region = 'TR' AND key = 'fee_min_minor';

-- ══ AC-1, R-10: the setting ══════════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT region, value FROM public.platform_settings WHERE key = 'contact_visible_days' ORDER BY region $$,
  $$ VALUES ('KSA'::text, '14'::jsonb), ('TR', '14'::jsonb) $$,
  'AC-1, R-10: contact_visible_days is seeded 14 for both regions');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'contact_visible_days'$$),
  '23514', 'R-10: below 1 is refused by the row check');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '"14"' WHERE region = 'TR' AND key = 'contact_visible_days'$$),
  '23514', 'R-10: a string is refused');
SELECT is(pg_temp.err($$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'contact_visible_days'$$),
  'pricing_setting_required', 'R-10: the key cannot be deleted');

-- ══ AC-2: pay_provider_fee, refusals in order ════════════════════════════════
SELECT is(pg_temp.call_as('a1', format('SELECT public.pay_provider_fee(%L, %L, NULL)::text', pg_temp.app(1), 'de')),
  'validation_failed', 'AC-2 step 1: a locale outside ar, tr, en');
SELECT is(pg_temp.pay(1, 'a2', pg_temp.app(1)), 'not_found', 'AC-2 step 2, R-14: another provider''s application is not found');
SELECT is(pg_temp.pay(1, 'c1'), 'not_found', 'AC-2 step 2: the customer is not its provider');
SELECT is(pg_temp.pay(1, 'a1', gen_random_uuid()), 'not_found', 'AC-2 step 2: an unknown application');
SELECT is(pg_temp.pay(3), 'invalid_state', 'AC-2 step 3: the commission is not settled yet (SELECTED)');
SELECT is(pg_temp.pay(1, 'a2', pg_temp.app2(1)), 'invalid_state', 'AC-2 step 3: an application that is not the pick');
SELECT is(pg_temp.probe(ARRAY[pg_temp.suspend('a1')], format('pg_temp.pay(%s)', 1)), 'invalid_state',
  'AC-2 step 3: a suspended provider cannot pay');
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.requests SET fee_deadline = now() - interval '1 minute' WHERE id = %L$q$, pg_temp.r(4))],
                        'pg_temp.pay(4)'), 'request_immutable',
  'AC-1, R-6: fee_deadline cannot be moved by hand');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET selected_at = now() - interval '2 days', payment_deadline = now() - interval '1 day', fee_deadline = now() - interval '1 minute' WHERE id = %L$q$, pg_temp.r(4)),
                              'ALTER TABLE public.requests ENABLE TRIGGER requests_guard'],
                        'pg_temp.pay(4)'), 'deadline_passed', 'AC-2 step 4: past the fee window');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'payments_enabled'$$],
                        'pg_temp.pay(5)'), 'payments_disabled', 'AC-2 step 6: payments switched off');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'checkout_hold_minutes'$$],
                        'pg_temp.pay(5)'), 'checkout_settings_invalid', 'AC-2 step 7: a missing checkout setting');

-- A new attempt, then reuse, then the count.
CREATE TEMP TABLE pay1 AS SELECT pg_temp.pay(1)::jsonb AS j;
SELECT is((SELECT j - 'attempt_id' FROM pay1), '{"status": "checkout", "reused": false}', 'AC-2 step 11: a new attempt');
SELECT is(pg_temp.pay(1)::jsonb, (SELECT j || '{"reused": true}' FROM pay1), 'AC-2 step 9: a young attempt is reused');
SELECT results_eq(
  $$ SELECT f.kind, f.status, f.amount, f.payer_id = f.provider_id, f.provider_id = pg_temp.u('a1')
       FROM public.fee_payments f WHERE f.id = pg_temp.pfee(1) $$,
  $$ VALUES ('provider_fee'::text, 'pending'::text, 5000::bigint, true, true) $$,
  'AC-0: one pending provider fee, the frozen amount, paid by the chosen provider');
SELECT is((SELECT count FROM public.action_counters WHERE subject_id = pg_temp.pfee(1)), 1, 'AC-2: one count, none for the reuse');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'fee.checkout_requested' AND new_value ->> 'request_id' = pg_temp.r(1)::text
             AND new_value ->> 'fee_payment_id' = pg_temp.pfee(1)::text), 1, 'AC-2: one audit row for the new attempt, none for the reuse');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.platform_settings SET value = '1' WHERE region = 'TR' AND key = 'checkouts_per_fee_hour'$$,
                              format($q$UPDATE public.checkout_attempts SET status = 'failed', failure_reason = 'psp_failed', finished_at = now() WHERE id = %L$q$, pg_temp.att(1))],
                        'pg_temp.pay(1)'), 'too_many_checkouts', 'AC-2 step 10: above the limit');

-- R-1: my_checkout serves the provider with its amount, deadline and application.
SELECT results_eq(
  format($$ SELECT j ->> 'fee_kind', (j ->> 'amount')::bigint, (j ->> 'deadline')::timestamptz = r.fee_deadline,
                   (j ->> 'application_id')::uuid FROM (SELECT %s::jsonb AS j) x, public.requests r WHERE r.id = %L $$,
         quote_literal(pg_temp.call_as('a1', format('SELECT public.my_checkout(%L)::text', pg_temp.att(1)))), pg_temp.r(1)),
  $$ VALUES ('provider_fee'::text, 5000::bigint, true, pg_temp.app(1)) $$,
  'R-1: my_checkout gives the provider the fee, the amount, the fee window and the application');
SELECT is(pg_temp.call_as('c1', format('SELECT public.my_checkout(%L)::text', pg_temp.att(1))), 'not_found',
  'R-1: the customer cannot read the provider''s attempt');
SELECT is(pg_temp.call_as('a2', format('SELECT public.my_checkout(%L)::text', pg_temp.att(1))), 'not_found',
  'R-1: nor another provider');

-- ══ AC-3, R-15: accept_provider_fee ══════════════════════════════════════════
CREATE FUNCTION pg_temp.accept1() RETURNS text LANGUAGE sql AS $$
  SELECT format('public.accept_provider_fee(%L, %L)', pg_temp.pfee(1), pg_temp.att(1)) $$;
SELECT ok(public.accept_provider_fee(pg_temp.pfee(1), pg_temp.att(1)), 'AC-3: a pending fee inside the window is accepted');
SELECT ok(NOT public.accept_provider_fee(gen_random_uuid(), pg_temp.att(1)), 'AC-3: an unknown fee is not');
SELECT is(pg_temp.probe(ARRAY[pg_temp.suspend('a1')], pg_temp.accept1()), 'false', 'AC-3: not when the provider is suspended');
SELECT is(pg_temp.probe(ARRAY[format($q$INSERT INTO public.fee_refunds (region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency, reason)
                                       SELECT 'TR', %L, 'fee', f.id, 'pay-23-c1', f.amount, 'TRY', 'test' FROM public.fee_payments f
                                        WHERE f.request_id = %L AND f.kind = 'commission'$q$, pg_temp.r(1), pg_temp.r(1))],
                        pg_temp.accept1()), 'false', 'AC-3: not when the commission was refunded');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.checkout_attempts DISABLE TRIGGER USER',
                              format($q$UPDATE public.checkout_attempts SET started_at = (SELECT fee_deadline + interval '1 minute' FROM public.requests WHERE id = %L) WHERE id = %L$q$, pg_temp.r(1), pg_temp.att(1))],
                        pg_temp.accept1()), 'false', 'AC-3: not for an attempt started after the fee window');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET selected_at = now() - interval '3 hours', payment_deadline = now() - interval '2 hours', scheduled_start_at = now() - interval '1 minute', scheduled_end_at = now() + interval '1 hour' WHERE id = %L$q$, pg_temp.r(1))],
                        pg_temp.accept1()), 'false', 'AC-3, R-15: not after the job''s start');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'checkout_hold_minutes'$$],
                        pg_temp.accept1()), 'checkout_settings_invalid', 'AC-3: a missing hold raises, never refunds');

CREATE TEMP TABLE pay5 AS SELECT pg_temp.pay(5)::jsonb AS j;
CREATE FUNCTION pg_temp.accept5() RETURNS text LANGUAGE sql AS $$
  SELECT format('public.accept_provider_fee(%L, %L)', pg_temp.pfee(5), pg_temp.att(5)) $$;
SELECT ok(public.accept_provider_fee(pg_temp.pfee(5), pg_temp.att(5)), 'S10-7: R5 is accepted as it stands');
SELECT ok(NOT public.accept_provider_fee(pg_temp.pfee(5), pg_temp.att(1)), 'S10-7: not with an attempt of another fee');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET selected_at = now() - interval '3 days', payment_deadline = now() - interval '2 days', fee_deadline = now() - interval '1 hour' WHERE id = %L$q$, pg_temp.r(5)),
                              'ALTER TABLE public.checkout_attempts DISABLE TRIGGER USER',
                              format($q$UPDATE public.checkout_attempts SET started_at = now() - interval '2 hours' WHERE id = %L$q$, pg_temp.att(5))],
                        pg_temp.accept5()), 'false', 'S10-7: not after the fee window plus the hold');
SELECT is(pg_temp.probe(ARRAY[format($q$INSERT INTO public.fee_refunds (region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency, reason)
                                       VALUES ('TR', %L, 'fee', %L, 'pay-23-r5', 5000, 'TRY', 'test')$q$, pg_temp.r(5), pg_temp.pfee(5))],
                        pg_temp.accept5()), 'false', 'S10-7: not when a refund names the provider fee itself');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.applications DISABLE TRIGGER applications_guard',
                              format($q$UPDATE public.applications SET status = 'WITHDRAWN' WHERE id = %L$q$, pg_temp.app(5))],
                        pg_temp.accept5()), 'false', 'S10-7: not when the pick is no longer AWAITING_FEE');
-- S10-6: a suspend that lands first turns a verified payment late, refunded; nothing is revealed.
SELECT is(pg_temp.probe(ARRAY[pg_temp.suspend('a1')],
                        format($q$(public.apply_fee_paid(%L, %L, 'pay-23-s5', 5000, 'TRY', 150)) ->> 'status'$q$, pg_temp.pfee(5), pg_temp.att(5))),
  'late', 'S10-6: a payment after a suspend is refunded, not revealed');
-- A-6: an expired document does not hide a paid job's contacts; only suspension does. The standing function
-- is swapped inside the probe (rolled back) to answer document_expired.
SELECT is(pg_temp.probe(ARRAY[format($q$SELECT public.apply_fee_paid(%L, %L, 'pay-23-d5', 5000, 'TRY', 150)$q$, pg_temp.pfee(5), pg_temp.att(5)),
                              $q$CREATE OR REPLACE FUNCTION public.provider_standing(p_provider_id uuid) RETURNS text
                                   LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $f$ SELECT 'document_expired'::text $f$$q$],
                        format('pg_temp.visible(%s, %L)', 5, 'a1')), 'true',
  'A-6: a provider whose document expired after the reveal still sees the paid job');

-- ══ AC-4: the verified payment reveals ═══════════════════════════════════════
SELECT is(pg_temp.contacts(1, 'c1'), 'not_found', 'AC-5: no contacts for the customer before the fee');
SELECT is(pg_temp.contacts(1, 'a1'), 'not_found', 'AC-5: nor for the provider');
SELECT is(pg_temp.street(1, 'a1'), 'none', 'AC-6: the provider reads no street line before the fee');
SELECT is(pg_temp.visible(1, 'a1'), 'false', 'R-2: contacts_visible is false before the fee');
CREATE TEMP TABLE paid1 AS SELECT public.apply_fee_paid(pg_temp.pfee(1), pg_temp.att(1), 'pay-23-p1', 5000, 'TRY', 150) AS j;
SELECT is((SELECT j ->> 'status' FROM paid1), 'paid', 'AC-4: the payment is accepted');
SELECT results_eq(
  $$ SELECT r.status, a.status, a.unlocked_at = now(), b.status
       FROM public.requests r JOIN public.applications a ON a.id = r.selected_application_id
       JOIN public.applications b ON b.id = pg_temp.app2(1) WHERE r.id = pg_temp.r(1) $$,
  $$ VALUES ('UNLOCKED'::text, 'UNLOCKED'::text, true, 'NOT_SELECTED'::text) $$,
  'AC-4, R-12: request and pick UNLOCKED, unlocked_at set, the other applicant NOT_SELECTED');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'request.unlocked' AND entity_id = pg_temp.r(1)::text), 1,
  'AC-4: one audit row for the move');

-- ══ AC-5, AC-6, AC-7: the contacts ═══════════════════════════════════════════
SELECT results_eq(
  format($$ SELECT j ->> 'side', j ->> 'name', j ->> 'phone', j ->> 'whatsapp', j ->> 'email', (j ->> 'email_confirmed')::boolean,
                   j ? 'street', j ? 'notes' FROM (SELECT %s::jsonb AS j) x $$, quote_literal(pg_temp.contacts(1, 'c1'))),
  $$ VALUES ('customer'::text, 'Ayşe Usta'::text, '+905559230003'::text, 'https://wa.me/905559230003'::text, 'ayse@example.test'::text, false, false, false) $$,
  'AC-5, AC-7: the customer reads the provider''s approved name, phone, WhatsApp link, email; no address fields');
SELECT results_eq(
  format($$ SELECT j ->> 'side', j ->> 'name', j ->> 'phone', j ->> 'whatsapp', j ->> 'street', j ->> 'notes', j -> 'zone' ->> 'tr'
              FROM (SELECT %s::jsonb AS j) x $$, quote_literal(pg_temp.contacts(1, 'a1'))),
  $$ VALUES ('provider'::text, 'Ece Müşteri'::text, '+905559230001'::text, 'https://wa.me/905559230001'::text, 'Moda Cad. No 5'::text, 'Ring twice'::text, 'Moda'::text) $$,
  'AC-5: the provider reads the customer''s name, phone, WhatsApp link, street line, notes and zone');
SELECT is(pg_temp.street(1, 'a1'), 'Moda Cad. No 5', 'AC-6: the same query now returns the street line');
SELECT is(pg_temp.contacts(1, 'a2'), 'not_found', 'AC-5, R-14: the second applicant gets nothing');
SELECT is(pg_temp.street(1, 'a2'), 'none', 'AC-6: nor the street line');
SELECT is(pg_temp.contacts(1, 'c2'), 'not_found', 'AC-5: a stranger gets nothing');
SELECT is(pg_temp.street(1, 'c2'), 'none', 'AC-6, R-14: a stranger reads no street line');
SELECT is(pg_temp.visible(1, 'c2'), 'false', 'R-2: contacts_visible is false for a stranger');
SELECT is(pg_temp.visible(1, 'a1'), 'true', 'R-2: and true for the unlocked provider');
SELECT is(pg_temp.contacts(1, 'anon'), '42501', 'AC-5: anon cannot call request_contacts');
SELECT is(pg_temp.visible(1, 'anon'), '42501', 'R-2: nor contacts_visible');
SELECT is(pg_temp.street(1, 'anon'), '42501', 'AC-6, S10-8: anon reads no address row');
SELECT is(pg_temp.contacts(3, 'c1'), 'not_found', 'R-14: a never unlocked request gives the customer nothing');

-- R-3: one audit row per side, however many reads.
SELECT pg_temp.contacts(1, 'c1');
SELECT pg_temp.contacts(1, 'a1');
SELECT results_eq(
  $$ SELECT new_value ->> 'side', count(*)::int FROM public.audit_log
      WHERE action = 'contacts.viewed' AND entity_id = pg_temp.r(1)::text GROUP BY 1 ORDER BY 1 $$,
  $$ VALUES ('customer'::text, 1), ('provider'::text, 1) $$,
  'AC-7, R-3: the first read of each side writes one audit row, later reads none');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'audit_log'
                   AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%contacts.viewed%'),
  'R-3: a unique partial index backs the one row per side');

-- R-4, A-5: a suspended provider loses the customer's contacts; the customer keeps the provider's.
SELECT is(pg_temp.probe(ARRAY[pg_temp.suspend('a1')], format('pg_temp.contacts(%s, %L)', 1, 'a1')), 'not_found',
  'R-4: a provider suspended after the reveal gets nothing');
SELECT is(pg_temp.probe(ARRAY[pg_temp.suspend('a1')], format('pg_temp.street(%s, %L)', 1, 'a1')), 'none',
  'R-4: nor the street line');
SELECT is(pg_temp.probe(ARRAY[pg_temp.suspend('a1')], format('(pg_temp.contacts(%s, %L))::jsonb ->> %L', 1, 'c1', 'name')), 'Ayşe Usta',
  'R-4: the customer still sees the provider');

-- The window: closed less than contact_visible_days ago shows; longer ago hides.
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET status = 'COMPLETED', closed_by = 'customer', closed_at = now() - interval '13 days' WHERE id = %L$q$, pg_temp.r(1))],
                        format('(pg_temp.contacts(%s, %L))::jsonb ->> %L', 1, 'c1', 'side')), 'customer',
  'AC-5: 13 days after the close the contacts still show');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET status = 'COMPLETED', closed_by = 'customer', closed_at = now() - interval '15 days' WHERE id = %L$q$, pg_temp.r(1))],
                        format('pg_temp.contacts(%s, %L)', 1, 'a1')), 'not_found',
  'AC-5: 15 days after the close they are gone');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET status = 'COMPLETED', closed_by = 'customer', closed_at = now() - interval '15 days' WHERE id = %L$q$, pg_temp.r(1))],
                        format('pg_temp.street(%s, %L)', 1, 'a1')), 'none',
  'AC-6: and so is the street line');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET status = 'CANCELLED', cancelled_at = now() - interval '20 days', cancelled_by = 'admin', closed_by = 'customer', closed_at = now() - interval '20 days' WHERE id = %L$q$, pg_temp.r(1))],
                        format('pg_temp.contacts(%s, %L)', 1, 'c1')), 'not_found',
  'R-14: a cancelled request closed long ago gives nothing');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET status = 'COMPLETED', closed_by = 'customer', closed_at = now() - interval '1 day' WHERE id = %L$q$, pg_temp.r(1)),
                              'ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'contact_visible_days'$$],
                        format('pg_temp.contacts(%s, %L)', 1, 'c1')), 'contact_settings_invalid',
  'AC-1: a closed request with the setting missing refuses');
SELECT is(pg_temp.contacts(1, 'c2'), 'not_found', 'R-14: the stranger again, after all of that');
SELECT is(pg_temp.call_as('c2', format('SELECT count(*)::text FROM public.request_addresses WHERE customer_id = %L', pg_temp.u('c1'))), '0',
  'R-14: a customer reads no other customer''s address rows');

-- ══ R-9: a second payment after the reveal is refunded ═══════════════════════
CREATE TEMP TABLE second1 AS SELECT public.apply_fee_paid(pg_temp.pfee(1), pg_temp.att(1), 'pay-23-p1b', 5000, 'TRY', 150) AS j;
SELECT is((SELECT j ->> 'status' FROM second1), 'late', 'R-9: a second payment for a paid fee is late');
SELECT is((SELECT count(*)::int FROM public.fee_refunds WHERE psp_payment_id = 'pay-23-p1b' AND kind = 'late'), 1,
  'R-9: and refunded once');
SELECT is(pg_temp.pay(1), 'already_paid', 'AC-2 step 3: a revealed application is already paid');

-- ══ AC-2 step 5, R-8: a provider fee of 0 ════════════════════════════════════
SELECT is((SELECT provider_fee_amount FROM public.applications WHERE id = pg_temp.app(2)), 0::bigint, 'R2 holds a frozen fee of 0');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'payments_enabled'$$],
                        format('(pg_temp.pay(%s))::jsonb ->> %L', 2, 'status')), 'settled',
  'AC-2 step 5: a fee of 0 settles even with payments off');
SELECT is(pg_temp.pay(2), '{"status": "settled"}', 'AC-2 step 5: settled');
SELECT results_eq(
  $$ SELECT r.status, a.status, a.unlocked_at IS NOT NULL,
            (SELECT count(*)::int FROM public.fee_payments f WHERE f.request_id = r.id AND f.kind = 'provider_fee')
       FROM public.requests r JOIN public.applications a ON a.id = r.selected_application_id WHERE r.id = pg_temp.r(2) $$,
  $$ VALUES ('UNLOCKED'::text, 'UNLOCKED'::text, true, 0) $$,
  'AC-4: a fee of 0 reveals with no fee row');
SELECT is((pg_temp.contacts(2, 'a1'))::jsonb ->> 'street', 'Moda Cad. No 5', 'AC-5: and the provider reads the street line');
SELECT is(pg_temp.probe(ARRAY[format($q$INSERT INTO public.fee_refunds (region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency, reason)
                                       SELECT 'TR', %L, 'fee', f.id, 'pay-23-c8', f.amount, 'TRY', 'test' FROM public.fee_payments f
                                        WHERE f.request_id = %L AND f.kind = 'commission'$q$, pg_temp.r(8), pg_temp.r(8))],
                        'pg_temp.pay(8)'), 'invalid_state',
  'R-8: a fee of 0 does not reveal when the commission was refunded');

-- ══ R-15: the start overrun ══════════════════════════════════════════════════
SELECT ok((SELECT fee_deadline > scheduled_start_at FROM public.requests WHERE id = pg_temp.r(9)),
  'R-15: within the floor the fee window passes the start');
CREATE TEMP TABLE pay9 AS SELECT pg_temp.pay(9)::jsonb AS j;
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard',
                              format($q$UPDATE public.requests SET selected_at = now() - interval '3 hours', payment_deadline = now() - interval '2 hours', scheduled_start_at = now() - interval '1 minute', scheduled_end_at = now() + interval '1 hour' WHERE id = %L$q$, pg_temp.r(9))],
                        format('public.accept_provider_fee(%L, %L)', pg_temp.pfee(9), pg_temp.att(9))), 'false',
  'R-15: a payment in the overrun, after the start, is not accepted (07 refunds it)');

SELECT ok((pg_temp.call_as('a1', format('SELECT public.my_checkout(%L)::text', pg_temp.att(9)))::jsonb ->> 'deadline')::timestamptz
             = (SELECT scheduled_start_at FROM public.requests WHERE id = pg_temp.r(9)),
  'S10-1: my_checkout gives the provider the window capped at the start');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.requests DISABLE TRIGGER requests_guard', format($q$UPDATE public.requests SET selected_at = now() - interval '3 hours', payment_deadline = now() - interval '2 hours', scheduled_start_at = now() - interval '1 minute', scheduled_end_at = now() + interval '1 hour' WHERE id = %L$q$, pg_temp.r(5))],
                        'pg_temp.pay(5)'), 'deadline_passed',
  'S10-1: after the start no provider fee checkout opens, even inside the overrun');

-- ══ R-5, R-6: the guards ═════════════════════════════════════════════════════
SELECT is(pg_temp.err(format($q$UPDATE public.applications SET unlocked_at = now() WHERE id = %L$q$, pg_temp.app(6))),
  'application_immutable', 'R-5: unlocked_at cannot be set outside the AWAITING_FEE to UNLOCKED move');
SELECT is(pg_temp.err(format($q$UPDATE public.applications SET status = 'UNLOCKED', status_changed_at = now() WHERE id = %L$q$, pg_temp.app(6))),
  'application_immutable', 'R-5: nor UNLOCKED without unlocked_at');
SELECT is(pg_temp.err(format($q$UPDATE public.applications SET unlocked_at = now() - interval '1 day' WHERE id = %L$q$, pg_temp.app(1))),
  'application_immutable', 'R-5: unlocked_at never changes once set');
SELECT is(pg_temp.err(format($q$UPDATE public.applications SET unlocked_at = NULL WHERE id = %L$q$, pg_temp.app(1))),
  'application_immutable', 'R-5: nor is it cleared');
SELECT is(pg_temp.err(format($q$UPDATE public.requests SET status = 'UNLOCKED' WHERE id = %L$q$, pg_temp.r(6))),
  'request_unlock_invalid', 'R-6: a request cannot become UNLOCKED while its pick has no unlocked_at');
SELECT is(pg_temp.err(format($q$UPDATE public.requests SET closed_at = now() WHERE id = %L$q$, pg_temp.r(6))),
  'request_immutable', 'R-6: closed_at is set only with a terminal move');
SELECT is_empty(
  $$ SELECT r.rolname || ' ' || t.tbl FROM (VALUES ('applications'), ('requests')) t(tbl)
       CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
      WHERE has_table_privilege(r.rolname, 'public.' || t.tbl, 'UPDATE') $$,
  'R-5: no API role may update applications or requests');

-- ══ R-11: the jobs read ══════════════════════════════════════════════════════
CREATE FUNCTION pg_temp.jobs(p_user text, p_tab text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.provider_jobs(%L, NULL, NULL)::text', p_tab))::jsonb $$;
SELECT ok((SELECT bool_or((x ->> 'application_id')::uuid = pg_temp.app(1)) FROM jsonb_array_elements(pg_temp.jobs('a1', 'active') -> 'rows') x),
  'R-11: the unlocked job is in Active');
SELECT ok((SELECT bool_or((x ->> 'application_id')::uuid = pg_temp.app(5)) FROM jsonb_array_elements(pg_temp.jobs('a1', 'chosen') -> 'rows') x),
  'R-11: an AWAITING_FEE job is in Chosen');
SELECT ok((SELECT bool_or((x ->> 'application_id')::uuid = pg_temp.app(3)) FROM jsonb_array_elements(pg_temp.jobs('a1', 'applied') -> 'rows') x),
  'R-11: a SELECTED job (commission unpaid) is in Applied');
SELECT ok((SELECT bool_or((x ->> 'application_id')::uuid = pg_temp.app2(1)) FROM jsonb_array_elements(pg_temp.jobs('a2', 'done') -> 'rows') x),
  'R-11: a NOT_SELECTED application is in Done');
SELECT ok((SELECT bool_and((x ->> 'fee_deadline')::timestamptz IS NOT NULL AND (x ->> 'provider_fee_amount')::bigint = 5000)
             FROM jsonb_array_elements(pg_temp.jobs('a1', 'chosen') -> 'rows') x WHERE (x ->> 'application_id')::uuid = pg_temp.app(5)),
  'R-11, R-15: Chosen carries the fee and its deadline');
SELECT is_empty(
  $$ SELECT k FROM jsonb_array_elements(pg_temp.jobs('a1', 'active') -> 'rows') x, jsonb_object_keys(x) k
      WHERE k IN ('phone', 'email', 'street', 'line', 'notes', 'full_name') $$,
  'R-11: the jobs read carries no contact field');
SELECT is(pg_temp.call_as('a1', $$SELECT public.provider_jobs('later', NULL, NULL)::text$$), 'validation_failed',
  'R-11: an unknown tab is refused');
SELECT is(pg_temp.call_as('c1', $$SELECT public.provider_jobs('active', NULL, NULL)::text$$), 'forbidden',
  'R-11: a customer cannot read jobs');

-- ══ Grants ═══════════════════════════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default", p.prosecdef,
            has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            has_function_privilege('service_role', p.oid, 'EXECUTE'),
            has_function_privilege('anon', p.oid, 'EXECUTE')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('accept_provider_fee', 'after_provider_fee_paid', 'contact_settings', 'contacts_visible',
                          'pay_provider_fee', 'provider_fee_settled', 'provider_jobs', 'request_contacts')
      ORDER BY p.proname $$,
  $$ VALUES ('accept_provider_fee', false, false, false, false), ('after_provider_fee_paid', false, false, false, false),
            ('contact_settings', false, false, false, false), ('contacts_visible', true, true, false, false),
            ('pay_provider_fee', true, true, false, false), ('provider_fee_settled', false, false, false, false),
            ('provider_jobs', true, true, false, false), ('request_contacts', true, true, false, false) $$,
  'AC-2, AC-5, R-2, R-11: definers only where a user calls; internal functions have no grant');
SELECT is((SELECT provolatile::text FROM pg_proc WHERE proname = 'request_contacts'), 'v', 'R-3: request_contacts is volatile');
SELECT is(pg_temp.call_as('anon', format('SELECT public.pay_provider_fee(%L, %L, NULL)::text', pg_temp.app(5), 'tr')), '42501',
  'R-14: anon cannot call pay_provider_fee');
SELECT is(pg_temp.call_as('anon', $$SELECT public.provider_jobs('active', NULL, NULL)::text$$), '42501',
  'R-14: nor provider_jobs');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'request_addresses'
             AND policyname = 'request_addresses_read_unlocked' AND cmd = 'SELECT'), 1,
  'AC-6: the unlocked provider''s address policy exists');

SELECT * FROM finish();
ROLLBACK;
