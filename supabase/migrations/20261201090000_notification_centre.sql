-- Position 18 (spec 0011-18): the in app notification centre and live status.
--
-- Every step that already mails (13 to 17) also leaves a notice, whatever the mail does. One recipient map serves both
-- channels: 13's inline logic in queue_audit_email moves, unchanged in effect, into audit_notices(audit_id), which
-- writes nothing (R-1). Mail keeps its own trigger; notices get their own (R-2), so neither can lose the other or the
-- move. A notice stores ids only and is rendered when read (R-5). Each new notice sends its recipient an empty ping on
-- a private Realtime topic only they can join (R-9); the browser then reads through the usual doors.
--
-- Order below: the table, RLS and guard -> the switch reader -> the map and the replaced mail function -> the notice
-- writers and triggers -> the replaced reminders -> the readers and writers for the browser -> the ping and the
-- Realtime policy -> housekeeping.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. notifications (AC-4). Ids, the kind, the time, the read time, one optional deadline. No words, no personal data.
--    RLS on with one own row select policy; no table grant to any API role: reads and the read mark go through the
--    definer functions of section 7 (R-8).
-- ═══════════════════════════════════════════════════════════════════════════

create table public.notifications (
  id            uuid        primary key default gen_random_uuid(),
  region        text        not null references public.regions (code) on delete restrict,
  -- Cascade, unlike the rest of the schema: a notice is derived from the rows it names and goes with them. Nothing
  -- deletes a profile or a request in the product; the race tests' clean up and 21's wipe do.
  recipient_id  uuid        not null references public.profiles (id) on delete cascade,
  kind          text        not null,
  request_id    uuid        references public.requests (id) on delete cascade,
  entity_id     uuid,
  deadline_at   timestamptz,
  dedupe_key    text        not null,
  created_at    timestamptz not null default now(),
  read_at       timestamptz,

  constraint notifications_dedupe_key_unique unique (dedupe_key),
  constraint notifications_dedupe_key_length check (char_length(dedupe_key) between 1 and 300),
  -- R-3: 13 to 17's mail templates minus confirm_email and password_changed.
  constraint notifications_kind_valid check (kind in (
    'new_offer', 'chosen', 'pay_your_fee', 'commission_received', 'contacts_ready', 'job_started', 'please_confirm',
    'job_completed', 'request_cancelled', 'pick_again', 'pick_ended', 'window_missed', 'payment_too_late',
    'fee_refunded', 'account_approved', 'account_rejected', 'account_suspended', 'pay_window_closing', 'closes_soon',
    'report_received', 'report_new_admin', 'report_handled', 'rate_provider', 'rating_received')),
  constraint notifications_read_after_created check (read_at is null or read_at >= created_at)
);

alter table public.notifications enable row level security;

create policy notifications_read_own
  on public.notifications for select
  to authenticated
  using (recipient_id = (select auth.uid()));

revoke all on table public.notifications from anon, authenticated, service_role;

create index notifications_recipient_list_idx on public.notifications (recipient_id, created_at desc, id desc);
create index notifications_recipient_unread_idx on public.notifications (recipient_id) where read_at is null;
create index notifications_created_idx on public.notifications (created_at);
create index notifications_request_idx on public.notifications (request_id);
create index notifications_region_idx on public.notifications (region);

-- AC-4: a notice changes only by read_at going from null to a time.
create function public.notifications_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.region is distinct from old.region
     or new.recipient_id is distinct from old.recipient_id or new.kind is distinct from old.kind
     or new.request_id is distinct from old.request_id or new.entity_id is distinct from old.entity_id
     or new.deadline_at is distinct from old.deadline_at or new.dedupe_key is distinct from old.dedupe_key
     or new.created_at is distinct from old.created_at
     or (old.read_at is not null and new.read_at is distinct from old.read_at)
     or (old.read_at is null and new.read_at is null) then
    raise exception 'invalid_update';
  end if;
  return new;
end;
$$;

revoke all on function public.notifications_guard() from public, anon, authenticated, service_role;

