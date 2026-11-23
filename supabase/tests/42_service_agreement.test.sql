-- Position 20, spec 0011-20 (D222): the service agreement.
--
-- The three tables with RLS on, policies, grants and their guards (AC-1, AC-11); the draft-1 template and the body
-- rules (AC-1); each pay refusal agreement_required, in its place in the order (AC-2, AC-3, X-5); the provider bound to
-- the customer's version (AC-3); the carried re-pick's acceptance (AC-4); the row and the outbox job at the reveal, with
-- frozen content and the number, and no row (but a gap the heartbeat alerts) without both acceptances (AC-5); the render
-- context, finish and fail, mail and notices (AC-6 to AC-8); agreement_visible for each side, a stranger, after opening
-- and after 7 days (AC-9); admin's list, its audited view and render again (AC-10, AC-7); the bucket's guard and policy
-- (AC-11); provider_jobs' version and request_offers' carried flag (AC-3, AC-4); grants.
--
-- A condition that needs a row changed and put back runs inside pg_temp.probe, which rolls its own changes back.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(154);

SET CONSTRAINTS ALL IMMEDIATE;

-- Spec 0011-20b: 20b made draft-2 the active template. This file proves position 20 on draft-1, so it makes draft-1
-- the active one again for its own run (rolled back); pgTAP 45 proves draft-2.
UPDATE public.agreement_templates SET active = false WHERE region = 'TR' AND version = 'draft-2';
UPDATE public.agreement_templates SET active = true WHERE region = 'TR' AND version = 'draft-1';

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000004200' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000004270' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.app(p integer, w text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-00000042' || CASE w WHEN 'a1' THEN '81' ELSE '82' END
          || lpad(p::text, 2, '0'))::uuid $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1 the customer, c2 a stranger, a1 the chosen provider, a2 another applicant, ad and ad2 admins. c1 and a1 have
-- confirmed addresses.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559420001'), ('c2', '905559420002'), ('a1', '905559420003'), ('a2', '905559420004'),
               ('ad', '905559420005'), ('d2', '905559420006')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale, email, email_confirmed_at)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'tr', e, CASE WHEN e IS NOT NULL THEN now() END
  FROM (VALUES ('c1', 'customer', '905559420001', 'Ayşe Müşteri', 'c1-42@example.com'),
               ('c2', 'customer', '905559420002', 'Yabancı', NULL),
               ('a1', 'provider', '905559420003', 'İlker Usta', 'a1-42@example.com'),
               ('a2', 'provider', '905559420004', 'İki Usta', NULL),
               ('ad', 'admin', '905559420005', 'Yönetici', NULL),
               ('d2', 'admin', '905559420006', 'Yönetici İki', NULL)) AS t(c, r, p, n, e);
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'İlker Usta Temizlik'
 WHERE id = pg_temp.u('a1');
UPDATE public.providers SET status = 'approved', approved_at = now(), approved_name = 'İki Usta'
 WHERE id = pg_temp.u('a2');
INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Ev"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Temizlik", "en": "Cleaning"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Moda", "en": "Moda"}', 1.00, true);
UPDATE public.platform_settings SET value = 'true'
 WHERE region = 'TR' AND key IN ('payments_enabled', 'emails_enabled', 'notifications_enabled');

CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p_user), 'role', 'authenticated')::text, true) $$;
-- A request of c1 starting in 3 days with offers of a1 and a2, the commission given.
CREATE FUNCTION pg_temp.base(p integer, p_commission bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100, "service": {"name": {"tr": "Temizlik", "en": "Cleaning"}, "category_name": {"tr": "Ev"}},
      "breakdown": {"addons": [{"name": {"tr": "Cam", "en": "Windows"}, "price": 5000}, {"name": {"en": "Oven"}, "price": 3000}]}}',
    100000, p_commission, 100000 - p_commission, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours');
  INSERT INTO public.request_addresses (request_id, region, customer_id, line)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), 'Moda Cad. No 9 Daire 4');
  INSERT INTO public.applications (id, region, request_id, provider_id, message)
  VALUES (pg_temp.app(p, 'a1'), 'TR', pg_temp.r(p), pg_temp.u('a1'), 'An offer for the agreement tests, long enough.'),
         (pg_temp.app(p, 'a2'), 'TR', pg_temp.r(p), pg_temp.u('a2'), 'Another offer for the agreement tests, long enough.');
