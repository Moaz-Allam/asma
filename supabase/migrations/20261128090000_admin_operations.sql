-- Position 16 (spec 0011-16, amended by D197 with rules R-1 to R-14 and cross check rules X-1 to X-16; an X rule
-- wins over an R rule, a rule over an AC): admin operations.
--
-- Admin sees every region (R-1). New: a request list (R-2), the admin cancel with an attribution (R-3, X-1, X-2,
-- X-8, X-9), one deadline extension per pick or per request (R-5, X-5 to X-7), the flag queue and the hand clear
-- (R-7, X-15), the street line on click, audited (R-8, X-13), and revenue from the ledger by day or month (R-9,
-- X-11, X-12). Replaced from their latest bodies: cancel_by_rule (12, a seventh argument p_meta), requests_guard and
-- applications_guard (14, the extension moves, R-6, X-3, X-4), raise_deadline_flags (12, the hand clear latch) and
-- queue_audit_email with the audit_log_email trigger (14, request.admin_cancelled, R-4, X-10).
--
-- Three nullable columns; cancellation_rules rows for admin in OPEN and SELECTED. Every admin function is a definer
-- that checks is_admin() again, revokes PUBLIC and pins search_path (supabase/tests/02, 10). Refusals are stable
-- codes in the exception message: forbidden, not_found, validation_failed, reason_required, invalid_state,
-- not_cancellable, checkout_open, already_extended, deadline_after_start, already_cleared, not_available;
-- lib/admin-requests and lib/admin-revenue map them. No argument is an amount (rule 1).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Columns (R-5, X-6, X-7). The allowance lives on the pick's application, so a new pick gets a fresh one; the
--    confirm allowance lives on the request and is never reset.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.applications
  add column payment_extended_at timestamptz,
  add column fee_extended_at timestamptz;

alter table public.requests
  add column confirm_extended_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The matrix (R-3, X-8): admin may cancel OPEN and SELECTED; nothing is paid, so nothing comes back, and it
--    counts against nobody by itself (the attribution is on the audit row).
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.cancellation_rules (region, state, actor, allowed, commission_outcome, provider_fee_outcome, counts_against)
select g.code, t.state, 'admin', true, 'not_paid', 'not_paid', 'admin_attribution'
  from public.regions g
 cross join (values ('OPEN'), ('SELECTED')) as t(state)
 where g.code in ('TR', 'KSA');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The extension band (X-4, X-5): later than the old deadline and now, at most 48 hours past the later of the two,
--    and never past the cap when there is one. Internal, no API grant.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.extension_in_band(p_old timestamptz, p_new timestamptz, p_cap timestamptz)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select p_old is not null and p_new is not null
         and p_new > p_old and p_new > now()
         and p_new <= greatest(p_old, now()) + interval '48 hours'
         and (p_cap is null or p_new <= p_cap)
$$;

