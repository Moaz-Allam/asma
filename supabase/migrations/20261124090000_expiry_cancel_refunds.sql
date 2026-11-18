-- Position 12 (spec 0011-12, amended by D181 with rules R-1 to R-15): expiry, cancellation, fee refunds.
--
-- Every way a request stops early. A payment window that passes reopens the request (§36 rows 4 and 6); a paid
-- commission carries to the next pick (D90), which then needs no payment step; after max_reselections failed picks,
-- or when the start passes with nobody paid, the commission is refunded (row 7 and its start edge). Who may cancel,
-- and what each cancel refunds, is the table cancellation_rules (§36 rows 1 to 12): the functions read their
-- outcomes from it. Refunds are always queued to the relay (08) through queue_fee_refund; a refund the PSP refuses
-- for good is finished by hand by admin (R-10). Suspending a provider drops their unpaid picks (AC-10). Deadline flags
-- name a job that did not start or finish (AC-11). Each move writes one audit_log row, ids only; an admin's free
-- text goes only into its audit row (R-11).
--
-- A pick that ends clears the request's four selection columns (R-2) and leaves its application EXPIRED or
-- WITHDRAWN; the applications keep the history. The other applicants, NOT_SELECTED at the choose (D162, spec 0010),
-- are restored to APPLIED on a reopen (project-overview §8 "applicants restored", D162 "restored by 12 on a
-- reopen"); a suspended provider's are not.
--
-- Lock order (D169): the requests row first, always; under it the provider row (shared), then the fees, then the
-- applications. suspend_provider locks its requests in ascending id order before the provider row (R-8). The cron
-- jobs take requests with skip locked and run each in its own subtransaction.
--
-- Every function revokes PUBLIC and pins search_path (supabase/tests/02). Refusals are stable codes in the
-- exception message; the doors map them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Settings (AC-1). max_reselections (1 to 10) and the two grace settings (1 to 168 hours), seeded by 00, get
--    row checks and join the guard's required keys. A missing or malformed value makes its reader refuse.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_max_reselections_valid check (
    case when key <> 'max_reselections' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 10 end),
  add constraint platform_settings_start_grace_hours_valid check (
    case when key <> 'start_grace_hours' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 168 end),
  add constraint platform_settings_completion_grace_hours_valid check (
    case when key <> 'completion_grace_hours' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 168 end);

create or replace function public.pricing_settings_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if old.key in ('price_rounding_minor', 'max_price_multiple', 'provider_fee_kind', 'provider_fee_value', 'fee_min_minor',
                 'checkout_hold_minutes', 'psp_buyer_city', 'min_window_minutes', 'checkouts_per_fee_hour',
                 'unlock_window_hours', 'contact_visible_days', 'confirm_window_hours', 'auto_close_enabled',
                 'max_reselections', 'start_grace_hours', 'completion_grace_hours')
     and (tg_op = 'DELETE' or new.key is distinct from old.key or new.region is distinct from old.region) then
    raise exception 'pricing_setting_required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.pricing_settings_guard() from public, anon, authenticated, service_role;

