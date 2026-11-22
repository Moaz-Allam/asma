-- Position 19a, spec 0011-19a (D213): trust and quality.
--
-- The twelve settings and their reader (AC-1); every figure computed from the rows, each case exact (AC-2); the offer
-- card's three figures (AC-3); the provider's own view (AC-4); probation as a reading and admin's waiver (AC-5); the
-- live job limit (AC-6); the reserved slots on apply and in the feed (AC-7); the hourly watchlist job, which writes
-- nothing but flags (AC-8); admin's handle (AC-9); the admin reads (AC-10 to AC-13); the document reminder through
-- the recipient map, the mail and the notice (AC-14); every refusal, every role, the grants and the two closed tables
-- (AC-18). The meta test of 17 (nine readers of a rating, AC-15) lives in 35.
--
-- Jobs are seeded as postgres with the guards off (pg_temp.job), exact to the minute. Any rating already in the local
-- database (a past e2e run) is hidden inside this transaction first, so the region mean is this file's.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(157);

SET CONSTRAINTS ALL IMMEDIATE;

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003800' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003870' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.app(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003880' || lpad(p::text, 2, '0'))::uuid $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1, c2 customers; a1 the metrics provider (approved 400 days ago); a2 on probation with two live jobs; a3 established
-- (five jobs); a4 for the waiver; a5 on probation with a cancel and a report; a6 rated low; a7 the reminder; a8 with an
-- expired document; a9, aa, ab the funnel; b1 to b8 the applicants that fill eight slots; ad the admin.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(t.c), 'authenticated', 'authenticated', '9055593800' || lpad(t.n::text, 2, '0'), now()
  FROM (VALUES ('c1', 1), ('c2', 2), ('a1', 3), ('a2', 4), ('a3', 5), ('a4', 6), ('a5', 7), ('a6', 8), ('a7', 9),
               ('a8', 10), ('a9', 11), ('aa', 12), ('ab', 13), ('b1', 14), ('b2', 15), ('b3', 16), ('b4', 17),
               ('b5', 18), ('b6', 19), ('b7', 20), ('b8', 21), ('ad', 22)) AS t(c, n);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale, email, email_confirmed_at)
SELECT pg_temp.u(t.c),
       CASE WHEN t.c LIKE 'c%' THEN 'customer' WHEN t.c = 'ad' THEN 'admin' ELSE 'provider' END,
       'TR', '+9055593800' || lpad(t.n::text, 2, '0'), 'Kalite ' || upper(t.c), 'en',
       CASE WHEN t.c = 'a7' THEN 'a7-38@example.com' END, CASE WHEN t.c = 'a7' THEN now() END
  FROM (VALUES ('c1', 1), ('c2', 2), ('a1', 3), ('a2', 4), ('a3', 5), ('a4', 6), ('a5', 7), ('a6', 8), ('a7', 9),
               ('a8', 10), ('a9', 11), ('aa', 12), ('ab', 13), ('b1', 14), ('b2', 15), ('b3', 16), ('b4', 17),
               ('b5', 18), ('b6', 19), ('b7', 20), ('b8', 21), ('ad', 22)) AS t(c, n);
UPDATE public.providers SET status = 'approved', approved_at = now() - interval '30 days', approved_name = 'Usta ' || right(id::text, 2)
 WHERE id::text LIKE '00000000-0000-0000-0000-0000003800%';
UPDATE public.providers SET approved_at = now() - interval '400 days', approved_name = 'Metin Kaya' WHERE id = pg_temp.u('a1');
UPDATE public.providers SET approved_at = now() - interval '10 days' WHERE id = pg_temp.u('a5');
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Kalite"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Temizlik", "en": "Cleaning"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Moda"}', 1.00, true);
-- a2 and a3 have a complete setup, so they can apply and see the feed.
INSERT INTO public.provider_services (provider_id, service_id, region)
VALUES (pg_temp.u('a2'), pg_temp.u('51'), 'TR'), (pg_temp.u('a3'), pg_temp.u('51'), 'TR');
INSERT INTO public.provider_zones (provider_id, zone_id, region)
VALUES (pg_temp.u('a2'), pg_temp.u('21'), 'TR'), (pg_temp.u('a3'), pg_temp.u('21'), 'TR');
INSERT INTO public.provider_availability (provider_id, region, work_days, start_hour, end_hour)
VALUES (pg_temp.u('a2'), 'TR', '{0,1,2,3,4,5,6}', 0, 24), (pg_temp.u('a3'), 'TR', '{0,1,2,3,4,5,6}', 0, 24);
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key IN ('apply_needs_email', 'emails_enabled', 'notifications_enabled');

-- A past e2e run may have left ratings: hidden here (rolled back at the end), so the region mean is this file's.
INSERT INTO public.rating_hides (rating_id, region, reason, note, hidden_by)
SELECT r.id, r.region, 'other', 'Hidden for the pgTAP run.', pg_temp.u('ad')
  FROM public.ratings r
 WHERE NOT EXISTS (SELECT 1 FROM public.rating_hides h WHERE h.rating_id = r.id);

-- ── helpers ──────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'none';
EXCEPTION
  WHEN raise_exception THEN RETURN sqlerrm;
  WHEN others THEN RETURN sqlstate;
END $$;
CREATE FUNCTION pg_temp.call_as(p_user text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     CASE WHEN p_user = 'anon' THEN '{"role": "anon"}'
                          WHEN p_user = 'service' THEN '{"role": "service_role"}'
                          ELSE jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', CASE WHEN p_user = 'anon' THEN 'anon'
                                           WHEN p_user = 'service' THEN 'service_role' ELSE 'authenticated' END);
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
-- Runs the setup and reads the expression, then rolls both back.
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

-- A job of customer c with provider w on request p, seeded exact with the guards off. p_at is the close (COMPLETED)
-- or the cancel (CANCELLED); the booked start is p_at minus 4 hours and the actual start p_late after it; the
-- application arrived p_resp minutes after the request. UNLOCKED and COMMISSION_PAID are live picks.
CREATE FUNCTION pg_temp.job(p integer, w text, p_status text, p_at timestamptz, p_late interval DEFAULT interval '0',
                            p_by text DEFAULT NULL, c text DEFAULT 'c1', p_resp integer DEFAULT 10)
  RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_at timestamptz := p_at - interval '4 hours';
BEGIN
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at, created_at)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u(c), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100, "service": {"name": {"tr": "Temizlik", "en": "Cleaning"}}}', 100000, 10000, 90000, 'TRY',
    v_at, v_at + interval '2 hours', v_at - interval '10 hours');
  INSERT INTO public.applications (id, region, request_id, provider_id, message, created_at)
  VALUES (pg_temp.app(p), 'TR', pg_temp.r(p), pg_temp.u(w), 'An offer for the quality tests, long enough to pass.',
          v_at - interval '10 hours' + make_interval(mins => p_resp));
  ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
  UPDATE public.applications
     SET status = CASE p_status WHEN 'COMPLETED' THEN 'CONFIRMED' WHEN 'CANCELLED' THEN 'CANCELLED'
                                WHEN 'COMMISSION_PAID' THEN 'AWAITING_FEE' ELSE 'UNLOCKED' END,
         status_changed_at = v_at - interval '2 hours',
         unlocked_at = CASE WHEN p_status <> 'COMMISSION_PAID' THEN v_at - interval '2 hours' END,
         provider_fee_amount = 0, provider_fee_kind = 'fixed'
   WHERE id = pg_temp.app(p);
  ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests
     SET status = p_status, selected_application_id = pg_temp.app(p), selected_at = v_at - interval '5 hours',
         payment_deadline = v_at - interval '4 hours', fee_deadline = v_at - interval '3 hours',
         actual_started_at = CASE WHEN p_status = 'COMPLETED' THEN v_at + p_late END,
         actual_completed_at = CASE WHEN p_status = 'COMPLETED' THEN v_at + p_late + interval '1 hour' END,
         closed_at = CASE WHEN p_status IN ('COMPLETED', 'CANCELLED') THEN p_at END,
         closed_by = CASE WHEN p_status = 'COMPLETED' THEN 'customer' WHEN p_status = 'CANCELLED' THEN p_by END,
         cancelled_at = CASE WHEN p_status = 'CANCELLED' THEN p_at END,
         cancelled_by = CASE WHEN p_status = 'CANCELLED' THEN p_by END
   WHERE id = pg_temp.r(p);
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
  RETURN pg_temp.r(p);
