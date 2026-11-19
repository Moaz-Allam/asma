-- Position 14, spec 0011-14 (D193): report a problem.
--
-- The settings and their reader (R-2, R-4, X-8); the three tables with RLS on, a deny policy and no grant (R-15);
-- who may report and when (R-1, R-2), the text rules (R-3), one open and two in total (X-16), the daily limit (R-4);
-- the bucket, its policies, its guard trigger, the photo cap and the admin view gate (AC-2, X-3 to X-6); my_report and
-- request_close_info (AC-3, AC-7); the paused auto close and reminder (R-6, R-7, X-7); every handle outcome and refusal
-- (AC-5, R-9 to R-12, X-1, X-2, X-14, X-17 to X-20); the guard moves of the return to work and the deadline reset (R-5,
-- X-13); warnings (AC-6); the mail rows (R-8, X-10, X-11, X-15); the queue and the detail (AC-4, X-21, X-22); grants.
--
-- A condition that needs a row changed and put back runs inside pg_temp.probe, which rolls its own changes back.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(143);

SET CONSTRAINTS ALL IMMEDIATE;

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003000' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003070' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.app(p integer, w text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-00000030' || CASE w WHEN 'a1' THEN '81' WHEN 'a2' THEN '82' ELSE '84' END
          || lpad(p::text, 2, '0'))::uuid $$;
-- A photo object name under report x: TR/<x>/<n as a uuid>.jpg.
CREATE FUNCTION pg_temp.ph(x uuid, n integer, p_region text DEFAULT 'TR', p_ext text DEFAULT 'jpg') RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT p_region || '/' || x || '/10000000-0000-4000-8000-0000000030' || lpad(n::text, 2, '0') || '.' || p_ext $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1 the customer, c2 a stranger, a1 the chosen provider, a2 another applicant, b1 the provider suspended below,
-- ad the admin. c1, a1 and ad have confirmed addresses.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559300001'), ('c2', '905559300002'), ('a1', '905559300003'), ('a2', '905559300004'),
               ('b1', '905559300005'), ('ad', '905559300006')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale, email, email_confirmed_at)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'en', e, CASE WHEN e IS NOT NULL THEN now() END
  FROM (VALUES ('c1', 'customer', '905559300001', 'Şikayet Müşteri', 'c1-30@example.com'),
               ('c2', 'customer', '905559300002', 'Yabancı', NULL),
               ('a1', 'provider', '905559300003', 'Bir Usta', 'a1-30@example.com'),
               ('a2', 'provider', '905559300004', 'İki Usta', NULL),
               ('b1', 'provider', '905559300005', 'Askı Usta', NULL),
               ('ad', 'admin', '905559300006', 'Yönetici', 'ad-30@example.com')) AS t(c, r, p, n, e);
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Usta'
 WHERE id IN (pg_temp.u('a1'), pg_temp.u('a2'), pg_temp.u('b1'));
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Şikayet"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Temizlik", "en": "Cleaning"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Moda"}', 1.00, true);
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key IN ('payments_enabled', 'emails_enabled');
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'auto_close_enabled';
UPDATE public.platform_settings SET value = '5' WHERE region = 'TR' AND key = 'reports_per_user_day';

CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text, true) $$;
-- A request of c1 starting in 3 days with an offer of provider w (and of a2 when w is a1), the commission given.
CREATE FUNCTION pg_temp.base(p integer, w text, p_commission bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100, "service": {"name": {"tr": "Temizlik", "en": "Cleaning"}}}', 100000, p_commission,
    100000 - p_commission, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours');
  INSERT INTO public.request_addresses (request_id, region, customer_id, line) VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), 'Moda Cad. No 9');
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  VALUES (pg_temp.app(p, w), 'TR', pg_temp.r(p), pg_temp.u(w), 'An offer for the report tests, long enough to pass.');
  IF w = 'a1' THEN
    INSERT INTO public.applications (id, region, request_id, provider_id, message)
    VALUES (pg_temp.app(p, 'a2'), 'TR', pg_temp.r(p), pg_temp.u('a2'), 'Another offer for the report tests, long enough.');
  END IF;
