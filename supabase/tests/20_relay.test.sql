-- Position 08, spec 0011-08: the relay's database side.
--
-- Every function the relay calls is proven here for its happy path, its refusals, and a denied anonymous
-- and customer call: checkout_context, mark_checkout_ready, mark_checkout_failed, abandon_checkout,
-- psp_callback, psp_webhook, mark_refund_failed, reconcile_pending, reconcile_daily_list, outbox_health,
-- fake_psp_set, fake_psp_get; the internal relay_kick and payments_enabled; the settings and their checks,
-- the new columns and the widened attempt guard, the token and card page filter (R-6), start_checkout's
-- kick, and the four schedules. AC-6, AC-8, AC-9, AC-12, AC-13, AC-15, AC-18, AC-20, AC-21; R-1, R-2, R-4,
-- R-6, R-8 to R-12, R-14 to R-16.
--
-- Rows are written here as the table owner where a function would need a whole flow first (a paid fee, a
-- done refund, an attempt started hours ago); the functions under test then run on them.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(122);

SET CONSTRAINTS ALL IMMEDIATE;

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002000' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000002070' || lpad(p::text, 2, '0'))::uuid $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
VALUES (pg_temp.u('c1'), 'authenticated', 'authenticated', '905559200001', now());
INSERT INTO public.profiles (id, role, region, phone, full_name, locale, email)
VALUES (pg_temp.u('c1'), 'customer', 'TR', '+905559200001', 'Röle Bir', 'tr', 'c1@example.test');
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Röle"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Bir"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Semt"}', 1.00, true);

-- A request and its commission fee (pending), one per number.
CREATE FUNCTION pg_temp.fee(p integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100}', 100000, 10000, 90000, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours');
  INSERT INTO public.fee_payments (region, request_id, kind, payer_id, amount, currency)
  VALUES ('TR', pg_temp.r(p), 'commission', pg_temp.u('c1'), 10000, 'TRY')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
-- An attempt written as the owner, started and finished some time ago.
CREATE FUNCTION pg_temp.att(p_fee uuid, p_status text, p_age interval, p_finished interval DEFAULT NULL,
                            p_reason text DEFAULT NULL, p_token text DEFAULT NULL, p_ip inet DEFAULT NULL)
  RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.checkout_attempts (region, fee_payment_id, status, started_at, finished_at, failure_reason, psp_token,
                                        url, payer_ip)
  VALUES ('TR', p_fee, p_status, now() - p_age, now() - p_finished, p_reason, p_token,
          CASE WHEN p_token IS NOT NULL THEN 'https://pay.example.test/p/' || p_token END, p_ip)
  RETURNING id $$;
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'none';
EXCEPTION
  WHEN raise_exception THEN RETURN sqlerrm;
  WHEN others THEN RETURN sqlstate;
END;
$$;
-- The SQLSTATE of a call made as an API role, or 'none'.
CREATE FUNCTION pg_temp.as_role(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_state text := 'none';
BEGIN
  PERFORM set_config('request.jwt.claims',
                     CASE WHEN p_role = 'anon' THEN '{"role": "anon"}'
                          ELSE jsonb_build_object('sub', pg_temp.u('c1'), 'role', 'authenticated')::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    v_state := sqlstate;
  END;
  RESET ROLE;
  RETURN v_state;
END;
$$;

-- ══ AC-18, R-16: the settings ════════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT region, key, jsonb_typeof(value) FROM public.platform_settings
      WHERE key IN ('payments_enabled', 'checkout_hold_minutes', 'psp_buyer_city') ORDER BY region, key $$,
  $$ VALUES ('KSA', 'checkout_hold_minutes', 'number'), ('KSA', 'payments_enabled', 'boolean'),
            ('KSA', 'psp_buyer_city', 'string'), ('TR', 'checkout_hold_minutes', 'number'),
            ('TR', 'payments_enabled', 'boolean'), ('TR', 'psp_buyer_city', 'string') $$,
  'AC-18, R-16: payments_enabled, checkout_hold_minutes and psp_buyer_city exist in both regions');
SELECT is((SELECT value FROM public.platform_settings WHERE region = 'KSA' AND key = 'payments_enabled'), 'false'::jsonb,
  'AC-18: payments are off in KSA');
SELECT results_eq(
  $$ SELECT region, value FROM public.platform_settings WHERE key IN ('checkout_hold_minutes', 'psp_buyer_city')
      ORDER BY key, region $$,
  $$ VALUES ('KSA', '15'::jsonb), ('TR', '15'::jsonb), ('KSA', '"Riyadh"'::jsonb), ('TR', '"Istanbul"'::jsonb) $$,
  'R-16: the hold is 15 minutes and the buyer city is the region''s seed');

UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'payments_enabled';
SELECT ok(public.payments_enabled('TR'), 'AC-18: payments_enabled reads true');
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key = 'payments_enabled';
SELECT ok(NOT public.payments_enabled('TR'), 'AC-18: payments_enabled reads false');
DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'payments_enabled';
SELECT ok(NOT public.payments_enabled('TR'), 'AC-18: a missing row is off (fail closed)');
SELECT ok(NOT public.payments_enabled('XX'), 'AC-18: an unknown region is off');
INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', 'payments_enabled', 'true');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET value = '"true"' WHERE region = 'TR' AND key = 'payments_enabled' $$),
  '23514', 'AC-18: a string under payments_enabled is refused');

SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'checkout_hold_minutes' $$),
  '23514', 'R-16: a hold of 0 minutes is refused');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET value = '1441' WHERE region = 'TR' AND key = 'checkout_hold_minutes' $$),
  '23514', 'R-16: a hold over a day is refused');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET value = '1.5' WHERE region = 'TR' AND key = 'checkout_hold_minutes' $$),
  '23514', 'R-16: a fractional hold is refused');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET value = '"15"' WHERE region = 'TR' AND key = 'checkout_hold_minutes' $$),
  '23514', 'R-16: a hold as text is refused');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET value = '""' WHERE region = 'TR' AND key = 'psp_buyer_city' $$),
  '23514', 'R-16: an empty buyer city is refused');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET value = '34' WHERE region = 'TR' AND key = 'psp_buyer_city' $$),
  '23514', 'R-16: a buyer city as a number is refused');
