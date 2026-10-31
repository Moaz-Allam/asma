import 'server-only';

import {
  captureException,
  captureRequestError as sentryCaptureRequestError,
  flush,
  init,
} from '@sentry/nextjs';
import type { Instrumentation } from 'next';
import { after } from 'next/server';

import { appEnv, appRelease } from '@/lib/deployment';
import { sentryDsn } from '@/lib/env';
import {
  ALLOWED_REQUEST_HEADERS,
  scrubBreadcrumb,
  scrubEvent,
  scrubLog,
  scrubSpan,
  scrubUrl,
} from '@/lib/observability/scrub';
import { TELEMETRY_SPAN_NAMES, tracesSampleRate } from '@/lib/observability/shared';

/**
 * The server side of the Sentry door (spec 0004 AC-1, AC-3, AC-5, AC-8). Node only: the proxy runs on
 * Node and no route uses the edge runtime, so there is no edge init.
 *
 * Every function swallows its own failures: observability never breaks a request.
 */

export const FLUSH_TIMEOUT_MS = 2000;

let started = false;

/** Runs once from register() in instrumentation.ts, after the environment checks. On only with a DSN. */
export function initServer(): void {
  const dsn = sentryDsn();
  if (started || !dsn) return;
  started = true;
  try {
    init(serverOptions(dsn));
  } catch (error) {
    console.error('[observability] Sentry did not start', error instanceof Error ? error.name : 'unknown');
  }
}

/** Everything `init` gets, built apart so the tests can read it (AC-1, AC-3, AC-5). */
export function serverOptions(dsn: string): Parameters<typeof init>[0] {
  const environment = appEnv(process.env);
  const rate = tracesSampleRate(environment);
  return {
    dsn,
    environment,
    release: appRelease(process.env),
    sendDefaultPii: false,
    includeLocalVariables: false,
    // Our own rate, whatever an incoming `sentry-trace` header asks: a caller cannot force sampling
    // and spend the span quota (review 2026-10-29). Our browser never sends that header to us.
    tracesSampler: () => rate,
    tracePropagationTargets: [],
    enableLogs: true,
    ignoreTransactions: TELEMETRY_SPAN_NAMES,
    ignoreSpans: TELEMETRY_SPAN_NAMES,
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeSendSpan: (span) => scrubSpan(span),
    beforeSendLog: (log) => scrubLog(log),
  };
}

/**
 * Sends what is buffered (logs, alerts) once the response has gone, before the function freezes:
 * never awaited on the request path. Outside a request (boot, a job) `after()` is unavailable, so the
 * flush simply starts.
 */
export function flushSoon(): void {
  try {
    after(() => flush(FLUSH_TIMEOUT_MS));
  } catch {
    void flush(FLUSH_TIMEOUT_MS).catch(() => undefined);
  }
}

type OnRequestError = Instrumentation.onRequestError;

function allowedHeaders(
  headers: Parameters<OnRequestError>[1]['headers'],
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && ALLOWED_REQUEST_HEADERS.includes(name.toLowerCase())) out[name] = value;
  }
  return out;
}

/**
 * An error a Server Action caught and turned into a stable code (spec 0005). Thrown errors reach Sentry
 * through `onRequestError`; a caught one would otherwise vanish. Scrubbed in `beforeSend` like the rest.
 */
export function reportServerError(where: string, error: unknown): void {
  try {
    captureException(error, { tags: { where } });
    flushSoon();
  } catch {
    // Never let reporting an error raise another one.
  }
}

/**
 * `onRequestError` in instrumentation.ts (AC-1, AC-3): a Server Action, Route Handler or server
 * component error, with only allow listed headers and a scrubbed path. Awaited, with a flush, so the
 * event is sent before the function freezes.
 */
export async function captureRequestError(
  ...[error, request, context]: Parameters<OnRequestError>
): Promise<void> {
  try {
    sentryCaptureRequestError(
      error,
      { method: request.method, path: scrubUrl(request.path), headers: allowedHeaders(request.headers) },
      context,
    );
    await flush(FLUSH_TIMEOUT_MS);
  } catch {
    // Never let reporting an error raise another one.
  }
}
