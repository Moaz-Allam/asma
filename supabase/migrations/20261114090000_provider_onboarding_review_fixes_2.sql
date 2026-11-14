-- Position 02, second review round (spec 0006, security review of PR #26, 2026-11-13). Both earlier 02
-- migrations are in the cloud, so these changes land here, in one file.
--
--  1. An object in the provider buckets can no longer be overwritten in place. A signed upload URL made
--     with upsert on writes `insert ... on conflict do update` as service_role, past RLS, and only the
--     BEFORE INSERT trigger ran: the object kept its id while its bytes changed, so a document admin had
--     approved matched new bytes (reproduced locally on 2026-11-14: same id, new eTag and size, row still
--     approved). A BEFORE UPDATE trigger now refuses any change to the bytes, the name or the bucket.
--  2. The cap also counts bytes: 100 MB across the provider's folder, orphans included, because an
--     orphan older than 24 hours stops counting toward the 20 objects (D120) and nothing deletes it
--     before position 21 (AC-22).
--  3. The contact scanner flags 7 or more digits within any 21 characters, whatever stands between them,
--     instead of a run with gaps of at most 2 (owner, 2026-11-13, D131). 25 was the start; 21 is the
--     widest window that passes every must pass row of the corpus.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. No overwrite in place.
-- ═══════════════════════════════════════════════════════════════════════════

-- An update from an API role may touch bookkeeping columns, never what the object is: its bytes (version,
-- eTag, size, type), its name or its bucket. A maintenance update by the database owner is left alone.
create function public.provider_files_guard_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_role text := coalesce(current_setting('role', true), '');
begin
  if (old.bucket_id in ('provider-documents', 'provider-photos')
      or new.bucket_id in ('provider-documents', 'provider-photos'))
     and v_role in ('authenticated', 'service_role', 'anon')
     and (new.bucket_id is distinct from old.bucket_id
          or new.name is distinct from old.name
          or new.version is distinct from old.version
          or new.metadata ->> 'eTag' is distinct from old.metadata ->> 'eTag'
          or new.metadata ->> 'size' is distinct from old.metadata ->> 'size'
          or new.metadata ->> 'mimetype' is distinct from old.metadata ->> 'mimetype') then
    raise exception 'upload_refused' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.provider_files_guard_update() from public, anon, authenticated, service_role;

create trigger provider_files_guard_update
  before update on storage.objects
  for each row execute function public.provider_files_guard_update();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The cap in bytes as well as objects.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.provider_store_allowed(p_provider uuid, p_bucket text, p_name text)
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

  -- Under 20 counted objects (a row points to it, or an orphan younger than 24 hours, D120), and under
  -- 100 MB across every object in the folder, orphans of any age included. One more file is at most
  -- 10 MB, so a folder ends below 110 MB; honest use stays under about 60 MB.
  return (
    select count(*) filter (
             where o.created_at > now() - interval '24 hours'
                or exists (select 1 from public.provider_documents d
                            where d.storage_path = o.name collate "C")) < 20
           and coalesce(sum(nullif(o.metadata ->> 'size', '')::bigint), 0) < 104857600
      from storage.objects o
     where o.bucket_id in ('provider-documents', 'provider-photos')
       and o.name like p_provider::text || '/%'
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The scanner: 7 digits within any 21 characters (D131).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.has_contact_info(p_text text)
  returns boolean
  language plpgsql
  immutable
  security invoker
  set search_path = ''
as $$
declare
  t        text := public.contact_normalise(p_text);
  v_token  text;
  v_word   text;
  v_run    integer := 0;
  v_digits integer[] := array[]::integer[];
  -- 7 digits inside this many characters, whatever stands between them, read as a phone number.
  -- The widest window that passes every must pass row of the corpus (verify.md); never below 17.
  c_window constant integer := 21;
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

  -- 7 or more digits within any c_window characters. A separator of any length counts, so
  -- `0555 - 123 - 45 - 67` is caught; the old run with gaps of at most 2 is a case of this.
  for i in 1 .. char_length(t) loop
    if substr(t, i, 1) ~ '[0-9]' then
      v_digits := v_digits || i;
    end if;
  end loop;
  for k in 1 .. coalesce(cardinality(v_digits), 0) - 6 loop
    if v_digits[k + 6] - v_digits[k] < c_window then
      return true;
    end if;
  end loop;

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. contact_normalise: ö and ç were crossed (ö became c, ç became o), so the Turkish digit words üç and
--    dört were never recognised (/check review, 2026-11-13). The whole fold table was checked: the
--    capitals, the other Turkish letters, the Arabic letter variants and the 20 digits map as intended.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.contact_normalise(p_text text)
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
           'igusocaiu01234567890123456789ااااي' || 'هويكي'
         )
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. register_provider_document returns no reviewed_by: an admin id is not for providers (D129 item 4
--    hid the column, but the function returned the whole row, on the replay path too).
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
    return (to_jsonb(v_old) - 'reviewed_by') || jsonb_build_object('previous_path', null, 'sweep', '[]'::jsonb,
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

  return (to_jsonb(v_doc) - 'reviewed_by') || jsonb_build_object('previous_path', v_previous, 'sweep', to_jsonb(v_sweep),
                                               'backToReview', v_back, 'created', true);
end;
$$;