SELECT is(pg_temp.err($$ DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'checkout_hold_minutes' $$),
  'pricing_setting_required', 'R-16: the hold cannot be deleted');
SELECT is(pg_temp.err($$ UPDATE public.platform_settings SET key = 'psp_buyer_town' WHERE region = 'TR' AND key = 'psp_buyer_city' $$),
  'pricing_setting_required', 'R-16: the buyer city cannot be renamed');
SELECT is(public.checkout_settings('TR'), '{"hold_minutes": 15, "buyer_city": "Istanbul"}'::jsonb,
  'R-16: checkout_settings reads both');
SELECT is(public.checkout_settings('XX'), NULL, 'R-16: a region without them reads null');

-- ══ AC-20: the fake's table, RLS on, no API grant ═══════════════════════════════
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.fake_psp_outcomes'::regclass),
  'AC-20: fake_psp_outcomes has RLS enabled');
SELECT is_empty(
  $$ SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'fake_psp_outcomes'
        AND grantee IN ('anon', 'authenticated', 'service_role') $$,
  'AC-20: no API role holds a grant on fake_psp_outcomes');
SELECT is(pg_temp.as_role('authenticated', 'SELECT 1 FROM public.fake_psp_outcomes'), '42501',
  'AC-20: a customer cannot read the fake''s table');

-- ══ AC-6: start_checkout still queues, and kicks; relay_kick without Vault does nothing ══
CREATE TEMP TABLE f1 AS SELECT pg_temp.fee(1) AS id;
CREATE TEMP TABLE a1 AS SELECT public.start_checkout((SELECT id FROM f1), 'tr', NULL) AS id;
SELECT is((SELECT count(*)::int FROM public.outbox_events WHERE idempotency_key = 'checkout:' || (SELECT id FROM a1) || ':init'), 1,
  'AC-6: start_checkout still queues its initialize row');
SELECT is((SELECT count(*)::int FROM net.http_request_queue WHERE convert_from(body, 'UTF8') LIKE '%drain%'), 0,
  'AC-6: without the Vault secrets the kick sends nothing');
SELECT is(public.relay_kick('drain'), NULL, 'AC-6: relay_kick answers null without the Vault secrets');
SELECT is(pg_temp.err($$ SELECT public.relay_kick('payout') $$), 'validation_failed', 'AC-6: an unknown task is refused');

SELECT vault.create_secret('https://relay.example.test/api/relay', 'relay_url');
SELECT vault.create_secret('relay-test-secret', 'relay_secret');
CREATE TEMP TABLE k1 AS SELECT public.relay_kick('heartbeat') AS id;
SELECT ok((SELECT id FROM k1) IS NOT NULL, 'AC-6: with both secrets the kick is queued in pg_net');
SELECT results_eq(
  $$ SELECT q.url, convert_from(q.body, 'UTF8')::jsonb, q.headers ->> 'x-relay-secret', q.timeout_milliseconds
       FROM net.http_request_queue q WHERE q.id = (SELECT id FROM k1) $$,
  $$ VALUES ('https://relay.example.test/api/relay'::text, '{"task": "heartbeat"}'::jsonb, 'relay-test-secret'::text, 10000) $$,
  'AC-6, R-7: the kick posts {task} with the secret header and a 10 second timeout');
CREATE TEMP TABLE a1b AS SELECT public.start_checkout(pg_temp.fee(2), 'tr', NULL) AS id;
SELECT ok(EXISTS (SELECT 1 FROM net.http_request_queue q WHERE convert_from(q.body, 'UTF8')::jsonb = '{"task": "drain"}'),
  'AC-6: start_checkout kicks a drain');
SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'relay_url'), 'http://relay.example.test/api/relay');
SELECT is(public.relay_kick('drain'), NULL, 'AC-6: a relay URL that is not https is never called');
DELETE FROM vault.secrets WHERE name IN ('relay_url', 'relay_secret');

SELECT results_eq(
  $$ SELECT jobname::text, schedule::text, command::text FROM cron.job WHERE jobname LIKE 'relay-%' ORDER BY jobname $$,
  $$ VALUES ('relay-drain', '* * * * *', 'select public.relay_kick(''drain'')'),
            ('relay-heartbeat', '*/5 * * * *', 'select public.relay_kick(''heartbeat'')'),
            ('relay-reconcile-daily', '*/10 0-1 * * *', 'select public.relay_kick(''reconcile_daily'')'),
            ('relay-reconcile-pending', '*/15 * * * *', 'select public.relay_kick(''reconcile_pending'')') $$,
  'AC-6, R-11: the four schedules');

-- ══ AC-20, R-4, R-8: checkout_context ══════════════════════════════════════════
SELECT is(public.checkout_context((SELECT id FROM a1)) - 'attempt_age_seconds',
  jsonb_build_object('attempt_id', (SELECT id FROM a1), 'attempt_status', 'queued', 'failure_reason', null,
    'locale', 'tr', 'psp_token', null, 'region', 'TR', 'finished_seconds_ago', null, 'payer_ip', null,
    'fee_payment_id', (SELECT id FROM f1), 'fee_kind', 'commission', 'fee_status', 'pending', 'amount', 10000,
    'currency', 'TRY', 'payer_id', pg_temp.u('c1'), 'full_name', 'Röle Bir', 'email', 'c1@example.test',
    'settings', jsonb_build_object('hold_minutes', 15, 'buyer_city', 'Istanbul')),
  'AC-20: checkout_context returns the attempt, the fee, the payer and the settings; locale falls back to the region''s');
