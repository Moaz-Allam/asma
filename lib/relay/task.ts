import 'server-only';

import { randomUUID, timingSafeEqual } from 'node:crypto';

import { appRelease } from '@/lib/deployment';
import { createEmailDriver } from '@/lib/email';
import { getEnv } from '@/lib/env';
import { appOrigin } from '@/lib/http/origin';
import { log } from '@/lib/observability/log';
import { checkIn } from '@/lib/observability/server';

import { relayDb } from './db';
import { runDrain } from './drain';
import { runEmail } from './email';
import { heartbeat } from './heartbeat';
import { relayPsp } from './psp';
import { reconcileDaily, reconcilePending } from './reconcile';

/**
 * `/api/relay` (spec 0011-08 AC-5, R-7): who may wake the relay, and what each task does. The route checks the
 * secret and the body, answers 202 at once, and runs the task in `after()`. A run cut at any point is safe.
 */

// Spec 0011-13 R-12: `email` drains the mail lane (cron relay-email, every minute).
export const RELAY_TASKS = ['drain', 'reconcile_pending', 'reconcile_daily', 'heartbeat', 'email'] as const;
export type RelayTask = (typeof RELAY_TASKS)[number];
export const RELAY_BODY_LIMIT_BYTES = 1024;
export const RELAY_SECRET_HEADER = 'x-relay-secret';

/** Timing safe; false when no secret is configured, so the route answers 404 to everyone. */
export function relaySecretMatches(given: string | null): boolean {
  const expected = getEnv().RELAY_SECRET;
  if (expected === undefined || given === null) return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseTask(body: Uint8Array): RelayTask | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    const task = (parsed as { task?: unknown } | null)?.task;
    return (RELAY_TASKS as readonly unknown[]).includes(task) ? (task as RelayTask) : null;
  } catch {
    return null;
  }
}

export function workerName(): string {
  return `relay:${appRelease(process.env).slice(0, 12)}:${randomUUID().slice(0, 8)}`;
}

export async function runTask(task: RelayTask): Promise<void> {
  const db = relayDb();
  try {
    if (task === 'drain') {
      const id = checkIn('relay-drain', 'in_progress');
      try {
        await runDrain({ db, psp: relayPsp(db), worker: workerName() });
        checkIn('relay-drain', 'ok', id);
      } catch (error) {
        checkIn('relay-drain', 'error', id);
        throw error;
      }
    } else if (task === 'reconcile_pending') {
      await reconcilePending(db);
    } else if (task === 'reconcile_daily') {
      await reconcileDaily(db, relayPsp(db));
    } else if (task === 'email') {
      await runEmail({ db, driver: createEmailDriver(), worker: workerName(), origin: appOrigin() });
    } else {
      await heartbeat(db);
    }
  } catch {
    log.error('relay_task_failed');
  }
}
