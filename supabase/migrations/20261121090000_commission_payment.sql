-- Position 09 (spec 0011-09, amended by D175 with rules R-1 to R-15): the customer pays the commission.
--
-- The customer presses Pay on a SELECTED request. pay_commission opens the commission fee and a checkout
-- attempt (or returns a young one), counted per fee per hour; the relay (08) opens the card page and later
-- applies the verified result through apply_fee_paid (07). This migration fills 07’s two commission hooks:
-- accept_commission decides whether a verified payment is accepted, and after_commission_paid moves the
-- request to COMMISSION_PAID, the chosen application to AWAITING_FEE, and starts the provider’s fee window.
-- A commission of 0 moves the request at once, with no fee row (D171). The payer reads an attempt and a
-- receipt only through my_checkout and my_receipt; no PSP payment id, token or IP leaves the database.
--
-- Lock order (D169): the requests row first, always; under it, start_checkout and pay_commission lock
-- fee_payments then checkout_attempts, while cancel_request and commission_settled (after apply_fee_paid)
-- lock the fee before the applications. Every path takes the request row first, so the orders cannot
-- deadlock (reviews F7, 2026-11-17).
--
-- Order below: settings -> the counter table -> the request column and guard -> the readers -> the
-- attempt’s late reason -> start_checkout -> the commission hooks -> cancel -> pay -> the payer’s reads.
-- Every function revokes PUBLIC and pins search_path (supabase/tests/02). Refusals are stable codes in the
-- exception message; lib/requests maps them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Settings (AC-1). min_window_minutes and checkouts_per_fee_hour are new; unlock_window_hours (00) is now
--    held to whole hours 1 to 168. Each is a row check, and none can be deleted, renamed or moved to another
--    region. A missing key makes its reader refuse (unlock_settings_invalid, checkout_settings_invalid).
--    ☐ marks a value unconfirmed until S17.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_min_window_minutes_valid check (
    case when key <> 'min_window_minutes' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 1440 end),
  add constraint platform_settings_checkouts_per_fee_hour_valid check (
    case when key <> 'checkouts_per_fee_hour' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 100 end),
  add constraint platform_settings_unlock_window_hours_valid check (
    case when key <> 'unlock_window_hours' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 168 end);

-- min_window_minutes 60 ☐, checkouts_per_fee_hour 10.
insert into public.platform_settings (region, key, value) values
  ('TR',  'min_window_minutes',     '60'),
  ('KSA', 'min_window_minutes',     '60'),
  ('TR',  'checkouts_per_fee_hour', '10'),
  ('KSA', 'checkouts_per_fee_hour', '10')
on conflict (region, key) do nothing;

-- 03’s guard, widened again (07, 08): the three window and limit keys join it.
create or replace function public.pricing_settings_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if old.key in ('price_rounding_minor', 'max_price_multiple', 'provider_fee_kind', 'provider_fee_value', 'fee_min_minor',
                 'checkout_hold_minutes', 'psp_buyer_city', 'min_window_minutes', 'checkouts_per_fee_hour',
                 'unlock_window_hours')
     and (tg_op = 'DELETE' or new.key is distinct from old.key or new.region is distinct from old.region) then
    raise exception 'pricing_setting_required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.pricing_settings_guard() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The umbrella’s generic counter (AC-1, R-9, R-14). One row per (subject, action, UTC hour). 09 counts
--    action `checkout` with the fee id as subject. No API role reads or writes it; 21’s retention task
--    deletes rows older than 2 days.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.action_counters (
  region        text        not null references public.regions (code) on delete restrict,
  subject_id    uuid        not null,
  action        text        not null,
  window_start  timestamptz not null,
  count         integer     not null default 1,
  created_at    timestamptz not null default now(),

  constraint action_counters_pkey primary key (subject_id, action, window_start),
  constraint action_counters_action_valid check (action in ('checkout')),
  constraint action_counters_count_positive check (count >= 1)
);