END $$;
CREATE FUNCTION pg_temp.cfee(p integer) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'commission' $$;
CREATE FUNCTION pg_temp.pfee(p integer) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.fee_payments WHERE request_id = pg_temp.r(p) AND kind = 'provider_fee' AND status = 'pending' $$;
-- Choose a1 and pay the commission (verified).
CREATE FUNCTION pg_temp.paid_commission(p integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_att uuid;
BEGIN
  PERFORM pg_temp.base(p, 10000);
  PERFORM pg_temp.as_user('c1');
  PERFORM public.choose_provider(pg_temp.r(p), pg_temp.app(p, 'a1'));
  v_att := (public.pay_commission(pg_temp.r(p), 'tr', NULL, 'draft-1') ->> 'attempt_id')::uuid;
  PERFORM public.apply_fee_paid(pg_temp.cfee(p), v_att, 'pay-42-c' || p, 10000, 'TRY', 300);
END $$;
-- Both fees paid: UNLOCKED through two verified payments.
CREATE FUNCTION pg_temp.revealed(p integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_att uuid;
BEGIN
  PERFORM pg_temp.paid_commission(p);
  PERFORM pg_temp.as_user('a1');
  v_att := (public.pay_provider_fee(pg_temp.app(p, 'a1'), 'tr', NULL, 'draft-1') ->> 'attempt_id')::uuid;
  PERFORM public.apply_fee_paid(pg_temp.pfee(p), v_att, 'pay-42-p' || p,
                                (SELECT amount FROM public.fee_payments WHERE id = pg_temp.pfee(p)), 'TRY', 150);
  RETURN (SELECT id FROM public.service_agreements WHERE request_id = pg_temp.r(p));
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
  EXCEPTION
    WHEN raise_exception THEN v := sqlerrm;
    WHEN others THEN v := sqlstate;
  END;
  RESET ROLE;
  RETURN v;
END $$;
-- A statement as the owner, its refusal as text, or 'ok'.
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION
  WHEN raise_exception THEN RETURN sqlerrm;
  WHEN others THEN RETURN sqlstate;
END $$;
-- Run setup statements and an expression, then roll all of it back.
CREATE FUNCTION pg_temp.probe(p_setup text[], p_expr text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
  s text;
BEGIN
  BEGIN
    FOREACH s IN ARRAY p_setup LOOP
      EXECUTE s;
    END LOOP;
    EXECUTE p_expr INTO v;
    RAISE EXCEPTION 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF sqlerrm <> 'probe_rollback' THEN
      v := sqlerrm;
    END IF;
  END;
  RETURN v;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role, anon;

-- ══ AC-1, AC-11: the tables ═══════════════════════════════════════════════════
SELECT ok((SELECT bool_and(c.relrowsecurity) FROM pg_class c
            WHERE c.oid IN ('public.agreement_templates'::regclass, 'public.agreement_acceptances'::regclass,
                            'public.service_agreements'::regclass)),
  'AC-11: RLS is on for the three tables');
SELECT ok(NOT has_table_privilege('anon', 'public.agreement_templates', 'SELECT')
          AND NOT has_table_privilege('anon', 'public.agreement_acceptances', 'SELECT')
          AND NOT has_table_privilege('anon', 'public.service_agreements', 'SELECT'),
  'AC-11: anon reads none of them');
SELECT ok(NOT has_table_privilege('authenticated', 'public.agreement_templates', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.agreement_acceptances', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.service_agreements', 'UPDATE')
          AND NOT has_table_privilege('service_role', 'public.service_agreements', 'INSERT')
          AND NOT has_table_privilege('service_role', 'public.service_agreements', 'UPDATE'),
  'AC-11: no API role writes them directly');
SELECT is(pg_temp.call_as('c1', $$ INSERT INTO public.agreement_acceptances (region, request_id, application_id, user_id, role, template_id)
                                   VALUES ('TR', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'customer', gen_random_uuid())
                                   RETURNING 'inserted' $$),
  '42501', 'AC-11: a customer cannot insert an acceptance');

-- The template.
SELECT is((SELECT version || ' ' || active FROM public.agreement_templates WHERE region = 'TR' AND version = 'draft-1'), 'draft-1 true',
  'AC-1: TR has the draft-1 template, active');
SELECT ok((SELECT bool_and(s ->> 'heading' LIKE '[draft] %'
                           AND (SELECT bool_and(p #>> '{}' LIKE '[draft] %') FROM jsonb_array_elements(s -> 'paragraphs') p))
             FROM public.agreement_templates t, jsonb_array_elements(t.body) s WHERE t.version = 'draft-1'),
  'AC-1: every heading and paragraph of draft-1 starts [draft]');
SELECT ok(public.agreement_body_valid((SELECT body FROM public.agreement_templates WHERE version = 'draft-1')),
  'AC-1: draft-1 passes its own body check');
SELECT is(pg_temp.err($$ INSERT INTO public.agreement_templates (region, version, body)
                         VALUES ('TR', 'bad-1', '[{"heading": "H", "paragraphs": ["{{customer_name}} {{evil}}"]}]') $$),
  '23514', 'AC-1, rule 8: a field off the list is refused');
SELECT is(pg_temp.err($$ INSERT INTO public.agreement_templates (region, version, body)
                         VALUES ('TR', 'bad-2', '[{"heading": "H", "paragraphs": ["a {{ customer_name }} b"]}]') $$),
  '23514', 'AC-1: a braces pair that is not a field is refused');
SELECT is(pg_temp.err($$ INSERT INTO public.agreement_templates (region, version, body)
                         VALUES ('TR', 'bad-3', '[{"heading": "H", "paragraphs": ["x"], "extra": 1}]') $$),
  '23514', 'AC-1: a section with another key is refused');
SELECT is(pg_temp.err($$ INSERT INTO public.agreement_templates (region, version, body)
                         VALUES ('TR', 'Bad Version', '[{"heading": "H", "paragraphs": ["x"]}]') $$),
  '23514', 'AC-1: the version format is checked');
SELECT is(pg_temp.err($$ INSERT INTO public.agreement_templates (region, version, body, active)
                         VALUES ('TR', 'draft-9', '[{"heading": "H", "paragraphs": ["x"]}]', true) $$),
  '23505', 'AC-1: at most one active template per region');
SELECT is(pg_temp.err($$ UPDATE public.agreement_templates SET body = '[{"heading": "H", "paragraphs": ["x"]}]' WHERE version = 'draft-1' $$),
  'agreement_final', 'AC-11: a template''s body never changes, for the owner too');
SELECT is(pg_temp.err($$ DELETE FROM public.agreement_templates WHERE version = 'draft-1' $$),
  'agreement_final', 'AC-11: a template is never deleted');
SELECT is(pg_temp.err($$ TRUNCATE public.agreement_templates CASCADE $$),
  'agreement_final', 'AC-11: nor truncated');
SELECT is(pg_temp.probe(ARRAY[$$ UPDATE public.agreement_templates SET active = false WHERE version = 'draft-1' $$],
                        $$ SELECT active::text FROM public.agreement_templates WHERE version = 'draft-1' $$),
  'false', 'AC-11: only active may change');

-- The read.
SELECT is(pg_temp.call_as('c1', $$ SELECT public.agreement_template(NULL) ->> 'version' $$), 'draft-1',
  'AC-1: a signed in user reads the active template');
SELECT is(pg_temp.call_as('a1', $$ SELECT jsonb_array_length(public.agreement_template('draft-1') -> 'sections')::text $$), '7',
  'AC-12: and a named version, with its sections');
SELECT is(pg_temp.call_as('c1', $$ SELECT public.agreement_template('nope')::text $$), 'not_found',
  'AC-12: an unknown version is not_found');
SELECT is(pg_temp.call_as('anon', $$ SELECT public.agreement_template(NULL)::text $$), '42501',
  'AC-1: anon cannot read it');

-- ══ AC-2: the customer's acceptance in pay_commission ════════════════════════
SELECT pg_temp.base(1, 10000);
SELECT pg_temp.as_user('c1');
SELECT public.choose_provider(pg_temp.r(1), pg_temp.app(1, 'a1'));
SELECT is(pg_temp.call_as('c1', format('SELECT public.pay_commission(%L, %L, NULL)::text', pg_temp.r(1), 'tr')),
  'agreement_required', 'AC-2: no version, no payment');
SELECT is(pg_temp.call_as('c1', format('SELECT public.pay_commission(%L, %L, NULL, %L)::text', pg_temp.r(1), 'tr', 'draft-0')),
  'agreement_required', 'AC-2: a version that is not the active one is refused');
SELECT is((SELECT count(*)::integer FROM public.fee_payments WHERE request_id = pg_temp.r(1)), 0,
  'AC-2: a refused pay opened no fee');
SELECT is(pg_temp.probe(ARRAY[$$ ALTER TABLE public.requests DISABLE TRIGGER requests_guard $$,
                              format($$ UPDATE public.requests SET selected_at = now() - interval '2 hours', payment_deadline = now() - interval '1 minute' WHERE id = %L $$, pg_temp.r(1)),
                              $$ ALTER TABLE public.requests ENABLE TRIGGER requests_guard $$],
                        format('SELECT pg_temp.call_as(%L, %L)', 'c1', format('SELECT public.pay_commission(%L, %L, NULL)::text', pg_temp.r(1), 'tr'))),
  'deadline_passed', 'X-5: the deadline check comes before the agreement');
SELECT is(pg_temp.call_as('c2', format('SELECT public.pay_commission(%L, %L, NULL)::text', pg_temp.r(1), 'tr')),
  'not_found', 'X-5: the caller check comes before the agreement');
SELECT is(pg_temp.call_as('c1', format('SELECT public.pay_commission(%L, %L, NULL, %L) ->> %L', pg_temp.r(1), 'tr', 'draft-1', 'status')),
  'checkout', 'AC-2: the active version opens the card page');
SELECT is((SELECT role || ' ' || (user_id = pg_temp.u('c1')) || ' ' || (template_id = public.active_agreement_template('TR'))
             FROM public.agreement_acceptances WHERE application_id = pg_temp.app(1, 'a1')),
  'customer true true', 'AC-2: the customer''s acceptance of the active template, for the pick');
CREATE TEMP TABLE acc1 AS SELECT accepted_at FROM public.agreement_acceptances WHERE application_id = pg_temp.app(1, 'a1');
SELECT pg_temp.call_as('c1', format('SELECT public.pay_commission(%L, %L, NULL, %L)::text', pg_temp.r(1), 'tr', 'draft-1'));
SELECT is((SELECT count(*)::integer FROM public.agreement_acceptances WHERE application_id = pg_temp.app(1, 'a1')), 1,
  'AC-2: a replay keeps one acceptance');
SELECT is((SELECT accepted_at FROM public.agreement_acceptances WHERE application_id = pg_temp.app(1, 'a1')),
  (SELECT accepted_at FROM acc1), 'AC-2: and the first one''s time');
SELECT is(pg_temp.err(format($$ UPDATE public.agreement_acceptances SET accepted_at = now() WHERE application_id = %L $$, pg_temp.app(1, 'a1'))),
  'agreement_final', 'AC-11: an acceptance never changes, for the owner too');
SELECT is(pg_temp.err(format($$ DELETE FROM public.agreement_acceptances WHERE application_id = %L $$, pg_temp.app(1, 'a1'))),
  'agreement_final', 'AC-11: nor is it deleted');
SELECT is(pg_temp.err($$ TRUNCATE public.agreement_acceptances $$), 'agreement_final', 'AC-11: nor truncated');
SELECT is(pg_temp.call_as('c1', format('SELECT public.my_accepted_agreement(%L)', pg_temp.r(1))), 'draft-1',
  'Try again: the customer reads the version they accepted for the pick');
SELECT is(pg_temp.call_as('c2', format('SELECT coalesce(public.my_accepted_agreement(%L), %L)', pg_temp.r(1), 'none')), 'none',
  'Try again: a stranger reads nothing');
SELECT is(pg_temp.call_as('a1', format('SELECT coalesce(public.my_accepted_agreement(%L), %L)', pg_temp.r(1), 'none')), 'none',
  'Try again: the provider reads no customer acceptance as theirs');
SELECT is(pg_temp.call_as('c1', format($$ SELECT count(*)::text FROM public.agreement_acceptances WHERE request_id = %L $$, pg_temp.r(1))),
  '1', 'RLS: the customer reads their own acceptance');
SELECT is(pg_temp.call_as('c2', $$ SELECT count(*)::text FROM public.agreement_acceptances $$), '0',
  'RLS: a stranger reads none');
SELECT is(pg_temp.call_as('a1', $$ SELECT count(*)::text FROM public.agreement_acceptances $$), '0',
  'RLS: the provider does not read the customer''s acceptance');
SELECT is(pg_temp.call_as('ad', format($$ SELECT count(*)::text FROM public.agreement_acceptances WHERE request_id = %L $$, pg_temp.r(1))),
  '1', 'RLS: admin reads every acceptance');

-- A commission of 0 settles at once, with its acceptance stored (D171).
SELECT pg_temp.base(2, 0);
SELECT pg_temp.as_user('c1');
SELECT public.choose_provider(pg_temp.r(2), pg_temp.app(2, 'a1'));
SELECT is(pg_temp.call_as('c1', format('SELECT public.pay_commission(%L, %L, NULL)::text', pg_temp.r(2), 'tr')),
  'agreement_required', 'X-5: a commission of 0 needs the agreement too');
SELECT is(pg_temp.call_as('c1', format('SELECT public.pay_commission(%L, %L, NULL, %L) ->> %L', pg_temp.r(2), 'tr', 'draft-1', 'status')),
  'settled', 'AC-2: then it settles');
SELECT is((SELECT count(*)::integer FROM public.agreement_acceptances WHERE application_id = pg_temp.app(2, 'a1') AND role = 'customer'), 1,
  'AC-2: with the customer''s acceptance stored');
SELECT is(pg_temp.call_as('c1', format('SELECT public.pay_commission(%L, %L, NULL)::text', pg_temp.r(2), 'tr')),
  'already_paid', 'X-5: already_paid comes before the agreement check');

-- ══ AC-3: the provider's acceptance in pay_provider_fee ══════════════════════
-- A provider fee of 0 too (D171), so the reveal below runs in the request path (X-1).
ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
UPDATE public.applications SET provider_fee_amount = 0 WHERE id = pg_temp.app(2, 'a1');
ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
SELECT is(pg_temp.call_as('a1', format('SELECT public.pay_provider_fee(%L, %L, NULL)::text', pg_temp.app(2, 'a1'), 'tr')),
  'agreement_required', 'AC-3: no version, no fee');
SELECT is(pg_temp.call_as('a2', format('SELECT public.pay_provider_fee(%L, %L, NULL, %L)::text', pg_temp.app(2, 'a1'), 'tr', 'draft-1')),
  'not_found', 'AC-3: another provider is not_found first');
SELECT is(pg_temp.call_as('a1', $$ SELECT (r ->> 'agreement_version') FROM jsonb_array_elements(public.provider_jobs('chosen', NULL, NULL) -> 'rows') r
                                    WHERE r ->> 'application_id' = '00000000-0000-0000-0000-000000428102' $$),
  'draft-1', 'AC-3: provider_jobs returns the version the customer accepted');
-- The template changes after the customer accepted: the provider stays bound to draft-1.
UPDATE public.agreement_templates SET active = false WHERE version = 'draft-1';
INSERT INTO public.agreement_templates (region, version, body, active)
VALUES ('TR', 'draft-x2', '[{"heading": "[draft] İki", "paragraphs": ["[draft] {{customer_name}} ve {{provider_name}}."]}]', true);
SELECT is(pg_temp.call_as('a1', format('SELECT public.pay_provider_fee(%L, %L, NULL, %L)::text', pg_temp.app(2, 'a1'), 'tr', 'draft-x2')),
  'agreement_required', 'AC-3: the new active version is refused; the customer''s binds');
SELECT is(pg_temp.call_as('a1', format('SELECT public.pay_provider_fee(%L, %L, NULL, %L) ->> %L', pg_temp.app(2, 'a1'), 'tr', 'draft-1', 'status')),
  'settled', 'AC-3: the customer''s version, no longer active, is accepted (a fee of 0 settles at once)');
UPDATE public.agreement_templates SET active = false WHERE version = 'draft-x2';
UPDATE public.agreement_templates SET active = true WHERE version = 'draft-1';
SELECT is((SELECT string_agg(c.role || ':' || t.version, ' ' ORDER BY c.role) FROM public.agreement_acceptances c
             JOIN public.agreement_templates t ON t.id = c.template_id WHERE c.application_id = pg_temp.app(2, 'a1')),
  'customer:draft-1 provider:draft-1', 'AC-3: both sides accepted the one text');

-- ══ AC-5: the row and the outbox job at the reveal ═══════════════════════════
CREATE TEMP TABLE ag2 AS SELECT s.* FROM public.service_agreements s WHERE s.request_id = pg_temp.r(2);
GRANT SELECT ON ag2 TO authenticated, service_role;
SELECT is((SELECT count(*)::integer FROM ag2), 1, 'AC-5: the reveal of a fee of 0 made one agreement (X-1)');
SELECT ok((SELECT number ~ ('^HS-TR-' || to_char(now() AT TIME ZONE 'Europe/Istanbul', 'YYYY') || '-[0-9]{6}$') FROM ag2),
  'AC-5: numbered HS-TR-<year in Istanbul>-<6 digits>');
SELECT is((SELECT (application_id = pg_temp.app(2, 'a1')) AND rendered_at IS NULL AND storage_path IS NULL FROM ag2), true,
  'AC-5: for the pick, not rendered yet');
SELECT is((SELECT array_agg(k ORDER BY k) FROM ag2, jsonb_object_keys(content) k),
  ARRAY['addon_names', 'agreement_date', 'agreement_number', 'cash_due', 'category_name', 'commission', 'currency',
        'customer_accepted_at', 'customer_address', 'customer_directions', 'customer_name', 'customer_phone', 'district',
        'job_price', 'platform_name',
        'provider_accepted_at', 'provider_address', 'provider_fee', 'provider_name', 'provider_phone', 'scheduled_end', 'scheduled_start',
        'service_name', 'street_line', 'template_version', 'timezone', 'unlocked_at'],
  'AC-5: content holds every template field (and the time zone and the reveal time)');
SELECT is((SELECT jsonb_build_object('customer_name', content -> 'customer_name', 'customer_phone', content -> 'customer_phone',
                                     'provider_name', content -> 'provider_name', 'provider_phone', content -> 'provider_phone',
                                     'platform_name', content -> 'platform_name', 'service_name', content -> 'service_name',
                                     'category_name', content -> 'category_name', 'addon_names', content -> 'addon_names',
                                     'district', content -> 'district', 'street_line', content -> 'street_line',
                                     'job_price', content -> 'job_price', 'commission', content -> 'commission',
                                     'cash_due', content -> 'cash_due', 'currency', content -> 'currency',
                                     'template_version', content -> 'template_version') FROM ag2),
  '{"customer_name": "Ayşe Müşteri", "customer_phone": "+905559420001", "provider_name": "İlker Usta Temizlik",
    "provider_phone": "+905559420003", "platform_name": "Aldebyani", "service_name": "Temizlik", "category_name": "Ev",
    "addon_names": ["Cam", "Oven"], "district": "Moda", "street_line": "Moda Cad. No 9 Daire 4", "job_price": 100000,
    "commission": 0, "cash_due": 100000, "currency": "TRY", "template_version": "draft-1"}'::jsonb,
  'AC-5: frozen plain values from the rows the reveal reads (Turkish names, else English)');
SELECT is((SELECT jsonb_typeof(content -> 'provider_fee') || ' ' || jsonb_typeof(content -> 'scheduled_start') FROM ag2),
  'number string', 'AC-5: figures stay minor unit numbers, times stay instants');
SELECT is((SELECT kind || ' ' || (payload ->> 'agreement_id' = (SELECT id::text FROM ag2)) FROM public.outbox_events
            WHERE idempotency_key = 'agreement.render:' || (SELECT id FROM ag2) || ':1'),
  'agreement.render true', 'AC-5: the render is queued under key :1');
SELECT is((SELECT status FROM public.requests WHERE id = pg_temp.r(2)), 'UNLOCKED', 'AC-5: the reveal itself went through');

-- A pick unlocked without both acceptances (an old job): no row, a gap the heartbeat alerts, and the reveal still moves.
SELECT pg_temp.base(3, 0);
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
UPDATE public.applications SET status = 'AWAITING_FEE', provider_fee_amount = 0, provider_fee_kind = 'percent'
 WHERE id = pg_temp.app(3, 'a1');
UPDATE public.requests SET status = 'COMMISSION_PAID', selected_application_id = pg_temp.app(3, 'a1'), selected_at = now(),
       fee_deadline = now() + interval '1 day' WHERE id = pg_temp.r(3);
ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
SELECT lives_ok(format('SELECT public.provider_fee_settled(%L)', pg_temp.r(3)), 'AC-5: the reveal never fails for the agreement');
SELECT is((SELECT status FROM public.requests WHERE id = pg_temp.r(3)), 'UNLOCKED', 'AC-5: it unlocked');
SELECT is((SELECT count(*)::integer FROM public.service_agreements WHERE request_id = pg_temp.r(3)), 0,
  'AC-5: without both acceptances there is no agreement');
SELECT ok(public.agreement_gaps() @> jsonb_build_array(jsonb_build_object('application_id', pg_temp.app(3, 'a1'), 'region', 'TR')),
  'AC-5: and the heartbeat''s gap list names the pick');
SELECT ok(NOT public.agreement_gaps() @> jsonb_build_array(jsonb_build_object('application_id', pg_temp.app(2, 'a1'), 'region', 'TR')),
  'AC-5: a pick with its agreement is no gap');

-- ══ AC-11: the agreement row's guard ═════════════════════════════════════════
SELECT is(pg_temp.err(format($$ UPDATE public.service_agreements SET content = '{}' WHERE request_id = %L $$, pg_temp.r(2))),
  'agreement_final', 'AC-11: content never changes');
SELECT is(pg_temp.err(format($$ UPDATE public.service_agreements SET number = 'HS-TR-2026-999999' WHERE request_id = %L $$, pg_temp.r(2))),
  'agreement_final', 'AC-11: nor the number');
SELECT is(pg_temp.err(format($$ UPDATE public.service_agreements SET storage_path = 'TR/2026/x.pdf' WHERE request_id = %L $$, pg_temp.r(2))),
  'agreement_final', 'AC-11: the file fields only together, and only once');
SELECT is(pg_temp.err(format($$ DELETE FROM public.service_agreements WHERE request_id = %L $$, pg_temp.r(2))),
  'agreement_final', 'AC-11: never deleted, for the owner too');
SELECT is(pg_temp.err($$ TRUNCATE public.service_agreements $$), 'agreement_final', 'AC-11: nor truncated');

-- ══ AC-6, AC-8: the render context, the file, finish, mail and notices ═══════
SELECT is(pg_temp.call_as('service', format($$ SELECT (public.agreement_render_context(%L) -> 'content' ->> 'street_line') $$, (SELECT id FROM ag2))),
  'Moda Cad. No 9 Daire 4', 'AC-6: the relay reads the frozen content');
SELECT is(pg_temp.call_as('service', format($$ SELECT public.agreement_render_context(%L) ->> 'template_version' $$, (SELECT id FROM ag2))),
  'draft-1', 'AC-6: and the accepted template');
SELECT is(pg_temp.call_as('c1', format($$ SELECT public.agreement_render_context(%L)::text $$, (SELECT id FROM ag2))),
  '42501', 'AC-6: only the service role reads it');
CREATE TEMP TABLE path2 AS SELECT 'TR/' || to_char(now() AT TIME ZONE 'Europe/Istanbul', 'YYYY') || '/' || (SELECT id FROM ag2) || '-r1.pdf' AS p;
GRANT SELECT ON path2 TO authenticated, service_role;
SELECT is(pg_temp.call_as('service', format($$ SELECT public.finish_agreement_render(%L, %L, %L, 2048)::text $$,
                                            (SELECT id FROM ag2), (SELECT p FROM path2), repeat('a', 64))),
  'validation_failed', 'AC-6: finish refuses a path with no stored object');
SELECT is(pg_temp.call_as('c1', format($$ INSERT INTO storage.objects (bucket_id, name) VALUES ('service-agreements', %L) RETURNING 'x' $$,
                                       (SELECT p FROM path2))),
  '42501', 'AC-11: a signed in user cannot upload an agreement');
SELECT is(pg_temp.call_as('service', $$ INSERT INTO storage.objects (bucket_id, name) VALUES ('service-agreements', 'TR/2026/not-an-agreement.pdf') RETURNING 'x' $$),
  '42501', 'AC-11: the relay cannot upload under any other name');
SELECT is(pg_temp.call_as('service', format($$ INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('service-agreements', %L, '{"size": 2048}') RETURNING 'stored' $$,
                                            (SELECT p FROM path2))),
  'stored', 'AC-6: the relay uploads to the agreement''s path');
SELECT is(pg_temp.call_as('service', format($$ SELECT public.finish_agreement_render(%L, %L, %L, 2048) ->> 'status' $$,
                                            (SELECT id FROM ag2), (SELECT p FROM path2), repeat('a', 64))),
  'rendered', 'AC-6: finish sets the file fields');
SELECT is((SELECT storage_path = (SELECT p FROM path2) AND sha256 = repeat('a', 64) AND byte_size = 2048 AND rendered_at IS NOT NULL
             FROM public.service_agreements WHERE id = (SELECT id FROM ag2)), true, 'AC-6: all four, together');
SELECT is((SELECT string_agg(payload ->> 'template' || ':' || (payload ->> 'recipient_id' = CASE WHEN payload ->> 'template' = 'agreement_ready_customer'
                                                                                              THEN pg_temp.u('c1') ELSE pg_temp.u('a1') END::text), ' '
                             ORDER BY idempotency_key)
             FROM public.outbox_events WHERE idempotency_key LIKE 'agreement:' || (SELECT id FROM ag2) || ':%'),
  'agreement_ready_customer:true agreement_ready_provider:true', 'AC-8: one mail per side, keyed agreement:<id>:<role>');
SELECT is((SELECT string_agg(recipient_id::text, ' ' ORDER BY recipient_id) FROM public.notifications
            WHERE kind = 'agreement_ready' AND entity_id = (SELECT id FROM ag2)),
  pg_temp.u('a1') || ' ' || pg_temp.u('c1'), 'AC-8: and one notice per side');
SELECT is(pg_temp.call_as('service', format($$ SELECT public.finish_agreement_render(%L, %L, %L, 2048) ->> 'replayed' $$,
                                            (SELECT id FROM ag2), (SELECT p FROM path2), repeat('b', 64))),
  'true', 'AC-6: a replay does nothing');
SELECT is((SELECT sha256 FROM public.service_agreements WHERE id = (SELECT id FROM ag2)), repeat('a', 64),
  'AC-6: the file fields stay as first set');
SELECT is((SELECT count(*)::integer FROM public.outbox_events WHERE idempotency_key LIKE 'agreement:' || (SELECT id FROM ag2) || ':%'), 2,
  'AC-8: no second mail');
SELECT is(pg_temp.err(format($$ UPDATE public.service_agreements SET sha256 = repeat('c', 64) WHERE id = %L $$, (SELECT id FROM ag2))),
  'agreement_final', 'AC-11: the file fields never change once set');
SELECT is(pg_temp.call_as('service', format($$ SELECT public.fail_agreement_render(%L) ->> 'status' $$, (SELECT id FROM ag2))),
  'rendered', 'AC-7: a rendered agreement cannot be marked failed');

-- The mail's send time answer.
SELECT is((SELECT public.email_context(id) #>> '{values,agreement_number}' FROM public.outbox_events
            WHERE idempotency_key = 'agreement:' || (SELECT id FROM ag2) || ':customer'),
  (SELECT number FROM ag2), 'AC-8: email_context names the agreement number');
SELECT is((SELECT (public.email_context(id) -> 'values' ? 'storage_path')::text || ' ' || (public.email_context(id)::text LIKE '%.pdf%')::text
             FROM public.outbox_events WHERE idempotency_key = 'agreement:' || (SELECT id FROM ag2) || ':provider'),
  'false false', 'AC-8: and never a path');

-- ══ AC-9: the parties' card and download ═════════════════════════════════════
SELECT is(pg_temp.call_as('c1', format('SELECT public.agreement_visible(%L)::text', (SELECT id FROM ag2))), 'true', 'AC-9: the customer sees it');
SELECT is(pg_temp.call_as('a1', format('SELECT public.agreement_visible(%L)::text', (SELECT id FROM ag2))), 'true', 'AC-9: the provider sees it');
SELECT is(pg_temp.call_as('c2', format('SELECT public.agreement_visible(%L)::text', (SELECT id FROM ag2))), 'false', 'AC-9: a stranger does not');
SELECT is(pg_temp.call_as('a2', format('SELECT public.agreement_visible(%L)::text', (SELECT id FROM ag2))), 'false',
  'AC-9: the other applicant does not');
SELECT is(pg_temp.call_as('c1', format('SELECT public.my_agreement(%L) - %L', pg_temp.r(2), 'id')),
  jsonb_build_object('number', (SELECT number FROM ag2), 'side', 'customer', 'opened', false)::text, 'AC-9: my_agreement for the card');
SELECT is(pg_temp.call_as('c2', format('SELECT coalesce(public.my_agreement(%L)::text, %L)', pg_temp.r(2), 'null')), 'null',
  'AC-9: nothing for a stranger');
SELECT is(pg_temp.call_as('c2', format('SELECT public.open_service_agreement(%L)::text', (SELECT id FROM ag2))), 'not_found',
  'AC-9: a stranger cannot open it');
SELECT is(pg_temp.call_as('c1', format('SELECT public.agreement_read_allowed(%L)::text', (SELECT p FROM path2))), 'false',
  'AC-9: the bucket refuses the customer before the open');
SELECT is(pg_temp.call_as('c1', format('SELECT public.open_service_agreement(%L) ->> %L', (SELECT id FROM ag2), 'storage_path')),
  (SELECT p FROM path2), 'AC-9: open returns the path in the same call');
SELECT ok((SELECT customer_opened_at IS NOT NULL AND provider_opened_at IS NULL FROM public.service_agreements WHERE id = (SELECT id FROM ag2)),
  'AC-9: and stamps the customer''s side only');
SELECT is(pg_temp.call_as('c1', format('SELECT public.agreement_read_allowed(%L)::text', (SELECT p FROM path2))), 'true',
  'AC-9: the bucket lets the customer read for 10 minutes');
SELECT is(pg_temp.call_as('a1', format('SELECT public.agreement_read_allowed(%L)::text', (SELECT p FROM path2))), 'false',
  'AC-9: not the provider, who has not opened it');
SELECT is(pg_temp.call_as('c2', format('SELECT public.agreement_read_allowed(%L)::text', (SELECT p FROM path2))), 'false',
  'AC-9: nor a stranger');
CREATE TEMP TABLE opened2 AS SELECT customer_opened_at FROM public.service_agreements WHERE id = (SELECT id FROM ag2);
SELECT pg_temp.call_as('c1', format('SELECT public.open_service_agreement(%L)::text', (SELECT id FROM ag2)));
SELECT is((SELECT customer_opened_at FROM public.service_agreements WHERE id = (SELECT id FROM ag2)), (SELECT customer_opened_at FROM opened2),
  'AC-9: a second open keeps the first time (Download again)');
SELECT is(pg_temp.call_as('c1', format('SELECT (public.my_agreement(%L) ->> %L)', pg_temp.r(2), 'opened')), 'true',
  'AC-9: the card knows it was opened');
SELECT is(pg_temp.err(format($$ UPDATE public.service_agreements SET customer_opened_at = now() + interval '1 second' WHERE id = %L $$, (SELECT id FROM ag2))),
  'agreement_final', 'AC-11: an opened time is set once');
SELECT is(pg_temp.probe(ARRAY[$$ ALTER TABLE public.service_agreements DISABLE TRIGGER service_agreements_guard $$,
                              format($$ UPDATE public.service_agreements SET customer_opened_at = now() - interval '11 minutes',
                                        created_at = now() - interval '1 hour' WHERE id = %L $$, (SELECT id FROM ag2))],
                        format('SELECT pg_temp.call_as(%L, %L) || pg_temp.call_as(%L, %L)', 'c1', format('SELECT public.agreement_visible(%L)::text', (SELECT id FROM ag2)),
                               'c1', format('SELECT public.agreement_read_allowed(%L)::text', (SELECT p FROM path2)))),
  'falsefalse', 'AC-9: 10 minutes after the open, the card and the link are gone');
SELECT is(pg_temp.probe(ARRAY[$$ ALTER TABLE public.service_agreements DISABLE TRIGGER service_agreements_guard $$,
                              format($$ UPDATE public.service_agreements SET rendered_at = now() - interval '7 days 1 minute',
                                        created_at = now() - interval '8 days' WHERE id = %L $$, (SELECT id FROM ag2))],
                        format('SELECT pg_temp.call_as(%L, %L)', 'a1', format('SELECT public.agreement_visible(%L)::text', (SELECT id FROM ag2)))),
  'false', 'AC-9: 7 days after the render, the unopened card is gone too');
SELECT is(pg_temp.call_as('a1', format('SELECT public.my_agreement(%L) ->> %L', pg_temp.r(2), 'side')), 'provider',
  'AC-9: the provider''s card');

-- ══ AC-10: admin ═════════════════════════════════════════════════════════════
SELECT is(pg_temp.call_as('c1', $$ SELECT public.admin_agreements(NULL, NULL)::text $$), 'forbidden', 'AC-10: admin only');
SELECT is(pg_temp.call_as('ad', format($$ SELECT (public.admin_agreements(%L, NULL) -> 'rows' -> 0 ->> 'number') $$,
                                       right((SELECT number FROM ag2), 6))),
  (SELECT number FROM ag2), 'AC-10: searchable by number');
SELECT is(pg_temp.call_as('ad', format($$ SELECT (public.admin_agreements(%L, NULL) -> 'rows' -> 0 ->> 'customer_name')
                                                 || ' ' || (public.admin_agreements(%L, NULL) -> 'rows' -> 0 ->> 'request_status') $$,
                                       pg_temp.r(2), upper(pg_temp.r(2)::text))),
  'Ayşe Müşteri UNLOCKED', 'AC-10: and by request id, with the frozen names and the live status');
SELECT is(pg_temp.call_as('ad', format('SELECT public.agreement_read_allowed(%L)::text', (SELECT p FROM path2))), 'false',
  'AC-10: no link for admin before the view is audited');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_agreement_link(%L) ->> %L', (SELECT id FROM ag2), 'path')),
  (SELECT p FROM path2), 'AC-10: the view returns the path');
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE action = 'agreement.viewed' AND actor_id = pg_temp.u('ad')
            AND entity_id = (SELECT id::text FROM ag2)), 1, 'AC-10: after writing its audit row');
SELECT is(pg_temp.call_as('ad', format('SELECT public.agreement_read_allowed(%L)::text', (SELECT p FROM path2))), 'true',
  'AC-10: then the bucket lets that admin read');
SELECT is(pg_temp.call_as('d2', format('SELECT public.agreement_read_allowed(%L)::text', (SELECT p FROM path2))), 'false',
  'AC-10: not another admin without their own view');
SELECT is(pg_temp.call_as('a1', format('SELECT public.admin_agreement_link(%L)::text', (SELECT id FROM ag2))), 'forbidden',
  'AC-10: a party cannot use the admin view');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_rerender_agreement(%L)::text', (SELECT id FROM ag2))), 'invalid_state',
  'AC-7: a rendered agreement is not rendered again');

-- A failed render, then render again (AC-7).
SELECT pg_temp.revealed(4);
CREATE TEMP TABLE ag4 AS SELECT s.* FROM public.service_agreements s WHERE s.request_id = pg_temp.r(4);
GRANT SELECT ON ag4 TO authenticated, service_role;
SELECT is((SELECT content ->> 'commission' || ' ' || ((content ->> 'provider_fee')::bigint > 0)::text FROM ag4), '10000 true',
  'AC-5: a reveal through two verified payments makes its agreement too');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_rerender_agreement(%L)::text', (SELECT id FROM ag4))), 'invalid_state',
  'AC-7: a queued (not failed) agreement is not rendered again');
