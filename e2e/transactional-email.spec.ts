import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { TEST_CODE, testE164, testPhone } from './numbers';

/**
 * Spec 0011-13 AC-12 at 390px with axe in every locale, with the fake mail driver on the real local database.
 *
 * 1. A customer saves an email on the account page; the relay's `email` task (kicked through /api/relay, as pg_net
 *    does on a deployment) writes the confirmation to the fake driver's file; the link opens a signed in page whose
 *    one button confirms the address once; a second use is refused.
 * 2. With that customer and a provider whose address is confirmed by SQL, an offer, a choose and a paid commission
 *    (a commission of 0, which settles at once, D171) are driven through the database functions as each user, and
 *    write the expected templates to the expected people: in outbox_events, then in the fake file after a drain.
 */

test.use({ baseURL: `http://localhost:${process.env.E2E_PORT || 3100}` });

const SECRET = 'e2e-relay-secret-0000000000000000000000';
const MAIL_FILE = process.env.EMAIL_FAKE_FILE ?? '';

const CATALOGUES: Record<string, unknown> = Object.fromEntries(
  ['ar', 'tr', 'en'].map((l) => [
    l,
    JSON.parse(readFileSync(join(process.cwd(), 'messages', `${l}.json`), 'utf8')),
  ]),
);

function m(locale: string, path: string): string {
  let node: unknown = CATALOGUES[locale];
  for (const part of path.split('.')) node = (node as Record<string, unknown>)[part];
  if (typeof node !== 'string') throw new Error(`no message ${path}`);
  return node;
}

