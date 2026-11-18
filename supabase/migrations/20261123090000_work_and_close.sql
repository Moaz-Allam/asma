-- Position 11 (spec 0011-11, amended by D180 with rules R-1 to R-13): work and close. No money moves (D91).
--
-- After the reveal the provider presses Started (from 00:00 of the start day in the region's time zone) and Done;
-- the customer confirms, or marks the job done from the start day if the provider never presses anything. A job
-- that reached Done closes by itself confirm_window_hours later, but only where auto_close_enabled is on (R-2: off
-- until 13's notice and 14's Not done exist). Every close writes closed_at and closed_by, so 10's contact window
-- starts. Each move writes one audit_log row (A-2), ids only.
--
-- Lock order (D169, R-3): the requests row first, then the selected application, then (provider functions) the
-- caller's provider row for share. A replay answers replayed only when the state already matches the caller's own
-- move. Every function revokes PUBLIC and pins search_path (supabase/tests/02).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Settings (AC-1, R-2). confirm_window_hours (07, 72 ☐) is held to whole hours 1 to 720; auto_close_enabled is a
--    JSON boolean (the existing `_enabled` check), seeded off. Both join the guard's required keys.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_confirm_window_hours_valid check (
    case when key <> 'confirm_window_hours' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 720 end);

insert into public.platform_settings (region, key, value) values
  ('TR',  'auto_close_enabled', 'false'),
  ('KSA', 'auto_close_enabled', 'false')
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
                 'unlock_window_hours', 'contact_visible_days', 'confirm_window_hours', 'auto_close_enabled')
     and (tg_op = 'DELETE' or new.key is distinct from old.key or new.region is distinct from old.region) then
    raise exception 'pricing_setting_required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.pricing_settings_guard() from public, anon, authenticated, service_role;

create function public.confirm_settings(p_region text)
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
   where s.region = p_region and s.key = 'confirm_window_hours';
  if jsonb_typeof(v_value) is distinct from 'number'
     or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
     or (v_value #>> '{}')::numeric not between 1 and 720 then
    raise exception 'confirm_settings_invalid';
  end if;
  return (v_value #>> '{}')::integer;
end;
$$;

revoke all on function public.confirm_settings(text) from public, anon, authenticated, service_role;

-- Fails closed, as payments_enabled (08).
create function public.auto_close_enabled(p_region text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select coalesce((select s.value = 'true'::jsonb
                     from public.platform_settings s
                    where s.region = p_region and s.key = 'auto_close_enabled'), false)
$$;

revoke all on function public.auto_close_enabled(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Columns and checks (AC-1, R-4). No row is COMPLETED before launch, so the check is added validated.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.requests
  add column actual_started_at timestamptz,
  add column actual_completed_at timestamptz,
  add column confirm_deadline timestamptz,
  add column closed_by text,
  add constraint requests_closed_by_valid check (closed_by is null or closed_by in ('customer', 'auto')),
  add constraint requests_closed_by_set check ((closed_by is null) = (closed_at is null)),
  add constraint requests_completed_closed check (status <> 'COMPLETED' or (closed_at is not null and closed_by is not null)),
  add constraint requests_confirm_after_done check (
    confirm_deadline is null or (actual_completed_at is not null and confirm_deadline > actual_completed_at)),
  -- Security review S11-4: a state always carries its columns, so an AWAITING_CONFIRMATION row can always close.
  add constraint requests_awaiting_has_deadline check (
    status <> 'AWAITING_CONFIRMATION' or (confirm_deadline is not null and actual_completed_at is not null)),
  add constraint requests_started_has_time check (
    status not in ('IN_PROGRESS', 'AWAITING_CONFIRMATION') or actual_started_at is not null);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The guards (R-4).
-- ═══════════════════════════════════════════════════════════════════════════

-- 10's guard, widened: the work moves, each new column written once with its move.
create or replace function public.requests_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                            'selected_application_id', 'selected_at', 'payment_deadline', 'fee_deadline', 'closed_at',
                            'actual_started_at', 'actual_completed_at', 'confirm_deadline', 'closed_by'])
     is distinct from (to_jsonb(old) - array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                                             'selected_application_id', 'selected_at', 'payment_deadline',
                                             'fee_deadline', 'closed_at', 'actual_started_at', 'actual_completed_at',
                                             'confirm_deadline', 'closed_by']) then
    raise exception 'request_immutable';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'OPEN' and new.status in ('CANCELLED', 'SELECTED'))
              or (old.status = 'SELECTED' and new.status in ('CANCELLED', 'COMMISSION_PAID'))
              or (old.status = 'COMMISSION_PAID' and new.status = 'UNLOCKED')
              or (old.status = 'UNLOCKED' and new.status in ('IN_PROGRESS', 'COMPLETED'))
              or (old.status = 'IN_PROGRESS' and new.status in ('AWAITING_CONFIRMATION', 'COMPLETED'))
              or (old.status = 'AWAITING_CONFIRMATION' and new.status = 'COMPLETED')) then
    raise exception 'request_transition_invalid';
  end if;
  if (new.selected_application_id, new.selected_at, new.payment_deadline)
     is distinct from (old.selected_application_id, old.selected_at, old.payment_deadline)
     and not (old.status = 'OPEN' and new.status = 'SELECTED') then
    raise exception 'request_immutable';
  end if;
  if new.fee_deadline is distinct from old.fee_deadline
     and not (old.status = 'SELECTED' and new.status = 'COMMISSION_PAID') then
    raise exception 'request_immutable';
  end if;
  if old.status = 'SELECTED' and new.status = 'COMMISSION_PAID' and new.fee_deadline is null then
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

