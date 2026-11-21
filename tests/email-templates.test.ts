import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EMAIL_COLORS } from '@/lib/email/shell';
import { renderEmail } from '@/lib/email/templates';
import {
  EMAIL_LOCALES,
  EMAIL_TEMPLATES,
  type EmailLocale,
  type EmailTemplate,
  type SendContext,
} from '@/lib/email/types';
import { cleanValue, escapeHtml, VALUE_LIMIT } from '@/lib/email/values';

/**
 * Spec 0011-13 AC-2, AC-5, R-6, R-7, R-13: every template in ar, tr and en, rendered from hostile values. The
 * markup is escaped, direction marks and line breaks are gone, a long service name is clamped, Arabic is
 * `dir="rtl" lang="ar"`, every link is the origin, the locale and a path of ids, and nothing appears that the
 * values did not carry (no address, no other id).
 */

const ORIGIN = 'http://localhost:3100';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const FEE = '22222222-2222-4222-8222-222222222222';
const REPORT = '33333333-3333-4333-8333-333333333333';
const REPORT_TEMPLATES: ReadonlySet<EmailTemplate> = new Set([
  'report_received',
  'report_handled',
  'report_new_admin',
]);
const TOKEN = 'AbC_-'.repeat(8) + 'xyz';
const ADDRESS = 'person-13@example.com';
const HOSTILE = `<script>alert("x")</script> 'quoted' & \u202Eevil\u2066\u200F\nSubject: injected\r\n${'Ç'.repeat(300)}`;

const PROVIDER_TEMPLATES: ReadonlySet<EmailTemplate> = new Set([
  'chosen',
  'pay_your_fee',
  'job_completed',
  'pick_ended',
  'window_missed',
  'account_approved',
  'account_rejected',
  'account_suspended',
  'rating_received',
]);

function context(
  template: EmailTemplate,
  locale: EmailLocale,
  side: 'customer' | 'provider' | null,
): SendContext {
  return {
    status: 'send',
    template,
    email: ADDRESS,
    locale,
    region_locale: 'tr',
    timezone: 'Europe/Istanbul',
    values: {
      side,
      request_id: REQUEST,
      service: { tr: HOSTILE, en: HOSTILE, ar: HOSTILE },
      start_at: '2026-11-22T10:00:00+00:00',
      deadline: '2026-11-21T10:00:00+00:00',
      amount: 12345,
      currency: 'TRY',
      fee_id: FEE,
      carried: true,
      token: template === 'confirm_email' ? TOKEN : null,
      ...(REPORT_TEMPLATES.has(template) ? { report_id: REPORT, reason: 'poor_work' as const } : {}),
      ...(template === 'password_changed' ? { changed_at: '2026-11-20T09:30:00+00:00' } : {}),
      ...(template === 'rate_provider' ? { provider_name: HOSTILE } : {}),
    },
  };
}

const CASES = EMAIL_TEMPLATES.flatMap((template) =>
  EMAIL_LOCALES.flatMap((locale) => {
    const sides: Array<'customer' | 'provider' | null> =
      template === 'report_new_admin' || template === 'password_changed'
        ? [null]
        : PROVIDER_TEMPLATES.has(template)
          ? ['provider']
          : [
                'contacts_ready',
                'request_cancelled',
                'payment_too_late',
                'fee_refunded',
                'pay_window_closing',
                'report_received',
                'report_handled',
              ].includes(template)
            ? ['customer', 'provider']
            : ['customer'];
    return sides.map((side) => ({ template, locale, side }));
  }),
);

const HREF = new RegExp(
  `^${ORIGIN}/(ar|tr|en)/(requests/${REQUEST}|receipts/${FEE}|provider/applications|account|admin/reports/${REPORT}|account/email/confirm\\?t=${TOKEN}|login\\?mode=code&reset=1|provider/profile)$`,
);

describe('every template renders in every locale (AC-2)', () => {
  it.each(CASES)('$template in $locale for the $side', ({ template, locale, side }) => {
    const mail = renderEmail(context(template, locale, side), ORIGIN);

    // Escaped: no live markup from a value, quotes encoded.
    expect(mail.html).not.toMatch(/<script/i);
    expect(mail.html).not.toContain('alert("x")');
    expect(mail.subject + mail.text + mail.html).not.toMatch(
      /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/,
    );
    // No line break from a value: the subject is one line, and no value adds a header.
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text).not.toContain('\nSubject: injected');
    // Clamped to 120 characters.
    expect(mail.text).not.toContain('Ç'.repeat(VALUE_LIMIT));
    expect(mail.subject.length).toBeLessThanOrEqual(200);
    // Direction and language from the locale.
    expect(mail.html).toContain(`<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">`);
    // Western digits in all three locales (D52).
    expect(mail.text).not.toMatch(/[٠-٩۰-۹]/);
    // R-6: no address, and no id but the request, the fee and the token, each only inside a link.
    expect(mail.subject + mail.text + mail.html).not.toContain(ADDRESS);
    const hrefs = [...mail.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]?.replace(/&amp;/g, '&') ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(HREF);
    expect(new Set(hrefs).size).toBe(1);
    expect(mail.text).toContain(hrefs[0]);
  });
});

