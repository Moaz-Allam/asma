-- Position 13, spec 0011-13 (D191, D192): transactional email.
--
-- The settings and their readers (R-3, R-10, R-14); email_confirmations' RLS, policy and grants (R-9); the map on a
-- real request (AC-3: new_offer, chosen, commission_received, pay_your_fee, contacts_ready) and on synthetic audit rows
-- for every other row; a replay writing nothing; the preference and switch cases (AC-4); each "only if" through
-- email_context (R-8), and its skips; the confirmation (AC-7, R-9); the two lanes, finish_email and the token strip
-- (R-11, R-12, AC-11); the apply gate (R-10); R-2's forced error; the reminders (AC-6); the housekeeping; every grant;
-- the trigger's `when` list against the map; the cron jobs.
--
-- Race tests 19 and 28 commit rows through dblink, so every assertion here is scoped to this file's own ids.
-- A condition that needs a row changed and put back runs inside pg_temp.probe, which rolls its own changes back.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(218);

SET CONSTRAINTS ALL IMMEDIATE;

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002900' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002970' || lpad(p::text, 2, '0'))::uuid $$;
-- The application of provider w (a1, a2, a3) on request p.
CREATE FUNCTION pg_temp.app(p integer, w text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-00000029' || CASE w WHEN 'a1' THEN '81' WHEN 'a2' THEN '82' ELSE '83' END
          || lpad(p::text, 2, '0'))::uuid $$;
-- The tag of one of this file's people, for readable lists.
CREATE FUNCTION pg_temp.who(p uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN pg_temp.u('c1') THEN 'c1' WHEN pg_temp.u('c2') THEN 'c2' WHEN pg_temp.u('a1') THEN 'a1'
                WHEN pg_temp.u('a2') THEN 'a2' WHEN pg_temp.u('a3') THEN 'a3' WHEN pg_temp.u('ad') THEN 'ad' ELSE 'x' END $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1 a customer with a confirmed address (locale en), c2 a customer without one; a1 a2 providers with confirmed
-- addresses (tr, ar), a3 a provider without one; ad an admin. Inserted with their addresses: the guard and the
-- audit trigger on profiles run on update only.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559290001'), ('c2', '905559290002'), ('a1', '905559290003'), ('a2', '905559290004'),
               ('a3', '905559290005'), ('ad', '905559290006')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale, email, email_confirmed_at)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, l, e, CASE WHEN e IS NOT NULL THEN now() END
  FROM (VALUES ('c1', 'customer', '905559290001', 'Posta Müşteri', 'en', 'c1-29@example.com'),
               ('c2', 'customer', '905559290002', 'Adressiz', 'tr', NULL),
               ('a1', 'provider', '905559290003', 'Bir Usta', 'tr', 'a1-29@example.com'),
               ('a2', 'provider', '905559290004', 'İki Usta', 'ar', 'a2-29@example.com'),
               ('a3', 'provider', '905559290005', 'Üç Usta', 'tr', NULL),
               ('ad', 'admin', '905559290006', 'Yönetici', 'tr', NULL)) AS t(c, r, p, n, l, e);
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Usta'
 WHERE id IN (pg_temp.u('a1'), pg_temp.u('a2'), pg_temp.u('a3'));
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Posta"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Temizlik", "en": "Cleaning"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Moda"}', 1.00, true);
-- Not the seed's: both switches on for TR here.
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key IN ('payments_enabled', 'emails_enabled');
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key IN ('apply_needs_email', 'auto_close_enabled');

CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text, true) $$;
-- A request of customer c (price 100000, commission 10000 unless given), starting in 3 days, with offers of the
-- providers given (a1 a2 a3 unless given).
CREATE FUNCTION pg_temp.req(p integer, c text DEFAULT 'c1', p_commission bigint DEFAULT 10000,
                            p_apps text[] DEFAULT ARRAY['a1', 'a2', 'a3']) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at, notes)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u(c), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100, "service": {"name": {"tr": "Temizlik", "en": "Cleaning"}}}', 100000, p_commission,
    100000 - p_commission, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours', 'Ring twice');
  INSERT INTO public.request_addresses (request_id, region, customer_id, line) VALUES (pg_temp.r(p), 'TR', pg_temp.u(c), 'Moda Cad. No 9');
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT pg_temp.app(p, w), 'TR', pg_temp.r(p), pg_temp.u(w), 'An offer for the email tests, long enough to pass.'
    FROM unnest(p_apps) w;
  RETURN pg_temp.r(p);
END $$;
CREATE FUNCTION pg_temp.choose(p integer, w text, c text DEFAULT 'c1') RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(c);
  RETURN public.choose_provider(pg_temp.r(p), pg_temp.app(p, w));
