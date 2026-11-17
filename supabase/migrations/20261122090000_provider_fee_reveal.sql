-- Position 10 (spec 0011-10, amended by D178 with rules R-1 to R-15): the chosen provider pays the provider fee,
-- then contacts are shared both ways.
--
-- Once the commission is settled (09), the chosen provider presses Pay on My jobs. pay_provider_fee opens the
-- provider fee and a checkout attempt (or returns a young one), counted per fee per hour, exactly as 09's
-- pay_commission does; the relay (08) opens the card page and applies the verified result through apply_fee_paid
-- (07). This migration fills 07's two provider fee hooks: accept_provider_fee decides whether a verified payment is
-- accepted, and after_provider_fee_paid moves the request and the pick to UNLOCKED, stamps applications.unlocked_at,
-- and turns every other live application NOT_SELECTED. A provider fee of 0 moves at once, with no fee row (D171).
--
-- The reveal (rule 2): one helper, contacts_visible, answers for the caller only; request_contacts returns phones
-- and emails from profiles through it, and a new policy lets the unlocked provider read the street line through it.
-- A provider suspended after the reveal loses the customer's contacts (A-5). Contacts hide again
-- contact_visible_days after requests.closed_at, which 11 and 12 write.
--
-- Lock order (D169): the requests row first, always; under it the provider row (shared), then the fee, then the
-- applications. Every path takes the request row first, so the orders cannot deadlock.
--
-- Every function revokes PUBLIC and pins search_path (supabase/tests/02). Refusals are stable codes in the
-- exception message; the doors map them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The setting (AC-1, R-10). contact_visible_days 14 ☐ per region, a row check, and it joins the guard's
--    required keys. A missing key makes contact_settings refuse contact_settings_invalid.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_contact_visible_days_valid check (
    case when key <> 'contact_visible_days' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 365 end);

insert into public.platform_settings (region, key, value) values
  ('TR',  'contact_visible_days', '14'),
  ('KSA', 'contact_visible_days', '14')
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
                 'unlock_window_hours', 'contact_visible_days')
     and (tg_op = 'DELETE' or new.key is distinct from old.key or new.region is distinct from old.region) then
    raise exception 'pricing_setting_required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.pricing_settings_guard() from public, anon, authenticated, service_role;

create function public.contact_settings(p_region text)
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
   where s.region = p_region and s.key = 'contact_visible_days';
  if jsonb_typeof(v_value) is distinct from 'number'
     or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
     or (v_value #>> '{}')::numeric not between 1 and 365 then
    raise exception 'contact_settings_invalid';
  end if;
  return (v_value #>> '{}')::integer;
end;
$$;

revoke all on function public.contact_settings(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The columns (AC-1). requests.closed_at: written by 11 and 12 with a terminal move, never by 10.
--    applications.unlocked_at: the reveal as a one way fact, set once by provider_fee_settled.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.requests
  add column closed_at timestamptz,
  add constraint requests_closed_at_terminal check (closed_at is null or status in ('COMPLETED', 'CANCELLED'));

alter table public.applications
  add column unlocked_at timestamptz,
  add constraint applications_unlocked_at_set check (status <> 'UNLOCKED' or unlocked_at is not null),
  add constraint applications_unlocked_at_status check (
    unlocked_at is null or status in ('UNLOCKED', 'STARTED', 'COMPLETED', 'CONFIRMED', 'RATED', 'CANCELLED'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The guards (R-5, R-6).
-- ═══════════════════════════════════════════════════════════════════════════

-- 09's guard, widened: COMMISSION_PAID -> UNLOCKED is allowed only when the pick carries unlocked_at; closed_at
-- is set once, with a terminal move, never changed or cleared.
create or replace function public.requests_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                            'selected_application_id', 'selected_at', 'payment_deadline', 'fee_deadline', 'closed_at'])
     is distinct from (to_jsonb(old) - array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                                             'selected_application_id', 'selected_at', 'payment_deadline',
                                             'fee_deadline', 'closed_at']) then
    raise exception 'request_immutable';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'OPEN' and new.status in ('CANCELLED', 'SELECTED'))
              or (old.status = 'SELECTED' and new.status in ('CANCELLED', 'COMMISSION_PAID'))
              or (old.status = 'COMMISSION_PAID' and new.status = 'UNLOCKED')) then
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
  if new.closed_at is distinct from old.closed_at
     and not (old.closed_at is null and new.closed_at is not null
              and new.status is distinct from old.status and new.status in ('COMPLETED', 'CANCELLED')) then
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

