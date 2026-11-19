'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';

import { updateAccount, updateEmail } from '@/actions/account';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHydrated } from '@/lib/browser/use-hydrated';
import { useRouter } from '@/lib/i18n/navigation';

import { EmailLinkButton } from './EmailLinkButton';

/**
 * Name, the verified phone, the contact email and the language (`s12`, `p16`, AC-19, AC-32). `children` is the
 * notices table, which `s12` draws above the save button; its switches save on their own.
 */
export function AccountForm({
  fullName,
  phone,
  email,
  emailConfirmed,
  emailsEnabled = false,
  warnBeforeRename = false,
  children,
}: {
  fullName: string;
  phone: string;
  email: string | null;
  emailConfirmed: boolean;
  /** Spec 0011-13 AC-7: mail is on in the user's region, so "Send link again" can work. */
  emailsEnabled?: boolean;
  /** An approved provider: a rename returns the file to review, so ask first (spec 0006 AC-12). */
  warnBeforeRename?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('Account');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [backToReview, setBackToReview] = useState(false);
  const [confirm, setConfirm] = useState<FormData | null>(null);
  const [isPending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const router = useRouter();

  function save(form: FormData) {
    const typed = form.get('fullName');
    const name = typeof typed === 'string' ? typed : '';
    setConfirm(null);
    startTransition(async () => {
      try {
        const account = await updateAccount({ fullName: name });
        if (!account.success) return setError(account.error);
        // Set before the email step: if that step fails, the name was still saved and the file is in review.
        setBackToReview(account.data.backToReview);
        const contact = await updateEmail({ email: form.get('email') });
        if (contact.success) {
          setSaved(true);
          // A changed address is unconfirmed again and its link is on the way (spec 0011-13 R-9).
          router.refresh();
        } else setError(contact.error === 'validation_failed' ? 'email' : contact.error);
      } catch {
        setError('action_failed');
      }
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setBackToReview(false);
    const form = new FormData(event.currentTarget);
    const typed = form.get('fullName');
    const name = typeof typed === 'string' ? typed : '';
    if (name.trim().length < 2) return setError('name');
    setError(null);
    if (warnBeforeRename && name.trim() !== fullName.trim()) return setConfirm(form);
    save(form);
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
            {t('emailNote')} {email && emailConfirmed ? t('emailConfirmed') : null}
            {email && !emailConfirmed ? t('emailNotConfirmed') : null}
          </p>
          {email && !emailConfirmed && emailsEnabled ? <EmailLinkButton /> : null}
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
      {saved || backToReview ? (
        <p role="status" className="text-body-s text-text-secondary">
          {backToReview ? t('savedBackToReview') : t('saved')}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={isPending || !hydrated} className="self-start px-7">
        {isPending ? t('saving') : t('save')}
      </Button>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => (open ? undefined : setConfirm(null))}
        title={t('renameTitle')}
        body={t('renameBody')}
        confirmLabel={t('renameConfirm')}
        cancelLabel={t('renameCancel')}
        onConfirm={() => (confirm ? save(confirm) : undefined)}
        busy={isPending}
      />
    </form>
  );
}