SELECT ok((public.checkout_context((SELECT id FROM a1)) ->> 'attempt_age_seconds')::bigint >= 0, 'R-4: the attempt''s age');
SELECT is(pg_temp.err(format('SELECT public.checkout_context(%L)', gen_random_uuid())), 'not_found',
  'AC-20: an unknown attempt');

-- ══ AC-20, AC-21, R-9: mark_checkout_ready ═══════════════════════════════════════
SELECT is(pg_temp.err(format('SELECT public.mark_checkout_ready(%L, %L, %L)', (SELECT id FROM a1), 'tok-1', 'http://pay.example.test/x')),
  'validation_failed', 'AC-21: http on a host other than localhost is refused');
SELECT is(pg_temp.err(format('SELECT public.mark_checkout_ready(%L, %L, %L)', (SELECT id FROM a1), 'tok-1', 'https://user:pw@pay.example.test/x')),
  'validation_failed', 'AC-21: a URL with user info is refused');
SELECT is(pg_temp.err(format('SELECT public.mark_checkout_ready(%L, %L, %L)', (SELECT id FROM a1), 'tok-1', 'https://pay.example.test/' || repeat('a', 2000))),
  'validation_failed', 'AC-21: a URL over 2,000 characters is refused');
SELECT is(pg_temp.err(format('SELECT public.mark_checkout_ready(%L, %L, %L)', (SELECT id FROM a1), '', 'https://pay.example.test/x')),
  'validation_failed', 'AC-20: an empty token is refused');
SELECT is(pg_temp.err(format('SELECT public.mark_checkout_ready(%L, %L, %L)', (SELECT id FROM a1), 'tok-1', 'javascript:alert(1)')),
  'validation_failed', 'AC-21: a script URL is refused');
SELECT is(public.mark_checkout_ready((SELECT id FROM a1), 'tok-1', 'https://pay.example.test/p/tok-1'),
  '{"changed": true, "status": "ready"}'::jsonb, 'AC-20: queued to ready');
SELECT results_eq(
  $$ SELECT status, psp_token, url FROM public.checkout_attempts WHERE id = (SELECT id FROM a1) $$,
  $$ VALUES ('ready'::text, 'tok-1'::text, 'https://pay.example.test/p/tok-1'::text) $$,
  'AC-20: the token and the URL are stored');
SELECT is(public.mark_checkout_ready((SELECT id FROM a1), 'tok-other', 'https://pay.example.test/p/other'),
  '{"changed": false, "status": "ready"}'::jsonb, 'R-9: a second call changes nothing');
SELECT is(pg_temp.err(format('SELECT public.mark_checkout_ready(%L, %L, %L)', (SELECT id FROM a1b), 'tok-1', 'https://pay.example.test/p/tok-1')),
  'idempotency_conflict', 'AC-20: a token already on another attempt is a conflict');
SELECT is(public.mark_checkout_ready((SELECT id FROM a1b), 'tok-2', 'http://localhost:3100/tr/dev/fake-checkout/tok-2'),
  '{"changed": true, "status": "ready"}'::jsonb, 'AC-21: http on localhost is accepted (the fake)');

-- The widened guard.
SELECT is(pg_temp.err(format('UPDATE public.checkout_attempts SET psp_token = %L WHERE id = %L', 'tok-x', (SELECT id FROM a1))),
  'attempt_immutable', 'AC-20: a token is written once');
SELECT is(pg_temp.err(format('UPDATE public.checkout_attempts SET url = %L WHERE id = %L', 'https://evil.example.test/', (SELECT id FROM a1))),
  'attempt_immutable', 'AC-21: a card page URL is written once');
SELECT is(pg_temp.err(format('UPDATE public.checkout_attempts SET payer_ip = %L WHERE id = %L', '10.0.0.1', (SELECT id FROM a1))),
  'attempt_immutable', 'R-8: the payer''s IP may only be cleared');
SELECT is(pg_temp.err(format('UPDATE public.checkout_attempts SET status = %L, finished_at = now() WHERE id = %L', 'failed', (SELECT id FROM a1))),
  '23514', 'AC-20: a failed attempt needs its reason');
SELECT is(pg_temp.err(format('UPDATE public.checkout_attempts SET failure_reason = %L WHERE id = %L', 'psp_failed', (SELECT id FROM a1))),
  'attempt_immutable', 'AC-20: a reason is set only on the move to failed');

-- ══ AC-20, R-4, R-9: mark_checkout_failed and abandon_checkout ══════════════════════
SELECT is(pg_temp.err(format('SELECT public.mark_checkout_failed(%L, %L)', (SELECT id FROM a1), 'because')),
  'validation_failed', 'AC-20: a reason outside the closed list is refused');
SELECT is(pg_temp.err(format('SELECT public.mark_checkout_failed(%L, %L)', gen_random_uuid(), 'psp_failed')),
  'not_found', 'AC-20: an unknown attempt');
CREATE TEMP TABLE a2 AS SELECT public.start_checkout(pg_temp.fee(3), 'tr', NULL) AS id;
SELECT is(public.mark_checkout_failed((SELECT id FROM a2), 'fee_not_pending'),
  '{"changed": true, "status": "failed"}'::jsonb, 'R-4: queued to failed (fee_not_pending)');
SELECT results_eq(
  $$ SELECT status, failure_reason, finished_at IS NOT NULL FROM public.checkout_attempts WHERE id = (SELECT id FROM a2) $$,
  $$ VALUES ('failed'::text, 'fee_not_pending'::text, true) $$,
  'AC-20: the reason and the finish time are stored');
SELECT is(public.mark_checkout_failed((SELECT id FROM a2), 'psp_failed'),
  '{"changed": false, "status": "failed"}'::jsonb, 'R-9: a finished attempt is left as it is');
SELECT is(public.mark_checkout_failed((SELECT id FROM a1), 'psp_failed'),
  '{"changed": true, "status": "failed"}'::jsonb, 'AC-20: ready to failed (psp_failed)');
