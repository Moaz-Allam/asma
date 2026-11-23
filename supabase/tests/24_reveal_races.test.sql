-- Position 10, spec 0011-10 AC-14: the provider fee races, with two real sessions through dblink.
--
-- Two presses of Pay at once make one attempt (AC-2); a suspend that commits first makes a waiting press refuse
-- (AC-2, D156: the press takes the provider row for share); two verified payments on two attempts of one fee reveal
-- once and refund the other (AC-3, AC-4, R-9), with no deadlock; and the books balance after.
--
-- Like 22, this file commits its fixtures through a dblink session and removes them at the start and the end. Its ids
-- all start 00000000-0000-0000-0000-0000002400, its PSP ids start race-24-, and nothing else uses either. It turns
-- payments on for TR (the local seed does the same) and leaves them on.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT plan(11);

CREATE FUNCTION pg_temp.conn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('host=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database()) $$;

CREATE FUNCTION pg_temp.clean_up() RETURNS text LANGUAGE sql AS $fn$
  SELECT extensions.dblink_exec(pg_temp.conn(), $$
    BEGIN;
    CREATE TEMP TABLE race_fees ON COMMIT DROP AS
      SELECT id FROM public.fee_payments WHERE request_id::text LIKE '00000000-0000-0000-0000-0000002400%';
    CREATE TEMP TABLE race_journals ON COMMIT DROP AS
      SELECT id FROM public.ledger_journals
       WHERE idempotency_key LIKE '%race-24-%' OR fee_payment_id IN (SELECT id FROM race_fees);
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
                     'outbox_events', '%race-24-%', 'fee_payment_id', 'attempt_id', 'fee_refund_id',
                     '00000000-0000-0000-0000-0000002400%');
      EXECUTE format('DELETE FROM public.%I WHERE request_id::text LIKE %L', 'fee_refunds', '00000000-0000-0000-0000-0000002400%');
      EXECUTE format('DELETE FROM public.%I WHERE fee_payment_id IN (SELECT id FROM race_fees)', 'checkout_attempts');
      EXECUTE format('DELETE FROM public.%I WHERE id IN (SELECT id FROM race_fees)', 'fee_payments');
      FOREACH t IN ARRAY ARRAY['ledger_entries', 'ledger_journals', 'outbox_events', 'fee_refunds', 'checkout_attempts', 'fee_payments'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
      END LOOP;
    END $do$;
    DELETE FROM public.action_counters WHERE subject_id IN (SELECT id FROM race_fees);
    DELETE FROM public.audit_log WHERE actor_id::text LIKE '00000000-0000-0000-0000-0000002400%'
       OR entity_id LIKE '00000000-0000-0000-0000-0000002400%'
       OR entity_id IN (SELECT id::text FROM race_fees)
       OR new_value::text LIKE '%00000000-0000-0000-0000-0000002400%';
    ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
    UPDATE public.requests SET status = 'OPEN', selected_application_id = NULL, selected_at = NULL, payment_deadline = NULL,
           fee_deadline = NULL, closed_at = NULL
     WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000002400%' AND selected_application_id IS NOT NULL;
    ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
    -- Spec 0011-20: the agreements and acceptances of these picks (append only, so their guards are lifted here).
    ALTER TABLE public.service_agreements DISABLE TRIGGER USER;
    ALTER TABLE public.agreement_acceptances DISABLE TRIGGER USER;
    ALTER TABLE public.outbox_events DISABLE TRIGGER USER;
    DELETE FROM public.outbox_events WHERE kind = 'agreement.render'
       AND payload ->> 'agreement_id' IN (SELECT id::text FROM public.service_agreements WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000002400%'));
    DELETE FROM public.service_agreements WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000002400%');
    DELETE FROM public.agreement_acceptances WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000002400%');
    ALTER TABLE public.outbox_events ENABLE TRIGGER USER;
    ALTER TABLE public.agreement_acceptances ENABLE TRIGGER USER;
    ALTER TABLE public.service_agreements ENABLE TRIGGER USER;
    ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
    DELETE FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000002400%';
    ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
    ALTER TABLE public.requests DISABLE TRIGGER requests_delete_guard;
    DELETE FROM public.requests WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000002400%';
    ALTER TABLE public.requests ENABLE TRIGGER requests_delete_guard;
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000002400%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000002400%';
    DELETE FROM public.zones WHERE id::text LIKE '00000000-0000-0000-0000-0000002400%';
    DELETE FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000002400%';
    DELETE FROM public.profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000002400%';
    DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-0000002400%';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: a customer, two approved providers, three requests with offers from both, the first provider
-- chosen and the commission (0) settled, so each waits for the provider fee (5000). E3 gets a second attempt.
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'payments_enabled';
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  VALUES ('00000000-0000-0000-0000-000000240001', 'authenticated', 'authenticated', '905559240001', now()),
         ('00000000-0000-0000-0000-000000240002', 'authenticated', 'authenticated', '905559240002', now()),
         ('00000000-0000-0000-0000-0000002400c1', 'authenticated', 'authenticated', '905559240099', now());
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  VALUES ('00000000-0000-0000-0000-000000240001', 'provider', 'TR', '+905559240001', 'Yarış Bir', 'tr'),
         ('00000000-0000-0000-0000-000000240002', 'provider', 'TR', '+905559240002', 'Yarış İki', 'tr'),
         ('00000000-0000-0000-0000-0000002400c1', 'customer', 'TR', '+905559240099', 'Yarış Müşteri', 'tr');
  UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Yarış'
   WHERE id IN ('00000000-0000-0000-0000-000000240001', '00000000-0000-0000-0000-000000240002');
  INSERT INTO public.service_categories (id, region, name, active) VALUES ('00000000-0000-0000-0000-0000002400ca', 'TR', '{"tr": "Yarış"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
  VALUES ('00000000-0000-0000-0000-000000240051', '00000000-0000-0000-0000-0000002400ca', 'TR', '{"tr": "Bir"}', 1, 2, true);
  INSERT INTO public.zones (id, region, name, multiplier, active) VALUES ('00000000-0000-0000-0000-000000240021', 'TR', '{"tr": "Semt"}', 1.00, true);
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  SELECT ('00000000-0000-0000-0000-0000002400e' || g)::uuid, 'TR', '00000000-0000-0000-0000-0000002400c1', gen_random_uuid(),
         '00000000-0000-0000-0000-000000240051', '00000000-0000-0000-0000-000000240021', '{}', '[]',
         '{"rounding_minor": 100}', 100000, 0, 100000, 'TRY', now() + interval '2 days', now() + interval '2 days 2 hours'
    FROM generate_series(1, 3) g;
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT ('00000000-0000-0000-0000-0000002400f' || g)::uuid, 'TR', ('00000000-0000-0000-0000-0000002400e' || g)::uuid,
         '00000000-0000-0000-0000-000000240001', 'An offer for the reveal races, long enough.'
    FROM generate_series(1, 3) g;
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT ('00000000-0000-0000-0000-0000002400a' || g)::uuid, 'TR', ('00000000-0000-0000-0000-0000002400e' || g)::uuid,
         '00000000-0000-0000-0000-000000240002', 'A second offer for the reveal races, long enough.'
    FROM generate_series(1, 3) g;
  SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000002400c1", "role": "authenticated"}', true);
  SELECT public.choose_provider(('00000000-0000-0000-0000-0000002400e' || g)::uuid, ('00000000-0000-0000-0000-0000002400f' || g)::uuid, 'draft-1')
    FROM generate_series(1, 3) g;
  SELECT public.pay_commission(('00000000-0000-0000-0000-0000002400e' || g)::uuid, 'tr', NULL, 'draft-1') FROM generate_series(1, 3) g;
  SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000240001", "role": "authenticated"}', true);
  SELECT public.pay_provider_fee('00000000-0000-0000-0000-0000002400f3', 'tr', NULL, 'draft-1');
  INSERT INTO public.checkout_attempts (region, fee_payment_id, status, locale, psp_token, url, started_at)
  SELECT 'TR', f.id, 'ready', 'tr', 'race-24-tok-b', 'https://pay.example.test/p/race-24-b', now() - interval '1 minute'
    FROM public.fee_payments f WHERE f.request_id = '00000000-0000-0000-0000-0000002400e3' AND f.kind = 'provider_fee';
  COMMIT; $$);

CREATE FUNCTION pg_temp.one(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(pg_temp.conn(), p_sql) AS t(r text) $$;
CREATE FUNCTION pg_temp.result(p_conn text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT r::jsonb FROM extensions.dblink_get_result(p_conn, false) AS t(r text) $$;
CREATE FUNCTION pg_temp.pay_sql(p text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.pay_provider_fee(%L, %L, NULL, ''draft-1'')::text', '00000000-0000-0000-0000-0000002400f' || p, 'tr') $$;
-- The relay's call for E3's provider fee on its n-th newest attempt, its ids read first as the owner.
CREATE FUNCTION pg_temp.apply_sql(p_nth integer, p_psp text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.one(format(
    $q$ SELECT format('SELECT public.apply_fee_paid(%%L, %%L, %%L, %%s, %%L, 150)::text', f.id, a.id, %L, f.amount, f.currency)
          FROM public.fee_payments f JOIN public.checkout_attempts a ON a.fee_payment_id = f.id
         WHERE f.request_id = '00000000-0000-0000-0000-0000002400e3' AND f.kind = 'provider_fee'
         ORDER BY a.started_at DESC, a.id OFFSET %s LIMIT 1 $q$, p_psp, p_nth - 1)) $$;
CREATE FUNCTION pg_temp.as_provider(p_conn text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.dblink_exec(p_conn, 'RESET ROLE')
      || extensions.dblink_exec(p_conn, 'SET ROLE authenticated')
      || extensions.dblink_exec(p_conn, $q$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000240001", "role": "authenticated"}' $q$) $$;
CREATE FUNCTION pg_temp.as_relay(p_conn text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.dblink_exec(p_conn, 'RESET ROLE') || extensions.dblink_exec(p_conn, 'SET ROLE service_role') $$;
CREATE FUNCTION pg_temp.as_owner(p_conn text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.dblink_exec(p_conn, 'RESET ROLE') $$;

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());

-- ── two presses at once: one attempt ─────────────────────────────────────────
SELECT pg_temp.as_provider('a');
SELECT pg_temp.as_provider('b');
SELECT extensions.dblink_exec('a', 'BEGIN');
CREATE TEMP TABLE p1 AS SELECT r::jsonb AS j FROM extensions.dblink('a', pg_temp.pay_sql('1')) AS t(r text);
SELECT is((SELECT j - 'attempt_id' FROM p1), '{"status": "checkout", "reused": false}',
  'AC-2: the first press opens an attempt, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.pay_sql('1'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-2: the second press waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b'), (SELECT j || '{"reused": true}' FROM p1), 'AC-2: and then gets the same attempt back');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one($$ SELECT count(*)::text || ' ' || (SELECT c.count FROM public.action_counters c WHERE c.subject_id = f.id)
                          FROM public.checkout_attempts a JOIN public.fee_payments f ON f.id = a.fee_payment_id
                         WHERE f.request_id = '00000000-0000-0000-0000-0000002400e1' AND f.kind = 'provider_fee' GROUP BY f.id $$),
  '1 1', 'AC-2: one attempt, counted once');

-- ── a suspend first: the press that waits refuses ────────────────────────────
SELECT pg_temp.as_owner('a');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT extensions.dblink_exec('a', $$UPDATE public.providers SET status = 'suspended', suspension_reason = 'A race with the fee'
                                      WHERE id = '00000000-0000-0000-0000-000000240001'$$);
SELECT extensions.dblink_send_query('b', pg_temp.pay_sql('2'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-2, D156: the press waits on the provider row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%invalid_state%', 'AC-2: and then refuses invalid_state, opening nothing');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT extensions.dblink_exec(pg_temp.conn(), $$UPDATE public.providers SET status = 'approved', suspension_reason = NULL
                                                WHERE id = '00000000-0000-0000-0000-000000240001'$$);

-- ── two verified payments at once: one reveal, one refund ────────────────────
SELECT pg_temp.as_relay('a');
SELECT pg_temp.as_relay('b');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.apply_sql(1, 'race-24-p3a')) AS t(r text))::jsonb ->> 'status', 'paid',
  'AC-3: a payment for E3 is applied, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.apply_sql(2, 'race-24-p3b'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'R-9: the second payment waits');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b') ->> 'status', 'late', 'R-9: and then goes late, with no deadlock');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one($$ SELECT r.status || ' ' || a.status || ' ' || b.status || ' ' || (a.unlocked_at IS NOT NULL)::text
                          FROM public.requests r JOIN public.applications a ON a.id = r.selected_application_id
                          JOIN public.applications b ON b.id = '00000000-0000-0000-0000-0000002400a3'
                         WHERE r.id = '00000000-0000-0000-0000-0000002400e3' $$),
  'UNLOCKED UNLOCKED NOT_SELECTED true', 'AC-4: revealed once, the other applicant NOT_SELECTED');

-- ── the books after the races ────────────────────────────────────────────────
SELECT is(pg_temp.one($$ SELECT set_config('request.jwt.claims', '{"role": "service_role"}', false) || (public.ledger_check('TR') -> 'imbalances')::text $$),
  '{"role": "service_role"}[]', 'the books balance');

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();

SELECT * FROM finish();
ROLLBACK;
