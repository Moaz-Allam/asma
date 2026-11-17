-- Position 06, spec 0010: choose a provider.
--
-- A customer or a provider can call the database straight with a real token, so every rule is proven here
-- as that caller: who reads the offers and what keys come back, every refusal of choose_provider, the
-- replay, the deadline and its cap by the start, the others NOT_SELECTED, the guard on the three request
-- columns, the cap that ignores providers who are not approved now, the cancel of a SELECTED request, the
-- provider's view of the outcome, the message scanner rule and the one blank class. The races are in 17.
-- AC-2 to AC-5, AC-7, AC-11 to AC-15, AC-18. Every text and figure is fixture data.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(98);

-- ── ids ──────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000001600' || p)::uuid $$;
CREATE FUNCTION pg_temp.r(p integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000001670' || lpad(p::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.app(p_request integer, p_provider text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-00000016' || lpad(p_request::text, 2, '0') || p_provider)::uuid $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- c1 the customer, c2 another, d1 an admin. a1, a2, a5 approved; a3 suspended later; a4 approved with an
-- expired document. 00 signed in with no profile.
INSERT INTO auth.users (id, aud, role, phone, phone_confirmed_at)
SELECT pg_temp.u(c), 'authenticated', 'authenticated', p, now()
  FROM (VALUES ('c1', '905559160001'), ('c2', '905559160002'), ('d1', '905559160003'), ('a1', '905559160004'),
               ('a2', '905559160005'), ('a3', '905559160006'), ('a4', '905559160007'), ('a5', '905559160008'),
               ('00', '905559160009')) AS t(c, p);
INSERT INTO public.profiles (id, role, region, phone, full_name, locale)
SELECT pg_temp.u(c), r, 'TR', '+' || p, n, 'tr'
  FROM (VALUES ('c1', 'customer', '905559160001', 'FIXTURE_CUSTOMER'), ('c2', 'customer', '905559160002', 'Can İki'),
               ('d1', 'admin', '905559160003', 'Admin Bir'), ('a1', 'provider', '905559160004', 'Ayşe Usta'),
               ('a2', 'provider', '905559160005', 'Mehmet Usta'), ('a3', 'provider', '905559160006', 'Veli Usta'),
               ('a4', 'provider', '905559160007', 'Deniz Usta'), ('a5', 'provider', '905559160008', 'Zeki Usta')) AS t(c, r, p, n);
UPDATE public.providers SET status = 'approved', approved_at = timestamptz '2026-03-15 21:30:00+00',
       approved_name = CASE id WHEN pg_temp.u('a1') THEN 'Ayşe Nur Kaya' WHEN pg_temp.u('a2') THEN 'Mehmet'
                               WHEN pg_temp.u('a3') THEN 'Veli Demir' WHEN pg_temp.u('a4') THEN 'Deniz Ak'
                               ELSE 'Zeki Öz' END
 WHERE id IN (pg_temp.u('a1'), pg_temp.u('a2'), pg_temp.u('a3'), pg_temp.u('a4'), pg_temp.u('a5'));
INSERT INTO public.provider_documents (provider_id, region, type, storage_path, object_id, mime_type, size_bytes, status, valid_until)
VALUES (pg_temp.u('a4'), 'TR', 'id_front', 'fixture-16/id-front.jpg', gen_random_uuid(), 'image/jpeg', 1000, 'approved', current_date - 1);

INSERT INTO public.service_categories (id, region, name, active) VALUES (pg_temp.u('ca'), 'TR', '{"tr": "Seçim"}', true);
INSERT INTO public.services (id, category_id, region, name, hours_min, hours_max, active)
VALUES (pg_temp.u('51'), pg_temp.u('ca'), 'TR', '{"tr": "Bir"}', 1, 2, true);
INSERT INTO public.zones (id, region, name, multiplier, active) VALUES (pg_temp.u('21'), 'TR', '{"tr": "Semt"}', 1.00, true);

