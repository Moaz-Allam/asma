-- The standing negative test for Rule 7.
--
-- A table created without RLS raises NO error. It simply returns every row to
-- every authenticated user, and it is the single most common Supabase security
-- incident. This test exists BEFORE the first table so that the moment feature 03
-- creates one without a policy, CI goes red — rather than the leak being noticed
-- by someone reading a diff months later.
--
-- Partitioned parents count too (relkind 'p': architecture §39 partitions the ledger, the outbox
-- and notifications), and a view must run with its caller's rights (security_invoker), or it reads
-- past every policy on the tables under it (review 2026-10-29, D86).
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(3);

-- 1. Every table in `public`, partitioned parents included, has row level security enabled.
SELECT is_empty(
  $$ SELECT c.relname::text
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT c.relrowsecurity $$,
  'every table in public has RLS ENABLED (Rule 7)'
);

-- 2. RLS enabled with no policy denies everything, which is safe but is almost
--    always an oversight rather than intent. Catch it here, deliberately.
SELECT is_empty(
  $$ SELECT c.relname::text
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) $$,
  'every RLS-enabled table has at least one policy'
);

-- 3. Every view in `public` runs with the caller's rights, so the policies under it still apply.
SELECT is_empty(
  $$ SELECT c.relname::text
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'v'
        AND NOT coalesce('security_invoker=true' = ANY (c.reloptions), false) $$,
  'every view in public is security_invoker (Rule 7)'
);

SELECT * FROM finish();
ROLLBACK;