CREATE TEMP TABLE a3 AS SELECT pg_temp.att(pg_temp.fee(4), 'succeeded', interval '1 hour', interval '50 minutes') AS id;
SELECT is(public.mark_checkout_failed((SELECT id FROM a3), 'init_failed'),
  '{"changed": false, "status": "succeeded"}'::jsonb, 'R-9: succeeded is never overwritten');
SELECT is(public.abandon_checkout((SELECT id FROM a3)),
  '{"changed": false, "status": "succeeded"}'::jsonb, 'R-9: abandon never touches a succeeded attempt');
CREATE TEMP TABLE a4 AS SELECT public.start_checkout(pg_temp.fee(5), 'tr', NULL) AS id;
SELECT is(public.abandon_checkout((SELECT id FROM a4)),
  '{"changed": false, "status": "queued"}'::jsonb, 'R-2: abandon acts on ready only');
SELECT is(public.abandon_checkout((SELECT id FROM a1b)),
  '{"changed": true, "status": "abandoned"}'::jsonb, 'R-2: ready to abandoned');
SELECT is(public.abandon_checkout((SELECT id FROM a1b)),
  '{"changed": false, "status": "abandoned"}'::jsonb, 'R-9: a second abandon changes nothing');
SELECT is(pg_temp.err(format('SELECT public.abandon_checkout(%L)', gen_random_uuid())), 'not_found', 'AC-20: an unknown attempt');

-- ══ AC-8, R-1, R-6: psp_callback ═══════════════════════════════════════════════
CREATE TEMP TABLE a5 AS SELECT public.start_checkout(pg_temp.fee(6), 'tr', NULL) AS id;
SELECT public.mark_checkout_ready((SELECT id FROM a5), 'tok-5', 'https://pay.example.test/p/tok-5');
UPDATE public.checkout_attempts SET locale = 'en' WHERE id = (SELECT id FROM a5);
SELECT is(public.psp_callback('tok-unknown', '{"token": "tok-unknown"}'), NULL, 'AC-8: an unknown token answers null');
SELECT is(public.psp_callback('tok-5', '{"token": "tok-5", "status": "success", "cardNumber": "4111"}'),
  jsonb_build_object('attempt_id', (SELECT id FROM a5), 'locale', 'en', 'region', 'TR'),
  'AC-8: the attempt, its locale and its region');
SELECT results_eq(
  $$ SELECT event_key, payload, region FROM public.psp_events WHERE source = 'callback'
      AND event_key LIKE 'callback:' || (SELECT id FROM a5) || ':%' $$,
  $$ VALUES ('callback:' || (SELECT id FROM a5) || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI'),
             '{"status": "success"}'::jsonb, 'TR'::text) $$,
  'R-1, R-6: the callback is stored once per minute, its token and card fields stripped');
SELECT results_eq(
  $$ SELECT idempotency_key, kind, payload FROM public.outbox_events
      WHERE idempotency_key LIKE 'checkout:' || (SELECT id FROM a5) || ':verify:%' $$,
  $$ VALUES ('checkout:' || (SELECT id FROM a5) || ':verify:callback:' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI'),
             'payment.verify'::text, jsonb_build_object('attempt_id', (SELECT id FROM a5), 'final', false)) $$,
  'R-1: a check is queued with the minute in its key');
SELECT public.psp_callback('tok-5', '{"token": "tok-5"}');
SELECT is((SELECT count(*)::int FROM public.outbox_events WHERE idempotency_key LIKE 'checkout:' || (SELECT id FROM a5) || ':verify:%'), 1,
  'R-1: a second callback in the same minute queues nothing new');
SELECT is((SELECT status FROM public.checkout_attempts WHERE id = (SELECT id FROM a5)), 'ready',
  'AC-8: a callback changes no money state');
SELECT is(pg_temp.err(format('SELECT public.psp_callback(%L, %L)', 'tok-5', jsonb_build_object('x', repeat('a', 9000)))),
  'validation_failed', 'AC-8: fields over 8 KiB are refused');
SELECT is(pg_temp.err(format('SELECT public.psp_callback(%L, %L)', repeat('t', 501), '{}')),
  'validation_failed', 'AC-8: a token over 500 characters is refused');

-- ══ AC-9, R-14, R-15: psp_webhook ══════════════════════════════════════════════
CREATE TEMP TABLE w1 AS SELECT public.psp_webhook('evt-1', 'tok-5', NULL, '{"token": "tok-5", "status": "SUCCESS"}', 'TR') AS j;
SELECT ok((SELECT (j ->> 'new')::boolean AND j ->> 'attempt_id' = (SELECT id FROM a5)::text FROM w1),
  'AC-9: a new webhook event, its attempt found by token');
SELECT is((SELECT count(*)::int FROM public.outbox_events
            WHERE idempotency_key = 'checkout:' || (SELECT id FROM a5) || ':verify:webhook:' || (SELECT j ->> 'psp_event_id' FROM w1)), 1,
  'AC-9: a check is queued with the event id in its key');
SELECT is((SELECT payload FROM public.psp_events WHERE source = 'webhook' AND event_key = 'evt-1'), '{"status": "SUCCESS"}'::jsonb,
  'R-6: the webhook''s token is stripped');
CREATE TEMP TABLE w2 AS SELECT public.psp_webhook('evt-1', 'tok-5', NULL, '{"status": "SUCCESS"}', 'TR') AS j;
SELECT ok((SELECT NOT (j ->> 'new')::boolean AND j ->> 'psp_event_id' = (SELECT j ->> 'psp_event_id' FROM w1) FROM w2),
  'AC-9: a replayed webhook returns the stored event');
SELECT is((SELECT count(*)::int FROM public.outbox_events WHERE idempotency_key LIKE 'checkout:' || (SELECT id FROM a5) || ':verify:webhook:%'), 1,
  'A-3: a replayed webhook queues nothing new');
