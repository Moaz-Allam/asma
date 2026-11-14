import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Stepper } from '@/components/shared/Stepper';

/**
 * The frame of the two onboarding steps (`p2`, `p3`): the stepper, the gate line, the title and intro, the
 * form, and a side panel. Two steps: `p4` moved to position 05 (D111).
 */
export async function OnboardingFrame({
  step,
  title,
  intro,
  aside,
  children,
}: {
  step: 1 | 2;
  title: string;
  intro: string;
  aside: ReactNode;
  children: ReactNode;
}) {
  const t = await getTranslations('Provider');
  return (
    <div className="flex flex-col gap-5">
      <Stepper
        label={t('steps.label')}
        steps={[
          { label: t('steps.profile'), state: step === 1 ? 'current' : 'done', href: '/provider/profile' },
          {
            label: t('steps.documents'),
            state: step === 2 ? 'current' : 'next',
            href: '/provider/profile/documents',
          },
        ]}
      />
      <div className="flex flex-col gap-3 rounded-block bg-accent-light p-5 sm:flex-row sm:items-center lg:px-6.5">
        <p className="flex-1 text-body font-semibold text-text-primary">{t('gate')}</p>
        <span className="self-start rounded-full bg-accent px-4.5 py-2 text-chip text-accent-foreground sm:self-auto">
          {t('gateChip')}
        </span>
      </div>
      <div className="grid items-start gap-3.5 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-col gap-4">
            <h1 className="font-display text-title text-text-primary">{title}</h1>
            <p className="max-w-60ch text-body text-text-lede">{intro}</p>
          </header>
          {children}
        </div>
        <aside className="flex flex-col gap-3.5 lg:sticky lg:top-4">{aside}</aside>
      </div>
    </div>
  );
}
