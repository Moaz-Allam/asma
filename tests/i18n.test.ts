import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CLIENT_LANDING_KEYS, CLIENT_NAMESPACES, clientMessages } from '@/lib/i18n/client-messages';
import { DEFAULT_LOCALE, LOCALES, dirFor, isLocale } from '@/lib/i18n/direction';
import { routing } from '@/lib/i18n/routing';

describe('direction is derived from the locale, never hardcoded (Rule 10)', () => {
  it('maps ar to rtl and the Latin-script locales to ltr', () => {
    expect(dirFor('ar')).toBe('rtl');
    expect(dirFor('tr')).toBe('ltr');
    expect(dirFor('en')).toBe('ltr');
  });

  it('defaults an unknown locale to ltr rather than throwing', () => {
    // The 404 for a bad URL segment is the layout's job; this helper must stay total.
    expect(dirFor('zz')).toBe('ltr');
  });

  it('ships exactly the three agreed locales', () => {
    expect([...LOCALES]).toEqual(['ar', 'tr', 'en']);
    expect(routing.locales).toEqual(LOCALES);
    expect(routing.defaultLocale).toBe(DEFAULT_LOCALE);
  });

  it('recognises only known locales', () => {
    expect(isLocale('tr')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });
});

describe('message catalogues (Rule 10 — no raw key ever reaches a customer)', () => {
  const flatten = (o: Record<string, unknown>, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flatten(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`],
    );

  it('has every key in all three locales', async () => {
    const loaded = await Promise.all(
      LOCALES.map(async (l) => [l, (await import(`../messages/${l}.json`)).default] as const),
    );
    const keys = new Map(loaded.map(([l, m]) => [l, new Set(flatten(m))]));
    const all = new Set([...keys.values()].flatMap((s) => [...s]));

    for (const [locale, set] of keys) {
      const missing = [...all].filter((k) => !set.has(k));
      expect(missing, `messages/${locale}.json is missing: ${missing.join(', ')}`).toEqual([]);
    }
  });
});

describe('the messages a page sends to the browser (spec 0005 AC-31)', () => {
  function clientFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return clientFiles(path);
      if (!path.endsWith('.tsx')) return [];
      return readFileSync(path, 'utf8').startsWith("'use client'") ? [path] : [];
    });
  }

  it('holds every namespace a Client Component reads', () => {
    const files = [...clientFiles('app'), ...clientFiles('components')];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const [, namespace] of text.matchAll(/useTranslations\('([A-Za-z]+)/g)) {
        if (namespace === 'Landing') continue;
        expect(CLIENT_NAMESPACES as readonly string[], file).toContain(namespace);
      }
    }
  });

  it('keeps only the landing keys the phone menu uses', () => {
    const menu = readFileSync('components/layout/PublicMenu.tsx', 'utf8');
    const used = [...menu.matchAll(/tLanding\('([A-Za-z]+)'\)/g)].map((match) => match[1]);
    expect(new Set(used)).toEqual(new Set(CLIENT_LANDING_KEYS));
  });

  it('leaves the long copy on the server', async () => {
    const messages = (await import('../messages/en.json')).default;
    const picked = clientMessages(messages);
    expect(Object.keys(picked).sort()).toEqual([...CLIENT_NAMESPACES, 'Landing'].sort());
    expect(Object.keys(picked.Landing ?? {})).toEqual([...CLIENT_LANDING_KEYS]);
  });
});
