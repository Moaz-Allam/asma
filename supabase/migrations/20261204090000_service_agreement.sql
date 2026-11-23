-- Position 20 (spec 0011-20): the service agreement. Before each side pays its fee it accepts the region's active
-- agreement template (the provider the version the customer accepted); at the reveal both acceptances and the job's
-- frozen details become one numbered agreement row and an outbox `agreement.render` job; the relay renders a Turkish
-- PDF into the private, append only bucket `service-agreements`, then each side gets a mail with the PDF attached and
-- an in app notice. Each side downloads it from a card until it opens it once (10 minutes) or 7 days pass; admin lists
-- and opens every agreement, each view audited.
--
-- Contents:
--   1. agreement_templates, agreement_acceptances, service_agreements: checks, RLS, policies, grants, guards (AC-1, AC-11)
--   2. The number's sequence and the draft-1 TR template (AC-1, AC-5)
--   3. Helpers and the template read (AC-1, AC-12)
--   4. pay_commission, pay_provider_fee, choose_provider with the version (AC-2 to AC-4)
--   5. The reveal: provider_fee_settled, apply_fee_paid's alert (AC-5)
--   6. The render: outbox kind, context, finish, fail, render again (AC-6 to AC-8)
--   7. The parties' reads: my_agreement, agreement_visible, open_service_agreement (AC-9)
--   8. Admin: admin_agreements, admin_agreement_link (AC-10)
--   9. The bucket, its read policy and its guard (AC-9, AC-11)
--  10. Mail and notices: queue_email, email_context, the notice kind (AC-8)
--  11. provider_jobs with the customer's version, request_offers with the carried flag (AC-3, AC-4)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Tables (AC-1, AC-11, rule 7)
-- ═══════════════════════════════════════════════════════════════════════════

-- The only names a template may hold (spec 0011-20, Template fields). The renderer substitutes these and nothing else.
create function public.agreement_field_names()
  returns text[]
  language sql
  immutable
  set search_path = ''
as $$
  select array['agreement_number', 'agreement_date', 'customer_name', 'customer_phone', 'provider_name',
               'provider_phone', 'platform_name', 'service_name', 'category_name', 'addon_names', 'district',
               'street_line', 'scheduled_start', 'scheduled_end', 'job_price', 'commission', 'provider_fee',
               'cash_due', 'currency', 'customer_accepted_at', 'provider_accepted_at', 'template_version']::text[]
$$;

revoke all on function public.agreement_field_names() from public, anon, authenticated, service_role;

-- One text of a template: a string of 1 to 4000 characters whose every `{{name}}` is a listed field, and no other
-- braces pair left once those are removed (rule 8: nothing in it is ever run).
create function public.agreement_text_valid(p_text text)
  returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select p_text is not null
     and char_length(p_text) between 1 and 4000
     and not exists (select 1 from regexp_matches(p_text, '\{\{([^{}]*)\}\}', 'g') m
                      where not (m[1] = any (public.agreement_field_names())))
     and strpos(regexp_replace(p_text, '\{\{([a-z_]+)\}\}', '', 'g'), '{{') = 0
     and strpos(regexp_replace(p_text, '\{\{([a-z_]+)\}\}', '', 'g'), '}}') = 0
$$;

revoke all on function public.agreement_text_valid(text) from public, anon, authenticated, service_role;