alter table public.action_counters enable row level security;
create policy action_counters_no_api on public.action_counters for select to authenticated using (false);
revoke all on table public.action_counters from anon, authenticated, service_role;
create index action_counters_region_idx on public.action_counters (region);
create index action_counters_window_idx on public.action_counters (window_start);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The provider’s fee window on the request (AC-6, R-8). Written once, on SELECTED -> COMMISSION_PAID,
--    and always after the choose. It may pass the job’s start by up to min_window_minutes (R-8).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.requests
  add column fee_deadline timestamptz,
  add constraint requests_fee_deadline_after_choose check (
    fee_deadline is null or (selected_at is not null and fee_deadline > selected_at));

-- 06’s guard, widened: SELECTED -> COMMISSION_PAID is allowed, and fee_deadline is written only on that
-- move, never null after it.
create or replace function public.requests_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                            'selected_application_id', 'selected_at', 'payment_deadline', 'fee_deadline'])
     is distinct from (to_jsonb(old) - array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                                             'selected_application_id', 'selected_at', 'payment_deadline',
                                             'fee_deadline']) then
    raise exception 'request_immutable';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'OPEN' and new.status in ('CANCELLED', 'SELECTED'))
              or (old.status = 'SELECTED' and new.status in ('CANCELLED', 'COMMISSION_PAID'))) then
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
  return new;
end;
$$;

revoke all on function public.requests_guard() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The readers (AC-1, R-6). Internal, no API grant. Each refuses with its code when a key is missing or
--    malformed; the row checks hold the shape of a present value, so this is the second line.
-- ═══════════════════════════════════════════════════════════════════════════

-- The provider’s fee window: unlock_window_hours and min_window_minutes of a region.
create function public.unlock_settings(p_region text)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_hours    jsonb;
  v_minutes  jsonb;
