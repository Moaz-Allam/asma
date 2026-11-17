/**
 * The feed's keyset cursor (spec 0009 AC-5): the last row's outside hours flag, start and id, made opaque.
 * The start keeps Postgres's own text, so microseconds survive. A malformed cursor reads as none: page 1.
 */

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type FeedCursor = { outside: boolean; start: string; id: string };

export function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(`${cursor.outside ? 1 : 0}|${cursor.start}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeFeedCursor(value: unknown): FeedCursor | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return null;
  const text = Buffer.from(value, 'base64url').toString('utf8');
  const [outside, start, id, ...rest] = text.split('|');
  if (rest.length > 0 || start === undefined || id === undefined) return null;
  if ((outside !== '0' && outside !== '1') || !TIMESTAMP.test(start) || !UUID.test(id)) return null;
  if (Number.isNaN(Date.parse(start.replace(' ', 'T')))) return null;
  return { outside: outside === '1', start, id };
}