END $$;
CREATE FUNCTION pg_temp.cfee(p integer) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'commission' $$;
CREATE FUNCTION pg_temp.pfee(p integer, w text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'provider_fee' AND application_id = pg_temp.app(p, w) $$;
CREATE FUNCTION pg_temp.paycom(p integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_att uuid;
BEGIN
  PERFORM pg_temp.as_user('c1');
  v_att := (public.pay_commission(pg_temp.r(p), 'tr', NULL) ->> 'attempt_id')::uuid;
  RETURN public.apply_fee_paid(pg_temp.cfee(p), v_att, 'pay-29-c' || p, 10000, 'TRY', 300);
END $$;
CREATE FUNCTION pg_temp.payfee(p integer, w text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_att uuid;
BEGIN
  PERFORM pg_temp.as_user(w);
  v_att := (public.pay_provider_fee(pg_temp.app(p, w), 'tr', NULL) ->> 'attempt_id')::uuid;
  RETURN public.apply_fee_paid(pg_temp.pfee(p, w), v_att, 'pay-29-p' || p || w, 5000, 'TRY', 150);
END $$;
-- Move a request's windows, as the clock would (its order checks kept).
CREATE FUNCTION pg_temp.age(p integer, k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  IF k = 'fee' THEN
    UPDATE public.requests SET selected_at = now() - interval '5 hours',
           payment_deadline = CASE WHEN payment_deadline IS NOT NULL THEN now() - interval '4 hours' END,
           fee_deadline = now() - interval '1 hour' WHERE id = pg_temp.r(p);
  ELSIF k = 'start' THEN
    UPDATE public.requests SET selected_at = now() - interval '5 hours',
           payment_deadline = CASE WHEN payment_deadline IS NOT NULL THEN now() - interval '4 hours' END,
           fee_deadline = CASE WHEN fee_deadline IS NOT NULL THEN now() - interval '3 hours' END,
           scheduled_start_at = now() - interval '10 minutes', scheduled_end_at = now() + interval '2 hours' WHERE id = pg_temp.r(p);
  ELSIF k = 'pay_soon' THEN
    -- The commission window closes in 3 hours, 9 hours after the pick.
    UPDATE public.requests SET selected_at = now() - interval '6 hours', payment_deadline = now() + interval '3 hours' WHERE id = pg_temp.r(p);
  ELSIF k = 'pay_short' THEN
    -- Closes in 3 hours, but the whole window is 3.5 hours, shorter than the 4 hour lead.
    UPDATE public.requests SET selected_at = now() - interval '30 minutes', payment_deadline = now() + interval '3 hours' WHERE id = pg_temp.r(p);
  ELSIF k = 'pay_passed' THEN
    UPDATE public.requests SET selected_at = now() - interval '6 hours', payment_deadline = now() - interval '1 minute' WHERE id = pg_temp.r(p);
  ELSIF k = 'pay_far' THEN
    UPDATE public.requests SET selected_at = now() - interval '6 hours', payment_deadline = now() + interval '10 hours' WHERE id = pg_temp.r(p);
  ELSIF k = 'fee_soon' THEN
    UPDATE public.requests SET selected_at = now() - interval '6 hours',
           payment_deadline = CASE WHEN payment_deadline IS NOT NULL THEN now() - interval '5 hours' END,
           fee_deadline = now() + interval '3 hours' WHERE id = pg_temp.r(p);
  ELSIF k = 'confirm_soon' THEN
    UPDATE public.requests SET confirm_deadline = now() + interval '10 hours' WHERE id = pg_temp.r(p);
  END IF;
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
-- Provider w applies to request p ('none', or the refusal), as a plain insert: the triggers run on it.
CREATE FUNCTION pg_temp.offer(p integer, w text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.err(format('INSERT INTO public.applications (id, region, request_id, provider_id, message) VALUES (gen_random_uuid(), %L, %L, %L, %L)',
                            'TR', pg_temp.r(p), pg_temp.u(w), 'An offer for the email tests, long enough to pass.')) $$;

-- ── mail helpers ─────────────────────────────────────────────────────────────
-- A request's mail rows, sorted: template>recipient.
CREATE FUNCTION pg_temp.mails(p integer) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT coalesce(string_agg(o.payload ->> 'template' || '>' || pg_temp.who((o.payload ->> 'recipient_id')::uuid), ','
                             ORDER BY o.payload ->> 'template' COLLATE "C", pg_temp.who((o.payload ->> 'recipient_id')::uuid) COLLATE "C"), '')
    FROM public.outbox_events o
   WHERE o.kind = 'email.send' AND o.payload ->> 'request_id' = pg_temp.r(p)::text $$;
-- The mail rows one audit row wrote, sorted: template>recipient.
CREATE FUNCTION pg_temp.queued(p_audit bigint) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT coalesce(string_agg(o.payload ->> 'template' || '>' || pg_temp.who((o.payload ->> 'recipient_id')::uuid), ','
                             ORDER BY o.payload ->> 'template' COLLATE "C", pg_temp.who((o.payload ->> 'recipient_id')::uuid) COLLATE "C"), '')
    FROM public.outbox_events o
   WHERE o.kind = 'email.send' AND o.idempotency_key LIKE 'email:' || p_audit || ':%' $$;
-- A synthetic audit row (audit_log has no action check); its id. The trigger runs on it as on a real one.
CREATE FUNCTION pg_temp.audit(p_action text, p_type text, p_entity uuid, p_new jsonb DEFAULT '{}') RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  VALUES (NULL, p_action, p_type, p_entity::text, 'TR', NULL, p_new) RETURNING id $$;
-- The key AC-3 gives the latest audit row of an action on an entity, for one recipient and template.
CREATE FUNCTION pg_temp.k(p_action text, p_entity uuid, p_who text, p_template text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'email:' || (SELECT max(a.id) FROM public.audit_log a WHERE a.action = p_action AND a.entity_id = p_entity::text)
         || ':' || pg_temp.u(p_who) || ':' || p_template $$;
CREATE FUNCTION pg_temp.ctx(p_key text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.email_context(o.id) FROM public.outbox_events o WHERE o.idempotency_key = p_key $$;
-- send, or the skip's reason; 'missing' when no row has the key.
CREATE FUNCTION pg_temp.verdict(p_key text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.outbox_events WHERE idempotency_key = p_key) THEN
    RETURN 'missing';
  END IF;
  v := pg_temp.ctx(p_key);
  RETURN CASE WHEN v ->> 'status' = 'send' THEN 'send' ELSE v ->> 'reason' END;
END $$;
CREATE FUNCTION pg_temp.live(p_who text) RETURNS uuid LANGUAGE sql VOLATILE AS $$
  SELECT id FROM public.email_confirmations WHERE profile_id = pg_temp.u(p_who) AND used_at IS NULL AND revoked_at IS NULL $$;
CREATE FUNCTION pg_temp.tok(p_conf uuid) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT payload ->> 'token' FROM public.outbox_events WHERE idempotency_key = 'email:confirm:' || p_conf $$;
CREATE FUNCTION pg_temp.confirm(p_who text, p_token text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_who, format('SELECT public.confirm_email(%L)::text', p_token)) $$;
CREATE FUNCTION pg_temp.resend(p_who text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call_as(p_who, 'SELECT public.request_email_confirmation()::text') $$;
CREATE FUNCTION pg_temp.ctoken(p_id uuid) RETURNS timestamptz LANGUAGE sql VOLATILE AS $$
  SELECT claimed_at FROM public.outbox_events WHERE id = p_id $$;
CREATE FUNCTION pg_temp.mail_row(p_key text, p_payload jsonb, p_status text DEFAULT 'pending', p_attempts integer DEFAULT 0,
                                 p_claimed timestamptz DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.outbox_events (region, kind, idempotency_key, payload, status, attempts, next_attempt_at, claimed_at, claimed_by)
  VALUES ('TR', 'email.send', p_key, p_payload, p_status, p_attempts,
          CASE WHEN p_status = 'pending' THEN now() END, p_claimed, CASE WHEN p_claimed IS NOT NULL THEN 'worker-29-old' END)
  RETURNING id $$;

-- ══ R-3, R-10, R-14: the settings and their readers ═══════════════════════════
SELECT results_eq($$ SELECT key, value FROM public.platform_settings WHERE region = 'KSA'
                      AND key IN ('emails_enabled', 'apply_needs_email', 'pay_reminder_hours', 'email_link_hours', 'confirm_reminder_hours')
                    ORDER BY key COLLATE "C" $$,
  $$ VALUES ('apply_needs_email'::text, 'false'::jsonb), ('confirm_reminder_hours', '24'), ('email_link_hours', '24'),
            ('emails_enabled', 'false'), ('pay_reminder_hours', '4') $$,
  'R-14: the five settings, seeded off and at their defaults');
SELECT is((SELECT count(*)::int FROM public.platform_settings WHERE region = 'TR'
            AND key IN ('emails_enabled', 'apply_needs_email', 'pay_reminder_hours', 'email_link_hours', 'confirm_reminder_hours')),
  5, 'R-14: TR has all five');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '"yes"' WHERE region = 'TR' AND key = 'apply_needs_email'$$), '23514',
  'R-10: apply_needs_email is a JSON boolean');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '"yes"' WHERE region = 'TR' AND key = 'emails_enabled'$$), '23514',
  'R-3: emails_enabled is a JSON boolean');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'pay_reminder_hours'$$), '23514',
  'R-14: pay_reminder_hours at least 1');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '169' WHERE region = 'TR' AND key = 'email_link_hours'$$), '23514',
  'R-14: email_link_hours at most 168');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '1.5' WHERE region = 'TR' AND key = 'confirm_reminder_hours'$$), '23514',
  'R-14: confirm_reminder_hours is whole hours');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '"4"' WHERE region = 'TR' AND key = 'pay_reminder_hours'$$), '23514',
  'R-14: an hour setting is a JSON number');
SELECT is(pg_temp.err($$DELETE FROM public.platform_settings WHERE region = 'KSA' AND key = 'emails_enabled'$$), 'pricing_setting_required',
  'R-14: the switch cannot be deleted');
SELECT is(pg_temp.err($$DELETE FROM public.platform_settings WHERE region = 'KSA' AND key = 'confirm_reminder_hours'$$), 'pricing_setting_required',
  'R-14: nor an hour setting');
SELECT is(public.email_settings('TR'),
  '{"emails_enabled": true, "apply_needs_email": false, "pay_reminder_hours": 4, "email_link_hours": 24, "confirm_reminder_hours": 24}'::jsonb,
  'R-14: email_settings reads the five');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $q$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'confirm_reminder_hours'$q$],
                        $q$public.email_settings('TR')$q$),
  'email_settings_invalid', 'R-14: a missing setting raises email_settings_invalid');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $q$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'emails_enabled'$q$],
                        $q$public.emails_enabled('TR')$q$),
  'false', 'R-3: emails_enabled fails closed');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $q$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'apply_needs_email'$q$],
                        $q$public.apply_needs_email('TR')$q$),
  'false', 'R-10: apply_needs_email fails closed');
SELECT is(public.emails_enabled('KSA'), false, 'R-3: off in KSA');

-- ══ R-9: email_confirmations, RLS, the policy, no grant ═══════════════════════
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_confirmations'::regclass), 'R-9: RLS on');
SELECT ok((SELECT count(*) = 1 AND bool_and(polname = 'email_confirmations_no_api') FROM pg_policy
            WHERE polrelid = 'public.email_confirmations'::regclass), 'R-9: one policy');
SELECT ok((SELECT pg_get_expr(polqual, polrelid) COLLATE "C" = 'false' COLLATE "C" FROM pg_policy
            WHERE polrelid = 'public.email_confirmations'::regclass), 'R-9: and it denies every row');
SELECT is_empty($$ SELECT grantee FROM information_schema.role_table_grants
                    WHERE table_schema::text = 'public' AND table_name::text = 'email_confirmations'
                      AND grantee::text IN ('anon', 'authenticated', 'service_role') $$,
  'R-9: no API role has a grant on email_confirmations');
SELECT is(pg_temp.call_as('c1', 'SELECT count(*)::text FROM public.email_confirmations'), '42501', 'R-9: a signed in user reads nothing');
SELECT is(pg_temp.call_as('anon', 'SELECT count(*)::text FROM public.email_confirmations'), '42501', 'R-9: nor anon');
SELECT is_empty($$ SELECT column_name FROM information_schema.columns
                    WHERE table_schema::text = 'public' AND table_name::text = 'email_confirmations'
                      AND column_name::text LIKE '%token%' AND column_name::text <> 'token_hash' $$,
  'R-9: only the digest of a token is stored');
SELECT is(pg_temp.err($$INSERT INTO public.action_counters (region, subject_id, action, window_start, count)
                        VALUES ('TR', '00000000-0000-0000-0000-000000290099', 'mail', date_trunc('hour', now()), 1)$$), '23514',
  'R-9: the counter takes checkout and email_confirm only');

-- ══ AC-3: the map on a real request ═══════════════════════════════════════════
SELECT pg_temp.req(1);
SELECT is(pg_temp.mails(1), 'new_offer>c1,new_offer>c1,new_offer>c1', 'AC-3: one new_offer per offer, to the customer');
SELECT is((SELECT idempotency_key FROM public.outbox_events WHERE kind = 'email.send' AND payload ->> 'entity_id' = pg_temp.app(1, 'a1')::text),
  'email:offer:' || pg_temp.app(1, 'a1'), 'AC-3: a new offer is keyed email:offer:<application_id>');
SELECT is((SELECT array_agg(k ORDER BY k COLLATE "C") FROM public.outbox_events o, jsonb_object_keys(o.payload) k
            WHERE o.idempotency_key = 'email:offer:' || pg_temp.app(1, 'a1')),
  ARRAY['entity_id', 'recipient_id', 'request_id', 'send_until', 'template'], 'R-1: a payload holds ids, the template and send_until, no address');
SELECT ok((SELECT (payload ->> 'send_until')::timestamptz BETWEEN now() + interval '23 hours' AND now() + interval '25 hours'
             FROM public.outbox_events WHERE idempotency_key = 'email:offer:' || pg_temp.app(1, 'a1')),
  'R-5: with no deadline, send_until is the queue time plus 24 hours');
SELECT is(pg_temp.verdict('email:offer:' || pg_temp.app(1, 'a1')), 'send', 'AC-3: new_offer sends while the request is OPEN');

