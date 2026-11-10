-- Position 01, part 2 (spec 0005): the contact email and the notification preferences.
--
-- The email is contact only. It never signs anyone in, and nothing is sent to it until position 13
-- confirms it, so `email_confirmed_at` has no writer yet (no API role, service_role included). Preferences
-- are rows only for what a user turned off or on: no row means on (AC-33). Only topics that CAN be turned
-- off are topics; money and deadline notices are always on, so they are not in the table at all.
--
-- Order below: columns -> grants -> functions -> triggers -> the table, RLS, policies, grants.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. profiles.email and profiles.email_confirmed_at.
--    collate "C": an identifier never folds under a Turkish locale (rule 10), and lower() under "C" only
--    touches ASCII. The app lowercases first with plain toLowerCase; the check refuses anything else.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column email text collate "C",
  add column email_confirmed_at timestamptz,
  add constraint profiles_email_shape check (
    email is null
    or (email = lower(email)
        and char_length(email) <= 254
        and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  add constraint profiles_email_confirmed_needs_email check (email_confirmed_at is null or email is not null);

grant update (email) on table public.profiles to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The two triggers on profiles learn about the email.
--    A different address is unconfirmed again, and every real change is audited (AC-15). Saving the same
--    address changes nothing: `is distinct from` sees no change.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.profiles_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.region is distinct from old.region or new.phone is distinct from old.phone then
    raise exception 'immutable_field';
  end if;
  if new.email is distinct from old.email then
    new.email_confirmed_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.profiles_audit()
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
  if new.email is distinct from old.email then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
    values (auth.uid(), 'profile.email_changed', 'profile', new.id::text, new.region,
            jsonb_build_object('email', old.email), jsonb_build_object('email', new.email));
  end if;
  return null;
end;
$$;

-- create or replace keeps the earlier revoke, and these two stay executable by nobody: they are triggers.

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. notification_preferences: a user's own switches, one row per user and topic.
--    Region is copied from the owner's profile by a trigger, so a client cannot choose it, and the policy
--    checks it again.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.notification_preferences (
  user_id        uuid        not null references public.profiles (id) on delete restrict,
  topic          text        not null,
  region         text        not null references public.regions (code),
  email_enabled  boolean     not null,
  updated_at     timestamptz not null default now(),

  primary key (user_id, topic),
  -- The topics that can be turned off (lib/notifications/topics.ts). The rest are always on.
  constraint notification_preferences_topic_valid
    check (topic in ('new_offer', 'new_matching_request', 'work_updates', 'ratings'))
);

alter table public.notification_preferences enable row level security;

create policy notification_preferences_read_own
  on public.notification_preferences for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy notification_preferences_insert_own
  on public.notification_preferences for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and region = (select p.region from public.profiles p where p.id = (select auth.uid()))
  );

create policy notification_preferences_update_own
  on public.notification_preferences for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and region = (select p.region from public.profiles p where p.id = (select auth.uid()))
  );

create index notification_preferences_region_idx on public.notification_preferences (region);

-- Spec 0005. Table level update, because an upsert through the API sets every column it was sent; the
-- update policy still holds a row to its owner and their region. service_role reads, for position 13.
grant select, insert, update on table public.notification_preferences to authenticated;
grant select on table public.notification_preferences to service_role;

create function public.notification_preferences_prepare()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- The caller's own profile only: RLS lets them read nothing else. A missing profile leaves region
    -- null, which the column refuses.
    new.region := (select p.region from public.profiles p where p.id = new.user_id);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.notification_preferences_prepare() from public, anon, authenticated, service_role;

create trigger notification_preferences_prepare
  before insert or update on public.notification_preferences
  for each row execute function public.notification_preferences_prepare();
