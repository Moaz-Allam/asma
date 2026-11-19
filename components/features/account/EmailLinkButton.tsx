'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { requestEmailConfirmation } from '@/actions/account';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/lib/browser/use-hydrated';

const KNOWN = ['no_email', 'already_confirmed', 'emails_off', 'rate_limited', 'unauthorized', 'forbidden'];

/**
 * Spec 0011-13 AC-7: "Send link again". A plain button (`type="button"`), so inside the account form it never
 * submits the form. The database decides; this only shows its answer.
 */
export function EmailLinkButton() {
  const t = useTranslations('Account');
  const [state, setState] = useState<{ sent: boolean; error: string | null }>({ sent: false, error: null });
  const [isPending, startTransition] = useTransition();
  const hydrated = useHydrated();

  function send() {
    setState({ sent: false, error: null });
    startTransition(async () => {
      try {
        const result = await requestEmailConfirmation();
        if (result.success) setState({ sent: true, error: null });
        else setState({ sent: false, error: KNOWN.includes(result.error) ? result.error : 'action_failed' });
      } catch {
        setState({ sent: false, error: 'action_failed' });
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="secondary" size="sm" onClick={send} disabled={isPending || !hydrated}>
        {isPending ? t('emailSending') : t('emailSendLink')}
      </Button>
      {state.sent ? (
        <p role="status" className="text-meta text-text-secondary">
          {t('emailLinkSent')}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-meta text-error">
          {t(`emailErrors.${state.error}`)}
        </p>
      ) : null}
    </div>
  );
}
