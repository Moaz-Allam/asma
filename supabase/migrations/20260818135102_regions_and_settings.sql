-- 45 Multi-region foundation
--
-- D14: both markets run from ONE deployment, separated by a `region` column.
-- This migration creates the dimension itself. The region COLUMNS on domain
-- tables land in the migrations that create those tables (02, 03) — they do not
-- exist yet, and a CI check keeps them honest.
--
-- Order below is the mandatory one: table -> RLS -> policies -> constraints ->
-- indexes -> seed. Every step is here because its absence fails SILENTLY.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. regions — REFERENCE DATA. Seeded by migration, never written at runtime.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.regions (
  code            text primary key,
  currency        text        not null,
  default_locale  text        not null,
  psp_provider    text        not null,
  -- D16: a TR account uses +90, a KSA account +966. This is what makes
  -- "one account per region" workable under phone-based OTP, where one number
  -- maps to one identity.
  dial_code       text        not null,
  active          boolean     not null default true,
  created_at      timestamptz not null default now(),

  constraint regions_code_valid     check (code in ('TR', 'KSA')),
  constraint regions_currency_valid check (currency in ('TRY', 'SAR')),
  constraint regions_locale_valid   check (default_locale in ('ar', 'tr', 'en')),
  constraint regions_psp_valid      check (psp_provider in ('iyzico', 'paytabs')),
  constraint regions_dial_code_e164 check (dial_code ~ '^\+[1-9][0-9]{0,3}$')
);

alter table public.regions enable row level security;

-- Readable by anyone signed in: the app needs currency and dial code to render
-- a signup form. Writable by NOBODY — adding a market is a deploy, not a runtime
-- action, exactly like ledger_accounts. There is deliberately no INSERT/UPDATE/
-- DELETE policy, so RLS denies all three by default.
create policy regions_read_authenticated
  on public.regions for select
  to authenticated
  using (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. platform_settings — keyed (region, key).
--    G24: with `key` alone, changing TR's commission silently changed KSA's.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.platform_settings (
  region     text        not null references public.regions(code),
  key        text        not null,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,

  primary key (region, key)
);

alter table public.platform_settings enable row level security;

-- Read: any signed-in user (the app needs the unlock fee to render a panel).
create policy platform_settings_read_authenticated
  on public.platform_settings for select
  to authenticated
  using (true);

-- Write: admin only. D15 — admins are GLOBAL, so there is deliberately no
-- region predicate here. auth.jwt() is wrapped in a subselect so it evaluates
-- once per query rather than once per row (architecture.md §32).
create policy platform_settings_write_admin
  on public.platform_settings for all
  to authenticated
  using      ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Index every column a policy or a foreign key touches.
create index platform_settings_region_idx on public.platform_settings (region);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Seed. Idempotent: re-running a migration must not duplicate a region.
--    These values MUST match lib/region/index.ts REGION_CONFIG — a test asserts it.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.regions (code, currency, default_locale, psp_provider, dial_code) values
  ('TR',  'TRY', 'tr', 'iyzico',  '+90'),
  ('KSA', 'SAR', 'ar', 'paytabs', '+966')
on conflict (code) do nothing;

-- Seed defaults from progress-tracker.md §5 (D13). Per region, because they
-- differ per market and are admin-editable at runtime from here on.
insert into public.platform_settings (region, key, value) values
  ('TR',  'hold_hours',              '72'),
  ('TR',  'payment_window_hours',    '24'),
  ('TR',  'unlock_window_hours',     '24'),
  ('TR',  'max_applications',        '10'),
  ('TR',  'max_reselections',        '3'),
  ('TR',  'start_grace_hours',       '24'),
  ('TR',  'completion_grace_hours',  '24'),
  ('TR',  'max_price_multiple',      '20'),
  ('TR',  'applications_per_hour',   '20'),
  ('TR',  'late_cancel_cutoff_hours','24'),
  ('KSA', 'hold_hours',              '72'),
  ('KSA', 'payment_window_hours',    '24'),
  ('KSA', 'unlock_window_hours',     '24'),
  ('KSA', 'max_applications',        '10'),
  ('KSA', 'max_reselections',        '3'),
  ('KSA', 'start_grace_hours',       '24'),
  ('KSA', 'completion_grace_hours',  '24'),
  ('KSA', 'max_price_multiple',      '20'),
  ('KSA', 'applications_per_hour',   '20'),
  ('KSA', 'late_cancel_cutoff_hours','24')
on conflict (region, key) do nothing;
