import { createTranslator } from 'next-intl';

import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { localized } from '@/lib/catalog/localized';
import { formatMoney } from '@/lib/format/money';
import { instantLabel } from '@/lib/requests/view';

import { renderShell } from './shell';
import type { EmailLocale, EmailTemplate, RenderedEmail, SendContext } from './types';
import { cleanValue } from './values';

/**
 * One plain function per template (spec 0011-13 AC-2, R-6, R-7, R-13). Each builds its subject, its lines and its
 * one link from the values `email_context` returned and the catalogue strings under `Email.<template>`; the shell
 * escapes them. A mail says what happened and links to the page that shows it: no phone, no address, no notes, no
 * other party's name. Links are `appOrigin()` + `/<locale>` + a path with ids only (AC-5).
 */

const CATALOGUES = { ar, tr, en } as const;

export class EmailRenderError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'EmailRenderError';
  }
}

type Translate = (key: string, values?: Record<string, string>) => string;

type Parts = {
  t: Translate;
  /** The values a line may show, each already cleaned (bidi marks and line breaks removed, clamped). */
  vals: { service: string; start: string; deadline: string; amount: string; when: string; name: string };
  side: 'customer' | 'provider' | null;
  carried: boolean;
  hasRefund: boolean;
  hasDeadline: boolean;
  isFree: boolean;
  hasName: boolean;
  link: {
    request: () => { label: string; href: string };
    receiptOrRequest: () => { label: string; href: string };
    applications: () => { label: string; href: string };
    account: () => { label: string; href: string };
    reset: () => { label: string; href: string };
    confirm: () => { label: string; href: string };
    adminReport: () => { label: string; href: string };
    profile: () => { label: string; href: string };
  };
};

type Draft = { subject: string; lines: string[]; action: { label: string; href: string } };

/** The customer's page, or the provider's applications, by the recipient's side. */
function bySide(p: Parts): { label: string; href: string } {
  return p.side === 'provider' ? p.link.applications() : p.link.request();
}