END $$;
-- Paid fees on both sides (07's figures, as 27 and 29): UNLOCKED through two verified payments.
CREATE FUNCTION pg_temp.reqpaid(p integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_att uuid;
BEGIN
  PERFORM pg_temp.base(p, 'a1', 10000);
  PERFORM pg_temp.as_user('c1');
  PERFORM public.choose_provider(pg_temp.r(p), pg_temp.app(p, 'a1'));
  v_att := (public.pay_commission(pg_temp.r(p), 'tr', NULL) ->> 'attempt_id')::uuid;
  PERFORM public.apply_fee_paid((SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'commission'),
                                v_att, 'pay-30-c' || p, 10000, 'TRY', 300);
  PERFORM pg_temp.as_user('a1');
  v_att := (public.pay_provider_fee(pg_temp.app(p, 'a1'), 'tr', NULL) ->> 'attempt_id')::uuid;
  PERFORM public.apply_fee_paid((SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'provider_fee'),
                                v_att, 'pay-30-p' || p, 5000, 'TRY', 150);
  RETURN pg_temp.r(p);
END $$;
-- Both fees 0 (D171): UNLOCKED with no card page.
CREATE FUNCTION pg_temp.req(p integer, w text DEFAULT 'a1') RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.base(p, w, 0);
  PERFORM pg_temp.as_user('c1');
  PERFORM public.choose_provider(pg_temp.r(p), pg_temp.app(p, w));
  PERFORM public.pay_commission(pg_temp.r(p), 'tr', NULL);
  PERFORM pg_temp.as_user(w);
  PERFORM public.pay_provider_fee(pg_temp.app(p, w), 'tr', NULL);
  RETURN pg_temp.r(p);
END $$;
-- The start day, then Started and Done by provider w: AWAITING_CONFIRMATION.
CREATE FUNCTION pg_temp.done(p integer, w text DEFAULT 'a1') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests SET selected_at = now() - interval '5 hours', payment_deadline = now() - interval '4 hours',
         fee_deadline = now() - interval '3 hours', scheduled_start_at = now() - interval '1 hour',
         scheduled_end_at = now() + interval '1 hour'
   WHERE id = pg_temp.r(p);
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
  PERFORM pg_temp.as_user(w);
  PERFORM public.start_job(pg_temp.r(p));
  PERFORM public.finish_job(pg_temp.r(p));
END $$;
-- Set a request's columns past the guard (the clock, or a close long ago).
CREATE FUNCTION pg_temp.force(p integer, p_set text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  EXECUTE format('UPDATE public.requests SET %s WHERE id = %L', p_set, pg_temp.r(p));
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
END $$;
CREATE FUNCTION pg_temp.call_as(p_user text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     CASE WHEN p_user = 'anon' THEN '{"role": "anon"}'
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
-- A service role session that still carries c1's claims: the storage guard must refuse it anyway.
CREATE FUNCTION pg_temp.as_service(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u('c1'), 'role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  BEGIN
    EXECUTE p_sql INTO v;
    v := coalesce(v, 'none');
  EXCEPTION
    WHEN raise_exception THEN v := sqlerrm;
    WHEN others THEN v := sqlstate;
  END;
  RESET ROLE;
  RETURN v;
END $$;
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
-- open_report as a user: the status, or the refusal.
CREATE FUNCTION pg_temp.report(p_user text, p integer, p_reason text DEFAULT 'poor_work',
                               p_text text DEFAULT 'The work was left half done and the room is a mess.') RETURNS text
  LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.open_report(%L, %L, %L) ->> ''status''', pg_temp.r(p), p_reason, p_text)) $$;
-- The latest report by a user on a request.
CREATE FUNCTION pg_temp.rep(p integer, p_user text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.problem_reports WHERE request_id = pg_temp.r(p) AND reporter_id = pg_temp.u(p_user)
   -- Two reports of one transaction share now(): the open one first, so a handle always finds it.
   ORDER BY (status = 'open') DESC, created_at DESC, id DESC LIMIT 1 $$;
-- handle_report as a user: the outcome, or the refusal.
CREATE FUNCTION pg_temp.handle(p_user text, x uuid, p_outcome text, p_note text DEFAULT 'Checked both sides of it.',
                               p_refund uuid DEFAULT NULL, p_warn text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format('SELECT public.handle_report(%L, %L, %L, %L, %L) ->> ''outcome''',
                                        x, p_outcome, p_note, p_refund, p_warn)) $$;
-- An upload as a user, as the Storage API writes it: the new object id, or the refusal.
CREATE FUNCTION pg_temp.upload(p_user text, p_name text, p_mime text DEFAULT 'image/jpeg') RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format(
    $q$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('report-photos', %L, %L) RETURNING id::text$q$,
    p_name, jsonb_build_object('mimetype', p_mime, 'size', 2048))) $$;
-- How many report photo objects under report x a user can see.
CREATE FUNCTION pg_temp.seen(p_user text, x uuid) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_user, format(
    $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'report-photos' AND name LIKE %L$q$, 'TR/' || x || '/%')) $$;
CREATE FUNCTION pg_temp.audit(p_action text, p_entity text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT new_value FROM public.audit_log WHERE action = p_action AND entity_id = p_entity ORDER BY id DESC LIMIT 1 $$;
-- The mail rows of a report: template>recipient tag, sorted.
CREATE FUNCTION pg_temp.mails(x uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg((payload ->> 'template') || '>' || CASE (payload ->> 'recipient_id')::uuid
           WHEN pg_temp.u('c1') THEN 'c1' WHEN pg_temp.u('a1') THEN 'a1' WHEN pg_temp.u('ad') THEN 'ad' ELSE 'other' END,
           ',' ORDER BY payload ->> 'template', payload ->> 'recipient_id'), '')
    FROM public.outbox_events WHERE kind = 'email.send' AND payload ->> 'entity_id' = x::text $$;

-- r6 and r10 pay real fees, so they are made before the fee settings go to 0.
SELECT pg_temp.reqpaid(6);
SELECT pg_temp.reqpaid(10);
UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key IN ('provider_fee_value', 'fee_min_minor');
SELECT pg_temp.req(g) FROM unnest(ARRAY[1, 2, 3, 4, 8, 9]) g;
SELECT pg_temp.req(7, 'b1');
SELECT pg_temp.base(5, 'a1', 0);
SELECT pg_temp.done(g) FROM unnest(ARRAY[2, 3, 4, 8, 9]) g;
-- r4: confirmed by the customer, then its close moved back past the window (14 days).
SELECT pg_temp.as_user('c1');
SELECT public.confirm_job(pg_temp.r(4));
SELECT pg_temp.force(4, $$closed_at = now() - interval '15 days'$$);

-- ══ R-2, R-4, X-8: settings ══════════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT region, key, value FROM public.platform_settings WHERE key IN ('report_window_days', 'reports_per_user_day')
      AND region = 'KSA' ORDER BY key $$,
  $$ VALUES ('KSA'::text, 'report_window_days'::text, '14'::jsonb), ('KSA', 'reports_per_user_day', '5') $$,
  'X-8: both settings seeded, 14 days and 5 a day');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '91' WHERE region = 'TR' AND key = 'report_window_days'$$),
  '23514', 'X-8: the window is 1 to 90 days');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '2.5' WHERE region = 'TR' AND key = 'reports_per_user_day'$$),
  '23514', 'X-8: the daily limit is a whole number');
SELECT is(pg_temp.err($$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'reports_per_user_day'$$),
  'pricing_setting_required', 'X-8: the guard keeps both settings');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'report_window_days'$$],
                        $$public.report_settings('TR')$$),
  'report_settings_invalid', 'R-2: a missing setting makes the reader refuse');