function sql(query: string): Record<string, unknown>[] {
  const file = join(tmpdir(), `asma-e2e-mail-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
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

function script(statements: string) {
  sql(`do $s$ begin ${statements} end $s$;`);
}

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0013000${kind}00${d}`;
  return {
    category: id('c1'),
    service: id('51'),
    zone: id('21'),
    request: id('e1'),
    offer: id('f1'),
    names: { service: `Posta hizmet ${locale}`, zone: `Posta semt ${locale}`, category: `Posta ${locale}` },
  };
}

const profileId = (locale: string, who: 'emailCustomer' | 'emailProvider') =>
  `(select id from public.profiles where phone = '${testE164(locale, who)}')`;

type Mail = {
  key: string;
  to: string;
  template: string;
  locale: string;
  subject: string;
  text: string;
  html: string;
};

function mails(): Mail[] {
  if (!MAIL_FILE || !existsSync(MAIL_FILE)) return [];
  return readFileSync(MAIL_FILE, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Mail);
}

async function drainMail(request: APIRequestContext) {
  const response = await request.post('/api/relay', {
    headers: { 'x-relay-secret': SECRET },
    data: { task: 'email' },
  });
  expect(response.status()).toBe(202);
}

/** Kicks the mail lane until a mail matching `match` is in the fake driver's file. */
async function waitForMail(request: APIRequestContext, match: (mail: Mail) => boolean): Promise<Mail> {
  let found: Mail | undefined;
  await expect(async () => {
    await drainMail(request);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    found = mails().find(match);
    expect(found).toBeDefined();
  }).toPass({ timeout: 60_000 });
  return found as Mail;
}

async function axe(page: Page) {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
}

async function signIn(page: Page, locale: string, phone: string, path = `/${locale}/login`) {
  await page.goto(path);
  await page.locator('#login-phone').fill(phone);
  const send = page.locator('form button[type="submit"]');
  await expect(async () => {
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.locator('#login-code')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await page.locator('#login-code').pressSequentially(TEST_CODE);
}

async function onboard(page: Page, name: string) {
  await page.locator('#full-name').fill(name);
  const tick = page.locator('#agreement');
  await expect(async () => {
    if ((await tick.getAttribute('data-state')) !== 'checked') await tick.click();
    await expect(tick).toHaveAttribute('data-state', 'checked', { timeout: 500 });
  }).toPass();
  await page.locator('form button[type="submit"]').click();
}

async function newPage(browser: Browser) {
  return (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
}

test('an address is confirmed once through its link, and a choose and a paid commission mail the right people', async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(360_000);
  const locale = testInfo.project.name;
  expect(MAIL_FILE, 'the e2e wrapper sets EMAIL_FAKE_FILE').not.toBe('');
  const customerAddress = `e2e13-c-${locale}@example.com`;
  const providerAddress = `e2e13-p-${locale}@example.com`;

  // ── 1. Save an address, take the link from the fake file, confirm once (AC-7). ──
  await signIn(page, locale, testPhone(locale, 'emailCustomer'));
  await onboard(page, 'Posta müşteri');
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  // Spec 0011-13 AC-4: no confirmed address while mail is on (the local seed), so My requests nudges.
  await page.goto(`/${locale}/requests`);
  await expect(page.getByRole('note')).toContainText(m(locale, 'Requests.emailBanner.text'));
  await axe(page);

  await page.goto(`/${locale}/account`);
  await page.locator('#account-email').fill(customerAddress);
  await page.getByRole('button', { name: m(locale, 'Account.save'), exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: m(locale, 'Account.saved') })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: m(locale, 'Account.emailSendLink') })).toBeVisible({
    timeout: 20_000,
  });
  await axe(page);

  const confirmation = await waitForMail(
    request,
    (mail) => mail.to === customerAddress && mail.template === 'confirm_email',
  );
  expect(confirmation.locale).toBe(locale);
  expect(confirmation.key).toMatch(/^email:confirm:[0-9a-f-]{36}$/);
  const link = /\/(ar|tr|en)\/account\/email\/confirm\?t=([A-Za-z0-9_-]{43})/.exec(confirmation.text);
  expect(link?.[1]).toBe(locale);
  // The token never outlives its row (R-9): the drained row no longer holds it.
  expect(
    sql(
      `select (payload ? 'token') as has_token, status from public.outbox_events where idempotency_key = '${confirmation.key}';`,
    ),
  ).toEqual([{ has_token: false, status: 'done' }]);

  // Opening the link changes nothing; the one button does (a scanner's GET confirms no address).
  await page.goto(link?.[0] ?? '');
  await expect(page.getByRole('button', { name: m(locale, 'Account.confirm.button') })).toBeVisible();
  expect(
    sql(
      `select email_confirmed_at is null as unconfirmed from public.profiles where id = ${profileId(locale, 'emailCustomer')};`,
    ),
  ).toEqual([{ unconfirmed: true }]);
  await axe(page);
  await page.getByRole('button', { name: m(locale, 'Account.confirm.button') }).click();
  await expect(page.getByRole('status')).toContainText(m(locale, 'Account.confirm.done'));
  await axe(page);

  // A second use is refused.
  await page.goto(link?.[0] ?? '');
  await page.getByRole('button', { name: m(locale, 'Account.confirm.button') }).click();
  await expect(page.locator('main [role="alert"]')).toContainText(
    m(locale, 'Account.confirm.errors.link_used'),
  );
  await axe(page);

  await page.goto(`/${locale}/account`);
  await expect(page.locator('main')).toContainText(m(locale, 'Account.emailConfirmed'));
  await page.goto(`/${locale}/requests`);
  await expect(page.getByRole('note')).toHaveCount(0);

  // ── 2. An offer, a choose and a paid commission, each mailed to the right person (AC-3, AC-8). ──
  const providerPage = await newPage(browser);
  await signIn(providerPage, locale, testPhone(locale, 'emailProvider'), `/${locale}/login?as=provider`);
  await onboard(providerPage, `Posta Usta ${locale}`);
  await expect(providerPage).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  await providerPage.context().close();

  const f = ids(locale);
  const snapshot = JSON.stringify({
    price: 300000,
    currency: 'TRY',
    commission_percent: '0',
    rounding_minor: 100,
    breakdown: {
      base: 300000,
      modifiers: [],
      addons: [],
      zone: { id: f.zone, name: { tr: f.names.zone }, multiplier: '1.00' },
      unrounded: '300000',
      rounding_minor: 100,
    },
    service: { id: f.service, name: { tr: f.names.service }, category_name: { tr: f.names.category } },
  });
  // The address first, then its confirmation: the profile guard clears email_confirmed_at on an address change.
  script(
    `update public.providers set status = 'approved', approved_at = now(), approved_name = 'Posta Usta' where id = ${profileId(locale, 'emailProvider')};` +
      ` update public.profiles set email = '${providerAddress}' where id = ${profileId(locale, 'emailProvider')};` +
      ` update public.profiles set email_confirmed_at = now() where id = ${profileId(locale, 'emailProvider')};` +
      ` insert into public.service_categories (id, region, name, display_order, active) values ('${f.category}', 'TR', '{"tr": "${f.names.category}"}', 961, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${f.service}', '${f.category}', 'TR', '{"tr": "${f.names.service}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values ('${f.zone}', 'TR', '{"tr": "${f.names.zone}"}', 1.00, 961, true) on conflict (id) do nothing;` +
      ` insert into public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot, pricing_snapshot,` +
      ` fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)` +
      ` select '${f.request}', 'TR', ${profileId(locale, 'emailCustomer')}, gen_random_uuid(), '${f.service}', '${f.zone}', '{}', '[]',` +
      ` '${snapshot}', 300000, 0, 300000, 'TRY',` +
      ` ((now() at time zone 'Europe/Istanbul')::date + 3 + time '10:00') at time zone 'Europe/Istanbul',` +
      ` ((now() at time zone 'Europe/Istanbul')::date + 3 + time '13:00') at time zone 'Europe/Istanbul';` +
      ` insert into public.request_addresses (request_id, region, customer_id, line)` +
      ` select '${f.request}', 'TR', ${profileId(locale, 'emailCustomer')}, 'Moda Cad. No 5';` +
      ` insert into public.applications (id, region, request_id, provider_id, message) values` +
      ` ('${f.offer}', 'TR', '${f.request}', ${profileId(locale, 'emailProvider')}, 'I can start at ten with my own tools, two people.');` +
      ` perform set_config('request.jwt.claims', json_build_object('sub', ${profileId(locale, 'emailCustomer')}, 'role', 'authenticated')::text, true);` +
      ` perform public.choose_provider('${f.request}', '${f.offer}');` +
      ` perform public.pay_commission('${f.request}', '${locale}', null);`,
  );
  expect(sql(`select status from public.requests where id = '${f.request}';`)).toEqual([
    { status: 'COMMISSION_PAID' },
  ]);

  // The rows: one per recipient, keyed, no address in a payload (R-1, R-8).
  const rows = sql(
    `select o.payload ->> 'template' as template, case when o.payload ->> 'recipient_id' = (${profileId(locale, 'emailCustomer')})::text` +
      ` then 'customer' else 'provider' end as who, o.idempotency_key as key, (o.payload::text like '%@%') as has_address` +
      ` from public.outbox_events o where o.kind = 'email.send' and o.payload ->> 'request_id' = '${f.request}'` +
      ` order by 1, 2;`,
  ) as Array<{ template: string; who: string; key: string; has_address: boolean }>;
  expect(rows.map((r) => `${r.template}>${r.who}`)).toEqual([
    'chosen>provider',
    'commission_received>customer',
    'new_offer>customer',
    'pay_your_fee>provider',
  ]);
  expect(rows.every((r) => !r.has_address)).toBe(true);
  expect(rows.find((r) => r.template === 'new_offer')?.key).toBe(`email:offer:${f.offer}`);

  // After a drain, the fake file holds each one, at the right address, in each person's language. new_offer and
  // chosen no longer hold (the request moved on), so they end `condition`, unsent (R-8).
  for (const row of rows) {
    if (row.template === 'new_offer' || row.template === 'chosen') continue;
    const mail = await waitForMail(request, (candidate) => candidate.key === row.key);
    expect(mail.to).toBe(row.who === 'customer' ? customerAddress : providerAddress);
    expect(mail.locale).toBe(locale);
    expect(mail.html).toContain(`dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`);
    expect(mail.text).not.toContain('Moda Cad.');
    expect(mail.text).not.toContain('+90');
  }
  await expect
    .poll(
      async () => {
        // Kick again, so a row still claimed or pending when the loop above ended gets finished.
        await drainMail(request);
        return sql(
          `select string_agg(o.payload ->> 'template' || ':' || o.status || ':' || coalesce(o.last_error, '-'), ',' order by o.payload ->> 'template')` +
            ` as states from public.outbox_events o where o.kind = 'email.send' and o.payload ->> 'request_id' = '${f.request}';`,
        )[0]?.states;
      },
      { timeout: 60_000 },
    )
    .toBe('chosen:done:condition,commission_received:done:-,new_offer:done:condition,pay_your_fee:done:-');
  expect(
    mails()
      .filter((mail) => rows.some((r) => r.key === mail.key))
      .map((mail) => mail.template)
      .sort(),
  ).toEqual(['commission_received', 'pay_your_fee']);
});
