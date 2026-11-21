-- Position 17, spec 0011-17 (D205): ratings.
--
-- rate_provider (AC-1): only the request's customer, only COMPLETED with an unlocked pick, only inside the window in
-- whole hours, four whole scores from 1 to 5, one per request, the region, provider, application and customer from the
-- request, one audit row with ids only; every refusal. The tables are append only for every role and closed to every
-- API role (AC-2). A rating changes no money or state row, and nothing outside this spec reads the two tables (AC-3,
-- the meta test). The score (AC-4): New below the minimum, the shrinkage toward the region mean, the recency weight,
-- a hide counted at once. The offer card carries it (AC-5); the customer's form reads request_rating (AC-6); the
-- provider reads only their own summary (AC-7); admin lists and hides (AC-8); the two mails (AC-9); the four settings
-- (AC-10); the grants.
--
-- Ratings are seeded as postgres (no API role can insert one) through pg_temp.rated, which builds each COMPLETED
-- request with its unlocked pick first; five ratings need five requests, because request_id is unique (AC-13). Any
-- rating already in the local database (a past e2e run) is hidden inside this transaction first, so the region means
-- below are exactly this file's.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(138);

SET CONSTRAINTS ALL IMMEDIATE;

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003500' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003570' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.app(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000003580' || lpad(p::text, 2, '0'))::uuid $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1, c2 customers (c1 with a confirmed address); a1 the provider of the flows (a confirmed address, a two word
-- approved name); a2 to a6 the providers of the score tests; ad the admin.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559350001'), ('c2', '905559350002'), ('a1', '905559350003'), ('a2', '905559350004'),
               ('a3', '905559350005'), ('a4', '905559350006'), ('a5', '905559350007'), ('a6', '905559350008'),
               ('ad', '905559350009')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale, email, email_confirmed_at)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'en', e, CASE WHEN e IS NOT NULL THEN now() END
  FROM (VALUES ('c1', 'customer', '905559350001', 'Puan Müşteri', 'c1-35@example.com'),
               ('c2', 'customer', '905559350002', 'İkinci Müşteri', NULL),
               ('a1', 'provider', '905559350003', 'Ayşe Yılmaz', 'a1-35@example.com'),
               ('a2', 'provider', '905559350004', 'İki Usta', NULL),
               ('a3', 'provider', '905559350005', 'Üç Usta', NULL),
               ('a4', 'provider', '905559350006', 'Dört Usta', NULL),
               ('a5', 'provider', '905559350007', 'Beş Usta', NULL),
               ('a6', 'provider', '905559350008', 'Altı Usta', NULL),
               ('ad', 'admin', '905559350009', 'Puan Yönetici', NULL)) AS t(c, r, p, n, e);
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Usta'
 WHERE id IN (pg_temp.u('a2'), pg_temp.u('a3'), pg_temp.u('a4'), pg_temp.u('a5'), pg_temp.u('a6'));
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Ayşe Yılmaz' WHERE id = pg_temp.u('a1');
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Puan"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Temizlik", "en": "Cleaning", "ar": "تنظيف"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Moda"}', 1.00, true);
UPDATE public.platform_settings SET value = 'true' WHERE region = 'TR' AND key IN ('payments_enabled', 'emails_enabled');
UPDATE public.platform_settings SET value = 'false' WHERE region = 'TR' AND key IN ('apply_needs_email', 'auto_close_enabled');

-- A past e2e run may have left ratings: hidden here (rolled back at the end), so every region mean is this file's.
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
-- p_sql as an API role: anon, service (service_role), or a user tag (authenticated with that user's claims).
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
-- A direct write as postgres, naming the table as a value: 'none', or the trigger's refusal.
CREATE FUNCTION pg_temp.try_write(p_verb text, p_table text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_verb = 'update' THEN
    EXECUTE format('UPDATE public.%I SET created_at = created_at', p_table);
  ELSIF p_verb = 'delete' THEN
    EXECUTE format('DELETE FROM public.%I', p_table);
  ELSE
    EXECUTE format('TRUNCATE public.%I CASCADE', p_table);
  END IF;
  RETURN 'none';
EXCEPTION WHEN raise_exception THEN
  RETURN sqlerrm;
END $$;

-- A job of customer c with provider w on request p, seeded exact with the guards off. p_status is the request's
-- status (UNLOCKED, AWAITING_CONFIRMATION or COMPLETED), closed at p_closed (COMPLETED only) by p_by; p_unlocked
-- false leaves the pick without unlocked_at (unreachable through the functions).
CREATE FUNCTION pg_temp.job(p integer, w text, p_status text DEFAULT 'COMPLETED', p_closed timestamptz DEFAULT now(),
                            p_by text DEFAULT 'customer', c text DEFAULT 'c1', p_unlocked boolean DEFAULT true)
  RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_at timestamptz := coalesce(p_closed, now()) - interval '4 hours';
BEGIN
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u(c), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100, "service": {"name": {"tr": "Temizlik", "en": "Cleaning"}}}', 100000, 10000, 90000, 'TRY',
    v_at, v_at + interval '2 hours');
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  VALUES (pg_temp.app(p), 'TR', pg_temp.r(p), pg_temp.u(w), 'An offer for the rating tests, long enough to pass.');
  ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
  UPDATE public.applications
     SET status = CASE p_status WHEN 'COMPLETED' THEN 'CONFIRMED' WHEN 'AWAITING_CONFIRMATION' THEN 'COMPLETED'
                                ELSE 'UNLOCKED' END,
         status_changed_at = v_at - interval '2 hours',
         unlocked_at = CASE WHEN p_unlocked THEN v_at - interval '2 hours' END,
         provider_fee_amount = 0, provider_fee_kind = 'fixed'
   WHERE id = pg_temp.app(p);
  ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
  ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
  UPDATE public.requests
     SET status = p_status, selected_application_id = pg_temp.app(p), selected_at = v_at - interval '5 hours',
         payment_deadline = v_at - interval '4 hours', fee_deadline = v_at - interval '3 hours',
         actual_started_at = CASE WHEN p_status IN ('AWAITING_CONFIRMATION', 'COMPLETED') THEN v_at END,
         actual_completed_at = CASE WHEN p_status IN ('AWAITING_CONFIRMATION', 'COMPLETED') THEN v_at + interval '1 hour' END,
         confirm_deadline = CASE WHEN p_status = 'AWAITING_CONFIRMATION' THEN now() + interval '2 days' END,
         closed_at = CASE WHEN p_status = 'COMPLETED' THEN p_closed END,
         closed_by = CASE WHEN p_status = 'COMPLETED' THEN p_by END
   WHERE id = pg_temp.r(p);
  ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
  RETURN pg_temp.r(p);
