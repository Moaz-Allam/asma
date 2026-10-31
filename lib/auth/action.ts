import 'server-only';

import type { z } from 'zod';

import { reportServerError } from '@/lib/observability/server';

import { type Role } from './roles';
import { AuthRefusal, requireRole, requireUser, type RoleUser, type SessionUser } from './session';

/**
 * The wrapper around every Server Action (spec 0005 AC-12, AC-13; code-standards.md §19). Auth comes
 * first, so the guard test holds on any input, then Zod, then the handler, inside one try and catch.
 * The result is a stable code, never display text and never a throw (D39).
 *
 * The user from the one check is handed to the handler: an action has no render, so `cache` does not
 * apply, and a second check would be a second round trip to Auth.
 */

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

/** A handler's way to answer with a stable code a person can act on. */
class ActionFailure {
  constructor(readonly code: string) {}
}

export function fail(code: string): ActionFailure {
  return new ActionFailure(code);
}

/** Who may call: any signed in user, anyone holding a role, or the named roles. */
type Access = 'signed_in' | 'any_role' | readonly Role[];

type AccessUser<A extends Access> = A extends 'signed_in' ? SessionUser : RoleUser;

async function check(access: Access): Promise<SessionUser> {
  if (access === 'signed_in') return requireUser();
  if (access === 'any_role') return requireRole();
  return requireRole(...access);
}

export function guardedAction<A extends Access, S extends z.ZodType, T>(
  options: { name: string; access: A; schema: S },
  handler: (input: z.output<S>, user: AccessUser<A>) => Promise<T | ActionFailure>,
): (input?: unknown) => Promise<ActionResult<T>> {
  return async (input) => {
    try {
      const user = await check(options.access);
      const parsed = options.schema.safeParse(input);
      if (!parsed.success) return { success: false, error: 'validation_failed' };
      const result = await handler(parsed.data, user as AccessUser<A>);
      if (result instanceof ActionFailure) return { success: false, error: result.code };
      return { success: true, data: result };
    } catch (error) {
      if (error instanceof AuthRefusal) return { success: false, error: error.code };
      reportServerError(options.name, error);
      return { success: false, error: 'action_failed' };
    }
  };
}