begin
  select s.value into v_hours from public.platform_settings s where s.region = p_region and s.key = 'unlock_window_hours';
  select s.value into v_minutes from public.platform_settings s where s.region = p_region and s.key = 'min_window_minutes';
  if jsonb_typeof(v_hours) is distinct from 'number' or jsonb_typeof(v_minutes) is distinct from 'number'
     or (v_hours #>> '{}')::numeric <> trunc((v_hours #>> '{}')::numeric)
     or (v_hours #>> '{}')::numeric not between 1 and 168
     or (v_minutes #>> '{}')::numeric <> trunc((v_minutes #>> '{}')::numeric)
     or (v_minutes #>> '{}')::numeric not between 1 and 1440 then
    raise exception 'unlock_settings_invalid';
  end if;
  return jsonb_build_object('unlock_window_hours', (v_hours #>> '{}')::integer,
                            'min_window_minutes', (v_minutes #>> '{}')::integer);
end;
$$;

revoke all on function public.unlock_settings(text) from public, anon, authenticated, service_role;

-- R-6: the card page openings allowed per fee per hour. checkout_settings (08) is left as it is.
create function public.checkout_limit(p_region text)
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
   where s.region = p_region and s.key = 'checkouts_per_fee_hour';
  if jsonb_typeof(v_value) is distinct from 'number'
     or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
     or (v_value #>> '{}')::numeric not between 1 and 100 then
    raise exception 'checkout_settings_invalid';
  end if;
  return (v_value #>> '{}')::integer;
end;
$$;

revoke all on function public.checkout_limit(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. A late attempt is closed (AC-8, A-7). The relay fails an attempt `late_payment` when apply_fee_paid
--    answers late. reconcile_pending (08) rechecks only psp_failed and abandoned attempts, so a late one is
--    never asked again.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.checkout_attempts
  drop constraint checkout_attempts_failure_reason_valid,
  add constraint checkout_attempts_failure_reason_valid check (
    failure_reason is null or failure_reason in ('payments_disabled', 'psp_not_configured', 'url_refused', 'psp_failed',
                                                 'init_failed', 'fee_not_pending', 'init_late', 'late_payment'));

create or replace function public.fail_attempt(p_attempt_id uuid, p_reason text)
  returns jsonb
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_row  public.checkout_attempts%rowtype;
begin
  if p_reason is null or p_reason not in ('payments_disabled', 'psp_not_configured', 'url_refused', 'psp_failed',
                                          'init_failed', 'fee_not_pending', 'init_late', 'late_payment') then
    raise exception 'validation_failed';
  end if;
  v_row := public.lock_attempt(p_attempt_id);
  if v_row.status not in ('queued', 'ready') then
    return jsonb_build_object('changed', false, 'status', v_row.status);
  end if;
  update public.checkout_attempts
     set status = 'failed', failure_reason = p_reason, finished_at = now()
   where id = p_attempt_id;
  return jsonb_build_object('changed', true, 'status', 'failed');
end;
$$;

revoke all on function public.fail_attempt(uuid, text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. start_checkout, replaced (AC-3, R-7, 08’s R-8). The one argument form is dropped; the attempt now
--    carries the page locale and the payer’s IP (null allowed, cleared by reconcile_pending after 2 hours).
--    10 calls the same function for the provider fee.
-- ═══════════════════════════════════════════════════════════════════════════

drop function public.start_checkout(uuid);

create function public.start_checkout(p_fee_payment_id uuid, p_locale text, p_payer_ip inet)
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
  if p_locale is null or p_locale not in ('ar', 'tr', 'en') then
    raise exception 'validation_failed';
  end if;
  select f.request_id into v_request from public.fee_payments f where f.id = p_fee_payment_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform 1 from public.requests r where r.id = v_request for update;
  select f.* into v_fee from public.fee_payments f where f.id = p_fee_payment_id for update;
  if v_fee.status <> 'pending' then
    raise exception 'invalid_state';
  end if;
  insert into public.checkout_attempts (region, fee_payment_id, locale, payer_ip)
  values (v_fee.region, v_fee.id, p_locale, p_payer_ip)
  returning id into v_id;
  perform public.enqueue_outbox('checkout.initialize', 'checkout:' || v_id || ':init',
                                jsonb_build_object('attempt_id', v_id, 'fee_payment_id', v_fee.id), v_fee.region);
  perform public.relay_kick('drain');
  return v_id;
end;
$$;

revoke all on function public.start_checkout(uuid, text, inet) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The commission hooks (AC-5, AC-6, R-1, R-4). accept_commission is asked by apply_fee_paid before any
--    change; after_commission_paid runs after the paid journal. Both inside apply_fee_paid’s transaction with
--    the request and the fee already locked (D169). A commission of 0 reaches commission_settled from
--    pay_commission, with no fee row (D171): the commission side of the reveal is "commission_amount = 0 or
--    the commission fee is paid" (R-4).
-- ═══════════════════════════════════════════════════════════════════════════

-- SELECTED -> COMMISSION_PAID, the chosen application SELECTED -> AWAITING_FEE, and the provider’s fee
-- window: the unlock window or the job’s start, whichever comes first, raised to at least min_window_minutes
-- from now (the umbrella rule, A-1). Returns the fee deadline.
create function public.commission_settled(p_request_id uuid)
  returns timestamptz
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_req       public.requests%rowtype;
  v_settings  jsonb;
  v_deadline  timestamptz;
begin
  select r.* into v_req from public.requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_req.status <> 'SELECTED' then
    raise exception 'invalid_state';
  end if;
  v_settings := public.unlock_settings(v_req.region);
  v_deadline := greatest(
    least(now() + make_interval(hours => (v_settings ->> 'unlock_window_hours')::integer), v_req.scheduled_start_at),
    now() + make_interval(mins => (v_settings ->> 'min_window_minutes')::integer));

  -- R-1: the pick must still stand, its provider still approved (security review S09-2: the zero path never
  -- passes accept_commission); no row changed means it does not.
  update public.applications a
     set status = 'AWAITING_FEE', status_changed_at = now()
   where a.id = v_req.selected_application_id and a.request_id = v_req.id and a.status = 'SELECTED'
     and public.provider_standing(a.provider_id) is not distinct from 'approved';
  if not found then
    raise exception 'invalid_state';
  end if;

  update public.requests
     set status = 'COMMISSION_PAID', fee_deadline = v_deadline
   where id = v_req.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values ((select auth.uid()), 'request.commission_paid', 'requests', v_req.id::text, v_req.region,
          jsonb_build_object('status', 'SELECTED'),
          jsonb_build_object('status', 'COMMISSION_PAID', 'application_id', v_req.selected_application_id,
                             'fee_deadline', v_deadline));
  return v_deadline;
end;
$$;

revoke all on function public.commission_settled(uuid) from public, anon, authenticated, service_role;

-- AC-5, R-1, A-1: a verified commission payment is accepted only for a pending commission with no refund,
-- on a SELECTED request whose pick still stands (the application SELECTED, its provider approved), from an
-- attempt of this fee started by the payment deadline, before the job’s start, and no later than the
-- deadline plus the checkout hold. Anything else is false, and 07’s late path refunds the payment. A missing
-- hold setting raises, so the relay retries and alerts instead of refunding a real payment.
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
  if v_req.status is distinct from 'SELECTED' or v_req.payment_deadline is null then
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
  if not found or v_started > v_req.payment_deadline then
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

create or replace function public.after_commission_paid(p_fee uuid)
  returns void
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_request  uuid;
begin
  select f.request_id into v_request from public.fee_payments f where f.id = p_fee and f.kind = 'commission';
  if not found then
    raise exception 'not_found';
  end if;
  perform public.commission_settled(v_request);
end;
$$;

revoke all on function public.after_commission_paid(uuid) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Cancel, replaced again (AC-2, A-5, R-6). 06’s function, plus: in SELECTED it refuses checkout_open while
--    the commission fee has a queued or ready attempt younger than the checkout hold, so a card page in use
--    is not cut off. With the hold setting missing, any queued or ready attempt counts as young, and the
--    refusal carries the hint checkout_settings_invalid so the door alerts. COMMISSION_PAID stays
--    not_cancellable until 12.
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
  v_req   record;
  v_fee   uuid;
  v_hold  integer;
begin
  if p_reason is not null and p_reason not in ('plans_changed', 'found_elsewhere', 'price', 'other') then
    raise exception 'validation_failed';
  end if;
  select r.id, r.status, r.region, r.fixed_price into v_req
    from public.requests r
   where r.id = p_request_id and r.customer_id = v_uid
     for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_req.status = 'CANCELLED' then
    return jsonb_build_object('status', 'ok');
  end if;
  if v_req.status not in ('OPEN', 'SELECTED') then
    raise exception 'not_cancellable';
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

  update public.requests
     set status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'customer', cancel_reason = p_reason
   where id = p_request_id;

  update public.applications a
     set status = 'CANCELLED', status_changed_at = now()
   where a.request_id = p_request_id and a.status in ('APPLIED', 'SELECTED');

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.cancelled', 'requests', p_request_id::text, v_req.region,
          jsonb_build_object('status', v_req.status),
          jsonb_build_object('status', 'CANCELLED', 'fixed_price', v_req.fixed_price));

  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.cancel_request(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_request(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Pay (AC-4, R-5, R-10, R-11). The customer’s one write, in the spec’s order. Two presses at once: the
--    second waits on the request lock and gets the first’s attempt at step 9.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.pay_commission(p_request_id uuid, p_locale text, p_payer_ip text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_ip        inet;
  v_req       public.requests%rowtype;
  v_settings  jsonb;
  v_hold      integer;
  v_limit     integer;
  v_fee       uuid;
  v_attempt   uuid;
  v_count     integer;
begin
  -- 1. Inputs. The IP is what the caller says (N-1): one full length address, else null, never an error.
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

  -- 2. The request, locked, owned by the caller.
  select r.* into v_req from public.requests r
   where r.id = p_request_id and r.customer_id = v_uid
     for update;
  if not found then
    raise exception 'not_found';
  end if;

  -- 3. Already paid (R-5: in SELECTED only as a defence), or not SELECTED.
  if v_req.status in ('COMMISSION_PAID', 'UNLOCKED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED')
     or exists (select 1 from public.fee_payments f
                 where f.request_id = v_req.id and f.kind = 'commission' and f.status = 'paid') then
    raise exception 'already_paid';
  end if;
  if v_req.status <> 'SELECTED' then
    raise exception 'invalid_state';
  end if;

  -- 4. The payment window.
  if now() >= v_req.payment_deadline then
    raise exception 'deadline_passed';
  end if;

  -- 5. A commission of 0 (D171, A-2): settled at once, no fee row, no attempt, no switch or settings check.
  if v_req.commission_amount = 0 then
    perform public.commission_settled(v_req.id);
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

  -- 8. The commission fee, then its row locked.
  v_fee := public.open_fee(v_req.id, 'commission');
  perform 1 from public.fee_payments f where f.id = v_fee for update;

  -- 9. A young open attempt is returned as it is, nothing counted (R-11: a stuck queued one too).
  select a.id into v_attempt from public.checkout_attempts a
   where a.fee_payment_id = v_fee
     and a.status in ('queued', 'ready')
     and a.started_at > now() - make_interval(mins => v_hold)
   order by a.started_at desc, a.id
   limit 1;
  -- No audit row on a reuse (security review S09-3): nothing changed, and an uncounted call must not grow
  -- audit_log.
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

revoke all on function public.pay_commission(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pay_commission(uuid, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. The payer’s reads (AC-7, AC-13, R-3, R-13, A-4, A-6). Only the fee’s payer; anyone else, and an id
--     that does not exist, gets the same not_found. Never the token, the IP or a PSP payment id.
--     checkout_attempts keeps no API grant. 10 reuses both for the provider fee.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.my_checkout(p_attempt_id uuid)
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
           -- R-3, narrowed by security review S09-1: a late refund of a payment made on this attempt, never
           -- another attempt's or another fee's. A late refund has no fee id (07); apply_fee_paid records the
           -- attempt in its late_received journal, keyed by the PSP payment id the refund carries.
           'late_refund', exists (select 1 from public.fee_refunds x
                                   join public.ledger_journals j
                                     on j.idempotency_key = 'late:' || x.psp_payment_id || ':received'
                                  where x.request_id = f.request_id and x.kind = 'late'
                                    and j.response ->> 'attempt_id' = a.id::text))
    into v_out
    from public.checkout_attempts a
    join public.fee_payments f on f.id = a.fee_payment_id
   where a.id = p_attempt_id and f.payer_id = (select auth.uid());
  if v_out is null then
    raise exception 'not_found';
  end if;
  return v_out;
end;
$$;

revoke all on function public.my_checkout(uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_checkout(uuid) to authenticated;

-- The receipt number is our fee id (A-6), so the argument is that id (named for the receipt, not for money:
-- supabase/tests/10 refuses an argument named for money). A pending fee has no receipt. The service name comes back in all its
-- locales; the page picks its own.
create function public.my_receipt(p_receipt_id uuid)
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
           'receipt_number', f.id,
           'kind', f.kind,
           'amount', f.amount,
           'currency', f.currency,
           'status', f.status,
           'paid_at', f.paid_at,
           'timezone', g.timezone,
           'request_id', r.id,
           'service_name', s.name,
           'scheduled_start_at', r.scheduled_start_at)
    into v_out
    from public.fee_payments f
    join public.requests r on r.id = f.request_id
    join public.services s on s.id = r.service_id
    join public.regions g on g.code = f.region
   where f.id = p_receipt_id and f.payer_id = (select auth.uid()) and f.status in ('paid', 'refunded');
  if v_out is null then
    raise exception 'not_found';
  end if;
  return v_out;
end;
$$;

revoke all on function public.my_receipt(uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_receipt(uuid) to authenticated;