END $$;
-- An OPEN request of c1 starting at p_start, with no pick.
CREATE FUNCTION pg_temp.open_request(p integer, p_start timestamptz) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100, "service": {"name": {"tr": "Temizlik"}}}', 100000, 10000, 90000, 'TRY',
    p_start, p_start + interval '2 hours')
  RETURNING id $$;
CREATE FUNCTION pg_temp.report(p_request integer, p_against text, p_no_action boolean DEFAULT false) RETURNS uuid
  LANGUAGE sql AS $$
  INSERT INTO public.problem_reports (region, request_id, reporter_id, against_id, side, reason, text, status, outcome,
                                      admin_note, handled_by, handled_at)
  VALUES ('TR', pg_temp.r(p_request), pg_temp.u('c1'), pg_temp.u(p_against), 'customer', 'poor_work',
          'The work was not finished as agreed on the day.',
          CASE WHEN p_no_action THEN 'handled' ELSE 'open' END, CASE WHEN p_no_action THEN 'no_action' END,
          CASE WHEN p_no_action THEN 'Nothing to act on here.' END, CASE WHEN p_no_action THEN pg_temp.u('ad') END,
          CASE WHEN p_no_action THEN now() END)
  RETURNING id $$;
CREATE FUNCTION pg_temp.q(w text) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT public.provider_quality(pg_temp.u(w)) $$;
CREATE FUNCTION pg_temp.flag(w text, k text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT f.id FROM public.quality_flags f WHERE f.provider_id = pg_temp.u(w) AND f.kind = k ORDER BY f.raised_at DESC LIMIT 1 $$;
-- The rows of the tables the hourly job must never touch, as one digest (AC-8).
CREATE FUNCTION pg_temp.others() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.providers t),
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.user_warnings t),
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.requests t),
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.applications t),
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.outbox_events t),
    (SELECT count(*)::text FROM public.audit_log))) $$;

-- a1's jobs (AC-2). In the window: R1 on time, R2 15 minutes late (on time), R3 16 minutes late (late, another
-- customer); R5 cancelled by the customer, R6 cancelled by admin for the provider, R7 by the provider, R8 by admin for
-- the customer. Outside the window: R4 and R9, both COMPLETED. R10 and R11 are OPEN requests a1 applied to, whose
-- picks a1 later missed.
SELECT pg_temp.job(1, 'a1', 'COMPLETED', now() - interval '1 day', interval '0', NULL, 'c1', 10);
SELECT pg_temp.job(2, 'a1', 'COMPLETED', now() - interval '2 days', interval '15 minutes', NULL, 'c1', 20);
SELECT pg_temp.job(3, 'a1', 'COMPLETED', now() - interval '3 days', interval '16 minutes', NULL, 'c2', 30);
SELECT pg_temp.job(4, 'a1', 'COMPLETED', now() - interval '400 days', interval '0', NULL, 'c1', 10);
SELECT pg_temp.job(5, 'a1', 'CANCELLED', now() - interval '5 days', interval '0', 'customer', 'c1', 40);
SELECT pg_temp.job(6, 'a1', 'CANCELLED', now() - interval '6 days', interval '0', 'admin', 'c1', 50);
SELECT pg_temp.job(7, 'a1', 'CANCELLED', now() - interval '7 days', interval '0', 'provider', 'c1', 60);
SELECT pg_temp.job(8, 'a1', 'CANCELLED', now() - interval '8 days', interval '0', 'admin', 'c1', 70);
SELECT pg_temp.job(9, 'a1', 'COMPLETED', now() - interval '500 days', interval '0', NULL, 'c1', 10);
INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
VALUES (pg_temp.u('ad'), 'request.admin_cancelled', 'requests', pg_temp.r(6)::text, 'TR', NULL,
        '{"status": "CANCELLED", "attributed_to": "provider"}'),
       (pg_temp.u('ad'), 'request.admin_cancelled', 'requests', pg_temp.r(8)::text, 'TR', NULL,
        '{"status": "CANCELLED", "attributed_to": "customer"}');
SELECT pg_temp.open_request(10, now() - interval '1 hour');
SELECT pg_temp.open_request(11, now() - interval '1 hour');
INSERT INTO public.applications (id, region, request_id, provider_id, message)
VALUES (pg_temp.app(10), 'TR', pg_temp.r(10), pg_temp.u('a1'), 'A later offer for the quality tests, long enough.'),
       (pg_temp.app(11), 'TR', pg_temp.r(11), pg_temp.u('a1'), 'A later offer for the quality tests, long enough.');
-- Two misses that count (one written twice), one that does not.
INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
SELECT NULL, x.action, 'requests', x.req::text, 'TR', NULL,
       jsonb_build_object('status', 'OPEN', 'application_id', x.app, 'counts_against', x.counts)
  FROM (VALUES ('request.fee_expired', pg_temp.r(10), pg_temp.app(10), 'provider_fee_follow_through'),
               ('request.fee_expired', pg_temp.r(10), pg_temp.app(10), 'provider_fee_follow_through'),
               ('request.fee_expired', pg_temp.r(10), pg_temp.app(10), 'nobody'),
               ('request.provider_withdrew', pg_temp.r(11), pg_temp.app(11), 'provider_fee_follow_through')) AS x(action, req, app, counts);
SELECT pg_temp.report(1, 'a1');
SELECT pg_temp.report(2, 'a1', true);

-- a2: two live picks (an unlocked job and a pick awaiting the fee), nothing completed: on probation, at the limit.
SELECT pg_temp.job(20, 'a2', 'UNLOCKED', now() + interval '28 hours');
SELECT pg_temp.job(21, 'a2', 'COMMISSION_PAID', now() + interval '29 hours');
-- a3: five COMPLETED jobs, on time: established.
SELECT pg_temp.job(40 + g, 'a3', 'COMPLETED', now() - interval '1 hour') FROM generate_series(0, 4) g;
-- a5: approved 10 days ago, one cancel of its own after the reveal, one report against it.
SELECT pg_temp.job(50, 'a5', 'CANCELLED', now() - interval '1 day', interval '0', 'provider');
SELECT pg_temp.job(51, 'a5', 'COMPLETED', now() - interval '2 days');
SELECT pg_temp.report(51, 'a5');
-- a6: five COMPLETED jobs, each rated 2.
SELECT pg_temp.job(60 + g, 'a6', 'COMPLETED', now() - interval '1 hour') FROM generate_series(0, 4) g;
INSERT INTO public.ratings (region, request_id, application_id, provider_id, customer_id, punctuality, quality,
                            professionalism, value)
SELECT 'TR', pg_temp.r(60 + g), pg_temp.app(60 + g), pg_temp.u('a6'), pg_temp.u('c1'), 2, 2, 2, 2
  FROM generate_series(0, 4) g;
