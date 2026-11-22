-- Position 19b, spec 0011-19b: structured application answers.
--
-- Proves, as each caller: the application_questions table (its checks, the guard for every role, RLS, the grants,
-- the audit rows), what provider_request returns, every refusal of the new apply path in AC-4's order and that each
-- costs an attempt, the stored answers and snapshot (and that an admin edit never changes them), the one content
-- check and the guard on applications, the offer card (answers, a scanned answer hidden, message_hidden never null),
-- a suspended chosen provider's answers hidden, and the two argument call still resolving. The races (two sessions
-- through dblink) are in 41. Every figure and every text is fixture data. AC-1, AC-3 to AC-6, AC-9.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(100);

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000004000' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000004070' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.q(p text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.application_questions WHERE key = p AND category_id = '00000000-0000-0000-0000-0000004000ca' $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1 the customer, d1 and d2 admins, a1 to a6 approved providers with the same setup. K1 (ca) gets provider
-- questions; K2 (cb) never does. R1 to R4 are in K1, R5 and R6 in K2.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559400001'), ('d1', '905559400002'), ('d2', '905559400003'), ('a1', '905559400004'),
               ('a2', '905559400005'), ('a3', '905559400006'), ('a4', '905559400007'), ('a5', '905559400008'),
               ('a6', '905559400009')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'tr'
  FROM (VALUES ('c1', 'customer', '905559400001', 'FIXTURE_CUSTOMER'), ('d1', 'admin', '905559400002', 'Admin Bir'),
               ('d2', 'admin', '905559400003', 'Admin İki'), ('a1', 'provider', '905559400004', 'Ayşe Usta'),
               ('a2', 'provider', '905559400005', 'Mehmet Usta'), ('a3', 'provider', '905559400006', 'Veli Usta'),
               ('a4', 'provider', '905559400007', 'Deniz Usta'), ('a5', 'provider', '905559400008', 'Zeki Usta'),
               ('a6', 'provider', '905559400009', 'Ece Usta')) AS t(c, r, p, n);
UPDATE public.providers SET status = 'approved', approved_at = now() - interval '30 days', approved_name = 'Usta ' || right(id::text, 2)
 WHERE id::text LIKE '00000000-0000-0000-0000-0000004000a%';

INSERT INTO public.service_categories (id, region, name, active) VALUES
  (pg_temp.u('ca'), 'TR', '{"tr": "Tadilat", "en": "Repairs"}', true),
  (pg_temp.u('cb'), 'TR', '{"tr": "Bahçe", "en": "Garden"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active) VALUES
  (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Boya"}', 1, 2, true),
  (pg_temp.u('52'), pg_temp.u('cb'), 'TR', '{"tr": "Çim"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Semt"}', 1.00, true);
INSERT INTO public.provider_services (provider_id, service_id, region)
SELECT p.id, s.id, 'TR' FROM public.providers p, public.services s
 WHERE p.id::text LIKE '00000000-0000-0000-0000-0000004000a%' AND s.id IN (pg_temp.u('51'), pg_temp.u('52'));
INSERT INTO public.provider_zones (provider_id, zone_id, region)
SELECT id, pg_temp.u('21'), 'TR' FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000004000a%';
INSERT INTO public.provider_availability (provider_id, region, work_days, start_hour, end_hour)
SELECT id, 'TR', '{0,1,2,3,4,5,6}', 0, 24 FROM public.providers WHERE id::text LIKE '00000000-0000-0000-0000-0000004000a%';

CREATE FUNCTION pg_temp.req(p integer, p_service text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  VALUES (pg_temp.r(p), 'TR', pg_temp.u('c1'), gen_random_uuid(), pg_temp.u(p_service), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100}', 300000, 30000, 270000, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours')
  RETURNING id $$;
-- Room for every refusal below within the hourly limit.
UPDATE public.platform_settings SET value = '100' WHERE region = 'TR' AND key = 'applications_per_hour';
SELECT pg_temp.req(1, '51'), pg_temp.req(2, '51'), pg_temp.req(3, '51'), pg_temp.req(4, '51'),
       pg_temp.req(5, '52'), pg_temp.req(6, '52');

CREATE FUNCTION pg_temp.as_user(p text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(p), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'none';
EXCEPTION WHEN raise_exception THEN
  RETURN sqlerrm;
END;
$$;
CREATE FUNCTION pg_temp.version(p integer) RETURNS text LANGUAGE sql AS $$
  SELECT public.provider_request(pg_temp.r(p)) ->> 'questions_version' $$;
-- An apply with answers against the current version of the form.
CREATE FUNCTION pg_temp.ans(p integer, p_answers jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.apply_to_request(pg_temp.r(p), NULL, p_answers, pg_temp.version(p)) $$;
CREATE FUNCTION pg_temp.good() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"approach": "  I will bring two people and finish in one day.  ", "materials": "own", "insured": true}'::jsonb $$;
GRANT EXECUTE ON FUNCTION pg_temp.u(text), pg_temp.r(integer), pg_temp.q(text), pg_temp.as_user(text), pg_temp.err(text),
  pg_temp.version(integer), pg_temp.ans(integer, jsonb), pg_temp.good() TO authenticated;

-- ── the table (AC-1) ─────────────────────────────────────────────────────────
SELECT has_table('public', 'application_questions', 'application_questions exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.application_questions'::regclass), 'RLS is on');
SELECT policies_are('public', 'application_questions',
  ARRAY['application_questions_read_admin', 'application_questions_insert_admin', 'application_questions_update_admin'],
  'admin reads, inserts and updates; nobody deletes');
SELECT table_privs_are('public', 'application_questions', 'anon', ARRAY[]::text[], 'anon holds nothing');
SELECT table_privs_are('public', 'application_questions', 'service_role', ARRAY[]::text[], 'service_role holds nothing');
SELECT table_privs_are('public', 'application_questions', 'authenticated', ARRAY['SELECT'], 'signed in users only read, through RLS');
SELECT is((SELECT string_agg(c, ',' ORDER BY c) FROM unnest(ARRAY['key', 'type', 'category_id', 'region', 'id', 'created_at']) c
            WHERE has_column_privilege('authenticated', 'public.application_questions', c, 'UPDATE')), NULL,
  'no grant updates key, type, category, region, id or created_at');
SELECT is((SELECT string_agg(c, ',' ORDER BY c) FROM unnest(ARRAY['label', 'help_text', 'required', 'options', 'validation', 'display_order', 'active']) c
            WHERE has_column_privilege('authenticated', 'public.application_questions', c, 'UPDATE')),
  'active,display_order,help_text,label,options,required,validation', 'the editable columns update');
SELECT has_column('public', 'applications', 'answers', 'applications.answers exists');
SELECT has_column('public', 'applications', 'questions_snapshot', 'applications.questions_snapshot exists');
SELECT col_is_null('public', 'applications', 'message', 'message is nullable now');

-- Admin writes questions under RLS.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('d1');
SELECT lives_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, help_text, type, required, display_order)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'TR', 'approach', '{"tr": "Nasıl yaparsınız?", "en": "How will you do it?"}',
          '{"tr": "Birkaç satır.", "en": "A few lines."}', 'textarea', true, 1) $$, 'admin adds a text question');
