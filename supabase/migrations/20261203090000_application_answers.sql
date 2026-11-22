-- Position 19b (spec 0011-19b, D213): structured application answers.
--
-- Admin writes up to five questions per category for providers (application_questions, its own table, so an
-- application question never reaches the pricing engine). When a category has active questions, apply_to_request
-- takes answers instead of the message, checks them against the active set read once under the request row lock,
-- and stores the cleaned answers with a snapshot of the questions, so a later edit never changes what a sent
-- application meant. A category with none keeps 05's message exactly as today. Every text answer passes the contact
-- scanner at apply and again when the customer reads the card.
--
-- One table (application_questions): RLS on, admin read, insert and update policies, column grants (03's model,
-- D125), the catalog_audit trigger, a guard for every role. applications gains answers and questions_snapshot.
--
-- Replaced, bodies copied from their latest migration plus the change named at each: applications_guard (16),
-- offer_card (19a), request_offers (06), provider_request (19a), apply_to_request (19a, new signature).
--
-- Every function revokes PUBLIC and pins search_path (supabase/tests/02). Refusals are stable codes; the doors map
-- them. Lock order (D169): apply takes the requests row first, then the provider (shared), as before; the question
-- guard locks only its category row.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. application_questions (AC-1).
-- ═══════════════════════════════════════════════════════════════════════════

create table public.application_questions (
  id             uuid        primary key default gen_random_uuid(),
  category_id    uuid        not null,
  region         text        not null references public.regions (code) on delete restrict,
  -- collate "C": an identifier never folds under a Turkish locale (rule 10).
  key            text collate "C" not null,
  label          jsonb       not null,
  help_text      jsonb,
  type           text        not null,
  required       boolean     not null default false,
  options        jsonb,
  validation     jsonb,
  display_order  integer     not null default 0,
  active         boolean     not null default false,
  created_at     timestamptz not null default now(),

  -- Unique with retired keys included: a key means one thing in a category, forever.
  constraint application_questions_key_unique unique (category_id, key),
  constraint application_questions_category_fk foreign key (category_id, region)
    references public.service_categories (id, region) on delete restrict,
  constraint application_questions_key_format check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint application_questions_type_valid check (type in ('textarea', 'single_select', 'boolean')),
  constraint application_questions_label_ok check (public.catalog_text_ok(label, region, 120)),
  constraint application_questions_help_ok check (help_text is null or public.catalog_text_ok(help_text, region, 300)),
  constraint application_questions_shape_ok check (public.question_shape_ok(type, options, validation, region)),
  -- A textarea's limit is 10 to 600 code points (null means 600): an answer is 10 to max_length, so a lower limit
  -- would make the question unanswerable.
  constraint application_questions_text_limit check (
    case when type <> 'textarea' or validation is null then true
         when jsonb_typeof(validation -> 'maxLength') <> 'number' then false
         else (validation ->> 'maxLength')::numeric between 10 and 600 end)
);

alter table public.application_questions enable row level security;

create policy application_questions_read_admin on public.application_questions for select to authenticated
  using ((select public.is_admin()));
create policy application_questions_insert_admin on public.application_questions for insert to authenticated
  with check ((select public.is_admin()));
create policy application_questions_update_admin on public.application_questions for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create index application_questions_active_idx on public.application_questions (category_id, display_order, key)
  where active;
create index application_questions_region_idx on public.application_questions (region);
create index application_questions_category_region_idx on public.application_questions (category_id, region);

-- Read: authenticated, through the admin policy only. Write: named columns; key, type, category and region are set
-- on insert only. No delete for anyone.
revoke all on table public.application_questions from anon, authenticated, service_role;
grant select on table public.application_questions to authenticated;
grant insert (category_id, region, key, label, help_text, type, required, options, validation, display_order, active)
  on table public.application_questions to authenticated;
grant update (label, help_text, required, options, validation, display_order, active)
  on table public.application_questions to authenticated;

create trigger catalog_audit after insert or update on public.application_questions
  for each row execute function public.catalog_audit();

