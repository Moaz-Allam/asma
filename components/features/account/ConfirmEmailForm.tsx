'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { confirmEmail } from '@/actions/account';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/lib/browser/use-hydrated';
import { Link } from '@/lib/i18n/navigation';

import { EmailLinkButton } from './EmailLinkButton';

const KNOWN = ['invalid_link', 'link_expired', 'link_used', 'unauthorized', 'forbidden'];

/**
 * Spec 0011-13 AC-7: the confirm page's one button. Opening the link changes nothing; only this POST (a Server
 * Action) confirms, so a mail scanner that follows links confirms no address. A refused link shows one message
 * and "Send link again".
 */
export function ConfirmEmailForm({ token }: { token: string | null }) {
  const t = useTranslations('Account');
  const [state, setState] = useState<{ done: boolean; error: string | null }>({
    done: false,
    error: token === null ? 'invalid_link' : null,
  });
  const [isPending, startTransition] = useTransition();
  const hydrated = useHydrated();

  function submit() {
    if (token === null) return;
    startTransition(async () => {
      try {
        const result = await confirmEmail({ token });
        if (result.success) setState({ done: true, error: null });
        else {
          const code = result.error === 'validation_failed' ? 'invalid_link' : result.error;
          setState({ done: false, error: KNOWN.includes(code) ? code : 'action_failed' });
        }
      } catch {
        setState({ done: false, error: 'action_failed' });
      }
    });
  }

  if (state.done) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="status" className="text-body text-text-primary">
          {t('confirm.done')}
        </p>
        <Button asChild variant="secondary">
          <Link href="/account">{t('confirm.back')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-4">
      {state.error ? (
        <>
          <p role="alert" className="rounded-row bg-error-light px-4 py-3 text-body-s text-error">
            {t(`confirm.errors.${state.error}`)}
          </p>
          {state.error === 'link_expired' || state.error === 'invalid_link' ? <EmailLinkButton /> : null}
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Button type="submit" size="lg" disabled={isPending || !hydrated} className="px-7">
            {isPending ? t('confirm.confirming') : t('confirm.button')}
          </Button>
        </form>
      )}
      <Link href="/account" className="text-body-s text-link underline">
        {t('confirm.back')}
      </Link>
    </div>
  );
}
