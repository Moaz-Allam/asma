import { getTranslations, setRequestLocale } from 'next-intl/server';

import { FileProgress } from '@/components/features/provider/FileProgress';
import { OnboardingFrame } from '@/components/features/provider/OnboardingFrame';
import { ProfileForm } from '@/components/features/provider/ProfileForm';
import { ProviderProfileView } from '@/components/features/provider/ProviderProfileView';
import { ErrorState } from '@/components/shared/ErrorState';
import { PageHeader } from '@/components/shared/PageHeader';
import { getProfile } from '@/lib/account/profile';
import { guardPage } from '@/lib/auth/session';
import { Link } from '@/lib/i18n/navigation';
import { getProviderFile, getStanding } from '@/lib/provider/queries';
import { PHOTO_LINK_SECONDS, PHOTOS_BUCKET } from '@/lib/storage/buckets';
import { signedLink } from '@/lib/storage/server';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Step 1 (`p2`) or the profile (`p7`), by standing (spec 0006 Feature design, AC-1, AC-11):
 * draft and rejected see the form and Save goes to step 2; pending sees the form and stays; approved and
 * document_expired see `p7`, where `?edit=1` opens the form; suspended sees `p7` read only.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['provider']);
  const t = await getTranslations('ProviderForm');
  const tHome = await getTranslations('Provider.home');
  const { edit } = await searchParams;

  const [standing, file, profile] = await Promise.all([
    getStanding(user.id),
    getProviderFile(user.id),
    getProfile(user.id),
  ]);
  if (!standing || !file || !profile) {
    return (
      <>
        <PageHeader title={t('title')} />
        <ErrorState title={tHome('error.title')} body={tHome('error.body')} />
      </>
    );
  }

  const photo = file.documents.profile_photo;
  const photoUrl = photo ? await signedLink(PHOTOS_BUCKET, photo.path, PHOTO_LINK_SECONDS) : null;
  const approved = standing === 'approved' || standing === 'document_expired';

  if (standing === 'suspended' || (approved && edit !== '1')) {
    return (
      <ProviderProfileView
        file={file}
        standing={standing}
        fullName={profile.fullName}
        photoUrl={photoUrl}
        editable={approved}
      />
    );
  }

  const form = (
    <ProfileForm
      userId={user.id}
      region={file.region}
      photoUrl={photoUrl}
      hasPhoto={photo !== undefined}
      approved={approved}
      afterSave={
        standing === 'draft' || standing === 'rejected' ? '/provider/profile/documents' : '/provider/profile'
      }
      saved={{
        entityType: file.entityType,
        legalName: file.legalName,
        taxNumber: file.taxNumber,
        bio: file.profile?.bio ?? '',
        years: file.profile?.years ?? null,
        languages: file.profile?.languages ?? [],
      }}
    />
  );

  const name = (
    <div className="flex flex-col gap-2">
      <span className="text-body-s font-bold text-text-primary">{t('nameLabel')}</span>
      <p className="rounded-field bg-surface-secondary px-4.5 py-4 text-body text-text-primary">
        {profile.fullName}
      </p>
      <p className="text-meta text-text-secondary">
        {t('nameNote')}{' '}
        <Link href="/account" className="text-link underline underline-offset-4">
          {t('nameLink')}
        </Link>
      </p>
    </div>
  );

  if (approved) {
    return (
      <>
        <PageHeader title={t('editTitle')} intro={t('editIntro')} />
        {name}
        {form}
      </>
    );
  }

  return (
    <OnboardingFrame
      step={1}
      title={t('title')}
      intro={t('intro')}
      aside={
        <>
          <FileProgress file={file} />
          <p className="rounded-block border-2 border-border p-5 text-meta text-text-secondary">
            {t('privacyNote')}
          </p>
        </>
      }
    >
      {name}
      {form}
    </OnboardingFrame>
  );
}
