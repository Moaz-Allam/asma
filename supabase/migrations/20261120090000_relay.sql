-- Position 08 (spec 0011-08, amended by D173 with rules R-1 to R-16): the relay's database side.
--
-- The relay (`/api/relay`, lib/relay) is the only caller of the PSP. It reads and writes the money tables
-- only through the service role functions below, because 07 gave no role any table access. pg_cron runs
-- it every minute and pg_net kicks it at once when a checkout starts; the URL and the secret live in
-- Vault (S33), and without them every kick does nothing (local, CI, before S33).
--
-- Lock order (D169), in every function here: the requests row, then fee_payments, then
-- checkout_attempts, then fee_refunds. A function that starts from an attempt or a refund reads its
-- parents' ids without a lock, locks the request row first, then reads again under the lock (R-9).
--
-- Order below: extensions -> settings -> columns and the fake's table -> guards -> internal functions ->
-- the relay's functions -> start_checkout with its kick -> the schedules. Every function revokes PUBLIC
-- and pins search_path (supabase/tests/02). Refusals are stable codes in the exception message.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Extensions (AC-6). pg_cron makes its own `cron` schema; pg_net its own `net` schema.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Supabase's own admin role grants pg_net's functions to the API roles when the extension is created, and a
-- migration (run as postgres) cannot revoke a grant it did not make. Accepted (security review L2): `net` is not
-- an API schema, so no caller reaches it through PostgREST, and every function here pins its search path and runs
-- no SQL built from input. supabase/tests/20 proves the API roles cannot reach the schedules (`cron`).

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Settings (AC-18, R-16). payments_enabled is a JSON boolean (the existing `_enabled` check), seeded off
--    in both regions: only the owner turns it on (S37). checkout_hold_minutes and psp_buyer_city are
--    checked per row; a missing or malformed key makes its reader refuse checkout_settings_invalid. ☐
--    marks a value unconfirmed until S17 (the hold must be at least iyzico's token lifetime, S1).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_checkout_hold_minutes_valid check (
    case when key <> 'checkout_hold_minutes' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 1440 end),
  add constraint platform_settings_psp_buyer_city_valid check (
    case when key <> 'psp_buyer_city' then true
         when jsonb_typeof(value) <> 'string' then false
         else char_length(value #>> '{}') between 1 and 100 end);

insert into public.platform_settings (region, key, value) values
  ('TR',  'payments_enabled',      'false'),
  ('KSA', 'payments_enabled',      'false'),
  ('TR',  'checkout_hold_minutes', '15'),
  ('KSA', 'checkout_hold_minutes', '15'),
  ('TR',  'psp_buyer_city',        '"Istanbul"'),
  ('KSA', 'psp_buyer_city',        '"Riyadh"')
on conflict (region, key) do nothing;

-- 03's guard, widened again (07 added the fee keys): the two checkout settings cannot be deleted,
-- renamed or moved to another region, by any role.
create or replace function public.pricing_settings_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if old.key in ('price_rounding_minor', 'max_price_multiple', 'provider_fee_kind', 'provider_fee_value', 'fee_min_minor',
                 'checkout_hold_minutes', 'psp_buyer_city')
     and (tg_op = 'DELETE' or new.key is distinct from old.key or new.region is distinct from old.region) then
    raise exception 'pricing_setting_required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.pricing_settings_guard() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Columns (AC-20, R-8, R-12) and the fake PSP's store (AC-15).
-- ═══════════════════════════════════════════════════════════════════════════

-- Why an attempt failed: set only on the move to failed, and every failed attempt has one.
-- The payer's IP (R-8): personal data, set by 09 and 10, cleared 2 hours after the attempt finished.
alter table public.checkout_attempts
  add column failure_reason text,
  add column payer_ip inet,
  add constraint checkout_attempts_failure_reason_valid check (
    failure_reason is null or failure_reason in ('payments_disabled', 'psp_not_configured', 'url_refused', 'psp_failed',
                                                 'init_failed', 'fee_not_pending', 'init_late')),
  add constraint checkout_attempts_failure_reason_set check ((status = 'failed') = (failure_reason is not null));

-- One attempt per PSP token: the callback and the webhook find their attempt by it.
create unique index checkout_attempts_psp_token_idx on public.checkout_attempts (psp_token) where psp_token is not null;
-- reconcile_pending's three sweeps.
create index checkout_attempts_open_idx on public.checkout_attempts (status, started_at) where status in ('queued', 'ready');
create index checkout_attempts_finished_idx on public.checkout_attempts (finished_at) where finished_at is not null;

-- R-12: a failed row is alerted once; the heartbeat stamps it.
alter table public.outbox_events add column alerted_at timestamptz;
create index outbox_events_failed_idx on public.outbox_events (id) where status = 'failed' and alerted_at is null;

-- The fake PSP's choices and counters, one row per fake card page token. Only the relay's functions touch
-- it (no API grant); a token must belong to an attempt, which gives the row its region (U-5).
create table public.fake_psp_outcomes (
  token       text        primary key,
  region      text        not null references public.regions (code) on delete restrict,
  outcome     jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint fake_psp_outcomes_token_length check (char_length(token) between 1 and 500),
  constraint fake_psp_outcomes_outcome_object check (jsonb_typeof(outcome) = 'object' and octet_length(outcome::text) <= 4096)
);

alter table public.fake_psp_outcomes enable row level security;
create policy fake_psp_outcomes_no_api on public.fake_psp_outcomes for select to authenticated using (false);
revoke all on table public.fake_psp_outcomes from anon, authenticated, service_role;
create index fake_psp_outcomes_region_idx on public.fake_psp_outcomes (region);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Guards. 07's attempt guard, widened: the token and the card page URL are written once, the failure
--    reason only on the move to failed, and the payer's IP may only be cleared. A finished attempt still
--    never moves (07).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.checkout_attempts_guard()
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
     or (new.status = 'queued' and old.status <> 'queued')
     or (old.psp_token is not null and new.psp_token is distinct from old.psp_token)
     or (old.url is not null and new.url is distinct from old.url)
     or (new.failure_reason is distinct from old.failure_reason
         and not (new.status = 'failed' and old.status in ('queued', 'ready')))
     or (new.payer_ip is distinct from old.payer_ip and new.payer_ip is not null) then
    raise exception 'attempt_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.checkout_attempts_guard() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Internal functions (no API grant).
-- ═══════════════════════════════════════════════════════════════════════════

-- AC-18: payments on or off for a region, failing closed: a missing or non boolean row is off. 09 and 10's
-- pay functions read it; the relay reads the same row through lib/flags.
create function public.payments_enabled(p_region text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select coalesce((select s.value = 'true'::jsonb
                     from public.platform_settings s
                    where s.region = p_region and s.key = 'payments_enabled'), false)
$$;

revoke all on function public.payments_enabled(text) from public, anon, authenticated, service_role;

-- R-16: the two checkout settings of a region, or null when either is missing or malformed (the row
-- checks hold the shape of a present value, so only a missing one is null here).
create function public.checkout_settings(p_region text)
  returns jsonb
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select case when jsonb_typeof(h.value) = 'number' and jsonb_typeof(c.value) = 'string'
              then jsonb_build_object('hold_minutes', (h.value #>> '{}')::integer, 'buyer_city', c.value #>> '{}')
         end
    from (select 1) one
    left join public.platform_settings h on h.region = p_region and h.key = 'checkout_hold_minutes'
    left join public.platform_settings c on c.region = p_region and c.key = 'psp_buyer_city'
$$;

revoke all on function public.checkout_settings(text) from public, anon, authenticated, service_role;

-- AC-6, R-7: wake the relay for one task through pg_net. The URL and the secret come from Vault (S33);
-- without both it does nothing, so local, CI and the cloud before S33 never call out. pg_net sends after
-- commit and nothing on rollback. A kick only saves waiting for the next minute, so a missing Vault or
-- pg_net never fails the caller.
create function public.relay_kick(p_task text)
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
  if p_task is null or p_task not in ('drain', 'reconcile_pending', 'reconcile_daily', 'heartbeat') then
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

-- R-6: 07's filter, plus the checkout token and the card page at any depth and in any case.
create or replace function public.psp_payload_strip(p_payload jsonb, p_depth integer default 0)
  returns jsonb
  language plpgsql
  immutable
  security invoker
  set search_path = ''
as $$
begin
  if p_depth > 32 then
    raise exception 'payload_too_large';
  end if;
  if jsonb_typeof(p_payload) = 'object' then
    return coalesce(
      (select jsonb_object_agg(e.key, public.psp_payload_strip(e.value, p_depth + 1))
         from jsonb_each(p_payload) e
        where position('card' in lower(e.key)) = 0
          and position('address' in lower(e.key)) = 0
          and lower(e.key) not in ('cvc', 'cvv', 'expiremonth', 'expireyear', 'binnumber', 'lastfourdigits',
                                   'buyer', 'email', 'gsmnumber', 'identitynumber', 'identity_number', 'ip', 'name',
                                   'surname', 'contactname', 'token', 'psp_token', 'paymentpageurl',
                                   'checkoutformcontent')),
      '{}'::jsonb);
  elsif jsonb_typeof(p_payload) = 'array' then
    return coalesce(
      (select jsonb_agg(public.psp_payload_strip(x.v, p_depth + 1) order by x.i)
         from jsonb_array_elements(p_payload) with ordinality as x(v, i)),
      '[]'::jsonb);
  end if;
  return p_payload;
end;
$$;

revoke all on function public.psp_payload_strip(jsonb, integer) from public, anon, authenticated, service_role;

-- An attempt's parents, locked in the D169 order, then the attempt itself. Returns the attempt row, or
-- raises not_found.
create function public.lock_attempt(p_attempt_id uuid)
  returns public.checkout_attempts
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_fee      uuid;
  v_request  uuid;
  v_row      public.checkout_attempts%rowtype;
begin
  select a.fee_payment_id into v_fee from public.checkout_attempts a where a.id = p_attempt_id;
  if not found then
    raise exception 'not_found';
  end if;
  select f.request_id into v_request from public.fee_payments f where f.id = v_fee;
  perform 1 from public.requests r where r.id = v_request for update;
  perform 1 from public.fee_payments f where f.id = v_fee for update;
  select a.* into v_row from public.checkout_attempts a where a.id = p_attempt_id for update;
  return v_row;
end;
$$;

revoke all on function public.lock_attempt(uuid) from public, anon, authenticated, service_role;

-- The one move to failed, with its reason (R-9: a finished attempt is left as it is).
create function public.fail_attempt(p_attempt_id uuid, p_reason text)
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
                                          'init_failed', 'fee_not_pending', 'init_late') then
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
-- 6. The relay's functions (AC-20, service role only). Each answers {changed: false, status} rather than
--    an error when its row is not in a state it acts on (R-9).
-- ═══════════════════════════════════════════════════════════════════════════

-- AC-20, R-4, R-8: everything the relay needs about one attempt. The payer's name, email and IP are for
-- the card page request only (08b); the relay never logs them. settings is null when a checkout setting
-- is missing (R-16); only checkout.initialize needs it.
create function public.checkout_context(p_attempt_id uuid)
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
           'attempt_id', a.id, 'attempt_status', a.status, 'failure_reason', a.failure_reason,
           'locale', coalesce(a.locale, g.default_locale), 'psp_token', a.psp_token, 'region', a.region,
           'attempt_age_seconds', floor(extract(epoch from now() - a.started_at))::bigint,
           'finished_seconds_ago', floor(extract(epoch from now() - a.finished_at))::bigint,
           'payer_ip', host(a.payer_ip),
           'fee_payment_id', f.id, 'fee_kind', f.kind, 'fee_status', f.status, 'amount', f.amount,
           'currency', f.currency, 'payer_id', f.payer_id, 'full_name', p.full_name, 'email', p.email,
           'settings', public.checkout_settings(a.region))
    into v_out
    from public.checkout_attempts a
    join public.fee_payments f on f.id = a.fee_payment_id
    left join public.profiles p on p.id = f.payer_id
    join public.regions g on g.code = a.region
   where a.id = p_attempt_id;
  if v_out is null then
    raise exception 'not_found';
  end if;
  return v_out;
end;
$$;

revoke all on function public.checkout_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.checkout_context(uuid) to service_role;

-- AC-20, AC-21: the card page is open. From queued only. The URL's shape is checked again here: https (or
-- http on localhost), no user info, at most 2,000 characters. The host list is the relay's check.
create function public.mark_checkout_ready(p_attempt_id uuid, p_token text, p_url text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_row  public.checkout_attempts%rowtype;
begin
  if p_attempt_id is null or p_token is null or char_length(p_token) not between 1 and 500
     or p_url is null or char_length(p_url) not between 1 and 2000
     or not (p_url ~ '^https://[^/?#@\s]+([/?#][^\s]*)?$' or p_url ~ '^http://localhost(:[0-9]{1,5})?([/?#][^\s]*)?$') then
    raise exception 'validation_failed';
  end if;
  v_row := public.lock_attempt(p_attempt_id);
  if v_row.status <> 'queued' then
    return jsonb_build_object('changed', false, 'status', v_row.status);
  end if;
  begin
    update public.checkout_attempts set status = 'ready', psp_token = p_token, url = p_url where id = p_attempt_id;
  exception when unique_violation then
    raise exception 'idempotency_conflict';
  end;
  return jsonb_build_object('changed', true, 'status', 'ready');
end;
$$;

revoke all on function public.mark_checkout_ready(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_checkout_ready(uuid, text, text) to service_role;

-- AC-20, R-4: the attempt failed, with its reason. From queued or ready only.
create function public.mark_checkout_failed(p_attempt_id uuid, p_reason text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  if p_attempt_id is null then
    raise exception 'validation_failed';
  end if;
  return public.fail_attempt(p_attempt_id, p_reason);
end;
$$;

revoke all on function public.mark_checkout_failed(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_checkout_failed(uuid, text) to service_role;

-- AC-20, R-2: the token is dead and nothing was paid. From ready only.
create function public.abandon_checkout(p_attempt_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_row  public.checkout_attempts%rowtype;
begin
  if p_attempt_id is null then
    raise exception 'validation_failed';
  end if;
  v_row := public.lock_attempt(p_attempt_id);
  if v_row.status <> 'ready' then
    return jsonb_build_object('changed', false, 'status', v_row.status);
  end if;
  update public.checkout_attempts set status = 'abandoned', finished_at = now() where id = p_attempt_id;
  return jsonb_build_object('changed', true, 'status', 'abandoned');
end;
$$;

revoke all on function public.abandon_checkout(uuid) from public, anon, authenticated, service_role;
grant execute on function public.abandon_checkout(uuid) to service_role;

-- AC-8, R-1: the browser came back from the card page. Store the fields (token and card fields stripped)
-- and queue a check, at most once per attempt per UTC minute, so a later callback always asks again and a
-- forger is bounded. Changes no money state. An unknown token answers null.
create function public.psp_callback(p_token text, p_fields jsonb)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_att     record;
  v_event   jsonb;
  v_minute  text := to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MI');
begin
  if p_token is null or char_length(p_token) not between 1 and 500
     or jsonb_typeof(p_fields) is distinct from 'object' or octet_length(p_fields::text) > 8192 then
    raise exception 'validation_failed';
  end if;
  select a.id, a.region, coalesce(a.locale, g.default_locale) as locale into v_att
    from public.checkout_attempts a join public.regions g on g.code = a.region
   where a.psp_token = p_token;
  if not found then
    return null;
  end if;
  v_event := public.record_psp_event('callback', 'callback:' || v_att.id || ':' || v_minute, p_fields, v_att.region);
  perform public.enqueue_outbox('payment.verify', 'checkout:' || v_att.id || ':verify:callback:' || v_minute,
                                jsonb_build_object('attempt_id', v_att.id, 'final', false), v_att.region);
  -- The event and the check share the minute, so a new event means a new check: only then is the relay woken,
  -- so a caller looping on a known token buys no relay runs (security review S1).
  if (v_event ->> 'new')::boolean then
    perform public.relay_kick('drain');
  end if;
  return jsonb_build_object('attempt_id', v_att.id, 'locale', v_att.locale, 'region', v_att.region);
end;
$$;

revoke all on function public.psp_callback(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.psp_callback(text, jsonb) to service_role;

-- AC-9, R-15: a webhook whose signature the relay checked. Its region is the attempt's (by token), else the
-- fee's or the refund's (by PSP payment id), else the adapter's home region. A check is queued only when an
-- attempt is found; a replayed event queues nothing new (the same key).
create function public.psp_webhook(p_event_key text, p_token text, p_psp_payment_id text, p_payload jsonb,
                                   p_home_region text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_attempt  uuid;
  v_region   text;
  v_event    jsonb;
begin
  if p_event_key is null or char_length(p_event_key) not between 1 and 200
     or (p_token is not null and char_length(p_token) not between 1 and 500)
     or (p_psp_payment_id is not null and char_length(p_psp_payment_id) not between 1 and 200)
     or jsonb_typeof(p_payload) is distinct from 'object'
     or not exists (select 1 from public.regions g where g.code = p_home_region) then
    raise exception 'validation_failed';
  end if;
  if p_token is not null then
    select a.id, a.region into v_attempt, v_region from public.checkout_attempts a where a.psp_token = p_token;
  end if;
  if v_region is null and p_psp_payment_id is not null then
    select f.region into v_region from public.fee_payments f where f.psp_payment_id = p_psp_payment_id;
    if v_region is null then
      select x.region into v_region from public.fee_refunds x where x.psp_payment_id = p_psp_payment_id;
    end if;
  end if;
  v_region := coalesce(v_region, p_home_region);
  v_event := public.record_psp_event('webhook', p_event_key, p_payload, v_region);
  if v_attempt is not null then
    perform public.enqueue_outbox('payment.verify', 'checkout:' || v_attempt || ':verify:webhook:' || (v_event ->> 'id'),
                                  jsonb_build_object('attempt_id', v_attempt, 'final', false), v_region);
    if (v_event ->> 'new')::boolean then
      perform public.relay_kick('drain');
    end if;
  end if;
  return jsonb_build_object('psp_event_id', (v_event ->> 'id')::uuid, 'new', (v_event ->> 'new')::boolean,
                            'attempt_id', v_attempt);
end;
$$;

revoke all on function public.psp_webhook(text, text, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.psp_webhook(text, text, text, jsonb, text) to service_role;

-- AC-11, R-9, R-12: a refund the relay could not make. From queued only; done is never touched.
create function public.mark_refund_failed(p_fee_refund_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_request  uuid;
  v_fee      uuid;
  v_status   text;
begin
  if p_fee_refund_id is null then
    raise exception 'validation_failed';
  end if;
  select x.request_id, x.fee_payment_id into v_request, v_fee from public.fee_refunds x where x.id = p_fee_refund_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform 1 from public.requests r where r.id = v_request for update;
  if v_fee is not null then
    perform 1 from public.fee_payments f where f.id = v_fee for update;
  end if;
  select x.status into v_status from public.fee_refunds x where x.id = p_fee_refund_id for update;
  if v_status <> 'queued' then
    return jsonb_build_object('changed', false, 'status', v_status);
  end if;
  update public.fee_refunds set status = 'failed' where id = p_fee_refund_id;
  return jsonb_build_object('changed', true, 'status', 'failed');
end;
$$;

revoke all on function public.mark_refund_failed(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_refund_failed(uuid) to service_role;

-- AC-12, R-1, R-8, R-10: every 15 minutes. Queue a check for every attempt ready for more than 10 minutes and
-- less than 26 hours (final once it is older than 2 hours) and for every attempt failed by the PSP or abandoned
-- less than 2 hours ago (a payment can still land on its token); fail every attempt queued for more than 30
-- minutes whose initialize row failed; clear the payer's IP of every attempt started or finished more than 2
-- hours ago, each through the D169 locks (security review S5, S6). Each row in its own exception block: a
-- conflict is counted, never aborting the rest. A reconcile check carries `origin: reconcile`: on a pending
-- answer it finishes rather than retrying, because the next window asks again (review 2026-11-17, Major 1);
-- after 26 hours no check is queued at all, so an abandoned card page stops costing rows. Only new checks count
-- as queued and wake the relay.
create function public.reconcile_pending()
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_window     text := floor(extract(epoch from now()) / 900)::bigint::text;
  v_row        record;
  v_final      boolean;
  v_key        text;
  v_queued     integer := 0;
  v_failed     integer := 0;
  v_conflicts  integer := 0;
  v_cleared    integer := 0;
begin
  for v_row in
    select a.id, a.region, a.status, a.started_at from public.checkout_attempts a
     where (a.status = 'ready' and a.started_at < now() - interval '10 minutes'
            and a.started_at > now() - interval '26 hours')
        or (a.status in ('failed', 'abandoned') and a.finished_at > now() - interval '2 hours'
            and (a.status = 'abandoned' or a.failure_reason = 'psp_failed'))
     order by a.started_at, a.id
  loop
    v_final := v_row.status = 'ready' and v_row.started_at < now() - interval '2 hours';
    v_key := 'checkout:' || v_row.id || ':verify:reconcile:' || v_window || ':'
             || case when v_final then 'final' else 'open' end;
    begin
      if not exists (select 1 from public.outbox_events o where o.idempotency_key = v_key) then
        perform public.enqueue_outbox('payment.verify', v_key,
                                      jsonb_build_object('attempt_id', v_row.id, 'final', v_final, 'origin', 'reconcile'),
                                      v_row.region);
        v_queued := v_queued + 1;
      end if;
    exception when others then
      v_conflicts := v_conflicts + 1;
    end;
  end loop;

  for v_row in
    select a.id from public.checkout_attempts a
     where a.status = 'queued' and a.started_at < now() - interval '30 minutes'
       and exists (select 1 from public.outbox_events o
                    where o.idempotency_key = 'checkout:' || a.id || ':init' and o.status = 'failed')
     order by a.started_at, a.id
  loop
    begin
      if (public.fail_attempt(v_row.id, 'init_failed') ->> 'changed')::boolean then
        v_failed := v_failed + 1;
      end if;
    exception when others then
      v_conflicts := v_conflicts + 1;
    end;
  end loop;

  for v_row in
    select a.id from public.checkout_attempts a
     where a.payer_ip is not null
       and (a.started_at < now() - interval '2 hours' or a.finished_at < now() - interval '2 hours')
     order by a.started_at, a.id
  loop
    begin
      perform public.lock_attempt(v_row.id);
      update public.checkout_attempts set payer_ip = null where id = v_row.id and payer_ip is not null;
      if found then
        v_cleared := v_cleared + 1;
      end if;
    exception when others then
      v_conflicts := v_conflicts + 1;
    end;
  end loop;

  if v_queued > 0 then
    perform public.relay_kick('drain');
  end if;
  return jsonb_build_object('queued', v_queued, 'failed', v_failed, 'conflicts', v_conflicts, 'cleared_ips', v_cleared);
end;
$$;

revoke all on function public.reconcile_pending() from public, anon, authenticated, service_role;
grant execute on function public.reconcile_pending() to service_role;

-- AC-12, R-11, R-14: the payments of one local day of a region (in its timezone) to compare with the PSP:
-- fees paid that day, fees whose refund was done that day, and late refunds done that day. A payment that
-- already has its `reconcile:<day>:<psp_payment_id>` event is left out, so each run resumes where the last
-- one stopped. At most p_limit rows (1 to 500).
create function public.reconcile_daily_list(p_region text, p_day date, p_limit integer)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tz    text;
  v_from  timestamptz;
  v_to    timestamptz;
  v_out   jsonb;
begin
  select g.timezone into v_tz from public.regions g where g.code = p_region;
  if v_tz is null or p_day is null or p_limit is null or p_limit not between 1 and 500 then
    raise exception 'validation_failed';
  end if;
  v_from := p_day::timestamp at time zone v_tz;
  v_to := (p_day + 1)::timestamp at time zone v_tz;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.ref_id), '[]'::jsonb) into v_out
    from (
      select u.kind, u.ref_id, u.psp_payment_id, u.status, u.amount, u.currency, u.psp_fee_amount
        from (
          select 'fee' as kind, f.id as ref_id, f.psp_payment_id, f.status, f.amount, f.currency, f.psp_fee_amount
            from public.fee_payments f
           where f.region = p_region and f.status in ('paid', 'refunded')
             and ((f.paid_at >= v_from and f.paid_at < v_to)
                  or exists (select 1 from public.fee_refunds x
                              where x.fee_payment_id = f.id and x.status = 'done'
                                and x.finished_at >= v_from and x.finished_at < v_to))
          union all
          select 'late', x.id, x.psp_payment_id, 'refunded', x.amount, x.currency, null::bigint
            from public.fee_refunds x
           where x.region = p_region and x.kind = 'late' and x.status = 'done'
             and x.finished_at >= v_from and x.finished_at < v_to
        ) u
       where not exists (select 1 from public.psp_events e
                          where e.source = 'reconcile'
                            and e.event_key = 'reconcile:' || to_char(p_day, 'YYYY-MM-DD') || ':' || u.psp_payment_id)
       order by u.ref_id
       limit p_limit
    ) t;
  return v_out;
end;
$$;

revoke all on function public.reconcile_daily_list(text, date, integer) from public, anon, authenticated, service_role;
grant execute on function public.reconcile_daily_list(text, date, integer) to service_role;

-- AC-13, R-12: how far behind the outbox is, and every failed row not alerted yet (stamped here, so each
-- alerts once). A failed refund row's refund is marked failed in the same transaction, so a heartbeat cut
-- before its alert never leaves a refund `queued` for good (security review S3).
create function public.outbox_health()
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_oldest  bigint;
  v_failed  jsonb;
  v_row     jsonb;
begin
  select coalesce(floor(extract(epoch from now() - min(o.next_attempt_at)))::bigint, 0) into v_oldest
    from public.outbox_events o
   where o.status = 'pending' and o.next_attempt_at <= now();

  with picked as (
    select o.id from public.outbox_events o
     where o.status = 'failed' and o.alerted_at is null
     order by o.id
     limit 100
       for update skip locked),
  stamped as (
    update public.outbox_events o set alerted_at = now()
      from picked where o.id = picked.id
    returning o.id, o.kind, o.region, o.payload)
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'region', s.region, 'payload', s.payload)
                            order by s.id), '[]'::jsonb)
    into v_failed
    from stamped s;

  for v_row in select x from jsonb_array_elements(v_failed) x loop
    if v_row ->> 'kind' = 'refund.request' then
      begin
        perform public.mark_refund_failed((v_row -> 'payload' ->> 'fee_refund_id')::uuid);
      exception when others then
        null;
      end;
    end if;
  end loop;

  return jsonb_build_object('oldest_due_seconds', v_oldest, 'failed', v_failed);
end;
$$;

revoke all on function public.outbox_health() from public, anon, authenticated, service_role;
grant execute on function public.outbox_health() to service_role;

-- AC-15: the fake PSP's store, keyed by an attempt's token or its id (the fake's payment ids carry the attempt
-- id, never the token: security review S7). The attempt gives the row its region. The value is the fake's own
-- state (its outcome, counters and refunds), a small JSON object.
create function public.fake_psp_token(p_key text)
  returns text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select coalesce(
    (select a.psp_token from public.checkout_attempts a where a.psp_token = p_key),
    (select a.psp_token from public.checkout_attempts a
      where p_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and a.id = p_key::uuid))
$$;

revoke all on function public.fake_psp_token(text) from public, anon, authenticated, service_role;

create function public.fake_psp_set(p_token text, p_outcome jsonb)
  returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_token   text;
  v_region  text;
begin
  if p_token is null or char_length(p_token) not between 1 and 500
     or jsonb_typeof(p_outcome) is distinct from 'object' or octet_length(p_outcome::text) > 4096 then
    raise exception 'validation_failed';
  end if;
  v_token := public.fake_psp_token(p_token);
  select a.region into v_region from public.checkout_attempts a where a.psp_token = v_token;
  if v_region is null then
    raise exception 'not_found';
  end if;
  insert into public.fake_psp_outcomes (token, region, outcome) values (v_token, v_region, p_outcome)
  on conflict (token) do update set outcome = excluded.outcome, updated_at = now();
end;
$$;

revoke all on function public.fake_psp_set(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.fake_psp_set(text, jsonb) to service_role;

create function public.fake_psp_get(p_token text)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select o.outcome from public.fake_psp_outcomes o where o.token = public.fake_psp_token(p_token)
$$;

revoke all on function public.fake_psp_get(text) from public, anon, authenticated, service_role;
grant execute on function public.fake_psp_get(text) to service_role;

-- The fence (security review L1, G3): a fake payment (`fp1_…`, `fp2_…`) never settles or books anything unless
-- the Vault secret `fake_psp_allowed` is `true`. Only the local seed sets it; in the cloud the owner sets it for
-- a deliberate fake check (S37) and deletes it after, so a fake preview on the shared database cannot pay a
-- real fee once 09 and 10 accept payments.
create function public.fake_payment_fence()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_allowed  text;
begin
  if new.psp_payment_id is null or new.psp_payment_id !~ '^fp[12]_' then
    return new;
  end if;
  begin
    select s.decrypted_secret into v_allowed from vault.decrypted_secrets s where s.name = 'fake_psp_allowed';
  exception when others then
    v_allowed := null;
  end;
  if v_allowed is distinct from 'true' then
    raise exception 'fake_payment_refused';
  end if;
  return new;
end;
$$;

revoke all on function public.fake_payment_fence() from public, anon, authenticated, service_role;

create trigger fee_payments_fake_fence before insert or update of psp_payment_id on public.fee_payments
  for each row execute function public.fake_payment_fence();
create trigger fee_refunds_fake_fence before insert or update of psp_payment_id on public.fee_refunds
  for each row execute function public.fake_payment_fence();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. start_checkout (07 AC-5), replaced to kick the relay after it queues its row (AC-6). The kick is sent
--    by pg_net after commit; on rollback nothing is sent. 09 replaces it again to take the payer's IP.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.start_checkout(p_fee_payment_id uuid)
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
  perform public.relay_kick('drain');
  return v_id;
end;
$$;

revoke all on function public.start_checkout(uuid) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The schedules (AC-6, R-11). Each only kicks the relay; without the Vault secrets each does nothing.
--    cron.schedule replaces a job of the same name, so this is safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

select cron.schedule('relay-drain', '* * * * *', $$select public.relay_kick('drain')$$);
select cron.schedule('relay-heartbeat', '*/5 * * * *', $$select public.relay_kick('heartbeat')$$);
select cron.schedule('relay-reconcile-pending', '*/15 * * * *', $$select public.relay_kick('reconcile_pending')$$);
select cron.schedule('relay-reconcile-daily', '*/10 0-1 * * *', $$select public.relay_kick('reconcile_daily')$$);
