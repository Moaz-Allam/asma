-- Position 12, spec 0011-12 AC-13: the cancel, expiry and refund races, with two real sessions through dblink.
--
-- A verified payment and a customer's cancel (row 5: the cancel waits, then refunds); two cancels at once (one
-- refund); the expiry against a payment in flight in either order (skip locked never waits; a payment that waits on
-- the expiry goes late); two refunds of one fee at once (one row); and a provider fee in flight at a customer's cancel
-- (R-12: the cancel is not held, the payment that lands after it goes late). Every race ends with balanced books.
--
-- Like 22, this file commits its fixtures through a dblink session and removes them at the start and the end. Its ids
-- all start 00000000-0000-0000-0000-0000002800, its PSP ids start race-28-, and nothing else uses either. It turns
-- payments on for TR (the local seed does the same) and leaves them on. It pauses the expiry cron job
-- (requests-expire-windows) while its committed fixtures exist, so the job never moves them under the test, and its
-- clean up turns the job back on.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT plan(27);

CREATE FUNCTION pg_temp.conn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('host=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database()) $$;

CREATE FUNCTION pg_temp.clean_up() RETURNS text LANGUAGE sql AS $fn$
  SELECT extensions.dblink_exec(pg_temp.conn(), $$
    BEGIN;
    CREATE TEMP TABLE race_fees ON COMMIT DROP AS
      SELECT id FROM public.fee_payments WHERE request_id::text LIKE '00000000-0000-0000-0000-0000002800%';
    CREATE TEMP TABLE race_refunds ON COMMIT DROP AS
      SELECT id FROM public.fee_refunds WHERE request_id::text LIKE '00000000-0000-0000-0000-0000002800%';
    CREATE TEMP TABLE race_journals ON COMMIT DROP AS
      SELECT id FROM public.ledger_journals
       WHERE idempotency_key LIKE '%race-28-%' OR fee_payment_id IN (SELECT id FROM race_fees);
    DO $do$
    DECLARE t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY['ledger_entries', 'ledger_journals', 'outbox_events', 'fee_refunds', 'checkout_attempts', 'fee_payments'] LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
      END LOOP;
      EXECUTE format('DELETE FROM public.%I WHERE journal_id IN (SELECT id FROM race_journals)', 'ledger_entries');
      EXECUTE format('DELETE FROM public.%I WHERE id IN (SELECT id FROM race_journals)', 'ledger_journals');
      EXECUTE format('DELETE FROM public.%I WHERE payload ->> %L IN (SELECT id::text FROM race_fees)
                         OR payload ->> %L IN (SELECT a.id::text FROM public.checkout_attempts a WHERE a.fee_payment_id IN (SELECT id FROM race_fees))
                         OR payload ->> %L IN (SELECT id::text FROM race_refunds)',
                     'outbox_events', 'fee_payment_id', 'attempt_id', 'fee_refund_id');
      EXECUTE format('DELETE FROM public.%I WHERE id IN (SELECT id FROM race_refunds)', 'fee_refunds');
      EXECUTE format('DELETE FROM public.%I WHERE fee_payment_id IN (SELECT id FROM race_fees)', 'checkout_attempts');
      EXECUTE format('DELETE FROM public.%I WHERE id IN (SELECT id FROM race_fees)', 'fee_payments');
      FOREACH t IN ARRAY ARRAY['ledger_entries', 'ledger_journals', 'outbox_events', 'fee_refunds', 'checkout_attempts', 'fee_payments'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
      END LOOP;
    END $do$;
    DELETE FROM public.action_counters WHERE subject_id IN (SELECT id FROM race_fees);
    DELETE FROM public.audit_log WHERE actor_id::text LIKE '00000000-0000-0000-0000-0000002800%'
       OR entity_id LIKE '00000000-0000-0000-0000-0000002800%'
       OR entity_id IN (SELECT id::text FROM race_fees)
       OR entity_id IN (SELECT id::text FROM race_refunds)
       OR new_value::text LIKE '%00000000-0000-0000-0000-0000002800%';
    ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
    UPDATE public.requests SET status = CASE WHEN status = 'CANCELLED' THEN status ELSE 'OPEN' END, selected_application_id = NULL,
           selected_at = NULL, payment_deadline = NULL, fee_deadline = NULL
     WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000002800%' AND selected_application_id IS NOT NULL;
    ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
    -- Spec 0011-20: the agreements and acceptances of these picks (append only, so their guards are lifted here).
    ALTER TABLE public.service_agreements DISABLE TRIGGER USER;
    ALTER TABLE public.agreement_acceptances DISABLE TRIGGER USER;
    ALTER TABLE public.outbox_events DISABLE TRIGGER USER;
    DELETE FROM public.outbox_events WHERE kind = 'agreement.render'
       AND payload ->> 'agreement_id' IN (SELECT id::text FROM public.service_agreements WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000002800%'));
    DELETE FROM public.service_agreements WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000002800%');
    DELETE FROM public.agreement_acceptances WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000002800%');
    ALTER TABLE public.outbox_events ENABLE TRIGGER USER;
    ALTER TABLE public.agreement_acceptances ENABLE TRIGGER USER;
    ALTER TABLE public.service_agreements ENABLE TRIGGER USER;
    ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
    DELETE FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000002800%';
    ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
    ALTER TABLE public.requests DISABLE TRIGGER requests_delete_guard;
    DELETE FROM public.requests WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000002800%';
    ALTER TABLE public.requests ENABLE TRIGGER requests_delete_guard;
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000002800%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000002800%';
    DELETE FROM public.zones WHERE id::text LIKE '00000000-0000-0000-0000-0000002800%';
    DELETE FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000002800%';
    DELETE FROM public.profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000002800%';
    DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-0000002800%';
    SELECT cron.alter_job(jobid, active := true) FROM cron.job WHERE jobname = 'requests-expire-windows';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: a customer c1, providers p1 and p2, an admin, six requests (price 100000, commission 10000)
-- chosen on p1. E1 SELECTED, its card page failed; E2 and E3 SELECTED, their window and its hold passed, a card page
-- opened in time; E4 UNLOCKED (both fees paid); E5 COMMISSION_PAID with p1's card page open; E6 COMMISSION_PAID.
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'requests-expire-windows';
  UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key = 'payments_enabled';
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  VALUES ('00000000-0000-0000-0000-000000280001', 'authenticated', 'authenticated', '905559280001', now()),
         ('00000000-0000-0000-0000-000000280002', 'authenticated', 'authenticated', '905559280002', now()),
         ('00000000-0000-0000-0000-0000002800c1', 'authenticated', 'authenticated', '905559280099', now()),
         ('00000000-0000-0000-0000-0000002800ad', 'authenticated', 'authenticated', '905559280098', now());
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  VALUES ('00000000-0000-0000-0000-000000280001', 'provider', 'TR', '+905559280001', 'Yarış Bir', 'tr'),
         ('00000000-0000-0000-0000-000000280002', 'provider', 'TR', '+905559280002', 'Yarış İki', 'tr'),
         ('00000000-0000-0000-0000-0000002800c1', 'customer', 'TR', '+905559280099', 'Yarış Müşteri', 'tr'),
         ('00000000-0000-0000-0000-0000002800ad', 'admin', 'TR', '+905559280098', 'Yarış Yönetici', 'tr');
  UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Yarış Usta'
   WHERE id IN ('00000000-0000-0000-0000-000000280001', '00000000-0000-0000-0000-000000280002');
  INSERT INTO public.service_categories (id, region, name, active) VALUES ('00000000-0000-0000-0000-0000002800ca', 'TR', '{"tr": "Yarış"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
  VALUES ('00000000-0000-0000-0000-000000280051', '00000000-0000-0000-0000-0000002800ca', 'TR', '{"tr": "Bir"}', 1, 2, true);
  INSERT INTO public.zones (id, region, name, multiplier, active) VALUES ('00000000-0000-0000-0000-000000280021', 'TR', '{"tr": "Semt"}', 1.00, true);
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  SELECT ('00000000-0000-0000-0000-0000002800e' || g)::uuid, 'TR', '00000000-0000-0000-0000-0000002800c1', gen_random_uuid(),
         '00000000-0000-0000-0000-000000280051', '00000000-0000-0000-0000-000000280021', '{}', '[]',
         '{"rounding_minor": 100}', 100000, 10000, 90000, 'TRY', now() + interval '2 days', now() + interval '2 days 2 hours'
    FROM generate_series(1, 6) g;
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT ('00000000-0000-0000-0000-0000002800' || p.l || g)::uuid, 'TR', ('00000000-0000-0000-0000-0000002800e' || g)::uuid,
         p.provider, 'An offer for the cancel races, long enough.'
    FROM generate_series(1, 6) g,
         (VALUES ('a', '00000000-0000-0000-0000-000000280001'::uuid), ('b', '00000000-0000-0000-0000-000000280002'::uuid)) AS p(l, provider);
  SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000002800c1", "role": "authenticated"}', true);
  SELECT public.choose_provider(('00000000-0000-0000-0000-0000002800e' || g)::uuid, ('00000000-0000-0000-0000-0000002800a' || g)::uuid, 'draft-2')
    FROM generate_series(1, 6) g;
  SELECT public.pay_commission(('00000000-0000-0000-0000-0000002800e' || g)::uuid, 'tr', NULL, 'draft-2') FROM generate_series(1, 6) g;
  SELECT public.fail_attempt(a.id, 'psp_failed') FROM public.checkout_attempts a JOIN public.fee_payments f ON f.id = a.fee_payment_id
   WHERE f.request_id = '00000000-0000-0000-0000-0000002800e1';
  SELECT public.apply_fee_paid(f.id, a.id, 'race-28-c' || right(f.request_id::text, 1), 10000, 'TRY', 300)
    FROM public.fee_payments f JOIN public.checkout_attempts a ON a.fee_payment_id = f.id
   WHERE f.request_id IN ('00000000-0000-0000-0000-0000002800e4', '00000000-0000-0000-0000-0000002800e5', '00000000-0000-0000-0000-0000002800e6');
  SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000280001", "role": "authenticated"}', true);
  SELECT public.pay_provider_fee(('00000000-0000-0000-0000-0000002800a' || g)::uuid, 'tr', NULL, 'draft-2') FROM generate_series(4, 5) g;
  SELECT public.apply_fee_paid(f.id, a.id, 'race-28-p4', f.amount, 'TRY', 150)
    FROM public.fee_payments f JOIN public.checkout_attempts a ON a.fee_payment_id = f.id
   WHERE f.request_id = '00000000-0000-0000-0000-0000002800e4' AND f.kind = 'provider_fee';
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests SET selected_at = now() - interval '5 hours', payment_deadline = now() - interval '1 hour'
   WHERE id IN ('00000000-0000-0000-0000-0000002800e2', '00000000-0000-0000-0000-0000002800e3');
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
  ALTER TABLE public.checkout_attempts DISABLE TRIGGER checkout_attempts_guard;
  UPDATE public.checkout_attempts a SET started_at = now() - interval '2 hours'
    FROM public.fee_payments f
   WHERE f.id = a.fee_payment_id AND f.request_id IN ('00000000-0000-0000-0000-0000002800e2', '00000000-0000-0000-0000-0000002800e3');
  ALTER TABLE public.checkout_attempts ENABLE TRIGGER checkout_attempts_guard;
  COMMIT; $$);

CREATE FUNCTION pg_temp.one(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(pg_temp.conn(), p_sql) AS t(r text) $$;
CREATE FUNCTION pg_temp.result(p_conn text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT r::jsonb FROM extensions.dblink_get_result(p_conn, false) AS t(r text) $$;
CREATE FUNCTION pg_temp.e(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-0000-0000-0000002800e' || p $$;
CREATE FUNCTION pg_temp.cancel_sql(p text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.cancel_request(%L, NULL)::text', pg_temp.e(p)) $$;
-- The relay's call for a request's fee of a kind on its newest attempt, its ids read first as the owner.
CREATE FUNCTION pg_temp.apply_sql(p text, p_kind text, p_psp text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.one(format(
    $q$ SELECT format('SELECT public.apply_fee_paid(%%L, %%L, %%L, %%s, %%L, 150)::text', f.id, a.id, %L, f.amount, f.currency)
          FROM public.fee_payments f JOIN public.checkout_attempts a ON a.fee_payment_id = f.id
         WHERE f.request_id = %L AND f.kind = %L
         ORDER BY a.started_at DESC, a.id LIMIT 1 $q$, p_psp, pg_temp.e(p), p_kind)) $$;
CREATE FUNCTION pg_temp.as_who(p_conn text, p_id text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.dblink_exec(p_conn, 'RESET ROLE')
      || extensions.dblink_exec(p_conn, 'SET ROLE authenticated')
      || extensions.dblink_exec(p_conn, format($q$ SET request.jwt.claims = '{"sub": "%s", "role": "authenticated"}' $q$, p_id)) $$;
CREATE FUNCTION pg_temp.as_owner(p_conn text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.dblink_exec(p_conn, 'RESET ROLE') $$;
-- The request's state, its fees' states and its refunds (kind:reason:status), as committed.
CREATE FUNCTION pg_temp.state(p text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.one(format($q$
    SELECT r.status || ' | ' || coalesce((SELECT string_agg(f.kind || ':' || f.status, ',' ORDER BY f.kind) FROM public.fee_payments f WHERE f.request_id = r.id), '-')
           || ' | ' || coalesce((SELECT string_agg(x.kind || ':' || coalesce(x.reason, '-') || ':' || x.status, ',' ORDER BY x.kind, x.reason)
                                   FROM public.fee_refunds x WHERE x.request_id = r.id), '-')
      FROM public.requests r WHERE r.id = %L $q$, pg_temp.e(p))) $$;

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());

-- ── a verified payment first: the cancel that waits refunds the commission ───
SELECT pg_temp.as_owner('a');
SELECT pg_temp.as_who('b', '00000000-0000-0000-0000-0000002800c1');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.apply_sql('1', 'commission', 'race-28-c1')) AS t(r text))::jsonb ->> 'status', 'paid',
  'AC-13: a payment for E1 is applied, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.cancel_sql('1'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-13: the cancel waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b') #>> '{refund,amount}', '10000', 'row 5: and then cancels COMMISSION_PAID with the commission refunded, no deadlock');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.state('1'), 'CANCELLED | commission:paid | fee:customer_cancel:queued', 'AC-7: paid once, one refund');

-- ── two cancels at once: one refund ──────────────────────────────────────────
SELECT pg_temp.as_who('a', '00000000-0000-0000-0000-0000002800c1');
SELECT pg_temp.as_who('b', '00000000-0000-0000-0000-0000002800c1');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.cancel_sql('6')) AS t(r text))::jsonb #>> '{refund,amount}', '10000',
  'AC-13: the customer cancels E6 in one tab, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.cancel_sql('6'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-13: a second cancel waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b'), '{"status": "ok"}'::jsonb, 'AC-6: and then is a plain ok, queuing nothing');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.state('6'), 'CANCELLED | commission:paid | fee:customer_cancel:queued', 'AC-7: two cancels at once, one refund');

-- ── the expiry against a payment in flight: the payment holds the row ────────
SELECT pg_temp.as_owner('a');
SELECT pg_temp.as_owner('b');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.apply_sql('2', 'commission', 'race-28-c2')) AS t(r text))::jsonb ->> 'status', 'late',
  'AC-2: a payment for E2, past its window and the hold, is applied as late, still uncommitted');
