-- Position 02 review fixes (spec 0006, reviews of 2026-11-11). 20261110090000_provider_onboarding is
-- already in the cloud, so every change to it lands here.
--
--  1. The 20 object cap, the suspension and the consent also hold for a signed upload URL. Storage checks
--     the insert policy when the URL is made, then writes the object later as service_role, past RLS, so
--     a provider could make many URLs while under the cap (reproduced locally: 5 + 25 objects). A
--     trigger on storage.objects runs the same rules at the real insert (AC-22).
--  2. Admin functions refuse a draft provider (AC-14, AC-15: drafts are invisible) and refuse an admin
--     acting on their own providers row, which a promoted provider still has.
--  3. provider_can_apply is true only for a profile whose role is provider.
--  4. provider.company_changed keeps only the last four digits of a tax number: audit_log is append only
--     and never erased (owner, 2026-11-11, D127).
--  5. The admin policies of positions 00 and 01 (profiles, audit_log, terms_acceptances,
--     platform_settings) read is_admin(), so a demotion counts at once there too (D116).
--  6. Providers no longer read the admin ids in decided_by and reviewed_by.
--  7. Only a version in the provider-docs- namespace counts as the documents consent.
--  8. register_provider_document returns no previous_path when the path is the same one, so the action
--     never tries to delete the file it just registered.
--  9. decide_provider refuses file_missing only to approve: a lost object is a reason to reject.
--     A replay says so (replayed), so the decision event fires once.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The Storage rules, for any caller, by the folder's provider id.
-- ═══════════════════════════════════════════════════════════════════════════

-- May this provider store this object? The rules of provider_may_store, without auth.uid(), so the
-- Storage trigger can run them for a signed upload, where no user is in the request.
create function public.provider_store_allowed(p_provider uuid, p_bucket text, p_name text)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_row  public.providers%rowtype;
  v_type text := public.provider_object_type(p_bucket, p_name);
begin
  if p_provider is null or v_type is null or split_part(p_name, '/', 1) <> p_provider::text then
    return false;
  end if;

  select pr.* into v_row
    from public.providers pr
    join public.profiles p on p.id = pr.id and p.role = 'provider'
   where pr.id = p_provider;
  if not found or v_row.status = 'suspended' then
    return false;
  end if;

  if p_bucket = 'provider-documents' and not public.provider_has_docs_consent(p_provider, v_row.region) then
    return false;
  end if;

  return (
    select count(*) < 20
      from storage.objects o
     where o.bucket_id in ('provider-documents', 'provider-photos')
       and o.name like p_provider::text || '/%'
       and (o.created_at > now() - interval '24 hours'
            or exists (select 1 from public.provider_documents d
                        where d.storage_path = o.name collate "C"))
  );
end;
$$;

revoke all on function public.provider_store_allowed(uuid, text, text)
  from public, anon, authenticated, service_role;

-- The insert policy's check, as before: the caller's own folder, then the shared rules.
create or replace function public.provider_may_store(p_bucket text, p_name text)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;
  return public.provider_store_allowed(v_uid, p_bucket, p_name);
end;
$$;

-- The same rules at the real insert. Only API roles are checked: a signed upload arrives as
-- service_role, a direct upload as authenticated (the policy has already run, this repeats it). A
-- maintenance insert by the database owner is left alone.
create function public.provider_files_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_role  text := coalesce(current_setting('role', true), '');
  v_owner text := split_part(new.name, '/', 1);
begin
  if new.bucket_id not in ('provider-documents', 'provider-photos')
     or v_role not in ('authenticated', 'service_role', 'anon') then
    return new;
  end if;

  if v_owner !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or (v_role = 'authenticated' and v_owner <> coalesce((select auth.uid())::text, ''))
     or not public.provider_store_allowed(v_owner::uuid, new.bucket_id, new.name) then
    raise exception 'upload_refused' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.provider_files_guard() from public, anon, authenticated, service_role;

