-- Position 17, spec 0011-17 (D205): the rating races, with two real sessions through dblink.
--
-- Two rate_provider calls on one request at once (a double tap, a second tab): the second waits on the request row,
-- then finds the first rating and refuses already_rated, so one row stands (AC-1). Two hides of one rating at once:
-- the second waits on the rating's request row, then refuses already_hidden, so one hide stands (AC-8).
--
-- Like 31, this file commits its fixtures through a dblink session and removes them at the start and the end. Its
-- ids all start 00000000-0000-0000-0000-0000003600, and nothing else uses them. The clean up lifts the append only
-- triggers of ratings and rating_hides only for its own rows, inside its own transaction (21's wipe will do the same).
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT plan(8);

CREATE FUNCTION pg_temp.conn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('host=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database()) $$;

CREATE FUNCTION pg_temp.clean_up() RETURNS text LANGUAGE sql AS $fn$
  SELECT extensions.dblink_exec(pg_temp.conn(), $$
    BEGIN;
    DELETE FROM public.outbox_events WHERE payload::text LIKE '%00000000-0000-0000-0000-0000003600%';
    DELETE FROM public.audit_log WHERE actor_id::text LIKE '00000000-0000-0000-0000-0000003600%'
       OR entity_id LIKE '00000000-0000-0000-0000-0000003600%'
       OR new_value::text LIKE '%00000000-0000-0000-0000-0000003600%';
    ALTER TABLE public.rating_hides DISABLE TRIGGER rating_hides_append_only;
    ALTER TABLE public.ratings DISABLE TRIGGER ratings_append_only;
    DO $d$ BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE hidden_by::text LIKE %L', 'rating_hides', '00000000-0000-0000-0000-0000003600%');
      EXECUTE format('DELETE FROM public.%I WHERE customer_id::text LIKE %L', 'ratings', '00000000-0000-0000-0000-0000003600%');
    END $d$;
    ALTER TABLE public.ratings ENABLE TRIGGER ratings_append_only;
    ALTER TABLE public.rating_hides ENABLE TRIGGER rating_hides_append_only;
    ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
    UPDATE public.requests SET status = 'OPEN', selected_application_id = NULL, selected_at = NULL, payment_deadline = NULL,
           fee_deadline = NULL, closed_at = NULL, closed_by = NULL, actual_started_at = NULL, actual_completed_at = NULL,
           confirm_deadline = NULL
     WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000003600%' AND selected_application_id IS NOT NULL;
    ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
    -- Spec 0011-20: the agreements and acceptances of these picks (append only, so their guards are lifted here).
    ALTER TABLE public.service_agreements DISABLE TRIGGER USER;
    ALTER TABLE public.agreement_acceptances DISABLE TRIGGER USER;
    ALTER TABLE public.outbox_events DISABLE TRIGGER USER;
    DELETE FROM public.outbox_events WHERE kind = 'agreement.render'
       AND payload ->> 'agreement_id' IN (SELECT id::text FROM public.service_agreements WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000003600%'));
    DELETE FROM public.service_agreements WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000003600%');
    DELETE FROM public.agreement_acceptances WHERE application_id IN (SELECT id FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000003600%');
    ALTER TABLE public.outbox_events ENABLE TRIGGER USER;
    ALTER TABLE public.agreement_acceptances ENABLE TRIGGER USER;
    ALTER TABLE public.service_agreements ENABLE TRIGGER USER;
    ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
    DELETE FROM public.applications WHERE provider_id::text LIKE '00000000-0000-0000-0000-0000003600%';
    ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
    ALTER TABLE public.requests DISABLE TRIGGER requests_delete_guard;
    DELETE FROM public.requests WHERE customer_id::text LIKE '00000000-0000-0000-0000-0000003600%';
    ALTER TABLE public.requests ENABLE TRIGGER requests_delete_guard;
    DELETE FROM public.services WHERE id::text LIKE '00000000-0000-0000-0000-0000003600%';
    DELETE FROM public.service_categories WHERE id::text LIKE '00000000-0000-0000-0000-0000003600%';
    DELETE FROM public.zones WHERE id::text LIKE '00000000-0000-0000-0000-0000003600%';
    DELETE FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000003600%';
    DELETE FROM public.profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000003600%';
    DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-0000003600%';
    COMMIT; $$)
$fn$;

SELECT pg_temp.clean_up();

-- Committed fixtures: a customer, a provider and an admin; E1 and E2 COMPLETED with an unlocked pick (seeded with the
-- guards off), E2 already rated.
SELECT extensions.dblink_exec(pg_temp.conn(), $$
  BEGIN;
  INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
  VALUES ('00000000-0000-0000-0000-000000360001', 'authenticated', 'authenticated', '905559360001', now()),
         ('00000000-0000-0000-0000-0000003600c1', 'authenticated', 'authenticated', '905559360099', now()),
         ('00000000-0000-0000-0000-0000003600ad', 'authenticated', 'authenticated', '905559360098', now());
  INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
  VALUES ('00000000-0000-0000-0000-000000360001', 'provider', 'TR', '+905559360001', 'Yarış Usta', 'tr'),
         ('00000000-0000-0000-0000-0000003600c1', 'customer', 'TR', '+905559360099', 'Yarış Müşteri', 'tr'),
         ('00000000-0000-0000-0000-0000003600ad', 'admin', 'TR', '+905559360098', 'Yarış Yönetici', 'tr');
  UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Yarış'
   WHERE id = '00000000-0000-0000-0000-000000360001';
  INSERT INTO public.service_categories (id, region, name, active) VALUES ('00000000-0000-0000-0000-0000003600ca', 'TR', '{"tr": "Yarış"}', true);
  INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
  VALUES ('00000000-0000-0000-0000-000000360051', '00000000-0000-0000-0000-0000003600ca', 'TR', '{"tr": "Bir"}', 1, 2, true);
  INSERT INTO public.zones (id, region, name, multiplier, active) VALUES ('00000000-0000-0000-0000-000000360021', 'TR', '{"tr": "Semt"}', 1.00, true);
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  SELECT ('00000000-0000-0000-0000-0000003600e' || g)::uuid, 'TR', '00000000-0000-0000-0000-0000003600c1', gen_random_uuid(),
         '00000000-0000-0000-0000-000000360051', '00000000-0000-0000-0000-000000360021', '{}', '[]',
         '{"rounding_minor": 100}', 100000, 10000, 90000, 'TRY', now() - interval '4 hours', now() - interval '2 hours'
    FROM generate_series(1, 2) g;
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  SELECT ('00000000-0000-0000-0000-0000003600f' || g)::uuid, 'TR', ('00000000-0000-0000-0000-0000003600e' || g)::uuid,
         '00000000-0000-0000-0000-000000360001', 'An offer for the rating races, long enough.'
    FROM generate_series(1, 2) g;
  ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
  UPDATE public.applications SET status = 'CONFIRMED', status_changed_at = now() - interval '6 hours',
         unlocked_at = now() - interval '6 hours', provider_fee_amount = 0, provider_fee_kind = 'fixed'
   WHERE provider_id = '00000000-0000-0000-0000-000000360001';
  ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests r
     SET status = 'COMPLETED', selected_application_id = ('00000000-0000-0000-0000-0000003600f' || right(r.id::text, 1))::uuid,
         selected_at = now() - interval '9 hours', payment_deadline = now() - interval '8 hours',
         fee_deadline = now() - interval '7 hours', actual_started_at = now() - interval '4 hours',
         actual_completed_at = now() - interval '3 hours', closed_at = now() - interval '1 hour', closed_by = 'customer'
   WHERE r.customer_id = '00000000-0000-0000-0000-0000003600c1';
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
  INSERT INTO public.ratings (region, request_id, application_id, provider_id, customer_id, punctuality, quality,
                              professionalism, value)
  VALUES ('TR', '00000000-0000-0000-0000-0000003600e2', '00000000-0000-0000-0000-0000003600f2',
          '00000000-0000-0000-0000-000000360001', '00000000-0000-0000-0000-0000003600c1', 2, 2, 2, 2);
  COMMIT; $$);

CREATE FUNCTION pg_temp.one(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(pg_temp.conn(), p_sql) AS t(r text) $$;
CREATE FUNCTION pg_temp.as_user(p_conn text, p_id text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.dblink_exec(p_conn, 'RESET ROLE')
      || extensions.dblink_exec(p_conn, 'SET ROLE authenticated')
      || extensions.dblink_exec(p_conn, format($q$ SET request.jwt.claims = '{"sub": "%s", "role": "authenticated"}' $q$, p_id)) $$;
-- A call that reports its refusal as text, so a waiting session's error comes back as a result.
CREATE FUNCTION pg_temp.wrap(p_sql text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$ DO $d$ BEGIN PERFORM set_config('race.out', (%s)::text, false);
                    EXCEPTION WHEN raise_exception THEN PERFORM set_config('race.out', sqlerrm, false); END $d$ $q$, p_sql) $$;
CREATE FUNCTION pg_temp.out(p_conn text) RETURNS text LANGUAGE sql AS $$
  SELECT r FROM extensions.dblink(p_conn, $q$ SELECT current_setting('race.out', true) $q$) AS t(r text) $$;

SELECT extensions.dblink_connect('a', pg_temp.conn());
SELECT extensions.dblink_connect('b', pg_temp.conn());

-- ── two ratings of E1 at once ────────────────────────────────────────────────
SELECT pg_temp.as_user('a', '00000000-0000-0000-0000-0000003600c1');
SELECT pg_temp.as_user('b', '00000000-0000-0000-0000-0000003600c1');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT extensions.dblink_exec('a', pg_temp.wrap($q$ public.rate_provider('00000000-0000-0000-0000-0000003600e1', 5, 5, 5, 5) ? 'rating_id' $q$));
SELECT is(pg_temp.out('a'), 'true', 'AC-1: the first rating, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.wrap($q$ public.rate_provider('00000000-0000-0000-0000-0000003600e1', 1, 1, 1, 1) ? 'rating_id' $q$));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-1: the second waits on the request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.out('b'), 'already_rated', 'AC-1: and then finds the first and refuses');
SELECT is(pg_temp.one($q$ SELECT count(*)::text || ' ' || min(punctuality)::text FROM public.ratings
                          WHERE request_id = '00000000-0000-0000-0000-0000003600e1' $q$),
  '1 5', 'AC-1: one rating stands, the first');

-- ── two hides of E2's rating at once ─────────────────────────────────────────
SELECT pg_temp.as_user('a', '00000000-0000-0000-0000-0000003600ad');
SELECT pg_temp.as_user('b', '00000000-0000-0000-0000-0000003600ad');
SELECT extensions.dblink_exec('a', 'BEGIN');
SELECT extensions.dblink_exec('a', pg_temp.wrap(format($q$ public.admin_hide_rating(%L, 'fake', 'The first hide.') ? 'hidden_at' $q$,
  pg_temp.one($q$ SELECT id::text FROM public.ratings WHERE request_id = '00000000-0000-0000-0000-0000003600e2' $q$))));
SELECT is(pg_temp.out('a'), 'true', 'AC-8: the first hide, still uncommitted');
SELECT extensions.dblink_send_query('b', pg_temp.wrap(format($q$ public.admin_hide_rating(%L, 'other', 'The second hide.') ? 'hidden_at' $q$,
  pg_temp.one($q$ SELECT id::text FROM public.ratings WHERE request_id = '00000000-0000-0000-0000-0000003600e2' $q$))));
SELECT pg_sleep(0.3);
SELECT is(extensions.dblink_is_busy('b'), 1, 'AC-8: the second waits on the rating''s request row');
SELECT extensions.dblink_exec('a', 'COMMIT');
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT count(*) FROM extensions.dblink_get_result('b', false) AS t(r text);
SELECT is(pg_temp.out('b'), 'already_hidden', 'AC-8: and then refuses: a hide is final');
SELECT is(pg_temp.one($q$ SELECT count(*)::text || ' ' || min(h.reason) FROM public.rating_hides h JOIN public.ratings r ON r.id = h.rating_id
                          WHERE r.request_id = '00000000-0000-0000-0000-0000003600e2' $q$),
  '1 fake', 'AC-8: one hide stands, the first');

SELECT extensions.dblink_disconnect('a');
SELECT extensions.dblink_disconnect('b');
SELECT pg_temp.clean_up();

SELECT * FROM finish();
ROLLBACK;
