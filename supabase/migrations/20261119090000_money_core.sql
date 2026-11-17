-- Position 07 (spec 0011-07, amended by D169 with rules R-1 to R-12): the money core, database only.
--
-- No screen and no PSP call. This migration builds the fee settings and the one fee formula, raises the
-- commission to a floor, freezes the provider fee on the chosen application, and adds the money tables:
-- a row per fee, a row per card page opening, the refunds, an append only ledger of balanced journals,
-- the outbox the relay (08) reads, and every fact the PSP sends. Every money function is idempotent,
-- atomic and balanced; only the relay (service role) applies a PSP fact. It also deletes 00b's dead
-- escrow flags (D95).
--
-- Lock order (D169), in every function: the requests row, then its applications, then fee_payments, then
-- fee_refunds. A function that starts from a fee or a refund reads its request id without a lock, locks
-- the request row first, then reads again under the lock.
--
-- Order below: dead flags -> fee settings -> the fee formula -> the commission floor -> the frozen fee on
-- applications -> choose_provider -> the money tables, RLS, grants -> guards and the ledger triggers ->
-- internal functions -> the relay's functions -> the books check. Every function revokes PUBLIC and pins
-- search_path (supabase/tests/02). Refusals are stable codes in the exception message.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The dead 00b flags (AC-15, D95, R-11). No escrow, hold, release or payout exists any more.
--    hold_hours keeps its value as confirm_window_hours, which 11 reads.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.platform_settings (region, key, value)
select s.region, 'confirm_window_hours', s.value
  from public.platform_settings s
 where s.key = 'hold_hours'
on conflict (region, key) do nothing;

