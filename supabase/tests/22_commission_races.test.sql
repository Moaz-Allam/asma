-- Position 09, spec 0011-09 AC-15: the commission races, with two real sessions through dblink.
--
-- Two presses of Pay at once make one attempt (AC-4); a cancel and a press in either order (AC-2, AC-4); a
-- verified payment and a cancel in either order (AC-2, AC-5, AC-6); and a payment applied inside and after
-- the checkout hold that follows the payment deadline (AC-5).
--
-- Like 19, this file commits its fixtures through a dblink session and removes them at the start and the
-- end. Its ids all start 00000000-0000-0000-0000-0000002200, its PSP ids start race-22-, and nothing else
-- uses either. It turns payments on for TR (the local seed does the same) and leaves them on.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT plan(20);

CREATE FUNCTION pg_temp.conn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('host=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database()) $$;

CREATE FUNCTION pg_temp.clean_up() RETURNS text LANGUAGE sql AS $fn$
  SELECT extensions.dblink_exec(pg_temp.conn(), $$
    BEGIN;
    CREATE TEMP TABLE race_fees ON COMMIT DROP AS
      SELECT id FROM public.fee_payments WHERE request_id::text LIKE '00000000-0000-0000-0000-0000002200%';
    CREATE TEMP TABLE race_journals ON COMMIT DROP AS
      SELECT id FROM public.ledger_journals
       WHERE idempotency_key LIKE '%race-22-%' OR fee_payment_id IN (SELECT id FROM race_fees);
    DO $do$
    DECLARE t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY['ledger_entries', 'ledger_journals', 'outbox_events', 'fee_refunds', 'checkout_attempts', 'fee_payments'] LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
      END LOOP;
      EXECUTE format('DELETE FROM public.%I WHERE journal_id IN (SELECT id FROM race_journals)', 'ledger_entries');
      EXECUTE format('DELETE FROM public.%I WHERE id IN (SELECT id FROM race_journals)', 'ledger_journals');
      EXECUTE format('DELETE FROM public.%I WHERE idempotency_key LIKE %L
                         OR payload ->> %L IN (SELECT id::text FROM race_fees)
                         OR payload ->> %L IN (SELECT a.id::text FROM public.checkout_attempts a WHERE a.fee_payment_id IN (SELECT id FROM race_fees))
                         OR payload ->> %L IN (SELECT id::text FROM public.fee_refunds WHERE request_id::text LIKE %L)',
                     'outbox_events', '%race-22-%', 'fee_payment_id', 'attempt_id', 'fee_refund_id',
                     '00000000-0000-0000-0000-0000002200%');
      EXECUTE format('DELETE FROM public.%I WHERE request_id::text LIKE %L', 'fee_refunds', '00000000-0000-0000-0000-0000002200%');
      EXECUTE format('DELETE FROM public.%I WHERE fee_payment_id IN (SELECT id FROM race_fees)', 'checkout_attempts');
      EXECUTE format('DELETE FROM public.%I WHERE id IN (SELECT id FROM race_fees)', 'fee_payments');
      FOREACH t IN ARRAY ARRAY['ledger_entries', 'ledger_journals', 'outbox_events', 'fee_refunds', 'checkout_attempts', 'fee_payments'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
      END LOOP;
    END $do$;
    DELETE FROM public.action_counters WHERE subject_id IN (SELECT id FROM race_fees);
    DELETE FROM public.audit_log WHERE actor_id::text LIKE '00000000-0000-0000-0000-0000002200%'
       OR entity_id LIKE '00000000-0000-0000-0000-0000002200%'
       OR entity_id IN (SELECT id::text FROM race_fees)
       OR new_value::text LIKE '%00000000-0000-0000-0000-0000002200%';
    ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
    UPDATE public.requests SET status = CASE WHEN status = 'CANCELLED' THEN status ELSE 'OPEN' END, selected_application_id = NULL, selected_at = NULL, payment_deadline = NULL,
           fee_deadline = NULL
     WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000002200%' AND selected_application_id IS NOT NULL;
    ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
    ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
    DELETE FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000002200%';
    ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
    ALTER TABLE public.requests DISABLE TRIGGER requests_delete_guard;
    DELETE FROM public.requests WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000002200%';
    ALTER TABLE public.requests ENABLE TRIGGER requests_delete_guard;
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000002200%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000002200%';
    DELETE FROM public.zones WHERE id::text LIKE '00000000-0000-0000-0000-0000002200%';
    DELETE FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000002200%';
    DELETE FROM public.profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000002200%';
    DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-0000002200%';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: a customer, an approved provider, seven requests chosen on the provider. E4 and E5 are paid
-- for (a queued attempt each), E5's card page then failed; E6 and E7 had a window that closed 10 and 20
-- minutes ago, with a card page opened 3 hours ago (the hold is 15 minutes).
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'payments_enabled';
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  VALUES ('00000000-0000-0000-0000-000000220001', 'authenticated', 'authenticated', '905559220001', now()),
         ('00000000-0000-0000-0000-0000002200c1', 'authenticated', 'authenticated', '905559220099', now());
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  VALUES ('00000000-0000-0000-0000-000000220001', 'provider', 'TR', '+905559220001', 'Yarış Usta', 'tr'),
         ('00000000-0000-0000-0000-0000002200c1', 'customer', 'TR', '+905559220099', 'Yarış Müşteri', 'tr');
  UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Yarış Usta'
   WHERE id = '00000000-0000-0000-0000-000000220001';
  INSERT INTO public.service_categories (id, region, name, active) VALUES ('00000000-0000-0000-0000-0000002200ca', 'TR', '{"tr": "Yarış"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
  VALUES ('00000000-0000-0000-0000-000000220051', '00000000-0000-0000-0000-0000002200ca', 'TR', '{"tr": "Bir"}', 1, 2, true);
  INSERT INTO public.zones (id, region, name, multiplier, active) VALUES ('00000000-0000-0000-0000-000000220021', 'TR', '{"tr": "Semt"}', 1.00, true);
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  SELECT ('00000000-0000-0000-0000-0000002200e' || g)::uuid, 'TR', '00000000-0000-0000-0000-0000002200c1', gen_random_uuid(),
         '00000000-0000-0000-0000-000000220051', '00000000-0000-0000-0000-000000220021', '{}', '[]',
         '{"rounding_minor": 100}', 100000, 10000, 90000, 'TRY', now() + interval '2 days', now() + interval '2 days 2 hours'
    FROM generate_series(1, 7) g;
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT ('00000000-0000-0000-0000-0000002200f' || g)::uuid, 'TR', ('00000000-0000-0000-0000-0000002200e' || g)::uuid,
         '00000000-0000-0000-0000-000000220001', 'An offer for the commission races, long enough.'
    FROM generate_series(1, 7) g;
  SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000002200c1", "role": "authenticated"}', true);
  SELECT public.choose_provider(('00000000-0000-0000-0000-0000002200e' || g)::uuid, ('00000000-0000-0000-0000-0000002200f' || g)::uuid)
    FROM generate_series(1, 7) g;
  SELECT public.pay_commission(('00000000-0000-0000-0000-0000002200e' || g)::uuid, 'tr', NULL) FROM generate_series(4, 5) g;
  SELECT public.fail_attempt(a.id, 'psp_failed') FROM public.checkout_attempts a JOIN public.fee_payments f ON f.id = a.fee_payment_id
   WHERE f.request_id = '00000000-0000-0000-0000-0000002200e5';
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests SET selected_at = now() - interval '4 hours',
         payment_deadline = now() - CASE id WHEN '00000000-0000-0000-0000-0000002200e6' THEN interval '10 minutes' ELSE interval '20 minutes' END
   WHERE id IN ('00000000-0000-0000-0000-0000002200e6', '00000000-0000-0000-0000-0000002200e7');
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
  SELECT public.open_fee(('00000000-0000-0000-0000-0000002200e' || g)::uuid, 'commission') FROM generate_series(6, 7) g;
  INSERT INTO public.checkout_attempts (region, fee_payment_id, status, locale, psp_token, url, started_at)
  SELECT 'TR', f.id, 'ready', 'tr', 'race-22-tok-' || f.request_id, 'https://pay.example.test/p/race-22-' || f.request_id,
         now() - interval '3 hours'
    FROM public.fee_payments f
   WHERE f.request_id IN ('00000000-0000-0000-0000-0000002200e6', '00000000-0000-0000-0000-0000002200e7');
  COMMIT; $$);

CREATE FUNCTION pg_temp.one(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(pg_temp.conn(), p_sql) AS t(r text) $$;
CREATE FUNCTION pg_temp.result(p_conn text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT r::jsonb FROM extensions.dblink_get_result(p_conn, false) AS t(r text) $$;
CREATE FUNCTION pg_temp.pay_sql(p text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.pay_commission(%L, %L, NULL)::text', '00000000-0000-0000-0000-0000002200e' || p, 'tr') $$;
CREATE FUNCTION pg_temp.cancel_sql(p text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.cancel_request(%L, NULL)::text', '00000000-0000-0000-0000-0000002200e' || p) $$;
-- The relay's call for a request's commission on its newest attempt, its ids read first as the owner.
CREATE FUNCTION pg_temp.apply_sql(p text, p_psp text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.one(format(
    $q$ SELECT format('SELECT public.apply_fee_paid(%%L, %%L, %%L, %%s, %%L, 300)::text', f.id, a.id, %L, f.amount, f.currency)
          FROM public.fee_payments f JOIN public.checkout_attempts a ON a.fee_payment_id = f.id
         WHERE f.request_id = '00000000-0000-0000-0000-0000002200e%s'
         ORDER BY a.started_at DESC, a.id LIMIT 1 $q$, p_psp, p)) $$;
CREATE FUNCTION pg_temp.as_customer(p_conn text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.dblink_exec(p_conn, 'RESET ROLE')
      || extensions.dblink_exec(p_conn, 'SET ROLE authenticated')
      || extensions.dblink_exec(p_conn, $q$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000002200c1", "role": "authenticated"}' $q$) $$;
CREATE FUNCTION pg_temp.as_relay(p_conn text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.dblink_exec(p_conn, 'RESET ROLE') || extensions.dblink_exec(p_conn, 'SET ROLE service_role') $$;

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());

-- ── two presses at once: one attempt ─────────────────────────────────────────
SELECT pg_temp.as_customer('a');
SELECT pg_temp.as_customer('b');
SELECT extensions.dblink_exec('a', 'BEGIN');
CREATE TEMP TABLE p1 AS SELECT r::jsonb AS j FROM extensions.dblink('a', pg_temp.pay_sql('1')) AS t(r text);
SELECT is((SELECT j - 'attempt_id' FROM p1), '{"status": "checkout", "reused": false}',
  'AC-4: the first press opens an attempt, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.pay_sql('1'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-4: the second press waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b'), (SELECT j || '{"reused": true}' FROM p1), 'AC-4: and then gets the same attempt back');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one($$ SELECT count(*)::text || ' ' || (SELECT c.count FROM public.action_counters c WHERE c.subject_id = f.id)
                          FROM public.checkout_attempts a JOIN public.fee_payments f ON f.id = a.fee_payment_id
                         WHERE f.request_id = '00000000-0000-0000-0000-0000002200e1' GROUP BY f.id $$),
  '1 1', 'AC-4: one attempt, counted once');

-- ── a cancel first: the press that waits finds it cancelled ──────────────────
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.cancel_sql('2')) AS t(r text)), '{"status": "ok"}',
  'AC-2: the customer cancels E2, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.pay_sql('2'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-4: the press waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%invalid_state%', 'AC-4: and then refuses invalid_state, opening nothing');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);

-- ── a press first: the cancel that waits finds the card page open ────────────
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.pay_sql('3')) AS t(r text))::jsonb ->> 'status', 'checkout',
  'AC-4: a press on E3 opens an attempt, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.cancel_sql('3'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-2: the cancel waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%checkout_open%', 'AC-2: and then refuses checkout_open');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);