SELECT pg_temp.choose(1, 'a1');
SELECT is(pg_temp.mails(1), 'chosen>a1,new_offer>c1,new_offer>c1,new_offer>c1', 'AC-3: the pick writes chosen to the chosen provider');
SELECT ok(EXISTS (SELECT 1 FROM public.outbox_events WHERE idempotency_key = pg_temp.k('request.provider_chosen', pg_temp.r(1), 'a1', 'chosen')),
  'AC-3: keyed email:<audit_id>:<recipient_id>:<template>');
SELECT is(pg_temp.verdict('email:offer:' || pg_temp.app(1, 'a1')), 'condition', 'AC-3: new_offer no longer sends once the request is SELECTED');
SELECT is(pg_temp.ctx(pg_temp.k('request.provider_chosen', pg_temp.r(1), 'a1', 'chosen')) - 'values',
  jsonb_build_object('status', 'send', 'template', 'chosen', 'email', 'a1-29@example.com', 'locale', 'tr', 'region_locale', 'tr',
                     'timezone', (SELECT timezone FROM public.regions WHERE code = 'TR')),
  'R-7, R-8: the address and the language are read at send time');
SELECT is(pg_temp.ctx(pg_temp.k('request.provider_chosen', pg_temp.r(1), 'a1', 'chosen')) -> 'values',
  jsonb_build_object('side', 'provider', 'request_id', pg_temp.r(1), 'service', '{"tr": "Temizlik", "en": "Cleaning"}'::jsonb,
                     'start_at', (SELECT scheduled_start_at FROM public.requests WHERE id = pg_temp.r(1)), 'deadline', NULL,
                     'amount', NULL, 'currency', 'TRY', 'fee_id', NULL, 'carried', NULL, 'token', NULL),
  'R-8: the values of chosen: the service and the start, no other party''s data');

SELECT pg_temp.paycom(1);
SELECT is(pg_temp.mails(1), 'chosen>a1,commission_received>c1,new_offer>c1,new_offer>c1,new_offer>c1,pay_your_fee>a1',
  'AC-3: the paid commission writes commission_received to the customer and pay_your_fee to the provider');
SELECT is(pg_temp.ctx(pg_temp.k('request.commission_paid', pg_temp.r(1), 'c1', 'commission_received')) -> 'values' ->> 'amount', '10000',
  'R-8: the commission amount is the fee row''s');
SELECT is(pg_temp.ctx(pg_temp.k('request.commission_paid', pg_temp.r(1), 'c1', 'commission_received')) -> 'values' ->> 'fee_id', pg_temp.cfee(1)::text,
  'AC-5: the receipt''s fee id');
SELECT is(pg_temp.ctx(pg_temp.k('request.commission_paid', pg_temp.r(1), 'c1', 'commission_received')) ->> 'locale', 'en',
  'R-7: the customer''s own language');
SELECT is((pg_temp.ctx(pg_temp.k('request.commission_paid', pg_temp.r(1), 'a1', 'pay_your_fee')) -> 'values' ->> 'amount')::bigint,
  (SELECT provider_fee_amount FROM public.applications WHERE id = pg_temp.app(1, 'a1')), 'R-8: pay_your_fee shows the frozen provider fee');
SELECT is((pg_temp.ctx(pg_temp.k('request.commission_paid', pg_temp.r(1), 'a1', 'pay_your_fee')) -> 'values' ->> 'deadline')::timestamptz,
  (SELECT fee_deadline FROM public.requests WHERE id = pg_temp.r(1)), 'R-8: and the fee deadline');
SELECT is((SELECT (payload ->> 'send_until')::timestamptz FROM public.outbox_events
            WHERE idempotency_key = pg_temp.k('request.commission_paid', pg_temp.r(1), 'a1', 'pay_your_fee')),
  (SELECT fee_deadline FROM public.requests WHERE id = pg_temp.r(1)), 'R-5: send_until is the deadline the mail names');

SELECT pg_temp.payfee(1, 'a1');
SELECT is(pg_temp.mails(1),
  'chosen>a1,commission_received>c1,contacts_ready>a1,contacts_ready>c1,new_offer>c1,new_offer>c1,new_offer>c1,pay_your_fee>a1',
  'AC-3: the reveal writes contacts_ready to each side');
SELECT is(pg_temp.ctx(pg_temp.k('request.unlocked', pg_temp.r(1), 'c1', 'contacts_ready')) -> 'values' ->> 'side', 'customer',
  'R-8: the customer''s side');
SELECT is(pg_temp.ctx(pg_temp.k('request.unlocked', pg_temp.r(1), 'a1', 'contacts_ready')) -> 'values' ->> 'side', 'provider',
  'R-8: the provider''s side');
SELECT is(pg_temp.verdict(pg_temp.k('request.commission_paid', pg_temp.r(1), 'a1', 'pay_your_fee')), 'condition',
  'AC-3: pay_your_fee no longer sends once the fee is paid');
SELECT is(pg_temp.verdict(pg_temp.k('request.provider_chosen', pg_temp.r(1), 'a1', 'chosen')), 'condition',
  'AC-3: nor chosen once the request moved on');
SELECT is((SELECT count(*)::int FROM public.outbox_events o WHERE o.kind = 'email.send' AND o.payload ->> 'request_id' = pg_temp.r(1)::text
             AND (o.payload ? 'email' OR o.payload::text LIKE '%@%')), 0, 'R-8: no payload ever holds an address');

-- ══ AC-3: a replay writes nothing twice ═══════════════════════════════════════
CREATE TEMP TABLE mails_before AS SELECT count(*) AS n FROM public.outbox_events WHERE kind = 'email.send';
SELECT is(public.queue_audit_email((SELECT max(id) FROM public.audit_log WHERE action = 'request.unlocked' AND entity_id = pg_temp.r(1)::text)), 0,
  'AC-3: the same audit row again queues nothing');
SELECT is(public.queue_offer_email(pg_temp.app(1, 'a2')), 0, 'AC-3: nor the same offer');
SELECT is(public.apply_fee_paid(pg_temp.pfee(1, 'a1'), (SELECT id FROM public.checkout_attempts WHERE fee_payment_id = pg_temp.pfee(1, 'a1') LIMIT 1),
                                'pay-29-p1a1', 5000, 'TRY', 150) ->> 'replayed', 'true', 'AC-3: a replayed payment');
SELECT is((SELECT count(*) FROM public.outbox_events WHERE kind = 'email.send'), (SELECT n FROM mails_before), 'AC-3: the replays wrote no mail');

-- ══ AC-4: who gets mail; R-3: the switch ═════════════════════════════════════
SELECT pg_temp.req(2, 'c2');
SELECT is(pg_temp.mails(2), '', 'AC-4: a customer without a confirmed address gets no new_offer');
SELECT pg_temp.choose(2, 'a3', 'c2');
SELECT is(pg_temp.mails(2), '', 'AC-4: nor a provider without one');
INSERT INTO public.notification_preferences (user_id, topic, region, email_enabled) VALUES (pg_temp.u('c1'), 'new_offer', 'TR', false);
SELECT pg_temp.req(3);
SELECT is(pg_temp.mails(3), '', 'AC-4: the new_offer topic off writes no new_offer');
UPDATE public.notification_preferences SET email_enabled = true WHERE user_id = pg_temp.u('c1') AND topic = 'new_offer';
SELECT is(pg_temp.probe(ARRAY[$q$UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'emails_enabled'$q$],
                        format($q$pg_temp.queued(pg_temp.audit('provider.rejected', 'provider', %L))$q$, pg_temp.u('a1'))),
  '', 'R-3: nothing is queued while the switch is off');
SELECT pg_temp.req(9, 'c1', 10000, ARRAY[]::text[]);
SELECT is(pg_temp.probe(ARRAY[$q$UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'emails_enabled'$q$],
                        $q$pg_temp.offer(9, 'a1') || ' ' || pg_temp.mails(9)$q$),
  'none ', 'R-3: nor an offer');
SELECT is(pg_temp.probe(ARRAY[]::text[], $q$pg_temp.offer(9, 'a1') || ' ' || pg_temp.mails(9)$q$),
  'none new_offer>c1', 'R-3: the same offer with the switch on');

-- ══ AC-3: every other map row, on synthetic audit rows ════════════════════════
SELECT is(pg_temp.queued(pg_temp.audit('job.started', 'requests', pg_temp.r(1), jsonb_build_object('application_id', pg_temp.app(1, 'a1')))),
  'job_started>c1', 'AC-3: job.started');
SELECT is(pg_temp.queued(pg_temp.audit('job.done', 'requests', pg_temp.r(1), jsonb_build_object('application_id', pg_temp.app(1, 'a1')))),
  'please_confirm>c1', 'AC-3: job.done');
SELECT is(pg_temp.queued(pg_temp.audit('job.confirmed', 'requests', pg_temp.r(1), jsonb_build_object('application_id', pg_temp.app(1, 'a1')))),
  'job_completed>a1', 'AC-3: job.confirmed');
SELECT is(pg_temp.queued(pg_temp.audit('job.customer_closed', 'requests', pg_temp.r(1), jsonb_build_object('application_id', pg_temp.app(1, 'a1')))),
  'job_completed>a1', 'AC-3: job.customer_closed');
SELECT is(pg_temp.queued(pg_temp.audit('job.auto_closed', 'requests', pg_temp.r(1), jsonb_build_object('application_id', pg_temp.app(1, 'a1')))),
  'job_completed>a1', 'AC-3: job.auto_closed');