SELECT is(pg_temp.call_as('service', format('SELECT public.fail_agreement_render(%L) ->> %L', (SELECT id FROM ag4), 'status')), 'failed',
  'AC-7: the last failed try marks it failed');
SELECT is(pg_temp.call_as('ad', format($$ SELECT (r ->> 'failed') FROM jsonb_array_elements(public.admin_agreements(%L, NULL) -> 'rows') r $$, pg_temp.r(4))),
  'true', 'AC-10: the admin list shows it failed');
-- The relay ended attempt 1 as failed (its last try).
UPDATE public.outbox_events SET status = 'failed', next_attempt_at = NULL
 WHERE idempotency_key = 'agreement.render:' || (SELECT id FROM ag4) || ':1';
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_rerender_agreement(%L) ->> %L', (SELECT id FROM ag4), 'attempt')), '2',
  'AC-7: render again queues attempt 2');
SELECT is((SELECT count(*)::integer FROM public.outbox_events WHERE idempotency_key = 'agreement.render:' || (SELECT id FROM ag4) || ':2'), 1,
  'AC-7: under key :2 (a new object path)');
SELECT is((SELECT failed_at IS NULL AND content = (SELECT content FROM ag4) FROM public.service_agreements WHERE id = (SELECT id FROM ag4)), true,
  'AC-7: queued again, with the same frozen content');
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE action = 'agreement.rerender_requested' AND entity_id = (SELECT id::text FROM ag4)), 1,
  'AC-7: audited');
