'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { saveProviderAddress } from '@/actions/provider';
import { AddressFields, type AddressFieldErrors } from '@/components/features/address/AddressFields';
import { Button } from '@/components/ui/button';
import {
  PROVIDER_ADDRESS_KEYS,
  addressErrors,
  addressPayload,
  type AddressDraft,
  type AddressTextKey,
} from '@/lib/address/parts';
import { useRouter } from '@/lib/i18n/navigation';

/**
 * The provider's own address (spec 0011-20b AC-5, X-13): the onboarding step after the profile, and the same form from
 * the profile and the feed's banner later. The browser checks the part rules for messages; Postgres is the check.
 */
export function ProviderAddressForm({
  initial,
  mapKey,
  afterSave,
}: {
  initial: AddressDraft;
  mapKey: string | null;
  afterSave: string;
}) {
  const t = useTranslations('Address');
  const te = useTranslations('ProviderErrors');
  const router = useRouter();
  const [value, setValue] = useState<AddressDraft>(initial);
  const [errors, setErrors] = useState<AddressFieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, startSave] = useTransition();

  function message(key: AddressTextKey | 'pin'): string {
    if (key === 'pin') return t('errors.pin_invalid');
    const part = value[key];
    if (!part || part.trim() === '') return t('errors.required');
    if (key === 'postal_code') return t('errors.postal_code');
    if (key === 'building_no' || key === 'floor' || key === 'apartment') return t('errors.number');
    return t('errors.invalid');
  }

  function save() {
    const found = addressErrors(value, PROVIDER_ADDRESS_KEYS);
    const next: AddressFieldErrors = {};
    for (const key of Object.keys(found) as (AddressTextKey | 'pin')[]) next[key] = message(key);
    setErrors(next);
    setSaved(false);
    if (Object.keys(next).length > 0) {
      setBanner(t('errors.address_invalid'));
      return;
    }
    startSave(async () => {
      setBanner(null);
      let result: Awaited<ReturnType<typeof saveProviderAddress>>;
      try {
        result = await saveProviderAddress(
          addressPayload(value, PROVIDER_ADDRESS_KEYS) as Parameters<typeof saveProviderAddress>[0],
        );
      } catch {
        result = { success: false, error: 'network' };
      }
      if (!result.success) {
        setBanner(te(result.error as 'action_failed'));
        return;
      }
      setSaved(true);
      router.push(afterSave);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {banner ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s font-semibold text-error">
          {banner}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="rounded-block bg-success-light p-4 text-body-s text-success-foreground">
          {t('provider.saved')}
        </p>
      ) : null}
      <AddressFields
        mode="provider"
        value={value}
        onChange={(next) => {
          setValue(next);
          setErrors({});
        }}
        errors={errors}
        mapKey={mapKey}
        idPrefix="provider-address"
      />
      <p className="text-meta text-text-secondary">{t('providerPrivacy')}</p>
      <Button type="button" size="block" onClick={save} disabled={isSaving} className="sm:self-start">
        {isSaving ? t('provider.saving') : t('provider.save')}
      </Button>
    </div>
  );
}
