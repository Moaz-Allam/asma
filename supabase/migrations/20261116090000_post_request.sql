-- Position 04 (spec 0008): post a request.
--
-- A customer answers a service's questions, picks a district, a day and an hour, types the street
-- line, and publishes a request as OPEN. The price, the platform's commission and the cash due are
-- computed here, in the same transaction that creates the request, so nothing a browser sends can
-- change them (rule 1). The browser also sends the two figures it saw; they are compared and never
-- stored (D140). The exact address lives in its own table that only its customer reads, until
-- position 10 opens it to a provider who has paid.
--
-- Order below: regions.timezone -> zones (id, region) -> settings -> the three tables -> RLS ->
-- grants -> guards -> the settings readers and the split -> the quote rate limit -> the catalog
-- read -> quote, create and cancel -> the revoke on quote_price. Every function revokes PUBLIC and
-- pins search_path (supabase/tests/02). Refusals are stable codes in the exception message;
-- lib/requests maps them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Five Minor findings of the security pass over 03 (tracker Next, 2026-11-15), owed to this
--    migration because 04 is the first customer path into the engine.
--    (a) Both blank patterns gain the Hangul fillers, the braille blank, the variation selectors and
--        the tag characters. The pattern is written with escapes, the same in both copies;
--        supabase/tests/12 proves the two copies match.
--    (b) pricing_answer_errors caps the answers object at 64 KiB and one answer at 16 KiB or 30
--        array items, so a huge text or a long multi select costs nothing per key.
--    (c) answer_unknown echoes a caller key only when it could be a question key; any other unknown
--        key comes back once, as a null key.
--    (d) platform_settings gains an audit trigger: an admin token may write it.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.catalog_text_ok(p_value jsonb, p_region text, p_max integer)
  returns boolean
  language sql
  immutable
  security invoker
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
          or char_length(regexp_replace(e.value #>> '{}',
               '^[\s\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u2069\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\U000E0000-\U000E007F\U000E0100-\U000E01EF]+|[\s\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u2069\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\U000E0000-\U000E007F\U000E0100-\U000E01EF]+$',
               '', 'g')) not between 1 and p_max
    ),
    false)
$$;

create or replace function public.catalog_trim(p_text text)
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select regexp_replace(p_text,
    '^[\s\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u2069\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\U000E0000-\U000E007F\U000E0100-\U000E01EF]+|[\s\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u2069\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\U000E0000-\U000E007F\U000E0100-\U000E01EF]+$',
    '', 'g')
$$;

create or replace function public.pricing_answer_errors(p_questions jsonb, p_answers jsonb, p_priced_only boolean)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_errors  jsonb := '[]'::jsonb;
  v_q       jsonb;
  v_key     text;
  v_type    text;
  v_answer  jsonb;
  v_code    text;
  v_num     numeric;
  v_min     numeric;
  v_max     numeric;
  v_step    numeric;
  v_text    text;
  v_limit   integer;
  v_y       integer;
  v_m       integer;
  v_d       integer;
  v_values  text[];