SELECT is(pg_temp.call_as('c1', format($$ SELECT public.email_context(o.id)::text FROM public.outbox_events o LIMIT 1 $$)), '42501',
  'AC-8: email_context stays the relay''s');

-- ══ AC-4: the carried re-pick ════════════════════════════════════════════════
SELECT pg_temp.paid_commission(5);
ALTER TABLE public.requests DISABLE TRIGGER requests_guard;
UPDATE public.requests SET selected_at = now() - interval '5 hours', payment_deadline = now() - interval '4 hours',
       fee_deadline = now() - interval '1 hour' WHERE id = pg_temp.r(5);
ALTER TABLE public.requests ENABLE TRIGGER requests_guard;
SELECT is(public.expire_request(pg_temp.r(5)), 'reopened', 'AC-4: the fee window expires and the commission carries');
SELECT is(pg_temp.call_as('c1', format('SELECT public.request_offers(%L) ->> %L', pg_temp.r(5), 'carried')), 'true',
  'AC-4: request_offers says the commission carries');
SELECT is(pg_temp.call_as('c1', format('SELECT public.request_offers(%L) ->> %L', pg_temp.r(1), 'carried')), 'false',
  'AC-4: and not on a request without one');
SELECT is(pg_temp.call_as('c1', format('SELECT public.choose_provider(%L, %L)::text', pg_temp.r(5), pg_temp.app(5, 'a2'))),
  'agreement_required', 'AC-4: the carried re-pick needs the active version');
