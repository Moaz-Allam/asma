-- Position 13 (spec 0011-13, amended by D191 with rules R-1 to R-15): transactional email.
--
-- Mail is a side effect of the moves 06 to 12 already make. Every move writes one audit_log row in its own
-- transaction; an `after insert` trigger on audit_log (and one on applications, for a new offer) names the
-- recipients and writes one small `email.send` outbox row each: ids, the template and `send_until`, never an
-- address or a value (R-1). Whether the mail still makes sense, and every value it shows, is read by the relay at
-- send time through email_context (R-8), so a move that the same or a later transaction undoes sends nothing.
-- A trigger error never breaks the move: it writes one failed row, which the heartbeat alerts (R-2).
--
-- Mail has its own lane (R-12): claim_outbox leaves `email.send` rows to claim_email_outbox, so a burst of mail
-- never delays a payment or a refund. finish_email ends a mail row. One switch per region, emails_enabled, is off
-- in both regions until the owner turns it on (S43); the local seed turns it on for TR (R-3).
--
-- A contact address is confirmed with a one time link (R-9): 32 random bytes made here, only their sha256 digest
-- stored, the token in the outbox payload only until the row ends. The apply gate (R-10) waits behind its own
-- switch, apply_needs_email, off everywhere.
--
-- Order below: extension -> settings -> email_confirmations and the counter -> internal readers -> the queue ->
-- the triggers -> the lanes -> send time -> confirmation -> reminders and housekeeping -> the schedules. Every
-- function revokes PUBLIC and pins search_path (supabase/tests/02). Refusals are stable codes in the exception
-- message; the doors map them.

create extension if not exists pgcrypto with schema extensions;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Settings (R-3, R-10, R-14). emails_enabled is a JSON boolean (the existing `_enabled` check);
--    apply_needs_email gets its own boolean check; the three hour settings are whole hours from 1 to 168.
--    All five are seeded for both regions, join the guard's required keys, and are read by one reader,
--    email_settings(region), which refuses a missing or malformed value. ☐ confirm_reminder_hours is new.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_apply_needs_email_valid check (
    case when key <> 'apply_needs_email' then true else jsonb_typeof(value) = 'boolean' end),
  add constraint platform_settings_email_hours_valid check (
    case when key not in ('pay_reminder_hours', 'email_link_hours', 'confirm_reminder_hours') then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 168 end);

insert into public.platform_settings (region, key, value) values
  ('TR',  'emails_enabled',         'false'),
  ('KSA', 'emails_enabled',         'false'),
  ('TR',  'apply_needs_email',      'false'),
  ('KSA', 'apply_needs_email',      'false'),
  ('TR',  'pay_reminder_hours',     '4'),
  ('KSA', 'pay_reminder_hours',     '4'),
  ('TR',  'email_link_hours',       '24'),
  ('KSA', 'email_link_hours',       '24'),
  ('TR',  'confirm_reminder_hours', '24'),
  ('KSA', 'confirm_reminder_hours', '24')
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
                 'confirm_reminder_hours')
     and (tg_op = 'DELETE' or new.key is distinct from old.key or new.region is distinct from old.region) then
    raise exception 'pricing_setting_required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.pricing_settings_guard() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. email_confirmations (R-9) and the shared counter. Only the digest of a token is stored; one live
--    confirmation per profile (a new one revokes the older); RLS on with a deny policy and no grant, so no API
--    role reads or writes it. Ended rows are deleted 30 days after they end (emails_housekeeping).
-- ═══════════════════════════════════════════════════════════════════════════

create table public.email_confirmations (
  id          uuid        primary key default gen_random_uuid(),
  region      text        not null references public.regions (code) on delete restrict,
  profile_id  uuid        not null references public.profiles (id) on delete restrict,
  email       text        collate "C" not null,
  token_hash  bytea       not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),

  constraint email_confirmations_token_hash_unique unique (token_hash),
  constraint email_confirmations_token_hash_length check (octet_length(token_hash) = 32),
  constraint email_confirmations_email_length check (char_length(email) between 3 and 254),
  constraint email_confirmations_expiry check (expires_at > created_at),
  constraint email_confirmations_one_end check (used_at is null or revoked_at is null)
);

