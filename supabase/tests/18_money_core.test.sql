-- Position 07, spec 0011-07: the money core, database only.
--
-- Every money rule is proven here as the role that would call it: the fee settings and their checks, the
-- fee formula over a seeded loop, the commission floor and cap, the fee frozen on the chosen application,
-- the fee rows and their guard, the checkout attempt and its outbox row, the append only ledger and its
-- balance, the journal replay and conflict, applying a paid and a refunded PSP fact (accepted, late,
-- mismatched, replayed), the outbox lease and retry schedule, the PSP event store and its card filter,
-- the books check, who reads what, the dead 00b flags, and a seeded property test over random sequences.
-- The two session races are in 19. AC-0 to AC-15 (AC-14 races in 19), rules R-1 to R-12.
--
-- The ledger is append only, so this file never writes a ledger row except through the functions, and
-- every check that a direct write is refused goes through pg_temp.try_write, which names the table as a
-- value. Constraints run immediately here, so the balance trigger fires per statement in a test that
-- never commits.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(197);

SET CONSTRAINTS ALL IMMEDIATE;

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000001800' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000001870' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.app(p_request integer, p_provider text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-00000018' || lpad(p_request::text, 2, '0') || p_provider)::uuid $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1, c2 customers; d1 an admin; a1, a2 approved providers.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559180001'), ('c2', '905559180002'), ('d1', '905559180003'), ('a1', '905559180004'),
               ('a2', '905559180005')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'tr'
  FROM (VALUES ('c1', 'customer', '905559180001', 'Para Bir'), ('c2', 'customer', '905559180002', 'Para İki'),
               ('d1', 'admin', '905559180003', 'Admin Para'), ('a1', 'provider', '905559180004', 'Ayşe Usta'),
               ('a2', 'provider', '905559180005', 'Mehmet Usta')) AS t(c, r, p, n);
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'Usta'
 WHERE id IN (pg_temp.u('a1'), pg_temp.u('a2'));
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Para"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Bir"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Semt"}', 1.00, true);

-- A request of a customer at a price, written as create_request leaves it (10 percent, unit 100).
CREATE FUNCTION pg_temp.req(p_id uuid, p_customer text, p_price bigint) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  VALUES (p_id, 'TR', pg_temp.u(p_customer), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100}', p_price, p_price / 10, p_price - p_price / 10, 'TRY', now() + interval '3 days',
    now() + interval '3 days 2 hours')
  RETURNING id $$;
CREATE FUNCTION pg_temp.offer(p_request integer, p_provider text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  VALUES (pg_temp.app(p_request, p_provider), 'TR', pg_temp.r(p_request), pg_temp.u(p_provider),
          'An offer for the money tests, long enough.')
  RETURNING id $$;
CREATE FUNCTION pg_temp.as_user(p text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.as_service() RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true) $$;
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'none';
EXCEPTION WHEN raise_exception THEN
  RETURN sqlerrm;
END;
$$;
-- A direct write on a table named as a value, for the append only and guard checks.
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
END;
$$;
CREATE FUNCTION pg_temp.token(p_id uuid) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT claimed_at FROM public.outbox_events WHERE id = p_id $$;
CREATE FUNCTION pg_temp.fee(p_request integer, p_kind text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p_request) AND kind = p_kind $$;
GRANT EXECUTE ON FUNCTION pg_temp.u(text), pg_temp.r(integer), pg_temp.app(integer, text), pg_temp.as_user(text),
  pg_temp.as_service(), pg_temp.err(text), pg_temp.fee(integer, text), pg_temp.token(uuid) TO authenticated, service_role;

-- R1 for the frozen fee and the provider fee; R2 for refusals on choose; R3 stays OPEN; R4 for amount
-- mismatches; R5 for the commission path; R6 for a currency mismatch.
SELECT pg_temp.req(pg_temp.r(1), 'c1', 300000);
SELECT pg_temp.req(pg_temp.r(2), 'c1', 300000);
SELECT pg_temp.req(pg_temp.r(3), 'c1', 300000);
SELECT pg_temp.req(pg_temp.r(4), 'c1', 200000);
SELECT pg_temp.req(pg_temp.r(5), 'c1', 300000);
SELECT pg_temp.req(pg_temp.r(6), 'c2', 100000);
SELECT pg_temp.offer(1, 'a1');
SELECT pg_temp.offer(1, 'a2');
SELECT pg_temp.offer(2, 'a1');
SELECT pg_temp.offer(4, 'a2');
SELECT pg_temp.offer(5, 'a1');
SELECT pg_temp.offer(6, 'a2');

-- ══ AC-15: the dead 00b flags ═════════════════════════════════════════════════
SELECT is_empty(
  $$ SELECT region || ':' || key FROM public.platform_settings
      WHERE key IN ('funding_enabled', 'unlock_enabled', 'payouts_enabled', 'auto_release_enabled',
                    'late_cancel_cutoff_hours', 'hold_hours') $$,
  'AC-15: the four escrow flags, the late cancel cutoff and hold_hours are gone');
SELECT results_eq($$ SELECT region, value FROM public.platform_settings WHERE key = 'confirm_window_hours' ORDER BY region $$,
  $$ VALUES ('KSA', '72'::jsonb), ('TR', '72'::jsonb) $$, 'AC-15: hold_hours became confirm_window_hours with its value');
SELECT results_eq($$ SELECT region, value FROM public.platform_settings WHERE key = 'notifications_enabled' ORDER BY region $$,
  $$ VALUES ('KSA', 'false'::jsonb), ('TR', 'true'::jsonb) $$, 'AC-15: notifications_enabled stays');

-- ══ AC-1, R-2: the fee settings ═══════════════════════════════════════════════
SELECT results_eq(
  $$ SELECT region, key, value FROM public.platform_settings
      WHERE key IN ('provider_fee_kind', 'provider_fee_value', 'fee_min_minor') ORDER BY region, key $$,
  $$ VALUES ('KSA', 'fee_min_minor', '1000'::jsonb), ('KSA', 'provider_fee_kind', '"percent"'::jsonb),
            ('KSA', 'provider_fee_value', '5'::jsonb), ('TR', 'fee_min_minor', '1000'::jsonb),
            ('TR', 'provider_fee_kind', '"percent"'::jsonb), ('TR', 'provider_fee_value', '5'::jsonb) $$,
  'AC-1: percent, 5 and 1000 in both regions');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '"flat"' WHERE region = 'TR' AND key = 'provider_fee_kind' $$,
  '23514', NULL, 'R-2: a kind other than percent or fixed is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '5.5' WHERE region = 'TR' AND key = 'provider_fee_value' $$,
  '23514', NULL, 'R-2: a fee value must be an integer');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '"5"' WHERE region = 'TR' AND key = 'provider_fee_value' $$,
  '23514', NULL, 'R-2: a fee value must be a number');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '-1' WHERE region = 'TR' AND key = 'provider_fee_value' $$,
  '23514', NULL, 'R-2: a fee value below 0 is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '100000001' WHERE region = 'TR' AND key = 'fee_min_minor' $$,
  '23514', NULL, 'R-2: a floor above 100,000,000 is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '101' WHERE region = 'TR' AND key = 'provider_fee_value' $$,
  'P0001', 'fee_settings_invalid', 'R-2: a percent above 100 is refused across keys');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '1050' WHERE region = 'TR' AND key = 'fee_min_minor' $$,
  'P0001', 'fee_settings_invalid', 'R-2: a floor that is not a whole multiple of the unit is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '300' WHERE region = 'TR' AND key = 'price_rounding_minor' $$,
  'P0001', 'fee_settings_invalid', 'R-2: and so is a unit changed later that the floor no longer divides');
SELECT throws_ok(
  $$ UPDATE public.platform_settings SET value = CASE key WHEN 'provider_fee_kind' THEN '"fixed"'::jsonb ELSE '1550'::jsonb END
      WHERE region = 'TR' AND key IN ('provider_fee_kind', 'provider_fee_value') $$,
  'P0001', 'fee_settings_invalid', 'R-2: a fixed fee that is not a whole multiple of the unit is refused');
SELECT lives_ok(
  $$ UPDATE public.platform_settings SET value = CASE key WHEN 'provider_fee_kind' THEN '"fixed"'::jsonb ELSE '2500'::jsonb END
      WHERE region = 'KSA' AND key IN ('provider_fee_kind', 'provider_fee_value') $$,
  'R-2: a fixed fee of 2500 with a unit of 100 stands');
UPDATE public.platform_settings SET value = CASE key WHEN 'provider_fee_kind' THEN '"percent"'::jsonb ELSE '5'::jsonb END
 WHERE region = 'KSA' AND key IN ('provider_fee_kind', 'provider_fee_value');
SELECT throws_ok($$ DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'provider_fee_kind' $$,
  'P0001', 'pricing_setting_required', 'R-2: a fee setting is never deleted');
SELECT throws_ok($$ UPDATE public.platform_settings SET key = 'fee_min_gone' WHERE region = 'TR' AND key = 'fee_min_minor' $$,
  'P0001', 'pricing_setting_required', 'R-2: nor renamed');
SELECT throws_ok($$ UPDATE public.platform_settings SET region = 'KSA' WHERE region = 'TR' AND key = 'provider_fee_value' $$,
  'P0001', 'pricing_setting_required', 'R-2: nor moved to another region');

-- ══ AC-2: provider_fee_for ════════════════════════════════════════════════════
SELECT is(public.provider_fee_for('TR', 300000), 15000::bigint, 'AC-2: 5 percent of 3000 lira is 150 lira');
SELECT is(public.provider_fee_for('TR', 125000), 6300::bigint, 'AC-2: 62.5 lira rounds half up to 63');
SELECT is(public.provider_fee_for('TR', 124900), 6200::bigint, 'AC-2: 62.45 lira rounds down to 62');
SELECT is(public.provider_fee_for('TR', 10000), 1000::bigint, 'AC-2: raised to the floor of 10 lira');
SELECT is(public.provider_fee_for('TR', 850), 800::bigint, 'R-1: capped at the price rounded down to the unit');
SELECT is(public.provider_fee_for('TR', 99), 0::bigint, 'R-1: a price below the unit caps the fee at 0');
UPDATE public.platform_settings SET value = CASE key WHEN 'provider_fee_kind' THEN '"fixed"'::jsonb ELSE '2500'::jsonb END
 WHERE region = 'TR' AND key IN ('provider_fee_kind', 'provider_fee_value');
