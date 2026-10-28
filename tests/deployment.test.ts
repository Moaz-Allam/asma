import { describe, expect, it } from 'vitest';

import {
  appEnv,
  appRelease,
  assertDeploymentKeys,
  isCommitSha,
  isDeployment,
  missingDeploymentKeys,
} from '@/lib/deployment';

/**
 * Spec 0004 AC-9 (D71): a deployment refuses to build or boot without its keys, and "deployment" must
 * never be decided wrongly. Too narrow, and a preview ships blind (no errors, no analytics); too wide,
 * and every local build fails for keys nobody needs. Tests first: this is the gate the rest of 00b
 * stands on.
 */

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('isDeployment: the environment matrix', () => {
  it.each([
    ['on Vercel, whatever NODE_ENV says', { VERCEL: '1', NODE_ENV: 'development' }, true],
    ['a production build or server', { NODE_ENV: 'production' }, true],
    ['the build phase even before NODE_ENV is set', { NEXT_PHASE: 'phase-production-build' }, true],
    ['the production server phase', { NEXT_PHASE: 'phase-production-server' }, true],
    [
      'a production build marked local only (CI build, e2e)',
      { NODE_ENV: 'production', APP_LOCAL_ONLY: '1' },
      false,
    ],
    ['next dev', { NODE_ENV: 'development' }, false],
    ['the dev server phase', { NEXT_PHASE: 'phase-development-server' }, false],
    ['vitest', { NODE_ENV: 'test' }, false],
    ['an empty environment', {}, false],
  ])('%s', (_name, env, expected) => {
    expect(isDeployment(env)).toBe(expected);
  });

  it('counts only exactly 1 as local only: any other value stays a deployment (fail closed)', () => {
    expect(isDeployment({ NODE_ENV: 'production', APP_LOCAL_ONLY: 'true' })).toBe(true);
    expect(isDeployment({ NODE_ENV: 'production', APP_LOCAL_ONLY: 'yes' })).toBe(true);
    expect(isDeployment({ NODE_ENV: 'production', APP_LOCAL_ONLY: ' 1' })).toBe(true);
  });

  it('treats an empty value as unset, like lib/env.ts does', () => {
    expect(isDeployment({ NODE_ENV: 'production', APP_LOCAL_ONLY: '' })).toBe(true);
    expect(isDeployment({ VERCEL: '1', APP_LOCAL_ONLY: '' })).toBe(true);
    expect(isDeployment({ VERCEL: '', NODE_ENV: 'development' })).toBe(false);
  });

  it('refuses APP_LOCAL_ONLY on Vercel: it would switch the key checks off on a real deployment', () => {
    expect(() => isDeployment({ VERCEL: '1', APP_LOCAL_ONLY: '1' })).toThrow(/APP_LOCAL_ONLY/);
    expect(() => isDeployment({ VERCEL: '1', APP_LOCAL_ONLY: 'true' })).toThrow(/APP_LOCAL_ONLY/);
  });
});

describe('missingDeploymentKeys: what a deployment needs, per phase', () => {
  it('a Vercel build needs the full commit SHA (the release name)', () => {
    expect(missingDeploymentKeys({ VERCEL: '1' }, 'build')).toContain('VERCEL_GIT_COMMIT_SHA');
    expect(missingDeploymentKeys({ VERCEL: '1', VERCEL_GIT_COMMIT_SHA: 'abc123' }, 'build')).toContain(
      'VERCEL_GIT_COMMIT_SHA',
    );
    expect(missingDeploymentKeys({ VERCEL: '1', VERCEL_GIT_COMMIT_SHA: SHA }, 'build')).not.toContain(
      'VERCEL_GIT_COMMIT_SHA',
    );
  });

  it('a build off Vercel or a boot never asks for the commit SHA', () => {
    expect(missingDeploymentKeys({ NODE_ENV: 'production' }, 'build')).not.toContain('VERCEL_GIT_COMMIT_SHA');
    expect(missingDeploymentKeys({ VERCEL: '1' }, 'runtime')).not.toContain('VERCEL_GIT_COMMIT_SHA');
  });
});

describe('assertDeploymentKeys: refuse with a message naming each variable', () => {
  it('throws on a deployment that lacks a key, naming it and the phase', () => {
    expect(() => assertDeploymentKeys({ VERCEL: '1' }, 'build')).toThrow(/build[\s\S]*VERCEL_GIT_COMMIT_SHA/);
  });

  it('does nothing off a deployment, even with every key missing', () => {
    expect(() => assertDeploymentKeys({ NODE_ENV: 'development' }, 'build')).not.toThrow();
    expect(() =>
      assertDeploymentKeys({ NODE_ENV: 'production', APP_LOCAL_ONLY: '1' }, 'runtime'),
    ).not.toThrow();
  });

  it('carries the Vercel plus APP_LOCAL_ONLY refusal through', () => {
    expect(() => assertDeploymentKeys({ VERCEL: '1', APP_LOCAL_ONLY: '1' }, 'runtime')).toThrow(
      /APP_LOCAL_ONLY/,
    );
  });

  it('never echoes a value into the message, only names', () => {
    const secretish = 'sntrys_do_not_print_me';
    try {
      assertDeploymentKeys({ VERCEL: '1', VERCEL_GIT_COMMIT_SHA: secretish }, 'build');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String(error)).not.toContain(secretish);
    }
  });
});

describe('appEnv and appRelease: the environment and release names (AC-1)', () => {
  it.each([
    [{ VERCEL_ENV: 'production' }, 'production'],
    [{ VERCEL_ENV: 'preview' }, 'preview'],
    [{ VERCEL_ENV: 'development' }, 'local'],
    [{}, 'local'],
  ])('%j → %s', (env, expected) => {
    expect(appEnv(env)).toBe(expected);
  });

  it('names the release by the full commit SHA, else local', () => {
    expect(appRelease({ VERCEL_GIT_COMMIT_SHA: SHA })).toBe(SHA);
    expect(appRelease({ VERCEL_GIT_COMMIT_SHA: 'abc123' })).toBe('local');
    expect(appRelease({})).toBe('local');
  });

  it('accepts only a full lowercase 40 character SHA', () => {
    expect(isCommitSha(SHA)).toBe(true);
    expect(isCommitSha(SHA.toUpperCase())).toBe(false);
    expect(isCommitSha(SHA.slice(0, 7))).toBe(false);
    expect(isCommitSha(`${SHA}0`)).toBe(false);
  });
});
