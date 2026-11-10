import AxeBuilder from '@axe-core/playwright';

import { expect, test } from './fixtures';

/**
 * Spec 0005 AC-27, AC-29, AC-30 at 390px in every locale. The wrapper builds with no `APP_SITE_URL`, so every
 * page here must say `noindex`; `tests/seo.test.ts` proves the other side of the switch.
 */

test('the landing page follows s1 in order, and fits a phone', async ({ page }, testInfo) => {
  const locale = testInfo.project.name;
  await page.goto(`/${locale}`);

  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const ids = await page.locator('main section[id]').evaluateAll((sections) => sections.map((s) => s.id));
  expect(ids).toEqual(['how', 'prices', 'categories', 'faq']);
  await expect(page.locator('main section')).toHaveCount(9);
  await expect(page.locator('header')).toHaveCount(1);
  await expect(page.locator('footer')).toHaveCount(1);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
});

test('every call leads to the login with the right intent', async ({ page }, testInfo) => {
  const locale = testInfo.project.name;
  await page.goto(`/${locale}`);
  const hrefs = await page
    .locator('main a[href*="/login"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(new Set(hrefs)).toEqual(
    new Set([`/${locale}/login?next=%2Frequests%2Fnew`, `/${locale}/login?as=provider`]),
  );
});

test('the phone menu opens in a sheet and reaches a section', async ({ page }, testInfo) => {
  const locale = testInfo.project.name;
  await page.goto(`/${locale}`);
  await page.locator('header button').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.locator('a[href$="#prices"]').click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/${locale}#prices$`));
});

test('the server HTML holds the metadata, the structured data and every FAQ answer', async ({
  request,
}, testInfo) => {
  const locale = testInfo.project.name;
  const html = await (await request.get(`/${locale}`)).text();

  expect(html).toMatch(/<title>[^<]+<\/title>/);
  expect(html).toContain('name="description"');
  expect(html).toContain(`rel="canonical"`);
  for (const lang of ['ar', 'tr', 'en', 'x-default']) expect(html).toContain(`hrefLang="${lang}"`);
  expect(html).toContain('property="og:image"');
  expect(html).toContain(`/og/${locale}.png`);
  expect(html).toContain('name="twitter:card"');

  const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((match) =>
    JSON.parse(match[1] ?? '{}'),
  );
  expect(blocks.map((block) => block['@type'])).toEqual(['Organization', 'WebSite', 'Service', 'FAQPage']);

  const faq = blocks[3]?.mainEntity as Array<{ acceptedAnswer: { text: string } }>;
  expect(faq).toHaveLength(7);
  // The rendered HTML escapes some characters; a stretch of plain words is enough to find each answer.
  for (const { acceptedAnswer } of faq) {
    const words = acceptedAnswer.text.slice(0, 18).replace(/['"&<>]/g, '');
    expect(html.split('</script>').slice(-40).join('')).toContain(words);
  }
});

test('nothing is indexable while the site address is empty', async ({ page, request }, testInfo) => {
  await page.goto(`/${testInfo.project.name}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toMatch(/Disallow: \/\s*$/m);

  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).not.toContain('<url>');
});

test('the card image and the manifest are served', async ({ request }, testInfo) => {
  const image = await request.get(`/og/${testInfo.project.name}.png`);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');

  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).name).toBe('Aldebyani Home Care');
});

test('the English copy has no escrow wording and no quality claim', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'en', 'the wording is checked once, on the source language');
  await page.goto('/en');
  const text = (await page.locator('main').innerText()).toLowerCase();
  for (const word of ['escrow', 'held', 'release', 'guarantee', 'best', 'trusted', '%']) {
    expect(text, word).not.toContain(word);
  }
});
