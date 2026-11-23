-- Position 18, spec 0011-18 (D209): the in app notification centre and live status.
--
-- The table, its RLS, policy, grants and guard (AC-4, R-8); the notice writers on a real request (new_offer, chosen,
-- commission_received, pay_your_fee, contacts_ready) and on synthetic audit rows (AC-2); notices written whatever the
-- mail does (R-4), parity with the mail rows (AC-2), the switch (R-4), a replay (R-7); R-2's isolation both ways and
-- its forced error (X-5); the reminders with mail off (R-13, X-7); the readers and writers for the browser (AC-5,
-- AC-6); the ping and the Realtime policy (R-9, R-11, AC-11); housekeeping (AC-13); every grant; the two `when`
-- lists (R-3); the cron job.
--
-- Race tests commit rows through dblink, so every assertion here is scoped to this file's own ids.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(93);

SET CONSTRAINTS ALL IMMEDIATE;

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003700' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003770' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.app(p integer, w text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-00000037' || CASE w WHEN 'a1' THEN '81' ELSE '82' END
          || lpad(p::text, 2, '0'))::uuid $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1 a customer with a confirmed address, c2 one without; a1 a provider with a confirmed address, a2 one without;
-- ad an admin.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559370001'), ('c2', '905559370002'), ('a1', '905559370003'), ('a2', '905559370004'),
               ('ad', '905559370006')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale, email, email_confirmed_at)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'tr', e, CASE WHEN e IS NOT NULL THEN now() END
  FROM (VALUES ('c1', 'customer', '905559370001', 'Bildirim Müşteri', 'c1-37@example.com'),
               ('c2', 'customer', '905559370002', 'Adressiz', NULL),
               ('a1', 'provider', '905559370003', 'Bir Usta', 'a1-37@example.com'),
               ('a2', 'provider', '905559370004', 'İki Usta', NULL),
               ('ad', 'admin', '905559370006', 'Yönetici', NULL)) AS t(c, r, p, n, e);
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Usta'
 WHERE id IN (pg_temp.u('a1'), pg_temp.u('a2'));
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Bildirim"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Temizlik", "en": "Cleaning"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Moda"}', 1.00, true);
UPDATE public.platform_settings SET value = 'true'
 WHERE region = 'TR' AND key IN ('payments_enabled', 'emails_enabled', 'notifications_enabled');
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key IN ('apply_needs_email', 'auto_close_enabled');

CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.req(p integer, c text DEFAULT 'c1', p_apps text[] DEFAULT ARRAY['a1', 'a2']) RETURNS uuid
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at, notes)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u(c), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100, "service": {"name": {"tr": "Temizlik", "en": "Cleaning"}}, "secret": "x"}', 100000, 10000,
    90000, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours', 'Ring twice');
  INSERT INTO public.request_addresses (request_id, region, customer_id, line) VALUES (pg_temp.r(p), 'TR', pg_temp.u(c), 'Moda Cad. No 9');
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT pg_temp.app(p, w), 'TR', pg_temp.r(p), pg_temp.u(w), 'An offer for the notice tests, long enough to pass.'
    FROM unnest(p_apps) w;
  RETURN pg_temp.r(p);
END $$;
CREATE FUNCTION pg_temp.choose(p integer, w text, c text DEFAULT 'c1') RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(c);
  RETURN public.choose_provider(pg_temp.r(p), pg_temp.app(p, w), 'draft-1');
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
  v_att := (public.pay_commission(pg_temp.r(p), 'tr', NULL, 'draft-1') ->> 'attempt_id')::uuid;
  RETURN public.apply_fee_paid(pg_temp.cfee(p), v_att, 'pay-37-c' || p, 10000, 'TRY', 300);
