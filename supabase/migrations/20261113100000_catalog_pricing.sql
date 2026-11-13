-- Position 03 (spec 0007): the catalog and the pricing engine.
--
-- Admin builds the catalog as data: categories, services, addons, zones and questions, written
-- straight under RLS with one audit trigger, and one price formula per service, published through
-- one function so a published version never changes. The price is computed here, in Postgres, from
-- the customer's answers (D121): a hostile browser can call the database directly, and position 04's
-- create_request needs the price inside its own transaction. The engine stops at the job price; the
-- commission and the provider fee land in 07.
--
-- Nothing is seeded but the rounding setting: the owner enters real data (S17).
--
-- Order below: helpers the checks call -> tables -> RLS -> policies -> indexes -> grants -> triggers
-- -> the engine -> publish and preview -> settings. Every function revokes PUBLIC and pins
-- search_path (supabase/tests/02). Refusals are stable codes in the exception message;
-- lib/pricing and actions/admin-catalog.ts map them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The two check helpers (AC-2, AC-3). A check runs as the caller, so the caller needs the grant:
--    both are immutable, read nothing and reveal nothing. A check passes on null, so each returns
--    coalesce(…, false). The blank pattern (whitespace, NBSP, zero width) is written out in each,
--    because a check may only call what the caller can run.
-- ═══════════════════════════════════════════════════════════════════════════

-- Localised text: { "ar": …, "tr": …, "en": … }. The region's default locale is required (TR tr,
-- KSA ar; supabase/tests/09 proves this map equals regions.default_locale), the others optional.
-- Each value is a string that is not blank and at most p_max code points after trim.
create function public.catalog_text_ok(p_value jsonb, p_region text, p_max integer)
  returns boolean
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_value) = 'object'
    and p_value ? (case p_region when 'TR' then 'tr' when 'KSA' then 'ar' end)
    and not exists (
      select 1
        from jsonb_each(p_value) e
       where e.key not in ('ar', 'tr', 'en')
          or jsonb_typeof(e.value) <> 'string'
          or char_length(regexp_replace(e.value #>> '{}',
               '^[\s   -‍    ⁠　﻿]+|[\s   -‍    ⁠　﻿]+$',
               '', 'g')) not between 1 and p_max
    ),
    false)
$$;

