import { defineConfig, devices } from '@playwright/test';

/**
 * End to end journeys at phone width (390px) in every locale: `ar` (RTL), `tr`, `en` (D24).
 *
 * Run through `npm run test:e2e` (scripts/e2e.mjs), never bare: the wrapper builds the app with local
 * values so cloud values can never reach a test run. Navigate with explicit locale prefixes (`/ar/…`);
 * a locale cookie from one test must never decide another test's language.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

const LOCALES = [
  { name: 'ar', tag: 'ar' },
  { name: 'tr', tag: 'tr-TR' },
  { name: 'en', tag: 'en-US' },
] as const;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // More than two local workers timed out on the reference build; keep it at two.
  workers: 2,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: LOCALES.map(({ name, tag }) => ({
    name,
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      locale: tag,
    },
  })),
  webServer: {
    command: `npx next start --port ${PORT}`,
    url: `${baseURL}/en`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