END $$;
CREATE FUNCTION pg_temp.payfee(p integer, w text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_att uuid;
BEGIN
  PERFORM pg_temp.as_user(w);
  v_att := (public.pay_provider_fee(pg_temp.app(p, w), 'tr', NULL, 'draft-1') ->> 'attempt_id')::uuid;
  RETURN public.apply_fee_paid(pg_temp.pfee(p, w), v_att, 'pay-37-p' || p || w, 5000, 'TRY', 150);
END $$;
-- Run p_sql as p_user ('anon' or one of this file's people); the error code or message, else the first value.
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
-- The notices of one of this file's people, of one kind (all kinds when null).
CREATE FUNCTION pg_temp.n(p_who text, p_kind text DEFAULT NULL) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM public.notifications
   WHERE recipient_id = pg_temp.u(p_who) AND (p_kind IS NULL OR kind = p_kind) $$;
-- The mail rows of one of this file's people, of one template.
CREATE FUNCTION pg_temp.m(p_who text, p_template text) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM public.outbox_events
   WHERE kind = 'email.send' AND payload ->> 'recipient_id' = pg_temp.u(p_who)::text AND payload ->> 'template' = p_template $$;
-- The latest audit row of one action on one of this file's requests.
CREATE FUNCTION pg_temp.audit(p integer, p_action text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT max(id) FROM public.audit_log WHERE entity_id = pg_temp.r(p)::text AND action = p_action $$;
-- Whether Realtime can hold a ping here: its table, and today's partition (CI's database only start may have neither;
-- realtime.send swallows its own insert error, so a missing partition reads as no ping).
CREATE FUNCTION pg_temp.rt_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT to_regclass('realtime.messages') IS NOT NULL
     AND to_regclass('realtime.messages_' || to_char(now() AT TIME ZONE 'utc', 'YYYY_MM_DD')) IS NOT NULL $$;
-- The pings on one person's topic, where Realtime can hold them.
CREATE FUNCTION pg_temp.pings(p_who text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v integer;
BEGIN
  IF NOT pg_temp.rt_ready() THEN
    RETURN -1;
  END IF;
  EXECUTE 'SELECT count(*)::integer FROM realtime.messages WHERE topic = $1 AND extension = ''broadcast'' AND private'
     INTO v USING 'notices:' || pg_temp.u(p_who)::text;
  RETURN v;
END $$;

-- ══ AC-4, R-8: the table ═════════════════════════════════════════════════════
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notifications'::regclass), 'AC-4: RLS is on');
SELECT is((SELECT array_agg(polname::text) FROM pg_policy WHERE polrelid = 'public.notifications'::regclass),
          ARRAY['notifications_read_own'], 'R-8: one policy, the own row read');
SELECT ok(NOT has_table_privilege('authenticated', 'public.notifications', 'select')
          AND NOT has_table_privilege('authenticated', 'public.notifications', 'update')
          AND NOT has_table_privilege('authenticated', 'public.notifications', 'insert')
          AND NOT has_table_privilege('anon', 'public.notifications', 'select')
          AND NOT has_table_privilege('service_role', 'public.notifications', 'select'),
  'R-8: no table grant to any API role');
SELECT is(pg_temp.call_as('c1', 'SELECT count(*)::text FROM public.notifications'), '42501',
  'R-8: a direct read is refused for a signed in user');
SELECT is(pg_temp.call_as('anon', 'SELECT count(*)::text FROM public.notifications'), '42501',
  'R-8: and for anon');

-- ══ AC-2: the writers on a real request ══════════════════════════════════════
SELECT pg_temp.req(1);
SELECT is(pg_temp.n('c1', 'new_offer'), 2, 'AC-2: one new_offer notice per offer');
SELECT is((SELECT count(*)::integer FROM public.notifications
            WHERE dedupe_key IN ('notice:offer:' || pg_temp.app(1, 'a1'), 'notice:offer:' || pg_temp.app(1, 'a2'))),
          2, 'R-7: the offer key');
SELECT is((SELECT request_id FROM public.notifications WHERE dedupe_key = 'notice:offer:' || pg_temp.app(1, 'a1')),
          pg_temp.r(1), 'AC-4: the notice names the request');

SELECT pg_temp.choose(1, 'a1');
SELECT is(pg_temp.n('a1', 'chosen'), 1, 'AC-2: chosen, to the chosen provider');
SELECT is((SELECT dedupe_key FROM public.notifications WHERE recipient_id = pg_temp.u('a1') AND kind = 'chosen'),
          'notice:' || pg_temp.audit(1, 'request.provider_chosen') || ':' || pg_temp.u('a1') || ':chosen',
          'R-7: the audit key');
SELECT pg_temp.paycom(1);
SELECT is(pg_temp.n('c1', 'commission_received'), 1, 'AC-2: commission_received, to the customer');
SELECT is(pg_temp.n('a1', 'pay_your_fee'), 1, 'AC-2: pay_your_fee, to the chosen provider');
SELECT is((SELECT deadline_at FROM public.notifications WHERE recipient_id = pg_temp.u('a1') AND kind = 'pay_your_fee'),
          (SELECT fee_deadline FROM public.requests WHERE id = pg_temp.r(1)), 'AC-4: deadline_at is the fee deadline');
SELECT is((SELECT deadline_at FROM public.notifications WHERE recipient_id = pg_temp.u('c1') AND kind = 'commission_received'),
          NULL::timestamptz, 'AC-4: no deadline where the event names none');
SELECT pg_temp.payfee(1, 'a1');
SELECT is(pg_temp.n('c1', 'contacts_ready') + pg_temp.n('a1', 'contacts_ready'), 2, 'AC-2: contacts_ready, to both');

-- Parity: with mail on and both addresses confirmed, the notice set equals the mail set (AC-2).
SELECT is(
  (SELECT array_agg(x ORDER BY x COLLATE "C") FROM (
     SELECT n.recipient_id::text || ':' || n.kind AS x FROM public.notifications n
      WHERE n.request_id = pg_temp.r(1)) s),
  (SELECT array_agg(x ORDER BY x COLLATE "C") FROM (
     SELECT o.payload ->> 'recipient_id' || ':' || (o.payload ->> 'template') AS x FROM public.outbox_events o
      WHERE o.kind = 'email.send' AND o.payload ->> 'request_id' = pg_temp.r(1)::text) s),
  'AC-2: the notices equal the mails for the same moves');
-- Every audit row of request 1 left exactly the in app rows audit_notices names for it.
SELECT is(
  (SELECT bool_and((SELECT count(*) FROM public.audit_notices(a.id) m WHERE m.o_kind NOT IN ('confirm_email', 'password_changed'))
                   = (SELECT count(*) FROM public.notifications n WHERE n.dedupe_key LIKE 'notice:' || a.id || ':%'))
     FROM public.audit_log a WHERE a.entity_id = pg_temp.r(1)::text),
  true, 'R-1: each audit row left the notices of its map rows');
SELECT is(pg_temp.pings('a1') <> 0, true, 'R-9: a notice sends its recipient a ping on notices:<id> (or Realtime is absent here)');

-- R-4: a person without a confirmed address still gets every notice, and no mail.
SELECT pg_temp.req(2, 'c2', ARRAY['a2']);
SELECT is(pg_temp.n('c2', 'new_offer'), 1, 'R-4: a customer with no address gets the notice');
SELECT is(pg_temp.m('c2', 'new_offer'), 0, 'R-4: and no mail');
SELECT pg_temp.choose(2, 'a2', 'c2');
SELECT is(pg_temp.n('a2', 'chosen'), 1, 'R-4: a provider with no address gets the notice');
SELECT is(pg_temp.m('a2', 'chosen'), 0, 'R-4: and no mail');

-- R-7: a replay writes nothing twice.
SELECT is(public.queue_audit_notices(pg_temp.audit(1, 'request.provider_chosen')), 0, 'R-7: a replay writes nothing');
SELECT is(public.queue_offer_notice(pg_temp.app(1, 'a1')), 0, 'R-7: an offer replay writes nothing');
SELECT is(pg_temp.n('a1', 'chosen'), 1, 'R-7: still one chosen notice');

-- R-4: mail off, notices on.
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'emails_enabled';
SELECT pg_temp.req(3);
SELECT pg_temp.choose(3, 'a1');
SELECT is((SELECT count(*)::integer FROM public.notifications WHERE request_id = pg_temp.r(3)), 3,
  'R-4: with mail off, the two offers and the pick still leave notices');
SELECT is((SELECT count(*)::integer FROM public.outbox_events
            WHERE kind = 'email.send' AND payload ->> 'request_id' = pg_temp.r(3)::text), 0, 'R-4: and no mail is queued');
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'emails_enabled';

-- R-4: the switch. notifications_enabled off writes nothing; mail still goes.
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'notifications_enabled';
SELECT pg_temp.req(4);
SELECT pg_temp.choose(4, 'a1');
SELECT is((SELECT count(*)::integer FROM public.notifications WHERE request_id = pg_temp.r(4)), 0,
  'R-4: with the switch off, no notice');
SELECT is(pg_temp.m('a1', 'chosen') >= 2, true, 'R-2: the mail of that pick still went');
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'notifications_enabled';
SELECT is(public.notices_enabled('KSA'), false, 'R-4: KSA keeps notices off');
SELECT is(public.notices_enabled('XX'), false, 'R-4: a region with no row is off');

-- ══ R-2, X-5: each channel fails on its own ═════════════════════════════════
-- A notice failure: a constraint that refuses `chosen`, added and dropped inside this transaction.
SELECT pg_temp.req(5);
ALTER TABLE public.notifications ADD CONSTRAINT t37_refuse_chosen CHECK (kind <> 'chosen') NOT VALID;
SELECT pg_temp.choose(5, 'a1');
ALTER TABLE public.notifications DROP CONSTRAINT t37_refuse_chosen;
SELECT is((SELECT status FROM public.requests WHERE id = pg_temp.r(5)), 'SELECTED', 'R-2: the move commits when the notice fails');
SELECT is((SELECT status FROM public.outbox_events
            WHERE idempotency_key = 'notice:' || pg_temp.audit(5, 'request.provider_chosen') || ':queue_failed'),
          'failed', 'R-2: the notice failure leaves one failed row with the notice: key');
SELECT is((SELECT payload ? 'sqlstate' AND payload ? 'audit_id' AND NOT payload ? 'recipient_id' FROM public.outbox_events
            WHERE idempotency_key = 'notice:' || pg_temp.audit(5, 'request.provider_chosen') || ':queue_failed'),
          true, 'R-2: ids and the SQLSTATE only');
SELECT is((SELECT count(*)::integer FROM public.outbox_events
            WHERE kind = 'email.send' AND status = 'pending' AND payload ->> 'request_id' = pg_temp.r(5)::text
              AND payload ->> 'template' = 'chosen'), 1, 'R-2: the mail of the same move still went');
-- A mail failure: a broken mail setting fails the mail path, and the notice still lands.
SELECT pg_temp.req(6);
ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard;
CREATE TEMP TABLE t37_setting AS
  SELECT * FROM public.platform_settings WHERE region = 'TR' AND key = 'confirm_reminder_hours';
DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'confirm_reminder_hours';
SELECT pg_temp.choose(6, 'a1');
SELECT is((SELECT status FROM public.outbox_events
            WHERE idempotency_key = 'email:' || pg_temp.audit(6, 'request.provider_chosen') || ':queue_failed'),
          'failed', 'R-2: the mail path failed');
SELECT is((SELECT count(*)::integer FROM public.notifications WHERE request_id = pg_temp.r(6) AND kind = 'chosen'), 1,
  'R-2: the notice of the same move still landed');

-- ══ R-13, X-7: the reminders ═════════════════════════════════════════════════
-- Bad mail settings skip the region for both channels.
SELECT pg_temp.req(7);
SELECT pg_temp.choose(7, 'a1');
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
UPDATE public.requests SET selected_at = now() - interval '6 hours', payment_deadline = now() + interval '3 hours'
 WHERE id = pg_temp.r(7);
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
SELECT public.queue_reminders();
SELECT is((SELECT count(*)::integer FROM public.notifications WHERE request_id = pg_temp.r(7) AND kind = 'pay_window_closing'), 0,
  'X-7: a bad mail setting skips the reminders of both channels');
INSERT INTO public.platform_settings SELECT * FROM t37_setting;
ALTER TABLE public.platform_settings ENABLE TRIGGER pricing_settings_guard;
-- Mail off: the notice still goes, and the return value counts mails only.
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'emails_enabled';
SELECT is(public.queue_reminders() >= 0, true, 'X-7: the reminders run with mail off');
SELECT is((SELECT count(*)::integer FROM public.outbox_events
            WHERE idempotency_key = 'email:' || pg_temp.app(7, 'a1') || ':commission:pay_window_closing'), 0,
  'R-13: no reminder mail with mail off');
SELECT is((SELECT deadline_at FROM public.notifications
            WHERE dedupe_key = 'notice:' || pg_temp.app(7, 'a1') || ':commission:pay_window_closing'
              AND recipient_id = pg_temp.u('c1') AND kind = 'pay_window_closing'),
          (SELECT payment_deadline FROM public.requests WHERE id = pg_temp.r(7)),
  'R-13: the reminder notice, to the customer, with the deadline');
SELECT public.queue_reminders();
SELECT is((SELECT count(*)::integer FROM public.notifications WHERE request_id = pg_temp.r(7) AND kind = 'pay_window_closing'), 1,
  'R-7: a second run writes no second reminder');
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'emails_enabled';

-- ══ R-3: synthetic audit rows ════════════════════════════════════════════════
INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, region)
VALUES (pg_temp.u('ad'), 'provider.suspended', 'provider', pg_temp.u('a2')::text, 'TR');
SELECT is((SELECT request_id IS NULL AND entity_id = pg_temp.u('a2') FROM public.notifications
            WHERE recipient_id = pg_temp.u('a2') AND kind = 'account_suspended'), true,
  'R-3: an account notice has no request');
INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, region)
VALUES (pg_temp.u('a2'), 'auth.password_changed', 'profile', pg_temp.u('a2')::text, 'TR');
SELECT is((SELECT count(*)::integer FROM public.notifications
            WHERE recipient_id = pg_temp.u('a2') AND kind NOT IN ('new_offer', 'chosen', 'account_suspended')), 0,
  'R-3: a password change is mail only');
SELECT is((SELECT count(*)::integer FROM public.audit_notices(
             (SELECT max(id) FROM public.audit_log WHERE action = 'auth.password_changed' AND entity_id = pg_temp.u('a2')::text))),
          1, 'R-1: the map still names the password mail');

-- More map rows (slice review): the recipients and the deadline each one stores.
-- please_confirm while auto close is on carries the confirm deadline.
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'auto_close_enabled';
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
UPDATE public.requests SET actual_started_at = now() - interval '2 hours', actual_completed_at = now() - interval '1 hour',
       confirm_deadline = now() + interval '2 days' WHERE id = pg_temp.r(3);
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, region, new_value)
VALUES (pg_temp.u('a1'), 'job.done', 'request', pg_temp.r(3)::text, 'TR', jsonb_build_object('application_id', pg_temp.app(3, 'a1')));
SELECT is((SELECT deadline_at FROM public.notifications
            WHERE request_id = pg_temp.r(3) AND kind = 'please_confirm' AND recipient_id = pg_temp.u('c1')),
          (SELECT confirm_deadline FROM public.requests WHERE id = pg_temp.r(3)),
  'AC-2: please_confirm, to the customer, with the confirm deadline while auto close is on');
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'auto_close_enabled';
-- An automatic close: job_completed to the provider, and the rating invite to the customer until the window's end.
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
UPDATE public.requests SET status = 'COMPLETED', closed_at = now() - interval '1 hour', closed_by = 'auto' WHERE id = pg_temp.r(4);
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, region, new_value)
VALUES (NULL, 'job.auto_closed', 'request', pg_temp.r(4)::text, 'TR', jsonb_build_object('application_id', pg_temp.app(4, 'a1')));
SELECT is((SELECT count(*)::integer FROM public.notifications
            WHERE request_id = pg_temp.r(4) AND kind = 'job_completed' AND recipient_id = pg_temp.u('a1')), 1,
  'AC-2: job_completed, to the provider');