SELECT is(public.provider_fee_for('TR', 300000), 2500::bigint, 'AC-2: fixed is the value');
SELECT is(public.provider_fee_for('TR', 2000), 2000::bigint, 'R-2: a fixed fee is capped at the price too');
UPDATE public.platform_settings SET value = '500' WHERE region = 'TR' AND key = 'provider_fee_value';
SELECT is(public.provider_fee_for('TR', 300000), 1000::bigint, 'R-2: and raised to the floor');
UPDATE public.platform_settings SET value = CASE key WHEN 'provider_fee_kind' THEN '"percent"'::jsonb ELSE '5'::jsonb END
 WHERE region = 'TR' AND key IN ('provider_fee_kind', 'provider_fee_value');
SELECT throws_ok($$ SELECT public.provider_fee_for('TR', 0) $$, 'P0001', 'price_out_of_range', 'AC-2: a price of 0 is refused');
SELECT throws_ok($$ SELECT public.provider_fee_for('XX', 300000) $$, 'P0001', 'fee_settings_invalid', 'AC-1: an unknown region has no settings');
ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard;
UPDATE public.platform_settings SET key = 'fee_min_gone' WHERE region = 'TR' AND key = 'fee_min_minor';
SELECT throws_ok($$ SELECT public.provider_fee_for('TR', 300000) $$, 'P0001', 'fee_settings_invalid', 'AC-1: a missing floor refuses, never a default');
SELECT throws_ok($$ SELECT public.pricing_split('TR', 300000) $$, 'P0001', 'fee_settings_invalid', 'AC-1: and so does the split');
UPDATE public.platform_settings SET key = 'fee_min_minor' WHERE region = 'TR' AND key = 'fee_min_gone';
UPDATE public.platform_settings SET key = 'provider_fee_gone' WHERE region = 'TR' AND key = 'provider_fee_kind';
SELECT throws_ok($$ SELECT public.provider_fee_for('TR', 300000) $$, 'P0001', 'fee_settings_invalid', 'AC-1: a missing kind refuses');
UPDATE public.platform_settings SET key = 'provider_fee_kind' WHERE region = 'TR' AND key = 'provider_fee_gone';
ALTER TABLE public.platform_settings ENABLE TRIGGER pricing_settings_guard;

-- The seeded loop: 2,000 prices across six orders of magnitude, on the region's settings and on three
-- more shapes through the same core. Every fee is within the floor and the cap and a whole multiple of
-- the unit, and an uncapped percent fee above the floor equals the exact half up reference.
SELECT setseed(0.0711);
CREATE TEMP TABLE prices AS
  SELECT 1 + floor(random() * power(10, 1 + (g % 6)))::bigint AS price FROM generate_series(1, 2000) g;
GRANT SELECT ON prices TO authenticated, service_role;
CREATE TEMP TABLE shapes (kind text, value bigint, fee_min bigint, unit bigint);
GRANT SELECT ON shapes TO authenticated, service_role;
INSERT INTO shapes VALUES ('percent', 5, 1000, 100), ('percent', 13, 1500, 500), ('percent', 100, 0, 1), ('fixed', 2500, 1000, 100);
SELECT is_empty(
  $$ SELECT p.price FROM prices p
      WHERE public.provider_fee_for('TR', p.price)
            IS DISTINCT FROM public.fee_amount(p.price, public.fee_settings('TR', 100)) $$,
  'AC-2: provider_fee_for is the core on the region''s settings, for 2,000 prices');
SELECT is_empty(
  $$ SELECT s.kind, s.value, p.price, f.fee
       FROM prices p CROSS JOIN shapes s
       CROSS JOIN LATERAL (SELECT public.fee_amount(p.price, jsonb_build_object('kind', s.kind, 'value', s.value,
                                                                              'min', s.fee_min, 'unit', s.unit)) AS fee) f
      WHERE f.fee > p.price
         OR f.fee < least(s.fee_min, p.price - p.price % s.unit)
         OR f.fee % s.unit <> 0
         OR (s.kind = 'percent' AND f.fee > s.fee_min AND f.fee < p.price - p.price % s.unit
             AND f.fee <> round(p.price::numeric * s.value / 100 / s.unit) * s.unit) $$,
  'AC-2: 8,000 fees within the floor and the cap, whole units, half up');
SELECT ok(has_function_privilege('authenticated', 'public.provider_fee_for(text, bigint)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.provider_fee_for(text, bigint)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.provider_fee_for(text, bigint)', 'EXECUTE'),
  'AC-2: signed in users and the service role may ask for a fee; anon may not');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(public.provider_fee_for('TR', 300000), 15000::bigint, 'AC-2: a provider token reads the same figure');
RESET ROLE;

-- ══ AC-3, R-1: the commission floor and cap ══════════════════════════════════
SELECT is(public.pricing_split('TR', 300000) - 'commission_percent', '{"commission": 30000, "cash_due": 270000}',
  'AC-3: 10 percent above the floor is unchanged');
SELECT is(public.pricing_split('TR', 5000) - 'commission_percent', '{"commission": 1000, "cash_due": 4000}',
  'AC-3: 5 lira is raised to the 10 lira floor');
SELECT is(public.pricing_split('TR', 950) - 'commission_percent', '{"commission": 900, "cash_due": 50}',
  'R-1: below the floor, capped at the price rounded down to the unit');
SELECT is(public.pricing_split('TR', 1000) - 'commission_percent', '{"commission": 1000, "cash_due": 0}',
  'R-1: a cash due of 0 is allowed');

-- ══ AC-0, R-4: the fee frozen on the chosen application ══════════════════════
SELECT has_column('public', 'applications', 'provider_fee_amount', 'AC-0: applications.provider_fee_amount exists');
SELECT has_column('public', 'applications', 'provider_fee_kind', 'AC-0: applications.provider_fee_kind exists');
SELECT is_empty($$ SELECT id FROM public.applications WHERE status = 'SELECTED' AND provider_fee_amount IS NULL $$,
  'AC-0: every SELECTED application holds a fee (local rows back filled)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
SELECT is(public.choose_provider(pg_temp.r(1), pg_temp.app(1, 'a1')) ->> 'status', 'ok', 'AC-0: the customer chooses on R1');
RESET ROLE;
SELECT results_eq(
  $$ SELECT provider_id, status, provider_fee_amount, provider_fee_kind FROM public.applications
      WHERE request_id = pg_temp.r(1) ORDER BY provider_id $$,
  $$ VALUES (pg_temp.u('a1'), 'SELECTED', 15000::bigint, 'percent'), (pg_temp.u('a2'), 'NOT_SELECTED', NULL::bigint, NULL) $$,
  'AC-0: the chosen application holds 5 percent of the price and the kind; the other holds none');
UPDATE public.platform_settings SET value = '9' WHERE region = 'TR' AND key = 'provider_fee_value';
SELECT is((SELECT provider_fee_amount FROM public.applications WHERE id = pg_temp.app(1, 'a1')), 15000::bigint,
  'R-4: a settings change after the choose leaves the fee as it was');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
SELECT is(public.choose_provider(pg_temp.r(1), pg_temp.app(1, 'a1')) ->> 'replayed', 'true', 'R-4: the replay is unchanged');
RESET ROLE;
SELECT is((SELECT provider_fee_amount FROM public.applications WHERE id = pg_temp.app(1, 'a1')), 15000::bigint,
  'R-4: and the replay does not recompute the fee');
UPDATE public.platform_settings SET value = '5' WHERE region = 'TR' AND key = 'provider_fee_value';
SELECT throws_ok($$ UPDATE public.applications SET provider_fee_amount = 1 WHERE id = pg_temp.app(1, 'a1') $$,
  'P0001', 'application_immutable', 'R-4: the frozen fee never changes, even as postgres');
SELECT throws_ok($$ UPDATE public.applications SET provider_fee_kind = 'fixed' WHERE id = pg_temp.app(1, 'a1') $$,
  'P0001', 'application_immutable', 'R-4: nor its kind');
SELECT throws_ok($$ UPDATE public.applications SET provider_fee_amount = 1000, provider_fee_kind = 'fixed' WHERE id = pg_temp.app(2, 'a1') $$,
  'P0001', 'application_immutable', 'R-4: a fee is written only on the move APPLIED to SELECTED');
SELECT throws_ok($$ UPDATE public.applications SET status = 'SELECTED', provider_fee_amount = 1000 WHERE id = pg_temp.app(2, 'a1') $$,
  '23514', NULL, 'R-4: the amount and the kind are null together');
ALTER TABLE public.platform_settings DISABLE TRIGGER pricing_settings_guard;
UPDATE public.platform_settings SET key = 'provider_fee_gone' WHERE region = 'TR' AND key = 'provider_fee_kind';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', pg_temp.r(2), pg_temp.app(2, 'a1'))), 'fee_settings_invalid',
  'AC-0: a missing fee setting refuses the choose');
RESET ROLE;
UPDATE public.platform_settings SET key = 'provider_fee_kind' WHERE region = 'TR' AND key = 'provider_fee_gone';
ALTER TABLE public.platform_settings ENABLE TRIGGER pricing_settings_guard;
SELECT results_eq($$ SELECT r.status, a.status FROM public.requests r JOIN public.applications a ON a.request_id = r.id WHERE r.id = pg_temp.r(2) $$,
  $$ VALUES ('OPEN', 'APPLIED') $$, 'AC-0: and changes nothing');
SELECT ok((SELECT position('public.fee_settings(' in prosrc) > 0
                  AND position('public.fee_settings(' in prosrc)
                      < position('from public.applications a where a.request_id = v_req.id for update' in prosrc)
             FROM pg_proc WHERE proname = 'choose_provider'),
  'R-4: choose_provider reads the fee settings before any application lock');

-- Choose on R4, R5 and R6 for the money paths below.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
SELECT public.choose_provider(pg_temp.r(4), pg_temp.app(4, 'a2'));
SELECT public.choose_provider(pg_temp.r(5), pg_temp.app(5, 'a1'));
SELECT pg_temp.as_user('c2');
SELECT public.choose_provider(pg_temp.r(6), pg_temp.app(6, 'a2'));
RESET ROLE;

