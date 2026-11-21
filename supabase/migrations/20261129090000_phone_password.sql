-- Position 01b (spec 0012, D199): phone and password sign in.
--
-- 0005's no_password trigger blanked every password. It is replaced by password_guard, which keeps a password only
-- when a code had already proven the phone before the write and the account has a profile (AC-8, D104 holds, D201):
-- an account is only ever created by a code, so an insert never keeps one, and registering someone else's number with
-- a password, then waiting for them to confirm it, saves nothing. On a kept change it records app_metadata.has_password and password_changed_at (the app
-- reads them from getUser; the JWT and RLS never do) and writes one audit row. phone_fixed stops the Auth phone, the
-- sign in key, from moving away from profiles.phone.
--
-- Replaced from their latest bodies, each with the change named: queue_email and email_context (14, the template
-- password_changed), queue_audit_email and the audit_log_email trigger (16, the actions auth.password_set and
-- auth.password_changed, AC-10 as amended by D201).
-- Every new function is a definer with search_path '' and no API role's execute grant; Auth's own role runs the
-- triggers. supabase/tests/05, 29 and 34 prove it.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. password_guard (AC-8): replaces no_password.
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger no_password on auth.users;
drop function public.no_password();

create function public.password_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_old     text;
  v_new     text;
  v_region  text;
  v_profile boolean;
begin
  -- An account is only ever created by a code: a sign up that carries a password (a raw API call) saves none.
  if tg_op = 'INSERT' then
    new.encrypted_password := '';
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('has_password', false);
    return new;
  end if;

  -- Auth lists the column on most of its writes; an unchanged value changes nothing at all. Null counts as empty.
  v_old := coalesce(old.encrypted_password, '');
  v_new := coalesce(new.encrypted_password, '');
  if v_new = v_old then
    return new;
  end if;

  -- A new password is kept only when a code had proven the phone before this write, and the account has a profile.
  -- The profile is written only by onboarding, with the owner's own session, after the code. It closes a race: under
  -- READ COMMITTED a repeated raw sign up that read the row before the owner's code committed, and writes after it,
  -- would see the confirmation in OLD (security review 2026-11-21). `continue` sends onboarding before the password
  -- step, so no real flow changes.
  select p.region into v_region from public.profiles p where p.id = new.id;
  v_profile := found;
  if v_new <> '' and (old.phone_confirmed_at is null or not v_profile) then
    v_new := '';
  end if;
  new.encrypted_password := v_new;
  new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('has_password', v_new <> '');
  if v_new = '' then
    return new;
  end if;

  new.raw_app_meta_data := new.raw_app_meta_data || jsonb_build_object('password_changed_at', now());
  -- auth.uid() is null in Auth's connection: the actor is the account itself. No value holds the hash.
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (new.id, case when v_old = '' then 'auth.password_set' else 'auth.password_changed' end, 'auth_users',
          new.id::text, v_region, null, null);
  return new;
end;
$$;

revoke all on function public.password_guard() from public, anon, authenticated, service_role;

create trigger password_guard
  before insert or update of encrypted_password on auth.users
  for each row execute function public.password_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. phone_fixed (AC-8): the Auth phone never changes once set, so updateUser({ phone }) cannot move the sign in
--    key away from profiles.phone.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.phone_fixed()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if coalesce(old.phone, '') <> '' and new.phone is distinct from old.phone then
    raise exception 'phone_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.phone_fixed() from public, anon, authenticated, service_role;

create trigger phone_fixed
  before update of phone on auth.users
  for each row execute function public.phone_fixed();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Mail (AC-10): 14's and 16's functions, replaced, each with the change named.
-- ═══════════════════════════════════════════════════════════════════════════

-- The template list gains password_changed.
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
                           'report_received', 'report_new_admin', 'report_handled', 'password_changed') then
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

-- A password_changed case (no condition) and its value changed_at, the outbox row's time.
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
         'account_rejected', 'account_suspended', 'password_changed' then
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

-- 16's map plus auth.password_set and auth.password_changed, before the request lookup (the audit row names the account).
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

  -- AC-10 of 0012: a set or changed password, to the account owner. A first password is mailed too (security review
  -- 2026-11-21): a fresh stolen session could set one on an established account with none. queue_audit_mail sends
  -- only to a confirmed address, which a brand new sign up cannot have yet, so a new account gets nothing.
  if v_a.action in ('auth.password_set', 'auth.password_changed') then
    return public.queue_audit_mail(v_a.id, v_a.region, v_a.entity_id::uuid, 'password_changed', null,
                                   v_a.entity_id::uuid, v_day);
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

-- AC-3 of 13, R-8, X-15 of 14, X-10 of 16, AC-10 of 0012: the when list is the map's actions; supabase/tests/29 proves the two are equal.
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
                       'auth.password_set', 'auth.password_changed'))
  execute function public.audit_log_email();