SELECT is(pg_temp.probe(ARRAY[format($q$INSERT INTO public.notification_preferences (user_id, topic, region, email_enabled) VALUES (%L, 'work_updates', 'TR', false)$q$, pg_temp.u('c1'))],
                        format($q$pg_temp.queued(pg_temp.audit('job.started', 'requests', %L, '{}'))$q$, pg_temp.r(1))),
  '', 'AC-4: job_started follows work_updates');
SELECT is(pg_temp.probe(ARRAY[format($q$INSERT INTO public.notification_preferences (user_id, topic, region, email_enabled) VALUES (%L, 'work_updates', 'TR', false)$q$, pg_temp.u('a1'))],
                        format($q$pg_temp.queued(pg_temp.audit('job.confirmed', 'requests', %L, %L))$q$, pg_temp.r(1),
                               jsonb_build_object('application_id', pg_temp.app(1, 'a1')))),
  '', 'AC-4: job_completed follows work_updates');
SELECT is(pg_temp.probe(ARRAY[format($q$INSERT INTO public.notification_preferences (user_id, topic, region, email_enabled) VALUES (%L, 'work_updates', 'TR', false)$q$, pg_temp.u('c1'))],
                        format($q$pg_temp.queued(pg_temp.audit('job.done', 'requests', %L, '{}'))$q$, pg_temp.r(1))),
  'please_confirm>c1', 'AC-4: please_confirm is always on');
SELECT is(pg_temp.queued(pg_temp.audit('request.cancelled', 'requests', pg_temp.r(1), '{}')), 'request_cancelled>a1',
  'AC-3: the customer''s cancel, to the provider of the pick');
SELECT is(pg_temp.queued(pg_temp.audit('request.cancelled', 'requests', pg_temp.r(3), '{}')), '',
  'AC-3: no pick, nobody to tell');
SELECT is(pg_temp.queued(pg_temp.audit('request.provider_cancelled', 'requests', pg_temp.r(1), '{}')), 'request_cancelled>c1',
  'AC-3: the provider''s cancel, to the customer');
SELECT is(pg_temp.queued(pg_temp.audit('request.failed_picks_limit', 'requests', pg_temp.r(1), '{}')), 'request_cancelled>c1',
  'AC-3: request.failed_picks_limit');
SELECT is(pg_temp.queued(pg_temp.audit('request.no_paid_pick', 'requests', pg_temp.r(1), '{}')), 'request_cancelled>c1',
  'AC-3: request.no_paid_pick');
SELECT is(pg_temp.queued(pg_temp.audit('request.pick_expired', 'requests', pg_temp.r(1), jsonb_build_object('application_id', pg_temp.app(1, 'a2')))),
  'pick_again>c1,pick_ended>a2', 'AC-3: an expired pick, to the customer and the provider of new_value.application_id');
SELECT is(pg_temp.queued(pg_temp.audit('request.fee_expired', 'requests', pg_temp.r(1), jsonb_build_object('application_id', pg_temp.app(1, 'a2')))),
  'pick_again>c1,window_missed>a2', 'AC-3: an expired fee window');
SELECT is(pg_temp.queued(pg_temp.audit('request.provider_withdrew', 'requests', pg_temp.r(1), '{"request": "none"}')), '',
  'AC-3: an offer withdrawn is not mailed');
SELECT is(pg_temp.queued(pg_temp.audit('request.provider_withdrew', 'requests', pg_temp.r(1), '{"request": "reopened"}')), 'pick_again>c1',
  'AC-3: a pick withdrawn is');
SELECT is(pg_temp.queued(pg_temp.audit('request.pick_dropped', 'requests', pg_temp.r(1), '{}')), 'pick_again>c1', 'AC-3: request.pick_dropped');
SELECT is(pg_temp.queued(pg_temp.audit('request.provider_chosen', 'requests', pg_temp.r(1),
                                       jsonb_build_object('status', 'COMMISSION_PAID', 'application_id', pg_temp.app(1, 'a2'), 'carried', true))),
  'pay_your_fee>a2', 'AC-3: a carried pick asks the new provider to pay at once');
-- The fees and their payer (X-7).
INSERT INTO public.fee_refunds (id, region, request_id, kind, psp_payment_id, amount, currency, reason)
VALUES ('00000000-0000-0000-0000-000000299801', 'TR', pg_temp.r(1), 'late', 'pay-29-late', 7000, 'TRY', 'late_payment');
SELECT is(pg_temp.queued(pg_temp.audit('fee.late', 'fee_payments', pg_temp.cfee(1), '{"fee_refund_id": "00000000-0000-0000-0000-000000299801"}')),
  'payment_too_late>c1', 'AC-3: fee.late, to the payer of the fee');
SELECT is(pg_temp.queued(pg_temp.audit('fee.refunded', 'fee_refunds', '00000000-0000-0000-0000-000000299801')), 'fee_refunded>c1',
  'X-7: a late refund''s payer comes from the fee.late row that names it');
INSERT INTO public.fee_refunds (id, region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency, reason)
VALUES ('00000000-0000-0000-0000-000000299802', 'TR', pg_temp.r(1), 'fee', pg_temp.pfee(1, 'a1'), 'pay-29-p1a1', 5000, 'TRY', 'admin_refund');
SELECT is(pg_temp.queued(pg_temp.audit('fee.refunded', 'fee_refunds', '00000000-0000-0000-0000-000000299802')), 'fee_refunded>a1',
  'AC-3: a fee refund, to the payer of its fee');
SELECT is(pg_temp.queued(pg_temp.audit('fee.refund_done_by_hand', 'fee_refunds', '00000000-0000-0000-0000-000000299802')), 'fee_refunded>a1',
  'AC-3: fee.refund_done_by_hand');
SELECT is(pg_temp.queued(pg_temp.audit('fee.refunded', 'fee_refunds', gen_random_uuid())), '', 'AC-3: an unknown refund queues nothing');
SELECT is(pg_temp.queued(pg_temp.audit('provider.approved', 'provider', pg_temp.u('a1'))), 'account_approved>a1', 'AC-3: provider.approved');
SELECT is(pg_temp.queued(pg_temp.audit('provider.reinstated', 'provider', pg_temp.u('a1'))), 'account_approved>a1', 'AC-3: provider.reinstated');
SELECT is(pg_temp.queued(pg_temp.audit('provider.rejected', 'provider', pg_temp.u('a2'))), 'account_rejected>a2', 'AC-3: provider.rejected');
SELECT is(pg_temp.queued(pg_temp.audit('provider.suspended', 'provider', pg_temp.u('a2'))), 'account_suspended>a2', 'AC-3: provider.suspended');
SELECT is(pg_temp.queued(pg_temp.audit('provider.approved', 'provider', pg_temp.u('a3'))), '', 'AC-4: no confirmed address, no account mail');
SELECT is(pg_temp.queued(pg_temp.audit('fee.paid', 'fee_payments', pg_temp.cfee(1))), '', 'R-15: an action outside the map queues nothing');
SELECT is(pg_temp.queued(pg_temp.audit('request.provider_suspended', 'requests', pg_temp.r(1))), '', 'R-15: request.provider_suspended waits for 16');

-- ══ AC-3's last column and R-8's values, through email_context ════════════════
SELECT is(pg_temp.ctx(pg_temp.k('fee.late', pg_temp.cfee(1), 'c1', 'payment_too_late')) -> 'values' ->> 'amount', '7000',
  'R-8: payment_too_late shows the late refund');
SELECT is(pg_temp.ctx(pg_temp.k('fee.refunded', '00000000-0000-0000-0000-000000299802', 'a1', 'fee_refunded')) -> 'values' ->> 'fee_id',
  pg_temp.pfee(1, 'a1')::text, 'AC-5: a refunded fee links its receipt');
SELECT is(pg_temp.ctx(pg_temp.k('fee.refunded', '00000000-0000-0000-0000-000000299801', 'c1', 'fee_refunded')) -> 'values' ->> 'fee_id', NULL,
  'D192: a late refund has no receipt');
SELECT is(pg_temp.verdict(pg_temp.k('provider.approved', pg_temp.u('a1'), 'a1', 'account_approved')), 'send', 'AC-3: account_approved while approved');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.providers DISABLE TRIGGER USER',
                              format($q$UPDATE public.providers SET status = 'pending' WHERE id = %L$q$, pg_temp.u('a1'))],
                        format('pg_temp.verdict(%L)', pg_temp.k('provider.approved', pg_temp.u('a1'), 'a1', 'account_approved'))),
  'condition', 'AC-3: account_approved only while the provider is still approved');
SELECT is(pg_temp.verdict(pg_temp.k('provider.suspended', pg_temp.u('a2'), 'a2', 'account_suspended')), 'send', 'AC-3: account_suspended always');
SELECT is(pg_temp.ctx(pg_temp.k('provider.suspended', pg_temp.u('a2'), 'a2', 'account_suspended')) ->> 'locale', 'ar', 'R-7: Arabic for a2');

-- chosen, then the pick withdrawn: chosen ends condition, pick_again sends.
SELECT pg_temp.req(4);
SELECT pg_temp.choose(4, 'a1');
SELECT is(pg_temp.verdict(pg_temp.k('request.provider_chosen', pg_temp.r(4), 'a1', 'chosen')), 'send', 'AC-3: chosen while SELECTED on it');
SELECT is(pg_temp.call_as('a1', format('SELECT public.withdraw_application(%L)::text', pg_temp.app(4, 'a1'))), '{"status": "ok", "replayed": false}',
  'a1 withdraws the pick');