create trigger provider_files_guard
  before insert on storage.objects
  for each row execute function public.provider_files_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Admin functions: no draft, never your own row.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.provider_for_admin(p_provider_id uuid)
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
  if p_provider_id = (select auth.uid()) then
    raise exception 'forbidden';
  end if;
  select * into v_row from public.providers where id = p_provider_id for update;
  if not found or v_row.status = 'draft' then
    raise exception 'not_found';
  end if;
  return v_row;
end;
$$;

create or replace function public.log_document_view(p_document_id uuid, p_object_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_doc    public.provider_documents%rowtype;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select * into v_doc from public.provider_documents where id = p_document_id;
  if not found then
    raise exception 'not_found';
  end if;
  if v_doc.provider_id = (select auth.uid()) then
    raise exception 'forbidden';
  end if;
  select pr.status into v_status from public.providers pr where pr.id = v_doc.provider_id;
  if v_status is null or v_status = 'draft' then
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. provider_can_apply: a provider profile only.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.provider_can_apply(p_provider_id uuid)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select coalesce(public.provider_standing(p_provider_id) = 'approved', false)
         and exists (select 1 from public.profiles p where p.id = p_provider_id and p.role = 'provider')
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Step 1: the company change audit row keeps the tax number's last four digits only (D127).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.save_provider_profile(
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
               '[[:space:] ‐-―-]', '', 'g');
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
                               'tax_number_last4', right(v_row.tax_number, 4)),
            jsonb_build_object('entity_type', p_entity_type, 'legal_name', v_legal,
                               'tax_number_last4', right(v_tax, 4)));
    if v_row.status = 'approved' then
      perform public.provider_back_to_review(v_row, 'company_changed');
      v_back := true;
    end if;
  end if;

  return jsonb_build_object('backToReview', v_back);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Position 01's admin policies read profiles.role, not the token (D116).
-- ═══════════════════════════════════════════════════════════════════════════

alter policy profiles_read_admin on public.profiles
  using ((select public.is_admin()));

alter policy audit_log_read_admin on public.audit_log
  using ((select public.is_admin()));

alter policy terms_acceptances_read_admin on public.terms_acceptances
  using ((select public.is_admin()));

-- Position 00's settings policy, the same way: platform_settings decides money and consent versions.
alter policy platform_settings_write_admin on public.platform_settings
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Admin ids stay out of what a provider reads. Grants are per role, so admins lose the two columns
--    too; nothing reads them, and audit_log names who decided.
-- ═══════════════════════════════════════════════════════════════════════════

revoke select on table public.providers from authenticated;
grant select (id, region, status, entity_type, legal_name, tax_number, review_reason, rejection_code,
              rejection_note, suspension_reason, submitted_at, decided_at, approved_at, approved_name,
              created_at, updated_at)
  on table public.providers to authenticated;

revoke select on table public.provider_documents from authenticated;
grant select (id, provider_id, region, type, storage_path, object_id, mime_type, size_bytes, status,
              rejection_code, rejection_note, valid_until, reviewed_at, uploaded_at)
  on table public.provider_documents to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The documents consent version lives in its own namespace, so no other terms version can count.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.provider_docs_consent_version(p_region text)
  returns text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select s.value #>> '{}'
    from public.platform_settings s
   where s.region = p_region and s.key = 'provider_docs_consent_version'
     and (s.value #>> '{}') like 'provider-docs-%'
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. register_provider_document: no previous_path for the same path.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.register_provider_document(p_type text, p_path text)
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
    v_previous := nullif(v_old.storage_path, p_path);
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. decide_provider: a lost object blocks approve only; a replay says so.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.decide_provider(
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
  v_gone      boolean := false;
  v_name      text;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'validation_failed';
  end if;
  if v_row.status in ('approved', 'rejected') then
    return jsonb_build_object('status', v_row.status, 'replayed', true);
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
      v_all_ok := false;
      v_any_bad := true;
      v_gone := true;
    elsif v_doc.status = 'rejected' then
      v_all_ok := false;
      v_any_bad := true;
    elsif v_doc.status <> 'approved' or v_doc.valid_until < current_date then
      v_all_ok := false;
    end if;
  end loop;

  if p_decision = 'approved' then
    if v_gone then
      raise exception 'file_missing';
    end if;
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

  return jsonb_build_object('status', p_decision, 'replayed', false);
end;
$$;