-- ══ meta: tables, region, grants (rule 7, AC-6, AC-13) ═══════════════════════
SELECT is_empty(
  $$ SELECT t FROM unnest(ARRAY['fee_payments', 'checkout_attempts', 'fee_refunds', 'ledger_journals', 'ledger_entries',
                                'outbox_events', 'psp_events']) t
      WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
                         WHERE c.table_schema = 'public' AND c.table_name = t AND c.column_name = 'region' AND c.is_nullable = 'NO') $$,
  'U-5: every money table exists with a region that is never null');
SELECT is_empty(
  $$ SELECT table_name || ' ' || grantee || ' ' || privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN ('fee_payments', 'checkout_attempts', 'fee_refunds', 'ledger_journals', 'ledger_entries',
                           'outbox_events', 'psp_events')
        AND grantee IN ('anon', 'authenticated', 'service_role') $$,
  'AC-13: no API role holds a table privilege on any money table');
SELECT results_eq(
  $$ SELECT column_name::text COLLATE "default" FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND table_name = 'fee_payments' AND grantee = 'authenticated' AND privilege_type = 'SELECT'
      ORDER BY 1 $$,
  $$ VALUES ('amount'), ('application_id'), ('created_at'), ('currency'), ('id'), ('kind'), ('paid_at'), ('payer_id'),
            ('region'), ('request_id'), ('status') $$,
  'R-9: a payer reads these fee columns only, never the PSP fee or the PSP payment id');
SELECT is_empty(
  $$ SELECT table_name || ' ' || grantee || ' ' || column_name FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND table_name IN ('checkout_attempts', 'fee_refunds', 'ledger_journals', 'ledger_entries', 'outbox_events', 'psp_events')
        AND grantee IN ('anon', 'authenticated', 'service_role')
     UNION ALL
     SELECT table_name || ' ' || grantee || ' ' || column_name FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND table_name = 'fee_payments'
        AND grantee IN ('anon', 'authenticated', 'service_role')
        AND (grantee <> 'authenticated' OR privilege_type <> 'SELECT') $$,
  'AC-13: no other column privilege on any money table');
SELECT results_eq(
  $$ SELECT p.proname::text COLLATE "default",
            has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            has_function_privilege('service_role', p.oid, 'EXECUTE'),
            has_function_privilege('anon', p.oid, 'EXECUTE')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('fee_settings', 'fee_amount', 'provider_fee_for', 'open_fee', 'start_checkout', 'enqueue_outbox',
                          'post_journal', 'accept_commission', 'accept_provider_fee', 'after_commission_paid',
                          'after_provider_fee_paid', 'apply_fee_paid', 'apply_fee_refunded', 'claim_outbox', 'finish_outbox',
                          'record_psp_event', 'psp_payload_strip', 'ledger_check')
      ORDER BY p.proname $$,
  $$ VALUES ('accept_commission', false, false, false), ('accept_provider_fee', false, false, false),
            ('after_commission_paid', false, false, false), ('after_provider_fee_paid', false, false, false),
            ('apply_fee_paid', false, true, false), ('apply_fee_refunded', false, true, false),
            ('claim_outbox', false, true, false), ('enqueue_outbox', false, false, false), ('fee_amount', false, false, false),
            ('fee_settings', false, false, false), ('finish_outbox', false, true, false), ('ledger_check', true, true, false),
            ('open_fee', false, false, false), ('post_journal', false, false, false), ('provider_fee_for', true, true, false),
            ('psp_payload_strip', false, false, false), ('record_psp_event', false, true, false),
            ('start_checkout', false, false, false) $$,
  'the API surface: who may call each money function');
SELECT is_empty(
  $$ SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('provider_fee_for', 'apply_fee_paid', 'apply_fee_refunded', 'claim_outbox', 'finish_outbox',
                          'record_psp_event', 'ledger_check')
        AND NOT p.prosecdef $$,
  'every money function with an API grant is a definer function');
SELECT ok(NOT public.accept_commission(gen_random_uuid(), gen_random_uuid())
          AND NOT public.accept_provider_fee(gen_random_uuid(), gen_random_uuid()),
  'R-6: neither accept check accepts an unknown fee');

-- ══ AC-4, R-7: fee rows ═══════════════════════════════════════════════════════
SELECT is(pg_temp.err(format('SELECT public.open_fee(%L, %L)', pg_temp.r(3), 'commission')), 'invalid_state',
  'R-7: no commission row on an OPEN request');
SELECT is(pg_temp.err(format('SELECT public.open_fee(%L, %L)', pg_temp.r(1), 'provider_fee')), 'invalid_state',
  'R-7: no provider fee row before COMMISSION_PAID');
SELECT is(pg_temp.err(format('SELECT public.open_fee(%L, %L)', gen_random_uuid(), 'commission')), 'not_found',
  'AC-4: an unknown request');
SELECT is(pg_temp.err(format('SELECT public.open_fee(%L, %L)', pg_temp.r(1), 'tip')), 'validation_failed',
  'AC-4: an unknown kind');
CREATE TEMP TABLE f5 AS SELECT public.open_fee(pg_temp.r(5), 'commission') AS id;
GRANT SELECT ON f5 TO authenticated, service_role;
SELECT results_eq(
  $$ SELECT kind, payer_id, provider_id, application_id, amount, currency, status, region FROM public.fee_payments WHERE id = (SELECT id FROM f5) $$,
  $$ VALUES ('commission', pg_temp.u('c1'), NULL::uuid, NULL::uuid, 30000::bigint, 'TRY', 'pending', 'TR') $$,
  'AC-4: the commission row: the customer pays the stored commission, in the request''s currency, pending');
SELECT is(public.open_fee(pg_temp.r(5), 'commission'), (SELECT id FROM f5), 'AC-4: opening it again returns the same row');
SELECT is((SELECT count(*)::int FROM public.fee_payments WHERE request_id = pg_temp.r(5)), 1, 'AC-4: and writes nothing');
SELECT public.open_fee(pg_temp.r(4), 'commission');
SELECT public.open_fee(pg_temp.r(6), 'commission');
SELECT public.open_fee(pg_temp.r(1), 'commission');
-- R1 to COMMISSION_PAID by hand: 09 owns that move, so the guard is lifted inside this test only.
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
UPDATE public.requests SET status = 'COMMISSION_PAID' WHERE id = pg_temp.r(1);
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
CREATE TEMP TABLE pf1 AS SELECT public.open_fee(pg_temp.r(1), 'provider_fee') AS id;
GRANT SELECT ON pf1 TO authenticated, service_role;
SELECT results_eq(
  $$ SELECT kind, payer_id, provider_id, application_id, amount FROM public.fee_payments WHERE id = (SELECT id FROM pf1) $$,
  $$ VALUES ('provider_fee', pg_temp.u('a1'), pg_temp.u('a1'), pg_temp.app(1, 'a1'), 15000::bigint) $$,
  'AC-4: the provider fee row: the chosen provider pays the frozen fee of the selected application');
SELECT is(public.open_fee(pg_temp.r(1), 'provider_fee'), pg_temp.fee(1, 'provider_fee'), 'AC-4: opening it again returns the same row');
SELECT throws_ok(
  $$ INSERT INTO public.fee_payments (region, request_id, kind, payer_id, amount, currency) VALUES ('TR', pg_temp.r(5), 'commission', pg_temp.u('c1'), 30000, 'TRY') $$,
  '23505', NULL, 'R-7: one commission per request, even as postgres');
SELECT throws_ok(
  $$ INSERT INTO public.fee_payments (region, request_id, kind, payer_id, application_id, amount, currency)
     VALUES ('TR', pg_temp.r(4), 'commission', pg_temp.u('c1'), pg_temp.app(4, 'a2'), 20000, 'TRY') $$,
  '23514', NULL, 'R-7: a commission never names an application');
SELECT throws_ok(
  $$ INSERT INTO public.fee_payments (region, request_id, kind, payer_id, provider_id, amount, currency)
     VALUES ('TR', pg_temp.r(4), 'provider_fee', pg_temp.u('a2'), pg_temp.u('a2'), 1000, 'TRY') $$,
  '23514', NULL, 'R-7: a provider fee always names its application');
SELECT throws_ok($$ UPDATE public.fee_payments SET amount = 1 WHERE id = (SELECT id FROM f5) $$,
  'P0001', 'fee_immutable', 'R-7: the amount never changes, even as postgres');
SELECT throws_ok($$ UPDATE public.fee_payments SET payer_id = pg_temp.u('c2') WHERE id = (SELECT id FROM f5) $$,
  'P0001', 'fee_immutable', 'R-7: nor the payer');
SELECT throws_ok($$ UPDATE public.fee_payments SET status = 'refunded', psp_payment_id = 'x', paid_at = now(), psp_fee_amount = 0 WHERE id = (SELECT id FROM f5) $$,
  'P0001', 'fee_immutable', 'R-7: pending never moves straight to refunded');
SELECT throws_ok($$ UPDATE public.fee_payments SET status = 'paid' WHERE id = (SELECT id FROM f5) $$,
  '23514', NULL, 'R-7: a paid row needs its PSP payment id and paid time');
SELECT is(pg_temp.try_write('delete', 'fee_payments'), 'fee_immutable', 'R-7: a fee row is never deleted');
SELECT is(pg_temp.try_write('truncate', 'fee_payments'), 'fee_immutable', 'R-7: nor truncated');

-- ══ AC-5: checkout attempts ══════════════════════════════════════════════════
CREATE TEMP TABLE at5 AS SELECT public.start_checkout((SELECT id FROM f5), 'tr', NULL) AS id;
GRANT SELECT ON at5 TO authenticated, service_role;
SELECT results_eq(
  $$ SELECT a.fee_payment_id, a.status, a.region, o.kind, o.status, o.payload, o.attempts
       FROM public.checkout_attempts a JOIN public.outbox_events o ON o.idempotency_key = 'checkout:' || a.id || ':init'
      WHERE a.id = (SELECT id FROM at5) $$,
  $$ VALUES ((SELECT id FROM f5), 'queued', 'TR', 'checkout.initialize', 'pending',
             jsonb_build_object('attempt_id', (SELECT id FROM at5), 'fee_payment_id', (SELECT id FROM f5)), 0) $$,
  'AC-5: a queued attempt and its outbox row, keyed by the attempt, in one call');
