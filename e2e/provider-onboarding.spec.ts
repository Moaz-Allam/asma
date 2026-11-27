import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Browser, Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { onboard, signIn } from './auth';
import { testE164, testPhone, type NUMBER } from './numbers';

/**
 * Spec 0006 AC-28 at 390px in every locale, against the real local Auth, database and Storage: a provider
 * signs up, a bio with a phone is refused, real fixture files upload, admin shows a file and rejects one
 * document, the provider replaces it and resubmits, admin approves, a replaced document returns the file to
 * review. A second journey suspends and lifts; a third keeps a customer out. Each project has its own
 * admin and its own provider names, because one queue is shared and projects run in parallel. No test
 * counts the whole queue.
 */

const CATALOGUES: Record<string, unknown> = Object.fromEntries(
  ['ar', 'tr', 'en'].map((l) => [
    l,
    JSON.parse(readFileSync(join(process.cwd(), 'messages', `${l}.json`), 'utf8')),
  ]),
);
const FILES = join(process.cwd(), 'e2e', 'files');

/** A catalogue string, with `{name}` placeholders filled. */
function m(locale: string, path: string, vars: Record<string, string> = {}): string {
  let node: unknown = CATALOGUES[locale];
  for (const part of path.split('.')) node = (node as Record<string, unknown>)[part];
  if (typeof node !== 'string') throw new Error(`no message ${path}`);
  return node.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

function sql(query: string): string {
  // One command string: on Windows the shell would split a query passed as an argument at its spaces.
  // Two projects may call the CLI at the same moment, and it can fail on its own temp files: retry.
  let last = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const run = spawnSync(`npx supabase db query --local "${query.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      shell: true,
    });
    if (run.status === 0) return run.stdout;
    last = run.stderr;
  }
  throw new Error(`db query failed: ${last}`);
}

async function axe(page: Page) {
  // Each caller waits for its form or review state. Give its transitions two frames to start before scanning.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished),
    ),
  );
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
}

/** AC-27: no horizontal overflow at 360, 390, 430 and 1280 px, then back to the phone width. */
async function noOverflow(page: Page) {
  for (const width of [360, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    // clientWidth, not innerWidth: innerWidth counts a vertical scrollbar (up to 15 px) and hid a real 9 px overflow.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

async function newProvider(page: Page, locale: string, test: keyof typeof NUMBER, name: string) {
  await signIn(page, locale, testPhone(locale, test), `/${locale}/login?as=provider`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding\\?as=provider$`), { timeout: 20_000 });
  await onboard(page, name);
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
}

/** An admin of this project: signed up for real, promoted with SQL, signed in again for a fresh token. */
async function newAdmin(browser: Browser, locale: string, test: keyof typeof NUMBER): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, locale, testPhone(locale, test));
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding$`), { timeout: 20_000 });
  await onboard(page, `Admin ${locale}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  sql(`select public.promote_to_admin('${testE164(locale, test)}')`);
  await context.clearCookies();
  await signIn(page, locale, testPhone(locale, test));
  await expect(page).toHaveURL(new RegExp(`/${locale}/admin$`), { timeout: 20_000 });
  return page;
}

/** Uploads into one file input and waits until its button no longer says upload or uploading. */
async function upload(page: Page, label: string, file: string) {
  const input = page.locator(`input[type="file"][aria-label="${label}"]`);
  await expect(input).toBeEnabled();
  const button = input.locator('xpath=following-sibling::button[1]');
  const before = await button.textContent();
  await input.setInputFiles(join(FILES, file));
  await expect(button).not.toHaveText(before ?? '', { timeout: 20_000 });
  await expect(button).toBeEnabled({ timeout: 20_000 });
}

function card(page: Page, title: string): Locator {
  return page.locator('li', { has: page.getByRole('heading', { name: title, exact: true }) });
}

async function fillStepOne(page: Page, locale: string, bio: string) {
  await page.locator('label', { has: page.locator('input[name="entityType"][value="individual"]') }).click();
  await page.locator('#years').fill('6');
  await page.locator('#bio').fill(bio);
  const turkish = page.locator('input[name="languages"][value="tr"]');
  if (!(await turkish.isChecked())) await page.locator('label', { has: turkish }).click();
  await page.getByRole('button', { name: m(locale, 'ProviderForm.save') }).click();
}