END $$;
-- The seeding helper (AC-13): n COMPLETED jobs of provider w from request p on, each rated s at p_at minus k minutes
-- (k = 0, 1, ...), so the newest is the first.
CREATE FUNCTION pg_temp.rated(p integer, n integer, w text, s integer[], p_at timestamptz DEFAULT now(),
                              p_step interval DEFAULT interval '0') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  FOR i IN 0 .. n - 1 LOOP
    PERFORM pg_temp.job(p + i, w);
    INSERT INTO public.ratings (region, request_id, application_id, provider_id, customer_id, punctuality, quality,
                                professionalism, value, created_at)
    VALUES ('TR', pg_temp.r(p + i), pg_temp.app(p + i), pg_temp.u(w), pg_temp.u('c1'), s[1], s[2], s[3], s[4],
            p_at - p_step * i);
  END LOOP;
END $$;
CREATE FUNCTION pg_temp.sum(w text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT public.provider_rating_summary(pg_temp.u(w)) $$;
CREATE FUNCTION pg_temp.rate(p integer, s integer[] DEFAULT ARRAY[5, 5, 5, 5]) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.err(format('SELECT public.rate_provider(%L, %s, %s, %s, %s)', pg_temp.r(p),
                            coalesce(s[1]::text, 'NULL'), coalesce(s[2]::text, 'NULL'), coalesce(s[3]::text, 'NULL'),
                            coalesce(s[4]::text, 'NULL'))) $$;
-- The rows the money and state tables hold, as one digest (AC-3).
CREATE FUNCTION pg_temp.money_state() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.requests t),
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.applications t),
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.fee_payments t),
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.fee_refunds t),
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.checkout_attempts t),
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.ledger_journals t),
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.ledger_entries t))) $$;
-- A request's mail rows, sorted: template>tag.
CREATE FUNCTION pg_temp.mails(p integer) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT coalesce(string_agg(o.payload ->> 'template' || '>'
                               || CASE (o.payload ->> 'recipient_id')::uuid WHEN pg_temp.u('c1') THEN 'c1'
                                                                            WHEN pg_temp.u('a1') THEN 'a1' ELSE '?' END,
                             ',' ORDER BY o.payload ->> 'template' COLLATE "C"), '')
    FROM public.outbox_events o
   WHERE o.kind = 'email.send' AND o.payload ->> 'request_id' = pg_temp.r(p)::text
     AND o.payload ->> 'template' <> 'new_offer' $$;
CREATE FUNCTION pg_temp.mail_id(p integer, p_template text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT o.id FROM public.outbox_events o
   WHERE o.kind = 'email.send' AND o.payload ->> 'request_id' = pg_temp.r(p)::text AND o.payload ->> 'template' = p_template $$;

-- ══ AC-10: the settings ══════════════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT region::text COLLATE "default", key::text COLLATE "default", value::text FROM public.platform_settings
      WHERE key IN ('rating_window_days', 'rating_min_count', 'rating_prior_weight', 'rating_half_life_days')
      ORDER BY region COLLATE "C", key COLLATE "C" $$,
  $$ VALUES ('KSA'::text, 'rating_half_life_days'::text, '365'::text), ('KSA', 'rating_min_count', '5'),
            ('KSA', 'rating_prior_weight', '5'), ('KSA', 'rating_window_days', '14'),
            ('TR', 'rating_half_life_days', '365'), ('TR', 'rating_min_count', '5'), ('TR', 'rating_prior_weight', '5'),
            ('TR', 'rating_window_days', '14') $$,
  'AC-10: four keys per region, seeded for TR and KSA');
SELECT is(public.rating_settings('TR'),
  '{"rating_window_days": 14, "rating_min_count": 5, "rating_prior_weight": 5, "rating_half_life_days": 365}'::jsonb,
  'AC-10: the reader returns the four whole numbers');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'rating_window_days'$$), '23514',
  'AC-10: the window is at least 1 day');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '91' WHERE region = 'TR' AND key = 'rating_window_days'$$), '23514',
  'AC-10: and at most 90');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '14.5' WHERE region = 'TR' AND key = 'rating_window_days'$$), '23514',
  'AC-10: a whole number');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '"14"' WHERE region = 'TR' AND key = 'rating_window_days'$$), '23514',
  'AC-10: a JSON number');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '4' WHERE region = 'TR' AND key = 'rating_min_count'$$), '23514',
  'AC-10, overview §28: no average below 5 ratings, whatever admin sets');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '51' WHERE region = 'TR' AND key = 'rating_min_count'$$), '23514',
  'AC-10: the minimum is at most 50');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'rating_prior_weight'$$), '23514',
  'AC-10: the prior weight is at least 1');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '51' WHERE region = 'TR' AND key = 'rating_prior_weight'$$), '23514',
  'AC-10: and at most 50');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '29' WHERE region = 'TR' AND key = 'rating_half_life_days'$$), '23514',
  'AC-10: the half life is at least 30 days');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET value = '3651' WHERE region = 'TR' AND key = 'rating_half_life_days'$$), '23514',
  'AC-10: and at most 3650');
SELECT is(pg_temp.err($$DELETE FROM public.platform_settings WHERE region = 'KSA' AND key = 'rating_min_count'$$), 'pricing_setting_required',
  'AC-10: the guard keeps every rating key');
SELECT is(pg_temp.err($$UPDATE public.platform_settings SET key = 'rating_old' WHERE region = 'KSA' AND key = 'rating_half_life_days'$$), 'pricing_setting_required',
  'AC-10: and refuses a rename');
SELECT is(pg_temp.probe(ARRAY[$q$ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard$q$,
                              $q$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'rating_prior_weight'$q$],
                        $q$public.rating_settings('TR')$q$),
  'rating_settings_invalid', 'AC-10: a missing key fails closed');

