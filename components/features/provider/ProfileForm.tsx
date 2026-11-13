'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';

import { saveProviderProfile } from '@/actions/provider';
import { ChoiceChips } from '@/components/shared/ChoiceChips';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormField } from '@/components/shared/FormField';
import { ToggleChips } from '@/components/shared/ToggleChips';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useHydrated } from '@/lib/browser/use-hydrated';
import { Link, useRouter } from '@/lib/i18n/navigation';
import {
  bioLength,
  btrim,
  ENTITY_TYPES,
  LIMITS,
  normaliseTaxNumber,
  PROVIDER_LANGUAGES,
  TAX_NUMBER_DIGITS,
  type EntityType,
  type ProviderLanguage,
} from '@/lib/provider/options';
import { acceptAttribute } from '@/lib/storage/buckets';
import { localPreview } from '@/lib/storage/client';

import { useProviderUpload } from './use-provider-upload';

/**
 * Step 1 (`p2`, AC-1 to AC-4, AC-12). The form does plain checks only (D106); the action and the database
 * decide, so a refusal from either shows here with its own message. The "checked" chip shows when the
 * field equals the saved bio, which the database scanned when it was saved; there is no live chip.
 */

type Saved = {
  entityType: EntityType | null;
  legalName: string | null;
  taxNumber: string | null;
  bio: string;
  years: number | null;
  languages: ProviderLanguage[];
};

type FieldError = 'entity' | 'legalName' | 'taxNumber' | 'years' | 'bio' | 'languages';

