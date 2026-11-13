'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';

import { updateAccount, updateEmail } from '@/actions/account';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHydrated } from '@/lib/browser/use-hydrated';

/**
 * Name, the verified phone, the contact email and the language (`s12`, `p16`, AC-19, AC-32). `children` is the
 * notices table, which `s12` draws above the save button; its switches save on their own.
 */
export function AccountForm({
  fullName,
  phone,
  email,
  emailConfirmed,
  children,
}: {
  fullName: string;
  phone: string;
  email: string | null;
  emailConfirmed: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('Account');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const hydrated = useHydrated();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const typed = form.get('fullName');
    const name = typeof typed === 'string' ? typed : '';
    if (name.trim().length < 2) return setError('name');
    setError(null);
    startTransition(async () => {
      const account = await updateAccount({ fullName: name });
      if (!account.success) return setError(account.error);
      const contact = await updateEmail({ email: form.get('email') });
      if (contact.success) setSaved(true);
      else setError(contact.error === 'validation_failed' ? 'email' : contact.error);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-7">
      <div className="grid items-start gap-3 sm:grid-cols-2">
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
          <p className="text-meta font-normal text-text-secondary">{t('phoneNote')}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-email">{t('emailLabel')}</Label>
          <Input
            id="account-email"
            name="email"
            type="email"
            dir="ltr"
            autoComplete="email"
            defaultValue={email ?? ''}
            maxLength={254}
            aria-invalid={error === 'email'}
            className="text-start"
            onChange={() => setSaved(false)}
          />
          <p className="text-meta font-normal text-text-secondary">
            {t('emailNote')} {email && !emailConfirmed ? t('emailNotConfirmed') : null}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-body-s font-bold text-text-primary">{t('languageLabel')}</span>
          <LocaleSwitcher signedIn />
        </div>
      </div>

      {children}

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

      <Button type="submit" size="lg" disabled={isPending || !hydrated} className="self-start px-7">
        {isPending ? t('saving') : t('save')}
      </Button>
    </form>
  );
}
