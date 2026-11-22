import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { ProviderFileReview, type ReviewDocument } from '@/components/features/admin/ProviderFileReview';
import { ProviderQueue } from '@/components/features/admin/ProviderQueue';
import { AdminQualitySection } from '@/components/features/admin/quality/AdminQualitySection';
import { AdminRatingsSection } from '@/components/features/ratings/AdminRatingsSection';
import { STANDING_TONE } from '@/components/features/provider/StandingChip';
import { InitialAvatar } from '@/components/shared/InitialAvatar';
import { StatusChip } from '@/components/shared/StatusChip';
import { loadProviderQuality } from '@/lib/admin-quality';
import { loadProviderRatings } from '@/lib/admin-ratings';
import { guardPage } from '@/lib/auth/session';
import { Link } from '@/lib/i18n/navigation';
import { reportServerError } from '@/lib/observability/server';
import { adminProviderFile, parseQueueQuery, queueSearch } from '@/lib/provider/admin-queries';

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One provider's file for admin (`a1`, AC-15 to AC-19). A malformed id is refused before any query; a draft
 * or unknown id is 404. The phone shows its last four digits only, masked on the server. The queue sits
 * beside the file from `lg`, with the same query, and is hidden below it.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  if (!UUID.test(id)) notFound();

  const t = await getTranslations('AdminReview');
  const tStanding = await getTranslations('Provider.standing');
  const tReason = await getTranslations('Provider.reviewReason');
  const tEntity = await getTranslations('ProviderForm.entity');
  const tLang = await getTranslations('ProviderForm.languages');
  const format = await getFormatter();
  const search = await searchParams;
  const query = parseQueueQuery(search);
  // Spec 0011-17 AC-8: the ratings page, 1 based, kept beside the queue's own query.
  const rawPage = Array.isArray(search.rp) ? search.rp[0] : search.rp;
  const ratingsPage = rawPage && /^[1-9][0-9]{0,3}$/.test(rawPage) ? Number(rawPage) : 1;

  const file = await adminProviderFile(id);
  if (!file) notFound();
  // Ratings are optional and gate nothing (D4): a failed read hides the section, never the review page.
  const ratings =
    file.status === 'draft'
      ? null
      : await loadProviderRatings(file.id, ratingsPage).catch((error: unknown) => {
          reportServerError('adminProviderRatings', error);
          return null;
        });
  // Spec 0011-19a AC-13: the quality figures, optional too; an unknown id reads null and shows no section.
  const quality =
    file.status === 'draft'
      ? null
      : await loadProviderQuality(file.id).catch((error: unknown) => {
          reportServerError('adminProviderQuality', error);
          return null;
        });
  const ratingsHref = (page: number) =>
    `/admin/providers/${file.id}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(queueSearch(query))), rp: String(page) }).toString()}#ratings-title`;

  const today = new Date().toISOString().slice(0, 10);
  const required = file.requiredTypes.map((type) => file.documents[type]);
  const canApprove = required.every(
    (d) => d?.status === 'approved' && (d.validUntil === null || d.validUntil >= today),
  );
  const hasRejectedRequired = required.some((d) => d?.status === 'rejected');
  const reviewed = required.filter((d) => d !== undefined && d.status !== 'pending').length;
  const date = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: 'medium' }) : '—';
  // A date column, read as a calendar day: UTC, so no offset moves it.
  const day = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });
  const documents: ReviewDocument[] = Object.values(file.documents).map((d) => ({
    id: d.id,
    type: d.type,
    objectId: d.objectId,
    status: d.status,
    rejectionCode: d.rejectionCode,
    rejectionNote: d.rejectionNote,
    validUntil: d.validUntil,
    validUntilLabel: d.validUntil ? day(d.validUntil) : null,
  }));
  // The chip reads the standing, so an approved file with an expired document says so (AC-20).
  const standing = file.standing ?? file.status;
  const status = file.status === 'draft' ? 'pending' : file.status;

  const facts: Array<[string, string]> = [
    [t('phone'), `•••• ${file.phoneLastFour}`],
    [t('region'), t.has(`regions.${file.region}`) ? t(`regions.${file.region}`) : file.region],
    [t('years'), file.profile ? String(file.profile.years) : '—'],
    [t('languages'), file.profile ? file.profile.languages.map((l) => tLang(l)).join(' · ') : '—'],
    [t('entity'), file.entityType ? tEntity(file.entityType) : '—'],
    ...(file.entityType === 'company'
      ? ([
          [t('legalName'), file.legalName ?? '—'],
          [t('taxNumber'), file.taxNumber ?? '—'],
        ] as Array<[string, string]>)
      : []),
    [t('joined'), date(file.joinedAt)],
    [t('submittedAt'), date(file.submittedAt)],
    [t('decidedAt'), date(file.decidedAt)],
    [t('approvedAt'), date(file.approvedAt)],
  ];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div className="hidden lg:block">
        <ProviderQueue query={query} currentId={file.id} />
      </div>
      <article className="flex min-w-0 flex-col gap-6 rounded-panel border-2 border-border p-5.5 lg:p-7">
        <Link href={`/admin/providers?${queueSearch(query)}`} className="text-btn-sm text-link lg:hidden">
          {t('back')}
        </Link>
        <header className="flex flex-wrap items-start gap-4">
          <InitialAvatar name={file.fullName} className="size-16 text-title-s" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h1 className="font-display text-title-s break-words text-text-primary">{file.fullName}</h1>
            {file.approvedName && file.approvedName !== file.fullName ? (
              <p className="text-body-s break-words text-text-primary">
                {t('approvedName', { name: file.approvedName })}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <StatusChip tone={STANDING_TONE[standing]} label={tStanding(standing)} />
              {file.status === 'pending' && file.reviewReason ? (
                <StatusChip tone="info" label={tReason(file.reviewReason)} />
              ) : null}
            </div>
          </div>
        </header>

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-meta text-text-secondary">{label}</dt>
              <dd className="text-body-s font-semibold break-words text-text-primary" dir="auto">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        {file.profile ? (
          <section className="flex flex-col gap-2 rounded-block bg-surface-secondary p-5">
            <h2 className="text-meta font-bold text-text-secondary">{t('bio')}</h2>
            <p className="text-body-s whitespace-pre-line break-words text-text-primary" dir="auto">
              {file.profile.bio}
            </p>
          </section>
        ) : null}

        {file.status === 'suspended' && file.suspensionReason ? (
          <section className="flex flex-col gap-2 rounded-block bg-error-light p-5">
            <h2 className="text-meta font-bold text-text-secondary">{t('suspensionReason')}</h2>
            <p className="text-body-s whitespace-pre-line break-words text-text-primary">
              {file.suspensionReason}
            </p>
          </section>
        ) : null}

        <ProviderFileReview
          providerId={file.id}
          status={status}
          seenUpdatedAt={file.updatedAt}
          documents={documents}
          requiredTypes={file.requiredTypes}
          canApprove={canApprove}
          hasRejectedRequired={hasRejectedRequired}
          reviewed={reviewed}
          total={file.requiredTypes.length}
        />

        {quality ? (
          <AdminQualitySection
            data={quality}
            locale={locale}
            providerId={file.id}
            providerName={file.approvedName ?? file.fullName}
          />
        ) : null}

        {ratings ? <AdminRatingsSection data={ratings} page={ratingsPage} hrefFor={ratingsHref} /> : null}
      </article>
    </div>
  );
}
