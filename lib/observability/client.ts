import {
  addEventProcessor,
  addIntegration,
  browserTracingIntegration,
  captureException,
  captureRouterTransitionStart,
  init,
} from '@sentry/nextjs';

import { afterHydration } from '@/lib/browser/after-hydration';
import {
  isPathPrivateUrl,
  scrubBreadcrumb,
  scrubEvent,
  scrubRecordingEvent,
  scrubSpan,
} from '@/lib/observability/scrub';
import {
  DENY_URLS,
  IGNORE_ERRORS,
  SENTRY_TUNNEL_ROUTE,
  appEnvOf,
  isTelemetryPath,
  tracesSampleRate,
} from '@/lib/observability/shared';

/**
 * The browser side of the Sentry door (spec 0004 AC-1 to AC-4, AC-8). Only lib/observability imports
 * `@sentry/*`; `instrumentation-client.ts` and the error boundaries call the functions below.
 *
 * Every function swallows its own failures: observability never breaks the page.
 */

// Inlined by Next at build: the DSN is public by design; environment and release are mirrored from
// VERCEL_ENV and VERCEL_GIT_COMMIT_SHA by next.config.ts.
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const ENVIRONMENT = appEnvOf(process.env.NEXT_PUBLIC_APP_ENV);
const RELEASE = process.env.NEXT_PUBLIC_APP_RELEASE || 'local';

let started = false;

/** Runs from instrumentation-client.ts, before hydration. The SDK is on only when its key exists. */
export function initClient(): void {
  if (started || !DSN) return;
  started = true;
  try {
    init(clientOptions());
    // Replay events skip beforeSend, and the pages they list are user data (AC-3).
    addEventProcessor((event) => (event.type === 'replay_event' ? scrubEvent(event) : event));
    afterHydration(() => void loadReplay());
  } catch {
    // Observability never breaks the page.
  }
}

/** Everything `init` gets, built apart so the tests can read it (AC-2 to AC-4). */
export function clientOptions(): Parameters<typeof init>[0] {
  return {
    dsn: DSN,
    environment: ENVIRONMENT,
    release: RELEASE,
    // Envelopes go to our own /api/e handler, which forwards only ours, without the visitor's
    // cookies, referer or IP (D83); the SDK writes the DSN into each envelope for it to check.
    tunnel: SENTRY_TUNNEL_ROUTE,
    sendDefaultPii: false,
    tracesSampleRate: tracesSampleRate(ENVIRONMENT),
    // No trace header goes to any other origin (AC-2). The telemetry paths get no span, nor do MapTiler's calls,
    // whose paths hold the typed address, the pin or the tiles around a home (S20b-1).
    tracePropagationTargets: [],
    integrations: [
      browserTracingIntegration({
        shouldCreateSpanForRequest: (url) => !isTelemetryPath(url) && !isPathPrivateUrl(url),
      }),
    ],
    // A replay is kept only for a session in which an error happened (AC-4).
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
    ignoreErrors: IGNORE_ERRORS,
    denyUrls: DENY_URLS,
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    // Standalone spans (INP, named after the element clicked) skip both hooks above.
    beforeSendSpan: (span) => scrubSpan(span),
  };
}

/**
 * The replay's options (AC-4): masked text, inputs and media, and the attributes that can carry a
 * person's data (a `tel:` or `mailto:` link, an image or form URL, an option value) on top of
 * Sentry's default three. Nothing kept in sessionStorage, nothing from the network.
 */
export const REPLAY_OPTIONS = {
  maskAllText: true,
  maskAllInputs: true,
  blockAllMedia: true,
  maskAttributes: ['title', 'placeholder', 'aria-label', 'href', 'src', 'value', 'alt', 'action'],
  stickySession: false,
  networkDetailAllowUrls: [],
} as const;

/** Session replay, added lazily. */
async function loadReplay(): Promise<void> {
  try {
    const { replayIntegration } = await import('@sentry/nextjs');
    addIntegration(
      replayIntegration({
        ...REPLAY_OPTIONS,
        maskAttributes: [...REPLAY_OPTIONS.maskAttributes],
        networkDetailAllowUrls: [],
        beforeAddRecordingEvent: (event) => scrubRecordingEvent(event),
      }),
    );
  } catch {
    // A replay that cannot load is a replay we do without.
  }
}

/**
 * For the error boundaries (AC-17): report only an error without a digest. A digest means the server
 * rendered it and `onRequestError` has already reported it, so reporting again would count it twice.
 */
export function reportClientError(error: unknown): void {
  // A boundary receives whatever was thrown, which need not be an Error (Next 16.3).
  if (typeof error === 'object' && error !== null && 'digest' in error && error.digest) return;
  try {
    captureException(error);
  } catch {
    // Never let reporting an error raise another one.
  }
}

/** For `onRouterTransitionStart` in instrumentation-client.ts: a navigation span for each route change. */
export function routerTransitionStart(url: string, navigationType: 'push' | 'replace' | 'traverse'): void {
  try {
    captureRouterTransitionStart(url, navigationType);
  } catch {
    // Navigation goes on without its span.
  }
}
