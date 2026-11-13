import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { InitialAvatar } from '@/components/shared/InitialAvatar';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { SAMPLE_CURRENCY, SAMPLE_JOB_PRICE } from '@/lib/landing/samples';

function Step({
  number,
  title,
  body,
  sample,
  action,
}: {
  number: string;
  title: string;
  body: string;
  sample: ReactNode;
  action: string;
}) {
  return (
    <li className="flex flex-col rounded-panel bg-surface-secondary px-6.5 pt-7.5 pb-7.5">
      <span dir="ltr" className="self-start font-mono text-meta text-link">
        {number}
      </span>
      <h3 className="mt-2.5 mb-3 font-display text-step text-text-primary">{title}</h3>
      <p className="mb-6 flex-1 text-body-s font-normal text-text-body">{body}</p>
      {/* A picture of the app, not a control: the real button is the page's call to action. */}
      <div
        aria-hidden
        className="-mb-7.5 flex min-h-28 flex-col justify-between gap-3.5 rounded-t-tile bg-surface p-5"
      >
        {sample}
        <span className="rounded-full bg-accent p-2.75 text-center text-btn-sm text-accent-foreground">
          {action}
        </span>
      </div>
    </li>
  );
}

/** The four steps of `s1`, rewritten for the cash model (D87, D88). The cards show sample values. */
export function HowItWorks() {
  const t = useTranslations('Landing');

  return (
    <section id="how" className="scroll-mt-6 pt-12 pb-2.5 lg:pt-17.5">
      <h2 className="mb-7.5 font-display text-title text-text-primary lg:text-display">{t('howTitle')}</h2>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Step
          number="01"
          title={t('step1Title')}
          body={t('step1Body')}
          sample={<p className="text-sample text-text-primary">{t('step1Sample')}</p>}
          action={t('step1Action')}
        />
        <Step
          number="02"
          title={t('step2Title')}
          body={t('step2Body')}
          sample={<p className="text-sample text-text-primary">{t('step2Sample')}</p>}
          action={t('step2Action')}
        />
        <Step
          number="03"
          title={t('step3Title')}
          body={t('step3Body')}
          sample={
            <div>
              <MoneyDisplay
                amount={SAMPLE_JOB_PRICE}
                currency={SAMPLE_CURRENCY}
                className="text-amount-s text-text-primary"
              />
              <p className="mt-1 text-meta text-text-secondary">{t('step3Sample')}</p>
            </div>
          }
          action={t('step3Action')}
        />
        <Step
          number="04"
          title={t('step4Title')}
          body={t('step4Body')}
          sample={
            <div className="flex items-center gap-2.5">
              <InitialAvatar name={t('step4SampleName')} className="size-9.5" />
              <div>
                <p className="text-body-s font-bold text-text-primary">{t('step4SampleName')}</p>
                <p className="text-meta text-text-secondary">{t('step4SampleMeta')}</p>
              </div>
            </div>
          }
          action={t('step4Action')}
        />
      </ol>
    </section>
  );
}