begin
  if jsonb_typeof(p_answers) is distinct from 'object' then
    return jsonb_build_array(jsonb_build_object('key', null, 'code', 'answer_invalid'));
  end if;
  -- More than 64 KiB in all, or more keys than the service has questions plus room for slack, is junk:
  -- one error, no per key work.
  if octet_length(p_answers::text) > 65536
     or (select count(*) from jsonb_object_keys(p_answers)) > jsonb_array_length(coalesce(p_questions, '[]'::jsonb)) + 100 then
    return jsonb_build_array(jsonb_build_object('key', null, 'code', 'answer_invalid'));
  end if;

  -- A key that names no question of the set. Echoed only when it could be a question key; any other
  -- comes back once, with a null key, so a caller never gets an arbitrary string back.
  select v_errors || coalesce(jsonb_agg(jsonb_build_object('key', a.key, 'code', 'answer_unknown')), '[]'::jsonb)
    into v_errors
    from jsonb_object_keys(p_answers) a(key)
   where a.key ~ '^[a-z][a-z0-9_]{0,39}$'
     and not exists (select 1 from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) q
                      where q ->> 'key' = a.key);
  if exists (select 1 from jsonb_object_keys(p_answers) a(key) where a.key !~ '^[a-z][a-z0-9_]{0,39}$') then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('key', null, 'code', 'answer_unknown'));
  end if;

  for v_q in select q from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) q loop
    if p_priced_only and not coalesce((v_q ->> 'affects_pricing')::boolean, false) then
      continue;
    end if;
    v_key := v_q ->> 'key';
    v_type := v_q ->> 'type';
    v_answer := p_answers -> v_key;
    v_code := null;

    if v_answer is not null
       and (octet_length(v_answer::text) > 16384
            or (jsonb_typeof(v_answer) = 'array' and jsonb_array_length(v_answer) > 30)) then
      v_code := 'answer_out_of_range';
    elsif public.pricing_answer_blank(v_answer) then
      if coalesce((v_q ->> 'required')::boolean, false) then
        v_code := 'answer_required';
      end if;
    elsif v_type = 'number' then
      if jsonb_typeof(v_answer) <> 'number' or (v_answer #>> '{}')::numeric <> trunc((v_answer #>> '{}')::numeric) then
        v_code := 'answer_invalid';
      else
        v_num := (v_answer #>> '{}')::numeric;
        v_min := (v_q -> 'validation' ->> 'min')::numeric;
        v_max := (v_q -> 'validation' ->> 'max')::numeric;
        v_step := (v_q -> 'validation' ->> 'step')::numeric;
        if v_num < v_min or v_num > v_max or mod(v_num - v_min, v_step) <> 0 then
          v_code := 'answer_out_of_range';
        end if;
      end if;
    elsif v_type in ('single_select', 'multi_select') then
      select array_agg(o ->> 'value') into v_values from jsonb_array_elements(v_q -> 'options') o;
      if v_type = 'single_select' then
        if jsonb_typeof(v_answer) <> 'string' or not ((v_answer #>> '{}') = any (v_values)) then
          v_code := 'answer_invalid';
        end if;
      elsif jsonb_typeof(v_answer) <> 'array'
            or exists (select 1 from jsonb_array_elements(v_answer) e
                        where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (v_values)))
            or (select count(distinct e #>> '{}') from jsonb_array_elements(v_answer) e) <> jsonb_array_length(v_answer) then
        v_code := 'answer_invalid';
      end if;
    elsif v_type = 'boolean' then
      if jsonb_typeof(v_answer) <> 'boolean' then
        v_code := 'answer_invalid';
      end if;
    elsif v_type in ('text', 'textarea') then
      if jsonb_typeof(v_answer) <> 'string' then
        v_code := 'answer_invalid';
      else
        v_text := public.catalog_trim(v_answer #>> '{}');
        v_limit := coalesce((v_q -> 'validation' ->> 'maxLength')::numeric::integer, case v_type when 'text' then 200 else 500 end);
        if char_length(v_text) > v_limit then
          v_code := 'answer_out_of_range';
        elsif public.has_contact_info(v_text) then
          v_code := 'contact_info_in_answer';
        end if;
      end if;
    elsif v_type = 'date' then
      if jsonb_typeof(v_answer) <> 'string' or (v_answer #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        v_code := 'answer_invalid';
      else
        v_y := substr(v_answer #>> '{}', 1, 4)::integer;
        v_m := substr(v_answer #>> '{}', 6, 2)::integer;
        v_d := substr(v_answer #>> '{}', 9, 2)::integer;
        if v_y < 1 or v_m not between 1 and 12 or v_d < 1
           or v_d > extract(day from (make_date(v_y, v_m, 1) + interval '1 month' - interval '1 day'))::integer then
          v_code := 'answer_invalid';
        end if;
      end if;
    elsif v_type = 'time' then
      if jsonb_typeof(v_answer) <> 'string' or (v_answer #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        v_code := 'answer_invalid';
      end if;
    end if;

    if v_code is not null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('key', v_key, 'code', v_code));
    end if;
  end loop;

  -- At most 50 errors, the first by key: enough for a form, bounded for a hostile caller.
  return coalesce(
    (select jsonb_agg(e order by (e ->> 'key') collate "C", e ->> 'code')
       from (select e from jsonb_array_elements(v_errors) e
              order by (e ->> 'key') collate "C", e ->> 'code' limit 50) x),
    '[]'::jsonb);
end;
$$;

-- An admin token may write platform_settings (its policy covers every command), so every change is
-- recorded, the SQL editor's too. Settings hold no personal data; the values are copied whole.
create function public.platform_settings_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row public.platform_settings%rowtype;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (auth.uid(), 'settings.' || lower(tg_op), 'platform_settings', v_row.region || ':' || v_row.key, v_row.region,
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return null;
end;
$$;

revoke all on function public.platform_settings_audit() from public, anon, authenticated, service_role;

create trigger platform_settings_audit after insert or update or delete on public.platform_settings
  for each row execute function public.platform_settings_audit();

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. regions.timezone (AC-1). A start is a local date and hour, built into a timestamp here, so no
--    time zone arithmetic happens in TypeScript. Added nullable, both rows set, then not null.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.regions add column timezone text;
update public.regions set timezone = 'Europe/Istanbul' where code = 'TR';
update public.regions set timezone = 'Asia/Riyadh' where code = 'KSA';
alter table public.regions alter column timezone set not null;

-- A check cannot read pg_timezone_names, so a trigger holds the name to the IANA list.
create function public.regions_timezone_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = new.timezone) then
    raise exception 'timezone_invalid';
  end if;
  return new;
end;
$$;

revoke all on function public.regions_timezone_guard() from public, anon, authenticated, service_role;

create trigger regions_timezone_guard before insert or update of timezone on public.regions
  for each row execute function public.regions_timezone_guard();

-- A request names its zone with the region in the key (AC-2).
alter table public.zones add constraint zones_id_region unique (id, region);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Settings (AC-1, AC-28). Each key's own shape is a row check; the two pairs (lead and horizon,
--    first and last hour) are held at commit by a deferred trigger, so a pair changes in one
--    transaction. A missing row refuses at use, never a default. Edited by SQL until 16.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_commission_percent_valid check (
    case when key <> 'commission_percent' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric > 0 and (value #>> '{}')::numeric < 100
              and (value #>> '{}')::numeric = round((value #>> '{}')::numeric, 2) end),
  add constraint platform_settings_request_lead_days_valid check (
    case when key <> 'request_lead_days' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 0 and 30 end),
  add constraint platform_settings_request_horizon_days_valid check (
    case when key <> 'request_horizon_days' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 90 end),
  add constraint platform_settings_request_hours_valid check (
    case when key not in ('request_first_hour', 'request_last_hour') then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 0 and 23 end),
  add constraint platform_settings_max_open_requests_valid check (
    case when key <> 'max_open_requests' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 100 end),
  add constraint platform_settings_quotes_per_hour_valid check (
    case when key <> 'quotes_per_hour' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 10000 end);

-- The pairs, at commit. The row checks above already hold each value to a number.
create function public.request_settings_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_lead     numeric;
  v_horizon  numeric;
  v_first    numeric;
  v_last     numeric;
begin
  select (s.value #>> '{}')::numeric into v_lead from public.platform_settings s
   where s.region = new.region and s.key = 'request_lead_days';
  select (s.value #>> '{}')::numeric into v_horizon from public.platform_settings s
   where s.region = new.region and s.key = 'request_horizon_days';
  select (s.value #>> '{}')::numeric into v_first from public.platform_settings s
   where s.region = new.region and s.key = 'request_first_hour';
  select (s.value #>> '{}')::numeric into v_last from public.platform_settings s
   where s.region = new.region and s.key = 'request_last_hour';
  if v_horizon < v_lead or v_first > v_last then
    raise exception 'request_settings_invalid';
  end if;
  return null;
end;
$$;

revoke all on function public.request_settings_guard() from public, anon, authenticated, service_role;

create constraint trigger request_settings_guard
  after insert or update on public.platform_settings
  deferrable initially deferred
  for each row
  when (new.key in ('request_lead_days', 'request_horizon_days', 'request_first_hour', 'request_last_hour'))
  execute function public.request_settings_guard();

-- commission_percent is 10 in both regions, the D88 example, unconfirmed until S17 (D139).
insert into public.platform_settings (region, key, value) values
  ('TR',  'commission_percent',   '10'),
  ('KSA', 'commission_percent',   '10'),
  ('TR',  'request_lead_days',    '1'),
  ('KSA', 'request_lead_days',    '1'),
  ('TR',  'request_horizon_days', '14'),
  ('KSA', 'request_horizon_days', '14'),
  ('TR',  'request_first_hour',   '8'),
  ('KSA', 'request_first_hour',   '8'),
  ('TR',  'request_last_hour',    '18'),
  ('KSA', 'request_last_hour',    '18'),
  ('TR',  'max_open_requests',    '5'),
  ('KSA', 'max_open_requests',    '5'),
  ('TR',  'quotes_per_hour',      '60'),
  ('KSA', 'quotes_per_hour',      '60')
on conflict (region, key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The three tables (AC-1 to AC-3, AC-28). A child names its parent with the region in the key,
--    so it can never name a parent of another region, and an address row always has its request's
--    region and customer. Every reference restricts: nothing here is ever deleted. Money is integer
--    minor units (rule 4).
-- ═══════════════════════════════════════════════════════════════════════════

create table public.requests (
  id                  uuid primary key default gen_random_uuid(),
  region              text        not null references public.regions (code) on delete restrict,
  customer_id         uuid        not null references public.profiles (id) on delete restrict,
  -- Made when the form opens; a replay with it returns the first request (AC-12).
  client_key          uuid        not null,
  service_id          uuid        not null,
  zone_id             uuid        not null,
  addon_ids           uuid[]      not null default '{}',
  status              text        not null default 'OPEN',
  answers             jsonb       not null,
  questions_snapshot  jsonb       not null,
  pricing_snapshot    jsonb       not null,
  fixed_price         bigint      not null,
  commission_amount   bigint      not null,
  cash_due            bigint      not null,
  currency            text        not null,
  scheduled_start_at  timestamptz not null,
  scheduled_end_at    timestamptz not null,
  notes               text,
  cancelled_at        timestamptz,
  cancelled_by        text,
  cancel_reason       text,
  created_at          timestamptz not null default now(),

  constraint requests_client_key_unique unique (customer_id, client_key),
  constraint requests_id_region unique (id, region),
  constraint requests_id_region_customer unique (id, region, customer_id),
  constraint requests_service_fk foreign key (service_id, region)
    references public.services (id, region) on delete restrict,
  constraint requests_zone_fk foreign key (zone_id, region)
    references public.zones (id, region) on delete restrict,
  constraint requests_status_valid check (status in ('OPEN', 'SELECTED', 'COMMISSION_PAID', 'UNLOCKED',
                                                     'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED',
                                                     'CANCELLED')),
  constraint requests_answers_object check (jsonb_typeof(answers) = 'object'),
  -- The same 64 KiB cap pricing_answer_errors puts on the answers it accepts (03's security Minor).
  constraint requests_answers_size check (octet_length(answers::text) <= 65536),
  constraint requests_questions_array check (jsonb_typeof(questions_snapshot) = 'array'),
  constraint requests_pricing_object check (jsonb_typeof(pricing_snapshot) = 'object'),
  constraint requests_price_positive check (fixed_price >= 1),
  constraint requests_commission_range check (commission_amount between 0 and fixed_price),
  constraint requests_cash_due_split check (cash_due = fixed_price - commission_amount),
  constraint requests_currency_valid check (currency in ('TRY', 'SAR')),
  constraint requests_schedule_order check (scheduled_end_at > scheduled_start_at),
  constraint requests_notes_length check (notes is null or char_length(notes) <= 500),
  constraint requests_cancelled_at_status check ((cancelled_at is not null) = (status = 'CANCELLED')),
  constraint requests_cancelled_by_valid check (
    cancelled_by is null or cancelled_by in ('customer', 'provider', 'platform', 'admin')),
  constraint requests_cancelled_by_set check ((cancelled_by is not null) = (cancelled_at is not null)),
  constraint requests_cancel_reason_valid check (
    cancel_reason is null or cancel_reason in ('plans_changed', 'found_elsewhere', 'price', 'other')),
  constraint requests_cancel_reason_set check (cancel_reason is null or cancelled_at is not null)
);

-- Personal data under KVKK: the exact street line. One row per request; no address book.
create table public.request_addresses (
  request_id   uuid primary key,
  region       text        not null references public.regions (code) on delete restrict,
  customer_id  uuid        not null references public.profiles (id) on delete restrict,
  line         text        not null,
  created_at   timestamptz not null default now(),

  constraint request_addresses_request_fk foreign key (request_id, region, customer_id)
    references public.requests (id, region, customer_id) on delete restrict,
  constraint request_addresses_line_length check (char_length(line) between 5 and 200)
);

-- One fixed hourly window per user (AC-28). Overwritten in place; no personal data.
create table public.quote_counters (
  user_id       uuid primary key references public.profiles (id) on delete restrict,
  region        text        not null references public.regions (code) on delete restrict,
  window_start  timestamptz not null,
  count         integer     not null,

  constraint quote_counters_count_positive check (count >= 1)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. RLS (rule 7, AC-17). The customer reads their own request and its address; an admin reads every
--    request and no address (16 adds an audited read); a provider and anon read nothing (05 opens a
--    column limited path, 10 the both paid reveal). No write policy anywhere: the definer functions
--    below are the only writers. Each check runs once per query (architecture.md §32).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.requests enable row level security;
alter table public.request_addresses enable row level security;
alter table public.quote_counters enable row level security;

create policy requests_read_own on public.requests for select to authenticated
  using (customer_id = (select auth.uid()));
create policy requests_read_admin on public.requests for select to authenticated
  using ((select public.is_admin()));

create policy request_addresses_read_own on public.request_addresses for select to authenticated
  using (customer_id = (select auth.uid()));

create policy quote_counters_read_admin on public.quote_counters for select to authenticated
  using ((select public.is_admin()));

-- Every foreign key has a covering index, and region has one on each table.
create index requests_customer_created_idx on public.requests (customer_id, created_at desc, id);
create index requests_region_idx on public.requests (region);
create index requests_service_idx on public.requests (service_id, region);
create index requests_zone_idx on public.requests (zone_id, region);
create index request_addresses_customer_idx on public.request_addresses (customer_id);
create index request_addresses_region_idx on public.request_addresses (region);
create index request_addresses_request_idx on public.request_addresses (request_id, region, customer_id);
create index quote_counters_region_idx on public.quote_counters (region);

-- Grants (D77): read only, filtered by the policies. service_role reads requests, never an address.
revoke all on table public.requests, public.request_addresses, public.quote_counters
  from anon, authenticated, service_role;
grant select on table public.requests to authenticated, service_role;
grant select on table public.request_addresses to authenticated;
grant select on table public.quote_counters to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Guards (AC-3). Price, commission, cash due, the snapshots, the schedule and the notes never
--    change, for any role, the SQL editor included. Only status and the three cancel columns move
--    here; a later position adds its own columns to the allowed list in its own migration. An
--    address row never changes and is never deleted.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.requests_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason'])
     is distinct from (to_jsonb(old) - array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason']) then
    raise exception 'request_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.requests_guard() from public, anon, authenticated, service_role;

create trigger requests_guard before update on public.requests
  for each row execute function public.requests_guard();

create function public.request_addresses_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  raise exception 'request_address_immutable';
end;
$$;

revoke all on function public.request_addresses_guard() from public, anon, authenticated, service_role;

create trigger request_addresses_guard before update or delete on public.request_addresses
  for each row execute function public.request_addresses_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The settings reader and the split (AC-1b, AC-5). Internal: they run only inside the definer
--    functions below.
-- ═══════════════════════════════════════════════════════════════════════════

-- The five schedule and cap settings of a region, each checked, or request_settings_invalid.
create function public.request_settings(p_region text)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_out  jsonb := '{}'::jsonb;
  v_bad  boolean;
  r      record;
begin
  for r in
    select k.key, k.lo, k.hi, s.value
      from (values ('request_lead_days', 0, 30), ('request_horizon_days', 1, 90),
                   ('request_first_hour', 0, 23), ('request_last_hour', 0, 23),
                   ('max_open_requests', 1, 100)) k(key, lo, hi)
      left join public.platform_settings s on s.region = p_region and s.key = k.key
  loop
    v_bad := case when jsonb_typeof(r.value) = 'number'
                  then (r.value #>> '{}')::numeric <> trunc((r.value #>> '{}')::numeric)
                       or (r.value #>> '{}')::numeric not between r.lo and r.hi
                  else true end;
    if v_bad then
      raise exception 'request_settings_invalid';
    end if;
    v_out := v_out || jsonb_build_object(r.key, (r.value #>> '{}')::numeric::integer);
  end loop;
  if (v_out ->> 'request_horizon_days')::integer < (v_out ->> 'request_lead_days')::integer
     or (v_out ->> 'request_first_hour')::integer > (v_out ->> 'request_last_hour')::integer then
    raise exception 'request_settings_invalid';
  end if;
  return v_out;
end;
$$;

revoke all on function public.request_settings(text) from public, anon, authenticated, service_role;

-- The one place the split is computed (AC-5, D139): the commission rounds once, half up, to the
-- rounding unit, in exact numeric, so both figures are whole lira. No TypeScript computes either.
create function public.pricing_split(p_region text, p_price bigint)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_percent     jsonb;
  v_unit        jsonb;
  v_p           numeric;
  v_u           numeric;
  v_commission  bigint;
begin
  select s.value into v_percent from public.platform_settings s
   where s.region = p_region and s.key = 'commission_percent';
  select s.value into v_unit from public.platform_settings s
   where s.region = p_region and s.key = 'price_rounding_minor';
  if jsonb_typeof(v_percent) is distinct from 'number' or jsonb_typeof(v_unit) is distinct from 'number' then
    raise exception 'pricing_settings_invalid';
  end if;
  v_p := (v_percent #>> '{}')::numeric;
  v_u := (v_unit #>> '{}')::numeric;
  if v_p <= 0 or v_p >= 100 or v_p <> round(v_p, 2)
     or v_u <> trunc(v_u) or v_u not between 1 and 100000 then
    raise exception 'pricing_settings_invalid';
  end if;
  if p_price is null or p_price < 1 then
    raise exception 'price_out_of_range';
  end if;
  v_commission := (round(p_price::numeric * v_p / 100 / v_u) * v_u)::bigint;
  return jsonb_build_object('commission_percent', trim_scale(v_p)::text,
                            'commission', v_commission,
                            'cash_due', p_price - v_commission);
end;
$$;

revoke all on function public.pricing_split(text, bigint) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The quote rate limit (AC-28, D142). One atomic upsert counts the quote and opens a new window
--    when the old one is an hour old, so two parallel quotes cannot both take the last slot. A
--    refusal raises, which rolls the count back: a refused call counts nothing more.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.count_quote(p_user_id uuid, p_region text)
  returns integer
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_limit  jsonb;
  v_count  integer;
  v_bad    boolean;
begin
  select s.value into v_limit from public.platform_settings s
   where s.region = p_region and s.key = 'quotes_per_hour';
  v_bad := case when jsonb_typeof(v_limit) = 'number'
                then (v_limit #>> '{}')::numeric <> trunc((v_limit #>> '{}')::numeric)
                     or (v_limit #>> '{}')::numeric not between 1 and 10000
                else true end;
  if v_bad then
    raise exception 'request_settings_invalid';
  end if;

  insert into public.quote_counters as q (user_id, region, window_start, count)
  values (p_user_id, p_region, now(), 1)
  on conflict (user_id) do update
    set window_start = case when q.window_start <= now() - interval '1 hour' then now() else q.window_start end,
        count = case when q.window_start <= now() - interval '1 hour' then 1 else q.count + 1 end,
        region = excluded.region
  returning q.count into v_count;

  if v_count > (v_limit #>> '{}')::numeric then
    raise exception 'too_many_quotes';
  end if;
  return v_count;
end;
$$;

revoke all on function public.count_quote(uuid, text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The customer's read of the catalog (AC-4). One definer function, because customers read no
--    catalog table (0007 AC-14). It never returns a formula, a modifier, affects_pricing or a zone
--    multiplier. Text stays localised jsonb; lib/requests picks the locale.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.request_catalog()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_region    text;
  v_settings  jsonb;
  v_tz        text;
  v_currency  text;
begin
  select p.region into v_region from public.profiles p where p.id = (select auth.uid());
  if v_region is null then
    raise exception 'forbidden';
  end if;
  v_settings := public.request_settings(v_region);
  select g.timezone, g.currency into v_tz, v_currency from public.regions g where g.code = v_region;

  return jsonb_build_object(
    'region', v_region,
    'currency', v_currency,
    'timezone', v_tz,
    'today', to_char((now() at time zone v_tz)::date, 'YYYY-MM-DD'),
    'schedule', jsonb_build_object(
      'lead_days', v_settings -> 'request_lead_days',
      'horizon_days', v_settings -> 'request_horizon_days',
      'first_hour', v_settings -> 'request_first_hour',
      'last_hour', v_settings -> 'request_last_hour'),
    'zones', (
      select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name) order by z.display_order, z.id),
                      '[]'::jsonb)
        from public.zones z
       where z.region = v_region and z.active),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'services', svc.list)
                                order by c.display_order, c.id), '[]'::jsonb)
        from public.service_categories c
        cross join lateral (
          select jsonb_agg(jsonb_build_object(
                   'id', s.id,
                   'name', s.name,
                   'note', s.note,
                   'hours_min', s.hours_min,
                   'hours_max', s.hours_max,
                   'questions', (
                     select coalesce(jsonb_agg(jsonb_build_object(
                              'key', q.key, 'type', q.type, 'label', q.label, 'help_text', q.help_text,
                              'required', q.required, 'service_id', q.service_id, 'options', q.options,
                              'validation', q.validation) order by q.display_order, q.id), '[]'::jsonb)
                       from public.questions q
                      where q.category_id = c.id
                        and (q.service_id is null or q.service_id = s.id)
                        and q.active),
                   'addons', (
                     select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price)
                                               order by a.display_order, a.id), '[]'::jsonb)
                       from public.addons a
                      where a.service_id = s.id and a.active))
                 order by s.display_order, s.id) as list
            from public.services s
           where s.category_id = c.id
             and s.active
             and exists (select 1 from public.pricing_formulas f where f.service_id = s.id and f.active)
        ) svc
       where c.region = v_region and c.active and svc.list is not null));
end;
$$;

revoke all on function public.request_catalog() from public, anon, authenticated, service_role;
grant execute on function public.request_catalog() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Quote, create, cancel (AC-5, AC-7 to AC-12, AC-15, AC-28).
-- ═══════════════════════════════════════════════════════════════════════════

-- A quote with its split: what quote_price returns, plus commission_percent, commission and cash_due
-- on ok. Counted against the caller's hourly limit first, in this transaction.
create function public.quote_request(p_service_id uuid, p_zone_id uuid, p_addon_ids uuid[], p_answers jsonb)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_region  text;
  v_quote   jsonb;
begin
  select p.region into v_region from public.profiles p where p.id = v_uid;
  if v_region is null then
    raise exception 'forbidden';
  end if;
  perform public.count_quote(v_uid, v_region);
  v_quote := public.quote_price(p_service_id, p_zone_id, p_addon_ids, p_answers);
  if v_quote ->> 'status' = 'ok' then
    v_quote := v_quote || public.pricing_split(v_region, (v_quote ->> 'price')::bigint);
  end if;
  return v_quote;
end;
$$;

revoke all on function public.quote_request(uuid, uuid, uuid[], jsonb) from public, anon, authenticated, service_role;
grant execute on function public.quote_request(uuid, uuid, uuid[], jsonb) to authenticated;

-- The only way to create a request (AC-7), in one transaction, in the spec's order. The two expected
-- figures are what the form showed: compared once, at step 8, and never stored (rule 1, D140).
create function public.create_request(
  p_client_key           uuid,
  p_service_id           uuid,
  p_zone_id              uuid,
  p_addon_ids            uuid[],
  p_answers              jsonb,
  p_start_date           date,
  p_start_hour           integer,
  p_address_line         text,
  p_notes                text,
  p_expected_price       bigint,
  p_expected_commission  bigint
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_role        text;
  v_region      text;
  v_id          uuid;
  v_settings    jsonb;
  v_tz          text;
  v_currency    text;
  v_today       date;
  v_start       timestamptz;
  v_line        text;
  v_notes       text;
  v_open        integer;
  v_quote       jsonb;
  v_price       bigint;
  v_commission  bigint;
  v_service     record;
  v_answers     jsonb;
  v_questions   jsonb;
begin
  -- 1. The role from the profile, never the token's claim.
  select p.role, p.region into v_role, v_region from public.profiles p where p.id = v_uid;
  if v_role is null or v_role not in ('customer', 'admin') then
    raise exception 'forbidden';
  end if;

  -- 2. Serialise this caller's publishes: a replay waits here and then finds the first row, and two
  --    tabs near the cap cannot both pass step 6.
  perform 1 from public.profiles p where p.id = v_uid for no key update;

  -- 3. A replay returns the first request, whatever its status now, and checks nothing else (AC-12).
  if p_client_key is null then
    raise exception 'validation_failed';
  end if;
  select r.id into v_id from public.requests r where r.customer_id = v_uid and r.client_key = p_client_key;
  if found then
    return jsonb_build_object('status', 'ok', 'id', v_id);
  end if;

  -- 4. Settings, then the schedule in the region's own time zone.
  v_settings := public.request_settings(v_region);
  select g.timezone, g.currency into v_tz, v_currency from public.regions g where g.code = v_region;
  v_today := (now() at time zone v_tz)::date;
  if p_start_date is null or p_start_hour is null
     or p_start_hour not between (v_settings ->> 'request_first_hour')::integer
                             and (v_settings ->> 'request_last_hour')::integer
     or p_start_date not between v_today + (v_settings ->> 'request_lead_days')::integer
                             and v_today + (v_settings ->> 'request_horizon_days')::integer then
    raise exception 'schedule_invalid';
  end if;
  v_start := make_timestamptz(extract(year from p_start_date)::integer, extract(month from p_start_date)::integer,
                              extract(day from p_start_date)::integer, p_start_hour, 0, 0, v_tz);

  -- 5. The street line and the notes, trimmed, counted in code points.
  v_line := public.catalog_trim(p_address_line);
  if v_line is null or char_length(v_line) not between 5 and 200 then
    raise exception 'address_invalid';
  end if;
  v_notes := nullif(public.catalog_trim(p_notes), '');
  if char_length(v_notes) > 500 then
    raise exception 'notes_invalid';
  end if;
  if v_notes is not null and public.has_contact_info(v_notes) then
    raise exception 'contact_info_in_notes';
  end if;

  -- 6. The live open cap, admins included.
  select count(*) into v_open
    from public.requests r
   where r.customer_id = v_uid and r.status = 'OPEN' and r.scheduled_start_at > now();
  if v_open >= (v_settings ->> 'max_open_requests')::integer then
    raise exception 'too_many_open_requests';
  end if;

  -- 7. Count one quote, then price and split. quote_price's refusals pass through.
  perform public.count_quote(v_uid, v_region);
  v_quote := public.quote_price(p_service_id, p_zone_id, p_addon_ids, p_answers);
  if v_quote ->> 'status' <> 'ok' then
    return jsonb_build_object('status', 'invalid', 'errors', v_quote -> 'errors');
  end if;
  v_price := (v_quote ->> 'price')::bigint;
  v_quote := v_quote || public.pricing_split(v_region, v_price);
  v_commission := (v_quote ->> 'commission')::bigint;

  -- 8. The figures the customer saw must be the figures now. The only place the two are read.
  if p_expected_price is distinct from v_price or p_expected_commission is distinct from v_commission then
    return jsonb_build_object('status', 'price_changed', 'quote', v_quote);
  end if;

  -- 9. The request, its address and its audit row, with the server's own figures.
  select s.id, s.name, s.category_id, s.hours_max, c.name as category_name
    into v_service
    from public.services s
    join public.service_categories c on c.id = s.category_id
   where s.id = p_service_id;

  select coalesce(jsonb_object_agg(a.key, a.value), '{}'::jsonb)
    into v_answers
    from jsonb_each(p_answers) a
   where not public.pricing_answer_blank(a.value);

  select coalesce(jsonb_agg(jsonb_build_object('key', q.key, 'type', q.type, 'label', q.label,
                                               'options', q.options, 'required', q.required)
                            order by q.display_order, q.id), '[]'::jsonb)
    into v_questions
    from public.questions q
   where q.category_id = v_service.category_id
     and (q.service_id is null or q.service_id = p_service_id)
     and q.active;

  insert into public.requests (
    region, customer_id, client_key, service_id, zone_id, addon_ids, status, answers, questions_snapshot,
    pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at, notes)
  values (
    v_region, v_uid, p_client_key, p_service_id, p_zone_id, coalesce(p_addon_ids, '{}'), 'OPEN', v_answers, v_questions,
    jsonb_build_object(
      'formula_id', v_quote -> 'formula_id',
      'formula_version', v_quote -> 'formula_version',
      'price', v_price,
      'currency', v_quote -> 'currency',
      'breakdown', v_quote -> 'breakdown',
      'rounding_minor', v_quote -> 'breakdown' -> 'rounding_minor',
      'commission_percent', v_quote -> 'commission_percent',
      'service', jsonb_build_object('id', v_service.id, 'name', v_service.name,
                                    'category_name', v_service.category_name)),
    v_price, v_commission, (v_quote ->> 'cash_due')::bigint, v_currency,
    v_start, v_start + make_interval(hours => v_service.hours_max), v_notes)
  returning id into v_id;

  insert into public.request_addresses (request_id, region, customer_id, line)
  values (v_id, v_region, v_uid, v_line);

  -- Ids, status, the price and the region only: never the address, the notes or the answers (AC-18).
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.created', 'requests', v_id::text, v_region, null,
          jsonb_build_object('status', 'OPEN', 'fixed_price', v_price,
                             'service_id', p_service_id, 'zone_id', p_zone_id));

  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

revoke all on function public.create_request(uuid, uuid, uuid, uuid[], jsonb, date, integer, text, text, bigint, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.create_request(uuid, uuid, uuid, uuid[], jsonb, date, integer, text, text, bigint, bigint)
  to authenticated;

-- Cancel while OPEN, expired included (AC-15). An admin cancels only their own requests here;
-- cancelling another's is 16's. Nothing was paid, so nothing comes back.
create function public.cancel_request(p_request_id uuid, p_reason text)
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
  if v_req.status <> 'OPEN' then
    raise exception 'not_cancellable';
  end if;

  update public.requests
     set status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'customer', cancel_reason = p_reason
   where id = p_request_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.cancelled', 'requests', p_request_id::text, v_req.region,
          jsonb_build_object('status', 'OPEN'),
          jsonb_build_object('status', 'CANCELLED', 'fixed_price', v_req.fixed_price));

  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.cancel_request(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_request(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. quote_price loses its authenticated grant (AC-28): only quote_request and create_request reach
--     it, as their definer owner, so a direct RPC cannot skip the limit. This changes 0007 AC-9.
-- ═══════════════════════════════════════════════════════════════════════════

revoke execute on function public.quote_price(uuid, uuid, uuid[], jsonb) from authenticated;