alter table public.email_confirmations enable row level security;
create policy email_confirmations_no_api on public.email_confirmations for select to authenticated using (false);
revoke all on table public.email_confirmations from anon, authenticated, service_role;

create unique index email_confirmations_one_live_idx on public.email_confirmations (profile_id)
  where used_at is null and revoked_at is null;
create index email_confirmations_profile_idx on public.email_confirmations (profile_id);
create index email_confirmations_region_idx on public.email_confirmations (region);

-- R-9: the confirmation and its resend share one counter, at most 3 an hour per profile.
alter table public.action_counters
  drop constraint action_counters_action_valid,
  add constraint action_counters_action_valid check (action in ('checkout', 'email_confirm'));

-- R-12: each lane finds its due rows without reading the other's.
create index outbox_events_email_due_idx on public.outbox_events (next_attempt_at, id)
  where status = 'pending' and kind = 'email.send';
create index outbox_events_pay_due_idx on public.outbox_events (next_attempt_at, id)
  where status = 'pending' and kind <> 'email.send';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Internal readers (no API grant).
-- ═══════════════════════════════════════════════════════════════════════════

-- R-3: mail on or off for a region, failing closed: a missing or non boolean row is off.
create function public.emails_enabled(p_region text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select coalesce((select s.value = 'true'::jsonb
                     from public.platform_settings s
                    where s.region = p_region and s.key = 'emails_enabled'), false)
$$;

revoke all on function public.emails_enabled(text) from public, anon, authenticated, service_role;

-- R-10: the apply gate's own reader, failing closed to off, so a broken reminder setting never stops applying.
create function public.apply_needs_email(p_region text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select coalesce((select s.value = 'true'::jsonb
                     from public.platform_settings s
                    where s.region = p_region and s.key = 'apply_needs_email'), false)
$$;

revoke all on function public.apply_needs_email(text) from public, anon, authenticated, service_role;

-- R-14: the five mail settings of a region, or email_settings_invalid when one is missing or malformed.
create function public.email_settings(p_region text)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_s     jsonb;
  v_key   text;
begin
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb) into v_s
    from public.platform_settings s
   where s.region = p_region
     and s.key in ('emails_enabled', 'apply_needs_email', 'pay_reminder_hours', 'email_link_hours',
                   'confirm_reminder_hours');
  if jsonb_typeof(v_s -> 'emails_enabled') is distinct from 'boolean'
     or jsonb_typeof(v_s -> 'apply_needs_email') is distinct from 'boolean' then
    raise exception 'email_settings_invalid';
  end if;
  foreach v_key in array array['pay_reminder_hours', 'email_link_hours', 'confirm_reminder_hours'] loop
    if jsonb_typeof(v_s -> v_key) is distinct from 'number' then
      raise exception 'email_settings_invalid';
    end if;
    if (v_s ->> v_key)::numeric <> trunc((v_s ->> v_key)::numeric) or (v_s ->> v_key)::numeric not between 1 and 168 then
      raise exception 'email_settings_invalid';
    end if;
  end loop;
  return jsonb_build_object(
    'emails_enabled', (v_s ->> 'emails_enabled')::boolean,
    'apply_needs_email', (v_s ->> 'apply_needs_email')::boolean,
    'pay_reminder_hours', (v_s ->> 'pay_reminder_hours')::integer,
    'email_link_hours', (v_s ->> 'email_link_hours')::integer,
    'confirm_reminder_hours', (v_s ->> 'confirm_reminder_hours')::integer);
end;
$$;

revoke all on function public.email_settings(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The queue (R-1, AC-3, AC-4). One email.send row per recipient and key; a replay writes nothing twice. The
--    payload holds ids, the template and send_until, plus the token for confirm_email only (R-9). Except
--    confirm_email, a recipient without a confirmed address gets no row, and a topic turned off gets none.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.queue_email(p_key text, p_template text, p_recipient uuid, p_request uuid, p_entity uuid,
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
                           'account_rejected', 'account_suspended', 'pay_window_closing', 'closes_soon') then
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

-- AC-3: the key of a mapped audit row, email:<audit_id>:<recipient_id>:<template>. 1 when a row was written.
create function public.queue_audit_mail(p_audit_id bigint, p_region text, p_recipient uuid, p_template text,
                                        p_request uuid, p_entity uuid, p_send_until timestamptz,
                                        p_topic text default null)
  returns integer
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
begin
  if p_recipient is null then
    return 0;
  end if;
  if public.queue_email('email:' || p_audit_id || ':' || p_recipient || ':' || p_template, p_template, p_recipient,
                        p_request, p_entity, p_send_until, p_region, p_topic) is null then
    return 0;
  end if;
  return 1;
end;
$$;

revoke all on function public.queue_audit_mail(bigint, text, uuid, text, uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;

-- R-9, AC-7: a new confirmation for the profile's current address. 'queued', or why not: 'no_email',
-- 'already_confirmed', 'rate_limited' (3 an hour, shared with the resend). The older live ones are revoked;
-- the token's digest is stored, the token itself only in the outbox payload.
create function public.start_email_confirmation(p_profile_id uuid)
  returns text
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_prof   public.profiles%rowtype;
  v_set    jsonb;
  v_count  integer;
  v_token  text;
  v_id     uuid;
  v_exp    timestamptz;
begin
  select p.* into v_prof from public.profiles p where p.id = p_profile_id for update;
  if not found or v_prof.email is null then
    return 'no_email';
  end if;
  if v_prof.email_confirmed_at is not null then
    return 'already_confirmed';
  end if;
  v_set := public.email_settings(v_prof.region);
  insert into public.action_counters (region, subject_id, action, window_start, count)
  values (v_prof.region, v_prof.id, 'email_confirm', date_trunc('hour', now(), 'UTC'), 1)
  on conflict (subject_id, action, window_start) do update set count = public.action_counters.count + 1
   where public.action_counters.count < 3
  returning count into v_count;
  if v_count is null then
    return 'rate_limited';
  end if;
  update public.email_confirmations set revoked_at = now()
   where profile_id = v_prof.id and used_at is null and revoked_at is null;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_exp := now() + make_interval(hours => (v_set ->> 'email_link_hours')::integer);
  insert into public.email_confirmations (region, profile_id, email, token_hash, expires_at)
  values (v_prof.region, v_prof.id, v_prof.email, extensions.digest(v_token, 'sha256'), v_exp)
  returning id into v_id;
  perform public.queue_email('email:confirm:' || v_id, 'confirm_email', v_prof.id, null, v_id, v_exp, v_prof.region,
                             null, v_token);
  return 'queued';
end;
$$;

revoke all on function public.start_email_confirmation(uuid) from public, anon, authenticated, service_role;

-- R-1, AC-3: the recipients of one audit row, by the map. Only names people and ids; what the mail says and
-- whether it still holds is read at send time (email_context). Nothing while the region's switch is off.
create function public.queue_audit_email(p_audit_id bigint)
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
    when 'job.confirmed', 'job.customer_closed', 'job.auto_closed' then
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

-- AC-3: a new offer (05 writes no audit row on apply), to the customer, by the new_offer topic.
create function public.queue_offer_email(p_application_id uuid)
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
  if not found or not public.emails_enabled(v_app.region) then
    return 0;
  end if;
  perform public.email_settings(v_app.region);
  select r.* into v_req from public.requests r where r.id = v_app.request_id;
  if not found then
    return 0;
  end if;
  if public.queue_email('email:offer:' || v_app.id, 'new_offer', v_req.customer_id, v_req.id, v_app.id,
                        now() + interval '24 hours', v_app.region, 'new_offer') is null then
    return 0;
  end if;
  return 1;
end;
$$;

revoke all on function public.queue_offer_email(uuid) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The triggers (R-1, R-2, R-9, R-10). Mail never breaks a move: an error writes one failed row (ids and the
--    SQLSTATE only), which the heartbeat alerts as outbox_failed; if even that fails, a warning, and the move
--    still commits.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.audit_log_email()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_state  text;
begin
  begin
    perform public.queue_audit_email(new.id);
  exception when others then
    v_state := sqlstate;
    begin
      insert into public.outbox_events (region, kind, idempotency_key, payload, status, next_attempt_at, last_error)
      values (new.region, 'email.send', 'email:' || new.id || ':queue_failed',
              jsonb_build_object('audit_id', new.id, 'sqlstate', v_state), 'failed', null, 'queue_failed:' || v_state)
      on conflict (idempotency_key) do nothing;
    exception when others then
      raise warning 'email_queue_failed audit=% sqlstate=%', new.id, v_state;
    end;
  end;
  return null;
end;
$$;

revoke all on function public.audit_log_email() from public, anon, authenticated, service_role;

-- AC-3: the when list is the map's actions; supabase/tests/29 proves the two are equal.
create trigger audit_log_email after insert on public.audit_log
  for each row
  when (new.action in ('request.provider_chosen', 'request.commission_paid', 'request.unlocked', 'job.started',
                       'job.done', 'job.confirmed', 'job.customer_closed', 'job.auto_closed', 'request.cancelled',
                       'request.provider_cancelled', 'request.failed_picks_limit', 'request.no_paid_pick',
                       'request.pick_expired', 'request.fee_expired', 'request.provider_withdrew', 'request.pick_dropped',
                       'fee.late', 'fee.refunded', 'fee.refund_done_by_hand', 'profile.email_changed',
                       'provider.approved', 'provider.reinstated', 'provider.rejected', 'provider.suspended'))
  execute function public.audit_log_email();

create function public.applications_offer_email()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_state  text;
begin
  begin
    perform public.queue_offer_email(new.id);
  exception when others then
    v_state := sqlstate;
    begin
      insert into public.outbox_events (region, kind, idempotency_key, payload, status, next_attempt_at, last_error)
      values (new.region, 'email.send', 'email:offer:' || new.id || ':queue_failed',
              jsonb_build_object('application_id', new.id, 'sqlstate', v_state), 'failed', null,
              'queue_failed:' || v_state)
      on conflict (idempotency_key) do nothing;
    exception when others then
      raise warning 'email_queue_failed application=% sqlstate=%', new.id, v_state;
    end;
  end;
  return null;
end;
$$;

revoke all on function public.applications_offer_email() from public, anon, authenticated, service_role;

create trigger applications_offer_email after insert on public.applications
  for each row execute function public.applications_offer_email();

-- R-10, AC-10: while the region's apply_needs_email is on, a provider without a confirmed address cannot apply.
create function public.applications_need_email()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if public.apply_needs_email(new.region)
     and not exists (select 1 from public.profiles p
                      where p.id = new.provider_id and p.email is not null and p.email_confirmed_at is not null) then
    raise exception 'email_unconfirmed';
  end if;
  return new;
end;
$$;

revoke all on function public.applications_need_email() from public, anon, authenticated, service_role;

create trigger applications_need_email before insert on public.applications
  for each row execute function public.applications_need_email();

-- R-9: the token never outlives its row, whichever path ends it (finish_email, or a lease that ran out in
-- claim_email_outbox). Named to fire after outbox_events_guard (same timing fires in name order), so the
-- guard sees the update as written and this trigger alone drops the token.
create function public.outbox_strip_token()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.kind = 'email.send' and new.status in ('done', 'failed') and new.payload ? 'token' then
    new.payload := new.payload - 'token';
  end if;
  return new;
end;
$$;

revoke all on function public.outbox_strip_token() from public, anon, authenticated, service_role;

create trigger outbox_strip_token before update on public.outbox_events
  for each row execute function public.outbox_strip_token();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The two lanes (R-12, AC-11). 07's claim_outbox, the same signature and body, leaves email.send rows out;
--    claim_email_outbox claims only them, with the same lease rules; finish_email ends one.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.claim_outbox(p_limit integer, p_worker text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_out  jsonb;
begin
  if p_worker is null or char_length(p_worker) not between 1 and 100 then
    raise exception 'validation_failed';
  end if;

  with dead as (
    select o.id from public.outbox_events o
     where o.kind <> 'email.send'
       and o.status = 'claimed' and o.claimed_at < now() - interval '2 minutes' and o.attempts >= 6
       for update skip locked)
  update public.outbox_events o
     set status = 'failed', next_attempt_at = null, last_error = 'lease_expired'
    from dead
   where o.id = dead.id;

  with due as (
    select o.id from public.outbox_events o
     where o.kind <> 'email.send'
       and ((o.status = 'pending' and o.next_attempt_at <= now())
            or (o.status = 'claimed' and o.claimed_at < now() - interval '2 minutes' and o.attempts < 6))
     order by o.created_at, o.id
     limit least(greatest(coalesce(p_limit, 1), 1), 100)
       for update skip locked),
  claimed as (
    update public.outbox_events o
       set status = 'claimed', claimed_at = now(), claimed_by = p_worker, attempts = o.attempts + 1,
           next_attempt_at = null
      from due
     where o.id = due.id
    returning o.id, o.kind, o.idempotency_key, o.payload, o.attempts, o.region, o.claimed_at)
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'idempotency_key', c.idempotency_key,
                                               'payload', c.payload, 'attempts', c.attempts, 'region', c.region,
                                               'claim_token', c.claimed_at)
                            order by c.id), '[]'::jsonb)
    into v_out
    from claimed c;
  return v_out;
end;
$$;

revoke all on function public.claim_outbox(integer, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_outbox(integer, text) to service_role;

create function public.claim_email_outbox(p_limit integer, p_worker text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_out  jsonb;
begin
  if p_worker is null or char_length(p_worker) not between 1 and 100 then
    raise exception 'validation_failed';
  end if;

  with dead as (
    select o.id from public.outbox_events o
     where o.kind = 'email.send'
       and o.status = 'claimed' and o.claimed_at < now() - interval '2 minutes' and o.attempts >= 6
       for update skip locked)
  update public.outbox_events o
     set status = 'failed', next_attempt_at = null, last_error = 'lease_expired'
    from dead
   where o.id = dead.id;

  with due as (
    select o.id from public.outbox_events o
     where o.kind = 'email.send'
       and ((o.status = 'pending' and o.next_attempt_at <= now())
            or (o.status = 'claimed' and o.claimed_at < now() - interval '2 minutes' and o.attempts < 6))
     order by o.created_at, o.id
     limit least(greatest(coalesce(p_limit, 1), 1), 100)
       for update skip locked),
  claimed as (
    update public.outbox_events o
       set status = 'claimed', claimed_at = now(), claimed_by = p_worker, attempts = o.attempts + 1,
           next_attempt_at = null
      from due
     where o.id = due.id
    returning o.id, o.kind, o.idempotency_key, o.payload, o.attempts, o.region, o.claimed_at)
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'idempotency_key', c.idempotency_key,
                                               'payload', c.payload, 'attempts', c.attempts, 'region', c.region,
                                               'claim_token', c.claimed_at)
                            order by c.id), '[]'::jsonb)
    into v_out
    from claimed c;
  return v_out;
