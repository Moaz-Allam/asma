import type { Page } from '@playwright/test';

import { expect } from './fixtures';
import { TEST_CODE } from './numbers';

/**
 * The one sign in module every journey uses (spec 0012 AC-12): it replaced thirteen copies of the same two helpers.
 * Since 01b `/login` opens on phone and password, so a code sign in goes through `?mode=code`, and an account with a
 * role and no password meets the password step at `/continue`. These helpers pass that step with `TEST_PASSWORD`, so
 * a journey lands where it did before 01b. A fixture that writes a user by SQL may give it a password only by an
 * update after `phone_confirmed_at` is set and its profile exists: otherwise `password_guard` blanks it (D201).
 */

/** Ten code points or more, not on the common list, no phone digits (spec 0012 AC-5). */
export const TEST_PASSWORD = 'Lantern-Orchard-58';

/** The same login path in code mode (spec 0012 AC-3), keeping its `next` and `as`. */
export function codeLogin(path: string): string {
  const url = new URL(path, 'http://e2e.invalid');
  url.searchParams.set('mode', 'code');
  return `${url.pathname}${url.search}`;
}

const submit = (page: Page) => page.locator('form button[type="submit"]');

/** On the code mode's phone step: types the number and sends until the code step shows. */
export async function requestCode(page: Page, phone: string) {
  // Auth restarts with the database reset, so the first send of a run can meet it down: send again. The number is
  // typed on each try: a link between the two modes is a client navigation, which can replace the field under a fill.
  await expect(async () => {
    if (await page.locator('#login-code').isVisible()) return;
    await page.locator('#login-phone').fill(phone);
    await expect(submit(page)).toBeEnabled();
    await submit(page).click();
    await expect(page.locator('#login-code')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

export async function typeCode(page: Page, code: string) {
  await page.locator('#login-code').pressSequentially(code);
}

function onPasswordStep(page: Page): boolean {
  return new URL(page.url()).pathname.endsWith('/account/password');
}

/**
 * Fills the password step (`/account/password`, a first or a reset password) and waits to leave it. The button is
 * live only after hydration, so the click is never a native submit.
 */
export async function setNewPassword(page: Page, password = TEST_PASSWORD) {
  await expect(submit(page)).toBeEnabled();
  await page.locator('#new-password').fill(password);
  await page.locator('#repeat-password').fill(password);
  await submit(page).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/account/password'), { timeout: 20_000 });
}

/**
 * A sign in by code from `path` (put in code mode here), to wherever `/continue` sends: onboarding for a new account,
 * the landing for one with a password. The password step, for an account with a role and none yet, is passed with
 * `TEST_PASSWORD`.
 */
export async function signIn(page: Page, locale: string, phone: string, path = `/${locale}/login`) {
  await page.goto(codeLogin(path));
  await requestCode(page, phone);
  await typeCode(page, TEST_CODE);
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 });
  if (onPasswordStep(page)) await setNewPassword(page);
}

/** Onboarding (spec 0005 AC-7) up to the password step it now leads to (spec 0012 AC-4). */
export async function submitOnboarding(page: Page, name: string) {
  await page.locator('#full-name').fill(name);
  const tick = page.locator('#agreement');
  // A click before hydration does nothing, so keep trying until the box answers.
  await expect(async () => {
    if ((await tick.getAttribute('data-state')) !== 'checked') await tick.click();
    await expect(tick).toHaveAttribute('data-state', 'checked', { timeout: 500 });
  }).toPass();
  await submit(page).click();
  await page.waitForURL((url) => url.pathname.endsWith('/account/password'), { timeout: 20_000 });
}

/** Onboarding, then the password step with `TEST_PASSWORD`, so the journey lands on the role's first stop as before. */
export async function onboard(page: Page, name: string) {
  await submitOnboarding(page, name);
  await setNewPassword(page);
}

/** The password mode of `/login` (spec 0012 AC-1). Leaves the page where the answer puts it. */
export async function fillPasswordSignIn(page: Page, phone: string, password: string) {
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(password);
  await expect(submit(page)).toBeEnabled();
  await submit(page).click();
}

/** A sign in by phone and password from `path`, to wherever `/continue` sends. */
export async function signInWithPassword(
  page: Page,
  locale: string,
  phone: string,
  password = TEST_PASSWORD,
  path = `/${locale}/login`,
) {
  await page.goto(path);
  await fillPasswordSignIn(page, phone, password);
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 });
}

/** Signs this device out from the account page (spec 0005 AC-19) and waits for the home page. */
export async function signOut(page: Page, locale: string) {
  await page.goto(`/${locale}/account`);
  await page.locator('#sign-out').click();
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
}