SELECT is((SELECT deadline_at FROM public.notifications
            WHERE request_id = pg_temp.r(4) AND kind = 'rate_provider' AND recipient_id = pg_temp.u('c1')),
          (SELECT closed_at FROM public.requests WHERE id = pg_temp.r(4))
            + make_interval(hours => 24 * (public.rating_settings('TR') ->> 'rating_window_days')::integer),
  'AC-2: rate_provider, to the customer, until the rating window ends');
-- An admin cancel: the customer and the provider of the pick.
INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, region, new_value)
VALUES (pg_temp.u('ad'), 'request.admin_cancelled', 'request', pg_temp.r(5)::text, 'TR', '{}');
SELECT is((SELECT array_agg(recipient_id ORDER BY recipient_id) FROM public.notifications
            WHERE request_id = pg_temp.r(5) AND kind = 'request_cancelled'),
          (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.u('c1'), pg_temp.u('a1')]) x),
  'AC-2: an admin cancel tells the customer and the chosen provider');
-- A late payment: the payer of the fee it names.
INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, region, new_value)
VALUES (NULL, 'fee.late', 'fee_payments', pg_temp.cfee(1)::text, 'TR', '{"fee_refund_id": null}');
SELECT is((SELECT count(*)::integer FROM public.notifications
            WHERE recipient_id = pg_temp.u('c1') AND kind = 'payment_too_late' AND request_id = pg_temp.r(1)), 1,
  'AC-2: payment_too_late, to the payer');