end;
$$;

revoke all on function public.claim_email_outbox(integer, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_email_outbox(integer, text) to service_role;

-- R-11, R-12: sent -> done; a skip or already_sent -> done with the outcome in last_error; rejected -> failed at
-- once; retry -> 07's backoff, failed after the sixth try. p_detail is stored only when it is an HTTP status and an
-- error name (`http_422:validation_error`), never a message, which can quote the address.
create function public.finish_email(p_id uuid, p_outcome text, p_claim_token timestamptz, p_detail text default null)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_row   public.outbox_events%rowtype;
  v_note  text;
begin
  if p_id is null or p_outcome is null
     or p_outcome not in ('sent', 'email_off', 'unconfirmed', 'stale', 'condition', 'already_sent', 'rejected', 'retry') then
    raise exception 'validation_failed';
  end if;
  select o.* into v_row from public.outbox_events o where o.id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_row.kind <> 'email.send' then
    raise exception 'invalid_state';
  end if;
  if v_row.status <> 'claimed' or v_row.claimed_at is distinct from p_claim_token then
    return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'attempts', v_row.attempts,
                              'next_attempt_at', v_row.next_attempt_at, 'stale', true);
  end if;
  v_note := case when p_detail ~ '^[a-z0-9_:]{1,100}$' then p_detail else p_outcome end;
  if p_outcome = 'sent' then
    update public.outbox_events set status = 'done', done_at = now(), next_attempt_at = null, last_error = null
     where id = p_id returning * into v_row;
  elsif p_outcome in ('email_off', 'unconfirmed', 'stale', 'condition', 'already_sent') then
    update public.outbox_events set status = 'done', done_at = now(), next_attempt_at = null, last_error = p_outcome
     where id = p_id returning * into v_row;
  elsif p_outcome = 'rejected' or v_row.attempts >= 6 then
    update public.outbox_events set status = 'failed', next_attempt_at = null, last_error = v_note
     where id = p_id returning * into v_row;
  else
    update public.outbox_events
       set status = 'pending',
           next_attempt_at = now() + make_interval(mins => (array[1, 5, 30, 120, 720])[greatest(v_row.attempts, 1)]),
           last_error = v_note
     where id = p_id returning * into v_row;
  end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'attempts', v_row.attempts,
                            'next_attempt_at', v_row.next_attempt_at, 'stale', false);
