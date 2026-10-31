import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

/**
 * Scaffold smoke journey, run once per locale project (ar, tr, en) at 390px.
 * Later positions add their own journeys beside this file.
 */

const DIRECTION: Record<string, 'rtl' | 'ltr'> = { ar: 'rtl', tr: 'ltr', en: 'ltr' };

test('the landing page renders in its locale, with the right direction, and fits a phone', async ({
  page,
}, testInfo) => {
  const locale = testInfo.project.name;
  await page.goto(`/${locale}`);

  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', DIRECTION[locale] ?? 'ltr');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // No horizontal scroll at 390px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
});

test('the brand icons are served and linked (D40)', async ({ page }, testInfo) => {
  await page.goto(`/${testInfo.project.name}`);
  for (const [rel, path] of [
    ['icon', '/favicon.ico'],
    ['icon', '/icon.png'],
    ['apple-touch-icon', '/apple-icon.png'],
  ] as const) {
    await expect(page.locator(`head link[rel="${rel}"][href^="${path}"]`)).toHaveCount(1);
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toMatch(/^image\//);
  }
});

test('the bare root negotiates a locale prefix (D19)', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/${testInfo.project.name}$`));
});