SELECT lives_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type, required, options, display_order)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'TR', 'materials', '{"tr": "Malzeme", "en": "Materials"}', 'single_select', false,
          '[{"value": "own", "label": {"tr": "Benim", "en": "Mine"}}, {"value": "customer", "label": {"tr": "Müşteri", "en": "Yours"}}]', 2) $$,
  'a choice');
SELECT lives_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type, required, display_order)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'TR', 'insured', '{"tr": "Sigortalı mı?", "en": "Insured?"}', 'boolean', true, 3) $$,
  'and a yes or no');
SELECT lives_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type, validation, display_order)
  SELECT '00000000-0000-0000-0000-0000004000ca', 'TR', 'extra_' || g, '{"tr": "Ek"}', 'textarea', '{"maxLength": 300}', 10 + g
    FROM generate_series(1, 4) g $$, 'four more text questions');
SELECT is((SELECT count(*)::int FROM public.application_questions WHERE active AND category_id = pg_temp.u('ca')), 0,
  'every new row starts inactive');

SELECT throws_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'TR', 'rooms', '{"tr": "Oda"}', 'number') $$, '23514', NULL, 'a number type is refused');
SELECT throws_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'TR', 'when', '{"tr": "Ne zaman"}', 'date') $$, '23514', NULL, 'a date type is refused');
SELECT throws_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'TR', 'Bad', '{"tr": "Kötü"}', 'boolean') $$, '23514', NULL, 'a key out of format');
SELECT throws_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type, validation)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'TR', 'long_text', '{"tr": "Uzun"}', 'textarea', '{"maxLength": 601}') $$, '23514', NULL,
  'a text limit over 600');
