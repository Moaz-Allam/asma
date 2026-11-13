-- Position 02 (spec 0006): provider onboarding and approval.
--
-- A provider fills a profile, uploads a photo and identity papers straight from the browser into two
-- private buckets, and sends the file for review. Admin checks each document, approves or rejects, and
-- may suspend. The only output other positions read is provider_can_apply() (05).
--
-- A hostile client can call PostgREST and Storage directly with its own token, so every rule lives
-- here: no API role (service_role included) writes the three tables; definer functions do, in one
-- transaction with their audit row. Storage policies decide every upload, read and delete. Identity
-- always comes from auth.uid(), never from a path or an argument.
--
-- Order: tables -> RLS -> policies -> indexes -> grants -> helpers -> functions -> triggers -> buckets
-- and Storage policies -> settings -> backfill. Every function revokes PUBLIC and pins search_path
-- (supabase/tests/02). Errors are stable codes in the exception message; actions/provider.ts and
-- actions/admin-providers.ts map them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. providers: one row per provider, created by a trigger on profiles. Customers never read it.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.providers (
  id                 uuid primary key references public.profiles (id) on delete restrict,
  region             text        not null references public.regions (code),
  status             text        not null default 'draft',
  entity_type        text,
  legal_name         text,
  -- collate "C": an identifier never folds under a Turkish locale (rule 10).
  tax_number         text collate "C",
  review_reason      text,
  rejection_code     text,
  rejection_note     text,
  suspension_reason  text,
  submitted_at       timestamptz,
  decided_at         timestamptz,
  -- No foreign key: history outlives users.
  decided_by         uuid,
  approved_at        timestamptz,
  approved_name      text,
  created_at         timestamptz not null default now(),
  -- The version decide_provider compares. A verdict never touches it.
  updated_at         timestamptz not null default now(),

  constraint providers_status_valid
    check (status in ('draft', 'pending', 'approved', 'rejected', 'suspended')),
  constraint providers_entity_type_valid
    check (entity_type is null or entity_type in ('individual', 'company')),
  constraint providers_legal_name_length
    check (legal_name is null or char_length(btrim(legal_name)) between 2 and 200),
  -- D16 style, literal: a check cannot read another table. 10 digits in TR, 15 in KSA, so an 11 digit
  -- Turkish national ID can never land here (D112).
  constraint providers_tax_number_shape check (
    tax_number is null
    or (region = 'TR' and tax_number ~ '^[0-9]{10}$')
    or (region = 'KSA' and tax_number ~ '^[0-9]{15}$')
  ),
  constraint providers_company_fields check (
    (entity_type = 'company' and legal_name is not null and tax_number is not null)
    or (entity_type is distinct from 'company' and legal_name is null and tax_number is null)
  ),
  constraint providers_review_reason_valid check (
    review_reason is null
    or review_reason in ('first_submission', 'resubmitted', 'document_replaced', 'name_changed', 'company_changed')
  ),
  constraint providers_rejection_code_valid check (
    rejection_code is null
    or rejection_code in ('document_unclear', 'selfie_mismatch', 'criminal_record_invalid',
                          'document_expired', 'name_mismatch', 'photo_not_suitable')
  ),
  constraint providers_rejection_note_length
    check (rejection_note is null or char_length(rejection_note) <= 300),
  constraint providers_suspension_reason_length
    check (suspension_reason is null or char_length(btrim(suspension_reason)) between 5 and 500),
  constraint providers_suspended_has_reason
    check (status <> 'suspended' or suspension_reason is not null)
);

alter table public.providers enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. provider_profiles: the public part. Position 06 adds the customer read policy; nothing else here
--    may ever reach a customer.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.provider_profiles (
  provider_id       uuid primary key references public.providers (id) on delete restrict,
  region            text        not null references public.regions (code),
  bio               text        not null,
  years_experience  smallint    not null,
  languages         text[]      not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Code points, as [...text].length counts them in the browser.
  constraint provider_profiles_bio_length check (char_length(btrim(bio)) between 30 and 600),
  constraint provider_profiles_years_range check (years_experience between 0 and 60),
  -- lib/provider/options.ts PROVIDER_LANGUAGES holds the same list; a test proves they agree.
  constraint provider_profiles_languages_valid check (
    cardinality(languages) >= 1 and languages <@ array['tr', 'ar', 'en']::text[]
  )
);

alter table public.provider_profiles enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. provider_documents: one row per provider and type, replaced in place. The bucket follows from
--    the type. object_id is storage.objects.id, new at every creation: verdicts and views compare it,
--    because a path can be used twice. The ID number is never stored (D114).
-- ═══════════════════════════════════════════════════════════════════════════

create table public.provider_documents (
  id              uuid primary key default gen_random_uuid(),
  provider_id     uuid        not null references public.providers (id) on delete restrict,
  region          text        not null references public.regions (code),
  type            text        not null,
  storage_path    text collate "C" not null unique,
  object_id       uuid        not null,
  mime_type       text        not null,
  size_bytes      bigint      not null,
  status          text        not null default 'pending',
  rejection_code  text,
  rejection_note  text,
  valid_until     date,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  uploaded_at     timestamptz not null default now(),

  constraint provider_documents_one_per_type unique (provider_id, type),
  constraint provider_documents_type_valid check (
    type in ('profile_photo', 'id_front', 'id_back', 'selfie', 'criminal_record', 'skill_certificate')
  ),
  constraint provider_documents_status_valid check (status in ('pending', 'approved', 'rejected')),
  constraint provider_documents_rejection_code_valid check (
    rejection_code is null
    or rejection_code in ('document_unclear', 'selfie_mismatch', 'criminal_record_invalid',
                          'document_expired', 'name_mismatch', 'photo_not_suitable')
  ),
  constraint provider_documents_rejected_has_code check (status <> 'rejected' or rejection_code is not null),
  constraint provider_documents_rejection_note_length
    check (rejection_note is null or char_length(rejection_note) <= 300),
  constraint provider_documents_valid_until_types
    check (valid_until is null or type in ('id_front', 'id_back', 'criminal_record'))
);

