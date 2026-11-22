-- Test phones (spec 0013, D224): an allow list of exact phone numbers outside TR and KSA that may sign up, for testing
-- real SMS with a Twilio trial account (which sends only to numbers verified in Twilio). Each listed number is filed in
-- a region (TR by default). An empty table changes nothing: launch behaviour is exactly D16's.
--
-- The list is written only by the owner (SQL editor): RLS on, a deny policy, no grant to any API role. phone_region()
-- reads it after the two literal patterns; the profiles check becomes an E.164 shape check plus a guard trigger that
-- holds the same rule (a check cannot read a table).
--
-- Every function revokes PUBLIC and pins search_path (supabase/tests/02).

create table public.test_phones (
  phone       text        primary key,
  region      text        not null default 'TR' references public.regions (code) on delete restrict,
  note        text,
  created_at  timestamptz not null default now(),

  constraint test_phones_e164 check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- A listed number never shadows a real mobile number of a region: those keep their own region.
  constraint test_phones_not_region_mobile check (phone !~ '^\+905[0-9]{9}$' and phone !~ '^\+9665[0-9]{8}$'),
  constraint test_phones_note_size check (note is null or char_length(note) <= 200)
);

alter table public.test_phones enable row level security;

create policy test_phones_no_api_access on public.test_phones for all to anon, authenticated
  using (false) with check (false);

revoke all on table public.test_phones from anon, authenticated, service_role;

-- 05's body plus the allow list. Stable now (it reads a table). Literal patterns unchanged, so lib/region/phone.ts and
-- tests/region-phone.test.ts still agree with it.
create or replace function public.phone_region(p_phone text)
  returns text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select case
    when p_phone ~ '^\+905[0-9]{9}$' then 'TR'
    when p_phone ~ '^\+9665[0-9]{8}$' then 'KSA'
    else (select t.region from public.test_phones t where t.phone = p_phone)
  end
$$;

revoke all on function public.phone_region(text) from public, anon, authenticated, service_role;

-- The profiles rule (D16): the region is the phone's region. The literal check cannot see the allow list, so it
-- becomes a shape check plus this guard, which runs for every role on every write of phone or region.
alter table public.profiles drop constraint profiles_phone_matches_region;
alter table public.profiles add constraint profiles_phone_e164 check (phone ~ '^\+[1-9][0-9]{7,14}$');

create function public.profiles_phone_region()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if public.phone_region(new.phone) is distinct from new.region then
    raise exception 'phone_region_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_phone_region() from public, anon, authenticated, service_role;

create trigger profiles_phone_region before insert or update of phone, region on public.profiles
  for each row execute function public.profiles_phone_region();
