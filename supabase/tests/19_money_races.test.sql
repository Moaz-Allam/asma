-- Position 07, spec 0011-07: the money races, with two real sessions through dblink (AC-14, AC-10, AC-7).
--
-- A lock only shows between two sessions, so this file commits its fixtures through a dblink session and
-- removes them at the start and the end. Its ids all start 00000000-0000-0000-0000-0000001900, its PSP ids
-- start race-19-, and nothing else uses either. The money tables refuse a delete even as postgres, so the
-- clean up lifts their triggers inside one transaction, as the owner, and names each table as a value.
--
-- Since 09 (spec 0011-09 AC-5) the real accept check runs here: a pending commission on a SELECTED request
-- whose pick stands, inside the payment window. An accepted payment moves the request to COMMISSION_PAID.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT plan(23);

CREATE FUNCTION pg_temp.conn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('host=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database()) $$;

CREATE FUNCTION pg_temp.clean_up() RETURNS text LANGUAGE sql AS $fn$
  SELECT extensions.dblink_exec(pg_temp.conn(), $$
    BEGIN;
    CREATE TEMP TABLE race_journals ON COMMIT DROP AS
      SELECT id FROM public.ledger_journals
       WHERE idempotency_key LIKE '%race-19-%'
          OR fee_payment_id IN (SELECT f.id FROM public.fee_payments f WHERE f.request_id::text LIKE '00000000-0000-0000-0000-0000001900%');
    DO $do$
    DECLARE t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY['ledger_entries', 'ledger_journals', 'outbox_events', 'fee_refunds', 'checkout_attempts', 'fee_payments'] LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
      END LOOP;
      EXECUTE format('DELETE FROM public.%I WHERE journal_id IN (SELECT id FROM race_journals)', 'ledger_entries');
      EXECUTE format('DELETE FROM public.%I WHERE id IN (SELECT id FROM race_journals)', 'ledger_journals');
      EXECUTE format('DELETE FROM public.%I WHERE idempotency_key LIKE %L
                         OR payload ->> %L IN (SELECT id::text FROM public.fee_payments WHERE request_id::text LIKE %L)
                         OR payload ->> %L IN (SELECT id::text FROM public.fee_refunds WHERE request_id::text LIKE %L)',
                     'outbox_events', '%race-19-%', 'fee_payment_id', '00000000-0000-0000-0000-0000001900%',
                     'fee_refund_id', '00000000-0000-0000-0000-0000001900%');
      EXECUTE format('DELETE FROM public.%I WHERE request_id::text LIKE %L', 'fee_refunds', '00000000-0000-0000-0000-0000001900%');
      EXECUTE format('DELETE FROM public.%I WHERE fee_payment_id IN (SELECT id FROM public.fee_payments WHERE request_id::text LIKE %L)',
                     'checkout_attempts', '00000000-0000-0000-0000-0000001900%');
      EXECUTE format('DELETE FROM public.%I WHERE request_id::text LIKE %L', 'fee_payments', '00000000-0000-0000-0000-0000001900%');
      FOREACH t IN ARRAY ARRAY['ledger_entries', 'ledger_journals', 'outbox_events', 'fee_refunds', 'checkout_attempts', 'fee_payments'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
      END LOOP;
    END $do$;
    DELETE FROM public.audit_log WHERE actor_id::text LIKE '00000000-0000-0000-0000-0000001900%'
       OR entity_id LIKE '00000000-0000-0000-0000-0000001900%'
       OR new_value::text LIKE '%00000000-0000-0000-0000-0000001900%';
    ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
    UPDATE public.requests SET status = CASE WHEN status IN ('SELECTED', 'COMMISSION_PAID') THEN 'OPEN' ELSE status END,
           selected_application_id = NULL, selected_at = NULL, payment_deadline = NULL, fee_deadline = NULL
     WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000001900%' AND selected_application_id IS NOT NULL;
    ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
    ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
    DELETE FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000001900%';
    ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
    ALTER TABLE public.requests DISABLE TRIGGER requests_delete_guard;
    DELETE FROM public.requests WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000001900%';
    ALTER TABLE public.requests ENABLE TRIGGER requests_delete_guard;
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000001900%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000001900%';
    DELETE FROM public.zones WHERE id::text LIKE '00000000-0000-0000-0000-0000001900%';
    DELETE FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000001900%';
    DELETE FROM public.profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000001900%';
    DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-0000001900%';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: a customer, a provider, six requests chosen on the provider, a commission row and an
-- attempt for each, and the accept check of 09.
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  VALUES ('00000000-0000-0000-0000-000000190001', 'authenticated', 'authenticated', '905559190001', now()),
         ('00000000-0000-0000-0000-0000001900c1', 'authenticated', 'authenticated', '905559190099', now());
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  VALUES ('00000000-0000-0000-0000-000000190001', 'provider', 'TR', '+905559190001', 'Yarış Usta', 'tr'),
         ('00000000-0000-0000-0000-0000001900c1', 'customer', 'TR', '+905559190099', 'Yarış Müşteri', 'tr');
  UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Yarış Usta'
   WHERE id = '00000000-0000-0000-0000-000000190001';
  INSERT INTO public.service_categories (id, region, name, active) VALUES ('00000000-0000-0000-0000-0000001900ca', 'TR', '{"tr": "Yarış"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
  VALUES ('00000000-0000-0000-0000-000000190051', '00000000-0000-0000-0000-0000001900ca', 'TR', '{"tr": "Bir"}', 1, 2, true);
  INSERT INTO public.zones (id, region, name, multiplier, active) VALUES ('00000000-0000-0000-0000-000000190021', 'TR', '{"tr": "Semt"}', 1.00, true);
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  SELECT ('00000000-0000-0000-0000-0000001900e' || g)::uuid, 'TR', '00000000-0000-0000-0000-0000001900c1', gen_random_uuid(),
         '00000000-0000-0000-0000-000000190051', '00000000-0000-0000-0000-000000190021', '{}', '[]',
         '{"rounding_minor": 100}', 100000, 10000, 90000, 'TRY', now() + interval '2 days', now() + interval '2 days 2 hours'
    FROM generate_series(1, 6) g;
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT ('00000000-0000-0000-0000-0000001900f' || g)::uuid, 'TR', ('00000000-0000-0000-0000-0000001900e' || g)::uuid,
         '00000000-0000-0000-0000-000000190001', 'An offer for the money races, long enough.'
    FROM generate_series(1, 6) g;
  SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000001900c1", "role": "authenticated"}', true);
  SELECT public.choose_provider(('00000000-0000-0000-0000-0000001900e' || g)::uuid, ('00000000-0000-0000-0000-0000001900f' || g)::uuid)
    FROM generate_series(1, 6) g;
  SELECT public.start_checkout(public.open_fee(('00000000-0000-0000-0000-0000001900e' || g)::uuid, 'commission'), 'tr', NULL)
    FROM generate_series(1, 6) g;
  COMMIT; $$);

CREATE FUNCTION pg_temp.fee(p text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(pg_temp.conn(),
    format($q$ SELECT id::text FROM public.fee_payments WHERE request_id = '00000000-0000-0000-0000-0000001900%s' $q$, p)) AS t(r text) $$;
CREATE FUNCTION pg_temp.one(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(pg_temp.conn(), p_sql) AS t(r text) $$;
-- The relay's call for a request's commission, its ids read first as the owner (the service role reads no
-- money table).
CREATE FUNCTION pg_temp.pay_sql(p_request text, p_psp text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.one(format(
    $q$ SELECT format('SELECT public.apply_fee_paid(%%L, %%L, %%L, %%s, %%L, 300)::text', f.id, a.id, %L, f.amount, f.currency)
          FROM public.fee_payments f JOIN public.checkout_attempts a ON a.fee_payment_id = f.id
         WHERE f.request_id = '00000000-0000-0000-0000-0000001900%s' $q$, p_psp, p_request)) $$;
CREATE FUNCTION pg_temp.result(p_conn text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT r::jsonb FROM extensions.dblink_get_result(p_conn, false) AS t(r text) $$;

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());
SELECT extensions.dblink_exec('a', 'SET ROLE service_role');
SELECT extensions.dblink_exec('b', 'SET ROLE service_role');

-- ── two different PSP payments for one fee at once: one paid, one late ───────
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.pay_sql('e1', 'race-19-p1')) AS t(r text))::jsonb ->> 'status', 'paid',
  'AC-14: the first payment is applied, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.pay_sql('e1', 'race-19-p2'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-14: the second waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b') ->> 'status', 'late', 'AC-14: and then goes late');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one($$ SELECT status || ' ' || psp_payment_id FROM public.fee_payments WHERE request_id = '00000000-0000-0000-0000-0000001900e1' $$),
  'paid race-19-p1', 'AC-14: the fee is paid once, by the first payment');
SELECT is(pg_temp.one($$ SELECT kind || ' ' || status FROM public.fee_refunds WHERE psp_payment_id = 'race-19-p2' $$),
  'late queued', 'AC-14: the second is queued for a refund');

-- ── the same PSP payment twice at once: one applies, the other replays ───────
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.pay_sql('e2', 'race-19-p3')) AS t(r text))::jsonb ->> 'status', 'paid',
  'AC-8: a payment is applied, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.pay_sql('e2', 'race-19-p3'));