-- The guard, for every role: never deleted (deactivate instead), key, type, category and region fixed, at most five
-- active per category. Definer, so the category lock (X-4) works for any caller; it reads and locks one row only.
-- A BEFORE trigger runs ahead of the RLS write check, so application_questions_access (invoker, named to fire first)
-- refuses a signed in caller who is not admin before this guard can lock or count for them (19b security review).
create function public.application_questions_guard()
  returns trigger
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_active integer;
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'application_question_retire';
  end if;
  if tg_op = 'UPDATE'
     and (new.key is distinct from old.key or new.type is distinct from old.type
          or new.category_id is distinct from old.category_id or new.region is distinct from old.region
          or new.id is distinct from old.id or new.created_at is distinct from old.created_at) then
    raise exception 'application_question_immutable';
  end if;
  if new.active and (tg_op = 'INSERT' or not old.active) then
    -- Two admins activating different questions at once queue here, so the second counts the first (X-4).
    perform 1 from public.service_categories c where c.id = new.category_id for no key update;
    select count(*) into v_active
      from public.application_questions q
     where q.category_id = new.category_id and q.active and q.id <> new.id;
    if v_active >= 5 then
      raise exception 'too_many_questions';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.application_questions_guard() from public, anon, authenticated, service_role;

create function public.application_questions_access()
  returns trigger
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
begin
  -- Invoker, so current_user is the API role the caller holds: only admin writes through the API.
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.application_questions_access() from public, anon, authenticated, service_role;

-- Same timing fires in name order: access before guard.
create trigger application_questions_access before insert or update or delete on public.application_questions
  for each row execute function public.application_questions_access();
create trigger application_questions_guard before insert or update or delete on public.application_questions
  for each row execute function public.application_questions_guard();
create trigger application_questions_guard_truncate before truncate on public.application_questions
  for each statement execute function public.application_questions_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The active set and its version (AC-3, X-3, X-6). One list function, so the form, the version and apply read
--    the same shape; the version is the md5 of that list's text, null with no active question.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.application_questions_list(p_category_id uuid, p_region text)
  returns jsonb
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', q.key,
           'label', q.label,
           'help_text', q.help_text,
           'type', q.type,
           'required', q.required,
           'options', q.options,
           'max_length', case when q.type = 'textarea'
                              then coalesce((q.validation ->> 'maxLength')::integer, 600) end)
           order by q.display_order, q.key), '[]'::jsonb)
    from public.application_questions q
   where q.category_id = p_category_id and q.region = p_region and q.active
$$;

revoke all on function public.application_questions_list(uuid, text) from public, anon, authenticated, service_role;

create function public.application_questions_digest(p_list jsonb)
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select case when p_list is null or jsonb_array_length(p_list) = 0 then null else md5(p_list::text) end
$$;

revoke all on function public.application_questions_digest(jsonb) from public, anon, authenticated, service_role;

create function public.application_questions_version(p_category_id uuid, p_region text)
  returns text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select public.application_questions_digest(public.application_questions_list(p_category_id, p_region))
$$;

