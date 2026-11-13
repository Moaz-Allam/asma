import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';

import { fontVariables } from '@/lib/fonts';
import { clientMessages } from '@/lib/i18n/client-messages';
import { dirFor } from '@/lib/i18n/direction';
import { routing } from '@/lib/i18n/routing';
import { indexable, siteUrl } from '@/lib/seo/site';

import '../globals.css';

/**
 * The root of every user-facing route.
 *
 * There is deliberately NO app/layout.tsx — this layout renders <html>, and
 * next-intl documents removing pass-through root layouts because they conflict
 * with the localized one. Machine endpoints under app/api are not localized and
 * need no layout at all.
 *
 * Every page renders per request (spec 0004 AC-13, D69): the Content Security Policy carries a fresh
 * nonce from proxy.ts, and a nonce cannot exist in a page prerendered at build. So there is no
 * generateStaticParams, and the whole tree below is forced dynamic. The e2e suite checks the prerender
 * manifest holds no locale page.
 */
export const dynamic = 'force-dynamic';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Omit<Props, 'children'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'App' });
  return {
    metadataBase: new URL(siteUrl()),
    title: t('name'),
    description: t('tagline'),
    // Off until the real domain exists, and always on a preview (spec 0005 AC-30).
    robots: indexable() ? undefined : { index: false, follow: false },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  // A URL segment is client-supplied input. Validate it before anything else
  // trusts it — an unknown locale is a 404, never a silent fallback.
  if (!hasLocale(routing.locales, locale)) notFound();

  // Hands the locale to every Server Component beneath this layout without reading it from the
  // request again. Must be repeated in each page.tsx.
  setRequestLocale(locale);
  const messages = clientMessages(await getMessages());

  return (
    // Rule 10: both attributes derived from the locale. `dirFor` is the single
    // place direction is decided — never hardcode either value.
    <html lang={locale} dir={dirFor(locale)} className={fontVariables}>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
