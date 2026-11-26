import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';

/**
 * Spec 0005 AC-20, AC-21, AC-25 (D58, D100). The gate runs at G3, so it must be proved to fire now: a
 * gate nobody has seen fail is a sentence, not a guard.
 */

const SCRIPT = join(process.cwd(), 'scripts', 'launch-gate.mjs');

function gate(
  messages: Record<string, unknown>,
  {
    samples = false,
    photos = false,
    siteUrl = 'https://aldebyani.com',
  }: { samples?: boolean; photos?: boolean; siteUrl?: string } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'launch-gate-'));
  mkdirSync(join(root, 'messages'));
  mkdirSync(join(root, 'lib', 'landing'), { recursive: true });
  for (const locale of ['ar', 'tr', 'en']) {
    writeFileSync(join(root, 'messages', `${locale}.json`), JSON.stringify(messages));
  }
  writeFileSync(
    join(root, 'lib', 'landing', 'samples.ts'),
    `export const SAMPLE_DATA = ${samples};\nexport const BORROWED_PHOTOS = ${photos};\n`,
  );
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, APP_SITE_URL: siteUrl },
  });
}

type Tree = { [key: string]: string | Tree };

function flatten(node: Tree, path = ''): Array<[string, string]> {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${path}${key}`, value]] : flatten(value, `${path}${key}.`),
  ) as Array<[string, string]>;
}

describe('the launch gate', () => {
  it('passes a catalogue with nothing temporary', () => {
    expect(gate({ a: 'Merhaba' }).status).toBe(0);
  });

  it('fails while a Turkish string awaits the translator', () => {
    const run = gate({ a: { b: '[tr] Hello' } });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('a.b');
  });

  it('fails while a legal text is a draft', () => {
    expect(gate({ a: '[draft] Terms' }).status).toBe(1);
  });

  it('fails while the landing page shows sample data', () => {
    const run = gate({ a: 'Merhaba' }, { samples: true });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('SAMPLE_DATA');
  });

  it('fails while the landing page shows borrowed photos', () => {
    const run = gate({ a: 'Merhaba' }, { photos: true });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('BORROWED_PHOTOS');
  });

  it('fails while production has no site address', () => {
    const run = gate({ a: 'Merhaba' }, { siteUrl: '' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('APP_SITE_URL');
  });

  it('fails on the real catalogues today, which is why it is not in CI', () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(run.status).toBe(1);
  });
});

describe('the markers in the catalogues (D58, D100)', () => {
  const english = new Map(flatten(en));
  const turkish = flatten(tr);

  it('has no Turkish string awaiting the translator (translated 2026-11-24)', () => {
    const waiting = turkish.filter(([, value]) => value.includes('[tr]'));
    expect(waiting.map(([key]) => key)).toEqual([]);
  });

  it('holds the English text behind every [tr] marker, never machine output', () => {
    for (const [key, value] of turkish) {
      if (!value.includes('[tr] ')) continue;
      expect(value.replace('[tr] ', ''), key).toBe(english.get(key));
    }
  });

  it.each(['Legal.termsBody', 'Legal.privacyBody', 'Onboarding.agreement', 'ProviderDocs.consent'])(
    '%s does not start with the [draft] marker in any locale',
    (key) => {
      for (const catalogue of [ar, tr, en]) {
        const value = new Map(flatten(catalogue)).get(key);
        expect(value).not.toMatch(/^\[draft\] /);
      }
    },
  );
});