-- 10's guard, widened: the work moves of the selected application, and nothing else into or out of them.
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
  if new.status is distinct from old.status
     and old.status in ('NOT_SELECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED', 'CONFIRMED', 'RATED') then
    raise exception 'application_final';
  end if;
  -- R-4: the work moves. Out of UNLOCKED, STARTED or COMPLETED, and into STARTED, COMPLETED or CONFIRMED, only
  -- these (12 adds the cancels; 13 and 17 add CONFIRMED -> RATED).
  if new.status is distinct from old.status
     and (old.status in ('UNLOCKED', 'STARTED', 'COMPLETED') or new.status in ('STARTED', 'COMPLETED', 'CONFIRMED'))
     and not ((old.status = 'UNLOCKED' and new.status in ('STARTED', 'CONFIRMED'))
              or (old.status = 'STARTED' and new.status in ('COMPLETED', 'CONFIRMED'))
              or (old.status = 'COMPLETED' and new.status = 'CONFIRMED')) then
    raise exception 'application_transition_invalid';
  end if;
  return new;
end;
$$;

revoke all on function public.applications_guard() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The start day (R-8): 00:00 of the scheduled start's date in the region's time zone.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.start_day_reached(p_request_id uuid)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select now() >= (date_trunc('day', r.scheduled_start_at at time zone g.timezone)) at time zone g.timezone
    from public.requests r join public.regions g on g.code = r.region
   where r.id = p_request_id
$$;

revoke all on function public.start_day_reached(uuid) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The provider's moves (AC-2, AC-3, R-3, R-6).
-- ═══════════════════════════════════════════════════════════════════════════

-- The request and its selected application, locked, for the caller as that application's provider; the provider
-- row shared. not_found for anyone else, provider_suspended when not approved (an expired document still works:
-- the job was paid, A-6 of 10).
create function public.job_for_provider(p_request_id uuid)
  returns public.applications
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_req  public.requests%rowtype;
  v_app  public.applications%rowtype;
