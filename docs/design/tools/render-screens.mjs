// Render every screen of a Claude Design export to JPEG for docs/design/screens/, with the borrowed
// photos and avatars swapped for stand-ins (standins.mjs). Also captures each view of the admin
// console by clicking through its sidebar.
// Usage (from the repo root): node docs/design/tools/render-screens.mjs <unzipped export> docs/design/screens
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installStandins } from './standins.mjs';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: node docs/design/tools/render-screens.mjs <export dir> <out dir>');
  process.exit(1);
}

const FILES = [
  ['Nazzafly Web Mockups.dc.html', 'customer'],
  ['Nazzafly Provider Web.dc.html', 'provider'],
  ['Nazzafly Admin.dc.html', 'admin'],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1 });
const swapped = await installStandins(browser, ctx);
const page = await ctx.newPage();
const index = [];

for (const [file, group] of FILES) {
  await page.goto(pathToFileURL(join(src, file)).href, { waitUntil: 'networkidle', timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  mkdirSync(join(out, group), { recursive: true });

  // A screen section is an id block (s4, p10, a2) whose first row holds the design's label (.lbl).
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll('[id]')]
      .filter((e) => /^[a-z]+\d+[a-z]?$/.test(e.id) && e.querySelector(':scope > div .lbl, :scope > .lbl'))
      .map((e) => ({
        id: e.id,
        label: (e.querySelector('.lbl')?.parentElement?.innerText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 140),
      })),
  );
  for (const s of sections) {
    const el = page.locator(`[id="${s.id}"]`);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await el.screenshot({ path: join(out, group, `${s.id}.jpg`), type: 'jpeg', quality: 82 });
    const box = await el.boundingBox();
    index.push({
      group,
      id: s.id,
      file: `${group}/${s.id}.jpg`,
      label: s.label,
      w: Math.round(box.width),
      h: Math.round(box.height),
    });
  }

  // Interactive app frames outside the labelled sections (the admin console): one shot per view,
  // switching views with the buttons on its navy rail.
  const apps = await page.evaluate(() =>
    [...document.querySelectorAll('.scr')]
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !e.closest('[id]') || !/^[a-z]+\d+[a-z]?$/.test(e.closest('[id]').id))
      .map(({ e, i }) => {
        const rail = [...e.querySelectorAll('button')].filter((b) => {
          for (let p = b.parentElement; p && p !== e; p = p.parentElement)
            if (getComputedStyle(p).backgroundColor === 'rgb(15, 58, 115)') return true;
          return false;
        });
        // a view's name is the button's first non-numeric label (a count badge may follow it)
        const views = rail.map(
          (b) =>
            [...b.querySelectorAll('span')]
              .map((s) => s.innerText.replace(/\s+/g, ' ').trim())
              .find((s) => s && !/^\d+$/.test(s)) || b.innerText.replace(/\s+/g, ' ').trim(),
        );
        return { i, views };
      }),
  );
  for (const app of apps) {
    const scr = page.locator('.scr').nth(app.i);
    const views = app.views.length ? app.views : [null];
    for (let v = 0; v < views.length; v++) {
      if (views[v]) {
        await scr.locator('button', { hasText: views[v] }).first().click();
        await page.waitForTimeout(400);
      }
      const name = `app${app.i ? app.i : ''}-${String(v + 1).padStart(2, '0')}`;
      await scr.scrollIntoViewIfNeeded();
      await scr.screenshot({ path: join(out, group, `${name}.jpg`), type: 'jpeg', quality: 82 });
      const box = await scr.boundingBox();
      index.push({
        group,
        id: name,
        file: `${group}/${name}.jpg`,
        label: `${group} console · ${views[v] || 'main'}`,
        w: Math.round(box.width),
        h: Math.round(box.height),
      });
    }
  }
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`${index.length} screens; swapped: ${[...swapped].sort().join(', ')}`);
await browser.close();
