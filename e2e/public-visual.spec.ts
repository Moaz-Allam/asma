import { expect, test } from './fixtures';

const surfaces = [
  { name: 'landing', path: '', status: 200 },
  { name: 'login', path: '/login', status: 200 },
  { name: 'not-found', path: '/visual-qa-missing-page', status: 404 },
] as const;

const screens = [
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false },
] as const;

for (const screen of screens) {
  test.describe(screen.name, () => {
    test.use({
      viewport: screen.viewport,
      isMobile: screen.isMobile,
      hasTouch: screen.isMobile,
      reducedMotion: 'reduce',
    });

    test('public pages fit the viewport and support keyboard navigation', async ({ page }, testInfo) => {
      const locale = testInfo.project.name;
      for (const surface of surfaces) {
        await test.step(surface.name, async () => {
          const response = await page.goto(`/${locale}${surface.path}`);
          const main = page.getByRole('main');
          await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await page.screenshot({
            path: testInfo.outputPath('public-visual', `${surface.name}-${locale}-${screen.name}.png`),
            animations: 'disabled',
            scale: 'css',
          });

          expect(response?.status()).toBe(surface.status);
          await expect(page.locator('html')).toHaveAttribute('lang', locale);
          await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow).toBeLessThanOrEqual(0);

          if (surface.name === 'not-found') {
            await expect(main.locator(`a[href="/${locale}/requests"]`)).toBeVisible();
          } else {
            await page.keyboard.press('Tab');
            await expect(page.locator('a[href="#main-content"]')).toBeFocused();
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/#main-content$/);
            await expect(main).toBeFocused();
            await page.keyboard.press('Tab');
            await expect(main.locator(':focus')).toHaveCount(1);
          }
        });
      }
    });
  });
}