-- R30: an OPEN request tomorrow, with eight approved applicants (b1 to b8): eight of ten slots used.
SELECT pg_temp.open_request(30, now() + interval '2 days');
INSERT INTO public.applications (region, request_id, provider_id, message)
SELECT 'TR', pg_temp.r(30), pg_temp.u(b), 'A filler offer for the slot tests, long enough to pass.'
  FROM unnest(ARRAY['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8']) b;

-- ══ AC-1: the settings ═══════════════════════════════════════════════════════
SELECT is((SELECT count(*)::integer FROM public.platform_settings
            WHERE region IN ('TR', 'KSA') AND key IN ('metrics_window_days', 'metrics_min_jobs', 'on_time_grace_minutes',
              'probation_jobs', 'probation_live_jobs', 'probation_reserved_slots', 'floor_rating_min_tenths',
              'floor_report_rate_pct', 'floor_cancel_rate_pct', 'floor_follow_through_pct', 'quality_flag_cooldown_days',
              'document_reminder_days')), 24, 'AC-1: twelve keys seeded in each region');
SELECT is(public.quality_settings('TR'),
  '{"metrics_window_days": 365, "metrics_min_jobs": 5, "on_time_grace_minutes": 15, "probation_jobs": 5,
    "probation_live_jobs": 2, "probation_reserved_slots": 2, "floor_rating_min_tenths": 35, "floor_report_rate_pct": 10,
    "floor_cancel_rate_pct": 10, "floor_follow_through_pct": 70, "quality_flag_cooldown_days": 30,
    "document_reminder_days": 14}'::jsonb, 'AC-1: the reader returns the twelve defaults');
SELECT is(public.quality_settings('KSA') ->> 'probation_jobs', '5', 'AC-1: KSA has its own copy');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '29' WHERE region = 'TR' AND key = 'metrics_window_days'$$),
  '23514', 'AC-1: a window below 30 days is refused');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '4' WHERE region = 'TR' AND key = 'metrics_min_jobs'$$),
  '23514', 'AC-1: a minimum below 5 jobs is refused');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '11' WHERE region = 'TR' AND key = 'probation_reserved_slots'$$),
  '23514', 'AC-1: more than 10 reserved slots is refused');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '1.5' WHERE region = 'TR' AND key = 'probation_live_jobs'$$),
  '23514', 'AC-1: a fraction is refused');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '"14"' WHERE region = 'TR' AND key = 'document_reminder_days'$$),
  '23514', 'AC-1: a string is refused');
SELECT is(pg_temp.err($$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'floor_cancel_rate_pct'$$),
  'pricing_setting_required', 'AC-1: a quality key cannot be deleted');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.platform_settings SET value = '10' WHERE region = 'TR' AND key = 'probation_reserved_slots'$$],
                        $$public.quality_settings('TR')$$),
  'quality_settings_invalid', 'AC-1: reserved slots that leave nobody else a slot make the settings invalid');
SELECT is(pg_temp.probe(ARRAY[$$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'max_applicants_per_request'$$],
                        $$public.quality_settings('TR')$$),
  'quality_settings_invalid', 'AC-1, X-15: a broken apply cap reads as invalid quality settings');
SELECT is(public.document_reminder_days('TR'), 14, 'AC-1: the reminder reads its own key');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.platform_settings SET value = '10' WHERE region = 'TR' AND key = 'probation_reserved_slots'$$],
                        $$public.document_reminder_days('TR')$$),
  '14', 'AC-1: a broken quality key never stops the reminder');

-- ══ AC-2: the figures ════════════════════════════════════════════════════════
SELECT is(pg_temp.q('a1') -> 'jobs_done', '5', 'AC-2: jobs done counts every COMPLETED job, all time (two outside the window)');
SELECT is(public.provider_jobs_done(pg_temp.u('a1')), 5, 'AC-2, X-11: the count on its own agrees');
SELECT is(pg_temp.q('a1') -> 'completion', '{"num": 3, "den": 5, "pct": 60}',
  'AC-2: completion counts the provider''s two cancels, not the customer''s or the one admin put on the customer');
SELECT is(pg_temp.q('a1') -> 'on_time', '{"num": 2, "den": 3, "pct": 67}',
  'AC-2: 15 minutes late is on time, 16 is not; the old start is outside the window');
SELECT is(pg_temp.q('a1') -> 'cancellation', '{"num": 2, "den": 7, "pct": 29}',
  'AC-2, X-18: the provider''s cancels over the jobs revealed in the window');
SELECT is(pg_temp.q('a1') -> 'reports', '{"num": 1, "den": 3, "pct": 33}',
  'AC-2: a report handled with no action does not count');
SELECT is(pg_temp.q('a1') -> 'repeat_customers', '{"num": 1, "den": 2, "pct": 50}', 'AC-2: one of two customers came back');
SELECT is(pg_temp.q('a1') -> 'response_minutes', '{"minutes": 30, "count": 9}',
  'AC-2: the median minutes from request to offer, over the offers in the window');
SELECT is(pg_temp.q('a1') -> 'follow_through', '{"num": 7, "den": 9, "pct": 78}',
  'AC-2, X-9: two missed picks count (one written twice), one written nobody does not');
SELECT is((pg_temp.q('a1') ->> 'window_days') || ' ' || (pg_temp.q('a1') ->> 'grace_minutes'), '365 15', 'AC-2: the window and grace');
SELECT is(pg_temp.probe(ARRAY[$$INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, region, new_value)
                                VALUES (NULL, 'request.admin_cancelled', 'requests', pg_temp.r(5)::text, 'TR', '{"attributed_to": "provider"}')$$],
                        $$pg_temp.q('a1') -> 'completion'$$)::jsonb,
  '{"num": 3, "den": 5, "pct": 60}', 'AC-2, X-9: an attribution on a cancel the customer made changes nothing');
SELECT is(pg_temp.q('a3') -> 'completion', '{"num": 5, "den": 5, "pct": 100}', 'AC-2: five closed jobs, all complete');
SELECT is(public.provider_quality(gen_random_uuid()), NULL, 'AC-2: an unknown provider reads nothing');

-- ══ AC-3: the offer card ═════════════════════════════════════════════════════
SELECT is(public.provider_card_quality(pg_temp.u('a1')),
  '{"jobs_done": 5, "completion": {"pct": 60, "den": 5}, "on_time": null, "window_days": 365, "grace_minutes": 15}',
  'AC-3: a rate shows only from 5 in its own denominator');
SELECT is(public.provider_card_quality(pg_temp.u('a3')),
  '{"jobs_done": 5, "completion": {"pct": 100, "den": 5}, "on_time": {"pct": 100, "den": 5}, "window_days": 365, "grace_minutes": 15}',
  'AC-3: both rates past the minimum');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.platform_settings SET value = '10' WHERE region = 'TR' AND key = 'probation_reserved_slots'$$],
                        $$coalesce(public.provider_card_quality(pg_temp.u('a1'))::text, 'null')$$),
  'null', 'AC-3: broken settings read as nothing, never a refusal');
SELECT is((SELECT public.offer_card(a, 'Europe/Istanbul') -> 'quality' FROM public.applications a WHERE a.id = pg_temp.app(1)),
  public.provider_card_quality(pg_temp.u('a1')), 'AC-3: the offer card carries it');
SELECT ok((SELECT NOT (public.offer_card(a, 'Europe/Istanbul') -> 'quality' ?| ARRAY['cancellation', 'reports', 'follow_through', 'probation'])
             FROM public.applications a WHERE a.id = pg_temp.app(1)),
  'AC-3: no report rate, cancellation rate, follow through or probation reaches a customer');

