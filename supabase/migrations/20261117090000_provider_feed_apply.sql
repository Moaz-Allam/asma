-- Position 05 (spec 0009): provider feed and apply.
--
-- An approved provider says once which services, districts and days they cover, then reads a feed of
-- open requests that match and applies to one with a short message. Applying is free: no money moves
-- here, nothing is paid and nothing is revealed. A provider can call the database directly with a real
-- token, so every rule lives in a definer function. Two of them are the only provider reads of a
-- request and return named columns only (never the customer, the address, the notes or a typed
-- answer), and apply_to_request is the only write to applications.
--
-- Order below: the carry overs from 04's reviews -> providers (id, region) -> settings -> the five
-- tables -> RLS -> grants -> guards -> internal helpers -> setup -> the reads -> apply -> cancel.
-- Every function revokes PUBLIC and pins search_path (supabase/tests/02). Refusals are stable codes in
-- the exception message; lib/provider-feed and lib/requests map them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. 04 review carry overs (tracker R10). 20261116090000_post_request is in the cloud and never
--    changes, so the SQL findings of its two security passes and its cross review land here, each
--    with pgTAP in supabase/tests/14 ("04 review carry overs").
--    (B5) Both blank patterns gain the Khmer inherent vowels, the Mongolian variation selectors, the
--         interlinear annotation marks, the musical format marks and the Egyptian format controls.
--         The same class in both copies and in lib/requests/blank.ts.
--    (B1) pricing_split refuses a commission above the price; quote_request and create_request refuse
--         a commission that is not a whole multiple of the quote's own rounding unit.
--    (A6, B3) requests are never deleted or truncated, addresses never truncated.
--    (A7) requests_guard checks the status move: OPEN to CANCELLED is the only one today.
--    (B4) A stored commission is a whole multiple of its snapshot's rounding unit.
--    (A8) request_catalog, quote_request and create_request refuse a region that is switched off.
--    (A1) A quote that the engine refuses returns { status: 'refused', code } instead of raising, so
--         the count against the hourly limit commits.
--    (A2) The street line and the notes are capped in bytes before any regex reads them.
--    (F6) A start that is already past is refused, whatever the lead days.
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
               '^[\s\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u2069\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\U00013430-\U0001343F\U0001D173-\U0001D17A\U000E0000-\U000E007F\U000E0100-\U000E01EF]+|[\s\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u2069\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\U00013430-\U0001343F\U0001D173-\U0001D17A\U000E0000-\U000E007F\U000E0100-\U000E01EF]+$',
               '', 'g')) not between 1 and p_max
    ),
    false)
$$;