const TEMPLATES: Readonly<Record<EmailTemplate, (p: Parts) => Draft>> = {
  new_offer: (p) => ({
    subject: p.t('new_offer.subject', p.vals),
    lines: [p.t('new_offer.lead', p.vals)],
    action: p.link.request(),
  }),
  chosen: (p) => ({
    subject: p.t('chosen.subject', p.vals),
    lines: [p.t('chosen.lead', p.vals)],
    action: p.link.applications(),
  }),
  pay_your_fee: (p) => ({
    subject: p.t('pay_your_fee.subject', p.vals),
    lines: [p.t('pay_your_fee.lead', p.vals)],
    action: p.link.applications(),
  }),
  commission_received: (p) => ({
    subject: p.t('commission_received.subject', p.vals),
    // A commission of 0 (D171) is no amount to announce.
    lines: [p.t(p.isFree ? 'commission_received.leadFree' : 'commission_received.lead', p.vals)],
    action: p.link.receiptOrRequest(),
  }),
  contacts_ready: (p) => ({
    subject: p.t('contacts_ready.subject', p.vals),
    lines: [
      p.t(p.side === 'provider' ? 'contacts_ready.leadProvider' : 'contacts_ready.leadCustomer', p.vals),
    ],
    action: bySide(p),
  }),
  job_started: (p) => ({
    subject: p.t('job_started.subject', p.vals),
    lines: [p.t('job_started.lead', p.vals)],
    action: p.link.request(),
  }),
  please_confirm: (p) => ({
    subject: p.t('please_confirm.subject', p.vals),
    lines: [
      p.t('please_confirm.lead', p.vals),
      ...(p.hasDeadline ? [p.t('please_confirm.deadline', p.vals)] : []),
    ],
    action: p.link.request(),
  }),
  job_completed: (p) => ({
    subject: p.t('job_completed.subject', p.vals),
    lines: [p.t('job_completed.lead', p.vals)],
    action: p.link.applications(),
  }),
  request_cancelled: (p) => ({
    subject: p.t('request_cancelled.subject', p.vals),
    lines:
      p.side === 'provider'
        ? [p.t('request_cancelled.leadProvider', p.vals)]
        : [
            p.t('request_cancelled.leadCustomer', p.vals),
            ...(p.hasRefund ? [p.t('request_cancelled.refund', p.vals)] : []),
          ],
    action: bySide(p),
  }),
  pick_again: (p) => ({
    subject: p.t('pick_again.subject', p.vals),
    lines: [p.t('pick_again.lead', p.vals), ...(p.carried ? [p.t('pick_again.carried', p.vals)] : [])],
    action: p.link.request(),
  }),
  pick_ended: (p) => ({
    subject: p.t('pick_ended.subject', p.vals),
    lines: [p.t('pick_ended.lead', p.vals)],
    action: p.link.applications(),
  }),
  window_missed: (p) => ({
    subject: p.t('window_missed.subject', p.vals),
    lines: [p.t('window_missed.lead', p.vals)],
    action: p.link.applications(),
  }),
  payment_too_late: (p) => ({
    subject: p.t('payment_too_late.subject', p.vals),
    lines: [p.t('payment_too_late.lead', p.vals)],
    // D192: a late refund has no receipt, so the customer's link is the request.
    action: bySide(p),
  }),
  fee_refunded: (p) => ({
    subject: p.t('fee_refunded.subject', p.vals),
    lines: [p.t('fee_refunded.lead', p.vals)],
    action: p.side === 'provider' ? p.link.applications() : p.link.receiptOrRequest(),
  }),
  confirm_email: (p) => ({
    subject: p.t('confirm_email.subject', p.vals),
    lines: [p.t('confirm_email.lead', p.vals), p.t('confirm_email.ignore', p.vals)],
    action: p.link.confirm(),
  }),
  account_approved: (p) => ({
    subject: p.t('account_approved.subject', p.vals),
    lines: [p.t('account_approved.lead', p.vals)],
    action: p.link.account(),
  }),
  account_rejected: (p) => ({
    subject: p.t('account_rejected.subject', p.vals),
    lines: [p.t('account_rejected.lead', p.vals)],
    action: p.link.account(),
  }),
  account_suspended: (p) => ({
    subject: p.t('account_suspended.subject', p.vals),
    lines: [p.t('account_suspended.lead', p.vals)],
    action: p.link.account(),
  }),
  pay_window_closing: (p) => ({
    subject: p.t(
      p.side === 'provider' ? 'pay_window_closing.subjectProvider' : 'pay_window_closing.subjectCustomer',
      p.vals,
    ),
    lines: [
      p.t(
        p.side === 'provider' ? 'pay_window_closing.leadProvider' : 'pay_window_closing.leadCustomer',
        p.vals,
      ),
    ],
    action: bySide(p),
  }),
  closes_soon: (p) => ({
    subject: p.t('closes_soon.subject', p.vals),
    lines: [p.t('closes_soon.lead', p.vals)],
    action: p.link.request(),
  }),
  // Spec 0011-14 R-8, X-11: what happened, never the outcome or the other party; the reporter's own page.
  report_received: (p) => ({
    subject: p.t('report_received.subject', p.vals),
    lines: [p.t('report_received.lead', p.vals)],
    action: bySide(p),
  }),
  report_handled: (p) => ({
    subject: p.t('report_handled.subject', p.vals),
    lines: [p.t('report_handled.lead', p.vals)],
    action: bySide(p),
  }),
  report_new_admin: (p) => ({
    subject: p.t('report_new_admin.subject', p.vals),
    lines: [p.t('report_new_admin.lead', p.vals)],
    action: p.link.adminReport(),
  }),
  // Spec 0012 AC-10: what changed and when; if it was not them, a reset by SMS code and support.
  password_changed: (p) => ({
    subject: p.t('password_changed.subject', p.vals),
    lines: [p.t('password_changed.lead', p.vals), p.t('password_changed.notYou', p.vals)],
    action: p.link.reset(),
  }),
  // Spec 0011-17 AC-9: the invite after an auto or admin close, to the request page where the form is; optional.
  rate_provider: (p) => ({
    subject: p.t('rate_provider.subject', p.vals),
    lines: [
      p.t(p.hasName ? 'rate_provider.lead' : 'rate_provider.leadNoName', p.vals),
      ...(p.hasDeadline ? [p.t('rate_provider.until', p.vals)] : []),
      p.t('rate_provider.optional', p.vals),
    ],
    action: { ...p.link.request(), label: p.t('rate_provider.action') },
  }),
  // Spec 0011-17 AC-9: only that a rating arrived; no score, no customer, no request.
  rating_received: (p) => ({
    subject: p.t('rating_received.subject', p.vals),
    lines: [p.t('rating_received.lead', p.vals)],
    action: p.link.profile(),
  }),
};