create trigger notifications_guard before update on public.notifications
  for each row execute function public.notifications_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The switch (R-4): 00b's notifications_enabled per region, unread until now. Missing or not a boolean is off.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.notices_enabled(p_region text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select coalesce((select s.value = 'true'::jsonb
                     from public.platform_settings s
                    where s.region = p_region and s.key = 'notifications_enabled'), false)
$$;

revoke all on function public.notices_enabled(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. One recipient map, two channels (R-1, X-6). audit_notices returns, for one audit row, exactly the recipients,
--    templates, ids and send_until that queue_audit_email mailed before this migration, branch for branch, plus the
--    deadline the event names. It writes nothing and drops a null recipient (as queue_audit_mail did).
--    profile.email_changed is not in the map: it starts a confirmation, which only mail does.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.audit_notices(p_audit_id bigint)
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

-- 13's mail, now reading the map (R-1, X-6): the same early checks, the confirmation branch kept in its own body, the
-- same return value (the number of mail rows written).
create or replace function public.queue_audit_email(p_audit_id bigint)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_a  public.audit_log%rowtype;
  v_r  record;
  v_n  integer := 0;
begin
  select a.* into v_a from public.audit_log a where a.id = p_audit_id;
  if not found or v_a.region is null or not public.emails_enabled(v_a.region) then
    return 0;
  end if;
  perform public.email_settings(v_a.region);

  -- The address: a new one starts a confirmation (13's R-9). Mail only.
  if v_a.action = 'profile.email_changed' then
    if v_a.new_value ->> 'email' is not null and public.start_email_confirmation(v_a.entity_id::uuid) = 'queued' then
      perform public.relay_kick('email');
      return 1;
    end if;
    return 0;
  end if;

  for v_r in select m.* from public.audit_notices(p_audit_id) m loop
    v_n := v_n + public.queue_audit_mail(v_a.id, v_a.region, v_r.o_recipient, v_r.o_kind, v_r.o_request, v_r.o_entity,
                                         v_r.o_send_until, v_r.o_topic);
  end loop;
  return v_n;
end;
$$;

revoke all on function public.queue_audit_email(bigint) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The notice writers (R-2 to R-4, R-7). insert_notice writes one row, once per key. The audit writer skips the two
--    mail only templates; any other template missing from the kind check fails loudly through R-2's path, so a new
--    mail template cannot silently go without a notice.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.insert_notice(p_key text, p_region text, p_recipient uuid, p_kind text, p_request uuid,
                                     p_entity uuid, p_deadline timestamptz)
  returns integer
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_n  integer;
begin
  if p_key is null or char_length(p_key) not between 1 and 300 or p_region is null or p_kind is null then
    raise exception 'validation_failed';
  end if;
  if p_recipient is null then
    return 0;
  end if;
  insert into public.notifications (region, recipient_id, kind, request_id, entity_id, deadline_at, dedupe_key)
  values (p_region, p_recipient, p_kind, p_request, p_entity, p_deadline, p_key)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.insert_notice(text, text, uuid, text, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

create function public.queue_audit_notices(p_audit_id bigint)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_a  public.audit_log%rowtype;
  v_r  record;
  v_n  integer := 0;
begin
  select a.* into v_a from public.audit_log a where a.id = p_audit_id;
  if not found or v_a.region is null or not public.notices_enabled(v_a.region) then
    return 0;
  end if;
  for v_r in
    select m.* from public.audit_notices(p_audit_id) m where m.o_kind not in ('confirm_email', 'password_changed')
  loop
    -- Security review M-1 (17's D207): a rating notice never names the job or the service, so a provider cannot tie a
    -- score to a customer. The mail blanks the same values at send time.
    v_n := v_n + public.insert_notice('notice:' || v_a.id || ':' || v_r.o_recipient || ':' || v_r.o_kind, v_a.region,
                                      v_r.o_recipient, v_r.o_kind,
                                      case when v_r.o_kind = 'rating_received' then null else v_r.o_request end,
                                      case when v_r.o_kind = 'rating_received' then null else v_r.o_entity end,
                                      v_r.o_deadline);
  end loop;
  return v_n;
end;
$$;

revoke all on function public.queue_audit_notices(bigint) from public, anon, authenticated, service_role;

-- A new offer (05 writes no audit row on apply), to the customer. In app ignores the email switches (R-4).
create function public.queue_offer_notice(p_application_id uuid)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_app  public.applications%rowtype;
  v_req  public.requests%rowtype;
begin
  select a.* into v_app from public.applications a where a.id = p_application_id;
  if not found or not public.notices_enabled(v_app.region) then
    return 0;
  end if;
  select r.* into v_req from public.requests r where r.id = v_app.request_id;
  if not found then
    return 0;
  end if;
  return public.insert_notice('notice:offer:' || v_app.id, v_app.region, v_req.customer_id, 'new_offer', v_req.id,
                              v_app.id, null);
end;
$$;

revoke all on function public.queue_offer_notice(uuid) from public, anon, authenticated, service_role;

-- R-2: a notice never breaks a move. An error writes one failed outbox row (ids and the SQLSTATE only), which 08's
-- heartbeat alerts as outbox_failed; the `notice:` key says which channel failed. If even that fails, a warning.
create function public.audit_log_notice()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  -- Security review: a lock wait raises 55P03, which the block below catches, instead of running into a statement
  -- timeout (57014), which no exception block catches and which would cancel the move itself.
  set lock_timeout = '250ms'
as $$
declare
  v_state  text;
begin
  begin
    perform public.queue_audit_notices(new.id);
  exception when others then
    v_state := sqlstate;
    begin
      insert into public.outbox_events (region, kind, idempotency_key, payload, status, next_attempt_at, last_error)
      values (new.region, 'email.send', 'notice:' || new.id || ':queue_failed',
              jsonb_build_object('audit_id', new.id, 'sqlstate', v_state), 'failed', null, 'queue_failed:' || v_state)
      on conflict (idempotency_key) do nothing;
    exception when others then
      raise warning 'notice_queue_failed audit=% sqlstate=%', new.id, v_state;
    end;
  end;
  return null;
end;
$$;

revoke all on function public.audit_log_notice() from public, anon, authenticated, service_role;

-- R-3: the mail trigger's actions minus profile.email_changed, auth.password_set and auth.password_changed;
-- supabase/tests/37 proves it.
create trigger audit_log_notice after insert on public.audit_log
  for each row
  when (new.action in ('request.provider_chosen', 'request.commission_paid', 'request.unlocked', 'job.started',
                       'job.done', 'job.confirmed', 'job.customer_closed', 'job.auto_closed', 'request.cancelled',
                       'request.provider_cancelled', 'request.failed_picks_limit', 'request.no_paid_pick',
                       'request.pick_expired', 'request.fee_expired', 'request.provider_withdrew', 'request.pick_dropped',
                       'fee.late', 'fee.refunded', 'fee.refund_done_by_hand',
                       'provider.approved', 'provider.reinstated', 'provider.rejected', 'provider.suspended',
                       'job.closed_by_admin', 'report.opened', 'report.handled', 'request.admin_cancelled',
                       'rating.created'))
  execute function public.audit_log_notice();

create function public.applications_offer_notice()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  set lock_timeout = '250ms'
as $$
declare
  v_state  text;
begin
  begin
    perform public.queue_offer_notice(new.id);
  exception when others then
    v_state := sqlstate;
    begin
      insert into public.outbox_events (region, kind, idempotency_key, payload, status, next_attempt_at, last_error)
      values (new.region, 'email.send', 'notice:offer:' || new.id || ':queue_failed',
              jsonb_build_object('application_id', new.id, 'sqlstate', v_state), 'failed', null,
              'queue_failed:' || v_state)
      on conflict (idempotency_key) do nothing;
    exception when others then
      raise warning 'notice_queue_failed application=% sqlstate=%', new.id, v_state;
    end;
  end;
  return null;
end;
$$;

revoke all on function public.applications_offer_notice() from public, anon, authenticated, service_role;

create trigger applications_offer_notice after insert on public.applications
  for each row execute function public.applications_offer_notice();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The reminders (R-13, X-7). The same people at the same moments: a notice wherever notices are on, a mail exactly
--    as before wherever mail is on. The lead hours are mail settings, so a bad one skips the region for both channels
--    with the existing warning. The return value stays the number of mails written.
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_mail    boolean;
  v_notice  boolean;
  v_lead    interval;
  v_close   interval;
  v_row     record;
  v_n       integer := 0;
begin
  for v_region in select g.code from public.regions g order by g.code loop
    v_set := null;
    v_mail := false;
    v_notice := false;
    begin
      v_mail := public.emails_enabled(v_region);
      v_notice := public.notices_enabled(v_region);
      if v_mail or v_notice then
        v_set := public.email_settings(v_region);
      end if;
    exception when others then
      raise warning 'reminders_skipped region=% sqlstate=%', v_region, sqlstate;
      v_set := null;
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
        if v_notice then
          begin
            perform public.insert_notice('notice:' || v_row.app || ':commission:pay_window_closing', v_region,
                                         v_row.recipient, 'pay_window_closing', v_row.id, v_row.app, v_row.deadline);
          exception when others then
            raise warning 'reminder_notice_failed request=% sqlstate=%', v_row.id, sqlstate;
          end;
        end if;
        if v_mail then
          begin
            if public.queue_email('email:' || v_row.app || ':commission:pay_window_closing', 'pay_window_closing',
                                  v_row.recipient, v_row.id, v_row.app, v_row.deadline, v_region) is not null then
              v_n := v_n + 1;
            end if;
          exception when others then
            raise warning 'reminder_failed request=% sqlstate=%', v_row.id, sqlstate;
          end;
        end if;
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
        if v_notice then
          begin
            perform public.insert_notice('notice:' || v_row.app || ':provider_fee:pay_window_closing', v_region,
                                         v_row.recipient, 'pay_window_closing', v_row.id, v_row.app, v_row.deadline);
          exception when others then
            raise warning 'reminder_notice_failed request=% sqlstate=%', v_row.id, sqlstate;
          end;
        end if;
        if v_mail then
          begin
            if public.queue_email('email:' || v_row.app || ':provider_fee:pay_window_closing', 'pay_window_closing',
                                  v_row.recipient, v_row.id, v_row.app, v_row.deadline, v_region) is not null then
              v_n := v_n + 1;
            end if;
          exception when others then
            raise warning 'reminder_failed request=% sqlstate=%', v_row.id, sqlstate;
          end;
        end if;
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
          if v_notice then
            begin
              perform public.insert_notice('notice:' || v_row.id || ':closes_soon:'
                                             || floor(extract(epoch from v_row.deadline))::bigint,
                                           v_region, v_row.recipient, 'closes_soon', v_row.id, v_row.app,
                                           v_row.deadline);
            exception when others then
              raise warning 'reminder_notice_failed request=% sqlstate=%', v_row.id, sqlstate;
            end;
          end if;
          if v_mail then
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
          end if;
        end loop;
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.queue_reminders() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Reads and the read mark for the browser (AC-5, AC-6, R-8). Each reads auth.uid() and touches only the caller's
--    rows; nothing takes a recipient id. my_notices reads only the service name from the snapshot, never the rest.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.my_notices(p_before uuid default null, p_limit integer default 20)
  returns table (id uuid, kind text, created_at timestamptz, read_at timestamptz, request_id uuid, entity_id uuid,
                 deadline_at timestamptz, service_name jsonb, timezone text, default_locale text)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_at   timestamptz;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'not_found';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'validation_failed';
  end if;
  if p_before is not null then
    select n.created_at, n.id into v_at, v_id
      from public.notifications n
     where n.id = p_before and n.recipient_id = v_uid;
    if not found then
      raise exception 'not_found';
    end if;
  end if;
  return query
    select n.id, n.kind, n.created_at, n.read_at, n.request_id, n.entity_id, n.deadline_at,
           r.pricing_snapshot -> 'service' -> 'name', g.timezone, g.default_locale
      from public.notifications n
      join public.regions g on g.code = n.region
      left join public.requests r on r.id = n.request_id
     where n.recipient_id = v_uid
       and (v_at is null or (n.created_at, n.id) < (v_at, v_id))
     order by n.created_at desc, n.id desc
     limit p_limit;
end;
$$;

revoke all on function public.my_notices(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.my_notices(uuid, integer) to authenticated;

-- The unread count, capped at 100 (the bell shows 99+).
create function public.my_notice_count()
  returns integer
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select count(*)::integer
    from (select 1
            from public.notifications n
           where n.recipient_id = (select auth.uid()) and n.read_at is null
           limit 100) x
$$;

revoke all on function public.my_notice_count() from public, anon, authenticated, service_role;
grant execute on function public.my_notice_count() to authenticated;

-- Open one: marked read once (a second open keeps the first time); returns what the link needs.
create function public.open_notice(p_id uuid)
  returns table (kind text, request_id uuid, entity_id uuid)
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_n    public.notifications%rowtype;
begin
  if v_uid is null or p_id is null then
    raise exception 'not_found';
  end if;
  select x.* into v_n from public.notifications x where x.id = p_id and x.recipient_id = v_uid;
  if not found then
    raise exception 'not_found';
  end if;
  if v_n.read_at is null then
    -- Code review: a concurrent open or mark all may have read it first; then this is a no op, never invalid_update.
    update public.notifications x set read_at = now() where x.id = v_n.id and x.read_at is null;
  end if;
  return query select v_n.kind, v_n.request_id, v_n.entity_id;
end;
$$;

revoke all on function public.open_notice(uuid) from public, anon, authenticated, service_role;
grant execute on function public.open_notice(uuid) to authenticated;

create function public.mark_all_notices_read()
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_n    integer;
begin
  if v_uid is null then
    raise exception 'not_found';
  end if;
  update public.notifications x set read_at = now() where x.recipient_id = v_uid and x.read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_all_notices_read() from public, anon, authenticated, service_role;
grant execute on function public.mark_all_notices_read() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Live updates (R-9, R-11, X-1). Each new notice sends its recipient an empty ping on the private topic
--    notices:<id>. Realtime delivers it after the move commits. Any error is swallowed: Realtime never breaks a move,
--    and where realtime.send is missing (a database only start) the notice still commits.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.notifications_ping()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  -- Realtime's daily partition work locks realtime.messages: never wait long behind it inside a move.
  set lock_timeout = '250ms'
as $$
begin
  begin
    perform realtime.send('{}'::jsonb, 'notice', 'notices:' || new.recipient_id::text, true);
  exception when others then
    raise warning 'notice_ping_failed notice=% sqlstate=%', new.id, sqlstate;
  end;
  return null;
end;
$$;

revoke all on function public.notifications_ping() from public, anon, authenticated, service_role;

create trigger notifications_ping after insert on public.notifications
  for each row execute function public.notifications_ping();

-- Who may join notices:<id>: only that user, and only to read. No insert policy, so no browser can send on it.
-- Guarded only where Realtime has not created its table (CI's database only start); pgTAP 37 fails when the table
-- exists without this policy.
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages is missing; the notices policy is skipped here';
    return;
  end if;
  execute $p$
    create policy aldebyani_notices_read_own
      on realtime.messages for select
      to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and (select realtime.topic()) = 'notices:' || (select auth.uid())::text
        -- Security review: the row's own topic as well, so a row on another topic is never readable through this policy.
        and realtime.messages.topic = 'notices:' || (select auth.uid())::text
      )
  $p$;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Housekeeping (R-12, AC-13): notices older than 180 days go, read or not, 5,000 at a time.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.notices_housekeeping()
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_n      integer;
  v_total  integer := 0;
begin
  loop
    delete from public.notifications x
     where x.id in (select y.id from public.notifications y
                     where y.created_at < now() - interval '180 days'
                     order by y.created_at
                     limit 5000);
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    exit when v_n < 5000;
  end loop;
  return v_total;
end;
$$;

revoke all on function public.notices_housekeeping() from public, anon, authenticated, service_role;

-- cron.schedule replaces a job of the same name, so this is safe to run again.
select cron.schedule('notices-housekeeping', '23 3 * * *', $$select public.notices_housekeeping()$$);