SELECT is(pg_temp.err(format('SELECT public.start_checkout(%L, ''tr'', NULL)', gen_random_uuid())), 'not_found', 'AC-5: an unknown fee');
SELECT public.start_checkout(pg_temp.fee(4, 'commission'), 'tr', NULL);
SELECT public.start_checkout(pg_temp.fee(6, 'commission'), 'tr', NULL);
SELECT public.start_checkout(pg_temp.fee(1, 'provider_fee'), 'tr', NULL);
CREATE FUNCTION pg_temp.att(p_fee uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.checkout_attempts WHERE fee_payment_id = p_fee ORDER BY started_at, id LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.att(uuid) TO service_role;

-- ══ AC-6, AC-7: the ledger and post_journal ══════════════════════════════════
CREATE TEMP TABLE j1 AS SELECT public.post_journal('late_received', 'late:test-j1:received', 'TRY', 'TR',
  '[{"account": "psp_clearing", "amount": 9700}, {"account": "psp_fees", "amount": 300}, {"account": "refunds_due", "amount": -10000}]',
  NULL, '{"status": "test"}') AS j;
GRANT SELECT ON j1 TO authenticated, service_role;
SELECT is((SELECT j - 'journal_id' FROM j1), '{"status": "test"}', 'AC-7: the stored response comes back, with the journal id');
SELECT results_eq(
  $$ SELECT account, amount, region, currency FROM public.ledger_entries WHERE journal_id = (SELECT (j ->> 'journal_id')::uuid FROM j1) ORDER BY account $$,
  $$ VALUES ('psp_clearing', 9700::bigint, 'TR', 'TRY'), ('psp_fees', 300::bigint, 'TR', 'TRY'), ('refunds_due', -10000::bigint, 'TR', 'TRY') $$,
  'AC-6: three legs, in the journal''s region and currency');
SELECT is(public.post_journal('late_received', 'late:test-j1:received', 'TRY', 'TR',
  '[{"account": "refunds_due", "amount": -10000}, {"account": "psp_fees", "amount": 300}, {"account": "psp_clearing", "amount": 9700}]',
  NULL, '{"status": "other"}'), (SELECT j FROM j1), 'AC-7: the same key and legs in another order replay the stored response');
SELECT is((SELECT count(*)::int FROM public.ledger_entries WHERE journal_id = (SELECT (j ->> 'journal_id')::uuid FROM j1)), 3,
  'AC-7: and insert nothing');
SELECT is(pg_temp.err($$ SELECT public.post_journal('late_received', 'late:test-j1:received', 'TRY', 'TR',
  '[{"account": "psp_clearing", "amount": 10000}, {"account": "refunds_due", "amount": -10000}]', NULL, '{}') $$),
  'idempotency_conflict', 'AC-7: the same key with other legs is a conflict');
SELECT is(pg_temp.err($$ SELECT public.post_journal('late_received', 'late:test-j2:received', 'TRY', 'TR',
  '[{"account": "psp_clearing", "amount": 10000}, {"account": "refunds_due", "amount": -9000}]', NULL, '{}') $$),
  'journal_invalid', 'AC-6: legs that do not sum to zero are refused');
SELECT is(pg_temp.err($$ SELECT public.post_journal('late_received', 'late:test-j3:received', 'TRY', 'TR',
  '[{"account": "cash", "amount": 10000}, {"account": "refunds_due", "amount": -10000}]', NULL, '{}') $$),
  'journal_invalid', 'AC-6: an account outside the chart is refused');
SELECT is(pg_temp.err($$ SELECT public.post_journal('late_received', 'late:test-j4:received', 'TRY', 'TR',
  '[{"account": "psp_clearing", "amount": 0}, {"account": "refunds_due", "amount": 0}]', NULL, '{}') $$),
  'journal_invalid', 'AC-6: a leg of 0 is refused');
SELECT is(pg_temp.err($$ SELECT public.post_journal('late_received', 'late:test-j5:received', 'TRY', 'TR',
  '[{"account": "psp_clearing", "amount": 1.5}, {"account": "refunds_due", "amount": -1.5}]', NULL, '{}') $$),
  'journal_invalid', 'AC-6: a fractional leg is refused (rule 4)');
SELECT throws_ok(
  $$ WITH j AS (INSERT INTO public.ledger_journals (region, kind, currency, idempotency_key, legs, response)
                VALUES ('TR', 'late_received', 'TRY', 'late:test-direct:received', '[]', '{}') RETURNING id, region, currency)
     INSERT INTO public.ledger_entries (journal_id, region, currency, account, amount)
     SELECT id, region, currency, 'psp_clearing', 500 FROM j $$,
  'P0001', 'ledger_unbalanced', 'AC-6: a journal whose entries do not balance is refused, even as postgres');
SELECT throws_ok(
  $$ INSERT INTO public.ledger_journals (region, kind, currency, idempotency_key, legs, response)
     VALUES ('TR', 'late_received', 'TRY', 'late:test-empty:received', '[]', '{}') $$,
  'P0001', 'ledger_unbalanced', 'AC-6: a journal with fewer than two entries is refused');
SELECT throws_ok(
  $$ WITH j AS (INSERT INTO public.ledger_journals (region, kind, currency, idempotency_key, legs, response)
                VALUES ('TR', 'late_received', 'TRY', 'late:test-sar:received', '[]', '{}') RETURNING id, region)
     INSERT INTO public.ledger_entries (journal_id, region, currency, account, amount)
     SELECT id, region, 'SAR', a, m FROM j, (VALUES ('psp_clearing', 500), ('refunds_due', -500)) v(a, m) $$,
  '23503', NULL, 'R-8: an entry in another currency than its journal is refused');
SELECT is(pg_temp.try_write('update', 'ledger_entries'), 'ledger_append_only', 'AC-6, rule 5: a ledger entry is never updated, even as postgres');
SELECT is(pg_temp.try_write('delete', 'ledger_entries'), 'ledger_append_only', 'AC-6, rule 5: nor deleted');
SELECT is(pg_temp.try_write('truncate', 'ledger_entries'), 'ledger_append_only', 'AC-6, rule 5: nor truncated');
SELECT is(pg_temp.try_write('update', 'ledger_journals'), 'ledger_append_only', 'AC-6, rule 5: a journal is never updated');
SELECT is(pg_temp.try_write('delete', 'ledger_journals'), 'ledger_append_only', 'AC-6, rule 5: nor deleted');

-- ══ AC-8: apply_fee_paid ═════════════════════════════════════════════════════
-- A payment after the window goes the late path (09's accept check, spec 0011-09 AC-5): R5's payment window
-- is moved into the past here, with the request guard lifted inside this test only, so the attempt started
-- after the deadline.
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
UPDATE public.requests SET selected_at = now() - interval '2 days', payment_deadline = now() - interval '1 day'
 WHERE id = pg_temp.r(5);
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE p1 AS SELECT public.apply_fee_paid((SELECT id FROM f5), (SELECT id FROM at5), 'pay-18-p1', 30000, 'TRY', 900) AS j;
GRANT SELECT ON p1 TO authenticated, service_role;
RESET ROLE;
SELECT is((SELECT j - 'journal_id' - 'fee_refund_id' FROM p1),
  jsonb_build_object('status', 'late', 'fee_payment_id', (SELECT id FROM f5), 'attempt_id', (SELECT id FROM at5),
                     'psp_payment_id', 'pay-18-p1', 'amount', 30000, 'currency', 'TRY', 'psp_fee', 900,
                     'alerts', '["late_payment_refunded"]'::jsonb, 'replayed', false),
  'AC-8, R-6: not accepted (after the window): late, with the alert');
SELECT results_eq($$ SELECT status, psp_payment_id FROM public.fee_payments WHERE id = (SELECT id FROM f5) $$,
  $$ VALUES ('pending', NULL::text) $$, 'AC-8: the fee stays as it was');
SELECT results_eq(
  $$ SELECT r.kind, r.request_id, r.fee_payment_id, r.amount, r.currency, r.status, r.reason, o.kind, o.payload
       FROM public.fee_refunds r JOIN public.outbox_events o ON o.idempotency_key = 'refund:' || r.id
      WHERE r.psp_payment_id = 'pay-18-p1' $$,
  $$ VALUES ('late', pg_temp.r(5), NULL::uuid, 30000::bigint, 'TRY', 'queued', 'late_payment', 'refund.request',
             jsonb_build_object('fee_refund_id', (SELECT (j ->> 'fee_refund_id')::uuid FROM p1), 'psp_payment_id', 'pay-18-p1',
                                'amount', 30000, 'currency', 'TRY')) $$,
  'AC-8: a late refund row and its outbox refund.request');
SELECT results_eq(
  $$ SELECT j.kind, j.idempotency_key, j.fee_payment_id, e.account, e.amount
       FROM public.ledger_journals j JOIN public.ledger_entries e ON e.journal_id = j.id
      WHERE j.id = (SELECT (j ->> 'journal_id')::uuid FROM p1) ORDER BY e.account $$,
  $$ VALUES ('late_received', 'late:pay-18-p1:received', NULL::uuid, 'psp_clearing', 29100::bigint),
            ('late_received', 'late:pay-18-p1:received', NULL::uuid, 'psp_fees', 900::bigint),
            ('late_received', 'late:pay-18-p1:received', NULL::uuid, 'refunds_due', -30000::bigint) $$,
  'AC-8, R-8: posted to refunds_due, never revenue, with no fee on the journal');
SET LOCAL ROLE service_role;
SELECT is(public.apply_fee_paid((SELECT id FROM f5), (SELECT id FROM at5), 'pay-18-p1', 30000, 'TRY', 900),
  (SELECT j || '{"replayed": true}' FROM p1), 'AC-8: the same PSP payment again returns the stored result');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.fee_refunds WHERE psp_payment_id = 'pay-18-p1'), 1, 'AC-8: and writes nothing');

-- Accept a pending fee on a SELECTED request, as 09 will, inside this test only.
CREATE OR REPLACE FUNCTION public.accept_commission(p_fee uuid, p_attempt uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.fee_payments f JOIN public.requests r ON r.id = f.request_id
                  WHERE f.id = p_fee AND f.status = 'pending' AND r.status = 'SELECTED') $$;
CREATE OR REPLACE FUNCTION public.accept_provider_fee(p_fee uuid, p_attempt uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.fee_payments f JOIN public.requests r ON r.id = f.request_id
                  WHERE f.id = p_fee AND f.status = 'pending' AND r.status = 'COMMISSION_PAID') $$;