SELECT pg_sleep(0.3);
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b') - 'journal_id', '{"status": "paid", "replayed": true}'::jsonb
            || (SELECT (r::jsonb - 'journal_id' - 'replayed') FROM extensions.dblink(pg_temp.conn(),
                  $$ SELECT response::text FROM public.ledger_journals WHERE idempotency_key LIKE 'fee:%:paid'
                       AND fee_payment_id IN (SELECT id FROM public.fee_payments WHERE request_id = '00000000-0000-0000-0000-0000001900e2') $$) AS t(r text)),
  'AC-8: the waiting delivery of the same payment returns the stored result');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one($$ SELECT count(*)::text FROM public.fee_refunds WHERE psp_payment_id = 'race-19-p3' $$), '0',
  'AC-8: and is not booked as a late payment');

-- ── a cancel first: the payment that waits goes late ─────────────────────────
-- Since 09 a cancel is refused while a young attempt is open (AC-2), so the card page of E3 failed first.
SELECT pg_temp.one($$ SELECT public.mark_checkout_failed(a.id, 'psp_failed')::text FROM public.checkout_attempts a
                        JOIN public.fee_payments f ON f.id = a.fee_payment_id
                       WHERE f.request_id = '00000000-0000-0000-0000-0000001900e3' $$);