-- The failed pick limit of a region.
create function public.reselection_limit(p_region text)
  returns integer
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_value  jsonb;
begin
  select s.value into v_value from public.platform_settings s where s.region = p_region and s.key = 'max_reselections';
  if jsonb_typeof(v_value) is distinct from 'number'
     or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
     or (v_value #>> '{}')::numeric not between 1 and 10 then
    raise exception 'expiry_settings_invalid';
  end if;
  return (v_value #>> '{}')::integer;
end;
$$;

revoke all on function public.reselection_limit(text) from public, anon, authenticated, service_role;

-- A grace setting of a region in hours, or null when missing or malformed (the flag run skips that region and
-- warns; it never guesses).
create function public.grace_hours(p_region text, p_key text)
  returns integer
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select case when p_key in ('start_grace_hours', 'completion_grace_hours')
               and jsonb_typeof(s.value) = 'number'
               and (s.value #>> '{}')::numeric = trunc((s.value #>> '{}')::numeric)
               and (s.value #>> '{}')::numeric between 1 and 168
              then (s.value #>> '{}')::integer end
    from (select 1) one
    left join public.platform_settings s on s.region = p_region and s.key = p_key
$$;

revoke all on function public.grace_hours(text, text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Columns and checks (AC-1, R-3, R-5, R-13).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.requests
  add column failed_picks integer not null default 0,
  add constraint requests_failed_picks_range check (failed_picks >= 0);

-- R-5: closed_by widened; every CANCELLED row gets its close from its cancel before the checks are added.
alter table public.requests
  drop constraint requests_closed_by_valid,
  add constraint requests_closed_by_valid check (
    closed_by is null or closed_by in ('customer', 'provider', 'platform', 'admin', 'auto'));

alter table public.requests disable trigger requests_guard;
update public.requests
   set closed_at = cancelled_at, closed_by = cancelled_by
 where status = 'CANCELLED' and closed_at is null and closed_by is null;
alter table public.requests enable trigger requests_guard;

-- R15 G-1 (the CANCELLED half) and R-13: a cancel is closed, by whoever cancelled.
alter table public.requests
  add constraint requests_cancelled_closed check (status <> 'CANCELLED' or (closed_at is not null and closed_by is not null)),
  add constraint requests_closed_by_cancelled check (status <> 'CANCELLED' or closed_by = cancelled_by);

-- R-3: a carried re-pick has no payment window. The pick's id and time stay null together; a window needs a pick;
-- SELECTED always has one. R-2: an OPEN request carries no pick and no fee window.
alter table public.requests
  drop constraint requests_selection_together,
  add constraint requests_selection_together check (
    (selected_application_id is null) = (selected_at is null)
    and (payment_deadline is null or selected_at is not null)),
  add constraint requests_selected_window check (status <> 'SELECTED' or payment_deadline is not null),
  add constraint requests_open_no_pick check (status <> 'OPEN' or (selected_application_id is null and fee_deadline is null));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The cancellation matrix (AC-1, §36), as data. One row per (region, state, actor); the functions read the
--    outcomes and never branch on their own. A missing row is "not allowed". Signed in users read it (the dialog
--    states the outcome); no API role writes it. Rows:
--      1 OPEN customer · 2 SELECTED customer · 3 SELECTED provider (withdraw) · 4 SELECTED platform (window
--      expires) · 5 COMMISSION_PAID customer · 6 COMMISSION_PAID provider (fee window expires, or withdraws) ·
--      7 COMMISSION_PAID platform (failed pick limit, or the start with nobody paid) · 8 UNLOCKED/IN_PROGRESS
--      customer · 9 UNLOCKED/IN_PROGRESS provider · 10 UNLOCKED/IN_PROGRESS platform (a no-show is a flag, not a
--      cancel) · 11 admin in any paid state (by hand) · 12 AWAITING_CONFIRMATION onward: not cancellable.
--    An OPEN request with a carried commission reads the COMMISSION_PAID rows (AC-6).
-- ═══════════════════════════════════════════════════════════════════════════

create table public.cancellation_rules (
  region                text    not null references public.regions (code) on delete restrict,
  state                 text    not null,
  actor                 text    not null,
  allowed               boolean not null,
  commission_outcome    text    not null,
  provider_fee_outcome  text    not null,
  counts_against        text    not null,

  constraint cancellation_rules_pkey primary key (region, state, actor),
  constraint cancellation_rules_state_valid check (state in ('OPEN', 'SELECTED', 'COMMISSION_PAID', 'UNLOCKED', 'IN_PROGRESS',
                                                             'AWAITING_CONFIRMATION', 'COMPLETED')),
  constraint cancellation_rules_actor_valid check (actor in ('customer', 'provider', 'platform', 'admin')),
  constraint cancellation_rules_commission_valid check (commission_outcome in ('not_paid', 'refund', 'carry', 'none', 'by_hand')),
  constraint cancellation_rules_provider_fee_valid check (provider_fee_outcome in ('not_paid', 'none', 'by_hand')),
  constraint cancellation_rules_counts_valid check (counts_against in (
    'nobody', 'provider_cancellation', 'provider_fee_follow_through', 'customer_late_cancel', 'provider_no_show',
    'admin_attribution')),
  -- Rule 1 of §36: after the reveal nothing comes back by itself.
  constraint cancellation_rules_no_refund_after_reveal check (
    state not in ('UNLOCKED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED') or commission_outcome <> 'refund'),
  -- Row 12: a report, not a cancellation.
  constraint cancellation_rules_not_after_done check (state not in ('AWAITING_CONFIRMATION', 'COMPLETED') or not allowed)
);

alter table public.cancellation_rules enable row level security;
create policy cancellation_rules_read on public.cancellation_rules for select to authenticated using (true);
revoke all on table public.cancellation_rules from anon, authenticated, service_role;
grant select on table public.cancellation_rules to authenticated;

insert into public.cancellation_rules (region, state, actor, allowed, commission_outcome, provider_fee_outcome, counts_against)
select g.code, t.state, t.actor, t.allowed, t.commission_outcome, t.provider_fee_outcome, t.counts_against
  from public.regions g
 cross join (values
   ('OPEN',                  'customer', true,  'not_paid', 'not_paid', 'nobody'),                       -- 1
   ('SELECTED',              'customer', true,  'not_paid', 'not_paid', 'nobody'),                       -- 2
   ('SELECTED',              'provider', true,  'not_paid', 'not_paid', 'provider_cancellation'),        -- 3
   ('SELECTED',              'platform', true,  'not_paid', 'not_paid', 'nobody'),                       -- 4
   ('COMMISSION_PAID',       'customer', true,  'refund',   'not_paid', 'nobody'),                       -- 5
   ('COMMISSION_PAID',       'provider', true,  'carry',    'not_paid', 'provider_fee_follow_through'),  -- 6
   ('COMMISSION_PAID',       'platform', true,  'refund',   'not_paid', 'nobody'),                       -- 7
   ('UNLOCKED',              'customer', true,  'none',     'none',     'customer_late_cancel'),         -- 8
   ('IN_PROGRESS',           'customer', true,  'none',     'none',     'customer_late_cancel'),         -- 8
   ('UNLOCKED',              'provider', true,  'none',     'none',     'provider_cancellation'),        -- 9
   ('IN_PROGRESS',           'provider', true,  'none',     'none',     'provider_cancellation'),        -- 9
   ('UNLOCKED',              'platform', false, 'none',     'none',     'provider_no_show'),             -- 10
   ('IN_PROGRESS',           'platform', false, 'none',     'none',     'provider_no_show'),             -- 10
   ('COMMISSION_PAID',       'admin',    true,  'by_hand',  'by_hand',  'admin_attribution'),            -- 11
   ('UNLOCKED',              'admin',    true,  'by_hand',  'by_hand',  'admin_attribution'),            -- 11
   ('IN_PROGRESS',           'admin',    true,  'by_hand',  'by_hand',  'admin_attribution'),            -- 11
   ('AWAITING_CONFIRMATION', 'admin',    false, 'by_hand',  'by_hand',  'admin_attribution'),            -- 11, 12
   ('COMPLETED',             'admin',    false, 'by_hand',  'by_hand',  'admin_attribution'),            -- 11, 12
   ('AWAITING_CONFIRMATION', 'customer', false, 'none',     'none',     'nobody'),                       -- 12
   ('AWAITING_CONFIRMATION', 'provider', false, 'none',     'none',     'nobody'),                       -- 12
   ('AWAITING_CONFIRMATION', 'platform', false, 'none',     'none',     'nobody'),                       -- 12
   ('COMPLETED',             'customer', false, 'none',     'none',     'nobody'),                       -- 12
   ('COMPLETED',             'provider', false, 'none',     'none',     'nobody'),                       -- 12
   ('COMPLETED',             'platform', false, 'none',     'none',     'nobody')                        -- 12
 ) as t(state, actor, allowed, commission_outcome, provider_fee_outcome, counts_against)
 where g.code in ('TR', 'KSA');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Deadline flags (AC-1, AC-11). At most one open flag per (request, kind); a cleared flag can be raised again.
--    Admin reads; no API role writes. A flag is cleared once and never changed after.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.deadline_flags (
  id          uuid primary key default gen_random_uuid(),
  region      text        not null references public.regions (code) on delete restrict,
  request_id  uuid        not null,
  kind        text        not null,
  raised_at   timestamptz not null default now(),
  cleared_at  timestamptz,
  cleared_by  uuid        references public.profiles (id) on delete restrict,
  note        text,

  constraint deadline_flags_request_fk foreign key (request_id, region)
    references public.requests (id, region) on delete restrict,
  constraint deadline_flags_kind_valid check (kind in ('start_late', 'completion_late')),
  constraint deadline_flags_cleared_order check (cleared_at is null or cleared_at >= raised_at),
  constraint deadline_flags_cleared_by_set check (cleared_by is null or cleared_at is not null),
  constraint deadline_flags_note_length check (note is null or char_length(note) between 1 and 500)
);

alter table public.deadline_flags enable row level security;
create policy deadline_flags_read_admin on public.deadline_flags for select to authenticated using ((select public.is_admin()));
revoke all on table public.deadline_flags from anon, authenticated, service_role;
grant select on table public.deadline_flags to authenticated;

create unique index deadline_flags_one_open_idx on public.deadline_flags (request_id, kind) where cleared_at is null;
create index deadline_flags_request_idx on public.deadline_flags (request_id, region);
create index deadline_flags_region_idx on public.deadline_flags (region);
create index deadline_flags_cleared_by_idx on public.deadline_flags (cleared_by);

create function public.deadline_flags_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'flag_immutable';
  end if;
  if (to_jsonb(new) - array['cleared_at', 'cleared_by', 'note']) is distinct from (to_jsonb(old) - array['cleared_at', 'cleared_by', 'note'])
     or old.cleared_at is not null or new.cleared_at is null then
    raise exception 'flag_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.deadline_flags_guard() from public, anon, authenticated, service_role;

create trigger deadline_flags_guard before update or delete on public.deadline_flags
  for each row execute function public.deadline_flags_guard();
create trigger deadline_flags_no_truncate before truncate on public.deadline_flags
  for each statement execute function public.deadline_flags_guard();

-- AC-11: a flag clears by itself (no actor, note `auto`) on start, done, close or cancel. Null kinds clear both.
create function public.clear_deadline_flags(p_request_id uuid, p_kinds text[])
  returns void
  language sql
  volatile
  security invoker
  set search_path = ''
as $$
  update public.deadline_flags
     set cleared_at = now(), note = 'auto'
   where request_id = p_request_id and cleared_at is null and (p_kinds is null or kind = any (p_kinds))
$$;

revoke all on function public.clear_deadline_flags(uuid, text[]) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Readers (internal, no API grant).
-- ═══════════════════════════════════════════════════════════════════════════

-- The commission that carries (D90): its fee paid and never refunded. Null when there is none (a commission of 0
-- has no fee row, so it never carries).
create function public.carried_commission(p_request_id uuid)
  returns uuid
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select f.id from public.fee_payments f
   where f.request_id = p_request_id and f.kind = 'commission' and f.status = 'paid'
     and not exists (select 1 from public.fee_refunds x where x.fee_payment_id = f.id)
$$;

revoke all on function public.carried_commission(uuid) from public, anon, authenticated, service_role;

-- The state the matrix is read in: an OPEN request with a carried commission reads the COMMISSION_PAID rows (AC-6).
create function public.cancel_state(p_request_id uuid)
  returns text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select case when r.status = 'OPEN' and public.carried_commission(r.id) is not null then 'COMMISSION_PAID' else r.status end
    from public.requests r where r.id = p_request_id
$$;

revoke all on function public.cancel_state(uuid) from public, anon, authenticated, service_role;

create function public.cancel_rule(p_region text, p_state text, p_actor text)
  returns public.cancellation_rules
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select c.* from public.cancellation_rules c where c.region = p_region and c.state = p_state and c.actor = p_actor
$$;

revoke all on function public.cancel_rule(text, text, text) from public, anon, authenticated, service_role;

-- A card page in use on a fee: an attempt queued or ready, younger than the checkout hold. With the hold setting
-- missing every open attempt counts as young (09's rule), so nothing is cut off on a bad setting.
create function public.attempt_open(p_fee_payment_id uuid, p_region text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select p_fee_payment_id is not null
         and exists (select 1 from public.checkout_attempts a
                      where a.fee_payment_id = p_fee_payment_id
                        and a.status in ('queued', 'ready')
                        and (h.hold is null or a.started_at > now() - make_interval(mins => h.hold)))
    from (select (public.checkout_settings(p_region) ->> 'hold_minutes')::integer as hold) h
$$;

revoke all on function public.attempt_open(uuid, text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The guards (R-1, R-2, R-3, R-6), replaced whole. Every earlier rule of 06 to 11 stays.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.requests_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                            'selected_application_id', 'selected_at', 'payment_deadline', 'fee_deadline', 'closed_at',
                            'actual_started_at', 'actual_completed_at', 'confirm_deadline', 'closed_by', 'failed_picks'])
     is distinct from (to_jsonb(old) - array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                                             'selected_application_id', 'selected_at', 'payment_deadline',
                                             'fee_deadline', 'closed_at', 'actual_started_at', 'actual_completed_at',
                                             'confirm_deadline', 'closed_by', 'failed_picks']) then
    raise exception 'request_immutable';
  end if;
  -- R-1: the moves of 04 to 11, plus the reopens, the carried re-pick and the cancels of 12.
  if new.status is distinct from old.status
     and not ((old.status = 'OPEN' and new.status in ('CANCELLED', 'SELECTED', 'COMMISSION_PAID'))
              or (old.status = 'SELECTED' and new.status in ('CANCELLED', 'COMMISSION_PAID', 'OPEN'))
              or (old.status = 'COMMISSION_PAID' and new.status in ('UNLOCKED', 'OPEN', 'CANCELLED'))
              or (old.status = 'UNLOCKED' and new.status in ('IN_PROGRESS', 'COMPLETED', 'CANCELLED'))
              or (old.status = 'IN_PROGRESS' and new.status in ('AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED'))
              or (old.status = 'AWAITING_CONFIRMATION' and new.status = 'COMPLETED')) then
    raise exception 'request_transition_invalid';
  end if;
  -- R-2: a reopen clears the pick whole, in the same update.
  if new.status = 'OPEN' and old.status in ('SELECTED', 'COMMISSION_PAID')
     and not (new.selected_application_id is null and new.selected_at is null and new.payment_deadline is null
              and new.fee_deadline is null) then
    raise exception 'request_transition_invalid';
  end if;
  -- R-3: the carried re-pick: a pick and a fee window, no payment window, and a commission paid and not refunded.
  if old.status = 'OPEN' and new.status = 'COMMISSION_PAID'
     and (new.selected_application_id is null or new.payment_deadline is not null or new.fee_deadline is null
          or public.carried_commission(new.id) is null) then
    raise exception 'request_transition_invalid';
  end if;
  -- The pick changes only on a choose (06), a carried re-pick (R-3) or a reopen (R-2).
  if (new.selected_application_id, new.selected_at, new.payment_deadline)
     is distinct from (old.selected_application_id, old.selected_at, old.payment_deadline)
     and not ((old.status = 'OPEN' and new.status in ('SELECTED', 'COMMISSION_PAID'))
              or (old.status in ('SELECTED', 'COMMISSION_PAID') and new.status = 'OPEN')) then
    raise exception 'request_immutable';
  end if;
  -- fee_deadline: written on SELECTED -> COMMISSION_PAID (09) and on the carried re-pick, cleared on a reopen.
  if new.fee_deadline is distinct from old.fee_deadline
     and not ((old.status in ('SELECTED', 'OPEN') and new.status = 'COMMISSION_PAID')
              or (old.status = 'COMMISSION_PAID' and new.status = 'OPEN')) then
    raise exception 'request_immutable';
  end if;
  if old.status = 'SELECTED' and new.status = 'COMMISSION_PAID' and new.fee_deadline is null then
    raise exception 'request_immutable';
  end if;
  -- failed_picks only grows, by one, and only on COMMISSION_PAID -> OPEN.
  if new.failed_picks is distinct from old.failed_picks
     and not (old.status = 'COMMISSION_PAID' and new.status = 'OPEN' and new.failed_picks = old.failed_picks + 1) then
    raise exception 'request_immutable';
  end if;
  if (new.closed_at, new.closed_by) is distinct from (old.closed_at, old.closed_by)
     and not (old.closed_at is null and old.closed_by is null
              and new.closed_at is not null and new.closed_by is not null
              and new.status is distinct from old.status and new.status in ('COMPLETED', 'CANCELLED')) then
    raise exception 'request_immutable';
  end if;
  if new.actual_started_at is distinct from old.actual_started_at
     and not (old.actual_started_at is null and new.actual_started_at is not null
              and old.status = 'UNLOCKED' and new.status = 'IN_PROGRESS') then
    raise exception 'request_immutable';
  end if;
  if new.actual_completed_at is distinct from old.actual_completed_at
     and not (old.actual_completed_at is null and new.actual_completed_at is not null
              and ((old.status = 'IN_PROGRESS' and new.status = 'AWAITING_CONFIRMATION')
                   or (old.status in ('UNLOCKED', 'IN_PROGRESS') and new.status = 'COMPLETED'))) then
    raise exception 'request_immutable';
  end if;
  if new.confirm_deadline is distinct from old.confirm_deadline
     and not (old.confirm_deadline is null and new.confirm_deadline is not null
              and old.status = 'IN_PROGRESS' and new.status = 'AWAITING_CONFIRMATION') then
    raise exception 'request_immutable';
  end if;
  if new.status = 'UNLOCKED' and old.status is distinct from 'UNLOCKED'
     and not exists (select 1 from public.applications a
                      where a.id = new.selected_application_id and a.unlocked_at is not null) then
    raise exception 'request_unlock_invalid';
  end if;
  return new;
end;
$$;

revoke all on function public.requests_guard() from public, anon, authenticated, service_role;

create or replace function public.applications_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'application_immutable';
  end if;
  if new.id is distinct from old.id
     or new.region is distinct from old.region
     or new.request_id is distinct from old.request_id
     or new.provider_id is distinct from old.provider_id
     or new.message is distinct from old.message
     or new.created_at is distinct from old.created_at then
    raise exception 'application_immutable';
  end if;
  if (new.provider_fee_amount, new.provider_fee_kind) is distinct from (old.provider_fee_amount, old.provider_fee_kind)
     and not (old.status = 'APPLIED' and new.status = 'SELECTED'
              and old.provider_fee_amount is null and old.provider_fee_kind is null) then
    raise exception 'application_immutable';
  end if;
  if new.unlocked_at is distinct from old.unlocked_at
     and not (old.unlocked_at is null and new.unlocked_at is not null
              and old.status = 'AWAITING_FEE' and new.status = 'UNLOCKED') then
    raise exception 'application_immutable';
  end if;
  if new.status = 'UNLOCKED' and new.unlocked_at is null then
    raise exception 'application_immutable';
  end if;
  -- Final, except a NOT_SELECTED applicant restored to APPLIED by a reopen of its request (D162).
  if new.status is distinct from old.status
     and old.status in ('NOT_SELECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED', 'CONFIRMED', 'RATED')
     and not (old.status = 'NOT_SELECTED' and new.status = 'APPLIED'
              and exists (select 1 from public.requests r where r.id = new.request_id and r.status = 'OPEN')) then
    raise exception 'application_final';
  end if;
  -- R-6: the endings, each only from the states that may end that way; APPLIED only by the restore.
  if new.status is distinct from old.status
     and ((new.status = 'WITHDRAWN' and old.status not in ('APPLIED', 'SELECTED', 'AWAITING_FEE'))
          or (new.status = 'EXPIRED' and old.status not in ('SELECTED', 'AWAITING_FEE'))
          or (new.status = 'CANCELLED' and old.status not in ('APPLIED', 'SELECTED', 'AWAITING_FEE', 'UNLOCKED', 'STARTED'))
          or (new.status = 'APPLIED' and old.status <> 'NOT_SELECTED')) then
    raise exception 'application_transition_invalid';
  end if;
  -- 11's work moves (R-4 of 11), plus the cancels of an unlocked or started job (12).
  if new.status is distinct from old.status
     and (old.status in ('UNLOCKED', 'STARTED', 'COMPLETED') or new.status in ('STARTED', 'COMPLETED', 'CONFIRMED'))
     and not ((old.status = 'UNLOCKED' and new.status in ('STARTED', 'CONFIRMED', 'CANCELLED'))
              or (old.status = 'STARTED' and new.status in ('COMPLETED', 'CONFIRMED', 'CANCELLED'))
              or (old.status = 'COMPLETED' and new.status = 'CONFIRMED')) then
    raise exception 'application_transition_invalid';
  end if;
  return new;
end;
$$;

revoke all on function public.applications_guard() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Refunds (AC-7, R-11). The one way a fee refund is made: its row and its outbox row in one transaction, for a
--    paid fee, the fee's own figures. A second call returns the first refund. Internal, no API grant.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.queue_fee_refund(p_fee_id uuid, p_reason text, p_by uuid)
  returns uuid
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_request  uuid;
  v_fee      public.fee_payments%rowtype;
  v_id       uuid;
begin
  if p_reason is null or p_reason not in ('customer_cancel', 'no_paid_pick', 'failed_picks', 'admin_refund') then
    raise exception 'validation_failed';
  end if;
  select f.request_id into v_request from public.fee_payments f where f.id = p_fee_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform 1 from public.requests r where r.id = v_request for update;
  select f.* into v_fee from public.fee_payments f where f.id = p_fee_id for update;
  select x.id into v_id from public.fee_refunds x where x.fee_payment_id = v_fee.id;
  if found then
    return v_id;
  end if;
  if v_fee.status <> 'paid' or v_fee.amount < 1 or v_fee.psp_payment_id is null then
    raise exception 'invalid_state';
  end if;
  insert into public.fee_refunds (region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency, reason, requested_by)
  values (v_fee.region, v_fee.request_id, 'fee', v_fee.id, v_fee.psp_payment_id, v_fee.amount, v_fee.currency, p_reason, p_by)
  returning id into v_id;
  perform public.enqueue_outbox('refund.request', 'refund:' || v_id,
                                jsonb_build_object('fee_refund_id', v_id, 'psp_payment_id', v_fee.psp_payment_id,
                                                   'amount', v_fee.amount, 'currency', v_fee.currency),
                                v_fee.region);
  perform public.relay_kick('drain');
  return v_id;
end;
$$;

revoke all on function public.queue_fee_refund(uuid, text, uuid) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The moves a pick ends with (R-2, AC-3, AC-6). Internal; the caller holds the request lock.
-- ═══════════════════════════════════════════════════════════════════════════

-- The cancel itself, from the matrix: allowed and the outcomes for (region, state, actor). The request CANCELLED and
-- closed by the actor (R-13), the live applications CANCELLED, the flags cleared, and the commission refund queued only
-- where the rule says refund.
create function public.cancel_by_rule(p_request_id uuid, p_actor text, p_cancel_reason text, p_refund_reason text,
                                      p_action text, p_by uuid)
  returns jsonb
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_req     public.requests%rowtype;
  v_state   text;
  v_rule    public.cancellation_rules%rowtype;
  v_fee     public.fee_payments%rowtype;
  v_refund  uuid;
begin
  select r.* into v_req from public.requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  v_state := public.cancel_state(v_req.id);
  v_rule := public.cancel_rule(v_req.region, v_state, p_actor);
  if v_rule.region is null or not v_rule.allowed then
    raise exception 'not_cancellable';
  end if;
  select f.* into v_fee from public.fee_payments f where f.id = public.carried_commission(v_req.id) for update;

  update public.requests
     set status = 'CANCELLED', cancelled_at = now(), cancelled_by = p_actor, cancel_reason = p_cancel_reason,
         closed_at = now(), closed_by = p_actor
   where id = v_req.id;
  update public.applications a
     set status = 'CANCELLED', status_changed_at = now()
   where a.request_id = v_req.id and a.status in ('APPLIED', 'SELECTED', 'AWAITING_FEE', 'UNLOCKED', 'STARTED');
  perform public.clear_deadline_flags(v_req.id, null);

  if v_rule.commission_outcome = 'refund' and v_fee.id is not null then
    v_refund := public.queue_fee_refund(v_fee.id, p_refund_reason, p_by);
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (p_by, p_action, 'requests', v_req.id::text, v_req.region,
          jsonb_build_object('status', v_req.status),
          jsonb_build_object('status', 'CANCELLED', 'cancelled_by', p_actor, 'rule_state', v_state,
                             'commission_outcome', v_rule.commission_outcome,
                             'provider_fee_outcome', v_rule.provider_fee_outcome,
                             'counts_against', v_rule.counts_against, 'fee_refund_id', v_refund,
                             'fixed_price', v_req.fixed_price));

  return jsonb_build_object('status', 'ok')
         || case when v_refund is null then '{}'::jsonb
                 else jsonb_build_object('refund', jsonb_build_object('fee_refund_id', v_refund, 'amount', v_fee.amount,
                                                                      'currency', v_fee.currency)) end;
end;
$$;

revoke all on function public.cancel_by_rule(uuid, text, text, text, text, uuid) from public, anon, authenticated, service_role;

-- R-2: the pick ends. Its application EXPIRED or WITHDRAWN, the request OPEN with its four selection columns cleared in
-- one update, failed_picks + 1 for a failed pick (only from COMMISSION_PAID, rows 6).
create function public.end_pick(p_request_id uuid, p_application_status text, p_failed boolean)
  returns uuid
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_req  public.requests%rowtype;
begin
  if p_application_status is null or p_application_status not in ('EXPIRED', 'WITHDRAWN') then
    raise exception 'validation_failed';
  end if;
  select r.* into v_req from public.requests r where r.id = p_request_id for update;
  if not found or v_req.status not in ('SELECTED', 'COMMISSION_PAID') or (p_failed and v_req.status <> 'COMMISSION_PAID') then
    raise exception 'invalid_state';
  end if;
  update public.applications a
     set status = p_application_status, status_changed_at = now()
   where a.id = v_req.selected_application_id and a.request_id = v_req.id and a.status in ('SELECTED', 'AWAITING_FEE');
  if not found then
    raise exception 'invalid_state';
  end if;
  update public.requests
     set status = 'OPEN', selected_application_id = null, selected_at = null, payment_deadline = null, fee_deadline = null,
         failed_picks = failed_picks + case when p_failed then 1 else 0 end
   where id = v_req.id;
  return v_req.selected_application_id;
end;
$$;

revoke all on function public.end_pick(uuid, text, boolean) from public, anon, authenticated, service_role;

-- After a reopen: the failed pick limit (AC-3, row 7), then the start with a carried commission (AC-2.3), each a
-- cancel by the platform with the commission refunded; else the other applicants come back (D162), a suspended
-- provider's excepted.
create function public.after_reopen(p_request_id uuid)
  returns text
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_req  public.requests%rowtype;
begin
  select r.* into v_req from public.requests r where r.id = p_request_id for update;
  if not found or v_req.status <> 'OPEN' then
    raise exception 'invalid_state';
  end if;
  if v_req.failed_picks >= public.reselection_limit(v_req.region) then
    perform public.cancel_by_rule(v_req.id, 'platform', null, 'failed_picks', 'request.failed_picks_limit', null);
    return 'cancelled';
  end if;
  if v_req.scheduled_start_at <= now() and public.carried_commission(v_req.id) is not null then
    perform public.cancel_by_rule(v_req.id, 'platform', null, 'no_paid_pick', 'request.no_paid_pick', null);
    return 'cancelled';
  end if;
  update public.applications a
     set status = 'APPLIED', status_changed_at = now()
   where a.request_id = v_req.id and a.status = 'NOT_SELECTED'
     and exists (select 1 from public.providers pr where pr.id = a.provider_id and pr.status <> 'suspended');
  return 'reopened';
end;
$$;

revoke all on function public.after_reopen(uuid) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. The expiry (AC-2, AC-3). Run by pg_cron as postgres every minute; no API grant. At most 200 a run, each in its own
--    subtransaction, locked rows skipped (taken next run). A window ends when no payment can be accepted on it any
--    more (09's and 10's accept: the deadline plus the checkout hold, or the start) and no attempt is younger than
--    the hold. A missing hold setting holds every pick.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.expire_request(p_request_id uuid)
  returns text
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_req        public.requests%rowtype;
  v_hold       integer;
  v_fee        uuid;
  v_app        uuid;
  v_suspended  boolean;
  v_rule       public.cancellation_rules%rowtype;
  v_action     text;
  v_status     text;
  v_out        text;
begin
  select r.* into v_req from public.requests r where r.id = p_request_id for update;
  if not found then
    return 'none';
  end if;
  v_hold := (public.checkout_settings(v_req.region) ->> 'hold_minutes')::integer;

  if v_req.status = 'SELECTED' then
    -- Row 4: the customer's payment window. R-7: a pick of a suspended provider is dropped here once no card page
    -- is in use (the suspend left it).
    v_suspended := exists (select 1 from public.applications a join public.providers pr on pr.id = a.provider_id
                            where a.id = v_req.selected_application_id and pr.status = 'suspended');
    if v_hold is null then
      return 'held';
    end if;
    if not v_suspended and now() < v_req.scheduled_start_at
       and now() <= v_req.payment_deadline + make_interval(mins => v_hold) then
      return 'none';
    end if;
    select f.id into v_fee from public.fee_payments f where f.request_id = v_req.id and f.kind = 'commission';
    if public.attempt_open(v_fee, v_req.region) then
      return 'held';
    end if;
    v_rule := public.cancel_rule(v_req.region, 'SELECTED', 'platform');
    if not v_suspended and (v_rule.region is null or not v_rule.allowed) then
      return 'none';
    end if;
    v_status := case when v_suspended then 'WITHDRAWN' else 'EXPIRED' end;
    v_action := case when v_suspended then 'request.pick_dropped' else 'request.pick_expired' end;
    v_app := public.end_pick(v_req.id, v_status, false);
  elsif v_req.status = 'COMMISSION_PAID' then
    -- Row 6: the provider's fee window, capped by the start.
    if v_hold is null then
      return 'held';
    end if;
    if now() < v_req.scheduled_start_at and now() <= v_req.fee_deadline + make_interval(mins => v_hold) then
      return 'none';
    end if;
    select f.id into v_fee from public.fee_payments f
     where f.request_id = v_req.id and f.kind = 'provider_fee' and f.application_id = v_req.selected_application_id;
    if public.attempt_open(v_fee, v_req.region) then
      return 'held';
    end if;
    v_rule := public.cancel_rule(v_req.region, 'COMMISSION_PAID', 'provider');
    if v_rule.region is null or not v_rule.allowed then
      return 'none';
    end if;
    v_status := 'EXPIRED';
    v_action := 'request.fee_expired';
    v_app := public.end_pick(v_req.id, v_status, true);
  elsif v_req.status = 'OPEN' then
    -- The start edge (AC-2.3): a carried commission and nobody paid by the start.
    if v_req.scheduled_start_at > now() or public.carried_commission(v_req.id) is null then
      return 'none';
    end if;
    perform public.cancel_by_rule(v_req.id, 'platform', null, 'no_paid_pick', 'request.no_paid_pick', null);
    return 'cancelled';
  else
    return 'none';
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (null, v_action, 'requests', v_req.id::text, v_req.region,
          jsonb_build_object('status', v_req.status, 'application_id', v_app),
          jsonb_build_object('status', 'OPEN', 'application_id', v_app, 'application_status', v_status,
                             'failed_picks', v_req.failed_picks + case when v_req.status = 'COMMISSION_PAID' then 1 else 0 end,
                             'commission_outcome', v_rule.commission_outcome,
                             'counts_against', case when v_suspended then 'nobody' else v_rule.counts_against end));
  v_out := public.after_reopen(v_req.id);
  return case when v_out = 'cancelled' then 'cancelled' else 'reopened' end;
end;
$$;

revoke all on function public.expire_request(uuid) from public, anon, authenticated, service_role;

create function public.expire_windows()
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_id    uuid;
  v_out   text;
  v_done  integer := 0;
begin
  for v_id in
    select r.id from public.requests r
     where (r.status = 'SELECTED'
            and (r.scheduled_start_at <= now()
                 or r.payment_deadline + make_interval(mins => coalesce((public.checkout_settings(r.region) ->> 'hold_minutes')::integer, 0)) < now()
                 or exists (select 1 from public.applications a join public.providers pr on pr.id = a.provider_id
                             where a.id = r.selected_application_id and pr.status = 'suspended')))
        or (r.status = 'COMMISSION_PAID'
            and (r.scheduled_start_at <= now()
                 or r.fee_deadline + make_interval(mins => coalesce((public.checkout_settings(r.region) ->> 'hold_minutes')::integer, 0)) < now()))
        or (r.status = 'OPEN' and r.scheduled_start_at <= now() and public.carried_commission(r.id) is not null)
     order by r.id
     limit 200
     for update of r skip locked
  loop
    begin
      v_out := public.expire_request(v_id);
      if v_out in ('reopened', 'cancelled') then
        v_done := v_done + 1;
      end if;
    exception when others then
      -- One bad row never stops the rest, and it is reported (the request id and the SQLSTATE only).
      raise warning 'expire_failed request=% sqlstate=%', v_id, sqlstate;
    end;
  end loop;
  return v_done;
end;
$$;

revoke all on function public.expire_windows() from public, anon, authenticated, service_role;

select cron.schedule('requests-expire-windows', '* * * * *', $$select public.expire_windows()$$);

-- ═══════════════════════════════════════════════════════════════════════════
-- 9b. The commission's acceptance, replaced (owner, 2026-11-18). 09's rules, plus: the attempt must have started at or
--     after the request's current selected_at. Once a pick ends and the customer picks again, a card page opened under
--     the earlier pick is refused, so 07's late path refunds its payment rather than paying the new pick.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.accept_commission(p_fee uuid, p_attempt uuid)
  returns boolean
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_fee      public.fee_payments%rowtype;
  v_req      public.requests%rowtype;
  v_started  timestamptz;
  v_hold     integer;
begin
  select f.* into v_fee from public.fee_payments f where f.id = p_fee;
  if not found or v_fee.kind <> 'commission' or v_fee.status <> 'pending' then
    return false;
  end if;
  if exists (select 1 from public.fee_refunds x where x.fee_payment_id = v_fee.id) then
    return false;
  end if;
  select r.* into v_req from public.requests r where r.id = v_fee.request_id;
  if v_req.status is distinct from 'SELECTED' or v_req.payment_deadline is null or v_req.selected_at is null then
    return false;
  end if;
  if not exists (select 1 from public.applications a
                  where a.id = v_req.selected_application_id
                    and a.request_id = v_req.id
                    and a.status = 'SELECTED'
                    and public.provider_standing(a.provider_id) is not distinct from 'approved') then
    return false;
  end if;
  select a.started_at into v_started from public.checkout_attempts a
   where a.id = p_attempt and a.fee_payment_id = v_fee.id;
  if not found or v_started > v_req.payment_deadline or v_started < v_req.selected_at then
    return false;
  end if;
  if now() >= v_req.scheduled_start_at then
    return false;
  end if;
  v_hold := (public.checkout_settings(v_req.region) ->> 'hold_minutes')::integer;
  if v_hold is null then
    raise exception 'checkout_settings_invalid';
  end if;
  return now() <= v_req.payment_deadline + make_interval(mins => v_hold);
end;
$$;

revoke all on function public.accept_commission(uuid, uuid) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Choose, replaced (AC-4, R-3, R-4). 07's function in 07's order, plus: an application whose provider expired or
--     withdrew on this request refuses provider_not_eligible; and on an OPEN request with a carried commission the
--     pick moves straight to COMMISSION_PAID: the application APPLIED -> SELECTED (its fee frozen) -> AWAITING_FEE in
--     one transaction, selected_at now, no payment window, the fee window by 09's rule. open_fee is not called here.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.choose_provider(p_request_id uuid, p_application_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid           uuid := (select auth.uid());
  v_req           public.requests%rowtype;
  v_window        integer;
  v_fees          jsonb;
  v_fee           bigint;
  v_provider      uuid;
  v_app_req       uuid;
  v_status        text;
  v_deadline      timestamptz;
  v_now           timestamptz := now();
  v_carried       uuid;
  v_unlock        jsonb;
  v_fee_deadline  timestamptz;
begin
  -- 1. The request, locked, the caller's own.
  select r.* into v_req from public.requests r
   where r.id = p_request_id and r.customer_id = v_uid
     for update;
  if not found then
    raise exception 'not_found';
  end if;

  -- 2. The same offer chosen again: the stored answer, no write.
  if v_req.status = 'SELECTED' and v_req.selected_application_id = p_application_id then
    return jsonb_build_object('status', 'ok', 'replayed', true,
                              'selected_at', v_req.selected_at, 'payment_deadline', v_req.payment_deadline);
  end if;
  if v_req.status = 'COMMISSION_PAID' and v_req.selected_application_id = p_application_id and v_req.payment_deadline is null then
    return jsonb_build_object('status', 'ok', 'replayed', true, 'selected_at', v_req.selected_at,
                              'payment_deadline', null, 'carried', true, 'fee_deadline', v_req.fee_deadline);
  end if;

  -- 3. Open, and before its start.
  if v_req.status <> 'OPEN' or v_req.scheduled_start_at <= v_now then
    raise exception 'not_choosable';
  end if;

  -- 4. The payment window and the fee settings of the request's region; for a carried commission the fee window too.
  v_window := public.choose_settings(v_req.region);
  v_fees := public.fee_settings(v_req.region);
  v_carried := public.carried_commission(v_req.id);
  if v_carried is not null then
    v_unlock := public.unlock_settings(v_req.region);
  end if;

  -- 5. The application without a lock, then its provider shared, then the applications.
  select a.provider_id, a.request_id into v_provider, v_app_req
    from public.applications a
   where a.id = p_application_id;
  if not found or v_app_req is distinct from v_req.id then
    raise exception 'offer_unavailable';
  end if;
  perform 1 from public.providers pr where pr.id = v_provider for share;
  perform 1 from public.applications a where a.request_id = v_req.id for update;

  -- 6. Still APPLIED, from a provider approved now. A provider whose pick on this request expired or who withdrew
  --    is never picked again (umbrella answer).
  select a.status into v_status from public.applications a where a.id = p_application_id;
  if v_status in ('EXPIRED', 'WITHDRAWN') then
    raise exception 'provider_not_eligible';
  end if;
  if v_status is distinct from 'APPLIED'
     or public.provider_standing(v_provider) is distinct from 'approved' then
    raise exception 'offer_unavailable';
  end if;

  -- 6b. The provider fee, frozen now from the stored price.
  v_fee := public.fee_amount(v_req.fixed_price, v_fees);

  -- 7. The chosen one SELECTED with its fee, every other APPLIED one NOT_SELECTED.
  update public.applications a
     set status = case when a.id = p_application_id then 'SELECTED' else 'NOT_SELECTED' end,
         status_changed_at = v_now,
         provider_fee_amount = case when a.id = p_application_id then v_fee else a.provider_fee_amount end,
         provider_fee_kind = case when a.id = p_application_id then v_fees ->> 'kind' else a.provider_fee_kind end
   where a.request_id = v_req.id and a.status = 'APPLIED';

  if v_carried is null then
    -- 8. The request, with the deadline capped by the start.
    v_deadline := least(v_now + make_interval(hours => v_window), v_req.scheduled_start_at);
    update public.requests
       set status = 'SELECTED', selected_application_id = p_application_id, selected_at = v_now,
           payment_deadline = v_deadline
     where id = v_req.id;

    -- 9. Ids and the deadline only.
    insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
    values (v_uid, 'request.provider_chosen', 'requests', v_req.id::text, v_req.region,
            jsonb_build_object('status', 'OPEN'),
            jsonb_build_object('status', 'SELECTED', 'application_id', p_application_id,
                               'payment_deadline', v_deadline));

    return jsonb_build_object('status', 'ok', 'replayed', false, 'selected_at', v_now, 'payment_deadline', v_deadline);
  end if;

  -- 8c. The carried re-pick (R-3, R-4): no payment step; the provider's fee window starts now.
  update public.applications set status = 'AWAITING_FEE', status_changed_at = v_now where id = p_application_id;
  v_fee_deadline := greatest(
    least(v_now + make_interval(hours => (v_unlock ->> 'unlock_window_hours')::integer), v_req.scheduled_start_at),
    v_now + make_interval(mins => (v_unlock ->> 'min_window_minutes')::integer));
  update public.requests
     set status = 'COMMISSION_PAID', selected_application_id = p_application_id, selected_at = v_now,
         fee_deadline = v_fee_deadline
   where id = v_req.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.provider_chosen', 'requests', v_req.id::text, v_req.region,
          jsonb_build_object('status', 'OPEN'),
          jsonb_build_object('status', 'COMMISSION_PAID', 'application_id', p_application_id, 'carried', true,
                             'fee_payment_id', v_carried, 'fee_deadline', v_fee_deadline));

  return jsonb_build_object('status', 'ok', 'replayed', false, 'selected_at', v_now, 'payment_deadline', null,
                            'carried', true, 'fee_deadline', v_fee_deadline);
end;
$$;

revoke all on function public.choose_provider(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.choose_provider(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. The provider withdraws (AC-5, R-7, R-15), before the reveal only.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.withdraw_application(p_application_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_request  uuid;
  v_req      public.requests%rowtype;
  v_app      public.applications%rowtype;
  v_rule     public.cancellation_rules%rowtype;
  v_fee      uuid;
  v_out      text := 'none';
begin
  select a.request_id into v_request from public.applications a
   where a.id = p_application_id and a.provider_id = v_uid;
  if not found then
    raise exception 'not_found';
  end if;
  select r.* into v_req from public.requests r where r.id = v_request for update;
  select a.* into v_app from public.applications a where a.id = p_application_id and a.provider_id = v_uid for update;

  if v_app.status = 'WITHDRAWN' then
    return jsonb_build_object('status', 'ok', 'replayed', true);
  end if;
  -- After the reveal it is a cancel (AC-6), never a withdraw.
  if v_app.unlocked_at is not null or v_app.status not in ('APPLIED', 'SELECTED', 'AWAITING_FEE') then
    raise exception 'invalid_state';
  end if;

  if v_app.status = 'APPLIED' then
    update public.applications set status = 'WITHDRAWN', status_changed_at = now() where id = v_app.id;
  elsif v_app.status = 'SELECTED' then
    -- Row 3.
    if v_req.status <> 'SELECTED' or v_req.selected_application_id is distinct from v_app.id then
      raise exception 'invalid_state';
    end if;
    v_rule := public.cancel_rule(v_req.region, 'SELECTED', 'provider');
    if v_rule.region is null or not v_rule.allowed then
      raise exception 'invalid_state';
    end if;
    -- R-7: never under the customer's card page.
    select f.id into v_fee from public.fee_payments f where f.request_id = v_req.id and f.kind = 'commission';
    if public.attempt_open(v_fee, v_req.region) then
      raise exception 'checkout_open';
    end if;
    perform public.end_pick(v_req.id, 'WITHDRAWN', false);
    v_out := public.after_reopen(v_req.id);
  else
    -- Row 6: a failed pick; the commission carries.
    if v_req.status <> 'COMMISSION_PAID' or v_req.selected_application_id is distinct from v_app.id then
      raise exception 'invalid_state';
    end if;
    v_rule := public.cancel_rule(v_req.region, 'COMMISSION_PAID', 'provider');
    if v_rule.region is null or not v_rule.allowed then
      raise exception 'invalid_state';
    end if;
    select f.id into v_fee from public.fee_payments f
     where f.request_id = v_req.id and f.kind = 'provider_fee' and f.application_id = v_app.id;
    if public.attempt_open(v_fee, v_req.region) then
      raise exception 'checkout_open';
    end if;
    perform public.end_pick(v_req.id, 'WITHDRAWN', true);
    v_out := public.after_reopen(v_req.id);
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.provider_withdrew', 'requests', v_req.id::text, v_req.region,
          jsonb_build_object('status', v_req.status, 'application_status', v_app.status),
          jsonb_build_object('application_id', v_app.id, 'application_status', 'WITHDRAWN', 'request', v_out,
                             'commission_outcome', coalesce(v_rule.commission_outcome, 'not_paid'),
                             'counts_against', coalesce(v_rule.counts_against, 'nobody')));
  return jsonb_build_object('status', 'ok', 'replayed', false);
end;
$$;

revoke all on function public.withdraw_application(uuid) from public, anon, authenticated, service_role;
grant execute on function public.withdraw_application(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. Cancellation (AC-6, R-12, R-13). The customer's cancel_request replaced, and the unlocked provider's cancel.
--     Both read the matrix; AWAITING_CONFIRMATION onward refuses not_cancellable (row 12). 09's checkout_open guard
--     stays for SELECTED; a provider fee attempt in flight never holds a customer's cancel (R-12).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.cancel_request(p_request_id uuid, p_reason text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_req   public.requests%rowtype;
  v_fee   uuid;
  v_hold  integer;
begin
  if p_reason is not null and p_reason not in ('plans_changed', 'found_elsewhere', 'price', 'other') then
    raise exception 'validation_failed';
  end if;
  select r.* into v_req from public.requests r
   where r.id = p_request_id and r.customer_id = v_uid
     for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_req.status = 'CANCELLED' then
    return jsonb_build_object('status', 'ok');
  end if;

  if v_req.status = 'SELECTED' then
    select f.id into v_fee from public.fee_payments f
     where f.request_id = p_request_id and f.kind = 'commission'
       for update;
    if found then
      v_hold := (public.checkout_settings(v_req.region) ->> 'hold_minutes')::integer;
      if exists (select 1 from public.checkout_attempts a
                  where a.fee_payment_id = v_fee
                    and a.status in ('queued', 'ready')
                    and (v_hold is null or a.started_at > now() - make_interval(mins => v_hold))) then
        if v_hold is null then
          raise exception 'checkout_open' using hint = 'checkout_settings_invalid';
        end if;
        raise exception 'checkout_open';
      end if;
    end if;
  end if;

  return public.cancel_by_rule(v_req.id, 'customer', p_reason, 'customer_cancel', 'request.cancelled', v_uid);
end;
$$;

revoke all on function public.cancel_request(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_request(uuid, text) to authenticated;

create function public.provider_cancel_job(p_request_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_req  public.requests%rowtype;
begin
  -- Only the selected, unlocked provider takes the request's lock (S11-2); anyone else reads not_found.
  select r.* into v_req from public.requests r
   where r.id = p_request_id
     and exists (select 1 from public.applications a
                  where a.id = r.selected_application_id and a.provider_id = v_uid and a.unlocked_at is not null)
     for update of r;
  if not found then
    raise exception 'not_found';
  end if;
  if v_req.status = 'CANCELLED' then
    if v_req.cancelled_by = 'provider' then
      return jsonb_build_object('status', 'ok');
    end if;
    raise exception 'not_cancellable';
  end if;
  return public.cancel_by_rule(v_req.id, 'provider', null, null, 'request.provider_cancelled', v_uid);
end;
$$;

revoke all on function public.provider_cancel_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.provider_cancel_job(uuid) to authenticated;

-- AC-14: what a cancel would do now, for the dialog: whether the caller may cancel, and the exact refund from the
-- matrix and the paid amount. The customer of the request or its unlocked provider; anyone else reads not_found.
create function public.cancel_preview(p_request_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_req    public.requests%rowtype;
  v_actor  text;
  v_state  text;
  v_rule   public.cancellation_rules%rowtype;
  v_fee    public.fee_payments%rowtype;
  v_open   boolean := false;
  v_refund boolean;
begin
  select r.* into v_req from public.requests r where r.id = p_request_id;
  if not found then
    raise exception 'not_found';
  end if;
  if v_req.customer_id = v_uid then
    v_actor := 'customer';
  elsif exists (select 1 from public.applications a
                 where a.id = v_req.selected_application_id and a.provider_id = v_uid and a.unlocked_at is not null) then
    v_actor := 'provider';
  else
    raise exception 'not_found';
  end if;
  if v_req.status = 'CANCELLED' then
    return jsonb_build_object('actor', v_actor, 'state', 'CANCELLED', 'can_cancel', false, 'checkout_open', false,
                              'commission_outcome', null, 'provider_fee_outcome', null, 'counts_against', null,
                              'refund', null);
  end if;
  v_state := public.cancel_state(v_req.id);
  v_rule := public.cancel_rule(v_req.region, v_state, v_actor);
  select f.* into v_fee from public.fee_payments f where f.id = public.carried_commission(v_req.id);
  if v_actor = 'customer' and v_req.status = 'SELECTED' then
    v_open := public.attempt_open((select f.id from public.fee_payments f
                                    where f.request_id = v_req.id and f.kind = 'commission'), v_req.region);
  end if;
  v_refund := coalesce(v_rule.allowed, false) and v_rule.commission_outcome = 'refund' and v_fee.id is not null;
  return jsonb_build_object(
    'actor', v_actor,
    'state', v_state,
    'can_cancel', coalesce(v_rule.allowed, false) and not v_open,
    'checkout_open', v_open,
    'commission_outcome', v_rule.commission_outcome,
    'provider_fee_outcome', v_rule.provider_fee_outcome,
    'counts_against', v_rule.counts_against,
    'refund', case when v_refund then jsonb_build_object('kind', 'commission', 'amount', v_fee.amount,
                                                         'currency', v_fee.currency) end);
end;
$$;

revoke all on function public.cancel_preview(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_preview(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. Admin (AC-8, AC-9, AC-12, R-10, R-11). is_admin() inside each; every action audited with its free text.
--     The arguments name the receipt and the refund, never money (supabase/tests/10 refuses an argument named for
--     money): p_payment_id is the fee_payments id, p_refund_id the fee_refunds id.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.admin_refund_fee(p_payment_id uuid, p_reason text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_request  uuid;
  v_req      public.requests%rowtype;
  v_fee      public.fee_payments%rowtype;
  v_id       uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'reason_required';
  end if;
  select f.request_id into v_request from public.fee_payments f where f.id = p_payment_id;
  if not found then
    raise exception 'not_found';
  end if;
  select r.* into v_req from public.requests r where r.id = v_request for update;
  select f.* into v_fee from public.fee_payments f where f.id = p_payment_id for update;
  select x.id into v_id from public.fee_refunds x where x.fee_payment_id = v_fee.id;
  if found then
    return jsonb_build_object('status', 'ok', 'replayed', true, 'fee_refund_id', v_id);
  end if;
  if v_fee.status <> 'paid' then
    raise exception 'invalid_state';
  end if;
  -- Row 11: a commission once the request is cancelled or revealed; a provider fee once its own pick was revealed.
  if v_fee.kind = 'commission'
     and v_req.status not in ('CANCELLED', 'UNLOCKED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED') then
    raise exception 'invalid_state';
  end if;
  if v_fee.kind = 'provider_fee'
     and not exists (select 1 from public.applications a where a.id = v_fee.application_id and a.unlocked_at is not null) then
    raise exception 'invalid_state';
  end if;
  v_id := public.queue_fee_refund(v_fee.id, 'admin_refund', v_uid);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'fee.refund_by_admin', 'fee_payments', v_fee.id::text, v_fee.region,
          jsonb_build_object('status', 'paid', 'request_status', v_req.status),
          jsonb_build_object('fee_refund_id', v_id, 'kind', v_fee.kind, 'request_id', v_req.id, 'reason', v_reason));
  return jsonb_build_object('status', 'ok', 'replayed', false, 'fee_refund_id', v_id);
end;
$$;

revoke all on function public.admin_refund_fee(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_refund_fee(uuid, text) to authenticated;

-- R-10: a refund the PSP refused for good (08 marked it failed), refunded by hand in the PSP panel and recorded here:
-- done_by_hand, the same journal apply_fee_refunded posts (same key, so a second post is a replay), the fee refunded.
-- A later PSP success for it is refused by apply_fee_refunded (invalid_state), which the relay alerts.
create function public.admin_mark_refund_done(p_refund_id uuid, p_note text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_note     text := btrim(coalesce(p_note, ''));
  v_request  uuid;
  v_fee_id   uuid;
  v_fee      public.fee_payments%rowtype;
  v_ref      public.fee_refunds%rowtype;
  v_key      text;
  v_legs     jsonb;
  v_result   jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if char_length(v_note) not between 10 and 500 then
    raise exception 'reason_required';
  end if;
  select x.request_id, x.fee_payment_id into v_request, v_fee_id from public.fee_refunds x where x.id = p_refund_id;
  if not found then
    raise exception 'not_found';
  end if;
  -- The lock order of apply_fee_refunded: request, fee, refund.
  perform 1 from public.requests r where r.id = v_request for update;
  if v_fee_id is not null then
    select f.* into v_fee from public.fee_payments f where f.id = v_fee_id for update;
  end if;
  select x.* into v_ref from public.fee_refunds x where x.id = p_refund_id for update;
  if v_ref.status = 'done_by_hand' then
    return jsonb_build_object('status', 'ok', 'replayed', true);
  end if;
  if v_ref.status <> 'failed' then
    raise exception 'invalid_state';
  end if;

  v_key := case v_ref.kind when 'fee' then 'fee:' || v_ref.fee_payment_id || ':refund'
                           else 'late:' || v_ref.psp_payment_id || ':refund' end;
  if v_ref.kind = 'fee' then
    if v_fee.status <> 'paid' or v_ref.amount <> v_fee.amount or v_ref.currency <> v_fee.currency
       or v_ref.psp_payment_id is distinct from v_fee.psp_payment_id then
      raise exception 'invalid_state';
    end if;
    update public.fee_payments set status = 'refunded' where id = v_fee.id;
    v_legs := jsonb_build_array(
      jsonb_build_object('account', case v_fee.kind when 'commission' then 'commission_refunds' else 'provider_fee_refunds' end,
                         'amount', v_ref.amount),
      jsonb_build_object('account', 'psp_clearing', 'amount', -v_ref.amount));
  else
    v_legs := jsonb_build_array(
      jsonb_build_object('account', 'refunds_due', 'amount', v_ref.amount),
      jsonb_build_object('account', 'psp_clearing', 'amount', -v_ref.amount));
  end if;
  update public.fee_refunds set status = 'done_by_hand', finished_at = now() where id = v_ref.id;

  v_result := jsonb_build_object('status', 'refunded', 'fee_refund_id', v_ref.id, 'kind', v_ref.kind,
                                 'fee_payment_id', v_ref.fee_payment_id, 'psp_payment_id', v_ref.psp_payment_id,
                                 'psp_refund_id', null, 'by_hand', true, 'amount', v_ref.amount,
                                 'currency', v_ref.currency, 'alerts', '[]'::jsonb);
  v_result := public.post_journal(case v_ref.kind when 'fee' then 'fee_refund' else 'late_refund' end, v_key,
                                  v_ref.currency, v_ref.region, v_legs, v_ref.fee_payment_id, v_result);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'fee.refund_done_by_hand', 'fee_refunds', v_ref.id::text, v_ref.region,
          jsonb_build_object('status', 'failed'),
          jsonb_build_object('status', 'done_by_hand', 'fee_payment_id', v_ref.fee_payment_id,
                             'journal_id', (v_result ->> 'journal_id')::uuid, 'note', v_note));
  return jsonb_build_object('status', 'ok', 'replayed', false, 'journal_id', (v_result ->> 'journal_id')::uuid);
end;
$$;

revoke all on function public.admin_mark_refund_done(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_mark_refund_done(uuid, text) to authenticated;

-- AC-12: one request as admin reads it: the summary without the address, every application (the pick and past picks),
-- the fees, the refunds, the request's ledger lines, the flags and the audit timeline.
create function public.admin_request_detail(p_request_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_req   public.requests%rowtype;
  v_out   jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select r.* into v_req from public.requests r where r.id = p_request_id;
  if not found then
    raise exception 'not_found';
  end if;

  with fees as (
    select f.* from public.fee_payments f where f.request_id = v_req.id
  ), refunds as (
    select x.* from public.fee_refunds x where x.request_id = v_req.id
  ), journals as (
    select j.* from public.ledger_journals j
     where j.fee_payment_id in (select id from fees)
        or j.idempotency_key in (select 'late:' || x.psp_payment_id || ':received' from refunds x where x.kind = 'late'
                                 union all
                                 select 'late:' || x.psp_payment_id || ':refund' from refunds x where x.kind = 'late')
  )
  select jsonb_build_object(
    'request', jsonb_build_object(
      'id', v_req.id, 'region', v_req.region, 'status', v_req.status, 'customer_id', v_req.customer_id,
      'service_name', (select s.name from public.services s where s.id = v_req.service_id),
      'zone_name', (select z.name from public.zones z where z.id = v_req.zone_id),
      'timezone', (select g.timezone from public.regions g where g.code = v_req.region),
      'fixed_price', v_req.fixed_price, 'commission_amount', v_req.commission_amount, 'cash_due', v_req.cash_due,
      'currency', v_req.currency, 'scheduled_start_at', v_req.scheduled_start_at,
      'scheduled_end_at', v_req.scheduled_end_at, 'created_at', v_req.created_at,
      'selected_application_id', v_req.selected_application_id, 'selected_at', v_req.selected_at,
      'payment_deadline', v_req.payment_deadline, 'fee_deadline', v_req.fee_deadline,
      'failed_picks', v_req.failed_picks, 'cancelled_at', v_req.cancelled_at, 'cancelled_by', v_req.cancelled_by,
      'cancel_reason', v_req.cancel_reason, 'closed_at', v_req.closed_at, 'closed_by', v_req.closed_by,
      'actual_started_at', v_req.actual_started_at, 'actual_completed_at', v_req.actual_completed_at,
      'confirm_deadline', v_req.confirm_deadline),
    'applications', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'provider_id', a.provider_id, 'provider_name', pr.approved_name, 'status', a.status,
        'selected', a.id = v_req.selected_application_id, 'created_at', a.created_at,
        'status_changed_at', a.status_changed_at, 'unlocked_at', a.unlocked_at,
        'provider_fee_amount', a.provider_fee_amount) order by a.created_at, a.id)
      from public.applications a left join public.providers pr on pr.id = a.provider_id
     where a.request_id = v_req.id), '[]'::jsonb),
    'fees', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'kind', f.kind, 'provider_id', f.provider_id, 'application_id', f.application_id,
        'amount', f.amount, 'currency', f.currency, 'status', f.status, 'paid_at', f.paid_at,
        'psp_payment_id', f.psp_payment_id, 'psp_fee_amount', f.psp_fee_amount, 'created_at', f.created_at)
        order by f.created_at, f.id) from fees f), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'kind', x.kind, 'fee_payment_id', x.fee_payment_id, 'psp_payment_id', x.psp_payment_id,
        'amount', x.amount, 'currency', x.currency, 'reason', x.reason, 'status', x.status,
        'requested_by', x.requested_by, 'created_at', x.created_at, 'finished_at', x.finished_at)
        order by x.created_at, x.id) from refunds x), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object(
        'journal_id', j.id, 'kind', j.kind, 'key', j.idempotency_key, 'fee_payment_id', j.fee_payment_id,
        'currency', j.currency, 'created_at', j.created_at,
        'entries', (select jsonb_agg(jsonb_build_object('account', e.account, 'amount', e.amount) order by e.id)
                      from public.ledger_entries e where e.journal_id = j.id))
        order by j.created_at, j.id) from journals j), '[]'::jsonb),
    'flags', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'raised_at', d.raised_at, 'cleared_at', d.cleared_at, 'cleared_by', d.cleared_by,
        'note', d.note) order by d.raised_at, d.id)
      from public.deadline_flags d where d.request_id = v_req.id), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'action', l.action, 'actor_id', l.actor_id, 'entity_type', l.entity_type, 'entity_id', l.entity_id,
        'old_value', l.old_value, 'new_value', l.new_value, 'created_at', l.created_at) order by l.created_at, l.id)
      from public.audit_log l
     where (l.entity_type = 'requests' and l.entity_id = v_req.id::text)
        or (l.entity_type = 'fee_payments' and l.entity_id in (select id::text from fees))
        or (l.entity_type = 'fee_refunds' and l.entity_id in (select id::text from refunds))), '[]'::jsonb))
    into v_out;
  return v_out;