function translator(locale: EmailLocale): Translate {
  const t = createTranslator({
    locale,
    messages: CATALOGUES[locale],
    namespace: 'Email',
    // A missing string or value is a bug, never a silent fallback in a real mail.
    onError: (error) => {
      throw new EmailRenderError(`catalogue:${error.code}`);
    },
  });
  return t as unknown as Translate;
}

/** Renders one mail from `email_context`'s answer. `origin` is `appOrigin()`, handed in so this stays pure. */
export function renderEmail(context: SendContext, origin: string): RenderedEmail {
  const { values, locale } = context;
  const t = translator(locale);
  const base = `${origin}/${locale}`;
  const needs = <T>(value: T | null, code: string): T => {
    if (value === null) throw new EmailRenderError(code);
    return value;
  };
  const amount =
    values.amount !== null && values.currency !== null
      ? formatMoney(values.amount, values.currency, locale)
      : '';
  const parts: Parts = {
    t,
    vals: {
      service: cleanValue(localized(values.service, locale, context.region_locale)),
      start:
        values.start_at === null ? '' : cleanValue(instantLabel(values.start_at, context.timezone, locale)),
      deadline:
        values.deadline === null ? '' : cleanValue(instantLabel(values.deadline, context.timezone, locale)),
      amount: cleanValue(amount),
      when:
        values.changed_at === undefined || values.changed_at === null
          ? ''
          : cleanValue(instantLabel(values.changed_at, context.timezone, locale)),
      name: cleanValue(values.provider_name ?? ''),
    },
    side: values.side,
    carried: values.carried === true,
    hasRefund: values.amount !== null && values.amount > 0,
    hasDeadline: values.deadline !== null,
    isFree: values.amount === 0,
    hasName: (values.provider_name ?? '').trim().length > 0,
    link: {
      request: () => ({
        label: t('shell.openRequest'),
        href: `${base}/requests/${needs(values.request_id, 'request_id_missing')}`,
      }),
      receiptOrRequest: () =>
        values.fee_id !== null
          ? { label: t('shell.openReceipt'), href: `${base}/receipts/${values.fee_id}` }
          : {
              label: t('shell.openRequest'),
              href: `${base}/requests/${needs(values.request_id, 'request_id_missing')}`,
            },
      applications: () => ({ label: t('shell.openApplications'), href: `${base}/provider/applications` }),
      account: () => ({ label: t('shell.openAccount'), href: `${base}/account` }),
      reset: () => ({ label: t('password_changed.action'), href: `${base}/login?mode=code&reset=1` }),
      confirm: () => ({
        label: t('confirm_email.action'),
        href: `${base}/account/email/confirm?t=${encodeURIComponent(needs(values.token, 'token_missing'))}`,
      }),
      adminReport: () => ({
        label: t('report_new_admin.action'),
        href: `${base}/admin/reports/${needs(values.report_id ?? null, 'report_id_missing')}`,
      }),
      profile: () => ({ label: t('rating_received.action'), href: `${base}/provider/profile` }),
    },
  };
  const draft = TEMPLATES[context.template](parts);
  const subject = cleanValue(draft.subject, 200);
  const { html, text } = renderShell({
    locale,
    subject,
    lines: draft.lines,
    action: draft.action,
    linkHint: t('shell.linkHint'),
    footer: t('shell.footer'),
  });
  return { subject, text, html };
}
