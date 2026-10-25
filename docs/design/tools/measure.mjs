// Measure the visual values a Claude Design export actually uses, from computed styles inside the
// product frames (.scr) of the customer, provider and admin files. Feeds context/ui-tokens.md.
// Usage (from the repo root): node docs/design/tools/measure.mjs <unzipped export> <report.json>
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: node docs/design/tools/measure.mjs <export dir> <report.json>');
  process.exit(1);
}
const FILES = ['Nazzafly Web Mockups.dc.html', 'Nazzafly Provider Web.dc.html', 'Nazzafly Admin.dc.html'];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
const total = {};

for (const f of FILES) {
  await page.goto(pathToFileURL(join(src, f)).href, { waitUntil: 'networkidle', timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  const r = await page.evaluate(() => {
    const res = {};
    const add = (cat, key) => {
      (res[cat] ??= {})[key] = (res[cat][key] || 0) + 1;
    };
    const hex = (c) => {
      const m = c.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
      if (!m) return c;
      const h = [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
      return m[4] !== undefined && +m[4] < 1 ? `#${h}@${(+m[4]).toFixed(2)}` : `#${h}`;
    };
    for (const scr of document.querySelectorAll('.scr')) {
      for (const e of scr.querySelectorAll('*')) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
          const fam = cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
          add('type', `${fam} | ${cs.fontSize} | ${cs.fontWeight} | ${cs.lineHeight} | ${cs.letterSpacing}`);
          add('textColor', hex(cs.color));
          if (/^H[1-4]$/.test(e.tagName))
            add(
              'heading',
              `${e.tagName.toLowerCase()} | ${fam} | ${cs.fontSize} | ${cs.fontWeight} | ${cs.letterSpacing}`,
            );
          if (e.tagName === 'BUTTON' || e.classList.contains('pill'))
            add(
              'button',
              `${fam} | ${cs.fontSize} | ${cs.fontWeight} | pad ${cs.padding} | r ${cs.borderRadius} | bg ${hex(cs.backgroundColor)} | fg ${hex(cs.color)}`,
            );
        }
        if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') add('background', hex(cs.backgroundColor));
        if (cs.borderTopLeftRadius !== '0px') add('radius', cs.borderTopLeftRadius);
        if (cs.boxShadow !== 'none') add('shadow', cs.boxShadow);
        if (cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none')
          add('border', `${cs.borderTopWidth} ${hex(cs.borderTopColor)}`);
        if (cs.padding !== '0px') add('padding', cs.padding);
        if (cs.gap && cs.gap !== 'normal' && cs.gap !== '0px') add('gap', cs.gap);
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName))
          add(
            'input',
            `${cs.fontSize} | pad ${cs.padding} | r ${cs.borderRadius} | border ${cs.borderTopWidth} ${hex(cs.borderTopColor)} | h ${cs.height}`,
          );
      }
    }
    return res;
  });
  for (const [cat, m] of Object.entries(r))
    for (const [k, n] of Object.entries(m)) (total[cat] ??= {})[k] = (total[cat][k] || 0) + n;
}
const sorted = Object.fromEntries(
  Object.entries(total).map(([cat, m]) => [
    cat,
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 60),
  ]),
);
writeFileSync(out, JSON.stringify(sorted, null, 2) + '\n');
console.log(`report written to ${out}`);
await browser.close();
