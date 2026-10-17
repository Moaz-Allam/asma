-- Meta tests over every function we own: a new function cannot slip past review with default access.
--
-- Postgres grants EXECUTE to PUBLIC on every new function by default, and Supabase's default
-- privileges grant it to anon and authenticated as well. A SECURITY DEFINER function runs with its
-- owner's rights, so one exposed by accident bypasses RLS entirely (rule 7). The reference build hit
-- this even after a per schema revoke, so the fix is mechanical: revoke explicitly per function, and
-- keep this test failing on any missed revoke (docs/engineering-approach.md §12, §23).
--
-- Allow lists: a function that PUBLIC or anon may call ON PURPOSE is named below with the position
-- that added it. Today both lists are empty.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(3);

CREATE TEMP TABLE allowed_public (signature text PRIMARY KEY);
CREATE TEMP TABLE allowed_anon (signature text PRIMARY KEY);
-- INSERT INTO allowed_anon VALUES ('public.example(uuid)');  -- position NN, spec NNNN: why

-- Functions in the exposed schema that we wrote (members of an extension are not ours).
CREATE TEMP VIEW our_functions AS
  SELECT p.oid,
         p.oid::regprocedure::text AS signature,
         p.prosecdef,
         p.proconfig,
         p.proacl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');

-- 1. A NULL acl means the default grant: PUBLIC may execute. Grantee 0 is PUBLIC.
SELECT is_empty(
  $$ SELECT f.signature
       FROM our_functions f
      WHERE (f.proacl IS NULL
             OR EXISTS (SELECT 1 FROM aclexplode(f.proacl) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
        AND f.signature NOT IN (SELECT signature FROM allowed_public) $$,
  'no function in public is executable by PUBLIC (revoke it explicitly)'
);

-- 2. anon reaches functions through the API without signing in.
SELECT is_empty(
  $$ SELECT f.signature
       FROM our_functions f
      WHERE has_function_privilege('anon', f.oid, 'EXECUTE')
        AND f.signature NOT IN (SELECT signature FROM allowed_anon) $$,
  'no function in public is executable by anon unless allow listed'
);

-- 3. A definer function without a pinned search_path can be hijacked by an object a caller creates.
SELECT is_empty(
  $$ SELECT f.signature
       FROM our_functions f
      WHERE f.prosecdef
        AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(f.proconfig, '{}'::text[])) c
                         WHERE c LIKE 'search_path=%') $$,
  'every SECURITY DEFINER function pins its search_path'
);

SELECT * FROM finish();
ROLLBACK;