revoke all on function public.application_questions_version(uuid, text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. applications gains answers and their snapshot (AC-5).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.applications
  alter column message drop not null,
  add column answers jsonb,
  add column questions_snapshot jsonb,
  add constraint applications_one_content check (coalesce(
    (message is not null and answers is null and questions_snapshot is null)
    or (message is null
        and jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 16384
        and jsonb_typeof(questions_snapshot) = 'array' and octet_length(questions_snapshot::text) <= 32768),
    false));

-- 16's body, the two new columns added to the refused changes.
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
     or new.answers is distinct from old.answers
     or new.questions_snapshot is distinct from old.questions_snapshot
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
  -- Final, except a NOT_SELECTED applicant restored to APPLIED by a reopen of its request (D162).
  if new.status is distinct from old.status
     and old.status in ('NOT_SELECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED', 'CONFIRMED', 'RATED')
     and not (old.status = 'NOT_SELECTED' and new.status = 'APPLIED'
              and exists (select 1 from public.requests r where r.id = new.request_id and r.status = 'OPEN')) then
    raise exception 'application_final';
  end if;
  -- R-6: the endings, each only from the states that may end that way; APPLIED only by the restore.
  if new.status is distinct from old.status
     and ((new.status = 'WITHDRAWN' and old.status not in ('APPLIED', 'SELECTED', 'AWAITING_FEE'))
          or (new.status = 'EXPIRED' and old.status not in ('SELECTED', 'AWAITING_FEE'))
          or (new.status = 'CANCELLED' and old.status not in ('APPLIED', 'SELECTED', 'AWAITING_FEE', 'UNLOCKED', 'STARTED'))
          or (new.status = 'APPLIED' and old.status <> 'NOT_SELECTED')) then
    raise exception 'application_transition_invalid';
  end if;
  -- 11's work moves (R-4 of 11), plus the cancels of an unlocked or started job (12), plus 14's return to work
  -- (COMPLETED -> STARTED, X-13).
  if new.status is distinct from old.status
     and (old.status in ('UNLOCKED', 'STARTED', 'COMPLETED') or new.status in ('STARTED', 'COMPLETED', 'CONFIRMED'))
     and not ((old.status = 'UNLOCKED' and new.status in ('STARTED', 'CONFIRMED', 'CANCELLED'))
              or (old.status = 'STARTED' and new.status in ('COMPLETED', 'CONFIRMED', 'CANCELLED'))
              or (old.status = 'COMPLETED' and new.status in ('CONFIRMED', 'STARTED'))) then
    raise exception 'application_transition_invalid';
  end if;
  -- R-6 of 16: the extension allowances go from null to a value once, never back, only while the pick waits for that
  -- payment and its request is in that payment's state.
  if new.payment_extended_at is distinct from old.payment_extended_at
     and not (old.payment_extended_at is null and new.payment_extended_at is not null
              and old.status = 'SELECTED' and new.status = 'SELECTED'
              and exists (select 1 from public.requests r
                           where r.id = new.request_id and r.selected_application_id = new.id and r.status = 'SELECTED')) then
    raise exception 'application_immutable';
  end if;
  if new.fee_extended_at is distinct from old.fee_extended_at
     and not (old.fee_extended_at is null and new.fee_extended_at is not null
              and old.status = 'AWAITING_FEE' and new.status = 'AWAITING_FEE'
              and exists (select 1 from public.requests r
                           where r.id = new.request_id and r.selected_application_id = new.id
                             and r.status = 'COMMISSION_PAID')) then
    raise exception 'application_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.applications_guard() from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The offer card (AC-6, X-2): 19a's body plus `answers`, and message_hidden never null (a null message scans to
--    null). Answers in snapshot order, answered ones only; a text answer the scanner matches comes back hidden.
-- ═══════════════════════════════════════════════════════════════════════════

-- The text answers of one application joined in snapshot order, so the scanner reads a number split across fields
-- as one (19b security review).
create function public.answers_joined_text(p_answers jsonb, p_snapshot jsonb)
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select string_agg(p_answers ->> (s.q ->> 'key'), ' ' order by s.ord)
    from jsonb_array_elements(coalesce(p_snapshot, '[]'::jsonb)) with ordinality as s(q, ord)
   where s.q ->> 'type' = 'textarea' and jsonb_typeof(p_answers -> (s.q ->> 'key')) = 'string'
$$;

revoke all on function public.answers_joined_text(jsonb, jsonb) from public, anon, authenticated, service_role;

create function public.offer_answers(p_answers jsonb, p_snapshot jsonb)
  returns jsonb
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  -- A text answer is hidden when it alone, or the text answers together, would be refused today.
  with joined as (
    select coalesce(public.message_has_contact_info(public.answers_joined_text(p_answers, p_snapshot)), false) as hit
  )
  select case when p_answers is null then null else coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', s.q ->> 'key',
             'label', s.q -> 'label',
             'type', s.q ->> 'type',
             'choice', case when s.q ->> 'type' = 'single_select' then s.q -> 'choice' end,
             'value', case s.q ->> 'type'
                        when 'textarea' then case when j.hit
                                                    or coalesce(public.message_has_contact_info(p_answers ->> (s.q ->> 'key')), false)
                                                  then null else p_answers -> (s.q ->> 'key') end
                        when 'boolean' then p_answers -> (s.q ->> 'key')
                      end,
             'hidden', s.q ->> 'type' = 'textarea'
                       and (j.hit or coalesce(public.message_has_contact_info(p_answers ->> (s.q ->> 'key')), false)))
           order by s.ord)
      from jsonb_array_elements(p_snapshot) with ordinality as s(q, ord), joined j
     where p_answers ? (s.q ->> 'key')), '[]'::jsonb) end
    from joined
