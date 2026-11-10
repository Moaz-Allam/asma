import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Categories } from '@/components/features/landing/Categories';
import { ClosingCall } from '@/components/features/landing/ClosingCall';
import { FAQ_KEYS, Faq } from '@/components/features/landing/Faq';
import { Hero } from '@/components/features/landing/Hero';
import { HowItWorks } from '@/components/features/landing/HowItWorks';
import { OffersBand } from '@/components/features/landing/OffersBand';
import { Prices } from '@/components/features/landing/Prices';
import { QuickStart } from '@/components/features/landing/QuickStart';
import { Trust } from '@/components/features/landing/Trust';
import { getSessionUser } from '@/lib/auth/session';
import { redirect } from '@/lib/i18n/navigation';
import { getPublicRegions } from '@/lib/region/public';
import { landingJsonLd, serializeJsonLd } from '@/lib/seo/json-ld';
import { languageAlternates, siteUrl } from '@/lib/seo/site';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Seo' });
  const title = t('title');
  const description = t('description');
  const image = { url: `/og/${locale}.png`, width: 1200, height: 630, alt: t('imageAlt') };

  return {
    title,
    description,
    alternates: { canonical: `/${locale}`, languages: languageAlternates('') },
    openGraph: {
      type: 'website',
      url: `/${locale}`,
      siteName: 'Aldebyani',
      locale,
      title,
      description,
      images: [image],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  };
}

/** The full landing page, `s1` in order (spec 0005 AC-27). Signed in goes home. */
export default async function LandingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (await getSessionUser()) redirect({ href: '/continue', locale });

  const t = await getTranslations('Seo');
  const tFaq = await getTranslations('Landing.faq');
  const regions = await getPublicRegions();
  const blocks = landingJsonLd({
    url: siteUrl(),
    locale,
    name: 'Aldebyani',
    description: t('description'),
    serviceName: t('serviceName'),
    regions,
    faqs: FAQ_KEYS.map((key) => ({ question: tFaq(`${key}Q`), answer: tFaq(`${key}A`) })),
  });

  return (
    <>
      {blocks.map((block) => (
        <script
          key={String(block['@type'])}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(block) }}
        />
      ))}
      <Hero />
      <HowItWorks />
      <Prices />
      <Categories />
      <OffersBand />
      <Trust />
      <QuickStart />
      <Faq />
      <ClosingCall />
    </>
  );
}