-- ── a verified payment first: the cancel that waits finds it paid ────────────
SELECT pg_temp.as_relay('a');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.apply_sql('4', 'race-22-p4')) AS t(r text))::jsonb ->> 'status', 'paid',
  'AC-5: a payment for E4 is applied, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.cancel_sql('4'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-2: the cancel waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%not_cancellable%', 'AC-2: and then refuses not_cancellable');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one($$ SELECT r.status || ' ' || a.status || ' ' || f.status FROM public.requests r
                          JOIN public.applications a ON a.id = r.selected_application_id
                          JOIN public.fee_payments f ON f.request_id = r.id
                         WHERE r.id = '00000000-0000-0000-0000-0000002200e4' $$),
  'COMMISSION_PAID AWAITING_FEE paid', 'AC-6: the request moved on, once');

-- ── a cancel first: the payment that waits goes late ─────────────────────────
SELECT pg_temp.as_customer('a');
SELECT pg_temp.as_relay('b');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.cancel_sql('5')) AS t(r text)), '{"status": "ok"}',
  'AC-2: E5''s card page failed, so the customer cancels it, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.apply_sql('5', 'race-22-p5'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-5: the payment waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b') ->> 'status', 'late', 'AC-5: and then goes late on the cancelled request, with no deadlock');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);

-- ── the deadline plus the hold ───────────────────────────────────────────────
SELECT pg_temp.as_relay('a');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.apply_sql('6', 'race-22-p6')) AS t(r text))::jsonb ->> 'status', 'paid',
  'AC-5: 10 minutes after the deadline, inside the hold, a card page opened in time is accepted');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.apply_sql('7', 'race-22-p7')) AS t(r text))::jsonb ->> 'status', 'late',
  'AC-5: 20 minutes after the deadline, past the hold, it is refunded as late');

-- ── the books after the races ────────────────────────────────────────────────
SELECT is(pg_temp.one($$ SELECT set_config('request.jwt.claims', '{"role": "service_role"}', false) || (public.ledger_check('TR') -> 'imbalances')::text $$),
  '{"role": "service_role"}[]', 'the books balance');

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();

SELECT * FROM finish();
ROLLBACK;