-- A request of a customer, written as create_request leaves it.
CREATE FUNCTION pg_temp.req(p_id uuid, p_customer text, p_start timestamptz) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
  VALUES (p_id, 'TR', pg_temp.u(p_customer), gen_random_uuid(), pg_temp.u('51'), pg_temp.u('21'), '{}', '[]',
    '{"rounding_minor": 100}', 300000, 30000, 270000, 'TRY', p_start, p_start + interval '2 hours')
  RETURNING id $$;
-- An offer, minutes after the hour so the order is fixed.
CREATE FUNCTION pg_temp.offer(p_request integer, p_provider text, p_minute integer, p_message text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.applications (id, region, request_id, provider_id, message, created_at)
  VALUES (pg_temp.app(p_request, p_provider), 'TR', pg_temp.r(p_request), pg_temp.u(p_provider), p_message,
          date_trunc('hour', now()) - interval '1 hour' + make_interval(mins => p_minute))
  RETURNING id $$;
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
GRANT EXECUTE ON FUNCTION pg_temp.u(text), pg_temp.r(integer), pg_temp.app(integer, text), pg_temp.as_user(text),
  pg_temp.err(text) TO authenticated;

-- R1: three offers (a1, a2, a3) and a hidden one (a5); R2: one offer (a2) and an expired document (a4);
-- R3 started already; R4 starts in 5 hours; R5 of c2; R6 for the cap; R7 cancelled.
SELECT pg_temp.req(pg_temp.r(1), 'c1', now() + interval '3 days');
SELECT pg_temp.req(pg_temp.r(2), 'c1', now() + interval '3 days');
SELECT pg_temp.req(pg_temp.r(3), 'c1', now() - interval '1 hour');
SELECT pg_temp.req(pg_temp.r(4), 'c1', now() + interval '5 hours');
SELECT pg_temp.req(pg_temp.r(5), 'c2', now() + interval '3 days');
SELECT pg_temp.req(pg_temp.r(6), 'c1', now() + interval '4 days');
SELECT pg_temp.offer(1, 'a2', 10, 'I can come on Saturday with my own tools.');
SELECT pg_temp.offer(1, 'a1', 5, 'I am free all week and live close by.');
SELECT pg_temp.offer(1, 'a3', 20, 'Ready to start at nine, two people.');
SELECT pg_temp.offer(1, 'a5', 30, 'FIXTURE call 0555 now, then 123 and 45 67 later');
SELECT pg_temp.offer(2, 'a2', 1, 'Happy to do this one as well, thank you.');
SELECT pg_temp.offer(2, 'a4', 2, 'My papers are old but my tools are new.');
SELECT pg_temp.offer(3, 'a1', 1, 'This one starts too soon for anyone now.');
SELECT pg_temp.offer(4, 'a1', 1, 'I can be there in two hours from now on.');
SELECT pg_temp.offer(5, 'a1', 1, 'Another customer, another nice request.');
UPDATE public.providers SET status = 'suspended', suspension_reason = 'Repeated complaints from customers' WHERE id = pg_temp.u('a3');

-- ── schema and setting (AC-7) ────────────────────────────────────────────────
SELECT has_column('public', 'requests', 'selected_application_id', 'requests.selected_application_id exists');
SELECT has_column('public', 'requests', 'selected_at', 'requests.selected_at exists');
SELECT has_column('public', 'requests', 'payment_deadline', 'requests.payment_deadline exists');
SELECT results_eq($$ SELECT region, value FROM public.platform_settings WHERE key = 'payment_window_hours' ORDER BY region $$,
  $$ VALUES ('KSA', '24'::jsonb), ('TR', '24'::jsonb) $$, 'the payment window is 24 hours in both regions');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '0' WHERE region = 'TR' AND key = 'payment_window_hours' $$,
  '23514', NULL, 'a window of 0 hours is refused');
SELECT throws_ok($$ UPDATE public.platform_settings SET value = '73' WHERE region = 'TR' AND key = 'payment_window_hours' $$,
  '23514', NULL, 'a window of 73 hours is refused');
SELECT is(public.choose_settings('TR'), 24, 'choose_settings reads the window as an integer');

