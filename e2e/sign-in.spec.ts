import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { TURNSTILE_STUB, expect, test } from './fixtures';
import { TEST_CODE, WRONG_CODE, testPhone } from './numbers';

/**
 * Spec 0005 at 390px in every locale: the real local Auth server with test numbers, the real hook and
 * the real database. Only Cloudflare's script is stubbed, so no journey depends on Cloudflare.
 * Selectors are by id or role, not text: `tr` holds marked English until the translator arrives.
 */

async function axe(page: Page) {
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
}

const sendButton = (page: Page) => page.locator('form button[type="submit"]');

async function requestCode(page: Page, phone: string) {
  await page.locator('#login-phone').fill(phone);
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();
  await expect(page.locator('#login-code')).toBeVisible();
}

async function typeCode(page: Page, code: string) {
  await page.locator('#login-code').pressSequentially(code);
}

async function signIn(page: Page, locale: string, phone: string, path = `/${locale}/login`) {
  await page.goto(path);
  await requestCode(page, phone);
  await typeCode(page, TEST_CODE);
}

async function finishOnboarding(page: Page, name = 'Ayşe Yılmaz') {
  await page.locator('#full-name').fill(name);
  const tick = page.locator('#agreement');
  // A click before hydration does nothing, so keep trying until the box answers.
  await expect(async () => {
    if ((await tick.getAttribute('data-state')) !== 'checked') await tick.click();
    await expect(tick).toHaveAttribute('data-state', 'checked', { timeout: 500 });
  }).toPass();
  await sendButton(page).click();
}

async function signOut(page: Page, locale: string) {
  await page.goto(`/${locale}/account`);
  await page.locator('section button').click();
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
}

test('a new customer signs up, signs out and signs in again', async ({ page }, testInfo) => {
  const locale = testInfo.project.name;
  const phone = testPhone(locale, 'customer');

  await page.goto(`/${locale}/login`);
  await axe(page);

  await signIn(page, locale, phone);
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding$`));
  await axe(page);

  // Every other page sends them back here until they finish (AC-7).
  await page.goto(`/${locale}/account`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding$`));

  await finishOnboarding(page);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`));
  await axe(page);

  await signOut(page, locale);

  await signIn(page, locale, phone);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`));

  // The wrong role goes to their own home (AC-12), and so does the login page (AC-10).
  await page.goto(`/${locale}/admin`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`));
  await page.goto(`/${locale}/provider`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`));
  await page.goto(`/${locale}/login`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`));
  await page.goto(`/${locale}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`));
});

test('a provider link preselects the role, and one phone keeps one role', async ({ page }, testInfo) => {
  const locale = testInfo.project.name;
  const phone = testPhone(locale, 'provider');

  await signIn(page, locale, phone, `/${locale}/login?as=provider`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding\\?as=provider$`));
  await expect(page.locator('input[value="provider"]')).toBeChecked();

  await finishOnboarding(page, 'Mehmet Demir');
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider/profile$`));
  await axe(page);

  await page.goto(`/${locale}/requests`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider$`));

  await signOut(page, locale);
  await signIn(page, locale, phone);
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider$`));
});

test('a wrong code shows one message and the right one still works', async ({ page }, testInfo) => {
  const locale = testInfo.project.name;
  await page.goto(`/${locale}/login`);
  await requestCode(page, testPhone(locale, 'wrongCode'));

  await typeCode(page, WRONG_CODE);
  await expect(page.locator('#login-error')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${locale}/login$`));
  expect(page.url()).not.toContain(WRONG_CODE);

  await typeCode(page, TEST_CODE);
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding$`));
});

test('the form refuses a bad number with no Auth call', async ({ page, telemetry }, testInfo) => {
  const locale = testInfo.project.name;
  const otp: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/auth/v1/otp')) otp.push(request.url());
  });
  await page.goto(`/${locale}/login`);
  await expect(sendButton(page)).toBeEnabled();

  for (const number of ['0212 123 45 67', '555 12', '+49 151 1234 5678']) {
    await page.locator('#login-phone').fill(number);
    await sendButton(page).click();
    await expect(page.locator('#login-error')).toBeVisible();
  }
  expect(otp).toEqual([]);

  await expect
    .poll(() => telemetry.posthog.filter((event) => event.event === 'phone_rejected').length, {
      timeout: 20_000,
    })
    .toBe(3);
  const reasons = telemetry.posthog
    .filter((event) => event.event === 'phone_rejected')
    .map((event) => event.properties.reason);
  expect(reasons).toEqual(['not_mobile', 'too_short', 'other_country']);
});

test('the form takes every way of writing a number, in every digit set', async ({ page }, testInfo) => {
  const locale = testInfo.project.name;
  const sent: string[] = [];
  await page.route('**/auth/v1/otp', async (route) => {
    sent.push(String(route.request().postDataJSON().phone));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  for (const typed of ['555 123 45 67', '0555 123 45 67', '+90 555 123 45 67', '٥٥٥ ١٢٣ ٤٥ ٦٧']) {
    await page.goto(`/${locale}/login`);
    await requestCode(page, typed);
    await page.evaluate(() => sessionStorage.clear());
  }
  expect(sent).toEqual(Array.from({ length: 4 }, () => '+905551234567'));
});

test('a reload on the code step keeps working', async ({ page, context }, testInfo) => {
  const locale = testInfo.project.name;
  await page.goto(`/${locale}/login`);
  await requestCode(page, testPhone(locale, 'reload'));

  await page.reload();
  await expect(page.locator('#login-code')).toBeVisible();
  expect(page.url()).not.toContain('555');

  // Change number offers the way back while the code is live.
  await page.locator('form button[type="button"]').first().click();
  await expect(page.locator('#login-phone')).toBeVisible();
  await page.locator('form button[type="button"]').click();
  await expect(page.locator('#login-code')).toBeVisible();

  await typeCode(page, TEST_CODE);
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding$`));
  expect(await page.evaluate(() => sessionStorage.getItem('login_step'))).toBeNull();
  expect((await context.cookies()).some((cookie) => cookie.name.includes('auth-token'))).toBe(true);
});

