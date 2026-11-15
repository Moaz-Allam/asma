/**
 * The list's keyset cursor (spec 0008 AC-13): the last row's `created_at`, as Postgres sent it (so the
 * microseconds survive), and its id, made opaque. A malformed cursor reads as none: page 1.
 */

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Cursor = { createdAt: string; id: string };

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(value: unknown): Cursor | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return null;
  let text: string;
  try {
    text = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const [createdAt, id, ...rest] = text.split('|');
  if (rest.length > 0 || createdAt === undefined || id === undefined) return null;
  if (!TIMESTAMP.test(createdAt) || !UUID.test(id)) return null;
  if (Number.isNaN(Date.parse(createdAt.replace(' ', 'T')))) return null;
  return { createdAt, id };
}