-- 07's guard, widened: unlocked_at goes from null to a value only on AWAITING_FEE -> UNLOCKED, and never
-- changes or clears after that.
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
  return new;
end;
$$;

revoke all on function public.applications_guard() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The provider fee hooks (AC-3, AC-4, R-8, R-12, R-15). accept_provider_fee is asked by apply_fee_paid
--    before any change; after_provider_fee_paid runs after the paid journal. Both inside apply_fee_paid's
--    transaction with the request and the fee locked.
-- ═══════════════════════════════════════════════════════════════════════════

-- The commission side is settled: a commission of 0, or its fee paid and never refunded (R-4 of 09).
create function public.commission_side_settled(p_request_id uuid)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select r.commission_amount = 0
         or exists (select 1 from public.fee_payments f
                     where f.request_id = r.id and f.kind = 'commission' and f.status = 'paid'
                       and not exists (select 1 from public.fee_refunds x where x.fee_payment_id = f.id))
    from public.requests r
   where r.id = p_request_id
$$;

revoke all on function public.commission_side_settled(uuid) from public, anon, authenticated, service_role;

create or replace function public.accept_provider_fee(p_fee uuid, p_attempt uuid)
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
  if not found or v_fee.kind <> 'provider_fee' or v_fee.status <> 'pending' then
    return false;
  end if;
  if exists (select 1 from public.fee_refunds x where x.fee_payment_id = v_fee.id) then
    return false;
  end if;
  select r.* into v_req from public.requests r where r.id = v_fee.request_id;
  if v_req.status is distinct from 'COMMISSION_PAID' or v_req.fee_deadline is null then
    return false;
  end if;
  if not exists (select 1 from public.applications a
                  where a.id = v_req.selected_application_id
                    and a.request_id = v_req.id
                    and a.provider_id = v_fee.provider_id
                    and a.status = 'AWAITING_FEE'
                    and public.provider_standing(a.provider_id) is not distinct from 'approved') then
    return false;
  end if;
  if not public.commission_side_settled(v_req.id) then
    return false;
  end if;
  select a.started_at into v_started from public.checkout_attempts a
   where a.id = p_attempt and a.fee_payment_id = v_fee.id;
  if not found or v_started > v_req.fee_deadline then
    return false;
  end if;
  -- R-15: a payment after the job's start is refunded, as the commission is (09 A-1), even inside the floor.
  if now() >= v_req.scheduled_start_at then
    return false;
  end if;
  v_hold := (public.checkout_settings(v_req.region) ->> 'hold_minutes')::integer;
  if v_hold is null then
    raise exception 'checkout_settings_invalid';
  end if;
  return now() <= v_req.fee_deadline + make_interval(mins => v_hold);
end;
$$;

revoke all on function public.accept_provider_fee(uuid, uuid) from public, anon, authenticated, service_role;

-- The one move to UNLOCKED, for a paid fee and for a fee of 0. The request row is already locked by the caller.
create function public.provider_fee_settled(p_request_id uuid)
  returns void
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_req  public.requests%rowtype;
begin
  select r.* into v_req from public.requests r where r.id = p_request_id for update;
  if not found or v_req.status <> 'COMMISSION_PAID' then
    raise exception 'invalid_state';
  end if;
  -- R-8: the commission side is settled, on this path too.
  if not public.commission_side_settled(v_req.id) then
    raise exception 'invalid_state';
  end if;

  -- The pick must still stand and its provider be approved; no row changed means it does not.
  update public.applications a
     set status = 'UNLOCKED', unlocked_at = now(), status_changed_at = now()
   where a.id = v_req.selected_application_id and a.request_id = v_req.id and a.status = 'AWAITING_FEE'
     and public.provider_standing(a.provider_id) is not distinct from 'approved';
  if not found then
    raise exception 'invalid_state';
  end if;

  update public.requests set status = 'UNLOCKED' where id = v_req.id;

  -- R-12: only live rows of other providers move; final rows stay as they are.
  update public.applications a
     set status = 'NOT_SELECTED', status_changed_at = now()
   where a.request_id = v_req.id and a.id <> v_req.selected_application_id and a.status in ('APPLIED', 'SELECTED');

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values ((select auth.uid()), 'request.unlocked', 'requests', v_req.id::text, v_req.region,
          jsonb_build_object('status', 'COMMISSION_PAID'),
          jsonb_build_object('status', 'UNLOCKED', 'application_id', v_req.selected_application_id));