revoke all on function public.extension_in_band(timestamptz, timestamptz, timestamptz) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The guards (R-6, X-3, X-4), replaced whole from 14. Every earlier rule stays word for word; added: the payment
--    and fee window extensions, the confirm allowance, and the two application allowances.
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
                            'actual_started_at', 'actual_completed_at', 'confirm_deadline', 'closed_by', 'failed_picks',
                            'confirm_extended_at'])
     is distinct from (to_jsonb(old) - array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                                             'selected_application_id', 'selected_at', 'payment_deadline',
                                             'fee_deadline', 'closed_at', 'actual_started_at', 'actual_completed_at',
                                             'confirm_deadline', 'closed_by', 'failed_picks',
                                             'confirm_extended_at']) then
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
              or (old.status in ('SELECTED', 'COMMISSION_PAID') and new.status = 'OPEN'))
     -- X-4 of 16: the payment window alone moves later while SELECTED, within the band, the pick's allowance unused.
     and not (old.status = 'SELECTED' and new.status = 'SELECTED'
              and new.selected_application_id is not distinct from old.selected_application_id
              and new.selected_at is not distinct from old.selected_at
              and new.fee_deadline is not distinct from old.fee_deadline
              and public.extension_in_band(old.payment_deadline, new.payment_deadline, new.scheduled_start_at)
              and exists (select 1 from public.applications a
                           where a.id = new.selected_application_id and a.payment_extended_at is null)) then
    raise exception 'request_immutable';
  end if;
  -- fee_deadline: written on SELECTED -> COMMISSION_PAID (09) and on the carried re-pick, cleared on a reopen.
  if new.fee_deadline is distinct from old.fee_deadline
     and not ((old.status in ('SELECTED', 'OPEN') and new.status = 'COMMISSION_PAID')
              or (old.status = 'COMMISSION_PAID' and new.status = 'OPEN'))
     -- X-4 of 16: the fee window alone moves later while COMMISSION_PAID, within the band, the allowance unused.
     and not (old.status = 'COMMISSION_PAID' and new.status = 'COMMISSION_PAID'
              and new.selected_application_id is not distinct from old.selected_application_id
              and new.selected_at is not distinct from old.selected_at
              and new.payment_deadline is not distinct from old.payment_deadline
              and public.extension_in_band(old.fee_deadline, new.fee_deadline, new.scheduled_start_at)
              and exists (select 1 from public.applications a
                           where a.id = new.selected_application_id and a.fee_extended_at is null)) then
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
  -- R-5, X-6 of 16: the confirm allowance is spent once, with a later confirm deadline, while AWAITING_CONFIRMATION,
  -- and never reset.
  if new.confirm_extended_at is distinct from old.confirm_extended_at
     and not (old.confirm_extended_at is null and new.confirm_extended_at is not null
              and old.status = 'AWAITING_CONFIRMATION' and new.status = 'AWAITING_CONFIRMATION'
              and new.confirm_deadline > old.confirm_deadline) then
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
  -- R-6 of 16: the extension allowances go from null to a value once, never back, only while the pick waits for that
  -- payment and its request is in that payment's state.
  if new.payment_extended_at is distinct from old.payment_extended_at
     and not (old.payment_extended_at is null and new.payment_extended_at is not null
              and old.status = 'SELECTED' and new.status = 'SELECTED'
              and exists (select 1 from public.requests r
                           where r.id = new.request_id and r.selected_application_id = new.id and r.status = 'SELECTED')) then
    raise exception 'application_immutable';
  end if;
  if new.fee_extended_at is distinct from old.fee_extended_at
     and not (old.fee_extended_at is null and new.fee_extended_at is not null
              and old.status = 'AWAITING_FEE' and new.status = 'AWAITING_FEE'
              and exists (select 1 from public.requests r
                           where r.id = new.request_id and r.selected_application_id = new.id
                             and r.status = 'COMMISSION_PAID')) then
    raise exception 'application_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.applications_guard() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. cancel_by_rule (X-1), replaced from 12 with a seventh argument merged into its audit row's new_value. Its three
--    callers keep six arguments.
-- ═══════════════════════════════════════════════════════════════════════════

drop function public.cancel_by_rule(uuid, text, text, text, text, uuid);

create function public.cancel_by_rule(p_request_id uuid, p_actor text, p_cancel_reason text, p_refund_reason text,
                                      p_action text, p_by uuid, p_meta jsonb default null)
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
                             'fixed_price', v_req.fixed_price)
          || coalesce(p_meta, '{}'::jsonb));

  return jsonb_build_object('status', 'ok')
         || case when v_refund is null then '{}'::jsonb
                 else jsonb_build_object('refund', jsonb_build_object('fee_refund_id', v_refund, 'amount', v_fee.amount,
                                                                      'currency', v_fee.currency)) end;
end;
$$;