SELECT extensions.dblink_exec('a', 'RESET ROLE');
SELECT extensions.dblink_exec('a', 'SET ROLE authenticated');
SELECT extensions.dblink_exec('a', $$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000001900c1", "role": "authenticated"}' $$);
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', $$ SELECT public.cancel_request('00000000-0000-0000-0000-0000001900e3', NULL)::text $$) AS t(r text)),
  '{"status": "ok"}', 'AC-14: the customer cancels E3, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.pay_sql('e3', 'race-19-p4'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-14: the payment waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b') ->> 'status', 'late', 'AC-14: and goes late on a cancelled request, with no deadlock');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);

-- ── a payment first: the cancel that waits finishes after it ─────────────────
SELECT extensions.dblink_exec('b', 'RESET ROLE');
SELECT extensions.dblink_exec('b', 'SET ROLE authenticated');
SELECT extensions.dblink_exec('b', $$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000001900c1", "role": "authenticated"}' $$);
SELECT extensions.dblink_exec('a', 'RESET ROLE');
SELECT extensions.dblink_exec('a', 'SET ROLE service_role');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.pay_sql('e4', 'race-19-p5')) AS t(r text))::jsonb ->> 'status', 'paid',
  'AC-14: a payment for E4 is applied, still uncommitted');