-- A new report: the reporter, and every admin of the region (a second admin here).
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
VALUES (pg_temp.u('ae'), 'authenticated', 'authenticated', '905559370007', now());
INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
VALUES (pg_temp.u('ae'), 'admin', 'TR', '+905559370007', 'İkinci Yönetici', 'tr');
INSERT INTO public.problem_reports (id, region, request_id, reporter_id, against_id, side, reason, text, status)
VALUES (pg_temp.u('b1'), 'TR', pg_temp.r(1), pg_temp.u('c1'), pg_temp.u('a1'), 'customer', 'poor_work',
        'The work was left half done and the room was not cleaned.', 'open');
INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, region)
VALUES (pg_temp.u('c1'), 'report.opened', 'problem_report', pg_temp.u('b1')::text, 'TR');
SELECT is((SELECT count(*)::integer FROM public.notifications
            WHERE recipient_id = pg_temp.u('c1') AND kind = 'report_received' AND entity_id = pg_temp.u('b1')), 1,
  'AC-2: report_received, to the reporter');
SELECT is((SELECT count(*)::integer FROM public.notifications
            WHERE recipient_id IN (pg_temp.u('ad'), pg_temp.u('ae')) AND kind = 'report_new_admin' AND entity_id = pg_temp.u('b1')), 2,
  'AC-2: report_new_admin, to each admin of the region');