begin
  -- Security review S11-2: only the selected, unlocked provider can take the request's lock.
  select r.* into v_req from public.requests r
   where r.id = p_request_id
     and exists (select 1 from public.applications a
                  where a.id = r.selected_application_id and a.provider_id = v_uid and a.unlocked_at is not null)
     for update of r;
  if not found then
    raise exception 'not_found';
  end if;
  select a.* into v_app from public.applications a
   where a.id = v_req.selected_application_id and a.provider_id = v_uid and a.unlocked_at is not null
     for update;
  if not found then
    raise exception 'not_found';
  end if;
  perform 1 from public.providers pr where pr.id = v_uid for share;
  if not exists (select 1 from public.providers pr where pr.id = v_uid and pr.status = 'approved') then
    raise exception 'provider_suspended';
  end if;
  return v_app;
end;
$$;

revoke all on function public.job_for_provider(uuid) from public, anon, authenticated, service_role;

create function public.start_job(p_request_id uuid)
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
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values ((select auth.uid()), 'job.started', 'requests', p_request_id::text, v_region,
          jsonb_build_object('status', 'UNLOCKED'), jsonb_build_object('status', 'IN_PROGRESS', 'application_id', v_app.id));
  return jsonb_build_object('status', 'ok', 'replayed', false);
end;
$$;

revoke all on function public.start_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.start_job(uuid) to authenticated;

create function public.finish_job(p_request_id uuid)
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
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values ((select auth.uid()), 'job.done', 'requests', p_request_id::text, v_region,
          jsonb_build_object('status', 'IN_PROGRESS'),
          jsonb_build_object('status', 'AWAITING_CONFIRMATION', 'application_id', v_app.id));
  return jsonb_build_object('status', 'ok', 'replayed', false);
end;
$$;