SELECT is(public.report_settings('TR'), '{"report_window_days": 14, "reports_per_user_day": 5}'::jsonb, 'R-2: the reader');

-- ══ R-15: tables ═════════════════════════════════════════════════════════════
SELECT ok((SELECT bool_and(c.relrowsecurity) FROM pg_class c
            WHERE c.oid IN ('public.problem_reports'::regclass, 'public.report_photos'::regclass, 'public.user_warnings'::regclass)),
  'R-15: RLS is on for the three tables');
SELECT is_empty(
  $$ SELECT table_name, grantee FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name IN ('problem_reports', 'report_photos', 'user_warnings')
        AND grantee IN ('anon', 'authenticated', 'service_role') $$,
  'R-15: no API role has a table grant');
SELECT is(pg_temp.call_as('c1', 'SELECT count(*)::text FROM public.problem_reports'), '42501', 'R-15: a direct read is refused');
SELECT is(pg_temp.call_as('ad', 'SELECT count(*)::text FROM public.user_warnings'), '42501', 'R-15: for an admin too');

-- ══ AC-1, R-1 to R-4, X-16: open_report ═════════════════════════════════════
SELECT is(pg_temp.report('c2', 1), 'not_allowed', 'R-1: a stranger cannot report');
SELECT is(pg_temp.report('a2', 1), 'not_allowed', 'R-1: nor a provider who applied and was not chosen');
SELECT is(pg_temp.report('ad', 1), 'not_allowed', 'R-1: nor admin');
SELECT is(pg_temp.report('c1', 5), 'not_allowed', 'R-2: nor anyone before the reveal');
SELECT is(pg_temp.report('c1', 4), 'not_allowed', 'R-2: nor after the window');
SELECT is(pg_temp.probe(ARRAY[format($q$SELECT pg_temp.force(4, 'closed_at = now() - interval ''13 days''')$q$)],
                        format($q$pg_temp.report('c1', 4)$q$)),
  'ok', 'R-2: inside the window after the close');
SELECT is(pg_temp.report('anon', 1), '42501', 'AC-1: anon has no grant');
SELECT is(pg_temp.report('c1', 1, 'rude'), 'validation_failed', 'AC-1: an unknown reason');
SELECT is(pg_temp.report('c1', 1, 'other', '   too short here   '), 'validation_failed', 'R-3: under 20 characters after the trim');
SELECT is(pg_temp.report('c1', 1, 'other', repeat('ş', 2001)), 'validation_failed', 'R-3: the byte cap comes first');
SELECT is(pg_temp.report('c1', 1, 'other', repeat('x', 1001)), 'validation_failed', 'R-3: at most 1000 characters');
SELECT is(pg_temp.report('c1', 1, 'asked_money_off_platform', '  He asked me to send TR12 0006 4000 0011 2345 6789 01.  '), 'ok',
  'R-3: no contact scanner; an IBAN is evidence');
SELECT is((SELECT text FROM public.problem_reports WHERE id = pg_temp.rep(1, 'c1')),
  'He asked me to send TR12 0006 4000 0011 2345 6789 01.', 'R-3: stored trimmed');
SELECT is((SELECT side || ' ' || (against_id = pg_temp.u('a1'))::text || ' ' || status FROM public.problem_reports WHERE id = pg_temp.rep(1, 'c1')),
  'customer true open', 'R-1: the customer reports the chosen provider');
SELECT is(pg_temp.audit('report.opened', pg_temp.rep(1, 'c1')::text),
  jsonb_build_object('request_id', pg_temp.r(1), 'reason', 'asked_money_off_platform', 'side', 'customer'),
  'AC-1: one audit row, ids and the reason only');
SELECT is(pg_temp.report('c1', 1), 'report_open', 'AC-1: one open report per person and request');
SELECT is(pg_temp.report('a1', 1, 'did_not_pay_cash', 'The customer did not pay the cash after the job.'), 'ok',
  'R-1: the provider reports the customer');
SELECT is((SELECT against_id FROM public.problem_reports WHERE id = pg_temp.rep(1, 'a1')), pg_temp.u('c1'), 'R-1: against the customer');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.platform_settings SET value = '2' WHERE region = 'TR' AND key = 'reports_per_user_day'$$],
                        format($q$pg_temp.report('c1', 8)$q$)),
  'ok', 'R-4: under the daily limit');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.platform_settings SET value = '1' WHERE region = 'TR' AND key = 'reports_per_user_day'$$],
                        format($q$pg_temp.report('c1', 8)$q$)),
  'too_many_reports', 'R-4: the daily limit counts the reporter''s rows');
-- The rest of this file files more reports than one day allows.
UPDATE public.platform_settings SET value = '50' WHERE region = 'TR' AND key = 'reports_per_user_day';

-- ══ R-8, X-10, X-11: the mail of a new report ═══════════════════════════════
SELECT is(pg_temp.mails(pg_temp.rep(1, 'c1')), 'report_new_admin>ad,report_received>c1',
  'R-8: the reporter and the region''s admin; nothing to the reported party');
SELECT is(pg_temp.mails(pg_temp.rep(1, 'a1')), 'report_new_admin>ad,report_received>a1', 'X-20: the provider''s report mails the provider and admin, never the customer');
SELECT is((SELECT public.email_context(id) -> 'values' FROM public.outbox_events
            WHERE kind = 'email.send' AND payload ->> 'template' = 'report_new_admin' AND payload ->> 'entity_id' = pg_temp.rep(1, 'c1')::text)
          - array['service', 'start_at'],
  jsonb_build_object('side', null, 'request_id', pg_temp.r(1), 'deadline', null, 'amount', null, 'currency', 'TRY', 'fee_id', null,
                     'carried', null, 'token', null, 'report_id', pg_temp.rep(1, 'c1'), 'reason', 'asked_money_off_platform'),
  'X-10: the admin mail carries the report id and the reason code, no side');