-- ══ AC-4: the score ══════════════════════════════════════════════════════════
SELECT pg_temp.rated(1, 1, 'a3', ARRAY[5, 5, 5, 5]);
SELECT is(pg_temp.sum('a3'), '{"state": "new", "count": 1}'::jsonb, 'AC-4: one 5 shows New, never 5.0');
SELECT pg_temp.rated(2, 3, 'a3', ARRAY[5, 5, 5, 5]);
SELECT is(pg_temp.sum('a3'), '{"state": "new", "count": 4}'::jsonb, 'AC-4: four ratings still show New');
SELECT pg_temp.rated(5, 1, 'a3', ARRAY[5, 5, 5, 5]);
SELECT is(pg_temp.sum('a3') ->> 'state', 'rated', 'AC-4: the fifth shows a score');
SELECT is(pg_temp.sum('a3') ->> 'overall', '5.0', 'AC-4: with no other rating in the region, the mean is the provider''s own');
-- a4: five 3s. The region mean is now (25 + 15) / 10 = 4, so a3 is (5 × 4 + 25) / (5 + 5) = 4.5 and a4 is 3.5.
SELECT pg_temp.rated(6, 5, 'a4', ARRAY[3, 3, 3, 3]);
SELECT is(pg_temp.sum('a3'),
  '{"state": "rated", "count": 5, "overall": 4.5, "punctuality": 4.5, "quality": 4.5, "professionalism": 4.5, "value": 4.5}'::jsonb,
  'AC-4: five 5s in a region of 3s show 4.5, never 5.0 (shrinkage toward the region mean)');
SELECT is(pg_temp.sum('a4'),
  '{"state": "rated", "count": 5, "overall": 3.5, "punctuality": 3.5, "quality": 3.5, "professionalism": 3.5, "value": 3.5}'::jsonb,
  'AC-4: and five 3s show 3.5');
-- a5: four new ratings of (5, 4, 3, 2) and one of (1, 1, 1, 1) exactly 365 days old, which weighs 0.5: Σw = 4.5.
-- Region means over 15 ratings: punctuality 61/15, quality 57/15, professionalism 53/15, value 49/15, overall 55/15.
-- Punctuality (5 × 61/15 + 20 + 0.5) / 9.5 = 4.298 → 4.3 (a full weight would give 4.1); quality 35.5 / 9.5 → 3.7;
-- professionalism 30.17 / 9.5 → 3.2; value 24.83 / 9.5 → 2.6; overall (18.33 + 14 + 0.5) / 9.5 → 3.5.
SELECT pg_temp.rated(11, 4, 'a5', ARRAY[5, 4, 3, 2]);
SELECT pg_temp.rated(15, 1, 'a5', ARRAY[1, 1, 1, 1], now() - interval '8760 hours');
SELECT is(pg_temp.sum('a5'),
  '{"state": "rated", "count": 5, "overall": 3.5, "punctuality": 4.3, "quality": 3.7, "professionalism": 3.2, "value": 2.6}'::jsonb,
  'AC-4: each dimension on its own, and a rating 365 days old weighs half of a new one');
SELECT is((round((5 * (61.0 / 15) + 4 * 5 + 0.5 * 1) / (5 + 4.5), 1))::text, '4.3',
  'AC-4: the punctuality figure, computed here from the formula');
SELECT isnt((round((5 * (61.0 / 15) + 5 * 5 - 4) / (5 + 5), 1))::text, '4.3',
  'AC-4: a full weight on the old rating would not give it');
-- a6: six ratings, the newest first; one of them a 1.
SELECT pg_temp.rated(16, 5, 'a6', ARRAY[4, 4, 4, 4], now(), interval '1 minute');
SELECT pg_temp.rated(21, 1, 'a6', ARRAY[1, 1, 1, 1], now() - interval '10 minutes');
SELECT is((pg_temp.sum('a6') ->> 'count')::int, 6, 'AC-4: a6 has six visible ratings');
SELECT ok(NOT (public.provider_rating_summary(pg_temp.u('c1')) ?| ARRAY['overall']),
  'AC-4: a customer id is no provider: New with no figure');

-- ══ AC-1: rate_provider ══════════════════════════════════════════════════════
SELECT pg_temp.job(30, 'a1');
SELECT pg_temp.job(31, 'a1', 'UNLOCKED', NULL);
SELECT pg_temp.job(32, 'a1', 'AWAITING_CONFIRMATION', NULL);
SELECT pg_temp.job(33, 'a1', p_unlocked => false);
SELECT pg_temp.job(34, 'a1', p_closed => now() - interval '336 hours' - interval '1 second');
SELECT pg_temp.job(35, 'a2', p_closed => now() - interval '336 hours');
SELECT pg_temp.job(36, 'a1', p_by => 'admin');
SELECT pg_temp.job(37, 'a1');
SELECT pg_temp.job(38, 'a1');

SELECT pg_temp.as_user('c2');
SELECT is(pg_temp.rate(30), 'not_found', 'AC-1: another customer is refused as not found');
SELECT pg_temp.as_user('a1');
SELECT is(pg_temp.rate(30), 'not_found', 'AC-1: the provider of the job is refused');
SELECT pg_temp.as_user('ad');
SELECT is(pg_temp.rate(30), 'not_found', 'AC-1: admin can never rate for anyone');
SELECT pg_temp.as_user('c1');
SELECT is(pg_temp.err($$SELECT public.rate_provider('00000000-0000-0000-0000-000000357099', 5, 5, 5, 5)$$), 'not_found',
  'AC-1: an unknown request');
SELECT is(pg_temp.err($$SELECT public.rate_provider(NULL, 5, 5, 5, 5)$$), 'not_found', 'AC-1: no request id');
SELECT is(pg_temp.rate(30, ARRAY[0, 5, 5, 5]), 'validation_failed', 'AC-1: a score below 1');
SELECT is(pg_temp.rate(30, ARRAY[5, 6, 5, 5]), 'validation_failed', 'AC-1: a score above 5');
SELECT is(pg_temp.rate(30, ARRAY[5, 5, NULL, 5]), 'validation_failed', 'AC-1: all four are required');
SELECT is(pg_temp.rate(31), 'invalid_state', 'AC-1: a job still running');
SELECT is(pg_temp.rate(32), 'invalid_state', 'AC-1: a job waiting for confirmation');
SELECT is(pg_temp.rate(33), 'invalid_state', 'AC-1: a completed request whose pick was never unlocked');
SELECT is(pg_temp.rate(34), 'deadline_passed', 'AC-1: one second past 14 × 24 hours after the close');
SELECT is(pg_temp.rate(35), 'none', 'AC-1: exactly 14 × 24 hours after the close is still inside');
SELECT is(pg_temp.rate(36), 'none', 'AC-1: a job admin closed counts like any other COMPLETED');
SELECT is(pg_temp.probe(ARRAY[$q$SELECT public.promote_to_admin('+905559350001')$q$], $q$pg_temp.rate(37)$q$), 'not_found',
  'AC-1: a customer promoted to admin later never rates their old jobs (security review I-1)');