end;
$$;

revoke all on function public.finish_email(uuid, text, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.finish_email(uuid, text, timestamptz, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Send time (R-8, AC-3's last column, AC-6). The relay's one reader: `skip` with a reason, or the address,
--    the locale and the template's values. The address is read here and nowhere else; no payload holds one.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.email_context(p_outbox_id uuid)
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
  v_email    text;
  v_side     text;
  v_ok       boolean := true;
  v_amount   bigint;
  v_cur      text;
  v_fee      uuid;
  v_dead     timestamptz;
  v_carried  boolean;
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
      v_ok := v_req.status = 'AWAITING_CONFIRMATION';
      v_dead := v_req.confirm_deadline;
    when 'account_approved' then
      v_ok := exists (select 1 from public.providers pr where pr.id = v_rcp and pr.status = 'approved');
    when 'contacts_ready', 'job_started', 'job_completed', 'pick_ended', 'window_missed', 'confirm_email',
         'account_rejected', 'account_suspended' then
      v_ok := true;
    else
      raise exception 'invalid_state';
  end case;

  if not coalesce(v_ok, false) then
    return jsonb_build_object('status', 'skip', 'reason', 'condition');
  end if;
  return jsonb_build_object(
    'status', 'send',
    'template', v_tpl,
    'email', v_email,
    'locale', coalesce(v_prof.locale, v_reg.default_locale),
    'region_locale', v_reg.default_locale,
    'timezone', v_reg.timezone,
    'values', jsonb_build_object(
      'side', v_side,
      'request_id', v_req.id,
      'service', v_req.pricing_snapshot -> 'service' -> 'name',
      'start_at', v_req.scheduled_start_at,
      'deadline', v_dead,
      'amount', v_amount,
      'currency', v_cur,
      'fee_id', v_fee,
      'carried', v_carried,
      'token', case when v_tpl = 'confirm_email' then v_o.payload ->> 'token' end));
end;
$$;

revoke all on function public.email_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.email_context(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Confirming an address (AC-7, R-9). The resend, and the confirm itself: a POST by the signed in owner, never a
--    public route. confirm_email is the first writer of profiles.email_confirmed_at.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.request_email_confirmation()
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_prof  public.profiles%rowtype;
  v_out   text;
begin
  if v_uid is null then
    raise exception 'forbidden';
  end if;
  select p.* into v_prof from public.profiles p where p.id = v_uid;
  if not found then
    raise exception 'forbidden';
  end if;
  if v_prof.email is null then
    raise exception 'no_email';
  end if;
  if v_prof.email_confirmed_at is not null then
    raise exception 'already_confirmed';
  end if;
  if not public.emails_enabled(v_prof.region) then
    raise exception 'emails_off';
  end if;
  v_out := public.start_email_confirmation(v_uid);
  if v_out = 'rate_limited' then
    raise exception 'rate_limited';
  end if;
  if v_out <> 'queued' then
    raise exception '%', v_out;
  end if;
  perform public.relay_kick('email');
  return jsonb_build_object('status', 'queued');
end;
$$;

revoke all on function public.request_email_confirmation() from public, anon, authenticated, service_role;
grant execute on function public.request_email_confirmation() to authenticated;

create function public.confirm_email(p_token text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_prof  public.profiles%rowtype;
  v_conf  public.email_confirmations%rowtype;
begin
  if v_uid is null then
    raise exception 'forbidden';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid_link';
  end if;
  -- Lock order: the profile, then its confirmations (as start_email_confirmation).
  select p.* into v_prof from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'invalid_link';
  end if;
  select c.* into v_conf from public.email_confirmations c
   where c.token_hash = extensions.digest(p_token, 'sha256')
     for update;
  if not found or v_conf.profile_id <> v_uid then
    raise exception 'invalid_link';
  end if;
  if v_conf.used_at is not null then
    raise exception 'link_used';
  end if;
  if v_conf.revoked_at is not null or v_conf.expires_at <= now() or v_prof.email is distinct from v_conf.email then
    raise exception 'link_expired';
  end if;
  update public.email_confirmations set used_at = now() where id = v_conf.id;
  update public.profiles set email_confirmed_at = now() where id = v_uid and email_confirmed_at is null;
  return jsonb_build_object('status', 'confirmed');
end;
$$;

revoke all on function public.confirm_email(text) from public, anon, authenticated, service_role;
grant execute on function public.confirm_email(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Reminders (AC-6) every 15 minutes and the daily housekeeping (R-9). Run by pg_cron as postgres; no API
--    grant. One bad row never stops the rest (its own subtransaction, the id and the SQLSTATE only).
-- ═══════════════════════════════════════════════════════════════════════════

create function public.queue_reminders()
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

      -- The customer's confirm window, only where it closes by itself.
      if public.auto_close_enabled(v_region) then
        v_close := make_interval(hours => (v_set ->> 'confirm_reminder_hours')::integer);
        for v_row in
          select r.id, r.customer_id as recipient, r.selected_application_id as app, r.confirm_deadline as deadline
            from public.requests r
           where r.region = v_region and r.status = 'AWAITING_CONFIRMATION'
             and r.confirm_deadline > now() and r.confirm_deadline <= now() + v_close
           order by r.id
        loop
          begin
            if public.queue_email('email:' || v_row.id || ':closes_soon', 'closes_soon', v_row.recipient, v_row.id,
                                  v_row.app, v_row.deadline, v_region) is not null then
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

-- R-9: a confirmation ends at the first of its use, its revoke and its expiry; 30 days later it is deleted.
create function public.emails_housekeeping()
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_n  integer;
begin
  delete from public.email_confirmations c
   where least(c.used_at, c.revoked_at, c.expires_at) < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.emails_housekeeping() from public, anon, authenticated, service_role;

-- 08's kick learns the `email` task (R-12).
create or replace function public.relay_kick(p_task text)
  returns bigint
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_url     text;
  v_secret  text;
begin
  if p_task is null or p_task not in ('drain', 'reconcile_pending', 'reconcile_daily', 'heartbeat', 'email') then
    raise exception 'validation_failed';
  end if;
  begin
    select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'relay_url';
    select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'relay_secret';
  exception when undefined_table or invalid_schema_name or insufficient_privilege then
    return null;
  end;
  if v_url is null or v_secret is null or v_url !~ '^https://' then
    return null;
  end if;
  return net.http_post(
    url := v_url,
    body := jsonb_build_object('task', p_task),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-relay-secret', v_secret),
    timeout_milliseconds := 10000);
end;
$$;

revoke all on function public.relay_kick(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. The schedules. cron.schedule replaces a job of the same name, so this is safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

select cron.schedule('relay-email', '* * * * *', $$select public.relay_kick('email')$$);
select cron.schedule('emails-reminders', '*/15 * * * *', $$select public.queue_reminders()$$);
select cron.schedule('emails-housekeeping', '17 3 * * *', $$select public.emails_housekeeping()$$);