test('a next that leaves the site lands on the home of the role', async ({ page }, testInfo) => {
  const locale = testInfo.project.name;
  await signIn(page, locale, testPhone(locale, 'injection'));
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding$`));
  await finishOnboarding(page);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`));

  for (const next of ['https://evil.example', '//evil.example', '/\\evil.example']) {
    await page.goto(`/${locale}/continue?next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`));
  }

  // A next the role may open is honoured; one it may not is ignored.
  await page.goto(`/${locale}/continue?next=${encodeURIComponent('/account')}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/account$`));
  await page.goto(`/${locale}/continue?next=${encodeURIComponent('/admin')}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`));
});

test('the account page saves the name, and the language follows the profile', async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const locale = testInfo.project.name;
  const phone = testPhone(locale, 'account');
  await signIn(page, locale, phone);
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding$`));
  await finishOnboarding(page);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`));

  await page.goto(`/${locale}/account`);
  await axe(page);
  await page.locator('#account-name').fill('Yeni İsim');
  await sendButton(page).click();
  await expect(page.locator('main [role="status"]')).toBeVisible();
  await expect(page.locator('#account-phone')).toHaveJSProperty('readOnly', true);

  const target = locale === 'en' ? 'tr' : 'en';
  await page.locator(`main button[lang="${target}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/${target}/account$`));

  // A fresh browser signs in on another language's URL and is moved to the profile's (AC-10).
  const fresh = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const other = await fresh.newPage();
  await other.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  );
  await signIn(other, locale, phone);
  await expect(other).toHaveURL(new RegExp(`/${target}/requests$`));

  // Signing out on one device leaves the other signed in (AC-19).
  await signOut(page, target);
  await other.goto(`/${target}/account`);
  await expect(other).toHaveURL(new RegExp(`/${target}/account$`));
  await fresh.close();
});

test('a widget that cannot load shows a retry, and nothing can be sent', async ({ page }, testInfo) => {
  const locale = testInfo.project.name;
  await page.unroute('https://challenges.cloudflare.com/**');
  await page.route('https://challenges.cloudflare.com/**', (route) => route.abort());

  await page.goto(`/${locale}/login`);
  await expect(page.locator('main [role="alert"]')).toBeVisible();
  await expect(sendButton(page)).toBeDisabled();
});

test('the login page fires no CSP violation (AC-23)', async ({ page, telemetry }, testInfo) => {
  await page.goto(`/${testInfo.project.name}/login`);
  await expect(sendButton(page)).toBeEnabled();
  expect(await telemetry.cspViolations()).toEqual([]);
});

test('a private page with no session goes to the login', async ({ page }, testInfo) => {
  const locale = testInfo.project.name;
  await page.goto(`/${locale}/requests/new`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/login\\?next=%2Frequests%2Fnew$`));
});

test('the terms and privacy pages exist and say noindex', async ({ page }, testInfo) => {
  const locale = testInfo.project.name;
  for (const path of ['terms', 'privacy']) {
    await page.goto(`/${locale}/${path}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await axe(page);
  }
});

test('no phone, code or name reaches Sentry or PostHog', async ({ page, telemetry }, testInfo) => {
  const locale = testInfo.project.name;
  const phone = testPhone(locale, 'telemetry');
  await page.goto(`/${locale}/login`);
  await requestCode(page, phone);
  await expect
    .poll(() => telemetry.posthog.map((event) => event.event), { timeout: 20_000 })
    .toContain('code_requested');
  await typeCode(page, TEST_CODE);
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding$`));
  await finishOnboarding(page, 'Gizli Kişi');
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`));

  await expect
    .poll(() => telemetry.posthog.map((event) => event.event), { timeout: 20_000 })
    .toEqual(expect.arrayContaining(['code_verified', 'onboarding_completed']));
  expect(telemetry.posthog.find((event) => event.event === 'onboarding_completed')?.properties.role).toBe(
    'customer',
  );

  const sent = JSON.stringify([telemetry.posthog, telemetry.sentry]);
  expect(sent).not.toContain(phone);
  expect(sent).not.toContain(TEST_CODE);
  expect(sent).not.toContain('Gizli');
  expect(telemetry.offOrigin).toEqual([]);
  expect(await telemetry.cspViolations()).toEqual([]);
});
