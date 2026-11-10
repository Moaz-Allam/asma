#!/usr/bin/env node
/**
 * Makes `public/og/{ar,tr,en}.png`, the link preview cards (spec 0005 AC-29). Run by hand, once, and commit
 * the images: `node scripts/make-og-images.mjs`. A real browser, because `next/og` does not shape Arabic.
 * Colours are `ui-tokens.md` §2; the fonts come from Google Fonts for this one run.
 */

import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

const OUT = join(process.cwd(), 'public', 'og');
const FONTS =
  'https://fonts.googleapis.com/css2?family=Alexandria:wght@800&family=Archivo+Black&family=Cairo:wght@500&display=block';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });

for (const locale of ['ar', 'tr', 'en']) {
  const messages = JSON.parse(await readFile(join('messages', `${locale}.json`), 'utf8'));
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const title = messages.App.tagline;
  await page.setContent(
    `<!doctype html><html lang="${locale}" dir="${dir}"><head><link rel="stylesheet" href="${FONTS}"><style>
      body { margin: 0; width: 1200px; height: 630px; box-sizing: border-box; padding: 72px 80px;
             background: #0f3a73; color: #ffffff; display: flex; flex-direction: column; justify-content: space-between; }
      .mark { font: 400 44px 'Archivo Black', sans-serif; letter-spacing: -0.01em; }
      h1 { margin: 0; font: 800 76px/1.24 Alexandria, sans-serif; letter-spacing: -0.03em; max-width: 960px; }
      p { margin: 0; font: 500 30px Cairo, sans-serif; color: #dbe7f6; }
    </style></head><body><div class="mark" dir="ltr">Aldebyani</div><h1>${title}</h1><p dir="ltr">Aldebyani Home Care</p></body></html>`,
    { waitUntil: 'networkidle' },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, `${locale}.png`) });
  console.log(`public/og/${locale}.png`);
}

await browser.close();