-- ══ AC-5: probation ══════════════════════════════════════════════════════════
SELECT is(public.provider_on_probation(pg_temp.u('a2')), true, 'AC-5: no completed job yet: on probation');
SELECT is(public.provider_on_probation(pg_temp.u('a5')), true, 'AC-5: one completed job: still on probation');
SELECT is(public.provider_on_probation(pg_temp.u('a3')), false, 'AC-5: probation ends on the fifth COMPLETED job');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.providers SET status = 'suspended', suspension_reason = 'test reason' WHERE id = pg_temp.u('a2')$$],
                        $$public.provider_on_probation(pg_temp.u('a2'))$$),
  'false', 'AC-5: a suspended provider is not on probation');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.platform_settings SET value = '10' WHERE region = 'TR' AND key = 'probation_reserved_slots'$$],
                        $$public.provider_on_probation(pg_temp.u('a2'))$$),
  'false', 'AC-5: broken settings fail open (nobody is held back)');
SELECT pg_temp.as_user('ad');
SELECT is(pg_temp.err($$SELECT public.admin_end_probation(pg_temp.u('a4'), 'short')$$), 'reason_required', 'AC-5: a note under 10 characters');
SELECT is(pg_temp.err($$SELECT public.admin_end_probation(pg_temp.u('a3'), 'A trusted provider from before launch.')$$),
  'not_on_probation', 'AC-5: an established provider is not on probation');
SELECT is(pg_temp.err($$SELECT public.admin_end_probation(gen_random_uuid(), 'A trusted provider from before launch.')$$),
  'not_on_probation', 'AC-5: nor is an unknown id');
SELECT is(public.admin_end_probation(pg_temp.u('a4'), '  A trusted provider from before launch.  '), '{"status": "ok"}',
  'AC-5: admin ends probation with a note');
SELECT is(public.provider_on_probation(pg_temp.u('a4')), false, 'AC-5: the waiver ends it at once');
SELECT is((SELECT w.note || '|' || w.waived_by::text FROM public.probation_waivers w WHERE w.provider_id = pg_temp.u('a4')),
  'A trusted provider from before launch.|' || pg_temp.u('ad')::text, 'AC-5: one waiver row, the note trimmed');
SELECT is((SELECT a.new_value || jsonb_build_object('entity_type', a.entity_type) FROM public.audit_log a
            WHERE a.action = 'provider.probation_ended' AND a.entity_id = pg_temp.u('a4')::text),
  '{"note": "A trusted provider from before launch.", "entity_type": "provider"}', 'AC-5: and one audit row');
SELECT is(pg_temp.err($$SELECT public.admin_end_probation(pg_temp.u('a4'), 'A trusted provider from before launch.')$$),
  'already_waived', 'AC-5, X-21: a second waiver reads already_waived, not not_on_probation');
SELECT is(pg_temp.err($$UPDATE public.probation_waivers SET note = 'Changed afterwards, never.' WHERE provider_id = pg_temp.u('a4')$$),
  'probation_waiver_final', 'AC-5: a waiver is final');
SELECT is(pg_temp.err($$DELETE FROM public.probation_waivers WHERE provider_id = pg_temp.u('a4')$$),
  'probation_waiver_final', 'AC-5: and cannot be deleted');

-- ══ AC-6, AC-7: the live job limit and the reserved slots ════════════════════
SELECT is(public.provider_live_jobs(pg_temp.u('a2')), 2, 'AC-6: an unlocked job and a pick awaiting the fee are live');
SELECT is(public.provider_live_jobs(pg_temp.u('a3')), 0, 'AC-6: closed jobs are not');
SELECT is(public.provider_apply_cap(pg_temp.u('a3'), 'TR'), 8, 'AC-7: an established provider''s cap leaves two slots');
SELECT is(public.provider_apply_cap(pg_temp.u('a2'), 'TR'), 10, 'AC-7: a provider on probation has the whole cap');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.platform_settings SET value = '10' WHERE region = 'TR' AND key = 'probation_reserved_slots'$$],
                        $$public.provider_apply_cap(pg_temp.u('a3'), 'TR')$$),
  '10', 'AC-7: broken settings give everyone the whole cap (fail open)');
SELECT pg_temp.as_user('a3');
SELECT is((SELECT jsonb_build_object('cap', j -> 'cap', 'full', j -> 'full') FROM public.provider_request(pg_temp.r(30)) j),
  '{"cap": 8, "full": true}', 'AC-7: with eight applicants an established provider sees the request full');
SELECT is((SELECT jsonb_build_object('cap', x -> 'cap', 'full', x -> 'full')
             FROM jsonb_array_elements(public.provider_feed(NULL, NULL, NULL, NULL, NULL, NULL, NULL) -> 'rows') x
            WHERE x ->> 'id' = pg_temp.r(30)::text),
  '{"cap": 8, "full": true}', 'AC-7: and in the feed');
SELECT is(public.provider_home_counts() -> 'open_requests', '0', 'AC-7: and does not count it as open');
SELECT is(pg_temp.err($$SELECT public.apply_to_request(pg_temp.r(30), 'I can come tomorrow with my own tools and finish early.')$$),
  'request_full', 'AC-7: apply refuses request_full');
SELECT pg_temp.as_user('a2');
SELECT is((SELECT jsonb_build_object('cap', j -> 'cap', 'full', j -> 'full') FROM public.provider_request(pg_temp.r(30)) j),
  '{"cap": 10, "full": false}', 'AC-7: a provider on probation still sees it open');
SELECT is(public.provider_home_counts() -> 'open_requests', '1', 'AC-7: and counts it');
SELECT is(pg_temp.err($$SELECT public.apply_to_request(pg_temp.r(30), 'I can come tomorrow with my own tools and finish early.')$$),
  'probation_limit', 'AC-6: at two live jobs on probation, apply refuses probation_limit');
SELECT is(pg_temp.probe(ARRAY[$$ALTER TABLE public.requests DISABLE TRIGGER requests_guard$$,
                              $$UPDATE public.requests SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'customer',
                                       closed_at = now(), closed_by = 'customer' WHERE id = pg_temp.r(21)$$,
                              $$ALTER TABLE public.requests ENABLE TRIGGER requests_guard$$],
                        $$public.apply_to_request(pg_temp.r(30), 'I can come tomorrow with my own tools and finish early.') ->> 'status'$$),
  'ok', 'AC-7: one live job fewer, the provider on probation takes slot 9');
SELECT is((SELECT count(*)::integer FROM public.applications WHERE request_id = pg_temp.r(30)), 8, 'AC-6: the refusal wrote nothing');

-- ══ AC-4: the provider's own view ════════════════════════════════════════════
SELECT is(public.my_provider_quality(),
  '{"quality": {"jobs_done": 0, "completion": null, "on_time": null, "window_days": 365, "grace_minutes": 15},
    "probation": {"jobs_done": 0, "jobs_needed": 5, "live": 2, "live_limit": 2}}',
  'AC-4: the card figures and probation while it lasts');
SELECT pg_temp.as_user('a1');
SELECT is(public.my_provider_quality() -> 'probation', 'null', 'AC-4: no probation once past it');
SELECT is(public.my_provider_quality() -> 'quality', public.provider_card_quality(pg_temp.u('a1')),
  'AC-4: exactly what customers see');
SELECT is(pg_temp.call_as('c1', $$SELECT public.my_provider_quality()::text$$), 'forbidden', 'AC-4: a customer is refused');

-- ══ AC-8: the hourly job ═════════════════════════════════════════════════════
RESET ROLE;
SELECT pg_temp.as_user('ad');
CREATE TEMPORARY TABLE before_run AS SELECT pg_temp.others() AS d;
SELECT cmp_ok(public.raise_quality_flags(), '>=', 4, 'AC-8: the first run raises at least this file''s four flags');
SELECT is((SELECT d FROM before_run), pg_temp.others(),
  'AC-8: the job writes nothing but flags: providers, warnings, requests, applications, outbox and audit unchanged');