-- ── the blank class, one source (AC-14) ──────────────────────────────────────
SELECT is(public.blank_class(), '\s' || public.blank_marks(), 'the class is whitespace plus the marks');
CREATE TEMP TABLE marks AS
  SELECT cp FROM (VALUES (160, 160), (173, 173), (847, 847), (1564, 1564), (4447, 4448), (5760, 5760), (6068, 6069),
                         (6155, 6158), (8192, 8207), (8232, 8239), (8287, 8292), (8294, 8297), (10240, 10240),
                         (12288, 12288), (12644, 12644), (65024, 65039), (65279, 65279), (65440, 65440), (65529, 65531),
                         (78896, 78911), (119155, 119162), (917504, 917631), (917760, 917999)) v(lo, hi),
                 generate_series(lo, hi) cp;
SELECT is_empty($$ SELECT to_hex(cp) FROM marks WHERE public.catalog_trim(chr(cp) || 'x' || chr(cp)) <> 'x' $$,
  'catalog_trim strips every code point of the class');
SELECT is_empty($$ SELECT to_hex(cp) FROM marks WHERE public.contact_normalise('a' || chr(cp) || 'b') NOT IN ('ab', 'a b') $$,
  'contact_normalise strips every mark of the class, or folds a space to a space');
SELECT is(public.contact_normalise('beş   dört'), 'bes   dort', 'and keeps the whitespace between words');
SELECT ok(public.catalog_text_ok('{"tr": "Moda"}', 'TR', 10) AND NOT public.catalog_text_ok(jsonb_build_object('tr', chr(10240) || chr(65039)), 'TR', 10),
  'catalog_text_ok reads the same class');

-- ── the message scanner (AC-13) ──────────────────────────────────────────────
SELECT is(public.message_digit_limit(), 10, 'the limit is 10 digits');
SELECT is_empty(
  $$ SELECT t FROM (VALUES
       ('call 0555 when you can, I am free on 123 most days, then 45 and 67 is fine'),
       ('0 5 5 5 hello there my friend 1 2 3 4 5 6 and more'),
       ('0555' || repeat(chr(10240), 25) || '123' || repeat(chr(12644), 25) || '4567'),
       ('Numaram sıfır beş beş beş, sonra uzun bir ara 1234567 tamam'),
       ('numaram 0532 olarak başlıyor, devamı ise 123 ve 45 ve sonra altı yedi')) c(t)
      WHERE NOT public.message_has_contact_info(t) $$,
  'every added must catch row is flagged');
SELECT is_empty(
  $$ SELECT t FROM (VALUES
       ('I can start at 10:30 on the 21st with 2 people; about 3 hours.'),
       ('25 Kasım 09:00''da başlarım, 3 oda 2 banyo için 4 saat yeter.'),
       ('أبدأ يوم 25 الساعة 9 مع 2 من الفريق، والعمل 3 ساعات.'),
       ('6 years of experience in homes and villas'), ('9 to 5, 10 years since 2015'),
       ('3 bedrooms, 2 bathrooms, 1 kitchen, 6 years since 2019'),
       ('I can start at 13:00 on Saturday and finish in about 7 hours with two people.'),
       ('Cumartesi 13:00''te başlayabilirim, iki kişiyle yaklaşık 7 saatte biter.'),
       ('خبرة 8 سنوات في تنظيف الفلل بعد التشطيب، وأحضر أدواتي ومنظفاتي.')) c(t)
      WHERE public.message_has_contact_info(t) $$,
  'every must pass row passes, the older corpora included');
SELECT ok(public.message_has_contact_info('In 2015 I started cleaning homes, by 2019 my team had grown, now we do 120 jobs'), 'known false positive, accepted: 10 digits');
SELECT ok(NOT public.has_contact_info('In 2015 I started cleaning homes, by 2019 my team had grown, now we do 120 jobs'), 'while bios and notes keep the old rule');

