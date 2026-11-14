import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { DocumentsStep, type CardDocument } from '@/components/features/provider/DocumentsStep';
import { FileProgress } from '@/components/features/provider/FileProgress';
import { OnboardingFrame } from '@/components/features/provider/OnboardingFrame';
import { ErrorState } from '@/components/shared/ErrorState';
import { PageHeader } from '@/components/shared/PageHeader';
import { guardPage } from '@/lib/auth/session';
import { DOCUMENT_CARDS } from '@/lib/provider/options';
import { getProviderFile, getStanding, hasDocsConsent } from '@/lib/provider/queries';
import type { DocumentType } from '@/lib/storage/buckets';

type Props = { params: Promise<{ locale: string }> };

/**
 * Step 2 (`p3`, AC-5 to AC-9). The cards: ID (front and back), selfie, the criminal record when the region
 * requires it, and the optional certificate. Suspended sees them read only; Send for review shows in draft
 * and rejected. The ID number is never asked for.
 */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['provider']);
  const t = await getTranslations('ProviderDocs');
  const tHome = await getTranslations('Provider.home');
  const format = await getFormatter();

  const [standing, file] = await Promise.all([getStanding(user.id), getProviderFile(user.id)]);
  if (!standing || !file) {
    return (
      <>
        <PageHeader title={t('title')} />
        <ErrorState title={tHome('error.title')} body={tHome('error.body')} />
      </>
    );
  }
  const consented = await hasDocsConsent(user.id, file.region);

  const cards = DOCUMENT_CARDS.filter(
    (card) => card !== 'criminal_record' || file.requiredTypes.includes('criminal_record'),
  );
  const documents: Partial<Record<DocumentType, CardDocument>> = Object.fromEntries(
    Object.values(file.documents).map((d) => [
      d.type,
      {
        type: d.type,
        status: d.status,
        rejectionCode: d.rejectionCode,
        rejectionNote: d.rejectionNote,
        validUntil: d.validUntil,
      },
    ]),
  );
  const formatDate = Object.fromEntries(
    Object.values(file.documents)
      .map((d) => d.validUntil)
      .filter((v): v is string => v !== null)
      .map((v) => [v, format.dateTime(new Date(`${v}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' })]),
  );

  const step = (
    <DocumentsStep
      userId={user.id}
      cards={cards}
      documents={documents}
      consented={consented}
      readOnly={standing === 'suspended'}
      approved={standing === 'approved' || standing === 'document_expired'}
      canSubmit={standing === 'draft' || standing === 'rejected'}
      formatDate={formatDate}
    />
  );

  if (standing !== 'draft' && standing !== 'rejected') {
    return (
      <>
        <PageHeader title={t('title')} intro={t('introAfter')} />
        {step}
      </>
    );
  }

  return (
    <OnboardingFrame
      step={2}
      title={t('title')}
      intro={t('intro')}
      aside={
        <>
          <FileProgress file={file} />
          <p className="rounded-block bg-accent-light p-5 text-body-s text-text-primary">{t('reviewNote')}</p>
        </>
      }
    >
      {step}
    </OnboardingFrame>
  );
}