SELECT is((SELECT status FROM public.requests WHERE id = pg_temp.r(5)), 'OPEN', 'AC-4: and nothing moved');
SELECT is(pg_temp.call_as('c1', format('SELECT public.choose_provider(%L, %L, %L) ->> %L', pg_temp.r(5), pg_temp.app(5, 'a2'), 'draft-1', 'carried')),
  'true', 'AC-4: with it, the re-pick goes straight to the fee');
SELECT is((SELECT string_agg(a.provider_id::text || ':' || c.role, ' ' ORDER BY a.provider_id) FROM public.agreement_acceptances c
             JOIN public.applications a ON a.id = c.application_id WHERE c.request_id = pg_temp.r(5)),
  pg_temp.u('a1') || ':customer ' || pg_temp.u('a2') || ':customer', 'AC-4: a new acceptance for the new pick; the old one stays');

-- ══ AC-11: the bucket ════════════════════════════════════════════════════════
SELECT is((SELECT string_agg(policyname || ':' || cmd, ' ') FROM pg_policies
            WHERE schemaname = 'storage' AND tablename = 'objects' AND qual LIKE '%service-agreements%'),
  'service_agreements_read:SELECT', 'AC-11: the bucket has one read policy and nothing else');
SELECT is((SELECT public::text || ' ' || file_size_limit || ' ' || array_to_string(allowed_mime_types, ',') FROM storage.buckets WHERE id = 'service-agreements'),
  'false 1048576 application/pdf', 'AC-11: private, 1 MiB, PDF only');
