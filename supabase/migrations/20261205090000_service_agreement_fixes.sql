-- Position 20 review fixes (docs/reviews/2026-11-23-feat-20-service-agreement-security.md and
-- docs/reviews/2026-11-23-feat-20-service-agreement.md). S20-1: no table read of service_agreements for any API role
-- (admin reads only through admin_agreements and the audited admin_agreement_link). S20-2, S20-6: a party reads the
-- agreement only while it may see the contacts (an approved provider, the contacts window). S20-3: the reveal never
-- fails for the agreement. S20-4: a retry takes the version already accepted. S20-5: no re-render while one is queued.
-- Also: alert a failed render once, each admin row's time zone, an index for the storage read check.

drop policy service_agreements_admin_read on public.service_agreements;
revoke select on table public.service_agreements from authenticated;
create policy service_agreements_no_api on public.service_agreements for select to authenticated using (false);

create index service_agreements_storage_path_idx on public.service_agreements (storage_path) where storage_path is not null;


create or replace function public.agreement_side(p_s public.service_agreements, p_uid uuid)
  returns text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select case when exists (select 1 from public.requests r where r.id = (p_s).request_id and r.customer_id = p_uid)
              then 'customer'
              when exists (select 1 from public.applications a
                            join public.providers pr on pr.id = a.provider_id
                           where a.id = (p_s).application_id and a.provider_id = p_uid and pr.status = 'approved')
              then 'provider'
         end
$$;

revoke all on function public.agreement_side(public.service_agreements, uuid) from public, anon, authenticated, service_role;

create or replace function public.agreement_visible(p_id uuid)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_s       public.service_agreements%rowtype;
  v_side    text;
  v_opened  timestamptz;
begin
  select s.* into v_s from public.service_agreements s where s.id = p_id;
  if not found or v_s.rendered_at is null or v_s.rendered_at <= now() - interval '7 days' then
    return false;
  end if;
  v_side := public.agreement_side(v_s, (select auth.uid()));
  if v_side is null or not public.contacts_visible(v_s.request_id) then
    return false;
  end if;
  v_opened := case v_side when 'customer' then v_s.customer_opened_at else v_s.provider_opened_at end;
  return v_opened is null or v_opened > now() - interval '10 minutes';
end;
$$;

revoke all on function public.agreement_visible(uuid) from public, anon, authenticated, service_role;
grant execute on function public.agreement_visible(uuid) to authenticated;

create or replace function public.agreement_read_allowed(p_name text)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_s       public.service_agreements%rowtype;
  v_side    text;
  v_opened  timestamptz;
begin
  if v_uid is null or p_name is null then
    return false;
  end if;
  select s.* into v_s from public.service_agreements s where s.storage_path = p_name collate "C";
  if not found then
    return false;
  end if;
  v_side := public.agreement_side(v_s, v_uid);
  if v_side is not null and public.contacts_visible(v_s.request_id) then
    v_opened := case v_side when 'customer' then v_s.customer_opened_at else v_s.provider_opened_at end;
    if v_opened is not null and v_opened > now() - interval '10 minutes' then
      return true;
    end if;
  end if;
  return public.is_admin()
         and exists (
           select 1 from public.audit_log a
            where a.action = 'agreement.viewed'
              and a.actor_id = v_uid
              and a.entity_id = v_s.id::text
              and a.created_at > now() - interval '2 minutes'
              and a.new_value ->> 'path' = p_name
         );
end;
$$;

revoke all on function public.agreement_read_allowed(text) from public, anon, authenticated, service_role;
grant execute on function public.agreement_read_allowed(text) to authenticated;