SELECT is((SELECT string_agg(f.kind, ',' ORDER BY f.kind) FROM public.quality_flags f WHERE f.provider_id = pg_temp.u('a1')),
  'high_cancellations', 'AC-8: a1 crosses the cancel line only (reports under the minimum, follow through above 70%)');
SELECT is((SELECT f.figure FROM public.quality_flags f WHERE f.id = pg_temp.flag('a1', 'high_cancellations')),
  '{"num": 2, "den": 7, "pct": 29, "threshold": 10}', 'AC-8: the figure that crossed');
SELECT is((SELECT f.figure FROM public.quality_flags f WHERE f.id = pg_temp.flag('a6', 'low_rating')),
  '{"overall": 2.0, "count": 5, "threshold": 3.5}', 'AC-8, X-17: a score under 3.5 raises low_rating');
SELECT is((SELECT string_agg(f.kind || ':' || (f.source_id = CASE f.kind WHEN 'probation_cancel' THEN pg_temp.r(50)
                                                                      ELSE (SELECT x.id FROM public.problem_reports x WHERE x.against_id = pg_temp.u('a5')) END)::text,
                             ',' ORDER BY f.kind)
             FROM public.quality_flags f WHERE f.provider_id = pg_temp.u('a5')),
  'probation_cancel:true,probation_report:true', 'AC-8: on probation, the cancel and the report each raise a flag naming its source');
SELECT is((SELECT count(*)::integer FROM public.quality_flags f
            WHERE f.provider_id IN (pg_temp.u('a2'), pg_temp.u('a3'), pg_temp.u('a4'), pg_temp.u('b1'))), 0,
  'AC-8: nothing for providers whose figures are fine');
SELECT is((SELECT count(*)::integer FROM public.quality_flags f WHERE f.provider_id::text LIKE '00000000-0000-0000-0000-0000003800%'),
  4, 'AC-8: four flags in all');
SELECT public.raise_quality_flags();
SELECT is((SELECT count(*)::integer FROM public.quality_flags f WHERE f.provider_id::text LIKE '00000000-0000-0000-0000-0000003800%'),
  4, 'AC-8: a second run never duplicates');
SELECT is(pg_temp.err($$INSERT INTO public.quality_flags (region, provider_id, kind, figure)
                        VALUES ('TR', pg_temp.u('a1'), 'high_cancellations', '{}')$$),
  '23505', 'AC-8: one open rate flag per provider and kind');
SELECT is(pg_temp.err($$INSERT INTO public.quality_flags (region, provider_id, kind, source_id, figure)
                        VALUES ('TR', pg_temp.u('a1'), 'high_reports', gen_random_uuid(), '{}')$$),
  '23514', 'AC-8: a rate flag names no source');
SELECT is(pg_temp.err($$INSERT INTO public.quality_flags (region, provider_id, kind, figure)
                        VALUES ('TR', pg_temp.u('a1'), 'probation_report', '{}')$$),
  '23514', 'AC-8: a probation flag names its source');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.platform_settings SET value = '10' WHERE region = 'TR' AND key = 'probation_reserved_slots'$$],
                        $$public.raise_quality_flags() >= 0$$),
  'true', 'AC-8: a region with broken settings is skipped with a warning, never an error');

-- ══ AC-9: admin handles a flag ═══════════════════════════════════════════════
SELECT is(pg_temp.err(format($$SELECT public.admin_handle_quality_flag(%L, 'banned', 'A long enough note here.')$$, pg_temp.flag('a1', 'high_cancellations'))),
  'validation_failed', 'AC-9: an unknown outcome');
SELECT is(pg_temp.err(format($$SELECT public.admin_handle_quality_flag(%L, 'warned', 'short')$$, pg_temp.flag('a1', 'high_cancellations'))),
  'reason_required', 'AC-9: a note under 10 characters');
SELECT is(pg_temp.err($$SELECT public.admin_handle_quality_flag(gen_random_uuid(), 'warned', 'A long enough note here.')$$),
  'not_found', 'AC-9: an unknown flag');
SELECT is(public.admin_handle_quality_flag(pg_temp.flag('a1', 'high_cancellations'), 'warned', 'Two cancels after the reveal.'),
  '{"status": "ok", "outcome": "warned"}', 'AC-9: admin warns');
SELECT is((SELECT w.reason || '|' || coalesce(w.report_id::text, 'none') || '|' || w.created_by::text FROM public.user_warnings w
            WHERE w.user_id = pg_temp.u('a1')),
  'high_cancellations|none|' || pg_temp.u('ad')::text, 'AC-9: one warning with the kind as its reason, no report');
SELECT is((SELECT f.outcome || '|' || f.note || '|' || (f.handled_by = pg_temp.u('ad'))::text FROM public.quality_flags f
            WHERE f.id = pg_temp.flag('a1', 'high_cancellations')),
  'warned|Two cancels after the reveal.|true', 'AC-9: the flag is handled with the note');
SELECT is((SELECT a.new_value || jsonb_build_object('entity_type', a.entity_type) FROM public.audit_log a
            WHERE a.action = 'quality.flag_handled' AND a.entity_id = pg_temp.flag('a1', 'high_cancellations')::text),
  '{"kind": "high_cancellations", "outcome": "warned", "note": "Two cancels after the reveal.", "entity_type": "quality_flags"}',
  'AC-9: one audit row');
SELECT is(pg_temp.err(format($$SELECT public.admin_handle_quality_flag(%L, 'cleared', 'A long enough note here.')$$, pg_temp.flag('a1', 'high_cancellations'))),
  'already_handled', 'AC-9: a flag is handled once');
SELECT is(pg_temp.call_as('a1', $$SELECT public.my_warning() ->> 'reason'$$), 'high_cancellations', 'AC-9: the provider sees the warning');
SELECT pg_temp.as_user('ad');
SELECT is(public.admin_handle_quality_flag(pg_temp.flag('a5', 'probation_cancel'), 'warned', 'A cancel in the first jobs.') ->> 'status',
  'ok', 'AC-9: a probation flag warns too');
SELECT is((SELECT w.reason FROM public.user_warnings w WHERE w.user_id = pg_temp.u('a5')), 'probation_issue',
  'AC-9: with the reason probation_issue');
SELECT is(public.admin_handle_quality_flag(pg_temp.flag('a6', 'low_rating'), 'suspended', 'Rated low again and again.') ->> 'outcome',
  'suspended', 'AC-9: admin suspends');
SELECT is((SELECT p.status || '|' || p.suspension_reason FROM public.providers p WHERE p.id = pg_temp.u('a6')),
  'suspended|quality:low_rating', 'AC-9: through suspend_provider, with a fixed code, never the note');
SELECT ok(EXISTS (SELECT 1 FROM public.audit_log a WHERE a.action = 'provider.suspended' AND a.entity_id = pg_temp.u('a6')::text),
  'AC-9: suspend_provider writes its own audit row (its mail and notice hang on it)');
SELECT is(public.admin_handle_quality_flag(pg_temp.flag('a5', 'probation_report'), 'cleared', 'The report was about the weather.') ->> 'outcome',
  'cleared', 'AC-9: admin clears');
SELECT is((SELECT count(*)::integer FROM public.user_warnings w WHERE w.user_id = pg_temp.u('a5')), 1, 'AC-9: a clear writes no warning');
INSERT INTO public.quality_flags (region, provider_id, kind, figure)
VALUES ('TR', pg_temp.u('a6'), 'low_follow_through', '{"num": 1, "den": 5, "pct": 20, "threshold": 70}'),
       ('TR', pg_temp.u('a8'), 'low_follow_through', '{"num": 1, "den": 5, "pct": 20, "threshold": 70}');
