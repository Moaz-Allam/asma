import { useTranslations } from 'next-intl';

import { Link } from '@/lib/i18n/navigation';

/**
 * The agreement reminder above every payment button (ui-registry `AgreementLine`, D92, spec 0011-09 AC-10): one
 * short line with a link to the terms. The wording is a draft until the lawyer's text lands (S16, D100). 10 puts
 * it above the provider fee button too.
 */
export function AgreementLine() {
  const t = useTranslations('Payment');
  return (
    <p className="text-body-s text-text-secondary">
      {t.rich('agreement', {
        terms: (chunks) => (
          <Link href="/terms" className="text-link underline underline-offset-4">
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}