describe('the links and lines of AC-5', () => {
  const href = (
    template: EmailTemplate,
    side: 'customer' | 'provider' | null,
    over: Partial<SendContext['values']> = {},
  ) => {
    const base = context(template, 'en', side);
    const mail = renderEmail({ ...base, values: { ...base.values, ...over } }, ORIGIN);
    return /href="([^"]*)"/.exec(mail.html)?.[1] ?? '';
  };

  it('a customer links to the request, a provider to the applications, account mails to the account', () => {
    expect(href('new_offer', 'customer')).toBe(`${ORIGIN}/en/requests/${REQUEST}`);
    expect(href('chosen', 'provider')).toBe(`${ORIGIN}/en/provider/applications`);
    expect(href('contacts_ready', 'provider')).toBe(`${ORIGIN}/en/provider/applications`);
    expect(href('account_approved', 'provider')).toBe(`${ORIGIN}/en/account`);
  });

  it('a paid commission and a refunded fee link the receipt; without a fee row, the request', () => {
    expect(href('commission_received', 'customer')).toBe(`${ORIGIN}/en/receipts/${FEE}`);
    expect(href('commission_received', 'customer', { fee_id: null, amount: 0 })).toBe(
      `${ORIGIN}/en/requests/${REQUEST}`,
    );
    expect(href('fee_refunded', 'customer')).toBe(`${ORIGIN}/en/receipts/${FEE}`);
    expect(href('fee_refunded', 'customer', { fee_id: null })).toBe(`${ORIGIN}/en/requests/${REQUEST}`);
  });

  it('a new report links admin to the report; the reporter to their own page (spec 0011-14 X-10)', () => {
    expect(href('report_new_admin', null)).toBe(`${ORIGIN}/en/admin/reports/${REPORT}`);
    expect(href('report_received', 'customer')).toBe(`${ORIGIN}/en/requests/${REQUEST}`);
    expect(href('report_handled', 'provider')).toBe(`${ORIGIN}/en/provider/applications`);
  });

  it('a changed password links the reset by code and says when, in the region time zone (spec 0012 AC-10)', () => {
    expect(href('password_changed', null, { request_id: null })).toBe(
      `${ORIGIN}/en/login?mode=code&amp;reset=1`,
    );
    const base = context('password_changed', 'en', null);
    const mail = renderEmail({ ...base, values: { ...base.values, request_id: null } }, ORIGIN);
    expect(mail.text).toContain('12:30');
    expect(mail.text).toContain('SMS code');
  });

  it('the rating invite links the request; the new rating notice links the profile, with no score (spec 0011-17 AC-9)', () => {
    expect(href('rate_provider', 'customer')).toBe(`${ORIGIN}/en/requests/${REQUEST}`);
    expect(href('rating_received', 'provider')).toBe(`${ORIGIN}/en/provider/profile`);
    const invite = context('rate_provider', 'en', 'customer');
    const named = renderEmail(
      { ...invite, values: { ...invite.values, provider_name: 'Ayşe Y.' } },
      ORIGIN,
    ).text;
    expect(named).toContain('Ayşe Y.');
    expect(named).toContain('You can rate until');
    expect(named).toContain('changes nothing about any payment');
    const unnamed = renderEmail(
      { ...invite, values: { ...invite.values, provider_name: null, deadline: null } },
      ORIGIN,
    ).text;
    expect(unnamed).not.toMatch(/with\s*is closed/);
    expect(unnamed).toContain('is closed. You can rate it if you like.');
    expect(unnamed).not.toContain('You can rate until');
    const notice = renderEmail(context('rating_received', 'en', 'provider'), ORIGIN);
    expect(notice.text).not.toMatch(/[1-5] of 5|★/);
  });

  it('the confirmation links the confirm page with the token', () => {
    expect(href('confirm_email', null, { token: TOKEN, request_id: null })).toBe(
      `${ORIGIN}/en/account/email/confirm?t=${TOKEN}`,
    );
  });

  it('optional lines appear only with their value', () => {
    const lines = (template: EmailTemplate, over: Partial<SendContext['values']>) => {
      const base = context(template, 'en', 'customer');
      return renderEmail({ ...base, values: { ...base.values, ...over } }, ORIGIN).text;
    };
    expect(lines('pick_again', { carried: true })).toContain('do not pay it again');
    expect(lines('pick_again', { carried: false })).not.toContain('do not pay it again');
    expect(lines('please_confirm', { deadline: null })).not.toContain('closes by itself');
    expect(lines('request_cancelled', { amount: null })).not.toContain('refunding');
    expect(lines('request_cancelled', { amount: 10000 })).toContain('refunding');
    expect(lines('commission_received', { amount: 0, fee_id: null })).toContain('No commission is due');
    expect(lines('commission_received', { amount: 10000 })).not.toContain('No commission is due');
  });

  it('refuses a mail whose link has no id, rather than sending a broken link', () => {
    const base = context('new_offer', 'en', 'customer');
    expect(() => renderEmail({ ...base, values: { ...base.values, request_id: null } }, ORIGIN)).toThrow(
      'request_id_missing',
    );
    const confirm = context('confirm_email', 'en', null);
    expect(() => renderEmail({ ...confirm, values: { ...confirm.values, token: null } }, ORIGIN)).toThrow(
      'token_missing',
    );
  });
});

describe('the value helpers', () => {
  it('cleanValue removes direction marks and line breaks and clamps', () => {
    expect(cleanValue('a\u202Eb\u2066c\nd\r\ne')).toBe('abc d e');
    expect(Array.from(cleanValue('x'.repeat(500))).length).toBe(VALUE_LIMIT);
  });

  it('escapeHtml encodes the five characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('the shell colours are the tokens (ui-tokens.md §2)', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const ramp = (name: string) =>
    new RegExp(`--ramp-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)?.[1]?.toLowerCase();

  it.each([
    ['primary', 'primary-900'],
    ['body', 'ink-800'],
    ['muted', 'ink-500'],
    ['page', 'primary-50'],
    ['border', 'primary-150'],
    ['surface', 'white'],
  ] as const)('%s is --ramp-%s', (key, name) => {
    expect(EMAIL_COLORS[key]).toBe(ramp(name));
  });
});