SELECT is(pg_temp.err(format($$ DELETE FROM storage.objects WHERE bucket_id = 'service-agreements' AND name = %L $$, (SELECT p FROM path2))),
  '42501', 'AC-11: no role deletes an agreement file, the owner included');
SELECT is(pg_temp.err(format($$ UPDATE storage.objects SET metadata = '{}' WHERE bucket_id = 'service-agreements' AND name = %L $$, (SELECT p FROM path2))),
  '42501', 'AC-11: nor changes one');
SELECT is(pg_temp.call_as('service', format($$ DELETE FROM storage.objects WHERE bucket_id = 'service-agreements' AND name = %L RETURNING 'x' $$, (SELECT p FROM path2))),
  '42501', 'AC-11: the service role neither');

-- ══ Review fixes (20261205090000_service_agreement_fixes) ════════════════════
-- S20-1: no API role reads service_agreements directly; admin goes through the functions.
SELECT ok(NOT has_table_privilege('authenticated', 'public.service_agreements', 'SELECT'),
  'S20-1: authenticated has no read on service_agreements');
SELECT is(pg_temp.call_as('ad', $$ SELECT count(*)::text FROM public.service_agreements $$), '42501',
  'S20-1: admin cannot dump the frozen street lines and phones');
SELECT is(pg_temp.call_as('ad', format($$ SELECT (public.admin_agreements(%L, NULL) -> 'rows' -> 0 ->> 'timezone') $$, pg_temp.r(2))),
  'Europe/Istanbul', 'admin rows carry the region time zone');

