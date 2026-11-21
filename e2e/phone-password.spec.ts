import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Browser, Page } from '@playwright/test';

import {
  TEST_PASSWORD,
  fillPasswordSignIn,
  onboard,
  requestCode,
  setNewPassword,
  signIn,
  signInWithPassword,
  signOut,
  submitOnboarding,
  typeCode,
} from './auth';
import { TURNSTILE_STUB, expect, test, type Telemetry } from './fixtures';
import { TEST_CODE, testE164, testPhone } from './numbers';

/**
 * Spec 0012 at 390px in every locale, on the real local Auth server (AC-9's settings) and the real triggers: a new
 * account proves its phone by code and sets a password; the password signs in; a wrong one and an unknown phone say
 * the same thing; a reset by code replaces it; the account page changes it, ends every other session and moves "last
 * changed"; a raw sign up that carries a password saves none. Selectors by id or role: `tr` holds marked English.
 */

// Low entropy on purpose, as TEST_PASSWORD (the CI secret scan).
const NEW_PASSWORD = 'dddd-eeee-ffff';
/** Well formed for Turkey and never registered: a password sign in for it must look like a wrong password. */
const UNKNOWN_PHONE = '555 800 00 47';

async function axe(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.evaluate(() =>
    Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
  );
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
}

function sql(query: string): Record<string, unknown>[] {
  const file = join(tmpdir(), `asma-e2e-pw-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
  writeFileSync(file, query);
  let last = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const run = spawnSync('npx', ['supabase', 'db', 'query', '--local', '-o', 'json', '-f', file], {
      encoding: 'utf8',
      shell: true,
    });
    if (run.status === 0) {
      const start = run.stdout.search(/[[{]/);
      if (start < 0) return [];
      const parsed = JSON.parse(run.stdout.slice(start)) as
        Record<string, unknown>[] | { rows?: Record<string, unknown>[] };
      return Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
    }
    last = `${run.stdout}\n${run.stderr}`;
  }
  throw new Error(`db query failed: ${last}`);
}

/** `auth.users.phone` holds E.164 without the plus. */
const authPhone = (e164: string) => e164.replace(/^\+/, '');

async function freshPage(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  );
  return page;
}

const submit = (page: Page) => page.locator('form button[type="submit"]');
const loginError = (page: Page) => page.locator('#login-error');
const passwordSection = (page: Page) => page.locator('section[aria-labelledby="password-section"]');

/** AC-11: no phone and no password in any event or Sentry envelope this page sent. */
function expectNothingSecret(telemetry: Telemetry, secrets: string[]) {
  const sent = JSON.stringify(telemetry.posthog) + telemetry.sentry.join('\n');
  for (const secret of secrets) expect(sent).not.toContain(secret);
}

test('a new account sets a password, signs in with it, and resets it by code', async ({
  page,
  telemetry,
}, testInfo) => {
  test.setTimeout(240_000);
  const locale = testInfo.project.name;
  const phone = testPhone(locale, 'passwordCustomer');

  // AC-1, AC-3: the login opens on phone and password, with both ways to the code route.
  await page.goto(`/${locale}/login`);
  await expect(page.locator('#login-phone')).toHaveAttribute('autocomplete', 'username');
  await expect(page.locator('#login-password')).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');
  await page.locator('button[aria-controls="login-password"]').click();
  await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
  await expect(page.locator(`main a[href="/${locale}/login?mode=code&reset=1"]`)).toBeVisible();
  await expect(submit(page)).toBeEnabled();
  await axe(page);

  // A new account: the code route, onboarding, then the password step (AC-4).
  await page.locator(`main a[href="/${locale}/login?mode=code"]`).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/login\\?mode=code$`));
  await requestCode(page, phone);
  await typeCode(page, TEST_CODE);
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding$`));
  await submitOnboarding(page, 'Parola Müşteri');
  await expect(page).toHaveURL(new RegExp(`/${locale}/account/password\\?next=%2Frequests%2Fnew$`));
  await expect(page.locator('#new-password')).toHaveAttribute('autocomplete', 'new-password');
  await expect(submit(page)).toBeEnabled();
  await axe(page);

  // AC-5: the form refuses a weak choice, a short one and two that differ, before any Auth call.
  const userCalls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/auth/v1/user') && request.method() === 'PUT') userCalls.push(request.url());
  });
  const refused: ReadonlyArray<readonly [string, string]> = [
    ['1234567890', '1234567890'],
    ['short-one', 'short-one'],
    [`x${phone}x`, `x${phone}x`],
    [TEST_PASSWORD, NEW_PASSWORD],
  ];
  for (const [first, second] of refused) {
    await page.locator('#new-password').fill(first);
    await page.locator('#repeat-password').fill(second);
    await submit(page).click();
    await expect(page.locator('#password-error')).toBeVisible();
  }
  expect(userCalls).toEqual([]);
  await setNewPassword(page, TEST_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`));

  // The account page shows when it was set, and no reminder.
  await page.goto(`/${locale}/account`);
  await expect(passwordSection(page).locator('#current-password')).toBeVisible();

  // AC-1: sign out, then in with the password.
  await signOut(page, locale);
  await signInWithPassword(page, locale, phone, TEST_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`));
  await signOut(page, locale);

  // AC-2: a wrong password and an unknown phone show the same message, and the URL holds neither.
  await page.goto(`/${locale}/login`);
  await fillPasswordSignIn(page, phone, 'Not-The-Password-1');
  await expect(loginError(page)).toBeVisible();
  const wrong = await loginError(page).innerText();
  // The failure event waits for the next batch (the person stays on the page): let it go before leaving.
  await expect
    .poll(() => telemetry.posthog.map((event) => event.event), { timeout: 20_000 })
    .toContain('password_sign_in_failed');
  await page.goto(`/${locale}/login`);
  await fillPasswordSignIn(page, UNKNOWN_PHONE, TEST_PASSWORD);
  await expect(loginError(page)).toBeVisible();
  expect(await loginError(page).innerText()).toBe(wrong);
  await expect(page).toHaveURL(new RegExp(`/${locale}/login$`));
  await axe(page);

  // AC-3, AC-6: forgot it: a code with reset=1 lands on the reset step, and the new password replaces the old.
  await page.locator(`main a[href="/${locale}/login?mode=code&reset=1"]`).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/login\\?mode=code&reset=1$`));
  await requestCode(page, phone);
  await typeCode(page, TEST_CODE);
  await expect(page).toHaveURL(new RegExp(`/${locale}/account/password\\?reason=reset&next=%2Frequests$`));
  await expect(submit(page)).toBeEnabled();
  await axe(page);
  await setNewPassword(page, NEW_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`));

  await signOut(page, locale);
  await page.goto(`/${locale}/login`);
  await fillPasswordSignIn(page, phone, TEST_PASSWORD);
  await expect(loginError(page)).toBeVisible();
  await signInWithPassword(page, locale, phone, NEW_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`));

  // AC-3: a signed in visitor who asks for a reset is signed out on this device first, then resets by code.
  await page.goto(`/${locale}/account`);
  // No sideways scroll at 390px: in RTL the switches' hidden inputs once pushed the page 9px wide.
  await page.waitForLoadState('networkidle');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBe(0);
  await passwordSection(page).locator(`a[href*="reset=1"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/login\\?mode=code&reset=1&next=%2Faccount$`));
  // The page asks first (D201): opening a ?reset=1 link alone signs nobody out.
  await expect(page.locator('#login-phone')).toHaveCount(0);
  await page.goto(`/${locale}/account`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/account$`));
  await passwordSection(page).locator(`a[href*="reset=1"]`).first().click();
  await page.locator('#reset-sign-out').click();
  await requestCode(page, phone);
  await typeCode(page, TEST_CODE);
  await expect(page).toHaveURL(new RegExp(`/${locale}/account/password\\?reason=reset&next=%2Faccount$`));
  await setNewPassword(page, TEST_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`/${locale}/account$`));

  // AC-11: the events, each with its reason, and no phone or password anywhere.
  await expect
    .poll(() => telemetry.posthog.map((event) => event.event), { timeout: 20_000 })
    .toEqual(expect.arrayContaining(['password_set', 'password_signed_in', 'password_sign_in_failed']));
  const reasons = (name: string) =>
    telemetry.posthog.filter((event) => event.event === name).map((event) => event.properties.reason);
  expect(reasons('password_set')).toEqual(expect.arrayContaining(['first', 'reset']));
  expect(new Set(reasons('password_sign_in_failed'))).toEqual(new Set(['credentials']));
  expectNothingSecret(telemetry, [
    TEST_PASSWORD,
    NEW_PASSWORD,
    'Not-The-Password-1',
    phone,
    testE164(locale, 'passwordCustomer'),
  ]);
});

test('a change from the account page needs the current password, moves "last changed" and ends other sessions', async ({
  page,
  browser,
  baseURL,
  telemetry,
}, testInfo) => {
  test.setTimeout(240_000);
  const locale = testInfo.project.name;
  const phone = testPhone(locale, 'passwordChange');
  const e164 = testE164(locale, 'passwordChange');

  await signIn(page, locale, phone);
  await onboard(page, 'Parola Değişim');
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`));

  // D201: with no JavaScript (the page before hydration), every password form's submit is disabled, so a native GET
  // can never carry a password into a URL. Signed in: the change form and the reset step; signed out: the login.
  const viewport = { width: 390, height: 844 };
  const signedIn = await browser.newContext({
    baseURL,
    viewport,
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const signedOut = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false });
  for (const [context, path] of [
    [signedIn, `/${locale}/account`],
    [signedIn, `/${locale}/account/password?reason=reset`],
    [signedOut, `/${locale}/login`],
  ] as const) {
    const plain = await context.newPage();
    await plain.goto(path);
    const submits = plain.locator('form:has(input[type="password"]) button[type="submit"]');
    await expect(submits).toHaveCount(1);
    await expect(submits).toBeDisabled();
    await plain.close();
  }
  await signedIn.close();
  await signedOut.close();

  // Another device signed in with the password.
  const other = await freshPage(browser, baseURL);
  await signInWithPassword(other, locale, phone, TEST_PASSWORD);
  await expect(other).toHaveURL(new RegExp(`/${locale}/requests$`));

  // Move "last changed" back, so the change can be seen to move it (the trigger writes it only on a password write).
  sql(
    `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"password_changed_at": "2026-01-02T09:00:00+00:00"}'::jsonb where phone = '${authPhone(e164)}'`,
  );
  await page.goto(`/${locale}/account`);
  const lastChanged = passwordSection(page).locator('h2 + p');
  const before = await lastChanged.innerText();
  await expect(passwordSection(page).locator('button[type="submit"]')).toBeEnabled();
  await axe(page);

  // AC-7: a wrong current password is refused with the sign in's message.
  await page.locator('#current-password').fill('Not-The-Password-2');
  await page.locator('#change-new-password').fill(NEW_PASSWORD);
  await page.locator('#change-repeat-password').fill(NEW_PASSWORD);
  await passwordSection(page).locator('button[type="submit"]').click();
  await expect(page.locator('#change-password-error')).toBeVisible();

  // The right one changes it: a status, "last changed" moves, and the other device is signed out.
  await expect(passwordSection(page).locator('button[type="submit"]')).toBeEnabled();
  await page.locator('#current-password').fill(TEST_PASSWORD);
  await page.locator('#change-new-password').fill(NEW_PASSWORD);
  await page.locator('#change-repeat-password').fill(NEW_PASSWORD);
  await passwordSection(page).locator('button[type="submit"]').click();
  await expect(passwordSection(page).getByRole('status')).toBeVisible({ timeout: 20_000 });
  await expect(lastChanged).not.toHaveText(before);

  // Its cookie is still there, so the proxy lets it through and the page guard sends it to a bare /login (0005).
  await other.goto(`/${locale}/requests`);
  await expect(other).toHaveURL(new RegExp(`/${locale}/login$`));
  await other.context().close();

  // AC-10: the change wrote one audit row that queues the notice (sent only with a confirmed email, which this
  // account has none of, so the row is all there is to see).
  const audit = sql(
    `select action from public.audit_log where entity_type = 'auth_users' and entity_id = (select id::text from auth.users where phone = '${authPhone(e164)}') order by created_at`,
  );
  expect(audit.map((row) => row.action)).toEqual(['auth.password_set', 'auth.password_changed']);

  await signOut(page, locale);
  await page.goto(`/${locale}/login`);
  await fillPasswordSignIn(page, phone, TEST_PASSWORD);
  await expect(loginError(page)).toBeVisible();
  await signInWithPassword(page, locale, phone, NEW_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`));

  await expect
    .poll(
      () =>
        telemetry.posthog.filter((event) => event.event === 'password_set').map((e) => e.properties.reason),
      {
        timeout: 20_000,
      },
    )
    .toEqual(expect.arrayContaining(['first', 'change']));
  expectNothingSecret(telemetry, [TEST_PASSWORD, NEW_PASSWORD, 'Not-The-Password-2', phone]);
});

test('a raw sign up that carries a password saves none, and continue asks for one', async ({
  page,
  browser,
  baseURL,
  request,
}, testInfo) => {
  test.setTimeout(240_000);
  const locale = testInfo.project.name;
  const phone = testPhone(locale, 'passwordRaw');
  const e164 = testE164(locale, 'passwordRaw');
  const raw = 'Raw-Signup-Password-77';

  // AC-8: the API call an attacker would make, straight to Auth with no app in between.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  expect(url && key).toBeTruthy();
  const signup = await request.post(`${url}/auth/v1/signup`, {
    headers: { apikey: String(key), 'content-type': 'application/json' },
    data: { phone: e164, password: raw },
  });
  expect(signup.ok()).toBe(true);
  expect(
    sql(
      `select encrypted_password = '' as blank, raw_app_meta_data ->> 'has_password' as has_password from auth.users where phone = '${authPhone(e164)}'`,
    ),
  ).toEqual([{ blank: true, has_password: 'false' }]);

  // The owner of the number proves it by code.
  await signIn(page, locale, phone);
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding$`));

  // The phone is proven now, and the raw password still does not sign in (AC-2's one message).
  const other = await freshPage(browser, baseURL);
  await other.goto(`/${locale}/login`);
  await fillPasswordSignIn(other, phone, raw);
  await expect(loginError(other)).toBeVisible();
  await other.context().close();

  // AC-4: onboarding leads to the password step, because no password was ever saved.
  await submitOnboarding(page, 'Parola Ham');
  await expect(page).toHaveURL(new RegExp(`/${locale}/account/password\\?next=%2Frequests%2Fnew$`));
  await setNewPassword(page, TEST_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`));
});