SELECT is(pg_temp.err(format($q$INSERT INTO public.ratings (region, request_id, application_id, provider_id, customer_id,
                                   punctuality, quality, professionalism, value) VALUES ('TR', %L, %L, %L, %L, 5, 5, 5, 5)$q$,
                             pg_temp.r(38), pg_temp.app(38), pg_temp.u('a2'), pg_temp.u('c1'))),
  'validation_failed', 'Guardrail: even as postgres, a rating names the provider of the request''s pick');
SELECT is(pg_temp.err(format($q$INSERT INTO public.ratings (region, request_id, application_id, provider_id, customer_id,
                                   punctuality, quality, professionalism, value) VALUES ('TR', %L, %L, %L, %L, 5, 5, 5, 5)$q$,
                             pg_temp.r(38), pg_temp.app(38), pg_temp.u('a1'), pg_temp.u('c2'))),
  '23503', 'Guardrail: and the request''s own customer');
SELECT is(pg_temp.probe(ARRAY[$q$ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard$q$,
                              $q$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'rating_window_days'$q$],
                        format($q$pg_temp.rate(37) || ' / ' || (pg_temp.sum('a3') ->> 'state')$q$)),
  'rating_settings_invalid / unavailable', 'AC-1, AC-4: a broken setting refuses the rating and makes the score unavailable');

-- AC-3: the happy path changes no money or state row.
CREATE TEMP TABLE before_state AS SELECT pg_temp.money_state() AS digest;
SELECT is(pg_temp.err(format($q$SELECT public.rate_provider(%L, 5, 4, 5, 3)$q$, pg_temp.r(30))), 'none', 'AC-1: the customer rates');
SELECT is(pg_temp.money_state(), (SELECT digest FROM before_state),
  'AC-3: requests, applications, fees, refunds, checkouts and the ledger are untouched');
SELECT results_eq(
  $$ SELECT region::text, provider_id, application_id, customer_id, punctuality::int, quality::int, professionalism::int, value::int
       FROM public.ratings WHERE request_id = pg_temp.r(30) $$,
  $$ VALUES ('TR'::text, pg_temp.u('a1'), pg_temp.app(30), pg_temp.u('c1'), 5, 4, 5, 3) $$,
  'AC-1: one row, with the region, provider, application and customer from the request');
SELECT results_eq(
  $$ SELECT actor_id, entity_type::text, region::text, old_value IS NULL,
            (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(new_value) k)::text,
            new_value ->> 'application_id', new_value ->> 'rating_id'
       FROM public.audit_log WHERE action = 'rating.created' AND entity_id = pg_temp.r(30)::text $$,
  $$ SELECT pg_temp.u('c1'), 'requests'::text, 'TR'::text, true, '{application_id,rating_id}'::text,
            pg_temp.app(30)::text, (SELECT id::text FROM public.ratings WHERE request_id = pg_temp.r(30)) $$,
  'AC-1: one audit row, ids only, no score');
SELECT is(pg_temp.rate(30), 'already_rated', 'AC-1: a second rating for the request');
SELECT is((SELECT count(*)::int FROM public.ratings WHERE request_id = pg_temp.r(30)), 1, 'AC-1: still one row');

-- ══ AC-2: append only, closed to every API role ══════════════════════════════
SELECT is(pg_temp.try_write('update', 'ratings'), 'rating_append_only', 'AC-2: a rating is never updated, even as postgres');
SELECT is(pg_temp.try_write('delete', 'ratings'), 'rating_append_only', 'AC-2: nor deleted');
SELECT is(pg_temp.try_write('truncate', 'ratings'), 'rating_append_only', 'AC-2: nor truncated');
SELECT is(pg_temp.try_write('truncate', 'rating_hides'), 'rating_append_only', 'AC-2: nor truncated');
SELECT is(pg_temp.call_as('c1', $$SELECT count(*)::text FROM public.ratings$$), '42501', 'AC-2: a customer cannot select ratings');
SELECT is(pg_temp.call_as('a1', $$SELECT count(*)::text FROM public.ratings$$), '42501', 'AC-2: nor a provider');
SELECT is(pg_temp.call_as('anon', $$SELECT count(*)::text FROM public.ratings$$), '42501', 'AC-2: nor anon');
SELECT is(pg_temp.call_as('service', $$SELECT count(*)::text FROM public.ratings$$), '42501', 'AC-2: nor the service role');
SELECT is(pg_temp.call_as('c1', format($q$INSERT INTO public.ratings (region, request_id, application_id, provider_id, customer_id,
                                          punctuality, quality, professionalism, value)
                                          VALUES ('TR', %L, %L, %L, %L, 5, 5, 5, 5) RETURNING id::text$q$,
                                       pg_temp.r(38), pg_temp.app(38), pg_temp.u('a1'), pg_temp.u('c1'))),
  '42501', 'AC-2: a customer cannot insert a rating directly');
SELECT is(pg_temp.call_as('service', format($q$INSERT INTO public.ratings (region, request_id, application_id, provider_id, customer_id,
                                               punctuality, quality, professionalism, value)
                                               VALUES ('TR', %L, %L, %L, %L, 5, 5, 5, 5) RETURNING id::text$q$,
                                            pg_temp.r(38), pg_temp.app(38), pg_temp.u('a1'), pg_temp.u('c1'))),
  '42501', 'AC-2: nor the service role');
SELECT is(pg_temp.call_as('c1', $$SELECT count(*)::text FROM public.rating_hides$$), '42501', 'AC-2: nobody selects hides');
SELECT is(pg_temp.call_as('service', $$SELECT count(*)::text FROM public.rating_hides$$), '42501', 'AC-2: not even the service role');
SELECT is(pg_temp.call_as('ad', format($q$INSERT INTO public.rating_hides (rating_id, region, reason, note, hidden_by)
                                          SELECT %L::uuid, 'TR', 'fake', 'Direct insert.', %L::uuid RETURNING rating_id::text$q$,
                                       (SELECT id FROM public.ratings WHERE request_id = pg_temp.r(30)), pg_temp.u('ad'))),
  '42501', 'AC-2: admin hides only through admin_hide_rating');
SELECT results_eq(
  $$ SELECT c.relname::text COLLATE "default", c.relrowsecurity,
            has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
            has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
            has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       FROM pg_class c WHERE c.oid IN ('public.ratings'::regclass, 'public.rating_hides'::regclass)
      ORDER BY c.relname COLLATE "C" $$,
  $$ VALUES ('rating_hides'::text, true, false, false, false), ('ratings', true, false, false, false) $$,
  'AC-2: RLS on, no privilege for any API role');