SELECT is((SELECT public.email_context(id) ->> 'status' FROM public.outbox_events
            WHERE kind = 'email.send' AND payload ->> 'template' = 'report_received' AND payload ->> 'entity_id' = pg_temp.rep(1, 'c1')::text),
  'send', 'R-8: the reporter''s mail sends');

-- ══ AC-2, X-3 to X-6: photos ════════════════════════════════════════════════
SELECT ok(pg_temp.upload('c1', pg_temp.ph(pg_temp.rep(1, 'c1'), 1)) ~ '^[0-9a-f-]{36}$', 'AC-2: the reporter uploads into the report''s folder');
SELECT is(pg_temp.upload('a1', pg_temp.ph(pg_temp.rep(1, 'c1'), 2)), '42501', 'AC-2: the other side cannot');
SELECT is(pg_temp.upload('c2', pg_temp.ph(pg_temp.rep(1, 'c1'), 2)), '42501', 'AC-2: nor a stranger');
SELECT is(pg_temp.upload('c1', pg_temp.ph(pg_temp.rep(1, 'c1'), 2, 'KSA')), '42501', 'X-5: the region segment is the report''s');
SELECT is(pg_temp.upload('c1', pg_temp.ph(pg_temp.rep(1, 'c1'), 2, 'TR', 'png')), '42501', 'X-5: a .jpg name only');
SELECT is(pg_temp.upload('c1', 'TR/' || pg_temp.rep(1, 'c1') || '/../x.jpg'), '42501', 'X-5: a climbing name');
SELECT is(pg_temp.as_service(format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('report-photos', %L) RETURNING id::text$q$,
                                    pg_temp.ph(pg_temp.rep(1, 'c1'), 3))),
  '42501', 'X-4: a service role write is refused by the trigger');
SELECT ok(pg_temp.upload('c1', pg_temp.ph(pg_temp.rep(1, 'c1'), 2)) ~ '^[0-9a-f-]{36}$'
          AND pg_temp.upload('c1', pg_temp.ph(pg_temp.rep(1, 'c1'), 3)) ~ '^[0-9a-f-]{36}$', 'AC-2: a second and a third photo');
SELECT is(pg_temp.upload('c1', pg_temp.ph(pg_temp.rep(1, 'c1'), 4)), '42501', 'AC-2: Storage refuses a fourth object (X-6: unregistered ones count)');
SELECT is(pg_temp.call_as('a1', format('SELECT public.add_report_photo(%L, %L) ->> ''status''', pg_temp.rep(1, 'c1'), pg_temp.ph(pg_temp.rep(1, 'c1'), 1))),
  'not_allowed', 'AC-2: only the reporter registers');
SELECT is(pg_temp.call_as('c1', format('SELECT public.add_report_photo(%L, %L) ->> ''replayed''', pg_temp.rep(1, 'c1'), pg_temp.ph(pg_temp.rep(1, 'c1'), 1))),
  'false', 'AC-2: the reporter registers a photo');
SELECT is(pg_temp.call_as('c1', format('SELECT public.add_report_photo(%L, %L) ->> ''replayed''', pg_temp.rep(1, 'c1'), pg_temp.ph(pg_temp.rep(1, 'c1'), 1))),
  'true', 'AC-2: a replay is ok');
SELECT is(pg_temp.call_as('c1', format('SELECT public.add_report_photo(%L, %L) ->> ''status''', pg_temp.rep(1, 'c1'), pg_temp.ph(pg_temp.rep(1, 'c1'), 9))),
  'file_invalid', 'AC-2: no object, no row');
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES ('report-photos', pg_temp.ph(pg_temp.rep(1, 'a1'), 1), '{"mimetype": "image/png", "size": 2048}');
SELECT is(pg_temp.call_as('a1', format('SELECT public.add_report_photo(%L, %L) ->> ''status''', pg_temp.rep(1, 'a1'), pg_temp.ph(pg_temp.rep(1, 'a1'), 1))),
  'file_invalid', 'X-5: the type Storage recorded must be JPEG');
SELECT is(pg_temp.call_as('c1', format('SELECT string_agg(public.add_report_photo(%L, n) ->> ''status'', '','') FROM unnest(ARRAY[%L, %L]) n',
                                       pg_temp.rep(1, 'c1'), pg_temp.ph(pg_temp.rep(1, 'c1'), 2), pg_temp.ph(pg_temp.rep(1, 'c1'), 3))),
  'ok,ok', 'AC-2: up to three rows');
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES ('report-photos', pg_temp.ph(pg_temp.rep(1, 'c1'), 5), '{"mimetype": "image/jpeg", "size": 2048}');
SELECT is(pg_temp.call_as('c1', format('SELECT public.add_report_photo(%L, %L) ->> ''status''', pg_temp.rep(1, 'c1'), pg_temp.ph(pg_temp.rep(1, 'c1'), 5))),
  'too_many_photos', 'AC-2: the function caps at three under the report lock');
SELECT is(pg_temp.seen('c1', pg_temp.rep(1, 'c1')), '4', 'AC-2: the reporter reads every object in their report''s folder');
SELECT is(pg_temp.seen('a1', pg_temp.rep(1, 'c1')), '0', 'AC-2: the other side reads none');
SELECT is(pg_temp.seen('c2', pg_temp.rep(1, 'c1')), '0', 'AC-2: a stranger reads none');
SELECT is(pg_temp.seen('ad', pg_temp.rep(1, 'c1')), '0', 'X-3: admin reads none before a recorded view');
SELECT is(pg_temp.call_as('c1', format('SELECT public.log_report_photo_view(%L) ->> ''path''',
                                       (SELECT id FROM public.report_photos WHERE object_path = pg_temp.ph(pg_temp.rep(1, 'c1'), 1))::text)),
  'forbidden', 'X-3: only admin logs a view');
