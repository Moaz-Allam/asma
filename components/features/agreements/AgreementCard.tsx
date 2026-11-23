'use client';

import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { openAgreementAction } from '@/actions/agreements';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/lib/i18n/navigation';

/**
 * The service agreement's download card (ui-registry `AgreementCard`, spec 0011-20 AC-9, AC-13), on the customer's
 * request page and the provider's job. Shown while `agreement_visible` holds (the server decides): rendered, a party,
 * under 7 days, and this side not opened or opened under 10 minutes ago. Download stamps the open and fetches a 300
 * second link signed as the signed in user; after the open it says the copy is in the mail and offers Download again
 * until the 10 minutes pass, then the card is gone.
 */
export function AgreementCard({
  agreementId,
  number,
  opened,
}: {
  agreementId: string;
  number: string;
  opened: boolean;
}) {
  const t = useTranslations('Agreement.card');
  const router = useRouter();
  const [wasOpened, setWasOpened] = useState(opened);
  const [failed, setFailed] = useState(false);
  const [busy, start] = useTransition();

  function download() {
    setFailed(false);
    start(async () => {
      let result: Awaited<ReturnType<typeof openAgreementAction>>;
      try {
        result = await openAgreementAction({ agreementId, number });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (!result.success || !result.data.url) {
        setFailed(true);
        router.refresh();
        return;
      }
      setWasOpened(true);
      window.location.assign(result.data.url);
    });
  }

  return (
    <section
      aria-labelledby={`agreement-${agreementId}`}
      className="flex flex-col gap-3 rounded-panel border border-border-light bg-surface p-5 lg:p-7.5"
    >
      <div className="flex items-start gap-3">
        <FileText aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-accent" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={`agreement-${agreementId}`} className="font-display text-title-s text-text-primary">
            {t('title')}
          </h2>
          <p className="text-body-s break-words text-text-secondary">{t('number', { number })}</p>
        </div>
      </div>
      {wasOpened ? (
        <p role="status" className="text-body-s text-text-primary">
          {t('opened')}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {t('failed')}
        </p>
      ) : null}
      <Button
        className="self-start"
        variant={wasOpened ? 'outline' : 'primary'}
        disabled={busy}
        onClick={download}
      >
        {wasOpened ? t('again') : t('download')}
      </Button>
    </section>
  );
}