-- S20-2: a provider suspended after the reveal loses the card, the open, the read and the mail.
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.providers SET status = 'suspended', suspension_reason = 'A test of the agreement' WHERE id = %L$q$, pg_temp.u('a1'))],
                        format('SELECT pg_temp.call_as(%L, %L) || pg_temp.call_as(%L, %L) || pg_temp.call_as(%L, %L)',
                               'a1', format('SELECT public.agreement_visible(%L)::text', (SELECT id FROM ag2)),
                               'a1', format('SELECT public.open_service_agreement(%L)::text', (SELECT id FROM ag2)),
                               'a1', format('SELECT public.agreement_read_allowed(%L)::text', (SELECT p FROM path2)))),
  'falsenot_foundfalse', 'S20-2: a suspended provider gets no card, no open, no storage read');
SELECT is(pg_temp.probe(ARRAY[format($q$UPDATE public.providers SET status = 'suspended', suspension_reason = 'A test of the agreement' WHERE id = %L$q$, pg_temp.u('a1'))],
                        format($q$SELECT public.email_context(id) ->> 'reason' FROM public.outbox_events WHERE idempotency_key = 'agreement:%s:provider'$q$, (SELECT id FROM ag2))),
  'condition', 'S20-2: and no agreement mail');
SELECT is(pg_temp.call_as('c1', format('SELECT public.agreement_visible(%L)::text', (SELECT id FROM ag2))), 'true',
  'S20-6: the customer of a live job still sees the card');