INSERT INTO public.fee_refunds (region, request_id, kind, psp_payment_id, amount, currency, reason)
VALUES ('TR', pg_temp.r(6), 'late', 'pay-late-1', 10000, 'TRY', 'late_payment');
SELECT is((public.psp_webhook('evt-2', NULL, 'pay-late-1', '{"paymentId": "pay-late-1"}', 'KSA') ->> 'attempt_id'), NULL,
  'AC-9: a webhook found by payment id queues no check');
SELECT is((SELECT region FROM public.psp_events WHERE source = 'webhook' AND event_key = 'evt-2'), 'TR',
  'AC-9: its region is the refund''s');
SELECT public.psp_webhook('evt-3', NULL, 'pay-nobody', '{}', 'KSA');
SELECT is((SELECT region FROM public.psp_events WHERE source = 'webhook' AND event_key = 'evt-3'), 'KSA',
  'AC-9: nothing found, the adapter''s home region');
SELECT is(pg_temp.err($$ SELECT public.psp_webhook('evt-4', NULL, NULL, '{}', 'XX') $$), 'validation_failed',
  'AC-9: an unknown home region is refused');
SELECT is(pg_temp.err(format('SELECT public.psp_webhook(%L, NULL, NULL, %L, %L)', repeat('e', 201), '{}', 'TR')), 'validation_failed',
  'AC-9: an event key over 200 characters is refused');

-- ══ R-6: a full iyzico style retrieve loses every token, page, card and buyer field ══
SELECT public.record_psp_event('retrieve', 'retrieve:r6', '{
  "status": "success", "paymentStatus": "SUCCESS", "token": "t-1", "paymentId": "p-1", "price": "100.0",
  "paidPrice": "100.0", "currency": "TRY", "conversationId": "c-1", "basketId": "b-1", "fraudStatus": 1,
  "paymentPageUrl": "https://pay.example.test/p/t-1", "checkoutFormContent": "<script>",
  "cardType": "CREDIT_CARD", "binNumber": "411111", "lastFourDigits": "1111",
  "buyer": {"name": "A", "identityNumber": "11111111111"},
  "itemTransactions": [{"itemId": "i-1", "paymentTransactionId": "pt-1", "PSP_TOKEN": "x", "Token": "y",
                        "convertedPayout": {"iyziCommissionFee": "1.0", "identity_number": "1"}}]
}', 'TR');
SELECT is((SELECT payload FROM public.psp_events WHERE source = 'retrieve' AND event_key = 'retrieve:r6'), '{
  "status": "success", "paymentStatus": "SUCCESS", "paymentId": "p-1", "price": "100.0", "paidPrice": "100.0",
  "currency": "TRY", "conversationId": "c-1", "basketId": "b-1", "fraudStatus": 1,
  "itemTransactions": [{"itemId": "i-1", "paymentTransactionId": "pt-1",
                        "convertedPayout": {"iyziCommissionFee": "1.0"}}]
}'::jsonb, 'R-6: tokens, the card page, card and buyer fields are gone at any depth and in any case');

-- ══ AC-11, R-9, R-12: mark_refund_failed ═══════════════════════════════════════
CREATE TEMP TABLE x1 AS SELECT id FROM public.fee_refunds WHERE psp_payment_id = 'pay-late-1';
SELECT is(public.mark_refund_failed((SELECT id FROM x1)), '{"changed": true, "status": "failed"}'::jsonb,
  'AC-11: queued to failed');
SELECT is(public.mark_refund_failed((SELECT id FROM x1)), '{"changed": false, "status": "failed"}'::jsonb,
  'R-9: a second call changes nothing');
INSERT INTO public.fee_refunds (region, request_id, kind, psp_payment_id, amount, currency, reason, status, psp_refund_id, finished_at)
VALUES ('TR', pg_temp.r(6), 'late', 'pay-late-2', 10000, 'TRY', 'late_payment', 'done', 'ref-2', now());
SELECT is(public.mark_refund_failed((SELECT id FROM public.fee_refunds WHERE psp_payment_id = 'pay-late-2')),
  '{"changed": false, "status": "done"}'::jsonb, 'R-9: a done refund is never marked failed');
SELECT is(pg_temp.err(format('SELECT public.mark_refund_failed(%L)', gen_random_uuid())), 'not_found', 'AC-11: an unknown refund');

-- ══ AC-12, R-1, R-8, R-10: reconcile_pending ═══════════════════════════════════
CREATE TEMP TABLE rp AS SELECT
  pg_temp.att(pg_temp.fee(10), 'ready', interval '20 minutes', NULL, NULL, 'tok-10') AS open_ready,
  pg_temp.att(pg_temp.fee(11), 'ready', interval '3 hours', NULL, NULL, 'tok-11') AS final_ready,
  pg_temp.att(pg_temp.fee(12), 'ready', interval '5 minutes', NULL, NULL, 'tok-12') AS young_ready,
  pg_temp.att(pg_temp.fee(13), 'failed', interval '90 minutes', interval '1 hour', 'psp_failed', 'tok-13') AS psp_failed,
  pg_temp.att(pg_temp.fee(14), 'failed', interval '90 minutes', interval '1 hour', 'payments_disabled') AS disabled,
  pg_temp.att(pg_temp.fee(15), 'abandoned', interval '5 hours', interval '3 hours', NULL, 'tok-15', '10.1.1.1') AS old_abandoned,
  pg_temp.att(pg_temp.fee(16), 'queued', interval '40 minutes') AS stuck_queued,
  pg_temp.att(pg_temp.fee(17), 'queued', interval '40 minutes') AS slow_queued,
  pg_temp.att(pg_temp.fee(18), 'ready', interval '27 hours', NULL, NULL, 'tok-18') AS stale_ready,
  pg_temp.att(pg_temp.fee(19), 'ready', interval '3 hours', NULL, NULL, 'tok-19', '10.2.2.2') AS ready_with_ip;