revoke all on function public.catalog_text_ok(jsonb, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.catalog_text_ok(jsonb, text, integer) to authenticated;

create or replace function public.catalog_trim(p_text text)
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select regexp_replace(p_text,
    '^[\s\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u2069\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\U00013430-\U0001343F\U0001D173-\U0001D17A\U000E0000-\U000E007F\U000E0100-\U000E01EF]+|[\s\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u2069\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\U00013430-\U0001343F\U0001D173-\U0001D17A\U000E0000-\U000E007F\U000E0100-\U000E01EF]+$',
    '', 'g')
$$;

revoke all on function public.catalog_trim(text) from public, anon, authenticated, service_role;

-- (B1) The split reads the rounding unit itself, apart from the engine. A unit changed between the two
-- reads could round the commission past the price: refused here, never stored.
create or replace function public.pricing_split(p_region text, p_price bigint)
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
  if v_commission > p_price then
    raise exception 'pricing_settings_invalid';
  end if;
  return jsonb_build_object('commission_percent', trim_scale(v_p)::text,
                            'commission', v_commission,
                            'cash_due', p_price - v_commission);
end;
$$;

revoke all on function public.pricing_split(text, bigint) from public, anon, authenticated, service_role;

-- (A7) The frozen columns as before, plus the status move. A later position adds its own moves here,
-- in its own migration (06: OPEN to SELECTED, and so on).
create or replace function public.requests_guard()
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
  if new.status is distinct from old.status
     and not (old.status = 'OPEN' and new.status = 'CANCELLED') then
    raise exception 'request_transition_invalid';
  end if;
  return new;
end;
$$;

revoke all on function public.requests_guard() from public, anon, authenticated, service_role;

-- (A6, B3) A request is never deleted and never truncated, for any role, the SQL editor included.
-- The address table gets the same statement guard from its own function.
create function public.requests_delete_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  raise exception 'request_immutable';
end;
$$;

revoke all on function public.requests_delete_guard() from public, anon, authenticated, service_role;

create trigger requests_delete_guard before delete on public.requests
  for each row execute function public.requests_delete_guard();
create trigger requests_truncate_guard before truncate on public.requests
  for each statement execute function public.requests_delete_guard();
create trigger request_addresses_truncate_guard before truncate on public.request_addresses
  for each statement execute function public.request_addresses_guard();

-- (B4) The commission is a whole multiple of the unit its own snapshot was rounded with. A snapshot
-- with no unit, or a unit of 0, fails.
alter table public.requests
  add constraint requests_commission_unit check (
    coalesce(commission_amount % nullif((pricing_snapshot ->> 'rounding_minor')::bigint, 0) = 0, false));

-- (A8) The catalog read, with the region switch.
create or replace function public.request_catalog()
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
  v_active    boolean;
begin
  select p.region into v_region from public.profiles p where p.id = (select auth.uid());
  if v_region is null then
    raise exception 'forbidden';
  end if;
  select g.timezone, g.currency, g.active into v_tz, v_currency, v_active
    from public.regions g where g.code = v_region;
  if v_active is not true then
    raise exception 'region_unavailable';
  end if;
  v_settings := public.request_settings(v_region);

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

-- (A1, A8) A quote with its split. Counted against the caller's hourly limit first. The four refusals a
-- caller can cause in the engine come back as a status, so the count commits; a settings fault still
-- raises.
create or replace function public.quote_request(p_service_id uuid, p_zone_id uuid, p_addon_ids uuid[], p_answers jsonb)
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
  v_split   jsonb;
begin
  select p.region into v_region from public.profiles p where p.id = v_uid;
  if v_region is null then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.regions g where g.code = v_region and g.active) then
    raise exception 'region_unavailable';
  end if;
  perform public.count_quote(v_uid, v_region);
  begin
    v_quote := public.quote_price(p_service_id, p_zone_id, p_addon_ids, p_answers);
  exception when raise_exception then
    if sqlerrm in ('service_unavailable', 'zone_unavailable', 'addon_unavailable', 'price_out_of_range') then
      return jsonb_build_object('status', 'refused', 'code', sqlerrm);
    end if;
    raise;
  end;
  if v_quote ->> 'status' = 'ok' then
    v_split := public.pricing_split(v_region, (v_quote ->> 'price')::bigint);
    if (v_split ->> 'commission')::bigint % (v_quote -> 'breakdown' ->> 'rounding_minor')::bigint <> 0 then
      raise exception 'pricing_settings_invalid';
    end if;
    v_quote := v_quote || v_split;
  end if;
  return v_quote;
end;
$$;

revoke all on function public.quote_request(uuid, uuid, uuid[], jsonb) from public, anon, authenticated, service_role;
grant execute on function public.quote_request(uuid, uuid, uuid[], jsonb) to authenticated;

