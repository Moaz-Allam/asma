-- Position 20b (spec 0011-20b, D225, D229): structured addresses and a map pin. The request address becomes Turkish
-- parts (il and ilçe from the zone, mahalle, street, building number, floor, apartment, postal code, directions) and an
-- optional pin; the provider gives their own address at onboarding. Both stay behind the reveal (rule 2) and print on
-- the service agreement (template draft-2). The map runs in the browser only; nothing here calls MapTiler.
--
-- Contents:
--   1. zones: il and ilçe, their grants and the active TR guard (AC-1, X-7, X-15)
--   2. The address helpers: part rules, the pin box, compose_address, address_parse (AC-2, AC-3, X-9, X-16)
--   3. request_addresses: the parts, the pin and their checks; the provider's direct read dropped (AC-2, X-20)
--   4. create_request with p_address, dropped and created (AC-3, X-8, X-12)
--   5. request_catalog with il and ilçe on each zone (AC-4, X-10)
--   6. provider_addresses: table, RLS, guards, save and read (AC-5, X-11)
--   7. submit_provider_file and apply_to_request: address_required (AC-5, X-13)
--   8. The reveal: request_contacts with both addresses (AC-6, X-6, X-14)
--   9. Admin: admin_request_address with the parts, admin_provider_address audited (AC-7)
--  10. The agreement: field names, queue_agreement's content, template draft-2 active (AC-8, X-4, X-18)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. zones: il and ilçe (AC-1). Stored as typed (proper names, never folded, rule 10). Nullable, so existing zones
--    and every fixture stay valid; an active TR zone saved through the API (admin's catalog) needs both (X-7).
-- ═══════════════════════════════════════════════════════════════════════════

-- One free text part: null, or trimmed, no control character, and min to max code points. Unicode format characters
-- (soft hyphen, Arabic letter mark, zero width, line separators, bidi embeddings and isolates, the BOM) count as control: they make an address read differently (S20b-3).
create function public.address_part_ok(p_text text, p_min integer, p_max integer)
  returns boolean
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select p_text is null
      or (p_text = public.catalog_trim(p_text)
          and p_text !~ '[[:cntrl:]\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]'
          and char_length(p_text) between p_min and p_max)
$$;

revoke all on function public.address_part_ok(text, integer, integer) from public, anon, authenticated, service_role;

-- Inline checks, no function: admin writes zones as `authenticated`, and a check runs with the writer's rights.
alter table public.zones
  add column il text,
  add column ilce text,
  add constraint zones_il_ok check (
    il is null or (char_length(il) between 2 and 60 and il ~ '^\S(.*\S)?$' and il !~ '[[:cntrl:]\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]')),
  add constraint zones_ilce_ok check (
    ilce is null or (char_length(ilce) between 2 and 60 and ilce ~ '^\S(.*\S)?$' and ilce !~ '[[:cntrl:]\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]'));

grant insert (il, ilce) on table public.zones to authenticated;
grant update (il, ilce) on table public.zones to authenticated;

-- X-7: a trigger, not a check, so an old zone never blocks a migration or a fixture. It binds the API roles, the
-- path admin's catalog writes through; the SQL editor (the owner) may still stage a zone first.
create function public.zones_place_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and new.active and new.region = 'TR'
     and (new.il is null or new.ilce is null) then
    raise exception 'zone_place_required';
  end if;
  return new;
end;
$$;

revoke all on function public.zones_place_guard() from public, anon, authenticated, service_role;

create trigger zones_place_guard before insert or update on public.zones
  for each row execute function public.zones_place_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The address helpers (Address rules, Address composition). All internal.
-- ═══════════════════════════════════════════════════════════════════════════

-- A number part (building, floor, apartment): letters, digits, `/`, `.`, `-` and spaces, and at most 4 digits, so no
-- part can carry a phone number on its own; these parts are never joined into a scan (X-2).
create function public.address_number_ok(p_text text)
  returns boolean
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select p_text is null
      or (p_text ~ '^[0-9A-Za-zÇĞİÖŞÜçğıöşü./ -]+$'
          and char_length(regexp_replace(p_text, '[^0-9]', '', 'g')) <= 4)
$$;

revoke all on function public.address_number_ok(text) from public, anon, authenticated, service_role;

-- The region's pin box (AC-3). Only TR has one; KSA keeps the single line until its own shape is decided.
create function public.address_pin_in_region(p_region text, p_lat numeric, p_lng numeric)
  returns boolean
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select case p_region
           when 'TR' then p_lat between 35.5 and 42.5 and p_lng between 25.5 and 45.0
           else false
         end
$$;

revoke all on function public.address_pin_in_region(text, numeric, numeric) from public, anon, authenticated, service_role;

-- One line from the parts (Address composition, X-16): `<mahalle> Mah.` (no suffix when the name already ends in
-- Mah., Mahallesi or Mh.), `<street>`, `No: <n>`, `Kat: <n>` and `Daire: <n>` when given, `<postal> <ilçe>/<il>`,
-- joined by `, `. The suffix test is a case blind pattern, never lower() (rule 10). Directions are never in the line.
create function public.compose_address(p_mahalle text, p_street text, p_building_no text, p_floor text,
                                       p_apartment text, p_postal_code text, p_ilce text, p_il text)
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select nullif(array_to_string(array_remove(array[
           case when p_mahalle is null then null
                when p_mahalle ~* '(mah\.|mahallesi|mh\.)$' then p_mahalle
                else p_mahalle || ' Mah.' end,
           p_street,
           'No: ' || p_building_no,
           'Kat: ' || p_floor,
           'Daire: ' || p_apartment,
           nullif(concat_ws(' ', p_postal_code, nullif(concat_ws('/', p_ilce, p_il), '')), '')
         ], null), ', '), '')
$$;

revoke all on function public.compose_address(text, text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;

-- p_address checked and normalised (X-8, X-9): an object of at most 4096 bytes, only the listed keys, strings
-- (trimmed, an empty one becomes null) except lat and lng (JSON numbers, both or neither, at most six decimals, inside
-- the region's box). The required parts, then each part's own rule, then the contact scanner on each free text part
-- and on the free text parts joined (X-2). A provider's address has il and ilçe and no directions.
create function public.address_parse(p_address jsonb, p_region text, p_provider boolean)
  returns jsonb
  language plpgsql
  immutable
  security invoker
  set search_path = ''
as $$
declare
  c_text  constant text[] := case when p_provider
                                  then array['il', 'ilce', 'mahalle', 'street', 'building_no', 'floor', 'apartment',
                                             'postal_code']
                                  else array['mahalle', 'street', 'building_no', 'floor', 'apartment', 'postal_code',
                                             'directions'] end;
  c_free  constant text[] := array['il', 'ilce', 'mahalle', 'street', 'directions'];
  v_key   text;
  v_val   jsonb;
  v_text  text;
  v_out   jsonb := '{}'::jsonb;
  v_lat   numeric;
  v_lng   numeric;
begin
  if p_address is null or jsonb_typeof(p_address) <> 'object' or octet_length(p_address::text) > 4096 then
    raise exception 'address_invalid';
  end if;
  for v_key, v_val in select e.key, e.value from jsonb_each(p_address) e loop
    if v_key in ('lat', 'lng') then
      if jsonb_typeof(v_val) not in ('number', 'null') then
        raise exception 'pin_invalid';
      end if;
    elsif v_key = any (c_text) then
      if jsonb_typeof(v_val) = 'string' then
        v_text := nullif(public.catalog_trim(v_val #>> '{}'), '');
        if v_text is not null then
          v_out := v_out || jsonb_build_object(v_key, v_text);
        end if;
      elsif jsonb_typeof(v_val) <> 'null' then
        raise exception 'address_invalid';
      end if;
    else
      raise exception 'address_invalid';
    end if;
  end loop;

  -- The pin.
  v_lat := case when jsonb_typeof(p_address -> 'lat') = 'number' then (p_address ->> 'lat')::numeric end;
  v_lng := case when jsonb_typeof(p_address -> 'lng') = 'number' then (p_address ->> 'lng')::numeric end;
  if (v_lat is null) <> (v_lng is null) then
    raise exception 'pin_invalid';
  end if;
  if v_lat is not null then
    if v_lat <> round(v_lat, 6) or v_lng <> round(v_lng, 6)
       or not public.address_pin_in_region(p_region, v_lat, v_lng) then
      raise exception 'pin_invalid';
    end if;
    v_out := v_out || jsonb_build_object('lat', round(v_lat, 6), 'lng', round(v_lng, 6));
  end if;

  -- The required parts and each part's rule.
  if v_out ->> 'mahalle' is null or v_out ->> 'street' is null or v_out ->> 'building_no' is null
     or (p_provider and (v_out ->> 'il' is null or v_out ->> 'ilce' is null)) then
    raise exception 'address_invalid';
  end if;
  if not (public.address_part_ok(v_out ->> 'il', 2, 60)
          and public.address_part_ok(v_out ->> 'ilce', 2, 60)
          and public.address_part_ok(v_out ->> 'mahalle', 2, 80)
          and public.address_part_ok(v_out ->> 'street', 2, 80)
          and public.address_part_ok(v_out ->> 'building_no', 1, 10)
          and public.address_part_ok(v_out ->> 'floor', 1, 10)
          and public.address_part_ok(v_out ->> 'apartment', 1, 10)
          and public.address_part_ok(v_out ->> 'directions', 1, 300)
          and public.address_number_ok(v_out ->> 'building_no')
          and public.address_number_ok(v_out ->> 'floor')
          and public.address_number_ok(v_out ->> 'apartment')
          and coalesce((v_out ->> 'postal_code') ~ '^[0-9]{5}$', true)) then
    raise exception 'address_invalid';
  end if;

  -- The scanner: each free text part, then the free text parts joined, so a number split across two parts is
  -- still caught. The number parts never join a scan.
  foreach v_key in array c_free loop
    if public.has_contact_info(v_out ->> v_key) then
      raise exception 'contact_info_in_address';
    end if;
  end loop;
  if public.has_contact_info(concat_ws(' ', v_out ->> 'il', v_out ->> 'ilce', v_out ->> 'mahalle', v_out ->> 'street',
                                       v_out ->> 'directions')) then
    raise exception 'contact_info_in_address';
  end if;
  return v_out;
end;
$$;

revoke all on function public.address_parse(jsonb, text, boolean) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. request_addresses: the parts and the pin (AC-2). A row before 20b has the line and nothing else (AC-9); a new
--    row has at least mahalle, street and the building number. The row stays immutable (04's guard).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.request_addresses
  drop constraint request_addresses_line_length,
  add column il text,
  add column ilce text,
  add column mahalle text,
  add column street text,
  add column building_no text,
  add column floor text,
  add column apartment text,
  add column postal_code text,
  add column directions text,
  add column lat numeric(9,6),
  add column lng numeric(9,6),
  -- D230: every part at its maximum composes to 348 code points, so the line allows 400 (the spec's 300 cannot hold it).
  add constraint request_addresses_line_length check (char_length(line) between 1 and 400),
  add constraint request_addresses_parts_ok check (
    public.address_part_ok(il, 2, 60) and public.address_part_ok(ilce, 2, 60)
    and public.address_part_ok(mahalle, 2, 80) and public.address_part_ok(street, 2, 80)
    and public.address_part_ok(building_no, 1, 10) and public.address_part_ok(floor, 1, 10)
    and public.address_part_ok(apartment, 1, 10) and public.address_part_ok(directions, 1, 300)
    and public.address_number_ok(building_no) and public.address_number_ok(floor)
    and public.address_number_ok(apartment)
    and (postal_code is null or postal_code ~ '^[0-9]{5}$')),
  add constraint request_addresses_shape check (
    (il is null and ilce is null and mahalle is null and street is null and building_no is null and floor is null
     and apartment is null and postal_code is null and directions is null and lat is null)
    or (mahalle is not null and street is not null and building_no is not null)),
  add constraint request_addresses_pin_pair check ((lat is null) = (lng is null)),
  add constraint request_addresses_pin_in_region check (lat is null or public.address_pin_in_region(region, lat, lng));

-- X-20: the chosen provider reads the address and the pin only through request_contacts.
drop policy request_addresses_read_unlocked on public.request_addresses;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. create_request with p_address (AC-3, X-8, X-12). 04's order; step 5 checks the parts, step 9 stores them with il
--    and ilçe copied from the zone (never the client) and the line composed here. The old overload is dropped.
-- ═══════════════════════════════════════════════════════════════════════════

drop function public.create_request(uuid, uuid, uuid, uuid[], jsonb, date, integer, text, text, bigint, bigint);

create function public.create_request(
  p_client_key           uuid,
  p_service_id           uuid,
  p_zone_id              uuid,
  p_addon_ids            uuid[],
  p_answers              jsonb,
  p_start_date           date,
  p_start_hour           integer,
  p_address              jsonb,
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
  v_addr        jsonb;
  v_il          text;
  v_ilce        text;
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

  -- 5. The address parts (address_invalid, pin_invalid, contact_info_in_address), then the notes: capped in bytes
  --    first, then trimmed and counted in code points.
  v_addr := public.address_parse(p_address, v_region, false);
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

  -- AC-1, AC-2: il and ilçe from the zone as it is now, frozen in the row; null while admin has not filled the zone.
  select z.il, z.ilce into v_il, v_ilce from public.zones z where z.id = p_zone_id;
  insert into public.request_addresses (request_id, region, customer_id, line, il, ilce, mahalle, street, building_no,
                                        floor, apartment, postal_code, directions, lat, lng)
  values (v_id, v_region, v_uid,
          public.compose_address(v_addr ->> 'mahalle', v_addr ->> 'street', v_addr ->> 'building_no',
                                 v_addr ->> 'floor', v_addr ->> 'apartment', v_addr ->> 'postal_code', v_ilce, v_il),
          v_il, v_ilce, v_addr ->> 'mahalle', v_addr ->> 'street', v_addr ->> 'building_no', v_addr ->> 'floor',
          v_addr ->> 'apartment', v_addr ->> 'postal_code', v_addr ->> 'directions',
          (v_addr ->> 'lat')::numeric, (v_addr ->> 'lng')::numeric);

  -- Ids, status, the price and the region only: never the address, the notes or the answers (AC-18).
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.created', 'requests', v_id::text, v_region, null,
          jsonb_build_object('status', 'OPEN', 'fixed_price', v_price,
                             'service_id', p_service_id, 'zone_id', p_zone_id));

  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

revoke all on function public.create_request(uuid, uuid, uuid, uuid[], jsonb, date, integer, jsonb, text, bigint, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.create_request(uuid, uuid, uuid, uuid[], jsonb, date, integer, jsonb, text, bigint, bigint)
  to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. request_catalog with il and ilçe on each zone (AC-4, X-10), otherwise as in 05.
-- ═══════════════════════════════════════════════════════════════════════════

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
      select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'il', z.il, 'ilce', z.ilce) order by z.display_order, z.id),
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
-- 6. provider_addresses (AC-5, X-11): one row per provider, written only by save_provider_address, read by its
--    provider through my_provider_address, by the customer of a revealed job through the agreement's frozen copy,
--    and by admin through admin_provider_address. RLS on, a deny policy, no API grant (rule 7).
-- ═══════════════════════════════════════════════════════════════════════════

create table public.provider_addresses (
  provider_id  uuid        primary key,
  region       text        not null references public.regions (code) on delete restrict,
  il           text        not null,
  ilce         text        not null,
  mahalle      text        not null,
  street       text        not null,
  building_no  text        not null,
  floor        text,
  apartment    text,
  postal_code  text,
  lat          numeric(9,6),
  lng          numeric(9,6),
  updated_at   timestamptz not null default now(),

  constraint provider_addresses_provider_fk foreign key (provider_id, region)
    references public.providers (id, region) on delete restrict,
  constraint provider_addresses_parts_ok check (
    public.address_part_ok(il, 2, 60) and public.address_part_ok(ilce, 2, 60)
    and public.address_part_ok(mahalle, 2, 80) and public.address_part_ok(street, 2, 80)
    and public.address_part_ok(building_no, 1, 10) and public.address_part_ok(floor, 1, 10)
    and public.address_part_ok(apartment, 1, 10)
    and public.address_number_ok(building_no) and public.address_number_ok(floor)
    and public.address_number_ok(apartment)
    and (postal_code is null or postal_code ~ '^[0-9]{5}$')),
  constraint provider_addresses_pin_pair check ((lat is null) = (lng is null)),
  constraint provider_addresses_pin_in_region check (lat is null or public.address_pin_in_region(region, lat, lng))
);

create index provider_addresses_region_idx on public.provider_addresses (region);
create index provider_addresses_provider_region_idx on public.provider_addresses (provider_id, region);

alter table public.provider_addresses enable row level security;
create policy provider_addresses_no_api on public.provider_addresses for select to authenticated using (false);
revoke all on table public.provider_addresses from anon, authenticated, service_role;

-- No row is ever deleted or truncated (an agreement already froze its copy; 21 decides account deletion).
create function public.provider_addresses_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  raise exception 'provider_address_final';
end;
$$;

revoke all on function public.provider_addresses_guard() from public, anon, authenticated, service_role;

create trigger provider_addresses_no_delete before delete on public.provider_addresses
  for each row execute function public.provider_addresses_guard();
create trigger provider_addresses_no_truncate before truncate on public.provider_addresses
  for each statement execute function public.provider_addresses_guard();

-- Save (AC-5): the caller's own row, inserted or changed; a save that changes something writes one
-- provider.address_changed row with ids only (X-23). Any provider status may save.
create function public.save_provider_address(p_address jsonb)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_row   public.providers%rowtype := public.provider_caller();
  v_addr  jsonb := public.address_parse(p_address, v_row.region, true);
  v_old   public.provider_addresses%rowtype;
  v_new   public.provider_addresses%rowtype;
begin
  select a.* into v_old from public.provider_addresses a where a.provider_id = v_row.id for update;
  insert into public.provider_addresses (provider_id, region, il, ilce, mahalle, street, building_no, floor, apartment,
                                         postal_code, lat, lng, updated_at)
  values (v_row.id, v_row.region, v_addr ->> 'il', v_addr ->> 'ilce', v_addr ->> 'mahalle', v_addr ->> 'street',
          v_addr ->> 'building_no', v_addr ->> 'floor', v_addr ->> 'apartment', v_addr ->> 'postal_code',
          (v_addr ->> 'lat')::numeric, (v_addr ->> 'lng')::numeric, now())
  on conflict (provider_id) do update
     set il = excluded.il, ilce = excluded.ilce, mahalle = excluded.mahalle, street = excluded.street,
         building_no = excluded.building_no, floor = excluded.floor, apartment = excluded.apartment,
         postal_code = excluded.postal_code, lat = excluded.lat, lng = excluded.lng, updated_at = excluded.updated_at
  returning * into v_new;
  if v_old.provider_id is null
     or (to_jsonb(v_old) - 'updated_at') is distinct from (to_jsonb(v_new) - 'updated_at') then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
    values (v_row.id, 'provider.address_changed', 'provider', v_row.id::text, v_row.region, null,
            jsonb_build_object('first', v_old.provider_id is null));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.save_provider_address(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_provider_address(jsonb) to authenticated;

-- The caller's own address with its composed line, or null.
create function public.my_provider_address()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_row  public.providers%rowtype := public.provider_reader();
begin
  return (select jsonb_build_object(
                   'il', a.il, 'ilce', a.ilce, 'mahalle', a.mahalle, 'street', a.street, 'building_no', a.building_no,
                   'floor', a.floor, 'apartment', a.apartment, 'postal_code', a.postal_code, 'lat', a.lat, 'lng', a.lng,
                   'line', public.compose_address(a.mahalle, a.street, a.building_no, a.floor, a.apartment,
                                                  a.postal_code, a.ilce, a.il),
                   'updated_at', a.updated_at)
            from public.provider_addresses a where a.provider_id = v_row.id);
end;
$$;

revoke all on function public.my_provider_address() from public, anon, authenticated, service_role;
grant execute on function public.my_provider_address() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. address_required (AC-5, X-13): submit lists `address` as missing; apply refuses an approved provider without one
--    right after the setup gate. Both otherwise as before.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.submit_provider_file()
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row       public.providers%rowtype := public.provider_caller();
  v_required  text[];
  v_missing   text[] := array[]::text[];
  v_rejected  text[] := array[]::text[];
  v_gone      text[] := array[]::text[];
  v_type      text;
  v_doc       public.provider_documents%rowtype;
  v_reason    text;
begin
  if v_row.status = 'suspended' then
    raise exception 'provider_suspended';
  end if;
  if v_row.status in ('pending', 'approved') then
    return jsonb_build_object('status', v_row.status, 'missing', '[]'::jsonb, 'rejected', '[]'::jsonb,
                              'objectsMissing', '[]'::jsonb);
  end if;

  if v_row.entity_type is null
     or not exists (select 1 from public.provider_profiles where provider_id = v_row.id) then
    v_missing := v_missing || 'profile'::text;
  end if;
  if not public.provider_has_docs_consent(v_row.id, v_row.region) then
    v_missing := v_missing || 'consent'::text;
  end if;
  -- 20b AC-5, X-13: the provider's own address.
  if not exists (select 1 from public.provider_addresses a where a.provider_id = v_row.id) then
    v_missing := v_missing || 'address'::text;
  end if;

  v_required := public.provider_required_types(v_row.region);
  foreach v_type in array v_required loop
    select * into v_doc from public.provider_documents where provider_id = v_row.id and type = v_type;
    if not found then
      v_missing := v_missing || v_type;
    elsif not public.provider_document_object_exists(v_doc) then
      v_gone := v_gone || v_type;
    elsif v_doc.status = 'rejected' then
      v_rejected := v_rejected || v_type;
    end if;
  end loop;

  if cardinality(v_missing) > 0 or cardinality(v_rejected) > 0 or cardinality(v_gone) > 0 then
    return jsonb_build_object('status', v_row.status, 'missing', to_jsonb(v_missing),
                              'rejected', to_jsonb(v_rejected), 'objectsMissing', to_jsonb(v_gone));
  end if;

  v_reason := case when v_row.status = 'draft' then 'first_submission' else 'resubmitted' end;
  update public.providers
     set status = 'pending', submitted_at = now(), review_reason = v_reason,
         rejection_code = null, rejection_note = null
   where id = v_row.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_row.id, 'provider.submitted', 'provider', v_row.id::text, v_row.region,
          jsonb_build_object('status', v_row.status),
          jsonb_build_object('status', 'pending', 'review_reason', v_reason));

  return jsonb_build_object('status', 'pending', 'missing', '[]'::jsonb, 'rejected', '[]'::jsonb,
                            'objectsMissing', '[]'::jsonb);
end;
$$;

revoke all on function public.submit_provider_file() from public, anon, authenticated, service_role;
grant execute on function public.submit_provider_file() to authenticated;

create or replace function public.apply_to_request(p_request_id uuid, p_message text default null, p_answers jsonb default null,
                                        p_questions_version text default null)
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
  v_qset      jsonb;
  v_cap       integer;
  v_category  uuid;
  v_qs        jsonb;
  v_q         jsonb;
  v_key       text;
  v_value     jsonb;
  v_text      text;
  v_clean     jsonb := '{}'::jsonb;
  v_snapshot  jsonb := '[]'::jsonb;
  v_item      jsonb;
  v_choice    jsonb;
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

  -- 3b. 20b AC-5: an approved provider without an address adds one first.
  if not exists (select 1 from public.provider_addresses a where a.provider_id = v_me.id) then
    raise exception 'address_required';
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

  -- 8, 9. The caller's cap (AC-7 of 0011-19a: the reserved slots are for providers on probation), held by the row
  --       lock of step 4. A broken quality setting gives the whole cap (fail open).
  v_settings := public.apply_settings(v_req.region);
  v_qset := public.quality_settings_or_null(v_req.region);
  v_cap := (v_settings ->> 'max_applicants_per_request')::integer;
  if v_qset is not null and not public.provider_on_probation_with(v_me.id, v_qset) then
    v_cap := v_cap - (v_qset ->> 'probation_reserved_slots')::integer;
  end if;
  v_count := public.approved_applied_count(v_req.id);
  if v_count >= v_cap then
    raise exception 'request_full';
  end if;

  -- 9b. AC-6 of 0011-19a: while on probation, no new application past probation_live_jobs live jobs. Applications
  --     already sent, choose, pay and the reveal are untouched.
  if v_qset is not null and public.provider_on_probation_with(v_me.id, v_qset)
     and public.provider_live_jobs(v_me.id) >= (v_qset ->> 'probation_live_jobs')::integer then
    raise exception 'probation_limit';
  end if;

  -- 10. One attempt against the hourly limit.
  perform public.count_application(v_me.id, v_req.region, (v_settings ->> 'applications_per_hour')::integer);

  -- 11. The active questions of the request's category, read once: the version, the checks and the snapshot all
  --     come from this one result (X-6).
  select s.category_id into v_category from public.services s where s.id = v_req.service_id;
  v_qs := public.application_questions_list(v_category, v_req.region);

  if jsonb_array_length(v_qs) = 0 then
    -- 12a. No active question: 05's message, exactly as before.
    if p_answers is not null or p_questions_version is not null then
      return jsonb_build_object('status', 'refused', 'code', 'questions_changed');
    end if;
    if p_message is null or octet_length(p_message) > 8192 then
      return jsonb_build_object('status', 'refused', 'code', 'message_invalid');
    end if;
    v_message := public.catalog_trim(p_message);
    if char_length(v_message) not between 20 and 600 then
      return jsonb_build_object('status', 'refused', 'code', 'message_invalid');
    end if;
    -- The contact scanner (D153).
    if public.message_has_contact_info(v_message) then
      return jsonb_build_object('status', 'refused', 'code', 'contact_info_in_message');
    end if;

    -- 13a. The application, in its request's region.
    insert into public.applications (region, request_id, provider_id, message)
    values (v_req.region, v_req.id, v_me.id, v_message)
    returning id, status, created_at into v_app;
  else
    -- 12b. Active questions: the form must be the current one, answers only.
    if p_answers is null or p_message is not null
       or p_questions_version is distinct from public.application_questions_digest(v_qs) then
      return jsonb_build_object('status', 'refused', 'code', 'questions_changed');
    end if;
    if jsonb_typeof(p_answers) <> 'object' or octet_length(p_answers::text) > 16384 then
      return jsonb_build_object('status', 'refused', 'code', 'answers_invalid');
    end if;
    if exists (select 1 from jsonb_object_keys(p_answers) k
                where not exists (select 1 from jsonb_array_elements(v_qs) q where q ->> 'key' = k)) then
      return jsonb_build_object('status', 'refused', 'code', 'questions_changed');
    end if;

    for v_q in select q from jsonb_array_elements(v_qs) q loop
      v_key := v_q ->> 'key';
      v_value := p_answers -> v_key;
      if v_value is not null and jsonb_typeof(v_value) = 'null' then
        v_value := null;
      end if;
      v_item := jsonb_build_object('key', v_key, 'label', v_q -> 'label', 'type', v_q ->> 'type',
                                   'required', v_q -> 'required');

      if v_value is not null and v_q ->> 'type' = 'textarea' then
        if jsonb_typeof(v_value) <> 'string' or octet_length(v_value #>> '{}') > 8192 then
          return jsonb_build_object('status', 'refused', 'code', 'answers_invalid', 'key', v_key);
        end if;
        v_text := public.catalog_trim(v_value #>> '{}');
        if v_text = '' then
          v_value := null;
        elsif char_length(v_text) not between 10 and (v_q ->> 'max_length')::integer then
          return jsonb_build_object('status', 'refused', 'code', 'answers_invalid', 'key', v_key);
        elsif public.message_has_contact_info(v_text) then
          return jsonb_build_object('status', 'refused', 'code', 'contact_info_in_answer', 'key', v_key);
        else
          v_clean := v_clean || jsonb_build_object(v_key, v_text);
        end if;
      elsif v_value is not null and v_q ->> 'type' = 'single_select' then
        if jsonb_typeof(v_value) <> 'string' then
          return jsonb_build_object('status', 'refused', 'code', 'answers_invalid', 'key', v_key);
        end if;
        v_choice := null;
        select jsonb_build_object('value', o ->> 'value', 'label', o -> 'label') into v_choice
          from jsonb_array_elements(v_q -> 'options') o
         where o ->> 'value' = v_value #>> '{}';
        if v_choice is null then
          return jsonb_build_object('status', 'refused', 'code', 'answers_invalid', 'key', v_key);
        end if;
        v_item := v_item || jsonb_build_object('choice', v_choice);
        v_clean := v_clean || jsonb_build_object(v_key, v_value);
      elsif v_value is not null and v_q ->> 'type' = 'boolean' then
        if jsonb_typeof(v_value) <> 'boolean' then
          return jsonb_build_object('status', 'refused', 'code', 'answers_invalid', 'key', v_key);
        end if;
        v_clean := v_clean || jsonb_build_object(v_key, v_value);
      end if;

      if v_value is null and (v_q ->> 'required')::boolean then
        return jsonb_build_object('status', 'refused', 'code', 'answers_invalid', 'key', v_key);
      end if;
      v_snapshot := v_snapshot || jsonb_build_array(v_item);
    end loop;

    -- 12c. The text answers together, so a number split across fields is caught as one (19b security review).
    if public.message_has_contact_info(public.answers_joined_text(v_clean, v_snapshot)) then
      return jsonb_build_object('status', 'refused', 'code', 'contact_info_in_answer');
    end if;

    -- 13b. The application, its answers and what they answered.
    insert into public.applications (region, request_id, provider_id, message, answers, questions_snapshot)
    values (v_req.region, v_req.id, v_me.id, null, v_clean, v_snapshot)
    returning id, status, created_at into v_app;
  end if;

  return jsonb_build_object('status', 'ok', 'replayed', false, 'application',
           jsonb_build_object('id', v_app.id, 'status', v_app.status, 'created_at', v_app.created_at));
end;
$$;

revoke all on function public.apply_to_request(uuid, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.apply_to_request(uuid, text, jsonb, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The reveal (AC-6, rule 2): only while contacts_visible holds. The provider gets the customer's parts, line,
--    directions and pin; the customer gets the provider's composed address as frozen into the agreement at the reveal
--    (X-6), or null for "not given" (X-14). The provider's pin is never returned here. Otherwise as in 10.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.request_contacts(p_request_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_req   public.requests%rowtype;
  v_app   public.applications%rowtype;
  v_side  text;
  v_out   jsonb;
begin
  if not public.contacts_visible(p_request_id) then
    -- Only a party learns that the window setting is missing; anyone else gets not_found as always.
    select r.* into v_req from public.requests r where r.id = p_request_id;
    if found and coalesce(v_req.closed_at, v_req.cancelled_at) is not null
       and (v_req.customer_id = v_uid
            or exists (select 1 from public.applications a
                        where a.id = v_req.selected_application_id and a.provider_id = v_uid
                          and a.unlocked_at is not null)) then
      perform public.contact_settings(v_req.region);
    end if;
    raise exception 'not_found';
  end if;
  select r.* into v_req from public.requests r where r.id = p_request_id for share;
  select a.* into v_app from public.applications a where a.id = v_req.selected_application_id;
  v_side := case when v_req.customer_id = v_uid then 'customer' else 'provider' end;

  if v_side = 'customer' then
    -- The provider, to the customer.
    select jsonb_build_object(
             'side', 'customer',
             'name', pr.approved_name,
             'phone', p.phone,
             'whatsapp', 'https://wa.me/' || regexp_replace(p.phone, '\D', '', 'g'),
             'email', p.email,
             'email_confirmed', p.email_confirmed_at is not null,
             'provider_address', (select s.content ->> 'provider_address' from public.service_agreements s
                                   where s.application_id = v_app.id))
      into v_out
      from public.providers pr join public.profiles p on p.id = pr.id
     where pr.id = v_app.provider_id;
  else
    -- The customer, the place and the time, to the provider.
    select jsonb_build_object(
             'side', 'provider',
             'name', p.full_name,
             'phone', p.phone,
             'whatsapp', 'https://wa.me/' || regexp_replace(p.phone, '\D', '', 'g'),
             'email', p.email,
             'email_confirmed', p.email_confirmed_at is not null,
             'street', ra.line,
             'address', case when ra.request_id is null then null else jsonb_build_object(
                          'line', ra.line, 'il', ra.il, 'ilce', ra.ilce, 'mahalle', ra.mahalle, 'street', ra.street,
                          'building_no', ra.building_no, 'floor', ra.floor, 'apartment', ra.apartment,
                          'postal_code', ra.postal_code, 'directions', ra.directions, 'lat', ra.lat, 'lng', ra.lng) end,
             'notes', v_req.notes,
             'zone', (select z.name from public.zones z where z.id = v_req.zone_id),
             'scheduled_start_at', v_req.scheduled_start_at,
             'scheduled_end_at', v_req.scheduled_end_at,
             'timezone', (select g.timezone from public.regions g where g.code = v_req.region))
      into v_out
      from public.profiles p
      left join public.request_addresses ra on ra.request_id = v_req.id
     where p.id = v_req.customer_id;
  end if;

  -- AC-7, R-3: the first read of each side is audited once; a concurrent first read conflicts quietly.
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'contacts.viewed', 'requests', v_req.id::text, v_req.region, null,
          jsonb_build_object('side', v_side))
  on conflict (entity_id, actor_id) where action = 'contacts.viewed' do nothing;

  return v_out;
end;
$$;

revoke all on function public.request_contacts(uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_contacts(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Admin (AC-7): the request's address with its parts and pin, audited as in 16; a provider's address, audited with
--    the reason in audit_log only.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.admin_request_address(p_request_id uuid, p_reason text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_req     public.requests%rowtype;
  v_addr    public.request_addresses%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'reason_required';
  end if;
  select r.* into v_req from public.requests r where r.id = p_request_id;
  if not found then
    raise exception 'not_found';
  end if;
  if not exists (select 1 from public.applications a
                  where a.id = v_req.selected_application_id and a.request_id = v_req.id and a.unlocked_at is not null) then
    raise exception 'not_available';
  end if;
  select x.* into v_addr from public.request_addresses x where x.request_id = v_req.id;
  if not found then
    raise exception 'not_available';
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.address_viewed', 'requests', v_req.id::text, v_req.region, null,
          jsonb_build_object('reason', v_reason));
  return jsonb_build_object('line', v_addr.line, 'il', v_addr.il, 'ilce', v_addr.ilce, 'mahalle', v_addr.mahalle,
                            'street', v_addr.street, 'building_no', v_addr.building_no, 'floor', v_addr.floor,
                            'apartment', v_addr.apartment, 'postal_code', v_addr.postal_code,
                            'directions', v_addr.directions, 'lat', v_addr.lat, 'lng', v_addr.lng);
end;
$$;

revoke all on function public.admin_request_address(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_request_address(uuid, text) to authenticated;

create function public.admin_provider_address(p_provider_id uuid, p_reason text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_addr    public.provider_addresses%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'validation_failed';
  end if;
  select a.* into v_addr from public.provider_addresses a where a.provider_id = p_provider_id;
  if not found then
    raise exception 'not_found';
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'provider.address_viewed', 'provider', v_addr.provider_id::text, v_addr.region, null,
          jsonb_build_object('reason', v_reason));
  return jsonb_build_object('line', public.compose_address(v_addr.mahalle, v_addr.street, v_addr.building_no,
                                                           v_addr.floor, v_addr.apartment, v_addr.postal_code,
                                                           v_addr.ilce, v_addr.il),
                            'il', v_addr.il, 'ilce', v_addr.ilce, 'mahalle', v_addr.mahalle, 'street', v_addr.street,
                            'building_no', v_addr.building_no, 'floor', v_addr.floor, 'apartment', v_addr.apartment,
                            'postal_code', v_addr.postal_code, 'lat', v_addr.lat, 'lng', v_addr.lng,
                            'updated_at', v_addr.updated_at);
end;
$$;

revoke all on function public.admin_provider_address(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_provider_address(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. The agreement (AC-8): three new field names, the content frozen at the reveal adds the customer's composed
--     address and directions and the provider's composed address (null with no row); template draft-2 for TR, made the
--     active one in this transaction (draft-1 stays for picks that accepted it).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.agreement_field_names()
  returns text[]
  language sql
  immutable
  set search_path = ''
as $$
  select array['agreement_number', 'agreement_date', 'customer_name', 'customer_phone', 'provider_name',
               'provider_phone', 'platform_name', 'service_name', 'category_name', 'addon_names', 'district',
               'street_line', 'scheduled_start', 'scheduled_end', 'job_price', 'commission', 'provider_fee',
               'cash_due', 'currency', 'customer_accepted_at', 'provider_accepted_at', 'template_version',
               'customer_address', 'customer_directions', 'provider_address']::text[]
$$;

revoke all on function public.agreement_field_names() from public, anon, authenticated, service_role;

create or replace function public.queue_agreement(p_request_id uuid, p_application_id uuid)
  returns uuid
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_req      public.requests%rowtype;
  v_app      public.applications%rowtype;
  v_cust     public.agreement_acceptances%rowtype;
  v_prov     public.agreement_acceptances%rowtype;
  v_tpl      public.agreement_templates%rowtype;
  v_tz       text;
  v_seq      bigint;
  v_number   text;
  v_content  jsonb;
  v_id       uuid;
begin
  select s.id into v_id from public.service_agreements s where s.application_id = p_application_id;
  if found then
    return v_id;
  end if;
  select r.* into v_req from public.requests r where r.id = p_request_id;
  select a.* into v_app from public.applications a where a.id = p_application_id and a.request_id = p_request_id;
  select c.* into v_cust from public.agreement_acceptances c where c.application_id = p_application_id and c.role = 'customer';
  select c.* into v_prov from public.agreement_acceptances c where c.application_id = p_application_id and c.role = 'provider';
  -- An old pick (unlocked before this release) or a broken path: no agreement, and the caller alerts.
  if v_req.id is null or v_app.id is null or v_app.unlocked_at is null or v_cust.id is null or v_prov.id is null
     or v_cust.template_id <> v_prov.template_id then
    return null;
  end if;
  select t.* into v_tpl from public.agreement_templates t where t.id = v_cust.template_id;
  select g.timezone into v_tz from public.regions g where g.code = v_req.region;

  -- The number: a fixed list of regions, never dynamic SQL; a gap after a rollback is fine.
  v_seq := case v_req.region when 'TR' then nextval('public.service_agreement_seq_tr') end;
  if v_seq is null then
    return null;
  end if;
  v_number := 'HS-' || v_req.region || '-' || to_char(v_app.unlocked_at at time zone v_tz, 'YYYY') || '-'
              || lpad(v_seq::text, 6, '0');

  -- Plain values only: minor unit integers and UTC instants, formatted once by the renderer (Template fields).
  select jsonb_build_object(
           'agreement_number', v_number,
           'agreement_date', to_char(v_app.unlocked_at at time zone v_tz, 'YYYY-MM-DD'),
           'timezone', v_tz,
           'unlocked_at', v_app.unlocked_at,
           'customer_name', cp.full_name,
           'customer_phone', cp.phone,
           'provider_name', coalesce(pr.approved_name, pp.full_name),
           'provider_phone', pp.phone,
           'platform_name', 'Aldebyani',
           'service_name', public.agreement_tr_text(v_req.pricing_snapshot -> 'service' -> 'name'),
           'category_name', public.agreement_tr_text(v_req.pricing_snapshot -> 'service' -> 'category_name'),
           'addon_names', coalesce((select jsonb_agg(public.agreement_tr_text(x -> 'name') order by n)
                                      from jsonb_array_elements(
                                             case when jsonb_typeof(v_req.pricing_snapshot -> 'breakdown' -> 'addons') = 'array'
                                                  then v_req.pricing_snapshot -> 'breakdown' -> 'addons'
                                                  else '[]'::jsonb end) with ordinality as e(x, n)
                                     where public.agreement_tr_text(x -> 'name') is not null), '[]'::jsonb),
           'district', public.agreement_tr_text(z.name),
           'street_line', ad.line,
           'customer_address', ad.line,
           'customer_directions', ad.directions,
           'provider_address', case when pa.provider_id is null then null
                                    else public.compose_address(pa.mahalle, pa.street, pa.building_no, pa.floor,
                                                                pa.apartment, pa.postal_code, pa.ilce, pa.il) end,
           'scheduled_start', v_req.scheduled_start_at,
           'scheduled_end', v_req.scheduled_end_at,
           'job_price', v_req.fixed_price,
           'commission', v_req.commission_amount,
           'provider_fee', v_app.provider_fee_amount,
           'cash_due', v_req.cash_due,
           'currency', v_req.currency,
           'customer_accepted_at', v_cust.accepted_at,
           'provider_accepted_at', v_prov.accepted_at,
           'template_version', v_tpl.version)
    into v_content
    from public.profiles cp
    join public.profiles pp on pp.id = v_app.provider_id
    left join public.providers pr on pr.id = v_app.provider_id
    left join public.zones z on z.id = v_req.zone_id
    left join public.request_addresses ad on ad.request_id = v_req.id
    left join public.provider_addresses pa on pa.provider_id = v_app.provider_id
   where cp.id = v_req.customer_id;
  if v_content is null then
    return null;
  end if;

  insert into public.service_agreements (region, request_id, application_id, number, template_id, content)
  values (v_req.region, v_req.id, v_app.id, v_number, v_tpl.id, v_content)
  on conflict (application_id) do nothing
  returning id into v_id;
  if v_id is null then
    select s.id into v_id from public.service_agreements s where s.application_id = p_application_id;
    return v_id;
  end if;
  perform public.enqueue_outbox('agreement.render', 'agreement.render:' || v_id || ':1',
                                jsonb_build_object('agreement_id', v_id), v_req.region);
  return v_id;
end;
$$;

revoke all on function public.queue_agreement(uuid, uuid) from public, anon, authenticated, service_role;

-- Every heading and paragraph starts `[draft] ` until the lawyer's text lands (B10, S16). draft-1's seven sections,
-- with both addresses and the customer's directions (X-18).
insert into public.agreement_templates (region, version, active, body) values ('TR', 'draft-2', false, $json$[
  {"heading": "[draft] Taraflar",
   "paragraphs": [
     "[draft] Bu Hizmet Sözleşmesi ({{agreement_number}}), {{agreement_date}} tarihinde hizmet alan {{customer_name}} (telefon: {{customer_phone}}) ile hizmet veren {{provider_name}} (telefon: {{provider_phone}}) arasında, {{platform_name}} platformu aracılığıyla kurulmuştur.",
     "[draft] Hizmet alanın adresi: {{customer_address}}. Hizmet verenin adresi: {{provider_address}}."]},
  {"heading": "[draft] Platformun rolü",
   "paragraphs": [
     "[draft] {{platform_name}}, taraflar arasında yalnızca aracılık hizmeti sunar ve bu sözleşmenin tarafı değildir.",
     "[draft] Platform hizmet bedelini tahsil etmez, tutmaz ve aktarmaz. Platform yalnızca kendi komisyonunu ve hizmet veren ücretini çevrimiçi alır."]},
  {"heading": "[draft] Hizmetin konusu",
   "paragraphs": [
     "[draft] Hizmet: {{service_name}} ({{category_name}}). Ek hizmetler: {{addon_names}}.",
     "[draft] Hizmet adresi: {{customer_address}} ({{district}}). Yol tarifi: {{customer_directions}}.",
     "[draft] Planlanan başlangıç: {{scheduled_start}}. Planlanan bitiş: {{scheduled_end}}."]},
  {"heading": "[draft] Bedel ve ödeme",
   "paragraphs": [
     "[draft] Hizmet bedeli: {{job_price}}. Para birimi: {{currency}}.",
     "[draft] Hizmet alan, platform komisyonu olarak {{commission}} tutarını çevrimiçi ödemiştir.",
     "[draft] Hizmet veren, platform hizmet veren ücreti olarak {{provider_fee}} tutarını çevrimiçi ödemiştir.",
     "[draft] Hizmet alan, hizmet tamamlandıktan sonra hizmet verene yüz yüze ve nakit olarak şu tutarı öder: {{cash_due}}."]},
  {"heading": "[draft] Tarafların yükümlülükleri",
   "paragraphs": [
     "[draft] Hizmet veren, hizmeti özenle, kararlaştırılan zamanda ve kararlaştırılan kapsamda yerine getirir.",
     "[draft] Hizmet alan, hizmetin yapılabilmesi için adrese erişimi sağlar ve kararlaştırılan nakit tutarı öder."]},
  {"heading": "[draft] İptal ve sorunlar",
   "paragraphs": [
     "[draft] İptal ve ücret iadesi koşulları platformun kullanım şartlarında yer alır.",
     "[draft] Hizmetle ilgili bir sorun platform üzerinden bildirilebilir. Platform, taraflardan biri kurallara aykırı davranırsa hukuki yollara başvurma hakkını saklı tutar."]},
  {"heading": "[draft] Kabul",
   "paragraphs": [
     "[draft] Hizmet alan bu sözleşmeyi {{customer_accepted_at}} tarihinde, hizmet veren {{provider_accepted_at}} tarihinde elektronik olarak kabul etmiştir. Sözleşme şablonu: {{template_version}}."]}
]$json$::jsonb);

-- X-4: draft-1 off, then draft-2 on, in this one transaction (the one active index never sees two).
update public.agreement_templates set active = false where region = 'TR' and version = 'draft-1';
update public.agreement_templates set active = true where region = 'TR' and version = 'draft-2';