SELECT is(pg_temp.verdict(pg_temp.k('request.provider_chosen', pg_temp.r(4), 'a1', 'chosen')), 'condition', 'AC-3: chosen ends condition once withdrawn');
SELECT is(pg_temp.verdict(pg_temp.k('request.provider_withdrew', pg_temp.r(4), 'c1', 'pick_again')), 'send', 'AC-3: the customer may pick again');
SELECT is(pg_temp.ctx(pg_temp.k('request.provider_withdrew', pg_temp.r(4), 'c1', 'pick_again')) -> 'values' ->> 'carried', 'false',
  'R-8: nothing paid, nothing carries');

-- pay_your_fee, then the customer cancels at COMMISSION_PAID and the commission comes back.
SELECT pg_temp.req(5);
SELECT pg_temp.choose(5, 'a1');
SELECT pg_temp.paycom(5);
SELECT is(pg_temp.verdict(pg_temp.k('request.commission_paid', pg_temp.r(5), 'a1', 'pay_your_fee')), 'send', 'AC-3: pay_your_fee while COMMISSION_PAID on it');
SELECT is(pg_temp.call_as('c1', format('SELECT public.cancel_request(%L, NULL)::jsonb ->> ''status''', pg_temp.r(5))), 'ok', 'c1 cancels at COMMISSION_PAID');
SELECT is(pg_temp.verdict(pg_temp.k('request.commission_paid', pg_temp.r(5), 'a1', 'pay_your_fee')), 'condition', 'AC-3: pay_your_fee ends condition');
SELECT is(pg_temp.verdict(pg_temp.k('request.cancelled', pg_temp.r(5), 'a1', 'request_cancelled')), 'send', 'AC-3: the provider of the pick hears of the cancel');
CREATE TEMP TABLE r5_refund AS SELECT id FROM public.fee_refunds WHERE fee_payment_id = pg_temp.cfee(5);
SELECT is(public.apply_fee_refunded((SELECT id FROM r5_refund), 'psp-refund-29-5') ->> 'replayed', 'false', 'the commission refund lands');
SELECT is(pg_temp.ctx(pg_temp.k('fee.refunded', (SELECT id FROM r5_refund), 'c1', 'fee_refunded')) -> 'values',
  jsonb_build_object('side', 'customer', 'request_id', pg_temp.r(5), 'service', '{"tr": "Temizlik", "en": "Cleaning"}'::jsonb,
                     'start_at', (SELECT scheduled_start_at FROM public.requests WHERE id = pg_temp.r(5)), 'deadline', NULL,
                     'amount', 10000, 'currency', 'TRY', 'fee_id', pg_temp.cfee(5), 'carried', NULL, 'token', NULL),
  'R-8: fee_refunded shows the refund and its receipt');
SELECT is(pg_temp.queued(pg_temp.audit('request.no_paid_pick', 'requests', pg_temp.r(5), jsonb_build_object('fee_refund_id', (SELECT id FROM r5_refund)))),
  'request_cancelled>c1', 'AC-3: a platform cancel with its refund line');
SELECT is(pg_temp.ctx(pg_temp.k('request.no_paid_pick', pg_temp.r(5), 'c1', 'request_cancelled')) -> 'values' ->> 'amount', '10000',
  'R-8: the refund line on a cancel');

-- The fee window expires: pick_again with the commission carried, window_missed; a re-pick ends pick_again.
SELECT pg_temp.req(6);
SELECT pg_temp.choose(6, 'a1');
SELECT pg_temp.paycom(6);
SELECT pg_temp.age(6, 'fee');
SELECT is(public.expire_request(pg_temp.r(6)), 'reopened', 'the fee window expires');
SELECT is(pg_temp.mails(6) LIKE '%pick_again>c1%' AND pg_temp.mails(6) LIKE '%window_missed>a1%', true, 'AC-3: pick_again and window_missed');
SELECT is(pg_temp.ctx(pg_temp.k('request.fee_expired', pg_temp.r(6), 'c1', 'pick_again')) -> 'values' ->> 'carried', 'true',
  'R-8: the commission carries');
SELECT pg_temp.choose(6, 'a2');
SELECT is(pg_temp.verdict(pg_temp.k('request.fee_expired', pg_temp.r(6), 'c1', 'pick_again')), 'condition', 'AC-3: pick_again ends once re-picked');
SELECT is(pg_temp.verdict(pg_temp.k('request.provider_chosen', pg_temp.r(6), 'a2', 'pay_your_fee')), 'send', 'AC-3: the carried pick pays at once');

-- An expired pick that the failed pick limit cancels sends no pick_again (R-1).
SELECT pg_temp.req(16);
SELECT pg_temp.choose(16, 'a1');
SELECT pg_temp.paycom(16);
SELECT pg_temp.age(16, 'fee');
UPDATE public.platform_settings SET value = '1' WHERE region = 'TR' AND key = 'max_reselections';
SELECT is(public.expire_request(pg_temp.r(16)), 'cancelled', 'the first failed pick reaches a limit of 1');
UPDATE public.platform_settings SET value = '3' WHERE region = 'TR' AND key = 'max_reselections';
SELECT is(pg_temp.verdict(pg_temp.k('request.fee_expired', pg_temp.r(16), 'c1', 'pick_again')), 'condition', 'R-1: the cancel in the same transaction ends pick_again');
SELECT is(pg_temp.verdict(pg_temp.k('request.failed_picks_limit', pg_temp.r(16), 'c1', 'request_cancelled')), 'send', 'AC-3: the customer hears of the cancel instead');

-- The work: job_started, please_confirm while AWAITING_CONFIRMATION, then confirmed.
SELECT pg_temp.age(1, 'start');
SELECT is(pg_temp.call_as('a1', format('SELECT public.start_job(%L)::jsonb ->> ''status''', pg_temp.r(1))), 'ok', 'a1 starts the job');
SELECT is(pg_temp.verdict(pg_temp.k('job.started', pg_temp.r(1), 'c1', 'job_started')), 'send', 'AC-3: job_started');
SELECT is(pg_temp.call_as('a1', format('SELECT public.finish_job(%L)::jsonb ->> ''status''', pg_temp.r(1))), 'ok', 'a1 marks it done');
SELECT is(pg_temp.verdict(pg_temp.k('job.done', pg_temp.r(1), 'c1', 'please_confirm')), 'send', 'AC-3: please_confirm while AWAITING_CONFIRMATION');
SELECT is(pg_temp.ctx(pg_temp.k('job.done', pg_temp.r(1), 'c1', 'please_confirm')) -> 'values' ->> 'deadline', NULL,
  'R-8: no confirm deadline while auto close is off');
SELECT is(pg_temp.probe(ARRAY[$q$UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'auto_close_enabled'$q$],
                        format($q$(pg_temp.ctx(%L) -> 'values' ->> 'deadline')::timestamptz = (SELECT confirm_deadline FROM public.requests WHERE id = %L)$q$,
                               pg_temp.k('job.done', pg_temp.r(1), 'c1', 'please_confirm'), pg_temp.r(1))),
  'true', 'R-8: the confirm deadline where it closes by itself');
SELECT is(pg_temp.probe(ARRAY[format('SELECT pg_temp.call_as(%L, %L)', 'c1', format('SELECT public.confirm_job(%L)::text', pg_temp.r(1)))],
                        format('pg_temp.verdict(%L)', pg_temp.k('job.done', pg_temp.r(1), 'c1', 'please_confirm'))),
  'condition', 'AC-3: please_confirm ends once confirmed');

-- ══ R-8: the skips at send time ══════════════════════════════════════════════
SELECT is(pg_temp.probe(ARRAY[$q$UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'emails_enabled'$q$],
                        format('pg_temp.verdict(%L)', pg_temp.k('request.commission_paid', pg_temp.r(1), 'c1', 'commission_received'))),
  'email_off', 'R-3, R-8: a row queued before the switch went off ends email_off');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.outbox_events DISABLE TRIGGER outbox_events_guard',
                              format($q$UPDATE public.outbox_events SET payload = jsonb_set(payload, '{send_until}', to_jsonb(now() - interval '1 minute'))
                                         WHERE idempotency_key = %L$q$, pg_temp.k('request.commission_paid', pg_temp.r(1), 'c1', 'commission_received'))],
                        format('pg_temp.verdict(%L)', pg_temp.k('request.commission_paid', pg_temp.r(1), 'c1', 'commission_received'))),
  'stale', 'R-5: past send_until ends stale');
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.profiles SET email_confirmed_at = NULL WHERE id = %L$q$, pg_temp.u('c1'))],
                        format('pg_temp.verdict(%L)', pg_temp.k('request.commission_paid', pg_temp.r(1), 'c1', 'commission_received'))),
  'unconfirmed', 'R-8: an address unconfirmed since the queue ends unconfirmed');
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.profiles SET email = 'c1-new-29@example.com' WHERE id = %L$q$, pg_temp.u('c1'))],
                        format('pg_temp.verdict(%L)', pg_temp.k('request.commission_paid', pg_temp.r(1), 'c1', 'commission_received'))),
  'unconfirmed', 'R-8: an address changed since the queue gets nothing until confirmed');
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.profiles SET email = 'c1-new-29@example.com' WHERE id = %L$q$, pg_temp.u('c1')),
                              format($q$UPDATE public.profiles SET email_confirmed_at = now() WHERE id = %L$q$, pg_temp.u('c1'))],
                        format($q$pg_temp.ctx(%L) ->> 'email'$q$, pg_temp.k('request.commission_paid', pg_temp.r(1), 'c1', 'commission_received'))),
  'c1-new-29@example.com', 'R-8: then it goes to the new address');
