import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';

type Props = { params: Promise<{ locale: string }> };

export default async function LandingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Landing />;
}

function Landing() {
  const t = useTranslations('Landing');

  // Structure and semantics only — no brand values until B4. Logical properties
  // throughout (ms/me, ps/pe, start/end) so the layout flips with the locale.
  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <span className="text-lg font-semibold text-text-primary">{t('title')}</span>
        <LocaleSwitcher />
      </header>

      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text-primary">{t('heading')}</h1>
        <p className="text-sm text-text-secondary">{t('body')}</p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="text-base font-semibold text-text-primary">{t('statusHeading')}</h2>
        <p className="mt-2 text-sm text-text-muted">{t('statusBody')}</p>
      </section>
    </main>
  );
}
