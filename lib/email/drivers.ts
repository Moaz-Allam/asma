import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';

import type { EmailDriver, OutgoingEmail, SendResult } from './types';

/**
 * The three drivers (spec 0011-13 R-4, R-11, AC-8). `off` sends nothing; `fake` appends one JSON line per mail
 * to a file the e2e wrapper names (an in memory record would not survive across server workers); `resend` posts
 * to Resend's REST API with the outbox key as the Idempotency-Key, so a retry never sends twice. Only the HTTP
 * status and Resend's error `name` ever leave a driver, never its message, which can quote the address.
 */

export const RESEND_URL = 'https://api.resend.com/emails';
export const EMAIL_CALL_TIMEOUT_MS = 15_000;

export function createOffDriver(): EmailDriver {
  return { name: 'off', send: async () => ({ outcome: 'email_off' }) };
}

export function createFakeDriver(file: string | undefined): EmailDriver {
  return {
    name: 'fake',
    send: async (mail: OutgoingEmail): Promise<SendResult> => {
      if (file === undefined) return { outcome: 'retry', detail: 'not_configured' };
      const line = JSON.stringify({
        id: `fake_${mail.key}`,
        key: mail.key,
        to: mail.to,
        from: 'fake@aldebyani.test',
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        template: mail.template,
        locale: mail.locale,
        // Spec 0011-20 AC-8: each attachment's name, size and SHA256, never its bytes.
        ...(mail.attachments && mail.attachments.length > 0
          ? {
              attachments: mail.attachments.map((file) => ({
                filename: file.filename,
                size: file.content.byteLength,
                sha256: createHash('sha256').update(file.content).digest('hex'),
              })),
            }
          : {}),
      });
      await appendFile(file, `${line}\n`, 'utf8');
      return { outcome: 'sent' };
    },
  };
}

/** `http_<status>:<name>`, the name only when it is a plain code (R-11). */
function detailOf(status: number, name: unknown): string {
  const code = typeof name === 'string' && /^[a-z0-9_]{1,60}$/.test(name) ? name : 'unknown';
  return `http_${status}:${code}`;
}

/** R-11: what each Resend answer means for the row. */
export function resendOutcome(status: number, name: unknown): SendResult {
  if (status >= 200 && status < 300) return { outcome: 'sent' };
  const detail = detailOf(status, name);
  // The key was used with another payload, so a mail already went (a template changed between two tries, R-7).
  if (status === 409 && name === 'invalid_idempotent_request') return { outcome: 'already_sent', detail };
  if (status === 409 || status === 429 || status >= 500) return { outcome: 'retry', detail };
  return { outcome: 'rejected', detail };
}

export type ResendOptions = {
  apiKey: string | undefined;
  from: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function createResendDriver(options: ResendOptions): EmailDriver {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? EMAIL_CALL_TIMEOUT_MS;
  return {
    name: 'resend',
    send: async (mail: OutgoingEmail): Promise<SendResult> => {
      // R-4: required only with this driver; without them the row waits (alerted when it runs out of tries).
      if (options.apiKey === undefined || options.from === undefined) {
        return { outcome: 'retry', detail: 'not_configured' };
      }
      let response: Response;
      try {
        response = await doFetch(RESEND_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            // AC-8: the outbox key, at most 256 characters and alive 24 hours at Resend (R-5).
            'Idempotency-Key': mail.key,
          },
          body: JSON.stringify({
            from: options.from,
            to: [mail.to],
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            // Spec 0011-20 AC-8: Resend takes each file as base64 content.
            ...(mail.attachments && mail.attachments.length > 0
              ? {
                  attachments: mail.attachments.map((file) => ({
                    filename: file.filename,
                    content: Buffer.from(file.content).toString('base64'),
                  })),
                }
              : {}),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        return { outcome: 'retry', detail: timedOut ? 'timeout' : 'network_error' };
      }
      let name: unknown;
      if (response.status < 200 || response.status >= 300) {
        try {
          name = ((await response.json()) as { name?: unknown } | null)?.name;
        } catch {
          name = undefined;
        }
      }
      return resendOutcome(response.status, name);
    },
  };
}