-- ── the display name (AC-3) ──────────────────────────────────────────────────
SELECT is(public.offer_display_name('Ayşe Nur Kaya'), '{"display_name": "Ayşe K.", "first_name": "Ayşe"}', 'first word and the initial of the last');
SELECT is(public.offer_display_name('Mehmet'), '{"display_name": "Mehmet", "first_name": "Mehmet"}', 'a single word stays whole');
SELECT is(public.offer_display_name('  İsmail   Işık  '), '{"display_name": "İsmail I.", "first_name": "İsmail"}', 'extra spaces, never case folded');
SELECT is(public.offer_display_name('أحمد السيد') ->> 'display_name', 'أحمد ا.', 'an Arabic name, first code point of the last word');
SELECT is(public.offer_display_name(chr(12644) || ' '), '{"display_name": null, "first_name": null}', 'a blank name is null');
SELECT is(public.offer_display_name('Ayşe' || chr(12644) || 'Kaya') ->> 'display_name', 'Ayşe K.', 'an invisible mark between words splits them (review S3)');
SELECT is(public.offer_display_name('Usta 0532 123 45 67') ->> 'display_name', NULL, 'a name the scanner flags shows as Provider (review S3)');

-- ── the cap helper (AC-5) ────────────────────────────────────────────────────
SELECT is(public.approved_applied_count(pg_temp.r(1)), 3, 'R1: a1, a2 and a5 hold slots; suspended a3 does not');
SELECT is(public.approved_applied_count(pg_temp.r(2)), 1, 'R2: a4 with an expired document holds none');

-- ── the offers (AC-2 to AC-5, AC-13) ─────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
CREATE TEMP TABLE o1 AS SELECT public.request_offers(pg_temp.r(1)) AS j;
SELECT is((SELECT array_agg(k ORDER BY k) FROM o1, jsonb_object_keys(j) k),
  ARRAY['cancelled_at', 'chosen', 'offers', 'payment_deadline', 'payment_window_hours', 'selected_at', 'status', 'timezone'],
  'request_offers returns exactly these keys');
SELECT is((SELECT j - 'offers' FROM o1),
  '{"status": "OPEN", "timezone": "Europe/Istanbul", "payment_window_hours": 24, "selected_at": null, "payment_deadline": null, "cancelled_at": null, "chosen": null}',
  'an OPEN request, nothing chosen yet');
SELECT is((SELECT jsonb_agg(x ->> 'application_id' ORDER BY ord) FROM o1, jsonb_array_elements(j -> 'offers') WITH ORDINALITY AS t(x, ord)),
  jsonb_build_array(pg_temp.app(1, 'a1'), pg_temp.app(1, 'a2'), pg_temp.app(1, 'a5')),
  'oldest first, and the suspended provider''s offer is hidden');
SELECT is((SELECT array_agg(k ORDER BY k) FROM o1, jsonb_object_keys(j -> 'offers' -> 0) k),
  ARRAY['application_id', 'approved_since', 'created_at', 'display_name', 'first_name', 'message', 'message_hidden'],
  'an offer has exactly these keys');
SELECT is((SELECT (j -> 'offers' -> 0) - 'created_at' FROM o1),
  jsonb_build_object('application_id', pg_temp.app(1, 'a1'), 'display_name', 'Ayşe K.', 'first_name', 'Ayşe',
                     'approved_since', '2026-03-01', 'message', 'I am free all week and live close by.', 'message_hidden', false),
  'the first offer: name and initial, the month in Istanbul, the message');
SELECT is((SELECT jsonb_build_object('message', x -> 'message', 'hidden', x -> 'message_hidden') FROM o1, jsonb_array_elements(j -> 'offers') x
            WHERE x ->> 'application_id' = pg_temp.app(1, 'a5')::text),
  '{"message": null, "hidden": true}', 'an older message the new rule would refuse is hidden');
SELECT ok((SELECT j::text !~* 'FIXTURE|Usta|Nur|9055|provider_id|phone|tax' FROM o1), 'no full name, phone, id or customer anywhere');
SELECT is(public.request_offers(pg_temp.r(2)) -> 'offers' -> 0 ->> 'application_id', pg_temp.app(2, 'a2')::text, 'R2: only a2, not the expired document');
SELECT is(jsonb_array_length(public.request_offers(pg_temp.r(6)) -> 'offers'), 0, 'no offer yet: an empty list');
SELECT is(public.request_offers(pg_temp.r(5)), NULL, 'another customer''s request reads as nothing');
SELECT is(public.request_offers(gen_random_uuid()), NULL, 'an unknown id reads as nothing');
SELECT pg_temp.as_user('a1');
SELECT is(public.request_offers(pg_temp.r(1)), NULL, 'a provider reads no offers');
SELECT pg_temp.as_user('d1');
SELECT is(public.request_offers(pg_temp.r(1)), NULL, 'nor an admin, on another customer''s request');
SELECT pg_temp.as_user('c1');
SELECT is_empty($$ SELECT id FROM public.applications $$, 'the customer still reads no application row directly');

