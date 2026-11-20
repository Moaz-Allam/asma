import { getTranslations } from 'next-intl/server';

import { ChangePasswordForm } from '@/components/features/account/ChangePasswordForm';
import { Button } from '@/components/ui/button';
import type { PasswordSectionState } from '@/lib/account/password-section';
import { Link } from '@/lib/i18n/navigation';

/**
 * The account page's Password section (spec 0012 AC-4, AC-7): a reminder with a link while no password is set, else
 * when it last changed and the change form.
 */
export async function PasswordSection({
  state,
  phone,
  siteKey,
  nonce,
}: {
  state: PasswordSectionState;
  phone: string;
  siteKey: string | undefined;
  nonce: string | undefined;
}) {
  const t = await getTranslations('Account.password');

  if (state.kind === 'reminder') {
    return (
      <section
        aria-labelledby="password-section"
        className="flex flex-col gap-3 rounded-card bg-warning-light px-6 py-5"
      >
        <h2 id="password-section" className="font-sans text-label font-semibold text-text-primary">
          {t('sectionTitle')}
        </h2>
        <p className="text-body-s text-text-primary">{t('reminder')}</p>
        <Button asChild variant="white" className="self-start">
          <Link href={{ pathname: '/account/password', query: { next: '/account' } }}>
            {t('reminderLink')}
          </Link>
        </Button>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="password-section"
      className="flex flex-col gap-4 rounded-card border-2 border-border bg-surface px-6 py-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="password-section" className="font-sans text-label font-semibold text-text-primary">
          {t('sectionTitle')}
        </h2>
        <p className="text-body-s text-text-secondary">
          {state.changedLabel ? t('lastChanged', { when: state.changedLabel }) : t('lastChangedUnknown')}
        </p>
      </div>
      <ChangePasswordForm phone={phone} siteKey={siteKey} nonce={nonce} />
    </section>
  );
}
