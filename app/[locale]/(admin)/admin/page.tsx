import { getTranslations, setRequestLocale } from 'next-intl/server';

import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/shared/PageHeader';
import { guardPage } from '@/lib/auth/session';
import { Link } from '@/lib/i18n/navigation';
import { ADMIN_LINKS } from '@/lib/navigation/menus';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The admin home. `EmptyState` until position 16. Below `lg` the bottom bar has three tabs, so a row of
 * links reaches the rail's other pages (spec 0007 AC-16). "Find request by id" opens a request's money trail
 * (spec 0011-12 AC-12); a plain GET form, so it works before the page hydrates.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const t = await getTranslations('Homes');
  const tNav = await getTranslations('Nav');
  const tFind = await getTranslations('AdminRequests');
  const invalid = (await searchParams).find === 'invalid';

  return (
    <>
      <PageHeader title={t('adminTitle')} />
      <nav aria-label={t('adminLinks')} className="lg:hidden">
        <ul className="flex flex-wrap gap-2.5">
          {ADMIN_LINKS.map(({ key, href }) => (
            <li key={key}>
              <Link
                href={href}
                className="inline-flex min-h-11 items-center rounded-full bg-surface-secondary px-5.5 py-3 text-btn-sm text-text-primary"
              >
                {tNav(key)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <form
        action={`/${locale}/admin/requests`}
        method="get"
        className="flex flex-col gap-2 rounded-block bg-surface-secondary p-5"
        role="search"
      >
        <Label htmlFor="find-request">{tFind('find')}</Label>
        <div className="flex flex-wrap gap-2.5">
          <Input
            id="find-request"
            name="id"
            required
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
            className="min-w-0 flex-1"
            aria-describedby={invalid ? 'find-request-error' : undefined}
            aria-invalid={invalid ? true : undefined}
          />
          <Button type="submit">{tFind('findSubmit')}</Button>
        </div>
        {invalid ? (
          <p id="find-request-error" role="alert" className="text-body-s text-error-foreground">
            {tFind('findInvalid')}
          </p>
        ) : null}
      </form>
      <EmptyState lead={t('adminLead')} title={t('adminEmpty')} body={t('adminBody')} />
    </>
  );
}