-- ── choose: every refusal (AC-7, AC-18) ──────────────────────────────────────
SELECT pg_temp.as_user('a1');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', pg_temp.r(1), pg_temp.app(1, 'a1'))), 'not_found', 'a provider token');
SELECT pg_temp.as_user('c2');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', pg_temp.r(1), pg_temp.app(1, 'a1'))), 'not_found', 'another customer');
SELECT pg_temp.as_user('d1');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', pg_temp.r(1), pg_temp.app(1, 'a1'))), 'not_found', 'an admin on another customer''s request');
SELECT pg_temp.as_user('00');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', pg_temp.r(1), pg_temp.app(1, 'a1'))), 'not_found', 'no profile');
SELECT pg_temp.as_user('c1');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', gen_random_uuid(), pg_temp.app(1, 'a1'))), 'not_found', 'an unknown request');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', pg_temp.r(3), pg_temp.app(3, 'a1'))), 'not_choosable', 'a request whose start passed');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', pg_temp.r(1), pg_temp.app(2, 'a2'))), 'offer_unavailable', 'an offer of another request');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', pg_temp.r(1), gen_random_uuid())), 'offer_unavailable', 'an unknown offer');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', pg_temp.r(1), pg_temp.app(1, 'a3'))), 'offer_unavailable', 'a suspended provider''s offer');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', pg_temp.r(2), pg_temp.app(2, 'a4'))), 'offer_unavailable', 'an offer from an expired document');
RESET ROLE;
DELETE FROM public.platform_settings WHERE region = 'TR' AND key = 'payment_window_hours';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', pg_temp.r(1), pg_temp.app(1, 'a1'))), 'choose_settings_invalid', 'a missing window refuses, never a default');
SELECT is(public.request_offers(pg_temp.r(1)) -> 'payment_window_hours', 'null', 'and the offers still read, with no window');
RESET ROLE;
INSERT INTO public.platform_settings (region, key, value) VALUES ('TR', 'payment_window_hours', '24');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'request.provider_chosen' AND entity_id LIKE '00000000-0000-0000-0000-0000001670%'), 0,
  'no refusal wrote anything');

-- ── choose: the happy path and the replay (AC-7) ─────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
CREATE TEMP TABLE ch AS SELECT public.choose_provider(pg_temp.r(1), pg_temp.app(1, 'a1')) AS j;
RESET ROLE;
SELECT is((SELECT array_agg(k ORDER BY k) FROM ch, jsonb_object_keys(j) k), ARRAY['payment_deadline', 'replayed', 'selected_at', 'status'],
  'the answer has exactly these keys');
SELECT is((SELECT j ->> 'replayed' FROM ch), 'false', 'a new choose');
SELECT results_eq(
  $$ SELECT status, selected_application_id, selected_at = now(), payment_deadline = now() + interval '24 hours' FROM public.requests WHERE id = pg_temp.r(1) $$,
  $$ VALUES ('SELECTED', pg_temp.app(1, 'a1'), true, true) $$, 'the request is SELECTED, with the offer, the time and now + 24 hours');
SELECT results_eq(
  $$ SELECT provider_id, status, status_changed_at = now() FROM public.applications WHERE request_id = pg_temp.r(1) ORDER BY created_at $$,
  $$ VALUES (pg_temp.u('a1'), 'SELECTED', true), (pg_temp.u('a2'), 'NOT_SELECTED', true), (pg_temp.u('a3'), 'NOT_SELECTED', true),
            (pg_temp.u('a5'), 'NOT_SELECTED', true) $$,
  'the chosen offer SELECTED, every other one NOT_SELECTED');
