-- Position 17 (spec 0011-17, D205): ratings, optional, never gating anything (D4).
--
-- After a job is COMPLETED with an unlocked pick, its customer may rate the provider once, within rating_window_days
-- of the close, on four scores from 1 to 5 (rate_provider). The score customers see is computed every time it is read
-- (provider_rating_summary): shrunk toward the region mean with weight rating_prior_weight, each rating weighted by its
-- age with half life rating_half_life_days, and shown only from rating_min_count ratings on. Nothing stores it, so it
-- always equals what the rows say. Admin may hide a rating with a reason and a note (admin_hide_rating); a hide is its
-- own append only row and is final. No score is ever changed.
--
-- Two tables (ratings, rating_hides): RLS on, a deny policy, no API grant, and an append only trigger for every role
-- (the ledger's pattern, 07). Every read and write goes through a definer function that checks auth.uid() or
-- is_admin(). No column is added to any existing table and no status gains a value: a rating is its own row, which
-- is what keeps D4 true (supabase/tests/35 proves nothing else reads the two tables).
--
-- Lock order (D169): the requests row first, always.
--
-- Replaced, bodies copied from their latest migration plus the change named at each: pricing_settings_guard (14),
-- offer_card (06), queue_email, email_context, queue_audit_email and the audit_log_email trigger (0012).
--
-- Every function revokes PUBLIC and pins search_path (supabase/tests/02). Refusals are stable codes in the exception
-- message; the doors map them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Settings (AC-10). Seeded for both regions, held to whole numbers, required by the guard, read by one fail
--    closed reader.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_rating_window_days_valid check (
    case when key <> 'rating_window_days' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 90 end),
  add constraint platform_settings_rating_min_count_valid check (
    case when key <> 'rating_min_count' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 5 and 50 end),
  add constraint platform_settings_rating_prior_weight_valid check (
    case when key <> 'rating_prior_weight' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 50 end),
  add constraint platform_settings_rating_half_life_days_valid check (
    case when key <> 'rating_half_life_days' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 30 and 3650 end);

insert into public.platform_settings (region, key, value) values
  ('TR',  'rating_window_days',    '14'),
  ('KSA', 'rating_window_days',    '14'),
  ('TR',  'rating_min_count',      '5'),
  ('KSA', 'rating_min_count',      '5'),
  ('TR',  'rating_prior_weight',   '5'),
  ('KSA', 'rating_prior_weight',   '5'),
  ('TR',  'rating_half_life_days', '365'),
  ('KSA', 'rating_half_life_days', '365')
on conflict (region, key) do nothing;

-- 14's list plus the four rating keys.
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
                 'confirm_reminder_hours',
                 'report_window_days', 'reports_per_user_day',
                 'rating_window_days', 'rating_min_count', 'rating_prior_weight', 'rating_half_life_days')
     and (tg_op = 'DELETE' or new.key is distinct from old.key or new.region is distinct from old.region) then
    raise exception 'pricing_setting_required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.pricing_settings_guard() from public, anon, authenticated, service_role;

-- AC-10: the four rating settings of a region, or rating_settings_invalid when one is missing or malformed.
create function public.rating_settings(p_region text)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_window  jsonb;
  v_min     jsonb;
  v_prior   jsonb;
  v_half    jsonb;