SELECT is(pg_temp.err(format('SELECT public.email_context(%L)', gen_random_uuid())), 'not_found', 'R-8: an unknown row');
SELECT is(pg_temp.err(format('SELECT public.email_context(%L)', (SELECT id FROM public.outbox_events WHERE kind <> 'email.send' ORDER BY created_at DESC, id LIMIT 1))),
  'invalid_state', 'R-8: never a payment row');

-- ══ AC-7, R-9: confirming an address ═════════════════════════════════════════
SELECT is(pg_temp.resend('c2'), 'no_email', 'AC-7: no address, nothing to confirm');
SELECT is(pg_temp.resend('c1'), 'already_confirmed', 'AC-7: already confirmed');
SELECT is(pg_temp.resend('anon'), '42501', 'AC-7: anon cannot ask');
UPDATE public.profiles SET email = 'c2-29@example.com' WHERE id = pg_temp.u('c2');
CREATE TEMP TABLE c2_first AS SELECT pg_temp.live('c2') AS id;
SELECT ok((SELECT id FROM c2_first) IS NOT NULL, 'R-9: saving an address starts a confirmation in the same transaction');
SELECT is(pg_temp.tok((SELECT id FROM c2_first)) ~ '^[A-Za-z0-9_-]{43}$', true, 'R-9: 32 random bytes, base64url, in the payload');
SELECT is((SELECT token_hash FROM public.email_confirmations WHERE id = (SELECT id FROM c2_first)),
  extensions.digest(pg_temp.tok((SELECT id FROM c2_first)), 'sha256'), 'R-9: only its sha256 digest is stored');
SELECT is((SELECT email || ' ' || extract(epoch FROM expires_at - created_at)::int FROM public.email_confirmations WHERE id = (SELECT id FROM c2_first)),
  'c2-29@example.com 86400', 'AC-7: for that address, alive email_link_hours');
SELECT is(pg_temp.ctx('email:confirm:' || (SELECT id FROM c2_first)) - 'values' - 'timezone',
  '{"status": "send", "template": "confirm_email", "email": "c2-29@example.com", "locale": "tr", "region_locale": "tr"}'::jsonb,
  'AC-4: confirm_email goes to the unconfirmed address');
SELECT is(pg_temp.ctx('email:confirm:' || (SELECT id FROM c2_first)) -> 'values' ->> 'token', pg_temp.tok((SELECT id FROM c2_first)),
  'R-8: the token, for confirm_email only');
SELECT is((SELECT count::int FROM public.action_counters WHERE subject_id = pg_temp.u('c2') AND action = 'email_confirm'), 1, 'R-9: the counter counts it');
SELECT is(pg_temp.resend('c2'), '{"status": "queued"}', 'AC-7: Send link again');
CREATE TEMP TABLE c2_second AS SELECT pg_temp.live('c2') AS id;
SELECT ok((SELECT revoked_at IS NOT NULL FROM public.email_confirmations WHERE id = (SELECT id FROM c2_first))
          AND (SELECT id FROM c2_second) <> (SELECT id FROM c2_first), 'R-9: a new confirmation revokes the older one');
SELECT is((SELECT count(*)::int FROM public.email_confirmations WHERE profile_id = pg_temp.u('c2') AND used_at IS NULL AND revoked_at IS NULL), 1,
  'R-9: one live per profile');
SELECT is(pg_temp.verdict('email:confirm:' || (SELECT id FROM c2_first)), 'stale', 'R-8: a revoked confirmation''s mail ends stale');
SELECT is(pg_temp.confirm('c2', pg_temp.tok((SELECT id FROM c2_first))), 'link_expired', 'AC-7: a revoked link');
SELECT is(pg_temp.confirm('c1', pg_temp.tok((SELECT id FROM c2_second))), 'invalid_link', 'AC-7: someone else''s link');
SELECT is(pg_temp.confirm('c2', 'not-a-token'), 'invalid_link', 'AC-7: a malformed link');
SELECT is(pg_temp.confirm('c2', repeat('A', 43)), 'invalid_link', 'AC-7: an unknown link');
SELECT is(pg_temp.confirm('anon', pg_temp.tok((SELECT id FROM c2_second))), '42501', 'AC-7: never signed out');
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.email_confirmations SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = %L$q$,
                                     (SELECT id FROM c2_second))],
                        format('pg_temp.confirm(%L, %L)', 'c2', pg_temp.tok((SELECT id FROM c2_second)))),
  'link_expired', 'AC-7: an expired link');
SELECT is(pg_temp.confirm('c2', pg_temp.tok((SELECT id FROM c2_second))), '{"status": "confirmed"}', 'AC-7: the owner confirms');
SELECT ok((SELECT email_confirmed_at IS NOT NULL FROM public.profiles WHERE id = pg_temp.u('c2'))
          AND (SELECT used_at IS NOT NULL FROM public.email_confirmations WHERE id = (SELECT id FROM c2_second)),
  'AC-7: email_confirmed_at set, the confirmation used');
SELECT is(pg_temp.confirm('c2', pg_temp.tok((SELECT id FROM c2_second))), 'link_used', 'AC-7: a second use is refused');
SELECT is(pg_temp.verdict('email:confirm:' || (SELECT id FROM c2_second)), 'stale', 'R-8: a used confirmation''s mail ends stale');
SELECT is(pg_temp.resend('c2'), 'already_confirmed', 'AC-7: then nothing more to confirm');
-- The shared limit: 3 an hour, the trigger and the button together.
UPDATE public.profiles SET email = 'a3-29@example.com' WHERE id = pg_temp.u('a3');
SELECT is(pg_temp.resend('a3'), '{"status": "queued"}', 'R-9: the second this hour');
SELECT is(pg_temp.resend('a3'), '{"status": "queued"}', 'R-9: the third');
CREATE TEMP TABLE a3_third AS SELECT pg_temp.live('a3') AS id;
SELECT is(pg_temp.resend('a3'), 'rate_limited', 'R-9: the fourth is refused');
SELECT is(pg_temp.live('a3'), (SELECT id FROM a3_third), 'R-9: a refused one revokes nothing');
UPDATE public.profiles SET email = 'a3-new-29@example.com' WHERE id = pg_temp.u('a3');
SELECT is((SELECT count(*)::int FROM public.email_confirmations WHERE profile_id = pg_temp.u('a3')), 3,
  'R-9: over the limit, an address change queues nothing');
SELECT is(pg_temp.verdict('email:confirm:' || (SELECT id FROM a3_third)), 'stale', 'R-8: the address changed, the mail ends stale');
SELECT is(pg_temp.confirm('a3', pg_temp.tok((SELECT id FROM a3_third))), 'link_expired', 'AC-7: and the link no longer confirms');
SELECT is(pg_temp.probe(ARRAY[$q$UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'emails_enabled'$q$],
                        $q$pg_temp.resend('a3')$q$),
  'emails_off', 'AC-7: the button refuses while mail is off');
SELECT is(pg_temp.probe(ARRAY[$q$UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'emails_enabled'$q$,
                              format($q$UPDATE public.profiles SET email = 'c1-off-29@example.com' WHERE id = %L$q$, pg_temp.u('c1'))],
                        format($q$(SELECT count(*) FROM public.email_confirmations WHERE profile_id = %L)$q$, pg_temp.u('c1'))),
  '0', 'R-3: no confirmation is started while mail is off');

-- ══ R-12, AC-11: the two lanes; R-11: finish_email; R-9: the token strip ══════
-- Rows other files committed (19, 28) and this file's are set aside, so each lane sees only the rows below.
UPDATE public.outbox_events SET status = 'done', done_at = now(), next_attempt_at = NULL WHERE status IN ('pending', 'claimed');
SELECT is_empty($$ SELECT id FROM public.outbox_events WHERE kind = 'email.send' AND status IN ('done', 'failed') AND payload ? 'token' $$,
  'R-9: a row that ends, by any update, loses its token');
CREATE TEMP TABLE lane AS SELECT
  pg_temp.mail_row('email:29:lane:sent', jsonb_build_object('template', 'account_rejected', 'recipient_id', pg_temp.u('a1'), 'request_id', NULL,
                   'entity_id', pg_temp.u('a1'), 'send_until', now() + interval '1 hour', 'token', 'x')) AS sent,
  pg_temp.mail_row('email:29:lane:rejected', jsonb_build_object('template', 'confirm_email', 'recipient_id', pg_temp.u('a1'), 'request_id', NULL,
                   'entity_id', gen_random_uuid(), 'send_until', now() + interval '1 hour', 'token', 'y')) AS rejected,
  pg_temp.mail_row('email:29:lane:retry', jsonb_build_object('template', 'account_rejected', 'recipient_id', pg_temp.u('a1'), 'request_id', NULL,
                   'entity_id', pg_temp.u('a1'), 'send_until', now() + interval '1 hour')) AS retry,
  pg_temp.mail_row('email:29:lane:skip', jsonb_build_object('template', 'account_rejected', 'recipient_id', pg_temp.u('a1'), 'request_id', NULL,
                   'entity_id', pg_temp.u('a1'), 'send_until', now() + interval '1 hour')) AS skip,
  pg_temp.mail_row('email:29:lane:last', jsonb_build_object('template', 'account_rejected', 'recipient_id', pg_temp.u('a1'), 'request_id', NULL,
                   'entity_id', pg_temp.u('a1'), 'send_until', now() + interval '1 hour'), 'pending', 5) AS last,
  pg_temp.mail_row('email:29:lane:dead', jsonb_build_object('template', 'confirm_email', 'recipient_id', pg_temp.u('a1'), 'request_id', NULL,
                   'entity_id', gen_random_uuid(), 'send_until', now() + interval '1 hour', 'token', 'z'), 'claimed', 6,
                   now() - interval '3 minutes') AS dead;