SELECT is((SELECT new_value FROM public.audit_log WHERE action = 'request.provider_chosen' AND entity_id = pg_temp.r(1)::text),
  jsonb_build_object('status', 'SELECTED', 'application_id', pg_temp.app(1, 'a1'), 'payment_deadline', (SELECT j -> 'payment_deadline' FROM ch)),
  'one audit row, with ids and the deadline only');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
SELECT is(public.choose_provider(pg_temp.r(1), pg_temp.app(1, 'a1')), (SELECT j || '{"replayed": true}' FROM ch), 'choosing the same offer again is the replay');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', pg_temp.r(1), pg_temp.app(1, 'a2'))), 'not_choosable', 'choosing another offer now refuses');
SELECT is((public.choose_provider(pg_temp.r(4), pg_temp.app(4, 'a1')) ->> 'payment_deadline')::timestamptz,
  (SELECT scheduled_start_at FROM public.requests WHERE id = pg_temp.r(4)), 'a start in 5 hours caps the deadline');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'request.provider_chosen' AND entity_id = pg_temp.r(1)::text), 1,
  'the replay wrote nothing');

-- ── the offers after the choose (AC-2, AC-9) ─────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
CREATE TEMP TABLE o2 AS SELECT public.request_offers(pg_temp.r(1)) AS j;
SELECT is((SELECT j -> 'offers' FROM o2), '[]', 'no other offer is listed once chosen');
SELECT is((SELECT jsonb_build_object('status', j ->> 'status', 'chosen', j -> 'chosen' ->> 'application_id', 'chosen_status', j -> 'chosen' ->> 'status',
                                     'suspended', j -> 'chosen' -> 'suspended', 'deadline', j -> 'payment_deadline') FROM o2),
  jsonb_build_object('status', 'SELECTED', 'chosen', pg_temp.app(1, 'a1'), 'chosen_status', 'SELECTED', 'suspended', false,
                     'deadline', (SELECT j -> 'payment_deadline' FROM ch)),
  'the chosen offer, its status and the stored deadline');
SELECT is((SELECT array_agg(k ORDER BY k) FROM o2, jsonb_object_keys(j -> 'chosen') k),
  ARRAY['application_id', 'approved_since', 'created_at', 'display_name', 'first_name', 'message', 'message_hidden', 'status', 'suspended'],
  'the chosen offer has the offer keys plus status and suspended');

-- ── the provider's view (AC-12) ──────────────────────────────────────────────
SELECT pg_temp.as_user('a1');
SELECT is((SELECT jsonb_build_object('status', j #>> '{application,status}', 'closed', j -> 'closed', 'deadline', j -> 'payment_deadline')
             FROM (SELECT public.provider_request(pg_temp.r(1)) AS j) x),
  jsonb_build_object('status', 'SELECTED', 'closed', true, 'deadline', (SELECT j -> 'payment_deadline' FROM ch)),
  'the chosen provider reads SELECTED, closed, and the deadline');
SELECT is(public.provider_home_counts() -> 'selected', '2', 'and counts two chosen applications (R1, R4)');
SELECT is((SELECT x -> 'payment_deadline' FROM jsonb_array_elements(public.provider_applications(NULL, NULL) -> 'rows') x WHERE x ->> 'id' = pg_temp.r(1)::text),
  (SELECT j -> 'payment_deadline' FROM ch), 'and My applications carries the deadline too');
SELECT pg_temp.as_user('a2');
SELECT is((SELECT jsonb_build_object('status', j #>> '{application,status}', 'deadline', j -> 'payment_deadline')
             FROM (SELECT public.provider_request(pg_temp.r(1)) AS j) x),
  '{"status": "NOT_SELECTED", "deadline": null}', 'another provider reads NOT_SELECTED and no deadline');
SELECT is(public.provider_home_counts() -> 'selected', '0', 'and counts none chosen');
RESET ROLE;

-- ── the guard on the three columns (AC-7) ────────────────────────────────────
SELECT throws_ok($$ UPDATE public.requests SET payment_deadline = payment_deadline + interval '1 hour' WHERE id = pg_temp.r(1) $$,
  'P0001', 'request_immutable', 'the deadline never changes once set, even as postgres');
SELECT throws_ok($$ UPDATE public.requests SET selected_application_id = pg_temp.app(1, 'a2') WHERE id = pg_temp.r(1) $$,
  'P0001', 'request_immutable', 'nor the chosen offer');
SELECT throws_ok($$ UPDATE public.requests SET selected_at = now(), selected_application_id = pg_temp.app(2, 'a2'), payment_deadline = now() WHERE id = pg_temp.r(2) $$,
  'P0001', 'request_immutable', 'the columns are written only on the move OPEN to SELECTED');
SELECT throws_ok($$ UPDATE public.requests SET status = 'SELECTED' WHERE id = pg_temp.r(2) $$,
  '23514', NULL, 'SELECTED without the three columns is refused by the check');
SELECT throws_ok($$ UPDATE public.requests SET status = 'OPEN' WHERE id = pg_temp.r(1) $$,
  'P0001', 'request_transition_invalid', 'SELECTED never goes back to OPEN in 06');
SELECT throws_ok($$ UPDATE public.applications SET status = 'APPLIED' WHERE id = pg_temp.app(1, 'a2') $$,
  'P0001', 'application_final', 'a NOT_SELECTED offer stays final until 12');
SELECT throws_ok($$ INSERT INTO public.applications (region, request_id, provider_id, message, status)
                    VALUES ('TR', pg_temp.r(4), pg_temp.u('a2'), 'A second chosen offer, never allowed.', 'SELECTED') $$,
  '23505', NULL, 'a request never has two SELECTED applications, even as postgres (review G1)');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'requests_payment_deadline_after_choose'),
  'the deadline is held after the choose time (review G2)');

