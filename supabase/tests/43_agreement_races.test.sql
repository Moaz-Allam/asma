-- Position 20, spec 0011-20 AC-14: the agreement races, with two real sessions through dblink.
--
-- Two presses of Pay at once store one acceptance (AC-2); two relay workers finishing one agreement's render make one
-- file record, one finish and one mail per side (AC-6, AC-8); two uploads of one object path store one file
-- (`upsert: false`, AC-6, AC-11).
--
-- Like 22, this file commits its fixtures through a dblink session and removes them at the start and the end. Its ids
-- all start 00000000-0000-0000-0000-0000004300, and nothing else uses them. The clean up lifts the append only guards
-- with session_replication_role, the one way the owner can (the product never does).
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT plan(12);

CREATE FUNCTION pg_temp.conn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('host=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database()) $$;

CREATE FUNCTION pg_temp.clean_up() RETURNS text LANGUAGE sql AS $fn$
  SELECT extensions.dblink_exec(pg_temp.conn(), $$
    BEGIN;
    SET LOCAL session_replication_role = replica;
    CREATE TEMP TABLE race_agreements ON COMMIT DROP AS
      SELECT id FROM public.service_agreements WHERE request_id::text LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM storage.objects WHERE bucket_id = 'service-agreements'
       AND name LIKE '%/' || '%' AND substring(name from '/([0-9a-f-]{36})-r') IN (SELECT id::text FROM race_agreements);
    DELETE FROM public.notifications WHERE recipient_id::text LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM public.outbox_events WHERE payload ->> 'agreement_id' IN (SELECT id::text FROM race_agreements)
       OR payload ->> 'entity_id' IN (SELECT id::text FROM race_agreements)
       OR payload ->> 'request_id' LIKE '00000000-0000-0000-0000-0000004300%'
       OR payload ->> 'recipient_id' LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM public.service_agreements WHERE id IN (SELECT id FROM race_agreements);
    DELETE FROM public.agreement_acceptances WHERE request_id::text LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM public.outbox_events WHERE payload ->> 'fee_payment_id' IN
      (SELECT id::text FROM public.fee_payments WHERE request_id::text LIKE '00000000-0000-0000-0000-0000004300%');
    DELETE FROM public.outbox_events WHERE payload ->> 'attempt_id' IN
      (SELECT a.id::text FROM public.checkout_attempts a JOIN public.fee_payments f ON f.id = a.fee_payment_id
        WHERE f.request_id::text LIKE '00000000-0000-0000-0000-0000004300%');
    DELETE FROM public.action_counters WHERE subject_id IN
      (SELECT id FROM public.fee_payments WHERE request_id::text LIKE '00000000-0000-0000-0000-0000004300%');
    DELETE FROM public.checkout_attempts WHERE fee_payment_id IN
      (SELECT id FROM public.fee_payments WHERE request_id::text LIKE '00000000-0000-0000-0000-0000004300%');
    DELETE FROM public.fee_payments WHERE request_id::text LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM public.audit_log WHERE actor_id::text LIKE '00000000-0000-0000-0000-0000004300%'
       OR entity_id LIKE '00000000-0000-0000-0000-0000004300%'
       OR entity_id IN (SELECT id::text FROM race_agreements)
       OR new_value::text LIKE '%00000000-0000-0000-0000-0000004300%';
    UPDATE public.requests SET status = 'OPEN', selected_application_id = NULL, selected_at = NULL, payment_deadline = NULL,
           fee_deadline = NULL, closed_at = NULL WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM public.request_addresses WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM public.requests WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM public.zones WHERE id::text LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM public.profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000004300%';
    DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-0000004300%';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: a customer and an approved provider with confirmed addresses; E1 chosen and waiting for its
-- commission; E2 with a commission and a provider fee of 0, paid both ways, so its agreement exists, queued.
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  UPDATE public.platform_settings SET value = 'true'
   WHERE region = 'TR' AND key IN ('payments_enabled', 'emails_enabled', 'notifications_enabled');
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  VALUES ('00000000-0000-0000-0000-000000430001', 'authenticated', 'authenticated', '905559430001', now()),
         ('00000000-0000-0000-0000-0000004300c1', 'authenticated', 'authenticated', '905559430099', now());
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale, email, email_confirmed_at)
  VALUES ('00000000-0000-0000-0000-000000430001', 'provider', 'TR', '+905559430001', 'Yarış Usta', 'tr', 'p-43@example.com', now()),
         ('00000000-0000-0000-0000-0000004300c1', 'customer', 'TR', '+905559430099', 'Yarış Müşteri', 'tr', 'c-43@example.com', now());
  UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Yarış Usta'
   WHERE id = '00000000-0000-0000-0000-000000430001';
  INSERT INTO public.service_categories (id, region, name, active) VALUES ('00000000-0000-0000-0000-0000004300ca', 'TR', '{"tr": "Yarış"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
  VALUES ('00000000-0000-0000-0000-000000430051', '00000000-0000-0000-0000-0000004300ca', 'TR', '{"tr": "Bir"}', 1, 2, true);
  INSERT INTO public.zones (id, region, name, multiplier, active) VALUES ('00000000-0000-0000-0000-000000430021', 'TR', '{"tr": "Semt"}', 1.00, true);
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  SELECT ('00000000-0000-0000-0000-0000004300e' || g)::uuid, 'TR', '00000000-0000-0000-0000-0000004300c1', gen_random_uuid(),
         '00000000-0000-0000-0000-000000430051', '00000000-0000-0000-0000-000000430021', '{}', '[]',
         '{"rounding_minor": 100, "service": {"name": {"tr": "Bir"}}}', 100000, CASE g WHEN 1 THEN 10000 ELSE 0 END,
         CASE g WHEN 1 THEN 90000 ELSE 100000 END, 'TRY', now() + interval '2 days', now() + interval '2 days 2 hours'
    FROM generate_series(1, 2) g;
  INSERT INTO public.request_addresses (request_id, region, customer_id, line)
  SELECT ('00000000-0000-0000-0000-0000004300e' || g)::uuid, 'TR', '00000000-0000-0000-0000-0000004300c1', 'Yarış Sok. 1'
    FROM generate_series(1, 2) g;
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT ('00000000-0000-0000-0000-0000004300f' || g)::uuid, 'TR', ('00000000-0000-0000-0000-0000004300e' || g)::uuid,
         '00000000-0000-0000-0000-000000430001', 'An offer for the agreement races, long enough.'
    FROM generate_series(1, 2) g;
  SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000004300c1", "role": "authenticated"}', false);
  SELECT public.choose_provider(('00000000-0000-0000-0000-0000004300e' || g)::uuid, ('00000000-0000-0000-0000-0000004300f' || g)::uuid)
    FROM generate_series(1, 2) g;
  SELECT public.pay_commission('00000000-0000-0000-0000-0000004300e2', 'tr', NULL, 'draft-1');
  ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
  UPDATE public.applications SET provider_fee_amount = 0 WHERE id = '00000000-0000-0000-0000-0000004300f2';
  ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
  SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000430001", "role": "authenticated"}', false);
  SELECT public.pay_provider_fee('00000000-0000-0000-0000-0000004300f2', 'tr', NULL, 'draft-1');
  COMMIT; $$);

CREATE FUNCTION pg_temp.one(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(pg_temp.conn(), p_sql) AS t(r text) $$;
CREATE FUNCTION pg_temp.result(p_conn text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT r::jsonb FROM extensions.dblink_get_result(p_conn, false) AS t(r text) $$;
CREATE FUNCTION pg_temp.as_customer(p_conn text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.dblink_exec(p_conn, 'RESET ROLE')
      || extensions.dblink_exec(p_conn, 'SET ROLE authenticated')
      || extensions.dblink_exec(p_conn, $q$ SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000004300c1", "role": "authenticated"}' $q$) $$;
CREATE FUNCTION pg_temp.as_relay(p_conn text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.dblink_exec(p_conn, 'RESET ROLE')
      || extensions.dblink_exec(p_conn, $q$ SET request.jwt.claims = '{"role": "service_role"}' $q$)
      || extensions.dblink_exec(p_conn, 'SET ROLE service_role') $$;

CREATE TEMP TABLE e2 AS
  SELECT pg_temp.one($$ SELECT id::text FROM public.service_agreements WHERE request_id = '00000000-0000-0000-0000-0000004300e2' $$) AS id;
CREATE TEMP TABLE e2path AS
  SELECT 'TR/' || to_char(now() AT TIME ZONE 'Europe/Istanbul', 'YYYY') || '/' || (SELECT id FROM e2) || '-r1.pdf' AS p;
CREATE FUNCTION pg_temp.upload_sql() RETURNS text LANGUAGE sql AS $$
  SELECT format($q$ INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('service-agreements', %L, '{"size": 4096}') RETURNING 'stored' $q$,
                (SELECT p FROM e2path)) $$;
CREATE FUNCTION pg_temp.finish_sql() RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.finish_agreement_render(%L, %L, %L, 4096)::text', (SELECT id FROM e2), (SELECT p FROM e2path), repeat('d', 64)) $$;

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());

SELECT ok((SELECT id FROM e2) IS NOT NULL, 'fixture: E2''s reveal made its agreement');

-- ── two presses of Pay at once: one acceptance ───────────────────────────────
SELECT pg_temp.as_customer('a');
SELECT pg_temp.as_customer('b');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', $$ SELECT public.pay_commission('00000000-0000-0000-0000-0000004300e1', 'tr', NULL, 'draft-1') ->> 'status' $$) AS t(r text)),
  'checkout', 'AC-2: the first press stores the acceptance, still uncommitted');
SELECT extensions.dblink_send_query('b', $$ SELECT public.pay_commission('00000000-0000-0000-0000-0000004300e1', 'tr', NULL, 'draft-1')::text $$);
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-2: the second press waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b') ->> 'reused', 'true', 'AC-2: and then reuses the attempt');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one($$ SELECT count(*)::text FROM public.agreement_acceptances WHERE application_id = '00000000-0000-0000-0000-0000004300f1' $$),
  '1', 'AC-2: one acceptance');

-- ── two uploads of one path: one file ────────────────────────────────────────
SELECT pg_temp.as_relay('a');
SELECT pg_temp.as_relay('b');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.upload_sql()) AS t(r text)), 'stored', 'AC-6: the first upload, uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.upload_sql());
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-6: the second waits on the same name');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT ok(extensions.dblink_error_message('b') LIKE '%duplicate key%', 'AC-6: and is refused: no upsert, one file');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);

-- ── two workers finish one render: one finish, one mail per side ─────────────
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT is((SELECT r FROM extensions.dblink('a', pg_temp.finish_sql()) AS t(r text))::jsonb ->> 'replayed', 'false',
  'AC-6: the first worker finishes, uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.finish_sql());
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-6: the second waits on the agreement row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT is(pg_temp.result('b') ->> 'replayed', 'true', 'AC-6: and then finds it rendered');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.one(format($$ SELECT (SELECT count(*) FROM public.outbox_events WHERE idempotency_key LIKE 'agreement:%s:%%')
                                       || ' ' || (SELECT count(*) FROM public.notifications WHERE kind = 'agreement_ready' AND entity_id = %L) $$,
                             (SELECT id FROM e2), (SELECT id FROM e2))),
  '2 2', 'AC-8: one mail and one notice per side');

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();

SELECT * FROM finish();
ROLLBACK;
