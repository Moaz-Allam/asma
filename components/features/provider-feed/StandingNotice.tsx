import { getTranslations } from 'next-intl/server';

import { AccountStateBanner } from '@/components/features/provider/AccountStateBanner';
import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';
import type { ProviderFile } from '@/lib/provider/queries';
import type { Standing } from '@/lib/provider/options';

/**
 * 02's standing page, shown in place of the feed to any provider who is not approved (spec 0009 AC-15): the
 * draft step for a draft file, else the account state banner of 02.
 */
export async function StandingNotice({
  standing,
  file,
}: {
  standing: Exclude<Standing, 'approved'>;
  file: ProviderFile;
}) {
  if (standing !== 'draft') return <AccountStateBanner standing={standing} file={file} />;
  const t = await getTranslations('Provider.home');
  return (
    <section className="flex flex-col items-start gap-4 rounded-panel bg-accent-light p-6.5 lg:p-9">
      <p className="text-body text-text-primary">{t('draft.next')}</p>
      <Button asChild size="lg">
        <Link href="/provider/profile">{t('draft.action')}</Link>
      </Button>
    </section>
  );
}