INSERT INTO public.outbox_events (region, kind, idempotency_key, payload, status, attempts, next_attempt_at)
VALUES ('TR', 'checkout.initialize', 'checkout:' || (SELECT stuck_queued FROM rp) || ':init', '{}', 'failed', 6, NULL),
       ('TR', 'checkout.initialize', 'checkout:' || (SELECT slow_queued FROM rp) || ':init', '{}', 'pending', 2, now());
-- A row already under the PSP failed attempt's key: left as it is, and nothing new queued under that key.
INSERT INTO public.outbox_events (region, kind, idempotency_key, payload)
VALUES ('TR', 'payment.verify',
        'checkout:' || (SELECT psp_failed FROM rp) || ':verify:reconcile:' || floor(extract(epoch FROM now()) / 900)::bigint || ':open',
        '{"other": true}');
CREATE TEMP TABLE rp1 AS SELECT public.reconcile_pending() AS j;
SELECT is((SELECT j - 'queued' FROM rp1), '{"failed": 1, "conflicts": 0, "cleared_ips": 2}'::jsonb,
  'AC-12, R-8, R-10: one stuck attempt failed, no conflict, the IPs of an old finished and an old ready attempt cleared');
SELECT is((SELECT payload FROM public.outbox_events
            WHERE idempotency_key LIKE 'checkout:' || (SELECT psp_failed FROM rp) || ':verify:reconcile:%'),
  '{"other": true}'::jsonb, 'R-10: a key already taken is left as it is');
SELECT is((SELECT payload ->> 'origin' FROM public.outbox_events
            WHERE idempotency_key LIKE 'checkout:' || (SELECT open_ready FROM rp) || ':verify:reconcile:%'),
  'reconcile', 'review Major 1: a reconcile check says so, so a pending answer finishes it');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.outbox_events o WHERE o.kind = 'payment.verify'
                       AND (o.payload ->> 'attempt_id')::uuid = (SELECT stale_ready FROM rp)),
  'review Major 1: no check for an attempt ready more than 26 hours');
SELECT is((SELECT payer_ip FROM public.checkout_attempts WHERE id = (SELECT ready_with_ip FROM rp)), NULL,
  'security S6: the IP of an attempt started more than 2 hours ago is cleared, finished or not');
SELECT results_eq(
  $$ SELECT o.payload ->> 'final', right(o.idempotency_key, 5)
       FROM public.outbox_events o
      WHERE o.kind = 'payment.verify' AND o.idempotency_key LIKE '%:verify:reconcile:%'
        AND (o.payload ->> 'attempt_id')::uuid IN ((SELECT open_ready FROM rp), (SELECT final_ready FROM rp))
      ORDER BY o.payload ->> 'final' $$,
  $$ VALUES ('false', ':open'), ('true', 'final') $$,
  'AC-12, R-10: a ready attempt older than 10 minutes is checked; older than 2 hours, finally');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.outbox_events o WHERE o.kind = 'payment.verify'
                       AND (o.payload ->> 'attempt_id')::uuid IN ((SELECT young_ready FROM rp), (SELECT disabled FROM rp),
                                                                 (SELECT old_abandoned FROM rp))),
  'AC-12, R-1: a young ready attempt, a non PSP failure and an attempt finished 3 hours ago are not checked');
SELECT results_eq(
  $$ SELECT status, failure_reason FROM public.checkout_attempts
      WHERE id IN ((SELECT stuck_queued FROM rp), (SELECT slow_queued FROM rp)) ORDER BY status $$,
  $$ VALUES ('failed'::text, 'init_failed'::text), ('queued', NULL) $$,
  'AC-12: a queued attempt whose initialize row failed fails; one still retrying waits');
SELECT is((SELECT payer_ip FROM public.checkout_attempts WHERE id = (SELECT old_abandoned FROM rp)), NULL,
  'R-8: the payer''s IP is cleared 2 hours after the attempt finished');
CREATE TEMP TABLE before_rp2 AS SELECT count(*) AS n FROM public.outbox_events;
SELECT public.reconcile_pending();
SELECT is((SELECT count(*) FROM public.outbox_events), (SELECT n FROM before_rp2),
  'R-10: a second run in the same window queues nothing new');

-- ══ AC-12, R-11, R-14: reconcile_daily_list ═════════════════════════════════════
-- 2026-11-10 22:30 UTC is 2026-11-11 01:30 in Istanbul.
UPDATE public.fee_payments SET status = 'paid', psp_payment_id = 'pay-d1', paid_at = '2026-11-10 22:30:00+00', psp_fee_amount = 300
 WHERE request_id = pg_temp.r(10);
UPDATE public.fee_payments SET status = 'paid', psp_payment_id = 'pay-d2', paid_at = '2026-11-10 20:30:00+00', psp_fee_amount = 300
 WHERE request_id = pg_temp.r(11);
INSERT INTO public.fee_refunds (region, request_id, kind, psp_payment_id, amount, currency, reason, status, psp_refund_id, finished_at)
VALUES ('TR', pg_temp.r(12), 'late', 'pay-d3', 5000, 'TRY', 'late_payment', 'done', 'ref-d3', '2026-11-11 08:00:00+00');
SELECT is((SELECT jsonb_agg(e ->> 'psp_payment_id' ORDER BY e ->> 'psp_payment_id')
             FROM jsonb_array_elements(public.reconcile_daily_list('TR', '2026-11-11', 500)) e),
  '["pay-d1", "pay-d3"]'::jsonb, 'AC-12: the Istanbul day''s paid fee and done late refund, not the day before''s');