SELECT is(pg_temp.call_as('ad', format('SELECT public.log_report_photo_view(%L) ->> ''path''',
                                       (SELECT id FROM public.report_photos WHERE object_path = pg_temp.ph(pg_temp.rep(1, 'c1'), 1))::text)),
  pg_temp.ph(pg_temp.rep(1, 'c1'), 1), 'AC-4: the view returns the path to sign');
SELECT is(pg_temp.seen('ad', pg_temp.rep(1, 'c1')), '1', 'X-3: then admin reads that one photo only');
SELECT is((SELECT (new_value ->> 'path') || ' ' || (new_value ->> 'report_id') FROM public.audit_log WHERE action = 'report.photo_viewed' ORDER BY id DESC LIMIT 1),
  pg_temp.ph(pg_temp.rep(1, 'c1'), 1) || ' ' || pg_temp.rep(1, 'c1'), 'X-3: one audit row per view');
SELECT is(pg_temp.as_service(format($q$UPDATE storage.objects SET metadata = '{}' WHERE bucket_id = 'report-photos' AND name = %L RETURNING id::text$q$,
                                    pg_temp.ph(pg_temp.rep(1, 'c1'), 1))),
  '42501', 'AC-2: no change to an object, even as service role');
SELECT is(pg_temp.as_service(format($q$DELETE FROM storage.objects WHERE bucket_id = 'report-photos' AND name = %L RETURNING id::text$q$,
                                    pg_temp.ph(pg_temp.rep(1, 'c1'), 1))),
  '42501', 'AC-2: and no delete');
SELECT results_eq(
  $$ SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'report-photos' $$,
  $$ VALUES ('report-photos'::text, false, 10485760::bigint, ARRAY['image/jpeg']) $$,
  'X-5: the bucket is private, 10 MB, JPEG only');
SELECT results_eq(
  $$ SELECT polname::text COLLATE "default", polcmd::text FROM pg_policy
      WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'report_photos%' ORDER BY polname $$,
  $$ VALUES ('report_photos_insert', 'a'), ('report_photos_read', 'r') $$,
  'AC-2: an insert and a read policy, no update or delete');
SELECT results_eq(
  $$ SELECT DISTINCT event_manipulation::text COLLATE "default" FROM information_schema.triggers
      WHERE event_object_schema = 'storage' AND event_object_table = 'objects'
        AND action_statement LIKE '%report_photos_storage_guard%' ORDER BY 1 $$,
  $$ VALUES ('DELETE'), ('INSERT'), ('UPDATE') $$,
  'X-4: the guard fires on insert, update and delete');

-- ══ AC-3, AC-7: my_report and the close info ════════════════════════════════
SELECT is(pg_temp.call_as('c1', format('SELECT (public.my_report(%L) ->> ''can_report'') || '' '' || (public.my_report(%L) -> ''report'' ->> ''status'')', pg_temp.r(1), pg_temp.r(1))),
  'false open', 'AC-7: the caller''s open report, and no second one');
SELECT is(pg_temp.call_as('c2', format('SELECT public.my_report(%L)::text', pg_temp.r(1))), 'not_found', 'AC-7: not for a stranger');
SELECT is(pg_temp.call_as('a1', format('SELECT public.my_report(%L) -> ''report'' ->> ''reason''', pg_temp.r(1))), 'did_not_pay_cash',
  'AC-7: each side sees only their own report');
SELECT is(pg_temp.call_as('c1', format($q$SELECT ((public.my_report(%L) -> 'report') ?| ARRAY['outcome', 'admin_note', 'text'])::text$q$, pg_temp.r(1))),
  'false', 'AC-7: never the outcome, the note or the text');
SELECT is(pg_temp.call_as('c1', format('SELECT public.my_report(%L) ->> ''can_report''', pg_temp.r(5))), 'not_found', 'AC-7: nothing before the reveal');
SELECT is(pg_temp.call_as('c1', format('SELECT public.request_close_info(%L) ->> ''my_report_open''', pg_temp.r(2))), 'false',
  'AC-3: no report, no wait');
SELECT is(pg_temp.report('c1', 2, 'poor_work', 'Not done: the kitchen tiles are still missing.'), 'ok', 'AC-3: Not done, report a problem');
SELECT is(pg_temp.call_as('c1', format('SELECT public.request_close_info(%L) ->> ''my_report_open''', pg_temp.r(2))), 'true',
  'AC-3: the close waits for admin');

-- ══ R-6, R-7, X-7: the paused close and reminder ════════════════════════════
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'auto_close_enabled';
SELECT pg_temp.force(g, $$actual_completed_at = now() - interval '4 days', confirm_deadline = now() - interval '1 hour'$$) FROM unnest(ARRAY[2, 8]) g;
SELECT is(public.auto_close_jobs(), 1, 'R-6: the auto close takes the job with no open report');
SELECT is((SELECT string_agg(status, ' ' ORDER BY id) FROM public.requests WHERE id IN (pg_temp.r(2), pg_temp.r(8))),
  'AWAITING_CONFIRMATION COMPLETED', 'R-6: and skips the one with an open report');
SELECT pg_temp.force(g, $$confirm_deadline = now() + interval '2 hours'$$) FROM unnest(ARRAY[2, 9]) g;
SELECT ok(public.queue_reminders() >= 1, 'X-7: the reminders run');
SELECT is((SELECT count(*)::int FROM public.outbox_events WHERE idempotency_key LIKE 'email:' || pg_temp.r(2) || ':closes_soon%'), 0,
  'X-7: nothing queued while a report is open');
SELECT is((SELECT count(*)::int FROM public.outbox_events
            WHERE idempotency_key = 'email:' || pg_temp.r(9) || ':closes_soon:' || floor(extract(epoch from now() + interval '2 hours'))::bigint), 1,
  'X-7: the key carries the deadline');
