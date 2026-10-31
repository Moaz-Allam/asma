#!/usr/bin/env node
/**
 * `npm run launch:gate` — holds temporary content back from real users (spec 0005 AC-25, D100).
 *
 * Run at gate G3, not in CI: while we build, the temporary content is expected. Fails while any Turkish
 * string still awaits the translator (`[tr] `, D58) or any legal text is still a draft (`[draft] `).
 * Part 2 of position 01 adds the landing samples and the site address.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES = ['ar', 'tr', 'en'];
const MARKERS = ['[tr]', '[draft]'];

function strings(node, path = '') {
  if (typeof node === 'string') return [[path, node]];
  return Object.entries(node).flatMap(([key, value]) => strings(value, path ? `${path}.${key}` : key));
}

/** Every marked key per marker, across the catalogues. */
function findMarkers(root) {
  const found = new Map(MARKERS.map((marker) => [marker, []]));
  for (const locale of LOCALES) {
    const catalogue = JSON.parse(readFileSync(join(root, 'messages', `${locale}.json`), 'utf8'));
    for (const [key, value] of strings(catalogue)) {
      for (const marker of MARKERS) {
        if (value.includes(`${marker} `)) found.get(marker).push(`${locale}: ${key}`);
      }
    }
  }
  return found;
}

function main() {
  const found = findMarkers(process.cwd());
  let failed = false;
  for (const [marker, keys] of found) {
    if (keys.length === 0) continue;
    failed = true;
    console.error(`launch:gate: ${keys.length} string(s) still marked ${marker}:`);
    for (const key of keys.slice(0, 10)) console.error(`  ${key}`);
    if (keys.length > 10) console.error(`  and ${keys.length - 10} more`);
  }
  if (failed) process.exit(1);
  console.log('launch:gate: no temporary content left.');
}

main();