SELECT is((SELECT e FROM jsonb_array_elements(public.reconcile_daily_list('TR', '2026-11-11', 500)) e
            WHERE e ->> 'psp_payment_id' = 'pay-d1'),
  jsonb_build_object('kind', 'fee', 'ref_id', (SELECT id FROM public.fee_payments WHERE psp_payment_id = 'pay-d1'),
                     'psp_payment_id', 'pay-d1', 'status', 'paid', 'amount', 10000, 'currency', 'TRY', 'psp_fee_amount', 300),
  'R-14: a row''s shape');
SELECT is((SELECT jsonb_agg(e ->> 'psp_payment_id') FROM jsonb_array_elements(public.reconcile_daily_list('TR', '2026-11-10', 500)) e),
  '["pay-d2"]'::jsonb, 'AC-12: the day before holds the other payment');
SELECT public.record_psp_event('reconcile', 'reconcile:2026-11-11:pay-d1', '{}', 'TR');
SELECT is((SELECT jsonb_agg(e ->> 'psp_payment_id') FROM jsonb_array_elements(public.reconcile_daily_list('TR', '2026-11-11', 500)) e),
  '["pay-d3"]'::jsonb, 'R-11: a payment already reconciled that day is left out');
SELECT is(jsonb_array_length(public.reconcile_daily_list('TR', '2026-11-10', 1)), 1, 'R-11: the limit holds');
SELECT is(public.reconcile_daily_list('KSA', '2026-11-11', 500), '[]'::jsonb, 'AC-12: another region''s payments are left out');
SELECT is(pg_temp.err($$ SELECT public.reconcile_daily_list('TR', '2026-11-11', 501) $$), 'validation_failed',
  'R-11: at most 500 rows');
SELECT is(pg_temp.err($$ SELECT public.reconcile_daily_list('XX', '2026-11-11', 10) $$), 'validation_failed',
  'AC-12: an unknown region');

-- ══ AC-13, R-12: outbox_health ═════════════════════════════════════════════════
UPDATE public.outbox_events SET alerted_at = now() WHERE status = 'failed';
INSERT INTO public.fee_refunds (id, region, request_id, kind, psp_payment_id, amount, currency, reason)
VALUES (pg_temp.u('d1'), 'TR', pg_temp.r(13), 'late', 'pay-health', 10000, 'TRY', 'late_payment');
INSERT INTO public.outbox_events (region, kind, idempotency_key, payload, status, attempts, next_attempt_at, last_error)
VALUES ('TR', 'refund.request', 'refund:health-1', jsonb_build_object('fee_refund_id', pg_temp.u('d1')), 'failed', 6, NULL, 'boom'),
       ('TR', 'payment.verify', 'checkout:health:verify:1', '{"attempt_id": "y"}', 'pending', 1, now() - interval '10 minutes', NULL);
CREATE TEMP TABLE h1 AS SELECT public.outbox_health() AS j;
SELECT ok((SELECT (j ->> 'oldest_due_seconds')::bigint >= 600 FROM h1), 'AC-13: the oldest due row''s age in seconds');
SELECT is((SELECT jsonb_agg(f - 'id') FROM h1, jsonb_array_elements(j -> 'failed') f),
  jsonb_build_array(jsonb_build_object('kind', 'refund.request', 'region', 'TR', 'payload',
                                       jsonb_build_object('fee_refund_id', pg_temp.u('d1')))),
  'R-12: a failed row not alerted yet is returned');
SELECT is((SELECT status FROM public.fee_refunds WHERE id = pg_temp.u('d1')), 'failed',
  'security S3: its refund is marked failed in the same transaction as the stamp');
SELECT is((public.outbox_health() -> 'failed'), '[]'::jsonb, 'R-12: and only once');
SELECT is(pg_temp.err($$ UPDATE public.outbox_events SET payload = '{}' WHERE idempotency_key = 'refund:health-1' $$),
  'outbox_immutable', 'R-12: stamping alerted_at leaves the payload guard in place');

-- ══ AC-15: the fake's store ══════════════════════════════════════════════════════
SELECT is(pg_temp.err($$ SELECT public.fake_psp_set('tok-none', '{"outcome": "success"}') $$), 'not_found',
  'AC-15: a token of no attempt is refused');
SELECT is(pg_temp.err($$ SELECT public.fake_psp_set('tok-5', '[1]') $$), 'validation_failed', 'AC-15: the state is an object');
SELECT public.fake_psp_set('tok-5', '{"outcome": "pending", "retrieves": 0}');
SELECT public.fake_psp_set('tok-5', '{"outcome": "pending", "retrieves": 1}');
SELECT is(public.fake_psp_get('tok-5'), '{"outcome": "pending", "retrieves": 1}'::jsonb, 'AC-15: set and get round trip');
SELECT is((SELECT region FROM public.fake_psp_outcomes WHERE token = 'tok-5'), 'TR', 'AC-15: the row takes its attempt''s region');
SELECT is(public.fake_psp_get('tok-none'), NULL, 'AC-15: an unknown token reads null');
SELECT is(public.fake_psp_get((SELECT id FROM a5)::text), '{"outcome": "pending", "retrieves": 1}'::jsonb,
  'security S7: the store is also read by the attempt id, which the fake payment ids carry');

-- ══ security L1, G3: a fake payment books nothing unless the Vault switch says so ══
DELETE FROM vault.secrets WHERE name = 'fake_psp_allowed';
SELECT is(pg_temp.err($$ INSERT INTO public.fee_refunds (region, request_id, kind, psp_payment_id, amount, currency)
                         VALUES ('TR', pg_temp.r(14), 'late', 'fp1_' || gen_random_uuid(), 100, 'TRY') $$),
  'fake_payment_refused', 'security L1: without the switch a fake payment id is refused');
SELECT is(pg_temp.err($$ UPDATE public.fee_payments SET status = 'paid', psp_payment_id = 'fp2_x', paid_at = now(), psp_fee_amount = 0
                         WHERE request_id = pg_temp.r(15) $$),
  'fake_payment_refused', 'security L1: nor can it settle a fee');