SELECT throws_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type, validation)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'TR', 'tiny_text', '{"tr": "Kısa"}', 'textarea', '{"maxLength": 9}') $$, '23514', NULL,
  'a text limit under 10');
SELECT throws_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type, options)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'TR', 'flag', '{"tr": "Bayrak"}', 'boolean', '[]') $$, '23514', NULL,
  'a yes or no with options');
SELECT throws_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'TR', 'nolabel', '{"en": "English only"}', 'boolean') $$, '23514', NULL,
  'a label without the region''s default locale');
SELECT throws_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'TR', 'approach', '{"tr": "Yine"}', 'boolean') $$, '23505', NULL,
  'a key is unique per category');
SELECT throws_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'KSA', 'other_region', '{"ar": "س"}', 'boolean') $$, '23503', NULL,
  'the region is the category''s');

SELECT lives_ok($$ UPDATE public.application_questions SET active = true
  WHERE category_id = '00000000-0000-0000-0000-0000004000ca' AND key IN ('approach', 'materials', 'insured', 'extra_1', 'extra_2') $$,
  'five active');
SELECT throws_ok($$ UPDATE public.application_questions SET active = true WHERE key = 'extra_3' $$, 'P0001', 'too_many_questions',
  'a sixth is refused');
SELECT throws_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type, active)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'TR', 'born_active', '{"tr": "Etkin"}', 'boolean', true) $$, 'P0001',
  'too_many_questions', 'so is a sixth inserted active');
SELECT lives_ok($$ UPDATE public.application_questions SET active = true, label = '{"tr": "Ek bir"}' WHERE key = 'extra_1' $$,
  'an edit of an active question counts no new one');
SELECT throws_ok($$ UPDATE public.application_questions SET key = 'renamed' WHERE key = 'extra_4' $$, '42501', NULL,
  'no grant renames a key');
SELECT throws_ok($$ DELETE FROM public.application_questions WHERE key = 'extra_4' $$, '42501', NULL, 'no grant deletes');
SELECT lives_ok($$ UPDATE public.application_questions SET active = false WHERE key IN ('extra_1', 'extra_2') $$, 'two retired');

RESET ROLE;
SELECT throws_ok($$ UPDATE public.application_questions SET key = 'renamed' WHERE key = 'extra_4' $$, 'P0001',
  'application_question_immutable', 'the key is fixed for the owner too');
SELECT throws_ok($$ UPDATE public.application_questions SET type = 'boolean', validation = NULL WHERE key = 'extra_4' $$, 'P0001',
  'application_question_immutable', 'the type is fixed');
SELECT throws_ok($$ UPDATE public.application_questions SET category_id = '00000000-0000-0000-0000-0000004000cb' WHERE key = 'extra_4' $$,
  'P0001', 'application_question_immutable', 'the category is fixed');
SELECT throws_ok($$ DELETE FROM public.application_questions WHERE key = 'extra_4' $$, 'P0001', 'application_question_retire',
  'a delete is refused for the owner: deactivate instead');