SELECT is(pg_temp.probe(ARRAY[$$ ALTER TABLE public.requests DISABLE TRIGGER requests_guard $$,
                              format($$ UPDATE public.requests SET status = 'CANCELLED', cancelled_at = now() - interval '30 days', closed_at = now() - interval '30 days', closed_by = 'admin', cancelled_by = 'admin' WHERE id = %L $$, pg_temp.r(2)),
                              $$ ALTER TABLE public.requests ENABLE TRIGGER requests_guard $$],
                        format('SELECT pg_temp.call_as(%L, %L)', 'c1', format('SELECT public.agreement_visible(%L)::text', (SELECT id FROM ag2)))),
  'false', 'S20-6: past the contacts window the card is gone too');

-- S20-3: a failing agreement never rolls back the reveal.
SELECT pg_temp.base(6, 0);
SELECT pg_temp.as_user('c1');
SELECT public.choose_provider(pg_temp.r(6), pg_temp.app(6, 'a1'));
SELECT public.pay_commission(pg_temp.r(6), 'tr', NULL, 'draft-1');
ALTER TABLE public.applications DISABLE TRIGGER applications_guard;
UPDATE public.applications SET provider_fee_amount = 0 WHERE id = pg_temp.app(6, 'a1');
ALTER TABLE public.applications ENABLE TRIGGER applications_guard;
CREATE TEMP TABLE seq_before AS SELECT last_value, is_called FROM public.service_agreement_seq_tr;
SELECT setval('public.service_agreement_seq_tr', 999999, true);
SELECT is(pg_temp.call_as('a1', format('SELECT public.pay_provider_fee(%L, %L, NULL, %L) ->> %L', pg_temp.app(6, 'a1'), 'tr', 'draft-1', 'status')),
  'settled', 'S20-3: the fee settles although the agreement number has run out');
SELECT setval('public.service_agreement_seq_tr', (SELECT last_value FROM seq_before), (SELECT is_called FROM seq_before));
SELECT is((SELECT status FROM public.requests WHERE id = pg_temp.r(6)) || ' ' ||
          (SELECT count(*) FROM public.service_agreements WHERE request_id = pg_temp.r(6)),
  'UNLOCKED 0', 'S20-3: the reveal stands with no agreement, which the heartbeat alerts');

-- S20-4: a retry is bound to the version already accepted, even after the template changes.
SELECT pg_temp.base(7, 10000);
SELECT pg_temp.as_user('c1');
SELECT public.choose_provider(pg_temp.r(7), pg_temp.app(7, 'a1'));
SELECT pg_temp.call_as('c1', format('SELECT public.pay_commission(%L, %L, NULL, %L)::text', pg_temp.r(7), 'tr', 'draft-1'));
UPDATE public.agreement_templates SET active = false WHERE version = 'draft-1';
UPDATE public.agreement_templates SET active = true WHERE version = 'draft-x2';
SELECT is(pg_temp.call_as('c1', format('SELECT public.pay_commission(%L, %L, NULL, %L)::text', pg_temp.r(7), 'tr', 'draft-x2')),
  'agreement_required', 'S20-4: the new active version is refused once draft-1 was accepted for this pick');
SELECT is(pg_temp.call_as('c1', format('SELECT public.pay_commission(%L, %L, NULL, %L) ->> %L', pg_temp.r(7), 'tr', 'draft-1', 'status')),
  'checkout', 'S20-4: the accepted version still pays (the retry page offers it)');
UPDATE public.agreement_templates SET active = false WHERE version = 'draft-x2';
UPDATE public.agreement_templates SET active = true WHERE version = 'draft-1';

-- S20-5 and the single alert: no re-render while one is queued; a second failure does not alert again.
SELECT is(pg_temp.call_as('service', format('SELECT public.fail_agreement_render(%L) ->> %L', (SELECT id FROM ag4), 'status')), 'failed',
  'the queued attempt 2 fails');
SELECT is(pg_temp.call_as('service', format('SELECT public.fail_agreement_render(%L) ->> %L', (SELECT id FROM ag4), 'status')), 'already_failed',
  'a second failure reports already_failed, so the relay alerts once');
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_rerender_agreement(%L)::text', (SELECT id FROM ag4))), 'invalid_state',
  'S20-5: no re-render while attempt 2 is still queued');
UPDATE public.outbox_events SET status = 'failed', next_attempt_at = NULL
 WHERE idempotency_key = 'agreement.render:' || (SELECT id FROM ag4) || ':2';
SELECT is(pg_temp.call_as('ad', format('SELECT public.admin_rerender_agreement(%L) ->> %L', (SELECT id FROM ag4), 'attempt')), '3',
  'S20-5: once it ended, attempt 3 is queued');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'service_agreements_storage_path_idx'),
  'the storage read check has its index');

-- ══ grants ═══════════════════════════════════════════════════════════════════
SELECT ok(NOT has_function_privilege('authenticated', 'public.finish_agreement_render(uuid, text, text, integer)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.fail_agreement_render(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.agreement_gaps()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.queue_agreement(uuid, uuid)', 'EXECUTE')
          AND NOT has_function_privilege('service_role', 'public.queue_agreement(uuid, uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.record_acceptance(uuid, uuid, uuid, text, uuid)', 'EXECUTE'),
  'grants: the relay''s and the internal functions are not the API''s');
SELECT ok(has_function_privilege('service_role', 'public.finish_agreement_render(uuid, text, text, integer)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.agreement_render_context(uuid)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.agreement_gaps()', 'EXECUTE'),
  'grants: the relay may call its three');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                       WHERE n.nspname = 'public' AND p.proname IN ('pay_commission', 'pay_provider_fee', 'choose_provider')
                         AND pg_get_function_identity_arguments(p.oid) NOT LIKE '%p_agreement_version text'),
  'AC-2 to AC-4: no old overload is left');

SELECT * FROM finish();
ROLLBACK;
