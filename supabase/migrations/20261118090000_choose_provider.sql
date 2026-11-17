-- Position 06 (spec 0010): choose a provider.
--
-- The customer reads the offers on their own request and chooses one. The chosen application becomes
-- SELECTED, every other APPLIED one NOT_SELECTED, the request SELECTED, and a payment deadline starts:
-- the payment window (a setting, 24 hours) or the job's start, whichever comes first. Nothing is paid and
-- nothing is revealed here: 09 takes the commission, 10 opens the contact details.
--
-- Because the customer now reads provider messages, this migration also closes the scanner gaps the 05
-- security review found (tracker R11): a whole message digit rule for apply messages, one source for the
-- blank class, and offers of providers who are not approved now neither shown, chosen nor counted.
--
-- Order below: the blank class -> the message scanner -> the setting -> the request columns and guard ->
-- the helpers -> request_offers -> choose_provider -> cancel_request -> 05's functions on the new cap
-- helper. Every function revokes PUBLIC and pins search_path (supabase/tests/02). Refusals are stable
-- codes in the exception message; lib/requests maps them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. One blank class (AC-14, review G1). blank_class() is whitespace plus the invisible marks; the trim and
--    the text check use it whole. blank_marks() is the same class without whitespace: the contact
--    normaliser strips those marks but keeps the spaces between words, so its gap and word rules hold.
--    lib/requests/blank.ts copies the class; tests/requests-helpers.test.ts proves the copies agree.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.blank_marks()
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select '\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u2069\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\U00013430-\U0001343F\U0001D173-\U0001D17A\U000E0000-\U000E007F\U000E0100-\U000E01EF'::text
$$;

revoke all on function public.blank_marks() from public, anon, authenticated, service_role;

create function public.blank_class()
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select '\s\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u2069\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\U00013430-\U0001343F\U0001D173-\U0001D17A\U000E0000-\U000E007F\U000E0100-\U000E01EF'::text
$$;

revoke all on function public.blank_class() from public, anon, authenticated, service_role;

create or replace function public.catalog_trim(p_text text)
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select regexp_replace(p_text,
    '^[' || public.blank_class() || ']+|[' || public.blank_class() || ']+$',
    '', 'g')
$$;

revoke all on function public.catalog_trim(text) from public, anon, authenticated, service_role;