SELECT throws_ok($$ TRUNCATE public.application_questions $$, 'P0001', 'application_question_retire', 'and so is a truncate');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'application_questions' AND action = 'catalog.created'
            AND entity_id IN (SELECT id::text FROM public.application_questions WHERE category_id = pg_temp.u('ca'))), 7,
  'catalog_audit wrote a created row per question');
SELECT ok((SELECT count(*) FROM public.audit_log WHERE entity_type = 'application_questions' AND action = 'catalog.updated'
            AND actor_id = pg_temp.u('d1')) >= 7, 'and an updated row per change, with the admin as actor');

-- Nobody but admin reads the table.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is((SELECT count(*)::int FROM public.application_questions), 0, 'a provider reads no question');
SELECT pg_temp.as_user('c1');
SELECT is((SELECT count(*)::int FROM public.application_questions), 0, 'nor a customer');
SELECT pg_temp.as_user('a1');
SELECT throws_ok($$ INSERT INTO public.application_questions (category_id, region, key, label, type)
  VALUES ('00000000-0000-0000-0000-0000004000ca', 'TR', 'sneaky', '{"tr": "Sinsi"}', 'boolean') $$, '42501', NULL,
  'a provider writes none');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT count(*) FROM public.application_questions $$, '42501', NULL, 'anon reads nothing');
RESET ROLE;

-- ── the provider's read (AC-3) ───────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
CREATE TEMP TABLE pr1 AS SELECT public.provider_request(pg_temp.r(1)) AS j;
SELECT is((SELECT j -> 'questions' FROM pr1),
  '[{"key": "approach", "label": {"tr": "Nasıl yaparsınız?", "en": "How will you do it?"}, "help_text": {"tr": "Birkaç satır.", "en": "A few lines."},
     "type": "textarea", "required": true, "options": null, "max_length": 600},
    {"key": "materials", "label": {"tr": "Malzeme", "en": "Materials"}, "help_text": null, "type": "single_select", "required": false,
     "options": [{"value": "own", "label": {"tr": "Benim", "en": "Mine"}}, {"value": "customer", "label": {"tr": "Müşteri", "en": "Yours"}}],
     "max_length": null},
    {"key": "insured", "label": {"tr": "Sigortalı mı?", "en": "Insured?"}, "help_text": null, "type": "boolean", "required": true,
     "options": null, "max_length": null}]'::jsonb,
  'the active questions in order, each with exactly these keys; retired ones are gone');
SELECT is((SELECT j ->> 'questions_version' FROM pr1), (SELECT md5((j -> 'questions')::text) FROM pr1), 'the version is the md5 of the list');
SELECT is((SELECT j -> 'application' FROM pr1), 'null'::jsonb, 'no application yet');
SELECT is(public.provider_request(pg_temp.r(5)) -> 'questions', '[]'::jsonb, 'a category with no question: an empty list');
SELECT is(public.provider_request(pg_temp.r(5)) ->> 'questions_version', NULL, 'and no version');
RESET ROLE;
SELECT is(public.application_questions_version(pg_temp.u('ca'), 'TR'), (SELECT j ->> 'questions_version' FROM pr1),
  'application_questions_version agrees');
-- Any edit moves the version (X-3).
CREATE TEMP TABLE versions AS SELECT 'start'::text AS step, public.application_questions_version(pg_temp.u('ca'), 'TR') AS v;
UPDATE public.application_questions SET required = true WHERE key = 'materials';
INSERT INTO versions SELECT 'required', public.application_questions_version(pg_temp.u('ca'), 'TR');
UPDATE public.application_questions SET required = false, help_text = '{"tr": "Kısaca"}' WHERE key = 'materials';
INSERT INTO versions SELECT 'help', public.application_questions_version(pg_temp.u('ca'), 'TR');
UPDATE public.application_questions SET validation = '{"maxLength": 500}' WHERE key = 'approach';
INSERT INTO versions SELECT 'limit', public.application_questions_version(pg_temp.u('ca'), 'TR');
UPDATE public.application_questions SET help_text = NULL WHERE key = 'materials';
UPDATE public.application_questions SET validation = NULL WHERE key = 'approach';
INSERT INTO versions SELECT 'back', public.application_questions_version(pg_temp.u('ca'), 'TR');
SELECT is((SELECT count(DISTINCT v)::int FROM versions WHERE step <> 'back'), 4, 'a required flag, help text and a limit each move the version');
SELECT is((SELECT v FROM versions WHERE step = 'back'), (SELECT v FROM versions WHERE step = 'start'), 'and the same set reads the same version');
SELECT is((SELECT array_agg(proname::text ORDER BY proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND proname LIKE 'application_questions_%'
              AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))),
  NULL, 'the question helpers are internal: no API role runs them');