-- (A1, A2, A8, F6) The only way to create a request, in 04's order. The two expected figures are what
-- the form showed: compared once, at step 8, and never stored (rule 1, D140).
create or replace function public.create_request(
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
  v_active      boolean;
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

  -- 4. The region switch, the settings, then the schedule in the region's own time zone. A start that
  --    is already past is refused even with a lead of 0 days.
  select g.timezone, g.currency, g.active into v_tz, v_currency, v_active
    from public.regions g where g.code = v_region;
  if v_active is not true then
    raise exception 'region_unavailable';
  end if;
  v_settings := public.request_settings(v_region);
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
  if v_start <= now() then
    raise exception 'schedule_invalid';
  end if;

  -- 5. The street line and the notes: capped in bytes first, then trimmed and counted in code points.
  if p_address_line is null or octet_length(p_address_line) > 4096 then
    raise exception 'address_invalid';
  end if;
  v_line := public.catalog_trim(p_address_line);
  if v_line is null or char_length(v_line) not between 5 and 200 then
    raise exception 'address_invalid';
  end if;
  if octet_length(p_notes) > 4096 then
    raise exception 'notes_invalid';
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

  -- 7. Count one quote, then price and split. A refusal the caller caused in the engine comes back as a
  --    status, so the count commits; answer errors come back as before.
  perform public.count_quote(v_uid, v_region);
  begin
    v_quote := public.quote_price(p_service_id, p_zone_id, p_addon_ids, p_answers);
  exception when raise_exception then
    if sqlerrm in ('service_unavailable', 'zone_unavailable', 'addon_unavailable', 'price_out_of_range') then
      return jsonb_build_object('status', 'refused', 'code', sqlerrm);
    end if;
    raise;
  end;
  if v_quote ->> 'status' <> 'ok' then
    return jsonb_build_object('status', 'invalid', 'errors', v_quote -> 'errors');
  end if;
  v_price := (v_quote ->> 'price')::bigint;
  v_quote := v_quote || public.pricing_split(v_region, v_price);
  v_commission := (v_quote ->> 'commission')::bigint;
  if v_commission % (v_quote -> 'breakdown' ->> 'rounding_minor')::bigint <> 0 then
    raise exception 'pricing_settings_invalid';
  end if;

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. providers (id, region), so the tables below hold a provider's region by key (AC-1).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.providers add constraint providers_id_region unique (id, region);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Settings (AC-1). Each key's shape is a row check, as 04's keys. A missing row refuses at use,
--    never a default. Edited by SQL until 16.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_max_applicants_valid check (
    case when key <> 'max_applicants_per_request' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 50 end),
  add constraint platform_settings_applications_per_hour_valid check (
    case when key <> 'applications_per_hour' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 1000 end);

insert into public.platform_settings (region, key, value) values
  ('TR',  'max_applicants_per_request', '10'),
  ('KSA', 'max_applicants_per_request', '10'),
  ('TR',  'applications_per_hour',      '20'),
  ('KSA', 'applications_per_hour',      '20')
on conflict (region, key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The five tables (AC-1). A child names its parent with the region in the key, so a pick, an
--    availability row or an application can never name a parent of another region. Every reference
--    restricts.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 to 7 distinct days, each 0 to 6 (0 is Sunday, as Postgres dow).
create function public.work_days_ok(p_days smallint[])
  returns boolean
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select coalesce(
    array_ndims(p_days) = 1
    and cardinality(p_days) between 1 and 7
    and array_position(p_days, null) is null
    and not exists (select 1 from unnest(p_days) d where d not between 0 and 6)
    and (select count(distinct d) from unnest(p_days) d) = cardinality(p_days),
    false)
$$;

revoke all on function public.work_days_ok(smallint[]) from public, anon, authenticated, service_role;

create table public.provider_services (
  provider_id  uuid        not null,
  service_id   uuid        not null,
  region       text        not null references public.regions (code) on delete restrict,
  created_at   timestamptz not null default now(),

  constraint provider_services_pkey primary key (provider_id, service_id),
  constraint provider_services_provider_fk foreign key (provider_id, region)
    references public.providers (id, region) on delete restrict,
  constraint provider_services_service_fk foreign key (service_id, region)
    references public.services (id, region) on delete restrict
);

create table public.provider_zones (
  provider_id  uuid        not null,
  zone_id      uuid        not null,
  region       text        not null references public.regions (code) on delete restrict,
  created_at   timestamptz not null default now(),

  constraint provider_zones_pkey primary key (provider_id, zone_id),
  constraint provider_zones_provider_fk foreign key (provider_id, region)
    references public.providers (id, region) on delete restrict,
  constraint provider_zones_zone_fk foreign key (zone_id, region)
    references public.zones (id, region) on delete restrict
);

create table public.provider_availability (
  provider_id  uuid primary key,
  region       text        not null references public.regions (code) on delete restrict,
  work_days    smallint[]  not null,
  start_hour   smallint    not null,
  end_hour     smallint    not null,
  updated_at   timestamptz not null default now(),

  constraint provider_availability_provider_fk foreign key (provider_id, region)
    references public.providers (id, region) on delete restrict,
  constraint provider_availability_days_valid check (public.work_days_ok(work_days)),
  constraint provider_availability_start_range check (start_hour between 0 and 23),
  constraint provider_availability_end_range check (end_hour between 1 and 24 and end_hour > start_hour)
);

-- The message is free text and may hold personal data despite the scanner: read only by its author,
-- an admin and (from 06) the customer of that request.
create table public.applications (
  id                 uuid primary key default gen_random_uuid(),
  region             text        not null references public.regions (code) on delete restrict,
  request_id         uuid        not null,
  provider_id        uuid        not null,
  message            text        not null,
  status             text        not null default 'APPLIED',
  created_at         timestamptz not null default now(),
  status_changed_at  timestamptz not null default now(),

  constraint applications_request_provider_unique unique (request_id, provider_id),
  constraint applications_request_fk foreign key (request_id, region)
    references public.requests (id, region) on delete restrict,
  constraint applications_provider_fk foreign key (provider_id, region)
    references public.providers (id, region) on delete restrict,
  constraint applications_message_length check (char_length(message) between 20 and 600),
  constraint applications_status_valid check (status in (
    'APPLIED', 'SELECTED', 'AWAITING_FEE', 'UNLOCKED', 'STARTED', 'COMPLETED', 'CONFIRMED', 'RATED',
    'NOT_SELECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED'))
);

-- One fixed hourly window per provider (AC-10 step 10), as 04's quote_counters. Overwritten in place;
-- no personal data.
create table public.apply_counters (
  provider_id   uuid primary key references public.providers (id) on delete restrict,
  region        text        not null references public.regions (code) on delete restrict,
  window_start  timestamptz not null,
  count         integer     not null,

  constraint apply_counters_count_positive check (count >= 1)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. RLS (rule 7, AC-18). A provider reads their own picks, hours and applications; an admin reads
--    all; a customer and anon read nothing (06 adds the customer's read of the applications on their
--    own request). The insert policy on applications is defence in depth only: no API role holds a
--    write grant, so apply_to_request is the only writer (D148). requests and request_addresses keep
--    04's policies. Each check runs once per query (architecture.md §32).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.provider_services enable row level security;
alter table public.provider_zones enable row level security;
alter table public.provider_availability enable row level security;
alter table public.applications enable row level security;
alter table public.apply_counters enable row level security;

create policy provider_services_read_own on public.provider_services for select to authenticated
  using (provider_id = (select auth.uid()));
create policy provider_services_read_admin on public.provider_services for select to authenticated
  using ((select public.is_admin()));

create policy provider_zones_read_own on public.provider_zones for select to authenticated
  using (provider_id = (select auth.uid()));
create policy provider_zones_read_admin on public.provider_zones for select to authenticated
  using ((select public.is_admin()));

create policy provider_availability_read_own on public.provider_availability for select to authenticated
  using (provider_id = (select auth.uid()));
create policy provider_availability_read_admin on public.provider_availability for select to authenticated
  using ((select public.is_admin()));

create policy applications_read_own on public.applications for select to authenticated
  using (provider_id = (select auth.uid()));
create policy applications_read_admin on public.applications for select to authenticated
  using ((select public.is_admin()));
create policy applications_insert_own on public.applications for insert to authenticated
  with check (provider_id = (select auth.uid()) and (select public.provider_can_apply((select auth.uid()))));

create policy apply_counters_read_admin on public.apply_counters for select to authenticated
  using ((select public.is_admin()));

-- Every foreign key has a covering index, and region has one on each table.
create index provider_services_service_idx on public.provider_services (service_id, region);
create index provider_services_region_idx on public.provider_services (region);
create index provider_zones_zone_idx on public.provider_zones (zone_id, region);
create index provider_zones_region_idx on public.provider_zones (region);
create index provider_availability_region_idx on public.provider_availability (region);
create index applications_provider_created_idx on public.applications (provider_id, created_at desc, id);
create index applications_request_status_idx on public.applications (request_id, status);
create index applications_region_idx on public.applications (region);
create index apply_counters_region_idx on public.apply_counters (region);
-- The feed reads open requests of one region by start.
create index requests_open_start_idx on public.requests (region, scheduled_start_at, id) where status = 'OPEN';

-- Grants (D77): read only, filtered by the policies. No API role writes any of the five, and
-- service_role reads none of them yet.
revoke all on table public.provider_services, public.provider_zones, public.provider_availability,
  public.applications, public.apply_counters
  from anon, authenticated, service_role;
grant select on table public.provider_services, public.provider_zones, public.provider_availability,
  public.applications, public.apply_counters
  to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The applications guard (AC-17). An application is never deleted or truncated; its identity, its
--    message and its creation time never change; a final status never moves. For any role, the SQL
--    editor included. Later positions widen the moves for their own transitions.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.applications_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'application_immutable';
  end if;
  if new.id is distinct from old.id
     or new.region is distinct from old.region
     or new.request_id is distinct from old.request_id
     or new.provider_id is distinct from old.provider_id
     or new.message is distinct from old.message
     or new.created_at is distinct from old.created_at then
    raise exception 'application_immutable';
  end if;
  if new.status is distinct from old.status
     and old.status in ('NOT_SELECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED', 'CONFIRMED', 'RATED') then
    raise exception 'application_final';
  end if;
  return new;
end;
$$;

revoke all on function public.applications_guard() from public, anon, authenticated, service_role;

create trigger applications_guard before update or delete on public.applications
  for each row execute function public.applications_guard();
create trigger applications_truncate_guard before truncate on public.applications
  for each statement execute function public.applications_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Internal helpers. None has an API grant: they run only inside the definer functions below.
-- ═══════════════════════════════════════════════════════════════════════════

-- Both settings of a region, each checked, or apply_settings_invalid (AC-1).
create function public.apply_settings(p_region text)
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
      from (values ('max_applicants_per_request', 1, 50), ('applications_per_hour', 1, 1000)) k(key, lo, hi)
      left join public.platform_settings s on s.region = p_region and s.key = k.key
  loop
    v_bad := case when jsonb_typeof(r.value) = 'number'
                  then (r.value #>> '{}')::numeric <> trunc((r.value #>> '{}')::numeric)
                       or (r.value #>> '{}')::numeric not between r.lo and r.hi
                  else true end;
    if v_bad then
      raise exception 'apply_settings_invalid';
    end if;
    v_out := v_out || jsonb_build_object(r.key, (r.value #>> '{}')::numeric::integer);
  end loop;
  return v_out;
end;
$$;

revoke all on function public.apply_settings(text) from public, anon, authenticated, service_role;

-- The caller's providers row, not locked, for the reads and for apply (whose first lock is the
-- request row). Refuses anyone who is not a provider with a row, as provider_caller does.
create function public.provider_reader()
  returns public.providers
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_row public.providers%rowtype;
begin
  select pr.* into v_row
    from public.providers pr
    join public.profiles p on p.id = pr.id and p.role = 'provider'
   where pr.id = (select auth.uid());
  if not found then
    raise exception 'forbidden';
  end if;
  return v_row;
end;
$$;

revoke all on function public.provider_reader() from public, anon, authenticated, service_role;

-- A setup is complete with one offered service, one active district and an availability row (AC-4).
-- A service is offered while it and its category are on.
create function public.provider_setup_complete(p_provider_id uuid)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select exists (select 1
                   from public.provider_services ps
                   join public.services s on s.id = ps.service_id
                   join public.service_categories c on c.id = s.category_id
                  where ps.provider_id = p_provider_id and s.active and c.active)
     and exists (select 1
                   from public.provider_zones pz
                   join public.zones z on z.id = pz.zone_id
                  where pz.provider_id = p_provider_id and z.active)
     and exists (select 1 from public.provider_availability a where a.provider_id = p_provider_id)
$$;

revoke all on function public.provider_setup_complete(uuid) from public, anon, authenticated, service_role;

-- Outside hours: the start, in the region's time zone, falls on a day not worked or at an hour outside
-- [start, end). The end time is not tested (AC-5). No availability reads as inside.
create function public.provider_outside_hours(
  p_start timestamptz, p_timezone text, p_work_days smallint[], p_start_hour integer, p_end_hour integer)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select coalesce(
    not (extract(dow from (p_start at time zone p_timezone))::smallint = any (p_work_days))
    or extract(hour from (p_start at time zone p_timezone)) < p_start_hour
    or extract(hour from (p_start at time zone p_timezone)) >= p_end_hour,
    false)
$$;

revoke all on function public.provider_outside_hours(timestamptz, text, smallint[], integer, integer)
  from public, anon, authenticated, service_role;

-- The short details of a request (AC-7, D146), built from named columns: a column added to requests
-- later stays hidden until someone adds it here on purpose. Names come from the pricing snapshot, as
-- they read when the request was posted.
create function public.provider_short_details(p_request public.requests)
  returns jsonb
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select jsonb_build_object(
    'id', (p_request).id,
    'service_id', (p_request).service_id,
    'zone_id', (p_request).zone_id,
    'service_name', (p_request).pricing_snapshot -> 'service' -> 'name',
    'zone_name', (p_request).pricing_snapshot -> 'breakdown' -> 'zone' -> 'name',
    'addon_names', coalesce((
      select jsonb_agg(a.item -> 'name' order by a.ord)
        from jsonb_array_elements(
               case when jsonb_typeof((p_request).pricing_snapshot -> 'breakdown' -> 'addons') = 'array'
                    then (p_request).pricing_snapshot -> 'breakdown' -> 'addons' else '[]'::jsonb end)
             with ordinality a(item, ord)), '[]'::jsonb),
    'scheduled_start_at', (p_request).scheduled_start_at,
    'scheduled_end_at', (p_request).scheduled_end_at,
    'fixed_price', (p_request).fixed_price,
    'cash_due', (p_request).cash_due,
    'currency', (p_request).currency)
$$;

revoke all on function public.provider_short_details(public.requests) from public, anon, authenticated, service_role;

-- The structured answers (AC-7): choice, number, yes or no, date and time questions, in the snapshot's
-- order. A typed answer (text, textarea) never leaves. A value is returned only in its own shape, so a
-- string can never ride out under a number, date or time question.
create function public.provider_structured_answers(p_questions jsonb, p_answers jsonb)
  returns jsonb
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', q.item ->> 'key',
           'label', q.item -> 'label',
           'type', q.item ->> 'type',
           'value', case q.item ->> 'type'
                      when 'number' then case when jsonb_typeof(p_answers -> (q.item ->> 'key')) = 'number'
                                              then p_answers -> (q.item ->> 'key') end
                      when 'boolean' then case when jsonb_typeof(p_answers -> (q.item ->> 'key')) = 'boolean'
                                               then p_answers -> (q.item ->> 'key') end
                      when 'date' then case when p_answers ->> (q.item ->> 'key') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                                            then p_answers -> (q.item ->> 'key') end
                      when 'time' then case when p_answers ->> (q.item ->> 'key') ~ '^[0-9]{2}:[0-9]{2}$'
                                            then p_answers -> (q.item ->> 'key') end
                    end,
           'option_labels', case when q.item ->> 'type' in ('single_select', 'multi_select') then (
                select coalesce(jsonb_agg(o.item -> 'label' order by o.ord), '[]'::jsonb)
                  from jsonb_array_elements(
                         case when jsonb_typeof(q.item -> 'options') = 'array' then q.item -> 'options' else '[]'::jsonb end)
                       with ordinality o(item, ord)
                 where case q.item ->> 'type'
                         when 'single_select' then p_answers -> (q.item ->> 'key') = o.item -> 'value'
                         else jsonb_typeof(p_answers -> (q.item ->> 'key')) = 'array'
                              and (p_answers -> (q.item ->> 'key')) @> jsonb_build_array(o.item -> 'value')
                       end) end)
         order by q.ord), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_questions) = 'array' then p_questions else '[]'::jsonb end)
         with ordinality q(item, ord)
   where q.item ->> 'type' in ('single_select', 'multi_select', 'number', 'boolean', 'date', 'time')
     and p_answers ? (q.item ->> 'key')
$$;

revoke all on function public.provider_structured_answers(jsonb, jsonb) from public, anon, authenticated, service_role;

-- One atomic upsert counts the attempt and opens a new window when the old one is an hour old, so two
-- parallel applies cannot both take the last slot (AC-10 step 10). The refusal raises, which rolls
-- this count back; a refused message returns instead, so its count commits.
create function public.count_application(p_provider_id uuid, p_region text, p_limit integer)
  returns integer
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_count  integer;
begin
  insert into public.apply_counters as c (provider_id, region, window_start, count)
  values (p_provider_id, p_region, now(), 1)
  on conflict (provider_id) do update
    set window_start = case when c.window_start <= now() - interval '1 hour' then now() else c.window_start end,
        count = case when c.window_start <= now() - interval '1 hour' then 1 else c.count + 1 end,
        region = excluded.region
  returning c.count into v_count;

  if v_count > p_limit then
    raise exception 'too_many_applications';
  end if;
  return v_count;
end;
$$;

revoke all on function public.count_application(uuid, text, integer) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Setup (AC-2 to AC-4, D151). It gates applying only; 02's submit, approve and suspend flows do
--    not change, and a save never sends the file back to review.
-- ═══════════════════════════════════════════════════════════════════════════

-- The caller's picks beside every offered service (by category) and active district of their region.
-- A stored pick that admin turned off stays listed, flagged inactive. Names stay localised jsonb.
create function public.provider_setup()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_me  public.providers%rowtype;
begin
  v_me := public.provider_reader();

  return jsonb_build_object(
    'region', v_me.region,
    'timezone', (select g.timezone from public.regions g where g.code = v_me.region),
    'complete', public.provider_setup_complete(v_me.id),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'services', svc.list)
                                order by c.display_order, c.id), '[]'::jsonb)
        from public.service_categories c
        cross join lateral (
          select jsonb_agg(jsonb_build_object(
                   'id', s.id,
                   'name', s.name,
                   'note', s.note,
                   'selected', ps.provider_id is not null,
                   'inactive', not (s.active and c.active))
                 order by s.display_order, s.id) as list
            from public.services s
            left join public.provider_services ps on ps.service_id = s.id and ps.provider_id = v_me.id
           where s.category_id = c.id
             and ((s.active and c.active) or ps.provider_id is not null)
        ) svc
       where c.region = v_me.region and svc.list is not null),
    'zones', (
      select coalesce(jsonb_agg(jsonb_build_object(
                        'id', z.id,
                        'name', z.name,
                        'selected', pz.provider_id is not null,
                        'inactive', not z.active)
                      order by z.display_order, z.id), '[]'::jsonb)
        from public.zones z
        left join public.provider_zones pz on pz.zone_id = z.id and pz.provider_id = v_me.id
       where z.region = v_me.region and (z.active or pz.provider_id is not null)),
    'availability', (
      select jsonb_build_object('work_days', to_jsonb(a.work_days), 'start_hour', a.start_hour, 'end_hour', a.end_hour)
        from public.provider_availability a
       where a.provider_id = v_me.id));
