-- Position 19a (spec 0011-19a, D213): trust and quality.
--
-- Honest quality signals read from what the platform already records. Every figure is computed from the rows each
-- time it is read (provider_quality, provider_card_quality); nothing stores a result, so no figure can disagree with
-- the jobs. The customer's offer card gains jobs done, the completion rate and the on time rate (each rate only past
-- metrics_min_jobs). A new provider is on probation for their first probation_jobs completed jobs: a reading, never a
-- stored state (02's five states stay as built, D112). While on probation apply refuses past probation_live_jobs live
-- jobs, and the last probation_reserved_slots of a request's applicant slots are theirs alone. An hourly job writes
-- watchlist flags when a provider crosses a threshold; only admin acts on a flag (warn, suspend, clear), with a note,
-- audited (D4 holds: nothing here acts on a provider by itself). A daily job reminds a provider before a required
-- document expires, through 13's mail and 18's notices.
--
-- Two tables (quality_flags, probation_waivers): RLS on, a deny policy, no API grant; every read and write goes
-- through a definer function that checks is_admin() or auth.uid().
--
-- Lock order (D169): the requests row first, always. admin_handle_quality_flag locks its flag row first, then
-- suspend_provider takes the requests in ascending order and the provider; nothing locks requests and then a flag.
--
-- Replaced, bodies copied from their latest migration plus the change named at each: pricing_settings_guard (17),
-- offer_card (17), provider_feed, provider_request, provider_home_counts and apply_to_request (06), audit_notices
-- (18), queue_email and email_context (17), the audit_log_email and audit_log_notice triggers (17, 18), and the
-- checks user_warnings_reason_valid (14) and notifications_kind_valid (18).
--
-- Every function revokes PUBLIC and pins search_path (supabase/tests/02). Refusals are stable codes in the exception
-- message; the doors map them. No function here but raise_quality_flags reads a rating (supabase/tests/35).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Settings (AC-1). Twelve keys per region, each held to whole numbers in its range, required by the guard, read
--    by one fail closed reader. The reminder job reads its one key through its own reader, so a broken quality key
--    never stops reminders.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_metrics_window_days_valid check (
    case when key <> 'metrics_window_days' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 30 and 1095 end),
  add constraint platform_settings_metrics_min_jobs_valid check (
    case when key <> 'metrics_min_jobs' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 5 and 50 end),
  add constraint platform_settings_on_time_grace_minutes_valid check (
    case when key <> 'on_time_grace_minutes' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 0 and 120 end),
  add constraint platform_settings_probation_jobs_valid check (
    case when key <> 'probation_jobs' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 50 end),
  add constraint platform_settings_probation_live_jobs_valid check (
    case when key <> 'probation_live_jobs' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 10 end),
  add constraint platform_settings_probation_reserved_slots_valid check (
    case when key <> 'probation_reserved_slots' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 0 and 10 end),
  add constraint platform_settings_floor_rating_min_tenths_valid check (
    case when key <> 'floor_rating_min_tenths' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 10 and 50 end),
  add constraint platform_settings_floor_report_rate_pct_valid check (
    case when key <> 'floor_report_rate_pct' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 100 end),
  add constraint platform_settings_floor_cancel_rate_pct_valid check (
    case when key <> 'floor_cancel_rate_pct' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 100 end),
  add constraint platform_settings_floor_follow_through_pct_valid check (
    case when key <> 'floor_follow_through_pct' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 100 end),
  add constraint platform_settings_quality_flag_cooldown_days_valid check (
    case when key <> 'quality_flag_cooldown_days' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 365 end),
  add constraint platform_settings_document_reminder_days_valid check (
    case when key <> 'document_reminder_days' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 60 end);

insert into public.platform_settings (region, key, value)
select g.code, k.key, k.value::jsonb
  from (values ('TR'), ('KSA')) g(code)
 cross join (values ('metrics_window_days', '365'), ('metrics_min_jobs', '5'), ('on_time_grace_minutes', '15'),
                    ('probation_jobs', '5'), ('probation_live_jobs', '2'), ('probation_reserved_slots', '2'),
                    ('floor_rating_min_tenths', '35'), ('floor_report_rate_pct', '10'), ('floor_cancel_rate_pct', '10'),
                    ('floor_follow_through_pct', '70'), ('quality_flag_cooldown_days', '30'),
                    ('document_reminder_days', '14')) k(key, value)
on conflict (region, key) do nothing;

-- 17's list plus the twelve quality keys.
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
                 'report_window_days', 'reports_per_user_day',
                 'rating_window_days', 'rating_min_count', 'rating_prior_weight', 'rating_half_life_days',
                 'metrics_window_days', 'metrics_min_jobs', 'on_time_grace_minutes', 'probation_jobs',
                 'probation_live_jobs', 'probation_reserved_slots', 'floor_rating_min_tenths', 'floor_report_rate_pct',
                 'floor_cancel_rate_pct', 'floor_follow_through_pct', 'quality_flag_cooldown_days',
                 'document_reminder_days')
     and (tg_op = 'DELETE' or new.key is distinct from old.key or new.region is distinct from old.region) then
    raise exception 'pricing_setting_required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.pricing_settings_guard() from public, anon, authenticated, service_role;

-- AC-1: the twelve values of a region, or quality_settings_invalid when one is missing or malformed, or when the
-- reserved slots would leave no slot for anyone else (X-15: the cap through apply_settings, its refusal folded in).
create function public.quality_settings(p_region text)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_out  jsonb := '{}'::jsonb;
  v_cap  integer;
  r      record;