SELECT public.queue_email('email:' || pg_temp.r(2) || ':closes_soon:test', 'closes_soon', pg_temp.u('c1'), pg_temp.r(2),
                          pg_temp.app(2, 'a1'), now() + interval '1 hour', 'TR');
SELECT is((SELECT public.email_context(id) ->> 'reason' FROM public.outbox_events WHERE idempotency_key = 'email:' || pg_temp.r(2) || ':closes_soon:test'),
  'condition', 'R-7: a closes_soon row already queued skips at send time');
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'auto_close_enabled';

-- ══ AC-5: handle_report refusals ════════════════════════════════════════════
SELECT is(pg_temp.handle('c1', pg_temp.rep(1, 'c1'), 'no_action'), 'forbidden', 'AC-5: admin only');
SELECT is(pg_temp.handle('ad', pg_temp.rep(1, 'c1'), 'ban'), 'invalid_outcome', 'AC-5: an unknown outcome');
SELECT is(pg_temp.handle('ad', pg_temp.rep(1, 'c1'), 'no_action', '   short   '), 'validation_failed', 'R-12: the note is 10 to 500 after the trim');
SELECT is(pg_temp.handle('ad', pg_temp.rep(1, 'c1'), 'warned', 'Checked both sides of it.', NULL, 'rude'), 'validation_failed',
  'X-19: a warning reason is one of the six');
SELECT is(pg_temp.handle('ad', gen_random_uuid(), 'no_action'), 'not_found', 'AC-5: an unknown report');
SELECT is(pg_temp.handle('ad', pg_temp.rep(1, 'c1'), 'returned_to_work'), 'invalid_state', 'AC-5: a return to work needs AWAITING_CONFIRMATION');
SELECT is(pg_temp.handle('ad', pg_temp.rep(1, 'c1'), 'job_closed'), 'invalid_state', 'AC-5: so does a close');
SELECT is(pg_temp.handle('ad', pg_temp.rep(1, 'a1'), 'suspended'), 'invalid_outcome', 'R-10: no customer suspension');
SELECT is(pg_temp.handle('ad', pg_temp.rep(1, 'c1'), 'no_action', 'Checked both sides of it.', (SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(10) AND kind = 'commission')), 'invalid_refund',
  'R-11: a refund of another request''s fee');

-- ══ AC-5, AC-6, R-9: a warning ══════════════════════════════════════════════
SELECT is(pg_temp.handle('ad', pg_temp.rep(1, 'c1'), 'warned', 'He asked for an IBAN transfer twice.'), 'warned', 'AC-5: warned');
SELECT is((SELECT reason || ' ' || (report_id = pg_temp.rep(1, 'c1'))::text FROM public.user_warnings WHERE user_id = pg_temp.u('a1')),
  'asked_money_off_platform true', 'R-9: one warning for the reported party, the report''s reason');
SELECT is((SELECT status || ' ' || outcome || ' ' || admin_note || ' ' || (handled_by = pg_temp.u('ad'))::text FROM public.problem_reports WHERE id = pg_temp.rep(1, 'c1')),
  'handled warned He asked for an IBAN transfer twice. true', 'AC-5: the report is handled with the note');
SELECT is(pg_temp.audit('report.handled', pg_temp.rep(1, 'c1')::text),
  jsonb_build_object('request_id', pg_temp.r(1), 'outcome', 'warned', 'refund', null, 'reason', 'asked_money_off_platform'),
  'R-12: the audit row holds ids, the reason and the outcome, never the note');
SELECT is(pg_temp.handle('ad', pg_temp.rep(1, 'c1'), 'no_action'), 'already_handled', 'AC-5: a replay refuses');
SELECT is(pg_temp.mails(pg_temp.rep(1, 'c1')), 'report_handled>c1,report_new_admin>ad,report_received>c1', 'R-8: the reporter hears it was handled');
SELECT is(pg_temp.call_as('c1', format($q$SELECT (public.my_report(%L) ->> 'can_report') || ' ' || (public.my_report(%L) -> 'report' ->> 'status')$q$, pg_temp.r(1), pg_temp.r(1))),
  'true handled', 'AC-7: handled, and a second report may follow');
SELECT is(pg_temp.call_as('a1', 'SELECT public.my_warning() ->> ''reason'''), 'asked_money_off_platform', 'AC-6: the warned person sees the reason code');
SELECT is(pg_temp.call_as('c1', 'SELECT public.my_warning()::text'), NULL, 'AC-6: the reporter has none');
SELECT is(pg_temp.call_as('c1', format('SELECT public.acknowledge_warning(%L)::text', (SELECT id FROM public.user_warnings WHERE user_id = pg_temp.u('a1')))),
  'not_found', 'AC-6: nobody else acknowledges it');
SELECT is(pg_temp.call_as('a1', format('SELECT public.acknowledge_warning(%L) ->> ''replayed''', (SELECT id FROM public.user_warnings WHERE user_id = pg_temp.u('a1')))),
  'false', 'AC-6: the warned person acknowledges');
SELECT is(pg_temp.call_as('a1', format('SELECT public.acknowledge_warning(%L) ->> ''replayed''', (SELECT id FROM public.user_warnings WHERE user_id = pg_temp.u('a1')))),
  'true', 'AC-6: a replay is ok');
SELECT is(pg_temp.call_as('a1', 'SELECT public.my_warning()::text'), NULL, 'AC-6: and the banner goes');
SELECT is(pg_temp.err(format($q$UPDATE public.user_warnings SET reason = 'other' WHERE user_id = %L$q$, pg_temp.u('a1'))), 'warning_immutable',
  'AC-6: a warning never changes');