SELECT is((SELECT r FROM extensions.dblink('b', $q$ SELECT public.expire_windows()::text || ' ' || (SELECT status FROM public.requests WHERE id = '00000000-0000-0000-0000-0000002800e2') $q$) AS t(r text)),
  '1 SELECTED', 'AC-2: the expiry never waits: it skips the locked E2 (and takes E3)');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is((SELECT r FROM extensions.dblink('b', 'SELECT public.expire_windows()::text') AS t(r text)), '1', 'AC-2: the next run takes E2');
SELECT is(pg_temp.state('2'), 'OPEN | commission:pending | late:late_payment:queued', 'AC-2, R-9: E2 reopened, its commission pending, the payment refunded once as late');

-- ── the expiry first: the payment that waits goes late ───────────────────────
-- The first run above reopened E3, so it is picked again (on p2) and its window moved past in a committed step.
SELECT is(pg_temp.one($q$ SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000002800c1", "role": "authenticated"}', false)
                            || ' ' || (public.choose_provider('00000000-0000-0000-0000-0000002800e3', '00000000-0000-0000-0000-0000002800b3', 'draft-2') ->> 'status') $q$),
  '{"sub": "00000000-0000-0000-0000-0000002800c1", "role": "authenticated"} ok', 'fixture: E3 picked again on its restored applicant');
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests SET selected_at = now() - interval '5 hours', payment_deadline = now() - interval '1 hour'
   WHERE id = '00000000-0000-0000-0000-0000002800e3';
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
  COMMIT; $$);