SELECT is(pg_temp.err(format($$SELECT public.admin_handle_quality_flag(%L, 'suspended', 'A long enough note here.')$$, pg_temp.flag('a6', 'low_follow_through'))),
  'not_approved', 'AC-9: a provider already suspended cannot be suspended again');
INSERT INTO public.provider_documents (provider_id, region, type, storage_path, object_id, mime_type, size_bytes, status, valid_until)
VALUES (pg_temp.u('a8'), 'TR', 'id_front', 'providers/38/a8-id-front.jpg', gen_random_uuid(), 'image/jpeg', 1000, 'approved', current_date - 1);
SELECT is(public.provider_standing(pg_temp.u('a8')), 'document_expired', 'AC-9: a8''s standing reads document_expired');
SELECT is(public.admin_handle_quality_flag(pg_temp.flag('a8', 'low_follow_through'), 'suspended', 'Missed most picks.') ->> 'outcome',
  'suspended', 'AC-9, X-14: a provider with an expired document may be suspended too');
SELECT is(pg_temp.err(format($$UPDATE public.quality_flags SET note = 'Changed afterwards, never.' WHERE id = %L$$, pg_temp.flag('a1', 'high_cancellations'))),
  'quality_flag_immutable', 'AC-8: a handled flag never changes');
SELECT is(pg_temp.err($$DELETE FROM public.quality_flags WHERE provider_id = pg_temp.u('a1')$$), 'quality_flag_immutable',
  'AC-8: and is never deleted');
SELECT is(pg_temp.err($$TRUNCATE public.quality_flags$$), 'quality_flag_immutable', 'AC-8: nor truncated');
-- The cooldown: handled today, the same kind waits 30 days; handled 31 days ago, it is raised again.
SELECT public.raise_quality_flags();
SELECT is((SELECT count(*)::integer FROM public.quality_flags f WHERE f.provider_id = pg_temp.u('a1')), 1,
  'AC-8: inside the cooldown the handled kind is not raised again');
SELECT is(pg_temp.probe(ARRAY[$$ALTER TABLE public.quality_flags DISABLE TRIGGER quality_flags_guard$$,
                              $$UPDATE public.quality_flags SET raised_at = now() - interval '40 days', handled_at = now() - interval '31 days'
                                 WHERE provider_id = pg_temp.u('a1')$$,
                              $$ALTER TABLE public.quality_flags ENABLE TRIGGER quality_flags_guard$$,
                              $$SELECT public.raise_quality_flags()$$],
                        $$(SELECT count(*) FROM public.quality_flags f WHERE f.provider_id = pg_temp.u('a1') AND f.handled_at IS NULL)$$),
  '1', 'AC-8: after the cooldown it is raised again');

-- ══ AC-10 to AC-13: admin reads ══════════════════════════════════════════════
SELECT is(pg_temp.err($$SELECT public.admin_quality_flags(0)$$), 'validation_failed', 'AC-10: a page below 1');
SELECT is(pg_temp.err($$SELECT public.admin_quality_flags(10001)$$), 'validation_failed', 'AC-10: a page above 10000');
INSERT INTO public.quality_flags (region, provider_id, kind, figure)
VALUES ('TR', pg_temp.u('a3'), 'high_reports', '{"num": 1, "den": 5, "pct": 20, "threshold": 10}');
SELECT is((SELECT x - 'id' - 'raised_at' FROM jsonb_array_elements(public.admin_quality_flags(1) -> 'rows') x
            WHERE x ->> 'provider_id' = pg_temp.u('a3')::text),
  jsonb_build_object('kind', 'high_reports', 'figure', '{"num": 1, "den": 5, "pct": 20, "threshold": 10}'::jsonb,
                     'provider_id', pg_temp.u('a3'), 'provider_name', 'Usta ' || right(pg_temp.u('a3')::text, 2),
                     'standing', 'approved', 'region', 'TR', 'timezone', 'Europe/Istanbul'),
  'AC-10: an open flag with the provider''s approved name, standing and the region''s time zone');
SELECT is((public.admin_quality_flags(1) ->> 'total')::integer, (SELECT count(*)::integer FROM public.quality_flags WHERE handled_at IS NULL),
  'AC-10: the total counts the open flags');
SELECT ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.admin_quality_flags(1) -> 'rows') x
                       WHERE x ->> 'id' = pg_temp.flag('a1', 'high_cancellations')::text),
  'AC-10: a handled flag leaves the list');
-- Every page is read, so providers an e2e run left on probation in a local database cannot push a5 off page 1.
SELECT is((SELECT x - 'approved_at' - 'provider_name' FROM generate_series(1, 50) pg,
                   jsonb_array_elements(public.admin_probation(pg) -> 'rows') x
            WHERE x ->> 'provider_id' = pg_temp.u('a5')::text),
  jsonb_build_object('provider_id', pg_temp.u('a5'), 'region', 'TR', 'timezone', 'Europe/Istanbul', 'jobs_done', 1,
                     'jobs_needed', 5, 'live', 0, 'live_limit', 2, 'reports', 1, 'open_flags', 0),
  'AC-11: a provider on probation with their progress, reports and open flags');
SELECT ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.admin_probation(1) -> 'rows') x
                       WHERE x ->> 'provider_id' IN (pg_temp.u('a3')::text, pg_temp.u('a4')::text)),
  'AC-11: neither an established provider nor a waived one');
SELECT is(pg_temp.err($$SELECT public.admin_probation(0)$$), 'validation_failed', 'AC-11: the page rules');
-- The funnel: a9 rejected then approved, aa and ab approved, all three months ago in Istanbul.
CREATE TEMPORARY TABLE funnel_month AS
SELECT date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul') - interval '3 months' AS m;
INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, region, new_value, created_at)
SELECT pg_temp.u('ad'), x.action, 'provider', pg_temp.u(x.w)::text, 'TR', '{}', ((SELECT m FROM funnel_month) + x.d) AT TIME ZONE 'Europe/Istanbul'
  FROM (VALUES ('provider.rejected', 'a9', interval '1 day'), ('provider.approved', 'a9', interval '5 days'),
               ('provider.approved', 'aa', interval '2 days'), ('provider.approved', 'ab', interval '3 days')) AS x(action, w, d);
CREATE FUNCTION pg_temp.tr_funnel() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT x FROM jsonb_array_elements(public.admin_quality_funnel()) x WHERE x ->> 'region' = 'TR' $$;
SELECT is((SELECT x - 'month' FROM jsonb_array_elements(pg_temp.tr_funnel() -> 'months') x
            WHERE x ->> 'month' = to_char((SELECT m FROM funnel_month), 'YYYY-MM')),
  '{"approved": 2, "rejected": 1, "rate": 66.7}', 'AC-12: first decisions only: rejected then approved counts once, as rejected');