SELECT is(pg_temp.err(format($q$UPDATE public.problem_reports SET outcome = 'no_action' WHERE id = %L$q$, pg_temp.rep(1, 'c1'))), 'report_immutable',
  'X-24: a handled report never changes');
SELECT is(pg_temp.err(format($q$DELETE FROM public.problem_reports WHERE id = %L$q$, pg_temp.rep(1, 'a1'))), 'report_immutable', 'X-24: nor is deleted');

-- ══ X-16: two reports per person and request ════════════════════════════════
SELECT is(pg_temp.report('c1', 1, 'other', 'A second problem with the same job, a new one.'), 'ok', 'X-16: a second report');
SELECT is(pg_temp.handle('ad', pg_temp.rep(1, 'c1'), 'no_action'), 'no_action', 'AC-5: no action');
SELECT is(pg_temp.report('c1', 1, 'other', 'A third problem with the same job, a new one.'), 'report_limit', 'X-16: never a third');
SELECT is(pg_temp.handle('ad', pg_temp.rep(1, 'a1'), 'no_action'), 'no_action', 'AC-5: no action on the provider''s report');

-- ══ AC-5, R-5, X-13, X-17, X-18: the return to work ═════════════════════════
INSERT INTO public.deadline_flags (region, request_id, kind) VALUES ('TR', pg_temp.r(2), 'completion_late');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.providers SET status = 'suspended', suspension_reason = 'Repeated complaints from customers' WHERE id = '00000000-0000-0000-0000-0000003000a1'$$],
                        format($q$pg_temp.handle('ad', %L, 'returned_to_work')$q$, pg_temp.rep(2, 'c1'))),
  'provider_not_approved', 'X-17: a return needs an active provider');
SELECT is(pg_temp.handle('ad', pg_temp.rep(2, 'c1'), 'returned_to_work', 'The tiles are missing, back to work.'), 'returned_to_work',
  'AC-5: returned to work');
SELECT is((SELECT r.status || ' ' || coalesce(r.actual_completed_at::text, '-') || ' ' || coalesce(r.confirm_deadline::text, '-') || ' ' || a.status
             FROM public.requests r JOIN public.applications a ON a.id = r.selected_application_id WHERE r.id = pg_temp.r(2)),
  'IN_PROGRESS - - STARTED', 'R-5: IN_PROGRESS with the done time and deadline cleared, the application STARTED');
SELECT ok((SELECT cleared_at IS NOT NULL FROM public.deadline_flags WHERE request_id = pg_temp.r(2) AND kind = 'completion_late'),
  'X-18: the completion flag is cleared');
SELECT is(pg_temp.audit('job.returned_to_work', pg_temp.r(2)::text) ->> 'report_id', pg_temp.rep(2, 'c1')::text, 'AC-5: audited');
SELECT is(pg_temp.call_as('a1', format('SELECT public.finish_job(%L) ->> ''replayed''', pg_temp.r(2))), 'false', 'AC-5: the provider can press Done again');

-- R-5, X-13: the guard.
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.requests SET confirm_deadline = confirm_deadline - interval '1 hour' WHERE id = %L$q$, pg_temp.r(2))], $$'none'$$),
  'request_immutable', 'X-13: a deadline never moves earlier');
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.requests SET confirm_deadline = confirm_deadline + interval '1 hour' WHERE id = %L$q$, pg_temp.r(2))], $$'none'$$),
  'none', 'X-13: it moves later while AWAITING_CONFIRMATION');
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.requests SET confirm_deadline = NULL WHERE id = %L$q$, pg_temp.r(2))], $$'none'$$),
  'request_immutable', 'X-13: it clears only on the return to work');
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.requests SET status = 'IN_PROGRESS' WHERE id = %L$q$, pg_temp.r(2))], $$'none'$$),
  'request_transition_invalid', 'R-5: a return keeps nothing of the done');
SELECT is(pg_temp.err(format($q$UPDATE public.requests SET actual_completed_at = NULL WHERE id = %L$q$, pg_temp.r(8))),
  'request_immutable', 'X-13: the done time clears on no other move');
SELECT is(pg_temp.err(format($q$UPDATE public.applications SET status = 'STARTED' WHERE id = %L$q$, pg_temp.app(8, 'a1'))),
  'application_final', 'R-5: a CONFIRMED application never goes back');

-- ══ AC-5: a full window again ═══════════════════════════════════════════════
SELECT pg_temp.force(2, $$confirm_deadline = now() + interval '1 hour'$$);
SELECT is(pg_temp.report('c1', 2, 'other', 'Still not right after the second visit.'), 'ok', 'AC-5: the customer reports again');
SELECT is(pg_temp.handle('ad', pg_temp.rep(2, 'c1'), 'no_action'), 'no_action', 'AC-5: no action');
SELECT is((SELECT confirm_deadline FROM public.requests WHERE id = pg_temp.r(2)), now() + make_interval(hours => public.confirm_settings('TR')),
  'AC-5: a job still waiting gets the full confirm window again');

-- ══ AC-5, X-15: an admin close ══════════════════════════════════════════════
SELECT is(pg_temp.report('c1', 3), 'ok', 'AC-5: a report on a done job');
SELECT is(pg_temp.handle('ad', pg_temp.rep(3, 'c1'), 'job_closed', 'Both say the job is done now.'), 'job_closed', 'AC-5: closed by admin');
SELECT is((SELECT status || ' ' || closed_by FROM public.requests WHERE id = pg_temp.r(3)), 'COMPLETED admin', 'AC-5: COMPLETED, closed by admin');
SELECT is((SELECT count(*)::int FROM public.outbox_events WHERE kind = 'email.send' AND payload ->> 'template' = 'job_completed'
             AND payload ->> 'request_id' = pg_temp.r(3)::text AND payload ->> 'recipient_id' = pg_temp.u('a1')::text), 1,
  'X-15: an admin close mails the provider like a confirm');