export function ProfileForm({
  userId,
  region,
  saved,
  photoUrl,
  hasPhoto,
  approved,
  afterSave,
}: {
  userId: string;
  region: 'TR' | 'KSA';
  saved: Saved;
  /** A short signed link to the saved photo, from the server render. */
  photoUrl: string | null;
  hasPhoto: boolean;
  /** Approved or document_expired: a company change, a new photo, goes back to review, so ask first. */
  approved: boolean;
  /** Where Save goes: step 2, this page again (pending), or `p7` (approved). */
  afterSave: string;
}) {
  const t = useTranslations('ProviderForm');
  const tErrors = useTranslations('ProviderErrors');
  const router = useRouter();
  const hydrated = useHydrated();
  const [isPending, startTransition] = useTransition();

  const [entityType, setEntityType] = useState<EntityType | null>(saved.entityType);
  const [legalName, setLegalName] = useState(saved.legalName ?? '');
  const [taxNumber, setTaxNumber] = useState(saved.taxNumber ?? '');
  const [years, setYears] = useState(saved.years === null ? '' : String(saved.years));
  const [bio, setBio] = useState(saved.bio);
  const [languages, setLanguages] = useState<ProviderLanguage[]>(saved.languages);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmCompany, setConfirmCompany] = useState(false);

  const count = bioLength(bio);
  // The database stores btrim(bio), so the chip compares the same way (AC-3).
  const checked = saved.bio !== '' && btrim(bio) === saved.bio;

  function check(): FieldError[] {
    const found: FieldError[] = [];
    if (entityType === null) found.push('entity');
    if (entityType === 'company') {
      const legal = [...legalName.trim()].length;
      if (legal < LIMITS.legalNameMin || legal > LIMITS.legalNameMax) found.push('legalName');
      if (!new RegExp(`^[0-9]{${TAX_NUMBER_DIGITS[region]}}$`).test(normaliseTaxNumber(taxNumber)))
        found.push('taxNumber');
    }
    const y = Number(years);
    if (years.trim() === '' || !Number.isInteger(y) || y < 0 || y > LIMITS.yearsMax) found.push('years');
    if (count < LIMITS.bioMin || count > LIMITS.bioMax) found.push('bio');
    if (languages.length === 0) found.push('languages');
    return found;
  }

  function companyChanged(): boolean {
    if (saved.entityType === null) return false;
    const legal = entityType === 'company' ? legalName.trim() : null;
    const tax = entityType === 'company' ? normaliseTaxNumber(taxNumber) : null;
    return entityType !== saved.entityType || legal !== saved.legalName || tax !== saved.taxNumber;
  }

  function save() {
    setConfirmCompany(false);
    startTransition(async () => {
      const result = await saveProviderProfile({
        entityType,
        legalName: entityType === 'company' ? legalName : null,
        taxNumber: entityType === 'company' ? taxNumber : null,
        bio,
        years: Number(years),
        languages,
      });
      if (!result.success) {
        if (result.error === 'contact_info_in_bio') setErrors(['bio']);
        return setFormError(result.error);
      }
      router.push(afterSave);
      router.refresh();
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const found = check();
    setErrors(found);
    if (found.length > 0) return;
    if (approved && companyChanged()) return setConfirmCompany(true);
    save();
  }

  const invalid = (field: FieldError) => errors.includes(field);
  const describedBy = (id: string, field: FieldError) => (invalid(field) ? `${id}-error` : undefined);

  return (
    <div className="flex flex-col gap-6">
      <PhotoUpload userId={userId} photoUrl={photoUrl} hasPhoto={hasPhoto} approved={approved} />

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <ChoiceChips
          name="entityType"
          legend={t('entityLegend')}
          options={ENTITY_TYPES.map((value) => ({ value, label: t(`entity.${value}`) }))}
          value={entityType}
          onChange={setEntityType}
        />
        {invalid('entity') ? <p className="text-meta text-error">{t('errors.entity')}</p> : null}

        {entityType === 'company' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              id="legal-name"
              label={t('legalNameLabel')}
              error={invalid('legalName') ? t('errors.legalName') : null}
            >
              <Input
                id="legal-name"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                maxLength={LIMITS.legalNameMax}
                autoComplete="organization"
                aria-invalid={invalid('legalName')}
                aria-describedby={describedBy('legal-name', 'legalName')}
              />
            </FormField>
            <FormField
              id="tax-number"
              label={t('taxNumberLabel')}
              note={t('taxNumberNote', { digits: TAX_NUMBER_DIGITS[region] })}
              error={
                invalid('taxNumber') ? t('errors.taxNumber', { digits: TAX_NUMBER_DIGITS[region] }) : null
              }
            >
              <Input
                id="tax-number"
                dir="ltr"
                inputMode="numeric"
                value={taxNumber}
                onChange={(e) => setTaxNumber(e.target.value)}
                maxLength={40}
                className="text-start"
                aria-invalid={invalid('taxNumber')}
                aria-describedby={describedBy('tax-number', 'taxNumber')}
              />
            </FormField>
          </div>
        ) : null}

        <FormField id="years" label={t('yearsLabel')} error={invalid('years') ? t('errors.years') : null}>
          <Input
            id="years"
            inputMode="numeric"
            value={years}
            onChange={(e) => setYears(e.target.value.replace(/[^0-9]/g, ''))}
            maxLength={2}
            className="sm:max-w-40"
            aria-invalid={invalid('years')}
            aria-describedby={describedBy('years', 'years')}
          />
        </FormField>

        <FormField
          id="bio"
          label={t('bioLabel')}
          note={
            <span className="flex flex-wrap items-center gap-2.5">
              {checked ? (
                <span className="rounded-full bg-accent-light px-3 py-1.5 text-chip text-text-primary">
                  {t('bioChecked')}
                </span>
              ) : null}
              <span aria-live="polite">{t('bioCount', { count, max: LIMITS.bioMax })}</span>
            </span>
          }
          error={
            invalid('bio')
              ? formError === 'contact_info_in_bio'
                ? tErrors('contact_info_in_bio')
                : t('errors.bio')
              : null
          }
        >
          <p className="text-meta text-text-secondary">{t('bioHint')}</p>
          <Textarea
            id="bio"
            value={bio}
            onChange={(e) => {
              setBio(e.target.value);
              // The scanner's verdict was about the old text: drop it, or the field would show the
              // length message instead.
              if (formError === 'contact_info_in_bio') {
                setFormError(null);
                setErrors((current) => current.filter((field) => field !== 'bio'));
              }
            }}
            rows={5}
            aria-invalid={invalid('bio')}
            aria-describedby={describedBy('bio', 'bio')}
          />
        </FormField>

        <ToggleChips
          name="languages"
          legend={t('languagesLegend')}
          options={PROVIDER_LANGUAGES.map((value) => ({ value, label: t(`languages.${value}`) }))}
          values={languages}
          onChange={setLanguages}
          invalid={invalid('languages')}
        />
        {invalid('languages') ? <p className="text-meta text-error">{t('errors.languages')}</p> : null}

        {formError && formError !== 'contact_info_in_bio' ? (
          <p role="alert" className="rounded-row bg-error-light px-4 py-3 text-body-s text-error">
            {tErrors.has(formError) ? tErrors(formError) : tErrors('action_failed')}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2.5">
          <Button type="submit" size="lg" disabled={isPending || !hydrated} className="px-7">
            {isPending ? t('saving') : t('save')}
          </Button>
          {approved ? (
            <Button asChild size="lg" variant="secondary">
              <Link href="/provider/profile">{t('cancelEdit')}</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <ConfirmDialog
        open={confirmCompany}
        onOpenChange={setConfirmCompany}
        title={t('confirmCompanyTitle')}
        body={t('confirmCompanyBody')}
        confirmLabel={t('confirmCompany')}
        cancelLabel={t('cancel')}
        onConfirm={save}
        busy={isPending}
      />
    </div>
  );
}

/** The profile photo (AC-4): a local preview after a pick, a short signed link after a reload. */
function PhotoUpload({
  userId,
  photoUrl,
  hasPhoto,
  approved,
}: {
  userId: string;
  photoUrl: string | null;
  hasPhoto: boolean;
  approved: boolean;
}) {
  const t = useTranslations('ProviderForm');
  const tErrors = useTranslations('ProviderErrors');
  const { upload, error, isPending } = useProviderUpload(userId, 'profile_photo');
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<File | null>(null);

  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  function start(file: File) {
    setPreview(localPreview(file));
    upload(file);
  }

  // A failed upload keeps the photo that is really stored, not the local preview of the one that failed.
  const shown = (error ? null : preview) ?? photoUrl;

  return (
    <section className="grid grid-cols-[auto_1fr] items-center gap-5">
      <div className="flex size-26 items-center justify-center overflow-hidden rounded-full bg-surface-secondary">
        {shown ? (
          // A blob or a signed Storage link: next/image would fetch and cache it on our server.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt={t('photoAlt')} className="size-full object-cover" />
        ) : (
          <span className="text-meta text-text-secondary">{t('photoEmpty')}</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-body-s font-bold text-text-primary">{t('photoTitle')}</span>
        <span className="text-meta text-text-secondary">{t('photoNote')}</span>
        <div className="mt-2 inline-flex">
          <input
            ref={input}
            type="file"
            aria-label={t('photoTitle')}
            accept={acceptAttribute('profile_photo')}
            className="sr-only"
            tabIndex={-1}
            disabled={isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (approved && hasPhoto) setPending(file);
              else start(file);
            }}
          />
          <Button variant="secondary" size="md" disabled={isPending} onClick={() => input.current?.click()}>
            {isPending
              ? t('uploading')
              : hasPhoto || (preview && !error)
                ? t('photoReplace')
                : t('photoUpload')}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-meta text-error">
            {tErrors.has(error) ? tErrors(error) : tErrors('action_failed')}
          </p>
        ) : null}
      </div>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => (open ? undefined : setPending(null))}
        title={t('confirmReplaceTitle')}
        body={t('confirmReplaceBody')}
        confirmLabel={t('confirmReplace')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          if (pending) start(pending);
          setPending(null);
        }}
      />
    </section>
  );
}