-- Definer since 06: the catalog checks run as the admin who writes a row, and catalog_trim has no API
-- grant. It reads only its arguments; search_path is pinned.
create or replace function public.catalog_text_ok(p_value jsonb, p_region text, p_max integer)
  returns boolean
  language sql
  immutable
  security definer
  set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_value) = 'object'
    and p_value ? (case p_region when 'TR' then 'tr' when 'KSA' then 'ar' end)
    and not exists (
      select 1
        from jsonb_each(p_value) e
       where e.key not in ('ar', 'tr', 'en')
          or jsonb_typeof(e.value) <> 'string'
          or char_length(public.catalog_trim(e.value #>> '{}')) not between 1 and p_max
    ),
    false)
$$;

revoke all on function public.catalog_text_ok(jsonb, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.catalog_text_ok(jsonb, text, integer) to authenticated;

-- 02's fold and strip, then the marks of the blank class, so a phone padded with braille blanks or Hangul
-- fillers reads as a phone (review F1).
create or replace function public.contact_normalise(p_text text)
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select regexp_replace(
           translate(
             regexp_replace(
               lower(translate(normalize(coalesce(p_text, ''), nfkc), 'İIĞÜŞÖÇÂÎÛ', 'iiğüşöçâîû')),
               '[­̀-ͯـً-ٰٟۖ-ۭ​-‏‪-‮⁠-⁤﻿]',
               '',
               'g'
             ),
             'ığüşöçâîû٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹أإآٱىةؤئکی',
             'igusocaiu01234567890123456789اااايهويكي'
           ),
           '[' || public.blank_marks() || ']',
           '',
           'g')
$$;

revoke all on function public.contact_normalise(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The apply message scanner (AC-13, review F1). A phone needs 10 digits however it is split, so a
--    message holding 10 or more digits anywhere is refused. Bios, notes and answers keep has_contact_info.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.message_digit_limit()
  returns integer
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select 10
$$;

revoke all on function public.message_digit_limit() from public, anon, authenticated, service_role;

create function public.message_has_contact_info(p_text text)
  returns boolean
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  -- Figures plus spelled digit words count together, so 9 figures and 2 spelled digits are caught (06
  -- security review S1). The everyday words for "one" (one, bir, واحد) do not count: they read as "a".
  select public.has_contact_info(p_text)
      or char_length(regexp_replace(t, '[^0-9]', '', 'g'))
         + (select count(*)::integer
              from regexp_split_to_table(t, '[^a-z0-9ء-ي]+') w
             where w = any (array[
               'zero', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
               'sifir', 'iki', 'uc', 'dort', 'bes', 'alti', 'yedi', 'sekiz', 'dokuz',
               'صفر', 'اثنان', 'اثنين', 'اتنين', 'ثلاثه', 'ثلاث', 'تلاته', 'اربعه', 'اربع',
               'خمسه', 'خمس', 'سته', 'ست', 'سبعه', 'سبع', 'ثمانيه', 'ثماني', 'ثمان', 'تمانيه', 'تسعه', 'تسع']))
         >= public.message_digit_limit()
    from (select public.contact_normalise(p_text) as t) x
$$;

revoke all on function public.message_has_contact_info(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The payment window (AC-7, D160): hours, 1 to 72, 24 in both regions. A missing or malformed value
--    refuses at use, never a default. Edited by SQL until 16.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_payment_window_hours_valid check (
    case when key <> 'payment_window_hours' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 72 end);

insert into public.platform_settings (region, key, value) values
  ('TR',  'payment_window_hours', '24'),
  ('KSA', 'payment_window_hours', '24')
on conflict (region, key) do nothing;

create function public.choose_settings(p_region text)
  returns integer
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_value jsonb;
begin
  select s.value into v_value from public.platform_settings s
   where s.region = p_region and s.key = 'payment_window_hours';
  if jsonb_typeof(v_value) is distinct from 'number'
     or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
     or (v_value #>> '{}')::numeric not between 1 and 72 then
    raise exception 'choose_settings_invalid';
  end if;
  return (v_value #>> '{}')::numeric::integer;
end;
$$;

revoke all on function public.choose_settings(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The choose on the request (AC-7). Three columns, null together, set together on OPEN -> SELECTED and
--    never changed after (12 widens this for its reopen). The key ties the chosen application to this
--    request; the region follows through applications (request_id, region).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.applications add constraint applications_id_request unique (id, request_id);

alter table public.requests
  add column selected_application_id uuid,
  add column selected_at timestamptz,
  add column payment_deadline timestamptz,
  add constraint requests_selected_application_fk foreign key (selected_application_id, id)
    references public.applications (id, request_id),
  add constraint requests_selection_together check (
    (selected_application_id is null) = (selected_at is null)
    and (selected_at is null) = (payment_deadline is null)),
  add constraint requests_selected_set check (status <> 'SELECTED' or selected_application_id is not null),
  add constraint requests_payment_deadline_order check (payment_deadline is null or payment_deadline <= scheduled_start_at),
  add constraint requests_payment_deadline_after_choose check (payment_deadline is null or payment_deadline > selected_at);

create index requests_selected_application_idx on public.requests (selected_application_id, id);

-- At most one SELECTED application per request, whoever writes it (06 security review G1): 09, 10 and 12
-- add writers.
create unique index applications_one_selected_idx on public.applications (request_id) where status = 'SELECTED';

-- The frozen columns as before; the status moves of 04 and 06; the three choose columns written only on
-- the move OPEN -> SELECTED, and never changed after.
create or replace function public.requests_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                            'selected_application_id', 'selected_at', 'payment_deadline'])
     is distinct from (to_jsonb(old) - array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                                             'selected_application_id', 'selected_at', 'payment_deadline']) then
    raise exception 'request_immutable';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'OPEN' and new.status in ('CANCELLED', 'SELECTED'))
              or (old.status = 'SELECTED' and new.status = 'CANCELLED')) then
    raise exception 'request_transition_invalid';
  end if;
  if (new.selected_application_id, new.selected_at, new.payment_deadline)
     is distinct from (old.selected_application_id, old.selected_at, old.payment_deadline)
     and not (old.status = 'OPEN' and new.status = 'SELECTED') then
    raise exception 'request_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.requests_guard() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Helpers. None has an API grant: they run only inside the definer functions below.
-- ═══════════════════════════════════════════════════════════════════════════

-- The offers that hold a cap slot: APPLIED, from a provider who is approved now (AC-5, review F2). Every
-- cap count reads this one helper; provider_standing stays the one source of standing.
create function public.approved_applied_count(p_request_id uuid)
  returns integer
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select count(*)::integer
    from public.applications a
   where a.request_id = p_request_id
     and a.status = 'APPLIED'
     and public.provider_standing(a.provider_id) is not distinct from 'approved'
$$;

revoke all on function public.approved_applied_count(uuid) from public, anon, authenticated, service_role;

-- The first word, a space, the first code point of the last word and a full stop (AC-3). A single word
-- stays whole; a blank name is null. Never case folded (rule 10).
create function public.offer_display_name(p_name text)
  returns jsonb
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  -- Words split on the whole blank class, not only spaces, so an invisible mark between words cannot keep a
  -- full name whole; a name the scanner flags (a phone, a handle) shows as "Provider" (06 review S3).
  select case
           when w is null or public.has_contact_info(p_name) then jsonb_build_object('display_name', null, 'first_name', null)
           when cardinality(w) = 1 then jsonb_build_object('display_name', w[1], 'first_name', w[1])
           else jsonb_build_object('display_name', w[1] || ' ' || left(w[cardinality(w)], 1) || '.',
                                   'first_name', w[1])
         end
    from (select regexp_split_to_array(nullif(public.catalog_trim(p_name), ''), '[' || public.blank_class() || ']+') as w) x
$$;

revoke all on function public.offer_display_name(text) from public, anon, authenticated, service_role;

-- One offer as the customer reads it: named fields only, a message the new rule would refuse hidden.
create function public.offer_card(p_application public.applications, p_timezone text)
  returns jsonb
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select jsonb_build_object(
           'application_id', (p_application).id,
           'approved_since', to_char(date_trunc('month', pr.approved_at at time zone p_timezone), 'YYYY-MM-DD'),
           'message', case when public.message_has_contact_info((p_application).message) then null
                           else (p_application).message end,
           'message_hidden', public.message_has_contact_info((p_application).message),
           'created_at', (p_application).created_at)
         || public.offer_display_name(pr.approved_name)
    from public.providers pr
   where pr.id = (p_application).provider_id
$$;

revoke all on function public.offer_card(public.applications, text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The customer's read of the offers (AC-2 to AC-5, AC-9, AC-10, AC-13). The only customer read of
--    applications: no read policy exists. Null when the caller is not the request's customer.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.request_offers(p_request_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_req     public.requests%rowtype;
  v_tz      text;
  v_window  integer;
  v_offers  jsonb := '[]'::jsonb;
  v_chosen  jsonb;
begin
  select r.* into v_req from public.requests r
   where r.id = p_request_id and r.customer_id = (select auth.uid());
  if not found then
    return null;
  end if;
  select g.timezone into v_tz from public.regions g where g.code = v_req.region;
  begin
    v_window := public.choose_settings(v_req.region);
  exception when raise_exception then
    v_window := null;
  end;

  if v_req.status = 'OPEN' then
    select coalesce(jsonb_agg(public.offer_card(a, v_tz) order by a.created_at, a.id), '[]'::jsonb)
      into v_offers
      from public.applications a
     where a.request_id = v_req.id
       and a.status = 'APPLIED'
       and public.provider_standing(a.provider_id) is not distinct from 'approved';
  end if;

  if v_req.selected_application_id is not null then
    select public.offer_card(a, v_tz)
           || jsonb_build_object('status', a.status,
                                 'suspended', public.provider_standing(a.provider_id) is distinct from 'approved')
      into v_chosen
      from public.applications a
     where a.id = v_req.selected_application_id;
    -- A provider suspended after the choose may have been suspended for that very message: it is hidden
    -- from then on (06 security review S2).
    if (v_chosen ->> 'suspended')::boolean then
      v_chosen := v_chosen || jsonb_build_object('message', null, 'message_hidden', true);
    end if;
  end if;

  return jsonb_build_object(
    'status', v_req.status,
    'timezone', v_tz,
    'payment_window_hours', v_window,
    'selected_at', v_req.selected_at,
    'payment_deadline', v_req.payment_deadline,
    'cancelled_at', v_req.cancelled_at,
    'offers', v_offers,
    'chosen', v_chosen);
end;
$$;

revoke all on function public.request_offers(uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_offers(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Choose (AC-7, D160, D162). The only way to choose, in one transaction, in the spec's order. Lock order
--    (D156): the request row, then the chosen provider's row (shared), then the request's applications.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.choose_provider(p_request_id uuid, p_application_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_req       public.requests%rowtype;
  v_window    integer;
  v_provider  uuid;
  v_app_req   uuid;
  v_status    text;
  v_deadline  timestamptz;
  v_now       timestamptz := now();
begin
  -- 1. The request, locked, the caller's own.
  select r.* into v_req from public.requests r
   where r.id = p_request_id and r.customer_id = v_uid
     for update;
  if not found then
    raise exception 'not_found';
  end if;

  -- 2. The same offer chosen again: the stored answer, no write.
  if v_req.status = 'SELECTED' and v_req.selected_application_id = p_application_id then
    return jsonb_build_object('status', 'ok', 'replayed', true,
                              'selected_at', v_req.selected_at, 'payment_deadline', v_req.payment_deadline);
  end if;

  -- 3. Open, and before its start.
  if v_req.status <> 'OPEN' or v_req.scheduled_start_at <= v_now then
    raise exception 'not_choosable';
  end if;

  -- 4. The payment window of the request's region.
  v_window := public.choose_settings(v_req.region);

  -- 5. The application without a lock (every change to this request's applications takes the request lock
  --    first, and provider_id never changes), then its provider shared, then the applications.
  select a.provider_id, a.request_id into v_provider, v_app_req
    from public.applications a
   where a.id = p_application_id;
  if not found or v_app_req is distinct from v_req.id then
    raise exception 'offer_unavailable';
  end if;
  perform 1 from public.providers pr where pr.id = v_provider for share;
  perform 1 from public.applications a where a.request_id = v_req.id for update;

  -- 6. Still APPLIED, from a provider approved now.
  select a.status into v_status from public.applications a where a.id = p_application_id;
  if v_status is distinct from 'APPLIED'
     or public.provider_standing(v_provider) is distinct from 'approved' then
    raise exception 'offer_unavailable';
  end if;

  -- 7. The chosen one SELECTED, every other APPLIED one NOT_SELECTED.
  update public.applications a
     set status = case when a.id = p_application_id then 'SELECTED' else 'NOT_SELECTED' end,
         status_changed_at = v_now
   where a.request_id = v_req.id and a.status = 'APPLIED';

  -- 8. The request, with the deadline capped by the start.
  v_deadline := least(v_now + make_interval(hours => v_window), v_req.scheduled_start_at);
  update public.requests
     set status = 'SELECTED', selected_application_id = p_application_id, selected_at = v_now,
         payment_deadline = v_deadline
   where id = v_req.id;

  -- 9. Ids and the deadline only.
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.provider_chosen', 'requests', v_req.id::text, v_req.region,
          jsonb_build_object('status', 'OPEN'),
          jsonb_build_object('status', 'SELECTED', 'application_id', p_application_id,
                             'payment_deadline', v_deadline));

  return jsonb_build_object('status', 'ok', 'replayed', false, 'selected_at', v_now, 'payment_deadline', v_deadline);
end;
$$;

revoke all on function public.choose_provider(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.choose_provider(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Cancel, replaced again (AC-11, §36 row 2). 05's behaviour, plus SELECTED: the request CANCELLED and its
--    SELECTED application CANCELLED; NOT_SELECTED rows stay. Nothing was paid, so nothing comes back. The
--    audit row records the real old status.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.cancel_request(p_request_id uuid, p_reason text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_req  record;
begin
  if p_reason is not null and p_reason not in ('plans_changed', 'found_elsewhere', 'price', 'other') then
    raise exception 'validation_failed';
  end if;
  select r.id, r.status, r.region, r.fixed_price into v_req
    from public.requests r
   where r.id = p_request_id and r.customer_id = v_uid
     for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_req.status = 'CANCELLED' then
    return jsonb_build_object('status', 'ok');
  end if;
  if v_req.status not in ('OPEN', 'SELECTED') then
    raise exception 'not_cancellable';
  end if;

  update public.requests
     set status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'customer', cancel_reason = p_reason
   where id = p_request_id;

  update public.applications a
     set status = 'CANCELLED', status_changed_at = now()
   where a.request_id = p_request_id and a.status in ('APPLIED', 'SELECTED');

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.cancelled', 'requests', p_request_id::text, v_req.region,
          jsonb_build_object('status', v_req.status),
          jsonb_build_object('status', 'CANCELLED', 'fixed_price', v_req.fixed_price));

  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.cancel_request(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_request(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. 05's provider functions, replaced: every cap count reads approved_applied_count (AC-5);
--    apply_to_request scans the message with message_has_contact_info (AC-13); provider_request and
--    provider_applications add the payment deadline for the provider whose application is SELECTED, and
--    provider_home_counts the selected count (AC-12). The rest of each body is 05's, unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.provider_feed(
  p_service_ids    uuid[],
  p_zone_ids       uuid[],
  p_from           date,
  p_to             date,
  p_after_outside  boolean,
  p_after_start    timestamptz,
  p_after_id       uuid
)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_me     public.providers%rowtype;
  v_tz     text;
  v_cap    integer;
  v_days   smallint[];
  v_first  integer;
  v_last   integer;
  v_rows   jsonb;
  v_more   boolean;
begin
  v_me := public.provider_reader();
  select g.timezone into v_tz from public.regions g where g.code = v_me.region;
  -- A filter longer than any setup can match nothing more: refused as empty before any row is read.
  if public.provider_standing(v_me.id) is distinct from 'approved'
     or not public.provider_setup_complete(v_me.id)
     or coalesce(cardinality(p_service_ids), 0) > 50
     or coalesce(cardinality(p_zone_ids), 0) > 100 then
    return jsonb_build_object('timezone', v_tz, 'has_more', false, 'rows', '[]'::jsonb);
  end if;

  v_cap := (public.apply_settings(v_me.region) ->> 'max_applicants_per_request')::integer;
  select a.work_days, a.start_hour, a.end_hour into v_days, v_first, v_last
    from public.provider_availability a
   where a.provider_id = v_me.id;

  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= 20), '[]'::jsonb), count(*) > 20
    into v_rows, v_more
    from (
      select row_number() over (order by m.outside_hours, m.scheduled_start_at, m.id) as rn,
             public.provider_short_details(m.req) || jsonb_build_object(
               'applied_count', m.applied_count,
               'cap', v_cap,
               'full', m.applied_count >= v_cap,
               'outside_hours', m.outside_hours,
               'application', (
                 select jsonb_build_object('id', a.id, 'status', a.status, 'created_at', a.created_at)
                   from public.applications a
                  where a.request_id = m.id and a.provider_id = v_me.id)) as j
        from (
          select q.req, q.id, q.scheduled_start_at, q.outside_hours, q.applied_count
            from (
              select r as req, r.id, r.scheduled_start_at,
                     public.provider_outside_hours(r.scheduled_start_at, v_tz, v_days, v_first, v_last) as outside_hours,
                     public.approved_applied_count(r.id) as applied_count
                from public.requests r
               where r.region = v_me.region
                 and r.status = 'OPEN'
                 and r.scheduled_start_at > now()
                 and exists (select 1 from public.provider_services ps
                              where ps.provider_id = v_me.id and ps.service_id = r.service_id)
                 and exists (select 1 from public.provider_zones pz
                              where pz.provider_id = v_me.id and pz.zone_id = r.zone_id)
                 and (p_service_ids is null or r.service_id = any (p_service_ids))
                 and (p_zone_ids is null or r.zone_id = any (p_zone_ids))
                 and (p_from is null or (r.scheduled_start_at at time zone v_tz)::date >= p_from)
                 and (p_to is null or (r.scheduled_start_at at time zone v_tz)::date < p_to)
            ) q
           where p_after_outside is null or p_after_start is null or p_after_id is null
              or (q.outside_hours, q.scheduled_start_at, q.id) > (p_after_outside, p_after_start, p_after_id)
           order by q.outside_hours, q.scheduled_start_at, q.id
           limit 21
        ) m
    ) x;

  return jsonb_build_object('timezone', v_tz, 'has_more', v_more, 'rows', v_rows);
end;
$$;

revoke all on function public.provider_feed(uuid[], uuid[], date, date, boolean, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.provider_feed(uuid[], uuid[], date, date, boolean, timestamptz, uuid) to authenticated;

create or replace function public.provider_request(p_request_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_me       public.providers%rowtype;
  v_tz       text;
  v_req      public.requests%rowtype;
  v_app      jsonb;
  v_in_feed  boolean;
  v_cap      integer;
  v_count    integer;
  v_days     smallint[];
  v_first    integer;
  v_last     integer;
begin
  v_me := public.provider_reader();
  select r.* into v_req from public.requests r where r.id = p_request_id and r.region = v_me.region;
  if not found then
    return null;
  end if;

  select jsonb_build_object('id', a.id, 'status', a.status, 'created_at', a.created_at) into v_app
    from public.applications a
   where a.request_id = v_req.id and a.provider_id = v_me.id;

  v_in_feed := v_req.status = 'OPEN'
    and v_req.scheduled_start_at > now()
    and public.provider_standing(v_me.id) is not distinct from 'approved'
    and public.provider_setup_complete(v_me.id)
    and exists (select 1 from public.provider_services ps
                 where ps.provider_id = v_me.id and ps.service_id = v_req.service_id)
    and exists (select 1 from public.provider_zones pz
                 where pz.provider_id = v_me.id and pz.zone_id = v_req.zone_id);
  if v_app is null and not v_in_feed then
    return null;
  end if;

  select g.timezone into v_tz from public.regions g where g.code = v_me.region;
  v_cap := (public.apply_settings(v_me.region) ->> 'max_applicants_per_request')::integer;
  v_count := public.approved_applied_count(v_req.id);
  select a.work_days, a.start_hour, a.end_hour into v_days, v_first, v_last
    from public.provider_availability a
   where a.provider_id = v_me.id;

  return public.provider_short_details(v_req) || jsonb_build_object(
    'applied_count', v_count,
    'cap', v_cap,
    'full', v_count >= v_cap,
    'outside_hours', public.provider_outside_hours(v_req.scheduled_start_at, v_tz, v_days, v_first, v_last),
    'application', v_app,
    'closed', v_req.status <> 'OPEN' or v_req.scheduled_start_at <= now(),
    'timezone', v_tz,
    'answers', public.provider_structured_answers(v_req.questions_snapshot, v_req.answers),
    'payment_deadline', case when v_app ->> 'status' = 'SELECTED' then v_req.payment_deadline end);
end;
$$;

revoke all on function public.provider_request(uuid) from public, anon, authenticated, service_role;
grant execute on function public.provider_request(uuid) to authenticated;

create or replace function public.provider_applications(p_after_created_at timestamptz, p_after_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_me    public.providers%rowtype;
  v_tz    text;
  v_rows  jsonb;
  v_more  boolean;
begin
  v_me := public.provider_reader();
  select g.timezone into v_tz from public.regions g where g.code = v_me.region;

  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= 20), '[]'::jsonb), count(*) > 20
    into v_rows, v_more
    from (
      select row_number() over (order by m.created_at desc, m.id desc) as rn,
             public.provider_short_details(m.req) || jsonb_build_object(
               'application', jsonb_build_object('id', m.id, 'status', m.status, 'created_at', m.created_at),
               'payment_deadline', case when m.status = 'SELECTED' then (m.req).payment_deadline end) as j
        from (
          select a.id, a.status, a.created_at, r as req
            from public.applications a
            join public.requests r on r.id = a.request_id
           where a.provider_id = v_me.id
             and (p_after_created_at is null or p_after_id is null
                  or (a.created_at, a.id) < (p_after_created_at, p_after_id))
           order by a.created_at desc, a.id desc
           limit 21
        ) m
    ) x;

  return jsonb_build_object('timezone', v_tz, 'has_more', v_more, 'rows', v_rows);
end;
$$;

revoke all on function public.provider_applications(timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.provider_applications(timestamptz, uuid) to authenticated;

create or replace function public.provider_home_counts()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_me        public.providers%rowtype;
  v_complete  boolean;
  v_cap       integer;
  v_open      integer := 0;
  v_applied   integer;
  v_selected  integer;
begin
  v_me := public.provider_reader();
  v_complete := public.provider_setup_complete(v_me.id);

  if v_complete and public.provider_standing(v_me.id) is not distinct from 'approved' then
    v_cap := (public.apply_settings(v_me.region) ->> 'max_applicants_per_request')::integer;
    select count(*) into v_open
      from public.requests r
     where r.region = v_me.region
       and r.status = 'OPEN'
       and r.scheduled_start_at > now()
       and exists (select 1 from public.provider_services ps
                    where ps.provider_id = v_me.id and ps.service_id = r.service_id)
       and exists (select 1 from public.provider_zones pz
                    where pz.provider_id = v_me.id and pz.zone_id = r.zone_id)
       and public.approved_applied_count(r.id) < v_cap;
  end if;

  select count(*) into v_applied
    from public.applications a
   where a.provider_id = v_me.id and a.status = 'APPLIED';

  select count(*) into v_selected
    from public.applications a
   where a.provider_id = v_me.id and a.status = 'SELECTED';

  return jsonb_build_object('setup_complete', v_complete, 'open_requests', v_open, 'applied', v_applied,
                            'selected', v_selected);
end;
$$;

revoke all on function public.provider_home_counts() from public, anon, authenticated, service_role;
grant execute on function public.provider_home_counts() to authenticated;

create or replace function public.apply_to_request(p_request_id uuid, p_message text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_me        public.providers%rowtype;
  v_standing  text;
  v_req       record;
  v_app       record;
  v_settings  jsonb;
  v_count     integer;
  v_message   text;
begin
  -- 1. A provider profile with a providers row; identity from the token only.
  v_me := public.provider_reader();

  -- 2. Standing: approved only, so an expired document is refused too.
  v_standing := public.provider_standing(v_me.id);
  if v_standing = 'suspended' then
    raise exception 'provider_suspended';
  end if;
  if v_standing is distinct from 'approved' then
    raise exception 'not_approved';
  end if;

  -- 3. The setup gates applying (D151).
  if not public.provider_setup_complete(v_me.id) then
    raise exception 'setup_incomplete';
  end if;

  -- 4. The request row, locked: cancel and choose take the same lock first. An unknown id and another
  --    region read the same.
  select r.id, r.region, r.status, r.service_id, r.zone_id, r.scheduled_start_at into v_req
    from public.requests r
   where r.id = p_request_id and r.region = v_me.region
     for update;
  if not found then
    raise exception 'not_found';
  end if;

  -- 4b. The caller's providers row, shared, then the standing again: a suspension that commits while this
  --     apply runs either waits for it or is seen here (review F2). Suspend touches no request row, so the
  --     order request, then provider, cannot deadlock with it.
  perform 1 from public.providers pr where pr.id = v_me.id for share;
  v_standing := public.provider_standing(v_me.id);
  if v_standing = 'suspended' then
    raise exception 'provider_suspended';
  end if;
  if v_standing is distinct from 'approved' then
    raise exception 'not_approved';
  end if;

  -- 5. A repeat returns the stored application with no write, whatever the request's state now.
  select a.id, a.status, a.created_at into v_app
    from public.applications a
   where a.request_id = v_req.id and a.provider_id = v_me.id;
  if found then
    return jsonb_build_object('status', 'ok', 'replayed', true, 'application',
             jsonb_build_object('id', v_app.id, 'status', v_app.status, 'created_at', v_app.created_at));
  end if;

  -- 6. Outside the caller's stored picks reads as unknown, so ids cannot be probed.
  if not exists (select 1 from public.provider_services ps
                  where ps.provider_id = v_me.id and ps.service_id = v_req.service_id)
     or not exists (select 1 from public.provider_zones pz
                     where pz.provider_id = v_me.id and pz.zone_id = v_req.zone_id) then
    raise exception 'not_found';
  end if;

  -- 7. Open to applications until its start.
  if v_req.status <> 'OPEN' or v_req.scheduled_start_at <= now() then
    raise exception 'request_closed';
  end if;

  -- 8, 9. The cap, held by the row lock of step 4.
  v_settings := public.apply_settings(v_req.region);
  v_count := public.approved_applied_count(v_req.id);
  if v_count >= (v_settings ->> 'max_applicants_per_request')::integer then
    raise exception 'request_full';
  end if;

  -- 10. One attempt against the hourly limit.
  perform public.count_application(v_me.id, v_req.region, (v_settings ->> 'applications_per_hour')::integer);

  -- 11. The message: capped in bytes before any regex reads it, trimmed, 20 to 600 code points.
  if p_message is null or octet_length(p_message) > 8192 then
    return jsonb_build_object('status', 'refused', 'code', 'message_invalid');
  end if;
  v_message := public.catalog_trim(p_message);
  if char_length(v_message) not between 20 and 600 then
    return jsonb_build_object('status', 'refused', 'code', 'message_invalid');
  end if;

  -- 12. The contact scanner (D153).
  if public.message_has_contact_info(v_message) then
    return jsonb_build_object('status', 'refused', 'code', 'contact_info_in_message');
  end if;

  -- 13. The application, in its request's region.
  insert into public.applications (region, request_id, provider_id, message)
  values (v_req.region, v_req.id, v_me.id, v_message)
  returning id, status, created_at into v_app;

  return jsonb_build_object('status', 'ok', 'replayed', false, 'application',
           jsonb_build_object('id', v_app.id, 'status', v_app.status, 'created_at', v_app.created_at));
end;
$$;

revoke all on function public.apply_to_request(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.apply_to_request(uuid, text) to authenticated;