alter table public.provider_documents enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. is_admin(): who is admin, from profiles.role, so a demotion counts at once and a token cannot lag
--    (D116). Definer, so a policy can call it without reading profiles under the caller's RLS.
--    Policies wrap it in a subselect, so it runs once per query.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.is_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce((select p.role = 'admin' from public.profiles p where p.id = (select auth.uid())), false)
$$;

revoke all on function public.is_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_admin() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Policies: a provider reads their own rows, an admin reads all, nobody else reads anything.
--    No write policy and no write grant: the functions below are the only writers (AC-21).
-- ═══════════════════════════════════════════════════════════════════════════

create policy providers_read_own
  on public.providers for select
  to authenticated
  using (id = (select auth.uid()));

create policy providers_read_admin
  on public.providers for select
  to authenticated
  using ((select public.is_admin()));

create policy provider_profiles_read_own
  on public.provider_profiles for select
  to authenticated
  using (provider_id = (select auth.uid()));

create policy provider_profiles_read_admin
  on public.provider_profiles for select
  to authenticated
  using ((select public.is_admin()));

create policy provider_documents_read_own
  on public.provider_documents for select
  to authenticated
  using (provider_id = (select auth.uid()));

create policy provider_documents_read_admin
  on public.provider_documents for select
  to authenticated
  using ((select public.is_admin()));

create index providers_region_idx on public.providers (region);
create index providers_submitted_idx on public.providers (status, submitted_at, id);
create index providers_decided_idx on public.providers (status, decided_at, id);
create index provider_profiles_region_idx on public.provider_profiles (region);
create index provider_documents_region_idx on public.provider_documents (region);
-- admin_may_read() looks for a fresh view row by one admin, on every signed link.
create index audit_log_document_viewed_idx
  on public.audit_log (actor_id, created_at)
  where action = 'document.viewed';

-- D77: each table its own grants. Read only for both API roles; no write grant to anyone.
grant select on table public.providers to authenticated, service_role;
grant select on table public.provider_profiles to authenticated, service_role;
grant select on table public.provider_documents to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Internal helpers. Executable by no API role: only the definer functions below call them.
-- ═══════════════════════════════════════════════════════════════════════════

-- The bucket a document type lives in. profile_photo has its own bucket, so 06 can open photos to
-- customers without any rule touching identity papers.
create function public.provider_type_bucket(p_type text)
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select case
    when p_type = 'profile_photo' then 'provider-photos'
    when p_type in ('id_front', 'id_back', 'selfie', 'criminal_record', 'skill_certificate') then 'provider-documents'
  end
$$;

revoke all on function public.provider_type_bucket(text) from public, anon, authenticated, service_role;

-- The document type of a well formed object name in that bucket, or null:
--   provider-photos     {uuid}/profile_photo/{uuid}.jpg
--   provider-documents  {uuid}/{id_front|id_back|selfie}/{uuid}.{jpg|png}
--                       {uuid}/{criminal_record|skill_certificate}/{uuid}.{jpg|png|pdf}
-- Lower case uuids only, as auth.uid()::text and crypto.randomUUID() write them.
create function public.provider_object_type(p_bucket text, p_name text)
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  with u as (select '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' as id)
  select case
    when p_bucket = 'provider-photos'
         and p_name ~ ('^' || u.id || '/profile_photo/' || u.id || '\.jpg$')
      then 'profile_photo'
    when p_bucket = 'provider-documents'
         and p_name ~ ('^' || u.id || '/(id_front|id_back|selfie)/' || u.id || '\.(jpg|png)$')
      then split_part(p_name, '/', 2)
    when p_bucket = 'provider-documents'
         and p_name ~ ('^' || u.id || '/(criminal_record|skill_certificate)/' || u.id || '\.(jpg|png|pdf)$')
      then split_part(p_name, '/', 2)
  end
  from u
$$;

revoke all on function public.provider_object_type(text, text) from public, anon, authenticated, service_role;

-- The content type an extension stands for.
create function public.provider_ext_mime(p_name text)
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select case lower(substring(p_name from '\.([A-Za-z]+)$'))
    when 'jpg' then 'image/jpeg'
    when 'png' then 'image/png'
    when 'pdf' then 'application/pdf'
  end
$$;

revoke all on function public.provider_ext_mime(text) from public, anon, authenticated, service_role;

-- The current documents consent version of a region (AC-6). Null when the row is missing, and then
-- nobody can consent or upload a document, which fails closed.
create function public.provider_docs_consent_version(p_region text)
  returns text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select s.value #>> '{}'
    from public.platform_settings s
   where s.region = p_region and s.key = 'provider_docs_consent_version'
$$;

revoke all on function public.provider_docs_consent_version(text) from public, anon, authenticated, service_role;

