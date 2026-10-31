-- Position 01, part 1 (spec 0005): accounts, roles, the agreement, the audit trail.
--
-- Sending and checking the code happen in Supabase Auth, straight from the browser (D98), so what
-- truly holds lives here: the before_user_created hook refuses a bad number before any SMS, no account
-- ever holds a password (D104), and complete_onboarding is the one writer of a role, in one transaction,
-- from the verified auth.users row (D99).
--
-- Order below is the mandatory one: tables -> RLS -> policies -> grants -> functions and triggers ->
-- their grants -> seed. Every function revokes PUBLIC and pins search_path (supabase/tests/02).
-- Errors are stable codes in the exception message; actions/onboarding.ts maps them (rule 10).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. profiles: one row per onboarded user.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.profiles (
  -- Deletion means anonymising (architecture §39), a later position, so the row can never vanish.
  id          uuid primary key references auth.users (id) on delete restrict,
  role        text        not null,
  region      text        not null references public.regions (code),
  -- E.164. collate "C" because an identifier never folds under a Turkish locale (rule 10).
  phone       text collate "C" not null unique,
  full_name   text        not null,
  locale      text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_role_valid   check (role in ('customer', 'provider', 'admin')),
  constraint profiles_locale_valid check (locale in ('ar', 'tr', 'en')),
  constraint profiles_name_length  check (char_length(btrim(full_name)) between 2 and 100),
  -- D16. Literal, because a check cannot read another table, and not phone_region(): every update of
  -- the row runs the check as the caller, who has no execute grant. phone_region() and
  -- lib/region/phone.ts hold the same patterns; tests/region-phone.test.ts proves all three agree.
  constraint profiles_phone_matches_region check (
    (region = 'TR' and phone ~ '^\+905[0-9]{9}$') or (region = 'KSA' and phone ~ '^\+9665[0-9]{8}$')
  )
);

alter table public.profiles enable row level security;

-- D15: admins are global, so there is no region predicate. auth.uid() and auth.jwt() are wrapped in a
-- subselect so they run once per query, not once per row (architecture §32).
create policy profiles_read_own
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_read_admin
  on public.profiles for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create index profiles_region_idx on public.profiles (region);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. terms_acceptances: one row per acceptance, append only. Only complete_onboarding writes.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.terms_acceptances (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null references public.profiles (id) on delete restrict,
  region         text        not null references public.regions (code),
  terms_version  text        not null,
  locale         text        not null,
  accepted_at    timestamptz not null default now(),

  constraint terms_acceptances_once unique (user_id, terms_version)
);

alter table public.terms_acceptances enable row level security;

create policy terms_acceptances_read_own
  on public.terms_acceptances for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy terms_acceptances_read_admin
  on public.terms_acceptances for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create index terms_acceptances_region_idx on public.terms_acceptances (region);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. audit_log: append only, written by the database. A plain table, partition when it grows (§39).
--    old_value and new_value may hold a name or an email, so only admins read it (D102).
-- ═══════════════════════════════════════════════════════════════════════════

