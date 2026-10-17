import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain ESM script without type declarations.
import { findPhysicalClasses } from '@/scripts/check-logical-classes.mjs';

type Hit = { line: number; token: string; suggestion: string };
const find = (src: string) => findPhysicalClasses(src) as Hit[];

describe('lint:rtl finds physical direction classes', () => {
  it.each([
    ['ml-4', 'ms-4'],
    ['pr-2', 'pe-2'],
    ['-left-2', '-start-2'],
    ['right-0', 'end-0'],
    ['text-left', 'text-start'],
    ['border-l', 'border-s'],
    ['border-r-2', 'border-e-2'],
    ['rounded-tl-lg', 'rounded-ss-lg'],
    ['rounded-r', 'rounded-e'],
    ['float-right', 'float-end'],
    ['md:pl-6', 'ps-6'], // the variant stays as written; only the utility is reported

    ['ml-[13px]', 'ms-[13px]'],
  ])('flags %s and suggests %s', (cls, suggestion) => {
    const hits = find(`<div className="flex ${cls} gap-2" />`);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.suggestion).toBe(suggestion);
  });

  it.each([
    'ms-4 me-2 ps-3 pe-1 start-0 end-0 text-start text-end border-s border-e rounded-s rounded-ee',
    'border-red-500 text-right-aligned-label',
    'const left = 0; const right = 1;',
    '// a comment mentioning ml-4 is not a class',
  ])('stays quiet on: %s', (src) => {
    expect(find(`const c = "${src}";`)).toEqual([]);
  });

  it('reports the line number', () => {
    expect(find('const a = "x";\nconst b = "mr-1";')[0]?.line).toBe(2);
  });
});

describe('lint:rtl as a command', () => {
  const script = fileURLToPath(new URL('../../scripts/check-logical-classes.mjs', import.meta.url));

  it('exits 1 with file:line and the replacement, and 0 on clean files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-rtl-'));
    try {
      writeFileSync(join(dir, 'Bad.tsx'), 'export const B = () => <p className="ml-4">x</p>;\n');
      const bad = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('Bad.tsx:1');
      expect(bad.stderr).toContain('use ms-4');

      writeFileSync(join(dir, 'Bad.tsx'), 'export const B = () => <p className="ms-4">x</p>;\n');
      const good = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
      expect(good.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