-- ── a suspension after the choose (AC-2, AC-9) ───────────────────────────────
UPDATE public.providers SET status = 'suspended', suspension_reason = 'Repeated complaints from customers' WHERE id = pg_temp.u('a1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
SELECT is(public.request_offers(pg_temp.r(1)) -> 'chosen' -> 'suspended', 'true', 'the chosen card stays, flagged suspended');
SELECT is((SELECT jsonb_build_object('message', j -> 'chosen' -> 'message', 'hidden', j -> 'chosen' -> 'message_hidden')
             FROM (SELECT public.request_offers(pg_temp.r(1)) AS j) x),
  '{"message": null, "hidden": true}', 'and its message is hidden from then on (review S2)');
RESET ROLE;
UPDATE public.providers SET status = 'approved', suspension_reason = NULL WHERE id = pg_temp.u('a1');

-- ── the cap ignores providers who are not approved now (AC-5) ────────────────
UPDATE public.platform_settings SET value = '1' WHERE region = 'TR' AND key = 'max_applicants_per_request';
INSERT INTO public.provider_services (provider_id, service_id, region) VALUES (pg_temp.u('a2'), pg_temp.u('51'), 'TR'), (pg_temp.u('a5'), pg_temp.u('51'), 'TR');
INSERT INTO public.provider_zones (provider_id, zone_id, region) VALUES (pg_temp.u('a2'), pg_temp.u('21'), 'TR'), (pg_temp.u('a5'), pg_temp.u('21'), 'TR');
INSERT INTO public.provider_availability (provider_id, region, work_days, start_hour, end_hour)
VALUES (pg_temp.u('a2'), 'TR', '{0,1,2,3,4,5,6}', 0, 24), (pg_temp.u('a5'), 'TR', '{0,1,2,3,4,5,6}', 0, 24);
SELECT pg_temp.offer(6, 'a3', 1, 'Suspended, yet my offer was made before.');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT is(public.apply_to_request(pg_temp.r(6), 'I would like to take this one, thank you.') ->> 'status', 'ok',
  'a suspended provider''s offer frees its slot: a2 takes the only one');
SELECT pg_temp.as_user('a5');
SELECT is(pg_temp.err(format('SELECT public.apply_to_request(%L, %L)', pg_temp.r(6), 'And me as well, if there is still room left.')), 'request_full',
  'then the cap of one holds');
RESET ROLE;
UPDATE public.providers SET status = 'approved', suspension_reason = NULL WHERE id = pg_temp.u('a3');
SELECT is(public.approved_applied_count(pg_temp.r(6)), 2, 'a reinstated provider can push the live count past the cap');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT is(public.provider_request(pg_temp.r(6)) -> 'full', 'true', 'which reads as full');
RESET ROLE;
UPDATE public.platform_settings SET value = '10' WHERE region = 'TR' AND key = 'max_applicants_per_request';

-- ── the scanner on apply (AC-13) ─────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a5');
SELECT is(public.apply_to_request(pg_temp.r(6), 'call 0555 when you can, I am free on 123 most days, then 45 and 67 is fine'),
  '{"status": "refused", "code": "contact_info_in_message"}', 'a phone split by words is refused on apply');
RESET ROLE;

-- ── cancel a SELECTED request (AC-11) ────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
SELECT is(public.cancel_request(pg_temp.r(1), 'found_elsewhere'), '{"status": "ok"}', 'the customer cancels a SELECTED request');
RESET ROLE;
SELECT results_eq($$ SELECT status, cancelled_by FROM public.requests WHERE id = pg_temp.r(1) $$, $$ VALUES ('CANCELLED', 'customer') $$,
  'the request is CANCELLED, by the customer');
SELECT results_eq($$ SELECT provider_id, status FROM public.applications WHERE request_id = pg_temp.r(1) ORDER BY created_at $$,
  $$ VALUES (pg_temp.u('a1'), 'CANCELLED'), (pg_temp.u('a2'), 'NOT_SELECTED'), (pg_temp.u('a3'), 'NOT_SELECTED'), (pg_temp.u('a5'), 'NOT_SELECTED') $$,
  'the chosen offer CANCELLED, the others stay NOT_SELECTED');
SELECT is((SELECT old_value FROM public.audit_log WHERE action = 'request.cancelled' AND entity_id = pg_temp.r(1)::text), '{"status": "SELECTED"}',
  'the audit row records the real old status');
SELECT ok((SELECT selected_application_id IS NOT NULL AND payment_deadline IS NOT NULL FROM public.requests WHERE id = pg_temp.r(1)),
  'the choose columns stay as history');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c1');
SELECT is((SELECT jsonb_build_object('offers', j -> 'offers', 'chosen', j -> 'chosen' ->> 'status', 'cancelled', j ->> 'cancelled_at' IS NOT NULL)
             FROM (SELECT public.request_offers(pg_temp.r(1)) AS j) x),
  '{"offers": [], "chosen": "CANCELLED", "cancelled": true}', 'a cancelled request lists no offers and keeps the chosen one, CANCELLED');
SELECT is(pg_temp.err(format('SELECT public.choose_provider(%L, %L)', pg_temp.r(1), pg_temp.app(1, 'a2'))), 'not_choosable', 'a cancelled request cannot be chosen on');
SELECT pg_temp.as_user('a1');
SELECT is(public.provider_request(pg_temp.r(1)) #>> '{application,status}', 'CANCELLED', 'the chosen provider reads CANCELLED');
RESET ROLE;

-- ── grants (AC-15) ───────────────────────────────────────────────────────────
SELECT ok(has_function_privilege('authenticated', 'public.request_offers(uuid)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.choose_provider(uuid, uuid)', 'EXECUTE'),
  'a signed in user may call the two functions (they check who)');
SELECT ok(NOT has_function_privilege('anon', 'public.request_offers(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.choose_provider(uuid, uuid)', 'EXECUTE'),
  'anon may call neither');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('blank_class', 'blank_marks', 'message_digit_limit', 'message_has_contact_info', 'choose_settings',
                          'approved_applied_count', 'offer_display_name', 'offer_card')
        AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')
             OR has_function_privilege('service_role', p.oid, 'EXECUTE')) $$,
  'no helper of 06 has an API grant');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE proname = 'request_offers') AND (SELECT prosecdef FROM pg_proc WHERE proname = 'choose_provider'),
  'both are definer functions');
SELECT ok((SELECT prosrc !~* 'raise[^;]*message' FROM pg_proc WHERE proname = 'choose_provider'), 'no raise carries a message');

SELECT * FROM finish();
ROLLBACK;