-- ── apply with answers: every refusal in order (AC-4) ────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(public.apply_to_request(pg_temp.r(1), NULL, NULL, pg_temp.version(1)), '{"status": "refused", "code": "questions_changed"}',
  'no answers where there are questions');
SELECT is(public.apply_to_request(pg_temp.r(1), 'I can come on Saturday with my own tools.'), '{"status": "refused", "code": "questions_changed"}',
  'a message where there are questions (the two argument call resolves)');
SELECT is(public.apply_to_request(pg_temp.r(1), '', pg_temp.good(), pg_temp.version(1)), '{"status": "refused", "code": "questions_changed"}',
  'any message beside the answers, an empty one included');
SELECT is(public.apply_to_request(pg_temp.r(1), NULL, pg_temp.good(), md5('stale')), '{"status": "refused", "code": "questions_changed"}',
  'a stale version');
SELECT is(public.apply_to_request(pg_temp.r(1), NULL, pg_temp.good(), NULL), '{"status": "refused", "code": "questions_changed"}',
  'no version');
SELECT is(pg_temp.ans(1, '["approach"]'), '{"status": "refused", "code": "answers_invalid"}', 'answers that are not an object');
SELECT is(pg_temp.ans(1, jsonb_build_object('approach', repeat('a', 16400))), '{"status": "refused", "code": "answers_invalid"}',
  'answers over 16384 bytes');
SELECT is(pg_temp.ans(1, pg_temp.good() || '{"extra_1": "A retired question, answered anyway."}'),
  '{"status": "refused", "code": "questions_changed"}', 'a key that is not an active question');
SELECT is(pg_temp.ans(1, pg_temp.good() - 'approach'), '{"status": "refused", "code": "answers_invalid", "key": "approach"}',
  'a required text left out');
SELECT is(pg_temp.ans(1, pg_temp.good() || '{"approach": null}'), '{"status": "refused", "code": "answers_invalid", "key": "approach"}',
  'or null');
SELECT is(pg_temp.ans(1, pg_temp.good() || '{"approach": "   "}'), '{"status": "refused", "code": "answers_invalid", "key": "approach"}',
  'or blank');
SELECT is(pg_temp.ans(1, pg_temp.good() || '{"approach": 42}'), '{"status": "refused", "code": "answers_invalid", "key": "approach"}',
  'a text answer that is not a string');
SELECT is(pg_temp.ans(1, pg_temp.good() || jsonb_build_object('approach', repeat('ü', 4097))),
  '{"status": "refused", "code": "answers_invalid", "key": "approach"}', 'a text answer over 8192 bytes');
SELECT is(pg_temp.ans(1, pg_temp.good() || '{"approach": " too short "}'), '{"status": "refused", "code": "answers_invalid", "key": "approach"}',
  'under 10 code points after the trim');
SELECT is(pg_temp.ans(1, pg_temp.good() || jsonb_build_object('approach', repeat('ş', 601))),
  '{"status": "refused", "code": "answers_invalid", "key": "approach"}', 'over its limit of 600 code points');
SELECT is(pg_temp.ans(1, pg_temp.good() || '{"approach": "call me on 0555 123 45 67 any time"}'),
  '{"status": "refused", "code": "contact_info_in_answer", "key": "approach"}', 'a phone number in a text answer');
SELECT is(pg_temp.ans(1, pg_temp.good() || '{"materials": "nobody"}'), '{"status": "refused", "code": "answers_invalid", "key": "materials"}',
  'a choice that is not an option');