REVOKE ALL ON FUNCTION public.accept_commission(uuid, uuid), public.accept_provider_fee(uuid, uuid) FROM public, anon, authenticated, service_role;
-- 07's no op transition for the provider fee, inside this test only: 10 fills it (supabase/tests/23 proves the
-- move); these cases prove the posting, on fixtures that do not hold a full pick.
CREATE OR REPLACE FUNCTION public.after_provider_fee_paid(p_fee uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$ BEGIN NULL; END $$;
REVOKE ALL ON FUNCTION public.after_provider_fee_paid(uuid) FROM public, anon, authenticated, service_role;

SET LOCAL ROLE service_role;
CREATE TEMP TABLE p2 AS SELECT public.apply_fee_paid((SELECT id FROM f5), (SELECT id FROM at5), 'pay-18-p2', 30000, 'TRY', 900) AS j;
GRANT SELECT ON p2 TO authenticated, service_role;
RESET ROLE;
SELECT is((SELECT j - 'journal_id' FROM p2),
  jsonb_build_object('status', 'paid', 'fee_payment_id', (SELECT id FROM f5), 'attempt_id', (SELECT id FROM at5),
                     'psp_payment_id', 'pay-18-p2', 'amount', 30000, 'currency', 'TRY', 'psp_fee', 900,
                     'alerts', '[]'::jsonb, 'replayed', false),
  'AC-8: accepted: paid');
SELECT results_eq(
  $$ SELECT f.status, f.psp_payment_id, f.psp_fee_amount, f.paid_at = now(), a.status, a.finished_at = now()
       FROM public.fee_payments f JOIN public.checkout_attempts a ON a.fee_payment_id = f.id WHERE f.id = (SELECT id FROM f5) $$,
  $$ VALUES ('paid', 'pay-18-p2', 900::bigint, true, 'succeeded', true) $$,
  'AC-8: the fee paid with its PSP payment and PSP fee, the attempt succeeded');
SELECT results_eq(
  $$ SELECT j.kind, j.idempotency_key, j.fee_payment_id, e.account, e.amount
       FROM public.ledger_journals j JOIN public.ledger_entries e ON e.journal_id = j.id
      WHERE j.id = (SELECT (j ->> 'journal_id')::uuid FROM p2) ORDER BY e.account $$,
  $$ VALUES ('fee_paid', 'fee:' || (SELECT id FROM f5) || ':paid', (SELECT id FROM f5), 'commission_revenue', -30000::bigint),
            ('fee_paid', 'fee:' || (SELECT id FROM f5) || ':paid', (SELECT id FROM f5), 'psp_clearing', 29100::bigint),
            ('fee_paid', 'fee:' || (SELECT id FROM f5) || ':paid', (SELECT id FROM f5), 'psp_fees', 900::bigint) $$,
  'AC-8: the paid journal: clearing A - F, PSP fees F, commission revenue -A');
SELECT ok(EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'fee.paid' AND entity_id = (SELECT id FROM f5)::text
                     AND new_value = jsonb_build_object('fee_payment_id', (SELECT id FROM f5), 'attempt_id', (SELECT id FROM at5),
                                                        'journal_id', (SELECT (j ->> 'journal_id')::uuid FROM p2), 'fee_refund_id', NULL)),
  'R-3: one audit row with ids only');
SET LOCAL ROLE service_role;
SELECT is(public.apply_fee_paid((SELECT id FROM f5), (SELECT id FROM at5), 'pay-18-p2', 30000, 'TRY', 900),
  (SELECT j || '{"replayed": true}' FROM p2), 'AC-8: a replay of the paid fact returns the stored result');
SELECT is(pg_temp.err(format('SELECT public.apply_fee_paid(%L, %L, %L, 30000, %L, 900)', (SELECT id FROM f5), (SELECT id FROM at5), 'pay-18-p2', 'SAR')),
  'idempotency_conflict', 'AC-8: a replay with other figures is a conflict');
SELECT is(pg_temp.err(format('SELECT public.apply_fee_paid(%L, %L, %L, 20000, %L, 0)', pg_temp.fee(4, 'commission'), pg_temp.att(pg_temp.fee(4, 'commission')), 'pay-18-p2', 'TRY')),
  'idempotency_conflict', 'AC-8: a PSP payment already applied to another fee is a conflict');
CREATE TEMP TABLE p3 AS SELECT public.apply_fee_paid((SELECT id FROM f5), (SELECT id FROM at5), 'pay-18-p3', 30000, 'TRY', 900) AS j;
GRANT SELECT ON p3 TO authenticated, service_role;
RESET ROLE;
SELECT is((SELECT j ->> 'status' FROM p3) || ' ' || (SELECT j ->> 'alerts' FROM p3), 'late ["late_payment_refunded"]',
  'AC-8: a second payment for a paid fee goes late');
SELECT is((SELECT count(*)::int FROM public.ledger_journals WHERE fee_payment_id = (SELECT id FROM f5) AND kind = 'fee_paid'), 1,
  'AC-8: and the fee keeps one paid journal');
SET LOCAL ROLE service_role;
CREATE TEMP TABLE p4 AS SELECT public.apply_fee_paid(pg_temp.fee(4, 'commission'), pg_temp.att(pg_temp.fee(4, 'commission')), 'pay-18-p4', 19900, 'TRY', 500) AS j;
GRANT SELECT ON p4 TO authenticated, service_role;
CREATE TEMP TABLE p6 AS SELECT public.apply_fee_paid(pg_temp.fee(6, 'commission'), pg_temp.att(pg_temp.fee(6, 'commission')), 'pay-18-p6', 10000, 'SAR', 300) AS j;
GRANT SELECT ON p6 TO authenticated, service_role;
RESET ROLE;
SELECT results_eq(
  $$ SELECT x.j ->> 'status', x.j -> 'alerts', r.reason, f.status
       FROM (SELECT j FROM p4 UNION ALL SELECT j FROM p6) x
       JOIN public.fee_refunds r ON r.id = (x.j ->> 'fee_refund_id')::uuid
       JOIN public.fee_payments f ON f.id = (x.j ->> 'fee_payment_id')::uuid
      ORDER BY x.j ->> 'psp_payment_id' $$,
  $$ VALUES ('late', '["reconcile_mismatch"]'::jsonb, 'payment_mismatch', 'pending'),
            ('late', '["reconcile_mismatch"]'::jsonb, 'payment_mismatch', 'pending') $$,
  'AC-8: an amount or a currency that differs from the fee goes late with reconcile_mismatch; the fee stays pending');
SELECT is((SELECT jsonb_agg(e.account || ' ' || e.currency || ' ' || e.amount ORDER BY e.account)
             FROM public.ledger_entries e WHERE e.journal_id = (SELECT (j ->> 'journal_id')::uuid FROM p6)),
  '["psp_clearing SAR 9700", "psp_fees SAR 300", "refunds_due SAR -10000"]', 'AC-8: the money is booked in the currency it came in');
SET LOCAL ROLE service_role;
CREATE TEMP TABLE p7 AS SELECT public.apply_fee_paid(pg_temp.fee(1, 'provider_fee'), pg_temp.att(pg_temp.fee(1, 'provider_fee')), 'pay-18-p7', 15000, 'TRY', NULL) AS j;
GRANT SELECT ON p7 TO authenticated, service_role;
RESET ROLE;
SELECT is((SELECT jsonb_build_object('status', j ->> 'status', 'psp_fee', j -> 'psp_fee', 'alerts', j -> 'alerts') FROM p7),
  '{"status": "paid", "psp_fee": 0, "alerts": ["reconcile_mismatch"]}', 'AC-8: a missing PSP fee is posted as 0 and alerted');
SELECT is((SELECT jsonb_agg(e.account || ' ' || e.amount ORDER BY e.account) FROM public.ledger_entries e
            WHERE e.journal_id = (SELECT (j ->> 'journal_id')::uuid FROM p7)),
  '["provider_fee_revenue -15000", "psp_clearing 15000"]', 'AC-8: two legs, the provider fee revenue account');
SELECT is((SELECT psp_fee_amount FROM public.fee_payments WHERE id = pg_temp.fee(1, 'provider_fee')), 0::bigint, 'AC-8: stored as 0');
SET LOCAL ROLE service_role;
SELECT is((public.apply_fee_paid(pg_temp.fee(4, 'commission'), pg_temp.att(pg_temp.fee(4, 'commission')), 'pay-18-p8', 20000, 'TRY', 20001)) -> 'alerts',
  '["reconcile_mismatch"]', 'R-8: a PSP fee above the amount is treated as missing');
RESET ROLE;
SELECT is((SELECT psp_fee_amount FROM public.fee_payments WHERE id = pg_temp.fee(4, 'commission')), 0::bigint, 'R-8: and posted as 0');
SET LOCAL ROLE service_role;
SELECT is(pg_temp.err(format('SELECT public.apply_fee_paid(%L, %L, %L, 10000, %L, 0)', pg_temp.fee(6, 'commission'), (SELECT id FROM at5), 'pay-18-p9', 'TRY')),
  'not_found', 'R-5: an attempt of another fee is refused');
SELECT is(pg_temp.err(format('SELECT public.apply_fee_paid(%L, %L, %L, 10000, %L, 0)', gen_random_uuid(), (SELECT id FROM at5), 'pay-18-p9', 'TRY')),
  'not_found', 'AC-8: an unknown fee');
SELECT is(pg_temp.err(format('SELECT public.apply_fee_paid(%L, %L, %L, 0, %L, 0)', pg_temp.fee(6, 'commission'), pg_temp.att(pg_temp.fee(6, 'commission')), 'pay-18-p9', 'TRY')),
  'validation_failed', 'AC-8: an amount of 0');
SELECT is(pg_temp.err(format('SELECT public.apply_fee_paid(%L, %L, %L, 10000, %L, 0)', pg_temp.fee(6, 'commission'), pg_temp.att(pg_temp.fee(6, 'commission')), 'pay-18-p9', 'USD')),
  'validation_failed', 'AC-8: a currency outside the regions');
SELECT is(pg_temp.err(format('SELECT public.apply_fee_paid(%L, %L, %L, 10000, %L, 0)', pg_temp.fee(6, 'commission'), pg_temp.att(pg_temp.fee(6, 'commission')), '', 'TRY')),
  'validation_failed', 'AC-8: an empty PSP payment id');
