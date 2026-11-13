'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { signOut } from '@/actions/account';
import { Button } from '@/components/ui/button';
import { getPathname } from '@/lib/i18n/navigation';

/** Sign out of this device only (spec 0005 AC-19). A full page load, so every page sees the new state. */
export function SignOutCard() {
  const t = useTranslations('Account');
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  function onSignOut() {
    startTransition(async () => {
      await signOut();
      window.location.assign(getPathname({ href: '/', locale }));
    });
  }

  return (
    <section className="flex items-center gap-3 rounded-card border-2 border-border bg-surface px-6 py-5">
      <div className="flex flex-1 flex-col">
        <h2 className="font-sans text-label font-semibold text-text-primary">{t('signOutTitle')}</h2>
        <p className="text-body-s text-text-secondary">{t('signOutNote')}</p>
      </div>
      <Button variant="secondary" disabled={isPending} onClick={onSignOut}>
        {t('signOut')}
      </Button>
    </section>
  );
}
