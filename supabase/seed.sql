-- Local seed, run by `supabase db reset` (and so by `npm run test:e2e`), never pushed to the cloud.
--
-- Position 08 (spec 0011-08 AC-18, D172): payments are seeded off in both regions by the `relay`
-- migration, and only the owner turns them on in the cloud (S37). The local stack turns TR on, so the
-- end to end suite can open fake card pages.
update public.platform_settings set value = 'true' where region = 'TR' and key = 'payments_enabled';

-- The fake payment fence (security review 2026-11-17, L1): a fake payment books nothing unless this Vault
-- secret is `true`. Local only; in the cloud the owner sets it for a deliberate fake check and deletes it after.
select vault.create_secret('true', 'fake_psp_allowed');