SELECT is(pg_temp.ans(1, pg_temp.good() || '{"materials": ["own"]}'), '{"status": "refused", "code": "answers_invalid", "key": "materials"}',
  'a choice that is not a string');
SELECT is(pg_temp.ans(1, pg_temp.good() || '{"insured": "true"}'), '{"status": "refused", "code": "answers_invalid", "key": "insured"}',
  'a yes or no that is not a boolean');
SELECT is(pg_temp.ans(1, pg_temp.good() - 'insured'), '{"status": "refused", "code": "answers_invalid", "key": "insured"}',
  'a required yes or no left out');
RESET ROLE;
SELECT is((SELECT count FROM public.apply_counters WHERE provider_id = pg_temp.u('a1')), 20, 'each refusal counted one attempt (D153)');
SELECT is((SELECT count(*)::int FROM public.applications WHERE provider_id = pg_temp.u('a1')), 0, 'and stored nothing');
SELECT ok((SELECT prosrc !~* 'raise[^;]*(p_message|v_message|p_answers|v_text|v_value|v_clean)' FROM pg_proc WHERE proname = 'apply_to_request'),
  'no raise in apply_to_request carries the message or an answer');

-- ── apply with answers: stored (AC-4, AC-5) ──────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
CREATE TEMP TABLE ok1 AS SELECT pg_temp.ans(1, pg_temp.good()) AS j;
SELECT is((SELECT (j - 'application') FROM ok1), '{"status": "ok", "replayed": false}', 'clean answers apply');
SELECT is(public.apply_to_request(pg_temp.r(1), 'whatever', '[]', 'stale'), (SELECT j || '{"replayed": true}' FROM ok1),
  'a replay returns the stored application, whatever was sent');
SELECT pg_temp.as_user('a2');
SELECT is(pg_temp.ans(1, '{"approach": "Two of us, one day, all tools brought.", "insured": false}') ->> 'status', 'ok',
  'an optional question left out applies too');
RESET ROLE;
SELECT is((SELECT jsonb_build_object('message', message, 'answers', answers, 'snapshot', questions_snapshot)
             FROM public.applications WHERE provider_id = pg_temp.u('a1')),
  '{"message": null, "answers": {"approach": "I will bring two people and finish in one day.", "materials": "own", "insured": true},
    "snapshot": [{"key": "approach", "label": {"tr": "Nasıl yaparsınız?", "en": "How will you do it?"}, "type": "textarea", "required": true},
                 {"key": "materials", "label": {"tr": "Malzeme", "en": "Materials"}, "type": "single_select", "required": false,
                  "choice": {"value": "own", "label": {"tr": "Benim", "en": "Mine"}}},
                 {"key": "insured", "label": {"tr": "Sigortalı mı?", "en": "Insured?"}, "type": "boolean", "required": true}]}'::jsonb,
  'no message, the trimmed answers, and a snapshot holding only the chosen option');
SELECT is((SELECT jsonb_build_object('answers', answers, 'materials', questions_snapshot -> 1)
             FROM public.applications WHERE provider_id = pg_temp.u('a2')),
  '{"answers": {"approach": "Two of us, one day, all tools brought.", "insured": false},
    "materials": {"key": "materials", "label": {"tr": "Malzeme", "en": "Materials"}, "type": "single_select", "required": false}}'::jsonb,
  'an optional question left empty is stored absent, its snapshot entry kept, no choice');

-- The provider reads their own answers back.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is((SELECT jsonb_build_object('answers', x -> 'application_answers', 'snap', jsonb_array_length(x -> 'questions_snapshot'))
             FROM (SELECT public.provider_request(pg_temp.r(1)) -> 'application' AS x) t),
  '{"answers": {"approach": "I will bring two people and finish in one day.", "materials": "own", "insured": true}, "snap": 3}'::jsonb,
  'provider_request carries the caller''s own answers and snapshot');
SELECT pg_temp.as_user('a3');
SELECT is(public.provider_request(pg_temp.r(1)) -> 'application', 'null'::jsonb, 'and never another provider''s');
RESET ROLE;

