import { dirFor } from '@/lib/i18n/direction';

import type { EmailLocale } from './types';
import { escapeHtml } from './values';

/**
 * The one HTML shell every mail uses (spec 0011-13 R-13): a table layout and inline styles, because mail clients
 * read neither our stylesheet nor CSS variables. `dir` and `lang` come from the locale, so Arabic mail reads right
 * to left with no physical alignment anywhere. Every string is escaped here, the href included.
 */

// The token values of app/globals.css (ui-tokens.md §2), copied because a mail cannot read a CSS variable.
// tests/email-templates.test.ts proves each equals its ramp in globals.css.
export const EMAIL_COLORS = {
  // --color-text-primary, --color-accent: --ramp-primary-900
  primary: '#0f3a73',
  // --color-text-body: --ramp-ink-800
  body: '#2c3c5e',
  // --color-text-muted: --ramp-ink-500
  muted: '#6a7a97',
  // --color-surface-secondary: --ramp-primary-50
  page: '#f2f6fc',
  // --color-border: --ramp-primary-150
  border: '#e4ecf7',
  // --color-surface, --color-accent-foreground: --ramp-white
  surface: '#ffffff',
} as const;

const FONT = "-apple-system,'Segoe UI',Tahoma,Arial,sans-serif";

export type ShellInput = {
  locale: EmailLocale;
  subject: string;
  /** Plain text paragraphs, values already filled in. */
  lines: readonly string[];
  action: { label: string; href: string };
  linkHint: string;
  footer: string;
};

export function renderShell(input: ShellInput): { html: string; text: string } {
  const dir = dirFor(input.locale);
  const href = escapeHtml(input.action.href);
  const paragraphs = input.lines
    .map(
      (line) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${EMAIL_COLORS.body};">${escapeHtml(line)}</p>`,
    )
    .join('');
  const html =
    '<!doctype html>' +
    `<html lang="${input.locale}" dir="${dir}">` +
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(input.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${EMAIL_COLORS.page};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="background:${EMAIL_COLORS.page};">` +
    '<tr><td align="center" style="padding:24px 16px;">' +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:560px;background:${EMAIL_COLORS.surface};border:1px solid ${EMAIL_COLORS.border};border-radius:12px;">` +
    `<tr><td style="padding:24px;font-family:${FONT};">` +
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:28px;color:${EMAIL_COLORS.primary};">${escapeHtml(input.subject)}</h1>` +
    paragraphs +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr>' +
    `<td style="background:${EMAIL_COLORS.primary};border-radius:8px;">` +
    `<a href="${href}" style="display:inline-block;padding:12px 20px;font-size:16px;font-weight:600;color:${EMAIL_COLORS.surface};text-decoration:none;">${escapeHtml(input.action.label)}</a>` +
    '</td></tr></table>' +
    `<p style="margin:0 0 8px;font-size:13px;line-height:20px;color:${EMAIL_COLORS.muted};">${escapeHtml(input.linkHint)}</p>` +
    `<p style="margin:0 0 24px;font-size:13px;line-height:20px;word-break:break-all;"><a href="${href}" style="color:${EMAIL_COLORS.primary};">${href}</a></p>` +
    `<p style="margin:0;font-size:13px;line-height:20px;color:${EMAIL_COLORS.muted};">${escapeHtml(input.footer)}</p>` +
    '</td></tr></table>' +
    '</td></tr></table>' +
    '</body></html>';
  const text = [
    input.subject,
    '',
    ...input.lines.flatMap((line) => [line, '']),
    `${input.action.label}: ${input.action.href}`,
    '',
    input.footer,
  ].join('\n');
  return { html, text };
}