SELECT results_eq(
  $$ SELECT tablename::text COLLATE "default", policyname::text COLLATE "default", qual COLLATE "default" FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('ratings', 'rating_hides') ORDER BY tablename COLLATE "C" $$,
  $$ VALUES ('rating_hides'::text, 'rating_hides_no_api'::text, 'false'::text), ('ratings', 'ratings_no_api', 'false') $$,
  'AC-2: one deny policy each');

-- ══ AC-3: it gates nothing ═══════════════════════════════════════════════════
SELECT is(
  (SELECT string_agg(p.proname::text, ',' ORDER BY p.proname COLLATE "C")
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND regexp_replace(regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g'),
                         '''[^'']*''', '', 'g') ~ '\m(ratings|rating_hides|provider_rating_summary)\M'),
  'admin_hide_rating,admin_provider_ratings,email_context,my_provider_rating,offer_card,provider_rating_summary,rate_provider,request_rating',
  'AC-3: exactly these functions read ratings or rating_hides, directly or through provider_rating_summary, so nothing can wait on a rating');
-- Security review guardrail (2026-11-22): the same set with string literals kept (so dynamic SQL naming the tables is
-- caught), apart from the notice topic 'ratings', and no view, materialized view or policy anywhere reads them.
SELECT is(
  (SELECT string_agg(p.proname::text, ',' ORDER BY p.proname COLLATE "C")
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_temp%'
      AND replace(regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g'), '''ratings''', '')
          ~ '\m(ratings|rating_hides|provider_rating_summary)\M'),
  'admin_hide_rating,admin_provider_ratings,email_context,my_provider_rating,offer_card,provider_rating_summary,rate_provider,request_rating',
  'AC-3: no other function in any schema names them, not even inside a dynamic SQL string');
SELECT is_empty(
  $$ SELECT viewname::text FROM pg_views WHERE definition ~ '\m(ratings|rating_hides|provider_rating_summary)\M'
     UNION ALL SELECT matviewname::text FROM pg_matviews WHERE definition ~ '\m(ratings|rating_hides|provider_rating_summary)\M'
     UNION ALL SELECT policyname::text FROM pg_policies
      WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '\m(ratings|rating_hides|provider_rating_summary)\M' $$,
  'AC-3: no view, materialized view or policy reads a rating');
SELECT pg_temp.as_user('c1');
SELECT is((public.my_report(pg_temp.r(38)) ->> 'can_report')::boolean, true,
  'AC-3: a COMPLETED request with no rating keeps its report window');
SELECT pg_temp.as_user('a1');
SELECT ok((public.provider_history((SELECT (scheduled_start_at AT TIME ZONE 'Europe/Istanbul')::date FROM public.requests
                                     WHERE id = pg_temp.r(38))) -> 'rows')
          @> jsonb_build_array(jsonb_build_object('request_id', pg_temp.r(38))),
  'AC-3: and its provider history row');

-- ══ AC-6: request_rating ═════════════════════════════════════════════════════
SELECT pg_temp.as_user('c1');
SELECT results_eq(
  $$ SELECT x ->> 'can_rate', (x ->> 'rate_until')::timestamptz = now() + interval '336 hours', x ->> 'timezone', x -> 'rating' = 'null'::jsonb,
            (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(x) k)::text
       FROM (SELECT public.request_rating(pg_temp.r(38)) AS x) t $$,
  $$ VALUES ('true'::text, true, 'Europe/Istanbul'::text, true, '{can_rate,rate_until,rating,timezone}'::text) $$,
  'AC-6: an unrated COMPLETED job: can rate until the close plus 14 days, in the region''s time zone');
SELECT results_eq(
  $$ SELECT x ->> 'can_rate', (x -> 'rating') - 'created_at', (x -> 'rating') ? 'created_at'
       FROM (SELECT public.request_rating(pg_temp.r(30)) AS x) t $$,
  $$ VALUES ('false'::text, '{"punctuality": 5, "quality": 4, "professionalism": 5, "value": 3}'::jsonb, true) $$,
  'AC-6: after the send, the four scores read only, with their time');
SELECT results_eq(
  $$ SELECT x ->> 'can_rate', x ->> 'rate_until' IS NOT NULL, x -> 'rating' = 'null'::jsonb
       FROM (SELECT public.request_rating(pg_temp.r(34)) AS x) t $$,
  $$ VALUES ('false'::text, true, true) $$,
  'AC-6: past the window, no form');
SELECT results_eq(
  $$ SELECT x ->> 'can_rate', x ->> 'rate_until' IS NULL FROM (SELECT public.request_rating(pg_temp.r(31)) AS x) t $$,
  $$ VALUES ('false'::text, true) $$,
  'AC-6: a running job has no window yet');
SELECT is(pg_temp.probe(ARRAY[$q$ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard$q$,
                              $q$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'rating_min_count'$q$],
                        format($q$public.request_rating(%L) ->> 'can_rate'$q$, pg_temp.r(38))),
  'false', 'AC-6: a broken setting shows no form');
SELECT pg_temp.as_user('c2');
SELECT is(public.request_rating(pg_temp.r(38)), NULL::jsonb, 'AC-6: another customer reads nothing');
SELECT pg_temp.as_user('a1');
SELECT is(public.request_rating(pg_temp.r(38)), NULL::jsonb, 'AC-6: nor the provider');
SELECT pg_temp.as_user('ad');
SELECT is(public.request_rating(pg_temp.r(38)), NULL::jsonb, 'AC-6: nor admin');
SELECT is(pg_temp.call_as('anon', format($q$SELECT public.request_rating(%L)::text$q$, pg_temp.r(38))), '42501',
  'AC-6: anon cannot call it');
SELECT is(pg_temp.call_as('anon', format($q$SELECT public.rate_provider(%L, 5, 5, 5, 5)::text$q$, pg_temp.r(38))), '42501',
  'AC-1: nor rate_provider');

-- ══ AC-5: the offer card ═════════════════════════════════════════════════════
INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
  pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
VALUES (pg_temp.r(50), 'TR', pg_temp.u('c2'), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
  '{"rounding_minor": 100}', 100000, 10000, 90000, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours');
INSERT INTO public.applications (id, region, request_id, provider_id, message)
SELECT gen_random_uuid(), 'TR', pg_temp.r(50), pg_temp.u(w), 'An offer for the rating card tests, long enough.'
  FROM unnest(ARRAY['a1', 'a3']) w;
SELECT pg_temp.as_user('c2');
SELECT is((SELECT o -> 'rating' FROM jsonb_array_elements(public.request_offers(pg_temp.r(50)) -> 'offers') o
            WHERE o ->> 'application_id' = (SELECT id::text FROM public.applications WHERE request_id = pg_temp.r(50) AND provider_id = pg_temp.u('a3'))),
  pg_temp.sum('a3'), 'AC-5: each offer carries its provider''s score');
SELECT is((SELECT o -> 'rating' FROM jsonb_array_elements(public.request_offers(pg_temp.r(50)) -> 'offers') o
            WHERE o ->> 'application_id' = (SELECT id::text FROM public.applications WHERE request_id = pg_temp.r(50) AND provider_id = pg_temp.u('a1'))),
  '{"state": "new", "count": 2}'::jsonb, 'AC-5: and New with the count below 5');
SELECT pg_temp.as_user('c1');
SELECT is(public.request_offers(pg_temp.r(30)) -> 'chosen' -> 'rating', pg_temp.sum('a1'), 'AC-5: the chosen provider too');
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.providers SET status = 'suspended', suspension_reason = 'Suspended for the card test.' WHERE id = %L$q$, pg_temp.u('a1'))],
                        format($q$public.request_offers(%L) -> 'chosen' -> 'rating' ->> 'state'$q$, pg_temp.r(30))),
  'new', 'AC-5: a chosen provider suspended after the choose keeps their rating');

-- ══ AC-7: the provider ═══════════════════════════════════════════════════════
SELECT pg_temp.as_user('a3');
SELECT is(public.my_provider_rating(), pg_temp.sum('a3'), 'AC-7: a provider reads their own summary');
SELECT pg_temp.as_user('a1');
SELECT is(public.my_provider_rating(), '{"state": "new", "count": 2}'::jsonb, 'AC-7: New with the count');
SELECT pg_temp.as_user('c1');
SELECT is(pg_temp.err($$SELECT public.my_provider_rating()$$), 'forbidden', 'AC-7: a customer is refused');
SELECT pg_temp.as_user('ad');
SELECT is(pg_temp.err($$SELECT public.my_provider_rating()$$), 'forbidden', 'AC-7: and admin');

-- ══ AC-8: admin ══════════════════════════════════════════════════════════════
-- a2: 21 more ratings (r60 to r80), one a minute apart, for the second page.
SELECT pg_temp.rated(60, 21, 'a2', ARRAY[4, 4, 4, 4], now() - interval '1 hour', interval '1 minute');
SELECT pg_temp.as_user('ad');
SELECT results_eq(
  $$ SELECT (x ->> 'total')::int, jsonb_array_length(x -> 'rows'), x ->> 'timezone', x -> 'summary' = pg_temp.sum('a2'),
            (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(x) k)::text
       FROM (SELECT public.admin_provider_ratings(pg_temp.u('a2'), 1) AS x) t $$,
  $$ VALUES (22, 20, 'Europe/Istanbul'::text, true, '{rows,summary,timezone,total}'::text) $$,
  'AC-8: the summary, the total, the time zone and 20 rows a page');
SELECT is(jsonb_array_length(public.admin_provider_ratings(pg_temp.u('a2'), 2) -> 'rows'), 2, 'AC-8: the second page');
SELECT is((SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(public.admin_provider_ratings(pg_temp.u('a2'), 1) -> 'rows' -> 0) k)::text,
  '{created_at,hide,id,professionalism,punctuality,quality,request_id,value}', 'AC-8: each row''s keys');
SELECT is(public.admin_provider_ratings(pg_temp.u('a2'), 1) -> 'rows' -> 0 ->> 'request_id', pg_temp.r(35)::text,
  'AC-8: newest first (r35 rated now, a2''s seeded ones an hour back and older)');
SELECT is(public.admin_provider_ratings(pg_temp.u('a2'), 2) -> 'rows' -> 1 ->> 'request_id', pg_temp.r(80)::text,
  'AC-8: the oldest last');
SELECT is(pg_temp.err(format($q$SELECT public.admin_provider_ratings(%L, 0)$q$, pg_temp.u('a2'))), 'validation_failed',
  'AC-8: a page below 1');
SELECT is(pg_temp.err(format($q$SELECT public.admin_provider_ratings(%L, NULL)$q$, pg_temp.u('a2'))), 'validation_failed',
  'AC-8: no page');
SELECT is(pg_temp.err(format($q$SELECT public.admin_provider_ratings(%L, 1)$q$, pg_temp.u('c1'))), 'not_found',
  'AC-8: an id that is no provider');

-- The hide, on a6's 1 (r21).
CREATE TEMP TABLE a6_before AS SELECT pg_temp.sum('a6') AS s;
SELECT pg_temp.as_user('c1');
SELECT is(pg_temp.err(format($q$SELECT public.admin_hide_rating(%L, 'fake', 'A note.')$q$,
                             (SELECT id FROM public.ratings WHERE request_id = pg_temp.r(21)))), 'forbidden',
  'AC-8: a customer cannot hide');
SELECT is(pg_temp.err(format($q$SELECT public.admin_provider_ratings(%L, 1)$q$, pg_temp.u('a6'))), 'forbidden',
  'AC-8: nor list');
SELECT pg_temp.as_user('a6');
SELECT is(pg_temp.err(format($q$SELECT public.admin_hide_rating(%L, 'fake', 'A note.')$q$,
                             (SELECT id FROM public.ratings WHERE request_id = pg_temp.r(21)))), 'forbidden',
  'AC-8: nor the rated provider');
SELECT is(pg_temp.err(format($q$SELECT public.admin_provider_ratings(%L, 1)$q$, pg_temp.u('a6'))), 'forbidden',
  'AC-8: who cannot list either');
SELECT pg_temp.as_user('ad');
SELECT is(pg_temp.err(format($q$SELECT public.admin_hide_rating(%L, 'spam', 'A note.')$q$,
                             (SELECT id FROM public.ratings WHERE request_id = pg_temp.r(21)))), 'validation_failed',
  'AC-8: a reason outside the list');
SELECT is(pg_temp.err(format($q$SELECT public.admin_hide_rating(%L, 'fake', '   ')$q$,
                             (SELECT id FROM public.ratings WHERE request_id = pg_temp.r(21)))), 'validation_failed',
  'AC-8: a blank note');
SELECT is(pg_temp.err(format($q$SELECT public.admin_hide_rating(%L, 'fake', %L)$q$,
                             (SELECT id FROM public.ratings WHERE request_id = pg_temp.r(21)), repeat('n', 501))), 'validation_failed',
  'AC-8: a note over 500 characters');
SELECT is(pg_temp.err($$SELECT public.admin_hide_rating('00000000-0000-0000-0000-000000357099', 'fake', 'A note.')$$), 'not_found',
  'AC-8: an unknown rating');
SELECT ok((public.admin_hide_rating((SELECT id FROM public.ratings WHERE request_id = pg_temp.r(21)), 'pressure',
                                    '  The customer says the provider made them do it.  ')) ? 'hidden_at',
  'AC-8: admin hides with a reason and a note');
SELECT results_eq(
  $$ SELECT h.region::text, h.reason::text, h.note::text, h.hidden_by FROM public.rating_hides h
       JOIN public.ratings r ON r.id = h.rating_id WHERE r.request_id = pg_temp.r(21) $$,
  $$ VALUES ('TR'::text, 'pressure'::text, 'The customer says the provider made them do it.'::text, pg_temp.u('ad')) $$,
  'AC-8: one hide row, the region copied from the rating, the note trimmed');
SELECT results_eq(
  $$ SELECT actor_id, entity_type::text, region::text, new_value
       FROM public.audit_log WHERE action = 'rating.hidden'
        AND entity_id = (SELECT id::text FROM public.ratings WHERE request_id = pg_temp.r(21)) $$,
  $$ VALUES (pg_temp.u('ad'), 'ratings'::text, 'TR'::text,
             '{"reason": "pressure", "note": "The customer says the provider made them do it."}'::jsonb) $$,
  'AC-8: one audit row with the reason and the note');
SELECT is((SELECT count(*)::int FROM public.outbox_events o
            WHERE o.idempotency_key LIKE 'email:' || (SELECT id FROM public.audit_log WHERE action = 'rating.hidden'
                                                        AND entity_id = (SELECT id::text FROM public.ratings WHERE request_id = pg_temp.r(21))) || ':%'),
  0, 'AC-8: no mail hangs on a hide');
SELECT is(pg_temp.err(format($q$SELECT public.admin_hide_rating(%L, 'fake', 'Again.')$q$,
                             (SELECT id FROM public.ratings WHERE request_id = pg_temp.r(21)))), 'already_hidden',
  'AC-8: a hide is final; a second refuses');
SELECT is((pg_temp.sum('a6') ->> 'count')::int, 5, 'AC-4: hiding lowers the count at once');
SELECT ok((pg_temp.sum('a6') ->> 'overall')::numeric > ((SELECT s FROM a6_before) ->> 'overall')::numeric,
  'AC-4: and changes the figures at once (the 1 no longer counts)');
SELECT results_eq(
  $$ SELECT r ->> 'request_id', r -> 'hide' ->> 'reason', r -> 'hide' ->> 'hidden_by_name', r -> 'hide' ? 'hidden_at', r -> 'hide' ? 'note'
       FROM jsonb_array_elements(public.admin_provider_ratings(pg_temp.u('a6'), 1) -> 'rows') r
      WHERE r -> 'hide' <> 'null'::jsonb $$,
  $$ VALUES (pg_temp.r(21)::text, 'pressure'::text, 'Puan Yönetici'::text, true, true) $$,
  'AC-8: the list shows the hide with the admin''s name');
SELECT is(jsonb_array_length(public.admin_provider_ratings(pg_temp.u('a6'), 1) -> 'rows'), 6,
  'AC-8: a hidden rating stays in admin''s list');
SELECT ok(public.admin_hide_rating((SELECT id FROM public.ratings WHERE request_id = pg_temp.r(16)), 'customer_asked',
                                   'The customer asked us to.') ? 'hidden_at', 'AC-8: another hide');
SELECT is(pg_temp.sum('a6'), '{"state": "new", "count": 4}'::jsonb, 'AC-4: hiding the fifth sends the provider back to New');
-- AC-2 again, now that hide rows exist (a row trigger fires only on a row).
SELECT is(pg_temp.try_write('update', 'rating_hides'), 'rating_append_only', 'AC-2: a hide is never updated, even as postgres');
SELECT is(pg_temp.try_write('delete', 'rating_hides'), 'rating_append_only', 'AC-2: nor deleted (no unhide)');

-- ══ AC-9: mail ═══════════════════════════════════════════════════════════════
SELECT is(pg_temp.mails(30), 'rating_received>a1', 'AC-9: rating.created mails the provider');
SELECT results_eq(
  $$ SELECT o.payload ->> 'entity_id', (o.payload ->> 'send_until')::timestamptz > now() FROM public.outbox_events o
      WHERE o.id = pg_temp.mail_id(30, 'rating_received') $$,
  $$ VALUES (pg_temp.app(30)::text, true) $$,
  'AC-9: entity the application, sent at once');
SELECT results_eq(
  $$ SELECT x ->> 'status', x ->> 'template', x -> 'values' ->> 'side', x -> 'values' -> 'request_id' = 'null'::jsonb,
            x -> 'values' -> 'service' = 'null'::jsonb, x -> 'values' -> 'start_at' = 'null'::jsonb
       FROM (SELECT public.email_context(pg_temp.mail_id(30, 'rating_received')) AS x) t $$,
  $$ VALUES ('send'::text, 'rating_received'::text, 'provider'::text, true, true, true) $$,
  'AC-9: the relay sends it, with nothing that names the rated job (security review M-1)');
SELECT pg_temp.as_user('c1');
SELECT is(pg_temp.probe(ARRAY[format($q$INSERT INTO public.notification_preferences (user_id, topic, region, email_enabled) VALUES (%L, 'ratings', 'TR', false)$q$, pg_temp.u('a1')),
                              format($q$SELECT public.rate_provider(%L, 5, 5, 5, 5)$q$, pg_temp.r(37))],
                        $q$pg_temp.mails(37)$q$),
  '', 'AC-9: rating_received follows the ratings topic');

SELECT pg_temp.job(40, 'a1', 'AWAITING_CONFIRMATION', NULL);
SELECT pg_temp.job(41, 'a1', 'AWAITING_CONFIRMATION', NULL);
SELECT pg_temp.job(42, 'a1', 'AWAITING_CONFIRMATION', NULL);
SELECT pg_temp.job(43, 'a1', 'AWAITING_CONFIRMATION', NULL);
SELECT public.close_job(pg_temp.r(40), 'auto', 'job.auto_closed');
SELECT public.close_job(pg_temp.r(41), 'admin', 'job.closed_by_admin');
SELECT public.close_job(pg_temp.r(42), 'customer', 'job.confirmed');
SELECT public.close_job(pg_temp.r(43), 'customer', 'job.customer_closed');
SELECT is(pg_temp.mails(40), 'job_completed>a1,rate_provider>c1', 'AC-9: an auto close invites the customer to rate');
SELECT is(pg_temp.mails(41), 'job_completed>a1,rate_provider>c1', 'AC-9: so does an admin close');
SELECT is(pg_temp.mails(42), 'job_completed>a1', 'AC-9: a Confirm does not (the customer sees the form already)');
SELECT is(pg_temp.mails(43), 'job_completed>a1', 'AC-9: nor a customer close');
SELECT results_eq(
  $$ SELECT o.payload ->> 'entity_id', (o.payload ->> 'send_until')::timestamptz = now() + interval '336 hours'
       FROM public.outbox_events o WHERE o.id = pg_temp.mail_id(40, 'rate_provider') $$,
  $$ VALUES (pg_temp.app(40)::text, true) $$,
  'AC-9: entity the application, send_until the window''s end');
SELECT is(pg_temp.probe(ARRAY[format($q$INSERT INTO public.notification_preferences (user_id, topic, region, email_enabled) VALUES (%L, 'ratings', 'TR', false)$q$, pg_temp.u('c1')),
                              format($q$SELECT public.close_job(%L, 'auto', 'job.auto_closed')$q$, pg_temp.r(32))],
                        $q$pg_temp.mails(32)$q$),
  'job_completed>a1', 'AC-9: rate_provider follows the ratings topic');
SELECT results_eq(
  $$ SELECT x ->> 'status', x ->> 'template', x -> 'values' ->> 'side', x -> 'values' ->> 'provider_name',
            (x -> 'values' ->> 'deadline')::timestamptz = now() + interval '336 hours'
       FROM (SELECT public.email_context(pg_temp.mail_id(40, 'rate_provider')) AS x) t $$,
  $$ VALUES ('send'::text, 'rate_provider'::text, 'customer'::text, 'Ayşe Y.'::text, true) $$,
  'AC-9: sent while unrated, with the provider''s display name and the window''s end');
SELECT is(pg_temp.probe(ARRAY[$q$UPDATE public.platform_settings SET value = '1' WHERE region = 'TR' AND key = 'rating_window_days'$q$,
                              $q$ALTER TABLE public.requests DISABLE TRIGGER requests_guard$q$,
                              format($q$UPDATE public.requests SET closed_at = now() - interval '2 days' WHERE id = %L$q$, pg_temp.r(40))],
                        format($q$public.email_context(%L) ->> 'reason'$q$, pg_temp.mail_id(40, 'rate_provider'))),
  'condition', 'AC-9: the window is recomputed from the current setting at send time');
-- D4 (slice review 2026-11-22): a broken rating setting never blocks a close or its other mail, and a queued invite
-- is skipped, never raised.
SELECT is(pg_temp.probe(ARRAY[$q$ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard$q$,
                              $q$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'rating_window_days'$q$,
                              format($q$SELECT public.close_job(%L, 'auto', 'job.auto_closed')$q$, pg_temp.r(32))],
                        format($q$(SELECT status FROM public.requests WHERE id = %L) || ' / ' || pg_temp.mails(32)$q$, pg_temp.r(32))),
  'COMPLETED / job_completed>a1', 'D4: with a broken rating setting, the auto close still closes and mails the provider, with no invite');
SELECT is(pg_temp.probe(ARRAY[$q$ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard$q$,
                              $q$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'rating_window_days'$q$,
                              format($q$SELECT public.close_job(%L, 'admin', 'job.closed_by_admin')$q$, pg_temp.r(31))],
                        format($q$(SELECT status FROM public.requests WHERE id = %L) || ' / ' || pg_temp.mails(31)$q$, pg_temp.r(31))),
  'COMPLETED / job_completed>a1', 'D4: and so does an admin close');
SELECT is(pg_temp.probe(ARRAY[$q$ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard$q$,
                              $q$DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'rating_window_days'$q$],
                        format($q$public.email_context(%L)$q$, pg_temp.mail_id(41, 'rate_provider'))),
  '{"reason": "condition", "status": "skip"}', 'D4: a queued invite is skipped when the setting is broken, never raised');
SELECT pg_temp.as_user('c1');
SELECT is(pg_temp.rate(40), 'none', 'AC-1: the customer of an auto closed job rates');
SELECT is(public.email_context(pg_temp.mail_id(40, 'rate_provider')),
  '{"status": "skip", "reason": "condition"}'::jsonb, 'AC-9: once rated, the invite is skipped');

-- ══ Grants and attributes ════════════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default", p.prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE'),
            has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('service_role', p.oid, 'EXECUTE')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('rate_provider', 'request_rating', 'my_provider_rating', 'admin_provider_ratings', 'admin_hide_rating',
                          'provider_rating_summary', 'rating_settings', 'rating_append_only', 'rating_consistent', 'offer_card')
      ORDER BY p.proname COLLATE "C" $$,
  $$ VALUES ('admin_hide_rating'::text, true, false, true, false), ('admin_provider_ratings', true, false, true, false),
            ('my_provider_rating', true, false, true, false), ('offer_card', false, false, false, false),
            ('provider_rating_summary', false, false, false, false), ('rate_provider', true, false, true, false),
            ('rating_append_only', false, false, false, false), ('rating_consistent', false, false, false, false),
            ('rating_settings', false, false, false, false),
            ('request_rating', true, false, true, false) $$,
  'Security model: the five doors are definers granted to authenticated only; the internals have no grant');
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default", p.provolatile::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('request_rating', 'my_provider_rating', 'admin_provider_ratings', 'provider_rating_summary')
      ORDER BY p.proname COLLATE "C" $$,
  $$ VALUES ('admin_provider_ratings'::text, 's'::text), ('my_provider_rating', 's'), ('provider_rating_summary', 's'),
            ('request_rating', 's') $$,
  'AC-6 to AC-8: the reads are stable');
SELECT results_eq(
  $$ SELECT tgname::text COLLATE "default" FROM pg_trigger
      WHERE tgrelid IN ('public.ratings'::regclass, 'public.rating_hides'::regclass) AND NOT tgisinternal
      ORDER BY tgname COLLATE "C" $$,
  $$ VALUES ('rating_hides_append_only'::text), ('rating_hides_no_truncate'), ('ratings_append_only'), ('ratings_consistent'),
            ('ratings_no_truncate') $$,
  'AC-2: the four append only triggers, and the consistency trigger');
SELECT is((SELECT count(*)::int FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name IN ('rating_avg', 'rating_count')), 0,
  'AC-4: no stored score anywhere');

SELECT * FROM finish();
ROLLBACK;