-- An admin edit never changes what was sent.
CREATE TEMP TABLE snap_before AS SELECT questions_snapshot AS s FROM public.applications WHERE provider_id = pg_temp.u('a1');
UPDATE public.application_questions
   SET label = '{"tr": "Yeni etiket"}',
       options = '[{"value": "own", "label": {"tr": "Kendim"}}, {"value": "none", "label": {"tr": "Yok"}}]'
 WHERE key = 'materials';
SELECT is((SELECT questions_snapshot FROM public.applications WHERE provider_id = pg_temp.u('a1')), (SELECT s FROM snap_before),
  'the snapshot survives an admin edit');

-- ── the one content check and the guard (AC-5) ───────────────────────────────
SELECT throws_ok(format($$ INSERT INTO public.applications (region, request_id, provider_id, message, answers, questions_snapshot)
  VALUES ('TR', %L, %L, 'A message long enough to store here.', '{}', '[]') $$, pg_temp.r(2), pg_temp.u('a4')), '23514', NULL,
  'a message and answers together are refused');
SELECT throws_ok(format($$ INSERT INTO public.applications (region, request_id, provider_id) VALUES ('TR', %L, %L) $$,
  pg_temp.r(2), pg_temp.u('a4')), '23514', NULL, 'neither is refused');
SELECT throws_ok(format($$ INSERT INTO public.applications (region, request_id, provider_id, answers, questions_snapshot)
  VALUES ('TR', %L, %L, '[]', '[]') $$, pg_temp.r(2), pg_temp.u('a4')), '23514', NULL, 'answers that are not an object');
SELECT throws_ok(format($$ INSERT INTO public.applications (region, request_id, provider_id, answers)
  VALUES ('TR', %L, %L, '{}') $$, pg_temp.r(2), pg_temp.u('a4')), '23514', NULL, 'answers with no snapshot');
SELECT throws_ok(format($$ INSERT INTO public.applications (region, request_id, provider_id, answers, questions_snapshot)
  VALUES ('TR', %L, %L, '{}', jsonb_build_array(repeat('x', 33000))) $$, pg_temp.r(2), pg_temp.u('a4')), '23514', NULL,
  'a snapshot over 32768 bytes');
SELECT throws_ok($$ UPDATE public.applications SET answers = '{"approach": "Rewritten after the fact, sorry."}'
  WHERE provider_id = '00000000-0000-0000-0000-0000004000a1' $$, 'P0001', 'application_immutable', 'no role changes an answer');
SELECT throws_ok($$ UPDATE public.applications SET questions_snapshot = '[]' WHERE provider_id = '00000000-0000-0000-0000-0000004000a1' $$,
  'P0001', 'application_immutable', 'nor the snapshot');

-- ── a category with no question keeps the message (AC-4) ─────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(public.apply_to_request(pg_temp.r(5), NULL, '{"approach": "Answers where none are asked."}', NULL),
  '{"status": "refused", "code": "questions_changed"}', 'answers where there are no questions');
SELECT is(public.apply_to_request(pg_temp.r(5), 'I can start on Saturday morning with two people.', NULL, md5('x')),
  '{"status": "refused", "code": "questions_changed"}', 'a version where there are no questions');
SELECT is(public.apply_to_request(pg_temp.r(5), 'short'), '{"status": "refused", "code": "message_invalid"}', 'the message rules hold');
SELECT is(public.apply_to_request(pg_temp.r(5), 'I can start on Saturday morning with two people.') ->> 'status', 'ok',
  'the two argument call still applies with a message');
SELECT is(public.apply_to_request(p_request_id => pg_temp.r(6), p_message => 'Named arguments, as PostgREST sends them.',
                                  p_answers => NULL, p_questions_version => NULL) ->> 'status', 'ok',
  'all four named, nulls included, as the door sends them');