SELECT extensions.dblink_exec('b', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('b', $q$ SELECT public.expire_request('00000000-0000-0000-0000-0000002800e3') $q$) AS t(r text)), 'reopened',
  'AC-2: the expiry reopens E3 again, still uncommitted');
SELECT extensions.dblink_send_query('a', pg_temp.apply_sql('3', 'commission', 'race-28-c3'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('a'), 1, 'AC-2: the payment on the old card page waits on the request row');
SELECT extensions.dblink_exec('b', 'COMMIT');
SELECT is(pg_temp.result('a') ->> 'status', 'late', 'AC-2: and then goes late on the reopened request, with no deadlock');
SELECT count(*) FROM extensions.dblink_get_result('a', false) AS t(r text);
SELECT is(pg_temp.state('3'), 'OPEN | commission:pending | late:late_payment:queued', 'AC-2: one late refund, nothing else');

-- ── two refunds of one fee at once: one row ──────────────────────────────────
SELECT pg_temp.as_who('a', '00000000-0000-0000-0000-0000002800ad');
SELECT pg_temp.as_who('b', '00000000-0000-0000-0000-0000002800ad');
CREATE TEMP TABLE e4_fee AS SELECT pg_temp.one($q$ SELECT id::text FROM public.fee_payments WHERE request_id = '00000000-0000-0000-0000-0000002800e4' AND kind = 'commission' $q$) AS id;
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', format('SELECT public.admin_refund_fee(%L, %L)::text', (SELECT id FROM e4_fee), 'No-show, refunded by admin')) AS t(r text))::jsonb ->> 'replayed',
  'false', 'AC-8: admin refunds E4''s commission, still uncommitted');