create table public.audit_log (
  id           bigint generated always as identity primary key,
  -- auth.uid(), null from the SQL editor. No foreign key: history outlives users.
  actor_id     uuid,
  action       text        not null,
  entity_type  text        not null,
  entity_id    text        not null,
  region       text,
  old_value    jsonb,
  new_value    jsonb,
  created_at   timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create policy audit_log_read_admin
  on public.audit_log for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create index audit_log_created_at_idx on public.audit_log (created_at);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Grants (D77: each table its own). No API role, service_role included, writes the two
--    append only tables, and no API role updates role, region or phone (AC-9, AC-14).
-- ═══════════════════════════════════════════════════════════════════════════

grant select on table public.profiles to authenticated, service_role;
grant update (full_name, locale) on table public.profiles to authenticated;
grant select on table public.terms_acceptances to authenticated, service_role;
grant select on table public.audit_log to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. phone_region(): the region of a mobile number, or null. Same patterns as the check above.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.phone_region(p_phone text)
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select case
    when p_phone ~ '^\+905[0-9]{9}$' then 'TR'
    when p_phone ~ '^\+9665[0-9]{8}$' then 'KSA'
  end
$$;

revoke all on function public.phone_region(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. public_region_info(): what a signed out visitor may know. Anon reads no table, so this is
--    security definer and returns public facts only (allow list in supabase/tests/02).
-- ═══════════════════════════════════════════════════════════════════════════

create function public.public_region_info()
  returns table (code text, dial_code text, support_whatsapp text)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select r.code,
         r.dial_code,
         s.value #>> '{}'
    from public.regions r
    left join public.platform_settings s
      on s.region = r.code and s.key = 'support_whatsapp'
   where r.active
   order by r.code
$$;

revoke all on function public.public_region_info() from public, anon, authenticated, service_role;
grant execute on function public.public_region_info() to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. check_new_user(): the before_user_created Auth hook, before any SMS is sent (AC-3).
--    Refuses anything but a mobile number of an active region: an email or password sign up has no
--    phone. Auth stores phones without the leading plus. Switching KSA on is a data change.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.check_new_user(event jsonb)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_phone text := ltrim(coalesce(event -> 'user' ->> 'phone', ''), '+');
  v_email text := coalesce(event -> 'user' ->> 'email', '');
begin
  if v_email = ''
     and exists (select 1 from public.regions r
                  where r.active and r.code = public.phone_region('+' || v_phone)) then
    return '{}'::jsonb;
  end if;
  return '{"error": {"http_code": 400, "message": "phone_not_supported"}}'::jsonb;
end;
$$;

revoke all on function public.check_new_user(jsonb) from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.check_new_user(jsonb) to supabase_auth_admin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. no_password(): no account ever holds a password (AC-3, D104). Otherwise an attacker signs up a
--    victim's number with a password and waits for the victim to confirm it by code.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.no_password()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  new.encrypted_password := '';
  return new;
end;
$$;

revoke all on function public.no_password() from public, anon, authenticated, service_role;

create trigger no_password
  before insert or update of encrypted_password on auth.users
  for each row execute function public.no_password();

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. complete_onboarding(): role, profile, agreement and audit in one transaction (AC-8).
--    Region and phone come from the verified auth.users row, never from the client. A retry changes
--    nothing and returns the same answer, and a second call with another role keeps the first.
--    The action refreshes the session afterwards, so the token carries the role.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.complete_onboarding(
  p_role text,
  p_full_name text,
  p_locale text,
  p_accept_terms boolean
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_name     text := btrim(coalesce(p_full_name, ''));
  v_phone    text;
  v_region   text;
  v_terms    text;
  v_existing public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;

  select * into v_existing from public.profiles where id = v_uid;
  if found then
    return jsonb_build_object('role', v_existing.role, 'region', v_existing.region, 'created', false);
  end if;

  if p_role is null or p_role not in ('customer', 'provider')
     or p_accept_terms is distinct from true
     or char_length(v_name) not between 2 and 100
     or p_locale is null or p_locale not in ('ar', 'tr', 'en') then
    raise exception 'validation_failed';
  end if;

  select '+' || u.phone, public.phone_region('+' || u.phone)
    into v_phone, v_region
    from auth.users u
   where u.id = v_uid and u.phone_confirmed_at is not null;

  if v_region is null
     or not exists (select 1 from public.regions r where r.code = v_region and r.active) then
    raise exception 'phone_not_eligible';
  end if;

  select s.value #>> '{}' into strict v_terms
    from public.platform_settings s
   where s.region = v_region and s.key = 'terms_version';

  begin
    insert into public.profiles (id, role, region, phone, full_name, locale)
    values (v_uid, p_role, v_region, v_phone, v_name, p_locale)
    on conflict (id) do nothing;
  exception
    -- profiles.phone keeps the sign up number, so an Auth phone change can free a number in
    -- auth.users that a profile still holds.
    when unique_violation then
      raise exception 'phone_taken';
  end;

  -- A double submit lost the race: the other call did the rest of the work.
  if not found then
    select * into v_existing from public.profiles where id = v_uid;
    return jsonb_build_object('role', v_existing.role, 'region', v_existing.region, 'created', false);
  end if;

  insert into public.terms_acceptances (user_id, region, terms_version, locale)
  values (v_uid, v_region, v_terms, p_locale);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, new_value)
  values (v_uid, 'account.created', 'profile', v_uid::text, v_region, jsonb_build_object('role', p_role));

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('role', p_role, 'region', v_region)
   where id = v_uid;

  return jsonb_build_object('role', p_role, 'region', v_region, 'created', true);
end;
$$;

revoke all on function public.complete_onboarding(text, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_onboarding(text, text, text, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. promote_to_admin(): the first admin, from the SQL editor only (AC-16, D99). No API role may
--     call it. Sets the role in both places, and audits it.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.promote_to_admin(p_phone text)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where phone = p_phone;
  if not found then
    raise exception 'no_profile';
  end if;

  update public.profiles set role = 'admin' where id = v_profile.id;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "admin"}'::jsonb
   where id = v_profile.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (auth.uid(), 'account.promoted', 'profile', v_profile.id::text, v_profile.region,
          jsonb_build_object('role', v_profile.role), '{"role": "admin"}'::jsonb);
end;
$$;

revoke all on function public.promote_to_admin(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. Triggers on profiles. The column grants stop an API role; this stops every role (AC-9).
--     The audit trigger is definer because `authenticated` cannot insert into audit_log, and being
--     a trigger it records a direct API update too (AC-15). Part 2 adds the email change.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.profiles_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.region is distinct from old.region or new.phone is distinct from old.phone then
    raise exception 'immutable_field';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.profiles_guard() from public, anon, authenticated, service_role;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

create function public.profiles_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.full_name is distinct from old.full_name then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
    values (auth.uid(), 'profile.name_changed', 'profile', new.id::text, new.region,
            jsonb_build_object('full_name', old.full_name), jsonb_build_object('full_name', new.full_name));
  end if;
  return null;
end;
$$;

revoke all on function public.profiles_audit() from public, anon, authenticated, service_role;

create trigger profiles_audit
  after update on public.profiles
  for each row execute function public.profiles_audit();

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. Seed. The version a new account accepts, per region (AC-20). `draft-1` until S16; the launch
--     gate holds the draft text back from real users (D100). support_whatsapp has no row until S25.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.platform_settings (region, key, value) values
  ('TR',  'terms_version', '"draft-1"'),
  ('KSA', 'terms_version', '"draft-1"')
on conflict (region, key) do nothing;