revoke all on function public.cancel_by_rule(uuid, text, text, text, text, uuid, jsonb) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. raise_deadline_flags (R-7, X-15), replaced from 12 with the hand clear latch.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.raise_deadline_flags()
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
       -- R-7, X-15 of 16: a (request, kind) admin cleared by hand is never raised again.
       and not exists (select 1 from public.deadline_flags d
                        where d.request_id = r.id and d.cleared_by is not null
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The mail map (R-4, X-10), replaced from 14 plus request.admin_cancelled.
-- ═══════════════════════════════════════════════════════════════════════════

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
    when 'request.admin_cancelled' then
      -- R-4, X-10 of 16: the customer (no refund line: admin refunds by hand, which sends its own mail) and the
      -- provider of the pick, when there is one.
      v_app := v_req.selected_application_id;
      v_prov := null;
      select a.provider_id into v_prov from public.applications a where a.id = v_app;
      v_n := public.queue_audit_mail(v_a.id, v_a.region, v_req.customer_id, 'request_cancelled', v_req.id, null, v_day)
           + public.queue_audit_mail(v_a.id, v_a.region, v_prov, 'request_cancelled', v_req.id, v_app, v_day);
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

-- AC-3 of 13, R-8, X-15 of 14, X-10 of 16: the when list is the map's actions; supabase/tests/29 proves the two are equal.
drop trigger audit_log_email on public.audit_log;
create trigger audit_log_email after insert on public.audit_log
  for each row
  when (new.action in ('request.provider_chosen', 'request.commission_paid', 'request.unlocked', 'job.started',
                       'job.done', 'job.confirmed', 'job.customer_closed', 'job.auto_closed', 'request.cancelled',
                       'request.provider_cancelled', 'request.failed_picks_limit', 'request.no_paid_pick',
                       'request.pick_expired', 'request.fee_expired', 'request.provider_withdrew', 'request.pick_dropped',
                       'fee.late', 'fee.refunded', 'fee.refund_done_by_hand', 'profile.email_changed',
                       'provider.approved', 'provider.reinstated', 'provider.rejected', 'provider.suspended',
                       'job.closed_by_admin', 'report.opened', 'report.handled', 'request.admin_cancelled'))
  execute function public.audit_log_email();

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The request list (R-1, R-2): every region, 20 a page, newest first, ties by id. No name, phone, address or note.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.admin_requests(p_status text, p_region text, p_from date, p_to date, p_has_flag boolean,
                                      p_page integer)
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
  if (p_status is not null and p_status not in ('OPEN', 'SELECTED', 'COMMISSION_PAID', 'UNLOCKED', 'IN_PROGRESS',
                                                 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED'))
     or (p_region is not null and not exists (select 1 from public.regions g where g.code = p_region))
     or (p_from is not null and p_to is not null and (p_to < p_from or p_to - p_from > 366))
     or v_page > 10000 then
    raise exception 'validation_failed';
  end if;

  with picked as (
    select r.*, g.timezone,
           (r.created_at at time zone g.timezone)::date as local_day,
           coalesce((select array_agg(d.kind order by d.kind) from public.deadline_flags d
                      where d.request_id = r.id and d.cleared_at is null), '{}'::text[]) as open_flags,
           exists (select 1 from public.problem_reports x where x.request_id = r.id and x.status = 'open') as open_report
      from public.requests r
      join public.regions g on g.code = r.region
     where (p_status is null or r.status = p_status)
       and (p_region is null or r.region = p_region)
  ), filtered as (
    select p.* from picked p
     where (p_from is null or p.local_day >= p_from)
       and (p_to is null or p.local_day <= p_to)
       and (p_has_flag is null or (cardinality(p.open_flags) > 0) = p_has_flag)
  )
  select (select count(*)::integer from filtered),
         coalesce((select jsonb_agg(t.row_json order by t.created_at desc, t.id)
                     from (select f.id, f.created_at, jsonb_build_object(
                                    'id', f.id, 'region', f.region, 'status', f.status,
                                    'service_name', (select s.name from public.services s where s.id = f.service_id),
                                    'zone_name', (select z.name from public.zones z where z.id = f.zone_id),
                                    'created_at', f.created_at, 'scheduled_start_at', f.scheduled_start_at,
                                    'fixed_price', f.fixed_price, 'currency', f.currency, 'timezone', f.timezone,
                                    'open_flags', to_jsonb(f.open_flags), 'open_report', f.open_report) as row_json
                             from filtered f
                            order by f.created_at desc, f.id
                            limit 20 offset (v_page - 1) * 20) t), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;

revoke all on function public.admin_requests(text, text, date, date, boolean, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_requests(text, text, date, date, boolean, integer) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. The admin cancel (R-3, X-1, X-2, X-9). cancel_by_rule with actor admin; the attribution and the reason only on
--     the audit row. A second cancel by admin is a replay; cancelled by anyone else, not_cancellable.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.admin_cancel_request(p_request_id uuid, p_attributed_to text, p_reason text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_req     public.requests%rowtype;
  v_com     uuid;
  v_pfee    uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_attributed_to is null or p_attributed_to not in ('customer', 'provider', 'platform') then
    raise exception 'validation_failed';
  end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'reason_required';
  end if;
  select r.* into v_req from public.requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_req.status = 'CANCELLED' then
    if v_req.cancelled_by = 'admin' then
      return jsonb_build_object('status', 'ok', 'replayed', true);
    end if;
    raise exception 'not_cancellable';
  end if;
  if v_req.status in ('AWAITING_CONFIRMATION', 'COMPLETED') then
    raise exception 'not_cancellable';
  end if;
  -- X-2: never under an open card page, the customer's or the pick's.
  select f.id into v_com from public.fee_payments f where f.request_id = v_req.id and f.kind = 'commission';
  select f.id into v_pfee from public.fee_payments f
   where f.request_id = v_req.id and f.kind = 'provider_fee' and f.application_id = v_req.selected_application_id;
  if public.attempt_open(v_com, v_req.region) or public.attempt_open(v_pfee, v_req.region) then
    raise exception 'checkout_open';
  end if;
  return public.cancel_by_rule(v_req.id, 'admin', null, null, 'request.admin_cancelled', v_uid,
                               jsonb_build_object('attributed_to', p_attributed_to, 'reason', v_reason))
         || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.admin_cancel_request(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_cancel_request(uuid, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. The extension (R-5, X-5 to X-7): once per pick for payment and fee, once per request for confirm; 1 to 48
--     hours from the later of the old deadline and now; payment and fee never past the start. The request moves
--     first, while the allowance is still unused (the guard checks it), then the allowance is spent.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.admin_extend_deadline(p_request_id uuid, p_which text, p_hours integer, p_reason text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_req     public.requests%rowtype;
  v_app     public.applications%rowtype;
  v_old     timestamptz;
  v_new     timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_which is null or p_which not in ('payment', 'fee', 'confirm') or p_hours is null or p_hours not between 1 and 48 then
    raise exception 'validation_failed';
  end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'reason_required';
  end if;
  select r.* into v_req from public.requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'not_found';
  end if;

  if p_which = 'payment' then
    if v_req.status <> 'SELECTED' or v_req.selected_application_id is null then
      raise exception 'invalid_state';
    end if;
    select a.* into v_app from public.applications a where a.id = v_req.selected_application_id for update;
    if v_app.payment_extended_at is not null then
      raise exception 'already_extended';
    end if;
    v_old := v_req.payment_deadline;
  elsif p_which = 'fee' then
    if v_req.status <> 'COMMISSION_PAID' or v_req.selected_application_id is null or v_req.fee_deadline is null then
      raise exception 'invalid_state';
    end if;
    select a.* into v_app from public.applications a where a.id = v_req.selected_application_id for update;
    if v_app.fee_extended_at is not null then
      raise exception 'already_extended';
    end if;
    v_old := v_req.fee_deadline;
  else
    if v_req.status <> 'AWAITING_CONFIRMATION' then
      raise exception 'invalid_state';
    end if;
    if v_req.confirm_extended_at is not null then
      raise exception 'already_extended';
    end if;
    v_old := v_req.confirm_deadline;
  end if;

  v_new := greatest(v_old, now()) + make_interval(hours => p_hours);
  if p_which in ('payment', 'fee') and v_new > v_req.scheduled_start_at then
    raise exception 'deadline_after_start';
  end if;

  if p_which = 'payment' then
    update public.requests set payment_deadline = v_new where id = v_req.id;
    update public.applications set payment_extended_at = now() where id = v_app.id;
  elsif p_which = 'fee' then
    update public.requests set fee_deadline = v_new where id = v_req.id;
    update public.applications set fee_extended_at = now() where id = v_app.id;
  else
    update public.requests set confirm_deadline = v_new, confirm_extended_at = now() where id = v_req.id;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.deadline_extended', 'requests', v_req.id::text, v_req.region,
          jsonb_build_object('which', p_which, 'deadline', v_old),
          jsonb_build_object('which', p_which, 'deadline', v_new, 'hours', p_hours, 'reason', v_reason,
                             'application_id', v_app.id));
  return jsonb_build_object('status', 'ok', 'which', p_which, 'deadline', v_new);
end;
$$;

revoke all on function public.admin_extend_deadline(uuid, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_extend_deadline(uuid, text, integer, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. The flag queue (R-7, X-15): open flags oldest first, 20 a page; the hand clear locks the flag first, so it
--     never races the cron clear.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.admin_flags(p_page integer)
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
  if v_page > 10000 then
    raise exception 'validation_failed';
  end if;
  select count(*)::integer into v_total from public.deadline_flags d where d.cleared_at is null;
  select coalesce(jsonb_agg(t.row_json order by t.raised_at, t.id), '[]'::jsonb) into v_rows
    from (select d.id, d.raised_at,
                 jsonb_build_object('id', d.id, 'kind', d.kind, 'raised_at', d.raised_at, 'request_id', d.request_id,
                                    'region', d.region, 'request_status', r.status, 'timezone', g.timezone) as row_json
            from public.deadline_flags d
            join public.requests r on r.id = d.request_id
            join public.regions g on g.code = d.region
           where d.cleared_at is null
           order by d.raised_at, d.id
           limit 20 offset (v_page - 1) * 20) t;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;

revoke all on function public.admin_flags(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_flags(integer) to authenticated;

create function public.admin_clear_flag(p_flag_id uuid, p_note text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_note  text := btrim(coalesce(p_note, ''));
  v_flag  public.deadline_flags%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if char_length(v_note) not between 10 and 500 then
    raise exception 'reason_required';
  end if;
  select d.* into v_flag from public.deadline_flags d where d.id = p_flag_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_flag.cleared_at is not null then
    raise exception 'already_cleared';
  end if;
  update public.deadline_flags set cleared_at = now(), cleared_by = v_uid, note = v_note where id = v_flag.id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.flag_cleared', 'requests', v_flag.request_id::text, v_flag.region,
          jsonb_build_object('flag_id', v_flag.id, 'kind', v_flag.kind),
          jsonb_build_object('flag_id', v_flag.id, 'kind', v_flag.kind, 'note', v_note));
  return jsonb_build_object('status', 'ok', 'flag_id', v_flag.id);
end;
$$;

revoke all on function public.admin_clear_flag(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_clear_flag(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. The street line (R-8, X-13): only once the pick was revealed; every call audited with the reason, never the
--     line. The owner approved admin path of AC-5, outside rule 2's two parties.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.admin_request_address(p_request_id uuid, p_reason text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_req     public.requests%rowtype;
  v_line    text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'reason_required';
  end if;
  select r.* into v_req from public.requests r where r.id = p_request_id;
  if not found then
    raise exception 'not_found';
  end if;
  if not exists (select 1 from public.applications a
                  where a.id = v_req.selected_application_id and a.request_id = v_req.id and a.unlocked_at is not null) then
    raise exception 'not_available';
  end if;
  select x.line into v_line from public.request_addresses x where x.request_id = v_req.id;
  if not found then
    raise exception 'not_available';
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.address_viewed', 'requests', v_req.id::text, v_req.region, null,
          jsonb_build_object('reason', v_reason));
  return jsonb_build_object('line', v_line);
end;
$$;

revoke all on function public.admin_request_address(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_request_address(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. Revenue from the ledger (R-9, X-11, X-12). Per region, currency and the day or month of each entry in its
--     region's time zone. Revenue accounts carry credits (negative), so their lines are the negated sums; refunds
--     and PSP fees are the sums. refunds_due is shown apart (late_received, late_refunded) and never in net; PSP
--     fees count on every journal. Only buckets with entries; both ends inclusive, a month grain widens to whole
--     months. Integer minor units summed as bigint (rule 4).
-- ═══════════════════════════════════════════════════════════════════════════

create function public.admin_revenue(p_from date, p_to date, p_grain text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_from  date;
  v_to    date;
  v_rows  jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_grain is null or p_grain not in ('day', 'month') then
    raise exception 'validation_failed';
  end if;
  if p_grain = 'day' then
    if p_to - p_from + 1 > 92 then
      raise exception 'validation_failed';
    end if;
    v_from := p_from;
    v_to := p_to;
  else
    v_from := date_trunc('month', p_from)::date;
    v_to := (date_trunc('month', p_to) + interval '1 month - 1 day')::date;
    if (extract(year from p_to)::integer * 12 + extract(month from p_to)::integer)
       - (extract(year from p_from)::integer * 12 + extract(month from p_from)::integer) + 1 > 24 then
      raise exception 'validation_failed';
    end if;
  end if;

  with entries as (
    select e.region, e.currency, e.account, e.amount,
           case p_grain when 'day' then (e.created_at at time zone g.timezone)::date
                        else date_trunc('month', e.created_at at time zone g.timezone)::date end as bucket,
           (e.created_at at time zone g.timezone)::date as local_day
      from public.ledger_entries e
      join public.regions g on g.code = e.region
  ), sums as (
    select x.region, x.currency, x.bucket,
           coalesce(-sum(x.amount) filter (where x.account = 'commission_revenue'), 0)::bigint as commission_revenue,
           coalesce(-sum(x.amount) filter (where x.account = 'provider_fee_revenue'), 0)::bigint as provider_fee_revenue,
           coalesce(sum(x.amount) filter (where x.account = 'commission_refunds'), 0)::bigint as commission_refunds,
           coalesce(sum(x.amount) filter (where x.account = 'provider_fee_refunds'), 0)::bigint as provider_fee_refunds,
           coalesce(sum(x.amount) filter (where x.account = 'psp_fees'), 0)::bigint as psp_fees,
           coalesce(-sum(x.amount) filter (where x.account = 'refunds_due' and x.amount < 0), 0)::bigint as late_received,
           coalesce(sum(x.amount) filter (where x.account = 'refunds_due' and x.amount > 0), 0)::bigint as late_refunded
      from entries x
     where x.local_day between v_from and v_to
     group by x.region, x.currency, x.bucket
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'region', s.region, 'currency', s.currency, 'bucket', to_char(s.bucket, 'YYYY-MM-DD'),
           'commission_revenue', s.commission_revenue, 'provider_fee_revenue', s.provider_fee_revenue,
           'commission_refunds', s.commission_refunds, 'provider_fee_refunds', s.provider_fee_refunds,
           'psp_fees', s.psp_fees,
           'net', s.commission_revenue + s.provider_fee_revenue - s.commission_refunds - s.provider_fee_refunds - s.psp_fees,
           'late_received', s.late_received, 'late_refunded', s.late_refunded)
           order by s.region, s.currency, s.bucket), '[]'::jsonb)
    into v_rows
    from sums s;
  return jsonb_build_object('from', to_char(v_from, 'YYYY-MM-DD'), 'to', to_char(v_to, 'YYYY-MM-DD'), 'grain', p_grain,
                            'rows', v_rows);
end;
$$;

revoke all on function public.admin_revenue(date, date, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_revenue(date, date, text) to authenticated;
