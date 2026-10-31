-- 00b Scaffold completion (spec 0004): money flags per region, KSA switched off, health ping.
--
-- D70: the five money kill switches leave the environment and become platform_settings rows, one
-- per region, read live on every call and failing closed (lib/flags). D71: GET /api/health pings
-- the database through health_ping(), the one function anon may call on purpose.
--
-- No table is created, so there is no RLS step: regions and platform_settings keep the policies
-- from 20260818135102 (signed in users read, admins write platform_settings, nobody writes regions).
-- Order below: grants -> constraint -> data -> function and its grants.

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Explicit table grants (owner, 2026-10-28). RLS decides which ROWS a role sees; a GRANT decides
--    whether the role may touch the table at all. The cloud project was created with Supabase's old
--    default privileges (anon, authenticated and service_role hold every privilege on every new
--    table, TRUNCATE included), while the local stack and CI use the newer hardened defaults (no
--    select, insert, update or delete for any of them). The same migrations therefore behaved
--    differently in the two places. Revoking everything and granting exactly the access model
--    makes them identical everywhere:
--      regions            read: signed in users and server jobs (service_role). Written by no role.
--      platform_settings  read: signed in users and server jobs; write: authenticated, where the
--                         admin only policy from 20260818135102 decides (D15).
--    anon gets nothing on either table: an anonymous flag read fails, and lib/flags turns any
--    failure into "off". supabase/tests/03 pins these grants exactly.
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on table public.regions, public.platform_settings from anon, authenticated, service_role;

grant select on table public.regions to authenticated, service_role;
grant select on table public.platform_settings to authenticated, service_role;
grant insert, update, delete on table public.platform_settings to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Only a JSON boolean can be stored under a key ending in `_enabled`.
--    The string "false" is truthy in JavaScript and would switch a money feature ON. The flag
--    reader already treats a non boolean as off; the database refuses to store one at all.
--    No seeded key ends in `_enabled` before this migration, so existing rows all pass.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_enabled_is_boolean
  check (right(key, 8) <> '_enabled' or jsonb_typeof(value) = 'boolean');

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The five money flags per region (D70). TR is live at launch; KSA stays off until a Saudi
--    PSP is chosen (D22, Q7). An admin flips a row in the table editor until the admin UI (16);
--    the next read sees it, with no deploy. Idempotent like every seed here.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.platform_settings (region, key, value) values
  ('TR',  'funding_enabled',       'true'),
  ('TR',  'unlock_enabled',        'true'),
  ('TR',  'payouts_enabled',       'true'),
  ('TR',  'auto_release_enabled',  'true'),
  ('TR',  'notifications_enabled', 'true'),
  ('KSA', 'funding_enabled',       'false'),
  ('KSA', 'unlock_enabled',        'false'),
  ('KSA', 'payouts_enabled',       'false'),
  ('KSA', 'auto_release_enabled',  'false'),
  ('KSA', 'notifications_enabled', 'false')
on conflict (region, key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. KSA is not live (D22, D70). Nothing reads regions.active until position 01 (the region step
--    at sign up); until then the KSA flags above are the switch that acts.
-- ═══════════════════════════════════════════════════════════════════════════

update public.regions set active = false where code = 'KSA';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. health_ping(): "is the database answering?" for GET /api/health (D71).
--    security invoker and a body that reads nothing, so calling it reveals no data. search_path
--    is pinned anyway: the body needs no schema, and a pinned path keeps the advisor quiet.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.health_ping()
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select true
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function; revoke it, then grant exactly the two
-- API roles. Entered in the anon allow list of supabase/tests/02_function_grants.test.sql.
revoke execute on function public.health_ping() from public;
grant execute on function public.health_ping() to anon, authenticated;