test('a provider is reviewed, rejected, fixed and approved, then a replaced document returns the file to review', async ({
  page,
  browser,
  telemetry,
}, testInfo) => {
  test.setTimeout(300_000);
  const locale = testInfo.project.name;
  const name = `Usta ${locale} Onboarding`;

  await newProvider(page, locale, 'onboarding', name);
  // Scan once hydrated: before that the Save button is disabled and faded on purpose.
  await expect(page.getByRole('button', { name: m(locale, 'ProviderForm.save') })).toBeEnabled();
  await axe(page);
  await noOverflow(page);

  // A bio with a spelled phone is refused, by the database (AC-3).
  await page
    .locator(`input[type="file"][aria-label="${m(locale, 'ProviderForm.photoTitle')}"]`)
    .setInputFiles(join(FILES, 'photo.jpg'));
  await expect(page.getByRole('button', { name: m(locale, 'ProviderForm.photoReplace') })).toBeVisible({
    timeout: 20_000,
  });
  await fillStepOne(
    page,
    locale,
    'Ev temizliği yapıyorum, sıfır beş beş beş bir iki üç dört diye arayın lütfen.',
  );
  await expect(page.getByText(m(locale, 'ProviderErrors.contact_info_in_bio'))).toBeVisible();
  await fillStepOne(
    page,
    locale,
    'Ev ve ofis temizliğinde altı yıllık deneyimim var, malzemelerimi getiririm.',
  );
  // Spec 0011-20b AC-5, X-13: step 2 is the provider's own address, typed (the map is optional).
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider/profile/address$`), { timeout: 20_000 });
  await page.locator('#provider-address-il').fill('İstanbul');
  await page.locator('#provider-address-ilce').fill('Kadıköy');
  await page.locator('#provider-address-mahalle').fill('Rasimpaşa');
  await page.locator('#provider-address-street').fill('Rıhtım Cad.');
  await page.getByRole('button', { name: m(locale, 'Address.provider.save') }).click();
  // The browser names the missing building number before anything is sent.
  await expect(page.getByText(m(locale, 'Address.errors.required'))).toBeVisible();
  await page.locator('#provider-address-building_no').fill('3');
  await expect(page.getByRole('button', { name: m(locale, 'Address.provider.save') })).toBeEnabled();
  await axe(page);
  await noOverflow(page);
  await page.getByRole('button', { name: m(locale, 'Address.provider.save') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider/profile/documents$`), { timeout: 20_000 });

  // Step 3: the cards wait for the consent (AC-6).
  const front = m(locale, 'ProviderDocs.id.id_front');
  await expect(page.locator(`input[type="file"][aria-label="${front}"]`)).toBeDisabled();
  await page.locator('#docs-consent').click();
  await upload(page, front, 'id-front.jpg');
  await upload(page, m(locale, 'ProviderDocs.id.id_back'), 'id-back.png');
  await upload(page, m(locale, 'ProviderDocs.selfie.title'), 'selfie.jpg');
  // A renamed text file is refused in the browser (AC-7).
  await page
    .locator(`input[type="file"][aria-label="${m(locale, 'ProviderDocs.criminal_record.title')}"]`)
    .setInputFiles(join(FILES, 'not-a-pdf.pdf'));
  await expect(page.getByText(m(locale, 'ProviderErrors.file_type_refused'))).toBeVisible();
  await upload(page, m(locale, 'ProviderDocs.criminal_record.title'), 'record.pdf');
  await expect(page.getByRole('button', { name: m(locale, 'ProviderDocs.submit') })).toBeEnabled();
  await axe(page);
  await noOverflow(page);
  await page.getByRole('button', { name: m(locale, 'ProviderDocs.submit') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider$`), { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: m(locale, 'Provider.home.pending.title') })).toBeVisible();

  // Admin shows the selfie, rejects it with a reason, and rejects the file (AC-16 to AC-18).
  const admin = await newAdmin(browser, locale, 'admin');
  await admin.goto(`/${locale}/admin/providers`);
  await admin.getByRole('link', { name: new RegExp(name) }).click();
  const selfieTitle = m(locale, 'ProviderDocs.missing.selfie');
  const selfie = card(admin, selfieTitle);
  const showSelfie = selfie.getByRole('button', {
    name: m(locale, 'AdminReview.show', { what: selfieTitle }),
  });
  await expect(showSelfie).toBeEnabled();
  await axe(admin);
  await noOverflow(admin);
  await showSelfie.click();
  await expect(selfie.locator('img')).toBeVisible();
  await selfie.getByRole('button', { name: m(locale, 'Rejection.document_unclear') }).click();
  await selfie.getByRole('button', { name: m(locale, 'AdminReview.reject') }).click();
  await expect(selfie.getByText(m(locale, 'AdminReview.docStatus.rejected'), { exact: true })).toBeVisible();
  await admin.getByRole('button', { name: m(locale, 'AdminReview.rejectFile') }).click();
  await expect(
    admin.locator('article header').getByText(m(locale, 'Provider.standing.rejected'), { exact: true }),
  ).toBeVisible();

  // The provider sees why, replaces the selfie and resubmits (AC-8, AC-9, AC-10).
  await page.reload();
  await expect(page.getByText(m(locale, 'Rejection.document_unclear')).first()).toBeVisible();
  await page.goto(`/${locale}/provider/profile/documents`);
  await upload(page, m(locale, 'ProviderDocs.selfie.title'), 'selfie.jpg');
  await page.getByRole('button', { name: m(locale, 'ProviderDocs.submit') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider$`), { timeout: 20_000 });

  // Admin shows and matches everything, then approves.
  await admin.reload();
  const inYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  for (const [title, shows, dated] of [
    [m(locale, 'AdminReview.idTitle'), ['id_front', 'id_back'], 'id'],
    [m(locale, 'ProviderDocs.missing.profile_photo'), ['profile_photo'], null],
    [selfieTitle, ['selfie'], null],
    [m(locale, 'ProviderDocs.missing.criminal_record'), ['criminal_record'], 'criminal_record'],
  ] as const) {
    const box = card(admin, title);
    for (const type of shows) {
      await box
        .getByRole('button', {
          name: m(locale, 'AdminReview.show', { what: m(locale, `ProviderDocs.missing.${type}`) }),
        })
        .click();
    }
    if (dated) await box.locator(`#valid-${dated}`).fill(inYear);
    await box.getByRole('button', { name: m(locale, 'AdminReview.match') }).click();
    await expect(box.getByText(m(locale, 'AdminReview.docStatus.approved'), { exact: true })).toBeVisible();
  }
  await admin.getByRole('button', { name: m(locale, 'AdminReview.approve') }).click();
  await expect(
    admin.locator('article header').getByText(m(locale, 'Provider.standing.approved'), { exact: true }),
  ).toBeVisible();

  // The provider is approved; replacing a document asks first and returns the file to review (AC-12).
  await page.reload();
  await expect(
    page.locator('header').first().getByText(m(locale, 'Provider.standing.approved'), { exact: true }),
  ).toBeVisible();
  await page.goto(`/${locale}/provider/profile/documents`);
  const selfieInput = page.locator(
    `input[type="file"][aria-label="${m(locale, 'ProviderDocs.selfie.title')}"]`,
  );
  await selfieInput.setInputFiles(join(FILES, 'selfie.jpg'));
  await page.getByRole('button', { name: m(locale, 'ProviderForm.confirmReplace') }).click();
  await expect(
    page.locator('header').first().getByText(m(locale, 'Provider.standing.pending'), { exact: true }),
  ).toBeVisible({
    timeout: 20_000,
  });

  // Nothing personal or a link to an object reached telemetry (AC-24), and no CSP violation fired (AC-25).
  const payloads = JSON.stringify([telemetry.sentry, telemetry.posthog]);
  expect(payloads).not.toContain(name);
  expect(payloads).not.toContain('/storage/v1/object/sign');
  expect(payloads).not.toMatch(/profile_photo\/|id_front\/|selfie\//);
  expect(await telemetry.cspViolations()).toEqual([]);
  await admin.context().close();
});

