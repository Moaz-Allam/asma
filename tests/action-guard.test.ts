import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0005 AC-13, rule 11. A meta test: it finds every Server Action and Route Handler on disk, so a new
 * one is covered the moment it exists. Each must refuse an anonymous caller, on any input, or be one of
 * the four named machine endpoints. Sign in adds no exemption: it is not a Server Action (D98).
 */

const auth = vi.hoisted(() => ({
  getUser: vi.fn(async () => ({ data: { user: null }, error: new Error('no session') })),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/db/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: auth.getUser },
    rpc: auth.rpc,
    from: auth.from,
  }),
}));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'tr' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ACTIONS_DIR = 'actions';

/** The only routes with no session (D71, D83). Anything else must refuse. */
const MACHINE_ENDPOINTS = ['app/api/health', 'app/api/e', 'app/api/a/[...path]', 'app/api/csp'];

function walk(dir: string, match: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, match);
    return match(name) ? [path] : [];
  });
}

const posix = (path: string) => relative('.', path).split(sep).join('/');
const actionFiles = walk(ACTIONS_DIR, (name) => /\.tsx?$/.test(name)).map(posix);
const routeFiles = walk('app', (name) => /^route\.tsx?$/.test(name)).map(posix);

/** Inputs a caller controls: the check must come first, so none of these may reach validation. */
const INPUTS: unknown[] = [undefined, null, {}, 'x', 1, { role: 'admin', accepted: true, fullName: 'Ab Cd' }];

type Action = (input?: unknown) => Promise<unknown>;

beforeEach(() => {
  auth.rpc.mockClear();
  auth.from.mockClear();
});

describe('the action guard', () => {
  it('finds the actions directory', () => {
    expect(actionFiles.length).toBeGreaterThan(0);
  });

  it.each(actionFiles)('%s is a server module', (file) => {
    expect(readFileSync(file, 'utf8')).toMatch(/^'use server';/);
  });

  it.each(actionFiles)(
    '%s: every export refuses anyone anonymous',
    async (file) => {
      const loaded = (await import(/* @vite-ignore */ `../${file}`)) as Record<string, Action>;
      const exported = Object.entries(loaded);
      expect(exported.length).toBeGreaterThan(0);

      for (const [name, action] of exported) {
        for (const input of INPUTS) {
          await expect(action(input), `${file} ${name}`).resolves.toEqual({
            success: false,
            error: 'unauthorized',
          });
        }
      }
      expect(auth.rpc).not.toHaveBeenCalled();
      expect(auth.from).not.toHaveBeenCalled();
      // The first action file loaded pays the cold import of every door under a full parallel run.
    },
    30_000,
  );
});

describe('the route guard', () => {
  it('names exactly four machine endpoints, and each still exists', () => {
    expect(MACHINE_ENDPOINTS).toHaveLength(4);
    for (const route of MACHINE_ENDPOINTS) expect(routeFiles).toContain(`${route}/route.ts`);
  });

  const guarded = routeFiles.filter(
    (file) => !MACHINE_ENDPOINTS.includes(file.replace(/\/route\.tsx?$/, '')),
  );

  it.each(guarded)('%s refuses anyone anonymous', async (file) => {
    const loaded = (await import(/* @vite-ignore */ `../${file}`)) as Record<
      string,
      (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>
    >;
    const handlers = Object.entries(loaded).filter(([name]) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(name));
    expect(handlers.length).toBeGreaterThan(0);

    for (const [, handler] of handlers) {
      const response = await handler(new NextRequest('http://localhost/tr/x'), {
        params: Promise.resolve({ locale: 'tr' }),
      });
      const refused = response.status === 401 || response.status === 403;
      const toLogin = /\/login(\?|$)/.test(response.headers.get('location') ?? '');
      expect(refused || toLogin, file).toBe(true);
    }
  });
});