end;
$$;

revoke all on function public.provider_fee_settled(uuid) from public, anon, authenticated, service_role;

create or replace function public.after_provider_fee_paid(p_fee uuid)
  returns void
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_request  uuid;
begin
  select f.request_id into v_request from public.fee_payments f where f.id = p_fee and f.kind = 'provider_fee';
  if not found then
    raise exception 'invalid_state';
  end if;
  perform public.provider_fee_settled(v_request);
end;
$$;

revoke all on function public.after_provider_fee_paid(uuid) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. pay_provider_fee (AC-2). The same steps as 09's pay_commission, for the chosen provider.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.pay_provider_fee(p_application_id uuid, p_locale text, p_payer_ip text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_ip        inet;
  v_request   uuid;
  v_req       public.requests%rowtype;
  v_app       public.applications%rowtype;
  v_settings  jsonb;
  v_hold      integer;
  v_limit     integer;
  v_fee       uuid;
  v_attempt   uuid;
  v_count     integer;
begin
  -- 1. Inputs, as 09: one full length address, else null, never an error.
  if p_locale is null or p_locale not in ('ar', 'tr', 'en') then
    raise exception 'validation_failed';
  end if;
  if p_payer_ip is not null and char_length(p_payer_ip) <= 45 then
    begin
      v_ip := p_payer_ip::inet;
      if masklen(v_ip) <> (case family(v_ip) when 4 then 32 else 128 end) then
        v_ip := null;
      end if;
    exception when others then
      v_ip := null;
    end;
  end if;

  -- 2. The request, locked; the caller's provider row, shared (D156); the application read again.
  select a.request_id into v_request from public.applications a
   where a.id = p_application_id and a.provider_id = v_uid;
  if not found then
    raise exception 'not_found';
  end if;
  select r.* into v_req from public.requests r where r.id = v_request for update;
  perform 1 from public.providers pr where pr.id = v_uid for share;
  select a.* into v_app from public.applications a where a.id = p_application_id and a.provider_id = v_uid;
  if not found then
    raise exception 'not_found';
  end if;

  -- 3. Already paid, or not the pick waiting for its fee.
  if v_app.unlocked_at is not null
     or exists (select 1 from public.fee_payments f
                 where f.request_id = v_req.id and f.kind = 'provider_fee' and f.provider_id = v_uid
                   and f.status = 'paid') then
    raise exception 'already_paid';
  end if;
  if v_req.status <> 'COMMISSION_PAID' or v_req.selected_application_id is distinct from v_app.id
     or v_app.status <> 'AWAITING_FEE' or v_app.provider_fee_amount is null
     or public.provider_standing(v_uid) is distinct from 'approved' then
    raise exception 'invalid_state';
  end if;

  -- 4. The fee window.
  if now() >= v_req.fee_deadline then
    raise exception 'deadline_passed';
  end if;

  -- 5. A provider fee of 0 (D171): settled at once, no fee row, no attempt, no switch or settings check.
  if v_app.provider_fee_amount = 0 then
    perform public.provider_fee_settled(v_req.id);
    return jsonb_build_object('status', 'settled');
  end if;

  -- 6, 7. The switch and the checkout settings of the region of the request.
  if not public.payments_enabled(v_req.region) then
    raise exception 'payments_disabled';
  end if;
  v_settings := public.checkout_settings(v_req.region);
  if v_settings is null then
    raise exception 'checkout_settings_invalid';
  end if;
  v_hold := (v_settings ->> 'hold_minutes')::integer;

  -- 8. The provider fee, then its row locked.
  v_fee := public.open_fee(v_req.id, 'provider_fee');
  perform 1 from public.fee_payments f where f.id = v_fee for update;

  -- 9. A young open attempt is returned as it is: nothing counted, no audit row (D176).
  select a.id into v_attempt from public.checkout_attempts a
   where a.fee_payment_id = v_fee
     and a.status in ('queued', 'ready')
     and a.started_at > now() - make_interval(mins => v_hold)
   order by a.started_at desc, a.id
   limit 1;
  if found then
    return jsonb_build_object('status', 'checkout', 'attempt_id', v_attempt, 'reused', true);
  end if;

  -- 10. One count for this fee in this UTC hour; above the limit the raise rolls the count back.
  v_limit := public.checkout_limit(v_req.region);
  insert into public.action_counters (region, subject_id, action, window_start, count)
  values (v_req.region, v_fee, 'checkout', date_trunc('hour', now(), 'UTC'), 1)
  on conflict (subject_id, action, window_start) do update set count = public.action_counters.count + 1
  returning count into v_count;
  if v_count > v_limit then
    raise exception 'too_many_checkouts';
  end if;

  -- 11. A new attempt and its outbox row.
  v_attempt := public.start_checkout(v_fee, p_locale, v_ip);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'fee.checkout_requested', 'checkout_attempts', v_attempt::text, v_req.region, null,
          jsonb_build_object('request_id', v_req.id, 'fee_payment_id', v_fee, 'attempt_id', v_attempt,
                             'reused', false));
  return jsonb_build_object('status', 'checkout', 'attempt_id', v_attempt, 'reused', false);