end;
$$;

revoke all on function public.admin_request_detail(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_request_detail(uuid) to authenticated;

-- 07's books check, replaced: a late refund done by hand carries its journal like one done by the PSP (R-10).
create or replace function public.ledger_check(p_region text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_totals      jsonb;
  v_imbalances  jsonb;
begin
  if not (coalesce((select auth.role()), '') = 'service_role' or public.is_admin()) then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('currency', t.currency, 'account', t.account, 'total', t.total)
                            order by t.currency, t.account), '[]'::jsonb)
    into v_totals
    from (select e.currency, e.account, sum(e.amount) as total
            from public.ledger_entries e
           where e.region = p_region
           group by e.currency, e.account) t;

  select coalesce(jsonb_agg(jsonb_build_object('check', i.check_name, 'ref', i.ref, 'value', i.value)
                            order by i.check_name, i.ref), '[]'::jsonb)
    into v_imbalances
    from (
      select 'journal_unbalanced' as check_name, j.id::text as ref, coalesce(sum(e.amount), 0) as value
        from public.ledger_journals j
        left join public.ledger_entries e on e.journal_id = j.id
       where j.region = p_region
       group by j.id
      having count(e.id) < 2 or coalesce(sum(e.amount), 0) <> 0
      union all
      select 'currency_unbalanced', p_region || ':' || e.currency, sum(e.amount)
        from public.ledger_entries e
       where e.region = p_region
       group by e.currency
      having sum(e.amount) <> 0
      union all
      select 'fee_paid_journals', f.id::text, count(j.id)
        from public.fee_payments f
        left join public.ledger_journals j on j.fee_payment_id = f.id and j.kind = 'fee_paid'
       where f.region = p_region
       group by f.id, f.status
      having (f.status in ('paid', 'refunded') and count(j.id) <> 1) or (f.status = 'pending' and count(j.id) > 0)
      union all
      select 'fee_refund_journals', f.id::text, count(j.id)
        from public.fee_payments f
        left join public.ledger_journals j on j.fee_payment_id = f.id and j.kind = 'fee_refund'
       where f.region = p_region
       group by f.id, f.status
      having (f.status = 'refunded' and count(j.id) <> 1) or (f.status <> 'refunded' and count(j.id) > 0)
      union all
      select 'late_refund_journals', x.id::text, count(j.id)
        from public.fee_refunds x
        left join public.ledger_journals j on j.idempotency_key = 'late:' || x.psp_payment_id || ':refund'
       where x.region = p_region and x.kind = 'late'
       group by x.id, x.status
      having (x.status in ('done', 'done_by_hand') and count(j.id) <> 1)
          or (x.status not in ('done', 'done_by_hand') and count(j.id) > 0)
      union all
      select 'late_received_without_refund', j.idempotency_key, 1
        from public.ledger_journals j
       where j.region = p_region and j.kind = 'late_received'
         and not exists (select 1 from public.fee_refunds x
                          where x.kind = 'late' and j.idempotency_key = 'late:' || x.psp_payment_id || ':received')
      union all
      select 'late_refund_without_received', x.id::text, 1
        from public.fee_refunds x
       where x.region = p_region and x.kind = 'late'
         and not exists (select 1 from public.ledger_journals j
                          where j.idempotency_key = 'late:' || x.psp_payment_id || ':received')
      union all
      select 'psp_fee_differs', f.id::text, f.psp_fee_amount - coalesce(sum(e.amount), 0)
        from public.fee_payments f
        join public.ledger_journals j on j.fee_payment_id = f.id and j.kind = 'fee_paid'
        left join public.ledger_entries e on e.journal_id = j.id and e.account = 'psp_fees'
       where f.region = p_region and f.status in ('paid', 'refunded')
       group by f.id, f.psp_fee_amount
      having f.psp_fee_amount <> coalesce(sum(e.amount), 0)
    ) i;

  return jsonb_build_object('region', p_region, 'totals', v_totals, 'imbalances', v_imbalances);
