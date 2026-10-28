import {
  addEventProcessor,
  addIntegration,
  browserTracingIntegration,
  captureException,
  captureRouterTransitionStart,
  init,
} from '@sentry/nextjs';

import { afterHydration } from '@/lib/browser/after-hydration';
import { scrubBreadcrumb, scrubEvent, scrubRecordingEvent } from '@/lib/observability/scrub';
import {
  DENY_URLS,
  IGNORE_ERRORS,
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
    init({
      dsn: DSN,
      environment: ENVIRONMENT,
      release: RELEASE,
      sendDefaultPii: false,
      tracesSampleRate: tracesSampleRate(ENVIRONMENT),
      // No trace header goes to any other origin (AC-2), and the telemetry paths get no span.
      tracePropagationTargets: [],
      integrations: [
        browserTracingIntegration({ shouldCreateSpanForRequest: (url) => !isTelemetryPath(url) }),
      ],
      // A replay is kept only for a session in which an error happened (AC-4).
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
      ignoreErrors: IGNORE_ERRORS,
      denyUrls: DENY_URLS,
      beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
      beforeSend: (event) => scrubEvent(event),
      beforeSendTransaction: (event) => scrubEvent(event),
    });
    // Replay events skip beforeSend, and the pages they list are user data (AC-3).
    addEventProcessor((event) => (event.type === 'replay_event' ? scrubEvent(event) : event));
    afterHydration(() => void loadReplay());
  } catch {
    // Observability never breaks the page.
  }
}

/** Session replay, added lazily: masked, nothing kept in sessionStorage, nothing from the network. */
async function loadReplay(): Promise<void> {
  try {
    const { replayIntegration } = await import('@sentry/nextjs');
    addIntegration(
      replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
        stickySession: false,
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