revoke all on function public.finish_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.finish_job(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The customer's moves (AC-4, AC-5, R-3, R-6, R-9).
-- ═══════════════════════════════════════════════════════════════════════════

-- The one close of a request and its selected application to COMPLETED / CONFIRMED. The request row is locked
-- by the caller.
create function public.close_job(p_request_id uuid, p_by text, p_action text)
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
  -- Review: the callers check the state; this asserts it too.
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
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  -- R-10: the auto close has no actor, whatever session runs it.
  values (case when p_by = 'auto' then null else (select auth.uid()) end, p_action, 'requests', p_request_id::text, v_req.region,
          jsonb_build_object('status', v_req.status),
          jsonb_build_object('status', 'COMPLETED', 'closed_by', p_by, 'application_id', v_req.selected_application_id));
end;
$$;

revoke all on function public.close_job(uuid, text, text) from public, anon, authenticated, service_role;

create function public.confirm_job(p_request_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_req  public.requests%rowtype;
begin
  select r.* into v_req from public.requests r
   where r.id = p_request_id and r.customer_id = (select auth.uid())
     for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_req.status = 'COMPLETED' and v_req.closed_by = 'customer' then
    return jsonb_build_object('status', 'ok', 'replayed', true);
  end if;
  -- R-3: a confirm after confirm_deadline but before the auto close is accepted: the customer's word wins.
  if v_req.status <> 'AWAITING_CONFIRMATION' then
    raise exception 'invalid_state';
  end if;
  perform public.close_job(p_request_id, 'customer', 'job.confirmed');
  return jsonb_build_object('status', 'ok', 'replayed', false);
end;
$$;

revoke all on function public.confirm_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.confirm_job(uuid) to authenticated;

create function public.customer_mark_done(p_request_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_req  public.requests%rowtype;
begin
  select r.* into v_req from public.requests r
   where r.id = p_request_id and r.customer_id = (select auth.uid())
     for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_req.status = 'COMPLETED' and v_req.closed_by = 'customer' then
    return jsonb_build_object('status', 'ok', 'replayed', true);
  end if;
  if v_req.status not in ('UNLOCKED', 'IN_PROGRESS') then
    raise exception 'invalid_state';
  end if;
  if not public.start_day_reached(p_request_id) then
    raise exception 'too_early';
  end if;
  perform public.close_job(p_request_id, 'customer', 'job.customer_closed');
  return jsonb_build_object('status', 'ok', 'replayed', false);
end;
$$;

revoke all on function public.customer_mark_done(uuid) from public, anon, authenticated, service_role;
grant execute on function public.customer_mark_done(uuid) to authenticated;

-- R-2, R-5: what the customer's page needs to word the close: whether the region closes by itself, and whether
-- "Job done" may be pressed now. The customer of the request only.
create function public.request_close_info(p_request_id uuid)
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
    'can_mark_done', v_req.status in ('UNLOCKED', 'IN_PROGRESS') and public.start_day_reached(v_req.id));
end;
$$;

revoke all on function public.request_close_info(uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_close_info(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The auto close (AC-6, R-2, R-10). Run by pg_cron as postgres; no API grant. At most 200 a run, each in its own
--    subtransaction, locked rows skipped (taken next run), nothing while the region's switch is off.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.auto_close_jobs()
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

select cron.schedule('jobs-auto-close', '*/10 * * * *', $$select public.auto_close_jobs()$$);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. My jobs, replaced (AC-7, A-3, R-5): Active keeps a job until it closes; each row carries the request's state,
--    its work dates and whether Started may be pressed now. Still no contact field.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.provider_jobs(p_tab text, p_after_changed_at timestamptz, p_after_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_me        public.providers%rowtype;
  v_tz        text;
  v_statuses  text[];
  v_rows      jsonb;
  v_more      boolean;
begin
  v_statuses := case p_tab
    when 'applied' then array['APPLIED', 'SELECTED']
    when 'chosen'  then array['AWAITING_FEE']
    when 'active'  then array['UNLOCKED', 'STARTED', 'COMPLETED']
    when 'done'    then array['CONFIRMED', 'RATED', 'NOT_SELECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED']
  end;
  if v_statuses is null then
    raise exception 'validation_failed';
  end if;
  v_me := public.provider_reader();
  select g.timezone into v_tz from public.regions g where g.code = v_me.region;

  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= 20), '[]'::jsonb), count(*) > 20
    into v_rows, v_more
    from (
      select row_number() over (order by m.status_changed_at desc, m.id desc) as rn,
             public.provider_short_details(m.req) || jsonb_build_object(
               'application_id', m.id,
               'application_status', m.status,
               'status_changed_at', m.status_changed_at,
               'provider_fee_amount', m.provider_fee_amount,
               'unlocked_at', m.unlocked_at,
               'payment_deadline', case when m.status = 'SELECTED' then (m.req).payment_deadline end,
               'fee_deadline', case when m.status = 'AWAITING_FEE'
                                    then least((m.req).fee_deadline, (m.req).scheduled_start_at) end,
               -- Security review S11-1: the request's state and work dates only for the caller's own selected,
               -- unlocked application; a losing or past pick learns nothing of the winner's job (rule 2).
               'request_status', case when m.own then (m.req).status end,
               'actual_started_at', case when m.own then (m.req).actual_started_at end,
               'confirm_deadline', case when m.own then (m.req).confirm_deadline end,
               'closed_at', case when m.own then (m.req).closed_at end,
               'can_start', m.own and m.status = 'UNLOCKED' and (m.req).status = 'UNLOCKED'
                            and public.start_day_reached((m.req).id)) as j
        from (
          select a.id, a.status, a.status_changed_at, a.provider_fee_amount, a.unlocked_at, r as req,
                 (a.id = r.selected_application_id and a.unlocked_at is not null) as own
            from public.applications a
            join public.requests r on r.id = a.request_id
           where a.provider_id = v_me.id
             and a.status = any (v_statuses)
             and (p_after_changed_at is null or p_after_id is null
                  or (a.status_changed_at, a.id) < (p_after_changed_at, p_after_id))
           order by a.status_changed_at desc, a.id desc
           limit 21
        ) m
    ) x;

  return jsonb_build_object('timezone', v_tz, 'now', now(), 'has_more', v_more, 'rows', v_rows);
end;
$$;

revoke all on function public.provider_jobs(text, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.provider_jobs(text, timestamptz, uuid) to authenticated;
