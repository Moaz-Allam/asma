-- Position 14 (spec 0011-14, amended by D193 with rules R-1 to R-15 and cross check rules X-1 to X-25; an X rule
-- wins over an R rule, a rule over an AC): report a problem.
--
-- From the reveal until report_window_days after the close, either party of a request can report the other: a reason
-- code, a short text and up to three photos. Admin works a queue and handles each report once: no action, a warning
-- (a reason code, never admin's words, R-9), a provider suspension (02's suspend_provider, X-2), a return to work or a
-- close of a job waiting for confirmation, plus an optional refund of one of the request's fees (12's
-- admin_refund_fee, R-11). An open report pauses the auto close and the closes_soon reminder (R-6, R-7, X-7). Mail
-- rides 13's audit trigger: report.opened and report.handled (R-8), and an admin close mails like a confirm (X-15).
--
-- Three tables (problem_reports, report_photos, user_warnings) with RLS on, a deny policy and no API grant (R-15):
-- every read and write goes through a definer function that checks auth.uid() or is_admin(). Report photos live in
-- the private bucket report-photos; its policies call report_photo_allowed, a trigger repeats the insert rule for
-- every API role (X-4), and an admin reads a photo only after log_report_photo_view wrote its audit row (X-3).
--
-- Lock order (D169): the requests row first, always; then the reporter's profile (R-4) or the report row; for a
-- suspension every request of the provider in one ascending pass before the report row (X-1).
--
-- Replaced again, bodies copied from their latest migration plus the change named at each: pricing_settings_guard
-- (13), requests_guard and applications_guard (12), auto_close_jobs and request_close_info (11), queue_email,
-- queue_audit_email, email_context, queue_reminders and the audit_log_email trigger (13).
--
-- Every function revokes PUBLIC and pins search_path (supabase/tests/02). Refusals are stable codes in the exception
-- message; the doors map them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Settings (R-2, R-4, X-8). Seeded for both regions, held to whole numbers, required by the guard, read by one
--    fail closed reader.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_report_window_days_valid check (
    case when key <> 'report_window_days' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 90 end),
  add constraint platform_settings_reports_per_user_day_valid check (
    case when key <> 'reports_per_user_day' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 50 end);

insert into public.platform_settings (region, key, value) values
  ('TR',  'report_window_days',   '14'),
  ('KSA', 'report_window_days',   '14'),
  ('TR',  'reports_per_user_day', '5'),
  ('KSA', 'reports_per_user_day', '5')
on conflict (region, key) do nothing;

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
                 'max_reselections', 'start_grace_hours', 'completion_grace_hours',
                 'emails_enabled', 'apply_needs_email', 'pay_reminder_hours', 'email_link_hours',
                 'confirm_reminder_hours',
                 'report_window_days', 'reports_per_user_day')
     and (tg_op = 'DELETE' or new.key is distinct from old.key or new.region is distinct from old.region) then
    raise exception 'pricing_setting_required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.pricing_settings_guard() from public, anon, authenticated, service_role;

-- R-2, X-8: the two report settings of a region, or report_settings_invalid when one is missing or malformed.
create function public.report_settings(p_region text)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_window  jsonb;
  v_day     jsonb;
