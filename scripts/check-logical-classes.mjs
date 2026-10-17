#!/usr/bin/env node
/**
 * `npm run lint:rtl` — fails on physical direction utilities and names the logical replacement.
 *
 * Direction is derived from the locale at runtime (ar = RTL, tr and en = LTR), so `ml-4` is wrong in
 * one direction by construction. The write guard catches this at write time for agents; this script
 * catches it for every commit, in CI. Rule 10, context/ui-rules.md §3.
 *
 * Usage: node scripts/check-logical-classes.mjs [file or directory ...]
 *        (defaults to app, components, lib). Exit 1 when anything is found.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.css']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'test-results', 'playwright-report']);

/** Physical utility prefix → its logical replacement. Longest prefixes first. */
const REPLACEMENTS = [
  ['scroll-ml', 'scroll-ms'],
  ['scroll-mr', 'scroll-me'],
  ['scroll-pl', 'scroll-ps'],
  ['scroll-pr', 'scroll-pe'],
  ['rounded-tl', 'rounded-ss'],
  ['rounded-tr', 'rounded-se'],
  ['rounded-bl', 'rounded-es'],
  ['rounded-br', 'rounded-ee'],
  ['rounded-l', 'rounded-s'],
  ['rounded-r', 'rounded-e'],
  ['border-l', 'border-s'],
  ['border-r', 'border-e'],
  ['text-left', 'text-start'],
  ['text-right', 'text-end'],
  ['float-left', 'float-start'],
  ['float-right', 'float-end'],
  ['clear-left', 'clear-start'],
  ['clear-right', 'clear-end'],
  ['ml', 'ms'],
  ['mr', 'me'],
  ['pl', 'ps'],
  ['pr', 'pe'],
  ['left', 'start'],
  ['right', 'end'],
];

// A utility starts at a class boundary (start, space, quote, backtick, colon for variants like md:,
// or a leading minus for negatives) and ends at a class boundary.
const PREFIX = REPLACEMENTS.map(([p]) => p.replace(/-/g, '\\-')).join('|');
const UTILITY = new RegExp(
  `(?<=^|[\\s'"\`:{(,])-?(${PREFIX})(?:-(?:\\d+(?:\\.\\d+)?|px|auto|full|\\d+\\/\\d+|\\[[^\\]\\s]+\\]|(?:xs|sm|md|lg|xl|\\dxl)|none))?(?=$|[\\s'"\`;,)}])`,
  'g',
);

// Utilities that only exist with a value; a bare `left` or `pr` in prose is not a class.
const NEEDS_VALUE = new Set([
  'ml',
  'mr',
  'pl',
  'pr',
  'left',
  'right',
  'scroll-ml',
  'scroll-mr',
  'scroll-pl',
  'scroll-pr',
]);

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

export function findPhysicalClasses(source) {
  const hits = [];
  const lines = stripComments(source).split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const match of line.matchAll(UTILITY)) {
      const token = match[0];
      const prefix = match[1];
      if (NEEDS_VALUE.has(prefix) && token.replace(/^-/, '') === prefix) continue;
      const logical = REPLACEMENTS.find(([p]) => p === prefix)[1];
      hits.push({ line: i + 1, token, suggestion: token.replace(prefix, logical) });
    }
  });
  return hits;
}

function collect(path, out) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) if (!SKIP_DIRS.has(entry)) collect(join(path, entry), out);
  } else if (EXTENSIONS.has(extname(path)) && !/\.(test|spec)\.tsx?$/.test(path)) {
    out.push(path);
  }
}

const isMain =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const targets = process.argv.slice(2);
  const files = [];
  for (const t of targets.length ? targets : ['app', 'components', 'lib']) collect(t, files);

  let count = 0;
  for (const file of files) {
    for (const hit of findPhysicalClasses(readFileSync(file, 'utf8'))) {
      count++;
      console.error(`${relative(process.cwd(), file)}:${hit.line}  ${hit.token}  →  use ${hit.suggestion}`);
    }
  }
  if (count) {
    console.error(
      `\nlint:rtl: ${count} physical direction class(es). Use logical properties (ui-rules.md §3).`,
    );
    process.exit(1);
  }
  console.log(`lint:rtl: ${files.length} file(s) checked, no physical direction classes.`);
}