-- AC-1: a JSON array of 1 to 40 sections, each exactly `{heading, paragraphs[]}`, at most 64 KiB in all.
create function public.agreement_body_valid(p_body jsonb)
  returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_body) = 'array'
    and jsonb_array_length(p_body) between 1 and 40
    and octet_length(p_body::text) <= 65536
    and not exists (
      select 1 from jsonb_array_elements(p_body) s
       where jsonb_typeof(s) <> 'object'
          or (select array_agg(k order by k) from jsonb_object_keys(s) k) <> array['heading', 'paragraphs']
          or jsonb_typeof(s -> 'heading') <> 'string'
          or not public.agreement_text_valid(s ->> 'heading')
          or jsonb_typeof(s -> 'paragraphs') <> 'array'
          or jsonb_array_length(s -> 'paragraphs') not between 1 and 40
          or exists (select 1 from jsonb_array_elements(s -> 'paragraphs') p
                      where jsonb_typeof(p) <> 'string' or not public.agreement_text_valid(p #>> '{}'))),
    false)
$$;

revoke all on function public.agreement_body_valid(jsonb) from public, anon, authenticated, service_role;

create table public.agreement_templates (
  id          uuid        primary key default gen_random_uuid(),
  region      text        not null references public.regions (code) on delete restrict,
  version     text        collate "C" not null,
  body        jsonb       not null,
  active      boolean     not null default false,
  created_at  timestamptz not null default now(),

  constraint agreement_templates_id_region unique (id, region),
  constraint agreement_templates_region_version unique (region, version),
  constraint agreement_templates_version_format check (version ~ '^[a-z0-9._-]{1,40}$'),
  constraint agreement_templates_body_valid check (public.agreement_body_valid(body))
);

create unique index agreement_templates_one_active on public.agreement_templates (region) where active;

create table public.agreement_acceptances (
  id              uuid        primary key default gen_random_uuid(),
  region          text        not null references public.regions (code) on delete restrict,
  request_id      uuid        not null,
  application_id  uuid        not null,
  user_id         uuid        not null references public.profiles (id) on delete restrict,
  role            text        not null,
  template_id     uuid        not null,
  accepted_at     timestamptz not null default now(),

  constraint agreement_acceptances_role_valid check (role in ('customer', 'provider')),
  constraint agreement_acceptances_one_per_side unique (application_id, role),
  constraint agreement_acceptances_request_fk foreign key (request_id, region)
    references public.requests (id, region) on delete restrict,
  constraint agreement_acceptances_application_fk foreign key (application_id, request_id)
    references public.applications (id, request_id) on delete restrict,
  constraint agreement_acceptances_template_fk foreign key (template_id, region)
    references public.agreement_templates (id, region) on delete restrict
);

create index agreement_acceptances_request_idx on public.agreement_acceptances (request_id, region);
create index agreement_acceptances_user_idx on public.agreement_acceptances (user_id);
create index agreement_acceptances_template_idx on public.agreement_acceptances (template_id, region);
create index agreement_acceptances_region_idx on public.agreement_acceptances (region);

create table public.service_agreements (
  id                  uuid        primary key default gen_random_uuid(),
  region              text        not null references public.regions (code) on delete restrict,
  request_id          uuid        not null,
  application_id      uuid        not null,
  number              text        collate "C" not null,
  template_id         uuid        not null,
  content             jsonb       not null,
  storage_path        text        collate "C",
  sha256              text,
  byte_size           integer,
  rendered_at         timestamptz,
  failed_at           timestamptz,
  customer_opened_at  timestamptz,
  provider_opened_at  timestamptz,
  created_at          timestamptz not null default now(),

  constraint service_agreements_one_per_pick unique (application_id),
  constraint service_agreements_number_unique unique (number),
  constraint service_agreements_number_format check (number ~ '^HS-[A-Z]{2,3}-[0-9]{4}-[0-9]{6}$'),
  constraint service_agreements_request_fk foreign key (request_id, region)
    references public.requests (id, region) on delete restrict,
  constraint service_agreements_application_fk foreign key (application_id, request_id)
    references public.applications (id, request_id) on delete restrict,
  constraint service_agreements_template_fk foreign key (template_id, region)
    references public.agreement_templates (id, region) on delete restrict,
  constraint service_agreements_content_valid check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 16384),
  constraint service_agreements_file_together check (
    (storage_path is null and sha256 is null and byte_size is null and rendered_at is null)
    or (storage_path is not null and sha256 is not null and byte_size is not null and rendered_at is not null)),
  constraint service_agreements_path_format check (
    storage_path is null or storage_path ~ '^[A-Z]{2,3}/[0-9]{4}/[0-9a-f-]{36}-r[0-9]{1,3}\.pdf$'),
  constraint service_agreements_sha_format check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint service_agreements_size_range check (byte_size is null or byte_size between 1 and 1048576),
  constraint service_agreements_opened_after check (
    (customer_opened_at is null or customer_opened_at >= created_at)
    and (provider_opened_at is null or provider_opened_at >= created_at))
);

create index service_agreements_request_idx on public.service_agreements (request_id, region);
create index service_agreements_template_idx on public.service_agreements (template_id, region);
create index service_agreements_region_idx on public.service_agreements (region);
create index service_agreements_list_idx on public.service_agreements (created_at desc, id desc);

-- RLS (rule 7). A party reads its own acceptances; admin reads all three; every other read goes through the definer
-- functions below. No API role inserts, updates or deletes any of them.
alter table public.agreement_templates enable row level security;
alter table public.agreement_acceptances enable row level security;
alter table public.service_agreements enable row level security;

create policy agreement_templates_admin_read on public.agreement_templates for select to authenticated
  using ((select public.is_admin()));
create policy agreement_acceptances_read_own on public.agreement_acceptances for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy service_agreements_admin_read on public.service_agreements for select to authenticated
  using ((select public.is_admin()));

revoke all on table public.agreement_templates, public.agreement_acceptances, public.service_agreements
  from anon, authenticated, service_role;
grant select on table public.agreement_templates, public.agreement_acceptances, public.service_agreements
  to authenticated;

-- AC-11: guards for every role, the database owner included. The relay and the definer functions write through these
-- rules, never around them.
create function public.agreement_acceptances_append_only()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  raise exception 'agreement_final';
end;
$$;

revoke all on function public.agreement_acceptances_append_only() from public, anon, authenticated, service_role;

create trigger agreement_acceptances_append_only before update or delete on public.agreement_acceptances
  for each row execute function public.agreement_acceptances_append_only();
create trigger agreement_acceptances_no_truncate before truncate on public.agreement_acceptances
  for each statement execute function public.agreement_acceptances_append_only();

create function public.agreement_templates_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE'
     or new.id is distinct from old.id or new.region is distinct from old.region
     or new.version is distinct from old.version or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at then
    raise exception 'agreement_final';
  end if;
  return new;
end;
$$;

revoke all on function public.agreement_templates_guard() from public, anon, authenticated, service_role;

create trigger agreement_templates_guard before update or delete on public.agreement_templates
  for each row execute function public.agreement_templates_guard();
create trigger agreement_templates_no_truncate before truncate on public.agreement_templates
  for each statement execute function public.agreement_acceptances_append_only();

-- AC-11: the four file fields from null to values together, once; failed_at only while not rendered; each opened time
-- from null, once. Nothing else ever changes, and no row is ever deleted.
create function public.service_agreements_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'agreement_final';
  end if;
  if new.id is distinct from old.id or new.region is distinct from old.region
     or new.request_id is distinct from old.request_id or new.application_id is distinct from old.application_id
     or new.number is distinct from old.number or new.template_id is distinct from old.template_id
     or new.content is distinct from old.content or new.created_at is distinct from old.created_at then
    raise exception 'agreement_final';
  end if;
  if (new.storage_path, new.sha256, new.byte_size, new.rendered_at)
       is distinct from (old.storage_path, old.sha256, old.byte_size, old.rendered_at)
     and (old.rendered_at is not null or new.rendered_at is null) then
    raise exception 'agreement_final';
  end if;
  if new.failed_at is distinct from old.failed_at and old.rendered_at is not null then
    raise exception 'agreement_final';
  end if;
  if (new.customer_opened_at is distinct from old.customer_opened_at and old.customer_opened_at is not null)
     or (new.provider_opened_at is distinct from old.provider_opened_at and old.provider_opened_at is not null) then
    raise exception 'agreement_final';
  end if;
  return new;
end;
$$;

revoke all on function public.service_agreements_guard() from public, anon, authenticated, service_role;

create trigger service_agreements_guard before update or delete on public.service_agreements
  for each row execute function public.service_agreements_guard();
create trigger service_agreements_no_truncate before truncate on public.service_agreements
  for each statement execute function public.agreement_acceptances_append_only();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The number's sequence (one per region, picked from a fixed list) and the draft-1 template (AC-1, AC-5)
-- ═══════════════════════════════════════════════════════════════════════════

create sequence public.service_agreement_seq_tr as bigint minvalue 1 maxvalue 999999 no cycle;
revoke all on sequence public.service_agreement_seq_tr from public, anon, authenticated, service_role;

-- Every heading and paragraph starts `[draft] ` until the lawyer's text lands as a new version (B10, S16).
insert into public.agreement_templates (region, version, active, body) values ('TR', 'draft-1', true, $json$[
  {"heading": "[draft] Taraflar",
   "paragraphs": [
     "[draft] Bu Hizmet Sözleşmesi ({{agreement_number}}), {{agreement_date}} tarihinde hizmet alan {{customer_name}} (telefon: {{customer_phone}}) ile hizmet veren {{provider_name}} (telefon: {{provider_phone}}) arasında, {{platform_name}} platformu aracılığıyla kurulmuştur."]},
  {"heading": "[draft] Platformun rolü",
   "paragraphs": [
     "[draft] {{platform_name}}, taraflar arasında yalnızca aracılık hizmeti sunar ve bu sözleşmenin tarafı değildir.",
     "[draft] Platform hizmet bedelini tahsil etmez, tutmaz ve aktarmaz. Platform yalnızca kendi komisyonunu ve hizmet veren ücretini çevrimiçi alır."]},
  {"heading": "[draft] Hizmetin konusu",
   "paragraphs": [
     "[draft] Hizmet: {{service_name}} ({{category_name}}). Ek hizmetler: {{addon_names}}.",
     "[draft] Hizmet adresi: {{street_line}}, {{district}}.",
     "[draft] Planlanan başlangıç: {{scheduled_start}}. Planlanan bitiş: {{scheduled_end}}."]},
  {"heading": "[draft] Bedel ve ödeme",
   "paragraphs": [
     "[draft] Hizmet bedeli: {{job_price}}. Para birimi: {{currency}}.",
     "[draft] Hizmet alan, platform komisyonu olarak {{commission}} tutarını çevrimiçi ödemiştir.",
     "[draft] Hizmet veren, platform hizmet veren ücreti olarak {{provider_fee}} tutarını çevrimiçi ödemiştir.",
     "[draft] Hizmet alan, hizmet tamamlandıktan sonra hizmet verene yüz yüze ve nakit olarak şu tutarı öder: {{cash_due}}."]},
  {"heading": "[draft] Tarafların yükümlülükleri",
   "paragraphs": [
     "[draft] Hizmet veren, hizmeti özenle, kararlaştırılan zamanda ve kararlaştırılan kapsamda yerine getirir.",
     "[draft] Hizmet alan, hizmetin yapılabilmesi için adrese erişimi sağlar ve kararlaştırılan nakit tutarı öder."]},
  {"heading": "[draft] İptal ve sorunlar",
   "paragraphs": [
     "[draft] İptal ve ücret iadesi koşulları platformun kullanım şartlarında yer alır.",
     "[draft] Hizmetle ilgili bir sorun platform üzerinden bildirilebilir. Platform, taraflardan biri kurallara aykırı davranırsa hukuki yollara başvurma hakkını saklı tutar."]},
  {"heading": "[draft] Kabul",
   "paragraphs": [
     "[draft] Hizmet alan bu sözleşmeyi {{customer_accepted_at}} tarihinde, hizmet veren {{provider_accepted_at}} tarihinde elektronik olarak kabul etmiştir. Sözleşme şablonu: {{template_version}}."]}
]$json$::jsonb);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Helpers and the template read (AC-1, AC-12)
-- ═══════════════════════════════════════════════════════════════════════════

-- The region's active template, or null.
create function public.active_agreement_template(p_region text)
  returns uuid
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select t.id from public.agreement_templates t where t.region = p_region and t.active
$$;

revoke all on function public.active_agreement_template(text) from public, anon, authenticated, service_role;

-- A localised name (an admin's text in up to three languages) as Turkish, else English, else Arabic (Template fields).
create function public.agreement_tr_text(p_name jsonb)
  returns text
  language sql
  immutable
  set search_path = ''
as $$
  select case when jsonb_typeof(p_name) = 'object'
              then coalesce(nullif(btrim(p_name ->> 'tr'), ''), nullif(btrim(p_name ->> 'en'), ''),
                            nullif(btrim(p_name ->> 'ar'), ''))
              when jsonb_typeof(p_name) = 'string' then nullif(btrim(p_name #>> '{}'), '')
         end
$$;

revoke all on function public.agreement_tr_text(jsonb) from public, anon, authenticated, service_role;

-- One side's acceptance, once per (application, side); a replay keeps the first (AC-2, AC-3).
create function public.record_acceptance(p_request_id uuid, p_application_id uuid, p_user uuid, p_role text,
                                         p_template uuid)
  returns void
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_region  text;
begin
  select r.region into v_region from public.requests r where r.id = p_request_id;
  insert into public.agreement_acceptances (region, request_id, application_id, user_id, role, template_id)
  values (v_region, p_request_id, p_application_id, p_user, p_role, p_template)
  on conflict (application_id, role) do nothing;
end;
$$;

revoke all on function public.record_acceptance(uuid, uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

-- AC-1, AC-12: the active template of the caller's region, or the named version of it. Anyone signed in.
create function public.agreement_template(p_version text default null)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_region  text;
  v_tpl     public.agreement_templates%rowtype;
begin
  select p.region into v_region from public.profiles p where p.id = (select auth.uid());
  if v_region is null then
    raise exception 'not_found';
  end if;
  if p_version is null then
    select t.* into v_tpl from public.agreement_templates t where t.region = v_region and t.active;
  elsif p_version ~ '^[a-z0-9._-]{1,40}$' then
    select t.* into v_tpl from public.agreement_templates t where t.region = v_region and t.version = p_version;
  end if;
  if v_tpl.id is null then
    raise exception 'not_found';
  end if;
  return jsonb_build_object('version', v_tpl.version, 'active', v_tpl.active, 'sections', v_tpl.body);
end;
$$;

revoke all on function public.agreement_template(text) from public, anon, authenticated, service_role;
grant execute on function public.agreement_template(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The three payers' functions with the version (AC-2, AC-3, AC-4). Each is dropped and created again, so no old
--    overload is left for PostgREST to see, and its grants are written again.
-- ═══════════════════════════════════════════════════════════════════════════

drop function public.pay_commission(uuid, text, text);
drop function public.pay_provider_fee(uuid, text, text);
drop function public.choose_provider(uuid, uuid);

create function public.pay_commission(p_request_id uuid, p_locale text, p_payer_ip text,
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
  select t.id into v_template from public.agreement_templates t
   where t.region = v_req.region and t.active and t.version = p_agreement_version;
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

create function public.pay_provider_fee(p_application_id uuid, p_locale text, p_payer_ip text,
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
  v_request   uuid;
  v_req       public.requests%rowtype;
  v_app       public.applications%rowtype;
  v_settings  jsonb;
  v_hold      integer;
  v_limit     integer;
  v_fee       uuid;
  v_attempt   uuid;
  v_count     integer;
  v_template  uuid;
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

  -- 4. The fee window, capped at the job's start (security review S10-1, R-15): a payment after the start is
  --    always refunded, so none is opened, and a fee of 0 never unlocks after it either.
  if now() >= least(v_req.fee_deadline, v_req.scheduled_start_at) then
    raise exception 'deadline_passed';
  end if;

  -- 4b. The agreement (spec 0011-20 AC-3): the version the customer accepted for this pick, even when it is no
  --     longer the active one, else agreement_required; then the provider's acceptance of that same template.
  select c.template_id into v_template
    from public.agreement_acceptances c
    join public.agreement_templates t on t.id = c.template_id
   where c.application_id = v_app.id and c.role = 'customer' and t.version = p_agreement_version;
  if p_agreement_version is null or v_template is null then
    raise exception 'agreement_required';
  end if;
  perform public.record_acceptance(v_req.id, v_app.id, v_uid, 'provider', v_template);

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

revoke all on function public.pay_provider_fee(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pay_provider_fee(uuid, text, text, text) to authenticated;

create function public.choose_provider(p_request_id uuid, p_application_id uuid, p_agreement_version text default null)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid           uuid := (select auth.uid());
  v_req           public.requests%rowtype;
  v_window        integer;
  v_fees          jsonb;
  v_fee           bigint;
  v_provider      uuid;
  v_app_req       uuid;
  v_status        text;
  v_deadline      timestamptz;
  v_now           timestamptz := now();
  v_carried       uuid;
  v_unlock        jsonb;
  v_fee_deadline  timestamptz;
  v_template      uuid;
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
  if v_req.status = 'COMMISSION_PAID' and v_req.selected_application_id = p_application_id and v_req.payment_deadline is null then
    return jsonb_build_object('status', 'ok', 'replayed', true, 'selected_at', v_req.selected_at,
                              'payment_deadline', null, 'carried', true, 'fee_deadline', v_req.fee_deadline);
  end if;

  -- 3. Open, and before its start.
  if v_req.status <> 'OPEN' or v_req.scheduled_start_at <= v_now then
    raise exception 'not_choosable';
  end if;

  -- 4. The payment window and the fee settings of the request's region; for a carried commission the fee window too.
  v_window := public.choose_settings(v_req.region);
  v_fees := public.fee_settings(v_req.region);
  v_carried := public.carried_commission(v_req.id);
  if v_carried is not null then
    v_unlock := public.unlock_settings(v_req.region);
  end if;

  -- 5. The application without a lock, then its provider shared, then the applications.
  select a.provider_id, a.request_id into v_provider, v_app_req
    from public.applications a
   where a.id = p_application_id;
  if not found or v_app_req is distinct from v_req.id then
    raise exception 'offer_unavailable';
  end if;
  perform 1 from public.providers pr where pr.id = v_provider for share;
  perform 1 from public.applications a where a.request_id = v_req.id for update;

  -- 6. Still APPLIED, from a provider approved now. A provider whose pick on this request expired or who withdrew
  --    is never picked again (umbrella answer).
  select a.status into v_status from public.applications a where a.id = p_application_id;
  if v_status in ('EXPIRED', 'WITHDRAWN') then
    raise exception 'provider_not_eligible';
  end if;
  if v_status is distinct from 'APPLIED'
     or public.provider_standing(v_provider) is distinct from 'approved' then
    raise exception 'offer_unavailable';
  end if;

  -- 6a. The agreement (spec 0011-20 AC-4): a carried commission skips the payment, so the customer accepts the
  --     region's active version here, else agreement_required. A first pick ignores the argument.
  if v_carried is not null then
    select t.id into v_template from public.agreement_templates t
     where t.region = v_req.region and t.active and t.version = p_agreement_version;
    if p_agreement_version is null or v_template is null then
      raise exception 'agreement_required';
    end if;
  end if;

  -- 6b. The provider fee, frozen now from the stored price.
  v_fee := public.fee_amount(v_req.fixed_price, v_fees);

  -- 7. The chosen one SELECTED with its fee, every other APPLIED one NOT_SELECTED.
  update public.applications a
     set status = case when a.id = p_application_id then 'SELECTED' else 'NOT_SELECTED' end,
         status_changed_at = v_now,
         provider_fee_amount = case when a.id = p_application_id then v_fee else a.provider_fee_amount end,
         provider_fee_kind = case when a.id = p_application_id then v_fees ->> 'kind' else a.provider_fee_kind end
   where a.request_id = v_req.id and a.status = 'APPLIED';

  if v_carried is null then
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
  end if;

  -- 8c. The carried re-pick (R-3, R-4): no payment step; the provider's fee window starts now.
  update public.applications set status = 'AWAITING_FEE', status_changed_at = v_now where id = p_application_id;
  v_fee_deadline := greatest(
    least(v_now + make_interval(hours => (v_unlock ->> 'unlock_window_hours')::integer), v_req.scheduled_start_at),
    v_now + make_interval(mins => (v_unlock ->> 'min_window_minutes')::integer));
  update public.requests
     set status = 'COMMISSION_PAID', selected_application_id = p_application_id, selected_at = v_now,
         fee_deadline = v_fee_deadline
   where id = v_req.id;
  perform public.record_acceptance(v_req.id, p_application_id, v_uid, 'customer', v_template);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_uid, 'request.provider_chosen', 'requests', v_req.id::text, v_req.region,
          jsonb_build_object('status', 'OPEN'),
          jsonb_build_object('status', 'COMMISSION_PAID', 'application_id', p_application_id, 'carried', true,
                             'fee_payment_id', v_carried, 'fee_deadline', v_fee_deadline));

  return jsonb_build_object('status', 'ok', 'replayed', false, 'selected_at', v_now, 'payment_deadline', null,
                            'carried', true, 'fee_deadline', v_fee_deadline);
end;
$$;

revoke all on function public.choose_provider(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.choose_provider(uuid, uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The reveal (AC-5). provider_fee_settled is the one place every pick moves to UNLOCKED (a verified payment and a
--    fee of 0), with the request row already locked: in the same transaction it freezes the agreement and queues its
--    render. A pick without both acceptances gets no row; the reveal never waits on or fails for the agreement.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.queue_agreement(p_request_id uuid, p_application_id uuid)
  returns uuid
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_req      public.requests%rowtype;
  v_app      public.applications%rowtype;
  v_cust     public.agreement_acceptances%rowtype;
  v_prov     public.agreement_acceptances%rowtype;
  v_tpl      public.agreement_templates%rowtype;
  v_tz       text;
  v_seq      bigint;
  v_number   text;
  v_content  jsonb;
  v_id       uuid;
begin
  select s.id into v_id from public.service_agreements s where s.application_id = p_application_id;
  if found then
    return v_id;
  end if;
  select r.* into v_req from public.requests r where r.id = p_request_id;
  select a.* into v_app from public.applications a where a.id = p_application_id and a.request_id = p_request_id;
  select c.* into v_cust from public.agreement_acceptances c where c.application_id = p_application_id and c.role = 'customer';
  select c.* into v_prov from public.agreement_acceptances c where c.application_id = p_application_id and c.role = 'provider';
  -- An old pick (unlocked before this release) or a broken path: no agreement, and the caller alerts.
  if v_req.id is null or v_app.id is null or v_app.unlocked_at is null or v_cust.id is null or v_prov.id is null
     or v_cust.template_id <> v_prov.template_id then
    return null;
  end if;
  select t.* into v_tpl from public.agreement_templates t where t.id = v_cust.template_id;
  select g.timezone into v_tz from public.regions g where g.code = v_req.region;

  -- The number: a fixed list of regions, never dynamic SQL; a gap after a rollback is fine.
  v_seq := case v_req.region when 'TR' then nextval('public.service_agreement_seq_tr') end;
  if v_seq is null then
    return null;
  end if;
  v_number := 'HS-' || v_req.region || '-' || to_char(v_app.unlocked_at at time zone v_tz, 'YYYY') || '-'
              || lpad(v_seq::text, 6, '0');

  -- Plain values only: minor unit integers and UTC instants, formatted once by the renderer (Template fields).
  select jsonb_build_object(
           'agreement_number', v_number,
           'agreement_date', to_char(v_app.unlocked_at at time zone v_tz, 'YYYY-MM-DD'),
           'timezone', v_tz,
           'unlocked_at', v_app.unlocked_at,
           'customer_name', cp.full_name,
           'customer_phone', cp.phone,
           'provider_name', coalesce(pr.approved_name, pp.full_name),
           'provider_phone', pp.phone,
           'platform_name', 'Aldebyani',
           'service_name', public.agreement_tr_text(v_req.pricing_snapshot -> 'service' -> 'name'),
           'category_name', public.agreement_tr_text(v_req.pricing_snapshot -> 'service' -> 'category_name'),
           'addon_names', coalesce((select jsonb_agg(public.agreement_tr_text(x -> 'name') order by n)
                                      from jsonb_array_elements(
                                             case when jsonb_typeof(v_req.pricing_snapshot -> 'breakdown' -> 'addons') = 'array'
                                                  then v_req.pricing_snapshot -> 'breakdown' -> 'addons'
                                                  else '[]'::jsonb end) with ordinality as e(x, n)
                                     where public.agreement_tr_text(x -> 'name') is not null), '[]'::jsonb),
           'district', public.agreement_tr_text(z.name),
           'street_line', ad.line,
           'scheduled_start', v_req.scheduled_start_at,
           'scheduled_end', v_req.scheduled_end_at,
           'job_price', v_req.fixed_price,
           'commission', v_req.commission_amount,
           'provider_fee', v_app.provider_fee_amount,
           'cash_due', v_req.cash_due,
           'currency', v_req.currency,
           'customer_accepted_at', v_cust.accepted_at,
           'provider_accepted_at', v_prov.accepted_at,
           'template_version', v_tpl.version)
    into v_content
    from public.profiles cp
    join public.profiles pp on pp.id = v_app.provider_id
    left join public.providers pr on pr.id = v_app.provider_id
    left join public.zones z on z.id = v_req.zone_id
    left join public.request_addresses ad on ad.request_id = v_req.id
   where cp.id = v_req.customer_id;
  if v_content is null then
    return null;
  end if;

  insert into public.service_agreements (region, request_id, application_id, number, template_id, content)
  values (v_req.region, v_req.id, v_app.id, v_number, v_tpl.id, v_content)
  on conflict (application_id) do nothing
  returning id into v_id;
  if v_id is null then
    select s.id into v_id from public.service_agreements s where s.application_id = p_application_id;
    return v_id;
  end if;
  perform public.enqueue_outbox('agreement.render', 'agreement.render:' || v_id || ':1',
                                jsonb_build_object('agreement_id', v_id), v_req.region);
  return v_id;
end;
$$;

revoke all on function public.queue_agreement(uuid, uuid) from public, anon, authenticated, service_role;

-- 10's body plus the agreement (AC-5).
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
  perform public.queue_agreement(v_req.id, v_req.selected_application_id);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values ((select auth.uid()), 'request.unlocked', 'requests', v_req.id::text, v_req.region,
          jsonb_build_object('status', 'COMMISSION_PAID'),
          jsonb_build_object('status', 'UNLOCKED', 'application_id', v_req.selected_application_id));
end;
$$;

revoke all on function public.provider_fee_settled(uuid) from public, anon, authenticated, service_role;

-- AC-5's alert. apply_fee_paid is left as 07 wrote it (a replay must return exactly its stored result, so it cannot
-- grow an alert after its journal), and a fee of 0 settles in a request path with no relay: so the relay's heartbeat
-- asks for every pick unlocked in the last day, since this release, that has no agreement, and alerts
-- `agreement_missing` for each (repeats join one issue per pick).
create function public.agreement_gaps()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('application_id', a.id, 'region', r.region) order by a.unlocked_at), '[]'::jsonb)
    from public.applications a
    join public.requests r on r.id = a.request_id
   where a.unlocked_at > now() - interval '1 day'
     and a.unlocked_at >= (select min(t.created_at) from public.agreement_templates t)
     and not exists (select 1 from public.service_agreements s where s.application_id = a.id)
$$;

revoke all on function public.agreement_gaps() from public, anon, authenticated, service_role;
grant execute on function public.agreement_gaps() to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The render (AC-6, AC-7, AC-8). The outbox kind, the relay's context, finish and fail, admin's render again.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.outbox_events drop constraint outbox_events_kind_valid;
alter table public.outbox_events add constraint outbox_events_kind_valid
  check (kind in ('checkout.initialize', 'payment.verify', 'refund.request', 'email.send', 'agreement.render'));

create or replace function public.enqueue_outbox(p_kind text, p_key text, p_payload jsonb, p_region text)
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
  if p_kind is null
     or p_kind not in ('checkout.initialize', 'payment.verify', 'refund.request', 'email.send', 'agreement.render')
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

-- AC-6: what the relay renders from: the frozen content and the accepted template's body, nothing live.
create function public.agreement_render_context(p_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_s    public.service_agreements%rowtype;
  v_tpl  public.agreement_templates%rowtype;
begin
  select s.* into v_s from public.service_agreements s where s.id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
  select t.* into v_tpl from public.agreement_templates t where t.id = v_s.template_id;
  return jsonb_build_object(
    'id', v_s.id,
    'region', v_s.region,
    'number', v_s.number,
    'created_at', v_s.created_at,
    'rendered', v_s.rendered_at is not null,
    'content', v_s.content,
    'template_version', v_tpl.version,
    'sections', v_tpl.body);
end;
$$;

revoke all on function public.agreement_render_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.agreement_render_context(uuid) to service_role;

-- AC-6, AC-8: the file fields once, then one mail and one notice per side. A replay finds them set and does nothing.
create function public.finish_agreement_render(p_id uuid, p_path text, p_sha256 text, p_byte_size integer)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_s         public.service_agreements%rowtype;
  v_provider  uuid;
  v_customer  uuid;
  v_until     timestamptz := now() + interval '7 days';
begin
  if p_id is null or p_path is null or p_sha256 is null or p_byte_size is null
     or p_sha256 !~ '^[0-9a-f]{64}$' or p_byte_size not between 1 and 1048576 then
    raise exception 'validation_failed';
  end if;
  select s.* into v_s from public.service_agreements s where s.id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_s.rendered_at is not null then
    return jsonb_build_object('status', 'rendered', 'replayed', true);
  end if;
  if p_path !~ ('^' || v_s.region || '/[0-9]{4}/' || v_s.id::text || '-r[0-9]{1,3}\.pdf$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'service-agreements' and o.name = p_path) then
    raise exception 'validation_failed';
  end if;
  update public.service_agreements
     set storage_path = p_path, sha256 = p_sha256, byte_size = p_byte_size, rendered_at = now()
   where id = v_s.id;

  select r.customer_id into v_customer from public.requests r where r.id = v_s.request_id;
  select a.provider_id into v_provider from public.applications a where a.id = v_s.application_id;
  -- Transactional mail (no topic switch); queue_email skips a recipient with no confirmed address.
  perform public.queue_email('agreement:' || v_s.id || ':customer', 'agreement_ready_customer', v_customer,
                             v_s.request_id, v_s.id, v_until, v_s.region);
  perform public.queue_email('agreement:' || v_s.id || ':provider', 'agreement_ready_provider', v_provider,
                             v_s.request_id, v_s.id, v_until, v_s.region);
  if public.notices_enabled(v_s.region) then
    perform public.insert_notice('notice:agreement:' || v_s.id || ':customer', v_s.region, v_customer,
                                 'agreement_ready', v_s.request_id, v_s.id, null);
    perform public.insert_notice('notice:agreement:' || v_s.id || ':provider', v_s.region, v_provider,
                                 'agreement_ready', v_s.request_id, v_s.id, null);
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, new_value)
  values (null, 'agreement.rendered', 'service_agreements', v_s.id::text, v_s.region,
          jsonb_build_object('request_id', v_s.request_id, 'byte_size', p_byte_size));
  return jsonb_build_object('status', 'rendered', 'replayed', false);
end;
$$;

revoke all on function public.finish_agreement_render(uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.finish_agreement_render(uuid, text, text, integer) to service_role;

-- AC-8: the stored file of a rendered agreement, for the relay's mail step (lib/storage `downloadAgreement` reads the
-- path itself, never from a payload), with its hash so the bytes are checked before they are attached.
create function public.agreement_file(p_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_s  public.service_agreements%rowtype;
begin
  select s.* into v_s from public.service_agreements s where s.id = p_id;
  if not found or v_s.rendered_at is null then
    raise exception 'not_found';
  end if;
  return jsonb_build_object('number', v_s.number, 'storage_path', v_s.storage_path, 'sha256', v_s.sha256,
                            'byte_size', v_s.byte_size);
end;
$$;

revoke all on function public.agreement_file(uuid) from public, anon, authenticated, service_role;
grant execute on function public.agreement_file(uuid) to service_role;

-- AC-7: the last try failed; the relay alerts `agreement_render_failed` (ids only). A rendered agreement stays rendered.
create function public.fail_agreement_render(p_id uuid)
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
  update public.service_agreements set failed_at = now() where id = v_s.id;
  return jsonb_build_object('status', 'failed', 'region', v_s.region);
end;
$$;

revoke all on function public.fail_agreement_render(uuid) from public, anon, authenticated, service_role;
grant execute on function public.fail_agreement_render(uuid) to service_role;

-- AC-7, AC-10: admin queues a new attempt of a failed agreement under the next key (and so a new object path). The
-- same frozen content, so the document says the same. Audited.
create function public.admin_rerender_agreement(p_id uuid)
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
  if v_s.rendered_at is not null or v_s.failed_at is null then
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The parties' reads (AC-9). Every time from the database's now().
-- ═══════════════════════════════════════════════════════════════════════════

-- The caller's side of an agreement: 'customer', 'provider' or null (a stranger, or the provider of a failed pick,
-- who never has one: there is one agreement per unlocked application).
create function public.agreement_side(p_s public.service_agreements, p_uid uuid)
  returns text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select case when exists (select 1 from public.requests r where r.id = (p_s).request_id and r.customer_id = p_uid)
              then 'customer'
              when exists (select 1 from public.applications a where a.id = (p_s).application_id and a.provider_id = p_uid)
              then 'provider'
         end
$$;

revoke all on function public.agreement_side(public.service_agreements, uuid) from public, anon, authenticated, service_role;

create function public.agreement_visible(p_id uuid)
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
  if v_side is null then
    return false;
  end if;
  v_opened := case v_side when 'customer' then v_s.customer_opened_at else v_s.provider_opened_at end;
  return v_opened is null or v_opened > now() - interval '10 minutes';
end;
$$;

revoke all on function public.agreement_visible(uuid) from public, anon, authenticated, service_role;
grant execute on function public.agreement_visible(uuid) to authenticated;

-- The card's read: the request's agreement as the caller sees it, or null (none, not a party, or no longer shown).
create function public.my_agreement(p_request_id uuid)
  returns jsonb
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
  select s.* into v_s from public.service_agreements s
    join public.requests r on r.id = s.request_id and r.selected_application_id = s.application_id
   where s.request_id = p_request_id;
  if not found then
    return null;
  end if;
  v_side := public.agreement_side(v_s, (select auth.uid()));
  if v_side is null or not public.agreement_visible(v_s.id) then
    return null;
  end if;
  v_opened := case v_side when 'customer' then v_s.customer_opened_at else v_s.provider_opened_at end;
  return jsonb_build_object('id', v_s.id, 'number', v_s.number, 'side', v_side, 'opened', v_opened is not null);
end;
$$;

revoke all on function public.my_agreement(uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_agreement(uuid) to authenticated;

-- Try again on the pay and return pages (AC-2, AC-3): the version the caller already accepted for the request's current
-- pick (the customer's or that pick's provider's), or null. The retry sends it back; Postgres checks it again.
create function public.my_accepted_agreement(p_request_id uuid)
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select t.version
    from public.requests r
    join public.agreement_acceptances c on c.application_id = r.selected_application_id
    join public.agreement_templates t on t.id = c.template_id
    join public.applications a on a.id = c.application_id
   where r.id = p_request_id
     and ((c.role = 'customer' and r.customer_id = (select auth.uid()))
          or (c.role = 'provider' and a.provider_id = (select auth.uid())))
$$;

revoke all on function public.my_accepted_agreement(uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_accepted_agreement(uuid) to authenticated;

-- Download (AC-9): stamps the caller's side once and returns the path in the same call; the page signs a 300 second
-- link as the signed in user, which the bucket's read policy allows for 10 minutes after the open.
create function public.open_service_agreement(p_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_s     public.service_agreements%rowtype;
  v_side  text;
begin
  select s.* into v_s from public.service_agreements s where s.id = p_id for update;
  if not found or not public.agreement_visible(p_id) then
    raise exception 'not_found';
  end if;
  v_side := public.agreement_side(v_s, (select auth.uid()));
  if v_side = 'customer' and v_s.customer_opened_at is null then
    update public.service_agreements set customer_opened_at = now() where id = v_s.id;
  elsif v_side = 'provider' and v_s.provider_opened_at is null then
    update public.service_agreements set provider_opened_at = now() where id = v_s.id;
  end if;
  return jsonb_build_object('storage_path', v_s.storage_path);
end;
$$;

revoke all on function public.open_service_agreement(uuid) from public, anon, authenticated, service_role;
grant execute on function public.open_service_agreement(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Admin (AC-10): the list, the audited view, and render again (section 6). No edit, no delete.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.admin_agreements(p_query text default null, p_after uuid default null)
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

-- One admin view, recorded first; the page signs a 60 second link only after this row exists (14's photo pattern).
create function public.admin_agreement_link(p_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_s  public.service_agreements%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select s.* into v_s from public.service_agreements s where s.id = p_id;
  if not found or v_s.rendered_at is null then
    raise exception 'not_found';
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, new_value)
  values ((select auth.uid()), 'agreement.viewed', 'service_agreements', v_s.id::text, v_s.region,
          jsonb_build_object('path', v_s.storage_path, 'request_id', v_s.request_id));
  return jsonb_build_object('bucket', 'service-agreements', 'path', v_s.storage_path);
end;
$$;

revoke all on function public.admin_agreement_link(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_agreement_link(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. The bucket (AC-9, AC-11). Private, PDF only, 1 MiB. One read policy and no insert, update or delete policy;
--    the relay uploads with its own handle. The guard refuses any update or delete in this bucket for every role, and
--    an insert only for a path of an agreement with no file yet.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('service-agreements', 'service-agreements', false, 1048576, array['application/pdf'])
on conflict (id) do nothing;

-- The read check, run as the caller: a party for 10 minutes after it opened the agreement, or an admin with an
-- agreement.viewed row for this path from the last 2 minutes.
create function public.agreement_read_allowed(p_name text)
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
  if v_side is not null then
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

create policy service_agreements_read
  on storage.objects for select
  to authenticated
  using (
    bucket_id = any (array['service-agreements'])
    and public.agreement_read_allowed(name)
  );

create function public.service_agreements_storage_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_id  text;
begin
  if tg_op = 'INSERT' then
    if new.bucket_id <> 'service-agreements' then
      return new;
    end if;
    v_id := substring(coalesce(new.name, '') from '^[A-Z]{2,3}/[0-9]{4}/([0-9a-f-]{36})-r[0-9]{1,3}\.pdf$');
    if v_id is null
       or coalesce(current_setting('role', true), '') in ('authenticated', 'anon')
       or not exists (select 1 from public.service_agreements s
                       where s.id::text = v_id and s.rendered_at is null
                         and new.name like s.region || '/%') then
      raise exception 'upload_refused' using errcode = '42501';
    end if;
    return new;
  end if;
  if (tg_op = 'UPDATE' and (old.bucket_id = 'service-agreements' or new.bucket_id = 'service-agreements'))
     or (tg_op = 'DELETE' and old.bucket_id = 'service-agreements') then
    raise exception 'agreement_final' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.service_agreements_storage_guard() from public, anon, authenticated, service_role;

create trigger service_agreements_storage_guard
  before insert or update or delete on storage.objects
  for each row execute function public.service_agreements_storage_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Mail and notices (AC-8): two templates in queue_email and email_context, the notice kind agreement_ready.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.notifications drop constraint notifications_kind_valid;
alter table public.notifications add constraint notifications_kind_valid check (kind in (
  'new_offer', 'chosen', 'pay_your_fee', 'commission_received', 'contacts_ready', 'job_started', 'please_confirm',
  'job_completed', 'request_cancelled', 'pick_again', 'pick_ended', 'window_missed', 'payment_too_late',
  'fee_refunded', 'account_approved', 'account_rejected', 'account_suspended', 'pay_window_closing', 'closes_soon',
  'report_received', 'report_new_admin', 'report_handled', 'rate_provider', 'rating_received', 'document_expiring',
  'agreement_ready'));

-- 19a's template list plus the two agreement mails (spec 0011-20 AC-8).
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
                           'rate_provider', 'rating_received', 'document_expiring', 'agreement_ready_customer',
                           'agreement_ready_provider') then
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

-- 19a's body plus the two agreement mails (spec 0011-20 AC-8).
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
                    else exists (select 1 from public.applications a
                                  where a.id = v_agr.application_id and a.provider_id = v_rcp)
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. provider_jobs with the customer's accepted version per row (AC-3); request_offers with whether the paid
--     commission carries to the next pick (AC-4: the choose confirm shows the checkbox only then).
-- ═══════════════════════════════════════════════════════════════════════════

-- 11's body plus the customer's accepted version (spec 0011-20 AC-3).
create or replace function public.provider_jobs(p_tab text, p_after_changed_at timestamptz, p_after_id uuid)
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
    when 'active'  then array['UNLOCKED', 'STARTED', 'COMPLETED']
    when 'done'    then array['CONFIRMED', 'RATED', 'NOT_SELECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED']
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
               -- Spec 0011-20 AC-3: the version the customer accepted for this pick, the one the provider accepts.
               'agreement_version', (select t.version from public.agreement_acceptances c
                                       join public.agreement_templates t on t.id = c.template_id
                                      where c.application_id = m.id and c.role = 'customer'),
               'payment_deadline', case when m.status = 'SELECTED' then (m.req).payment_deadline end,
               'fee_deadline', case when m.status = 'AWAITING_FEE'
                                    then least((m.req).fee_deadline, (m.req).scheduled_start_at) end,
               -- Security review S11-1: the request's state and work dates only for the caller's own selected,
               -- unlocked application; a losing or past pick learns nothing of the winner's job (rule 2).
               'request_status', case when m.own then (m.req).status end,
               'actual_started_at', case when m.own then (m.req).actual_started_at end,
               'confirm_deadline', case when m.own then (m.req).confirm_deadline end,
               'closed_at', case when m.own then (m.req).closed_at end,
               'can_start', m.own and m.status = 'UNLOCKED' and (m.req).status = 'UNLOCKED'
                            and public.start_day_reached((m.req).id)) as j
        from (
          select a.id, a.status, a.status_changed_at, a.provider_fee_amount, a.unlocked_at, r as req,
                 (a.id = r.selected_application_id and a.unlocked_at is not null) as own
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

  return jsonb_build_object('timezone', v_tz, 'now', now(), 'has_more', v_more, 'rows', v_rows);
end;
$$;

revoke all on function public.provider_jobs(text, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.provider_jobs(text, timestamptz, uuid) to authenticated;

-- 19b's body plus the carried flag (spec 0011-20 AC-4).
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
    'chosen', v_chosen,
    -- Spec 0011-20 AC-4: a paid commission carries to the next pick, so the choose takes the agreement.
    'carried', v_req.status = 'OPEN' and public.carried_commission(v_req.id) is not null);
end;
$$;

revoke all on function public.request_offers(uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_offers(uuid) to authenticated;