test('admin suspends and lifts an approved provider', async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const locale = testInfo.project.name;
  const name = `Usta ${locale} Suspended`;
  await newProvider(page, locale, 'suspended', name);
  sql(
    `update public.providers set status = 'approved', approved_at = now(), decided_at = now() where id = (select id from public.profiles where phone = '${testE164(locale, 'suspended')}')`,
  );

  const admin = await newAdmin(browser, locale, 'reviewer');
  await admin.goto(`/${locale}/admin/providers?tab=approved&sort=newest`);
  await admin.getByRole('link', { name: new RegExp(name) }).click();
  await admin.getByRole('button', { name: m(locale, 'AdminReview.suspend') }).click();
  await admin.locator('#suspend-reason').fill('Repeated complaints from customers');
  await admin.getByRole('button', { name: m(locale, 'AdminReview.suspendConfirm') }).click();
  await expect(admin.getByText('Repeated complaints from customers')).toBeVisible();

  await page.goto(`/${locale}/provider`);
  await expect(page.getByRole('heading', { name: m(locale, 'Provider.home.suspended.title') })).toBeVisible();
  await expect(page.getByText('Repeated complaints from customers')).toBeVisible();
  await axe(page);

  await admin.getByRole('button', { name: m(locale, 'AdminReview.lift') }).click();
  await admin.getByRole('button', { name: m(locale, 'AdminReview.liftConfirm') }).click();
  await expect(admin.getByRole('button', { name: m(locale, 'AdminReview.suspend') })).toBeVisible();
  await page.reload();
  const chip = (standing: string) =>
    page
      .locator('header')
      .first()
      .getByText(m(locale, `Provider.standing.${standing}`), { exact: true });
  await expect(chip('approved')).toBeVisible();
  await admin.context().close();

  // AC-11: approved sees `p7`, with Edit.
  await page.goto(`/${locale}/provider/profile`);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByRole('link', { name: m(locale, 'Provider.view.edit') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider/profile\\?edit=1$`));

  // AC-12: the first save of the company fields is no change; switching to a company asks first.
  await fillStepOne(
    page,
    locale,
    'Ev ve ofis temizliğinde altı yıllık deneyimim var, malzemelerimi getiririm.',
  );
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  await expect(chip('approved')).toBeVisible();
  await page.goto(`/${locale}/provider/profile?edit=1`);
  await page.locator('label', { has: page.locator('input[name="entityType"][value="company"]') }).click();
  await page.locator('#legal-name').fill(`Usta ${locale} Temizlik Ltd`);
  await page.locator('#tax-number').fill('1234567890');
  await page.getByRole('button', { name: m(locale, 'ProviderForm.save') }).click();
  await expect(
    page.getByRole('heading', { name: m(locale, 'ProviderForm.confirmCompanyTitle') }),
  ).toBeVisible();
  await page.getByRole('button', { name: m(locale, 'ProviderForm.cancel') }).click();
  await page.reload();
  await expect(chip('approved')).toBeVisible();

  // AC-12 on /account: a rename asks first; cancel changes nothing, confirm returns the file to review.
  await page.goto(`/${locale}/account`);
  await page.locator('#account-name').fill(`${name} Yeni`);
  await page.getByRole('button', { name: m(locale, 'Account.save') }).click();
  await page.getByRole('button', { name: m(locale, 'Account.renameCancel') }).click();
  await page.goto(`/${locale}/provider`);
  await expect(chip('approved')).toBeVisible();
  await page.goto(`/${locale}/account`);
  await page.locator('#account-name').fill(`${name} Yeni`);
  await page.getByRole('button', { name: m(locale, 'Account.save') }).click();
  await page.getByRole('button', { name: m(locale, 'Account.renameConfirm') }).click();
  await expect(page.getByText(m(locale, 'Account.savedBackToReview'))).toBeVisible({ timeout: 20_000 });
  await page.goto(`/${locale}/provider`);
  await expect(chip('pending')).toBeVisible();
});

test('a customer never reaches the provider or admin pages', async ({ page }, testInfo) => {
  const locale = testInfo.project.name;
  await signIn(page, locale, testPhone(locale, 'gateCustomer'));
  await onboard(page, `Müşteri ${locale}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  await page.goto(`/${locale}/admin/providers`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`), { timeout: 20_000 });
  await page.goto(`/${locale}/provider`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`), { timeout: 20_000 });
  await page.goto(`/${locale}/provider/profile/documents`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`), { timeout: 20_000 });
});