SELECT extensions.dblink_send_query('b', $$ SELECT public.cancel_request('00000000-0000-0000-0000-0000001900e4', NULL)::text $$);
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-14: the cancel waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b') ->> 'status', 'ok',
  'AC-14, 12 AC-6: and then cancels the COMMISSION_PAID request, in one order, with no deadlock');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one($$ SELECT r.status || ' ' || f.status || ' ' || x.status || ' ' || (x.amount = f.amount)::text
                          FROM public.requests r JOIN public.fee_payments f ON f.request_id = r.id
                          JOIN public.fee_refunds x ON x.fee_payment_id = f.id
                          WHERE r.id = '00000000-0000-0000-0000-0000001900e4' $$),
  'CANCELLED paid queued true', 'AC-14, 12 AC-7: the commission was paid once and its one refund, of its amount, is queued');

-- ── one PSP payment for two fees on two requests at once: never booked twice ─
SELECT extensions.dblink_exec('b', 'RESET ROLE');
SELECT extensions.dblink_exec('b', 'SET ROLE service_role');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.pay_sql('e5', 'race-19-p6')) AS t(r text))::jsonb ->> 'status', 'paid',
  'reviews: a payment is applied to E5, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.pay_sql('e6', 'race-19-p6'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'reviews: the same payment for E6 waits on the payment lock, though its request is free');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%idempotency_conflict%', 'reviews: and then refuses idempotency_conflict');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one($$ SELECT f.status || ' ' || (SELECT count(*) FROM public.fee_refunds x WHERE x.psp_payment_id = 'race-19-p6')
                          FROM public.fee_payments f WHERE f.request_id = '00000000-0000-0000-0000-0000001900e6' $$),
  'pending 0', 'reviews: E6 stays pending and the payment is not booked as late');

-- ── two relays claim the outbox at once: skip locked, no row twice ───────────
SELECT extensions.dblink_exec('a', 'RESET ROLE');
SELECT extensions.dblink_exec('b', 'RESET ROLE');
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  SELECT public.enqueue_outbox('payment.verify', 'race-19-o' || g, jsonb_build_object('n', g), 'TR') FROM generate_series(1, 4) g;
  COMMIT; $$);
SELECT extensions.dblink_exec('a', 'SET ROLE service_role');
SELECT extensions.dblink_exec('b', 'SET ROLE service_role');
SELECT extensions.dblink_exec('a', 'BEGIN');
CREATE TEMP TABLE claim_a AS
  SELECT r::jsonb AS j FROM extensions.dblink('a', $$ SELECT public.claim_outbox(1, 'race-a')::text $$) AS t(r text);
SELECT is((SELECT jsonb_array_length(j) FROM claim_a), 1, 'AC-10: the first relay claims one row, still uncommitted');
CREATE TEMP TABLE claim_b AS
  SELECT r::jsonb AS j FROM extensions.dblink('b', $$ SELECT public.claim_outbox(100, 'race-b')::text $$) AS t(r text);
SELECT is_empty(
  $$ SELECT x ->> 'id' FROM claim_a, jsonb_array_elements(j) x
     INTERSECT
     SELECT x ->> 'id' FROM claim_b, jsonb_array_elements(j) x $$,
  'AC-10: the second claims other rows at once, never the locked one');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.one($$ SELECT count(*)::text FROM public.outbox_events WHERE idempotency_key LIKE 'race-19-o%' AND attempts = 1 $$), '4',
  'AC-10: every row claimed exactly once');

-- ── the books after the races ────────────────────────────────────────────────
SELECT is(pg_temp.one($$ SELECT set_config('request.jwt.claims', '{"role": "service_role"}', false) || (public.ledger_check('TR') -> 'imbalances')::text $$),
  '{"role": "service_role"}[]', 'AC-14: the books balance');

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();

SELECT * FROM finish();
ROLLBACK;