begin
  select s.value into v_window from public.platform_settings s where s.region = p_region and s.key = 'rating_window_days';
  select s.value into v_min from public.platform_settings s where s.region = p_region and s.key = 'rating_min_count';
  select s.value into v_prior from public.platform_settings s where s.region = p_region and s.key = 'rating_prior_weight';
  select s.value into v_half from public.platform_settings s where s.region = p_region and s.key = 'rating_half_life_days';
  if jsonb_typeof(v_window) is distinct from 'number'
     or (v_window #>> '{}')::numeric <> trunc((v_window #>> '{}')::numeric)
     or (v_window #>> '{}')::numeric not between 1 and 90
     or jsonb_typeof(v_min) is distinct from 'number'
     or (v_min #>> '{}')::numeric <> trunc((v_min #>> '{}')::numeric)
     or (v_min #>> '{}')::numeric not between 5 and 50
     or jsonb_typeof(v_prior) is distinct from 'number'
     or (v_prior #>> '{}')::numeric <> trunc((v_prior #>> '{}')::numeric)
     or (v_prior #>> '{}')::numeric not between 1 and 50
     or jsonb_typeof(v_half) is distinct from 'number'
     or (v_half #>> '{}')::numeric <> trunc((v_half #>> '{}')::numeric)
     or (v_half #>> '{}')::numeric not between 30 and 3650 then
    raise exception 'rating_settings_invalid';
  end if;
  return jsonb_build_object('rating_window_days', (v_window #>> '{}')::integer,
                            'rating_min_count', (v_min #>> '{}')::integer,
                            'rating_prior_weight', (v_prior #>> '{}')::integer,
                            'rating_half_life_days', (v_half #>> '{}')::integer);
end;
$$;

revoke all on function public.rating_settings(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The tables (AC-2). RLS on, a deny policy (test 00 wants one on every RLS table), no API grant, append only.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.ratings (
  id               uuid        primary key default gen_random_uuid(),
  region           text        not null references public.regions (code) on delete restrict,
  request_id       uuid        not null unique references public.requests (id) on delete restrict,
  application_id   uuid        not null references public.applications (id) on delete restrict,
  provider_id      uuid        not null references public.providers (id) on delete restrict,
  customer_id      uuid        not null references public.profiles (id) on delete restrict,
  punctuality      smallint    not null,
  quality          smallint    not null,
  professionalism  smallint    not null,
  value            smallint    not null,
  created_at       timestamptz not null default now(),

  constraint ratings_punctuality_valid check (punctuality between 1 and 5),
  constraint ratings_quality_valid check (quality between 1 and 5),
  constraint ratings_professionalism_valid check (professionalism between 1 and 5),
  constraint ratings_value_valid check (value between 1 and 5)
);

alter table public.ratings enable row level security;
create policy ratings_no_api on public.ratings for select to authenticated using (false);
revoke all on table public.ratings from anon, authenticated, service_role;

-- The summary and the admin list read a provider's ratings newest first; the region mean reads a region's.
create index ratings_provider_idx on public.ratings (provider_id, created_at desc);
create index ratings_region_idx on public.ratings (region);
create index ratings_application_idx on public.ratings (application_id);
create index ratings_customer_idx on public.ratings (customer_id);

create table public.rating_hides (
  rating_id   uuid        primary key references public.ratings (id) on delete restrict,
  region      text        not null references public.regions (code) on delete restrict,
  reason      text        not null,
  note        text        not null,
  hidden_by   uuid        not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),

  constraint rating_hides_reason_valid check (reason in ('fake', 'pressure', 'customer_asked', 'other')),
  constraint rating_hides_note_size check (note = btrim(note) and char_length(note) between 1 and 500)
);

alter table public.rating_hides enable row level security;
create policy rating_hides_no_api on public.rating_hides for select to authenticated using (false);
revoke all on table public.rating_hides from anon, authenticated, service_role;

create index rating_hides_region_idx on public.rating_hides (region);
create index rating_hides_hidden_by_idx on public.rating_hides (hidden_by);

-- AC-2, rule 5: no update, delete or truncate, ever, for every role. A correction is a hide, never an edit.
create function public.rating_append_only()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  raise exception 'rating_append_only';
end;
$$;

revoke all on function public.rating_append_only() from public, anon, authenticated, service_role;

create trigger ratings_append_only before update or delete on public.ratings
  for each row execute function public.rating_append_only();
create trigger ratings_no_truncate before truncate on public.ratings
  for each statement execute function public.rating_append_only();
create trigger rating_hides_append_only before update or delete on public.rating_hides
  for each row execute function public.rating_append_only();
create trigger rating_hides_no_truncate before truncate on public.rating_hides
  for each statement execute function public.rating_append_only();

-- Security review guardrail (2026-11-22): a rating row always matches its request, for every role, the SQL editor
-- included: the request's region and customer, its selected application, and that application's provider and region.
-- A hide always carries its rating's region. So the region mean of a rated provider is never null.
alter table public.ratings
  add constraint ratings_id_region unique (id, region),
  add constraint ratings_request_region_customer_fk foreign key (request_id, region, customer_id)
    references public.requests (id, region, customer_id) on delete restrict,
  add constraint ratings_application_request_fk foreign key (application_id, request_id)
    references public.applications (id, request_id) on delete restrict;
alter table public.rating_hides
  add constraint rating_hides_rating_region_fk foreign key (rating_id, region)
    references public.ratings (id, region) on delete restrict;

create function public.rating_consistent()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if not exists (select 1
                   from public.requests r
                   join public.applications a on a.id = r.selected_application_id
                  where r.id = new.request_id and a.id = new.application_id
                    and a.provider_id = new.provider_id and a.region = new.region) then
    raise exception 'validation_failed';
  end if;
  return new;
end;
$$;

revoke all on function public.rating_consistent() from public, anon, authenticated, service_role;

create trigger ratings_consistent before insert on public.ratings
  for each row execute function public.rating_consistent();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The score (AC-4). Internal, no grant: called from the definer functions below and from offer_card.
-- ═══════════════════════════════════════════════════════════════════════════

-- (C × M + Σ wᵢrᵢ) / (C + Σ wᵢ) per dimension and overall, over the provider's visible ratings; M the region mean;
-- wᵢ = 0.5 ^ (age in days / half life). numeric throughout, rounded once. A broken setting is `unavailable`, caught
-- here because offer_card is plain SQL and cannot.
create function public.provider_rating_summary(p_provider_id uuid)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_region  text;
  v_set     jsonb;
  v_c       numeric;
  v_half    numeric;
  v_count   integer;
  v_m       record;
  v_s       record;
begin
  select pr.region into v_region from public.providers pr where pr.id = p_provider_id;
  if not found then
    return jsonb_build_object('state', 'new', 'count', 0);
  end if;
  begin
    v_set := public.rating_settings(v_region);
  exception when raise_exception then
    if sqlerrm = 'rating_settings_invalid' then
      return jsonb_build_object('state', 'unavailable');
    end if;
    raise;
  end;

  select count(*)::integer into v_count
    from public.ratings r
   where r.provider_id = p_provider_id
     and not exists (select 1 from public.rating_hides h where h.rating_id = r.id);
  if v_count < (v_set ->> 'rating_min_count')::integer then
    return jsonb_build_object('state', 'new', 'count', v_count);
  end if;

  v_c := (v_set ->> 'rating_prior_weight')::numeric;
  v_half := (v_set ->> 'rating_half_life_days')::numeric;

  -- M: the region mean of each dimension; overall, the mean of the per rating means.
  select avg(r.punctuality::numeric) as punctuality,
         avg(r.quality::numeric) as quality,
         avg(r.professionalism::numeric) as professionalism,
         avg(r.value::numeric) as value,
         avg((r.punctuality + r.quality + r.professionalism + r.value)::numeric / 4) as overall
    into v_m
    from public.ratings r
   where r.region = v_region
     and not exists (select 1 from public.rating_hides h where h.rating_id = r.id);

  -- Σ wᵢ and Σ wᵢrᵢ. The age is never below 0, so no weight passes 1.
  select sum(w.w) as sw,
         sum(w.w * w.punctuality) as punctuality,
         sum(w.w * w.quality) as quality,
         sum(w.w * w.professionalism) as professionalism,
         sum(w.w * w.value) as value,
         sum(w.w * (w.punctuality + w.quality + w.professionalism + w.value)::numeric / 4) as overall
    into v_s
    from (select power(0.5::numeric,
                       greatest(extract(epoch from now() - r.created_at), 0::numeric) / 86400.0 / v_half) as w,
                 r.punctuality, r.quality, r.professionalism, r.value
            from public.ratings r
           where r.provider_id = p_provider_id
             and not exists (select 1 from public.rating_hides h where h.rating_id = r.id)) w;

  return jsonb_build_object(
    'state', 'rated',
    'count', v_count,
    'overall', round((v_c * v_m.overall + v_s.overall) / (v_c + v_s.sw), 1),
    'punctuality', round((v_c * v_m.punctuality + v_s.punctuality) / (v_c + v_s.sw), 1),
    'quality', round((v_c * v_m.quality + v_s.quality) / (v_c + v_s.sw), 1),
    'professionalism', round((v_c * v_m.professionalism + v_s.professionalism) / (v_c + v_s.sw), 1),
    'value', round((v_c * v_m.value + v_s.value) / (v_c + v_s.sw), 1));
end;
$$;

revoke all on function public.provider_rating_summary(uuid) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The customer (AC-1, AC-6).
-- ═══════════════════════════════════════════════════════════════════════════

-- AC-1: one rating per request, by its customer, while COMPLETED with an unlocked pick and inside the window. Region,
-- provider, application and customer come from the request, never from the caller. Changes no other table but
-- audit_log (AC-3).
create function public.rate_provider(p_request_id uuid, p_punctuality integer, p_quality integer,
                                     p_professionalism integer, p_value integer)
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
  v_set   jsonb;
  v_id    uuid;
begin
  if p_request_id is null or v_uid is null then
    raise exception 'not_found';
  end if;
  -- The request row first (D169); someone else's request is never locked. Security review I-1 (2026-11-22): only a
  -- customer, so an account promoted to admin later never rates its own old jobs.
  select r.* into v_req from public.requests r
   where r.id = p_request_id and r.customer_id = v_uid
     and exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'customer')
     for update of r;
  if not found then
    raise exception 'not_found';
  end if;
  select a.* into v_app from public.applications a where a.id = v_req.selected_application_id;
  if v_req.status <> 'COMPLETED' or v_req.closed_at is null or v_app.id is null or v_app.unlocked_at is null then
    raise exception 'invalid_state';
  end if;
  if exists (select 1 from public.ratings r where r.request_id = v_req.id) then
    raise exception 'already_rated';
  end if;
  v_set := public.rating_settings(v_req.region);
  -- Whole hours, so a clock change never moves the end.
  if now() > v_req.closed_at + make_interval(hours => 24 * (v_set ->> 'rating_window_days')::integer) then
    raise exception 'deadline_passed';
  end if;
  if p_punctuality is null or p_quality is null or p_professionalism is null or p_value is null
     or p_punctuality not between 1 and 5 or p_quality not between 1 and 5
     or p_professionalism not between 1 and 5 or p_value not between 1 and 5 then
    raise exception 'validation_failed';
  end if;

  begin
    insert into public.ratings (region, request_id, application_id, provider_id, customer_id, punctuality, quality,
                                professionalism, value)
    values (v_req.region, v_req.id, v_app.id, v_app.provider_id, v_req.customer_id, p_punctuality, p_quality,
            p_professionalism, p_value)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'already_rated';
  end;
  -- Ids only, no score: 13's trigger finds the provider from application_id and never reads ratings.
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'rating.created', 'requests', v_req.id::text, v_req.region, null,
          jsonb_build_object('application_id', v_app.id, 'rating_id', v_id));
  return jsonb_build_object('rating_id', v_id);
end;
$$;

revoke all on function public.rate_provider(uuid, integer, integer, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.rate_provider(uuid, integer, integer, integer, integer) to authenticated;

-- AC-6: what the request page's rating section needs, for the request's customer only (null otherwise).
create function public.request_rating(p_request_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_req     public.requests%rowtype;
  v_tz      text;
  v_set     jsonb;
  v_until   timestamptz;
  v_rating  jsonb;
  v_open    boolean;
begin
  select r.* into v_req from public.requests r
   where r.id = p_request_id and r.customer_id = (select auth.uid());
  if not found then
    return null;
  end if;
  select g.timezone into v_tz from public.regions g where g.code = v_req.region;
  select jsonb_build_object('punctuality', x.punctuality, 'quality', x.quality, 'professionalism', x.professionalism,
                            'value', x.value, 'created_at', x.created_at)
    into v_rating
    from public.ratings x
   where x.request_id = v_req.id;

  v_open := v_req.status = 'COMPLETED' and v_req.closed_at is not null
            and exists (select 1 from public.applications a
                         where a.id = v_req.selected_application_id and a.unlocked_at is not null);
  if v_open then
    begin
      v_set := public.rating_settings(v_req.region);
      v_until := v_req.closed_at + make_interval(hours => 24 * (v_set ->> 'rating_window_days')::integer);
    exception when raise_exception then
      if sqlerrm <> 'rating_settings_invalid' then
        raise;
      end if;
      v_until := null;
    end;
  end if;

  return jsonb_build_object(
    'can_rate', v_open and v_rating is null and v_until is not null and now() <= v_until,
    'rate_until', v_until,
    'timezone', v_tz,
    'rating', v_rating);
end;
$$;

revoke all on function public.request_rating(uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_rating(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The provider (AC-7): only their own summary, never a rating, a date, a request or a customer.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.my_provider_rating()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_me  public.providers%rowtype;
begin
  v_me := public.provider_reader();
  return public.provider_rating_summary(v_me.id);
end;
$$;

revoke all on function public.my_provider_rating() from public, anon, authenticated, service_role;
grant execute on function public.my_provider_rating() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Admin (AC-8): every rating of a provider with its request id, and the hide.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.admin_provider_ratings(p_provider_id uuid, p_page integer)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_region  text;
  v_tz      text;
  v_total   integer;
  v_rows    jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_page is null or p_page < 1 or p_page > 10000 then
    raise exception 'validation_failed';
  end if;
  select pr.region into v_region from public.providers pr where pr.id = p_provider_id;
  if not found then
    raise exception 'not_found';
  end if;
  select g.timezone into v_tz from public.regions g where g.code = v_region;
  select count(*)::integer into v_total from public.ratings r where r.provider_id = p_provider_id;
  select coalesce(jsonb_agg(t.row_json order by t.created_at desc, t.id), '[]'::jsonb) into v_rows
    from (select r.id, r.created_at,
                 jsonb_build_object(
                   'id', r.id, 'created_at', r.created_at, 'request_id', r.request_id,
                   'punctuality', r.punctuality, 'quality', r.quality, 'professionalism', r.professionalism,
                   'value', r.value,
                   'hide', case when h.rating_id is null then null
                                else jsonb_build_object('reason', h.reason, 'note', h.note,
                                                        'hidden_by_name', p.full_name, 'hidden_at', h.created_at) end)
                   as row_json
            from public.ratings r
            left join public.rating_hides h on h.rating_id = r.id
            left join public.profiles p on p.id = h.hidden_by
           where r.provider_id = p_provider_id
           order by r.created_at desc, r.id
           limit 20 offset (p_page - 1) * 20) t;
  return jsonb_build_object('summary', public.provider_rating_summary(p_provider_id), 'total', v_total,
                            'timezone', v_tz, 'rows', v_rows);
end;
$$;

revoke all on function public.admin_provider_ratings(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_provider_ratings(uuid, integer) to authenticated;

create function public.admin_hide_rating(p_rating_id uuid, p_reason text, p_note text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_note    text := btrim(coalesce(p_note, ''));
  v_rating  public.ratings%rowtype;
  v_at      timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_reason is null or p_reason not in ('fake', 'pressure', 'customer_asked', 'other')
     or char_length(v_note) not between 1 and 500 then
    raise exception 'validation_failed';
  end if;
  select r.* into v_rating from public.ratings r where r.id = p_rating_id;
  if not found then
    raise exception 'not_found';
  end if;
  -- The request row first (D169).
  perform 1 from public.requests q where q.id = v_rating.request_id for update;
  if exists (select 1 from public.rating_hides h where h.rating_id = v_rating.id) then
    raise exception 'already_hidden';
  end if;
  begin
    insert into public.rating_hides (rating_id, region, reason, note, hidden_by)
    values (v_rating.id, v_rating.region, p_reason, v_note, v_uid)
    returning created_at into v_at;
  exception when unique_violation then
    raise exception 'already_hidden';
  end;
  -- No mail hangs on it: rating.hidden is not in the audit_log_email trigger's list.
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'rating.hidden', 'ratings', v_rating.id::text, v_rating.region, null,
          jsonb_build_object('reason', p_reason, 'note', v_note));
  return jsonb_build_object('hidden_at', v_at);
end;
$$;

revoke all on function public.admin_hide_rating(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_hide_rating(uuid, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The offer card (AC-5): 06's body plus `rating`, so request_offers (its only caller) returns it unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.offer_card(p_application public.applications, p_timezone text)
  returns jsonb
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select jsonb_build_object(
           'application_id', (p_application).id,
           'approved_since', to_char(date_trunc('month', pr.approved_at at time zone p_timezone), 'YYYY-MM-DD'),
           'message', case when public.message_has_contact_info((p_application).message) then null
                           else (p_application).message end,
           'message_hidden', public.message_has_contact_info((p_application).message),
           'created_at', (p_application).created_at,
           'rating', public.provider_rating_summary(pr.id))
         || public.offer_display_name(pr.approved_name)
    from public.providers pr
   where pr.id = (p_application).provider_id
$$;

revoke all on function public.offer_card(public.applications, text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Mail (AC-9): 0012's functions, replaced, each with the change named.
-- ═══════════════════════════════════════════════════════════════════════════

-- The template list gains rate_provider and rating_received.
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
                           'report_received', 'report_new_admin', 'report_handled', 'password_changed',
                           'rate_provider', 'rating_received') then
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

-- A rate_provider case (no rating yet, still COMPLETED, the window recomputed from the current setting still open;
-- its values add the provider's display name, and the window's end as the deadline) and a rating_received case (no
-- condition).
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

-- 0012's map plus rate_provider to the customer of a job closed by itself or by admin (a customer who just confirmed
-- or closed the job is looking at the form already), and rating.created to the provider.
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
  v_rate    timestamptz;
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
      -- AC-9 of 0011-17: the rating invite, until the window's end. A broken rating setting skips the invite only,
      -- never the provider's mail above.
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
          v_n := v_n + public.queue_audit_mail(v_a.id, v_a.region, v_req.customer_id, 'rate_provider', v_req.id, v_app,
                                               v_rate, 'ratings');
        end if;
      end if;
    when 'rating.created' then
      -- AC-9 of 0011-17: the provider, at once; only that a rating arrived, never the score.
      v_n := public.queue_audit_mail(v_a.id, v_a.region, v_prov, 'rating_received', v_req.id, v_app, v_day, 'ratings');
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

-- AC-3 of 13, R-8, X-15 of 14, X-10 of 16, AC-10 of 0012, AC-9 of 0011-17: the when list is the map's actions;
-- supabase/tests/29 proves the two are equal.
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
                       'auth.password_set', 'auth.password_changed', 'rating.created'))
  execute function public.audit_log_email();
