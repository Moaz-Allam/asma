import 'server-only';

import { gunzipSync } from 'node:zlib';

import { readCapped } from '@/lib/http/body';

/**
 * The PostHog relay (spec 0004 AC-6; D83): POST /api/a/* carries posthog-js's capture calls to EU Cloud.
 * Only the capture endpoints, only for our own project key, and with no visitor header beyond the
 * content type and encoding, so no cookie, referer or visitor IP reaches PostHog. Flags, remote config
 * and scripts are off in the client (lib/analytics/client.ts), so nothing else is ever needed here.
 *
 * A public machine endpoint: browsers post here without a session, so there is no requireRole() (D71,
 * D83). It answers without throwing; a lost event is only a lost event.
 */

/** One capture call, compressed; posthog-js batches a few events at a time. */
export const CAPTURE_LIMIT_BYTES = 1024 * 1024;
/** The same call decompressed: a gzip bomb stops here. */
const DECODED_LIMIT_BYTES = 5 * 1024 * 1024;
const POSTHOG_HOST = 'https://eu.i.posthog.com';
/** The endpoints posthog-js sends events to; `e` with our config, the others if a version moves. */
const CAPTURE_PATHS: ReadonlySet<string> = new Set(['e', 'i/v0/e', 'batch']);
/** The query parameters posthog-js sets that PostHog reads: the encoding, the SDK version, a cache buster. */
const FORWARDED_PARAMS = ['compression', 'ver', '_'] as const;
const UPSTREAM_TIMEOUT_MS = 5000;

export type PostHogForwarderOptions = {
  /** Read per request, so importing the route at build time never reads the environment. */
  key: () => string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

function decodePayload(body: Uint8Array, compression: string | null): unknown {
  if (compression === 'gzip-js' || compression === 'gzip') {
    return JSON.parse(gunzipSync(body, { maxOutputLength: DECODED_LIMIT_BYTES }).toString('utf8'));
  }
  const text = new TextDecoder().decode(body);
  if (compression === 'base64') {
    const data = new URLSearchParams(text).get('data') ?? '';
    return JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  }
  return JSON.parse(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every project key a payload names: per event (`properties.token`) and per batch (`api_key`). */
function keysOf(payload: unknown): string[] {
  const keys: string[] = [];
  const visit = (item: unknown): void => {
    if (!isRecord(item)) return;
    for (const field of ['api_key', 'token']) {
      const value = item[field];
      if (typeof value === 'string') keys.push(value);
    }
    if (isRecord(item.properties) && typeof item.properties.token === 'string')
      keys.push(item.properties.token);
  };
  if (Array.isArray(payload)) payload.forEach(visit);
  else {
    visit(payload);
    if (isRecord(payload) && Array.isArray(payload.batch)) payload.batch.forEach(visit);
  }
  return keys;
}

/** POST /api/a/<endpoint>: a capture call naming only our key, to its fixed EU Cloud URL. */
export function createPostHogForwarder(
  options: PostHogForwarderOptions,
): (request: Request, path: readonly string[]) => Promise<Response> {
  const send = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  return async (request, path) => {
    const key = options.key();
    const endpoint = path.filter((part) => part !== '').join('/');
    if (!key || !CAPTURE_PATHS.has(endpoint)) return new Response(null, { status: 404 });
    const body = await readCapped(request, CAPTURE_LIMIT_BYTES);
    if (body === null) return new Response(null, { status: 413 });

    const url = new URL(request.url);
    const encoding = request.headers.get('content-encoding');
    const compression = url.searchParams.get('compression') ?? (encoding === 'gzip' ? 'gzip' : null);
    let keys: string[];
    try {
      keys = keysOf(decodePayload(body, compression));
    } catch {
      return new Response(null, { status: 400 });
    }
    if (keys.length === 0 || keys.some((named) => named !== key)) return new Response(null, { status: 403 });

    const target = new URL(`${POSTHOG_HOST}/${endpoint}/`);
    for (const name of FORWARDED_PARAMS) {
      const value = url.searchParams.get(name);
      if (value !== null) target.searchParams.set(name, value);
    }
    const headers: Record<string, string> = {
      'content-type': request.headers.get('content-type') ?? 'text/plain',
    };
    if (encoding !== null) headers['content-encoding'] = encoding;
    try {
      const upstream = await send(target, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
      });
    } catch {
      return new Response(null, { status: 502 });
    }
  };
}