RESET ROLE;
SELECT is((SELECT status FROM public.fee_payments WHERE id = pg_temp.fee(6, 'commission')), 'pending', 'AC-8: no refusal changed the fee');
SELECT is(pg_temp.err(format('SELECT public.start_checkout(%L, ''tr'', NULL)', (SELECT id FROM f5))), 'invalid_state', 'AC-5: a paid fee opens no new attempt');

-- ══ AC-9: apply_fee_refunded ═════════════════════════════════════════════════
SET LOCAL ROLE service_role;
CREATE TEMP TABLE rf1 AS SELECT public.apply_fee_refunded((SELECT (j ->> 'fee_refund_id')::uuid FROM p1), 'refund-18-1') AS j;
GRANT SELECT ON rf1 TO authenticated, service_role;
RESET ROLE;
SELECT is((SELECT j - 'journal_id' FROM rf1),
  jsonb_build_object('status', 'refunded', 'fee_refund_id', (SELECT (j ->> 'fee_refund_id')::uuid FROM p1), 'kind', 'late',
                     'fee_payment_id', NULL, 'psp_payment_id', 'pay-18-p1', 'psp_refund_id', 'refund-18-1', 'amount', 30000,
                     'currency', 'TRY', 'alerts', '[]'::jsonb, 'replayed', false),
  'AC-9: a late refund applied');
SELECT is((SELECT jsonb_agg(e.account || ' ' || e.amount ORDER BY e.account) FROM public.ledger_entries e
            WHERE e.journal_id = (SELECT (j ->> 'journal_id')::uuid FROM rf1)),
  '["psp_clearing -30000", "refunds_due 30000"]', 'AC-9: refunds_due cleared against PSP clearing');
SELECT results_eq($$ SELECT status, psp_refund_id, finished_at = now() FROM public.fee_refunds WHERE psp_payment_id = 'pay-18-p1' $$,
  $$ VALUES ('done', 'refund-18-1', true) $$, 'AC-9: the refund is done');
SET LOCAL ROLE service_role;
SELECT is(public.apply_fee_refunded((SELECT (j ->> 'fee_refund_id')::uuid FROM p1), 'refund-18-1'), (SELECT j || '{"replayed": true}' FROM rf1),
  'AC-9: a replay returns the stored result');
SELECT is(pg_temp.err(format('SELECT public.apply_fee_refunded(%L, %L)', (SELECT (j ->> 'fee_refund_id')::uuid FROM p1), 'refund-18-x')),
  'idempotency_conflict', 'AC-9: a second PSP refund for one payment is a conflict');
RESET ROLE;
-- A fee refund, as 12 will write it.
INSERT INTO public.fee_refunds (region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency, reason)
VALUES ('TR', pg_temp.r(5), 'fee', (SELECT id FROM f5), 'pay-18-p2', 30000, 'TRY', 'test');
SELECT throws_ok(
  $$ INSERT INTO public.fee_refunds (region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency, reason)
     VALUES ('TR', pg_temp.r(5), 'fee', (SELECT id FROM f5), 'pay-18-other', 30000, 'TRY', 'test') $$,
  '23505', NULL, 'AC-9: a fee is refunded at most once');
SELECT throws_ok(
  $$ INSERT INTO public.fee_refunds (region, request_id, kind, psp_payment_id, amount, currency, reason)
     VALUES ('TR', pg_temp.r(5), 'late', 'pay-18-p1', 30000, 'TRY', 'test') $$,
  '23505', NULL, 'AC-9: a PSP payment is refunded at most once');
CREATE TEMP TABLE rid AS SELECT id, fee_payment_id FROM public.fee_refunds WHERE kind = 'fee';
GRANT SELECT ON rid TO authenticated, service_role;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE rf2 AS SELECT public.apply_fee_refunded((SELECT id FROM rid WHERE fee_payment_id = (SELECT id FROM f5)), 'refund-18-2') AS j;
GRANT SELECT ON rf2 TO authenticated, service_role;
RESET ROLE;
SELECT is((SELECT jsonb_agg(e.account || ' ' || e.amount ORDER BY e.account) FROM public.ledger_entries e
            JOIN public.ledger_journals j ON j.id = e.journal_id
           WHERE j.idempotency_key = 'fee:' || (SELECT id FROM f5) || ':refund' AND j.fee_payment_id = (SELECT id FROM f5)),
  '["commission_refunds 30000", "psp_clearing -30000"]', 'AC-9: the commission refund journal');
SELECT is((SELECT status FROM public.fee_payments WHERE id = (SELECT id FROM f5)), 'refunded', 'AC-9: the fee is refunded');
SELECT throws_ok($$ UPDATE public.fee_payments SET status = 'paid' WHERE id = (SELECT id FROM f5) $$,
  'P0001', 'fee_immutable', 'R-7: a refunded fee never moves again');
INSERT INTO public.fee_refunds (region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency, reason)
VALUES ('TR', pg_temp.r(6), 'fee', pg_temp.fee(6, 'commission'), 'pay-18-none', 10000, 'TRY', 'test');
INSERT INTO rid SELECT id, fee_payment_id FROM public.fee_refunds WHERE psp_payment_id = 'pay-18-none';
SET LOCAL ROLE service_role;
SELECT is(pg_temp.err(format('SELECT public.apply_fee_refunded(%L, %L)', (SELECT id FROM rid WHERE fee_payment_id = pg_temp.fee(6, 'commission')), 'refund-18-3')),
  'invalid_state', 'AC-9: a fee that was never paid is never refunded');
SELECT is(pg_temp.err(format('SELECT public.apply_fee_refunded(%L, %L)', gen_random_uuid(), 'refund-18-4')), 'not_found', 'AC-9: an unknown refund');
RESET ROLE;
INSERT INTO public.fee_refunds (region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency, reason)
VALUES ('TR', pg_temp.r(4), 'fee', pg_temp.fee(4, 'commission'), 'pay-18-not-its-own', 20000, 'TRY', 'test');
INSERT INTO rid SELECT id, fee_payment_id FROM public.fee_refunds WHERE psp_payment_id = 'pay-18-not-its-own';
SELECT throws_ok(
  $$ INSERT INTO public.fee_refunds (region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency, reason)
     VALUES ('TR', pg_temp.r(5), 'fee', pg_temp.fee(1, 'provider_fee'), 'pay-18-other-request', 15000, 'TRY', 'test') $$,
  '23503', NULL, 'reviews: a fee refund always names its fee''s own request');
SET LOCAL ROLE service_role;
SELECT is(pg_temp.err(format('SELECT public.apply_fee_refunded(%L, %L)', (SELECT id FROM rid WHERE fee_payment_id = pg_temp.fee(4, 'commission')), 'refund-18-5')),
  'invalid_state', 'reviews: a fee refund of another payment than the fee''s own is refused');
RESET ROLE;
SELECT is(pg_temp.try_write('delete', 'fee_refunds'), 'fee_refund_immutable', 'AC-9: a refund row is never deleted');

-- ══ AC-10, R-10: the outbox ══════════════════════════════════════════════════
CREATE TEMP TABLE ob AS SELECT public.enqueue_outbox('email.send', 'email:test-18:1', '{"n": 1}', 'TR') AS id;
GRANT SELECT ON ob TO authenticated, service_role;
SELECT is(public.enqueue_outbox('email.send', 'email:test-18:1', '{"n": 1}', 'TR'), (SELECT id FROM ob), 'AC-10: the same key returns the same row');
SELECT is((SELECT count(*)::int FROM public.outbox_events WHERE idempotency_key = 'email:test-18:1'), 1, 'AC-10: once');
SELECT is(pg_temp.err($$ SELECT public.enqueue_outbox('email.send', 'email:test-18:1', '{"n": 2}', 'TR') $$), 'idempotency_conflict',
  'AC-10: the same key with another payload is a conflict');
SELECT is(pg_temp.err($$ SELECT public.enqueue_outbox('sms.send', 'sms:test-18:1', '{}', 'TR') $$), 'validation_failed', 'AC-10: an unknown kind');
SET LOCAL ROLE service_role;
CREATE TEMP TABLE c1 AS SELECT public.claim_outbox(100, 'worker-18') AS j;
GRANT SELECT ON c1 TO authenticated, service_role;
RESET ROLE;
SELECT ok((SELECT j @> jsonb_build_array(jsonb_build_object('id', (SELECT id FROM ob), 'kind', 'email.send', 'idempotency_key', 'email:test-18:1',
                                                           'payload', '{"n": 1}'::jsonb, 'attempts', 1, 'region', 'TR',
                                                           'claim_token', pg_temp.token((SELECT id FROM ob)))) FROM c1),
  'AC-10: a due row is claimed, with its attempt counted and its claim token');
SELECT results_eq($$ SELECT status, claimed_by, claimed_at = now(), attempts FROM public.outbox_events WHERE id = (SELECT id FROM ob) $$,
  $$ VALUES ('claimed', 'worker-18', true, 1) $$, 'AC-10: claimed by the worker now');
SET LOCAL ROLE service_role;
SELECT ok(NOT (public.claim_outbox(100, 'worker-other') @> jsonb_build_array(jsonb_build_object('id', (SELECT id FROM ob)))),
  'AC-10: a claimed row inside its lease is not claimed again');
SELECT is(public.finish_outbox((SELECT id FROM ob), true, NULL, pg_temp.token((SELECT id FROM ob)) - interval '1 second') - 'next_attempt_at',
  jsonb_build_object('id', (SELECT id FROM ob), 'status', 'claimed', 'attempts', 1, 'stale', true),
  'reviews: a finish with an old claim token changes nothing (a relay whose lease ran out)');
SELECT is(public.finish_outbox((SELECT id FROM ob), false, 'timeout', pg_temp.token((SELECT id FROM ob))) - 'next_attempt_at',
  jsonb_build_object('id', (SELECT id FROM ob), 'status', 'pending', 'attempts', 1, 'stale', false), 'AC-10: a failed try goes back to pending');
RESET ROLE;
SELECT results_eq($$ SELECT next_attempt_at = now() + interval '1 minute', last_error FROM public.outbox_events WHERE id = (SELECT id FROM ob) $$,
  $$ VALUES (true, 'timeout') $$, 'AC-10: the next try in 1 minute');
-- Tries 2 to 6: each due again, claimed and failed.
CREATE TEMP TABLE schedule (attempt integer, wait interval, status text);
GRANT SELECT ON schedule TO authenticated, service_role;
DO $$
DECLARE
  v_id uuid := (SELECT id FROM ob);
  v_out jsonb;
