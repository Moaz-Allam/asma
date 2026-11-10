import type { PublicRegion } from '@/lib/region/public';

/**
 * The landing page's structured data (spec 0005 AC-29). Built from the same catalogue as the visible page,
 * so a claim in the markup is one the page makes. No `aggregateRating`, no price: no quality claim (B7), and
 * the prices on the page are samples.
 */

type Faq = { question: string; answer: string };

/** Our region codes to ISO country codes, for `areaServed`. */
const COUNTRY: Readonly<Record<string, string>> = { TR: 'TR', KSA: 'SA' };

function areaServed(regions: readonly PublicRegion[], locale: string) {
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  return regions.map((region) => {
    const country = COUNTRY[region.code] ?? region.code;
    return { '@type': 'Country', name: names.of(country) ?? country };
  });
}

export function landingJsonLd(input: {
  url: string;
  locale: string;
  name: string;
  description: string;
  serviceName: string;
  regions: readonly PublicRegion[];
  faqs: readonly Faq[];
}): Array<Record<string, unknown>> {
  const { url, locale, name, description, serviceName, regions, faqs } = input;
  const context = 'https://schema.org';
  const organization = `${url}/#organization`;

  return [
    {
      '@context': context,
      '@type': 'Organization',
      '@id': organization,
      name,
      url,
      logo: `${url}/icon.png`,
    },
    {
      '@context': context,
      '@type': 'WebSite',
      name,
      url,
      inLanguage: locale,
      publisher: { '@id': organization },
    },
    {
      '@context': context,
      '@type': 'Service',
      name: serviceName,
      description,
      provider: { '@id': organization },
      areaServed: areaServed(regions, locale),
    },
    {
      '@context': context,
      '@type': 'FAQPage',
      inLanguage: locale,
      mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    },
  ];
}

/** Safe inside a script tag: a `<` in any text cannot close it. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replaceAll('<', '\\u003c');
}