RESET ROLE;
SELECT is((SELECT jsonb_build_object('message', message, 'answers', answers, 'snapshot', questions_snapshot)
             FROM public.applications WHERE provider_id = pg_temp.u('a1') AND request_id = pg_temp.r(5)),
  '{"message": "I can start on Saturday morning with two people.", "answers": null, "snapshot": null}'::jsonb,
  'stored as a message application');

-- ── the offer card (AC-6) ────────────────────────────────────────────────────
-- a3's answer slipped past an older scanner: written straight, as it would have been stored.
INSERT INTO public.applications (region, request_id, provider_id, answers, questions_snapshot, created_at)
VALUES ('TR', pg_temp.r(1), pg_temp.u('a3'), '{"approach": "FIXTURE call 0555 now, then 123 and 45 67 later", "insured": true}',
        '[{"key": "approach", "label": {"tr": "Nasıl yaparsınız?"}, "type": "textarea", "required": true},
          {"key": "insured", "label": {"tr": "Sigortalı mı?"}, "type": "boolean", "required": true}]', now() + interval '1 minute');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
CREATE TEMP TABLE o1 AS SELECT public.request_offers(pg_temp.r(1)) AS j;
SELECT is((SELECT jsonb_agg(jsonb_build_object('message', x -> 'message', 'hidden', x -> 'message_hidden', 'answers', x -> 'answers')
                            ORDER BY x -> 'answers' -> 0 ->> 'value' NULLS LAST)
             FROM o1, jsonb_array_elements(j -> 'offers') x),
  '[{"message": null, "hidden": false, "answers": [
      {"key": "approach", "label": {"tr": "Nasıl yaparsınız?", "en": "How will you do it?"}, "type": "textarea", "choice": null,
       "value": "I will bring two people and finish in one day.", "hidden": false},
      {"key": "materials", "label": {"tr": "Malzeme", "en": "Materials"}, "type": "single_select",
       "choice": {"value": "own", "label": {"tr": "Benim", "en": "Mine"}}, "value": null, "hidden": false},
      {"key": "insured", "label": {"tr": "Sigortalı mı?", "en": "Insured?"}, "type": "boolean", "choice": null, "value": true, "hidden": false}]},
    {"message": null, "hidden": false, "answers": [
      {"key": "approach", "label": {"tr": "Nasıl yaparsınız?", "en": "How will you do it?"}, "type": "textarea", "choice": null,
       "value": "Two of us, one day, all tools brought.", "hidden": false},
      {"key": "insured", "label": {"tr": "Sigortalı mı?", "en": "Insured?"}, "type": "boolean", "choice": null, "value": false, "hidden": false}]},
    {"message": null, "hidden": false, "answers": [
      {"key": "approach", "label": {"tr": "Nasıl yaparsınız?"}, "type": "textarea", "choice": null, "value": null, "hidden": true},
      {"key": "insured", "label": {"tr": "Sigortalı mı?"}, "type": "boolean", "choice": null, "value": true, "hidden": false}]}]'::jsonb,
  'answers in snapshot order, answered ones only, the snapshot''s labels; a scanned answer hidden; message_hidden false, never null');
SELECT is(public.request_offers(pg_temp.r(5)) -> 'offers' -> 0 -> 'answers', 'null'::jsonb, 'a message card has answers null');

-- A chosen provider suspended after the choose shows no answers (X-1).
SELECT is(public.choose_provider(pg_temp.r(1), (SELECT j -> 'application' ->> 'id' FROM ok1)::uuid) ->> 'status', 'ok', 'c1 chooses a1');
RESET ROLE;
UPDATE public.providers SET status = 'suspended', suspension_reason = 'Repeated complaints from customers' WHERE id = pg_temp.u('a1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
SELECT is((SELECT jsonb_build_object('suspended', x -> 'suspended', 'answers', x -> 'answers', 'message', x -> 'message', 'hidden', x -> 'message_hidden')
             FROM (SELECT public.request_offers(pg_temp.r(1)) -> 'chosen' AS x) t),
  '{"suspended": true, "answers": null, "message": null, "hidden": true}'::jsonb, 'the suspended chosen provider''s answers are hidden');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