SELECT is(pg_temp.report('c1', 3, 'other', 'One more thing after the admin close.'), 'ok', 'R-2: a report after the close, inside the window');
SELECT is(pg_temp.handle('ad', pg_temp.rep(3, 'c1'), 'job_closed'), 'invalid_state', 'AC-5: a closed job cannot close again');

-- ══ R-11, X-20: a refund ════════════════════════════════════════════════════
SELECT is(pg_temp.report('c1', 6), 'ok', 'R-11: a report on a paid job');
SELECT is(pg_temp.handle('ad', pg_temp.rep(6, 'c1'), 'no_action', 'Refund the commission, by hand review.',
                         (SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(6) AND kind = 'commission')),
  'no_action', 'R-11: with a refund of the request''s own fee');
SELECT is((SELECT x.reason || ' ' || (x.id = p.fee_refund_id)::text FROM public.problem_reports p JOIN public.fee_refunds x ON x.id = p.fee_refund_id
            WHERE p.id = pg_temp.rep(6, 'c1')),
  'admin_refund true', 'R-11: the refund is queued through 12 and kept on the report');
SELECT is((SELECT new_value ->> 'reason' FROM public.audit_log WHERE action = 'fee.refund_by_admin'
             AND new_value ->> 'request_id' = pg_temp.r(6)::text ORDER BY id DESC LIMIT 1),
  'report:' || pg_temp.rep(6, 'c1'), 'R-12, review F-5: the refund''s audit row names the report, never the note');

-- ══ R-10, X-1, X-2, X-14: a suspension ══════════════════════════════════════
SELECT is(pg_temp.report('c1', 7, 'no_show', 'The provider never came on the day at all.'), 'ok', 'R-10: a report on b1''s job');
SELECT is(pg_temp.handle('ad', pg_temp.rep(7, 'c1'), 'suspended', 'Did not come, did not answer calls.', NULL, 'safety_or_behaviour'), 'suspended',
  'R-10: suspended');
SELECT is((SELECT status || ' ' || suspension_reason FROM public.providers WHERE id = pg_temp.u('b1')), 'suspended report:safety_or_behaviour',
  'X-2, X-19: a fixed reason the provider may read, never the note');
SELECT is(pg_temp.report('c1', 7, 'other', 'And again the next day, nobody came.'), 'ok', 'R-10: a second report');
SELECT is(pg_temp.handle('ad', pg_temp.rep(7, 'c1'), 'suspended'), 'already_suspended', 'X-14: a provider not approved');

-- ══ AC-4, X-21, X-22: the queue and the detail ══════════════════════════════
SELECT is(pg_temp.call_as('ad', 'SELECT (public.admin_reports(''open'', 1) ->> ''total'') || '' '' || (public.admin_reports_open_count())::text'),
  '2 2', 'X-21: the open tab and the rail count agree');
SELECT is(pg_temp.call_as('ad', 'SELECT (public.admin_reports(''handled'', 1) ->> ''total'') || '' '' || jsonb_array_length(public.admin_reports(''handled'', 1) -> ''rows'')'),
  '8 8', 'AC-4: the handled tab');
SELECT is(pg_temp.call_as('c1', 'SELECT public.admin_reports(''open'', 1)::text'), 'forbidden', 'AC-4: admin only');
SELECT is(pg_temp.call_as('ad', format($q$SELECT string_agg((p ->> 'role') || ':' || (p ->> 'filed') || '/' || (p ->> 'against') || '/' || (p ->> 'warnings'), ' ')
                                         FROM jsonb_array_elements(public.admin_report_detail(%L) -> 'parties') p$q$, pg_temp.rep(1, 'a1'))),
  'provider:0/7/1 customer:9/0/0', 'AC-4: both parties with their counts, this report left out');
SELECT is(pg_temp.call_as('ad', format('SELECT jsonb_array_length(public.admin_report_detail(%L) -> ''photos'')::text',
                                       (SELECT report_id FROM public.report_photos LIMIT 1))),
  '3', 'AC-4: the report with photos lists its three');
SELECT is(pg_temp.call_as('c1', format('SELECT public.admin_report_detail(%L)::text', pg_temp.rep(1, 'c1'))), 'forbidden', 'AC-4: admin only');

-- ══ Grants (R-15) ═══════════════════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default", has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            has_function_privilege('service_role', p.oid, 'EXECUTE')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('acknowledge_warning', 'add_report_photo', 'admin_report_detail', 'admin_reports', 'admin_reports_open_count',
                          'handle_report', 'log_report_photo_view', 'my_report', 'my_warning', 'open_report', 'problem_reports_guard',
                          'report_party', 'report_photo_allowed', 'report_photo_name_ok', 'report_photo_store_allowed',
                          'report_photos_guard', 'report_photos_storage_guard', 'report_settings', 'report_window_open', 'user_warnings_guard')
      ORDER BY p.proname COLLATE "C" $$,
  $$ VALUES ('acknowledge_warning'::text, false, true, false), ('add_report_photo', false, true, false), ('admin_report_detail', false, true, false),
            ('admin_reports', false, true, false), ('admin_reports_open_count', false, true, false), ('handle_report', false, true, false),
            ('log_report_photo_view', false, true, false), ('my_report', false, true, false), ('my_warning', false, true, false),
            ('open_report', false, true, false), ('problem_reports_guard', false, false, false), ('report_party', false, false, false),
            ('report_photo_allowed', false, true, false), ('report_photo_name_ok', false, false, false),
            ('report_photo_store_allowed', false, false, false), ('report_photos_guard', false, false, false),
            ('report_photos_storage_guard', false, false, false), ('report_settings', false, false, false),
            ('report_window_open', false, false, false), ('user_warnings_guard', false, false, false) $$,
  'R-15: authenticated on the doors and the storage check; nothing on the internals; nothing for anon');

SELECT * FROM finish();
ROLLBACK;