delete from public.platform_settings
 where key in ('funding_enabled', 'unlock_enabled', 'payouts_enabled', 'auto_release_enabled',
               'late_cancel_cutoff_hours', 'hold_hours');

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The fee settings (AC-1, R-2). Each key's own shape is a row check; the checks across keys (a percent
--    at most 100, a floor and a fixed fee in whole units) are held at commit by a deferred trigger, in
--    both directions, so a unit changed later is refused too. A missing or malformed key refuses at use
--    with fee_settings_invalid, never a default. Edited by SQL until 16. Seeds unconfirmed until S17.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_provider_fee_kind_valid check (
    case when key <> 'provider_fee_kind' then true
         when jsonb_typeof(value) <> 'string' then false
         else value #>> '{}' in ('percent', 'fixed') end),
  add constraint platform_settings_provider_fee_value_valid check (
    case when key <> 'provider_fee_value' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 0 and 100000000 end),
  add constraint platform_settings_fee_min_minor_valid check (
    case when key <> 'fee_min_minor' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 0 and 100000000 end);

create function public.fee_settings_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_kind   jsonb;
  v_value  jsonb;
  v_min    jsonb;
  v_unit   jsonb;
  v_u      numeric;
begin
  select s.value into v_kind from public.platform_settings s where s.region = new.region and s.key = 'provider_fee_kind';
  select s.value into v_value from public.platform_settings s where s.region = new.region and s.key = 'provider_fee_value';
  select s.value into v_min from public.platform_settings s where s.region = new.region and s.key = 'fee_min_minor';
  select s.value into v_unit from public.platform_settings s where s.region = new.region and s.key = 'price_rounding_minor';
  -- The row checks already hold each value's own shape; a missing key is refused by its readers.
  if v_kind #>> '{}' = 'percent' and jsonb_typeof(v_value) = 'number' and (v_value #>> '{}')::numeric > 100 then
    raise exception 'fee_settings_invalid';
  end if;
  if jsonb_typeof(v_unit) is distinct from 'number' or (v_unit #>> '{}')::numeric < 1 then
    return null;
  end if;
  v_u := (v_unit #>> '{}')::numeric;
  if (jsonb_typeof(v_min) = 'number' and (v_min #>> '{}')::numeric % v_u <> 0)
     or (v_kind #>> '{}' = 'fixed' and jsonb_typeof(v_value) = 'number' and (v_value #>> '{}')::numeric % v_u <> 0) then
    raise exception 'fee_settings_invalid';
  end if;
  return null;
end;
$$;

revoke all on function public.fee_settings_guard() from public, anon, authenticated, service_role;

create constraint trigger fee_settings_guard
  after insert or update on public.platform_settings
  deferrable initially deferred
  for each row
  when (new.key in ('provider_fee_kind', 'provider_fee_value', 'fee_min_minor', 'price_rounding_minor'))
  execute function public.fee_settings_guard();

-- 03's guard, widened to the three fee keys: no delete, no rename, no region move, for any role.
create or replace function public.pricing_settings_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if old.key in ('price_rounding_minor', 'max_price_multiple', 'provider_fee_kind', 'provider_fee_value', 'fee_min_minor')
     and (tg_op = 'DELETE' or new.key is distinct from old.key or new.region is distinct from old.region) then
    raise exception 'pricing_setting_required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.pricing_settings_guard() from public, anon, authenticated, service_role;

insert into public.platform_settings (region, key, value) values
  ('TR',  'provider_fee_kind',  '"percent"'),
  ('KSA', 'provider_fee_kind',  '"percent"'),
  ('TR',  'provider_fee_value', '5'),
  ('KSA', 'provider_fee_value', '5'),
  ('TR',  'fee_min_minor',      '1000'),
  ('KSA', 'fee_min_minor',      '1000')
on conflict (region, key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The one fee formula (AC-2, R-1, R-12). fee_settings reads the three keys against one rounding unit:
--    the caller's, so a unit is read once per computation, or the region's. fee_amount is the pure core,
--    in integer arithmetic only: a percent rounds half up to the unit in one step, a fixed fee is its
--    value; then raised to the floor and capped at the price rounded down to the unit. provider_fee_for is
--    the one entry for a figure shown or frozen anywhere (R-12).
-- ═══════════════════════════════════════════════════════════════════════════

create function public.fee_settings(p_region text, p_unit bigint default null)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_kind   jsonb;
  v_value  jsonb;
  v_min    jsonb;
  v_unit   jsonb;
  v_u      numeric := p_unit;
  v_v      numeric;
  v_m      numeric;
begin
  if v_u is null then
    select s.value into v_unit from public.platform_settings s where s.region = p_region and s.key = 'price_rounding_minor';
    if jsonb_typeof(v_unit) is distinct from 'number' then
      raise exception 'fee_settings_invalid';
    end if;
    v_u := (v_unit #>> '{}')::numeric;
  end if;
  select s.value into v_kind from public.platform_settings s where s.region = p_region and s.key = 'provider_fee_kind';
  select s.value into v_value from public.platform_settings s where s.region = p_region and s.key = 'provider_fee_value';
  select s.value into v_min from public.platform_settings s where s.region = p_region and s.key = 'fee_min_minor';
  if v_u <> trunc(v_u) or v_u not between 1 and 100000
     or jsonb_typeof(v_kind) is distinct from 'string' or coalesce(v_kind #>> '{}', '') not in ('percent', 'fixed')
     or jsonb_typeof(v_value) is distinct from 'number' or jsonb_typeof(v_min) is distinct from 'number' then
    raise exception 'fee_settings_invalid';
  end if;
  v_v := (v_value #>> '{}')::numeric;
  v_m := (v_min #>> '{}')::numeric;
  if v_v <> trunc(v_v) or v_m <> trunc(v_m) or v_m not between 0 and 100000000
     or v_v not between 0 and (case when v_kind #>> '{}' = 'percent' then 100 else 100000000 end)
     or v_m % v_u <> 0
     or (v_kind #>> '{}' = 'fixed' and v_v % v_u <> 0) then
    raise exception 'fee_settings_invalid';
  end if;
  return jsonb_build_object('kind', v_kind #>> '{}', 'value', v_v::bigint, 'min', v_m::bigint, 'unit', v_u::bigint);
end;
$$;

revoke all on function public.fee_settings(text, bigint) from public, anon, authenticated, service_role;

create function public.fee_amount(p_price bigint, p_settings jsonb)
  returns bigint
  language plpgsql
  immutable
  security invoker
  set search_path = ''
as $$
declare
  v_unit   bigint := (p_settings ->> 'unit')::bigint;
  v_value  bigint := (p_settings ->> 'value')::bigint;
  v_min    bigint := (p_settings ->> 'min')::bigint;
  v_fee    bigint;
begin
  if p_price is null or p_price < 1 or p_price > 1000000000000000 then
    raise exception 'price_out_of_range';
  end if;
  if p_settings ->> 'kind' = 'percent' then
    -- price x percent / 100, half up to the unit, in one integer step.
    v_fee := (p_price * v_value + 50 * v_unit) / (100 * v_unit) * v_unit;
  else
    v_fee := v_value;
  end if;
  return least(greatest(v_fee, v_min), p_price - p_price % v_unit);
end;
$$;

revoke all on function public.fee_amount(bigint, jsonb) from public, anon, authenticated, service_role;

-- Definer so a signed in user reads a figure without reading the formula; it reveals only a setting.
create function public.provider_fee_for(p_region text, p_price bigint)
  returns bigint
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  return public.fee_amount(p_price, public.fee_settings(p_region));
end;
$$;

revoke all on function public.provider_fee_for(text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.provider_fee_for(text, bigint) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The commission floor (AC-3, R-1). 04's split, with the unit read once: the commission rounds half up
--    to the unit, is raised to fee_min_minor and capped at the price rounded down to the unit, so the cash
--    due is whole units and may be 0. Requests stored before keep their figures (requests_guard).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.pricing_split(p_region text, p_price bigint)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_percent     jsonb;
  v_unit        jsonb;
  v_p           numeric;
  v_u           numeric;
  v_fees        jsonb;
  v_commission  bigint;
begin
  select s.value into v_percent from public.platform_settings s
   where s.region = p_region and s.key = 'commission_percent';
  select s.value into v_unit from public.platform_settings s
   where s.region = p_region and s.key = 'price_rounding_minor';
  if jsonb_typeof(v_percent) is distinct from 'number' or jsonb_typeof(v_unit) is distinct from 'number' then
    raise exception 'pricing_settings_invalid';
  end if;
  v_p := (v_percent #>> '{}')::numeric;
  v_u := (v_unit #>> '{}')::numeric;
  if v_p <= 0 or v_p >= 100 or v_p <> round(v_p, 2)
     or v_u <> trunc(v_u) or v_u not between 1 and 100000 then
    raise exception 'pricing_settings_invalid';
  end if;
  if p_price is null or p_price < 1 then
    raise exception 'price_out_of_range';
  end if;
  v_fees := public.fee_settings(p_region, v_u::bigint);
  v_commission := (round(p_price::numeric * v_p / 100 / v_u) * v_u)::bigint;
  v_commission := least(greatest(v_commission, (v_fees ->> 'min')::bigint), p_price - p_price % v_u::bigint);
  return jsonb_build_object('commission_percent', trim_scale(v_p)::text,
                            'commission', v_commission,
                            'cash_due', p_price - v_commission);
end;
$$;

revoke all on function public.pricing_split(text, bigint) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The provider fee frozen on the pick (AC-0, R-4, D169). Null together; written only on the move
--    APPLIED -> SELECTED while still null, never changed after, for every role. Local SELECTED rows are back
--    filled before the guard is widened; the cloud has none.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.applications
  add column provider_fee_amount bigint,
  add column provider_fee_kind text,
  add constraint applications_provider_fee_amount_range check (provider_fee_amount is null or provider_fee_amount >= 0),
  add constraint applications_provider_fee_kind_valid check (provider_fee_kind is null or provider_fee_kind in ('percent', 'fixed')),
  add constraint applications_provider_fee_together check ((provider_fee_amount is null) = (provider_fee_kind is null));

update public.applications a
   set provider_fee_amount = public.fee_amount(r.fixed_price, public.fee_settings(a.region)),
       provider_fee_kind = public.fee_settings(a.region) ->> 'kind'
  from public.requests r
 where r.id = a.request_id
   and a.status = 'SELECTED'
   and a.provider_fee_amount is null;

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
  if new.status is distinct from old.status
     and old.status in ('NOT_SELECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED', 'CONFIRMED', 'RATED') then
    raise exception 'application_final';
  end if;
  return new;
end;
$$;

revoke all on function public.applications_guard() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Choose, replaced (AC-0, R-4). 06's function in 06's order, plus: the fee settings read at step 4
--    beside the window (so a bad setting refuses before any application lock), the fee computed from the
--    stored price after the standing check, and both columns set in the statement that marks the chosen
--    row SELECTED. The replay at step 2 is unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.choose_provider(p_request_id uuid, p_application_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_req       public.requests%rowtype;
  v_window    integer;
  v_fees      jsonb;
  v_fee       bigint;
  v_provider  uuid;
  v_app_req   uuid;
  v_status    text;
  v_deadline  timestamptz;
  v_now       timestamptz := now();
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

  -- 3. Open, and before its start.
  if v_req.status <> 'OPEN' or v_req.scheduled_start_at <= v_now then
    raise exception 'not_choosable';
  end if;

  -- 4. The payment window and the fee settings of the request's region.
  v_window := public.choose_settings(v_req.region);
  v_fees := public.fee_settings(v_req.region);

  -- 5. The application without a lock (every change to this request's applications takes the request lock
  --    first, and provider_id never changes), then its provider shared, then the applications.
  select a.provider_id, a.request_id into v_provider, v_app_req
    from public.applications a
   where a.id = p_application_id;
  if not found or v_app_req is distinct from v_req.id then
    raise exception 'offer_unavailable';
  end if;
  perform 1 from public.providers pr where pr.id = v_provider for share;
  perform 1 from public.applications a where a.request_id = v_req.id for update;

  -- 6. Still APPLIED, from a provider approved now.
  select a.status into v_status from public.applications a where a.id = p_application_id;
  if v_status is distinct from 'APPLIED'
     or public.provider_standing(v_provider) is distinct from 'approved' then
    raise exception 'offer_unavailable';
  end if;

  -- 6b. The provider fee, frozen now from the stored price (AC-0, R-12).
  v_fee := public.fee_amount(v_req.fixed_price, v_fees);

  -- 7. The chosen one SELECTED with its fee, every other APPLIED one NOT_SELECTED.
  update public.applications a
     set status = case when a.id = p_application_id then 'SELECTED' else 'NOT_SELECTED' end,
         status_changed_at = v_now,
         provider_fee_amount = case when a.id = p_application_id then v_fee end,
         provider_fee_kind = case when a.id = p_application_id then v_fees ->> 'kind' end
   where a.request_id = v_req.id and a.status = 'APPLIED';

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
end;
$$;

revoke all on function public.choose_provider(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.choose_provider(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The money tables (AC-4 to AC-11, R-7, R-8). Every one has a region, names its parents with the region
--    in the key, and restricts every reference: nothing here is ever deleted by a cascade. Money is integer
--    minor units (rule 4). The provider fee names the pick by application_id (D169).
-- ═══════════════════════════════════════════════════════════════════════════

-- One row per fee. The commission is carried across picks (no application); the provider fee belongs to
-- the chosen provider of one application. Amount, kind, payer, application and request never change.
create table public.fee_payments (
  id               uuid primary key default gen_random_uuid(),
  region           text        not null references public.regions (code) on delete restrict,
  request_id       uuid        not null,
  kind             text        not null,
  payer_id         uuid        not null references public.profiles (id) on delete restrict,
  provider_id      uuid,
  application_id   uuid,
  amount           bigint      not null,
  currency         text        not null,
  status           text        not null default 'pending',
  psp_payment_id   text,
  psp_fee_amount   bigint,
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),

  constraint fee_payments_id_region unique (id, region),
  constraint fee_payments_psp_payment_unique unique (psp_payment_id),
  constraint fee_payments_request_fk foreign key (request_id, region)
    references public.requests (id, region) on delete restrict,
  constraint fee_payments_application_fk foreign key (application_id, request_id)
    references public.applications (id, request_id) on delete restrict,
  constraint fee_payments_provider_fk foreign key (provider_id, region)
    references public.providers (id, region) on delete restrict,
  constraint fee_payments_kind_valid check (kind in ('commission', 'provider_fee')),
  constraint fee_payments_status_valid check (status in ('pending', 'paid', 'refunded')),
  constraint fee_payments_currency_valid check (currency in ('TRY', 'SAR')),
  constraint fee_payments_amount_range check (amount >= 0),
  constraint fee_payments_pick check (
    case kind when 'commission' then application_id is null and provider_id is null
              else application_id is not null and provider_id is not null and provider_id = payer_id end),
  constraint fee_payments_paid_fields check (
    (status = 'pending') = (psp_payment_id is null)
    and (status = 'pending') = (paid_at is null)
    and (status = 'pending') = (psp_fee_amount is null)),
  constraint fee_payments_psp_fee_range check (psp_fee_amount is null or psp_fee_amount between 0 and amount),
  constraint fee_payments_psp_payment_length check (psp_payment_id is null or char_length(psp_payment_id) between 1 and 200)
);

create unique index fee_payments_one_commission_idx on public.fee_payments (request_id) where kind = 'commission';
create unique index fee_payments_one_provider_fee_idx on public.fee_payments (request_id, provider_id) where kind = 'provider_fee';

-- One row per card page opening. 08 fills the token and the URL; 09 and 10 the locale.
create table public.checkout_attempts (
  id               uuid primary key default gen_random_uuid(),
  region           text        not null references public.regions (code) on delete restrict,
  fee_payment_id   uuid        not null,
  status           text        not null default 'queued',
  locale           text,
  psp_token        text,
  url              text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),

  constraint checkout_attempts_fee_fk foreign key (fee_payment_id, region)
    references public.fee_payments (id, region) on delete restrict,
  constraint checkout_attempts_status_valid check (status in ('queued', 'ready', 'succeeded', 'failed', 'abandoned')),
  constraint checkout_attempts_locale_valid check (locale is null or locale in ('ar', 'tr', 'en')),
  constraint checkout_attempts_finished check ((status in ('succeeded', 'failed', 'abandoned')) = (finished_at is not null)),
  constraint checkout_attempts_token_length check (psp_token is null or char_length(psp_token) between 1 and 500),
  constraint checkout_attempts_url_length check (url is null or char_length(url) between 1 and 2000)
);

-- A refund of a fee, or of a payment that never became a fee's payment (late or duplicate). One per fee
-- and one per PSP payment. 12 adds the reasons and the admin paths.
create table public.fee_refunds (
  id               uuid primary key default gen_random_uuid(),
  region           text        not null references public.regions (code) on delete restrict,
  request_id       uuid        not null,
  kind             text        not null,
  fee_payment_id   uuid,
  psp_payment_id   text        not null,
  amount           bigint      not null,
  currency         text        not null,
  reason           text,
  requested_by     uuid        references public.profiles (id) on delete restrict,
  status           text        not null default 'queued',
  psp_refund_id    text,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),

  constraint fee_refunds_psp_payment_unique unique (psp_payment_id),
  constraint fee_refunds_psp_refund_unique unique (psp_refund_id),
  constraint fee_refunds_request_fk foreign key (request_id, region)
    references public.requests (id, region) on delete restrict,
  constraint fee_refunds_fee_fk foreign key (fee_payment_id, region)
    references public.fee_payments (id, region) on delete restrict,
  constraint fee_refunds_kind_valid check (kind in ('fee', 'late')),
  constraint fee_refunds_kind_fee check ((kind = 'fee') = (fee_payment_id is not null)),
  constraint fee_refunds_status_valid check (status in ('queued', 'done', 'failed', 'done_by_hand')),
  constraint fee_refunds_amount_positive check (amount > 0),
  constraint fee_refunds_currency_valid check (currency in ('TRY', 'SAR')),
  constraint fee_refunds_reason_valid check (reason is null or reason ~ '^[a-z_]{1,40}$'),
  constraint fee_refunds_psp_refund_set check ((status = 'done') = (psp_refund_id is not null)),
  constraint fee_refunds_finished check ((status in ('done', 'done_by_hand')) = (finished_at is not null)),
  constraint fee_refunds_psp_payment_length check (char_length(psp_payment_id) between 1 and 200),
  constraint fee_refunds_psp_refund_length check (psp_refund_id is null or char_length(psp_refund_id) between 1 and 200)
);

create unique index fee_refunds_one_per_fee_idx on public.fee_refunds (fee_payment_id) where fee_payment_id is not null;

-- A balanced journal per money fact, keyed by a domain id (rule 6). legs keeps the normalised legs it
-- was posted with, to tell a replay from a conflict; response is what the posting function returned.
create table public.ledger_journals (
  id                uuid primary key default gen_random_uuid(),
  region            text        not null references public.regions (code) on delete restrict,
  kind              text        not null,
  currency          text        not null,
  idempotency_key   text        not null,
  fee_payment_id    uuid,
  legs              jsonb       not null,
  response          jsonb       not null,
  created_at        timestamptz not null default now(),

  constraint ledger_journals_key_unique unique (idempotency_key),
  constraint ledger_journals_id_region_currency unique (id, region, currency),
  constraint ledger_journals_fee_fk foreign key (fee_payment_id, region)
    references public.fee_payments (id, region) on delete restrict,
  constraint ledger_journals_kind_valid check (kind in ('fee_paid', 'fee_refund', 'late_received', 'late_refund')),
  constraint ledger_journals_fee_set check ((kind in ('fee_paid', 'fee_refund')) = (fee_payment_id is not null)),
  constraint ledger_journals_currency_valid check (currency in ('TRY', 'SAR')),
  constraint ledger_journals_key_length check (char_length(idempotency_key) between 1 and 300)
);

-- The legs. Debit positive, credit negative; one region and one currency per journal (R-8), through the key.
create table public.ledger_entries (
  id          bigint generated always as identity primary key,
  journal_id  uuid        not null,
  region      text        not null references public.regions (code) on delete restrict,
  currency    text        not null,
  account     text        not null,
  amount      bigint      not null,
  created_at  timestamptz not null default now(),

  constraint ledger_entries_journal_fk foreign key (journal_id, region, currency)
    references public.ledger_journals (id, region, currency) on delete restrict,
  constraint ledger_entries_account_valid check (account in (
    'psp_clearing', 'commission_revenue', 'provider_fee_revenue', 'commission_refunds', 'provider_fee_refunds',
    'psp_fees', 'refunds_due')),
  constraint ledger_entries_amount_nonzero check (amount <> 0)
);

-- Side effects the relay carries out (08). No external call ever happens in a request path (rule 3).
create table public.outbox_events (
  id                uuid primary key default gen_random_uuid(),
  region            text        not null references public.regions (code) on delete restrict,
  kind              text        not null,
  idempotency_key   text        not null,
  payload           jsonb       not null,
  status            text        not null default 'pending',
  attempts          integer     not null default 0,
  next_attempt_at   timestamptz default now(),
  claimed_at        timestamptz,
  claimed_by        text,
  last_error        text,
  done_at           timestamptz,
  created_at        timestamptz not null default now(),

  constraint outbox_events_key_unique unique (idempotency_key),
  constraint outbox_events_kind_valid check (kind in ('checkout.initialize', 'payment.verify', 'refund.request', 'email.send')),
  constraint outbox_events_status_valid check (status in ('pending', 'claimed', 'done', 'failed')),
  constraint outbox_events_attempts_range check (attempts between 0 and 6),
  constraint outbox_events_payload_object check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536),
  constraint outbox_events_key_length check (char_length(idempotency_key) between 1 and 300),
  constraint outbox_events_worker_length check (claimed_by is null or char_length(claimed_by) between 1 and 100),
  constraint outbox_events_error_length check (last_error is null or char_length(last_error) <= 1000)
);

-- Every fact the PSP sends, once per (source, event key), card fields stripped (R-9).
create table public.psp_events (
  id           uuid primary key default gen_random_uuid(),
  region       text        not null references public.regions (code) on delete restrict,
  source       text        not null,
  event_key    text        not null,
  payload      jsonb       not null,
  received_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),

  constraint psp_events_source_key_unique unique (source, event_key),
  constraint psp_events_source_valid check (source in ('callback', 'webhook', 'retrieve', 'reconcile')),
  constraint psp_events_key_length check (char_length(event_key) between 1 and 200),
  constraint psp_events_payload_size check (octet_length(payload::text) <= 65536)
);

-- RLS (rule 7, AC-13). A payer reads their own fee rows, through column grants that leave out the PSP fee
-- and the PSP payment id (R-9). Nothing else is readable through the API: the deny policies below say so
-- out loud, and no API role holds a grant on those tables. Admin reads the books through ledger_check only.
alter table public.fee_payments enable row level security;
alter table public.checkout_attempts enable row level security;
alter table public.fee_refunds enable row level security;
alter table public.ledger_journals enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.outbox_events enable row level security;
alter table public.psp_events enable row level security;

create policy fee_payments_read_payer on public.fee_payments for select to authenticated
  using (payer_id = (select auth.uid()));
create policy checkout_attempts_no_api on public.checkout_attempts for select to authenticated using (false);
create policy fee_refunds_no_api on public.fee_refunds for select to authenticated using (false);
create policy ledger_journals_no_api on public.ledger_journals for select to authenticated using (false);
create policy ledger_entries_no_api on public.ledger_entries for select to authenticated using (false);
create policy outbox_events_no_api on public.outbox_events for select to authenticated using (false);
create policy psp_events_no_api on public.psp_events for select to authenticated using (false);

revoke all on table public.fee_payments, public.checkout_attempts, public.fee_refunds, public.ledger_journals,
  public.ledger_entries, public.outbox_events, public.psp_events
  from anon, authenticated, service_role;
grant select (id, region, request_id, kind, payer_id, application_id, amount, currency, status, paid_at, created_at)
  on table public.fee_payments to authenticated;

-- Every foreign key has a covering index, and region has one on each table.
create index fee_payments_request_idx on public.fee_payments (request_id, region);
create index fee_payments_application_idx on public.fee_payments (application_id, request_id);
create index fee_payments_payer_idx on public.fee_payments (payer_id);
create index fee_payments_provider_idx on public.fee_payments (provider_id, region);
create index fee_payments_region_idx on public.fee_payments (region);
create index checkout_attempts_fee_idx on public.checkout_attempts (fee_payment_id, region);
create index checkout_attempts_region_idx on public.checkout_attempts (region);
create index fee_refunds_request_idx on public.fee_refunds (request_id, region);
create index fee_refunds_fee_idx on public.fee_refunds (fee_payment_id, region);
create index fee_refunds_requested_by_idx on public.fee_refunds (requested_by);
create index fee_refunds_region_idx on public.fee_refunds (region);
create index ledger_journals_fee_idx on public.ledger_journals (fee_payment_id, region);
create index ledger_journals_region_idx on public.ledger_journals (region);
create index ledger_entries_journal_idx on public.ledger_entries (journal_id, region, currency);
create index ledger_entries_region_account_idx on public.ledger_entries (region, currency, account);
create index outbox_events_region_idx on public.outbox_events (region);
create index outbox_events_due_idx on public.outbox_events (next_attempt_at, id) where status = 'pending';
create index outbox_events_lease_idx on public.outbox_events (claimed_at) where status = 'claimed';
create index psp_events_region_idx on public.psp_events (region);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Guards and the ledger triggers (AC-6, R-7, rule 5). For every role, the SQL editor included.
-- ═══════════════════════════════════════════════════════════════════════════

-- The ledger is append only: no update, delete or truncate, ever. A correction is a new journal.
create function public.ledger_append_only()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  raise exception 'ledger_append_only';
end;
$$;

revoke all on function public.ledger_append_only() from public, anon, authenticated, service_role;

create trigger ledger_journals_append_only before update or delete on public.ledger_journals
  for each row execute function public.ledger_append_only();
create trigger ledger_journals_no_truncate before truncate on public.ledger_journals
  for each statement execute function public.ledger_append_only();
create trigger ledger_entries_append_only before update or delete on public.ledger_entries
  for each row execute function public.ledger_append_only();
create trigger ledger_entries_no_truncate before truncate on public.ledger_entries
  for each statement execute function public.ledger_append_only();

-- At commit, every journal touched has at least two entries and sums to zero. Definer: a deferred trigger
-- runs at commit as the session's role (the relay's service role), which reads no ledger table.
create function public.ledger_balanced()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_id   uuid := case tg_table_name when 'ledger_entries' then (to_jsonb(new) ->> 'journal_id')::uuid
                                    else (to_jsonb(new) ->> 'id')::uuid end;
  v_n    integer;
  v_sum  numeric;
begin
  select count(*), coalesce(sum(e.amount), 0) into v_n, v_sum
    from public.ledger_entries e
   where e.journal_id = v_id;
  if v_n < 2 or v_sum <> 0 then
    raise exception 'ledger_unbalanced';
  end if;
  return null;
end;
$$;

revoke all on function public.ledger_balanced() from public, anon, authenticated, service_role;

create constraint trigger ledger_journals_balanced after insert on public.ledger_journals
  deferrable initially deferred for each row execute function public.ledger_balanced();
create constraint trigger ledger_entries_balanced after insert on public.ledger_entries
  deferrable initially deferred for each row execute function public.ledger_balanced();

-- A fee row never changes what it charges, and moves only pending -> paid -> refunded; the paid fields are
-- written once, on pending -> paid. Never deleted or truncated.
create function public.fee_payments_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'fee_immutable';
  end if;
  if (to_jsonb(new) - array['status', 'psp_payment_id', 'psp_fee_amount', 'paid_at'])
     is distinct from (to_jsonb(old) - array['status', 'psp_payment_id', 'psp_fee_amount', 'paid_at']) then
    raise exception 'fee_immutable';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'pending' and new.status = 'paid') or (old.status = 'paid' and new.status = 'refunded')) then
    raise exception 'fee_immutable';
  end if;
  if (new.psp_payment_id, new.psp_fee_amount, new.paid_at) is distinct from (old.psp_payment_id, old.psp_fee_amount, old.paid_at)
     and not (old.status = 'pending' and new.status = 'paid') then
    raise exception 'fee_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.fee_payments_guard() from public, anon, authenticated, service_role;

create trigger fee_payments_guard before update or delete on public.fee_payments
  for each row execute function public.fee_payments_guard();
create trigger fee_payments_no_truncate before truncate on public.fee_payments
  for each statement execute function public.fee_payments_guard();

-- An attempt keeps its fee; a finished attempt never moves again. Never deleted or truncated.
create function public.checkout_attempts_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'attempt_immutable';
  end if;
  if new.id is distinct from old.id or new.region is distinct from old.region
     or new.fee_payment_id is distinct from old.fee_payment_id
     or new.started_at is distinct from old.started_at or new.created_at is distinct from old.created_at
     or (new.status is distinct from old.status and old.status in ('succeeded', 'failed', 'abandoned'))
     or (new.status = 'queued' and old.status <> 'queued') then
    raise exception 'attempt_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.checkout_attempts_guard() from public, anon, authenticated, service_role;

create trigger checkout_attempts_guard before update or delete on public.checkout_attempts
  for each row execute function public.checkout_attempts_guard();
create trigger checkout_attempts_no_truncate before truncate on public.checkout_attempts
  for each statement execute function public.checkout_attempts_guard();

-- A refund keeps what it refunds; done and done by hand are final; the PSP refund id is written once.
create function public.fee_refunds_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'fee_refund_immutable';
  end if;
  if (to_jsonb(new) - array['status', 'psp_refund_id', 'finished_at'])
     is distinct from (to_jsonb(old) - array['status', 'psp_refund_id', 'finished_at'])
     or (new.status is distinct from old.status and old.status in ('done', 'done_by_hand'))
     or (old.psp_refund_id is not null and new.psp_refund_id is distinct from old.psp_refund_id) then
    raise exception 'fee_refund_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.fee_refunds_guard() from public, anon, authenticated, service_role;

create trigger fee_refunds_guard before update or delete on public.fee_refunds
  for each row execute function public.fee_refunds_guard();
create trigger fee_refunds_no_truncate before truncate on public.fee_refunds
  for each statement execute function public.fee_refunds_guard();

-- An outbox row keeps its kind, key and payload; only its delivery state moves.
create function public.outbox_events_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.region is distinct from old.region or new.kind is distinct from old.kind
     or new.idempotency_key is distinct from old.idempotency_key or new.payload is distinct from old.payload
     or new.created_at is distinct from old.created_at then
    raise exception 'outbox_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.outbox_events_guard() from public, anon, authenticated, service_role;

create trigger outbox_events_guard before update on public.outbox_events
  for each row execute function public.outbox_events_guard();

-- A PSP event is a fact as received: never edited (21's retention job may delete).
create function public.psp_events_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  raise exception 'psp_event_immutable';
end;
$$;

revoke all on function public.psp_events_guard() from public, anon, authenticated, service_role;

create trigger psp_events_guard before update on public.psp_events
  for each row execute function public.psp_events_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Internal functions (no API grant). They run only inside definer functions: 09 and 10's pay
--    functions, and the relay's functions below.
-- ═══════════════════════════════════════════════════════════════════════════

-- AC-10: one row per key. The same key with the same content returns the row; other content is a conflict.
create function public.enqueue_outbox(p_kind text, p_key text, p_payload jsonb, p_region text)
  returns uuid
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_id   uuid;
  v_row  record;
begin
  if p_kind is null or p_kind not in ('checkout.initialize', 'payment.verify', 'refund.request', 'email.send')
     or p_key is null or char_length(p_key) not between 1 and 300
     or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 65536
     or p_region is null then
    raise exception 'validation_failed';
  end if;
  insert into public.outbox_events (region, kind, idempotency_key, payload)
  values (p_region, p_kind, p_key, p_payload)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    return v_id;
  end if;
  select o.id, o.kind, o.payload, o.region into v_row from public.outbox_events o where o.idempotency_key = p_key;
  if v_row.kind is distinct from p_kind or v_row.payload is distinct from p_payload or v_row.region is distinct from p_region then
    raise exception 'idempotency_conflict';
  end if;
  return v_row.id;
end;
$$;

revoke all on function public.enqueue_outbox(text, text, jsonb, text) from public, anon, authenticated, service_role;

-- AC-7, R-8: a journal and its legs, once per key. The legs are checked (chart accounts, whole non zero
-- amounts, sum zero) and normalised, so the same legs in another order replay. The same key with other
-- legs, kind, currency, region or fee is a conflict. Callers build the legs themselves; this function is
-- never given legs from outside the database.
create function public.post_journal(p_kind text, p_key text, p_currency text, p_region text, p_legs jsonb,
                                    p_fee_payment_id uuid, p_response jsonb)
  returns jsonb
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_id    uuid := gen_random_uuid();
  v_legs  jsonb;
  v_bad   boolean;
  v_sum   numeric;
  v_resp  jsonb;
  v_row   public.ledger_journals%rowtype;
begin
  if jsonb_typeof(p_legs) is distinct from 'array' or jsonb_array_length(p_legs) not between 2 and 10
     or p_key is null or jsonb_typeof(p_response) is distinct from 'object' then
    raise exception 'journal_invalid';
  end if;
  select bool_or(not coalesce(
           jsonb_typeof(l) = 'object'
           and jsonb_typeof(l -> 'account') = 'string'
           and l ->> 'account' in ('psp_clearing', 'commission_revenue', 'provider_fee_revenue', 'commission_refunds',
                                   'provider_fee_refunds', 'psp_fees', 'refunds_due')
           and case when jsonb_typeof(l -> 'amount') = 'number'
                    then (l ->> 'amount')::numeric = trunc((l ->> 'amount')::numeric)
                         and (l ->> 'amount')::numeric <> 0
                         and abs((l ->> 'amount')::numeric) <= 1000000000000000
                    else false end,
           false))
    into v_bad
    from jsonb_array_elements(p_legs) l;
  if v_bad then
    raise exception 'journal_invalid';
  end if;
  select sum((l ->> 'amount')::numeric) into v_sum from jsonb_array_elements(p_legs) l;
  if v_sum <> 0 then
    raise exception 'journal_invalid';
  end if;
  select jsonb_agg(jsonb_build_object('account', l ->> 'account', 'amount', (l ->> 'amount')::bigint)
                   order by l ->> 'account', (l ->> 'amount')::bigint)
    into v_legs
    from jsonb_array_elements(p_legs) l;

  -- The journal and its legs in one statement, so the balance check sees both even when it runs per
  -- statement.
  v_resp := p_response || jsonb_build_object('journal_id', v_id);
  with j as (
    insert into public.ledger_journals (id, region, kind, currency, idempotency_key, fee_payment_id, legs, response)
    values (v_id, p_region, p_kind, p_currency, p_key, p_fee_payment_id, v_legs, v_resp)
    on conflict (idempotency_key) do nothing
    returning id, region, currency)
  insert into public.ledger_entries (journal_id, region, currency, account, amount)
  select j.id, j.region, j.currency, l ->> 'account', (l ->> 'amount')::bigint
    from j, jsonb_array_elements(v_legs) l;
  if found then
    return v_resp;
  end if;

  select j.* into v_row from public.ledger_journals j where j.idempotency_key = p_key;
  if v_row.kind is distinct from p_kind or v_row.currency is distinct from p_currency
     or v_row.region is distinct from p_region or v_row.fee_payment_id is distinct from p_fee_payment_id
     or v_row.legs is distinct from v_legs then
    raise exception 'idempotency_conflict';
  end if;
  return v_row.response;
end;
$$;

revoke all on function public.post_journal(text, text, text, text, jsonb, uuid, jsonb) from public, anon, authenticated, service_role;

-- AC-4, R-7: the fee row for (request, kind, provider), or a new pending one. The commission needs a
-- SELECTED request and is the stored commission; the provider fee needs COMMISSION_PAID and is the fee
-- frozen on the selected application. The request's currency and region.
create function public.open_fee(p_request_id uuid, p_kind text)
  returns uuid
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_req  public.requests%rowtype;
  v_app  public.applications%rowtype;
  v_id   uuid;
begin
  if p_kind is null or p_kind not in ('commission', 'provider_fee') then
    raise exception 'validation_failed';
  end if;
  select r.* into v_req from public.requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'not_found';
  end if;

  if p_kind = 'commission' then
    select f.id into v_id from public.fee_payments f where f.request_id = v_req.id and f.kind = 'commission';
    if found then
      return v_id;
    end if;
    if v_req.status <> 'SELECTED' then
      raise exception 'invalid_state';
    end if;
    insert into public.fee_payments (region, request_id, kind, payer_id, amount, currency)
    values (v_req.region, v_req.id, 'commission', v_req.customer_id, v_req.commission_amount, v_req.currency)
    returning id into v_id;
    return v_id;
  end if;

  select a.* into v_app from public.applications a where a.id = v_req.selected_application_id;
  if not found then
    raise exception 'invalid_state';
  end if;
  select f.id into v_id from public.fee_payments f
   where f.request_id = v_req.id and f.kind = 'provider_fee' and f.provider_id = v_app.provider_id;
  if found then
    return v_id;
  end if;
  if v_req.status <> 'COMMISSION_PAID' or v_app.provider_fee_amount is null then
    raise exception 'invalid_state';
  end if;
  insert into public.fee_payments (region, request_id, kind, payer_id, provider_id, application_id, amount, currency)
  values (v_req.region, v_req.id, 'provider_fee', v_app.provider_id, v_app.provider_id, v_app.id,
          v_app.provider_fee_amount, v_req.currency)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.open_fee(uuid, text) from public, anon, authenticated, service_role;

-- AC-5: a queued attempt and its outbox row, in one transaction, for a pending fee.
create function public.start_checkout(p_fee_payment_id uuid)
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
  select f.request_id into v_request from public.fee_payments f where f.id = p_fee_payment_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform 1 from public.requests r where r.id = v_request for update;
  select f.* into v_fee from public.fee_payments f where f.id = p_fee_payment_id for update;
  if v_fee.status <> 'pending' then
    raise exception 'invalid_state';
  end if;
  insert into public.checkout_attempts (region, fee_payment_id) values (v_fee.region, v_fee.id) returning id into v_id;
  perform public.enqueue_outbox('checkout.initialize', 'checkout:' || v_id || ':init',
                                jsonb_build_object('attempt_id', v_id, 'fee_payment_id', v_fee.id), v_fee.region);
  return v_id;
end;
$$;

revoke all on function public.start_checkout(uuid) from public, anon, authenticated, service_role;

-- R-6: each kind's state check, asked before any change. 07 accepts nothing, so every payment goes the
-- late path until 09 (commission) and 10 (provider fee) replace these with their own rules.
create function public.accept_commission(p_fee uuid, p_attempt uuid)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select false
$$;

revoke all on function public.accept_commission(uuid, uuid) from public, anon, authenticated, service_role;

create function public.accept_provider_fee(p_fee uuid, p_attempt uuid)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select false
$$;

revoke all on function public.accept_provider_fee(uuid, uuid) from public, anon, authenticated, service_role;

-- AC-8: each kind's transition after a fee is paid. 09 (COMMISSION_PAID) and 10 (UNLOCKED) replace these.
create function public.after_commission_paid(p_fee uuid)
  returns void
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
begin
  null;
end;
$$;

revoke all on function public.after_commission_paid(uuid) from public, anon, authenticated, service_role;

create function public.after_provider_fee_paid(p_fee uuid)
  returns void
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
begin
  null;
end;
$$;

revoke all on function public.after_provider_fee_paid(uuid) from public, anon, authenticated, service_role;

-- R-9: drop every card field at any depth: any key containing "card" in any case, and the named iyzico
-- fields. The hosted page never sends us one; this is the second line.
create function public.psp_payload_strip(p_payload jsonb)
  returns jsonb
  language plpgsql
  immutable
  security invoker
  set search_path = ''
as $$
begin
  if jsonb_typeof(p_payload) = 'object' then
    return coalesce(
      (select jsonb_object_agg(e.key, public.psp_payload_strip(e.value))
         from jsonb_each(p_payload) e
        where position('card' in lower(e.key)) = 0
          and lower(e.key) not in ('cvc', 'cvv', 'expiremonth', 'expireyear', 'binnumber', 'lastfourdigits')),
      '{}'::jsonb);
  elsif jsonb_typeof(p_payload) = 'array' then
    return coalesce(
      (select jsonb_agg(public.psp_payload_strip(x.v) order by x.i)
         from jsonb_array_elements(p_payload) with ordinality as x(v, i)),
      '[]'::jsonb);
  end if;
  return p_payload;
end;
$$;

revoke all on function public.psp_payload_strip(jsonb) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. The relay's functions (service role only). They return results, never send: alerts come back in
--     an `alerts` array and the relay (08) raises each (R-3). One audit_log row each, ids only.
-- ═══════════════════════════════════════════════════════════════════════════

-- AC-8, R-5, R-8: apply a verified paid fact. Accepted (the kind's check, a pending fee, the fee's amount
-- and currency): the fee paid, the attempt succeeded, the paid journal, the kind's transition. Anything
-- else: the fee untouched, the money booked to refunds_due, a late refund and its outbox row. A PSP payment
-- already applied returns the stored result.
create function public.apply_fee_paid(p_fee_payment_id uuid, p_attempt_id uuid, p_psp_payment_id text,
                                      p_amount bigint, p_currency text, p_psp_fee bigint)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_request   uuid;
  v_fee       public.fee_payments%rowtype;
  v_key       text;
  v_stored    jsonb;
  v_psp_fee   bigint;
  v_alerts    jsonb := '[]'::jsonb;
  v_ok        boolean;
  v_mismatch  boolean;
  v_legs      jsonb;
  v_refund    uuid;
  v_result    jsonb;
begin
  -- 0. Inputs: whole minor units (rule 4), a currency of a region, an id.
  if p_fee_payment_id is null or p_attempt_id is null
     or p_psp_payment_id is null or char_length(p_psp_payment_id) not between 1 and 200
     or p_amount is null or p_amount < 1 or p_amount > 1000000000000000
     or p_currency is null or p_currency not in ('TRY', 'SAR') then
    raise exception 'validation_failed';
  end if;

  -- 1. The request id without a lock, the request row locked, then the fee locked (D169). The application
  --    is not locked: every change to it takes this request lock first (R-5).
  select f.request_id into v_request from public.fee_payments f where f.id = p_fee_payment_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform 1 from public.requests r where r.id = v_request for update;
  select f.* into v_fee from public.fee_payments f where f.id = p_fee_payment_id for update;
  perform 1 from public.checkout_attempts a where a.id = p_attempt_id and a.fee_payment_id = v_fee.id for update;
  if not found then
    raise exception 'not_found';
  end if;

  -- 2. A replay: this PSP payment already applied to this fee, as paid or as late.
  v_key := case when v_fee.psp_payment_id = p_psp_payment_id then 'fee:' || v_fee.id || ':paid'
                else 'late:' || p_psp_payment_id || ':received' end;
  select j.response into v_stored from public.ledger_journals j where j.idempotency_key = v_key;
  if found then
    if v_stored ->> 'fee_payment_id' is distinct from v_fee.id::text
       or (v_stored ->> 'amount')::bigint is distinct from p_amount
       or v_stored ->> 'currency' is distinct from p_currency then
      raise exception 'idempotency_conflict';
    end if;
    return v_stored || '{"replayed": true}'::jsonb;
  end if;
  if exists (select 1 from public.fee_payments f where f.psp_payment_id = p_psp_payment_id)
     or exists (select 1 from public.fee_refunds x where x.psp_payment_id = p_psp_payment_id) then
    raise exception 'idempotency_conflict';
  end if;

  -- 3. The PSP fee from the verified result, or 0 and an alert, so the daily reconcile corrects it (R-8).
  if p_psp_fee is null or p_psp_fee < 0 or p_psp_fee > p_amount then
    v_psp_fee := 0;
    v_alerts := v_alerts || '["reconcile_mismatch"]'::jsonb;
  else
    v_psp_fee := p_psp_fee;
  end if;

  -- 4. Accept or late, decided before any change.
  v_mismatch := p_amount <> v_fee.amount or p_currency <> v_fee.currency;
  v_ok := case v_fee.kind when 'commission' then public.accept_commission(v_fee.id, p_attempt_id)
                          else public.accept_provider_fee(v_fee.id, p_attempt_id) end;
  v_ok := coalesce(v_ok, false) and v_fee.status = 'pending' and not v_mismatch;

  if v_ok then
    update public.fee_payments
       set status = 'paid', paid_at = now(), psp_payment_id = p_psp_payment_id, psp_fee_amount = v_psp_fee
     where id = v_fee.id;
    update public.checkout_attempts
       set status = 'succeeded', finished_at = now()
     where id = p_attempt_id and status in ('queued', 'ready');
    select jsonb_agg(x) into v_legs from (
      select jsonb_build_object('account', 'psp_clearing', 'amount', p_amount - v_psp_fee) as x where p_amount - v_psp_fee <> 0
      union all
      select jsonb_build_object('account', 'psp_fees', 'amount', v_psp_fee) where v_psp_fee <> 0
      union all
      select jsonb_build_object('account', case v_fee.kind when 'commission' then 'commission_revenue'
                                                         else 'provider_fee_revenue' end,
                                'amount', -p_amount)) l;
    v_result := jsonb_build_object('status', 'paid', 'fee_payment_id', v_fee.id, 'attempt_id', p_attempt_id,
                                   'psp_payment_id', p_psp_payment_id, 'amount', p_amount, 'currency', p_currency,
                                   'psp_fee', v_psp_fee, 'alerts', v_alerts);
    v_result := public.post_journal('fee_paid', 'fee:' || v_fee.id || ':paid', p_currency, v_fee.region, v_legs,
                                    v_fee.id, v_result);
    if v_fee.kind = 'commission' then
      perform public.after_commission_paid(v_fee.id);
    else
      perform public.after_provider_fee_paid(v_fee.id);
    end if;
  else
    if not v_alerts ? (case when v_mismatch then 'reconcile_mismatch' else 'late_payment_refunded' end) then
      v_alerts := v_alerts || jsonb_build_array(case when v_mismatch then 'reconcile_mismatch' else 'late_payment_refunded' end);
    end if;
    insert into public.fee_refunds (region, request_id, kind, psp_payment_id, amount, currency, reason)
    values (v_fee.region, v_fee.request_id, 'late', p_psp_payment_id, p_amount, p_currency,
            case when v_mismatch then 'payment_mismatch' else 'late_payment' end)
    returning id into v_refund;
    perform public.enqueue_outbox('refund.request', 'refund:' || v_refund,
                                  jsonb_build_object('fee_refund_id', v_refund, 'psp_payment_id', p_psp_payment_id,
                                                     'amount', p_amount, 'currency', p_currency),
                                  v_fee.region);
    select jsonb_agg(x) into v_legs from (
      select jsonb_build_object('account', 'psp_clearing', 'amount', p_amount - v_psp_fee) as x where p_amount - v_psp_fee <> 0
      union all
      select jsonb_build_object('account', 'psp_fees', 'amount', v_psp_fee) where v_psp_fee <> 0
      union all
      select jsonb_build_object('account', 'refunds_due', 'amount', -p_amount)) l;
    v_result := jsonb_build_object('status', 'late', 'fee_payment_id', v_fee.id, 'attempt_id', p_attempt_id,
                                   'psp_payment_id', p_psp_payment_id, 'amount', p_amount, 'currency', p_currency,
                                   'psp_fee', v_psp_fee, 'fee_refund_id', v_refund, 'alerts', v_alerts);
    v_result := public.post_journal('late_received', 'late:' || p_psp_payment_id || ':received', p_currency,
                                    v_fee.region, v_legs, null, v_result);
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values ((select auth.uid()), case when v_ok then 'fee.paid' else 'fee.late' end, 'fee_payments', v_fee.id::text,
          v_fee.region, null,
          jsonb_build_object('fee_payment_id', v_fee.id, 'attempt_id', p_attempt_id,
                             'journal_id', (v_result ->> 'journal_id')::uuid, 'fee_refund_id', v_refund));

  return v_result || '{"replayed": false}'::jsonb;
end;
$$;

revoke all on function public.apply_fee_paid(uuid, uuid, text, bigint, text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.apply_fee_paid(uuid, uuid, text, bigint, text, bigint) to service_role;

-- AC-9: apply a verified refund, once. A fee refund sets the fee refunded and posts its refund journal; a
-- late refund clears refunds_due. A replay returns the stored result; another PSP refund id is a conflict.
create function public.apply_fee_refunded(p_fee_refund_id uuid, p_psp_refund_id text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_request  uuid;
  v_fee_id   uuid;
  v_fee      public.fee_payments%rowtype;
  v_ref      public.fee_refunds%rowtype;
  v_key      text;
  v_stored   jsonb;
  v_legs     jsonb;
  v_result   jsonb;
begin
  if p_fee_refund_id is null or p_psp_refund_id is null or char_length(p_psp_refund_id) not between 1 and 200 then
    raise exception 'validation_failed';
  end if;

  -- The lock order: request, fee, refund.
  select x.request_id, x.fee_payment_id into v_request, v_fee_id from public.fee_refunds x where x.id = p_fee_refund_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform 1 from public.requests r where r.id = v_request for update;
  if v_fee_id is not null then
    select f.* into v_fee from public.fee_payments f where f.id = v_fee_id for update;
  end if;
  select x.* into v_ref from public.fee_refunds x where x.id = p_fee_refund_id for update;

  v_key := case v_ref.kind when 'fee' then 'fee:' || v_ref.fee_payment_id || ':refund'
                           else 'late:' || v_ref.psp_payment_id || ':refund' end;
  if v_ref.status = 'done' then
    if v_ref.psp_refund_id is distinct from p_psp_refund_id then
      raise exception 'idempotency_conflict';
    end if;
    select j.response into v_stored from public.ledger_journals j where j.idempotency_key = v_key;
    return v_stored || '{"replayed": true}'::jsonb;
  end if;
  if v_ref.status not in ('queued', 'failed') then
    raise exception 'invalid_state';
  end if;

  if v_ref.kind = 'fee' then
    if v_fee.status <> 'paid' or v_ref.amount <> v_fee.amount or v_ref.currency <> v_fee.currency then
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
  update public.fee_refunds set status = 'done', psp_refund_id = p_psp_refund_id, finished_at = now()
   where id = v_ref.id;

  v_result := jsonb_build_object('status', 'refunded', 'fee_refund_id', v_ref.id, 'kind', v_ref.kind,
                                 'fee_payment_id', v_ref.fee_payment_id, 'psp_payment_id', v_ref.psp_payment_id,
                                 'psp_refund_id', p_psp_refund_id, 'amount', v_ref.amount, 'currency', v_ref.currency,
                                 'alerts', '[]'::jsonb);
  v_result := public.post_journal(case v_ref.kind when 'fee' then 'fee_refund' else 'late_refund' end, v_key,
                                  v_ref.currency, v_ref.region, v_legs, v_ref.fee_payment_id, v_result);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values ((select auth.uid()), 'fee.refunded', 'fee_refunds', v_ref.id::text, v_ref.region, null,
          jsonb_build_object('fee_refund_id', v_ref.id, 'fee_payment_id', v_ref.fee_payment_id,
                             'journal_id', (v_result ->> 'journal_id')::uuid));

  return v_result || '{"replayed": false}'::jsonb;
end;
$$;

revoke all on function public.apply_fee_refunded(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.apply_fee_refunded(uuid, text) to service_role;

-- AC-10, R-10: claim due rows (pending and due, or claimed with a lease older than 2 minutes) with skip
-- locked, so two relays never take one row. Each claim counts an attempt; a sixth attempt whose lease ran
-- out is failed instead.
create function public.claim_outbox(p_limit integer, p_worker text)
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
     where o.status = 'claimed' and o.claimed_at < now() - interval '2 minutes' and o.attempts >= 6
       for update skip locked)
  update public.outbox_events o
     set status = 'failed', next_attempt_at = null, last_error = 'lease_expired'
    from dead
   where o.id = dead.id;

  with due as (
    select o.id from public.outbox_events o
     where (o.status = 'pending' and o.next_attempt_at <= now())
        or (o.status = 'claimed' and o.claimed_at < now() - interval '2 minutes' and o.attempts < 6)
     order by o.created_at, o.id
     limit least(greatest(coalesce(p_limit, 1), 1), 100)
       for update skip locked),
  claimed as (
    update public.outbox_events o
       set status = 'claimed', claimed_at = now(), claimed_by = p_worker, attempts = o.attempts + 1,
           next_attempt_at = null
      from due
     where o.id = due.id
    returning o.id, o.kind, o.idempotency_key, o.payload, o.attempts, o.region)
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'idempotency_key', c.idempotency_key,
                                               'payload', c.payload, 'attempts', c.attempts, 'region', c.region)
                            order by c.id), '[]'::jsonb)
    into v_out
    from claimed c;
  return v_out;
end;
$$;

revoke all on function public.claim_outbox(integer, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_outbox(integer, text) to service_role;

-- AC-10, R-10: done, or the next try at 1, 5, 30, 120, then 720 minutes; failed after the sixth try. A row
-- that is not claimed any more is left as it is.
create function public.finish_outbox(p_id uuid, p_ok boolean, p_error text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_row  public.outbox_events%rowtype;
begin
  select o.* into v_row from public.outbox_events o where o.id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_row.status = 'claimed' then
    if coalesce(p_ok, false) then
      update public.outbox_events set status = 'done', done_at = now(), next_attempt_at = null
       where id = p_id returning * into v_row;
    elsif v_row.attempts >= 6 then
      update public.outbox_events set status = 'failed', next_attempt_at = null, last_error = left(coalesce(p_error, 'error'), 1000)
       where id = p_id returning * into v_row;
    else
      update public.outbox_events
         set status = 'pending',
             next_attempt_at = now() + make_interval(mins => (array[1, 5, 30, 120, 720])[greatest(v_row.attempts, 1)]),
             last_error = left(coalesce(p_error, 'error'), 1000)
       where id = p_id returning * into v_row;
    end if;
  end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'attempts', v_row.attempts,
                            'next_attempt_at', v_row.next_attempt_at);
end;
$$;

revoke all on function public.finish_outbox(uuid, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.finish_outbox(uuid, boolean, text) to service_role;

-- AC-11, R-9: store a PSP fact once per (source, event key), card fields stripped; refuse a payload over
-- 64 KiB before reading it.
create function public.record_psp_event(p_source text, p_event_key text, p_payload jsonb, p_region text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_id  uuid;
begin
  if p_source is null or p_source not in ('callback', 'webhook', 'retrieve', 'reconcile')
     or p_event_key is null or char_length(p_event_key) not between 1 and 200
     or p_payload is null or p_region is null then
    raise exception 'validation_failed';
  end if;
  if octet_length(p_payload::text) > 65536 then
    raise exception 'payload_too_large';
  end if;
  insert into public.psp_events (region, source, event_key, payload)
  values (p_region, p_source, p_event_key, public.psp_payload_strip(p_payload))
  on conflict (source, event_key) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('new', true, 'id', v_id);
  end if;
  select e.id into v_id from public.psp_events e where e.source = p_source and e.event_key = p_event_key;
  return jsonb_build_object('new', false, 'id', v_id);
end;
$$;

revoke all on function public.record_psp_event(text, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.record_psp_event(text, text, jsonb, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. The books (AC-12). Every (currency, account) total of a region, and every imbalance: a journal that
--     does not balance, a region and currency that does not sum to zero, a fee paid or refunded with no
--     journal or more than one, a journal for a fee that never got there, a late refund done with no
--     journal. No imbalance when the books are right. The service role and admins only.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.ledger_check(p_region text)
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
      having (x.status = 'done' and count(j.id) <> 1) or (x.status <> 'done' and count(j.id) > 0)
    ) i;

  return jsonb_build_object('region', p_region, 'totals', v_totals, 'imbalances', v_imbalances);
end;
$$;

revoke all on function public.ledger_check(text) from public, anon, authenticated, service_role;
grant execute on function public.ledger_check(text) to authenticated, service_role;