revoke all on function public.catalog_text_ok(jsonb, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.catalog_text_ok(jsonb, text, integer) to authenticated;

-- The shape of a question's options and validation, by type (spec 0007, Question types).
create function public.question_shape_ok(p_type text, p_options jsonb, p_validation jsonb, p_region text)
  returns boolean
  language plpgsql
  immutable
  security invoker
  set search_path = ''
as $$
declare
  v_max integer;
begin
  if p_type = 'number' then
    return coalesce(
      p_options is null
      and jsonb_typeof(p_validation) = 'object'
      and (select count(*) from jsonb_object_keys(p_validation) k) = 3
      and jsonb_typeof(p_validation -> 'min') = 'number'
      and jsonb_typeof(p_validation -> 'max') = 'number'
      and jsonb_typeof(p_validation -> 'step') = 'number'
      and (p_validation ->> 'min')::numeric = trunc((p_validation ->> 'min')::numeric)
      and (p_validation ->> 'max')::numeric = trunc((p_validation ->> 'max')::numeric)
      and (p_validation ->> 'step')::numeric = trunc((p_validation ->> 'step')::numeric)
      and (p_validation ->> 'min')::numeric >= 0
      and (p_validation ->> 'min')::numeric <= (p_validation ->> 'max')::numeric
      and (p_validation ->> 'max')::numeric <= 10000
      and (p_validation ->> 'step')::numeric >= 1,
      false);
  elsif p_type in ('single_select', 'multi_select') then
    return coalesce(
      p_validation is null
      and jsonb_typeof(p_options) = 'array'
      and jsonb_array_length(p_options) between 1 and 30
      and not exists (
        select 1
          from jsonb_array_elements(p_options) o
         where jsonb_typeof(o) <> 'object'
            or (select count(*) from jsonb_object_keys(o) k) <> 2
            or jsonb_typeof(o -> 'value') <> 'string'
            or (o ->> 'value') !~ '^[a-z0-9_]{1,40}$'
            or not coalesce(public.catalog_text_ok(o -> 'label', p_region, 120), false)
      )
      and (select count(distinct o ->> 'value') from jsonb_array_elements(p_options) o)
          = jsonb_array_length(p_options),
      false);
  elsif p_type in ('text', 'textarea') then
    v_max := case p_type when 'text' then 500 else 2000 end;
    return coalesce(
      p_options is null
      and (p_validation is null
           or (jsonb_typeof(p_validation) = 'object'
               and (select count(*) from jsonb_object_keys(p_validation) k) = 1
               and jsonb_typeof(p_validation -> 'maxLength') = 'number'
               and (p_validation ->> 'maxLength')::numeric = trunc((p_validation ->> 'maxLength')::numeric)
               and (p_validation ->> 'maxLength')::numeric between 1 and v_max)),
      false);
  elsif p_type in ('boolean', 'date', 'time') then
    return p_options is null and p_validation is null;
  end if;
  return false;
end;
$$;

revoke all on function public.question_shape_ok(text, jsonb, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.question_shape_ok(text, jsonb, jsonb, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The seven tables (AC-1). Every row belongs to one region, and a child names its parent with the
--    region in the key, so it can never name a parent of another region. All references restrict:
--    nothing here is ever deleted. The five catalog rows start off, so nothing reaches a customer
--    until admin turns it on.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.service_categories (
  id             uuid primary key default gen_random_uuid(),
  region         text        not null references public.regions (code) on delete restrict,
  name           jsonb       not null,
  display_order  integer     not null default 0,
  active         boolean     not null default false,
  created_at     timestamptz not null default now(),

  constraint service_categories_id_region unique (id, region),
  constraint service_categories_name_ok check (public.catalog_text_ok(name, region, 120))
);

create table public.services (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid        not null,
  region         text        not null references public.regions (code) on delete restrict,
  name           jsonb       not null,
  note           jsonb,
  hours_min      smallint    not null,
  hours_max      smallint    not null,
  display_order  integer     not null default 0,
  active         boolean     not null default false,
  created_at     timestamptz not null default now(),

  constraint services_id_region unique (id, region),
  constraint services_id_category unique (id, category_id),
  constraint services_category_fk foreign key (category_id, region)
    references public.service_categories (id, region) on delete restrict,
  constraint services_name_ok check (public.catalog_text_ok(name, region, 120)),
  constraint services_note_ok check (note is null or public.catalog_text_ok(note, region, 120)),
  constraint services_hours check (1 <= hours_min and hours_min <= hours_max and hours_max <= 24)
);

create table public.addons (
  id             uuid primary key default gen_random_uuid(),
  service_id     uuid        not null,
  region         text        not null references public.regions (code) on delete restrict,
  name           jsonb       not null,
  -- Minor units (rule 4).
  price          bigint      not null,
  display_order  integer     not null default 0,
  active         boolean     not null default false,
  created_at     timestamptz not null default now(),

  constraint addons_service_fk foreign key (service_id, region)
    references public.services (id, region) on delete restrict,
  constraint addons_name_ok check (public.catalog_text_ok(name, region, 120)),
  constraint addons_price_range check (price between 1 and 100000000)
);

create table public.zones (
  id             uuid primary key default gen_random_uuid(),
  region         text        not null references public.regions (code) on delete restrict,
  name           jsonb       not null,
  multiplier     numeric(3,2) not null default 1,
  display_order  integer     not null default 0,
  active         boolean     not null default false,
  created_at     timestamptz not null default now(),

  constraint zones_name_ok check (public.catalog_text_ok(name, region, 120)),
  constraint zones_multiplier_range check (multiplier between 0.50 and 2.00)
);

create table public.questions (
  id               uuid primary key default gen_random_uuid(),
  category_id      uuid        not null,
  -- Null: asked for every service of the category. Set: asked for that service only.
  service_id       uuid,
  region           text        not null references public.regions (code) on delete restrict,
  -- collate "C": an identifier never folds under a Turkish locale (rule 10).
  key              text collate "C" not null,
  label            jsonb       not null,
  help_text        jsonb,
  type             text        not null,
  required         boolean     not null default false,
  affects_pricing  boolean     not null default false,
  options          jsonb,
  validation       jsonb,
  display_order    integer     not null default 0,
  active           boolean     not null default false,
  created_at       timestamptz not null default now(),

  -- Unique with retired keys included: a key means one thing in a category, forever (AC-3).
  constraint questions_key_unique unique (category_id, key),
  constraint questions_category_fk foreign key (category_id, region)
    references public.service_categories (id, region) on delete restrict,
  -- The service must be of the same category, so of the same region too.
  constraint questions_service_fk foreign key (service_id, category_id)
    references public.services (id, category_id) on delete restrict,
  constraint questions_key_format check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint questions_type_valid check (type in ('number', 'single_select', 'multi_select', 'boolean',
                                                  'text', 'textarea', 'date', 'time')),
  constraint questions_text_never_prices check (not (affects_pricing and type in ('text', 'textarea', 'date', 'time'))),
  constraint questions_label_ok check (public.catalog_text_ok(label, region, 120)),
  constraint questions_help_ok check (help_text is null or public.catalog_text_ok(help_text, region, 300)),
  constraint questions_shape_ok check (public.question_shape_ok(type, options, validation, region))
);

create table public.pricing_formulas (
  id           uuid primary key default gen_random_uuid(),
  service_id   uuid        not null,
  region       text        not null references public.regions (code) on delete restrict,
  version      integer     not null,
  -- Minor units (rule 4).
  base_price   bigint      not null,
  active       boolean     not null default false,
  -- auth.uid() of the publishing admin. No foreign key: history outlives users.
  created_by   uuid,
  created_at   timestamptz not null default now(),

  constraint pricing_formulas_id_region unique (id, region),
  constraint pricing_formulas_version_unique unique (service_id, version),
  constraint pricing_formulas_service_fk foreign key (service_id, region)
    references public.services (id, region) on delete restrict,
  constraint pricing_formulas_version_valid check (version >= 1),
  constraint pricing_formulas_base_range check (base_price between 1 and 100000000)
);

create table public.pricing_modifiers (
  id            uuid primary key default gen_random_uuid(),
  formula_id    uuid        not null,
  region        text        not null references public.regions (code) on delete restrict,
  apply_order   integer     not null,
  question_key  text collate "C",
  match_type    text        not null,
  match_value   jsonb,
  effect_type   text        not null,
  -- Minor units: FIXED (negative for a discount) and PER_UNIT.
  amount        bigint,
  factor        numeric(6,4),
  created_at    timestamptz not null default now(),

  constraint pricing_modifiers_order_unique unique (formula_id, apply_order),
  constraint pricing_modifiers_formula_fk foreign key (formula_id, region)
    references public.pricing_formulas (id, region) on delete restrict,
  constraint pricing_modifiers_order_valid check (apply_order >= 1),
  constraint pricing_modifiers_match_valid check (match_type in ('equals', 'in', 'range', 'is_true', 'always')),
  constraint pricing_modifiers_effect_valid check (effect_type in ('FIXED', 'PER_UNIT', 'MULTIPLIER')),
  constraint pricing_modifiers_key_or_always check (question_key is not null or match_type = 'always'),
  constraint pricing_modifiers_amount_or_factor check (
    (effect_type = 'MULTIPLIER' and amount is null and factor between 0.1 and 10)
    or (effect_type = 'FIXED' and factor is null and amount between -100000000 and 100000000 and amount <> 0)
    or (effect_type = 'PER_UNIT' and factor is null and amount between 1 and 100000000)
  )
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RLS (rule 7, AC-14). Admin reads all seven and writes the five catalog tables; everyone else
--    reads and writes nothing directly (04 opens its own read path). No delete policy anywhere, and
--    no write policy on the two pricing tables: publish_pricing_formula is their only writer.
--    Admin is decided through is_admin(), in a subselect so it runs once per query (D116).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.addons enable row level security;
alter table public.zones enable row level security;
alter table public.questions enable row level security;
alter table public.pricing_formulas enable row level security;
alter table public.pricing_modifiers enable row level security;

create policy service_categories_read_admin on public.service_categories for select to authenticated
  using ((select public.is_admin()));
create policy service_categories_insert_admin on public.service_categories for insert to authenticated
  with check ((select public.is_admin()));
create policy service_categories_update_admin on public.service_categories for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy services_read_admin on public.services for select to authenticated
  using ((select public.is_admin()));
create policy services_insert_admin on public.services for insert to authenticated
  with check ((select public.is_admin()));
create policy services_update_admin on public.services for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy addons_read_admin on public.addons for select to authenticated
  using ((select public.is_admin()));
create policy addons_insert_admin on public.addons for insert to authenticated
  with check ((select public.is_admin()));
create policy addons_update_admin on public.addons for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy zones_read_admin on public.zones for select to authenticated
  using ((select public.is_admin()));
create policy zones_insert_admin on public.zones for insert to authenticated
  with check ((select public.is_admin()));
create policy zones_update_admin on public.zones for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy questions_read_admin on public.questions for select to authenticated
  using ((select public.is_admin()));
create policy questions_insert_admin on public.questions for insert to authenticated
  with check ((select public.is_admin()));
create policy questions_update_admin on public.questions for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy pricing_formulas_read_admin on public.pricing_formulas for select to authenticated
  using ((select public.is_admin()));

create policy pricing_modifiers_read_admin on public.pricing_modifiers for select to authenticated
  using ((select public.is_admin()));

-- Every foreign key has a covering index, and region has one on each table.
create index service_categories_region_idx on public.service_categories (region);
create index services_category_idx on public.services (category_id, region);
create index services_region_idx on public.services (region);
create index addons_service_idx on public.addons (service_id, region);
create index addons_region_idx on public.addons (region);
create index zones_region_idx on public.zones (region);
create index questions_category_idx on public.questions (category_id, region);
create index questions_service_idx on public.questions (service_id, category_id);
create index questions_region_idx on public.questions (region);
create index pricing_formulas_service_idx on public.pricing_formulas (service_id, region);
create index pricing_formulas_region_idx on public.pricing_formulas (region);
-- At most one active formula per service.
create unique index pricing_formulas_one_active on public.pricing_formulas (service_id) where active;
create index pricing_modifiers_formula_idx on public.pricing_modifiers (formula_id, region);
create index pricing_modifiers_region_idx on public.pricing_modifiers (region);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Grants (D77). Read: both API roles, through the policies above. Write: authenticated, on named
--    columns only. Insert: every column but id and created_at. Update: every column but those,
--    region, each parent id, and a question's key and type, so those never change through the API
--    (AC-3). No delete for anyone, and no API role, service_role included, writes the pricing tables.
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on table public.service_categories, public.services, public.addons, public.zones, public.questions,
                    public.pricing_formulas, public.pricing_modifiers
  from anon, authenticated, service_role;

grant select on table public.service_categories, public.services, public.addons, public.zones, public.questions,
                      public.pricing_formulas, public.pricing_modifiers
  to authenticated, service_role;

grant insert (region, name, display_order, active) on table public.service_categories to authenticated;
grant update (name, display_order, active) on table public.service_categories to authenticated;

grant insert (category_id, region, name, note, hours_min, hours_max, display_order, active)
  on table public.services to authenticated;
grant update (name, note, hours_min, hours_max, display_order, active) on table public.services to authenticated;

grant insert (service_id, region, name, price, display_order, active) on table public.addons to authenticated;
grant update (name, price, display_order, active) on table public.addons to authenticated;

grant insert (region, name, multiplier, display_order, active) on table public.zones to authenticated;
grant update (name, multiplier, display_order, active) on table public.zones to authenticated;

grant insert (category_id, service_id, region, key, label, help_text, type, required, affects_pricing, options,
              validation, display_order, active)
  on table public.questions to authenticated;
grant update (label, help_text, required, affects_pricing, options, validation, display_order, active)
  on table public.questions to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. catalog_audit() (AC-15): one trigger on the five catalog tables, so a change from the SQL editor
--    is recorded too. Definer, because authenticated cannot write audit_log. The comparison sits in
--    the body: a `when` clause naming old is refused on an insert trigger. A no change update writes
--    nothing.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.catalog_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
    values (auth.uid(), 'catalog.created', tg_table_name, v_new ->> 'id', v_new ->> 'region', null, v_new);
  else
    v_old := to_jsonb(old);
    if v_new is distinct from v_old then
      insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
      values (auth.uid(), 'catalog.updated', tg_table_name, v_new ->> 'id', v_new ->> 'region', v_old, v_new);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.catalog_audit() from public, anon, authenticated, service_role;

create trigger catalog_audit after insert or update on public.service_categories
  for each row execute function public.catalog_audit();
create trigger catalog_audit after insert or update on public.services
  for each row execute function public.catalog_audit();
create trigger catalog_audit after insert or update on public.addons
  for each row execute function public.catalog_audit();
create trigger catalog_audit after insert or update on public.zones
  for each row execute function public.catalog_audit();
create trigger catalog_audit after insert or update on public.questions
  for each row execute function public.catalog_audit();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. questions_guard() (AC-4): a question an active formula reads cannot be turned off, lose
--    affects_pricing, stop being required (a multi_select may be optional), or lose an option a
--    modifier matches. Volatile and row level, before update: its queries see a formula committed
--    while the update waited on the publish's `for share` lock.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.questions_guard()
  returns trigger
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_matched text[];
begin
  select coalesce(array_agg(distinct v.value), '{}')
    into v_matched
    from public.pricing_modifiers m
    join public.pricing_formulas f on f.id = m.formula_id and f.active
    join public.services s on s.id = f.service_id
    left join lateral (
      select m.match_value #>> '{}' as value where jsonb_typeof(m.match_value) = 'string'
      union all
      select e #>> '{}' from jsonb_array_elements(case when jsonb_typeof(m.match_value) = 'array'
                                                       then m.match_value else '[]'::jsonb end) e
    ) v on true
   where m.question_key = old.key
     and s.category_id = old.category_id
     and (old.service_id is null or s.id = old.service_id);

  -- No modifier row at all: not in use. The aggregate returns one row either way, so test the join.
  if not exists (
    select 1
      from public.pricing_modifiers m
      join public.pricing_formulas f on f.id = m.formula_id and f.active
      join public.services s on s.id = f.service_id
     where m.question_key = old.key
       and s.category_id = old.category_id
       and (old.service_id is null or s.id = old.service_id)
  ) then
    return new;
  end if;

  if (old.active and not new.active)
     or (old.affects_pricing and not new.affects_pricing)
     or (old.required and not new.required and new.type <> 'multi_select')
     or exists (
       select 1 from unnest(v_matched) mv
        where mv is not null
          and not exists (select 1 from jsonb_array_elements(coalesce(new.options, '[]'::jsonb)) o
                           where o ->> 'value' = mv)
     ) then
    raise exception 'question_in_use';
  end if;
  return new;
end;
$$;

revoke all on function public.questions_guard() from public, anon, authenticated, service_role;

create trigger questions_guard before update on public.questions
  for each row execute function public.questions_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. pricing_history_guard() (AC-12): a published formula and its modifiers never change, for any
--    role, the SQL editor included. The one move allowed is a formula's active going true to false,
--    with nothing else changed.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.pricing_history_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  -- Nested, because only a formula row has an active field to read.
  if tg_op = 'UPDATE' and tg_table_name = 'pricing_formulas' then
    if (to_jsonb(old) ->> 'active')::boolean and to_jsonb(new) = to_jsonb(old) || '{"active": false}'::jsonb then
      return new;
    end if;
  end if;
  raise exception 'pricing_history_immutable';
end;
$$;

revoke all on function public.pricing_history_guard() from public, anon, authenticated, service_role;

create trigger pricing_history_guard before update or delete on public.pricing_formulas
  for each row execute function public.pricing_history_guard();
create trigger pricing_history_guard before update or delete on public.pricing_modifiers
  for each row execute function public.pricing_history_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The engine (AC-5 to AC-9). Internal functions run only inside a definer function. Rule 8: the
--    formula is rows, read by this interpreter; no source here runs a string.
-- ═══════════════════════════════════════════════════════════════════════════

-- Trim whitespace, NBSP and zero width characters from both ends. Null stays null.
create function public.catalog_trim(p_text text)
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select regexp_replace(p_text,
    '^[\s   -‍    ⁠　﻿]+|[\s   -‍    ⁠　﻿]+$',
    '', 'g')
$$;

revoke all on function public.catalog_trim(text) from public, anon, authenticated, service_role;

-- Is this answer "no answer"? JSON null, missing, [] and a blank string count as none (AC-7).
create function public.pricing_answer_blank(p_answer jsonb)
  returns boolean
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select p_answer is null
      or jsonb_typeof(p_answer) = 'null'
      or p_answer = '[]'::jsonb
      or (jsonb_typeof(p_answer) = 'string' and public.catalog_trim(p_answer #>> '{}') = '')
$$;

revoke all on function public.pricing_answer_blank(jsonb) from public, anon, authenticated, service_role;

-- Answers against questions (AC-7). p_questions is a JSON array of question rows. Returns every
-- failure as { key, code }, sorted by key, or []. With p_priced_only, only priced questions are
-- checked and an answer to any other question of the set is ignored (a preview).
create function public.pricing_answer_errors(p_questions jsonb, p_answers jsonb, p_priced_only boolean)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_errors  jsonb := '[]'::jsonb;
  v_q       jsonb;
  v_key     text;
  v_type    text;
  v_answer  jsonb;
  v_code    text;
  v_num     numeric;
  v_min     numeric;
  v_max     numeric;
  v_step    numeric;
  v_text    text;
  v_limit   integer;
  v_y       integer;
  v_m       integer;
  v_d       integer;
  v_values  text[];
begin
  if jsonb_typeof(p_answers) is distinct from 'object' then
    return jsonb_build_array(jsonb_build_object('key', null, 'code', 'answer_invalid'));
  end if;

  -- A key that names no question of the set.
  select v_errors || coalesce(jsonb_agg(jsonb_build_object('key', a.key, 'code', 'answer_unknown')), '[]'::jsonb)
    into v_errors
    from jsonb_object_keys(p_answers) a(key)
   where not exists (select 1 from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) q
                      where q ->> 'key' = a.key);

  for v_q in select q from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) q loop
    if p_priced_only and not coalesce((v_q ->> 'affects_pricing')::boolean, false) then
      continue;
    end if;
    v_key := v_q ->> 'key';
    v_type := v_q ->> 'type';
    v_answer := p_answers -> v_key;
    v_code := null;

    if public.pricing_answer_blank(v_answer) then
      if coalesce((v_q ->> 'required')::boolean, false) then
        v_code := 'answer_required';
      end if;
    elsif v_type = 'number' then
      if jsonb_typeof(v_answer) <> 'number' or (v_answer #>> '{}')::numeric <> trunc((v_answer #>> '{}')::numeric) then
        v_code := 'answer_invalid';
      else
        v_num := (v_answer #>> '{}')::numeric;
        v_min := (v_q -> 'validation' ->> 'min')::numeric;
        v_max := (v_q -> 'validation' ->> 'max')::numeric;
        v_step := (v_q -> 'validation' ->> 'step')::numeric;
        if v_num < v_min or v_num > v_max or mod(v_num - v_min, v_step) <> 0 then
          v_code := 'answer_out_of_range';
        end if;
      end if;
    elsif v_type in ('single_select', 'multi_select') then
      select array_agg(o ->> 'value') into v_values from jsonb_array_elements(v_q -> 'options') o;
      if v_type = 'single_select' then
        if jsonb_typeof(v_answer) <> 'string' or not ((v_answer #>> '{}') = any (v_values)) then
          v_code := 'answer_invalid';
        end if;
      elsif jsonb_typeof(v_answer) <> 'array'
            or exists (select 1 from jsonb_array_elements(v_answer) e
                        where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (v_values)))
            or (select count(distinct e #>> '{}') from jsonb_array_elements(v_answer) e) <> jsonb_array_length(v_answer) then
        v_code := 'answer_invalid';
      end if;
    elsif v_type = 'boolean' then
      if jsonb_typeof(v_answer) <> 'boolean' then
        v_code := 'answer_invalid';
      end if;
    elsif v_type in ('text', 'textarea') then
      if jsonb_typeof(v_answer) <> 'string' then
        v_code := 'answer_invalid';
      else
        v_text := public.catalog_trim(v_answer #>> '{}');
        v_limit := coalesce((v_q -> 'validation' ->> 'maxLength')::integer, case v_type when 'text' then 200 else 500 end);
        if char_length(v_text) > v_limit then
          v_code := 'answer_out_of_range';
        elsif public.has_contact_info(v_text) then
          v_code := 'contact_info_in_answer';
        end if;
      end if;
    elsif v_type = 'date' then
      if jsonb_typeof(v_answer) <> 'string' or (v_answer #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        v_code := 'answer_invalid';
      else
        v_y := substr(v_answer #>> '{}', 1, 4)::integer;
        v_m := substr(v_answer #>> '{}', 6, 2)::integer;
        v_d := substr(v_answer #>> '{}', 9, 2)::integer;
        if v_y < 1 or v_m not between 1 and 12 or v_d < 1
           or v_d > extract(day from (make_date(v_y, v_m, 1) + interval '1 month' - interval '1 day'))::integer then
          v_code := 'answer_invalid';
        end if;
      end if;
    elsif v_type = 'time' then
      if jsonb_typeof(v_answer) <> 'string' or (v_answer #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        v_code := 'answer_invalid';
      end if;
    end if;

    if v_code is not null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('key', v_key, 'code', v_code));
    end if;
  end loop;

  return coalesce(
    (select jsonb_agg(e order by (e ->> 'key') collate "C", e ->> 'code') from jsonb_array_elements(v_errors) e),
    '[]'::jsonb);
end;
$$;

revoke all on function public.pricing_answer_errors(jsonb, jsonb, boolean) from public, anon, authenticated, service_role;

-- The interpreter (AC-5, AC-6, AC-8). Pure: tests call it directly.
--   (1) subtotal = base, (2) each modifier in array order, (3) + addons, (4) × zone multiplier,
--   (5) round once, half up, to a whole multiple of p_rounding.
-- Exact numeric throughout; nothing is rounded before step 5. The modifiers are already checked
-- (pricing_formula_errors for a draft, the table checks for a published version). Returns
-- { status: 'ok', price, unrounded, modifiers: [every line, with units and fired] } or
-- { status: 'price_out_of_range' } outside [one unit, base × p_max_multiple].
create function public.pricing_evaluate(
  p_base bigint,
  p_modifiers jsonb,
  p_answers jsonb,
  p_addons_total bigint,
  p_multiplier numeric,
  p_rounding bigint,
  p_max_multiple numeric
)
  returns jsonb
  language plpgsql
  immutable
  security invoker
  set search_path = ''
as $$
declare
  v_subtotal  numeric := p_base;
  v_m         jsonb;
  v_answer    jsonb;
  v_match     text;
  v_value     jsonb;
  v_fired     boolean;
  v_units     numeric;
  v_amount    bigint;
  v_factor    numeric(6,4);
  v_lines     jsonb := '[]'::jsonb;
  v_q         numeric;
  v_r         numeric;
  v_price     numeric;
begin
  for v_m in select m from jsonb_array_elements(coalesce(p_modifiers, '[]'::jsonb)) m loop
    v_match := v_m ->> 'match_type';
    v_value := v_m -> 'match_value';
    v_answer := case when jsonb_typeof(v_m -> 'question_key') = 'string' then p_answers -> (v_m ->> 'question_key') end;
    v_amount := (v_m ->> 'amount')::bigint;
    v_factor := (v_m ->> 'factor')::numeric(6,4);
    v_units := null;

    if v_m ->> 'question_key' is null then
      v_fired := v_match = 'always';
    elsif public.pricing_answer_blank(v_answer) then
      -- An unanswered question fires nothing.
      v_fired := false;
    elsif v_match = 'always' then
      v_fired := true;
    elsif v_match = 'equals' then
      v_fired := case when jsonb_typeof(v_answer) = 'array' then v_answer @> jsonb_build_array(v_value)
                      else v_answer = v_value end;
    elsif v_match = 'in' then
      v_fired := case when jsonb_typeof(v_answer) = 'array'
                      then exists (select 1 from jsonb_array_elements(v_answer) a where v_value @> jsonb_build_array(a))
                      else v_value @> jsonb_build_array(v_answer) end;
    elsif v_match = 'range' then
      v_fired := jsonb_typeof(v_answer) = 'number'
                 and (v_answer #>> '{}')::numeric between (v_value ->> 'min')::numeric and (v_value ->> 'max')::numeric;
    elsif v_match = 'is_true' then
      v_fired := v_answer = 'true'::jsonb;
    else
      v_fired := false;
    end if;

    if v_fired then
      if v_m ->> 'effect_type' = 'FIXED' then
        v_subtotal := v_subtotal + v_amount;
      elsif v_m ->> 'effect_type' = 'PER_UNIT' then
        v_units := (v_answer #>> '{}')::numeric;
        v_subtotal := v_subtotal + v_amount * v_units;
      elsif v_m ->> 'effect_type' = 'MULTIPLIER' then
        v_subtotal := v_subtotal * v_factor;
      end if;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'question_key', v_m -> 'question_key',
      'match_type', v_match,
      'match_value', coalesce(v_value, 'null'::jsonb),
      'effect_type', v_m ->> 'effect_type',
      'amount', v_amount,
      'factor', trim_scale(v_factor)::text,
      'units', v_units,
      'fired', v_fired));
  end loop;

  v_subtotal := (v_subtotal + coalesce(p_addons_total, 0)) * p_multiplier;

  -- One rounding, half up, exact: q = floor(subtotal / unit), r = the remainder in [0, unit).
  v_q := trunc(v_subtotal / p_rounding);
  v_r := v_subtotal - v_q * p_rounding;
  if v_r < 0 then
    v_q := v_q - 1;
    v_r := v_r + p_rounding;
  elsif v_r >= p_rounding then
    v_q := v_q + 1;
    v_r := v_r - p_rounding;
  end if;
  if 2 * v_r >= p_rounding then
    v_q := v_q + 1;
  end if;
  v_price := v_q * p_rounding;

  if v_price < p_rounding or v_price > p_base * p_max_multiple then
    return jsonb_build_object('status', 'price_out_of_range');
  end if;

  return jsonb_build_object('status', 'ok', 'price', v_price::bigint, 'unrounded', v_subtotal::text,
                            'modifiers', v_lines);
end;
$$;

revoke all on function public.pricing_evaluate(bigint, jsonb, jsonb, bigint, numeric, bigint, numeric)
  from public, anon, authenticated, service_role;

-- Load what a price needs, check it, then price (AC-7, AC-9, AC-13). Raises zone_unavailable,
-- addon_unavailable, pricing_settings_invalid or price_out_of_range, in that order, after the
-- service checks of its caller. Returns the output shape with null ids and version, or
-- { status: 'invalid', errors }. p_preview changes exactly four things: off zones and addons are
-- allowed, only priced questions are checked, the breakdown keeps every line, and a null zone is × 1.
create function public.pricing_compute(
  p_region text,
  p_service_id uuid,
  p_base bigint,
  p_modifiers jsonb,
  p_zone_id uuid,
  p_addon_ids uuid[],
  p_answers jsonb,
  p_preview boolean
)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_zone        public.zones%rowtype;
  v_multiplier  numeric := 1;
  v_addons      jsonb := '[]'::jsonb;
  v_addons_sum  bigint := 0;
  v_count       integer;
  v_rounding    jsonb;
  v_multiple    jsonb;
  v_category    uuid;
  v_questions   jsonb;
  v_errors      jsonb;
  v_result      jsonb;
  v_currency    text;
begin
  if p_zone_id is not null then
    select * into v_zone from public.zones z
     where z.id = p_zone_id and z.region = p_region and (z.active or p_preview);
    if not found then
      raise exception 'zone_unavailable';
    end if;
    v_multiplier := v_zone.multiplier;
  elsif not p_preview then
    raise exception 'zone_unavailable';
  end if;

  if p_addon_ids is not null and cardinality(p_addon_ids) > 0 then
    if array_position(p_addon_ids, null) is not null
       or (select count(distinct x) from unnest(p_addon_ids) x) <> cardinality(p_addon_ids) then
      raise exception 'addon_unavailable';
    end if;
    select count(*), coalesce(sum(a.price), 0),
           coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price)
                              order by array_position(p_addon_ids, a.id)), '[]'::jsonb)
      into v_count, v_addons_sum, v_addons
      from public.addons a
     where a.id = any (p_addon_ids) and a.service_id = p_service_id and a.region = p_region
       and (a.active or p_preview);
    if v_count <> cardinality(p_addon_ids) then
      raise exception 'addon_unavailable';
    end if;
  end if;

  select s.value into v_rounding from public.platform_settings s
   where s.region = p_region and s.key = 'price_rounding_minor';
  select s.value into v_multiple from public.platform_settings s
   where s.region = p_region and s.key = 'max_price_multiple';
  if jsonb_typeof(v_rounding) is distinct from 'number'
     or (v_rounding #>> '{}')::numeric <> trunc((v_rounding #>> '{}')::numeric)
     or (v_rounding #>> '{}')::numeric not between 1 and 100000
     or jsonb_typeof(v_multiple) is distinct from 'number'
     or (v_multiple #>> '{}')::numeric <= 0
     or (v_multiple #>> '{}')::numeric > 1000 then
    raise exception 'pricing_settings_invalid';
  end if;

  select s.category_id into v_category from public.services s where s.id = p_service_id;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.display_order, q.id), '[]'::jsonb)
    into v_questions
    from public.questions q
   where q.category_id = v_category
     and (q.service_id is null or q.service_id = p_service_id)
     and q.active;

  v_errors := public.pricing_answer_errors(v_questions, p_answers, p_preview);
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('status', 'invalid', 'errors', v_errors);
  end if;

  v_result := public.pricing_evaluate(p_base, p_modifiers, p_answers, v_addons_sum, v_multiplier,
                                      (v_rounding #>> '{}')::bigint, (v_multiple #>> '{}')::numeric);
  if v_result ->> 'status' <> 'ok' then
    raise exception 'price_out_of_range';
  end if;

  select r.currency into v_currency from public.regions r where r.code = p_region;

  return jsonb_build_object(
    'status', 'ok',
    'price', v_result -> 'price',
    'currency', v_currency,
    'formula_id', null,
    'formula_version', null,
    'breakdown', jsonb_build_object(
      'base', p_base,
      'modifiers', case when p_preview then v_result -> 'modifiers'
                        else coalesce((select jsonb_agg(l) from jsonb_array_elements(v_result -> 'modifiers') l
                                        where (l ->> 'fired')::boolean), '[]'::jsonb) end,
      'addons', v_addons,
      'zone', case when p_zone_id is null then null
                   else jsonb_build_object('id', v_zone.id, 'name', v_zone.name, 'multiplier', v_zone.multiplier::text) end,
      'unrounded', v_result -> 'unrounded',
      'rounding_minor', (v_rounding #>> '{}')::bigint));
end;
$$;

revoke all on function public.pricing_compute(text, uuid, bigint, jsonb, uuid, uuid[], jsonb, boolean)
  from public, anon, authenticated, service_role;

-- The only way a signed in non admin reaches the engine (AC-9, AC-10). No money argument: the client
-- sends answers, never a price (rule 1). The region is the caller's. 04's definer create_request
-- calls this too, because auth.uid() holds inside it. Writes nothing; the same inputs on the same
-- formula version give the same output.
create function public.quote_price(p_service_id uuid, p_zone_id uuid, p_addon_ids uuid[], p_answers jsonb)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_region     text;
  v_formula    public.pricing_formulas%rowtype;
  v_modifiers  jsonb;
  v_result     jsonb;
begin
  select p.region into v_region from public.profiles p where p.id = (select auth.uid());
  if v_region is null then
    raise exception 'forbidden';
  end if;

  select f.* into v_formula
    from public.services s
    join public.service_categories c on c.id = s.category_id
    join public.pricing_formulas f on f.service_id = s.id and f.active
   where s.id = p_service_id and s.region = v_region and s.active and c.active;
  if not found then
    raise exception 'service_unavailable';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'question_key', m.question_key, 'match_type', m.match_type, 'match_value', m.match_value,
           'effect_type', m.effect_type, 'amount', m.amount, 'factor', m.factor::text)
           order by m.apply_order), '[]'::jsonb)
    into v_modifiers
    from public.pricing_modifiers m
   where m.formula_id = v_formula.id;

  v_result := public.pricing_compute(v_region, p_service_id, v_formula.base_price, v_modifiers, p_zone_id,
                                     p_addon_ids, p_answers, false);
  if v_result ->> 'status' = 'ok' then
    v_result := v_result || jsonb_build_object('formula_id', v_formula.id, 'formula_version', v_formula.version);
  end if;
  return v_result;
end;
$$;

revoke all on function public.quote_price(uuid, uuid, uuid[], jsonb) from public, anon, authenticated, service_role;
grant execute on function public.quote_price(uuid, uuid, uuid[], jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Publishing (AC-12, AC-13).
-- ═══════════════════════════════════════════════════════════════════════════

-- Is a JSON value a number equal to itself at this scale? Tested before any cast, so bigint and
-- numeric(6,4) never round silently and a preview never differs from the published version.
create function public.pricing_number_at_scale(p_value jsonb, p_scale integer)
  returns boolean
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'number'
                  and (p_value #>> '{}')::numeric = round((p_value #>> '{}')::numeric, p_scale), false)
$$;

revoke all on function public.pricing_number_at_scale(jsonb, integer) from public, anon, authenticated, service_role;

-- Everything wrong with a draft formula, as { index, code }: index is the modifier's apply_order, or
-- null for the base price or the whole formula. One code per modifier, the first found. Stable, so it
-- takes no lock: the locks sit in publish_pricing_formula. Returns [] for a sound draft.
create function public.pricing_formula_errors(p_service_id uuid, p_base bigint, p_modifiers jsonb)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_category  uuid;
  v_errors    jsonb := '[]'::jsonb;
  v_m         jsonb;
  v_index     integer := 0;
  v_code      text;
  v_key       text;
  v_match     text;
  v_effect    text;
  v_value     jsonb;
  v_amount    jsonb;
  v_factor    jsonb;
  v_q         public.questions%rowtype;
  v_options   text[];
  v_f         numeric;
begin
  select s.category_id into v_category from public.services s where s.id = p_service_id;

  if p_base is null or p_base not between 1 and 100000000 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('index', null, 'code', 'base_price_out_of_range'));
  end if;

  if jsonb_typeof(p_modifiers) is distinct from 'array' then
    return v_errors || jsonb_build_array(jsonb_build_object('index', null, 'code', 'modifier_malformed'));
  end if;
  if jsonb_array_length(p_modifiers) > 50 then
    return v_errors || jsonb_build_array(jsonb_build_object('index', null, 'code', 'too_many_modifiers'));
  end if;

  for v_m in select m from jsonb_array_elements(p_modifiers) m loop
    v_index := v_index + 1;
    v_code := null;

    if jsonb_typeof(v_m) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_m) k
                   where k not in ('question_key', 'match_type', 'match_value', 'effect_type', 'amount', 'factor'))
       or jsonb_typeof(v_m -> 'match_type') is distinct from 'string'
       or jsonb_typeof(v_m -> 'effect_type') is distinct from 'string'
       or (v_m ->> 'match_type') not in ('equals', 'in', 'range', 'is_true', 'always')
       or (v_m ->> 'effect_type') not in ('FIXED', 'PER_UNIT', 'MULTIPLIER')
       or coalesce(jsonb_typeof(v_m -> 'question_key'), 'null') not in ('string', 'null') then
      v_code := 'modifier_malformed';
    end if;

    if v_code is null then
      v_key := v_m ->> 'question_key';
      v_match := v_m ->> 'match_type';
      v_effect := v_m ->> 'effect_type';
      v_value := nullif(v_m -> 'match_value', 'null'::jsonb);
      v_amount := nullif(v_m -> 'amount', 'null'::jsonb);
      v_factor := nullif(v_m -> 'factor', 'null'::jsonb);

      -- The amount or the factor, never both, never neither, of the right JSON type.
      if v_effect = 'MULTIPLIER' then
        if v_amount is not null or jsonb_typeof(v_factor) is distinct from 'string'
           or (v_factor #>> '{}') !~ '^[0-9]{1,6}(\.[0-9]{1,12})?$' then
          v_code := 'modifier_malformed';
        else
          v_f := (v_factor #>> '{}')::numeric;
          if v_f <> round(v_f, 4) then
            v_code := 'modifier_malformed';
          end if;
        end if;
      elsif v_factor is not null or not public.pricing_number_at_scale(v_amount, 0) then
        v_code := 'modifier_malformed';
      end if;
    end if;

    if v_code is null and v_key is not null then
      select q.* into v_q
        from public.questions q
       where q.category_id = v_category and q.key = v_key and q.active and q.affects_pricing
         and (q.service_id is null or q.service_id = p_service_id);
      if not found then
        v_code := 'question_not_priced';
      elsif not v_q.required and v_q.type <> 'multi_select' then
        v_code := 'question_not_required';
      end if;
    end if;

    if v_code is null then
      -- The match table.
      if (v_key is null and v_match <> 'always')
         or (v_key is not null and not (
              (v_q.type = 'number' and v_match in ('always', 'equals', 'range'))
              or (v_q.type in ('single_select', 'multi_select') and v_match in ('equals', 'in'))
              or (v_q.type = 'boolean' and v_match = 'is_true'))) then
        v_code := 'match_not_allowed';
      elsif (v_key is null and v_effect = 'PER_UNIT')
            or (v_key is not null and v_q.type in ('single_select', 'boolean') and v_effect = 'PER_UNIT')
            or (v_key is not null and v_q.type = 'multi_select' and v_effect <> 'FIXED') then
        v_code := 'effect_not_allowed';
      end if;
    end if;

    if v_code is null then
      -- The match value's shape, by match type and question type.
      if v_match in ('always', 'is_true') then
        if v_value is not null then
          v_code := 'modifier_malformed';
        end if;
      elsif v_match = 'equals' then
        if (v_q.type = 'number' and not public.pricing_number_at_scale(v_value, 0))
           or (v_q.type <> 'number' and jsonb_typeof(v_value) is distinct from 'string') then
          v_code := 'modifier_malformed';
        end if;
      elsif v_match = 'in' then
        if jsonb_typeof(v_value) is distinct from 'array' or jsonb_array_length(v_value) = 0
           or exists (select 1 from jsonb_array_elements(v_value) e where jsonb_typeof(e) <> 'string')
           or (select count(distinct e #>> '{}') from jsonb_array_elements(v_value) e) <> jsonb_array_length(v_value) then
          v_code := 'modifier_malformed';
        end if;
      elsif v_match = 'range' then
        if jsonb_typeof(v_value) is distinct from 'object'
           or (select count(*) from jsonb_object_keys(v_value) k) <> 2
           or not public.pricing_number_at_scale(v_value -> 'min', 0)
           or not public.pricing_number_at_scale(v_value -> 'max', 0)
           or (v_value ->> 'min')::numeric > (v_value ->> 'max')::numeric then
          v_code := 'modifier_malformed';
        end if;
      end if;
    end if;

    if v_code is null and v_key is not null and v_q.type in ('single_select', 'multi_select') then
      select array_agg(o ->> 'value') into v_options from jsonb_array_elements(v_q.options) o;
      if exists (select 1
                   from jsonb_array_elements(case when jsonb_typeof(v_value) = 'array' then v_value
                                                  else jsonb_build_array(v_value) end) e
                  where not ((e #>> '{}') = any (v_options))) then
        v_code := 'option_unknown';
      end if;
    end if;

    if v_code is null then
      if v_effect = 'FIXED' and ((v_amount #>> '{}')::numeric not between -100000000 and 100000000
                                 or (v_amount #>> '{}')::numeric = 0) then
        v_code := 'amount_out_of_range';
      elsif v_effect = 'PER_UNIT' and (v_amount #>> '{}')::numeric not between 1 and 100000000 then
        v_code := 'amount_out_of_range';
      elsif v_effect = 'MULTIPLIER' and v_f not between 0.1 and 10 then
        v_code := 'factor_out_of_range';
      end if;
    end if;

    if v_code is not null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('index', v_index, 'code', v_code));
    end if;
  end loop;

  return v_errors;
end;
$$;

revoke all on function public.pricing_formula_errors(uuid, bigint, jsonb) from public, anon, authenticated, service_role;

-- A draft or a stored formula as comparable JSON: numbers compare by value, so 1.3 equals 1.30.
create function public.pricing_canonical(p_modifiers jsonb)
  returns jsonb
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_array(
           m -> 'question_key', m ->> 'match_type', coalesce(m -> 'match_value', 'null'::jsonb), m ->> 'effect_type',
           (m ->> 'amount')::numeric, (m ->> 'factor')::numeric)
           order by o), '[]'::jsonb)
    from jsonb_array_elements(p_modifiers) with ordinality as t(m, o)
$$;

revoke all on function public.pricing_canonical(jsonb) from public, anon, authenticated, service_role;

-- Publish the next version of a service's formula (AC-12). Returns { status: 'ok', formula_id,
-- version }, { status: 'invalid_formula', errors } or { status: 'no_changes' }; raises forbidden,
-- service_unavailable or stale_formula. The region comes from the service row.
create function public.publish_pricing_formula(
  p_service_id uuid,
  p_expected_version integer,
  p_base bigint,
  p_modifiers jsonb
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_service  public.services%rowtype;
  v_active   public.pricing_formulas%rowtype;
  v_errors   jsonb;
  v_stored   jsonb;
  v_version  integer;
  v_id       uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  -- Two admins publish: the second waits here, then sees the new version and gets stale_formula.
  select * into v_service from public.services s where s.id = p_service_id for no key update;
  if not found then
    raise exception 'service_unavailable';
  end if;

  select * into v_active from public.pricing_formulas f where f.service_id = p_service_id and f.active;
  if p_expected_version is null or p_expected_version <> coalesce(v_active.version, 0) then
    raise exception 'stale_formula';
  end if;

  -- A question switched off while this runs: one of the two waits, so the guard or the check below
  -- sees the truth.
  perform 1
     from public.questions q
    where q.category_id = v_service.category_id
      and q.key in (select m ->> 'question_key'
                      from jsonb_array_elements(case when jsonb_typeof(p_modifiers) = 'array' then p_modifiers
                                                     else '[]'::jsonb end) m)
      for share;

  v_errors := public.pricing_formula_errors(p_service_id, p_base, p_modifiers);
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('status', 'invalid_formula', 'errors', v_errors);
  end if;

  if v_active.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'question_key', m.question_key, 'match_type', m.match_type, 'match_value', m.match_value,
             'effect_type', m.effect_type, 'amount', m.amount, 'factor', m.factor)
             order by m.apply_order), '[]'::jsonb)
      into v_stored
      from public.pricing_modifiers m
     where m.formula_id = v_active.id;
    if v_active.base_price = p_base and public.pricing_canonical(v_stored) = public.pricing_canonical(p_modifiers) then
      return jsonb_build_object('status', 'no_changes');
    end if;
    update public.pricing_formulas set active = false where id = v_active.id;
  end if;

  select coalesce(max(f.version), 0) + 1 into v_version from public.pricing_formulas f where f.service_id = p_service_id;

  insert into public.pricing_formulas (service_id, region, version, base_price, active, created_by)
  values (p_service_id, v_service.region, v_version, p_base, true, (select auth.uid()))
  returning id into v_id;

  insert into public.pricing_modifiers (formula_id, region, apply_order, question_key, match_type, match_value,
                                        effect_type, amount, factor)
  select v_id, v_service.region, o::integer, m ->> 'question_key', m ->> 'match_type',
         nullif(m -> 'match_value', 'null'::jsonb), m ->> 'effect_type',
         (m ->> 'amount')::bigint, (m ->> 'factor')::numeric(6,4)
    from jsonb_array_elements(p_modifiers) with ordinality as t(m, o);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values ((select auth.uid()), 'pricing.formula_published', 'pricing_formula', v_id::text, v_service.region,
          case when v_active.id is null then null
               else jsonb_build_object('version', v_active.version, 'base_price', v_active.base_price) end,
          jsonb_build_object('version', v_version, 'base_price', p_base));

  return jsonb_build_object('status', 'ok', 'formula_id', v_id, 'version', v_version);
end;
$$;

revoke all on function public.publish_pricing_formula(uuid, integer, bigint, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.publish_pricing_formula(uuid, integer, bigint, jsonb) to authenticated;

-- Try a draft before publishing (AC-13): the same checks and the same computation as a real quote, so
-- a preview and a quote of the same inputs give the same number. Writes nothing and raises no alert.
create function public.preview_pricing_formula(
  p_service_id uuid,
  p_base bigint,
  p_modifiers jsonb,
  p_zone_id uuid,
  p_addon_ids uuid[],
  p_answers jsonb
)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_region  text;
  v_errors  jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select s.region into v_region from public.services s where s.id = p_service_id;
  if v_region is null then
    raise exception 'service_unavailable';
  end if;

  v_errors := public.pricing_formula_errors(p_service_id, p_base, p_modifiers);
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('status', 'invalid_formula', 'errors', v_errors);
  end if;

  return public.pricing_compute(v_region, p_service_id, p_base, p_modifiers, p_zone_id, p_addon_ids, p_answers, true);
end;
$$;

revoke all on function public.preview_pricing_formula(uuid, bigint, jsonb, uuid, uuid[], jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_pricing_formula(uuid, bigint, jsonb, uuid, uuid[], jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Settings (AC-8). The rounding unit per region, and checks that hold both pricing keys, so a
--     quote never prices on a bad value and never guesses a default. Edited by SQL until 16.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_settings
  add constraint platform_settings_price_rounding_valid check (
    case when key <> 'price_rounding_minor' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
              and (value #>> '{}')::numeric between 1 and 100000 end),
  add constraint platform_settings_max_price_multiple_valid check (
    case when key <> 'max_price_multiple' then true
         when jsonb_typeof(value) <> 'number' then false
         else (value #>> '{}')::numeric > 0 and (value #>> '{}')::numeric <= 1000 end);

insert into public.platform_settings (region, key, value) values
  ('TR',  'price_rounding_minor', '100'),
  ('KSA', 'price_rounding_minor', '100')
on conflict (region, key) do nothing;