end;
$$;

revoke all on function public.ledger_check(text) from public, anon, authenticated, service_role;
grant execute on function public.ledger_check(text) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 14. Suspend, replaced (AC-10, R-7, R-8). 02's checks and audit row, plus: the provider's APPLIED applications
--     WITHDRAWN; a SELECTED or AWAITING_FEE pick WITHDRAWN and its request OPEN (not a failed pick; the commission
--     carries), except a SELECTED pick under the customer's card page, left for expire_windows; UNLOCKED and later
--     stay, each with an audit row. Locks: the affected requests in ascending id order, then the provider row (R-8).
--     An APPLIED row that appears between the two (an apply that committed first) is withdrawn under the provider
--     lock alone: no other path holds a provider share lock while it waits for that application's row.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.suspend_provider(p_provider_id uuid, p_reason text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_row     public.providers%rowtype;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_id      uuid;
  v_app     public.applications%rowtype;
  v_req     public.requests%rowtype;
  v_fee     uuid;
  v_out     text;
  v_counts  jsonb := jsonb_build_object('withdrawn', 0, 'reopened', 0, 'held', 0, 'kept', 0);
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  for v_id in
    select distinct a.request_id from public.applications a
     where a.provider_id = p_provider_id
       and a.status in ('APPLIED', 'SELECTED', 'AWAITING_FEE', 'UNLOCKED', 'STARTED', 'COMPLETED')
     order by 1
  loop
    perform 1 from public.requests r where r.id = v_id for update;
  end loop;

  v_row := public.provider_for_admin(p_provider_id);
  if v_row.status <> 'approved' then
    raise exception 'not_approved';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'validation_failed';
  end if;
  update public.providers
     set status = 'suspended', suspension_reason = v_reason, decided_at = now(), decided_by = v_uid
   where id = v_row.id;

  for v_app in
    select a.* from public.applications a
     where a.provider_id = v_row.id
       and a.status in ('APPLIED', 'SELECTED', 'AWAITING_FEE', 'UNLOCKED', 'STARTED', 'COMPLETED')
     order by a.request_id, a.id
  loop
    if v_app.status = 'APPLIED' then
      update public.applications set status = 'WITHDRAWN', status_changed_at = now() where id = v_app.id;
      v_counts := jsonb_set(v_counts, '{withdrawn}', to_jsonb((v_counts ->> 'withdrawn')::integer + 1));
      continue;
    end if;
    select r.* into v_req from public.requests r where r.id = v_app.request_id for update;
    if v_app.status in ('SELECTED', 'AWAITING_FEE') then
      if v_req.selected_application_id is distinct from v_app.id then
        continue;
      end if;
      if v_app.status = 'SELECTED' then
        select f.id into v_fee from public.fee_payments f where f.request_id = v_req.id and f.kind = 'commission';
        if public.attempt_open(v_fee, v_req.region) then
          -- R-7: the customer is on the card page; expire_windows drops this pick once the page is no longer in use.
          v_counts := jsonb_set(v_counts, '{held}', to_jsonb((v_counts ->> 'held')::integer + 1));
          continue;
        end if;
      end if;
      perform public.end_pick(v_req.id, 'WITHDRAWN', false);
      insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
      values (v_uid, 'request.pick_dropped', 'requests', v_req.id::text, v_req.region,
              jsonb_build_object('status', v_req.status, 'application_id', v_app.id),
              jsonb_build_object('status', 'OPEN', 'application_id', v_app.id, 'application_status', 'WITHDRAWN',
                                 'failed_picks', v_req.failed_picks, 'counts_against', 'nobody'));
      v_out := public.after_reopen(v_req.id);
      v_counts := jsonb_set(v_counts, '{reopened}', to_jsonb((v_counts ->> 'reopened')::integer + 1));
    else
      -- After the reveal the job stays (10's A-5 hides the customer's contacts from a suspended provider).
      insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
      values (v_uid, 'request.provider_suspended', 'requests', v_req.id::text, v_req.region, null,
              jsonb_build_object('status', v_req.status, 'application_id', v_app.id, 'provider_id', v_row.id));
      v_counts := jsonb_set(v_counts, '{kept}', to_jsonb((v_counts ->> 'kept')::integer + 1));
    end if;
  end loop;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'provider.suspended', 'provider', v_row.id::text, v_row.region,
          jsonb_build_object('status', v_row.status),
          jsonb_build_object('status', 'suspended', 'suspension_reason', v_reason, 'applications', v_counts));
  return jsonb_build_object('status', 'suspended');