BEGIN
  FOR i IN 2..6 LOOP
    UPDATE public.outbox_events SET next_attempt_at = now() - interval '1 second' WHERE id = v_id;
    PERFORM public.claim_outbox(100, 'worker-18');
    v_out := public.finish_outbox(v_id, false, 'boom', pg_temp.token(v_id));
    INSERT INTO schedule SELECT i, (SELECT next_attempt_at - now() FROM public.outbox_events WHERE id = v_id), v_out ->> 'status';
  END LOOP;
END $$;
SELECT results_eq($$ SELECT attempt, wait, status FROM schedule ORDER BY attempt $$,
  $$ VALUES (2, interval '5 minutes', 'pending'), (3, interval '30 minutes', 'pending'), (4, interval '120 minutes', 'pending'),
            (5, interval '720 minutes', 'pending'), (6, NULL::interval, 'failed') $$,
  'R-10: retries at 5, 30, 120 and 720 minutes, then failed after the sixth try');
SELECT is((SELECT status FROM public.outbox_events WHERE id = (SELECT id FROM ob)), 'failed', 'R-10: the row is failed');
CREATE TEMP TABLE ob2 AS SELECT public.enqueue_outbox('email.send', 'email:test-18:2', '{"n": 2}', 'TR') AS id;
GRANT SELECT ON ob2 TO authenticated, service_role;
UPDATE public.outbox_events SET status = 'claimed', claimed_at = now() - interval '3 minutes', claimed_by = 'gone', attempts = 2
 WHERE id = (SELECT id FROM ob2);
SET LOCAL ROLE service_role;
SELECT ok(public.claim_outbox(100, 'worker-18') @> jsonb_build_array(jsonb_build_object('id', (SELECT id FROM ob2), 'attempts', 3)),
  'R-10: a lease that ran out is claimed again, as a new attempt');
SELECT is(public.finish_outbox((SELECT id FROM ob2), true, NULL, pg_temp.token((SELECT id FROM ob2))) ->> 'status', 'done', 'AC-10: a success is done');
SELECT is(public.finish_outbox((SELECT id FROM ob2), false, 'late', pg_temp.token((SELECT id FROM ob2))) - 'next_attempt_at',
  jsonb_build_object('id', (SELECT id FROM ob2), 'status', 'done', 'attempts', 3, 'stale', true), 'AC-10: a late finish changes nothing');
RESET ROLE;
CREATE TEMP TABLE ob3 AS SELECT public.enqueue_outbox('email.send', 'email:test-18:3', '{"n": 3}', 'TR') AS id;
GRANT SELECT ON ob3 TO authenticated, service_role;
UPDATE public.outbox_events SET status = 'claimed', claimed_at = now() - interval '3 minutes', claimed_by = 'gone', attempts = 6
 WHERE id = (SELECT id FROM ob3);
SET LOCAL ROLE service_role;
SELECT ok(NOT (public.claim_outbox(100, 'worker-18') @> jsonb_build_array(jsonb_build_object('id', (SELECT id FROM ob3)))),
  'R-10: a sixth attempt whose lease ran out is not claimed again');
RESET ROLE;
SELECT is((SELECT status FROM public.outbox_events WHERE id = (SELECT id FROM ob3)), 'failed', 'R-10: it is failed');
SELECT throws_ok($$ UPDATE public.outbox_events SET payload = '{}' WHERE id = (SELECT id FROM ob2) $$,
  'P0001', 'outbox_immutable', 'AC-10: an outbox row keeps its kind, key and payload');

-- ══ AC-11, R-9: PSP events ═══════════════════════════════════════════════════
SET LOCAL ROLE service_role;
SELECT is(public.record_psp_event('webhook', 'evt-18-1', '{"paymentId": "1"}', 'TR') ->> 'new', 'true', 'AC-11: a new event');
SELECT is(public.record_psp_event('webhook', 'evt-18-1', '{"paymentId": "1"}', 'TR') ->> 'new', 'false', 'AC-11: the same event again is not new');
SELECT is(public.record_psp_event('callback', 'evt-18-1', '{"paymentId": "1"}', 'TR') ->> 'new', 'true', 'AC-11: the key is per source');
SELECT public.record_psp_event('retrieve', 'evt-18-2',
  '{"paymentId": "9", "cardNumber": "5528790000000008", "cardType": "CREDIT_CARD", "cvc": "123",
    "x": {"cardHolderName": "A B", "binNumber": "552879", "expireMonth": "12", "ExpireYear": "2030", "cardUserKey": "k",
          "itemTransactions": [{"lastFourDigits": "0008", "price": "1.0", "cardToken": "t"}], "cvv": "1", "CARDASSOCIATION": "M"}}',
  'TR');
RESET ROLE;
SELECT is((SELECT payload FROM public.psp_events WHERE source = 'retrieve' AND event_key = 'evt-18-2'),
  '{"paymentId": "9", "x": {"itemTransactions": [{"price": "1.0"}]}}', 'R-9: every card field is stripped, at any depth, in any case');
SELECT is((SELECT count(*)::int FROM public.psp_events WHERE event_key = 'evt-18-1'), 2, 'AC-11: one row per source and key');
SELECT is(public.psp_payload_strip(
  '{"paymentId": "9", "buyer": {"id": "b"}, "email": "a@b.c", "gsmNumber": "+905550000000", "identityNumber": "1",
    "ip": "1.2.3.4", "name": "A", "Surname": "B", "contactName": "C", "shippingAddress": {"x": 1}, "registrationAddress": "y",
    "basketItems": [{"price": "1.0", "name": "Fee"}]}'),
  '{"paymentId": "9", "basketItems": [{"price": "1.0"}]}', 'reviews: the buyer''s personal data is stripped too (KVKK)');
SET LOCAL ROLE service_role;
SELECT is(pg_temp.err(format('SELECT public.record_psp_event(%L, %L, %L, %L)', 'webhook', 'evt-18-deep',
                             repeat('[', 40) || repeat(']', 40), 'TR')),
  'payload_too_large', 'reviews: a payload nested deeper than 32 levels is refused with a stable code');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is(pg_temp.err(format('SELECT public.record_psp_event(%L, %L, %L, %L)', 'webhook', 'evt-18-3',
                             jsonb_build_object('blob', repeat('x', 65537)), 'TR')),
  'payload_too_large', 'R-9: a payload over 64 KiB is refused');
SELECT is(pg_temp.err($$ SELECT public.record_psp_event('email', 'evt-18-4', '{}', 'TR') $$), 'validation_failed', 'AC-11: an unknown source');
RESET ROLE;

-- ══ AC-13: who reads what ════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
SELECT results_eq($$ SELECT request_id, kind, amount, status FROM public.fee_payments ORDER BY request_id, kind $$,
  $$ VALUES (pg_temp.r(1), 'commission', 30000::bigint, 'pending'), (pg_temp.r(4), 'commission', 20000::bigint, 'paid'),
            (pg_temp.r(5), 'commission', 30000::bigint, 'refunded') $$,
  'AC-13: the customer reads their own fee rows');
SELECT throws_ok($$ SELECT psp_fee_amount FROM public.fee_payments $$, '42501', NULL, 'R-9: but never the PSP fee');
SELECT pg_temp.as_user('a1');
SELECT results_eq($$ SELECT request_id, kind, amount FROM public.fee_payments $$,
  $$ VALUES (pg_temp.r(1), 'provider_fee', 15000::bigint) $$, 'AC-13: the provider reads only their own fee row');
SELECT pg_temp.as_user('c2');
SELECT results_eq($$ SELECT request_id FROM public.fee_payments $$, $$ VALUES (pg_temp.r(6)) $$, 'AC-13: another customer reads only theirs');
SELECT pg_temp.as_user('d1');
SELECT is_empty($$ SELECT id FROM public.fee_payments $$, 'AC-13: an admin reads no fee row directly');
SELECT throws_ok($$ SELECT id FROM public.checkout_attempts $$, '42501', NULL, 'AC-13: no API read of checkout attempts');
SELECT throws_ok($$ SELECT id FROM public.fee_refunds $$, '42501', NULL, 'AC-13: nor of refunds');
SELECT throws_ok($$ SELECT id FROM public.ledger_journals $$, '42501', NULL, 'AC-13: nor of journals');
SELECT throws_ok($$ SELECT id FROM public.ledger_entries $$, '42501', NULL, 'AC-13: nor of ledger entries');
SELECT throws_ok($$ SELECT id FROM public.outbox_events $$, '42501', NULL, 'AC-13: nor of the outbox');
SELECT throws_ok($$ SELECT id FROM public.psp_events $$, '42501', NULL, 'AC-13: nor of PSP events');
SELECT throws_ok($$ SELECT public.apply_fee_paid(gen_random_uuid(), gen_random_uuid(), 'x', 1, 'TRY', 0) $$, '42501', NULL,
  'AC-8: a signed in user cannot apply a payment');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT id FROM public.fee_payments $$, '42501', NULL, 'AC-13: anon reads no fee row');
RESET ROLE;

-- ══ AC-12: the books ══════════════════════════════════════════════════════════
SELECT is_empty(
  $$ SELECT t.tgname FROM pg_trigger t
      WHERE t.tgname IN ('ledger_journals_balanced', 'ledger_entries_balanced', 'fee_settings_guard')
        AND NOT (t.tgdeferrable AND t.tginitdeferred) $$,
  'reviews: the balance and settings checks are deferred to commit (this file runs them per statement)');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE proname = 'ledger_balanced'),
  'reviews: the balance check is a definer function, so it runs at the relay''s commit (19 proves it)');
SET LOCAL ROLE service_role;
SELECT pg_temp.as_service();
SELECT is(public.ledger_check('TR') -> 'imbalances',
  '[{"check": "late_received_without_refund", "ref": "late:test-j1:received", "value": 1}]',
  'AC-12: the books balance after every path above, save the test journal of AC-7, which has no late refund row');
SELECT ok((SELECT bool_and(t ? 'currency' AND t ? 'account' AND t ? 'total') AND count(*) > 0
             FROM jsonb_array_elements(public.ledger_check('TR') -> 'totals') t),
  'AC-12: with every (currency, account) total');
