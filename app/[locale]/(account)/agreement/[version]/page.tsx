import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PageHeader } from '@/components/shared/PageHeader';
import { loadAgreementTemplate } from '@/lib/agreements';
import { labelText } from '@/lib/agreements/fields';
import { guardPage } from '@/lib/auth/session';
import { PRIVATE_PAGE_METADATA } from '@/lib/navigation/menus';

export const metadata = PRIVATE_PAGE_METADATA;

type Props = { params: Promise<{ locale: string; version: string }> };

/**
 * The full text of one service agreement version (spec 0011-20 AC-12): its sections in Turkish, with a short line in the
 * reader's locale saying the Turkish text is the agreement, and each field shown as its Turkish label in brackets, so
 * every checkbox links to exactly the text it accepts. Any version of the reader's region, active or not. No index.
 */
export default async function AgreementPage({ params }: Props) {
  const { locale, version } = await params;
  setRequestLocale(locale);
  await guardPage('any');
  let name: string;
  try {
    name = decodeURIComponent(version);
  } catch {
    notFound();
  }
  const template = await loadAgreementTemplate(name);
  if (!template) notFound();
  const t = await getTranslations('Agreement.page');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} intro={t('version', { version: template.version })} />
      <p className="rounded-block bg-accent-light p-4 text-body-s text-text-primary">{t('turkish')}</p>
      {template.active ? null : (
        <p role="status" className="rounded-block bg-surface-secondary p-4 text-body-s text-text-primary">
          {t('inactive')}
        </p>
      )}
      <article
        lang="tr"
        dir="ltr"
        className="flex flex-col gap-5 rounded-panel border border-border-light bg-surface p-5 lg:p-7.5"
      >
        {template.sections.map((section, index) => (
          <section key={index} className="flex flex-col gap-2">
            <h2 className="font-display text-title-s break-words text-text-primary">
              {labelText(section.heading)}
            </h2>
            {section.paragraphs.map((paragraph, i) => (
              <p key={i} className="text-body break-words text-text-primary">
                {labelText(paragraph)}
              </p>
            ))}
          </section>
        ))}
      </article>
    </div>
  );
}