SELECT is((SELECT jsonb_array_length(pg_temp.tr_funnel() -> 'months')), 12, 'AC-12: the current month and the 11 before it');
SELECT is((SELECT pg_temp.tr_funnel() -> 'months' -> 0 ->> 'month'), to_char(now() AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM'),
  'AC-12: newest first, in the region''s time zone');
SELECT is((SELECT public.admin_quality_funnel() -> 0 ->> 'region'), 'KSA', 'AC-12: one entry per region');
SELECT is((SELECT (SELECT sum(v::integer) FROM jsonb_each_text(x -> 'stages') AS e(k, v))::integer
             FROM jsonb_array_elements(public.admin_quality_funnel()) x WHERE x ->> 'region' = 'TR'),
  (SELECT count(*)::integer FROM public.providers WHERE region = 'TR'), 'AC-12: every provider in exactly one stage');
SELECT is(pg_temp.probe(ARRAY[$$INSERT INTO public.probation_waivers (provider_id, region, waived_by, note)
                                VALUES (pg_temp.u('a2'), 'TR', pg_temp.u('ad'), 'Moved for the funnel test.')$$],
                        $$(SELECT (x -> 'stages' ->> 'active')::integer - (x -> 'stages' ->> 'probation')::integer
                             FROM jsonb_array_elements(public.admin_quality_funnel()) x WHERE x ->> 'region' = 'TR')$$)::integer,
  (SELECT (x -> 'stages' ->> 'active')::integer - (x -> 'stages' ->> 'probation')::integer + 2
     FROM jsonb_array_elements(public.admin_quality_funnel()) x WHERE x ->> 'region' = 'TR'),
  'AC-12: a waiver moves a provider from probation to active');
SELECT is(public.admin_provider_quality(pg_temp.u('a1')) -> 'metrics', pg_temp.q('a1'), 'AC-13: every figure with its counts');
SELECT is((SELECT jsonb_build_object('probation', j -> 'probation', 'waiver', j -> 'waiver', 'timezone', j -> 'timezone')
             FROM public.admin_provider_quality(pg_temp.u('a1')) j),
  '{"probation": null, "waiver": null, "timezone": "Europe/Istanbul"}', 'AC-13: no probation, no waiver');
SELECT is((SELECT x ->> 'outcome' || '|' || (x ->> 'handled_by_name') || '|' || (x ->> 'note')
             FROM jsonb_array_elements(public.admin_provider_quality(pg_temp.u('a1')) -> 'flags') x),
  'warned|Kalite AD|Two cancels after the reveal.', 'AC-13: the handled flag with its handler and note');
SELECT is((public.admin_provider_quality(pg_temp.u('a4')) -> 'waiver') - 'at',
  '{"note": "A trusted provider from before launch.", "by_name": "Kalite AD"}', 'AC-13: the waiver with its note and author');
SELECT is(public.admin_provider_quality(pg_temp.u('a2')) -> 'probation', '{"jobs_done": 0, "jobs_needed": 5, "live": 2, "live_limit": 2}',
  'AC-13: probation progress');
SELECT is(pg_temp.err($$SELECT public.admin_provider_quality(gen_random_uuid())$$), 'not_found', 'AC-13: an unknown id');

-- ══ AC-14: the document reminder ═════════════════════════════════════════════
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key IN ('emails_enabled', 'notifications_enabled');
INSERT INTO public.provider_documents (id, provider_id, region, type, storage_path, object_id, mime_type, size_bytes, status, valid_until)
VALUES (pg_temp.u('d1'), pg_temp.u('a7'), 'TR', 'id_front', 'providers/38/a7-id-front.jpg', pg_temp.u('e1'), 'image/jpeg', 1000, 'approved', current_date + 10),
       (pg_temp.u('d2'), pg_temp.u('a7'), 'TR', 'id_back', 'providers/38/a7-id-back.jpg', pg_temp.u('e2'), 'image/jpeg', 1000, 'approved', current_date + 20),
       (pg_temp.u('d3'), pg_temp.u('a7'), 'TR', 'criminal_record', 'providers/38/a7-record.pdf', pg_temp.u('e3'), 'application/pdf', 1000, 'pending', current_date + 3);
SELECT cmp_ok(public.queue_document_reminders(), '>=', 1, 'AC-14: the daily job writes reminders');
SELECT is((SELECT string_agg(a.new_value::text, ',') FROM public.audit_log a
            WHERE a.action = 'provider.document_expiring' AND a.entity_id = pg_temp.u('a7')::text),
  jsonb_build_object('document_type', 'id_front', 'valid_until', current_date + 10, 'object_id', pg_temp.u('e1'))::text,
  'AC-14: one row for the approved document inside 14 days (not the one in 20, not the pending one)');
SELECT is((SELECT coalesce(a.actor_id::text, 'none') || '|' || a.entity_type || '|' || a.region FROM public.audit_log a
            WHERE a.action = 'provider.document_expiring' AND a.entity_id = pg_temp.u('a7')::text),
  'none|provider|TR', 'AC-14: no actor (the job), the provider as entity, the provider''s region');
SELECT is((SELECT row(m.*)::text FROM public.audit_log a, public.audit_notices(a.id) m
            WHERE a.action = 'provider.document_expiring' AND a.entity_id = pg_temp.u('a7')::text),
  row(pg_temp.u('a7'), 'document_expiring', NULL::uuid, pg_temp.u('d1'),
      (current_date + 11)::timestamp AT TIME ZONE 'Europe/Istanbul', (current_date + 11)::timestamp AT TIME ZONE 'Europe/Istanbul',
      NULL::text)::text,
  'AC-14, X-10: the map names the provider, the document row, and the end of that local day');
SELECT is((SELECT n.kind || '|' || n.entity_id::text || '|' || coalesce(n.request_id::text, 'none') || '|' || (n.deadline_at = (current_date + 11)::timestamp AT TIME ZONE 'Europe/Istanbul')::text
             FROM public.notifications n WHERE n.recipient_id = pg_temp.u('a7')),
  'document_expiring|' || pg_temp.u('d1')::text || '|none|true', 'AC-14: a notice, ids only, its date in deadline_at');
SELECT is((SELECT count(*)::integer FROM public.outbox_events o
            WHERE o.payload ->> 'template' = 'document_expiring' AND o.payload ->> 'recipient_id' = pg_temp.u('a7')::text), 1,
  'AC-14: and one mail');
SELECT is((SELECT (public.email_context(o.id) -> 'values' ->> 'document_type') || '|' || (public.email_context(o.id) -> 'values' ->> 'valid_until')
             FROM public.outbox_events o WHERE o.payload ->> 'template' = 'document_expiring' AND o.payload ->> 'recipient_id' = pg_temp.u('a7')::text),
  'id_front|' || to_char(current_date + 10, 'YYYY-MM-DD'), 'AC-14: the mail reads the document type and the date at send time');
SELECT is((SELECT public.email_context(o.id) ->> 'status' FROM public.outbox_events o
            WHERE o.payload ->> 'template' = 'document_expiring' AND o.payload ->> 'recipient_id' = pg_temp.u('a7')::text),
  'send', 'AC-14: while the document is still the one reminded');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.provider_documents SET valid_until = current_date + 100 WHERE id = pg_temp.u('d1')$$],
                        $$(SELECT public.email_context(o.id) ->> 'reason' FROM public.outbox_events o
                            WHERE o.payload ->> 'template' = 'document_expiring' AND o.payload ->> 'recipient_id' = pg_temp.u('a7')::text)$$),
  'condition', 'AC-14: a fresh replacement since means no mail');
SELECT public.queue_document_reminders();
SELECT is((SELECT count(*)::integer FROM public.audit_log a WHERE a.action = 'provider.document_expiring' AND a.entity_id = pg_temp.u('a7')::text),
  1, 'AC-14: never twice for one document object');
SELECT is(pg_temp.probe(ARRAY[$$UPDATE public.provider_documents SET object_id = gen_random_uuid(), valid_until = current_date + 5 WHERE id = pg_temp.u('d1')$$],
                        $$public.queue_document_reminders()$$)::integer >= 1, true,
  'AC-14: a replaced document (a new object) gets its own reminder');
SELECT ok(pg_temp.err($$INSERT INTO public.notifications (region, recipient_id, kind, dedupe_key) VALUES ('TR', pg_temp.u('a7'), 'document_expiring', 'notice:38:kind')$$) = 'none',
  'AC-14: the kind check takes document_expiring');