INSERT INTO public.outbox_events (region, kind, idempotency_key, payload) VALUES ('TR', 'payment.verify', 'verify:29:lane', '{}');
SELECT is((SELECT jsonb_agg(x ->> 'kind') FROM jsonb_array_elements(public.claim_outbox(100, 'worker-29')) x), '["payment.verify"]'::jsonb,
  'R-12: claim_outbox never returns mail');
SELECT is((SELECT status FROM public.outbox_events WHERE id = (SELECT dead FROM lane)), 'claimed',
  'R-12: nor ends a mail lease');
CREATE TEMP TABLE claimed AS SELECT public.claim_email_outbox(100, 'worker-29e') AS j;
SELECT is((SELECT count(*)::int FROM claimed, jsonb_array_elements(j) x WHERE x ->> 'kind' = 'email.send'), 5,
  'R-12: claim_email_outbox claims the five due mails');
SELECT is((SELECT count(*)::int FROM claimed, jsonb_array_elements(j) x WHERE x ->> 'kind' <> 'email.send'), 0, 'R-12: and nothing else');
SELECT is((SELECT status || ' ' || last_error FROM public.outbox_events WHERE id = (SELECT dead FROM lane)), 'failed lease_expired',
  'R-12: an expired lease after the sixth try fails the row');
SELECT ok(NOT (SELECT payload ? 'token' FROM public.outbox_events WHERE id = (SELECT dead FROM lane)), 'R-9: and drops its token');
SELECT is(public.finish_email((SELECT sent FROM lane), 'sent', pg_temp.ctoken((SELECT sent FROM lane))) ->> 'status', 'done', 'R-11: sent is done');
SELECT ok((SELECT last_error IS NULL AND done_at IS NOT NULL AND NOT payload ? 'token' FROM public.outbox_events WHERE id = (SELECT sent FROM lane)),
  'R-9: done, no error, no token');
SELECT is(public.finish_email((SELECT rejected FROM lane), 'rejected', pg_temp.ctoken((SELECT rejected FROM lane)), 'http_422:validation_error') ->> 'status',
  'failed', 'R-11: rejected fails at once');
SELECT ok((SELECT last_error = 'http_422:validation_error' AND NOT payload ? 'token' FROM public.outbox_events WHERE id = (SELECT rejected FROM lane)),
  'R-11, R-9: the status and the error name are kept; the token is gone');
SELECT is(public.finish_email((SELECT retry FROM lane), 'retry', pg_temp.ctoken((SELECT retry FROM lane)), 'Mailbox a1-29@example.com is full') ->> 'status',
  'pending', 'R-11: retry goes back to pending');
SELECT ok((SELECT last_error = 'retry' AND next_attempt_at BETWEEN now() + interval '59 seconds' AND now() + interval '61 seconds'
             FROM public.outbox_events WHERE id = (SELECT retry FROM lane)),
  'R-11: on 07''s backoff, and a detail that is not a code is never stored');
SELECT is(public.finish_email((SELECT skip FROM lane), 'condition', pg_temp.ctoken((SELECT skip FROM lane))) ->> 'status', 'done', 'R-12: a skip is done');
SELECT is((SELECT last_error FROM public.outbox_events WHERE id = (SELECT skip FROM lane)), 'condition', 'R-12: with the outcome kept');
SELECT is(public.finish_email((SELECT last FROM lane), 'retry', pg_temp.ctoken((SELECT last FROM lane))) ->> 'status', 'failed',
  'R-12: a retry after the sixth try fails');
SELECT is(public.finish_email((SELECT sent FROM lane), 'sent', pg_temp.ctoken((SELECT sent FROM lane))) ->> 'stale', 'true',
  'R-12: a finished row answers stale');
SELECT is(pg_temp.err(format('SELECT public.finish_email(%L, %L, now())', (SELECT sent FROM lane), 'bounced')), 'validation_failed',
  'R-12: only the known outcomes');
SELECT is(pg_temp.err(format('SELECT public.finish_email(%L, %L, now())', gen_random_uuid(), 'sent')), 'not_found', 'R-12: an unknown row');
SELECT is(pg_temp.err(format('SELECT public.finish_email(%L, %L, now())', (SELECT id FROM public.outbox_events WHERE idempotency_key = 'verify:29:lane'), 'sent')),
  'invalid_state', 'R-12: never a payment row');
SELECT is(pg_temp.err($$SELECT public.claim_email_outbox(10, '')$$), 'validation_failed', 'R-12: a worker name is required');

-- ══ R-10, AC-10: the apply gate ═══════════════════════════════════════════════
SELECT pg_temp.req(7, 'c1', 10000, ARRAY[]::text[]);
SELECT is(pg_temp.probe(ARRAY[$q$UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'apply_needs_email'$q$],
                        $q$pg_temp.offer(7, 'a3')$q$),
  'email_unconfirmed', 'R-10: on, a provider without a confirmed address cannot apply');
SELECT is(pg_temp.probe(ARRAY[$q$UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'apply_needs_email'$q$],
                        $q$pg_temp.offer(7, 'a1')$q$),
  'none', 'R-10: on, a confirmed provider applies');
SELECT is(pg_temp.probe(ARRAY[]::text[], $q$pg_temp.offer(7, 'a3')$q$), 'none', 'R-10: off, anyone applies');
SELECT is(pg_temp.probe(ARRAY[$q$UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'apply_needs_email'$q$,
                              'ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $q$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'pay_reminder_hours'$q$],
                        $q$pg_temp.offer(7, 'a1')$q$),
  'none', 'D192: a broken reminder setting never stops applying');

-- ══ R-2: mail never breaks a move ════════════════════════════════════════════
SELECT pg_temp.req(8, 'c1', 10000, ARRAY['a1']);
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $q$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'confirm_reminder_hours'$q$,
                              format($q$SELECT pg_temp.choose(8, 'a1')$q$)],
                        format($q$(SELECT status FROM public.requests WHERE id = %L) || ' ' ||
                                  (SELECT status || ' ' || last_error || ' ' || (payload ? 'sqlstate')::text FROM public.outbox_events
                                    WHERE idempotency_key = 'email:' || (SELECT max(id) FROM public.audit_log WHERE action = 'request.provider_chosen' AND entity_id = %L) || ':queue_failed')$q$,
                               pg_temp.r(8), pg_temp.r(8)::text)),
  'SELECTED failed queue_failed:P0001 true', 'R-2: a mapping error writes one failed row and the pick still commits');
SELECT is(pg_temp.probe(ARRAY['ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard',
                              $q$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'confirm_reminder_hours'$q$,
                              format($q$INSERT INTO public.applications (id, region, request_id, provider_id, message)
                                        VALUES ('00000000-0000-0000-0000-000000299902', 'TR', %L, %L, 'An offer while a setting is broken, long enough.')$q$,
                                     pg_temp.r(8), pg_temp.u('a2'))],
                        $q$(SELECT count(*) FROM public.applications WHERE id = '00000000-0000-0000-0000-000000299902') || ' ' ||
                           (SELECT status FROM public.outbox_events WHERE idempotency_key = 'email:offer:00000000-0000-0000-0000-000000299902:queue_failed')$q$),
  '1 failed', 'R-2: and an offer still lands');

-- ══ AC-6: the reminders ══════════════════════════════════════════════════════
SELECT pg_temp.req(10); SELECT pg_temp.choose(10, 'a1'); SELECT pg_temp.age(10, 'pay_soon');
SELECT pg_temp.req(11); SELECT pg_temp.choose(11, 'a1'); SELECT pg_temp.age(11, 'pay_short');
SELECT pg_temp.req(12); SELECT pg_temp.choose(12, 'a1'); SELECT pg_temp.age(12, 'pay_passed');
SELECT pg_temp.req(13); SELECT pg_temp.choose(13, 'a1'); SELECT pg_temp.age(13, 'pay_far');
-- A commission of 0 settles at once (D171), so the provider's fee window opens with no fee row.
SELECT pg_temp.req(14, 'c1', 0);
SELECT pg_temp.choose(14, 'a2');
SELECT pg_temp.call_as('c1', format('SELECT public.pay_commission(%L, %L, NULL)::text', pg_temp.r(14), 'tr'));
SELECT is(pg_temp.ctx(pg_temp.k('request.commission_paid', pg_temp.r(14), 'c1', 'commission_received')) -> 'values' ->> 'amount', '0',
  'D171: a commission of 0 is mailed as 0');
SELECT is(pg_temp.ctx(pg_temp.k('request.commission_paid', pg_temp.r(14), 'c1', 'commission_received')) -> 'values' ->> 'fee_id', NULL,
  'D171: with no receipt');
SELECT pg_temp.age(14, 'fee_soon');
SELECT pg_temp.age(1, 'confirm_soon');
SELECT is(pg_temp.probe(ARRAY[$q$UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'emails_enabled'$q$],
                        'public.queue_reminders()'),
  '0', 'AC-6: nothing while the switch is off');
SELECT is(public.queue_reminders() >= 2, true, 'AC-6: the run writes the due reminders');
SELECT is((SELECT (payload ->> 'send_until')::timestamptz FROM public.outbox_events
            WHERE idempotency_key = 'email:' || pg_temp.app(10, 'a1') || ':commission:pay_window_closing'),
  (SELECT payment_deadline FROM public.requests WHERE id = pg_temp.r(10)), 'AC-6: the customer''s reminder, keyed, until the deadline');
