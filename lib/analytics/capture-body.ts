import { gunzipSync } from 'node:zlib';

/**
 * Reads the body of a posthog-js capture call, for the /api/a relay (D83). No `server-only` here, so the
 * e2e suite can run the real SDK's real bytes through it: that path is stubbed in the browser, which is
 * how a handler refusing every real call once passed every test (2026-10-31).
 *
 * posthog-js 1.418 gzips with nothing in the URL to say so, and sends the events as `{ api_key, batch }`.
 * It falls back to base64 (`?compression=base64`) or plain JSON. Gzip is recognised by its first two
 * bytes, never by a parameter.
 */

/** The call decompressed: a gzip bomb stops here. */
const DECODED_LIMIT_BYTES = 5 * 1024 * 1024;

function isGzip(body: Uint8Array): boolean {
  return body[0] === 0x1f && body[1] === 0x8b;
}

function decode(body: Uint8Array, compression: string | null): unknown {
  if (isGzip(body)) {
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

/**
 * Every project key a capture call names: per event (`properties.token`) and per batch (`api_key`).
 * Throws on a body it cannot read.
 */
export function captureKeys(body: Uint8Array, compression: string | null): string[] {
  const payload = decode(body, compression);
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