begin
  select s.value into v_window from public.platform_settings s where s.region = p_region and s.key = 'report_window_days';
  select s.value into v_day from public.platform_settings s where s.region = p_region and s.key = 'reports_per_user_day';
  if jsonb_typeof(v_window) is distinct from 'number'
     or (v_window #>> '{}')::numeric <> trunc((v_window #>> '{}')::numeric)
     or (v_window #>> '{}')::numeric not between 1 and 90
     or jsonb_typeof(v_day) is distinct from 'number'
     or (v_day #>> '{}')::numeric <> trunc((v_day #>> '{}')::numeric)
     or (v_day #>> '{}')::numeric not between 1 and 50 then
    raise exception 'report_settings_invalid';
  end if;
  return jsonb_build_object('report_window_days', (v_window #>> '{}')::integer,
                            'reports_per_user_day', (v_day #>> '{}')::integer);
end;
$$;

revoke all on function public.report_settings(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The tables (R-15, X-24). RLS on, a deny policy (test 00 wants one on every RLS table), no API grant.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.problem_reports (
  id             uuid        primary key default gen_random_uuid(),
  region         text        not null references public.regions (code) on delete restrict,
  request_id     uuid        not null references public.requests (id) on delete restrict,
  reporter_id    uuid        not null references public.profiles (id) on delete restrict,
  against_id     uuid        not null references public.profiles (id) on delete restrict,
  side           text        not null,
  reason         text        not null,
  text           text        not null,
  status         text        not null default 'open',
  outcome        text,
  admin_note     text,
  handled_by     uuid        references public.profiles (id) on delete restrict,
  handled_at     timestamptz,
  fee_refund_id  uuid        references public.fee_refunds (id) on delete restrict,
  created_at     timestamptz not null default now(),

  constraint problem_reports_side_valid check (side in ('customer', 'provider')),
  constraint problem_reports_reason_valid check (
    reason in ('no_show', 'did_not_pay_cash', 'poor_work', 'safety_or_behaviour', 'asked_money_off_platform', 'other')),
  constraint problem_reports_status_valid check (status in ('open', 'handled')),
  constraint problem_reports_outcome_valid check (
    outcome is null or outcome in ('no_action', 'warned', 'suspended', 'returned_to_work', 'job_closed')),
  constraint problem_reports_parties_differ check (reporter_id <> against_id),
  constraint problem_reports_text_size check (octet_length(text) <= 4000 and char_length(text) between 20 and 1000),
  constraint problem_reports_note_size check (admin_note is null or char_length(admin_note) between 10 and 500),
  constraint problem_reports_handled_together check (
    (status = 'open' and outcome is null and admin_note is null and handled_by is null and handled_at is null
     and fee_refund_id is null)
    or (status = 'handled' and outcome is not null and admin_note is not null and handled_by is not null
        and handled_at is not null))
);

alter table public.problem_reports enable row level security;
create policy problem_reports_no_api on public.problem_reports for select to authenticated using (false);
revoke all on table public.problem_reports from anon, authenticated, service_role;

create unique index problem_reports_one_open_idx on public.problem_reports (request_id, reporter_id) where status = 'open';
-- R-6: the auto close and the reminders ask "is a report open on this request?".
create index problem_reports_open_idx on public.problem_reports (request_id) where status = 'open';
create index problem_reports_request_idx on public.problem_reports (request_id, reporter_id);
create index problem_reports_reporter_idx on public.problem_reports (reporter_id, created_at);
create index problem_reports_against_idx on public.problem_reports (against_id);
create index problem_reports_queue_idx on public.problem_reports (status, created_at, id);
create index problem_reports_handled_idx on public.problem_reports (status, handled_at, id);
create index problem_reports_region_idx on public.problem_reports (region);
create index problem_reports_handled_by_idx on public.problem_reports (handled_by);
create index problem_reports_fee_refund_idx on public.problem_reports (fee_refund_id);

create table public.report_photos (
  id           uuid        primary key default gen_random_uuid(),
  region       text        not null references public.regions (code) on delete restrict,
  report_id    uuid        not null references public.problem_reports (id) on delete restrict,
  -- storage.objects.id, new at every creation: the admin view row names it (X-3).
  object_id    uuid        not null,
  object_path  text collate "C" not null unique,
  created_at   timestamptz not null default now()
);

alter table public.report_photos enable row level security;
create policy report_photos_no_api on public.report_photos for select to authenticated using (false);
revoke all on table public.report_photos from anon, authenticated, service_role;

create index report_photos_report_idx on public.report_photos (report_id, created_at);
create index report_photos_region_idx on public.report_photos (region);

create table public.user_warnings (
  id               uuid        primary key default gen_random_uuid(),
  region           text        not null references public.regions (code) on delete restrict,
  user_id          uuid        not null references public.profiles (id) on delete restrict,
  report_id        uuid        references public.problem_reports (id) on delete restrict,
  reason           text        not null,
  created_by       uuid        not null references public.profiles (id) on delete restrict,
  created_at       timestamptz not null default now(),
  acknowledged_at  timestamptz,

  constraint user_warnings_reason_valid check (
    reason in ('no_show', 'did_not_pay_cash', 'poor_work', 'safety_or_behaviour', 'asked_money_off_platform', 'other'))
);

alter table public.user_warnings enable row level security;
create policy user_warnings_no_api on public.user_warnings for select to authenticated using (false);
revoke all on table public.user_warnings from anon, authenticated, service_role;

create index user_warnings_user_idx on public.user_warnings (user_id, created_at) where acknowledged_at is null;
create index user_warnings_user_all_idx on public.user_warnings (user_id);
create index user_warnings_report_idx on public.user_warnings (report_id);
create index user_warnings_created_by_idx on public.user_warnings (created_by);
create index user_warnings_region_idx on public.user_warnings (region);

-- X-3: report_photo_allowed looks for a fresh view row by one admin, on every signed link.
create index audit_log_report_photo_viewed_idx
  on public.audit_log (actor_id, created_at)
  where action = 'report.photo_viewed';

-- X-24: one update only, open to handled, the handled columns set together, once; nothing else ever changes.
create function public.problem_reports_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'report_immutable';
  end if;
  if (to_jsonb(new) - array['status', 'outcome', 'admin_note', 'handled_by', 'handled_at', 'fee_refund_id'])
     is distinct from (to_jsonb(old) - array['status', 'outcome', 'admin_note', 'handled_by', 'handled_at', 'fee_refund_id'])
     or not (old.status = 'open' and new.status = 'handled') then
    raise exception 'report_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.problem_reports_guard() from public, anon, authenticated, service_role;

create trigger problem_reports_guard before update or delete on public.problem_reports
  for each row execute function public.problem_reports_guard();
create trigger problem_reports_no_truncate before truncate on public.problem_reports
  for each statement execute function public.problem_reports_guard();

-- A registered photo never changes. (21's retention job deletes as the database owner.)
create function public.report_photos_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  raise exception 'report_photo_immutable';
end;
$$;

revoke all on function public.report_photos_guard() from public, anon, authenticated, service_role;

create trigger report_photos_guard before update on public.report_photos
  for each row execute function public.report_photos_guard();

-- A warning is acknowledged once; nothing else changes and it is never deleted.
create function public.user_warnings_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'warning_immutable';
  end if;
  if (to_jsonb(new) - 'acknowledged_at') is distinct from (to_jsonb(old) - 'acknowledged_at')
     or not (old.acknowledged_at is null and new.acknowledged_at is not null) then
    raise exception 'warning_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.user_warnings_guard() from public, anon, authenticated, service_role;

create trigger user_warnings_guard before update or delete on public.user_warnings
  for each row execute function public.user_warnings_guard();
create trigger user_warnings_no_truncate before truncate on public.user_warnings
  for each statement execute function public.user_warnings_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The guards (R-5, X-13), replaced whole. Every rule of 12 stays word for word; the return to work and the
--    confirm deadline reset are added.
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
  -- R-1 of 12: the moves of 04 to 11, plus the reopens, the carried re-pick and the cancels of 12; 14's return to
  -- work (X-13).
  if new.status is distinct from old.status
     and not ((old.status = 'OPEN' and new.status in ('CANCELLED', 'SELECTED', 'COMMISSION_PAID'))
              or (old.status = 'SELECTED' and new.status in ('CANCELLED', 'COMMISSION_PAID', 'OPEN'))
              or (old.status = 'COMMISSION_PAID' and new.status in ('UNLOCKED', 'OPEN', 'CANCELLED'))
              or (old.status = 'UNLOCKED' and new.status in ('IN_PROGRESS', 'COMPLETED', 'CANCELLED'))
              or (old.status = 'IN_PROGRESS' and new.status in ('AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED'))
              or (old.status = 'AWAITING_CONFIRMATION' and new.status in ('COMPLETED', 'IN_PROGRESS'))) then
    raise exception 'request_transition_invalid';
  end if;
  -- R-5 of 14: the return to work clears the done time and the confirm deadline in the same update.
  if old.status = 'AWAITING_CONFIRMATION' and new.status = 'IN_PROGRESS'
     and not (new.actual_completed_at is null and new.confirm_deadline is null) then
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
  -- X-13: the done time goes to null only on the return to work.
  if new.actual_completed_at is distinct from old.actual_completed_at
     and not (old.actual_completed_at is null and new.actual_completed_at is not null
              and ((old.status = 'IN_PROGRESS' and new.status = 'AWAITING_CONFIRMATION')
                   or (old.status in ('UNLOCKED', 'IN_PROGRESS') and new.status = 'COMPLETED')))
     and not (new.actual_completed_at is null
              and old.status = 'AWAITING_CONFIRMATION' and new.status = 'IN_PROGRESS') then
    raise exception 'request_immutable';
  end if;
  -- X-13: the confirm deadline is set on Done, cleared only on the return to work, and moved only later (past both
  -- the old value and now) while the status stays AWAITING_CONFIRMATION.
  if new.confirm_deadline is distinct from old.confirm_deadline
     and not (old.confirm_deadline is null and new.confirm_deadline is not null
              and old.status = 'IN_PROGRESS' and new.status = 'AWAITING_CONFIRMATION')
     and not (new.confirm_deadline is null
              and old.status = 'AWAITING_CONFIRMATION' and new.status = 'IN_PROGRESS')
     and not (old.status = 'AWAITING_CONFIRMATION' and new.status = 'AWAITING_CONFIRMATION'
              and old.confirm_deadline is not null and new.confirm_deadline is not null
              and new.confirm_deadline > old.confirm_deadline and new.confirm_deadline > now()) then
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
  -- 11's work moves (R-4 of 11), plus the cancels of an unlocked or started job (12), plus 14's return to work
  -- (COMPLETED -> STARTED, X-13).
  if new.status is distinct from old.status
     and (old.status in ('UNLOCKED', 'STARTED', 'COMPLETED') or new.status in ('STARTED', 'COMPLETED', 'CONFIRMED'))
     and not ((old.status = 'UNLOCKED' and new.status in ('STARTED', 'CONFIRMED', 'CANCELLED'))
              or (old.status = 'STARTED' and new.status in ('COMPLETED', 'CONFIRMED', 'CANCELLED'))
              or (old.status = 'COMPLETED' and new.status in ('CONFIRMED', 'STARTED'))) then
    raise exception 'application_transition_invalid';
  end if;
  return new;
end;
$$;

revoke all on function public.applications_guard() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Who may report (R-1, R-2). Internal readers, no API grant.
-- ═══════════════════════════════════════════════════════════════════════════

-- The other party of a request for this user, with the user's side, or nothing when the user is not a party: the
-- customer, or the provider of the selected application once it was unlocked (after the reveal it never changes).
create function public.report_party(p_request public.requests, p_user uuid)
  returns table (side text, against_id uuid)
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select case when p_request.customer_id = p_user then 'customer' else 'provider' end,
         case when p_request.customer_id = p_user then a.provider_id else p_request.customer_id end
    from public.applications a
   where a.id = p_request.selected_application_id
     and a.unlocked_at is not null
     and p_user is not null
     and (p_request.customer_id = p_user or a.provider_id = p_user)
     and a.provider_id <> p_request.customer_id
$$;

revoke all on function public.report_party(public.requests, uuid) from public, anon, authenticated, service_role;

-- R-2: open while the job runs, and after a close until closed_at + report_window_days.
create function public.report_window_open(p_request public.requests, p_window_days integer)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select p_request.status in ('UNLOCKED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION')
         or (p_request.status in ('COMPLETED', 'CANCELLED') and p_request.closed_at is not null
             and now() < p_request.closed_at + make_interval(days => p_window_days))
$$;

revoke all on function public.report_window_open(public.requests, integer) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The parties' functions (AC-1, AC-2, AC-6, AC-7).
-- ═══════════════════════════════════════════════════════════════════════════

create function public.open_report(p_request_id uuid, p_reason text, p_text text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_req      public.requests%rowtype;
  v_side     text;
  v_against  uuid;
  v_set      jsonb;
  v_text     text;
  v_id       uuid;
  v_count    integer;
begin
  if v_uid is null then
    raise exception 'not_allowed';
  end if;
  select r.* into v_req from public.requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'not_allowed';
  end if;
  select p.side, p.against_id into v_side, v_against from public.report_party(v_req, v_uid) p;
  if v_side is null then
    raise exception 'not_allowed';
  end if;
  v_set := public.report_settings(v_req.region);
  if not public.report_window_open(v_req, (v_set ->> 'report_window_days')::integer) then
    raise exception 'not_allowed';
  end if;
  -- R-3: the byte cap first, then the trim, then the length. No contact scanner: both sides hold each other's
  -- contacts already, and only admin reads the text.
  if p_reason is null
     or p_reason not in ('no_show', 'did_not_pay_cash', 'poor_work', 'safety_or_behaviour', 'asked_money_off_platform',
                         'other')
     or p_text is null or octet_length(p_text) > 4000 then
    raise exception 'validation_failed';
  end if;
  v_text := public.catalog_trim(p_text);
  if char_length(v_text) not between 20 and 1000 then
    raise exception 'validation_failed';
  end if;
  -- R-4: the reporter's profile row serialises one person's reports across requests.
  perform 1 from public.profiles p where p.id = v_uid for update;
  if exists (select 1 from public.problem_reports x
              where x.request_id = v_req.id and x.reporter_id = v_uid and x.status = 'open') then
    raise exception 'report_open';
  end if;
  -- X-16: at most 2 reports per (request, reporter) in total.
  select count(*) into v_count from public.problem_reports x where x.request_id = v_req.id and x.reporter_id = v_uid;
  if v_count >= 2 then
    raise exception 'report_limit';
  end if;
  select count(*) into v_count from public.problem_reports x
   where x.reporter_id = v_uid and x.created_at > now() - interval '24 hours';
  if v_count >= (v_set ->> 'reports_per_user_day')::integer then
    raise exception 'too_many_reports';
  end if;
  insert into public.problem_reports (region, request_id, reporter_id, against_id, side, reason, text)
  values (v_req.region, v_req.id, v_uid, v_against, v_side, p_reason, v_text)
  returning id into v_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'report.opened', 'problem_reports', v_id::text, v_req.region, null,
          jsonb_build_object('request_id', v_req.id, 'reason', p_reason, 'side', v_side));
  return jsonb_build_object('status', 'ok', 'report_id', v_id);
end;
$$;

revoke all on function public.open_report(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.open_report(uuid, text, text) to authenticated;

-- X-5: the one name a report photo may have: <region>/<report id>/<uuid>.jpg, the region the report's own.
create function public.report_photo_name_ok(p_report public.problem_reports, p_name text)
  returns boolean
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select p_name is not null
         and p_name ~ '^[A-Z]{2,3}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
         and split_part(p_name, '/', 1) = p_report.region
         and split_part(p_name, '/', 2) = p_report.id::text
$$;

revoke all on function public.report_photo_name_ok(public.problem_reports, text) from public, anon, authenticated, service_role;

-- AC-2, X-4, X-6: may this user store this object? The reporter, under an open report's own folder, while the folder
-- holds fewer than 3 objects (registered photos, plus objects not registered yet that are younger than 24 hours).
create function public.report_photo_store_allowed(p_user uuid, p_name text)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_rep  public.problem_reports%rowtype;
  v_id   text := split_part(coalesce(p_name, ''), '/', 2);
begin
  if p_user is null
     or v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  select x.* into v_rep from public.problem_reports x where x.id = v_id::uuid;
  if not found or v_rep.reporter_id <> p_user or v_rep.status <> 'open'
     or not public.report_photo_name_ok(v_rep, p_name) then
    return false;
  end if;
  return (
    select count(*) < 3
      from storage.objects o
     where o.bucket_id = 'report-photos'
       and o.name like v_rep.region || '/' || v_rep.id::text || '/%'
       and (o.created_at > now() - interval '24 hours'
            or exists (select 1 from public.report_photos p where p.object_path = o.name collate "C"))
  );
end;
$$;

revoke all on function public.report_photo_store_allowed(uuid, text) from public, anon, authenticated, service_role;

-- R-15, X-3: the storage policies' one check, run as the caller. A write: the store rule above. A read: the reporter
-- of the photo's report, or an admin with a report.photo_viewed row for this object and path from the last 2 minutes.
create function public.report_photo_allowed(p_name text, p_write boolean)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_photo  public.report_photos%rowtype;
  v_object uuid;
  v_id     text := split_part(coalesce(p_name, ''), '/', 2);
begin
  if v_uid is null or p_name is null then
    return false;
  end if;
  if coalesce(p_write, true) then
    return public.report_photo_store_allowed(v_uid, p_name);
  end if;
  -- The reporter reads every object under their own report's folder (Storage reads back the row it inserts, before
  -- add_report_photo registers it).
  if v_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (select 1 from public.problem_reports x
                  where x.id = v_id::uuid and x.reporter_id = v_uid and public.report_photo_name_ok(x, p_name)) then
    return true;
  end if;
  select p.* into v_photo from public.report_photos p where p.object_path = p_name collate "C";
  if not found then
    return false;
  end if;
  select o.id into v_object from storage.objects o where o.bucket_id = 'report-photos' and o.name = p_name;
  return public.is_admin()
         and v_object is not null
         and v_object = v_photo.object_id
         and exists (
           select 1 from public.audit_log a
            where a.action = 'report.photo_viewed'
              and a.actor_id = v_uid
              and a.created_at > now() - interval '2 minutes'
              and a.new_value ->> 'object_id' = v_object::text
              and a.new_value ->> 'path' = p_name
         );
end;
$$;

revoke all on function public.report_photo_allowed(text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.report_photo_allowed(text, boolean) to authenticated;

-- AC-2, X-5, X-25: register an uploaded photo. The reporter only, the report open, the object present with the
-- type and size Storage recorded (never the client's word), at most 3 under the report row lock.
create function public.add_report_photo(p_report_id uuid, p_object_path text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_rep    public.problem_reports%rowtype;
  v_obj    record;
  v_id     uuid;
  v_count  integer;
begin
  select x.* into v_rep from public.problem_reports x where x.id = p_report_id;
  if not found or v_uid is null or v_rep.reporter_id <> v_uid then
    raise exception 'not_allowed';
  end if;
  -- Umbrella order: the request first, then the report.
  perform 1 from public.requests r where r.id = v_rep.request_id for update;
  select x.* into v_rep from public.problem_reports x where x.id = p_report_id for update;
  select p.id into v_id from public.report_photos p
   where p.report_id = v_rep.id and p.object_path = p_object_path collate "C";
  if found then
    return jsonb_build_object('status', 'ok', 'photo_id', v_id, 'replayed', true);
  end if;
  if v_rep.status <> 'open' then
    raise exception 'not_allowed';
  end if;
  if not public.report_photo_name_ok(v_rep, p_object_path) then
    raise exception 'file_invalid';
  end if;
  select count(*) into v_count from public.report_photos p where p.report_id = v_rep.id;
  if v_count >= 3 then
    raise exception 'too_many_photos';
  end if;
  select o.id, o.metadata into v_obj from storage.objects o
   where o.bucket_id = 'report-photos' and o.name = p_object_path;
  if v_obj.id is null
     or v_obj.metadata ->> 'mimetype' is distinct from 'image/jpeg'
     or coalesce((v_obj.metadata ->> 'size')::bigint, 0) not between 1 and 10485760 then
    raise exception 'file_invalid';
  end if;
  insert into public.report_photos (region, report_id, object_id, object_path)
  values (v_rep.region, v_rep.id, v_obj.id, p_object_path)
  returning id into v_id;
  return jsonb_build_object('status', 'ok', 'photo_id', v_id, 'replayed', false);
end;
$$;

revoke all on function public.add_report_photo(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.add_report_photo(uuid, text) to authenticated;

-- AC-7: what the caller may know about their own report on a request: whether they can report now, and their latest
-- report's state. Never the outcome, the note or the other side's report.
create function public.my_report(p_request_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_req    public.requests%rowtype;
  v_side   text;
  v_set    jsonb;
  v_rep    public.problem_reports%rowtype;
  v_count  integer;
  v_can    boolean := false;
begin
  select r.* into v_req from public.requests r where r.id = p_request_id;
  if not found then
    raise exception 'not_found';
  end if;
  select p.side into v_side from public.report_party(v_req, v_uid) p;
  if v_side is null then
    raise exception 'not_found';
  end if;
  select x.* into v_rep from public.problem_reports x
   where x.request_id = v_req.id and x.reporter_id = v_uid
   order by x.created_at desc, x.id desc
   limit 1;
  select count(*) into v_count from public.problem_reports x where x.request_id = v_req.id and x.reporter_id = v_uid;
  begin
    v_set := public.report_settings(v_req.region);
    v_can := public.report_window_open(v_req, (v_set ->> 'report_window_days')::integer)
             and v_count < 2
             and (v_rep.id is null or v_rep.status <> 'open');
  exception when others then
    v_can := false;
  end;
  return jsonb_build_object(
    'can_report', v_can,
    'side', v_side,
    'report', case when v_rep.id is null then null
                   else jsonb_build_object('id', v_rep.id, 'status', v_rep.status, 'reason', v_rep.reason,
                                           'created_at', v_rep.created_at, 'handled_at', v_rep.handled_at,
                                           'photos', (select count(*) from public.report_photos p
                                                       where p.report_id = v_rep.id)) end);
end;
$$;

revoke all on function public.my_report(uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_report(uuid) to authenticated;

-- AC-6: the caller's oldest warning not acknowledged yet, or null.
create function public.my_warning()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select (select jsonb_build_object('id', w.id, 'reason', w.reason, 'created_at', w.created_at)
            from public.user_warnings w
           where w.user_id = (select auth.uid()) and w.acknowledged_at is null
           order by w.created_at, w.id
           limit 1)
$$;

revoke all on function public.my_warning() from public, anon, authenticated, service_role;
grant execute on function public.my_warning() to authenticated;

create function public.acknowledge_warning(p_warning_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_w  public.user_warnings%rowtype;
begin
  select w.* into v_w from public.user_warnings w
   where w.id = p_warning_id and w.user_id = (select auth.uid())
     for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_w.acknowledged_at is not null then
    return jsonb_build_object('status', 'ok', 'replayed', true);
  end if;
  update public.user_warnings set acknowledged_at = now() where id = v_w.id;
  return jsonb_build_object('status', 'ok', 'replayed', false);
end;
$$;

revoke all on function public.acknowledge_warning(uuid) from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_warning(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Admin (AC-4, AC-5, X-21, X-22). is_admin() inside each.
-- ═══════════════════════════════════════════════════════════════════════════

-- X-21: the queue, 20 a page. Open oldest first; handled newest handled first.
create function public.admin_reports(p_tab text, p_page integer)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_page   integer := greatest(coalesce(p_page, 1), 1);
  v_rows   jsonb;
  v_total  integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_tab is null or p_tab not in ('open', 'handled') or v_page > 10000 then
    raise exception 'validation_failed';
  end if;
  select count(*) into v_total from public.problem_reports x where x.status = p_tab;
  select coalesce(jsonb_agg(t.row_json order by t.ord), '[]'::jsonb) into v_rows
    from (
      select jsonb_build_object(
               'id', x.id, 'created_at', x.created_at, 'region', x.region, 'reason', x.reason, 'side', x.side,
               'request_id', x.request_id,
               'service', (select s.name from public.requests r join public.services s on s.id = r.service_id
                            where r.id = x.request_id),
               'status', x.status, 'outcome', x.outcome, 'handled_at', x.handled_at) as row_json,
             row_number() over (order by
               case when p_tab = 'open' then x.created_at end asc,
               case when p_tab = 'handled' then x.handled_at end desc,
               x.id) as ord
        from public.problem_reports x
       where x.status = p_tab
       order by ord
       limit 20 offset (v_page - 1) * 20
    ) t;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;

revoke all on function public.admin_reports(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_reports(text, integer) to authenticated;

create function public.admin_reports_open_count()
  returns integer
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  return (select count(*)::integer from public.problem_reports x where x.status = 'open');
end;
$$;

revoke all on function public.admin_reports_open_count() from public, anon, authenticated, service_role;
grant execute on function public.admin_reports_open_count() to authenticated;

-- X-22: the report, both parties with their past counts (this report left out), and the photo list. The request,
-- its fees and refunds come from 12's admin_request_detail.
create function public.admin_report_detail(p_report_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_rep  public.problem_reports%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select x.* into v_rep from public.problem_reports x where x.id = p_report_id;
  if not found then
    raise exception 'not_found';
  end if;
  return jsonb_build_object(
    'report', jsonb_build_object(
      'id', v_rep.id, 'region', v_rep.region, 'request_id', v_rep.request_id, 'reporter_id', v_rep.reporter_id,
      'against_id', v_rep.against_id, 'side', v_rep.side, 'reason', v_rep.reason, 'text', v_rep.text,
      'status', v_rep.status, 'outcome', v_rep.outcome, 'admin_note', v_rep.admin_note,
      'handled_by', v_rep.handled_by, 'handled_at', v_rep.handled_at, 'fee_refund_id', v_rep.fee_refund_id,
      'created_at', v_rep.created_at),
    'parties', (select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'role', p.role,
        'provider_status', (select pr.status from public.providers pr where pr.id = p.id),
        'is_reporter', p.id = v_rep.reporter_id,
        'filed', (select count(*) from public.problem_reports x where x.reporter_id = p.id and x.id <> v_rep.id),
        'against', (select count(*) from public.problem_reports x where x.against_id = p.id and x.id <> v_rep.id),
        'warnings', (select count(*) from public.user_warnings w
                      where w.user_id = p.id and w.report_id is distinct from v_rep.id))
        order by (p.id = v_rep.reporter_id) desc)
      from public.profiles p where p.id in (v_rep.reporter_id, v_rep.against_id)),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'created_at', ph.created_at)
                                         order by ph.created_at, ph.id)
                          from public.report_photos ph where ph.report_id = v_rep.id), '[]'::jsonb));
end;
$$;

revoke all on function public.admin_report_detail(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_report_detail(uuid) to authenticated;

-- AC-4, X-3: one admin view of one photo, recorded; the server signs the link only after this row exists.
create function public.log_report_photo_view(p_photo_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_photo  public.report_photos%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select p.* into v_photo from public.report_photos p where p.id = p_photo_id;
  if not found then
    raise exception 'not_found';
  end if;
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'report-photos' and o.name = v_photo.object_path and o.id = v_photo.object_id) then
    raise exception 'file_missing';
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, new_value)
  values ((select auth.uid()), 'report.photo_viewed', 'report_photos', v_photo.id::text, v_photo.region,
          jsonb_build_object('object_id', v_photo.object_id, 'path', v_photo.object_path, 'report_id', v_photo.report_id));
  return jsonb_build_object('bucket', 'report-photos', 'path', v_photo.object_path);
end;
$$;

revoke all on function public.log_report_photo_view(uuid) from public, anon, authenticated, service_role;
grant execute on function public.log_report_photo_view(uuid) to authenticated;

-- AC-5 with R-9 to R-12 and X-1, X-2, X-14, X-17 to X-20. The note is checked before any inner call; every lock is
-- taken in one ascending pass over the requests before the report row; the inner functions' own refusals pass
-- through (and roll the whole handle back), except suspend_provider's not_approved, which reads already_suspended.
create function public.handle_report(p_report_id uuid, p_outcome text, p_note text,
                                     p_refund_payment_id uuid default null, p_warning_reason text default null)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_note     text := public.catalog_trim(coalesce(p_note, ''));
  v_rep      public.problem_reports%rowtype;
  v_req      public.requests%rowtype;
  v_reason   text;
  v_id       uuid;
  v_app      public.applications%rowtype;
  v_refund   jsonb;
  v_ref_id   uuid;
  v_hours    integer;
  v_new_dl   timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_outcome is null or p_outcome not in ('no_action', 'warned', 'suspended', 'returned_to_work', 'job_closed') then
    raise exception 'invalid_outcome';
  end if;
  -- R-12, X-14: 10 to 500 characters, so neither admin_refund_fee nor suspend_provider refuses it from inside.
  if char_length(v_note) not between 10 and 500 then
    raise exception 'validation_failed';
  end if;
  if p_warning_reason is not null
     and p_warning_reason not in ('no_show', 'did_not_pay_cash', 'poor_work', 'safety_or_behaviour',
                                  'asked_money_off_platform', 'other') then
    raise exception 'validation_failed';
  end if;
  select x.* into v_rep from public.problem_reports x where x.id = p_report_id;
  if not found then
    raise exception 'not_found';
  end if;
  -- X-1: one ascending pass: the report's request, plus for a suspension every request suspend_provider will lock.
  for v_id in
    select v_rep.request_id
    union
    select a.request_id from public.applications a
     where p_outcome = 'suspended' and a.provider_id = v_rep.against_id
       and a.status in ('APPLIED', 'SELECTED', 'AWAITING_FEE', 'UNLOCKED', 'STARTED', 'COMPLETED')
    order by 1
  loop
    perform 1 from public.requests r where r.id = v_id for update;
  end loop;
  select x.* into v_rep from public.problem_reports x where x.id = p_report_id for update;
  if v_rep.status <> 'open' then
    raise exception 'already_handled';
  end if;
  select r.* into v_req from public.requests r where r.id = v_rep.request_id;
  v_reason := coalesce(p_warning_reason, v_rep.reason);

  case p_outcome
    when 'warned' then
      insert into public.user_warnings (region, user_id, report_id, reason, created_by)
      values (v_rep.region, v_rep.against_id, v_rep.id, v_reason, v_uid);
    when 'suspended' then
      -- R-10: providers only.
      if v_rep.side <> 'customer'
         or not exists (select 1 from public.providers pr where pr.id = v_rep.against_id) then
        raise exception 'invalid_outcome';
      end if;
      if not exists (select 1 from public.providers pr where pr.id = v_rep.against_id and pr.status = 'approved') then
        raise exception 'already_suspended';
      end if;
      begin
        -- X-2: the provider reads suspension_reason, so a fixed code goes in, never the note.
        perform public.suspend_provider(v_rep.against_id, 'report:' || v_reason);
      exception when raise_exception then
        if sqlerrm = 'not_approved' then
          raise exception 'already_suspended';
        end if;
        raise;
      end;
    when 'returned_to_work' then
      if v_req.status <> 'AWAITING_CONFIRMATION' then
        raise exception 'invalid_state';
      end if;
      select a.* into v_app from public.applications a where a.id = v_req.selected_application_id for update;
      -- X-17: a suspended provider could never press Done again.
      if not exists (select 1 from public.providers pr where pr.id = v_app.provider_id and pr.status = 'approved') then
        raise exception 'provider_not_approved';
      end if;
      update public.requests
         set status = 'IN_PROGRESS', actual_completed_at = null, confirm_deadline = null
       where id = v_req.id;
      update public.applications set status = 'STARTED', status_changed_at = now() where id = v_app.id;
      -- X-18: 12's job may raise it again later by its own rule.
      perform public.clear_deadline_flags(v_req.id, array['completion_late']);
      insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
      values (v_uid, 'job.returned_to_work', 'requests', v_req.id::text, v_req.region,
              jsonb_build_object('status', 'AWAITING_CONFIRMATION'),
              jsonb_build_object('status', 'IN_PROGRESS', 'application_id', v_app.id, 'report_id', v_rep.id));
    when 'job_closed' then
      if v_req.status <> 'AWAITING_CONFIRMATION' then
        raise exception 'invalid_state';
      end if;
      perform public.close_job(v_req.id, 'admin', 'job.closed_by_admin');
    else
      null;
  end case;

  -- R-11: the optional refund, one of this request's fees.
  if p_refund_payment_id is not null then
    if not exists (select 1 from public.fee_payments f
                    where f.id = p_refund_payment_id and f.request_id = v_rep.request_id) then
      raise exception 'invalid_refund';
    end if;
    v_refund := public.admin_refund_fee(p_refund_payment_id, v_note);
    -- X-20: a replay returns the first refund's id; it is stored the same way.
    v_ref_id := (v_refund ->> 'fee_refund_id')::uuid;
  end if;

  -- AC-5: a job still waiting for confirmation gets a full window again (never a shorter one).
  select r.* into v_req from public.requests r where r.id = v_rep.request_id;
  if v_req.status = 'AWAITING_CONFIRMATION' then
    v_hours := public.confirm_settings(v_req.region);
    v_new_dl := now() + make_interval(hours => v_hours);
    if v_new_dl > v_req.confirm_deadline then
      update public.requests set confirm_deadline = v_new_dl where id = v_req.id;
    end if;
  end if;

  update public.problem_reports
     set status = 'handled', outcome = p_outcome, admin_note = v_note, handled_by = v_uid, handled_at = now(),
         fee_refund_id = v_ref_id
   where id = v_rep.id;
  -- R-12: ids, the reason code and the outcome; never the note or the report text.
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'report.handled', 'problem_reports', v_rep.id::text, v_rep.region,
          jsonb_build_object('status', 'open'),
          jsonb_build_object('request_id', v_rep.request_id, 'outcome', p_outcome, 'refund', v_ref_id,
                             'reason', v_reason));
  return jsonb_build_object('status', 'ok', 'outcome', p_outcome, 'fee_refund_id', v_ref_id);
end;
$$;

revoke all on function public.handle_report(uuid, text, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.handle_report(uuid, text, text, uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The bucket (AC-2, X-3 to X-6). Private, 10 MB, JPEG only. The policies name their bucket (supabase/tests/08);
--    there is no update or delete policy. The trigger repeats the insert rule for every API role (a policy does not
--    run for a service role write) and refuses any change to an object; a write by the database owner is left alone.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('report-photos', 'report-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

create policy report_photos_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = any (array['report-photos'])
    and public.report_photo_allowed(name, true)
  );

create policy report_photos_read
  on storage.objects for select
  to authenticated
  using (
    bucket_id = any (array['report-photos'])
    and public.report_photo_allowed(name, false)
  );

create function public.report_photos_storage_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_role  text := coalesce(current_setting('role', true), '');
  v_id    text;
begin
  if v_role not in ('authenticated', 'service_role', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.bucket_id <> 'report-photos' then
      return new;
    end if;
    v_id := split_part(coalesce(new.name, ''), '/', 2);
    if v_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      -- X-4: one upload at a time per report, so two cannot both pass the count.
      perform pg_advisory_xact_lock(hashtextextended('report-photos:' || v_id, 14));
    end if;
    -- Only the reporter, signed in: a service role write carries no user.
    if v_role <> 'authenticated'
       or not public.report_photo_store_allowed((select auth.uid()), new.name) then
      raise exception 'upload_refused' using errcode = '42501';
    end if;
    return new;
  end if;
  if (tg_op = 'UPDATE' and (old.bucket_id = 'report-photos' or new.bucket_id = 'report-photos'))
     or (tg_op = 'DELETE' and old.bucket_id = 'report-photos') then
    raise exception 'upload_refused' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.report_photos_storage_guard() from public, anon, authenticated, service_role;

create trigger report_photos_storage_guard
  before insert or update or delete on storage.objects
  for each row execute function public.report_photos_storage_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The auto close (R-6), replaced: 11's body plus the open report filter.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.auto_close_jobs()
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_id      uuid;
  v_closed  integer := 0;
begin
  for v_id in
    select r.id from public.requests r
     where r.status = 'AWAITING_CONFIRMATION' and r.confirm_deadline <= now()
       and public.auto_close_enabled(r.region)
       and not exists (select 1 from public.problem_reports p
                        where p.request_id = r.id and p.status = 'open')
     order by r.confirm_deadline, r.id
     limit 200
     for update skip locked
  loop
    begin
      perform public.close_job(v_id, 'auto', 'job.auto_closed');
      v_closed := v_closed + 1;
    exception when others then
      -- Security review S11-3: one bad row never stops the rest, and it is reported (the database log, with the
      -- request id and the SQLSTATE only); it is tried again next run.
      raise warning 'auto_close_failed request=% sqlstate=%', v_id, sqlstate;
    end;
  end loop;
  return v_closed;
end;
$$;

revoke all on function public.auto_close_jobs() from public, anon, authenticated, service_role;

-- AC-3: 11's close info plus one field: the caller's own report on the request is open, so the close waits for admin.
create or replace function public.request_close_info(p_request_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_req  public.requests%rowtype;
begin
  select r.* into v_req from public.requests r
   where r.id = p_request_id and r.customer_id = (select auth.uid());
  if not found then
    raise exception 'not_found';
  end if;
  return jsonb_build_object(
    'auto_close_enabled', public.auto_close_enabled(v_req.region),
    'can_mark_done', v_req.status in ('UNLOCKED', 'IN_PROGRESS') and public.start_day_reached(v_req.id),
    'my_report_open', exists (select 1 from public.problem_reports p
                               where p.request_id = v_req.id and p.reporter_id = v_req.customer_id
                                 and p.status = 'open'));
end;
$$;

revoke all on function public.request_close_info(uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_close_info(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Mail (R-7, R-8, X-7, X-9 to X-11, X-15). 13's functions, replaced, each with the change named.
-- ═══════════════════════════════════════════════════════════════════════════

-- X-9: the template list gains the three report mails.
create or replace function public.queue_email(p_key text, p_template text, p_recipient uuid, p_request uuid, p_entity uuid,
                                              p_send_until timestamptz, p_region text, p_topic text default null,
                                              p_token text default null)
  returns uuid
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_id  uuid;
begin
  if p_key is null or char_length(p_key) not between 1 and 300 or p_send_until is null or p_region is null
     or p_template is null
     or p_template not in ('new_offer', 'chosen', 'pay_your_fee', 'commission_received', 'contacts_ready', 'job_started',
                           'please_confirm', 'job_completed', 'request_cancelled', 'pick_again', 'pick_ended',
                           'window_missed', 'payment_too_late', 'fee_refunded', 'confirm_email', 'account_approved',
                           'account_rejected', 'account_suspended', 'pay_window_closing', 'closes_soon',
                           'report_received', 'report_new_admin', 'report_handled') then
    raise exception 'validation_failed';
  end if;
  if p_recipient is null then
    return null;
  end if;
  if p_template <> 'confirm_email'
     and not exists (select 1 from public.profiles p
                      where p.id = p_recipient and p.email is not null and p.email_confirmed_at is not null) then
    return null;
  end if;
  -- AC-4: no row means on.
  if p_topic is not null
     and exists (select 1 from public.notification_preferences n
                  where n.user_id = p_recipient and n.topic = p_topic and not n.email_enabled) then
    return null;
  end if;
  insert into public.outbox_events (region, kind, idempotency_key, payload)
  values (p_region, 'email.send', p_key,
          jsonb_build_object('template', p_template, 'recipient_id', p_recipient, 'request_id', p_request,
                             'entity_id', p_entity, 'send_until', p_send_until)
          || case when p_token is null then '{}'::jsonb else jsonb_build_object('token', p_token) end)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.queue_email(text, text, uuid, uuid, uuid, timestamptz, text, text, text)
  from public, anon, authenticated, service_role;

-- R-8, X-10, X-11, X-15: 13's map plus the report rows, which come before the request lookup (the audit row names
-- the report), and job.closed_by_admin, mapped as job.confirmed.
create or replace function public.queue_audit_email(p_audit_id bigint)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_a       public.audit_log%rowtype;
  v_req     public.requests%rowtype;
  v_ref     public.fee_refunds%rowtype;
  v_rep     public.problem_reports%rowtype;
  v_admin   uuid;
  v_app     uuid;
  v_prov    uuid;
  v_payer   uuid;
  v_request uuid;
  v_fee     uuid;
  v_day     timestamptz := now() + interval '24 hours';
  v_n       integer := 0;
begin
  select a.* into v_a from public.audit_log a where a.id = p_audit_id;
  if not found or v_a.region is null or not public.emails_enabled(v_a.region) then
    return 0;
  end if;
  perform public.email_settings(v_a.region);

  -- The address and the account.
  if v_a.action = 'profile.email_changed' then
    if v_a.new_value ->> 'email' is not null and public.start_email_confirmation(v_a.entity_id::uuid) = 'queued' then
      perform public.relay_kick('email');
      return 1;
    end if;
    return 0;
  end if;
  if v_a.action in ('provider.approved', 'provider.reinstated', 'provider.rejected', 'provider.suspended') then
    return public.queue_audit_mail(v_a.id, v_a.region, v_a.entity_id::uuid,
                                   case v_a.action when 'provider.rejected' then 'account_rejected'
                                                   when 'provider.suspended' then 'account_suspended'
                                                   else 'account_approved' end,
                                   null, v_a.entity_id::uuid, v_day);
  end if;

  -- The reports (R-8, X-10, X-11): the reporter, and for a new report every admin of the report's region. The
  -- reported party gets no mail from the report (X-20).
  if v_a.action in ('report.opened', 'report.handled') then
    select x.* into v_rep from public.problem_reports x where x.id = v_a.entity_id::uuid;
    if not found then
      return 0;
    end if;
    if v_a.action = 'report.handled' then
      return public.queue_audit_mail(v_a.id, v_a.region, v_rep.reporter_id, 'report_handled', v_rep.request_id,
                                     v_rep.id, v_day);
    end if;
    v_n := public.queue_audit_mail(v_a.id, v_a.region, v_rep.reporter_id, 'report_received', v_rep.request_id,
                                   v_rep.id, v_day);
    for v_admin in
      select p.id from public.profiles p where p.role = 'admin' and p.region = v_rep.region order by p.id
    loop
      v_n := v_n + public.queue_audit_mail(v_a.id, v_a.region, v_admin, 'report_new_admin', v_rep.request_id,
                                           v_rep.id, v_day);
    end loop;
    return v_n;
  end if;

  -- The fees (the payer, X-7). fee.late names the fee; its late refund is in new_value.
  if v_a.action = 'fee.late' then
    select f.payer_id, f.request_id into v_payer, v_request from public.fee_payments f where f.id = v_a.entity_id::uuid;
    return public.queue_audit_mail(v_a.id, v_a.region, v_payer, 'payment_too_late', v_request,
                                   (v_a.new_value ->> 'fee_refund_id')::uuid, v_day);
  end if;
  if v_a.action in ('fee.refunded', 'fee.refund_done_by_hand') then
    select x.* into v_ref from public.fee_refunds x where x.id = v_a.entity_id::uuid;
    if not found then
      return 0;
    end if;
    if v_ref.fee_payment_id is not null then
      select f.payer_id into v_payer from public.fee_payments f where f.id = v_ref.fee_payment_id;
    else
      -- A late refund has no fee row: its payer is the payer of the fee whose fee.late row names it.
      select f.payer_id into v_payer
        from public.audit_log l
        join public.fee_payments f on f.id::text = l.entity_id
       where l.action = 'fee.late' and l.entity_type = 'fee_payments' and l.new_value ->> 'fee_refund_id' = v_ref.id::text
       order by l.id desc
       limit 1;
    end if;
    return public.queue_audit_mail(v_a.id, v_a.region, v_payer, 'fee_refunded', v_ref.request_id, v_ref.id, v_day);
  end if;

  -- The request moves: the audit row names the request.
  select r.* into v_req from public.requests r where r.id = v_a.entity_id::uuid;
  if not found then
    return 0;
  end if;
  v_app := (v_a.new_value ->> 'application_id')::uuid;
  select a.provider_id into v_prov from public.applications a where a.id = v_app;

  case v_a.action
    when 'request.provider_chosen' then
      if v_a.new_value ->> 'status' = 'COMMISSION_PAID' then
        -- A carried commission (12): the new pick pays at once.
        v_n := public.queue_audit_mail(v_a.id, v_a.region, v_prov, 'pay_your_fee', v_req.id, v_app,
                                       coalesce(v_req.fee_deadline, v_day));
      else
        v_n := public.queue_audit_mail(v_a.id, v_a.region, v_prov, 'chosen', v_req.id, v_app, v_day);
      end if;
    when 'request.commission_paid' then
      select f.id into v_fee from public.fee_payments f where f.request_id = v_req.id and f.kind = 'commission';
      v_n := public.queue_audit_mail(v_a.id, v_a.region, v_req.customer_id, 'commission_received', v_req.id, v_fee, v_day)
           + public.queue_audit_mail(v_a.id, v_a.region, v_prov, 'pay_your_fee', v_req.id, v_app,
                                     coalesce(v_req.fee_deadline, v_day));
    when 'request.unlocked' then
      v_n := public.queue_audit_mail(v_a.id, v_a.region, v_req.customer_id, 'contacts_ready', v_req.id, v_app, v_day)
           + public.queue_audit_mail(v_a.id, v_a.region, v_prov, 'contacts_ready', v_req.id, v_app, v_day);
    when 'job.started' then
      v_n := public.queue_audit_mail(v_a.id, v_a.region, v_req.customer_id, 'job_started', v_req.id, v_app, v_day,
                                     'work_updates');
    when 'job.done' then
      v_n := public.queue_audit_mail(v_a.id, v_a.region, v_req.customer_id, 'please_confirm', v_req.id, v_app,
                                     case when public.auto_close_enabled(v_a.region)
                                          then coalesce(v_req.confirm_deadline, v_day) else v_day end);
    when 'job.confirmed', 'job.customer_closed', 'job.auto_closed', 'job.closed_by_admin' then
      v_n := public.queue_audit_mail(v_a.id, v_a.region, v_prov, 'job_completed', v_req.id, v_app, v_day, 'work_updates');
    when 'request.cancelled' then
      -- The customer cancelled: the provider of the pick, when there is one (the cancel keeps the column).
      v_app := v_req.selected_application_id;
      v_prov := null;
      select a.provider_id into v_prov from public.applications a where a.id = v_app;
      v_n := public.queue_audit_mail(v_a.id, v_a.region, v_prov, 'request_cancelled', v_req.id, v_app, v_day);
    when 'request.provider_cancelled', 'request.failed_picks_limit', 'request.no_paid_pick' then
      -- The customer, with the commission refund when the cancel queued one.
      v_n := public.queue_audit_mail(v_a.id, v_a.region, v_req.customer_id, 'request_cancelled', v_req.id,
                                     (v_a.new_value ->> 'fee_refund_id')::uuid, v_day);
    when 'request.pick_expired' then
      v_n := public.queue_audit_mail(v_a.id, v_a.region, v_req.customer_id, 'pick_again', v_req.id, v_app, v_day)
           + public.queue_audit_mail(v_a.id, v_a.region, v_prov, 'pick_ended', v_req.id, v_app, v_day);
    when 'request.fee_expired' then
      v_n := public.queue_audit_mail(v_a.id, v_a.region, v_req.customer_id, 'pick_again', v_req.id, v_app, v_day)
           + public.queue_audit_mail(v_a.id, v_a.region, v_prov, 'window_missed', v_req.id, v_app, v_day);
    when 'request.provider_withdrew' then
      -- Only a withdrawn pick (new_value.request is `reopened` or `cancelled`), never an offer withdrawn.
      if coalesce(v_a.new_value ->> 'request', 'none') <> 'none' then
        v_n := public.queue_audit_mail(v_a.id, v_a.region, v_req.customer_id, 'pick_again', v_req.id, v_app, v_day);
      end if;
    when 'request.pick_dropped' then
      v_n := public.queue_audit_mail(v_a.id, v_a.region, v_req.customer_id, 'pick_again', v_req.id, v_app, v_day);
    else
      v_n := 0;
  end case;
  return v_n;
end;
$$;

revoke all on function public.queue_audit_email(bigint) from public, anon, authenticated, service_role;

-- AC-3 of 13, R-8, X-15: the when list is the map's actions; supabase/tests/29 proves the two are equal.
drop trigger audit_log_email on public.audit_log;
create trigger audit_log_email after insert on public.audit_log
  for each row
  when (new.action in ('request.provider_chosen', 'request.commission_paid', 'request.unlocked', 'job.started',
                       'job.done', 'job.confirmed', 'job.customer_closed', 'job.auto_closed', 'request.cancelled',
                       'request.provider_cancelled', 'request.failed_picks_limit', 'request.no_paid_pick',
                       'request.pick_expired', 'request.fee_expired', 'request.provider_withdrew', 'request.pick_dropped',
                       'fee.late', 'fee.refunded', 'fee.refund_done_by_hand', 'profile.email_changed',
                       'provider.approved', 'provider.reinstated', 'provider.rejected', 'provider.suspended',
                       'job.closed_by_admin', 'report.opened', 'report.handled'))
  execute function public.audit_log_email();

-- R-7, X-10, X-11: 13's send time reader plus the three report mails (the values add report_id and the reason code
-- only; side is null for an admin) and one condition on closes_soon: no open report on the request.
create or replace function public.email_context(p_outbox_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_o        public.outbox_events%rowtype;
  v_tpl      text;
  v_rcp      uuid;
  v_entity   uuid;
  v_until    timestamptz;
  v_prof     public.profiles%rowtype;
  v_reg      public.regions%rowtype;
  v_req      public.requests%rowtype;
  v_conf     public.email_confirmations%rowtype;
  v_rep      public.problem_reports%rowtype;
  v_email    text;
  v_side     text;
  v_ok       boolean := true;
  v_amount   bigint;
  v_cur      text;
  v_fee      uuid;
  v_dead     timestamptz;
  v_carried  boolean;
  v_values   jsonb;
begin
  if p_outbox_id is null then
    raise exception 'validation_failed';
  end if;
  select o.* into v_o from public.outbox_events o where o.id = p_outbox_id;
  if not found then
    raise exception 'not_found';
  end if;
  if v_o.kind <> 'email.send' or v_o.payload ->> 'template' is null or v_o.payload ->> 'recipient_id' is null then
    raise exception 'invalid_state';
  end if;
  v_tpl := v_o.payload ->> 'template';
  v_rcp := (v_o.payload ->> 'recipient_id')::uuid;
  v_entity := (v_o.payload ->> 'entity_id')::uuid;
  v_until := (v_o.payload ->> 'send_until')::timestamptz;

  if not public.emails_enabled(v_o.region) then
    return jsonb_build_object('status', 'skip', 'reason', 'email_off');
  end if;
  if v_until is null or v_until <= now() then
    return jsonb_build_object('status', 'skip', 'reason', 'stale');
  end if;
  select p.* into v_prof from public.profiles p where p.id = v_rcp;
  if not found then
    return jsonb_build_object('status', 'skip', 'reason', 'unconfirmed');
  end if;
  select g.* into v_reg from public.regions g where g.code = v_o.region;

  if v_tpl = 'confirm_email' then
    -- R-9: the confirmation still live and the address unchanged, else the mail is stale.
    select c.* into v_conf from public.email_confirmations c where c.id = v_entity and c.profile_id = v_rcp;
    if not found or v_conf.used_at is not null or v_conf.revoked_at is not null or v_conf.expires_at <= now()
       or v_prof.email is distinct from v_conf.email or v_o.payload ->> 'token' is null then
      return jsonb_build_object('status', 'skip', 'reason', 'stale');
    end if;
    v_email := v_conf.email;
    v_dead := v_conf.expires_at;
  else
    if v_prof.email is null or v_prof.email_confirmed_at is null then
      return jsonb_build_object('status', 'skip', 'reason', 'unconfirmed');
    end if;
    v_email := v_prof.email;
  end if;

  if v_o.payload ->> 'request_id' is not null then
    select r.* into v_req from public.requests r where r.id = (v_o.payload ->> 'request_id')::uuid;
    if not found then
      return jsonb_build_object('status', 'skip', 'reason', 'condition');
    end if;
    v_side := case when v_req.customer_id = v_rcp then 'customer' else 'provider' end;
    v_cur := v_req.currency;
  end if;

  case v_tpl
    when 'new_offer' then
      v_ok := v_req.status = 'OPEN';
    when 'chosen' then
      v_ok := v_req.status = 'SELECTED' and v_req.selected_application_id = v_entity;
    when 'pay_your_fee' then
      v_ok := v_req.status = 'COMMISSION_PAID' and v_req.selected_application_id = v_entity;
      select a.provider_fee_amount into v_amount from public.applications a where a.id = v_entity;
      v_dead := v_req.fee_deadline;
    when 'commission_received' then
      -- D171: a commission of 0 has no fee row, so 0 and no receipt.
      select f.id, f.amount, f.currency into v_fee, v_amount, v_cur
        from public.fee_payments f
       where f.id = v_entity and f.request_id = v_req.id and f.kind = 'commission';
      if v_fee is null then
        v_amount := 0;
        v_cur := v_req.currency;
      end if;
    when 'please_confirm' then
      v_ok := v_req.status = 'AWAITING_CONFIRMATION';
      if public.auto_close_enabled(v_o.region) then
        v_dead := v_req.confirm_deadline;
      end if;
    when 'request_cancelled' then
      if v_side = 'customer' and v_entity is not null then
        select x.amount, x.currency into v_amount, v_cur
          from public.fee_refunds x where x.id = v_entity and x.request_id = v_req.id;
        v_cur := coalesce(v_cur, v_req.currency);
      end if;
    when 'pick_again' then
      v_ok := v_req.status = 'OPEN';
      v_carried := public.carried_commission(v_req.id) is not null;
    when 'payment_too_late' then
      select x.amount, x.currency into v_amount, v_cur from public.fee_refunds x where x.id = v_entity;
      v_cur := coalesce(v_cur, v_req.currency);
    when 'fee_refunded' then
      select x.amount, x.currency, x.fee_payment_id into v_amount, v_cur, v_fee
        from public.fee_refunds x where x.id = v_entity;
      v_cur := coalesce(v_cur, v_req.currency);
    when 'pay_window_closing' then
      if v_side = 'customer' then
        v_ok := v_req.status = 'SELECTED' and v_req.selected_application_id = v_entity;
        v_dead := v_req.payment_deadline;
      else
        v_ok := v_req.status = 'COMMISSION_PAID' and v_req.selected_application_id = v_entity;
        v_dead := v_req.fee_deadline;
      end if;
    when 'closes_soon' then
      -- R-7: and no open report on the request (the close waits for admin).
      v_ok := v_req.status = 'AWAITING_CONFIRMATION'
              and not exists (select 1 from public.problem_reports p
                               where p.request_id = v_req.id and p.status = 'open');
      v_dead := v_req.confirm_deadline;
    when 'account_approved' then
      v_ok := exists (select 1 from public.providers pr where pr.id = v_rcp and pr.status = 'approved');
    when 'report_received' then
      select x.* into v_rep from public.problem_reports x where x.id = v_entity and x.reporter_id = v_rcp;
      v_ok := v_rep.id is not null;
    when 'report_handled' then
      select x.* into v_rep from public.problem_reports x where x.id = v_entity and x.reporter_id = v_rcp;
      v_ok := v_rep.id is not null and v_rep.status = 'handled';
    when 'report_new_admin' then
      select x.* into v_rep from public.problem_reports x where x.id = v_entity;
      v_ok := v_rep.id is not null and v_prof.role = 'admin';
      v_side := null;
    when 'contacts_ready', 'job_started', 'job_completed', 'pick_ended', 'window_missed', 'confirm_email',
         'account_rejected', 'account_suspended' then
      v_ok := true;
    else
      raise exception 'invalid_state';
  end case;

  if not coalesce(v_ok, false) then
    return jsonb_build_object('status', 'skip', 'reason', 'condition');
  end if;
  v_values := jsonb_build_object(
      'side', v_side,
      'request_id', v_req.id,
      'service', v_req.pricing_snapshot -> 'service' -> 'name',
      'start_at', v_req.scheduled_start_at,
      'deadline', v_dead,
      'amount', v_amount,
      'currency', v_cur,
      'fee_id', v_fee,
      'carried', v_carried,
      'token', case when v_tpl = 'confirm_email' then v_o.payload ->> 'token' end);
  if v_tpl in ('report_received', 'report_handled', 'report_new_admin') then
    v_values := v_values || jsonb_build_object('report_id', v_rep.id, 'reason', v_rep.reason);
  end if;
  return jsonb_build_object(
    'status', 'send',
    'template', v_tpl,
    'email', v_email,
    'locale', coalesce(v_prof.locale, v_reg.default_locale),
    'region_locale', v_reg.default_locale,
    'timezone', v_reg.timezone,
    'values', v_values);
end;
$$;

revoke all on function public.email_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.email_context(uuid) to service_role;

-- X-7: 13's reminders, the closes_soon key carrying the deadline (a reset deadline or a second Done gets its own
-- reminder), and nothing queued while a report is open on the request.
create or replace function public.queue_reminders()
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_region  text;
  v_set     jsonb;
  v_lead    interval;
  v_close   interval;
  v_row     record;
  v_n       integer := 0;
begin
  for v_region in select g.code from public.regions g order by g.code loop
    v_set := null;
    begin
      if public.emails_enabled(v_region) then
        v_set := public.email_settings(v_region);
      end if;
    exception when others then
      raise warning 'reminders_skipped region=% sqlstate=%', v_region, sqlstate;
    end;
    if v_set is not null then
      v_lead := make_interval(hours => (v_set ->> 'pay_reminder_hours')::integer);

      -- The customer's commission window, measured from the pick.
      for v_row in
        select r.id, r.customer_id as recipient, r.selected_application_id as app, r.payment_deadline as deadline
          from public.requests r
         where r.region = v_region and r.status = 'SELECTED'
           and r.payment_deadline > now() and r.payment_deadline <= now() + v_lead
           and r.payment_deadline - r.selected_at > v_lead
         order by r.id
      loop
        begin
          if public.queue_email('email:' || v_row.app || ':commission:pay_window_closing', 'pay_window_closing',
                                v_row.recipient, v_row.id, v_row.app, v_row.deadline, v_region) is not null then
            v_n := v_n + 1;
          end if;
        exception when others then
          raise warning 'reminder_failed request=% sqlstate=%', v_row.id, sqlstate;
        end;
      end loop;

      -- The chosen provider's fee window, from the later of the pick and the commission's payment.
      for v_row in
        select r.id, a.provider_id as recipient, r.selected_application_id as app, r.fee_deadline as deadline
          from public.requests r
          join public.applications a on a.id = r.selected_application_id
         where r.region = v_region and r.status = 'COMMISSION_PAID'
           and r.fee_deadline > now() and r.fee_deadline <= now() + v_lead
           and r.fee_deadline - greatest(r.selected_at,
                                         (select f.paid_at from public.fee_payments f
                                           where f.request_id = r.id and f.kind = 'commission' and f.status = 'paid')) > v_lead
         order by r.id
      loop
        begin
          if public.queue_email('email:' || v_row.app || ':provider_fee:pay_window_closing', 'pay_window_closing',
                                v_row.recipient, v_row.id, v_row.app, v_row.deadline, v_region) is not null then
            v_n := v_n + 1;
          end if;
        exception when others then
          raise warning 'reminder_failed request=% sqlstate=%', v_row.id, sqlstate;
        end;
      end loop;

      -- The customer's confirm window, only where it closes by itself, and not while a report is open.
      if public.auto_close_enabled(v_region) then
        v_close := make_interval(hours => (v_set ->> 'confirm_reminder_hours')::integer);
        for v_row in
          select r.id, r.customer_id as recipient, r.selected_application_id as app, r.confirm_deadline as deadline
            from public.requests r
           where r.region = v_region and r.status = 'AWAITING_CONFIRMATION'
             and r.confirm_deadline > now() and r.confirm_deadline <= now() + v_close
             and not exists (select 1 from public.problem_reports p
                              where p.request_id = r.id and p.status = 'open')
           order by r.id
        loop
          begin
            if public.queue_email('email:' || v_row.id || ':closes_soon:'
                                    || floor(extract(epoch from v_row.deadline))::bigint,
                                  'closes_soon', v_row.recipient, v_row.id, v_row.app, v_row.deadline,
                                  v_region) is not null then
              v_n := v_n + 1;
            end if;
          exception when others then
            raise warning 'reminder_failed request=% sqlstate=%', v_row.id, sqlstate;
          end;
        end loop;
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.queue_reminders() from public, anon, authenticated, service_role;