SELECT is((SELECT count(*)::integer FROM public.notifications WHERE recipient_id = pg_temp.u('a1') AND entity_id = pg_temp.u('b1')), 0,
  'AC-2: the reported party gets no notice from the report');
-- A rating: the provider learns only that one arrived, never which job (security review M-1, 17's D207).
INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, region, new_value)
VALUES (pg_temp.u('c1'), 'rating.created', 'request', pg_temp.r(4)::text, 'TR', jsonb_build_object('application_id', pg_temp.app(4, 'a1')));
SELECT is((SELECT request_id IS NULL AND entity_id IS NULL FROM public.notifications
            WHERE recipient_id = pg_temp.u('a1') AND kind = 'rating_received'), true,
  'M-1: rating_received names no request and no application');
-- Every audit row of this file left exactly the notices of its map rows.
SELECT is(
  (SELECT bool_and((SELECT count(*) FROM public.audit_notices(a.id) m WHERE m.o_kind NOT IN ('confirm_email', 'password_changed'))
                   = (SELECT count(*) FROM public.notifications n WHERE n.dedupe_key LIKE 'notice:' || a.id || ':%'))
     FROM public.audit_log a
    WHERE (a.entity_id IN (SELECT pg_temp.r(i)::text FROM generate_series(1, 7) i)
           OR a.entity_id IN (pg_temp.u('a2')::text, pg_temp.u('b1')::text, pg_temp.cfee(1)::text))
      -- The two moves made with notices off (request 4) and with the notice forced to fail (request 5).
      AND NOT (a.action = 'request.provider_chosen' AND a.entity_id IN (pg_temp.r(4)::text, pg_temp.r(5)::text))),
  true, 'R-1: every audit row of this file left the notices of its map rows');

