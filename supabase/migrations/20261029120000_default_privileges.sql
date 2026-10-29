-- 00b review guardrail (D86): every new table, sequence and function in public starts closed, in the
-- cloud, on the local stack and in CI alike.
--
-- Default privileges decide what a role holds on an object the moment a migration creates it. Read on
-- 2026-10-29, for objects created by `postgres` (every migration) in schema public:
--   cloud (the project's original defaults): anon, authenticated and service_role hold EVERYTHING on a
--     new table (TRUNCATE included), USAGE, SELECT and UPDATE on a new sequence, EXECUTE on a new
--     function;
--   local stack and CI (the CLI's newer defaults): no read or write, but still MAINTAIN, REFERENCES,
--     TRIGGER and TRUNCATE on a new table, and UPDATE on a new sequence.
-- So a migration that forgot its grants passed CI and shipped open in the cloud, and TRUNCATE is not
-- governed by RLS anywhere. D77 fixed the two existing tables; this fixes the cause. After it, none of
-- the three roles holds anything on a new object until its migration grants exactly the access model
-- (D77: each position grants its own). Objects that exist already keep their grants, which
-- supabase/tests/02 and 03 pin.
--
-- Functions stay executable by PUBLIC by Postgres's global default, which a per schema default cannot
-- remove: each function revokes it itself, and supabase/tests/02 fails on any that does not.
-- supabase/tests/04 proves the defaults below and that no public table grants anon anything.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;
