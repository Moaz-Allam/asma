'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { adminAgreementLinkAction, rerenderAgreementAction } from '@/actions/agreements';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/lib/i18n/navigation';

/**
 * One agreement's admin buttons (ui-registry `AgreementAdminActions`, spec 0011-20 AC-7, AC-10): View records the view
 * and then opens a 60 second link; Render again (a failed agreement only) queues a new attempt with the same frozen
 * content. Nothing edits or deletes an agreement.
 */
export function AgreementAdminActions({
  agreementId,
  number,
  rendered,
  failed,
}: {
  agreementId: string;
  number: string;
  rendered: boolean;
  failed: boolean;
}) {
  const t = useTranslations('Agreement.admin');
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, start] = useTransition();

  const errorText = (code: string) => t(`errors.${code}` as 'errors.action_failed');

  function view() {
    setMessage(null);
    start(async () => {
      const result = await adminAgreementLinkAction({ agreementId, number }).catch(() => null);
      if (!result || !result.success || !result.data.url) {
        setMessage({
          tone: 'error',
          text: errorText(result && !result.success ? result.error : 'action_failed'),
        });
        return;
      }
      window.open(result.data.url, '_blank', 'noopener,noreferrer');
    });
  }

  function renderAgain() {
    setMessage(null);
    start(async () => {
      const result = await rerenderAgreementAction({ agreementId }).catch(() => null);
      if (!result || !result.success) {
        setMessage({
          tone: 'error',
          text: errorText(result && !result.success ? result.error : 'action_failed'),
        });
        return;
      }
      setMessage({ tone: 'ok', text: t('renderQueued') });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2.5">
        {rendered ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={view}>
            {t('view')}
          </Button>
        ) : null}
        {failed ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={renderAgain}>
            {t('renderAgain')}
          </Button>
        ) : null}
      </div>
      {message ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={
            message.tone === 'error'
              ? 'rounded-block bg-error-light p-3 text-body-s text-error-foreground'
              : 'rounded-block bg-success-light p-3 text-body-s text-text-primary'
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
