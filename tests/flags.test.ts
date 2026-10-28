import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/lib/db/types';

/**
 * Spec 0004 AC-11, AC-14 (D70): a money flag is a platform_settings row per region, read live on every
 * call, and it FAILS CLOSED. A read error, a timeout, a missing or hidden row, or a non boolean value
 * returns false, logs `flag_read_failed`, and raises the `flag_read_failed` alert for record
 * `region:flag`. Tests first; the client is a fake with the Supabase query shape.
 */

const doors = vi.hoisted(() => ({ log: vi.fn(), raiseAlert: vi.fn() }));
vi.mock('@/lib/observability/log', () => ({ log: { error: doors.log, warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: doors.raiseAlert }));

const { FLAG_READ_TIMEOUT_MS, MONEY_FLAGS, isEnabled } = await import('@/lib/flags');

type Answer = { data: { value: unknown } | null; error: { message: string } | null };

/** A client whose query resolves with `answer` (or never), recording what it was asked. */
function fakeDb(answer: Answer | 'never' | 'throw') {
  const calls: Array<{
    table: string;
    columns: string;
    filters: Array<[string, unknown]>;
    signal?: AbortSignal;
  }> = [];
  const db = {
    from(table: string) {
      if (answer === 'throw') throw new Error('client exploded');
      const call: (typeof calls)[number] = { table, columns: '', filters: [] };
      calls.push(call);
      const query = {
        select(columns: string) {
          call.columns = columns;
          return query;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return query;
        },
        abortSignal(signal: AbortSignal) {
          call.signal = signal;
          return query;
        },
        maybeSingle() {
          return answer === 'never' ? new Promise<Answer>(() => {}) : Promise.resolve(answer);
        },
      };
      return query;
    },
  };
  return { db: db as unknown as Db, calls };
}

beforeEach(() => {
  doors.log.mockClear();
  doors.raiseAlert.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('isEnabled reads the row live', () => {
  it('returns the stored boolean for (region, key), asking only for the value', async () => {
    const on = fakeDb({ data: { value: true }, error: null });
    await expect(isEnabled('funding_enabled', 'TR', on.db)).resolves.toBe(true);
    expect(on.calls[0]).toMatchObject({
      table: 'platform_settings',
      columns: 'value',
      filters: [
        ['region', 'TR'],
        ['key', 'funding_enabled'],
      ],
    });
    const off = fakeDb({ data: { value: false }, error: null });
    await expect(isEnabled('payouts_enabled', 'KSA', off.db)).resolves.toBe(false);
    expect(doors.raiseAlert).not.toHaveBeenCalled();
    expect(doors.log).not.toHaveBeenCalled();
  });

  it('reads on every call: no cache, so flipping the row takes effect on the next read', async () => {
    const { db, calls } = fakeDb({ data: { value: true }, error: null });
    await isEnabled('unlock_enabled', 'TR', db);
    await isEnabled('unlock_enabled', 'TR', db);
    expect(calls).toHaveLength(2);
  });

  it('knows exactly the five money flags', () => {
    expect([...MONEY_FLAGS]).toEqual([
      'funding_enabled',
      'unlock_enabled',
      'payouts_enabled',
      'auto_release_enabled',
      'notifications_enabled',
    ]);
  });
});

describe('isEnabled fails closed, logs, and raises flag_read_failed', () => {
  it.each([
    [
      'a read error',
      { data: null, error: { message: 'permission denied for table platform_settings' } },
      'error',
    ],
    ['a missing or hidden row', { data: null, error: null }, 'missing'],
    ['the string "true"', { data: { value: 'true' }, error: null }, 'not_boolean'],
    ['the number 1', { data: { value: 1 }, error: null }, 'not_boolean'],
    ['a null value', { data: { value: null }, error: null }, 'not_boolean'],
  ] as Array<[string, Answer, string]>)('%s', async (_name, answer, cause) => {
    await expect(isEnabled('auto_release_enabled', 'TR', fakeDb(answer).db)).resolves.toBe(false);
    expect(doors.log).toHaveBeenCalledWith('flag_read_failed', { region: 'TR' });
    expect(doors.raiseAlert).toHaveBeenCalledWith('flag_read_failed', {
      recordId: 'TR:auto_release_enabled',
      region: 'TR',
      cause,
    });
  });

  it('a client that throws', async () => {
    await expect(isEnabled('funding_enabled', 'KSA', fakeDb('throw').db)).resolves.toBe(false);
    expect(doors.raiseAlert).toHaveBeenCalledWith('flag_read_failed', {
      recordId: 'KSA:funding_enabled',
      region: 'KSA',
      cause: 'error',
    });
  });

  it('a read that takes longer than 2 seconds, aborting the query', async () => {
    vi.useFakeTimers();
    const { db, calls } = fakeDb('never');
    const result = isEnabled('notifications_enabled', 'TR', db);
    await vi.advanceTimersByTimeAsync(FLAG_READ_TIMEOUT_MS);
    await expect(result).resolves.toBe(false);
    expect(FLAG_READ_TIMEOUT_MS).toBe(2000);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(doors.raiseAlert).toHaveBeenCalledWith('flag_read_failed', {
      recordId: 'TR:notifications_enabled',
      region: 'TR',
      cause: 'timeout',
    });
  });
});