SELECT is((SELECT sum((t ->> 'total')::bigint) FROM jsonb_array_elements(public.ledger_check('TR') -> 'totals') t
            WHERE t ->> 'currency' = 'TRY'), 0::numeric, 'AC-12: the totals of a currency sum to zero');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('d1');
SELECT is(jsonb_array_length(public.ledger_check('TR') -> 'imbalances'), 1, 'AC-12: an admin may run it');
SELECT pg_temp.as_user('c1');
SELECT is(pg_temp.err($$ SELECT public.ledger_check('TR') $$), 'forbidden', 'AC-12: a customer may not');
RESET ROLE;
-- A second paid journal for one fee is an imbalance the check names.
SELECT public.post_journal('fee_paid', 'fee:test-18:paid-again', 'TRY', 'TR',
  '[{"account": "psp_clearing", "amount": 15000}, {"account": "provider_fee_revenue", "amount": -15000}]',
  pg_temp.fee(1, 'provider_fee'), '{}');
SET LOCAL ROLE service_role;
SELECT pg_temp.as_service();
SELECT is((SELECT jsonb_agg(i ->> 'check') FROM jsonb_array_elements(public.ledger_check('TR') -> 'imbalances') i
            WHERE i ->> 'ref' = pg_temp.fee(1, 'provider_fee')::text),
  '["fee_paid_journals"]', 'AC-12: a fee with two paid journals is named');
RESET ROLE;

-- ══ AC-14: a seeded property test over random sequences (U-2) ════════════════
-- Twelve requests, each SELECTED on one provider. 09 and 10 move the request on payment; here a test
-- version does it, inside this transaction, with the request guard lifted.
CREATE OR REPLACE FUNCTION public.after_commission_paid(p_fee uuid) RETURNS void
  LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  UPDATE public.requests SET status = 'COMMISSION_PAID'
   WHERE id = (SELECT request_id FROM public.fee_payments WHERE id = p_fee) AND status = 'SELECTED' $$;
CREATE OR REPLACE FUNCTION public.after_provider_fee_paid(p_fee uuid) RETURNS void
  LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  UPDATE public.requests SET status = 'UNLOCKED'
   WHERE id = (SELECT request_id FROM public.fee_payments WHERE id = p_fee) AND status = 'COMMISSION_PAID' $$;
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
SELECT pg_temp.req(pg_temp.r(10 + g), 'c2', 50000 + g * 7000) FROM generate_series(1, 12) g;
SELECT pg_temp.offer(10 + g, 'a1') FROM generate_series(1, 12) g;
SELECT pg_temp.as_user('c2');
SELECT public.choose_provider(pg_temp.r(10 + g), pg_temp.app(10 + g, 'a1')) FROM generate_series(1, 12) g;

CREATE TEMP TABLE prop_pay (n integer, fee uuid, psp text, amount bigint, currency text, psp_fee bigint, pre_fee text,
                            pre_req text, accept_ok boolean, figures_ok boolean, result jsonb);
GRANT SELECT ON prop_pay TO authenticated, service_role;
CREATE TEMP TABLE prop_err (n integer, op integer, err text);
GRANT SELECT ON prop_err TO authenticated, service_role;
SELECT setseed(0.1807);
DO $$
DECLARE
  v_req    uuid;
  v_fee    public.fee_payments%rowtype;
  v_att    uuid;
  v_op     integer;
  v_psp    text;
  v_amount bigint;
  v_cur    text;
  v_pspfee bigint;
  v_prev   prop_pay%rowtype;
  v_out    jsonb;
  v_rid    uuid;
  v_rstat  text;
BEGIN
  FOR k IN 1..600 LOOP
    v_req := pg_temp.r(11 + floor(random() * 12)::integer);
    v_op := floor(random() * 8)::integer;
    BEGIN
      IF v_op = 0 THEN
        PERFORM public.open_fee(v_req, 'commission');
      ELSIF v_op = 1 THEN
        PERFORM public.open_fee(v_req, 'provider_fee');
      ELSIF v_op = 2 THEN
        SELECT * INTO v_fee FROM public.fee_payments WHERE request_id = v_req ORDER BY random() LIMIT 1;
        IF found THEN PERFORM public.start_checkout(v_fee.id, 'tr', NULL); END IF;
      ELSIF v_op IN (3, 4) THEN
        -- A payment: usually the fee's figures, sometimes a wrong amount or currency, sometimes no PSP fee.
        SELECT f.* INTO v_fee FROM public.fee_payments f WHERE f.request_id = v_req ORDER BY random() LIMIT 1;
        v_att := (SELECT a.id FROM public.checkout_attempts a WHERE a.fee_payment_id = v_fee.id ORDER BY random() LIMIT 1);
        IF v_att IS NOT NULL THEN
          v_psp := 'prop-' || k;
          v_amount := CASE WHEN random() < 0.1 THEN v_fee.amount + 100 ELSE v_fee.amount END;
          v_cur := CASE WHEN random() < 0.05 THEN 'SAR' ELSE 'TRY' END;
          v_pspfee := CASE WHEN random() < 0.05 THEN NULL ELSE floor(random() * v_amount / 20)::bigint END;
          INSERT INTO prop_pay
          SELECT k, v_fee.id, v_psp, v_amount, v_cur, v_pspfee, f.status, r.status,
                 CASE f.kind WHEN 'commission' THEN r.status = 'SELECTED' ELSE r.status = 'COMMISSION_PAID' END,
                 v_amount = f.amount AND v_cur = f.currency, NULL
            FROM public.fee_payments f JOIN public.requests r ON r.id = f.request_id WHERE f.id = v_fee.id;
          v_out := public.apply_fee_paid(v_fee.id, v_att, v_psp, v_amount, v_cur, v_pspfee);
          UPDATE prop_pay SET result = v_out WHERE prop_pay.n = k;
        END IF;
      ELSIF v_op = 5 THEN
        -- A replay or a duplicate delivery of an earlier fact, with the same figures.
        SELECT * INTO v_prev FROM prop_pay WHERE result IS NOT NULL ORDER BY random() LIMIT 1;
        IF found THEN
          v_out := public.apply_fee_paid(v_prev.fee, (v_prev.result ->> 'attempt_id')::uuid, v_prev.psp, v_prev.amount,
                                         v_prev.currency, v_prev.psp_fee);
          IF v_out IS DISTINCT FROM v_prev.result || '{"replayed": true}' THEN
            INSERT INTO prop_err VALUES (k, v_op, 'replay differs: ' || v_prev.psp);
          END IF;
        END IF;
      ELSIF v_op = 6 THEN
        -- 12's refund of a paid fee, written as 12 will write it, once.
        SELECT f.* INTO v_fee FROM public.fee_payments f
         WHERE f.request_id = v_req AND f.status = 'paid'
           AND NOT EXISTS (SELECT 1 FROM public.fee_refunds x WHERE x.fee_payment_id = f.id)
         ORDER BY random() LIMIT 1;
        IF found THEN
          INSERT INTO public.fee_refunds (region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency, reason)
          VALUES (v_fee.region, v_fee.request_id, 'fee', v_fee.id, v_fee.psp_payment_id, v_fee.amount, v_fee.currency, 'test');
        END IF;
      ELSE
        -- The PSP confirms a queued refund, or repeats a confirmation.
        SELECT x.id, x.status INTO v_rid, v_rstat FROM public.fee_refunds x
         WHERE x.request_id = v_req AND x.status IN ('queued', 'done') ORDER BY random() LIMIT 1;
        IF v_rid IS NOT NULL THEN
          PERFORM public.apply_fee_refunded(v_rid, 'prop-refund-' || v_rid);
        END IF;
      END IF;
    EXCEPTION WHEN raise_exception THEN
      IF sqlerrm NOT IN ('invalid_state') THEN
        INSERT INTO prop_err VALUES (k, v_op, sqlerrm);
      END IF;
    END;
  END LOOP;
END $$;
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;

SELECT is_empty($$ SELECT n, op, err FROM prop_err $$, 'AC-14: no unexpected refusal, and every replay returned the stored result');
SELECT ok((SELECT count(*) FROM prop_pay WHERE result ->> 'status' = 'paid') >= 12
          AND (SELECT count(*) FROM prop_pay WHERE result ->> 'status' = 'late') >= 12
          AND (SELECT count(*) FROM public.fee_refunds WHERE request_id IN (SELECT pg_temp.r(10 + g) FROM generate_series(1, 12) g) AND status = 'done') >= 6,
  'AC-14: the sequence reached paid, late and refunded facts');
SELECT is_empty(
  $$ SELECT n, psp FROM prop_pay
      WHERE result ->> 'status' = 'paid' AND NOT (pre_fee = 'pending' AND accept_ok AND figures_ok) $$,
  'AC-14, U-2: no payment that was not accepted set a fee paid');
SELECT is_empty(
  $$ SELECT n, psp FROM prop_pay
      WHERE result ->> 'status' = 'late' AND pre_fee = 'pending' AND accept_ok AND figures_ok $$,
  'AC-14: every acceptable payment was applied as paid');
SELECT is_empty(
  $$ SELECT f.id FROM public.fee_payments f
      WHERE f.request_id IN (SELECT pg_temp.r(10 + g) FROM generate_series(1, 12) g)
        AND ((SELECT count(*) FROM public.ledger_journals j WHERE j.fee_payment_id = f.id AND j.kind = 'fee_paid') > 1
             OR (SELECT count(*) FROM public.ledger_journals j WHERE j.fee_payment_id = f.id AND j.kind = 'fee_refund') > 1
             OR (SELECT count(*) FROM prop_pay p WHERE p.fee = f.id AND p.result ->> 'status' = 'paid' AND p.result ->> 'replayed' = 'false') > 1) $$,
  'AC-14, U-2: every fee paid at most once and refunded at most once');
SELECT is_empty(
  $$ SELECT psp_payment_id FROM public.fee_refunds GROUP BY psp_payment_id HAVING count(*) > 1 $$,
  'AC-14: every PSP payment refunded at most once');
SET LOCAL ROLE service_role;
SELECT pg_temp.as_service();
SELECT is((SELECT jsonb_agg(i) FROM jsonb_array_elements(public.ledger_check('TR') -> 'imbalances') i
            WHERE i ->> 'ref' NOT IN (pg_temp.fee(1, 'provider_fee')::text, 'late:test-j1:received')), NULL,
  'AC-14, U-2: the books balance after 600 random steps (the planted double journal aside)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