-- ══ AC-18: roles and grants ══════════════════════════════════════════════════
SELECT is(pg_temp.call_as('c1', $$SELECT public.admin_quality_flags(1)::text$$), 'forbidden', 'AC-18: a customer: admin_quality_flags');
SELECT is(pg_temp.call_as('a1', $$SELECT public.admin_quality_flags(1)::text$$), 'forbidden', 'AC-18: a provider: admin_quality_flags');
SELECT is(pg_temp.call_as('c1', format($$SELECT public.admin_handle_quality_flag(%L, 'cleared', 'A long enough note here.')::text$$, pg_temp.flag('a3', 'high_reports'))),
  'forbidden', 'AC-18: a customer: admin_handle_quality_flag');
SELECT is(pg_temp.call_as('a3', format($$SELECT public.admin_handle_quality_flag(%L, 'cleared', 'A long enough note here.')::text$$, pg_temp.flag('a3', 'high_reports'))),
  'forbidden', 'AC-18: a provider: admin_handle_quality_flag (not even their own)');
SELECT is(pg_temp.call_as('c1', $$SELECT public.admin_probation(1)::text$$), 'forbidden', 'AC-18: a customer: admin_probation');
SELECT is(pg_temp.call_as('a2', $$SELECT public.admin_probation(1)::text$$), 'forbidden', 'AC-18: a provider: admin_probation');
SELECT is(pg_temp.call_as('c1', $$SELECT public.admin_end_probation(pg_temp.u('a2'), 'A long enough note here.')::text$$), 'forbidden',
  'AC-18: a customer: admin_end_probation');
SELECT is(pg_temp.call_as('a2', $$SELECT public.admin_end_probation(pg_temp.u('a2'), 'A long enough note here.')::text$$), 'forbidden',
  'AC-18: a provider: admin_end_probation (not even their own)');
SELECT is(pg_temp.call_as('c1', $$SELECT public.admin_quality_funnel()::text$$), 'forbidden', 'AC-18: a customer: admin_quality_funnel');
SELECT is(pg_temp.call_as('a1', $$SELECT public.admin_quality_funnel()::text$$), 'forbidden', 'AC-18: a provider: admin_quality_funnel');
SELECT is(pg_temp.call_as('c1', $$SELECT public.admin_provider_quality(pg_temp.u('a1'))::text$$), 'forbidden', 'AC-18: a customer: admin_provider_quality');
SELECT is(pg_temp.call_as('a1', $$SELECT public.admin_provider_quality(pg_temp.u('a1'))::text$$), 'forbidden', 'AC-18: a provider: admin_provider_quality');
SELECT is_empty(
  $$ SELECT p.proname::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'execute')
        AND p.proname IN ('quality_settings', 'quality_settings_or_null', 'document_reminder_days', 'quality_rate',
                          'provider_caused_cancel', 'provider_jobs_done', 'provider_quality_with', 'provider_quality',
                          'provider_card_quality', 'provider_on_probation_with', 'provider_on_probation', 'provider_live_jobs',
                          'provider_apply_cap', 'my_provider_quality', 'quality_crosses', 'raise_quality_flags',
                          'admin_handle_quality_flag', 'admin_end_probation', 'admin_quality_flags', 'admin_probation',
                          'admin_quality_funnel', 'admin_provider_quality', 'queue_document_reminders',
                          'probation_waivers_append_only', 'quality_flags_guard') $$,
  'AC-18: anon executes none of them');
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default" FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND has_function_privilege('authenticated', p.oid, 'execute')
        AND p.proname IN ('quality_settings', 'quality_settings_or_null', 'document_reminder_days', 'quality_rate',
                          'provider_caused_cancel', 'provider_jobs_done', 'provider_quality_with', 'provider_quality',
                          'provider_card_quality', 'provider_on_probation_with', 'provider_on_probation', 'provider_live_jobs',
                          'provider_apply_cap', 'my_provider_quality', 'quality_crosses', 'raise_quality_flags',
                          'admin_handle_quality_flag', 'admin_end_probation', 'admin_quality_flags', 'admin_probation',
                          'admin_quality_funnel', 'admin_provider_quality', 'queue_document_reminders',
                          'probation_waivers_append_only', 'quality_flags_guard')
      ORDER BY p.proname COLLATE "C" $$,
  $$ VALUES ('admin_end_probation'::text), ('admin_handle_quality_flag'), ('admin_probation'), ('admin_provider_quality'),
            ('admin_quality_flags'), ('admin_quality_funnel'), ('my_provider_quality') $$,
  'AC-18: authenticated executes only the provider''s view and the six admin functions; the internals and the jobs have no grant');
SELECT is_empty(
  $$ SELECT p.proname::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND has_function_privilege('service_role', p.oid, 'execute')
        AND p.proname IN ('raise_quality_flags', 'queue_document_reminders', 'provider_quality', 'quality_settings') $$,
  'AC-8, AC-14, X-16: the two jobs and the readers have no service role grant (pg_cron runs them as postgres)');
SELECT is(pg_temp.call_as('a1', $$SELECT count(*)::text FROM public.quality_flags$$), '42501', 'AC-18: authenticated cannot read quality_flags');
SELECT is(pg_temp.call_as('anon', $$SELECT count(*)::text FROM public.quality_flags$$), '42501', 'AC-18: nor can anon');
SELECT is(pg_temp.call_as('service', $$SELECT count(*)::text FROM public.quality_flags$$), '42501', 'AC-18: nor the service role');
SELECT is(pg_temp.call_as('a4', $$SELECT count(*)::text FROM public.probation_waivers$$), '42501', 'AC-18: authenticated cannot read probation_waivers');
SELECT is(pg_temp.call_as('service', $$SELECT count(*)::text FROM public.probation_waivers$$), '42501', 'AC-18: nor the service role');
SELECT results_eq(
  $$ SELECT c.relname::text COLLATE "default", c.relrowsecurity FROM pg_class c
      WHERE c.oid IN ('public.quality_flags'::regclass, 'public.probation_waivers'::regclass) ORDER BY c.relname COLLATE "C" $$,
  $$ VALUES ('probation_waivers'::text, true), ('quality_flags', true) $$, 'AC-18: RLS on both tables');
-- Security review G-2 (2026-11-22): no API role holds any privilege on either table, so a later grant is caught here.
SELECT is_empty(
  $$ SELECT r.rolname || ' ' || t.tbl || ' ' || p.priv
       FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname),
            (VALUES ('public.quality_flags'), ('public.probation_waivers')) AS t(tbl),
            (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
      WHERE has_table_privilege(r.rolname, t.tbl, p.priv) $$,
  'AC-18, G-2: anon, authenticated and service_role hold no privilege on quality_flags or probation_waivers');
SELECT results_eq(
  $$ SELECT jobname::text COLLATE "default", schedule::text COLLATE "default", command::text COLLATE "default" FROM cron.job
      WHERE jobname IN ('providers-quality-flags', 'providers-document-reminders') ORDER BY jobname COLLATE "C" $$,
  $$ VALUES ('providers-document-reminders'::text, '0 6 * * *'::text, 'select public.queue_document_reminders()'::text),
            ('providers-quality-flags', '41 * * * *', 'select public.raise_quality_flags()') $$,
  'AC-8, AC-14: the two cron jobs');
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default", p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('raise_quality_flags', 'queue_document_reminders') ORDER BY p.proname COLLATE "C" $$,
  $$ VALUES ('queue_document_reminders'::text, true), ('raise_quality_flags', true) $$,
  'X-16: both jobs are security definer with a pinned path (supabase/tests/02)');

SELECT * FROM finish();
ROLLBACK;
