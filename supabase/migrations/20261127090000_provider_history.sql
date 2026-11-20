-- Position 15 (spec 0011-15, amended by D195 with rules R-1 to R-14 and cross check rules X-1 to X-13; an X rule
-- wins over an R rule, a rule over an AC): the provider's jobs and fees history, read only.
--
-- One definer function, provider_history(p_month). The caller comes from provider_reader() (05), so from auth.uid()
-- only: there is no provider id argument (R-7, X-2). A row is one of the caller's applications that unlocked, whatever
-- its later status (R-1), in the caller's region (X-7). A row belongs to the month of its request's scheduled start,
-- read in the region's time zone with half open bounds (R-2, X-8, X-9). The fee is the paid or refunded provider fee
-- row, else the fee frozen on the pick, which is 0 when no row exists (R-3, X-5, D171); the refund is that fee's
-- refund row (R-4, X-4). Totals cover the whole month, summed here in integer minor units (R-5, X-3, rule 4); the
-- rows stop at 200 (R-8, X-11). No customer name, phone, address, district or note is returned (R-9). Nothing is
-- stored: there is no balance, no withdrawal and no top up (rule 9, D91).
--
-- No table, grant or policy changes. The function revokes PUBLIC and pins search_path (supabase/tests/02).
-- Refusals are stable codes in the exception message: forbidden (provider_reader) and validation_failed (a month
-- outside the window); lib/provider-feed maps them.

create function public.provider_history(p_month date)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_me        public.providers%rowtype;
  v_tz        text;
  v_currency  text;
  v_current   date;
  v_first     date;
  v_last      date;
  v_latest    date;
  v_month     date;
  v_from      timestamptz;
  v_to        timestamptz;
  v_months    jsonb;
  v_totals    jsonb;
  v_rows      jsonb;
  v_truncated boolean;
begin
  v_me := public.provider_reader();
  select g.timezone, g.currency into v_tz, v_currency from public.regions g where g.code = v_me.region;

  -- X-1, X-8: the window runs from 11 months before the current month through the latest month holding one of the
  -- caller's jobs, at most 12 months ahead; every month is a first day in the region's time zone.
  v_current := date_trunc('month', now() at time zone v_tz)::date;
  v_first := (v_current - interval '11 months')::date;
  select date_trunc('month', max(r.scheduled_start_at) at time zone v_tz)::date
    into v_latest
    from public.applications a
    join public.requests r on r.id = a.request_id
   where a.provider_id = v_me.id and a.region = v_me.region and a.unlocked_at is not null;
  v_last := least(greatest(coalesce(v_latest, v_current), v_current), (v_current + interval '12 months')::date);

  -- R-2: any day of a month reads that month; null is the current month.
  v_month := coalesce(p_month - (extract(day from p_month)::integer - 1), v_current);
  if v_month < v_first or v_month > v_last then
    raise exception 'validation_failed';
  end if;
  v_from := v_month::timestamp at time zone v_tz;
  v_to := (v_month + interval '1 month')::timestamp at time zone v_tz;

  select jsonb_agg(to_jsonb(m::date) order by m desc)
    into v_months
    from generate_series(v_last::timestamp, v_first::timestamp, interval '-1 month') m;

  with base as (
    select a.id as application_id,
           a.request_id,
           a.status as application_status,
           r.scheduled_start_at,
           -- S11-1 (11): the request's state only for the caller's own selected pick; an unlocked pick always is.
           case when r.selected_application_id = a.id then r.status end as request_status,
           r.cash_due,
           s.name as service_name,
           f.id as fee_id,
           coalesce(f.amount, a.provider_fee_amount, 0) as fee_amount,
           case when fr.status in ('done', 'done_by_hand') then 'done'
                when fr.status in ('queued', 'failed') then 'pending'
                else 'none' end as refund_state,
           case when fr.status in ('done', 'done_by_hand') then fr.amount end as refund_amount
      from public.applications a
      join public.requests r on r.id = a.request_id
      join public.services s on s.id = r.service_id
      -- X-6: at most one provider fee row per request and provider (fee_payments_one_provider_fee_idx).
      left join public.fee_payments f
             on f.application_id = a.id and f.kind = 'provider_fee' and f.payer_id = v_me.id
            and f.status in ('paid', 'refunded')
      -- R-4: at most one refund per fee (fee_refunds_one_per_fee_idx).
      left join public.fee_refunds fr on fr.fee_payment_id = f.id and fr.kind = 'fee'
     where a.provider_id = v_me.id
       and a.region = v_me.region
       and a.unlocked_at is not null
       and r.scheduled_start_at >= v_from
       and r.scheduled_start_at < v_to
  ),
  numbered as (
    select b.*, row_number() over (order by b.scheduled_start_at desc, b.application_id desc) as rn from base b
  )
  select jsonb_build_object(
           'jobs', count(*),
           'fees_paid', coalesce(sum(n.fee_amount), 0)::bigint,
           'refunds', coalesce(sum(n.refund_amount), 0)::bigint,
           'net_fees', (coalesce(sum(n.fee_amount), 0) - coalesce(sum(n.refund_amount), 0))::bigint,
           'cash_closed', coalesce(sum(n.cash_due) filter (where n.request_status = 'COMPLETED'), 0)::bigint),
         coalesce(jsonb_agg(jsonb_build_object(
           'application_id', n.application_id,
           'request_id', n.request_id,
           'scheduled_start_at', n.scheduled_start_at,
           'service_name', n.service_name,
           'application_status', n.application_status,
           'request_status', n.request_status,
           'cash_due', n.cash_due,
           'fee_amount', n.fee_amount,
           'receipt_id', n.fee_id,
           'refund_state', n.refund_state,
           'refund_amount', n.refund_amount) order by n.rn) filter (where n.rn <= 200), '[]'::jsonb),
         count(*) > 200
    into v_totals, v_rows, v_truncated
    from numbered n;

  return jsonb_build_object(
    'month', to_jsonb(v_month),
    'timezone', v_tz,
    'currency', v_currency,
    'months', v_months,
    'totals', v_totals,
    'truncated', v_truncated,
    'rows', v_rows);
end;
$$;

revoke all on function public.provider_history(date) from public, anon, authenticated, service_role;
grant execute on function public.provider_history(date) to authenticated;

comment on function public.provider_history(date) is
  'Spec 0011-15: the caller''s own unlocked jobs of one month (by scheduled start in the region''s time zone), each '
  'with its cash, fee and refund, plus whole month totals; read only, at most 200 rows, no contact data.';