SELECT is(pg_temp.verdict('email:' || pg_temp.app(10, 'a1') || ':commission:pay_window_closing'), 'send', 'AC-6: and it sends while SELECTED on it');
SELECT is(pg_temp.verdict('email:' || pg_temp.app(11, 'a1') || ':commission:pay_window_closing'), 'missing', 'AC-6: a window shorter than the lead is skipped');
SELECT is(pg_temp.verdict('email:' || pg_temp.app(12, 'a1') || ':commission:pay_window_closing'), 'missing', 'AC-6: a passed deadline is skipped');
SELECT is(pg_temp.verdict('email:' || pg_temp.app(13, 'a1') || ':commission:pay_window_closing'), 'missing', 'AC-6: a deadline beyond the lead is not yet due');
SELECT is((SELECT pg_temp.who((payload ->> 'recipient_id')::uuid) FROM public.outbox_events
            WHERE idempotency_key = 'email:' || pg_temp.app(14, 'a2') || ':provider_fee:pay_window_closing'), 'a2',
  'AC-6: the chosen provider''s reminder');
SELECT is(pg_temp.ctx('email:' || pg_temp.app(14, 'a2') || ':provider_fee:pay_window_closing') -> 'values' ->> 'side', 'provider',
  'D192: the provider''s side of pay_window_closing');
SELECT is(pg_temp.verdict('email:' || pg_temp.r(1) || ':closes_soon:' || (SELECT floor(extract(epoch from confirm_deadline))::bigint FROM public.requests WHERE id = pg_temp.r(1))), 'missing', 'AC-6: no closes_soon while auto close is off');
SELECT is(public.queue_reminders(), 0, 'AC-6: a second run writes nothing');
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'auto_close_enabled';
SELECT is(public.queue_reminders(), 1, 'AC-6: with auto close on, the confirm window''s reminder');
SELECT is(pg_temp.verdict('email:' || pg_temp.r(1) || ':closes_soon:' || (SELECT floor(extract(epoch from confirm_deadline))::bigint FROM public.requests WHERE id = pg_temp.r(1))), 'send', 'AC-6: closes_soon sends while AWAITING_CONFIRMATION');
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'auto_close_enabled';
SELECT is(pg_temp.probe(ARRAY[format($q$SELECT pg_temp.age(13, 'pay_soon')$q$)], 'public.queue_reminders()'), '1',
  'AC-6: a window that comes inside the lead is taken on a later run');

-- ══ R-9: the housekeeping ════════════════════════════════════════════════════
INSERT INTO public.email_confirmations (region, profile_id, email, token_hash, expires_at, used_at, created_at) VALUES
  ('TR', pg_temp.u('c1'), 'c1-29@example.com', extensions.digest('old-29', 'sha256'), now() - interval '39 days', now() - interval '39 days 12 hours', now() - interval '40 days'),
  ('TR', pg_temp.u('c1'), 'c1-29@example.com', extensions.digest('recent-29', 'sha256'), now() - interval '1 day', NULL, now() - interval '2 days');
UPDATE public.email_confirmations SET revoked_at = now() - interval '1 day' WHERE token_hash = extensions.digest('recent-29', 'sha256');
SELECT is(public.emails_housekeeping() >= 1, true, 'R-9: the daily job deletes');
SELECT is((SELECT count(*)::int FROM public.email_confirmations WHERE token_hash = extensions.digest('old-29', 'sha256')), 0,
  'R-9: a confirmation ended over 30 days ago');
SELECT is((SELECT count(*)::int FROM public.email_confirmations WHERE profile_id IN (pg_temp.u('c1'), pg_temp.u('c2'), pg_temp.u('a3'))), 6,
  'R-9: and keeps the rest');

-- ══ Grants (AC-12) ═══════════════════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default", has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            has_function_privilege('service_role', p.oid, 'EXECUTE')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('apply_needs_email', 'applications_need_email', 'applications_offer_email', 'audit_log_email', 'claim_email_outbox',
                          'claim_outbox', 'confirm_email', 'email_context', 'email_settings', 'emails_enabled', 'emails_housekeeping',
                          'finish_email', 'outbox_strip_token', 'queue_audit_email', 'queue_audit_mail', 'queue_email', 'queue_offer_email',
                          'queue_reminders', 'relay_kick', 'request_email_confirmation', 'start_email_confirmation')
      ORDER BY p.proname COLLATE "C" $$,
  $$ VALUES ('applications_need_email'::text, false, false, false), ('applications_offer_email', false, false, false),
            ('apply_needs_email', false, false, false), ('audit_log_email', false, false, false),
            ('claim_email_outbox', false, false, true), ('claim_outbox', false, false, true), ('confirm_email', false, true, false),
            ('email_context', false, false, true), ('email_settings', false, false, false), ('emails_enabled', false, false, false),
            ('emails_housekeeping', false, false, false), ('finish_email', false, false, true), ('outbox_strip_token', false, false, false),
            ('queue_audit_email', false, false, false), ('queue_audit_mail', false, false, false), ('queue_email', false, false, false),
            ('queue_offer_email', false, false, false), ('queue_reminders', false, false, false), ('relay_kick', false, false, false),
            ('request_email_confirmation', false, true, false), ('start_email_confirmation', false, false, false) $$,
  'AC-12: no anon or authenticated grant on the internals; service role on the three relay functions; authenticated on the two confirmation functions');
SELECT ok((SELECT bool_and(p.prosecdef) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('audit_log_email', 'applications_offer_email', 'applications_need_email',
                                                         'queue_audit_email', 'queue_offer_email')),
  'Security model: the trigger bodies are security definer');

-- ══ AC-3: the trigger's when list is the map ═════════════════════════════════
SELECT is(
  (SELECT array_to_string(array_agg(m[1] ORDER BY m[1] COLLATE "C"), ',') COLLATE "default"
     FROM pg_trigger t, regexp_matches(pg_get_triggerdef(t.oid), '''([a-z_]+\.[a-z_]+)''', 'g') AS m
    WHERE t.tgname = 'audit_log_email' AND t.tgrelid = 'public.audit_log'::regclass),
  array_to_string(ARRAY['fee.late', 'fee.refund_done_by_hand', 'fee.refunded', 'job.auto_closed', 'job.closed_by_admin', 'job.confirmed',
        'job.customer_closed', 'job.done', 'job.started', 'profile.email_changed', 'provider.approved', 'provider.reinstated', 'provider.rejected',
        'provider.suspended', 'report.handled', 'report.opened', 'request.admin_cancelled', 'request.cancelled', 'request.commission_paid', 'request.failed_picks_limit', 'request.fee_expired', 'request.no_paid_pick',
        'request.pick_dropped', 'request.pick_expired', 'request.provider_cancelled', 'request.provider_chosen', 'request.provider_withdrew',
        'request.unlocked'], ','),
  'AC-3: the trigger fires on exactly the map''s actions');
SELECT results_eq(
  $$ SELECT tgname::text COLLATE "default" FROM pg_trigger WHERE tgrelid IN ('public.applications'::regclass, 'public.outbox_events'::regclass)
       AND tgname IN ('applications_offer_email', 'applications_need_email', 'outbox_strip_token') ORDER BY tgname COLLATE "C" $$,
  $$ VALUES ('applications_need_email'::text), ('applications_offer_email'), ('outbox_strip_token') $$,
  'R-1, R-9, R-10: the other three triggers');
SELECT ok('outbox_events_guard' < 'outbox_strip_token'::text COLLATE "C", 'D192: the guard fires before the strip (name order)');

-- ══ The schedules ════════════════════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT jobname::text, schedule::text, command::text FROM cron.job
      WHERE jobname IN ('relay-email', 'emails-reminders', 'emails-housekeeping') ORDER BY jobname COLLATE "C" $$,
  $$ VALUES ('emails-housekeeping'::text, '17 3 * * *'::text, 'select public.emails_housekeeping()'::text),
            ('emails-reminders', '*/15 * * * *', 'select public.queue_reminders()'),
            ('relay-email', '* * * * *', 'select public.relay_kick(''email'')') $$,
  'R-12, AC-6, R-9: the three jobs');
SELECT is(public.relay_kick('email'), NULL, 'R-12: relay_kick takes the email task (no Vault here, so no call)');

-- ══ R-1, R-6: what a payload may hold (security review 2026-11-19) ═════════
SELECT is_empty($$ SELECT o.id FROM public.outbox_events o
                    WHERE o.kind = 'email.send'
                      AND NOT ((SELECT array_agg(k) FROM jsonb_object_keys(o.payload) k)
                                 <@ ARRAY['template', 'recipient_id', 'request_id', 'entity_id', 'send_until', 'token']::text[]
                               OR (SELECT array_agg(k) FROM jsonb_object_keys(o.payload) k)
                                 <@ ARRAY['audit_id', 'application_id', 'sqlstate']::text[]) $$,
  'R-1: a mail payload holds ids, the template, send_until and the token, or a queue failure''s id and SQLSTATE; never a value');
SELECT is_empty($$ SELECT o.id FROM public.outbox_events o
                    WHERE o.kind = 'email.send' AND o.payload ? 'token' AND o.payload ->> 'template' IS DISTINCT FROM 'confirm_email' $$,
  'R-9: only confirm_email ever carries a token');

SELECT * FROM finish();
ROLLBACK;