end;
$$;

revoke all on function public.provider_setup() from public, anon, authenticated, service_role;
grant execute on function public.provider_setup() to authenticated;

-- Replaces the caller's three sets in one transaction (AC-3). The providers row is locked first, so two
-- saves run one after the other and a save that waits on a suspension sees it. The failing field
-- rides in the error's detail: services, zones, work_days or hours.
create function public.save_provider_setup(
  p_service_ids  uuid[],
  p_zone_ids     uuid[],
  p_work_days    smallint[],
  p_start_hour   integer,
  p_end_hour     integer
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_me  public.providers%rowtype;
begin
  v_me := public.provider_caller();
  if v_me.status = 'suspended' then
    raise exception 'provider_suspended';
  end if;

  if p_service_ids is null
     or coalesce(array_ndims(p_service_ids), 0) <> 1
     or cardinality(p_service_ids) not between 1 and 50
     or array_position(p_service_ids, null) is not null
     or (select count(distinct x) from unnest(p_service_ids) x) <> cardinality(p_service_ids)
     or (select count(*)
           from public.services s
           join public.service_categories c on c.id = s.category_id
          where s.id = any (p_service_ids) and s.region = v_me.region and s.active and c.active)
        <> cardinality(p_service_ids) then
    raise exception 'setup_invalid' using detail = 'services';
  end if;

  if p_zone_ids is null
     or coalesce(array_ndims(p_zone_ids), 0) <> 1
     or cardinality(p_zone_ids) not between 1 and 100
     or array_position(p_zone_ids, null) is not null
     or (select count(distinct x) from unnest(p_zone_ids) x) <> cardinality(p_zone_ids)
     or (select count(*) from public.zones z
          where z.id = any (p_zone_ids) and z.region = v_me.region and z.active)
        <> cardinality(p_zone_ids) then
    raise exception 'setup_invalid' using detail = 'zones';
  end if;

  if not public.work_days_ok(p_work_days) then
    raise exception 'setup_invalid' using detail = 'work_days';
  end if;

  if p_start_hour is null or p_end_hour is null
     or p_start_hour not between 0 and 23
     or p_end_hour not between 1 and 24
     or p_end_hour <= p_start_hour then
    raise exception 'setup_invalid' using detail = 'hours';
  end if;

  delete from public.provider_services ps where ps.provider_id = v_me.id;
  insert into public.provider_services (provider_id, service_id, region)
  select v_me.id, x, v_me.region from unnest(p_service_ids) x;

  delete from public.provider_zones pz where pz.provider_id = v_me.id;
  insert into public.provider_zones (provider_id, zone_id, region)
  select v_me.id, x, v_me.region from unnest(p_zone_ids) x;

  insert into public.provider_availability as a (provider_id, region, work_days, start_hour, end_hour, updated_at)
  values (v_me.id, v_me.region, (select array_agg(d order by d) from unnest(p_work_days) d),
          p_start_hour, p_end_hour, now())
  on conflict (provider_id) do update
    set work_days = excluded.work_days,
        start_hour = excluded.start_hour,
        end_hour = excluded.end_hour,
        updated_at = now();

  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.save_provider_setup(uuid[], uuid[], smallint[], integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.save_provider_setup(uuid[], uuid[], smallint[], integer, integer) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The provider's reads (AC-5 to AC-8, AC-13, AC-14). provider_feed and provider_request are the
--    only provider reads of a request. Identity comes from auth.uid() only.
-- ═══════════════════════════════════════════════════════════════════════════

-- The feed: OPEN requests with a future start, of the caller's region, whose service and district are
-- among the caller's stored picks (active or not). Nothing for a caller who is not approved or whose
-- setup is not complete. Filters are intersected with the setup, so they can only narrow. Order:
-- inside hours first, then soonest start, then id; 20 a page, keyset on those three.
create function public.provider_feed(
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
                     (select count(*) from public.applications a
                       where a.request_id = r.id and a.status = 'APPLIED')::integer as applied_count
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

-- One request's short details, with the structured answers (AC-7, AC-8). Returned when the request is
-- in the caller's feed, or when the caller has an application on it, in any state and any standing, so
-- a provider can reread what they applied to. Null otherwise: another region, an uncovered service or
-- district, an unknown id. "closed" is the reading of AC-8: the request left OPEN, or its start passed.
create function public.provider_request(p_request_id uuid)
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
  select count(*) into v_count from public.applications a
   where a.request_id = v_req.id and a.status = 'APPLIED';
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
    'answers', public.provider_structured_answers(v_req.questions_snapshot, v_req.answers));
end;
$$;

revoke all on function public.provider_request(uuid) from public, anon, authenticated, service_role;
grant execute on function public.provider_request(uuid) to authenticated;

-- The caller's applications, newest first, 20 a page, keyset on (created_at, id), each with its
-- request's short details (AC-13). No message: the list does not need it.
create function public.provider_applications(p_after_created_at timestamptz, p_after_id uuid)
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
               'application', jsonb_build_object('id', m.id, 'status', m.status, 'created_at', m.created_at)) as j
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

-- The two counts of the provider home (AC-14): requests in the caller's feed that are not full, inside
-- working hours or not, and the caller's APPLIED applications. With the setup flag, so the page can
-- show the setup prompt instead.
create function public.provider_home_counts()
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
       and (select count(*) from public.applications a
             where a.request_id = r.id and a.status = 'APPLIED') < v_cap;
  end if;

  select count(*) into v_applied
    from public.applications a
   where a.provider_id = v_me.id and a.status = 'APPLIED';

  return jsonb_build_object('setup_complete', v_complete, 'open_requests', v_open, 'applied', v_applied);
end;
$$;

revoke all on function public.provider_home_counts() from public, anon, authenticated, service_role;
grant execute on function public.provider_home_counts() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Apply (AC-10, D148, D155). The only way to create an application, in one transaction, in the
--    spec's order. Lock order, a rule for every later position that touches applications: the request
--    row first, then the caller's providers row (shared), then the caller's apply_counters row, then
--    applications rows. Steps 11 and 12 return
--    instead of raising, so the count of step 10 commits: probing the scanner costs rate limit. No
--    raise and no returned value ever carries the message text.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.apply_to_request(p_request_id uuid, p_message text)
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
  select count(*) into v_count
    from public.applications a
   where a.request_id = v_req.id and a.status = 'APPLIED';
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
  if public.has_contact_info(v_message) then
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Cancel, replaced (AC-16, D155). 04's behaviour, plus: every APPLIED application of the request
--     moves to CANCELLED in the same transaction, under the request row lock that apply takes first.
--     So an apply after a cancel refuses request_closed, and a cancel after an apply cancels it.
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
  if v_req.status <> 'OPEN' then
    raise exception 'not_cancellable';
  end if;

  update public.requests
     set status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'customer', cancel_reason = p_reason
   where id = p_request_id;

  update public.applications a
     set status = 'CANCELLED', status_changed_at = now()
   where a.request_id = p_request_id and a.status = 'APPLIED';

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.cancelled', 'requests', p_request_id::text, v_req.region,
          jsonb_build_object('status', 'OPEN'),
          jsonb_build_object('status', 'CANCELLED', 'fixed_price', v_req.fixed_price));

  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.cancel_request(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_request(uuid, text) to authenticated;
