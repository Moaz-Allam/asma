-- Meta guards over Storage (spec 0006 AC-26, D116): no bucket may ever be public, every policy on
-- storage.objects names its buckets, and none is granted to anon or PUBLIC.
--
-- A bucket made public in the dashboard serves every object to anyone with the URL, past every policy.
-- A policy with no bucket in it applies to every bucket, so a later bucket inherits rules written for
-- another. A policy to anon or PUBLIC opens objects to signed out callers. None of these raises an
-- error. The same three queries run against the cloud before the real calls (verify.md), because a
-- policy made in the dashboard would widen ours there and never show here.
--
-- Run: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(7);

-- 1. No bucket is public.
SELECT is_empty(
  $$ SELECT id FROM storage.buckets WHERE public $$,
  'no Storage bucket is public'
);

-- 2. Every USING and WITH CHECK expression on storage.objects opens with its bucket list, joined to the
--    rest by AND. Mentioning bucket_id is not enough: `bucket_id = 'x' OR true` mentions it and opens
--    every bucket. Postgres prints a top level OR in an extra pair of brackets, so the pattern refuses it.
SELECT is_empty(
  $$ SELECT p.polname::text
       FROM pg_policy p
       CROSS JOIN LATERAL (VALUES (pg_get_expr(p.polqual, p.polrelid)),
                                  (pg_get_expr(p.polwithcheck, p.polrelid))) AS e(expr)
      WHERE p.polrelid = 'storage.objects'::regclass
        AND e.expr IS NOT NULL
        AND e.expr !~ '^\(\(bucket_id = ANY \(ARRAY\[[^]]+\]\)\) AND .+\)$'
        AND e.expr !~ '^\(bucket_id = ANY \(ARRAY\[[^]]+\]\)\)$' $$,
  'every policy on storage.objects opens with its bucket list, joined by AND'
);

-- 3. No policy on storage.objects or storage.buckets is granted to anon or PUBLIC (role oid 0).
SELECT is_empty(
  $$ SELECT c.relname || '.' || p.polname
       FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
      WHERE p.polrelid IN ('storage.objects'::regclass, 'storage.buckets'::regclass)
        AND (0::oid = ANY (p.polroles) OR (SELECT oid FROM pg_roles WHERE rolname = 'anon') = ANY (p.polroles)) $$,
  'no Storage policy is granted to anon or PUBLIC'
);

-- 4. The two buckets of position 02 exist, private, with their limits and types.
SELECT results_eq(
  $$ SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets
      WHERE id IN ('provider-documents', 'provider-photos') ORDER BY id $$,
  $$ VALUES ('provider-documents', false, 10485760::bigint, ARRAY['image/jpeg', 'image/png', 'application/pdf']),
            ('provider-photos', false, 2097152::bigint, ARRAY['image/jpeg']) $$,
  'provider-documents and provider-photos are private, 10 MB and 2 MB, with their types'
);

-- 5. Their policies are exactly insert, read own, read admin and delete orphan: no update policy, so an
--    overwrite or a move fails.
SELECT results_eq(
  $$ SELECT polname::text COLLATE "default", polcmd::text FROM pg_policy
      WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'provider_files%' ORDER BY polname $$,
  $$ VALUES ('provider_files_delete_orphan', 'd'), ('provider_files_insert', 'a'),
            ('provider_files_read_admin', 'r'), ('provider_files_read_own', 'r') $$,
  'the provider file policies are insert, two reads and an orphan delete'
);

-- 7. The triggers that guard the provider buckets, taken together, fire on INSERT and on UPDATE. A signed
--    upload URL writes as service_role past RLS, and with upsert on it becomes `insert ... on conflict do
--    update`, which fires only the update side: a guard on insert alone let approved bytes change under
--    the same object id (security review of PR #26, 2026-11-13).
SELECT results_eq(
  $$ SELECT DISTINCT event_manipulation::text COLLATE "default" FROM information_schema.triggers
      WHERE event_object_schema = 'storage' AND event_object_table = 'objects'
        AND action_statement LIKE '%provider_files_guard%' ORDER BY 1 $$,
  $$ VALUES ('INSERT'), ('UPDATE') $$,
  'the provider bucket guards fire on insert and on update'
);

-- 6. A probe: a bucket made public by mistake would be caught by guard 1.
UPDATE storage.buckets SET public = true WHERE id = 'provider-photos';
SELECT isnt_empty($$ SELECT id FROM storage.buckets WHERE public $$, 'guard 1 sees a bucket made public');

SELECT * FROM finish();
ROLLBACK;