create or replace function public.fail_agreement_render(p_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_s  public.service_agreements%rowtype;
begin
  select s.* into v_s from public.service_agreements s where s.id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_s.rendered_at is not null then
    return jsonb_build_object('status', 'rendered');
  end if;
  if v_s.failed_at is not null then
    return jsonb_build_object('status', 'already_failed', 'region', v_s.region);
  end if;
  update public.service_agreements set failed_at = now() where id = v_s.id;
  return jsonb_build_object('status', 'failed', 'region', v_s.region);
end;
$$;

revoke all on function public.fail_agreement_render(uuid) from public, anon, authenticated, service_role;
grant execute on function public.fail_agreement_render(uuid) to service_role;

create or replace function public.admin_rerender_agreement(p_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_s        public.service_agreements%rowtype;
  v_attempt  integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select s.* into v_s from public.service_agreements s where s.id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_s.rendered_at is not null or v_s.failed_at is null
     or exists (select 1 from public.outbox_events o
                 where o.kind = 'agreement.render' and o.status in ('pending', 'claimed')
                   and o.payload ->> 'agreement_id' = v_s.id::text) then
    raise exception 'invalid_state';
  end if;
  select coalesce(max(split_part(o.idempotency_key, ':', 3)::integer), 0) + 1 into v_attempt
    from public.outbox_events o
   where o.kind = 'agreement.render' and o.idempotency_key like 'agreement.render:' || v_s.id || ':%';
  if v_attempt > 999 then
    raise exception 'invalid_state';
  end if;
  update public.service_agreements set failed_at = null where id = v_s.id;
  perform public.enqueue_outbox('agreement.render', 'agreement.render:' || v_s.id || ':' || v_attempt,
                                jsonb_build_object('agreement_id', v_s.id), v_s.region);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, new_value)
  values ((select auth.uid()), 'agreement.rerender_requested', 'service_agreements', v_s.id::text, v_s.region,
          jsonb_build_object('attempt', v_attempt));
  return jsonb_build_object('status', 'queued', 'attempt', v_attempt);
end;
$$;

revoke all on function public.admin_rerender_agreement(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_rerender_agreement(uuid) to authenticated;

create or replace function public.admin_agreements(p_query text default null, p_after uuid default null)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_q       text := nullif(btrim(coalesce(p_query, '')), '');
  v_req     uuid;
  v_num     text;
  v_cursor  public.service_agreements%rowtype;
  v_rows    jsonb;
  v_more    boolean;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if v_q is not null and char_length(v_q) > 100 then
    raise exception 'validation_failed';
  end if;
  if v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_req := lower(v_q)::uuid;
  elsif v_q is not null then
    -- Numbers are ASCII; upper() on a C collated copy never folds by a Turkish rule.
    v_num := upper(v_q collate "C");
  end if;
  if p_after is not null then
    select s.* into v_cursor from public.service_agreements s where s.id = p_after;
  end if;

  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= 50), '[]'::jsonb), count(*) > 50
    into v_rows, v_more
    from (
      select row_number() over (order by s.created_at desc, s.id desc) as rn,
             jsonb_build_object(
               'id', s.id,
               'number', s.number,
               'region', s.region,
               'timezone', g.timezone,
               'request_id', s.request_id,
               'request_status', r.status,
               'customer_name', s.content ->> 'customer_name',
               'provider_name', s.content ->> 'provider_name',
               'created_at', s.created_at,
               'rendered_at', s.rendered_at,
               'failed', s.rendered_at is null and s.failed_at is not null,
               'customer_opened_at', s.customer_opened_at,
               'provider_opened_at', s.provider_opened_at) as j
        from public.service_agreements s
        join public.requests r on r.id = s.request_id
        join public.regions g on g.code = s.region
       where (v_req is null or s.request_id = v_req)
         and (v_num is null or strpos(s.number, v_num) > 0)
         and (v_cursor.id is null or (s.created_at, s.id) < (v_cursor.created_at, v_cursor.id))
       order by s.created_at desc, s.id desc
       limit 51
    ) x;
  return jsonb_build_object('rows', v_rows, 'has_more', v_more);
end;
$$;

revoke all on function public.admin_agreements(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_agreements(text, uuid) to authenticated;

create or replace function public.provider_fee_settled(p_request_id uuid)
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

  -- Spec 0011-20 AC-5: the agreement, frozen now, and its render queued. Null (no row) when an acceptance is missing.
  -- Security review S20-3: in a subtransaction, so a content or sequence error cannot roll the payment back.
  begin
    perform public.queue_agreement(v_req.id, v_req.selected_application_id);
  exception when others then
    raise warning 'agreement_queue_failed request=%', v_req.id;
  end;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values ((select auth.uid()), 'request.unlocked', 'requests', v_req.id::text, v_req.region,
          jsonb_build_object('status', 'COMMISSION_PAID'),
          jsonb_build_object('status', 'UNLOCKED', 'application_id', v_req.selected_application_id));
end;
$$;

revoke all on function public.provider_fee_settled(uuid) from public, anon, authenticated, service_role;

create or replace function public.pay_commission(p_request_id uuid, p_locale text, p_payer_ip text,
                                      p_agreement_version text default null)
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
  v_template  uuid;
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

  -- 4b. The agreement (spec 0011-20 AC-2, X-5): the region's active version, else agreement_required; then the
  --     customer's acceptance for the selected application. A replay keeps the first acceptance.
  select c.template_id into v_template
    from public.agreement_acceptances c
    join public.agreement_templates t on t.id = c.template_id
   where c.application_id = v_req.selected_application_id and c.role = 'customer' and t.version = p_agreement_version;
  if v_template is null and not exists (select 1 from public.agreement_acceptances c
                                         where c.application_id = v_req.selected_application_id
                                           and c.role = 'customer') then
    select t.id into v_template from public.agreement_templates t
     where t.region = v_req.region and t.active and t.version = p_agreement_version;
  end if;
  if p_agreement_version is null or v_template is null then
    raise exception 'agreement_required';
  end if;
  perform public.record_acceptance(v_req.id, v_req.selected_application_id, v_uid, 'customer', v_template);

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

revoke all on function public.pay_commission(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pay_commission(uuid, text, text, text) to authenticated;

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
  v_agr      public.service_agreements%rowtype;
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
    when 'agreement_ready_customer', 'agreement_ready_provider' then
      -- Spec 0011-20 AC-8: the recipient is that side of the agreement and the file exists; else condition.
      select s.* into v_agr from public.service_agreements s where s.id = v_entity and s.request_id = v_req.id;
      v_ok := v_agr.id is not null and v_agr.rendered_at is not null
              and case v_tpl
                    when 'agreement_ready_customer' then v_req.customer_id = v_rcp
                    else public.agreement_side(v_agr, v_rcp) = 'provider'
                  end;
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
  if v_tpl in ('agreement_ready_customer', 'agreement_ready_provider') then
    -- The id and the number only, never a path: the relay loads the file through lib/storage.
    v_values := v_values || jsonb_build_object('agreement_id', v_agr.id, 'agreement_number', v_agr.number);
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