$$;

revoke all on function public.offer_answers(jsonb, jsonb) from public, anon, authenticated, service_role;

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
           'message_hidden', coalesce(public.message_has_contact_info((p_application).message), false),
           'answers', public.offer_answers((p_application).answers, (p_application).questions_snapshot),
           'created_at', (p_application).created_at,
           'rating', public.provider_rating_summary(pr.id),
           'quality', public.provider_card_quality(pr.id))
         || public.offer_display_name(pr.approved_name)
    from public.providers pr
   where pr.id = (p_application).provider_id
$$;

revoke all on function public.offer_card(public.applications, text) from public, anon, authenticated, service_role;

-- 06's body; a chosen provider suspended after the choose loses the answers too, beside the message (X-1).
create or replace function public.request_offers(p_request_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_req     public.requests%rowtype;
  v_tz      text;
  v_window  integer;
  v_offers  jsonb := '[]'::jsonb;
  v_chosen  jsonb;
begin
  select r.* into v_req from public.requests r
   where r.id = p_request_id and r.customer_id = (select auth.uid());
  if not found then
    return null;
  end if;
  select g.timezone into v_tz from public.regions g where g.code = v_req.region;
  begin
    v_window := public.choose_settings(v_req.region);
  exception when raise_exception then
    v_window := null;
  end;

  if v_req.status = 'OPEN' then
    select coalesce(jsonb_agg(public.offer_card(a, v_tz) order by a.created_at, a.id), '[]'::jsonb)
      into v_offers
      from public.applications a
     where a.request_id = v_req.id
       and a.status = 'APPLIED'
       and public.provider_standing(a.provider_id) is not distinct from 'approved';
  end if;

  if v_req.selected_application_id is not null then
    select public.offer_card(a, v_tz)
           || jsonb_build_object('status', a.status,
                                 'suspended', public.provider_standing(a.provider_id) is distinct from 'approved')
      into v_chosen
      from public.applications a
     where a.id = v_req.selected_application_id;
    -- A provider suspended after the choose may have been suspended for that very text: the message and the
    -- answers are hidden from then on (06 security review S2, 19b X-1).
    if (v_chosen ->> 'suspended')::boolean then
      v_chosen := v_chosen || jsonb_build_object('message', null, 'message_hidden', true, 'answers', null);
    end if;
  end if;

  return jsonb_build_object(
    'status', v_req.status,
    'timezone', v_tz,
    'payment_window_hours', v_window,
    'selected_at', v_req.selected_at,
    'payment_deadline', v_req.payment_deadline,
    'cancelled_at', v_req.cancelled_at,
    'offers', v_offers,
    'chosen', v_chosen);
end;
$$;

revoke all on function public.request_offers(uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_offers(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The provider's read (AC-3): 19a's body plus the active questions, their version, and the caller's own answers
--    with their snapshot. The request's own answers stay under the top level `answers` (X-8).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.provider_request(p_request_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_me        public.providers%rowtype;
  v_tz        text;
  v_req       public.requests%rowtype;
  v_app       jsonb;
  v_in_feed   boolean;
  v_cap       integer;
  v_count     integer;
  v_days      smallint[];
  v_first     integer;
  v_last      integer;
  v_category  uuid;
  v_qs        jsonb;
begin
  v_me := public.provider_reader();
  select r.* into v_req from public.requests r where r.id = p_request_id and r.region = v_me.region;
  if not found then
    return null;
  end if;

  select jsonb_build_object('id', a.id, 'status', a.status, 'created_at', a.created_at,
                            'application_answers', a.answers, 'questions_snapshot', a.questions_snapshot) into v_app
    from public.applications a
   where a.request_id = v_req.id and a.provider_id = v_me.id;

  v_in_feed := v_req.status = 'OPEN'
    and v_req.scheduled_start_at > now()
    and public.provider_standing(v_me.id) is not distinct from 'approved'
    and public.provider_setup_complete(v_me.id)
    and exists (select 1 from public.provider_services ps
                 where ps.provider_id = v_me.id and ps.service_id = v_req.service_id)
    and exists (select 1 from public.provider_zones pz
                 where pz.provider_id = v_me.id and pz.zone_id = v_req.zone_id);
  if v_app is null and not v_in_feed then
    return null;
  end if;

  select g.timezone into v_tz from public.regions g where g.code = v_me.region;
  v_cap := public.provider_apply_cap(v_me.id, v_me.region);
  v_count := public.approved_applied_count(v_req.id);
  select a.work_days, a.start_hour, a.end_hour into v_days, v_first, v_last
    from public.provider_availability a
   where a.provider_id = v_me.id;
  select s.category_id into v_category from public.services s where s.id = v_req.service_id;
  v_qs := public.application_questions_list(v_category, v_req.region);

  return public.provider_short_details(v_req) || jsonb_build_object(
    'applied_count', v_count,
    'cap', v_cap,
    'full', v_count >= v_cap,
    'outside_hours', public.provider_outside_hours(v_req.scheduled_start_at, v_tz, v_days, v_first, v_last),
    'application', v_app,
    'closed', v_req.status <> 'OPEN' or v_req.scheduled_start_at <= now(),
    'timezone', v_tz,
    'answers', public.provider_structured_answers(v_req.questions_snapshot, v_req.answers),
    'questions', v_qs,
    'questions_version', public.application_questions_digest(v_qs),
    'payment_deadline', case when v_app ->> 'status' = 'SELECTED' then v_req.payment_deadline end);
end;
$$;

revoke all on function public.provider_request(uuid) from public, anon, authenticated, service_role;
grant execute on function public.provider_request(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Apply (AC-4): a new signature, every argument after the first defaulted (X-7). Steps 1 to 10 are 19a's,
--    unchanged; steps 11 to 13 are replaced (X-6). Every refusal after step 10 is returned, so the attempt commits
--    (D153). No raise carries the message or an answer.
-- ═══════════════════════════════════════════════════════════════════════════

drop function public.apply_to_request(uuid, text);

create function public.apply_to_request(p_request_id uuid, p_message text default null, p_answers jsonb default null,
                                        p_questions_version text default null)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_me        public.providers%rowtype;
  v_standing  text;
  v_req       record;
  v_app       record;
  v_settings  jsonb;
  v_count     integer;
  v_message   text;
  v_qset      jsonb;
  v_cap       integer;
  v_category  uuid;
  v_qs        jsonb;
  v_q         jsonb;
  v_key       text;
  v_value     jsonb;
  v_text      text;
  v_clean     jsonb := '{}'::jsonb;
  v_snapshot  jsonb := '[]'::jsonb;
  v_item      jsonb;
  v_choice    jsonb;
begin
  -- 1. A provider profile with a providers row; identity from the token only.
  v_me := public.provider_reader();

  -- 2. Standing: approved only, so an expired document is refused too.
  v_standing := public.provider_standing(v_me.id);
  if v_standing = 'suspended' then
    raise exception 'provider_suspended';
  end if;
  if v_standing is distinct from 'approved' then
    raise exception 'not_approved';
  end if;

  -- 3. The setup gates applying (D151).
  if not public.provider_setup_complete(v_me.id) then
    raise exception 'setup_incomplete';
  end if;

  -- 4. The request row, locked: cancel and choose take the same lock first. An unknown id and another
  --    region read the same.
  select r.id, r.region, r.status, r.service_id, r.zone_id, r.scheduled_start_at into v_req
    from public.requests r
   where r.id = p_request_id and r.region = v_me.region
     for update;
  if not found then
    raise exception 'not_found';
  end if;

  -- 4b. The caller's providers row, shared, then the standing again: a suspension that commits while this
  --     apply runs either waits for it or is seen here (review F2). Suspend touches no request row, so the
  --     order request, then provider, cannot deadlock with it.
  perform 1 from public.providers pr where pr.id = v_me.id for share;
  v_standing := public.provider_standing(v_me.id);
  if v_standing = 'suspended' then
    raise exception 'provider_suspended';
  end if;
  if v_standing is distinct from 'approved' then
    raise exception 'not_approved';
  end if;

  -- 5. A repeat returns the stored application with no write, whatever the request's state now.
  select a.id, a.status, a.created_at into v_app
    from public.applications a
   where a.request_id = v_req.id and a.provider_id = v_me.id;
  if found then
    return jsonb_build_object('status', 'ok', 'replayed', true, 'application',
             jsonb_build_object('id', v_app.id, 'status', v_app.status, 'created_at', v_app.created_at));
  end if;

  -- 6. Outside the caller's stored picks reads as unknown, so ids cannot be probed.
  if not exists (select 1 from public.provider_services ps
                  where ps.provider_id = v_me.id and ps.service_id = v_req.service_id)
     or not exists (select 1 from public.provider_zones pz
                     where pz.provider_id = v_me.id and pz.zone_id = v_req.zone_id) then
    raise exception 'not_found';
  end if;

  -- 7. Open to applications until its start.
  if v_req.status <> 'OPEN' or v_req.scheduled_start_at <= now() then
    raise exception 'request_closed';
  end if;

  -- 8, 9. The caller's cap (AC-7 of 0011-19a: the reserved slots are for providers on probation), held by the row
  --       lock of step 4. A broken quality setting gives the whole cap (fail open).
  v_settings := public.apply_settings(v_req.region);
  v_qset := public.quality_settings_or_null(v_req.region);
  v_cap := (v_settings ->> 'max_applicants_per_request')::integer;
  if v_qset is not null and not public.provider_on_probation_with(v_me.id, v_qset) then
    v_cap := v_cap - (v_qset ->> 'probation_reserved_slots')::integer;
  end if;
  v_count := public.approved_applied_count(v_req.id);
  if v_count >= v_cap then
    raise exception 'request_full';
  end if;

  -- 9b. AC-6 of 0011-19a: while on probation, no new application past probation_live_jobs live jobs. Applications
  --     already sent, choose, pay and the reveal are untouched.
  if v_qset is not null and public.provider_on_probation_with(v_me.id, v_qset)
     and public.provider_live_jobs(v_me.id) >= (v_qset ->> 'probation_live_jobs')::integer then
    raise exception 'probation_limit';
  end if;

  -- 10. One attempt against the hourly limit.
  perform public.count_application(v_me.id, v_req.region, (v_settings ->> 'applications_per_hour')::integer);

  -- 11. The active questions of the request's category, read once: the version, the checks and the snapshot all
  --     come from this one result (X-6).
  select s.category_id into v_category from public.services s where s.id = v_req.service_id;
  v_qs := public.application_questions_list(v_category, v_req.region);

  if jsonb_array_length(v_qs) = 0 then
    -- 12a. No active question: 05's message, exactly as before.
    if p_answers is not null or p_questions_version is not null then
      return jsonb_build_object('status', 'refused', 'code', 'questions_changed');
    end if;
    if p_message is null or octet_length(p_message) > 8192 then
      return jsonb_build_object('status', 'refused', 'code', 'message_invalid');
    end if;
    v_message := public.catalog_trim(p_message);
    if char_length(v_message) not between 20 and 600 then
      return jsonb_build_object('status', 'refused', 'code', 'message_invalid');
    end if;
    -- The contact scanner (D153).
    if public.message_has_contact_info(v_message) then
      return jsonb_build_object('status', 'refused', 'code', 'contact_info_in_message');
    end if;

    -- 13a. The application, in its request's region.
    insert into public.applications (region, request_id, provider_id, message)
    values (v_req.region, v_req.id, v_me.id, v_message)
    returning id, status, created_at into v_app;
  else
    -- 12b. Active questions: the form must be the current one, answers only.
    if p_answers is null or p_message is not null
       or p_questions_version is distinct from public.application_questions_digest(v_qs) then
      return jsonb_build_object('status', 'refused', 'code', 'questions_changed');
    end if;
    if jsonb_typeof(p_answers) <> 'object' or octet_length(p_answers::text) > 16384 then
      return jsonb_build_object('status', 'refused', 'code', 'answers_invalid');
    end if;
    if exists (select 1 from jsonb_object_keys(p_answers) k
                where not exists (select 1 from jsonb_array_elements(v_qs) q where q ->> 'key' = k)) then
      return jsonb_build_object('status', 'refused', 'code', 'questions_changed');
    end if;

    for v_q in select q from jsonb_array_elements(v_qs) q loop
      v_key := v_q ->> 'key';
      v_value := p_answers -> v_key;
      if v_value is not null and jsonb_typeof(v_value) = 'null' then
        v_value := null;
      end if;
      v_item := jsonb_build_object('key', v_key, 'label', v_q -> 'label', 'type', v_q ->> 'type',
                                   'required', v_q -> 'required');

      if v_value is not null and v_q ->> 'type' = 'textarea' then
        if jsonb_typeof(v_value) <> 'string' or octet_length(v_value #>> '{}') > 8192 then
          return jsonb_build_object('status', 'refused', 'code', 'answers_invalid', 'key', v_key);
        end if;
        v_text := public.catalog_trim(v_value #>> '{}');
        if v_text = '' then
          v_value := null;
        elsif char_length(v_text) not between 10 and (v_q ->> 'max_length')::integer then
          return jsonb_build_object('status', 'refused', 'code', 'answers_invalid', 'key', v_key);
        elsif public.message_has_contact_info(v_text) then
          return jsonb_build_object('status', 'refused', 'code', 'contact_info_in_answer', 'key', v_key);
        else
          v_clean := v_clean || jsonb_build_object(v_key, v_text);
        end if;
      elsif v_value is not null and v_q ->> 'type' = 'single_select' then
        if jsonb_typeof(v_value) <> 'string' then
          return jsonb_build_object('status', 'refused', 'code', 'answers_invalid', 'key', v_key);
        end if;
        v_choice := null;
        select jsonb_build_object('value', o ->> 'value', 'label', o -> 'label') into v_choice
          from jsonb_array_elements(v_q -> 'options') o
         where o ->> 'value' = v_value #>> '{}';
        if v_choice is null then
          return jsonb_build_object('status', 'refused', 'code', 'answers_invalid', 'key', v_key);
        end if;
        v_item := v_item || jsonb_build_object('choice', v_choice);
        v_clean := v_clean || jsonb_build_object(v_key, v_value);
      elsif v_value is not null and v_q ->> 'type' = 'boolean' then
        if jsonb_typeof(v_value) <> 'boolean' then
          return jsonb_build_object('status', 'refused', 'code', 'answers_invalid', 'key', v_key);
        end if;
        v_clean := v_clean || jsonb_build_object(v_key, v_value);
      end if;

      if v_value is null and (v_q ->> 'required')::boolean then
        return jsonb_build_object('status', 'refused', 'code', 'answers_invalid', 'key', v_key);
      end if;
      v_snapshot := v_snapshot || jsonb_build_array(v_item);
    end loop;

    -- 12c. The text answers together, so a number split across fields is caught as one (19b security review).
    if public.message_has_contact_info(public.answers_joined_text(v_clean, v_snapshot)) then
      return jsonb_build_object('status', 'refused', 'code', 'contact_info_in_answer');
    end if;

    -- 13b. The application, its answers and what they answered.
    insert into public.applications (region, request_id, provider_id, message, answers, questions_snapshot)
    values (v_req.region, v_req.id, v_me.id, null, v_clean, v_snapshot)
    returning id, status, created_at into v_app;
  end if;

  return jsonb_build_object('status', 'ok', 'replayed', false, 'application',
           jsonb_build_object('id', v_app.id, 'status', v_app.status, 'created_at', v_app.created_at));
end;
$$;

revoke all on function public.apply_to_request(uuid, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.apply_to_request(uuid, text, jsonb, text) to authenticated;