end;
$$;

revoke all on function public.suspend_provider(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.suspend_provider(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 15. Deadline flags (AC-11). Run by pg_cron every 10 minutes; no API grant. UNLOCKED past the start plus
--     start_grace_hours raises start_late; IN_PROGRESS past the end plus completion_grace_hours raises
--     completion_late. Requests with skip locked, at most 200 a run, each in its own subtransaction. A flag whose
--     state has moved on is cleared by itself (a second line behind the job functions below).
-- ═══════════════════════════════════════════════════════════════════════════

create function public.raise_deadline_flags()
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_row     record;
  v_raised  integer := 0;
  v_region  text;
begin
  for v_region in
    select g.code from public.regions g
     where public.grace_hours(g.code, 'start_grace_hours') is null
        or public.grace_hours(g.code, 'completion_grace_hours') is null
  loop
    raise warning 'deadline_flags_settings_invalid region=%', v_region;
  end loop;

  update public.deadline_flags d
     set cleared_at = now(), note = 'auto'
   where d.cleared_at is null
     and not exists (select 1 from public.requests r
                      where r.id = d.request_id
                        and r.status = case d.kind when 'start_late' then 'UNLOCKED' else 'IN_PROGRESS' end);

  for v_row in
    select r.id, r.region, case r.status when 'UNLOCKED' then 'start_late' else 'completion_late' end as kind
      from public.requests r
     where ((r.status = 'UNLOCKED'
             and r.scheduled_start_at + make_interval(hours => public.grace_hours(r.region, 'start_grace_hours')) <= now())
            or (r.status = 'IN_PROGRESS'
                and r.scheduled_end_at + make_interval(hours => public.grace_hours(r.region, 'completion_grace_hours')) <= now()))
       and not exists (select 1 from public.deadline_flags d
                        where d.request_id = r.id and d.cleared_at is null
                          and d.kind = case r.status when 'UNLOCKED' then 'start_late' else 'completion_late' end)
     order by r.id
     limit 200
     for update of r skip locked
  loop
    begin
      insert into public.deadline_flags (region, request_id, kind)
      values (v_row.region, v_row.id, v_row.kind)
      on conflict (request_id, kind) where cleared_at is null do nothing;
      if found then
        v_raised := v_raised + 1;
        insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
        values (null, 'request.flag_raised', 'requests', v_row.id::text, v_row.region, null,
                jsonb_build_object('kind', v_row.kind));
      end if;
    exception when others then
      raise warning 'deadline_flag_failed request=% sqlstate=%', v_row.id, sqlstate;
    end;
  end loop;
  return v_raised;
end;
$$;

revoke all on function public.raise_deadline_flags() from public, anon, authenticated, service_role;

select cron.schedule('requests-deadline-flags', '*/10 * * * *', $$select public.raise_deadline_flags()$$);

-- ═══════════════════════════════════════════════════════════════════════════
-- 16. 11's job functions, replaced only to clear the flags (AC-11): Started clears start_late, Done clears both, and
--     every close (confirm, the customer's Job done, the auto close: all through close_job) clears both.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.start_job(p_request_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_app     public.applications%rowtype;
  v_status  text;
  v_region  text;
begin
  v_app := public.job_for_provider(p_request_id);
  select r.status, r.region into v_status, v_region from public.requests r where r.id = p_request_id;
  if v_status = 'IN_PROGRESS' and v_app.status = 'STARTED' then
    return jsonb_build_object('status', 'ok', 'replayed', true);
  end if;
  if v_status <> 'UNLOCKED' or v_app.status <> 'UNLOCKED' then
    raise exception 'invalid_state';
  end if;
  if not public.start_day_reached(p_request_id) then
    raise exception 'too_early';
  end if;
  update public.requests set status = 'IN_PROGRESS', actual_started_at = now() where id = p_request_id;
  update public.applications set status = 'STARTED', status_changed_at = now() where id = v_app.id;
  perform public.clear_deadline_flags(p_request_id, array['start_late']);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values ((select auth.uid()), 'job.started', 'requests', p_request_id::text, v_region,
          jsonb_build_object('status', 'UNLOCKED'), jsonb_build_object('status', 'IN_PROGRESS', 'application_id', v_app.id));
  return jsonb_build_object('status', 'ok', 'replayed', false);
end;
$$;

revoke all on function public.start_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.start_job(uuid) to authenticated;

create or replace function public.finish_job(p_request_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_app     public.applications%rowtype;
  v_status  text;
  v_region  text;
  v_hours   integer;
begin
  v_app := public.job_for_provider(p_request_id);
  select r.status, r.region into v_status, v_region from public.requests r where r.id = p_request_id;
  if v_status = 'AWAITING_CONFIRMATION' and v_app.status = 'COMPLETED' then
    return jsonb_build_object('status', 'ok', 'replayed', true);
  end if;
  if v_status <> 'IN_PROGRESS' or v_app.status <> 'STARTED' then
    raise exception 'invalid_state';
  end if;
  v_hours := public.confirm_settings(v_region);
  update public.requests
     set status = 'AWAITING_CONFIRMATION', actual_completed_at = now(),
         confirm_deadline = now() + make_interval(hours => v_hours)
   where id = p_request_id;
  update public.applications set status = 'COMPLETED', status_changed_at = now() where id = v_app.id;
  perform public.clear_deadline_flags(p_request_id, null);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values ((select auth.uid()), 'job.done', 'requests', p_request_id::text, v_region,
          jsonb_build_object('status', 'IN_PROGRESS'),
          jsonb_build_object('status', 'AWAITING_CONFIRMATION', 'application_id', v_app.id));
  return jsonb_build_object('status', 'ok', 'replayed', false);
end;
$$;

revoke all on function public.finish_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.finish_job(uuid) to authenticated;

create or replace function public.close_job(p_request_id uuid, p_by text, p_action text)
  returns void
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_req  public.requests%rowtype;
begin
  select r.* into v_req from public.requests r where r.id = p_request_id;
  if v_req.status not in ('UNLOCKED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION') then
    raise exception 'invalid_state';
  end if;
  perform 1 from public.applications a where a.id = v_req.selected_application_id for update;
  update public.requests
     set status = 'COMPLETED', closed_at = now(), closed_by = p_by,
         actual_completed_at = coalesce(actual_completed_at, now())
   where id = p_request_id;
  update public.applications set status = 'CONFIRMED', status_changed_at = now()
   where id = v_req.selected_application_id;
  perform public.clear_deadline_flags(p_request_id, null);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (case when p_by = 'auto' then null else (select auth.uid()) end, p_action, 'requests', p_request_id::text, v_req.region,
          jsonb_build_object('status', v_req.status),
          jsonb_build_object('status', 'COMPLETED', 'closed_by', p_by, 'application_id', v_req.selected_application_id));
end;
$$;

revoke all on function public.close_job(uuid, text, text) from public, anon, authenticated, service_role;
