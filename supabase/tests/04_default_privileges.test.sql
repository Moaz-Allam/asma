-- Meta tests over grants (D86, after the 00b reviews): a new object starts closed, and no table in
-- public is open beyond its explicit grants.
--
-- The cloud project and the local stack started with different default privileges, so a migration that
-- forgot its grants passed CI and shipped open in the cloud. 20261029120000_default_privileges makes
-- both start from nothing; these tests keep it that way, and catch a grant nobody meant.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

-- 1. No default privilege of `postgres` (every migration) in public reaches the API roles.
SELECT is_empty(
  $$ SELECT d.defaclobjtype::text || ' ' || a.grantee::regrole::text || ' ' || a.privilege_type
       FROM pg_default_acl d
       CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole = 'postgres'::regrole
        AND d.defaclnamespace = 'public'::regnamespace
        AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole) $$,
  'a new table, sequence or function in public grants nothing to anon, authenticated or service_role'
);

-- 2 to 4. And so a table created now, the way a migration creates one, starts with no grant at all.
--    A probe inside this rolled back transaction; RLS on, like every table (rule 7).
CREATE TABLE public.zz_default_privileges_probe (id int);
ALTER TABLE public.zz_default_privileges_probe ENABLE ROW LEVEL SECURITY;
SELECT table_privs_are('public', 'zz_default_privileges_probe', 'anon', ARRAY[]::text[],
  'a new table grants anon nothing');
SELECT table_privs_are('public', 'zz_default_privileges_probe', 'authenticated', ARRAY[]::text[],
  'a new table grants authenticated nothing');
SELECT table_privs_are('public', 'zz_default_privileges_probe', 'service_role', ARRAY[]::text[],
  'a new table grants service_role nothing');
DROP TABLE public.zz_default_privileges_probe;

-- 5. anon holds no privilege on any table or view in public. A table that anon may read on purpose
--    is added here by name, with the position that opened it.
SELECT is_empty(
  $$ SELECT c.relname::text || ' ' || a.privilege_type
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p', 'v', 'm')
        AND a.grantee = 'anon'::regrole $$,
  'anon holds no privilege on any table or view in public'
);

-- 6. No API role may truncate, trigger, reference or maintain a public table: those skip RLS.
SELECT is_empty(
  $$ SELECT c.relname::text || ' ' || a.grantee::regrole::text || ' ' || a.privilege_type
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND a.grantee IN ('authenticated'::regrole, 'service_role'::regrole)
        AND a.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN') $$,
  'no API role may truncate, trigger, reference or maintain a public table'
);

SELECT * FROM finish();
ROLLBACK;