-- ══ AC-11: the Realtime policy, as each person ═══════════════════════════════
-- realtime.topic() is the topic the joining client names; select on realtime.messages is what Realtime runs.
CREATE FUNCTION pg_temp.rt_seen(p_as text, p_topic_of text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v integer;
BEGIN
  IF NOT pg_temp.rt_ready() THEN
    RETURN -1;
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p_as), 'role', 'authenticated')::text, true);
  PERFORM set_config('realtime.topic', 'notices:' || pg_temp.u(p_topic_of)::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE 'SELECT count(*)::integer FROM realtime.messages WHERE topic = $1' INTO v USING 'notices:' || pg_temp.u(p_topic_of)::text;
  RESET ROLE;
  PERFORM set_config('realtime.topic', '', true);
  RETURN v;
END $$;
SELECT ok(pg_temp.rt_seen('a1', 'a1') <> 0, 'AC-11: a user reads the pings of their own topic (or Realtime is absent here)');
SELECT ok(pg_temp.rt_seen('c1', 'a1') IN (0, -1), 'AC-11: a user who names another user''s topic reads none of its pings');
SELECT ok(CASE WHEN to_regclass('realtime.messages') IS NULL THEN true
               ELSE (SELECT array_agg(polname::text) FROM pg_policy WHERE polrelid = to_regclass('realtime.messages'))
                    = ARRAY['aldebyani_notices_read_own'] END,
  'Security review: ours is the only policy on realtime.messages (permissive policies add up)');

-- ══ AC-5, AC-6: the readers and writers, as each person ══════════════════════
SELECT is(pg_temp.call_as('c1', 'SELECT public.my_notice_count()::text'),
          (SELECT count(*)::text FROM public.notifications WHERE recipient_id = pg_temp.u('c1') AND read_at IS NULL),
  'AC-5: the unread count is the caller''s own');
SELECT is(pg_temp.call_as('c1', 'SELECT count(*)::text FROM public.my_notices(NULL, 50)'),
          pg_temp.n('c1')::text, 'AC-5: my_notices returns every own notice');
SELECT is(pg_temp.call_as('c1', format('SELECT count(*)::text FROM public.my_notices(NULL, 50) WHERE id IN (SELECT id FROM public.notifications WHERE recipient_id <> %L)', pg_temp.u('c1'))),
          '42501', 'AC-5: a caller cannot even name someone else''s rows to filter by');
SELECT is(pg_temp.call_as('a1', format('SELECT count(*)::text FROM public.my_notices(NULL, 50) WHERE request_id = %L AND kind = %L', pg_temp.r(1), 'commission_received')),
          '0', 'AC-5: a provider never reads the customer''s notices');
SELECT is(pg_temp.call_as('c1', format('SELECT service_name::text FROM public.my_notices(NULL, 50) WHERE request_id = %L LIMIT 1', pg_temp.r(1))),
          '{"en": "Cleaning", "tr": "Temizlik"}', 'AC-5: only the service name map leaves the snapshot');
SELECT is(pg_temp.call_as('c1', format('SELECT timezone || '','' || default_locale FROM public.my_notices(NULL, 50) WHERE request_id = %L LIMIT 1', pg_temp.r(1))),
          (SELECT timezone || ',' || default_locale FROM public.regions WHERE code = 'TR'), 'AC-5: the region time zone and locale');
SELECT is(pg_temp.call_as('c1', 'SELECT count(*)::text FROM public.my_notices(NULL, 2)'), '2', 'AC-5: the limit');
SELECT is(pg_temp.call_as('c1', format(
            'SELECT count(*)::text FROM public.my_notices(%L, 50)',
            (SELECT id FROM public.notifications WHERE recipient_id = pg_temp.u('c1') ORDER BY created_at DESC, id DESC OFFSET 1 LIMIT 1))),
          (pg_temp.n('c1') - 2)::text, 'AC-5: the keyset returns the older rest');
SELECT is(pg_temp.call_as('c1', 'SELECT count(*)::text FROM public.my_notices(NULL, 0)'), 'validation_failed', 'AC-5: a limit of 0 is refused');
SELECT is(pg_temp.call_as('c1', 'SELECT count(*)::text FROM public.my_notices(NULL, 51)'), 'validation_failed', 'AC-5: a limit of 51 is refused');
SELECT is(pg_temp.call_as('c1', format('SELECT count(*)::text FROM public.my_notices(%L, 20)',
            (SELECT id FROM public.notifications WHERE recipient_id = pg_temp.u('a1') LIMIT 1))),
          'not_found', 'AC-5: someone else''s cursor is not found');
SELECT is(pg_temp.call_as('anon', 'SELECT public.my_notice_count()::text'), '42501', 'R-8: anon cannot count');
-- AC-5: the count stops at 100.
INSERT INTO public.notifications (region, recipient_id, kind, dedupe_key)
SELECT 'TR', pg_temp.u('c2'), 'account_approved', 't37:cap:' || i FROM generate_series(1, 101) i;
SELECT is(pg_temp.call_as('c2', 'SELECT public.my_notice_count()::text'), '100', 'AC-5: the unread count is capped at 100');
DELETE FROM public.notifications WHERE dedupe_key LIKE 't37:cap:%';

-- open_notice: marked once, own rows only.
CREATE TEMP TABLE t37_one AS
  SELECT id FROM public.notifications WHERE recipient_id = pg_temp.u('c1') AND kind = 'commission_received' LIMIT 1;
GRANT SELECT ON t37_one TO authenticated;
SELECT is(pg_temp.call_as('a1', 'SELECT kind FROM public.open_notice((SELECT id FROM t37_one))'), 'not_found',
  'AC-6: someone else''s notice is not found');
SELECT is((SELECT read_at FROM public.notifications WHERE id = (SELECT id FROM t37_one)), NULL::timestamptz,
  'AC-6: and stays unread');
SELECT is(pg_temp.call_as('c1', 'SELECT kind || '','' || request_id FROM public.open_notice((SELECT id FROM t37_one))'),
          'commission_received,' || pg_temp.r(1), 'AC-6: open returns what the link needs');
SELECT isnt((SELECT read_at FROM public.notifications WHERE id = (SELECT id FROM t37_one)), NULL::timestamptz,
  'AC-6: and marks it read');
SELECT is(pg_temp.call_as('c1', 'SELECT kind FROM public.open_notice((SELECT id FROM t37_one))'), 'commission_received',
  'AC-6: a second open is fine and keeps the first time');
SELECT ok((SELECT prosrc LIKE '%x.read_at is null%' FROM pg_proc WHERE oid = 'public.open_notice(uuid)'::regprocedure),
  'Code review: open_notice updates only an unread row, so a concurrent open or mark all is a no op');
CREATE TEMP TABLE t37_unread AS
  SELECT count(*)::text AS c FROM public.notifications WHERE recipient_id = pg_temp.u('c1') AND read_at IS NULL;
SELECT is(pg_temp.call_as('c1', 'SELECT public.mark_all_notices_read()::text'), (SELECT c FROM t37_unread),
  'AC-6: mark all returns how many it marked');
SELECT is(pg_temp.call_as('c1', 'SELECT public.my_notice_count()::text'), '0', 'AC-6: then nothing is unread');
SELECT isnt(pg_temp.call_as('a1', 'SELECT public.my_notice_count()::text'), '0', 'AC-6: someone else''s stay unread');

-- AC-4: the guard.
SELECT throws_ok(format('UPDATE public.notifications SET kind = %L WHERE id = %L', 'chosen', (SELECT id FROM t37_one)),
                 'P0001', 'invalid_update', 'AC-4: no column but read_at may change');
SELECT throws_ok(format('UPDATE public.notifications SET read_at = NULL WHERE id = %L', (SELECT id FROM t37_one)),
                 'P0001', 'invalid_update', 'AC-4: a read notice never becomes unread');

-- ══ AC-13: housekeeping ══════════════════════════════════════════════════════
INSERT INTO public.notifications (region, recipient_id, kind, dedupe_key, created_at)
VALUES ('TR', pg_temp.u('c2'), 'account_approved', 't37:old', now() - interval '181 days'),
       ('TR', pg_temp.u('c2'), 'account_approved', 't37:young', now() - interval '179 days');
SELECT is(public.notices_housekeeping() >= 1, true, 'AC-13: housekeeping deletes');
SELECT is((SELECT array_agg(dedupe_key ORDER BY dedupe_key) FROM public.notifications WHERE dedupe_key LIKE 't37:%'),
          ARRAY['t37:young'], 'AC-13: older than 180 days goes, younger stays');
SELECT is((SELECT count(*)::integer FROM cron.job WHERE jobname = 'notices-housekeeping'), 1, 'AC-13: the daily job');

-- ══ R-9, R-11, AC-11: the ping and the Realtime policy ═══════════════════════
SELECT ok((SELECT prosrc LIKE '%realtime.send(%' AND prosrc LIKE '%exception when others%'
             FROM pg_proc WHERE oid = 'public.notifications_ping()'::regprocedure),
  'R-9, X-5: the ping is sent inside a block that swallows any error');
SELECT ok(CASE WHEN to_regclass('realtime.messages') IS NULL THEN true
               ELSE EXISTS (SELECT 1 FROM pg_policy p
                             WHERE p.polrelid = to_regclass('realtime.messages') AND p.polname = 'aldebyani_notices_read_own'
                               AND p.polcmd = 'r'
                               AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
                               AND pg_get_expr(p.polqual, p.polrelid) LIKE '%broadcast%'
                               AND pg_get_expr(p.polqual, p.polrelid) LIKE '%notices:%'
                               AND pg_get_expr(p.polqual, p.polrelid) LIKE '%auth.uid()%') END,
  'R-11, AC-11: where Realtime exists, the select only own topic policy exists');
SELECT ok(CASE WHEN to_regclass('realtime.messages') IS NULL THEN true
               ELSE NOT EXISTS (SELECT 1 FROM pg_policy p
                                 WHERE p.polrelid = to_regclass('realtime.messages') AND p.polcmd IN ('a', '*')
                                   AND pg_get_expr(coalesce(p.polwithcheck, p.polqual), p.polrelid) LIKE '%notices:%') END,
  'AC-11: no policy lets anyone send on a notices topic');

-- ══ Grants (X-13) ════════════════════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default",
            has_function_privilege('anon', p.oid, 'EXECUTE'),
            has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            has_function_privilege('service_role', p.oid, 'EXECUTE')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('applications_offer_notice', 'audit_log_notice', 'audit_notices', 'insert_notice',
                          'mark_all_notices_read', 'my_notice_count', 'my_notices', 'notices_enabled',
                          'notices_housekeeping', 'notifications_guard', 'notifications_ping', 'open_notice',
                          'queue_audit_notices', 'queue_offer_notice')
      ORDER BY p.proname COLLATE "C" $$,
  $$ VALUES ('applications_offer_notice'::text, false, false, false), ('audit_log_notice', false, false, false),
            ('audit_notices', false, false, false), ('insert_notice', false, false, false),
            ('mark_all_notices_read', false, true, false), ('my_notice_count', false, true, false),
            ('my_notices', false, true, false), ('notices_enabled', false, false, false),
            ('notices_housekeeping', false, false, false), ('notifications_guard', false, false, false),
            ('notifications_ping', false, false, false), ('open_notice', false, true, false),
            ('queue_audit_notices', false, false, false), ('queue_offer_notice', false, false, false) $$,
  'X-13: only the four reader and writer functions are granted, and only to authenticated');