-- Whether a user accepted the current documents consent of their region.
create function public.provider_has_docs_consent(p_user uuid, p_region text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select exists (
    select 1 from public.terms_acceptances t
     where t.user_id = p_user
       and t.terms_version = public.provider_docs_consent_version(p_region)
  )
$$;

revoke all on function public.provider_has_docs_consent(uuid, text) from public, anon, authenticated, service_role;

-- The caller's providers row, locked. Refuses anyone who is not a provider with a row, so a customer or
-- an admin can never save, consent, register or submit (AC-21), even a promoted provider.
create function public.provider_caller()
  returns public.providers
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_row public.providers%rowtype;
begin
  select pr.* into v_row
    from public.providers pr
    join public.profiles p on p.id = pr.id and p.role = 'provider'
   where pr.id = (select auth.uid())
     for update of pr;
  if not found then
    raise exception 'forbidden';
  end if;
  return v_row;
end;
$$;

revoke all on function public.provider_caller() from public, anon, authenticated, service_role;

-- Every entry to pending from approved: the status, the reason, submitted_at reset, one audit row
-- (AC-12). The approved name goes into the audit row, so a rename can be read against it.
create function public.provider_back_to_review(p_provider public.providers, p_reason text)
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  update public.providers
     set status = 'pending',
         review_reason = p_reason,
         submitted_at = now(),
         rejection_code = null,
         rejection_note = null
   where id = p_provider.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (auth.uid(), 'provider.back_to_review', 'provider', p_provider.id::text, p_provider.region,
          jsonb_build_object('status', p_provider.status),
          jsonb_build_object('status', 'pending', 'review_reason', p_reason,
                             'approved_name', p_provider.approved_name));
end;
$$;

revoke all on function public.provider_back_to_review(public.providers, text)
  from public, anon, authenticated, service_role;

-- Whether a document row's object still exists in Storage.
create function public.provider_document_object_exists(p_document public.provider_documents)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select exists (
    select 1 from storage.objects o
     where o.id = p_document.object_id
       and o.bucket_id = public.provider_type_bucket(p_document.type)
       and o.name collate "C" = p_document.storage_path
  )
$$;

revoke all on function public.provider_document_object_exists(public.provider_documents)
  from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The contact scanner (AC-3, D116): the one copy. Only definer functions call it, so nobody can probe
--    it through the API. Position 05 calls the same function for messages. The pgTAP corpus is the
--    must catch and must pass table in docs/specs/0006-provider-onboarding/verify.md.
-- ═══════════════════════════════════════════════════════════════════════════

-- NFKC; Turkish capitals folded by hand, then lower() on what is left, so no locale is ever involved;
-- soft hyphens, combining marks, tatweel, Arabic marks and zero width or direction characters removed;
-- Turkish letters to their Latin base; Arabic Indic and Persian digits to 0 to 9; Arabic letter
-- variants to one form (hamza seats, alef maqsura, taa marbuta, Persian kaf and yeh).
create function public.contact_normalise(p_text text)
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select translate(
           regexp_replace(
             lower(translate(normalize(coalesce(p_text, ''), nfkc), 'İIĞÜŞÖÇÂÎÛ', 'iiğüşöçâîû')),
             '[­̀-ͯـً-ٰٟۖ-ۭ​-‏‪-‮⁠-⁤﻿]',
             '',
             'g'
           ),
           'ığüşöçâîû٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹أإآٱىةؤئکی',
           'iguscoaiu01234567890123456789ااااي' || 'هويكي'
         )
$$;

revoke all on function public.contact_normalise(text) from public, anon, authenticated, service_role;

create function public.has_contact_info(p_text text)
  returns boolean
  language plpgsql
  immutable
  security invoker
  set search_path = ''
as $$
declare
  t       text := public.contact_normalise(p_text);
  v_token text;
  v_word  text;
  v_run   integer := 0;
  -- Digits 0 to 9 spelled out, folded as contact_normalise() folds them.
  c_words constant text[] := array[
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'sifir', 'bir', 'iki', 'uc', 'dort', 'bes', 'alti', 'yedi', 'sekiz', 'dokuz',
    'صفر', 'واحد', 'اثنان', 'اثنين', 'اتنين', 'ثلاثه', 'ثلاث', 'تلاته', 'اربعه', 'اربع',
    'خمسه', 'خمس', 'سته', 'ست', 'سبعه', 'سبع', 'ثمانيه', 'ثماني', 'ثمان', 'تمانيه', 'تسعه', 'تسع'
  ];
begin
  if t = '' then
    return false;
  end if;

  -- A run of 7 or more digits, with gaps of at most 2 characters between them.
  if t ~ '[0-9](.{0,2}[0-9]){6,}' then
    return true;
  end if;

  -- Emails, plain and spelled with at and dot (brackets allowed).
  if t ~ '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+'
     or t ~ ('[a-z0-9._-]+[[:space:]]*[[({<]?[[:space:]]*\mat\M[[:space:]]*[])}>]?[[:space:]]*'
             || '[a-z0-9-]+[[:space:]]*[[({<]?[[:space:]]*\mdot\M[[:space:]]*[])}>]?[[:space:]]*[a-z]{2,}') then
    return true;
  end if;

  -- Links, and bare domains on a fixed list of endings (wa.me and t.me among them).
  if t ~ 'https?://|www\.'
     or t ~ '[a-z0-9-]\.(com|net|org|info|io|co|me|app|tr|sa)\M' then
    return true;
  end if;

  -- @ followed by 3 or more word characters.
  if t ~ '@[a-z0-9_.ء-ي]{3,}' then
    return true;
  end if;

  -- The names of WhatsApp, Telegram and Instagram, in Latin and Arabic letters.
  if t ~ '\mwh?ats?ap+|\mtele?gram|\minsta(gram[a-z]*)?\M'
     or t ~ 'واتس|وتساب|تلجرام|تليجرام|تيليجرام|تلغرام|تيليغرام|انستقرام|انستغرام|انستجرام|انستا' then
    return true;
  end if;

  -- 5 or more spelled digits (or digit groups) in a row. A leading Arabic waw ("and") is allowed.
  foreach v_token in array regexp_split_to_array(t, '[^a-z0-9ء-ي]+') loop
    v_word := v_token;
    if v_word ~ '^و..' and not (v_word = any (c_words)) then
      v_word := substr(v_word, 2);
    end if;
    if v_word ~ '^[0-9]+$' or v_word = any (c_words) then
      v_run := v_run + 1;
      if v_run >= 5 then
        return true;
      end if;
    elsif v_token <> '' then
      v_run := 0;
    end if;
  end loop;

  return false;
end;
$$;

revoke all on function public.has_contact_info(text) from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Readings other positions use (AC-20). Invoker: each reads through the caller's RLS, so a row the
--    caller cannot read gives null, never a guess.
-- ═══════════════════════════════════════════════════════════════════════════

-- The one list of required types. criminal_record is required unless the setting is the JSON value
-- false, so a missing or odd value reads as required. The optional certificate is never on it.
create function public.provider_required_types(p_region text)
  returns text[]
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select array['profile_photo', 'id_front', 'id_back', 'selfie']
         || case
              when coalesce((select s.value = 'false'::jsonb from public.platform_settings s
                              where s.region = p_region and s.key = 'criminal_record_required'), false)
              then array[]::text[]
              else array['criminal_record']
            end
$$;

revoke all on function public.provider_required_types(text) from public, anon, authenticated, service_role;
grant execute on function public.provider_required_types(text) to authenticated;

-- draft, pending, approved, rejected, suspended, or document_expired: an approved provider with a
-- required document whose valid_until is before today. A reading, not a stored state: no job needed.
create function public.provider_standing(p_provider_id uuid)
  returns text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select case
    when pr.status = 'approved' and exists (
      select 1 from public.provider_documents d
       where d.provider_id = pr.id
         and d.type = any (public.provider_required_types(pr.region))
         and d.valid_until < current_date
    ) then 'document_expired'
    else pr.status
  end
  from public.providers pr
  where pr.id = p_provider_id
$$;

revoke all on function public.provider_standing(uuid) from public, anon, authenticated, service_role;
grant execute on function public.provider_standing(uuid) to authenticated;

-- Position 05's insert policy calls this.
create function public.provider_can_apply(p_provider_id uuid)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select coalesce(public.provider_standing(p_provider_id) = 'approved', false)
$$;

revoke all on function public.provider_can_apply(uuid) from public, anon, authenticated, service_role;
grant execute on function public.provider_can_apply(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Storage rules (AC-22). Storage calls these as the uploading user, inside its policies.
-- ═══════════════════════════════════════════════════════════════════════════

-- May the caller store this object? A providers row for auth.uid() (so never yes for a customer or an
-- admin), their own folder, the right type and extension for that bucket, not suspended, the documents
-- consent for documents, and under 20 counted objects. Counted means pointed to by a row, or an orphan
-- younger than 24 hours (D120). Storage runs it twice per upload; the cap stops a storage attack, not
-- one extra file under a race.
create function public.provider_may_store(p_bucket text, p_name text)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.providers%rowtype;
  v_type text := public.provider_object_type(p_bucket, p_name);
begin
  if v_uid is null or v_type is null or split_part(p_name, '/', 1) <> v_uid::text then
    return false;
  end if;

  select pr.* into v_row
    from public.providers pr
    join public.profiles p on p.id = pr.id and p.role = 'provider'
   where pr.id = v_uid;
  if not found or v_row.status = 'suspended' then
    return false;
  end if;

  if p_bucket = 'provider-documents' and not public.provider_has_docs_consent(v_uid, v_row.region) then
    return false;
  end if;

  return (
    select count(*) < 20
      from storage.objects o
     where o.bucket_id in ('provider-documents', 'provider-photos')
       and o.name like v_uid::text || '/%'
       and (o.created_at > now() - interval '24 hours'
            or exists (select 1 from public.provider_documents d
                        where d.storage_path = o.name collate "C"))
  );
end;
$$;

revoke all on function public.provider_may_store(text, text) from public, anon, authenticated, service_role;
grant execute on function public.provider_may_store(text, text) to authenticated;

-- May the caller (an admin) read this object? Only with a document.viewed row by this admin for this
-- object id and this path in the last 2 minutes, so no admin token reads an ID unrecorded, and a view
-- row for a replaced file never opens a new object at a reused path (D120).
create function public.admin_may_read(p_object_id uuid, p_name text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select public.is_admin()
         and exists (
           select 1 from public.audit_log a
            where a.action = 'document.viewed'
              and a.actor_id = (select auth.uid())
              and a.created_at > now() - interval '2 minutes'
              and a.new_value ->> 'object_id' = p_object_id::text
              and a.new_value ->> 'path' = p_name
         )
$$;

revoke all on function public.admin_may_read(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_may_read(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Provider functions. Each needs a providers row for auth.uid() (provider_caller()).
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 1 (AC-2, AC-3, AC-12). The form sends every field on every save, so changes are found by
-- comparing the stored values with the normalised new ones. Returns { backToReview }.
create function public.save_provider_profile(
  p_entity_type text,
  p_legal_name text,
  p_tax_number text,
  p_bio text,
  p_years integer,
  p_languages text[]
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row        public.providers%rowtype := public.provider_caller();
  v_bio        text := btrim(coalesce(p_bio, ''));
  v_legal      text;
  v_tax        text;
  v_languages  text[];
  v_changed    boolean;
  v_back       boolean := false;
begin
  if v_row.status = 'suspended' then
    raise exception 'provider_suspended';
  end if;

  select array_agg(distinct l order by l) into v_languages from unnest(p_languages) l;

  if p_entity_type is null or p_entity_type not in ('individual', 'company')
     or char_length(v_bio) not between 30 and 600
     or p_years is null or p_years not between 0 and 60
     or v_languages is null or not (v_languages <@ array['tr', 'ar', 'en']::text[]) then
    raise exception 'validation_failed';
  end if;

  if p_entity_type = 'company' then
    v_legal := btrim(coalesce(p_legal_name, ''));
    -- Arabic Indic and Persian digits folded, spaces and dashes stripped.
    v_tax := regexp_replace(
               translate(coalesce(p_tax_number, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
               '[[:space:] ‐-―-]', '', 'g');
    if char_length(v_legal) not between 2 and 200
       or not ((v_row.region = 'TR' and v_tax ~ '^[0-9]{10}$')
               or (v_row.region = 'KSA' and v_tax ~ '^[0-9]{15}$')) then
      raise exception 'validation_failed';
    end if;
  end if;

  if public.has_contact_info(v_bio) then
    raise exception 'contact_info_in_bio';
  end if;

  v_changed := v_row.entity_type is not null
               and (v_row.entity_type, v_row.legal_name, v_row.tax_number)
                   is distinct from (p_entity_type, v_legal, v_tax::text);

  insert into public.provider_profiles (provider_id, region, bio, years_experience, languages)
  values (v_row.id, v_row.region, v_bio, p_years, v_languages)
  on conflict (provider_id) do update
    set bio = excluded.bio,
        years_experience = excluded.years_experience,
        languages = excluded.languages,
        updated_at = now();

  update public.providers
     set entity_type = p_entity_type,
         legal_name = v_legal,
         tax_number = v_tax,
         updated_at = now()
   where id = v_row.id;

  if v_changed then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
    values (v_row.id, 'provider.company_changed', 'provider', v_row.id::text, v_row.region,
            jsonb_build_object('entity_type', v_row.entity_type, 'legal_name', v_row.legal_name,
                               'tax_number', v_row.tax_number),
            jsonb_build_object('entity_type', p_entity_type, 'legal_name', v_legal, 'tax_number', v_tax));
    if v_row.status = 'approved' then
      perform public.provider_back_to_review(v_row, 'company_changed');
      v_back := true;
    end if;
  end if;

  return jsonb_build_object('backToReview', v_back);
end;
$$;

revoke all on function public.save_provider_profile(text, text, text, text, integer, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.save_provider_profile(text, text, text, text, integer, text[]) to authenticated;

-- The documents consent (AC-6): one terms_acceptances row with the region's current version, the
-- locale and database time. A retry adds nothing.
create function public.accept_provider_docs_consent(p_locale text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row     public.providers%rowtype := public.provider_caller();
  v_version text := public.provider_docs_consent_version(v_row.region);
begin
  if v_row.status = 'suspended' then
    raise exception 'provider_suspended';
  end if;
  if p_locale is null or p_locale not in ('ar', 'tr', 'en') or v_version is null then
    raise exception 'validation_failed';
  end if;

  insert into public.terms_acceptances (user_id, region, terms_version, locale)
  values (v_row.id, v_row.region, v_version, p_locale)
  on conflict (user_id, terms_version) do nothing;

  return jsonb_build_object('version', v_version);
end;
$$;

revoke all on function public.accept_provider_docs_consent(text) from public, anon, authenticated, service_role;
grant execute on function public.accept_provider_docs_consent(text) to authenticated;

-- Register an uploaded object (AC-7, AC-8, AC-12). The bucket follows from the type; the object's id,
-- size and type come from storage.objects, never from the client. Replaces the type's row in place and
-- returns it with previous_path and sweep: every object the action should delete now (the previous
-- file, and any orphan in that type's folder older than the new object). A retry with the object
-- already registered returns the row and writes nothing.
create function public.register_provider_document(p_type text, p_path text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row      public.providers%rowtype := public.provider_caller();
  v_bucket   text := public.provider_type_bucket(p_type);
  v_object   record;
  v_mime     text;
  v_size     bigint;
  v_old      public.provider_documents%rowtype;
  v_doc      public.provider_documents%rowtype;
  v_twin     public.provider_documents%rowtype;
  v_previous text;
  v_sweep    text[];
  v_back     boolean := false;
begin
  if v_row.status = 'suspended' then
    raise exception 'provider_suspended';
  end if;
  if v_bucket is null then
    raise exception 'validation_failed';
  end if;
  -- Another provider's folder, or a name of another type, reads as no such file.
  if public.provider_object_type(v_bucket, p_path) is distinct from p_type
     or split_part(p_path, '/', 1) <> v_row.id::text then
    raise exception 'file_missing';
  end if;

  select o.id, o.created_at, o.metadata into v_object
    from storage.objects o
   where o.bucket_id = v_bucket and o.name collate "C" = p_path;
  if not found then
    raise exception 'file_missing';
  end if;

  v_mime := v_object.metadata ->> 'mimetype';
  v_size := nullif(v_object.metadata ->> 'size', '')::bigint;
  if v_mime is distinct from public.provider_ext_mime(p_path) then
    raise exception 'file_type_refused';
  end if;
  if v_size is null or v_size <= 0
     or v_size > (case when v_bucket = 'provider-photos' then 2097152 else 10485760 end) then
    raise exception 'file_too_large';
  end if;

  select * into v_old from public.provider_documents where provider_id = v_row.id and type = p_type;

  if found and v_old.object_id = v_object.id then
    return to_jsonb(v_old) || jsonb_build_object('previous_path', null, 'sweep', '[]'::jsonb,
                                                 'backToReview', false, 'created', false);
  end if;

  if v_old.id is not null then
    v_previous := v_old.storage_path;
    update public.provider_documents
       set storage_path = p_path, object_id = v_object.id, mime_type = v_mime, size_bytes = v_size,
           status = 'pending', rejection_code = null, rejection_note = null, valid_until = null,
           reviewed_by = null, reviewed_at = null, uploaded_at = now()
     where id = v_old.id
    returning * into v_doc;
  else
    insert into public.provider_documents
      (provider_id, region, type, storage_path, object_id, mime_type, size_bytes)
    values (v_row.id, v_row.region, p_type, p_path, v_object.id, v_mime, v_size)
    returning * into v_doc;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_row.id, 'document.registered', 'provider_document', v_doc.id::text, v_row.region,
          case when v_old.id is null then null
               else jsonb_build_object('status', v_old.status, 'object_id', v_old.object_id) end,
          jsonb_build_object('type', p_type, 'object_id', v_object.id, 'provider_id', v_row.id));

  -- The two ID sides are one document (AC-8).
  if p_type in ('id_front', 'id_back') then
    select * into v_twin from public.provider_documents
     where provider_id = v_row.id
       and type = case when p_type = 'id_front' then 'id_back' else 'id_front' end;
    if found then
      if v_twin.valid_until < current_date
         and not (v_twin.status = 'rejected' and v_twin.rejection_code = 'document_expired') then
        update public.provider_documents
           set status = 'rejected', rejection_code = 'document_expired', rejection_note = null,
               reviewed_by = null, reviewed_at = now()
         where id = v_twin.id;
        insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
        values (null, 'document.reviewed', 'provider_document', v_twin.id::text, v_row.region,
                jsonb_build_object('status', v_twin.status, 'object_id', v_twin.object_id),
                jsonb_build_object('status', 'rejected', 'rejection_code', 'document_expired',
                                   'object_id', v_twin.object_id, 'type', v_twin.type));
      elsif v_twin.status = 'rejected' and v_twin.rejection_code <> 'document_expired' then
        update public.provider_documents
           set status = 'pending', rejection_code = null, rejection_note = null,
               reviewed_by = null, reviewed_at = null
         where id = v_twin.id;
      end if;
    end if;
  end if;

  if v_row.status = 'approved' then
    perform public.provider_back_to_review(v_row, 'document_replaced');
    v_back := true;
  end if;

  select coalesce(array_agg(o.name order by o.name), array[]::text[]) into v_sweep
    from storage.objects o
   where o.bucket_id = v_bucket
     and o.name like v_row.id::text || '/' || p_type || '/%'
     and o.name collate "C" <> p_path
     and o.created_at <= v_object.created_at
     and not exists (select 1 from public.provider_documents d where d.storage_path = o.name collate "C");

  return to_jsonb(v_doc) || jsonb_build_object('previous_path', v_previous, 'sweep', to_jsonb(v_sweep),
                                               'backToReview', v_back, 'created', true);
end;
$$;

revoke all on function public.register_provider_document(text, text) from public, anon, authenticated, service_role;
grant execute on function public.register_provider_document(text, text) to authenticated;

-- Send for review (AC-9). In draft or rejected only. Returns { status, missing, rejected, objectsMissing }
-- and writes nothing when anything is missing; from pending or approved it returns the status.
create function public.submit_provider_file()
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row       public.providers%rowtype := public.provider_caller();
  v_required  text[];
  v_missing   text[] := array[]::text[];
  v_rejected  text[] := array[]::text[];
  v_gone      text[] := array[]::text[];
  v_type      text;
  v_doc       public.provider_documents%rowtype;
  v_reason    text;
begin
  if v_row.status = 'suspended' then
    raise exception 'provider_suspended';
  end if;
  if v_row.status in ('pending', 'approved') then
    return jsonb_build_object('status', v_row.status, 'missing', '[]'::jsonb, 'rejected', '[]'::jsonb,
                              'objectsMissing', '[]'::jsonb);
  end if;

  if v_row.entity_type is null
     or not exists (select 1 from public.provider_profiles where provider_id = v_row.id) then
    v_missing := v_missing || 'profile'::text;
  end if;
  if not public.provider_has_docs_consent(v_row.id, v_row.region) then
    v_missing := v_missing || 'consent'::text;
  end if;

  v_required := public.provider_required_types(v_row.region);
  foreach v_type in array v_required loop
    select * into v_doc from public.provider_documents where provider_id = v_row.id and type = v_type;
    if not found then
      v_missing := v_missing || v_type;
    elsif not public.provider_document_object_exists(v_doc) then
      v_gone := v_gone || v_type;
    elsif v_doc.status = 'rejected' then
      v_rejected := v_rejected || v_type;
    end if;
  end loop;

  if cardinality(v_missing) > 0 or cardinality(v_rejected) > 0 or cardinality(v_gone) > 0 then
    return jsonb_build_object('status', v_row.status, 'missing', to_jsonb(v_missing),
                              'rejected', to_jsonb(v_rejected), 'objectsMissing', to_jsonb(v_gone));
  end if;

  v_reason := case when v_row.status = 'draft' then 'first_submission' else 'resubmitted' end;
  update public.providers
     set status = 'pending', submitted_at = now(), review_reason = v_reason,
         rejection_code = null, rejection_note = null
   where id = v_row.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values (v_row.id, 'provider.submitted', 'provider', v_row.id::text, v_row.region,
          jsonb_build_object('status', v_row.status),
          jsonb_build_object('status', 'pending', 'review_reason', v_reason));

  return jsonb_build_object('status', 'pending', 'missing', '[]'::jsonb, 'rejected', '[]'::jsonb,
                            'objectsMissing', '[]'::jsonb);
end;
$$;

revoke all on function public.submit_provider_file() from public, anon, authenticated, service_role;
grant execute on function public.submit_provider_file() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. Admin functions. Each refuses anyone but an admin (is_admin()) with forbidden, and locks the
--     provider row first, so a provider and an admin acting at once see each other's result.
-- ═══════════════════════════════════════════════════════════════════════════

-- The provider row for an admin, locked; not_found for a draft or unknown id.
create function public.provider_for_admin(p_provider_id uuid)
  returns public.providers
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_row public.providers%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select * into v_row from public.providers where id = p_provider_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  return v_row;
end;
$$;

revoke all on function public.provider_for_admin(uuid) from public, anon, authenticated, service_role;

-- Show a file (AC-16): a document.viewed row first, then the action signs a 60 second link, which
-- Storage allows only with this row (admin_may_read). Returns bucket, path and type.
create function public.log_document_view(p_document_id uuid, p_object_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_doc public.provider_documents%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select * into v_doc from public.provider_documents where id = p_document_id;
  if not found then
    raise exception 'not_found';
  end if;
  if v_doc.object_id is distinct from p_object_id then
    raise exception 'stale_document';
  end if;
  if not public.provider_document_object_exists(v_doc) then
    raise exception 'file_missing';
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, new_value)
  values ((select auth.uid()), 'document.viewed', 'provider_document', v_doc.id::text, v_doc.region,
          jsonb_build_object('type', v_doc.type, 'path', v_doc.storage_path, 'object_id', v_doc.object_id,
                             'provider_id', v_doc.provider_id));

  return jsonb_build_object('bucket', public.provider_type_bucket(v_doc.type), 'path', v_doc.storage_path,
                            'mime_type', v_doc.mime_type);
end;
$$;

revoke all on function public.log_document_view(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.log_document_view(uuid, uuid) to authenticated;

-- Mark documents match or reject (AC-17), while the file is pending. ID front and back take one
-- verdict together. Match needs this admin's view row for each object (view_required); the ID and the
-- criminal record need a valid_until after today and at most 15 years ahead; other types refuse a date.
-- Reject needs one of the six codes. One document.reviewed row per document.
create function public.review_provider_documents(
  p_provider_id uuid,
  p_ids uuid[],
  p_object_ids uuid[],
  p_verdict text,
  p_code text,
  p_note text,
  p_valid_until date
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row    public.providers%rowtype := public.provider_for_admin(p_provider_id);
  v_uid    uuid := (select auth.uid());
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_types  text[];
  v_doc    public.provider_documents%rowtype;
  v_i      integer;
begin
  if v_row.status <> 'pending' then
    raise exception 'not_under_review';
  end if;
  if p_ids is null or p_object_ids is null or cardinality(p_ids) not between 1 and 2
     or cardinality(p_ids) <> cardinality(p_object_ids)
     or p_verdict is null or p_verdict not in ('approved', 'rejected') then
    raise exception 'validation_failed';
  end if;

  -- Every id belongs to this provider; an id of another provider is refused.
  select array_agg(d.type order by d.type) into v_types
    from public.provider_documents d
   where d.id = any (p_ids) and d.provider_id = p_provider_id;
  if v_types is null or cardinality(v_types) <> cardinality(p_ids) then
    raise exception 'not_found';
  end if;
  if (cardinality(v_types) = 2 and v_types <> array['id_back', 'id_front'])
     or (cardinality(v_types) = 1 and v_types[1] in ('id_front', 'id_back')) then
    raise exception 'validation_failed';
  end if;

  if p_verdict = 'approved' then
    if v_types[1] in ('id_back', 'criminal_record') then
      if p_valid_until is null then
        raise exception 'valid_until_required';
      end if;
      if p_valid_until <= current_date or p_valid_until > (current_date + interval '15 years')::date then
        raise exception 'valid_until_invalid';
      end if;
    elsif p_valid_until is not null then
      raise exception 'valid_until_invalid';
    end if;
  else
    if p_code is null or p_code not in ('document_unclear', 'selfie_mismatch', 'criminal_record_invalid',
                                        'document_expired', 'name_mismatch', 'photo_not_suitable') then
      raise exception 'reason_required';
    end if;
    if char_length(coalesce(v_note, '')) > 300 then
      raise exception 'validation_failed';
    end if;
  end if;

  for v_i in 1 .. cardinality(p_ids) loop
    select * into v_doc from public.provider_documents where id = p_ids[v_i];
    if v_doc.object_id is distinct from p_object_ids[v_i] then
      raise exception 'stale_document';
    end if;
    if p_verdict = 'approved' and not exists (
      select 1 from public.audit_log a
       where a.action = 'document.viewed' and a.actor_id = v_uid
         and a.new_value ->> 'object_id' = v_doc.object_id::text
    ) then
      raise exception 'view_required';
    end if;
  end loop;

  for v_i in 1 .. cardinality(p_ids) loop
    select * into v_doc from public.provider_documents where id = p_ids[v_i];
    update public.provider_documents
       set status = p_verdict,
           rejection_code = case when p_verdict = 'rejected' then p_code end,
           rejection_note = case when p_verdict = 'rejected' then v_note end,
           valid_until = case when p_verdict = 'approved' then p_valid_until end,
           reviewed_by = v_uid,
           reviewed_at = now()
     where id = v_doc.id;
    insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
    values (v_uid, 'document.reviewed', 'provider_document', v_doc.id::text, v_doc.region,
            jsonb_build_object('status', v_doc.status, 'object_id', v_doc.object_id),
            jsonb_build_object('status', p_verdict, 'type', v_doc.type, 'object_id', v_doc.object_id,
                               'rejection_code', case when p_verdict = 'rejected' then p_code end,
                               'valid_until', case when p_verdict = 'approved' then p_valid_until end));
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.review_provider_documents(uuid, uuid[], uuid[], text, text, text, date)
  from public, anon, authenticated, service_role;
grant execute on function public.review_provider_documents(uuid, uuid[], uuid[], text, text, text, date)
  to authenticated;

-- Approve or reject the file (AC-18). The caller sends the providers.updated_at it saw, so nobody
-- approves a name, legal name or bio they did not see. A second click or a second admin gets the state
-- as it stands, with no second audit row.
create function public.decide_provider(
  p_provider_id uuid,
  p_decision text,
  p_seen_updated_at timestamptz,
  p_code text,
  p_note text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row       public.providers%rowtype := public.provider_for_admin(p_provider_id);
  v_uid       uuid := (select auth.uid());
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
  v_required  text[] := public.provider_required_types(v_row.region);
  v_type      text;
  v_doc       public.provider_documents%rowtype;
  v_all_ok    boolean := true;
  v_any_bad   boolean := false;
  v_name      text;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'validation_failed';
  end if;
  if v_row.status in ('approved', 'rejected') then
    return jsonb_build_object('status', v_row.status);
  end if;
  if v_row.status <> 'pending' then
    raise exception 'not_under_review';
  end if;
  if p_seen_updated_at is null or p_seen_updated_at is distinct from v_row.updated_at then
    raise exception 'stale_profile';
  end if;

  foreach v_type in array v_required loop
    select * into v_doc from public.provider_documents where provider_id = v_row.id and type = v_type;
    if not found then
      v_all_ok := false;
    elsif not public.provider_document_object_exists(v_doc) then
      raise exception 'file_missing';
    elsif v_doc.status = 'rejected' then
      v_all_ok := false;
      v_any_bad := true;
    elsif v_doc.status <> 'approved' or v_doc.valid_until < current_date then
      v_all_ok := false;
    end if;
  end loop;

  if p_decision = 'approved' then
    if not v_all_ok then
      raise exception 'documents_not_reviewed';
    end if;
    select p.full_name into v_name from public.profiles p where p.id = v_row.id;
    update public.providers
       set status = 'approved', decided_at = now(), decided_by = v_uid,
           approved_at = coalesce(approved_at, now()), approved_name = v_name,
           review_reason = null, rejection_code = null, rejection_note = null
     where id = v_row.id;
    insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
    values (v_uid, 'provider.approved', 'provider', v_row.id::text, v_row.region,
            jsonb_build_object('status', v_row.status, 'review_reason', v_row.review_reason),
            jsonb_build_object('status', 'approved', 'approved_name', v_name));
  else
    if not v_any_bad and v_note is null then
      raise exception 'reason_required';
    end if;
    if char_length(coalesce(v_note, '')) > 300
       or (p_code is not null and p_code not in ('document_unclear', 'selfie_mismatch', 'criminal_record_invalid',
                                                 'document_expired', 'name_mismatch', 'photo_not_suitable')) then
      raise exception 'validation_failed';
    end if;
    update public.providers
       set status = 'rejected', decided_at = now(), decided_by = v_uid,
           rejection_code = p_code, rejection_note = v_note
     where id = v_row.id;
    insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
    values (v_uid, 'provider.rejected', 'provider', v_row.id::text, v_row.region,
            jsonb_build_object('status', v_row.status, 'review_reason', v_row.review_reason),
            jsonb_build_object('status', 'rejected', 'rejection_code', p_code));
  end if;

  return jsonb_build_object('status', p_decision);
end;
$$;

revoke all on function public.decide_provider(uuid, text, timestamptz, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_provider(uuid, text, timestamptz, text, text) to authenticated;

-- Suspend an approved provider (AC-19), with a reason of 5 to 500 characters shown as written.
create function public.suspend_provider(p_provider_id uuid, p_reason text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row    public.providers%rowtype := public.provider_for_admin(p_provider_id);
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_row.status <> 'approved' then
    raise exception 'not_approved';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'validation_failed';
  end if;
  update public.providers
     set status = 'suspended', suspension_reason = v_reason, decided_at = now(), decided_by = (select auth.uid())
   where id = v_row.id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values ((select auth.uid()), 'provider.suspended', 'provider', v_row.id::text, v_row.region,
          jsonb_build_object('status', v_row.status),
          jsonb_build_object('status', 'suspended', 'suspension_reason', v_reason));
  return jsonb_build_object('status', 'suspended');
end;
$$;

revoke all on function public.suspend_provider(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.suspend_provider(uuid, text) to authenticated;

-- Lift a suspension, back to approved. The reason is cleared; audit_log keeps it.
create function public.reinstate_provider(p_provider_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row public.providers%rowtype := public.provider_for_admin(p_provider_id);
begin
  if v_row.status <> 'suspended' then
    raise exception 'not_suspended';
  end if;
  update public.providers
     set status = 'approved', suspension_reason = null, decided_at = now(), decided_by = (select auth.uid())
   where id = v_row.id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, region, old_value, new_value)
  values ((select auth.uid()), 'provider.reinstated', 'provider', v_row.id::text, v_row.region,
          jsonb_build_object('status', v_row.status, 'suspension_reason', v_row.suspension_reason),
          jsonb_build_object('status', 'approved'));
  return jsonb_build_object('status', 'approved');
end;
$$;

revoke all on function public.reinstate_provider(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reinstate_provider(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. Triggers on profiles. complete_onboarding does not change: a provider's row follows the profile.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.provider_row()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.role = 'provider' then
    insert into public.providers (id, region) values (new.id, new.region) on conflict (id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.provider_row() from public, anon, authenticated, service_role;

create trigger provider_row
  after insert on public.profiles
  for each row execute function public.provider_row();

-- A rename (AC-12). The form sends the name on every save, so old and new are compared. Touches
-- providers.updated_at, so a pending Approve sees it (stale_profile). An approved provider goes back to
-- review; a suspended one cannot rename; draft, pending and rejected keep their status.
create function public.provider_name_changed()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row public.providers%rowtype;
begin
  if new.full_name is not distinct from old.full_name then
    return null;
  end if;
  select * into v_row from public.providers where id = new.id for update;
  if not found then
    return null;
  end if;
  if v_row.status = 'suspended' then
    raise exception 'provider_suspended';
  end if;
  update public.providers set updated_at = now() where id = v_row.id;
  if v_row.status = 'approved' then
    perform public.provider_back_to_review(v_row, 'name_changed');
  end if;
  return null;
end;
$$;

revoke all on function public.provider_name_changed() from public, anon, authenticated, service_role;

create trigger provider_name_changed
  after update of full_name on public.profiles
  for each row execute function public.provider_name_changed();

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. Buckets, both private (AC-22). The bucket checks only the declared type and the size; the real
--     first bytes are checked in the browser for honest mistakes, and register cross checks the rest.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('provider-documents', 'provider-documents', false, 10485760,
   array['image/jpeg', 'image/png', 'application/pdf']),
  ('provider-photos', 'provider-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

-- Each policy names its buckets, so nothing here widens access to any other bucket (supabase/tests/08).
-- There is no update policy: overwrite and move fail.
create policy provider_files_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('provider-documents', 'provider-photos')
    and public.provider_may_store(bucket_id, name)
  );

create policy provider_files_read_own
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('provider-documents', 'provider-photos')
    and split_part(name, '/', 1) = (select auth.uid()::text)
  );

create policy provider_files_read_admin
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('provider-documents', 'provider-photos')
    and public.admin_may_read(id, name)
  );

-- A provider deletes only an object in their own folder that no row points to, so a file under review
-- can never be erased through the API. Admins delete nothing.
create policy provider_files_delete_orphan
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('provider-documents', 'provider-photos')
    and split_part(name, '/', 1) = (select auth.uid()::text)
    and not exists (select 1 from public.provider_documents d where d.storage_path = name collate "C")
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 14. Settings per region (C21, AC-6). criminal_record_required is edited on the settings page when
--     it lands (16), SQL until then. The consent version is a draft until S16; the launch gate holds
--     the draft text back from real users (D100).
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.platform_settings (region, key, value) values
  ('TR',  'criminal_record_required',      'true'),
  ('KSA', 'criminal_record_required',      'true'),
  ('TR',  'provider_docs_consent_version', '"provider-docs-draft-1"'),
  ('KSA', 'provider_docs_consent_version', '"provider-docs-draft-1"')
on conflict (region, key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 15. Backfill: every provider who onboarded before this migration gets a draft row.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.providers (id, region)
select p.id, p.region from public.profiles p where p.role = 'provider'
on conflict (id) do nothing;