begin
  for r in
    select k.key, k.lo, k.hi, s.value
      from (values ('metrics_window_days', 30, 1095), ('metrics_min_jobs', 5, 50), ('on_time_grace_minutes', 0, 120),
                   ('probation_jobs', 1, 50), ('probation_live_jobs', 1, 10), ('probation_reserved_slots', 0, 10),
                   ('floor_rating_min_tenths', 10, 50), ('floor_report_rate_pct', 1, 100),
                   ('floor_cancel_rate_pct', 1, 100), ('floor_follow_through_pct', 1, 100),
                   ('quality_flag_cooldown_days', 1, 365), ('document_reminder_days', 1, 60)) k(key, lo, hi)
      left join public.platform_settings s on s.region = p_region and s.key = k.key
  loop
    if jsonb_typeof(r.value) is distinct from 'number'
       or (r.value #>> '{}')::numeric <> trunc((r.value #>> '{}')::numeric)
       or (r.value #>> '{}')::numeric not between r.lo and r.hi then
      raise exception 'quality_settings_invalid';
    end if;
    v_out := v_out || jsonb_build_object(r.key, (r.value #>> '{}')::numeric::integer);
  end loop;
  begin
    v_cap := (public.apply_settings(p_region) ->> 'max_applicants_per_request')::integer;
  exception when raise_exception then
    if sqlerrm = 'apply_settings_invalid' then
      raise exception 'quality_settings_invalid';
    end if;
    raise;
  end;
  if (v_out ->> 'probation_reserved_slots')::integer >= v_cap then
    raise exception 'quality_settings_invalid';
  end if;
  return v_out;
end;
$$;

revoke all on function public.quality_settings(text) from public, anon, authenticated, service_role;

-- The fail open readers (AC-5, AC-7): null and a warning when a quality setting is broken, never a refusal.
create function public.quality_settings_or_null(p_region text)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
begin
  return public.quality_settings(p_region);
exception when raise_exception then
  if sqlerrm = 'quality_settings_invalid' then
    raise warning 'quality_settings_invalid region=%', p_region;
    return null;
  end if;
  raise;
end;
$$;

revoke all on function public.quality_settings_or_null(text) from public, anon, authenticated, service_role;

-- AC-1, AC-14: the reminder's one key, fail closed on its own.
create function public.document_reminder_days(p_region text)
  returns integer
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_value  jsonb;
begin
  select s.value into v_value from public.platform_settings s
   where s.region = p_region and s.key = 'document_reminder_days';
  if jsonb_typeof(v_value) is distinct from 'number'
     or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
     or (v_value #>> '{}')::numeric not between 1 and 60 then
    raise exception 'document_reminder_settings_invalid';
  end if;
  return (v_value #>> '{}')::numeric::integer;
end;
$$;

revoke all on function public.document_reminder_days(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Indexes (AC-16): a provider's jobs by reveal, the missed fees by application, the first decisions, the
--    reminders already written, and the admin cancel's attribution. The reminder index is unique, so two runs of the
--    daily job can never write the same reminder twice.
-- ═══════════════════════════════════════════════════════════════════════════

create index applications_provider_unlocked_idx on public.applications (provider_id, unlocked_at)
  where unlocked_at is not null;
create index audit_log_missed_fee_application_idx on public.audit_log ((new_value ->> 'application_id'))
  where action in ('request.fee_expired', 'request.provider_withdrew');
create index audit_log_provider_decision_idx on public.audit_log (entity_id, created_at)
  where action in ('provider.approved', 'provider.rejected');
create unique index audit_log_document_expiring_idx on public.audit_log (entity_id, (new_value ->> 'object_id'))
  where action = 'provider.document_expiring';
create index audit_log_admin_cancelled_idx on public.audit_log (entity_id)
  where action = 'request.admin_cancelled';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The figures (AC-2, AC-3). Internal, no grant. A provider's jobs are the requests whose selected application is
--    theirs with unlocked_at set. Rates are { num, den, pct }, pct rounded once (numeric, half away from zero), for
--    display only; every threshold compares the exact integers.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.quality_rate(p_num integer, p_den integer)
  returns jsonb
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select jsonb_build_object('num', p_num, 'den', p_den,
                            'pct', case when p_den = 0 then null else round(100 * p_num::numeric / p_den) end)
$$;

revoke all on function public.quality_rate(integer, integer) from public, anon, authenticated, service_role;

-- X-9: a provider caused cancel is a CANCELLED request cancelled by the provider, or by admin with the cancel
-- attributed to the provider; never read from cancellation_rules.counts_against.
create function public.provider_caused_cancel(p_request_id uuid, p_status text, p_cancelled_by text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select p_status = 'CANCELLED'
         and (p_cancelled_by = 'provider'
              or (p_cancelled_by = 'admin'
                  and exists (select 1 from public.audit_log l
                               where l.action = 'request.admin_cancelled' and l.entity_id = p_request_id::text
                                 and l.new_value ->> 'attributed_to' = 'provider')))
$$;

revoke all on function public.provider_caused_cancel(uuid, text, text) from public, anon, authenticated, service_role;

-- X-11: the all time count of COMPLETED jobs, on its own, so nothing needing only the count runs the rates.
create function public.provider_jobs_done(p_provider_id uuid)
  returns integer
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select count(*)::integer
    from public.applications a
    join public.requests r on r.selected_application_id = a.id
   where a.provider_id = p_provider_id and a.unlocked_at is not null and r.status = 'COMPLETED'
$$;

revoke all on function public.provider_jobs_done(uuid) from public, anon, authenticated, service_role;

-- AC-2 with the region's settings already in hand (X-20: a caller over many providers resolves them once).
create function public.provider_quality_with(p_provider_id uuid, p_set jsonb)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_since     timestamptz := now() - make_interval(days => (p_set ->> 'metrics_window_days')::integer);
  v_grace     interval := make_interval(mins => (p_set ->> 'on_time_grace_minutes')::integer);
  v_j         record;
  v_unlocked  integer;
  v_reports   integer;
  v_repeat    record;
  v_resp      record;
  v_missed    integer;
begin
  select count(*) filter (where j.status = 'COMPLETED' and j.closed_at >= v_since)::integer as completed,
         count(*) filter (where j.provider_cancel and j.cancelled_at >= v_since)::integer as cancels,
         count(*) filter (where j.actual_started_at >= v_since)::integer as started,
         count(*) filter (where j.actual_started_at >= v_since
                            and j.actual_started_at <= j.scheduled_start_at + v_grace)::integer as on_time,
         count(*) filter (where j.provider_cancel and j.unlocked_at >= v_since)::integer as unlocked_cancels
    into v_j
    from (select r.status, r.closed_at, r.cancelled_at, r.actual_started_at, r.scheduled_start_at, a.unlocked_at,
                 public.provider_caused_cancel(r.id, r.status, r.cancelled_by) as provider_cancel
            from public.applications a
            join public.requests r on r.selected_application_id = a.id
           where a.provider_id = p_provider_id and a.unlocked_at is not null) j;

  select count(*)::integer into v_unlocked
    from public.applications a
   where a.provider_id = p_provider_id and a.unlocked_at >= v_since;

  -- Reports by customers, minus those admin handled with no action.
  select count(*)::integer into v_reports
    from public.problem_reports x
   where x.against_id = p_provider_id and x.side = 'customer' and x.created_at >= v_since
     and x.outcome is distinct from 'no_action';

  select count(*)::integer as den, count(*) filter (where c.n >= 2)::integer as num
    into v_repeat
    from (select r.customer_id, count(*) as n
            from public.applications a
            join public.requests r on r.selected_application_id = a.id
           where a.provider_id = p_provider_id and a.unlocked_at is not null
             and r.status = 'COMPLETED' and r.closed_at >= v_since
           group by r.customer_id) c;

  select count(*)::integer as n,
         round((percentile_cont(0.5) within group (
                  order by (extract(epoch from a.created_at - r.created_at) / 60)::double precision))::numeric) as minutes
    into v_resp
    from public.applications a
    join public.requests r on r.id = a.request_id
   where a.provider_id = p_provider_id and a.created_at >= v_since;

  -- X-9: a fee missed counts only when its audit row says it counts against the provider's follow through.
  select count(distinct l.new_value ->> 'application_id')::integer into v_missed
    from public.applications a
    join public.audit_log l
      on (l.new_value ->> 'application_id') = a.id::text
     and l.action in ('request.fee_expired', 'request.provider_withdrew')
   where a.provider_id = p_provider_id
     and l.new_value ->> 'counts_against' = 'provider_fee_follow_through'
     and l.created_at >= v_since;

  return jsonb_build_object(
    'jobs_done', public.provider_jobs_done(p_provider_id),
    'completion', public.quality_rate(v_j.completed, v_j.completed + v_j.cancels),
    'on_time', public.quality_rate(v_j.on_time, v_j.started),
    'cancellation', public.quality_rate(v_j.unlocked_cancels, v_unlocked),
    'reports', public.quality_rate(v_reports, v_j.completed),
    'repeat_customers', public.quality_rate(v_repeat.num, v_repeat.den),
    'response_minutes', case when v_resp.n = 0 then null
                             else jsonb_build_object('minutes', v_resp.minutes, 'count', v_resp.n) end,
    'follow_through', public.quality_rate(v_unlocked, v_unlocked + v_missed),
    'window_days', (p_set ->> 'metrics_window_days')::integer,
    'grace_minutes', (p_set ->> 'on_time_grace_minutes')::integer);
end;
$$;

revoke all on function public.provider_quality_with(uuid, jsonb) from public, anon, authenticated, service_role;

-- AC-2: every figure of one provider, computed now. Raises quality_settings_invalid on a broken setting.
create function public.provider_quality(p_provider_id uuid)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_region  text;
begin
  select pr.region into v_region from public.providers pr where pr.id = p_provider_id;
  if not found then
    return null;
  end if;
  return public.provider_quality_with(p_provider_id, public.quality_settings(v_region));
end;
$$;

revoke all on function public.provider_quality(uuid) from public, anon, authenticated, service_role;

-- AC-3: the three figures customers see. Each rate only from metrics_min_jobs in its own denominator. Null on a
-- broken setting, caught here because offer_card is plain SQL and cannot.
create function public.provider_card_quality(p_provider_id uuid)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_region  text;
  v_set     jsonb;
  v_min     integer;
  v_since   timestamptz;
  v_grace   interval;
  v_j       record;
begin
  select pr.region into v_region from public.providers pr where pr.id = p_provider_id;
  if not found then
    return null;
  end if;
  begin
    v_set := public.quality_settings(v_region);
  exception when raise_exception then
    if sqlerrm = 'quality_settings_invalid' then
      return null;
    end if;
    raise;
  end;
  v_min := (v_set ->> 'metrics_min_jobs')::integer;
  v_since := now() - make_interval(days => (v_set ->> 'metrics_window_days')::integer);
  v_grace := make_interval(mins => (v_set ->> 'on_time_grace_minutes')::integer);

  select count(*) filter (where j.status = 'COMPLETED' and j.closed_at >= v_since)::integer as completed,
         count(*) filter (where j.status = 'CANCELLED' and j.cancelled_at >= v_since
                            and public.provider_caused_cancel(j.id, j.status, j.cancelled_by))::integer as cancels,
         count(*) filter (where j.actual_started_at >= v_since)::integer as started,
         count(*) filter (where j.actual_started_at >= v_since
                            and j.actual_started_at <= j.scheduled_start_at + v_grace)::integer as on_time
    into v_j
    from (select r.id, r.status, r.closed_at, r.cancelled_at, r.cancelled_by, r.actual_started_at, r.scheduled_start_at
            from public.applications a
            join public.requests r on r.selected_application_id = a.id
           where a.provider_id = p_provider_id and a.unlocked_at is not null) j;

  return jsonb_build_object(
    'jobs_done', public.provider_jobs_done(p_provider_id),
    'completion', case when v_j.completed + v_j.cancels >= v_min
                       then jsonb_build_object('pct', round(100 * v_j.completed::numeric / (v_j.completed + v_j.cancels)),
                                               'den', v_j.completed + v_j.cancels) end,
    'on_time', case when v_j.started >= v_min
                    then jsonb_build_object('pct', round(100 * v_j.on_time::numeric / v_j.started), 'den', v_j.started) end,
    'window_days', (v_set ->> 'metrics_window_days')::integer,
    'grace_minutes', (v_set ->> 'on_time_grace_minutes')::integer);
end;
$$;

revoke all on function public.provider_card_quality(uuid) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Probation (AC-5 to AC-7). A reading: approved now, fewer than probation_jobs COMPLETED jobs, no waiver. A
--    waiver is admin's, final, append only.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.probation_waivers (
  provider_id  uuid        primary key,
  region       text        not null references public.regions (code) on delete restrict,
  waived_by    uuid        not null references public.profiles (id) on delete restrict,
  note         text        not null,
  created_at   timestamptz not null default now(),

  constraint probation_waivers_provider_region_fk foreign key (provider_id, region)
    references public.providers (id, region) on delete restrict,
  constraint probation_waivers_note_size check (note = btrim(note) and char_length(note) between 10 and 500)
);

alter table public.probation_waivers enable row level security;
create policy probation_waivers_no_api on public.probation_waivers for select to authenticated using (false);
revoke all on table public.probation_waivers from anon, authenticated, service_role;

create index probation_waivers_region_idx on public.probation_waivers (region);
create index probation_waivers_waived_by_idx on public.probation_waivers (waived_by);

-- A waiver is final: no update, delete or truncate, for every role (07's pattern).
create function public.probation_waivers_append_only()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  raise exception 'probation_waiver_final';
end;
$$;

revoke all on function public.probation_waivers_append_only() from public, anon, authenticated, service_role;

create trigger probation_waivers_append_only before update or delete on public.probation_waivers
  for each row execute function public.probation_waivers_append_only();
create trigger probation_waivers_no_truncate before truncate on public.probation_waivers
  for each statement execute function public.probation_waivers_append_only();

create function public.provider_on_probation_with(p_provider_id uuid, p_set jsonb)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select coalesce(public.provider_standing(p_provider_id) = 'approved', false)
         and not exists (select 1 from public.probation_waivers w where w.provider_id = p_provider_id)
         and public.provider_jobs_done(p_provider_id) < (p_set ->> 'probation_jobs')::integer
$$;

revoke all on function public.provider_on_probation_with(uuid, jsonb) from public, anon, authenticated, service_role;

-- AC-5: fail open. A broken setting reads false with a warning, so it can never stop anyone applying.
create function public.provider_on_probation(p_provider_id uuid)
  returns boolean
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_set  jsonb;
begin
  select public.quality_settings_or_null(pr.region) into v_set from public.providers pr where pr.id = p_provider_id;
  if v_set is null then
    return false;
  end if;
  return public.provider_on_probation_with(p_provider_id, v_set);
end;
$$;

revoke all on function public.provider_on_probation(uuid) from public, anon, authenticated, service_role;

-- AC-6: picks paid or awaiting the provider's fee, and jobs not yet closed.
create function public.provider_live_jobs(p_provider_id uuid)
  returns integer
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select count(*)::integer
    from public.applications a
    join public.requests r on r.selected_application_id = a.id
   where a.provider_id = p_provider_id
     and r.status in ('COMMISSION_PAID', 'UNLOCKED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION')
$$;

revoke all on function public.provider_live_jobs(uuid) from public, anon, authenticated, service_role;

-- AC-7: the whole cap for a provider on probation, the cap minus the reserved slots for anyone else; the whole cap
-- on a broken quality setting (fail open). A broken apply setting still refuses, as before (apply_settings_invalid).
create function public.provider_apply_cap(p_provider_id uuid, p_region text)
  returns integer
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_cap  integer := (public.apply_settings(p_region) ->> 'max_applicants_per_request')::integer;
  v_set  jsonb := public.quality_settings_or_null(p_region);
begin
  if v_set is null or public.provider_on_probation_with(p_provider_id, v_set) then
    return v_cap;
  end if;
  return v_cap - (v_set ->> 'probation_reserved_slots')::integer;
end;
$$;

revoke all on function public.provider_apply_cap(uuid, text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The offer card (AC-3): 17's body plus `quality`, so request_offers (its only caller) returns it unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.offer_card(p_application public.applications, p_timezone text)
  returns jsonb
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select jsonb_build_object(
           'application_id', (p_application).id,
           'approved_since', to_char(date_trunc('month', pr.approved_at at time zone p_timezone), 'YYYY-MM-DD'),
           'message', case when public.message_has_contact_info((p_application).message) then null
                           else (p_application).message end,
           'message_hidden', public.message_has_contact_info((p_application).message),
           'created_at', (p_application).created_at,
           'rating', public.provider_rating_summary(pr.id),
           'quality', public.provider_card_quality(pr.id))
         || public.offer_display_name(pr.approved_name)
    from public.providers pr
   where pr.id = (p_application).provider_id
$$;

revoke all on function public.offer_card(public.applications, text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The apply path (AC-6, AC-7): 06's bodies, each reading the caller's cap through provider_apply_cap in place of
--    max_applicants_per_request, still against approved_applied_count and, in apply, still under the request row
--    lock. apply_to_request also gains step 9b, the live job limit while on probation. The rest is 06's, unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.provider_feed(
  p_service_ids    uuid[],
  p_zone_ids       uuid[],
  p_from           date,
  p_to             date,
  p_after_outside  boolean,
  p_after_start    timestamptz,
  p_after_id       uuid
)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_me     public.providers%rowtype;
  v_tz     text;
  v_cap    integer;
  v_days   smallint[];
  v_first  integer;
  v_last   integer;
  v_rows   jsonb;
  v_more   boolean;
begin
  v_me := public.provider_reader();
  select g.timezone into v_tz from public.regions g where g.code = v_me.region;
  -- A filter longer than any setup can match nothing more: refused as empty before any row is read.
  if public.provider_standing(v_me.id) is distinct from 'approved'
     or not public.provider_setup_complete(v_me.id)
     or coalesce(cardinality(p_service_ids), 0) > 50
     or coalesce(cardinality(p_zone_ids), 0) > 100 then
    return jsonb_build_object('timezone', v_tz, 'has_more', false, 'rows', '[]'::jsonb);
  end if;

  v_cap := public.provider_apply_cap(v_me.id, v_me.region);
  select a.work_days, a.start_hour, a.end_hour into v_days, v_first, v_last
    from public.provider_availability a
   where a.provider_id = v_me.id;

  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= 20), '[]'::jsonb), count(*) > 20
    into v_rows, v_more
    from (
      select row_number() over (order by m.outside_hours, m.scheduled_start_at, m.id) as rn,
             public.provider_short_details(m.req) || jsonb_build_object(
               'applied_count', m.applied_count,
               'cap', v_cap,
               'full', m.applied_count >= v_cap,
               'outside_hours', m.outside_hours,
               'application', (
                 select jsonb_build_object('id', a.id, 'status', a.status, 'created_at', a.created_at)
                   from public.applications a
                  where a.request_id = m.id and a.provider_id = v_me.id)) as j
        from (
          select q.req, q.id, q.scheduled_start_at, q.outside_hours, q.applied_count
            from (
              select r as req, r.id, r.scheduled_start_at,
                     public.provider_outside_hours(r.scheduled_start_at, v_tz, v_days, v_first, v_last) as outside_hours,
                     public.approved_applied_count(r.id) as applied_count
                from public.requests r
               where r.region = v_me.region
                 and r.status = 'OPEN'
                 and r.scheduled_start_at > now()
                 and exists (select 1 from public.provider_services ps
                              where ps.provider_id = v_me.id and ps.service_id = r.service_id)
                 and exists (select 1 from public.provider_zones pz
                              where pz.provider_id = v_me.id and pz.zone_id = r.zone_id)
                 and (p_service_ids is null or r.service_id = any (p_service_ids))
                 and (p_zone_ids is null or r.zone_id = any (p_zone_ids))
                 and (p_from is null or (r.scheduled_start_at at time zone v_tz)::date >= p_from)
                 and (p_to is null or (r.scheduled_start_at at time zone v_tz)::date < p_to)
            ) q
           where p_after_outside is null or p_after_start is null or p_after_id is null
              or (q.outside_hours, q.scheduled_start_at, q.id) > (p_after_outside, p_after_start, p_after_id)
           order by q.outside_hours, q.scheduled_start_at, q.id
           limit 21
        ) m
    ) x;

  return jsonb_build_object('timezone', v_tz, 'has_more', v_more, 'rows', v_rows);
end;
$$;

revoke all on function public.provider_feed(uuid[], uuid[], date, date, boolean, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.provider_feed(uuid[], uuid[], date, date, boolean, timestamptz, uuid) to authenticated;

create or replace function public.provider_request(p_request_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_me       public.providers%rowtype;
  v_tz       text;
  v_req      public.requests%rowtype;
  v_app      jsonb;
  v_in_feed  boolean;
  v_cap      integer;
  v_count    integer;
  v_days     smallint[];
  v_first    integer;
  v_last     integer;
begin
  v_me := public.provider_reader();
  select r.* into v_req from public.requests r where r.id = p_request_id and r.region = v_me.region;
  if not found then
    return null;
  end if;

  select jsonb_build_object('id', a.id, 'status', a.status, 'created_at', a.created_at) into v_app
    from public.applications a
   where a.request_id = v_req.id and a.provider_id = v_me.id;

  v_in_feed := v_req.status = 'OPEN'
    and v_req.scheduled_start_at > now()
    and public.provider_standing(v_me.id) is not distinct from 'approved'
    and public.provider_setup_complete(v_me.id)
    and exists (select 1 from public.provider_services ps
                 where ps.provider_id = v_me.id and ps.service_id = v_req.service_id)
    and exists (select 1 from public.provider_zones pz
                 where pz.provider_id = v_me.id and pz.zone_id = v_req.zone_id);
  if v_app is null and not v_in_feed then
    return null;
  end if;

  select g.timezone into v_tz from public.regions g where g.code = v_me.region;
  v_cap := public.provider_apply_cap(v_me.id, v_me.region);
  v_count := public.approved_applied_count(v_req.id);
  select a.work_days, a.start_hour, a.end_hour into v_days, v_first, v_last
    from public.provider_availability a
   where a.provider_id = v_me.id;

  return public.provider_short_details(v_req) || jsonb_build_object(
    'applied_count', v_count,
    'cap', v_cap,
    'full', v_count >= v_cap,
    'outside_hours', public.provider_outside_hours(v_req.scheduled_start_at, v_tz, v_days, v_first, v_last),
    'application', v_app,
    'closed', v_req.status <> 'OPEN' or v_req.scheduled_start_at <= now(),
    'timezone', v_tz,
    'answers', public.provider_structured_answers(v_req.questions_snapshot, v_req.answers),
    'payment_deadline', case when v_app ->> 'status' = 'SELECTED' then v_req.payment_deadline end);
end;
$$;

revoke all on function public.provider_request(uuid) from public, anon, authenticated, service_role;
grant execute on function public.provider_request(uuid) to authenticated;

create or replace function public.provider_home_counts()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_me        public.providers%rowtype;
  v_complete  boolean;
  v_cap       integer;
  v_open      integer := 0;
  v_applied   integer;
  v_selected  integer;
begin
  v_me := public.provider_reader();
  v_complete := public.provider_setup_complete(v_me.id);

  if v_complete and public.provider_standing(v_me.id) is not distinct from 'approved' then
    v_cap := public.provider_apply_cap(v_me.id, v_me.region);
    select count(*) into v_open
      from public.requests r
     where r.region = v_me.region
       and r.status = 'OPEN'
       and r.scheduled_start_at > now()
       and exists (select 1 from public.provider_services ps
                    where ps.provider_id = v_me.id and ps.service_id = r.service_id)
       and exists (select 1 from public.provider_zones pz
                    where pz.provider_id = v_me.id and pz.zone_id = r.zone_id)
       and public.approved_applied_count(r.id) < v_cap;
  end if;

  select count(*) into v_applied
    from public.applications a
   where a.provider_id = v_me.id and a.status = 'APPLIED';

  select count(*) into v_selected
    from public.applications a
   where a.provider_id = v_me.id and a.status = 'SELECTED';

  return jsonb_build_object('setup_complete', v_complete, 'open_requests', v_open, 'applied', v_applied,
                            'selected', v_selected);
end;
$$;

revoke all on function public.provider_home_counts() from public, anon, authenticated, service_role;
grant execute on function public.provider_home_counts() to authenticated;

create or replace function public.apply_to_request(p_request_id uuid, p_message text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_me        public.providers%rowtype;
  v_standing  text;
  v_req       record;
  v_app       record;
  v_settings  jsonb;
  v_count     integer;
  v_message   text;
  v_qset      jsonb;
  v_cap       integer;
begin
  -- 1. A provider profile with a providers row; identity from the token only.
  v_me := public.provider_reader();

  -- 2. Standing: approved only, so an expired document is refused too.
  v_standing := public.provider_standing(v_me.id);
  if v_standing = 'suspended' then
    raise exception 'provider_suspended';
  end if;
  if v_standing is distinct from 'approved' then
    raise exception 'not_approved';
  end if;

  -- 3. The setup gates applying (D151).
  if not public.provider_setup_complete(v_me.id) then
    raise exception 'setup_incomplete';
  end if;

  -- 4. The request row, locked: cancel and choose take the same lock first. An unknown id and another
  --    region read the same.
  select r.id, r.region, r.status, r.service_id, r.zone_id, r.scheduled_start_at into v_req
    from public.requests r
   where r.id = p_request_id and r.region = v_me.region
     for update;
  if not found then
    raise exception 'not_found';
  end if;

  -- 4b. The caller's providers row, shared, then the standing again: a suspension that commits while this
  --     apply runs either waits for it or is seen here (review F2). Suspend touches no request row, so the
  --     order request, then provider, cannot deadlock with it.
  perform 1 from public.providers pr where pr.id = v_me.id for share;
  v_standing := public.provider_standing(v_me.id);
  if v_standing = 'suspended' then
    raise exception 'provider_suspended';
  end if;
  if v_standing is distinct from 'approved' then
    raise exception 'not_approved';
  end if;

  -- 5. A repeat returns the stored application with no write, whatever the request's state now.
  select a.id, a.status, a.created_at into v_app
    from public.applications a
   where a.request_id = v_req.id and a.provider_id = v_me.id;
  if found then
    return jsonb_build_object('status', 'ok', 'replayed', true, 'application',
             jsonb_build_object('id', v_app.id, 'status', v_app.status, 'created_at', v_app.created_at));
  end if;

  -- 6. Outside the caller's stored picks reads as unknown, so ids cannot be probed.
  if not exists (select 1 from public.provider_services ps
                  where ps.provider_id = v_me.id and ps.service_id = v_req.service_id)
     or not exists (select 1 from public.provider_zones pz
                     where pz.provider_id = v_me.id and pz.zone_id = v_req.zone_id) then
    raise exception 'not_found';
  end if;

  -- 7. Open to applications until its start.
  if v_req.status <> 'OPEN' or v_req.scheduled_start_at <= now() then
    raise exception 'request_closed';
  end if;

  -- 8, 9. The caller's cap (AC-7 of 0011-19a: the reserved slots are for providers on probation), held by the row
  --       lock of step 4. A broken quality setting gives the whole cap (fail open).
  v_settings := public.apply_settings(v_req.region);
  v_qset := public.quality_settings_or_null(v_req.region);
  v_cap := (v_settings ->> 'max_applicants_per_request')::integer;
  if v_qset is not null and not public.provider_on_probation_with(v_me.id, v_qset) then
    v_cap := v_cap - (v_qset ->> 'probation_reserved_slots')::integer;
  end if;
  v_count := public.approved_applied_count(v_req.id);
  if v_count >= v_cap then
    raise exception 'request_full';
  end if;

  -- 9b. AC-6 of 0011-19a: while on probation, no new application past probation_live_jobs live jobs. Applications
  --     already sent, choose, pay and the reveal are untouched.
  if v_qset is not null and public.provider_on_probation_with(v_me.id, v_qset)
     and public.provider_live_jobs(v_me.id) >= (v_qset ->> 'probation_live_jobs')::integer then
    raise exception 'probation_limit';
  end if;

  -- 10. One attempt against the hourly limit.
  perform public.count_application(v_me.id, v_req.region, (v_settings ->> 'applications_per_hour')::integer);

  -- 11. The message: capped in bytes before any regex reads it, trimmed, 20 to 600 code points.
  if p_message is null or octet_length(p_message) > 8192 then
    return jsonb_build_object('status', 'refused', 'code', 'message_invalid');
  end if;
  v_message := public.catalog_trim(p_message);
  if char_length(v_message) not between 20 and 600 then
    return jsonb_build_object('status', 'refused', 'code', 'message_invalid');
  end if;

  -- 12. The contact scanner (D153).
  if public.message_has_contact_info(v_message) then
    return jsonb_build_object('status', 'refused', 'code', 'contact_info_in_message');
  end if;

  -- 13. The application, in its request's region.
  insert into public.applications (region, request_id, provider_id, message)
  values (v_req.region, v_req.id, v_me.id, v_message)
  returning id, status, created_at into v_app;

  return jsonb_build_object('status', 'ok', 'replayed', false, 'application',
           jsonb_build_object('id', v_app.id, 'status', v_app.status, 'created_at', v_app.created_at));
end;
$$;

revoke all on function public.apply_to_request(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.apply_to_request(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The provider's own view (AC-4): the three figures as customers see them, and probation while it lasts. Never a
--    flag, the report rate, the cancellation rate or follow through.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.my_provider_quality()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_me   public.providers%rowtype;
  v_set  jsonb;
begin
  v_me := public.provider_reader();
  v_set := public.quality_settings_or_null(v_me.region);
  return jsonb_build_object(
    'quality', public.provider_card_quality(v_me.id),
    'probation', case when v_set is not null and public.provider_on_probation_with(v_me.id, v_set)
                      then jsonb_build_object('jobs_done', public.provider_jobs_done(v_me.id),
                                              'jobs_needed', (v_set ->> 'probation_jobs')::integer,
                                              'live', public.provider_live_jobs(v_me.id),
                                              'live_limit', (v_set ->> 'probation_live_jobs')::integer) end);
end;
$$;

revoke all on function public.my_provider_quality() from public, anon, authenticated, service_role;
grant execute on function public.my_provider_quality() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The watchlist (AC-8, AC-9). One row per raised flag; a flag moves once, open to handled, and never again.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.quality_flags (
  id           uuid        primary key default gen_random_uuid(),
  region       text        not null references public.regions (code) on delete restrict,
  provider_id  uuid        not null,
  kind         text        not null,
  source_id    uuid,
  figure       jsonb       not null,
  raised_at    timestamptz not null default now(),
  handled_at   timestamptz,
  handled_by   uuid        references public.profiles (id) on delete restrict,
  outcome      text,
  note         text,

  constraint quality_flags_provider_region_fk foreign key (provider_id, region)
    references public.providers (id, region) on delete restrict,
  constraint quality_flags_kind_valid check (kind in ('low_rating', 'high_reports', 'high_cancellations',
                                                      'low_follow_through', 'probation_report', 'probation_cancel')),
  constraint quality_flags_source_for_probation check (
    (kind in ('probation_report', 'probation_cancel')) = (source_id is not null)),
  constraint quality_flags_figure_valid check (jsonb_typeof(figure) = 'object' and octet_length(figure::text) <= 1024),
  constraint quality_flags_outcome_valid check (outcome is null or outcome in ('warned', 'suspended', 'cleared')),
  constraint quality_flags_note_size check (note is null or (note = btrim(note) and char_length(note) between 10 and 500)),
  constraint quality_flags_handled_together check (
    (handled_at is null and handled_by is null and outcome is null and note is null)
    or (handled_at is not null and handled_by is not null and outcome is not null and note is not null
        and handled_at >= raised_at))
);

alter table public.quality_flags enable row level security;
create policy quality_flags_no_api on public.quality_flags for select to authenticated using (false);
revoke all on table public.quality_flags from anon, authenticated, service_role;

-- One open rate flag per provider and kind; one probation flag per source, ever; the queue, oldest first.
create unique index quality_flags_open_rate_idx on public.quality_flags (provider_id, kind)
  where handled_at is null and source_id is null;
create unique index quality_flags_source_idx on public.quality_flags (kind, source_id) where source_id is not null;
create index quality_flags_queue_idx on public.quality_flags (raised_at, id) where handled_at is null;
create index quality_flags_provider_idx on public.quality_flags (provider_id, raised_at desc);
create index quality_flags_region_idx on public.quality_flags (region);
create index quality_flags_handled_by_idx on public.quality_flags (handled_by);

-- An update may only move an open flag to handled, setting exactly the four handled columns; delete and truncate
-- refuse, for every role.
create function public.quality_flags_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' or old.handled_at is not null or new.handled_at is null
     or (to_jsonb(new) - array['handled_at', 'handled_by', 'outcome', 'note'])
        is distinct from (to_jsonb(old) - array['handled_at', 'handled_by', 'outcome', 'note']) then
    raise exception 'quality_flag_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.quality_flags_guard() from public, anon, authenticated, service_role;

create trigger quality_flags_guard before update or delete on public.quality_flags
  for each row execute function public.quality_flags_guard();
create trigger quality_flags_no_truncate before truncate on public.quality_flags
  for each statement execute function public.quality_flags_guard();

-- AC-9: five warning reasons beside 14's six.
alter table public.user_warnings drop constraint user_warnings_reason_valid;
alter table public.user_warnings add constraint user_warnings_reason_valid check (
  reason in ('no_show', 'did_not_pay_cash', 'poor_work', 'safety_or_behaviour', 'asked_money_off_platform', 'other',
             'low_rating', 'high_reports', 'high_cancellations', 'low_follow_through', 'probation_issue'));

-- Whether a rate crossed its line, on the exact integers: above for reports and cancels, below for follow through.
create function public.quality_crosses(p_rate jsonb, p_min integer, p_limit integer, p_above boolean)
  returns boolean
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select coalesce((p_rate ->> 'den')::integer >= p_min
                  and case when p_above then 100 * (p_rate ->> 'num')::integer > p_limit * (p_rate ->> 'den')::integer
                           else 100 * (p_rate ->> 'num')::integer < p_limit * (p_rate ->> 'den')::integer end,
                  false)
$$;

revoke all on function public.quality_crosses(jsonb, integer, integer, boolean) from public, anon, authenticated, service_role;

-- AC-8: the hourly job. Region by region (a region whose settings are broken is skipped with a warning), over the
-- providers whose status is approved (standing approved or document_expired). It writes nothing but quality_flags
-- rows. Each provider's open flags are locked first, so a handle in flight finishes before the job looks (39), and
-- each provider runs in its own subtransaction, so one failure never stops the rest.
create function public.raise_quality_flags()
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_region  text;
  v_set     jsonb;
  v_min     integer;
  v_cool    timestamptz;
  v_p       record;
  v_q       jsonb;
  v_r       jsonb;
  v_n       integer;
  v_one     integer;
  v_total   integer := 0;
begin
  for v_region in select g.code from public.regions g order by g.code loop
    begin
      v_set := public.quality_settings(v_region);
    exception when others then
      raise warning 'quality_flags_skipped region=% sqlstate=%', v_region, sqlstate;
      continue;
    end;
    v_min := (v_set ->> 'metrics_min_jobs')::integer;
    v_cool := now() - make_interval(days => (v_set ->> 'quality_flag_cooldown_days')::integer);

    for v_p in
      select pr.id, pr.approved_at from public.providers pr
       where pr.region = v_region and pr.status = 'approved'
       order by pr.id
    loop
      v_one := 0;
      begin
        perform 1 from public.quality_flags f where f.provider_id = v_p.id and f.handled_at is null for update;
        v_q := public.provider_quality_with(v_p.id, v_set);
        v_r := public.provider_rating_summary(v_p.id);

        -- The rate kinds: one open flag per kind, none within the cooldown after admin handled one.
        insert into public.quality_flags (region, provider_id, kind, figure)
        select v_region, v_p.id, k.kind, k.figure
          from (values
                  ('low_rating',
                   v_r ->> 'state' = 'rated'
                   and (v_r ->> 'overall')::numeric * 10 < (v_set ->> 'floor_rating_min_tenths')::integer,
                   jsonb_build_object('overall', (v_r ->> 'overall')::numeric, 'count', (v_r ->> 'count')::integer,
                                      'threshold', (v_set ->> 'floor_rating_min_tenths')::numeric / 10)),
                  ('high_reports',
                   public.quality_crosses(v_q -> 'reports', v_min, (v_set ->> 'floor_report_rate_pct')::integer, true),
                   (v_q -> 'reports') || jsonb_build_object('threshold', (v_set ->> 'floor_report_rate_pct')::integer)),
                  ('high_cancellations',
                   public.quality_crosses(v_q -> 'cancellation', v_min, (v_set ->> 'floor_cancel_rate_pct')::integer, true),
                   (v_q -> 'cancellation') || jsonb_build_object('threshold', (v_set ->> 'floor_cancel_rate_pct')::integer)),
                  ('low_follow_through',
                   public.quality_crosses(v_q -> 'follow_through', v_min,
                                          (v_set ->> 'floor_follow_through_pct')::integer, false),
                   (v_q -> 'follow_through')
                   || jsonb_build_object('threshold', (v_set ->> 'floor_follow_through_pct')::integer))
               ) k(kind, crossed, figure)
         where coalesce(k.crossed, false)
           and not exists (select 1 from public.quality_flags f
                            where f.provider_id = v_p.id and f.kind = k.kind and f.source_id is null
                              and (f.handled_at is null or f.handled_at > v_cool))
        on conflict do nothing;
        get diagnostics v_n = row_count;
        v_one := v_one + v_n;

        -- The probation kinds: every report by a customer and every provider caused cancel since approval, once each.
        if v_p.approved_at is not null and public.provider_on_probation_with(v_p.id, v_set) then
          insert into public.quality_flags (region, provider_id, kind, source_id, figure)
          select v_region, v_p.id, 'probation_report', x.id, jsonb_build_object('source', 'report')
            from public.problem_reports x
           where x.against_id = v_p.id and x.side = 'customer' and x.created_at >= v_p.approved_at
          on conflict do nothing;
          get diagnostics v_n = row_count;
          v_one := v_one + v_n;

          insert into public.quality_flags (region, provider_id, kind, source_id, figure)
          select v_region, v_p.id, 'probation_cancel', r.id, jsonb_build_object('source', 'request')
            from public.applications a
            join public.requests r on r.selected_application_id = a.id
           where a.provider_id = v_p.id and a.unlocked_at is not null
             and r.cancelled_at >= v_p.approved_at
             and public.provider_caused_cancel(r.id, r.status, r.cancelled_by)
          on conflict do nothing;
          get diagnostics v_n = row_count;
          v_one := v_one + v_n;
        end if;
        v_total := v_total + v_one;
      exception when others then
        raise warning 'quality_flags_failed provider=% sqlstate=%', v_p.id, sqlstate;
      end;
    end loop;
  end loop;
  return v_total;
end;
$$;

revoke all on function public.raise_quality_flags() from public, anon, authenticated, service_role;

-- cron.schedule replaces a job of the same name, so this is safe to run again.
select cron.schedule('providers-quality-flags', '41 * * * *', $$select public.raise_quality_flags()$$);

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Admin acts (AC-5, AC-9). Each checks is_admin() again, takes a note of 10 to 500 characters, and writes one
--    audit row on which no mail or notice hangs.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.admin_handle_quality_flag(p_flag_id uuid, p_outcome text, p_note text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_note  text := public.catalog_trim(coalesce(p_note, ''));
  v_flag  public.quality_flags%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_outcome is null or p_outcome not in ('warned', 'suspended', 'cleared') then
    raise exception 'validation_failed';
  end if;
  if char_length(v_note) not between 10 and 500 then
    raise exception 'reason_required';
  end if;
  select f.* into v_flag from public.quality_flags f where f.id = p_flag_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_flag.handled_at is not null then
    raise exception 'already_handled';
  end if;

  case p_outcome
    when 'warned' then
      -- The provider sees 14's banner with the translated reason, never admin's text.
      insert into public.user_warnings (region, user_id, report_id, reason, created_by)
      values (v_flag.region, v_flag.provider_id, null,
              case when v_flag.kind in ('probation_report', 'probation_cancel') then 'probation_issue'
                   else v_flag.kind end,
              v_uid);
    when 'suspended' then
      -- X-14: the stored status, so a provider whose standing reads document_expired may be suspended too. A fixed
      -- code goes in, never the note; 12's effects, the audit row and its mail and notice follow as today.
      if not exists (select 1 from public.providers pr where pr.id = v_flag.provider_id and pr.status = 'approved') then
        raise exception 'not_approved';
      end if;
      perform public.suspend_provider(v_flag.provider_id, 'quality:' || v_flag.kind);
    else
      null;
  end case;

  update public.quality_flags
     set handled_at = now(), handled_by = v_uid, outcome = p_outcome, note = v_note
   where id = v_flag.id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'quality.flag_handled', 'quality_flags', v_flag.id::text, v_flag.region, null,
          jsonb_build_object('kind', v_flag.kind, 'outcome', p_outcome, 'note', v_note));
  return jsonb_build_object('status', 'ok', 'outcome', p_outcome);
end;
$$;

revoke all on function public.admin_handle_quality_flag(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_handle_quality_flag(uuid, text, text) to authenticated;

-- AC-5: the provider row locked first; an existing waiver refuses before probation is read (X-21).
create function public.admin_end_probation(p_provider_id uuid, p_note text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_note    text := public.catalog_trim(coalesce(p_note, ''));
  v_region  text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if char_length(v_note) not between 10 and 500 then
    raise exception 'reason_required';
  end if;
  select pr.region into v_region from public.providers pr where pr.id = p_provider_id for update;
  if not found then
    raise exception 'not_on_probation';
  end if;
  if exists (select 1 from public.probation_waivers w where w.provider_id = p_provider_id) then
    raise exception 'already_waived';
  end if;
  if not public.provider_on_probation(p_provider_id) then
    raise exception 'not_on_probation';
  end if;
  begin
    insert into public.probation_waivers (provider_id, region, waived_by, note)
    values (p_provider_id, v_region, v_uid, v_note);
  exception when unique_violation then
    raise exception 'already_waived';
  end;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'provider.probation_ended', 'provider', p_provider_id::text, v_region, null,
          jsonb_build_object('note', v_note));
  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.admin_end_probation(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_end_probation(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Admin reads (AC-10 to AC-13). Every region (16, R-1); each checks is_admin() again; nothing here reads a
--     rating (AC-15).
-- ═══════════════════════════════════════════════════════════════════════════

create function public.admin_quality_flags(p_page integer)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_total  integer;
  v_rows   jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_page is null or p_page < 1 or p_page > 10000 then
    raise exception 'validation_failed';
  end if;
  select count(*)::integer into v_total from public.quality_flags f where f.handled_at is null;
  select coalesce(jsonb_agg(t.j order by t.raised_at, t.id), '[]'::jsonb) into v_rows
    from (select f.id, f.raised_at,
                 jsonb_build_object('id', f.id, 'kind', f.kind, 'figure', f.figure, 'raised_at', f.raised_at,
                                    'provider_id', f.provider_id, 'provider_name', pr.approved_name,
                                    'standing', public.provider_standing(f.provider_id), 'region', f.region,
                                    'timezone', g.timezone) as j
            from public.quality_flags f
            join public.providers pr on pr.id = f.provider_id
            join public.regions g on g.code = f.region
           where f.handled_at is null
           order by f.raised_at, f.id
           limit 20 offset (p_page - 1) * 20) t;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;

revoke all on function public.admin_quality_flags(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_quality_flags(integer) to authenticated;

-- AC-11: providers on probation, longest approved first. Settings once per region (X-20); a region with broken
-- settings has nobody on probation (fail open, AC-5).
create function public.admin_probation(p_page integer)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_total  integer;
  v_rows   jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_page is null or p_page < 1 or p_page > 10000 then
    raise exception 'validation_failed';
  end if;
  -- The settings once per region (materialized, so never once per provider row).
  with s as materialized (
    select g.code, g.timezone, public.quality_settings_or_null(g.code) as set from public.regions g
  ), p as materialized (
    select pr.id as provider_id, pr.approved_name as provider_name, pr.region, s.timezone, pr.approved_at,
           (s.set ->> 'probation_jobs')::integer as jobs_needed, (s.set ->> 'probation_live_jobs')::integer as live_limit
      from s
      join public.providers pr on pr.region = s.code
     where s.set is not null and pr.status = 'approved' and public.provider_on_probation_with(pr.id, s.set)
  )
  select (select count(*)::integer from p),
         (select coalesce(jsonb_agg(t.j order by t.approved_at nulls last, t.provider_id), '[]'::jsonb)
            from (select q.provider_id, q.approved_at,
                         jsonb_build_object(
                           'provider_id', q.provider_id, 'provider_name', q.provider_name, 'region', q.region,
                           'timezone', q.timezone, 'approved_at', q.approved_at,
                           'jobs_done', public.provider_jobs_done(q.provider_id), 'jobs_needed', q.jobs_needed,
                           'live', public.provider_live_jobs(q.provider_id), 'live_limit', q.live_limit,
                           'reports', (select count(*)::integer from public.problem_reports x
                                        where x.against_id = q.provider_id and x.side = 'customer'
                                          and x.created_at >= q.approved_at),
                           'open_flags', (select count(*)::integer from public.quality_flags f
                                           where f.provider_id = q.provider_id and f.handled_at is null)) as j
                    from p q
                   order by q.approved_at nulls last, q.provider_id
                   limit 20 offset (p_page - 1) * 20) t)
    into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;

revoke all on function public.admin_probation(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_probation(integer) to authenticated;

-- AC-12: per region, every provider in exactly one stage now, and the first decisions of the current month and the
-- 11 before it, months in the region's time zone. Admin only; no public claim uses the rate (B7).
create function public.admin_quality_funnel()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_g       record;
  v_set     jsonb;
  v_stages  jsonb;
  v_months  jsonb;
  v_out     jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  for v_g in select g.code, g.timezone from public.regions g order by g.code loop
    v_set := public.quality_settings_or_null(v_g.code);

    select jsonb_build_object(
             'draft', count(*) filter (where s.stage = 'draft'),
             'pending', count(*) filter (where s.stage = 'pending'),
             'probation', count(*) filter (where s.stage = 'probation'),
             'active', count(*) filter (where s.stage = 'active'),
             'document_expired', count(*) filter (where s.stage = 'document_expired'),
             'rejected', count(*) filter (where s.stage = 'rejected'),
             'suspended', count(*) filter (where s.stage = 'suspended'))
      into v_stages
      from (select case when x.standing = 'approved'
                        then case when v_set is not null and public.provider_on_probation_with(x.id, v_set)
                                  then 'probation' else 'active' end
                        else x.standing end as stage
              from (select pr.id, public.provider_standing(pr.id) as standing
                      from public.providers pr where pr.region = v_g.code) x) s;

    with first_decision as (
      select distinct on (l.entity_id) l.entity_id, l.action, l.created_at
        from public.providers pr
        join public.audit_log l
          on l.entity_id = pr.id::text and l.action in ('provider.approved', 'provider.rejected')
       where pr.region = v_g.code
       order by l.entity_id, l.created_at, l.id
    ), months as (
      select gs as m
        from generate_series(date_trunc('month', now() at time zone v_g.timezone) - interval '11 months',
                             date_trunc('month', now() at time zone v_g.timezone), interval '1 month') gs
    )
    select coalesce(jsonb_agg(jsonb_build_object(
                      'month', to_char(m.m, 'YYYY-MM'), 'approved', c.approved, 'rejected', c.rejected,
                      'rate', case when c.approved + c.rejected = 0 then null
                                   else round(100 * c.approved::numeric / (c.approved + c.rejected), 1) end)
                    order by m.m desc), '[]'::jsonb)
      into v_months
      from months m
      cross join lateral (
        select count(*) filter (where f.action = 'provider.approved')::integer as approved,
               count(*) filter (where f.action = 'provider.rejected')::integer as rejected
          from first_decision f
         where date_trunc('month', f.created_at at time zone v_g.timezone) = m.m) c;

    v_out := v_out || jsonb_build_array(jsonb_build_object('region', v_g.code, 'timezone', v_g.timezone,
                                                           'stages', v_stages, 'months', v_months));
  end loop;
  return v_out;
end;
$$;

revoke all on function public.admin_quality_funnel() from public, anon, authenticated, service_role;
grant execute on function public.admin_quality_funnel() to authenticated;

-- AC-13: every figure of one provider with its counts, probation, the waiver, and the last 20 flags. A broken
-- setting raises quality_settings_invalid, which the door maps.
create function public.admin_provider_quality(p_provider_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_pr     public.providers%rowtype;
  v_tz     text;
  v_set    jsonb;
  v_flags  jsonb;
  v_wv     jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select pr.* into v_pr from public.providers pr where pr.id = p_provider_id;
  if not found then
    raise exception 'not_found';
  end if;
  select g.timezone into v_tz from public.regions g where g.code = v_pr.region;
  v_set := public.quality_settings(v_pr.region);

  select jsonb_build_object('note', w.note, 'by_name', p.full_name, 'at', w.created_at) into v_wv
    from public.probation_waivers w
    left join public.profiles p on p.id = w.waived_by
   where w.provider_id = v_pr.id;

  select coalesce(jsonb_agg(t.j order by t.raised_at desc, t.id), '[]'::jsonb) into v_flags
    from (select f.id, f.raised_at,
                 jsonb_build_object('id', f.id, 'kind', f.kind, 'figure', f.figure, 'raised_at', f.raised_at,
                                    'outcome', f.outcome, 'note', f.note, 'handled_by_name', p.full_name,
                                    'handled_at', f.handled_at) as j
            from public.quality_flags f
            left join public.profiles p on p.id = f.handled_by
           where f.provider_id = v_pr.id
           order by f.raised_at desc, f.id
           limit 20) t;

  return jsonb_build_object(
    'timezone', v_tz,
    'metrics', public.provider_quality_with(v_pr.id, v_set),
    'probation', case when public.provider_on_probation_with(v_pr.id, v_set)
                      then jsonb_build_object('jobs_done', public.provider_jobs_done(v_pr.id),
                                              'jobs_needed', (v_set ->> 'probation_jobs')::integer,
                                              'live', public.provider_live_jobs(v_pr.id),
                                              'live_limit', (v_set ->> 'probation_live_jobs')::integer) end,
    'waiver', v_wv,
    'flags', v_flags);
end;
$$;

revoke all on function public.admin_provider_quality(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_provider_quality(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. The document expiry reminder (AC-14). A daily job writes one audit row per approved required document that
--     expires within document_reminder_days; 13's mail and 18's notices hang on it through the recipient map. A
--     replaced document has a new object_id, so it gets its own reminder later. The unique index of section 2 keeps
--     it to one row per document object.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.queue_document_reminders()
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_region  text;
  v_days    integer;
  v_n       integer;
  v_total   integer := 0;
begin
  for v_region in select g.code from public.regions g order by g.code loop
    begin
      v_days := public.document_reminder_days(v_region);
    exception when others then
      raise warning 'document_reminders_skipped region=% sqlstate=%', v_region, sqlstate;
      continue;
    end;
    insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
    select null, 'provider.document_expiring', 'provider', pr.id::text, pr.region, null,
           jsonb_build_object('document_type', d.type, 'valid_until', d.valid_until, 'object_id', d.object_id)
      from public.providers pr
      join public.provider_documents d on d.provider_id = pr.id
     where pr.region = v_region
       and pr.status = 'approved'
       and public.provider_standing(pr.id) = 'approved'
       and d.type = any (public.provider_required_types(pr.region))
       and d.status = 'approved'
       and d.valid_until between current_date and current_date + v_days
       and not exists (select 1 from public.audit_log l
                        where l.action = 'provider.document_expiring' and l.entity_id = pr.id::text
                          and l.new_value ->> 'object_id' = d.object_id::text)
     order by pr.id, d.type
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end;
$$;

revoke all on function public.queue_document_reminders() from public, anon, authenticated, service_role;

select cron.schedule('providers-document-reminders', '0 6 * * *', $$select public.queue_document_reminders()$$);

-- 18's kinds plus document_expiring.
alter table public.notifications drop constraint notifications_kind_valid;
alter table public.notifications add constraint notifications_kind_valid check (kind in (
  'new_offer', 'chosen', 'pay_your_fee', 'commission_received', 'contacts_ready', 'job_started', 'please_confirm',
  'job_completed', 'request_cancelled', 'pick_again', 'pick_ended', 'window_missed', 'payment_too_late',
  'fee_refunded', 'account_approved', 'account_rejected', 'account_suspended', 'pay_window_closing', 'closes_soon',
  'report_received', 'report_new_admin', 'report_handled', 'rate_provider', 'rating_received', 'document_expiring'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. The map and the mail (AC-14): 18's audit_notices with a document_expiring branch (the provider, entity the
--     provider_documents row still holding that object, until the end of valid_until in the region's time zone),
--     17's queue_email with the template, 17's email_context with its send time check, and both triggers' lists.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.audit_notices(p_audit_id bigint)
  returns table (o_recipient uuid, o_kind text, o_request uuid, o_entity uuid, o_send_until timestamptz,
                 o_deadline timestamptz, o_topic text)
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_a       public.audit_log%rowtype;
  v_req     public.requests%rowtype;
  v_ref     public.fee_refunds%rowtype;
  v_rep     public.problem_reports%rowtype;
  v_app     uuid;
  v_prov    uuid;
  v_payer   uuid;
  v_request uuid;
  v_fee     uuid;
  v_rate    timestamptz;
  v_day     timestamptz := now() + interval '24 hours';
begin
  select a.* into v_a from public.audit_log a where a.id = p_audit_id;
  if not found or v_a.region is null then
    return;
  end if;

  -- The account.
  if v_a.action in ('provider.approved', 'provider.reinstated', 'provider.rejected', 'provider.suspended') then
    return query
      select v_a.entity_id::uuid,
             case v_a.action when 'provider.rejected' then 'account_rejected'
                             when 'provider.suspended' then 'account_suspended'
                             else 'account_approved' end,
             null::uuid, v_a.entity_id::uuid, v_day, null::timestamptz, null::text;
    return;
  end if;

  -- AC-14 of 0011-19a: a required document expiring, to the provider. The entity is the provider_documents row that
  -- still holds the reminded object (nothing when it was replaced before this runs), until the end of valid_until in
  -- the region's time zone. An account matter: no topic.
  if v_a.action = 'provider.document_expiring' then
    return query
      select v_a.entity_id::uuid, 'document_expiring'::text, null::uuid, d.id,
             ((d.valid_until + 1)::timestamp at time zone g.timezone),
             ((d.valid_until + 1)::timestamp at time zone g.timezone), null::text
        from public.provider_documents d
        join public.regions g on g.code = v_a.region
       where d.provider_id = v_a.entity_id::uuid
         and d.object_id::text = v_a.new_value ->> 'object_id';
    return;
  end if;

  -- AC-10 of 0012: a set or changed password, to the account owner (mail only; notices skip it, R-3).
  if v_a.action in ('auth.password_set', 'auth.password_changed') then
    return query
      select v_a.entity_id::uuid, 'password_changed'::text, null::uuid, v_a.entity_id::uuid, v_day, null::timestamptz,
             null::text;
    return;
  end if;

  -- The reports (14): the reporter, and for a new report every admin of the report's region.
  if v_a.action in ('report.opened', 'report.handled') then
    select x.* into v_rep from public.problem_reports x where x.id = v_a.entity_id::uuid;
    if not found then
      return;
    end if;
    if v_a.action = 'report.handled' then
      return query
        select v_rep.reporter_id, 'report_handled'::text, v_rep.request_id, v_rep.id, v_day, null::timestamptz,
               null::text
         where v_rep.reporter_id is not null;
      return;
    end if;
    return query
      select v_rep.reporter_id, 'report_received'::text, v_rep.request_id, v_rep.id, v_day, null::timestamptz,
             null::text
       where v_rep.reporter_id is not null;
    return query
      select p.id, 'report_new_admin'::text, v_rep.request_id, v_rep.id, v_day, null::timestamptz, null::text
        from public.profiles p
       where p.role = 'admin' and p.region = v_rep.region
       order by p.id;
    return;
  end if;

  -- The fees (the payer, 13's X-7). fee.late names the fee; its late refund is in new_value.
  if v_a.action = 'fee.late' then
    select f.payer_id, f.request_id into v_payer, v_request from public.fee_payments f where f.id = v_a.entity_id::uuid;
    return query
      select v_payer, 'payment_too_late'::text, v_request, (v_a.new_value ->> 'fee_refund_id')::uuid, v_day,
             null::timestamptz, null::text
       where v_payer is not null;
    return;
  end if;
  if v_a.action in ('fee.refunded', 'fee.refund_done_by_hand') then
    select x.* into v_ref from public.fee_refunds x where x.id = v_a.entity_id::uuid;
    if not found then
      return;
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
    return query
      select v_payer, 'fee_refunded'::text, v_ref.request_id, v_ref.id, v_day, null::timestamptz, null::text
       where v_payer is not null;
    return;
  end if;

  -- The request moves: the audit row names the request.
  select r.* into v_req from public.requests r where r.id = v_a.entity_id::uuid;
  if not found then
    return;
  end if;
  v_app := (v_a.new_value ->> 'application_id')::uuid;
  select a.provider_id into v_prov from public.applications a where a.id = v_app;

  case v_a.action
    when 'request.provider_chosen' then
      if v_a.new_value ->> 'status' = 'COMMISSION_PAID' then
        -- A carried commission (12): the new pick pays at once.
        return query
          select v_prov, 'pay_your_fee'::text, v_req.id, v_app, coalesce(v_req.fee_deadline, v_day), v_req.fee_deadline,
                 null::text
           where v_prov is not null;
      else
        return query
          select v_prov, 'chosen'::text, v_req.id, v_app, v_day, null::timestamptz, null::text
           where v_prov is not null;
      end if;
    when 'request.commission_paid' then
      select f.id into v_fee from public.fee_payments f where f.request_id = v_req.id and f.kind = 'commission';
      return query
        select v_req.customer_id, 'commission_received'::text, v_req.id, v_fee, v_day, null::timestamptz, null::text
         where v_req.customer_id is not null;
      return query
        select v_prov, 'pay_your_fee'::text, v_req.id, v_app, coalesce(v_req.fee_deadline, v_day), v_req.fee_deadline,
               null::text
         where v_prov is not null;
    when 'request.unlocked' then
      return query
        select v_req.customer_id, 'contacts_ready'::text, v_req.id, v_app, v_day, null::timestamptz, null::text
         where v_req.customer_id is not null;
      return query
        select v_prov, 'contacts_ready'::text, v_req.id, v_app, v_day, null::timestamptz, null::text
         where v_prov is not null;
    when 'job.started' then
      return query
        select v_req.customer_id, 'job_started'::text, v_req.id, v_app, v_day, null::timestamptz, 'work_updates'::text
         where v_req.customer_id is not null;
    when 'job.done' then
      if public.auto_close_enabled(v_a.region) then
        return query
          select v_req.customer_id, 'please_confirm'::text, v_req.id, v_app, coalesce(v_req.confirm_deadline, v_day),
                 v_req.confirm_deadline, null::text
           where v_req.customer_id is not null;
      else
        return query
          select v_req.customer_id, 'please_confirm'::text, v_req.id, v_app, v_day, null::timestamptz, null::text
           where v_req.customer_id is not null;
      end if;
    when 'job.confirmed', 'job.customer_closed', 'job.auto_closed', 'job.closed_by_admin' then
      return query
        select v_prov, 'job_completed'::text, v_req.id, v_app, v_day, null::timestamptz, 'work_updates'::text
         where v_prov is not null;
      -- AC-9 of 0011-17: the rating invite, until the window's end. A broken rating setting skips the invite only,
      -- never the provider's notice above.
      if v_a.action in ('job.auto_closed', 'job.closed_by_admin') and v_req.closed_at is not null then
        begin
          v_rate := v_req.closed_at
                    + make_interval(hours => 24 * (public.rating_settings(v_a.region) ->> 'rating_window_days')::integer);
        exception when raise_exception then
          if sqlerrm <> 'rating_settings_invalid' then
            raise;
          end if;
          v_rate := null;
        end;
        if v_rate is not null then
          return query
            select v_req.customer_id, 'rate_provider'::text, v_req.id, v_app, v_rate, v_rate, 'ratings'::text
             where v_req.customer_id is not null;
        end if;
      end if;
    when 'rating.created' then
      -- AC-9 of 0011-17: the provider, at once; only that a rating arrived, never the score.
      return query
        select v_prov, 'rating_received'::text, v_req.id, v_app, v_day, null::timestamptz, 'ratings'::text
         where v_prov is not null;
    when 'request.cancelled' then
      -- The customer cancelled: the provider of the pick, when there is one (the cancel keeps the column).
      v_app := v_req.selected_application_id;
      v_prov := null;
      select a.provider_id into v_prov from public.applications a where a.id = v_app;
      return query
        select v_prov, 'request_cancelled'::text, v_req.id, v_app, v_day, null::timestamptz, null::text
         where v_prov is not null;
    when 'request.admin_cancelled' then
      -- R-4, X-10 of 16: the customer and the provider of the pick, when there is one.
      v_app := v_req.selected_application_id;
      v_prov := null;
      select a.provider_id into v_prov from public.applications a where a.id = v_app;
      return query
        select v_req.customer_id, 'request_cancelled'::text, v_req.id, null::uuid, v_day, null::timestamptz, null::text
         where v_req.customer_id is not null;
      return query
        select v_prov, 'request_cancelled'::text, v_req.id, v_app, v_day, null::timestamptz, null::text
         where v_prov is not null;
    when 'request.provider_cancelled', 'request.failed_picks_limit', 'request.no_paid_pick' then
      -- The customer, with the commission refund when the cancel queued one.
      return query
        select v_req.customer_id, 'request_cancelled'::text, v_req.id, (v_a.new_value ->> 'fee_refund_id')::uuid, v_day,
               null::timestamptz, null::text
         where v_req.customer_id is not null;
    when 'request.pick_expired' then
      return query
        select v_req.customer_id, 'pick_again'::text, v_req.id, v_app, v_day, null::timestamptz, null::text
         where v_req.customer_id is not null;
      return query
        select v_prov, 'pick_ended'::text, v_req.id, v_app, v_day, null::timestamptz, null::text
         where v_prov is not null;
    when 'request.fee_expired' then
      return query
        select v_req.customer_id, 'pick_again'::text, v_req.id, v_app, v_day, null::timestamptz, null::text
         where v_req.customer_id is not null;
      return query
        select v_prov, 'window_missed'::text, v_req.id, v_app, v_day, null::timestamptz, null::text
         where v_prov is not null;
    when 'request.provider_withdrew' then
      -- Only a withdrawn pick (new_value.request is `reopened` or `cancelled`), never an offer withdrawn.
      if coalesce(v_a.new_value ->> 'request', 'none') <> 'none' then
        return query
          select v_req.customer_id, 'pick_again'::text, v_req.id, v_app, v_day, null::timestamptz, null::text
           where v_req.customer_id is not null;
      end if;
    when 'request.pick_dropped' then
      return query
        select v_req.customer_id, 'pick_again'::text, v_req.id, v_app, v_day, null::timestamptz, null::text
         where v_req.customer_id is not null;
    else
      return;
  end case;
  return;
end;
$$;

revoke all on function public.audit_notices(bigint) from public, anon, authenticated, service_role;

-- 17's template list plus document_expiring.
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
                           'report_received', 'report_new_admin', 'report_handled', 'password_changed',
                           'rate_provider', 'rating_received', 'document_expiring') then
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

-- 17's body plus a document_expiring case (AC-14 of 0011-19a): the provider's document row still approved and still
-- inside the reminder days (a fresh replacement since means no mail); its values add the document type and the date.
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
  v_name     text;
  v_values   jsonb;
  v_doc      public.provider_documents%rowtype;
  v_days     integer;
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
    when 'rate_provider' then
      -- AC-9 of 0011-17: the customer, while no rating exists and the window, from the current setting, is open.
      begin
        v_dead := v_req.closed_at
                  + make_interval(hours => 24 * (public.rating_settings(v_o.region) ->> 'rating_window_days')::integer);
      exception when raise_exception then
        if sqlerrm <> 'rating_settings_invalid' then
          raise;
        end if;
        v_dead := null;
      end;
      v_ok := v_side = 'customer' and v_req.status = 'COMPLETED' and v_dead is not null and now() <= v_dead
              and v_req.selected_application_id = v_entity
              and not exists (select 1 from public.ratings x where x.request_id = v_req.id);
      select public.offer_display_name(pr.approved_name) ->> 'display_name' into v_name
        from public.applications a
        join public.providers pr on pr.id = a.provider_id
       where a.id = v_entity;
    when 'document_expiring' then
      select d.* into v_doc from public.provider_documents d where d.id = v_entity and d.provider_id = v_rcp;
      begin
        v_days := public.document_reminder_days(v_o.region);
      exception when raise_exception then
        if sqlerrm <> 'document_reminder_settings_invalid' then
          raise;
        end if;
        v_days := null;
      end;
      v_ok := v_doc.id is not null and v_doc.status = 'approved' and v_days is not null
              and v_doc.valid_until <= current_date + v_days;
      v_dead := (v_doc.valid_until + 1)::timestamp at time zone v_reg.timezone;
    when 'contacts_ready', 'job_started', 'job_completed', 'pick_ended', 'window_missed', 'confirm_email',
         'account_rejected', 'account_suspended', 'password_changed', 'rating_received' then
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
  if v_tpl = 'password_changed' then
    -- AC-10 of 0012: the outbox row is written in the change's own transaction, so its time is the change's.
    v_values := v_values || jsonb_build_object('changed_at', v_o.created_at);
  end if;
  if v_tpl in ('report_received', 'report_handled', 'report_new_admin') then
    v_values := v_values || jsonb_build_object('report_id', v_rep.id, 'reason', v_rep.reason);
  end if;
  if v_tpl = 'rate_provider' then
    v_values := v_values || jsonb_build_object('provider_name', v_name);
  end if;
  if v_tpl = 'document_expiring' then
    v_values := v_values || jsonb_build_object('document_type', v_doc.type,
                                               'valid_until', to_char(v_doc.valid_until, 'YYYY-MM-DD'));
  end if;
  if v_tpl = 'rating_received' then
    -- Security review M-1 (2026-11-22): the provider's notice carries nothing that names the rated job, so no later
    -- wording can show it.
    v_values := v_values || jsonb_build_object('request_id', null, 'service', null, 'start_at', null);
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

-- AC-14 of 0011-19a: both when lists gain provider.document_expiring; supabase/tests/29 and 37 prove each list equals
-- the map's actions (minus the mail only ones for notices).
drop trigger audit_log_email on public.audit_log;
create trigger audit_log_email after insert on public.audit_log
  for each row
  when (new.action in ('request.provider_chosen', 'request.commission_paid', 'request.unlocked', 'job.started',
                       'job.done', 'job.confirmed', 'job.customer_closed', 'job.auto_closed', 'request.cancelled',
                       'request.provider_cancelled', 'request.failed_picks_limit', 'request.no_paid_pick',
                       'request.pick_expired', 'request.fee_expired', 'request.provider_withdrew', 'request.pick_dropped',
                       'fee.late', 'fee.refunded', 'fee.refund_done_by_hand', 'profile.email_changed',
                       'provider.approved', 'provider.reinstated', 'provider.rejected', 'provider.suspended',
                       'job.closed_by_admin', 'report.opened', 'report.handled', 'request.admin_cancelled',
                       'auth.password_set', 'auth.password_changed', 'rating.created', 'provider.document_expiring'))
  execute function public.audit_log_email();

drop trigger audit_log_notice on public.audit_log;
create trigger audit_log_notice after insert on public.audit_log
  for each row
  when (new.action in ('request.provider_chosen', 'request.commission_paid', 'request.unlocked', 'job.started',
                       'job.done', 'job.confirmed', 'job.customer_closed', 'job.auto_closed', 'request.cancelled',
                       'request.provider_cancelled', 'request.failed_picks_limit', 'request.no_paid_pick',
                       'request.pick_expired', 'request.fee_expired', 'request.provider_withdrew', 'request.pick_dropped',
                       'fee.late', 'fee.refunded', 'fee.refund_done_by_hand',
                       'provider.approved', 'provider.reinstated', 'provider.rejected', 'provider.suspended',
                       'job.closed_by_admin', 'report.opened', 'report.handled', 'request.admin_cancelled',
                       'rating.created', 'provider.document_expiring'))
  execute function public.audit_log_notice();
