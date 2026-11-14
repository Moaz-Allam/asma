import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Spec 0006 AC-3 (D131): property tests for `public.has_contact_info`, the one scanner, which lives in
 * Postgres. fast-check draws the cases, the local database judges them all in one query. CI's `checks`
 * job has no database, so this skips there; the same two properties run seeded in pgTAP 07, which CI's
 * `database` job runs. Locally it runs whenever the stack listens on its database port.
 */

const DB_PORT = 54422;

function dbListening(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: DB_PORT });
    socket.setTimeout(500);
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
  });
}

/** The texts the scanner does NOT flag, out of `texts`. */
function unflagged(texts: string[]): string[] {
  const rows = texts.map((t) => `('${t.replace(/'/g, "''")}')`).join(',');
  const query = `select t from (values ${rows}) as c(t) where not public.has_contact_info(t)`;
  // The query goes in a file, so no test text passes through a shell (Windows needs one for npx).
  const dir = mkdtempSync(join(tmpdir(), 'scanner-'));
  const file = join(dir, 'query.sql');
  writeFileSync(file, query, 'utf8');
  const run = spawnSync('npx', ['supabase', 'db', 'query', '--local', '-f', `"${file}"`], {
    encoding: 'utf8',
    shell: true,
  });
  rmSync(dir, { recursive: true, force: true });
  if (run.status !== 0) throw new Error(`db query failed: ${run.stderr || run.error?.message}`);
  const json = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'))) as { rows: Array<{ t: string }> };
  return json.rows.map((r) => r.t);
}

const SEPARATOR_CHARS = [' ', '-', '/', '.', 'x', '_'] as const;
const separator = (min: number, max: number) =>
  fc.array(fc.constantFrom(...SEPARATOR_CHARS), { minLength: min, maxLength: max }).map((a) => a.join(''));
const tenDigits = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 10, maxLength: 10 });
const SHAPES = [
  [4, 3, 3],
  [3, 3, 2, 2],
  [4, 3, 2, 2],
] as const;

/** A 10 digit number cut into groups of a shape, with a separator of 1 to 5 characters between groups. */
const grouped = fc
  .tuple(tenDigits, fc.constantFrom(...SHAPES), fc.array(separator(1, 5), { minLength: 3, maxLength: 3 }))
  .map(([digits, shape, seps]) => {
    let at = 0;
    return shape
      .map((len, i) => {
        const group = digits.slice(at, at + len).join('');
        at += len;
        return i === 0 ? group : (seps[i - 1] ?? '') + group;
      })
      .join('');
  });

/**
 * A separator between every digit. 1 to 2 characters: 1 to 3 can put 7 digits across 25 characters, past
 * the 21 character window, which the owner was told when the window was set (D131).
 */
const everyDigit = fc
  .tuple(tenDigits, fc.array(separator(1, 2), { minLength: 9, maxLength: 9 }))
  .map(([digits, seps]) => digits.map((d, i) => (i === 0 ? `${d}` : (seps[i - 1] ?? '') + d)).join(''));

let available = false;
beforeAll(async () => {
  available = await dbListening();
});

describe('has_contact_info, properties (needs the local database)', () => {
  it('flags a 10 digit number in groups of 4,3,3 or 3,3,2,2 or 4,3,2,2, 1 to 5 characters apart', (ctx) => {
    if (!available) return ctx.skip();
    const cases = fc.sample(grouped, { numRuns: 300, seed: 20261113 });
    expect(unflagged(cases)).toEqual([]);
  }, 60_000);

  it('flags a 10 digit number with 1 to 2 characters between every digit', (ctx) => {
    if (!available) return ctx.skip();
    const cases = fc.sample(everyDigit, { numRuns: 300, seed: 20261114 });
    expect(unflagged(cases)).toEqual([]);
  }, 60_000);
});