SELECT extensions.dblink_send_query('b', format('SELECT public.admin_refund_fee(%L, %L)::text', (SELECT id FROM e4_fee), 'No-show, refunded by a second admin tab'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-13: the second refund waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b') ->> 'replayed', 'true', 'AC-7: and then returns the first refund');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.state('4'), 'UNLOCKED | commission:paid,provider_fee:paid | fee:admin_refund:queued', 'AC-13: two refunds of one fee give one row');

-- ── a provider fee in flight at a customer's cancel (R-12) ───────────────────
SELECT pg_temp.as_who('a', '00000000-0000-0000-0000-0000002800c1');
SELECT pg_temp.as_owner('b');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.cancel_sql('5')) AS t(r text))::jsonb #>> '{refund,amount}', '10000',
  'R-12: the customer cancels E5 under the provider''s open card page, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.apply_sql('5', 'provider_fee', 'race-28-p5'));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'R-12: the provider''s payment waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b') ->> 'status', 'late', 'R-12: and then goes late: nothing is revealed');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.state('5'), 'CANCELLED | commission:paid,provider_fee:pending | fee:customer_cancel:queued,late:late_payment:queued',
  'R-12: the commission refunded once, the provider''s payment refunded as late');

-- ── the books after the races ────────────────────────────────────────────────
SELECT is(pg_temp.one($$ SELECT set_config('request.jwt.claims', '{"role": "service_role"}', false) || (public.ledger_check('TR') -> 'imbalances')::text $$),
  '{"role": "service_role"}[]', 'the books balance');

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();
SELECT is((SELECT active FROM cron.job WHERE jobname = 'requests-expire-windows'), true, 'the expiry cron job is back on');

SELECT * FROM finish();
ROLLBACK;
