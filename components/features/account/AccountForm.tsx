'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';

import { updateAccount } from '@/actions/account';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHydrated } from '@/lib/browser/use-hydrated';

/** Name, the verified phone, and the language (`s12`, `p16`, spec 0005 AC-19). */
export function AccountForm({ fullName, phone }: { fullName: string; phone: string }) {
  const t = useTranslations('Account');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const hydrated = useHydrated();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const typed = new FormData(event.currentTarget).get('fullName');
    const name = typeof typed === 'string' ? typed : '';
    if (name.trim().length < 2) return setError('name');
    setError(null);
    startTransition(async () => {
      const result = await updateAccount({ fullName: name });
      if (result.success) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-name">{t('nameLabel')}</Label>
          <Input
            id="account-name"
            name="fullName"
            autoComplete="name"
            defaultValue={fullName}
            maxLength={100}
            aria-invalid={error === 'name'}
            onChange={() => setSaved(false)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-phone">{t('phoneLabel')}</Label>
          <Input id="account-phone" dir="ltr" value={phone} readOnly className="text-start" />
          <p className="text-meta text-text-secondary">{t('phoneNote')}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-body-s font-semibold text-text-primary">{t('languageLabel')}</span>
        <LocaleSwitcher signedIn />
      </div>

      {error ? (
        <p role="alert" className="rounded-row bg-error-light px-4 py-3 text-body-s text-error">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-body-s text-text-secondary">
          {t('saved')}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={isPending || !hydrated} className="self-start">
        {isPending ? t('saving') : t('save')}
      </Button>
    </form>
  );
}