SELECT is(pg_temp.err($$ INSERT INTO public.fee_refunds (region, request_id, kind, psp_payment_id, amount, currency)
                         VALUES ('TR', pg_temp.r(14), 'late', 'pay-real-1', 100, 'TRY') $$),
  'none', 'security L1: a real payment id is never fenced');
SELECT vault.create_secret('true', 'fake_psp_allowed');
SELECT is(pg_temp.err($$ INSERT INTO public.fee_refunds (region, request_id, kind, psp_payment_id, amount, currency)
                         VALUES ('TR', pg_temp.r(15), 'late', 'fp1_allowed', 100, 'TRY') $$),
  'none', 'security L1: with the switch on (the local seed) the fake books');

-- ══ security S1: a replayed callback or webhook wakes nothing ══
SELECT vault.create_secret('https://relay.example.test/api/relay', 'relay_url');
SELECT vault.create_secret('relay-test-secret', 'relay_secret');
CREATE TEMP TABLE q0 AS SELECT count(*) AS n FROM net.http_request_queue;
SELECT public.psp_callback('tok-5', '{"again": true}');
SELECT public.psp_webhook('evt-1', 'tok-5', NULL, '{}', 'TR');
SELECT is((SELECT count(*) FROM net.http_request_queue), (SELECT n FROM q0),
  'security S1: a callback in a minute already seen and a replayed webhook send no kick');
SELECT public.psp_webhook('evt-new-kick', 'tok-5', NULL, '{}', 'TR');
SELECT is((SELECT count(*) FROM net.http_request_queue), (SELECT n + 1 FROM q0), 'security S1: a new webhook event kicks once');
DELETE FROM vault.secrets WHERE name IN ('relay_url', 'relay_secret');

-- ══ security G2: the API roles cannot touch the schedules (pg_net's grants are Supabase's own, see the migration) ══
SELECT results_eq(
  $$ SELECT r, has_schema_privilege(r, 'cron', 'USAGE') FROM unnest(ARRAY['anon', 'authenticated']) r ORDER BY r $$,
  $$ VALUES ('anon', false), ('authenticated', false) $$,
  'security G2: no API role may read or change the schedules');

-- ══ AC-20: who may call what ═════════════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default",
            has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            has_function_privilege('service_role', p.oid, 'EXECUTE'),
            has_function_privilege('anon', p.oid, 'EXECUTE'),
            p.prosecdef
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('checkout_context', 'mark_checkout_ready', 'mark_checkout_failed', 'abandon_checkout',
                          'psp_callback', 'psp_webhook', 'mark_refund_failed', 'reconcile_pending', 'reconcile_daily_list',
                          'outbox_health', 'fake_psp_set', 'fake_psp_get', 'relay_kick', 'payments_enabled',
                          'checkout_settings', 'lock_attempt', 'fail_attempt', 'start_checkout', 'psp_payload_strip',
                          'fake_psp_token', 'fake_payment_fence')
      ORDER BY p.proname $$,
  $$ VALUES ('abandon_checkout', false, true, false, true), ('checkout_context', false, true, false, true),
            ('checkout_settings', false, false, false, false), ('fail_attempt', false, false, false, false),
            ('fake_payment_fence', false, false, false, true),
            ('fake_psp_get', false, true, false, true), ('fake_psp_set', false, true, false, true),
            ('fake_psp_token', false, false, false, false),
            ('lock_attempt', false, false, false, false), ('mark_checkout_failed', false, true, false, true),
            ('mark_checkout_ready', false, true, false, true), ('mark_refund_failed', false, true, false, true),
            ('outbox_health', false, true, false, true), ('payments_enabled', false, false, false, false),
            ('psp_callback', false, true, false, true), ('psp_payload_strip', false, false, false, false),
            ('psp_webhook', false, true, false, true), ('reconcile_daily_list', false, true, false, true),
            ('reconcile_pending', false, true, false, true), ('relay_kick', false, false, false, true),
            ('start_checkout', false, false, false, false) $$,
  'AC-20: the relay''s functions are service role only; the internal ones have no grant');

-- A denied customer and anonymous call for each.
CREATE TEMP TABLE calls (sql text);
INSERT INTO calls VALUES
  (format('SELECT public.checkout_context(%L)', (SELECT id FROM a5))),
  (format('SELECT public.mark_checkout_ready(%L, %L, %L)', (SELECT id FROM a4), 'tok-z', 'https://pay.example.test/z')),
  (format('SELECT public.mark_checkout_failed(%L, %L)', (SELECT id FROM a4), 'psp_failed')),
  (format('SELECT public.abandon_checkout(%L)', (SELECT id FROM a5))),
  ($$ SELECT public.psp_callback('tok-5', '{}') $$),
  ($$ SELECT public.psp_webhook('evt-9', 'tok-5', NULL, '{}', 'TR') $$),
  (format('SELECT public.mark_refund_failed(%L)', (SELECT id FROM x1))),
  ($$ SELECT public.reconcile_pending() $$),
  ($$ SELECT public.reconcile_daily_list('TR', '2026-11-11', 10) $$),
  ($$ SELECT public.outbox_health() $$),
  ($$ SELECT public.fake_psp_set('tok-5', '{}') $$),
  ($$ SELECT public.fake_psp_get('tok-5') $$),
  ($$ SELECT public.relay_kick('drain') $$),
  ($$ SELECT public.payments_enabled('TR') $$);
SELECT is_empty(
  $$ SELECT c.sql, r.role, pg_temp.as_role(r.role, c.sql) AS state
       FROM calls c CROSS JOIN (VALUES ('anon'), ('authenticated')) r(role)
      WHERE pg_temp.as_role(r.role, c.sql) <> '42501' $$,
  'AC-20: every relay function refuses an anonymous and a customer call (42501)');
SELECT is((SELECT count(*)::int FROM calls), 14, 'AC-20: fourteen calls were tried as each role');

SELECT * FROM finish();
ROLLBACK;
