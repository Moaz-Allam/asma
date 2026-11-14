import { getFormatter, getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';
import type { Standing } from '@/lib/provider/options';
import type { ProviderFile } from '@/lib/provider/queries';

/** The status card line per standing. This page renders only `approved`, `document_expired` and `suspended`. */
const STATUS_LINE: Partial<Record<Standing, 'statusApproved' | 'statusExpired' | 'statusSuspended'>> = {
  approved: 'statusApproved',
  document_expired: 'statusExpired',
  suspended: 'statusSuspended',
};

/**
 * The provider's own profile once approved or suspended (`p7`, AC-11), as far as data exists: photo, name,
 * chips, years and languages, and the account status card. Metrics, services, past work, ratings and the
 * bank card are left out on purpose (Feature design: 19, 05, 17, 06, D87).
 *
 * Everything that says whether the provider may apply follows `standing`, never `file.status`: an approved
 * provider with an expired document keeps `status = 'approved'` and reads `document_expired` (AC-20).
 */
export async function ProviderProfileView({
  file,
  standing,
  fullName,
  photoUrl,
  editable,
}: {
  file: ProviderFile;
  standing: Standing;
  fullName: string;
  photoUrl: string | null;
  editable: boolean;
}) {
  const t = await getTranslations('Provider.view');
  const tLang = await getTranslations('ProviderForm.languages');
  const format = await getFormatter();

  const approved = standing === 'approved';
  const record = file.documents.criminal_record;
  const id = file.documents.id_front;
  const year = file.approvedAt ? new Date(file.approvedAt).getUTCFullYear() : null;
  const date = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[1.55fr_1fr]">
      <section className="flex flex-col gap-6 rounded-panel bg-accent-light p-6.5 sm:flex-row sm:items-start lg:p-8.5">
        <div className="flex size-26 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-secondary">
          {photoUrl ? (
            // A signed Storage link: next/image would fetch and cache it on our server.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={t('photoAlt')} className="size-full object-cover" />
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {approved ? (
              <span className="rounded-full bg-surface px-3 py-1.5 text-chip">{t('idVerified')}</span>
            ) : null}
            {approved && record?.status === 'approved' ? (
              <span className="rounded-full bg-surface px-3 py-1.5 text-chip">{t('securityChecked')}</span>
            ) : null}
            {year ? (
              <span className="rounded-full bg-surface-secondary px-3 py-1.5 text-chip">
                {t('memberSince', { year })}
              </span>
            ) : null}
          </div>
          <h1 className="font-display text-title break-words text-text-primary">{fullName}</h1>
          {file.profile ? (
            <p className="text-body text-text-primary">
              {t('summary', {
                years: file.profile.years,
                languages: file.profile.languages.map((l) => tLang(l)).join(' · '),
              })}
            </p>
          ) : null}
          {file.profile ? (
            <p className="max-w-60ch text-body-s break-words whitespace-pre-line text-text-body">
              {file.profile.bio}
            </p>
          ) : null}
        </div>
        {editable ? (
          <Button asChild variant="white" size="lg" className="self-start">
            <Link href={{ pathname: '/provider/profile', query: { edit: '1' } }}>{t('edit')}</Link>
          </Button>
        ) : null}
      </section>

      <aside className="flex flex-col gap-3.5">
        <section className="flex flex-col gap-3 rounded-panel bg-surface-secondary p-6.5">
          <h2 className="text-eyebrow text-text-secondary">{t('statusTitle')}</h2>
          <ul className="flex flex-col gap-2.5 text-body-s font-semibold text-text-primary">
            <li>{t(STATUS_LINE[standing] ?? 'statusSuspended')}</li>
            {id?.validUntil ? <li>{t('idValid', { date: date(id.validUntil) })}</li> : null}
            {record?.validUntil ? <li>{t('recordValid', { date: date(record.validUntil) })}</li> : null}
          </ul>
          <p className="text-meta text-text-secondary">{t('replaceNote')}</p>
          <Link href="/provider/profile/documents" className="text-btn-sm text-link">
            {t('documentsLink')}
          </Link>
        </section>
      </aside>
    </div>
  );
}