SELECT ok((SELECT bool_and(p.prosecdef) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN ('audit_log_notice', 'applications_offer_notice', 'queue_audit_notices', 'queue_offer_notice',
                                'notifications_ping', 'my_notices', 'my_notice_count', 'open_notice', 'mark_all_notices_read',
                                'notices_housekeeping')),
  'Security model: the trigger bodies and the readers are security definer');

SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname)
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND 'lock_timeout=250ms' = ANY (coalesce(p.proconfig, '{}'))
              AND p.proname IN ('applications_offer_notice', 'audit_log_notice', 'notifications_ping')),
          ARRAY['applications_offer_notice', 'audit_log_notice', 'notifications_ping'],
  'Security review: the notice bodies inside a move wait at most 250ms for a lock, which their block catches');

-- ══ R-3: the two when lists ══════════════════════════════════════════════════
SELECT is(
  (SELECT array_to_string(array_agg(m[1] ORDER BY m[1] COLLATE "C"), ',') COLLATE "default"
     FROM pg_trigger t, regexp_matches(pg_get_triggerdef(t.oid), '''([a-z_]+\.[a-z_]+)''', 'g') AS m
    WHERE t.tgname = 'audit_log_notice' AND t.tgrelid = 'public.audit_log'::regclass),
  (SELECT array_to_string(array_agg(m[1] ORDER BY m[1] COLLATE "C"), ',') COLLATE "default"
     FROM pg_trigger t, regexp_matches(pg_get_triggerdef(t.oid), '''([a-z_]+\.[a-z_]+)''', 'g') AS m
    WHERE t.tgname = 'audit_log_email' AND t.tgrelid = 'public.audit_log'::regclass
      AND m[1] NOT IN ('profile.email_changed', 'auth.password_set', 'auth.password_changed')),
  'R-3: the notice trigger fires on the mail trigger''s actions minus the three mail only ones');
SELECT results_eq(
  $$ SELECT tgname::text COLLATE "default" FROM pg_trigger
      WHERE tgrelid IN ('public.applications'::regclass, 'public.notifications'::regclass)
        AND tgname IN ('applications_offer_notice', 'notifications_ping', 'notifications_guard')
      ORDER BY tgname COLLATE "C" $$,
  $$ VALUES ('applications_offer_notice'::text), ('notifications_guard'), ('notifications_ping') $$,
  'R-2, R-9, AC-4: the other three triggers');

SELECT * FROM finish();
ROLLBACK;