end;
$$;

revoke all on function public.pay_provider_fee(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pay_provider_fee(uuid, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The reveal (AC-5, AC-6, AC-7, R-2, R-3, R-4). contacts_visible is the one door: the policy and
--    request_contacts both ask it, and it answers only for the caller.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.contacts_visible(p_request_id uuid)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_req  public.requests%rowtype;
  v_app  public.applications%rowtype;
begin
  if v_uid is null then
    return false;
  end if;
  select r.* into v_req from public.requests r where r.id = p_request_id;
  if not found then
    return false;
  end if;
  select a.* into v_app from public.applications a
   where a.id = v_req.selected_application_id and a.request_id = v_req.id and a.unlocked_at is not null;
  if not found then
    return false;
  end if;
  if not (v_req.customer_id = v_uid
          or (v_app.provider_id = v_uid and public.provider_standing(v_uid) is not distinct from 'approved')) then
    return false;
  end if;
  return v_req.closed_at is null
      or v_req.closed_at > now() - make_interval(days => public.contact_settings(v_req.region));
end;
$$;

revoke all on function public.contacts_visible(uuid) from public, anon, authenticated, service_role;
grant execute on function public.contacts_visible(uuid) to authenticated;

-- R-3: one contacts.viewed row per (request, actor).
create unique index audit_log_contacts_viewed_once_idx on public.audit_log (entity_id, actor_id)
  where action = 'contacts.viewed';

create function public.request_contacts(p_request_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_req   public.requests%rowtype;
  v_app   public.applications%rowtype;
  v_side  text;
  v_out   jsonb;
begin
  if not public.contacts_visible(p_request_id) then
    raise exception 'not_found';
  end if;
  select r.* into v_req from public.requests r where r.id = p_request_id for share;
  select a.* into v_app from public.applications a where a.id = v_req.selected_application_id;
  v_side := case when v_req.customer_id = v_uid then 'customer' else 'provider' end;

  if v_side = 'customer' then
    -- The provider, to the customer.
    select jsonb_build_object(
             'side', 'customer',
             'name', pr.approved_name,
             'phone', p.phone,
             'whatsapp', 'https://wa.me/' || regexp_replace(p.phone, '\D', '', 'g'),
             'email', p.email,
             'email_confirmed', p.email_confirmed_at is not null)
      into v_out
      from public.providers pr join public.profiles p on p.id = pr.id
     where pr.id = v_app.provider_id;
  else
    -- The customer, the place and the time, to the provider.
    select jsonb_build_object(
             'side', 'provider',
             'name', p.full_name,
             'phone', p.phone,
             'whatsapp', 'https://wa.me/' || regexp_replace(p.phone, '\D', '', 'g'),
             'email', p.email,
             'email_confirmed', p.email_confirmed_at is not null,
             'street', (select ra.line from public.request_addresses ra where ra.request_id = v_req.id),
             'notes', v_req.notes,
             'zone', (select z.name from public.zones z where z.id = v_req.zone_id),
             'scheduled_start_at', v_req.scheduled_start_at,
             'scheduled_end_at', v_req.scheduled_end_at,
             'timezone', (select g.timezone from public.regions g where g.code = v_req.region))
      into v_out
      from public.profiles p
     where p.id = v_req.customer_id;
  end if;

  -- AC-7, R-3: the first read of each side is audited once; a concurrent first read conflicts quietly.
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'contacts.viewed', 'requests', v_req.id::text, v_req.region, null,
          jsonb_build_object('side', v_side))
  on conflict (entity_id, actor_id) where action = 'contacts.viewed' do nothing;

  return v_out;
end;
$$;

revoke all on function public.request_contacts(uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_contacts(uuid) to authenticated;

-- AC-6: the unlocked, approved provider reads the street line under exactly the same condition.
create policy request_addresses_read_unlocked on public.request_addresses for select to authenticated
  using (public.contacts_visible(request_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. my_checkout, replaced (R-1): the fee id (the payer's own receipt number), the amount, the deadline that
--    applies, and for a provider fee the application, so a provider's pay pages need no read on requests.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.my_checkout(p_attempt_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_out  jsonb;
begin
  select jsonb_build_object(
           'attempt_id', a.id,
           'request_id', f.request_id,
           'fee_kind', f.kind,
           'fee_status', f.status,
           'status', a.status,
           'reason', case when a.failure_reason is null then null
                          when a.failure_reason = 'late_payment' then 'late'
                          when a.failure_reason = 'payments_disabled' then 'paused'
                          else 'failed' end,
           'url', case when a.status = 'ready'
                        and a.started_at > now() - make_interval(mins => (public.checkout_settings(a.region) ->> 'hold_minutes')::integer)
                       then a.url end,
           'locale', a.locale,
           'fee_id', f.id,
           'amount', f.amount,
           'deadline', case f.kind when 'commission' then r.payment_deadline else r.fee_deadline end,
           'application_id', case when f.kind = 'provider_fee' then r.selected_application_id end,
           -- R-3 of 09, narrowed by security review S09-1: a late refund of a payment made on this attempt.
           'late_refund', exists (select 1 from public.fee_refunds x
                                   join public.ledger_journals j
                                     on j.idempotency_key = 'late:' || x.psp_payment_id || ':received'
                                  where x.request_id = f.request_id and x.kind = 'late'
                                    and j.response ->> 'attempt_id' = a.id::text))
    into v_out
    from public.checkout_attempts a
    join public.fee_payments f on f.id = a.fee_payment_id
    join public.requests r on r.id = f.request_id
   where a.id = p_attempt_id and f.payer_id = (select auth.uid());
  if v_out is null then
    raise exception 'not_found';
  end if;
  return v_out;
end;
$$;

revoke all on function public.my_checkout(uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_checkout(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. My jobs (AC-10, R-11). One definer read per tab, 20 a page, newest change first; no contact field.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.provider_jobs(p_tab text, p_after_changed_at timestamptz, p_after_id uuid)
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
    when 'active'  then array['UNLOCKED', 'STARTED']
    when 'done'    then array['COMPLETED', 'CONFIRMED', 'RATED', 'NOT_SELECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED']
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
               -- R-15: the Chosen tab shows the fee window capped at the start.
               'fee_deadline', case when m.status = 'AWAITING_FEE'
                                    then least((m.req).fee_deadline, (m.req).scheduled_start_at) end) as j
        from (
          select a.id, a.status, a.status_changed_at, a.provider_fee_amount, a.unlocked_at, r as req
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

  -- The database clock, so the page decides an open window without reading its own clock.
  return jsonb_build_object('timezone', v_tz, 'now', now(), 'has_more', v_more, 'rows', v_rows);
end;
$;

revoke all on function public.provider_jobs(text, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.provider_jobs(text, timestamptz, uuid) to authenticated;

create index applications_provider_changed_idx on public.applications (provider_id, status_changed_at desc, id desc);
